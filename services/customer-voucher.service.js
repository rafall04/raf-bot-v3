/**
 * Header Doc
 * Purpose: Owner logika beli voucher dari PANEL PELANGGAN (terautentikasi) — daftar paket,
 *   pembuatan transaksi QRIS iPaymu (tag `buynowpanel`), cek status milik-sendiri, dan riwayat
 *   per pelanggan. Berbeda dari surface anonim `/app/*` (`routes/public-anonymous.js`): di sini
 *   nomor HP diambil dari sesi pelanggan, TIDAK PERNAH dari body, dan setiap pembacaan status
 *   di-scope ke `customerId` pemilik transaksi.
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

function createCustomerVoucherService({
    getConfig,
    pay,
    addPayment,
    checkhargavc,
    getVoucherProfiles,
    getPayments,
    logger = console
} = {}) {
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
    async function createPurchase({ customer, prof }) {
        if (!isEnabled()) {
            return { ok: false, status: 503, message: 'Pembelian voucher belum tersedia saat ini.' };
        }

        const profile = findProfile(prof);
        if (!profile) {
            return { ok: false, status: 404, message: 'Paket voucher tidak ditemukan.' };
        }

        const amount = parseInt(checkhargavc(profile.prof), 10) || 0;
        if (amount <= 0) {
            return { ok: false, status: 422, message: 'Harga paket tidak valid. Hubungi admin.' };
        }

        // `phone_number` menyimpan DAFTAR nomor dipisah '|' (lihat CustomerService.getPhoneNumbers
        // dan BaseService.getCustomerJids), bukan satu nomor. Menyapu non-digit dari SELURUH string
        // akan MENGGABUNGKAN semua nomor jadi satu angka 26-39 digit — lolos cek panjang dan
        // terkirim ke iPaymu sebagai nomor sampah. Ambil nomor pertama sebagai nomor utama.
        const primaryPhone = String(customer?.phone_number || '')
            .split('|')
            .map((part) => part.trim())
            .filter(Boolean)[0] || '';
        const phoneDigits = primaryPhone.replace(/\D/g, '');
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

        let charge;
        try {
            charge = await pay({
                amount,
                reffId: reff,
                comment: `pembelian voucher ${profile.prof} sebesar Rp. ${amount} melalui panel pelanggan`,
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
        // bisa berubah, id tidak).
        addPayment(reff, charge.id, phoneDigits, 'buynowpanel', amount, 'QRIS', '', {
            qrStr: charge.qrString,
            priceTotal: charge.total,
            fee: charge.fee,
            subtotal: charge.subTotal,
            prof: profile.prof,
            customerId: String(customer.id),
            expiredAt: charge.exp || null
        });

        return {
            ok: true,
            status: 201,
            data: {
                reff,
                prof: profile.prof,
                packageName: profile.namavc || profile.durasivc || profile.prof,
                amount,
                total: charge.total ?? amount,
                fee: charge.fee ?? 0,
                qrString: charge.qrString,
                expiredAt: charge.exp || null
            }
        };
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
        const code = extractVoucherCode(record.ket);
        const failed = isFailedKet(record.ket);
        let state = 'pending';
        if (record.status && code) state = 'completed';
        else if (record.status && failed) state = 'failed';
        else if (record.status) state = 'processing';

        return {
            reff: String(record.reffId),
            state,
            paid: record.status === true,
            prof: record.prof || null,
            amount: parseInt(record.amount, 10) || 0,
            total: record.priceTotal ?? null,
            qrString: state === 'pending' ? record.qrStr || null : null,
            voucherCode: code,
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
        listPackages,
        createPurchase,
        getPurchaseStatus,
        listHistory,
        // diekspor untuk test
        _extractVoucherCode: extractVoucherCode
    };
}

module.exports = { createCustomerVoucherService };
