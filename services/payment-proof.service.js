/**
 * Header Doc
 * Purpose: Business rules alur "pelanggan kirim bukti bayar → admin konfirmasi". MEMUTUSKAN dulu
 *   apakah foto masuk itu memang kandidat bukti bayar (`evaluateIntake` → lib/payment-proof-intake-policy),
 *   baru menyimpan bukti + snapshot tagihan, memberi notif admin BERGAMBAR, lalu mengeksekusi
 *   konfirmasi (catat lunas via settleTagihanPayment: applyPaymentStatusChange + reaktivasi
 *   best-effort), penolakan, atau penghapusan. Semua teks user-facing dirender lewat template
 *   (response_templates.json) dengan fallback aman.
 *
 *   GERBANG UANG (14-07): klaim "bukti pembayaran" hanya boleh berdiri kalau pelanggan PUNYA yang
 *   bisa dilunasi. Sebelumnya snapshot tagihan dihitung, disimpan, bahkan dicetak ke admin sebagai
 *   "SUDAH LUNAS (mungkin bukan bukti bayar)" — tapi TIDAK PERNAH dipakai sebagai gerbang, sehingga
 *   foto koordinasi CCTV dari pelanggan nol-tunggakan tetap masuk antrian & pelanggannya dibalas
 *   "kalau ini bukti pembayaran…". Angka itu sekarang jadi gerbang, bukan sekadar label.
 * Caller: message/handlers/payment-proof-handler.js (evaluateIntake + submit);
 *   routes/admin-konfirmasi-bayar-routes.js (list/serve/konfirmasi/tolak/hapus lewat portal);
 *   message/handlers/payment-proof-admin-handler.js (konfirmasi/tolak/hapus lewat WhatsApp).
 * Deps: repositories/payment-proof.repository, lib/payment-proof-intake-policy (keputusan MURNI),
 *   lib/payment-finance-service, lib/services/bill-payment-settlement,
 *   lib/services/paid-receipt (struk lunas kanonik — JANGAN bikin template struk sendiri),
 *   lib/whatsapp-delivery-service, lib/whatsapp-critical-delivery, lib/admin-recipients, lib/template-service, lib/id-generator.
 * MainFuncs: createPaymentProofService/getPaymentProofService ->
 *   { evaluateIntake, handleIncomingProof, listPending, getById, getFilePath, confirmProof, confirmManyPending, rejectProof, deleteProof }.
 * SideEffects: Tulis store + file bukti, kirim WA (notif admin bergambar + notifikasi hasil ke pelanggan),
 *   menulis ledger pembayaran (paid) + reaktivasi MikroTik via settlement.
 *   CATATAN: evaluateIntake MURNI-BACA (tak menulis apa pun). deleteProof TIDAK mengirim apa pun ke
 *   pelanggan & TIDAK menyentuh ledger — ia hanya membuang entri dari antrian (untuk foto yang
 *   ternyata BUKAN bukti bayar, mis. keluhan).
 */
"use strict";

const { createPaymentProofRepository } = require("../repositories/payment-proof.repository");
const financeService = require("../lib/payment-finance-service");
const { createBillPaymentSettlement } = require("../lib/services/bill-payment-settlement");
const { renderCategoryTemplate } = require("../lib/template-service");
const { getAdminJids } = require("../lib/admin-recipients");
const { generatePaymentProofId } = require("../lib/id-generator");
const { classifyIncomingPhoto, ACTION } = require("../lib/payment-proof-intake-policy");

function renderResponseTemplate(key, data = {}, fallback = "") {
    const result = renderCategoryTemplate("responseTemplates", key, data);
    return result.found && result.text.trim() ? result.text : (fallback || key);
}

function formatRupiah(value) {
    return `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
}

function padPeriod(month, year) {
    return `${String(month).padStart(2, "0")}/${year}`;
}

// Bungkus settlement secara lazy — createBillPaymentSettlement() meng-`require` MikroTik/isolir saat
// dikonstruksi. Menundanya sampai konfirmasi pertama menjaga konstruksi service tetap ringan (mis. saat
// hanya submit bukti / saat di-import di test) tanpa menarik dependency berat WA/MikroTik.
function createLazyBillSettlement() {
    let impl = null;
    return {
        settleTagihanPayment: (args) => {
            if (!impl) impl = createBillPaymentSettlement();
            return impl.settleTagihanPayment(args);
        }
    };
}

function defaultDeps() {
    const delivery = require("../lib/whatsapp-delivery-service");
    return {
        repository: createPaymentProofRepository(),
        getCurrentBillingPeriod: financeService.getCurrentBillingPeriod,
        getPaymentPositionForPeriod: financeService.getPaymentPositionForPeriod,
        getEffectivePrice: financeService.getEffectivePrice,
        billSettlement: createLazyBillSettlement(),
        sendMessageToMany: delivery.sendMessageToMany,
        sendCritical: require("../lib/whatsapp-critical-delivery").sendCritical,
        buildPaidReceiptText: require("../lib/services/paid-receipt").buildPaidReceiptText,
        getAdminJids: () => getAdminJids(),
        findUserById: (id) =>
            (Array.isArray(global.users) ? global.users : []).find((u) => String(u.id) === String(id)) || null,
        getConfig: () => (global.config || {}),
        logger: console
    };
}

function createPaymentProofService(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };

    function logError(msg, err) {
        if (deps.logger && deps.logger.error) deps.logger.error(msg, err && err.message ? err.message : err);
    }
    function logWarn(msg, extra) {
        if (deps.logger && deps.logger.warn) deps.logger.warn(msg, extra);
    }

    // Snapshot tagihan periode berjalan — dipakai untuk label admin (BELUM/SUDAH LUNAS) & audit.
    async function buildBillingSnapshot(user) {
        const { periodMonth, periodYear } = deps.getCurrentBillingPeriod();
        const amountDue = deps.getEffectivePrice(user) || 0;
        let outstanding = null;
        let isFullyPaid = null;
        try {
            const position = await deps.getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue });
            outstanding = position.outstanding;
            isFullyPaid = position.is_fully_paid;
        } catch (err) {
            logError("[PAYMENT_PROOF] Snapshot tagihan gagal:", err);
        }
        return { periodMonth, periodYear, amountDue, outstanding, isFullyPaid };
    }

    async function notifyAdminsOfProof(record, billing, buffer, fileType) {
        const admins = deps.getAdminJids();
        if (!admins || admins.length === 0) {
            logWarn("[PAYMENT_PROOF] Tak ada JID admin untuk notif bukti bayar");
            return;
        }

        const cfg = deps.getConfig();
        // `site_url_bot` adalah URL INTERNAL bot (mis. http://127.0.0.1:3100) — tak bisa dibuka dari
        // HP admin. Utamakan `paymentProof.adminUrl` (URL portal publik) bila diisi.
        const baseUrl = (cfg.paymentProof && cfg.paymentProof.adminUrl)
            || cfg.site_url_bot
            || "http://localhost:3100";
        const adminUrl = `${String(baseUrl).replace(/\/+$/, "")}/konfirmasi-bayar`;
        const statusLabel = billing.isFullyPaid === true
            ? "SUDAH LUNAS (tak ada tagihan terbuka)"
            : (billing.isFullyPaid === false ? "BELUM LUNAS" : "status tak diketahui");
        const tagihanNominal = billing.outstanding != null && billing.outstanding > 0
            ? billing.outstanding
            : record.amountDue;

        // SARAN AKSI IKUT BUKTI, bukan kebiasaan. Notif lama selalu memimpin dengan "balas *ok*" —
        // termasuk untuk pelanggan yang jelas-jelas TIDAK punya tagihan. Di prod 11 dari 13 bukti
        // dikonfirmasi refleks oleh admin yang sama; satu "ok" pada foto keluhan = tagihan tercatat
        // LUNAS tanpa uang masuk. Kalau tak ada yang bisa dilunasi, yang dipimpin adalah *hapus*.
        const looksLikeProof = billing.isFullyPaid === false;
        const saran = looksLikeProof
            ? renderResponseTemplate("payment_proof_admin_hint_due", {}, "👉 *Balas pesan ini*: *ok* (catat lunas) · *tolak <alasan>* · *hapus* (ternyata bukan bukti bayar).")
            : renderResponseTemplate("payment_proof_admin_hint_nodue", {}, "⚠️ Pelanggan ini *tidak punya tagihan terbuka* — besar kemungkinan ini BUKAN bukti pembayaran (mis. foto keluhan).\n👉 *Balas pesan ini* dengan *hapus* untuk membuang dari antrian. *ok* hanya bila ini benar-benar pembayaran di muka.");

        const caption = renderResponseTemplate("payment_proof_admin_notification", {
            id: record.id,
            nama: record.userName,
            telepon: record.phone,
            status: statusLabel,
            tagihan: formatRupiah(tagihanNominal),
            periode: padPeriod(record.periodMonth, record.periodYear),
            saran,
            adminUrl
        }, `📸 *Dugaan bukti pembayaran*\n\nPelanggan: ${record.userName} (${record.phone})\nStatus: *${statusLabel}*\nTagihan ${padPeriod(record.periodMonth, record.periodYear)}: ${formatRupiah(tagihanNominal)}\n\n${saran}\n\nBisa juga ketik *bukti* untuk melihat antrian.\n\nKode: ${record.id}\nPortal: ${adminUrl}`);

        const payload = fileType === "document"
            ? { document: buffer, fileName: `${record.id}.pdf`, mimetype: "application/pdf", caption }
            : { image: buffer, caption };

        const res = await deps.sendMessageToMany(admins, payload);
        if (!res || !res.sent) {
            logWarn("[PAYMENT_PROOF] Notif admin tidak terkirim", res && res.errorCode);
        }
    }

    /**
     * Teriak ke admin saat "catat lunas" GAGAL. Tanpa ini kegagalan hanya jadi satu baris log:
     * admin sudah membalas "ok", pelanggan merasa lunas, tapi tagihan tetap terbuka dan uangnya
     * tak masuk ledger — persis insiden 03-08-2026 (SQLITE_IOERR pada koneksi tulis). NEVER-THROW:
     * kegagalan notifikasi tak boleh menutupi kegagalan aslinya.
     */
    async function alertAdminsSettleFailed(record, user, err) {
        try {
            const admins = deps.getAdminJids();
            if (!admins || admins.length === 0) {
                logWarn("[PAYMENT_PROOF] Tak ada JID admin untuk alert gagal catat lunas");
                return;
            }

            const text = renderResponseTemplate("payment_proof_settle_failed_admin", {
                id: record.id,
                nama: (user && user.name) || record.userName,
                periode: padPeriod(record.periodMonth, record.periodYear),
                nominal: formatRupiah(record.amountDue),
                alasan: err && err.message ? err.message : String(err)
            }, `🚨 *GAGAL CATAT LUNAS*\n\nPelanggan: ${(user && user.name) || record.userName}\nPeriode: ${padPeriod(record.periodMonth, record.periodYear)}\nNominal: ${formatRupiah(record.amountDue)}\nKode bukti: ${record.id}\n\nPenyebab: ${err && err.message ? err.message : String(err)}\n\n⚠️ Pembayaran ini *BELUM tercatat*. Tagihan masih terbuka dan uangnya belum masuk rekap. Coba konfirmasi ulang; kalau tetap gagal, laporkan ke teknis.`);

            const res = await deps.sendMessageToMany(admins, { text });
            if (!res || !res.sent) {
                logWarn("[PAYMENT_PROOF] Alert gagal-catat-lunas tidak terkirim", res && res.errorCode);
            }
        } catch (alertErr) {
            logError("[PAYMENT_PROOF] Alert gagal-catat-lunas error:", alertErr);
        }
    }

    /**
     * GERBANG INTAKE — dipanggil SEBELUM media diunduh & sebelum apa pun disimpan.
     *
     * Mengumpulkan bukti (snapshot tagihan) lalu menyerahkan keputusan ke `classifyIncomingPhoto`
     * (fungsi MURNI, satu-satunya tempat aturannya hidup). Tidak menulis apa pun.
     *
     * @returns {Promise<{action: string, reason: string, advance: boolean, billing: object|null, ackText: string|null}>}
     */
    async function evaluateIntake({ user, caption = "", adminActive = false, signalReady = true, recentComplaint = false }) {
        // Short-circuit murah: kalau admin sedang mengetik di chat ini, jangan sampai kita membuang
        // query tagihan — dan JANGAN bersuara. Aturannya tetap hidup (dan diuji) di policy.
        if (adminActive) {
            return { action: ACTION.SILENT, reason: "admin-aktif", advance: false, billing: null, ackText: null };
        }

        const billing = await buildBillingSnapshot(user);
        const decision = classifyIncomingPhoto({
            adminActive: false,
            signalReady,
            billing,
            userStatus: user && user.status,
            caption,
            recentComplaint
        });

        let ackText = null;
        if (decision.action === ACTION.COMPLAINT) {
            ackText = renderResponseTemplate("payment_proof_complaint_ack", {
                nama: (user && user.name) || "Kak"
            }, "Foto kamu sudah kami terima 🙏\n\nKalau ini soal *gangguan/kendala*, ketik *lapor* ya supaya langsung kami buatkan tiket ke teknisi.");
        } else if (decision.action === ACTION.NEUTRAL) {
            // Ack NETRAL: sengaja TIDAK menyebut kata "pembayaran" sama sekali. Inilah sumber
            // misleading-nya — bot menanamkan bingkai bayar ke percakapan yang bukan soal bayar.
            ackText = renderResponseTemplate("payment_proof_neutral_ack", {
                nama: (user && user.name) || "Kak"
            }, "Foto kamu sudah kami terima 🙏\n\nAda yang bisa kami bantu? Kalau ada *kendala jaringan*, ketik *lapor* ya.");
        }

        return { ...decision, billing, ackText };
    }

    /**
     * Fase 1: simpan bukti + snapshot tagihan + notif admin. Kembalikan ackText untuk dibalas ke
     * pelanggan oleh handler (lewat reply-runtime yang aman untuk @lid).
     */
    async function handleIncomingProof({
        user,
        canonicalSender,
        pushname,
        messageType,
        buffer,
        caption = "",
        billing: precomputedBilling = null,
        intakeReason = null,
        advance = false
    }) {
        const ext = messageType === "documentMessage" ? "pdf" : "jpg";
        const fileType = messageType === "documentMessage" ? "document" : "image";
        // Snapshot tagihan sudah dihitung oleh evaluateIntake — pakai ulang agar tidak query dua kali
        // DAN agar keputusan gerbang & isi record berdiri di atas angka yang PERSIS SAMA.
        const billing = precomputedBilling || await buildBillingSnapshot(user);
        // Semua pesan bertema TAGIHAN menyapa dengan nama PEMILIK AKUN (DB), bukan pushname WhatsApp.
        // Pushname sering nama anggota keluarga pemegang HP; menyapa "Halo Aulia" lalu mengirim struk
        // atas nama "Widji Rochani" di percakapan yang sama terlihat seperti dua sistem berbeda.
        const displayName = user.name || pushname || (canonicalSender ? String(canonicalSender).split("@")[0] : "Pelanggan");

        const record = {
            id: generatePaymentProofId(),
            userId: canonicalSender,            // JID kanonik → target notifikasi hasil
            userDbId: user.id,
            userName: user.name || displayName,
            phone: user.phone_number || (canonicalSender ? String(canonicalSender).split("@")[0] : ""),
            periodMonth: billing.periodMonth,
            periodYear: billing.periodYear,
            amountDue: billing.amountDue,
            outstandingAtSubmit: billing.outstanding,
            wasFullyPaidAtSubmit: billing.isFullyPaid,
            fileType,
            caption: caption || "",
            submittedAt: new Date().toISOString(),
            status: "pending",
            // Jejak audit gerbang: KENAPA foto ini dianggap kandidat bukti bayar. Tanpa ini,
            // salah-tangkap berikutnya tak bisa dilacak sebabnya (dan kita hanya bisa menebak lagi).
            intakeReason: intakeReason || null,
            isAdvancePayment: Boolean(advance),
            verifiedBy: null,
            verifiedAt: null,
            notes: null
        };

        const saved = await deps.repository.create(record, buffer, ext);

        // Notif admin best-effort — kegagalan kirim TIDAK menggagalkan pencatatan bukti.
        await notifyAdminsOfProof(saved, billing, buffer, fileType).catch((err) =>
            logError("[PAYMENT_PROOF] Notif admin error:", err));

        const ackText = renderResponseTemplate("payment_proof_received", {
            nama: displayName
        }, `Foto/bukti kamu sudah kami terima ✅\n\nKalau ini *bukti pembayaran*, admin akan segera mengecek & mengonfirmasi — kami kabari setelah beres. 🙏\nKalau kamu mau *lapor gangguan*, ketik *lapor* ya.`);

        return { record: saved, billing, ackText };
    }

    // ── Fase 2/3: sisi admin ──

    function listPending() {
        return deps.repository
            .listPending()
            .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
    }

    function getById(id) {
        return deps.repository.getById(id);
    }

    function getFilePath(record) {
        return deps.repository.getFilePath(record);
    }

    // Struk pelanggan memakai BUILDER BERSAMA (lib/services/paid-receipt) — bukan template sendiri.
    // Semua jalur pelunasan harus menghasilkan struk yang sama bentuknya; kode bukti (BP-…) dipakai
    // sebagai nomor rujukan supaya pelanggan punya pegangan bila ingin menanyakan pembayarannya.
    async function notifyCustomerConfirmed(record, user, settlement) {
        const text = deps.buildPaidReceiptText({
            user,
            amount: record.amountDue,
            periodMonth: record.periodMonth,
            periodYear: record.periodYear,
            // Pasangan dari asumsi di ~:383 — lihat catatan KEPUTUSAN PEMILIK 2026-08-16 di sana.
            // Sengaja dipertahankan; keduanya harus berubah bersama bila keputusan itu dicabut.
            method: "Transfer Bank",
            paidAt: new Date(),
            refId: record.id,
            reactivation: settlement && settlement.reactivation
        });
        // Kontrak sendCritical: payload WAJIB objek { text }.
        await deps.sendCritical(record.userId, { text }, { label: "payment-proof-confirmed" });
    }

    async function notifyCustomerRejected(record, reason) {
        const text = renderResponseTemplate("payment_proof_rejected", {
            nama: record.userName,
            alasan: reason || "-"
        }, `Mohon maaf ${record.userName}, bukti pembayaran yang kamu kirim belum bisa kami konfirmasi.\nAlasan: ${reason || "-"}\n\nSilakan kirim ulang bukti yang jelas atau hubungi admin ya 🙏`);
        // Kontrak sendCritical: payload WAJIB objek { text }.
        await deps.sendCritical(record.userId, { text }, { label: "payment-proof-rejected" });
    }

    /**
     * Konfirmasi bukti → catat lunas (fail-closed) + reaktivasi best-effort + struk pelanggan.
     * Idempoten: record non-pending ditolak; ledger yang sudah lunas → no_change (tanpa struk ganda).
     */
    async function confirmProof(id, { adminName = "admin", notes = "", allowNoOutstanding = false } = {}) {
        const record = deps.repository.getById(id);
        if (!record) return { ok: false, reason: "not_found" };
        if (record.status !== "pending") return { ok: false, reason: "already_processed", status: record.status };

        const user = deps.findUserById(record.userDbId);
        if (!user) return { ok: false, reason: "user_not_found" };

        // GERBANG KONFIRMASI: menolak melunasi apa yang tidak terutang.
        // Dulu record semacam ini tetap dibalik jadi "confirmed" walau settlement menghasilkan
        // ledger `no_change` — antrian jadi BERBOHONG (tampak terkonfirmasi, padahal tak ada apa pun
        // yang dilunasi), dan admin merasa sudah memproses bukti yang sebenarnya bukan bukti bayar.
        // Sekarang: kalau tak ada yang bisa dilunasi, katakan apa adanya dan arahkan ke *hapus*.
        if (!allowNoOutstanding) {
            try {
                const position = await deps.getPaymentPositionForPeriod(user, record.periodMonth, record.periodYear, {
                    amountDue: record.amountDue || deps.getEffectivePrice(user)
                });
                if (position && position.is_fully_paid === true) {
                    return {
                        ok: false,
                        reason: "no_outstanding",
                        periodMonth: record.periodMonth,
                        periodYear: record.periodYear
                    };
                }
            } catch (err) {
                // Tagihan tak terbaca ≠ tagihan nol. Jangan memblokir admin karena DB sedang ngambek;
                // lanjutkan — settleTagihanPayment sendiri idempoten & fail-closed.
                logWarn("[PAYMENT_PROOF] Cek tagihan saat konfirmasi gagal (lanjut):", err.message);
            }
        }

        let settlement;
        try {
            settlement = await deps.billSettlement.settleTagihanPayment({
                user,
                amountPaid: record.amountDue || deps.getEffectivePrice(user),
                periodMonth: record.periodMonth,
                periodYear: record.periodYear,
                // KEPUTUSAN PEMILIK 2026-08-16 — SENGAJA dipertahankan, JANGAN "diperbaiki".
                //
                // Record bukti bayar tak punya field metode (lihat bentuknya di ~baris 258):
                // sistem memang tak tahu pelanggan membayar dengan apa, jadi nilai ini ASUMSI,
                // bukan data. Terukur di produksi 2026-08-16: 36 konfirmasi (Rp5.065.000) di
                // Dander dan 42 (Rp5.535.000) di Tanjungharjo melewati jalur ini, yaitu 51%
                // dan 58% dari SELURUH angka "Transfer Bank" di /rekap-keuangan. Caption
                // pelanggan hampir tak pernah menyebut metode (0 dari 39 · 3 dari 47), jadi
                // tak ada yang bisa disimpulkan otomatis.
                //
                // Pemilik diberi empat pilihan (wajib pilih metode / opsional dengan default
                // netral / selalu netral BUKTI_BAYAR / biarkan) dan memilih MEMBIARKAN, dengan
                // alasan mayoritas pengirim foto memang transfer dan jalur WA `ok` harus tetap
                // satu ketukan. Data lama juga sengaja tidak ditandai ulang.
                //
                // Konsekuensi yang diterima secara sadar: pembayaran tunai/QRIS yang
                // dikonfirmasi lewat foto ikut terhitung transfer bank, dan pelanggannya
                // menerima struk bermetode "Transfer Bank". Baris di bawah (~:320) punya
                // asumsi yang sama dan harus ikut berubah bila keputusan ini dicabut.
                paymentMethod: "TRANSFER_BANK",
                reffId: record.id
            });
        } catch (err) {
            logError("[PAYMENT_PROOF] Gagal catat lunas:", err);
            // Kegagalan di sini BERARTI UANG TAK TERCATAT — jangan biarkan cuma jadi baris log.
            await alertAdminsSettleFailed(record, user, err);
            return { ok: false, reason: "settle_failed", error: err.message };
        }

        const ledgerAction = settlement.ledger && settlement.ledger.action;
        const updated = await deps.repository.update(id, {
            status: "confirmed",
            verifiedBy: adminName,
            verifiedAt: new Date().toISOString(),
            notes: notes || null,
            ledgerAction: ledgerAction || null,
            reactivation: settlement.reactivation || null
        });

        // Struk hanya bila transaksi INI yang membuat lunas (hindari struk ganda saat double-confirm).
        if (ledgerAction === "paid") {
            await notifyCustomerConfirmed(record, user, settlement)
                .catch((err) => logError("[PAYMENT_PROOF] Struk pelanggan gagal:", err));
        }

        // `user` disertakan supaya pemanggil (mis. route web konfirmasi-bayar) bisa mengalarmi
        // admin dgn pppoe_username saat reaktivasi gagal — record bukti tak menyimpan pppoe.
        return { ok: true, record: updated, settlement, user, alreadyPaid: ledgerAction !== "paid" };
    }

    /**
     * Konfirmasi SEMUA bukti pending sekaligus ("terima semua"). Menyelesaikan tiap bukti lewat
     * confirmProof YANG SAMA — jadi gerbang uangnya identik: bukti tanpa tagihan terbuka DILEWATI
     * (reason no_outstanding), TIDAK PERNAH ditandai lunas. Berjalan dalam SATU giliran pesan (satu
     * kunci per-pengirim) sehingga tak ada perintah yang hilang di tengah antrian. NEVER-THROW per item:
     * kegagalan satu bukti tak menggagalkan sisanya.
     *
     * @returns {Promise<{total, confirmed:[], alreadyPaid:[], skipped:[], failed:[]}>}
     */
    async function confirmManyPending({ adminName = "admin" } = {}) {
        const items = listPending(); // sudah terurut submittedAt (lama → baru)
        const confirmed = [];
        const alreadyPaid = [];
        const skipped = [];
        const failed = [];

        for (const item of items) {
            let res;
            try {
                res = await confirmProof(item.id, { adminName });
            } catch (err) {
                logError("[PAYMENT_PROOF] confirmManyPending item error:", err);
                failed.push({ id: item.id, userName: item.userName, error: err && err.message ? err.message : String(err) });
                continue;
            }

            if (res && res.ok) {
                const rec = res.record || item;
                if (res.alreadyPaid) {
                    alreadyPaid.push({ id: item.id, userName: rec.userName || item.userName });
                } else {
                    confirmed.push({
                        id: item.id,
                        userName: rec.userName || item.userName,
                        amountDue: rec.amountDue != null ? rec.amountDue : item.amountDue,
                        reactivation: res.settlement && res.settlement.reactivation
                    });
                }
            } else if (res && res.reason === "no_outstanding") {
                skipped.push({ id: item.id, userName: item.userName, reason: "no_outstanding" });
            } else {
                failed.push({ id: item.id, userName: item.userName, reason: (res && res.reason) || "unknown", error: res && res.error });
            }
        }

        return { total: items.length, confirmed, alreadyPaid, skipped, failed };
    }

    /**
     * Tolak bukti → tandai rejected + beri tahu pelanggan (best-effort, tak melempar).
     */
    async function rejectProof(id, { adminName = "admin", reason = "" } = {}) {
        const record = deps.repository.getById(id);
        if (!record) return { ok: false, reason: "not_found" };
        if (record.status !== "pending") return { ok: false, reason: "already_processed", status: record.status };

        const updated = await deps.repository.update(id, {
            status: "rejected",
            verifiedBy: adminName,
            verifiedAt: new Date().toISOString(),
            notes: reason || null
        });

        await notifyCustomerRejected(record, reason)
            .catch((err) => logError("[PAYMENT_PROOF] Notif tolak pelanggan gagal:", err));

        return { ok: true, record: updated };
    }

    /**
     * Hapus bukti PALSU (foto yang ternyata BUKAN bukti bayar — mis. keluhan yang salah tertangkap).
     * BEDA TEGAS dari rejectProof: jalur ini SENGAJA TIDAK mengirim apa pun ke pelanggan (mereka tak
     * pernah mengaku bayar, jadi pesan "pembayaran ditolak" akan membingungkan) dan TIDAK menyentuh
     * ledger. Cukup buang entri dari antrian: tandai status "deleted" (jejak audit tetap) & buang file.
     * Idempoten: hanya record berstatus pending yang bisa dihapus.
     */
    async function deleteProof(id, { adminName = "admin", reason = "" } = {}) {
        const record = deps.repository.getById(id);
        if (!record) return { ok: false, reason: "not_found" };
        if (record.status !== "pending") return { ok: false, reason: "already_processed", status: record.status };

        const updated = await deps.repository.softDelete(id, {
            status: "deleted",
            verifiedBy: adminName,
            verifiedAt: new Date().toISOString(),
            notes: reason || null
        });

        // Tidak ada notifyCustomer* di sini — itulah inti "hapus" vs "tolak".
        return { ok: true, record: updated };
    }

    return {
        deps,
        evaluateIntake,
        handleIncomingProof,
        listPending,
        getById,
        getFilePath,
        confirmProof,
        confirmManyPending,
        rejectProof,
        deleteProof
    };
}

let _singleton = null;
function getPaymentProofService() {
    if (!_singleton) _singleton = createPaymentProofService();
    return _singleton;
}

module.exports = { createPaymentProofService, getPaymentProofService };
