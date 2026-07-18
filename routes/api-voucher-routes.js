/**
 * Header Doc
 * Purpose: Factory router API voucher untuk generate, kirim, dan lacak kredensial/voucher pelanggan.
 * Caller: `routes/api.js` sebagai agregator sub-router voucher.
 * Deps: `express`, templating voucher, history pengiriman voucher, delivery service WhatsApp, serta `voucher-print` service/repository (layout + cetak + impor template Mikhmon).
 * MainFuncs: `createApiVoucherRouter`.
 * SideEffects: Membaca/menulis histori pengiriman voucher, mengirim pesan WhatsApp ke pelanggan, render lembar cetak voucher (HTML/QR), dan menyimpan settings/layout cetak.
 */
const express = require('express');
const { sendMessageToMany, ensureJid } = require('../lib/whatsapp-delivery-service');
const { createApiVoucherRepository } = require('../repositories/api-voucher.repository');
const { createApiVoucherService } = require('../services/api-voucher.service');
const { createVoucherPrintRepository } = require('../repositories/voucher-print.repository');
const { createVoucherPrintService } = require('../services/voucher-print.service');
const { createVoucherTrackingRepository } = require('../repositories/voucher-tracking.repository');
const { addHotspotUsersBatch, getvoucher } = require('../lib/mikrotik');
const { checkprofvc } = require('../lib/voucher');
const { updateKetPayment, updateStatusPayment } = require('../lib/payment');

function createApiVoucherRouter({
    fs,
    path,
    renderTemplate,
    loadVoucherSentHistory,
    appendVoucherSentHistory,
    resolveVoucherDeliveryStatus,
    buildVoucherSentHistoryEntries,
    getVoucherSentStats,
    findVoucherHistoryByReference,
    ensureAuthenticatedStaff
}) {
    const router = express.Router();

    // Guard staff fail-closed: endpoint voucher (generate/kirim/riwayat kredensial) hanya untuk
    // staff (admin/owner/superadmin/teknisi). Bila guard tidak diinjeksikan, default ini tetap
    // menolak non-staff agar pelanggan tidak bisa men-generate voucher atau membaca kredensial.
    const requireStaff = typeof ensureAuthenticatedStaff === 'function'
        ? ensureAuthenticatedStaff
        : (req, res, next) => {
            if (!req.user || !['admin', 'owner', 'superadmin', 'teknisi'].includes(req.user.role)) {
                const status = req.user ? 403 : 401;
                return res.status(status).json({ status, message: 'Akses ditolak.' });
            }
            return next();
        };

    // Ambil kode voucher dari field `ket` payment. buynowweb: "<kode>"; buynow: "Voucher: <kode>";
    // gagal terbit: "GAGAL voucher: ...". Kembalikan null bila belum ada kode nyata.
    function extractVoucherCode(ket) {
        if (!ket || typeof ket !== 'string') return null;
        const t = ket.trim();
        if (!t || /^GAGAL/i.test(t)) return null;
        const m = t.match(/^Voucher:\s*(.+)$/i);
        const code = (m ? m[1] : t).trim();
        return code || null;
    }

    function getRuntime() {
        return global.__appRuntime || null;
    }

    function getRuntimeStateValue(key, fallbackValue) {
        const runtime = getRuntime();
        if (runtime?.state?.has?.(key)) {
            return runtime.state.get(key);
        }
        if (typeof global[key] !== 'undefined') {
            return global[key];
        }
        return fallbackValue;
    }

    function getVoucherRepo() {
        return getRuntime()?.repositories?.voucher || null;
    }



    function getConfig() {
        return getRuntime()?.getConfig?.() || getRuntimeStateValue('config', {}) || {};
    }

    function getVoucherProfiles() {
        let profiles = getVoucherRepo()?.getAll() || getRuntimeStateValue('voucher', []);

        if (!profiles || profiles.length === 0) {
            const voucherDbPath = path.join(__dirname, '../database/voucher.json');
            if (fs.existsSync(voucherDbPath)) {
                profiles = JSON.parse(fs.readFileSync(voucherDbPath, 'utf8'));
            }
        }

        return Array.isArray(profiles) ? profiles : [];
    }


    const apiVoucherRepository = createApiVoucherRepository({
        runtime: getRuntime(),
        fs,
        path,
        loadVoucherSentHistory,
        appendVoucherSentHistory,
        findVoucherHistoryByReference,
        getVoucherSentStats
    });
    const apiVoucherService = createApiVoucherService({
        repository: apiVoucherRepository,
        getConfig,
        renderTemplate,
        sendMessageToMany,
        ensureJid,
        getvoucher,
        checkprofvc,
        updateKetPayment,
        updateStatusPayment,
        resolveVoucherDeliveryStatus,
        buildVoucherSentHistoryEntries,
        logger: console
    });

    const voucherPrintService = createVoucherPrintService({
        repository: createVoucherPrintRepository(),
        trackingRepository: createVoucherTrackingRepository(),
        getConfig,
        addHotspotUsersBatch,
        logger: console
    });

    router.get('/voucher/profiles', requireStaff, async (req, res) => {
        try {
            const result = await apiVoucherService.listVoucherProfiles();
            return res.status(result.status).json(result.body);
        } catch (error) {
            console.error('[VOUCHER_PROFILES_ERROR]', error);
            return res.status(500).json({
                status: 500,
                message: 'Gagal memuat paket voucher',
                error: error.message
            });
        }
    });

    router.post('/voucher/generate-send', requireStaff, async (req, res) => {
        try {
            const result = await apiVoucherService.generateAndSendVouchers({
                ...req.body,
                createdBy: req.user?.username || 'admin'
            });
            return res.status(result.status).json(result.body);
        } catch (error) {
            console.error('[VOUCHER_GENERATE_SEND_ERROR]', error);
            return res.status(500).json({
                status: 500,
                message: 'Terjadi kesalahan',
                error: error.message
            });
        }
    });

    router.get('/voucher/sent-history', requireStaff, (req, res) => {
        try {
            apiVoucherService.listSentHistory({
                limit: parseInt(req.query.limit, 10) || 50
            })
                .then((result) => res.status(result.status).json(result.body))
                .catch((error) => {
                    console.error('[VOUCHER_HISTORY_ERROR]', error);
                    return res.status(500).json({
                        status: 500,
                        message: 'Gagal memuat riwayat',
                        error: error.message
                    });
                });
        } catch (error) {
            console.error('[VOUCHER_HISTORY_ERROR]', error);
            return res.status(500).json({
                status: 500,
                message: 'Gagal memuat riwayat',
                error: error.message
            });
        }
    });

    router.get('/voucher/sent-stats', requireStaff, (req, res) => {
        try {
            apiVoucherService.getSentStats()
                .then((result) => res.status(result.status).json(result.body))
                .catch((error) => {
                    console.error('[VOUCHER_STATS_ERROR]', error);
                    return res.status(500).json({
                        status: 500,
                        message: 'Gagal memuat statistik',
                        error: error.message
                    });
                });
        } catch (error) {
            console.error('[VOUCHER_STATS_ERROR]', error);
            return res.status(500).json({
                status: 500,
                message: 'Gagal memuat statistik',
                error: error.message
            });
        }
    });

    // Statistik penjualan voucher ONLINE (buynowweb=web + buynow=WhatsApp) yang sudah dibayar.
    // Sumber: global.payment (record ber-createdAt). Read-only; dipakai halaman /voucher-sales.
    router.get('/voucher/sales-stats', requireStaff, (req, res) => {
        try {
            const payments = Array.isArray(global.payment) ? global.payment : [];
            const vouchers = Array.isArray(global.voucher) ? global.voucher : [];
            const nameByPrice = {};
            vouchers.forEach((v) => {
                const h = String(parseInt(v.hargavc, 10) || 0);
                if (h !== '0' && !nameByPrice[h]) nameByPrice[h] = v.namavc || v.prof || h;
            });
            const SALE_TAGS = ['buynowweb', 'buynow'];
            const sales = payments.filter((p) => p && p.status && SALE_TAGS.includes(p.tag) && (parseInt(p.amount, 10) || 0) > 0);
            const now = Date.now();
            const todayStr = new Date().toDateString();
            const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
            const today = { count: 0, revenue: 0 };
            const week = { count: 0, revenue: 0 };
            const total = { count: 0, revenue: 0 };
            const byPkg = {};
            const recent = [];
            sales.forEach((p) => {
                const amt = parseInt(p.amount, 10) || 0;
                total.count += 1; total.revenue += amt;
                const ts = typeof p.createdAt === 'number' ? p.createdAt : Date.parse(p.createdAt);
                if (ts && !isNaN(ts)) {
                    if (new Date(ts).toDateString() === todayStr) { today.count += 1; today.revenue += amt; }
                    if (ts >= weekAgo) { week.count += 1; week.revenue += amt; }
                }
                const pkg = nameByPrice[String(amt)] || ('Rp' + amt.toLocaleString('id-ID'));
                byPkg[pkg] = (byPkg[pkg] || 0) + 1;
                const _code = extractVoucherCode(p.ket);
                const _failed = !_code && typeof p.ket === 'string' && /^GAGAL/i.test(p.ket.trim());
                recent.push({ paket: pkg, amount: amt, ts: (ts && !isNaN(ts)) ? ts : null, tag: p.tag, code: _code, ref: p.reffId || null, failed: !!_failed });
            });
            const topPackages = Object.keys(byPkg).map((k) => ({ name: k, count: byPkg[k] })).sort((a, b) => b.count - a.count).slice(0, 5);
            recent.sort((a, b) => (b.ts || 0) - (a.ts || 0));
            return res.json({
                enabled: !!getConfig().voucherSalesDashboard?.enabled,
                today, week, total, topPackages, recent: recent.slice(0, 15)
            });
        } catch (e) {
            console.error('[VOUCHER_SALES_STATS]', e.message);
            return res.status(500).json({ error: 'Gagal menghitung statistik penjualan.' });
        }
    });

    // Kirim ULANG kode voucher yang SUDAH terbit ke nomor pembeli (recovery: pelanggan kehilangan
    // kode / WA sempat putus). TIDAK menerbitkan voucher baru — hanya kirim ulang kode tersimpan.
    // Never-throw; delivery-service yang cek koneksi WA & normalisasi nomor→JID.
    router.post('/voucher/resend', requireStaff, async (req, res) => {
        try {
            const reff = String((req.body && (req.body.reff || req.body.reference_id)) || '').trim();
            if (!reff) return res.status(400).json({ status: 400, message: 'Ref transaksi kosong.' });
            const payments = Array.isArray(global.payment) ? global.payment : [];
            const rec = payments.find((p) => p && String(p.reffId) === reff);
            if (!rec) return res.status(404).json({ status: 404, message: 'Transaksi tidak ditemukan.' });
            if (!['buynowweb', 'buynow'].includes(rec.tag)) {
                return res.status(400).json({ status: 400, message: 'Bukan transaksi voucher online.' });
            }
            const code = extractVoucherCode(rec.ket);
            if (!code) {
                return res.status(409).json({ status: 409, message: 'Kode belum ada (voucher gagal terbit / belum dibayar). Perlu diterbitkan ulang, bukan sekadar kirim ulang.' });
            }
            if (!rec.sender) return res.status(400).json({ status: 400, message: 'Nomor pembeli tidak tercatat.' });
            const vouchers = Array.isArray(global.voucher) ? global.voucher : [];
            const amt = parseInt(rec.amount, 10) || 0;
            const match = vouchers.find((v) => (parseInt(v.hargavc, 10) || 0) === amt);
            const namaPaket = (match && (match.namavc || match.durasivc || match.prof)) || ('Rp' + amt.toLocaleString('id-ID'));
            const result = await apiVoucherService.resendVoucherCode({ phone: rec.sender, code, namaPaket, amount: amt });
            return res.status(result.status).json(result.body);
        } catch (e) {
            console.error('[VOUCHER_RESEND]', e && e.message);
            return res.status(500).json({ status: 500, message: 'Terjadi kesalahan saat kirim ulang.' });
        }
    });

    // Kunci per-reff supaya klik "Terbitkan ulang" ganda tak memicu getvoucher dua kali (dobel voucher).
    const _reissueInFlight = new Set();

    // Terbitkan ULANG voucher untuk transaksi SUDAH DIBAYAR tapi voucher GAGAL terbit (beda dari
    // resend yang butuh kode SUDAH ada). Generate voucher BARU → simpan kode → kirim WA.
    // getvoucher non-idempotent → admin konfirmasi di UI + kunci in-flight di sini.
    router.post('/voucher/reissue', requireStaff, async (req, res) => {
        const reff = String((req.body && (req.body.reff || req.body.reference_id)) || '').trim();
        if (!reff) return res.status(400).json({ status: 400, message: 'Ref transaksi kosong.' });
        if (_reissueInFlight.has(reff)) {
            return res.status(409).json({ status: 409, message: 'Transaksi ini sedang diterbitkan ulang — tunggu sebentar.' });
        }
        _reissueInFlight.add(reff);
        try {
            const payments = Array.isArray(global.payment) ? global.payment : [];
            const rec = payments.find((p) => p && String(p.reffId) === reff);
            if (!rec) return res.status(404).json({ status: 404, message: 'Transaksi tidak ditemukan.' });
            if (!['buynowweb', 'buynow'].includes(rec.tag)) {
                return res.status(400).json({ status: 400, message: 'Bukan transaksi voucher online.' });
            }
            if (!rec.status) {
                return res.status(409).json({ status: 409, message: 'Transaksi belum dibayar — tidak bisa diterbitkan.' });
            }
            if (extractVoucherCode(rec.ket)) {
                return res.status(409).json({ status: 409, message: 'Voucher sudah punya kode. Pakai "Kirim ulang", bukan terbitkan ulang.' });
            }
            if (!rec.sender) return res.status(400).json({ status: 400, message: 'Nomor pembeli tidak tercatat.' });
            const vouchers = Array.isArray(global.voucher) ? global.voucher : [];
            const amt = parseInt(rec.amount, 10) || 0;
            const match = vouchers.find((v) => (parseInt(v.hargavc, 10) || 0) === amt);
            const namaPaket = (match && (match.namavc || match.durasivc || match.prof)) || ('Rp' + amt.toLocaleString('id-ID'));
            const result = await apiVoucherService.reissueVoucher({ reff, amount: amt, sender: rec.sender, namaPaket });
            return res.status(result.status).json(result.body);
        } catch (e) {
            console.error('[VOUCHER_REISSUE]', e && e.message);
            return res.status(500).json({ status: 500, message: 'Terjadi kesalahan saat terbitkan ulang.' });
        } finally {
            _reissueInFlight.delete(reff);
        }
    });

    router.post('/member/send-credentials', requireStaff, async (req, res) => {
        try {
            const result = await apiVoucherService.sendMemberCredentials({
                userId: req.body.userId,
                phones: req.body.phones,
                notes: req.body.notes,
                createdBy: req.user?.username || 'admin'
            });
            return res.status(result.status).json(result.body);
        } catch (error) {
            console.error('[MEMBER_CREDENTIALS_ERROR]', error);
            return res.status(500).json({
                status: 500,
                message: 'Terjadi kesalahan',
                error: error.message
            });
        }
    });

    // ===== Cetak Voucher (layout + QR, lepas Mikhmon untuk generate+cetak) =====
    router.get('/voucher/print/layouts', requireStaff, (req, res) => {
        try {
            return res.json({ status: 200, data: voucherPrintService.listLayouts() });
        } catch (error) {
            console.error('[VOUCHER_PRINT_LAYOUTS_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal memuat layout', error: error.message });
        }
    });

    router.get('/voucher/print/settings', requireStaff, (req, res) => {
        try {
            return res.json({ status: 200, data: voucherPrintService.getSettings() });
        } catch (error) {
            console.error('[VOUCHER_PRINT_SETTINGS_GET_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal memuat pengaturan', error: error.message });
        }
    });

    router.post('/voucher/print/settings', requireStaff, (req, res) => {
        try {
            const saved = voucherPrintService.saveSettings(req.body || {});
            return res.json({ status: 200, message: 'Pengaturan tersimpan', data: saved });
        } catch (error) {
            console.error('[VOUCHER_PRINT_SETTINGS_SAVE_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal menyimpan pengaturan', error: error.message });
        }
    });

    router.post('/voucher/print/layout', requireStaff, (req, res) => {
        try {
            if (!req.body || !req.body.id || !req.body.template) {
                return res.status(400).json({ status: 400, message: 'id dan template wajib diisi' });
            }
            const saved = voucherPrintService.saveLayout(req.body);
            return res.json({ status: 200, message: 'Layout tersimpan', data: saved });
        } catch (error) {
            console.error('[VOUCHER_PRINT_LAYOUT_SAVE_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal menyimpan layout', error: error.message });
        }
    });

    router.delete('/voucher/print/layout/:id', requireStaff, (req, res) => {
        try {
            const result = voucherPrintService.deleteLayout(req.params.id);
            return res.json({ status: 200, message: 'Layout dihapus', data: result });
        } catch (error) {
            console.error('[VOUCHER_PRINT_LAYOUT_DELETE_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal menghapus layout', error: error.message });
        }
    });

    router.post('/voucher/print/preview-mikhmon', requireStaff, (req, res) => {
        try {
            const result = voucherPrintService.previewMikhmonImport({ php: req.body ? req.body.php : '' });
            return res.json({ status: 200, data: result });
        } catch (error) {
            console.error('[VOUCHER_PRINT_MIKHMON_PREVIEW_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal konversi template', error: error.message });
        }
    });

    router.post('/voucher/print/import-mikhmon', requireStaff, (req, res) => {
        try {
            const result = voucherPrintService.importMikhmonLayout({
                id: req.body ? req.body.id : undefined,
                name: req.body ? req.body.name : undefined,
                php: req.body ? req.body.php : '',
                mergeColors: !req.body || req.body.mergeColors !== false
            });
            return res.json({ status: 200, message: 'Template Mikhmon diimpor', data: result });
        } catch (error) {
            console.error('[VOUCHER_PRINT_MIKHMON_IMPORT_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal impor template', error: error.message });
        }
    });

    router.post('/voucher/print/generate', requireStaff, async (req, res) => {
        try {
            const result = await voucherPrintService.generateBatch({
                profile: req.body ? req.body.profile : undefined,
                count: req.body ? req.body.count : undefined,
                length: req.body ? req.body.length : undefined,
                chartype: req.body ? req.body.chartype : undefined,
                prefix: req.body ? req.body.prefix : undefined,
                usernames: req.body ? req.body.usernames : undefined
            });
            if (!result.ok) {
                return res.status(400).json({ status: 400, message: result.message });
            }
            return res.json({
                status: 200,
                message: `Berhasil generate ${result.created} voucher${result.failed ? `, ${result.failed} gagal` : ''}`,
                data: result
            });
        } catch (error) {
            console.error('[VOUCHER_PRINT_GENERATE_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal generate voucher batch', error: error.message });
        }
    });

    router.post('/voucher/print/render', requireStaff, async (req, res) => {
        try {
            const result = await voucherPrintService.renderPrint({
                layoutId: req.body ? req.body.layoutId : undefined,
                vouchers: (req.body && req.body.vouchers) || [],
                thermal: Boolean(req.body && req.body.thermal),
                title: req.body ? req.body.title : undefined
            });
            res.set('Content-Type', 'text/html; charset=utf-8');
            return res.send(result.html);
        } catch (error) {
            console.error('[VOUCHER_PRINT_RENDER_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal render cetak', error: error.message });
        }
    });

    router.get('/voucher/print/report', requireStaff, async (req, res) => {
        try {
            const data = await voucherPrintService.getVoucherReport({
                from: req.query.from || null,
                to: req.query.to || null,
                profile: req.query.profile || null
            });
            return res.json({ status: 200, data });
        } catch (error) {
            console.error('[VOUCHER_PRINT_REPORT_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal memuat laporan', error: error.message });
        }
    });

    router.get('/voucher/print/activations', requireStaff, async (req, res) => {
        try {
            const data = await voucherPrintService.listVoucherActivations({
                limit: parseInt(req.query.limit, 10) || 50,
                profile: req.query.profile || null
            });
            return res.json({ status: 200, data });
        } catch (error) {
            console.error('[VOUCHER_PRINT_ACTIVATIONS_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal memuat aktivasi', error: error.message });
        }
    });

    return router;
}

module.exports = createApiVoucherRouter;
