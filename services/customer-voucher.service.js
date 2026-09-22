/**
 * Header Doc
 * Purpose: Owner logika beli voucher dari PANEL PELANGGAN (terautentikasi) — daftar paket,
 *   pembuatan transaksi QRIS iPaymu (tag `buynowpanel`), cek status milik-sendiri, dan riwayat
 *   per pelanggan. Berbeda dari surface anonim `/app/*` (`routes/public-anonymous.js`): di sini
 *   nomor HP diambil dari sesi pelanggan, TIDAK PERNAH dari body, dan setiap pembacaan status
 *   di-scope ke `customerId` pemilik transaksi. Mendukung qty>1 (satu transaksi iPaymu per
 *   batch) di bawah gate `config.voucherMultiPurchase` — gate yang sama dengan jalur publik/WA.
 * Caller: `routes/public.js` (sub-router `customerApiRouter`, guard `ensureCustomerAuthenticated`).
 * Deps: `lib/ipaymu` (pay), `lib/payment` (addPayment), `lib/voucher` (checkhargavc), state
 *   `global.voucher` / `global.payment`, config `customerVoucher.enabled`.
 * MainFuncs: `createCustomerVoucherService` → { isEnabled, listPackages, createPurchase,
 *   getPurchaseStatus, listHistory }.
 * SideEffects: Memanggil iPaymu (charge QRIS) dan menulis record `global.payment` via addPayment.
 *   TIDAK menerbitkan voucher — fulfillment ada di callback `POST /callback/payment` tag
 *   `buynowpanel` (routes/public.js), sama seperti jalur web/WA.
 */
'use strict';

// Murni orchestrator tanpa deps berat — aman di-require langsung (service lain DI-inject).
const {
    parseVoucherCodesFromKet,
    normalizeVoucherQty,
    voucherMultiBuyConfig,
    voucherCustomCredsConfig,
    normalizeVoucherUsername,
    normalizeVoucherPassword,
    assertVoucherUsernameAvailable
} = require('../lib/voucher-fulfillment');

// Voucher hanya diterbitkan setelah callback iPaymu terverifikasi; transaksi yang belum dibayar
// tetap "pending" selamanya di record. Batas ini dipakai riwayat agar panel tidak menarik ribuan
// record lama ke layar pelanggan.
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;

/**
 * Ambil kode voucher dari field `ket` sebuah record payment.
 * Cabang `buynowpanel` menyimpan kode polos (seperti `buynowweb`); kegagalan terbit ditulis
 * dengan prefix `GAGAL`. Kembalikan null bila belum ada kode nyata.
 */
function extractVoucherCode(ket) {
    if (!ket || typeof ket !== 'string') return null;
    const trimmed = ket.trim();
    if (!trimmed || /^GAGAL/i.test(trimmed)) return null;
    const match = trimmed.match(/^Voucher:\s*(.+)$/i);
    const code = (match ? match[1] : trimmed).trim();
    return code || null;
}

function isFailedKet(ket) {
    return typeof ket === 'string' && /^GAGAL/i.test(ket.trim());
}

/**
 * Biaya admin QRIS iPaymu, ditagihkan ke PEMBELI (feeDirection BUYER).
 *
 * Dipakai HANYA untuk estimasi yang ditampilkan SEBELUM transaksi dibuat — angka pasti
 * selalu datang dari iPaymu (`fee` pada record payment) begitu transaksi ada. Nilai ini
 * kembar dengan `QRIS_FEE_RATE` di `static/voucher-buy.html`; kalau iPaymu mengubah tarif,
 * dua-duanya harus ikut. Panel pelanggan membacanya dari sini (endpoint status) supaya
 * tidak ada konstanta ketiga di repo panel.
 */
const QRIS_FEE_RATE = 0.007;

/**
 * Nomor utama pelanggan sebagai digit polos, atau '' bila tidak ada.
 *
 * `phone_number` menyimpan DAFTAR nomor dipisah '|' (lihat CustomerService.getPhoneNumbers
 * dan BaseService.getCustomerJids). SATU-SATUNYA tempat aturan ini diterapkan untuk jalur
 * voucher panel — jangan menghitungnya ulang di pemanggil, karena menyapu non-digit dari
 * seluruh string akan menggabungkan semua nomor jadi angka 26-39 digit.
 */
function primaryPhoneDigits(customer) {
    const primary = String(customer?.phone_number || '')
        .split('|')
        .map((part) => part.trim())
        .filter(Boolean)[0] || '';
    return primary.replace(/\D/g, '');
}

function createCustomerVoucherService({
    getConfig,
    pay,
    addPayment,
    checkhargavc,
    getVoucherProfiles,
    getPayments,
    // Custom creds (#b405): di-inject route; lazy-require supaya modul ini tetap ringan
    // di-require test/orchestrator lain tanpa menarik seluruh adapter MikroTik.
    cekHotspotUser,
    withUsernameLock,
    logger = console
} = {}) {
    function resolveCekHotspotUser() {
        return typeof cekHotspotUser === 'function'
            ? cekHotspotUser
            : require('../lib/mikrotik').cekHotspotUser;
    }
    function resolveUsernameLock() {
        return typeof withUsernameLock === 'function'
            ? withUsernameLock
            : require('../lib/mikrotik/core').withMikrotikKeyLock;
    }
    function config() {
        return (typeof getConfig === 'function' ? getConfig() : global.config) || {};
    }

    function profiles() {
        if (typeof getVoucherProfiles === 'function') {
            const list = getVoucherProfiles();
            if (Array.isArray(list)) return list;
        }
        return Array.isArray(global.voucher) ? global.voucher : [];
    }

    function payments() {
        if (typeof getPayments === 'function') {
            const list = getPayments();
            if (Array.isArray(list)) return list;
        }
        return Array.isArray(global.payment) ? global.payment : [];
    }

    /** Fitur ini deploy-gelap: default OFF, dinyalakan operator lewat config. */
    function isEnabled() {
        return config().customerVoucher?.enabled === true;
    }

    /**
     * Read-model untuk layar pembuka panel.
     *
     * `qrisFeeRate` dan `notifyPhone` dikirim dari sini supaya panel bisa menampilkan
     * rincian "harga + biaya admin" dan nomor tujuan SEBELUM transaksi dibuat, tanpa
     * menghitung ulang aturan nomor utama di sisi klien.
     */
    function getFeatureStatus({ customer } = {}) {
        const digits = primaryPhoneDigits(customer);
        return {
            enabled: isEnabled(),
            qrisFeeRate: QRIS_FEE_RATE,
            notifyPhone: digits || null,
            // Gate yang sama dengan jalur publik/WA — panel hanya menampilkan stepper jumlah
            // bila operator mengaktifkannya di /config tab Voucher.
            multiBuy: voucherMultiBuyConfig(config()),
            // Username/password pilihan pelanggan (qty=1 saja) — panel menampilkan field
            // kustom hanya bila operator mengaktifkannya.
            customCreds: voucherCustomCredsConfig(config())
        };
    }

    /** Estimasi biaya admin QRIS. `ceil` supaya tak pernah lebih kecil dari fee asli iPaymu. */
    function estimateFee(amount) {
        const base = parseInt(amount, 10) || 0;
        return base > 0 ? Math.ceil(base * QRIS_FEE_RATE) : 0;
    }

    /** Read-model paket voucher untuk panel. Sengaja TIDAK membocorkan hargaReseller/margin. */
    function listPackages() {
        const featured = String(config().voucherFeatured || '').trim();
        return profiles()
            .filter((item) => item && item.prof)
            .map((item) => ({
                prof: String(item.prof),
                name: item.namavc || item.durasivc || String(item.prof),
                duration: item.durasivc || null,
                price: parseInt(item.hargavc, 10) || 0,
                featured: featured !== '' && String(item.prof) === featured
            }))
            .filter((item) => item.price > 0);
    }

    function findProfile(prof) {
        const wanted = String(prof || '').trim();
        if (!wanted) return null;
        return profiles().find((item) => item && String(item.prof) === wanted) || null;
    }

    /**
     * Buat transaksi QRIS untuk pelanggan terautentikasi.
     * `customer` WAJIB dari `req.customer` — nomor HP tidak boleh datang dari body, kalau tidak
     * pelanggan bisa membebankan pembelian atas nama nomor lain.
     */
    /**
     * Qty dari body: kosong ⇒ 1; selain itu HARUS integer >= 1 (strict — UI panel mengirim
     * angka bersih, input aneh berarti tampering, jadi ditolak bukan dinormalisasi).
     */
    function parsePurchaseQty(raw) {
        if (raw === undefined || raw === null || String(raw).trim() === '') return { ok: true, value: 1 };
        const n = Number(raw);
        return Number.isInteger(n) && n >= 1 ? { ok: true, value: n } : { ok: false };
    }

    /**
     * Probe ketersediaan username kustom (UX form; jawaban sementara — validasi final ada
     * di createPurchase di dalam lock). Hanya untuk pelanggan terautentikasi.
     */
    async function checkUsername({ name }) {
        if (!voucherCustomCredsConfig(config()).enabled) {
            return { ok: false, status: 404, message: '' };
        }
        const chk = await assertVoucherUsernameAvailable({
            payments: payments(),
            cekHotspotUser: resolveCekHotspotUser(),
            username: name
        });
        if (!chk.ok) {
            const status = chk.reason === 'invalid' ? 400 : (chk.reason === 'check_failed' ? 503 : 409);
            return { ok: false, status, message: chk.message, data: { available: false, reason: chk.reason } };
        }
        return { ok: true, status: 200, data: { available: true, username: chk.username } };
    }

    async function createPurchase({ customer, prof, qty, customUser, customPass }) {
        if (!isEnabled()) {
            return { ok: false, status: 503, message: 'Pembelian voucher belum tersedia saat ini.' };
        }

        const profile = findProfile(prof);
        if (!profile) {
            return { ok: false, status: 404, message: 'Paket voucher tidak ditemukan.' };
        }

        const qtyParsed = parsePurchaseQty(qty);
        if (!qtyParsed.ok) {
            return { ok: false, status: 400, message: 'Jumlah voucher tidak valid.' };
        }
        const qtyInt = qtyParsed.value;
        const multiBuy = voucherMultiBuyConfig(config());
        if (qtyInt > 1 && !multiBuy.enabled) {
            return { ok: false, status: 403, message: 'Pembelian lebih dari 1 voucher belum tersedia.' };
        }
        if (qtyInt > multiBuy.maxQty) {
            return { ok: false, status: 400, message: `Jumlah voucher maksimal ${multiBuy.maxQty} per transaksi.` };
        }

        // Username/password kustom (#b405): gate voucherCustomCreds, hanya qty=1 — N voucher
        // tak bisa berbagi satu username. Password kosong → sama dengan username.
        const wantsCustom = customUser !== undefined && customUser !== null && String(customUser).trim() !== '';
        let custom = null;
        if (wantsCustom) {
            if (!voucherCustomCredsConfig(config()).enabled) {
                return { ok: false, status: 403, message: 'Voucher dengan username sendiri belum tersedia.' };
            }
            if (qtyInt !== 1) {
                return { ok: false, status: 400, message: 'Username kustom hanya untuk pembelian 1 voucher.' };
            }
            const uname = normalizeVoucherUsername(customUser);
            if (!uname) {
                return { ok: false, status: 400, message: 'Username hanya boleh huruf kecil/angka plus - dan _ (3-16 karakter).' };
            }
            const pass = normalizeVoucherPassword(customPass);
            if (String(customPass || '').trim() !== '' && !pass) {
                return { ok: false, status: 400, message: 'Password hanya boleh 3-64 karakter tanpa spasi.' };
            }
            custom = { username: uname, password: pass || uname };
        }

        const unitPrice = parseInt(checkhargavc(profile.prof), 10) || 0;
        if (unitPrice <= 0) {
            return { ok: false, status: 422, message: 'Harga paket tidak valid. Hubungi admin.' };
        }
        // SATU transaksi iPaymu untuk seluruh batch — amount yang dibayar adalah harga×qty.
        const amount = unitPrice * qtyInt;

        const phoneDigits = primaryPhoneDigits(customer);
        // Dibedakan: "belum punya nomor" bisa diperbaiki sendiri oleh pelanggan lewat halaman
        // Pengaturan, sedangkan nomor yang ada tapi cacat biasanya salah input dari admin.
        if (!phoneDigits) {
            return {
                ok: false,
                status: 422,
                message: 'Akun Anda belum punya nomor HP terdaftar. Tambahkan dulu di menu Pengaturan, lalu coba lagi.'
            };
        }
        if (phoneDigits.length < 8) {
            return {
                ok: false,
                status: 422,
                message: 'Nomor HP akun Anda tidak valid. Perbaiki di menu Pengaturan, atau hubungi admin.'
            };
        }

        // iPaymu mewajibkan email; jalur web memakai pola sintetis yang sama agar tidak perlu
        // meminta email ke pelanggan yang sudah terverifikasi lewat nomor.
        const email = `${phoneDigits}@voucher.rafnet.local`;
        const reff = Math.floor(Math.random() * 1677721631342).toString(16);

        // Charge + tulis record. Untuk custom creds dipanggil DI DALAM lock per-username
        // (lihat bawah): record payment sekaligus RESERVASI nama — harus tertulis sebelum
        // lock lepas supaya checkout bersamaan tak sama-sama lolos pre-check.
        const chargeAndRecord = async () => {
            let charge;
            try {
                charge = await pay({
                    amount,
                    reffId: reff,
                    comment: `pembelian voucher ${profile.prof}${qtyInt > 1 ? ` x${qtyInt}` : ''} sebesar Rp. ${amount} melalui panel pelanggan`,
                    name: customer?.name || phoneDigits,
                    phone: parseInt(phoneDigits, 10),
                    email
                });
            } catch (error) {
                const message = typeof error === 'string' ? error : error?.message || 'Gagal membuat transaksi.';
                logger.error('[CUSTOMER_VOUCHER_CHARGE_ERROR]', message);
                return { ok: false, status: 502, message: 'Gagal membuat transaksi pembayaran. Coba lagi sebentar lagi.' };
            }

            // `prof` dan `customerId` disimpan EKSPLISIT di record. Cabang callback lama menurunkan
            // profil dari harga (`checkprofvc(amount)`) — itu tertukar bila dua paket berharga sama.
            // `customerId` juga yang dipakai untuk scoping riwayat & status, bukan nomor HP (nomor
            // bisa berubah, id tidak). `customUser`/`customPass` ikut tersimpan → reservasi username.
            addPayment(reff, charge.id, phoneDigits, 'buynowpanel', amount, 'QRIS', '', {
                qrStr: charge.qrString,
                priceTotal: charge.total,
                fee: charge.fee,
                subtotal: charge.subTotal,
                prof: profile.prof,
                qty: qtyInt,
                customerId: String(customer.id),
                expiredAt: charge.exp || null,
                ...(custom ? { customUser: custom.username, customPass: custom.password } : {})
            });

            return {
                ok: true,
                status: 201,
                data: {
                    reff,
                    prof: profile.prof,
                    packageName: profile.namavc || profile.durasivc || profile.prof,
                    qty: qtyInt,
                    unitPrice,
                    amount,
                    total: charge.total ?? amount,
                    fee: charge.fee ?? 0,
                    qrString: charge.qrString,
                    expiredAt: charge.exp || null
                }
            };
        };

        if (custom) {
            // Lock mencakup cek ketersediaan + charge + tulis record — celah antara pre-check
            // dan reservasi tak bisa disusupi checkout lain dengan username sama.
            return await resolveUsernameLock()(`voucher-custom:${custom.username}`, async () => {
                const chk = await assertVoucherUsernameAvailable({
                    payments: payments(),
                    cekHotspotUser: resolveCekHotspotUser(),
                    username: custom.username
                });
                if (!chk.ok) {
                    const status = chk.reason === 'check_failed' ? 503 : 409;
                    return { ok: false, status, message: chk.message };
                }
                return chargeAndRecord();
            });
        }
        return chargeAndRecord();
    }

    /** Cari record milik pelanggan ini saja. Fail-closed: id tidak cocok ⇒ dianggap tidak ada. */
    function findOwnedPayment(customer, reff) {
        const wanted = String(reff || '').trim();
        if (!wanted) return null;
        const record = payments().find((item) => item && String(item.reffId) === wanted);
        if (!record) return null;
        if (record.tag !== 'buynowpanel') return null;
        // KEAMANAN: tanpa cek ini, pelanggan lain bisa membaca kode voucher orang dengan menebak reff.
        // Fail-closed di KEDUA sisi: sesi tanpa id, atau record lama tanpa `customerId`,
        // tidak boleh saling cocok - dua "kosong" yang match akan membocorkan kode voucher.
        const customerId = String(customer?.id ?? '');
        const ownerId = String(record.customerId ?? '');
        if (!customerId || !ownerId || ownerId !== customerId) return null;
        return record;
    }

    function toStatusView(record) {
        // `voucherCodes` = SEMUA kode batch (diparse dari `ket` gabungan "A, B"); `voucherCode`
        // dipertahankan sebagai gabungan string untuk kompatibilitas panel versi lama.
        const voucherCodes = parseVoucherCodesFromKet(record.ket);
        const code = voucherCodes.length ? voucherCodes.join(', ') : null;
        const qty = normalizeVoucherQty(record.qty);
        const failed = isFailedKet(record.ket);
        let state = 'pending';
        if (record.status && code) state = 'completed';
        else if (record.status && failed) state = 'failed';
        else if (record.status) state = 'processing';

        // Rincian NYATA dari iPaymu (disimpan saat charge), bukan estimasi. Dipakai panel
        // untuk breakdown di layar QR dan struk pembayaran. `subtotal` mundur ke `amount`
        // untuk record lama yang belum menyimpannya.
        const amount = parseInt(record.amount, 10) || 0;
        const subtotal = parseInt(record.subtotal, 10) || amount;
        const fee = parseInt(record.fee, 10) || 0;

        return {
            reff: String(record.reffId),
            state,
            paid: record.status === true,
            prof: record.prof || null,
            qty,
            amount,
            subtotal,
            fee,
            total: record.priceTotal ?? (subtotal + fee),
            qrString: state === 'pending' ? record.qrStr || null : null,
            voucherCode: code,
            voucherCodes,
            // Terbit sebagian: lunas, ada kode, tapi kurang dari qty — panel menampilkan
            // peringatan agar pelanggan tahu sisanya diproses admin (orphan tercatat).
            partial: record.status === true && voucherCodes.length > 0 && voucherCodes.length < qty,
            // Kredensial kustom (#b405): username tampil selalu; password hanya setelah lunas
            // (pemilik record saja — scoping customerId di findOwnedPayment).
            customUser: record.customUser || null,
            customPass: record.status === true ? (record.customPass || null) : null,
            createdAt: record.createdAt ?? null,
            expiredAt: record.expiredAt ?? null
        };
    }

    function getPurchaseStatus({ customer, reff }) {
        const record = findOwnedPayment(customer, reff);
        if (!record) {
            return { ok: false, status: 404, message: 'Transaksi tidak ditemukan.' };
        }
        return { ok: true, status: 200, data: toStatusView(record) };
    }

    function listHistory({ customer, limit } = {}) {
        const customerId = String(customer?.id || '');
        if (!customerId) return { ok: true, status: 200, data: [] };

        const parsed = parseInt(limit, 10);
        const cap = Number.isFinite(parsed) && parsed > 0
            ? Math.min(parsed, MAX_HISTORY_LIMIT)
            : DEFAULT_HISTORY_LIMIT;

        const rows = payments()
            .filter((item) => item
                && item.tag === 'buynowpanel'
                && String(item.customerId || '') === customerId)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .slice(0, cap)
            .map(toStatusView);

        return { ok: true, status: 200, data: rows };
    }

    return {
        isEnabled,
        getFeatureStatus,
        estimateFee,
        listPackages,
        createPurchase,
        checkUsername,
        getPurchaseStatus,
        listHistory,
        // diekspor untuk test
        _extractVoucherCode: extractVoucherCode,
        _primaryPhoneDigits: primaryPhoneDigits
    };
}

module.exports = { createCustomerVoucherService };
