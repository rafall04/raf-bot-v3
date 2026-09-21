/**
 * Header Doc
 * Purpose: Sub-router callback pembayaran iPaymu (`POST /callback/payment`) — settle voucher
 *          (buynow/buynowweb/buynowpanel), topup saldo, dan tagihan bulanan.
 * Caller: `routes/public.js` (composer) → Express app; gateway iPaymu memanggil path ini.
 * Deps: express, rupiah-format, `lib/ipaymu` (checkTransaction), `lib/services/bill-payment-settlement`,
 *       `lib/mikrotik` (getvoucher), `lib/voucher-fulfillment` (batch qty + format kode),
 *       `lib/saldo`, `lib/payment`, `lib/voucher`, `lib/utils`,
 *       `lib/templating`, `lib/services/bill-payment-aftercare`, `lib/whatsapp-delivery-service`,
 *       `lib/whatsapp-critical-delivery`, `lib/admin-recipients`, `lib/services/reactivation-outcome`,
 *       `lib/voucher-orphan`, lazy: `lib/invoice-on-paid`, `lib/notif-router`.
 * MainFuncs: POST /callback/payment handler; helper `alertAdmins` + `_kategoriDariTag`;
 *            lock per reference_id `acquirePaymentCallbackLock`.
 * SideEffects: Kredit voucher/saldo/tagihan ke data global, kirim WA pelanggan/admin,
 *              catat orphan voucher, update ket/status payment.
 */
const log = require('../../lib/logger').logger.child('PAYMENT_CALLBACK');
const express = require('express');
const convertRupiah = require('rupiah-format');
// Verifikasi server-to-server status transaksi iPaymu (dipakai di callback).
// Diberi nama lain karena `pay` di-shadow oleh record pembayaran di dalam handler callback.
const verifyIpaymuTransaction = require("../../lib/ipaymu").checkTransaction;
// Settlement bayar tagihan bulanan (catat lunas + auto-reaktivasi). Dipakai cabang callback 'tagihan'.
const { createBillPaymentSettlement } = require('../../lib/services/bill-payment-settlement');
const billSettlement = createBillPaymentSettlement();
const { getvoucher } = require("../../lib/mikrotik");
const { generateVoucherBatch, formatVoucherCodeList, normalizeVoucherQty } = require("../../lib/voucher-fulfillment");
const { addKoinUser, checkATMuser } = require('../../lib/saldo');
const { updateStatusPayment, checkStatusPayment, updateKetPayment } = require('../../lib/payment');
const { checkprofvc, checkdurasivc, checkhargavc } = require('../../lib/voucher');
const { normalizePhoneNumber } = require('../../lib/utils');
const { renderTemplate } = require('../../lib/templating');
const { putuskanTindakanPascaLunas } = require('../../lib/services/bill-payment-aftercare');
const { sendMessage } = require('../../lib/whatsapp-delivery-service');
// Pengiriman kritis (kode voucher) + alert admin valid + catatan orphan (paid-tanpa-voucher).
const { sendCritical } = require('../../lib/whatsapp-critical-delivery');
const { getAdminJids } = require('../../lib/admin-recipients');
const { reactivationNeedsAttention } = require('../../lib/services/reactivation-outcome');
const { recordVoucherOrphan } = require('../../lib/voucher-orphan');

const router = express.Router();

// Alert admin yang ANDAL: kirim ke tiap JID admin valid via sendCritical (retry + dead-letter).
// Dipakai saat voucher gagal / reaktivasi tagihan gagal — wajib sampai ke operator.
// Peta tag→kategori notif-router (tanpa menyentuh 6 call-site). Kirim TETAP sendCritical durable;
// routing hanya mengubah PENERIMA (grup vs DM admin). notifRouting OFF/grup kosong → DM admin (lama).
function _kategoriDariTag(tag) {
    const t = String(tag || '').toLowerCase();
    if (t.startsWith('voucher')) return 'voucher_sale';
    if (t.includes('reaktivasi') || t.startsWith('tagihan')) return 'billing_isolir';
    return null;
}

async function alertAdmins(text, tag) {
    const adminFallback = getAdminJids();
    const kategori = _kategoriDariTag(tag);
    let jids = adminFallback;
    if (kategori) {
        try { jids = require('../../lib/notif-router').recipientsFor(kategori, { adminFallback }).recipients || adminFallback; }
        catch (_e) { jids = adminFallback; }
    }
    if (!jids.length) { log.error(`[ADMIN_ALERT] Tidak ada JID admin valid untuk: ${tag}`); return; }
    for (const jid of jids) {
        try { await sendCritical(jid, { text }, { label: tag || 'admin-alert' }); }
        catch (e) { log.error(`[ADMIN_ALERT] Gagal kirim ke ${jid}:`, e.message); }
    }
}

// --- Public Unauthenticated Routes ---
//
// Halaman `/voucher` + API `/app/*` (beli voucher online anonim) DIPINDAH ke
// `routes/public-anonymous.js` (owner tunggal) agar bisa di-mount di listener publik
// (port terpisah) tanpa menyeret dependency customer. Callback penyelesaiannya
// (`POST /callback/payment`, di bawah) TETAP di sini: gateway hanya diberi satu callback
// URL (port utama) dan `global.payment` dibagi dalam proses yang sama.

// Lock per reference_id untuk callback pembayaran — cegah pemrosesan konkuren
// (double credit) untuk transaksi yang sama. In-process; cukup untuk single instance.
const _paymentCallbackLocks = new Map();
function acquirePaymentCallbackLock(key) {
    const previous = _paymentCallbackLocks.get(key) || Promise.resolve();
    let release;
    const slot = new Promise((resolve) => { release = resolve; });
    const chained = previous.then(() => slot);
    _paymentCallbackLocks.set(key, chained);
    return previous.then(() => () => {
        release();
        if (_paymentCallbackLocks.get(key) === chained) {
            _paymentCallbackLocks.delete(key);
        }
    });
}

router.post('/callback/payment', async (req, res) => {
    const { reference_id, status_code } = req.body;
    let releaseCallbackLock = null;
    try {
        const pay = global.payment.find(val => val.reffId == reference_id);
        if (!pay) throw !1;
        if (status_code == '1') {
            // Idempotency cepat: kalau sudah diproses, balas 200 tanpa external call / re-credit.
            if (checkStatusPayment(reference_id)) throw !0;

            // Serialize per reference_id — cegah DUA callback konkuren memproses
            // pembayaran yang sama dua kali (verify + getvoucher/addKoinUser tidak atomik
            // tanpa lock → potensi double voucher / double saldo).
            releaseCallbackLock = await acquirePaymentCallbackLock(reference_id);

            // Re-check setelah memegang lock: callback lain mungkin sudah menyelesaikan
            // pemrosesan saat kita menunggu antrian lock.
            if (checkStatusPayment(reference_id)) throw !0;

            // KEAMANAN: JANGAN percaya body callback mentah — bisa di-forge → free saldo/voucher.
            // Verifikasi langsung ke iPaymu pakai trxId yang KITA simpan saat membuat transaksi.
            // Mode HOSTED (bayar tagihan via halaman iPaymu): TransactionId belum ada saat buat sesi,
            // baru muncul di payload callback → fallback ke req.body.trx_id/sid. Tetap AMAN: tetap
            // diverifikasi server-to-server ke iPaymu + cross-check referenceId & amount vs record kita.
            const effectiveTrxId = pay.trxId || req.body.trx_id || req.body.sid;
            const verify = await verifyIpaymuTransaction(effectiveTrxId, { sandbox: pay.sandbox === true });
            if (!verify || !verify.ok || !verify.paid) {
                log.warn('[PAYMENT_CALLBACK_REJECT] iPaymu belum konfirmasi LUNAS — kredit ditolak.', {
                    reference_id, trxId: effectiveTrxId, ipaymu_status: verify?.status, ipaymu_error: verify?.error
                });
                throw !1; // 500 → minta iPaymu retry callback; jangan kredit.
            }
            // Cegah substitusi trx: referenceId & amount dari iPaymu harus cocok dgn record kita.
            if (verify.referenceId != null && String(verify.referenceId) !== String(reference_id)) {
                log.warn('[PAYMENT_CALLBACK_REJECT] referenceId iPaymu tidak cocok.', {
                    reference_id, ipaymu_referenceId: verify.referenceId
                });
                throw !1;
            }
            if (verify.amount != null && pay.amount != null && parseInt(verify.amount, 10) < parseInt(pay.amount, 10)) {
                log.warn('[PAYMENT_CALLBACK_REJECT] amount iPaymu kurang dari tagihan.', {
                    reference_id, ipaymu_amount: verify.amount, expected: pay.amount
                });
                throw !1;
            }

            if (pay.tag == 'buynow') {
                // Profil DARI record bila ada (disimpan saat charge di payment-flow buynow) —
                // checkprofvc(harga) hanya fallback record lama: ia TERTUKAR bila dua paket
                // berharga sama (mengembalikan profil terdaftar terakhir) → voucher durasi salah.
                // (Fallback aman: record lama selalu qty=1, amount = harga satuan.)
                const prof = pay.prof || checkprofvc(`${pay.amount}`);
                const durasivc = checkdurasivc(prof);
                const hargavc = checkhargavc(prof);
                // Multi-beli (#b402): qty voucher disimpan saat charge. Record lama tanpa qty → 1.
                const qty = normalizeVoucherQty(pay.qty);
                const hargaSatuan = parseInt(hargavc, 10) || pay.amount;
                await generateVoucherBatch({ getvoucher, prof, qty, sender: pay.sender, caller: 'public.payment-callback.buynow' }).then(async ({ codes, failures }) => {
                    if (!codes.length) {
                        const batchErr = new Error(failures[0] || 'voucher gagal dibuat');
                        batchErr.failures = failures;
                        throw batchErr;
                    }
                    // TERBIT SEBAGIAN: kode yang sukses tetap dikirim; sisanya jadi orphan
                    // (fulfill manual admin) + alert — jangan buang voucher yang sudah terbit.
                    if (failures.length) {
                        failures.forEach((f) => recordVoucherOrphan({ type: 'buynow_callback', reference_id, sender: pay.sender, amount: hargaSatuan, profile: prof, qty, error: f }));
                        await alertAdmins(renderTemplate('voucher_gagal_admin', {
                            pelanggan: pay.sender, paket: durasivc || prof, harga: convertRupiah.convert(pay.amount), jumlah: `${failures.length} dari ${qty}`, ref: reference_id, error: failures[0]
                        }), 'voucher-gagal');
                    }
                    updateKetPayment(reference_id, `Voucher: ${codes.join(', ')}`);
                    updateStatusPayment(reference_id, true);
                    // Kode voucher = kritis → sendCritical (retry + dead-letter) supaya kode
                    // sampai ke pelanggan yang sudah bayar, bukan best-effort sendMessage.
                    if (pay.sender != "buynow") {
                        const message = renderTemplate('voucher_purchase_success', {
                            nama_paket: durasivc,
                            harga: convertRupiah.convert(pay.amount),
                            jumlah: failures.length ? `${codes.length} dari ${qty}` : String(codes.length),
                            kode_voucher: formatVoucherCodeList(codes)
                        });
                        await sendCritical(pay.sender, { text: message }, { label: 'voucher-code' });
                    }
                    throw !0;
                }).catch(async err => {
                    if (typeof err === "string" || err instanceof Error) {
                        const errorMessage = typeof err === "string" ? err : err.message;
                        // Voucher GAGAL dibuat padahal SUDAH BAYAR. getvoucher non-idempotent &
                        // tak di-retry → JANGAN throw !1 (retry → risiko voucher GANDA). Sebagai gantinya:
                        // catat orphan PER-ITEM + alert admin (fulfill manual) + pesan ringan ke pelanggan,
                        // lalu tandai paid (stop retry) supaya kegagalan TERLIHAT & bisa ditindaklanjuti.
                        const fails = Array.isArray(err.failures) && err.failures.length ? err.failures : [errorMessage];
                        fails.forEach((f) => recordVoucherOrphan({ type: 'buynow_callback', reference_id, sender: pay.sender, amount: hargaSatuan, profile: prof, qty, error: f }));
                        await alertAdmins(renderTemplate('voucher_gagal_admin', {
                            pelanggan: pay.sender, paket: durasivc || prof, harga: convertRupiah.convert(pay.amount), jumlah: `${fails.length} dari ${qty}`, ref: reference_id, error: errorMessage
                        }), 'voucher-gagal');
                        updateKetPayment(reference_id, `GAGAL voucher: ${errorMessage}`);
                        if (pay.sender != "buynow") {
                            try { await sendMessage(pay.sender, { text: renderTemplate('voucher_pending_manual', {}) }, { skipDuplicateCheck: true }); }
                            catch (notifyErr) { log.error('[BUYNOW_FAIL] gagal notif pelanggan:', notifyErr.message); }
                        }
                        updateStatusPayment(reference_id, true);
                        throw !0;
                    } else throw err; // sentinel SUKSES (true dari .then) → outer catch res.status(200). Dulu `!1`(false)→500 → iPaymu retry tiap penjualan SUKSES.
                });
            } else if (pay.tag == 'buynowweb') {
                // Profil DARI record (disimpan saat charge di public-anonymous). checkprofvc(harga)
                // hanya fallback untuk record LAMA — ia TERTUKAR bila dua profil berharga sama
                // (mengembalikan profil terdaftar terakhir) → voucher durasi salah.
                const prof = pay.prof || checkprofvc(String(pay.amount));
                const durasivc = checkdurasivc(prof);
                // Multi-beli (#b402): qty voucher disimpan saat charge di /app/buy (record lama → 1).
                const qty = normalizeVoucherQty(pay.qty);
                const hargaSatuan = parseInt(checkhargavc(prof), 10) || pay.amount;
                await generateVoucherBatch({ getvoucher, prof, qty, sender: pay.sender, caller: 'public.payment-callback.buynowweb' }).then(async ({ codes, failures }) => {
                    if (!codes.length) {
                        const batchErr = new Error(failures[0] || 'voucher gagal dibuat');
                        batchErr.failures = failures;
                        throw batchErr;
                    }
                    // TERBIT SEBAGIAN: kode sukses tetap disimpan/dikirim; sisanya orphan + alert admin.
                    if (failures.length) {
                        failures.forEach((f) => recordVoucherOrphan({ type: 'buynowweb_callback', reference_id, sender: pay.sender, amount: hargaSatuan, profile: prof, qty, error: f }));
                        await alertAdmins(renderTemplate('voucher_gagal_admin', {
                            pelanggan: pay.sender, paket: prof, harga: convertRupiah.convert(pay.amount), jumlah: `${failures.length} dari ${qty}`, ref: reference_id, error: failures[0]
                        }), 'voucher-gagal');
                    }
                    updateKetPayment(reference_id, `${codes.join(', ')}`);
                    updateStatusPayment(reference_id, true);
                    // Kirim kode voucher ke WA pembeli (kode = kritis krn sudah bayar → sendCritical
                    // retry + dead-letter). pay.sender = nomor mentah dari form web → normalisasi ke JID.
                    // Best-effort: gagal kirim TIDAK menggagalkan callback (kode tetap tampil di halaman
                    // via polling statustrx; sendCritical juga menyimpan ke dead-letter bila gagal).
                    try {
                        const digits = normalizePhoneNumber(String(pay.sender || ''));
                        const jid = digits && digits.length > 8 ? `${digits}@s.whatsapp.net` : null;
                        if (jid) {
                            const message = renderTemplate('voucher_beli_web', {
                                nama_paket: durasivc || prof,
                                harga: convertRupiah.convert(pay.amount),
                                jumlah: failures.length ? `${codes.length} dari ${qty}` : String(codes.length),
                                kode_voucher: formatVoucherCodeList(codes)
                            });
                            await sendCritical(jid, { text: message }, { label: 'voucher-web-code' });
                        }
                    } catch (waErr) {
                        log.error('[BUYNOWWEB] Gagal kirim kode voucher ke WA:', waErr.message);
                    }
                    // Notif admin bahwa voucher online TERJUAL (OPSIONAL, anti-spam via config).
                    // Best-effort + never-throw: gagal notif TIDAK menggagalkan callback.
                    try {
                        if (global.config && global.config.voucherSaleNotif && global.config.voucherSaleNotif.enabled) {
                            await alertAdmins(renderTemplate('voucher_terjual_admin', {
                                paket: durasivc || prof,
                                harga: convertRupiah.convert(pay.amount),
                                pembeli: pay.sender,
                                jumlah: String(codes.length),
                                kode: codes.join(', '),
                                ref: reference_id
                            }), 'voucher-terjual');
                        }
                    } catch (notifErr) {
                        log.error('[BUYNOWWEB] Gagal notif admin penjualan:', notifErr.message);
                    }
                    throw !0;
                }).catch(async err => {
                    if (typeof err === "string" || err instanceof Error) {
                        const errorMessage = typeof err === "string" ? err : err.message;
                        // Voucher web gagal padahal sudah bayar → orphan PER-ITEM + alert admin (fulfill
                        // manual), mark paid (stop retry; getvoucher non-idempotent). Pelanggan lihat status di halaman web.
                        const fails = Array.isArray(err.failures) && err.failures.length ? err.failures : [errorMessage];
                        fails.forEach((f) => recordVoucherOrphan({ type: 'buynowweb_callback', reference_id, sender: pay.sender, amount: hargaSatuan, profile: prof, qty, error: f }));
                        await alertAdmins(renderTemplate('voucher_gagal_admin', {
                            pelanggan: pay.sender, paket: prof, harga: convertRupiah.convert(pay.amount), jumlah: `${fails.length} dari ${qty}`, ref: reference_id, error: errorMessage
                        }), 'voucher-gagal');
                        updateKetPayment(reference_id, `GAGAL voucher: ${errorMessage}`);
                        updateStatusPayment(reference_id, true);
                        throw !0;
                    } else throw err; // sentinel SUKSES (true dari .then) → outer catch res.status(200). Dulu `!1`(false)→500 → iPaymu retry tiap penjualan SUKSES.
                });
            } else if (pay.tag == 'buynowpanel') {
                // Beli voucher dari PANEL PELANGGAN. Sama seperti `buynowweb`, kecuali: profil
                // diambil dari `pay.prof` yang DISIMPAN saat charge — bukan diturunkan dari harga
                // (`checkprofvc`), yang tertukar bila dua paket punya harga sama. Fallback ke
                // harga hanya untuk record lama/anomali.
                const prof = pay.prof || checkprofvc(String(pay.amount));
                const durasivc = checkdurasivc(prof);
                // Multi-beli (#b402): jalur panel belum mengirim qty → selalu 1; batch generic
                // dipertahankan supaya panel tinggal mengisi qty saat fitur diaktifkan di sana.
                const qty = normalizeVoucherQty(pay.qty);
                const hargaSatuan = parseInt(checkhargavc(prof), 10) || pay.amount;
                await generateVoucherBatch({ getvoucher, prof, qty, sender: pay.sender, caller: 'public.payment-callback.buynowpanel' }).then(async ({ codes, failures }) => {
                    if (!codes.length) {
                        const batchErr = new Error(failures[0] || 'voucher gagal dibuat');
                        batchErr.failures = failures;
                        throw batchErr;
                    }
                    // TERBIT SEBAGIAN: kode sukses disimpan/dikirim; sisanya orphan + alert admin.
                    if (failures.length) {
                        failures.forEach((f) => recordVoucherOrphan({ type: 'buynowpanel_callback', reference_id, sender: pay.sender, amount: hargaSatuan, profile: prof, qty, error: f }));
                        await alertAdmins(renderTemplate('voucher_gagal_admin', {
                            pelanggan: pay.sender, paket: durasivc || prof, harga: convertRupiah.convert(pay.amount), jumlah: `${failures.length} dari ${qty}`, ref: reference_id, error: failures[0]
                        }), 'voucher-gagal');
                    }
                    updateKetPayment(reference_id, `${codes.join(', ')}`);
                    updateStatusPayment(reference_id, true);
                    // Kode tampil di panel lewat polling GET /vouchers/purchase/:reff. WA tetap
                    // dikirim sebagai salinan permanen (pelanggan bisa kehilangan tab panel), dan
                    // pakai sendCritical karena pelanggan SUDAH bayar. Best-effort: gagal kirim
                    // TIDAK menggagalkan callback.
                    try {
                        const digits = normalizePhoneNumber(String(pay.sender || ''));
                        const jid = digits && digits.length > 8 ? `${digits}@s.whatsapp.net` : null;
                        if (jid) {
                            const message = renderTemplate('voucher_beli_panel', {
                                nama_paket: durasivc || prof,
                                harga: convertRupiah.convert(pay.amount),
                                jumlah: failures.length ? `${codes.length} dari ${qty}` : String(codes.length),
                                kode_voucher: formatVoucherCodeList(codes)
                            });
                            await sendCritical(jid, { text: message }, { label: 'voucher-panel-code' });
                        }
                    } catch (waErr) {
                        log.error('[BUYNOWPANEL] Gagal kirim kode voucher ke WA:', waErr.message);
                    }
                    // Notif admin penjualan (opsional, anti-spam via config). Never-throw.
                    try {
                        if (global.config && global.config.voucherSaleNotif && global.config.voucherSaleNotif.enabled) {
                            await alertAdmins(renderTemplate('voucher_terjual_admin', {
                                paket: durasivc || prof,
                                harga: convertRupiah.convert(pay.amount),
                                pembeli: pay.sender,
                                jumlah: String(codes.length),
                                kode: codes.join(', '),
                                ref: reference_id
                            }), 'voucher-terjual');
                        }
                    } catch (notifErr) {
                        log.error('[BUYNOWPANEL] Gagal notif admin penjualan:', notifErr.message);
                    }
                    throw !0;
                }).catch(async err => {
                    if (typeof err === "string" || err instanceof Error) {
                        const errorMessage = typeof err === "string" ? err : err.message;
                        // Sudah bayar tapi voucher gagal terbit → orphan PER-ITEM + alert admin (fulfill
                        // manual), lalu TETAP mark paid supaya iPaymu berhenti retry (getvoucher
                        // non-idempotent → retry = risiko voucher ganda). Panel menampilkan
                        // state `failed` dari prefix GAGAL di `ket`.
                        const fails = Array.isArray(err.failures) && err.failures.length ? err.failures : [errorMessage];
                        fails.forEach((f) => recordVoucherOrphan({ type: 'buynowpanel_callback', reference_id, sender: pay.sender, amount: hargaSatuan, profile: prof, qty, error: f }));
                        await alertAdmins(renderTemplate('voucher_gagal_admin', {
                            pelanggan: pay.sender, paket: durasivc || prof, harga: convertRupiah.convert(pay.amount), jumlah: `${fails.length} dari ${qty}`, ref: reference_id, error: errorMessage
                        }), 'voucher-gagal');
                        updateKetPayment(reference_id, `GAGAL voucher: ${errorMessage}`);
                        updateStatusPayment(reference_id, true);
                        throw !0;
                    } else throw err; // sentinel SUKSES (true dari .then) → outer catch res.status(200). Dulu `!1`(false)→500 → iPaymu retry tiap penjualan SUKSES.
                });
            } else if (pay.tag == 'topup') {
                // Kredit saldo DULU; HANYA tandai paid bila kredit sukses. Bila gagal (mis. JID
                // @lid tak ter-resolve / DB error), JANGAN tandai paid agar topup tidak hilang —
                // throw !1 → HTTP 500 → iPaymu retry callback, dan admin bisa intervensi.
                // (addKoinUser kini fail-closed: return false bila JID tak bisa di-resolve.)
                const credited = await addKoinUser(pay.sender, pay.amount);
                if (!credited) {
                    log.error('[IPAYMU_TOPUP] Kredit saldo GAGAL — payment TIDAK ditandai paid', {
                        reference_id, sender: pay.sender, amount: pay.amount
                    });
                    throw !1;
                }
                updateStatusPayment(reference_id, true);
                // PENTING: Cek connection state dan gunakan error handling sesuai rules
                const currentSaldo = await checkATMuser(pay.sender);
                const message = renderTemplate('topup_saldo_masuk', {
                    harga: convertRupiah.convert(pay.amount),
                    formattedSaldo: convertRupiah.convert(currentSaldo)
                });
                await sendMessage(pay.sender, { text: message });
                throw !0;
            } else if (pay.tag == 'tagihan') {
                // Bayar tagihan bulanan: cari pelanggan dari userId yang KITA simpan saat charge.
                const user = (global.users || []).find(u => String(u.id) === String(pay.userId));
                if (!user) {
                    log.error('[IPAYMU_TAGIHAN] User tidak ditemukan — payment TIDAK ditandai paid', { reference_id, userId: pay.userId });
                    throw !1; // 500 → iPaymu retry
                }

                // Catat lunas (ledger) + reaktivasi bila terisolir. Catat-lunas WAJIB sukses;
                // bila gagal → 500 supaya iPaymu retry & pembayaran tidak hilang (fail-closed).
                let settleResult;
                try {
                    settleResult = await billSettlement.settleTagihanPayment({
                        user,
                        amountPaid: pay.amount,
                        periodMonth: pay.periodMonth,
                        periodYear: pay.periodYear,
                        paymentMethod: pay.method || 'QRIS',
                        reffId: reference_id,
                        // Tandai lunas SEBELUM reaktivasi lambat (konsisten dgn Tripay/Mayar; anti retry salah-vonis).
                        markPaid: () => updateStatusPayment(reference_id, true),
                    });
                } catch (settleErr) {
                    log.error('[IPAYMU_TAGIHAN] Catat lunas GAGAL — payment TIDAK ditandai paid', { reference_id, error: settleErr.message });
                    throw !1; // 500 → iPaymu retry; jangan tandai paid.
                }

                updateStatusPayment(reference_id, true);
                const react = settleResult.reactivation || {};
                updateKetPayment(reference_id, `Tagihan lunas${react.attempted ? (react.ok ? ' + reaktivasi OK' : ' + reaktivasi GAGAL') : ''}`);

                // Pesan pelanggan ditentukan VERDICT ledger (lihat lib/services/bill-payment-aftercare):
                // bila periodenya ternyata sudah lunas, uangnya dicatat sebagai kelebihan bayar +
                // admin dialarmi, dan pelanggan menerima pesan jujur — bukan struk lunas.
                // Best-effort; kegagalan kirim TIDAK menggagalkan callback.
                try {
                    const tindakan = await putuskanTindakanPascaLunas({
                        user, settleResult, amount: pay.amount,
                        periodMonth: pay.periodMonth, periodYear: pay.periodYear,
                        method: pay.method || 'QRIS', refId: reference_id, gateway: 'ipaymu',
                    });
                    if (tindakan.jenis === 'kelebihan') {
                        log.warn('[IPAYMU_TAGIHAN] KELEBIHAN BAYAR', { reference_id, ledgerDicatat: tindakan.ledgerDicatat });
                    }
                    if (pay.sender) {
                        // FIX invoice-tak-terkirim (callback online): bila gate invoiceOnSettle ON &
                        // send_invoice ON & pelunasan BERSIH (bukan kelebihan) → kirim invoice PDF
                        // (caption = struk yang sama); jika tidak → struk teks lama. Cegah dobel-kirim.
                        const sentInvoice = await require('../../lib/invoice-on-paid').trySendSettleInvoice(user, {
                            messageText: tindakan.teksPelanggan,
                            paymentDetails: { method: pay.method || 'QRIS', paidDate: new Date().toISOString(), paymentHistoryId: reference_id },
                            isCleanPaid: tindakan.jenis !== 'kelebihan',
                        });
                        if (!sentInvoice) await sendMessage(pay.sender, { text: tindakan.teksPelanggan });
                    }
                } catch (notifyErr) {
                    log.error('[IPAYMU_TAGIHAN] Gagal kirim struk:', notifyErr.message);
                }

                // Alert admin bila reaktivasi PERLU dicek (gagal ubah profil ATAU router tak terbaca =
                // profile_read_failed → pelanggan bayar tapi bisa MASIH terisolir). Predikat bersama
                // dgn WA/web/Tripay/Mayar. Dulu hanya `attempted && !ok`, jadi blip MikroTik (kasus
                // paling mungkin) lolos tanpa alarm.
                if (reactivationNeedsAttention(react)) {
                    await alertAdmins(renderTemplate('tagihan_reaktivasi_gagal_admin', {
                        nama_pelanggan: user.name,
                        pppoe: user.pppoe_username || '-',
                        reference_id,
                    }), 'tagihan-reaktivasi-gagal');
                }
                throw !0; // 200
            }
        }
    } catch(err) {
        res.status(err ? 200 : 500).json({ status: err });
    } finally {
        if (releaseCallbackLock) releaseCallbackLock();
    }
});

module.exports = router;
