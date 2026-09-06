/**
 * Header Doc
 * Purpose: Halaman bayar tagihan bulanan publik (tanpa login, via token bertanda-tangan) +
 *   API-nya: info tagihan & channel aktif, buat charge iPaymu multi-channel, polling status.
 *   MULTI-GATEWAY (config `paymentGateway`: 'ipaymu' | 'tripay' | 'mayar') + mode halaman:
 *   - Tripay aktif → alur REDIRECT ke halaman Tripay (auto-settle) + callback POST /callback/tripay.
 *   - Mayar aktif → alur REDIRECT ke invoice Mayar (auto-settle) + webhook POST /callback/mayar.
 *   - iPaymu + `billPaymentHosted` → REDIRECT ke halaman iPaymu (callback POST /callback/payment).
 *   - iPaymu default → PORTAL sendiri (static/bill-payment.html, multi-channel direct).
 *   Pemilihan gateway via lib/payment-gateways (selector chargeRedirect/verify).
 * Caller: routes-registry (mount di "/").
 * Deps: lib/bill-pay-token, lib/ipaymu, lib/tripay, lib/mayar, lib/payment-gateways, lib/payment,
 *   lib/services/bill-payment-settlement, lib/templating, lib/whatsapp-delivery-service, qr-image, rupiah-format.
 * MainFuncs: GET /bayar/:token (portal/redirect), GET /bayar-status, POST /callback/tripay,
 *   GET /api/bayar/:token/info, POST /api/bayar/:token/charge, GET /api/bayar/:token/status.
 * SideEffects: Membuat transaksi/sesi gateway + menulis record payment.json (tag 'tagihan') + settle + struk WA.
 */
"use strict";

const express = require("express");
const path = require("path");
const qr = require("qr-image");
const convertRupiah = require("rupiah-format");
const rateLimit = require("express-rate-limit");

const { verifyBillPayToken, resolveBaseUrl } = require("../lib/bill-pay-token");
const ipaymu = require("../lib/ipaymu");
const tripay = require("../lib/tripay");
const mayar = require("../lib/mayar");
const gateways = require("../lib/payment-gateways");
const { addPayment, checkStatusPayment, updateStatusPayment, updateKetPayment, findPendingPayment } = require("../lib/payment");
const { acquireLock, releaseLock } = require("../lib/request-lock");

// Umur maksimum transaksi pending yang boleh DIPAKAI ULANG. Harus lebih pendek dari masa
// berlaku transaksi di sisi gateway (QRIS iPaymu ~1 jam) — memulangkan kode yang sudah mati
// di gateway lebih menyesatkan daripada menerbitkan yang baru.
const UMUR_PENDING_BOLEH_PAKAI_ULANG_MS = 45 * 60 * 1000;
const { createBillPaymentSettlement } = require("../lib/services/bill-payment-settlement");
const { putuskanTindakanPascaLunas } = require("../lib/services/bill-payment-aftercare");
const { reactivationNeedsAttention, alertReaktivasiGagal } = require("../lib/services/reactivation-outcome");
// Nominal yang di-charge WAJIB memakai harga efektif (subscription_price per-pelanggan + diskon
// aktif) — sumber yang sama dengan ledger. Memakai `packages.json.price` mentah di sini bukan
// sekadar teks salah: itu jumlah uang yang benar-benar ditarik dari pelanggan.
const { getEffectivePrice, getPaymentPositionForPeriod } = require("../lib/payment-finance-service");
const { sendMessage } = require("../lib/whatsapp-delivery-service");

const billSettlement = createBillPaymentSettlement();

const router = express.Router();
// Halaman bayar PUBLIK: pelanggan menyelesaikan pembayaran di sini. Express 4 hanya menangkap
// lemparan SINKRON, jadi handler `async` polos yang menolak membuat request MENGGANTUNG —
// tanpa 500, tanpa body. Pelanggan melihat spinner sampai gateway timeout, dan tak ada satu
// baris log pun yang menandainya. Beberapa `await` di berkas ini bahkan berada DI LUAR try.
const { asyncHandler } = require("../lib/error-handler");

const chargeLimiter = rateLimit({ windowMs: 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false });

// Verifikasi token + resolve konteks tagihan (pelanggan pascabayar + nominal paket).
async function resolveBillContext(token) {
    const v = verifyBillPayToken(token);
    if (!v.ok) return { ok: false, status: "invalid", reason: v.reason };
    const user = (global.users || []).find((u) => String(u.id) === String(v.uid));
    if (!user) return { ok: false, status: "user_not_found" };
    if (user.subscription === "PAKET-VOUCHER") return { ok: false, status: "not_postpaid", user };
    const pkg = (global.packages || []).find((p) => p.name === user.subscription) || {};
    // Paket pelanggan sudah tidak ada di katalog (dihapus/diganti nama) DAN tak ada harga khusus
    // per-pelanggan → JANGAN menarik uang. `getEffectivePrice` akan jatuh ke `getPackagePrice`
    // yang MENEBAK nominal dari pola nama ("PAKET-150K" → 150.000); menagih angka tebakan lewat
    // gateway tidak boleh terjadi. Arah gagal yang aman: nol, lalu ditahan gerbang di bawah.
    const hargaKhusus = Number.parseInt(user.subscription_price, 10);
    const paketHilang = !pkg.name && !(Number.isFinite(hargaKhusus) && hargaKhusus > 0);

    // TANPA fallback `|| pkg.price`: nol dari getEffectivePrice berarti pelanggan memang tak
    // punya tagihan (gratis / diskon 100%). Fallback akan menarik uang dari orang yang tak
    // berutang — dan di sini nominalnya benar-benar di-charge ke gateway.
    const hargaEfektif = paketHilang ? 0 : getEffectivePrice(user);

    // SISA tagihan, bukan harga penuh. Pelanggan yang sudah mencicil tak boleh ditarik lagi
    // sejumlah penuh — uangnya sudah masuk ledger. Sumbernya sama dengan penagihan.
    // GAGAL-TERTUTUP: ledger tak terbaca → pakai harga efektif (perilaku lama), jangan menebak.
    let amount = hargaEfektif;
    let sudahDibayar = 0;
    if (hargaEfektif > 0) {
        try {
            const { periodMonth, periodYear } = currentPeriod();
            const posisi = await getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue: hargaEfektif });
            if (posisi && Number.isFinite(Number(posisi.outstanding))) {
                amount = Math.max(0, Number(posisi.outstanding));
                sudahDibayar = Math.max(0, hargaEfektif - amount);
            }
        } catch (posErr) {
            console.warn("[BAYAR] Posisi ledger tak terbaca, pakai harga efektif:", posErr && posErr.message);
        }
    }

    return {
        ok: true,
        user,
        pkg,
        whitelist: pkg.whitelist === true,
        packageMissing: paketHilang,
        amountDue: hargaEfektif,
        alreadyPaid: sudahDibayar,
        amount,
        // Flag uji di PAKET (packages.json): user pada paket ber-`sandbox:true` memakai sandbox
        // iPaymu (demo, nol rupiah); paket pelanggan asli tak ber-flag → tetap produksi. Isolasi
        // per-paket, bukan toggle global → pelanggan lain tak terpengaruh.
        sandbox: pkg.sandbox === true,
    };
}

// Status lunas dari snapshot runtime bisa BOOLEAN atau INTEGER, tergantung siapa yang terakhir
// menulisnya: loader boot (`lib/database.js`) mengoersi ke boolean, tetapi jalur pelunasan
// (`lib/payment-finance-service.js` → `paidValue = isPaid ? 1 : 0`) menaruh integer 1 ke snapshot.
// Artinya `paid === true` justru GAGAL tepat setelah pelanggan membayar — persis saat gerbang
// "sudah lunas" paling dibutuhkan. Pakai predikat yang sama dengan services/api-users/update-user-by-id.js.
function isUserPaid(user) {
    const paid = user && user.paid;
    return paid === true || paid === 1 || paid === "1";
}

function currentPeriod() {
    const now = new Date();
    return { periodMonth: now.getMonth() + 1, periodYear: now.getFullYear() };
}

function customerPhoneDigits(user) {
    return String(user.phone_number || "").split("|")[0].trim().replace(/\D/g, "");
}

function customerJid(user) {
    const d = customerPhoneDigits(user);
    return d.length > 5 ? `${d}@s.whatsapp.net` : null;
}

// Mode hosted: alih-alih portal HTML sendiri, buat sesi iPaymu lalu redirect ke halaman iPaymu.
function billPaymentHostedEnabled() {
    return (global.config || {}).billPaymentHosted === true;
}

function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

// Halaman status minimal (untuk mode hosted: kondisi non-charge & landing returnUrl).
function statusPage(title, message) {
    return `<!doctype html><html lang="id"><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>${escHtml(title)}</title><style>` +
        `body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;` +
        `display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}` +
        `.card{max-width:380px;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:28px;text-align:center}` +
        `h1{font-size:18px;margin:0 0 10px}p{font-size:14px;line-height:1.6;color:#cbd5e1;margin:0}</style></head>` +
        `<body><div class="card"><h1>${escHtml(title)}</h1><p>${escHtml(message)}</p></div></body></html>`;
}

// Pakai alur REDIRECT (halaman gateway auto-settle) atau portal HTML sendiri?
//  - Tripay/Mayar aktif → SELALU redirect (halaman gateway hosted auto-settle).
//  - iPaymu + billPaymentHosted → redirect ke halaman iPaymu.
//  - iPaymu default → portal HTML direct (multi-channel sendiri).
function useRedirectFlow() {
    const gw = gateways.getActiveName();
    return gw === "tripay" || gw === "mayar" || billPaymentHostedEnabled();
}

// Halaman bayar — branch by gateway/mode.
router.get("/bayar/:token", chargeLimiter, asyncHandler(async (req, res) => {
    if (!useRedirectFlow()) {
        return res.sendFile(path.join(__dirname, "..", "static", "bill-payment.html"));
    }

    const ctx = await resolveBillContext(req.params.token);
    if (!ctx.ok) return res.status(400).send(statusPage("Link tidak valid", "Tautan pembayaran tidak valid atau sudah kedaluwarsa. Silakan hubungi admin."));
    if (ctx.whitelist) return res.send(statusPage("Tidak Ada Tagihan", `Halo ${ctx.user.name}, paket Anda tidak ditagih. Terima kasih.`));
    if (isUserPaid(ctx.user)) return res.send(statusPage("Sudah Lunas", `Tagihan Anda sudah lunas. Terima kasih, ${ctx.user.name}. 🙏`));
    // Tagihan efektif NOL (diskon penuh / harga khusus 0) BUKAN error konfigurasi — pelanggan
    // memang tak punya yang harus dibayar. Dulu kasus ini mustahil karena nominal selalu diambil
    // dari harga paket; sejak nominal memakai harga efektif, ia nyata dan tak boleh dijawab
    // "Nominal tagihan belum diatur — hubungi admin" yang membuat orang mengira dirinya menunggak.
    if (!ctx.packageMissing && ctx.amount === 0) {
        return res.send(statusPage("Tidak Ada Tagihan", `Halo ${ctx.user.name}, tagihan Anda periode ini Rp0 — tidak ada yang perlu dibayar. Terima kasih. 🙏`));
    }
    if (!ctx.amount || ctx.amount < 1000) return res.status(400).send(statusPage("Tagihan Belum Tersedia", "Nominal tagihan belum diatur. Silakan hubungi admin."));

    const { periodMonth, periodYear } = currentPeriod();

    // Sama seperti jalur /charge: pakai ULANG transaksi pending yang masih hidup. Jalur ini
    // dorman di produksi (aktif hanya untuk Tripay/Mayar atau mode hosted), tapi cacatnya
    // KELAS yang sama — menambalnya hanya di satu jalur adalah pola yang sudah terbukti
    // mahal di proyek ini.
    const pendingLama = findPendingPayment({
        tag: "tagihan", userId: ctx.user.id, periodMonth, periodYear,
        maxAgeMs: UMUR_PENDING_BOLEH_PAKAI_ULANG_MS,
    });
    if (pendingLama && pendingLama.redirectUrl) {
        console.log(`[BILL_REDIRECT_REUSE] Memakai ulang transaksi pending ${pendingLama.reffId} untuk user ${ctx.user.id} periode ${periodMonth}/${periodYear}`);
        return res.redirect(302, pendingLama.redirectUrl);
    }

    const reff = Math.floor(Math.random() * 1677721631342).toString(16);
    const base = resolveBaseUrl(global.config || {});
    const gw = gateways.getActive();

    let charge;
    try {
        charge = await gw.chargeRedirect({
            amount: ctx.amount,
            reffId: reff,
            name: ctx.user.name || "Pelanggan",
            phone: customerPhoneDigits(ctx.user) || "628000000000",
            email: `${reff}@bill.rafnet.local`,
            comment: `Tagihan ${ctx.user.subscription} - ${ctx.user.name}`,
            returnUrl: `${base}/bayar-status`,
            cancelUrl: `${base}/bayar/${encodeURIComponent(req.params.token)}`,
            sandbox: ctx.sandbox,
        });
    } catch (_e) {
        return res.status(502).send(statusPage("Gangguan Pembayaran", "Maaf, gateway pembayaran sedang sibuk. Coba beberapa saat lagi atau hubungi admin."));
    }

    // Persist record (tag 'tagihan') + gateway. trxId = reference gateway (Tripay punya saat
    // creation → callback Tripay verify pakai ini; iPaymu hosted null → callback iPaymu pakai
    // payload trx_id). userId/periode dipakai callback untuk catat lunas + reaktivasi.
    // Label ini ikut tercetak di STRUK pelanggan dan tersimpan sebagai metode di ledger,
    // jadi isinya harus nama gateway saja — bukan penanda mode internal. Versi lama
    // menulis "iPaymu (hosted)", sehingga pelanggan menerima "Metode : iPaymu (hosted)".
    // Mode hosted-nya sudah disimpan terpisah di meta (`hosted`), tak perlu menumpang label.
    const gwLabel = gw.name === "tripay" ? "Tripay" : gw.name === "mayar" ? "Mayar" : "iPaymu";
    addPayment(reff, charge.reference, customerJid(ctx.user), "tagihan", ctx.amount,
        gwLabel, `Tagihan ${ctx.user.name}`,
        {
            userId: ctx.user.id, periodMonth, periodYear, sandbox: ctx.sandbox,
            gateway: gw.name, hosted: gw.name === "ipaymu", sessionId: charge.sessionId || null,
            // Disimpan supaya permintaan berikutnya untuk periode yang sama diarahkan ke
            // transaksi INI, bukan menerbitkan yang baru.
            redirectUrl: charge.url || null,
        });

    return res.redirect(302, charge.url);
}));

// Callback Tripay (POST). Format & signature beda dari iPaymu → endpoint terpisah.
// Keamanan = sama modelnya dgn callback iPaymu: VERIFIKASI server-to-server (checkTransaction)
// + cross-check merchant_ref & amount. Tak bergantung signature (gate utama = S2S verify),
// jadi tak perlu raw-body (yang butuh edit body-parser global). Balas {success:true} utk ACK.
router.post("/callback/tripay", asyncHandler(async (req, res) => {
    let tripayLockRef = null;
    try {
        const body = req.body || {};
        const merchantRef = body.merchant_ref;
        const reference = body.reference;
        const status = String(body.status || "").toUpperCase();
        if (!merchantRef) return res.json({ success: true });

        const pay = (global.payment || []).find((v) => v.reffId == merchantRef && v.gateway === "tripay");
        if (!pay) return res.json({ success: true }); // bukan record kita / sudah dihapus → ACK
        if (status !== "PAID") return res.json({ success: true }); // expired/failed → ACK, tak kredit
        if (checkStatusPayment(merchantRef) === true) return res.json({ success: true }); // idempotent cepat

        // #b321: SERIALISASI per-ref + re-check DALAM lock. Gateway sering mengirim webhook duplikat/
        // retry; tanpa ini dua callback konkuren sama-sama lolos cek idempoten (dibaca SEBELUM
        // pelunasan) → pelunasan DIPROSES DOBEL → ledger dikredit 2x (pemasukan hantu). Callback iPaymu
        // sudah pakai pola ini; Tripay/Mayar dulu terlewat. Tak dapat lock = ref ini SEDANG diproses
        // callback lain → ACK saja (biar tak dobel; holder yang menuntaskan).
        if (!(await acquireLock(`bill-callback-${merchantRef}`, 8000))) {
            console.warn("[TRIPAY_CALLBACK] Tak dapat lock (ref diproses callback lain) — ACK.", { merchantRef });
            return res.json({ success: true });
        }
        tripayLockRef = merchantRef;
        if (checkStatusPayment(merchantRef) === true) return res.json({ success: true }); // re-check dalam lock

        // KEAMANAN: jangan percaya body mentah — verifikasi langsung ke Tripay.
        const verify = await tripay.checkTransaction(pay.trxId || reference, { sandbox: pay.sandbox === true });
        if (!verify || !verify.ok || !verify.paid) {
            console.warn("[TRIPAY_CALLBACK_REJECT] Tripay belum konfirmasi PAID — kredit ditolak.", { merchantRef, reference, status: verify?.status, error: verify?.error });
            return res.status(400).json({ success: false });
        }
        if (verify.referenceId != null && String(verify.referenceId) !== String(merchantRef)) {
            console.warn("[TRIPAY_CALLBACK_REJECT] merchant_ref Tripay tidak cocok.", { merchantRef, tripay_ref: verify.referenceId });
            return res.status(400).json({ success: false });
        }
        if (verify.amount != null && pay.amount != null && parseInt(verify.amount, 10) < parseInt(pay.amount, 10)) {
            console.warn("[TRIPAY_CALLBACK_REJECT] amount Tripay kurang dari tagihan.", { merchantRef, tripay_amount: verify.amount, expected: pay.amount });
            return res.status(400).json({ success: false });
        }

        const user = (global.users || []).find((u) => String(u.id) === String(pay.userId));
        if (!user) {
            console.error("[TRIPAY_CALLBACK] User tidak ditemukan — TIDAK ditandai paid", { merchantRef, userId: pay.userId });
            return res.status(400).json({ success: false });
        }

        let settleResult;
        try {
            settleResult = await billSettlement.settleTagihanPayment({
                user, amountPaid: pay.amount, periodMonth: pay.periodMonth, periodYear: pay.periodYear,
                paymentMethod: body.payment_method_code || "Tripay", reffId: merchantRef,
            });
        } catch (settleErr) {
            console.error("[TRIPAY_CALLBACK] Catat lunas GAGAL — TIDAK ditandai paid", { merchantRef, error: settleErr.message });
            return res.status(400).json({ success: false });
        }

        updateStatusPayment(merchantRef, true);
        const react = settleResult.reactivation || {};
        updateKetPayment(merchantRef, `Tagihan lunas (Tripay)${react.attempted ? (react.ok ? " + reaktivasi OK" : " + reaktivasi GAGAL") : ""}`);

        // Alarm admin bila pelanggan bayar tapi bisa MASIH terisolir (reaktivasi gagal / router tak
        // terbaca). Dulu Tripay CUMA menulis catatan yang tak dibaca siapa pun — beda dgn iPaymu yang
        // alarm. Sekarang ketiga gateway pakai jalur alarm yang SAMA. Best-effort, never-throw.
        if (reactivationNeedsAttention(react)) {
            alertReaktivasiGagal({ user, refId: merchantRef }).catch(() => {});
        }

        // Pesan pelanggan ditentukan oleh VERDICT ledger, bukan asumsi bahwa pelunasan pasti
        // tercatat. Bila periodenya ternyata sudah lunas, aftercare mencatat baris kelebihan
        // bayar + mengalarmi admin, dan pelanggan menerima pesan jujur — bukan struk lunas.
        // Best-effort: kegagalan kirim TIDAK menggagalkan callback.
        try {
            const tindakan = await putuskanTindakanPascaLunas({
                user, settleResult, amount: pay.amount,
                periodMonth: pay.periodMonth, periodYear: pay.periodYear,
                method: body.payment_name || "Tripay", refId: merchantRef, gateway: "tripay",
            });
            if (tindakan.jenis === "kelebihan") {
                console.warn("[TRIPAY_CALLBACK] KELEBIHAN BAYAR", { merchantRef, ledgerDicatat: tindakan.ledgerDicatat });
            }
            if (pay.sender) await sendMessage(pay.sender, { text: tindakan.teksPelanggan });
        } catch (notifyErr) {
            console.error("[TRIPAY_CALLBACK] Gagal kirim struk:", notifyErr.message);
        }

        return res.json({ success: true });
    } catch (err) {
        console.error("[TRIPAY_CALLBACK_ERROR]", err.message);
        return res.status(500).json({ success: false });
    } finally {
        if (tripayLockRef) releaseLock(`bill-callback-${tripayLockRef}`);
    }
}));

// Callback Mayar (POST webhook). Payload `{event, data}`; event 'payment.received' = lunas.
// Keamanan = model sama dgn callback Tripay: VERIFIKASI server-to-server (checkTransaction)
// sebelum kredit — TIDAK percaya body webhook mentah. Balas {success:true} untuk ACK.
// ⚠️ FIELD KORELASI (id di `data` yang cocok dgn invoice kita) & status paid WAJIB
//    dikonfirmasi lewat uji sandbox sebelum gateway 'mayar' diaktifkan untuk pelanggan asli.
router.post("/callback/mayar", asyncHandler(async (req, res) => {
    let mayarLockRef = null;
    try {
        const body = req.body || {};
        const event = String(body.event || body.type || "").toLowerCase();
        const data = body.data || {};
        if (event && event !== "payment.received") return res.json({ success: true }); // event lain → ACK

        // Kandidat id korelasi dari payload webhook (defensif — pasti-kan yang benar di sandbox).
        const candidates = [data.id, data.invoiceId, data.transactionId, data.merchantInvoiceId, data.paymentId]
            .filter((v) => v != null)
            .map((v) => String(v));
        if (candidates.length === 0) return res.json({ success: true }); // tak bisa dikorelasi → ACK

        const pay = (global.payment || []).find((v) => v.gateway === "mayar"
            && (candidates.includes(String(v.trxId)) || candidates.includes(String(v.reffId))));
        if (!pay) return res.json({ success: true }); // bukan record kita → ACK
        if (checkStatusPayment(pay.reffId) === true) return res.json({ success: true }); // idempotent cepat

        // #b321: SERIALISASI per-ref + re-check DALAM lock (sama seperti Tripay/iPaymu) — anti
        // double-settle dari webhook duplikat/retry. Tak dapat lock = ref diproses callback lain → ACK.
        if (!(await acquireLock(`bill-callback-${pay.reffId}`, 8000))) {
            console.warn("[MAYAR_CALLBACK] Tak dapat lock (ref diproses callback lain) — ACK.", { reffId: pay.reffId });
            return res.json({ success: true });
        }
        mayarLockRef = pay.reffId;
        if (checkStatusPayment(pay.reffId) === true) return res.json({ success: true }); // re-check dalam lock

        // KEAMANAN: verifikasi langsung ke Mayar (S2S) — id invoice = pay.trxId.
        const verify = await mayar.checkTransaction(pay.trxId, { sandbox: pay.sandbox === true });
        if (!verify || !verify.ok || !verify.paid) {
            console.warn("[MAYAR_CALLBACK_REJECT] Mayar belum konfirmasi PAID — kredit ditolak.", { reffId: pay.reffId, status: verify?.status, error: verify?.error });
            return res.status(400).json({ success: false });
        }
        if (verify.amount != null && pay.amount != null && parseInt(verify.amount, 10) < parseInt(pay.amount, 10)) {
            console.warn("[MAYAR_CALLBACK_REJECT] amount Mayar kurang dari tagihan.", { reffId: pay.reffId, mayar_amount: verify.amount, expected: pay.amount });
            return res.status(400).json({ success: false });
        }

        const user = (global.users || []).find((u) => String(u.id) === String(pay.userId));
        if (!user) {
            console.error("[MAYAR_CALLBACK] User tidak ditemukan — TIDAK ditandai paid", { reffId: pay.reffId, userId: pay.userId });
            return res.status(400).json({ success: false });
        }

        let settleResult;
        try {
            settleResult = await billSettlement.settleTagihanPayment({
                user, amountPaid: pay.amount, periodMonth: pay.periodMonth, periodYear: pay.periodYear,
                paymentMethod: "Mayar", reffId: pay.reffId,
            });
        } catch (settleErr) {
            console.error("[MAYAR_CALLBACK] Catat lunas GAGAL — TIDAK ditandai paid", { reffId: pay.reffId, error: settleErr.message });
            return res.status(400).json({ success: false });
        }

        updateStatusPayment(pay.reffId, true);
        const react = settleResult.reactivation || {};
        updateKetPayment(pay.reffId, `Tagihan lunas (Mayar)${react.attempted ? (react.ok ? " + reaktivasi OK" : " + reaktivasi GAGAL") : ""}`);

        // Sama seperti Tripay/iPaymu: alarm admin bila reaktivasi perlu dicek (best-effort, never-throw).
        if (reactivationNeedsAttention(react)) {
            alertReaktivasiGagal({ user, refId: pay.reffId }).catch(() => {});
        }

        // Sama seperti callback Tripay: pesan ditentukan verdict ledger (lihat aftercare).
        try {
            const tindakan = await putuskanTindakanPascaLunas({
                user, settleResult, amount: pay.amount,
                periodMonth: pay.periodMonth, periodYear: pay.periodYear,
                method: "Mayar", refId: pay.reffId, gateway: "mayar",
            });
            if (tindakan.jenis === "kelebihan") {
                console.warn("[MAYAR_CALLBACK] KELEBIHAN BAYAR", { reffId: pay.reffId, ledgerDicatat: tindakan.ledgerDicatat });
            }
            if (pay.sender) await sendMessage(pay.sender, { text: tindakan.teksPelanggan });
        } catch (notifyErr) {
            console.error("[MAYAR_CALLBACK] Gagal kirim struk:", notifyErr.message);
        }

        return res.json({ success: true });
    } catch (err) {
        console.error("[MAYAR_CALLBACK_ERROR]", err.message);
        return res.status(500).json({ success: false });
    } finally {
        if (mayarLockRef) releaseLock(`bill-callback-${mayarLockRef}`);
    }
}));

// Landing returnUrl mode hosted — buyer kembali dari halaman iPaymu. Settlement & struk
// ditangani server-to-server di callback; halaman ini hanya info ringan.
router.get("/bayar-status", (req, res) => {
    res.send(statusPage("Pembayaran Diproses", "Terima kasih! Pembayaran Anda sedang kami proses. Struk & status aktivasi layanan akan dikirim via WhatsApp. Anda boleh menutup halaman ini."));
});

// Info tagihan + daftar channel aktif (dinamis dari iPaymu).
router.get("/api/bayar/:token/info", asyncHandler(async (req, res) => {
    const ctx = await resolveBillContext(req.params.token);
    if (!ctx.ok) return res.json({ ok: false, status: ctx.status, reason: ctx.reason });
    if (ctx.whitelist) return res.json({ ok: true, status: "free", nama: ctx.user.name });

    const paid = isUserPaid(ctx.user);
    let channels = null;
    let channelError = null;
    if (!paid) {
        try {
            channels = await ipaymu.getPaymentChannels({ sandbox: ctx.sandbox });
        } catch (e) {
            channelError = e.message;
        }
    }
    // Link "verifikasi ke admin" yang dilihat PELANGGAN = nomor bot/bisnis (config.adminPhone).
    const cfg = global.config || {};
    const adminWa = String(cfg.adminPhone || cfg.telfon || "").replace(/\D/g, "");
    res.json({
        ok: true,
        status: paid ? "paid" : "unpaid",
        provider: cfg.nama || "Pembayaran",
        adminWa,
        nama: ctx.user.name,
        paket: ctx.user.subscription,
        amount: ctx.amount,
        formattedAmount: convertRupiah.convert(ctx.amount),
        sandbox: ctx.sandbox,
        channels,
        channelError,
    });
}));

// Buat charge untuk channel terpilih → balikkan data render (QR / VA / kode retail).
router.post("/api/bayar/:token/charge", chargeLimiter, asyncHandler(async (req, res) => {
    const ctx = await resolveBillContext(req.params.token);
    if (!ctx.ok) return res.status(400).json({ ok: false, status: ctx.status });
    if (ctx.whitelist) return res.status(400).json({ ok: false, status: "free" });
    if (isUserPaid(ctx.user)) return res.status(409).json({ ok: false, status: "already_paid" });
    if (!ctx.amount || ctx.amount < 1000) return res.status(400).json({ ok: false, status: "invalid_amount" });

    const { method, channel } = req.body || {};
    if (!method || !channel) return res.status(400).json({ ok: false, status: "missing_channel" });

    const { periodMonth, periodYear } = currentPeriod();

    // PAKAI ULANG transaksi pending yang masih hidup untuk periode ini, alih-alih menerbitkan
    // yang baru. Tanpa ini, tiap tap tombol bayar melahirkan QRIS/VA tambahan yang SEMUANYA
    // bisa dibayar; bila dua terbayar, uang kedua masuk rekening gateway tapi
    // `applyPaymentStatusChange` memulangkan `already_fully_paid` tanpa menulis baris ledger.
    // Artefak gateway (qrString/paymentNo/dll) ikut disimpan justru supaya bisa disajikan
    // ulang di sini — kalau tidak, "pakai ulang" mustahil dan pelanggan tetap dapat kode baru.
    const pendingLama = findPendingPayment({
        tag: "tagihan", userId: ctx.user.id, periodMonth, periodYear,
        maxAgeMs: UMUR_PENDING_BOLEH_PAKAI_ULANG_MS,
    });
    if (pendingLama && pendingLama.artefak && pendingLama.artefak.method === method && pendingLama.artefak.channel === channel) {
        console.log(`[BILL_CHARGE_REUSE] Memakai ulang transaksi pending ${pendingLama.reffId} untuk user ${ctx.user.id} periode ${periodMonth}/${periodYear}`);
        return res.json({ ok: true, reffId: pendingLama.reffId, dipakaiUlang: true, ...pendingLama.artefak });
    }

    const reff = Math.floor(Math.random() * 1677721631342).toString(16);

    let result;
    try {
        result = await ipaymu.payDirect({
            amount: ctx.amount,
            comment: `Tagihan ${ctx.user.subscription} - ${ctx.user.name}`,
            reffId: reff,
            name: ctx.user.name || "Pelanggan",
            phone: customerPhoneDigits(ctx.user) || "628000000000",
            email: `${reff}@bill.rafnet.local`,
            paymentMethod: method,
            paymentChannel: channel,
            sandbox: ctx.sandbox,
        });
    } catch (e) {
        return res.status(502).json({ ok: false, status: "gateway_error", message: e.message });
    }

    // Label metode yang RAMAH untuk struk WA (hindari kode mentah seperti "MPM").
    const titleCase = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    const methodLabel = method === "qris" ? "QRIS"
        : method === "va" ? `Transfer VA ${result.channelLabel || channel}`.trim()
        : method === "cstore" ? titleCase(result.channelLabel || channel)
        : (result.channelLabel || channel);

    let qrImage = null;
    if (result.qrString) {
        try {
            qrImage = "data:image/png;base64," + qr.imageSync(result.qrString, { type: "png", ec_level: "H" }).toString("base64");
        } catch (_e) {
            qrImage = null;
        }
    }

    // Artefak yang dilihat pelanggan, disimpan bersama record supaya permintaan berikutnya
    // untuk periode yang sama bisa MEMAKAI ULANG transaksi ini alih-alih menerbitkan yang baru.
    const artefak = {
        method,
        channel,
        via: result.via,
        channelLabel: result.channelLabel,
        qrImage,
        paymentNo: result.paymentNo,
        paymentName: result.paymentName,
        note: result.note,
        total: result.total,
        formattedTotal: convertRupiah.convert(result.total || ctx.amount),
        expired: result.expired,
    };

    // Persist record (tag 'tagihan'). userId/periode dipakai callback untuk catat lunas + reaktivasi;
    // sandbox=true → callback verifikasi ke endpoint sandbox (uji, bukan produksi).
    addPayment(reff, result.id, customerJid(ctx.user), "tagihan", ctx.amount, methodLabel,
        `Tagihan ${ctx.user.name}`, { userId: ctx.user.id, periodMonth, periodYear, sandbox: ctx.sandbox, artefak });

    res.json({ ok: true, reffId: reff, ...artefak });
}));

// Polling status pembayaran (reff dari hasil charge).
router.get("/api/bayar/:token/status", (req, res) => {
    const v = verifyBillPayToken(req.params.token);
    if (!v.ok) return res.status(400).json({ ok: false });
    const reff = req.query.reff;
    if (!reff) return res.json({ ok: true, paid: false });
    res.json({ ok: true, paid: checkStatusPayment(String(reff)) === true });
});

module.exports = router;
// Internal — test.
module.exports._isUserPaid = isUserPaid;
