/**
 * Header Doc
 * Purpose: Router halaman PHP/SB Admin dengan guard role eksplisit sebelum fallback file PHP.
 * Caller: `lib/routes-registry.js`.
 * Deps: Express, filesystem view lookup, dan middleware role lokal.
 * MainFuncs: `checkRole` dan route render halaman admin/teknisi.
 * SideEffects: Merender view PHP atau mengembalikan halaman 404/403.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Middleware to check user role
function checkRole(allowedRoles) {
    return (req, res, next) => {
        // Debug logging
        console.log(`[CHECK_ROLE] Path: ${req.path}, User: ${req.user ? req.user.username : 'null'}, Role: ${req.user ? req.user.role : 'null'}, Allowed: ${allowedRoles.join(', ')}`);
        
        if (!req.user) {
            console.log(`[CHECK_ROLE] No req.user found. Token: ${req.cookies?.token ? 'exists' : 'missing'}`);
            // If no user but has token, might be expired or invalid
            if (req.cookies?.token || req.headers?.authorization) {
                return res.status(403).send("Akses ditolak. Token tidak valid atau expired. Silakan login ulang.");
            }
            return res.status(403).send("Akses ditolak. Silakan login terlebih dahulu.");
        }
        
        if (!allowedRoles.includes(req.user.role)) {
            console.log(`[CHECK_ROLE] Role mismatch. User role: ${req.user.role}, Required: ${allowedRoles.join(', ')}`);
            if (req.user.role === 'teknisi') {
                return res.status(403).send("Akses ditolak. Halaman ini khusus Administrator.");
            }
            return res.status(403).send(`Akses ditolak. Role Anda (${req.user.role}) tidak memiliki akses ke halaman ini.`);
        }
        
        next();
    };
}

// Public pages (no auth required)
router.get('/login', (req, res) => {
    res.render('sb-admin/login.php');
});

// Landing utama — ROLE-AWARE (auto-forward). Admin/owner/superadmin lihat dashboard;
// role lain diarahkan ke halaman utamanya (samakan dengan redirect pasca-login di
// routes/public.js). Tamu tanpa token TIDAK pernah sampai sini — sudah di-redirect ke
// /login oleh middleware auth (lib/http-auth-bootstrap.js).
// Dulu di-hard-gate `checkRole` admin-only sehingga sesi teknisi yang membuka domain
// dapat 403 "khusus Administrator" (dan sesi pelanggan dapat 403 "token tidak valid"
// yang menyesatkan) alih-alih diarahkan otomatis.
router.get('/', (req, res) => {
    const role = req.user && req.user.role;
    if (role === 'admin' || role === 'owner' || role === 'superadmin') {
        return res.render('sb-admin/index.php');
    }
    if (role === 'teknisi') {
        return res.redirect('/pembayaran/teknisi');
    }
    if (role === 'agen') {
        return res.redirect('/agen-pembayaran');
    }
    // Sesi pelanggan (req.customer, tanpa req.user) atau peran tak dikenal → kembalikan ke login.
    return res.redirect('/login');
});

// Admin-only pages
router.get('/kompensasi', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/kompensasi.php');
});

router.get('/migrate', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/migrate.php');
});

router.get('/wifi-logs', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/wifi-logs.php');
});

router.get('/telegram-teknisi', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/telegram-teknisi.php');
});

router.get('/login-logs', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    console.log(`[ROUTE_HANDLER] /login-logs: Route handler called. User: ${req.user ? req.user.username : 'null'}, Role: ${req.user ? req.user.role : 'null'}`);
    res.render('sb-admin/login-logs.php');
});

router.get('/activity-logs', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/activity-logs.php');
});

router.get('/speed-boost-config', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/speed-boost-config.php');
});

router.get('/speed-requests', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/speed-requests.php');
});

router.get('/auto-outage', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/auto-outage.php');
});

router.get('/admin-olt', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/admin-olt.php');
});

// Provisioning OLT ZTE: registrasi ONU via SSH, tipe modem, backup konfigurasi.
router.get('/admin-olt-provision', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/admin-olt-provision.php');
});

router.get('/los-broadcast', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/los-broadcast.php');
});

// Log Gangguan OLT: riwayat kejadian OLT (LOS/DG/pulih) ter-enrich pelanggan + durasi.
router.get('/olt-log', checkRole(['admin', 'owner', 'superadmin', 'teknisi']), (req, res) => {
    res.render('sb-admin/olt-log.php');
});

// Versi TEKNISI (sidebar/tema teknisi) — konten sama via _olt-log-content.php.
router.get('/teknisi-olt-log', checkRole(['teknisi', 'admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/teknisi-olt-log.php');
});

// Kualitas Jalur Upstream: status & grafik loss/RTT per jalur (GMDP/IH/MNI/SF) + failover.
router.get('/upstream-quality', checkRole(['admin', 'owner', 'superadmin', 'teknisi']), (req, res) => {
    res.render('sb-admin/upstream-quality.php');
});

// Steering Pelanggan: pelanggan terkoneksi via ISP mana (live) + arahkan per-pelanggan/pool.
router.get('/steering-pelanggan', checkRole(['admin', 'owner', 'superadmin', 'teknisi']), (req, res) => {
    res.render('sb-admin/steering-pelanggan.php');
});

// Broadcast Tagihan: kirim pesan pembayaran (link bayar mandiri) ke pelanggan terpilih.
router.get('/broadcast-tagihan', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/broadcast-tagihan.php');
});

router.get('/cctv-monitor', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/cctv-monitor.php');
});

// Monitor modem infrastruktur (account_type='infrastruktur', mis. modem CCTV/monitoring):
// status OLT/redaman per modem, dipisah dari Data Pelanggan.
router.get('/infra-monitor', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/infra-monitor.php');
});

router.get('/agent-management', (req, res) => {
    res.render('sb-admin/agent-management.php');
});

router.get('/admin/daftar-tiket', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/admin-daftar-tiket.php');
});

// Teknisi pages - PROTECTED
router.get('/pembayaran/teknisi', checkRole(['teknisi', 'admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/pembayaran/teknisi.php');
});

router.get('/teknisi-tutorial', checkRole(['teknisi', 'admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/teknisi-tutorial.php');
});

router.get('/teknisi-tiket', checkRole(['teknisi', 'admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/teknisi-tiket.php');
});

router.get('/teknisi-pelanggan', checkRole(['teknisi', 'admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/teknisi-pelanggan.php');
});

router.get('/teknisi-pembayaran', checkRole(['teknisi', 'admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/teknisi-pembayaran.php');
});

// Halaman Agen - penagihan pembayaran pelanggan yang ditugaskan (agen + admin)
router.get('/agen-pembayaran', checkRole(['agen', 'admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/agen-pembayaran.php');
});

router.get('/agen-tutorial', checkRole(['agen', 'admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/agen-tutorial.php');
});

router.get('/teknisi-kasbon', checkRole(['teknisi', 'admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/teknisi-kasbon.php');
});

router.get('/admin/teknisi-request-paket', checkRole(['admin', 'owner', 'superadmin', 'teknisi']), (req, res) => {
    res.render('sb-admin/teknisi-request-paket.php');
});

router.get('/teknisi-map-viewer', checkRole(['teknisi', 'admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/teknisi-map-viewer.php');
});

router.get('/teknisi-olt', checkRole(['teknisi', 'admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/teknisi-olt.php');
});

router.get('/teknisi-psb', checkRole(['teknisi', 'admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/teknisi-psb.php');
});

router.get('/teknisi-psb-installation', checkRole(['teknisi', 'admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/teknisi-psb-installation.php');
});

router.get('/teknisi-psb-setup', checkRole(['teknisi', 'admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/teknisi-psb-setup.php');
});

// PSB Rekap page - ADMIN ONLY
router.get('/psb-rekap', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/psb-rekap.php');
});

// Admin Kasbon page - ADMIN ONLY
router.get('/admin-kasbon', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/admin-kasbon.php');
});

// Admin Diskon page - ADMIN ONLY
router.get('/admin-diskon', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/admin-diskon.php');
});

// Rekap Keuangan page - ADMIN ONLY
router.get('/rekap-keuangan', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/rekap-keuangan.php');
});

// Pengeluaran page - ADMIN ONLY
router.get('/pengeluaran', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/pengeluaran.php');
});

// Gaji Teknisi page - ADMIN ONLY
router.get('/gaji-teknisi', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/gaji-teknisi.php');
});

// Penugasan Agen page (assign pelanggan ke agen) - ADMIN ONLY
router.get('/penugasan-agen', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/penugasan-agen.php');
});

// Laporan Komisi Agen page - ADMIN ONLY
router.get('/laporan-agen', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/laporan-agen.php');
});

// Rubah Paket Pelanggan page - ADMIN ONLY
router.get('/rubah-paket', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/rubah-paket.php');
});

// Import MikroTik page - ADMIN ONLY
router.get('/import-mikrotik', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/import-mikrotik.php');
});

// Voucher Send page - ADMIN ONLY
router.get('/voucher-send', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/voucher-send.php');
});

// Paket Voucher (katalog CRUD paket voucher) page - ADMIN ONLY
// Path SENGAJA '/paket-voucher', BUKAN '/voucher': path '/voucher' kini milik halaman
// BELI voucher publik anonim (routes/public-anonymous.js) yang di-mount lebih dulu di
// lib/routes-registry.js DAN masuk PUBLIC_PATHS (lib/http-auth-bootstrap.js) — sehingga
// route admin di '/voucher' terbayangi total (dead code). Katalog admin pindah ke path
// khusus ini agar tetap bisa diakses tanpa mengusik surface beli publik yang sudah LIVE.
// Route eksplisit + checkRole tetap wajib: tanpa ini halaman jatuh ke generic handler
// '/:type' yang TANPA guard role, sehingga staf non-admin bisa membuka (API tetap dijaga).
router.get('/paket-voucher', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/paket-voucher.php');
});

// Cetak Voucher (generate batch + layout + QR, lepas Mikhmon) - ADMIN ONLY
router.get('/voucher-print', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/voucher-print.php');
});

// Penjualan Voucher (dashboard statistik voucher online terjual) - ADMIN ONLY.
// On/off via config.voucherSalesDashboard.enabled (default true); bila OFF → 404.
router.get('/voucher-sales', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    if (!(global.config && global.config.voucherSalesDashboard && global.config.voucherSalesDashboard.enabled)) {
        return res.status(404).render('sb-admin/404.php');
    }
    res.render('sb-admin/voucher-sales.php');
});

// Stok Voucher Agent (dashboard reseller) page - ADMIN ONLY
router.get('/agent-voucher-management', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/agent-voucher-management.php');
});

// Buka Isolir page - ADMIN ONLY
router.get('/buka-isolir', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/buka-isolir.php');
});

// Custom Isolir page - ADMIN ONLY
router.get('/custom-isolir', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/custom-isolir.php');
});

// Sync Device ID page - ADMIN ONLY
router.get('/sync-device-id', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/sync-device-id.php');
});

// Penyesuaian Bulk SSID page - ADMIN ONLY
router.get('/penyesuaian-bulk', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/bulk-ssid-diff.php');
});

// Working Hours page
router.get('/teknisi-working-hours', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/teknisi-working-hours.php');
});

// Payment status page
router.get('/payment-status', (req, res) => {
    res.render('sb-admin/payment-status.php');
});

router.get('/rekap-tunggakan', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/rekap-tunggakan.php');
});

// View invoice page
router.get('/views/sb-admin/view-invoice.php', (req, res) => {
    res.render('sb-admin/view-invoice.php');
});

// Logout
router.get('/logout', async (req, res) => {
    // Log logout event before clearing token
    if (req.user) {
        try {
            const { logLogout } = require('../lib/activity-logger');
            const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
            const userAgent = req.headers['user-agent'] || 'unknown';
            
            await logLogout({
                userId: req.user.id,
                username: req.user.username,
                role: req.user.role,
                ipAddress,
                userAgent
            });
        } catch (err) {
            // Log error but don't fail logout
            console.error(`[AUTH_LOG] ❌ Failed to log logout: ${req.user?.username || 'unknown'} - ${err.message}`);
        }
    }
    
    res.cookie("token", "", { httpOnly: true, maxAge: 0, path: "/" });
    return res.redirect("/login");
});

// Generic page handler
router.get('/:type([^.]+)', (req, res) => {
    const { type } = req.params;
    const filePath = path.join(__dirname, '..', 'views', 'sb-admin', `${type}.php`);
    if (fs.existsSync(filePath)) {
        res.render(`sb-admin/${type}.php`);
    } else {
        res.status(404).render('sb-admin/404.php');
    }
});

module.exports = router;
