/**
 * Header Doc
 * Purpose: Sub-router PUBLIK domain KONTEN read-only (dipisah dari routes/public.js yang grab-bag 5
 *   domain). Rute nama-WiFi + pengumuman + berita — semua GET tanpa auth, dipakai halaman publik/portal.
 *   Di-mount via facade `routes/public.js` (router.use) sehingga PATH tak berubah.
 * Caller: routes/public.js (facade).
 * Deps: lib/error-handler (asyncHandler), lib/response-helper (sendSuccess), lib/services/public-service.
 * MainFuncs: GET /api/wifi-name, /api/announcements(+/recent), /api/news(+/recent).
 * SideEffects: Baca config/announcement/news store (via PublicService); tak menulis.
 */
const express = require('express');
const { asyncHandler } = require('../../lib/error-handler');
const { sendSuccess } = require('../../lib/response-helper');
const PublicService = require('../../lib/services/public-service');

const router = express.Router();

router.get('/api/wifi-name', asyncHandler(async (req, res) => {
    const wifiData = await PublicService.getWifiName();
    // Nomor CS publik OPSIONAL (config.publicContact) untuk link "Chat admin" di halaman
    // voucher. Hanya diekspos bila berupa digit valid (>=9, bukan placeholder ber-'x');
    // bila kosong, bentuk respons TIDAK berubah (jaga kompat kontrak lama).
    let contact = '';
    try {
        const raw = String((global.config && global.config.publicContact) || '');
        const digits = raw.replace(/\D/g, '');
        if (digits.length >= 9 && !/x/i.test(raw)) contact = digits;
    } catch (_e) { /* abaikan */ }
    // Panduan "Cara pakai voucher" yang bisa dicustom admin (config.voucherGuide.steps/loginUrl).
    // Bila kosong, field tidak dikirim → halaman beli pakai default HTML-nya.
    let voucherGuide = null;
    try {
        const g = global.config && global.config.voucherGuide;
        if (g && (g.steps || g.loginUrl)) {
            voucherGuide = {};
            if (g.steps) voucherGuide.steps = String(g.steps);
            if (g.loginUrl) voucherGuide.loginUrl = String(g.loginUrl);
        }
    } catch (_e) { /* abaikan */ }
    // Nomor tujuan tombol "Laporkan ke Admin" di layar sukses: publicContact publik bila valid,
    // else nomor BOT sendiri (yang memang dipakai pelanggan chat). Dinormalisasi ke 62xxxx.
    let reportNumber = '';
    try {
        const pc = String((global.config && global.config.publicContact) || '');
        const pcd = pc.replace(/\D/g, '');
        if (pcd.length >= 9 && !/x/i.test(pc)) {
            reportNumber = pcd.charAt(0) === '0' ? '62' + pcd.slice(1) : pcd;
        } else {
            const botId = String((global.raf && global.raf.user && global.raf.user.id) || (global.conn && global.conn.user && global.conn.user.id) || '');
            const bd = botId.split(/[:@]/)[0].replace(/\D/g, '');
            if (bd.length >= 9) reportNumber = bd;
        }
    } catch (_e) { /* abaikan */ }
    // Status koneksi WA bot: bila bukan 'open', kode voucher TIDAK bisa dikirim via WA.
    // Halaman beli publik pakai flag ini untuk tak menjanjikan pengiriman WhatsApp.
    let waConnected = false;
    try { waConnected = (global.whatsappConnectionState === 'open'); } catch (_e) { /* abaikan */ }
    const data = Object.assign({}, wifiData,
        contact ? { contact } : {},
        voucherGuide ? { voucherGuide } : {},
        reportNumber ? { reportNumber } : {},
        { waConnected });
    return sendSuccess(res, data, "Nama WiFi berhasil diambil");
}));

// no-cache untuk konten real-time (pengumuman/berita bisa berubah kapan saja).
function noCache(res) {
    res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
}

router.get('/api/announcements', asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit) : null;
    const announcements = await PublicService.getAnnouncements({ limit });
    noCache(res);
    return res.status(200).json({ status: 200, success: true, message: "Daftar pengumuman berhasil diambil", data: announcements });
}));

router.get('/api/announcements/recent', asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit) : 5;
    const announcements = await PublicService.getAnnouncements({ limit });
    noCache(res);
    return res.status(200).json({ status: 200, success: true, message: "Daftar pengumuman terbaru berhasil diambil", data: announcements });
}));

router.get('/api/news', asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit) : null;
    const news = await PublicService.getNews({ limit });
    noCache(res);
    return res.status(200).json({ status: 200, success: true, message: "Daftar berita berhasil diambil", data: news });
}));

router.get('/api/news/recent', asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit) : 5;
    const news = await PublicService.getNews({ limit });
    noCache(res);
    return res.status(200).json({ status: 200, success: true, message: "Daftar berita terbaru berhasil diambil", data: news });
}));

module.exports = router;
