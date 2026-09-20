/**
 * Header Doc
 * Purpose: Factory router API voucher untuk generate, kirim, dan lacak kredensial/voucher pelanggan.
 * Caller: `routes/api.js` sebagai agregator sub-router voucher.
 * Deps: `express`, templating voucher, history pengiriman voucher, delivery service WhatsApp, admin-recipients (getAdminJids), html-to-pdf, response-template-helper, serta `voucher-print` service/repository (layout + cetak + impor template Mikhmon).
 * MainFuncs: `createApiVoucherRouter`.
 * SideEffects: Membaca/menulis histori pengiriman voucher, mengirim pesan WhatsApp ke pelanggan, render lembar cetak voucher (HTML/QR/PDF), kirim PDF lembar voucher ke WhatsApp owner/admin (gated config.voucherPrint), dan menyimpan settings/layout cetak.
 */
const log = require('../lib/logger').logger.child('API_VOUCHER_ROUTES');
const express = require('express');
const { sendMessageToMany, ensureJid } = require('../lib/whatsapp-delivery-service');
const { getAdminJids } = require('../lib/admin-recipients');
const { renderHtmlToPdf } = require('../lib/html-to-pdf');
const { renderResponseTemplate } = require('../lib/response-template-helper');
const { createApiVoucherRepository } = require('../repositories/api-voucher.repository');
const { createApiVoucherService } = require('../services/api-voucher.service');
const { createVoucherPrintRepository } = require('../repositories/voucher-print.repository');
const { createVoucherPrintService } = require('../services/voucher-print.service');
const { createVoucherTrackingRepository } = require('../repositories/voucher-tracking.repository');
const { addHotspotUsersBatch, getvoucher } = require('../lib/mikrotik');
const { checkprofvc, checknamavc } = require('../lib/voucher');
const { updateKetPayment, updateStatusPayment } = require('../lib/payment');
const { listVoucherOrphans, getVoucherOrphan, resolveVoucherOrphan } = require('../lib/voucher-orphan');

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
        htmlToPdf: renderHtmlToPdf,
        sendMessageToMany,
        ensureJid,
        getAdminJids,
        renderResponseTemplate,
        getVoucherProfiles,
        logger: console
    });

    router.get('/voucher/profiles', requireStaff, async (req, res) => {
        try {
            const result = await apiVoucherService.listVoucherProfiles();
            return res.status(result.status).json(result.body);
        } catch (error) {
            log.error('[VOUCHER_PROFILES_ERROR]', error);
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
            log.error('[VOUCHER_GENERATE_SEND_ERROR]', error);
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
                    log.error('[VOUCHER_HISTORY_ERROR]', error);
                    return res.status(500).json({
                        status: 500,
                        message: 'Gagal memuat riwayat',
                        error: error.message
                    });
                });
        } catch (error) {
            log.error('[VOUCHER_HISTORY_ERROR]', error);
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
                    log.error('[VOUCHER_STATS_ERROR]', error);
                    return res.status(500).json({
                        status: 500,
                        message: 'Gagal memuat statistik',
                        error: error.message
                    });
                });
        } catch (error) {
            log.error('[VOUCHER_STATS_ERROR]', error);
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
            log.error('[VOUCHER_SALES_STATS]', e.message);
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
            log.error('[VOUCHER_RESEND]', e && e.message);
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
            // Profil dari record pembayaran (disimpan saat charge) menang atas lookup-by-harga —
            // anti salah-durasi saat dua paket berharga sama.
            const result = await apiVoucherService.reissueVoucher({ reff, amount: amt, sender: rec.sender, namaPaket, prof: rec.prof });
            return res.status(result.status).json(result.body);
        } catch (e) {
            log.error('[VOUCHER_REISSUE]', e && e.message);
            return res.status(500).json({ status: 500, message: 'Terjadi kesalahan saat terbitkan ulang.' });
        } finally {
            _reissueInFlight.delete(reff);
        }
    });

    // ---------- Worklist voucher ORPHAN (/voucher-orphans) ----------
    // Orphan = entri di database/voucher_orphans.json. Dua bentuk:
    //   (a) paid-unissued — pelanggan BAYAR tapi voucher gagal dibuat (callback gagal):
    //       field {type, reference_id, sender, amount, profile, error} → aksi `fulfill`.
    //   (b) created-unpaid — voucher SUDAH terbit di MikroTik tapi penagihan gagal
    //       (saldo/agent rollback): field {sender, voucherCode, profile, price, reason} →
    //       aksi `send` (kirim kode existing) atau `manual`. JANGAN generate ulang — voucher
    //       sudah ada, membuat lagi = bocor voucher kedua.
    function toOrphanView(o) {
        return {
            id: o.id,
            timestamp: o.timestamp || null,
            kind: o.voucherCode ? 'created_unpaid' : 'paid_unissued',
            type: o.type || null,
            referenceId: o.reference_id || null,
            sender: o.sender || null,
            profile: o.profile || null,
            amount: o.amount != null ? o.amount : (o.price != null ? o.price : null),
            voucherCode: o.voucherCode || null,
            error: o.error || o.reason || null,
            resolved: !!o.resolved,
            resolvedAt: o.resolvedAt || null,
            resolvedBy: o.resolvedBy || null,
            resolution: o.resolution || null
        };
    }

    router.get('/voucher/orphans', requireStaff, (req, res) => {
        try {
            const status = ['open', 'resolved', 'all'].includes(String(req.query.status))
                ? String(req.query.status) : 'open';
            const all = listVoucherOrphans({ status: 'all' });
            const items = listVoucherOrphans({ status });
            return res.json({
                status: 200,
                stats: {
                    total: all.length,
                    open: all.filter((o) => !o.resolved).length,
                    resolved: all.filter((o) => !!o.resolved).length
                },
                items: items.map(toOrphanView)
            });
        } catch (e) {
            log.error('[VOUCHER_ORPHANS_LIST]', e && e.message);
            return res.status(500).json({ status: 500, message: 'Gagal memuat worklist orphan.' });
        }
    });

    // Kunci per-orphan: `fulfill`/`send` non-idempotent (membuat voucher / mengirim WA).
    const _orphanInFlight = new Set();

    router.post('/voucher/orphans/:id/resolve', requireStaff, async (req, res) => {
        const id = String(req.params.id || '').trim();
        const action = String((req.body && req.body.action) || '').trim();
        const note = String((req.body && req.body.note) || '').trim();
        const resolvedBy = (req.user && req.user.username) || 'admin';
        if (!id) return res.status(400).json({ status: 400, message: 'ID orphan kosong.' });
        if (!['fulfill', 'send', 'manual', 'refund'].includes(action)) {
            return res.status(400).json({ status: 400, message: 'Aksi tidak dikenal (fulfill|send|manual|refund).' });
        }
        if (_orphanInFlight.has(id)) {
            return res.status(409).json({ status: 409, message: 'Orphan ini sedang diproses — tunggu sebentar.' });
        }
        _orphanInFlight.add(id);
        try {
            const entry = getVoucherOrphan(id);
            if (!entry) return res.status(404).json({ status: 404, message: 'Orphan tidak ditemukan.' });
            if (entry.resolved) return res.status(409).json({ status: 409, message: 'Orphan sudah ter-resolve.' });

            if (action === 'fulfill') {
                // Terbitkan voucher BARU untuk pembelian yang sudah dibayar — pakai profile yang
                // TERCATAT di entri (bukan lookup harga: dua paket bisa berharga sama).
                if (entry.voucherCode) {
                    return res.status(409).json({ status: 409, message: 'Voucher sudah terbit (kode ada) — pakai aksi Kirim/Manual, jangan generate ulang.' });
                }
                if (!entry.reference_id) {
                    return res.status(400).json({ status: 400, message: 'Entri tanpa reference_id — selesaikan manual.' });
                }
                if (!entry.profile) {
                    return res.status(400).json({ status: 400, message: 'Entri tanpa profil voucher — selesaikan manual.' });
                }
                if (!entry.sender) {
                    return res.status(400).json({ status: 400, message: 'Entri tanpa nomor pembeli — selesaikan manual.' });
                }
                const result = await apiVoucherService.reissueVoucher({
                    reff: entry.reference_id,
                    amount: entry.amount != null ? entry.amount : entry.price,
                    sender: entry.sender,
                    namaPaket: checknamavc(entry.profile) || entry.profile,
                    prof: entry.profile
                });
                if (result.status !== 200) return res.status(result.status).json(result.body);
                resolveVoucherOrphan(id, { action: 'fulfill', note, resolvedBy, voucherCode: result.body.code });
                return res.status(200).json(result.body);
            }

            if (action === 'send') {
                // Voucher SUDAH ada di MikroTik — kirim ulang kode yang sama, JANGAN generate baru.
                if (!entry.voucherCode) {
                    return res.status(400).json({ status: 400, message: 'Tidak ada kode tersimpan — pakai fulfill (terbitkan baru) atau manual.' });
                }
                const digits = String(entry.sender || '').replace(/\D/g, '');
                if (digits.length < 9) {
                    return res.status(400).json({ status: 400, message: 'Sender bukan nomor HP (mis. agent_*) — kirim manual.' });
                }
                const result = await apiVoucherService.resendVoucherCode({
                    phone: digits,
                    code: entry.voucherCode,
                    namaPaket: checknamavc(entry.profile) || entry.profile || 'Voucher',
                    amount: entry.amount != null ? entry.amount : entry.price
                });
                if (result.status !== 200) return res.status(result.status).json(result.body);
                resolveVoucherOrphan(id, { action: 'send', note, resolvedBy, voucherCode: entry.voucherCode });
                return res.status(200).json(result.body);
            }

            // manual / refund — hanya tandai resolved + catatan (refund = uang sudah dikembalikan
            // di luar sistem; manual = admin fulfill lewat jalur lain).
            const updated = resolveVoucherOrphan(id, { action, note, resolvedBy });
            if (!updated) return res.status(409).json({ status: 409, message: 'Orphan sudah ter-resolve.' });
            return res.status(200).json({ status: 200, message: 'Orphan ditandai selesai.', item: toOrphanView(updated) });
        } catch (e) {
            log.error('[VOUCHER_ORPHAN_RESOLVE]', e && e.message);
            return res.status(500).json({ status: 500, message: 'Terjadi kesalahan saat memproses orphan.' });
        } finally {
            _orphanInFlight.delete(id);
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
            log.error('[MEMBER_CREDENTIALS_ERROR]', error);
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
            log.error('[VOUCHER_PRINT_LAYOUTS_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal memuat layout', error: error.message });
        }
    });

    router.get('/voucher/print/settings', requireStaff, (req, res) => {
        try {
            return res.json({ status: 200, data: voucherPrintService.getSettings() });
        } catch (error) {
            log.error('[VOUCHER_PRINT_SETTINGS_GET_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal memuat pengaturan', error: error.message });
        }
    });

    router.post('/voucher/print/settings', requireStaff, (req, res) => {
        try {
            const saved = voucherPrintService.saveSettings(req.body || {});
            return res.json({ status: 200, message: 'Pengaturan tersimpan', data: saved });
        } catch (error) {
            log.error('[VOUCHER_PRINT_SETTINGS_SAVE_ERROR]', error);
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
            log.error('[VOUCHER_PRINT_LAYOUT_SAVE_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal menyimpan layout', error: error.message });
        }
    });

    router.delete('/voucher/print/layout/:id', requireStaff, (req, res) => {
        try {
            const result = voucherPrintService.deleteLayout(req.params.id);
            return res.json({ status: 200, message: 'Layout dihapus', data: result });
        } catch (error) {
            log.error('[VOUCHER_PRINT_LAYOUT_DELETE_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal menghapus layout', error: error.message });
        }
    });

    router.post('/voucher/print/preview-mikhmon', requireStaff, (req, res) => {
        try {
            const result = voucherPrintService.previewMikhmonImport({ php: req.body ? req.body.php : '' });
            return res.json({ status: 200, data: result });
        } catch (error) {
            log.error('[VOUCHER_PRINT_MIKHMON_PREVIEW_ERROR]', error);
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
            log.error('[VOUCHER_PRINT_MIKHMON_IMPORT_ERROR]', error);
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
                const status = result.code === 'BUSY' ? 409 : 400;
                return res.status(status).json({ status, message: result.message, code: result.code });
            }
            return res.json({
                status: 200,
                message: `Berhasil generate ${result.created} voucher${result.failed ? `, ${result.failed} gagal` : ''}`,
                data: result
            });
        } catch (error) {
            log.error('[VOUCHER_PRINT_GENERATE_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal generate voucher batch', error: error.message });
        }
    });

    // Susun argumen render dari body (dipakai render HTML, PDF, dan kirim WA).
    function renderInputFromBody(body = {}) {
        return {
            layoutId: body.layoutId,
            vouchers: body.vouchers || [],
            thermal: Boolean(body.thermal),
            title: body.title,
            pageSize: body.pageSize,
            columns: body.columns,
            rows: body.rows
        };
    }

    router.post('/voucher/print/render', requireStaff, async (req, res) => {
        try {
            const result = await voucherPrintService.renderPrint(renderInputFromBody(req.body || {}));
            res.set('Content-Type', 'text/html; charset=utf-8');
            return res.send(result.html);
        } catch (error) {
            log.error('[VOUCHER_PRINT_RENDER_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal render cetak', error: error.message });
        }
    });

    // Render lembar -> PDF (unduh). Gated config.voucherPrint.enabled (butuh Chromium di server).
    router.post('/voucher/print/pdf', requireStaff, async (req, res) => {
        try {
            const cfg = getConfig() || {};
            if (!cfg.voucherPrint || cfg.voucherPrint.enabled !== true) {
                return res.status(403).json({ status: 403, message: 'Cetak PDF server nonaktif (config.voucherPrint.enabled=false).' });
            }
            const result = await voucherPrintService.renderPdf(renderInputFromBody(req.body || {}));
            if (!result.ok) {
                const httpMap = { PDF_FAILED: 502, BUSY: 409, PDF_ENGINE_MISSING: 503, RENDER_FAILED: 502 };
                const code = httpMap[result.code] || 400;
                return res.status(code).json({ status: code, message: result.message || 'Gagal render PDF', code: result.code });
            }
            res.set('Content-Type', 'application/pdf');
            res.set('Content-Disposition', `attachment; filename="voucher-${result.count}pcs.pdf"`);
            return res.send(result.buffer);
        } catch (error) {
            log.error('[VOUCHER_PRINT_PDF_ROUTE_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal render PDF', error: error.message });
        }
    });

    // Render lembar -> PDF -> kirim ke WhatsApp owner/admin (Opsi A). Gated config.voucherPrint.sendWhatsApp.
    // Penerima default = getAdminJids; staff boleh override lewat body.phone/phones. Service TAK melempar.
    router.post('/voucher/print/send-wa', requireStaff, async (req, res) => {
        try {
            const input = renderInputFromBody(req.body || {});
            input.phone = req.body ? req.body.phone : undefined;
            input.phones = req.body ? req.body.phones : undefined;
            const result = await voucherPrintService.renderPdfAndSend(input);
            if (result.ok) {
                return res.json({
                    status: 200,
                    message: `Voucher terkirim ke ${result.recipients.length} penerima (${result.fileName})`,
                    data: result
                });
            }
            // Pemetaan sebab -> HTTP: gate mati=403, tak ada penerima=422, WA/PDF gagal=502, lainnya=400.
            const map = { DISABLED: 403, WA_DISABLED: 403, NO_RECIPIENTS: 422, WA_ENGINE_MISSING: 503, PDF_FAILED: 502, RENDER_FAILED: 502, PDF_ENGINE_MISSING: 503, BUSY: 409, SEND_FAILED: 502, WHATSAPP_NOT_CONNECTED: 503 };
            const code = map[result.code] || 400;
            return res.status(code).json({ status: code, message: result.message || `Gagal kirim voucher (${result.code})`, code: result.code, warning: result.warning });
        } catch (error) {
            log.error('[VOUCHER_PRINT_SEND_WA_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal kirim voucher ke WhatsApp', error: error.message });
        }
    });

    // Riwayat batch tercetak (untuk cetak-ulang/kirim-ulang TANPA provision user MikroTik lagi).
    router.get('/voucher/print/batches', requireStaff, (req, res) => {
        try {
            return res.json({ status: 200, data: voucherPrintService.listBatches() });
        } catch (error) {
            log.error('[VOUCHER_PRINT_BATCHES_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal memuat riwayat batch', error: error.message });
        }
    });

    router.get('/voucher/print/batches/:id', requireStaff, (req, res) => {
        try {
            const batch = voucherPrintService.getBatch(req.params.id);
            if (!batch) {
                return res.status(404).json({ status: 404, message: 'Batch tidak ditemukan (mungkin sudah terhapus oleh pemangkasan riwayat).' });
            }
            return res.json({ status: 200, data: batch });
        } catch (error) {
            log.error('[VOUCHER_PRINT_BATCH_GET_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal memuat batch', error: error.message });
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
            log.error('[VOUCHER_PRINT_REPORT_ERROR]', error);
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
            log.error('[VOUCHER_PRINT_ACTIVATIONS_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal memuat aktivasi', error: error.message });
        }
    });

    return router;
}

module.exports = createApiVoucherRouter;
