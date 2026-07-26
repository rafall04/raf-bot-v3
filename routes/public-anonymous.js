/**
 * Header Doc
 * Purpose: Router publik ANONIM (tanpa login) sebagai OWNER TUNGGAL surface beli voucher online:
 *   halaman `/voucher` + API `/app/*` (buat transaksi iPaymu, cek detail/status, render QRIS→PNG).
 *   Dipisah dari `routes/public.js` agar bisa di-mount di listener publik (port terpisah) TANPA
 *   menyeret dependency customer-authenticated (CustomerService/WifiService/apiAuth/multer).
 * Caller: `lib/routes-registry` (mount "/" di app utama, kompat link lama) DAN `lib/public-site-app`
 *   (app publik pada port terpisah).
 * Deps: express, path, qr-image, `lib/ipaymu` (pay), `lib/voucher` (checkhargavc), `lib/payment` (addPayment);
 *   state `global.payment` / `global.packages` / `global.voucher`.
 * MainFuncs: GET /voucher, GET /app/:type/:id?, `toPublicVoucher` (proyeksi allowlist).
 * Catatan keamanan: `/app/voucher` TIDAK mengirim `global.voucher` mentah — ia diproyeksikan
 *   lewat `PUBLIC_VOUCHER_FIELDS` supaya `hargaReseller`/`margin` tidak bocor ke pengunjung
 *   anonim. Tambah kolom harga baru di voucher.json => tambahkan ke allowlist bila memang
 *   perlu tampil, bukan sebaliknya.
 * SideEffects: Membuat record pembayaran (addPayment) & memanggil iPaymu saat `buy`. TIDAK menyentuh
 *   saldo/voucher fulfillment — penyelesaian ada di callback `POST /callback/payment` (tetap di
 *   `routes/public.js`, port utama), berbagi `global.payment` dalam proses yang sama.
 */
const express = require('express');
const path = require('path');
const qr = require('qr-image');

const pay = require('../lib/ipaymu');
const { addPayment } = require('../lib/payment');
const { checkhargavc } = require('../lib/voucher');

const router = express.Router();

/**
 * Field voucher yang BOLEH dilihat publik anonim.
 *
 * ALLOWLIST, bukan blocklist: `global.voucher` (database/voucher.json) juga menyimpan
 * `hargaReseller` dan `margin`, dan menambah kolom harga baru di masa depan tidak boleh
 * otomatis bocor ke `/app/voucher`.
 *
 * Nama field DIPERTAHANKAN apa adanya. Ini sengaja BUKAN read-model bernama-baru seperti
 * `listPackages()` di services/customer-voucher.service.js (yang memancarkan price/name/
 * duration) — `static/voucher-buy.html` membaca `hargavc`/`namavc`/`durasivc` langsung,
 * jadi mengganti nama di sini akan mengosongkan katalog halaman beli.
 */
const PUBLIC_VOUCHER_FIELDS = ['prof', 'namavc', 'durasivc', 'hargavc'];

/** Proyeksi satu paket voucher untuk konsumsi publik. `featured` hanya ditambah bila benar. */
function toPublicVoucher(item, featured) {
    const out = {};
    PUBLIC_VOUCHER_FIELDS.forEach((field) => {
        if (item && item[field] !== undefined) out[field] = item[field];
    });
    if (featured) out.featured = true;
    return out;
}

// Halaman publik beli voucher online (pembeli umum/anonim). Static page; API-nya di /app/*.
router.get('/voucher', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'static', 'voucher-buy.html'));
});

router.get('/app/:type/:id?', async (req, res) => {
    const { type, id } = req.params;
    try {
        switch(type) {
            case "buy": {
                const { phone, email } = req.query;
                if (!phone || !email) return res.status(400).json({ status: 400, message: "Nomor telepon dan email diperlukan!" });
                const reff = Math.floor(Math.random() * 1677721631342).toString(16);
                let hargavc = checkhargavc(id);
                hargavc = parseInt(hargavc);
                let result = await pay({ amount: hargavc, reffId: reff, comment: `pembelian voucher ${id} sebesar Rp. ${hargavc} melalui web`, name: email?.split('@')?.[0] || "Anonymous", phone: parseInt(phone), email });
                addPayment(reff, result.id, phone, `buynowweb`, hargavc, 'QRIS', ``, { qrStr: result.qrString, priceTotal: result.total, fee: result.fee, subtotal: result.subTotal });
                return res.status(200).json({ status: 200, message: 'Success', data: reff });
            }
            case 'detailtrx': {
                return res.status(200).json({ status: 200, message: 'Success', data: global.payment.find(h => h.reffId == id) || null });
            }
            case 'statustrx': {
                let pay = global.payment.find(d => d.reffId == id);
                if (!pay) return res.status(404).json({ status: 404, message: "" });
                if (!pay.status) return res.status(400).json({ status: 400, message: "menunggu pembayaran!" });
                return res.status(200).json({ status: 200, message: 'Success', data: global.payment.find(h => h.reffId == id) || null });
            }
            case 'qr': {
                // Render QRIS string (tersimpan saat charge) menjadi gambar PNG agar tampil di
                // halaman beli voucher tanpa dependensi QR dari CDN.
                const rec = global.payment.find(d => d.reffId == id);
                if (!rec || !rec.qrStr) return res.status(404).send('');
                try {
                    const png = qr.imageSync(String(rec.qrStr), { type: 'png', ec_level: 'M' });
                    res.setHeader('Content-Type', 'image/png');
                    res.setHeader('Cache-Control', 'no-store');
                    return res.end(png);
                } catch (_e) {
                    return res.status(500).send('');
                }
            }
            default: {
                if (type == 'voucher') {
                    // Diproyeksikan lewat allowlist: JANGAN kirim `global.voucher` mentah —
                    // isinya termasuk hargaReseller & margin, dan endpoint ini anonim.
                    // Tandai paket "Terlaris" (config.voucherFeatured = prof) untuk badge halaman beli.
                    const feat = String((global.config && global.config.voucherFeatured) || '').trim();
                    const list = Array.isArray(global.voucher) ? global.voucher : [];
                    return res.json({
                        data: list.map(v => toPublicVoucher(v, feat !== '' && String(v && v.prof) === feat))
                    });
                }
                const data = type == 'packages' ? global.packages : [];
                return res.json({ data });
            }
        }
    } catch(err) {
        if (typeof err === "string") return res.json({ status: 400, message: err });
        console.log(err);
        return res.json({ status: 500, message: "Internal server error" });
    }
});

module.exports = router;
