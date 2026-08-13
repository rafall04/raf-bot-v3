/**
 * Header Doc
 * Purpose: Router halaman PHP/SB Admin dengan guard role eksplisit sebelum fallback file PHP.
 * Caller: `lib/routes-registry.js`.
 * Deps: Express, filesystem view lookup, middleware role lokal, dan
 *       `lib/http-error-page` untuk layar 403 ber-tema.
 * MainFuncs: `checkRole` dan route render halaman admin/teknisi.
 * SideEffects: Merender view PHP atau mengembalikan halaman 404/403.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { sendErrorPage } = require('../lib/http-error-page');

const router = express.Router();

// Middleware to check user role
function checkRole(allowedRoles) {
    return (req, res, next) => {
        // Debug logging
        console.log(`[CHECK_ROLE] Path: ${req.path}, User: ${req.user ? req.user.username : 'null'}, Role: ${req.user ? req.user.role : 'null'}, Allowed: ${allowedRoles.join(', ')}`);
        
        // Penolakan akses dulu dibalas res.send() teks polos — tanpa tema, tanpa judul,
        // tanpa jalan kembali. Sekarang memakai halaman error ber-tema (sadar mode gelap).
        if (!req.user) {
            console.log(`[CHECK_ROLE] No req.user found. Token: ${req.cookies?.token ? 'exists' : 'missing'}`);
            // If no user but has token, might be expired or invalid
            if (req.cookies?.token || req.headers?.authorization) {
                return sendErrorPage(res, {
                    status: 403,
                    title: 'Sesi kamu sudah berakhir',
                    message: 'Token login tidak valid atau sudah kedaluwarsa. Silakan masuk ulang untuk melanjutkan.',
                    backHref: '/login',
                    backLabel: 'Masuk Ulang',
                });
            }
            return sendErrorPage(res, {
                status: 403,
                title: 'Perlu masuk dulu',
                message: 'Halaman ini hanya bisa dibuka setelah kamu masuk ke panel.',
                backHref: '/login',
                backLabel: 'Halaman Masuk',
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            console.log(`[CHECK_ROLE] Role mismatch. User role: ${req.user.role}, Required: ${allowedRoles.join(', ')}`);
            if (req.user.role === 'teknisi') {
                return sendErrorPage(res, {
                    status: 403,
                    title: 'Halaman khusus Administrator',
                    message: 'Akun teknisi tidak punya akses ke halaman ini. Kembali ke panel teknisi untuk melanjutkan pekerjaan.',
                    backHref: '/pembayaran/teknisi',
                    backLabel: 'Panel Teknisi',
                });
            }
            return sendErrorPage(res, {
                status: 403,
                title: 'Akses tidak diizinkan',
                message: `Peran akun kamu (${req.user.role}) tidak memiliki akses ke halaman ini.`,
                backHref: '/',
                backLabel: 'Kembali ke Beranda',
            });
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
// Panduan admin — rujukan lengkap dari nol sampai operasional harian. Sengaja TIDAK dibuka untuk
// teknisi/agen: isinya menyeluruh (akun, keuangan, konfigurasi sistem), sedangkan mereka sudah
// punya halaman sendiri (`/teknisi-tutorial`, `/agen-tutorial`).
router.get('/admin-tutorial', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/admin-tutorial.php');
});

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

// Konfirmasi Bayar: verifikasi bukti pembayaran yang dikirim pelanggan via WhatsApp.
router.get('/konfirmasi-bayar', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/konfirmasi-bayar.php');
});

// Gratis Bulan Ini: bebaskan tagihan (waiver) untuk pelanggan baru — lunas tanpa masuk pemasukan.
router.get('/gratis-bulan-ini', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/gratis-bulan-ini.php');
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
    // View admin = tiket.php ("Ticket Management"). Dulu render 'admin-daftar-tiket.php' yang
    // TIDAK ADA → 500 ("Failed to lookup view") — kena navbar "Tiket Support Admin" & Owner Cockpit.
    res.render('sb-admin/tiket.php');
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

// Aset jaringan (ODC/ODP) + peta admin. DULU tak punya route eksplisit → jatuh ke handler generik
// `/:type([^.]+)` di bawah yang TANPA checkRole, jadi teknisi, agen, bahkan PELANGGAN yang login pun
// bisa merender halaman aset admin. Kini digate eksplisit (data-nya memang sudah ter-gate, tapi
// halaman internal tak boleh terbuka begitu saja).
// Teknisi MELIHAT lewat /teknisi-map-viewer dan MEMETAKAN lewat WhatsApp (#ODC / #ODP).
router.get('/network-assets', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/network-assets.php');
});

router.get('/map-viewer', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/map-viewer.php');
});

// Sambungkan pelanggan LAMA (yang sudah punya GPS) ke ODP: bot mengusulkan yang terdekat, admin
// memutuskan. Tak ada penetapan otomatis — jarak garis lurus itu tebakan, bukan kebenaran.
router.get('/rapikan-odp', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/rapikan-odp.php');
});

// Web PSB 3-fase legacy (teknisi-psb / -installation / -setup) + Rekap PSB lama DIPENSIUNKAN (S3):
// jalur utama sekarang = Papan PSB (/papan-psb) + wizard WA #PSB. Redirect ke papan supaya bookmark
// lama tetap mendarat di board terpadu (bukan 404). Endpoint tulis 3-fase di-410 di api-psb-routes.
router.get(['/teknisi-psb', '/teknisi-psb-installation', '/teknisi-psb-setup', '/psb-rekap'], checkRole(['teknisi', 'admin', 'owner', 'superadmin']), (req, res) => {
    res.redirect('/papan-psb');
});

// Papan PSB - daftar PSB (belum kepasang) via web; paritas dgn WA #jadwal. Staf (teknisi+admin) boleh daftar.
router.get('/papan-psb', checkRole(['teknisi', 'admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/papan-psb.php');
});

// Admin Kasbon page - ADMIN ONLY
router.get('/admin-kasbon', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/admin-kasbon.php');
});

// Admin Diskon page - ADMIN ONLY
router.get('/admin-diskon', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/admin-diskon.php');
});

// Owner Cockpit - beranda ringkasan sekali-baca owner (income/ISP/tiket/PSB/outage). Admin/owner.
router.get('/owner', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/owner-cockpit.php');
});

// Keuangan Pribadi - dompet PRIBADI pemilik yang menumpang instance ini.
// Otentikasinya BERDIRI SENDIRI (lib/personal-finance-auth): kredensial + rahasia sesi
// terpisah, cookie `pf_session`. Sesi admin TIDAK cukup untuk masuk ke sini — itu memang
// tujuannya: browser admin yang tertinggal terbuka tak boleh ikut membuka dompet.
// WAJIB terdaftar SEBELUM handler generik '/:type' di bawah — handler itu merender
// views/sb-admin/<type>.php TANPA cek role sama sekali. Halaman ini pun tidak menyisipkan
// data dari server: seluruh angka diambil via API yang punya penjaga sesi sendiri (berlapis).
// `no-store` pada KEDUA halaman dompet, dan itu bukan sekadar kerapian:
//  1) Tanpa itu browser menyimpan halaman login di bfcache, sehingga menekan tombol
//     BACK memunculkan form login lagi padahal sesinya masih hidup — persis keluhan
//     "keluar dari browser malah kembali ke halaman login".
//  2) Halaman dompet memuat angka keuangan pribadi; tak boleh mengendap di cache
//     browser atau perantara mana pun.
function noStore(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
}

router.get('/keuangan-pribadi/login', (req, res) => {
    const cfg = (global.config && global.config.personalFinance) || {};
    if (cfg.enabled !== true) return res.status(404).render('sb-admin/404.php');

    noStore(res);
    const pfAuth = require('../lib/personal-finance-auth');
    // Sudah punya sesi sah → tak perlu form login lagi.
    if (pfAuth.resolveSession(req)) return res.redirect('/keuangan-pribadi');
    return res.render('sb-admin/keuangan-pribadi-login.php');
});

// Dompet dipecah per fungsi (dulu satu halaman panjang yang menumpuk semuanya). Semua
// berbagi gerbang yang sama; hanya berkas view-nya berbeda.
const KP_HALAMAN = {
    '': 'keuangan-pribadi.php',                       // Ringkasan
    catatan: 'keuangan-pribadi-catatan.php',
    anggaran: 'keuangan-pribadi-anggaran.php',
    panduan: 'keuangan-pribadi-panduan.php',
    pengaturan: 'keuangan-pribadi-pengaturan.php'
};

function renderKeuanganPribadi(req, res, slug) {
    const cfg = (global.config && global.config.personalFinance) || {};
    // 404, BUKAN 403 — disengaja. "Akses ditolak" memberi tahu orang lain bahwa ada halaman
    // keuangan pribadi di sini; 404 tidak membocorkan apa pun.
    if (cfg.enabled !== true) return res.status(404).render('sb-admin/404.php');

    const view = KP_HALAMAN[slug];
    if (!view) return res.status(404).render('sb-admin/404.php');

    noStore(res);
    const pfAuth = require('../lib/personal-finance-auth');
    if (!pfAuth.resolveSession(req)) return res.redirect('/keuangan-pribadi/login');
    return res.render(`sb-admin/${view}`);
}

router.get('/keuangan-pribadi', (req, res) => renderKeuanganPribadi(req, res, ''));
router.get('/keuangan-pribadi/:slug', (req, res) => renderKeuanganPribadi(req, res, String(req.params.slug || '')));

// Survei Kepuasan (CSAT) - rangkuman rating pelanggan (skor/detractor/komentar/tren). Admin/owner.
router.get('/survei', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/survei.php');
});

// Rekap Keuangan page - ADMIN ONLY
router.get('/rekap-keuangan', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/rekap-keuangan.php');
});

// Pengeluaran page - ADMIN ONLY
// Kas Usaha — setelan grup WA kas + biaya rutin. Angkanya mendarat di expense_entries
// yang sama dengan /pengeluaran, jadi halaman ini tidak punya pembukuan sendiri.
router.get('/kas-usaha', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/kas-usaha.php');
});

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

// Laporan Marketing PSB (komisi pemberi lead) page - ADMIN ONLY
router.get('/laporan-marketing-psb', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/laporan-marketing-psb.php');
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
// On/off via config.voucherSalesDashboard.enabled (default AKTIF); hanya mati bila
// eksplisit { enabled: false }.
//
// Dulu gerbangnya memakai cek TRUTHY (`&& cfg.enabled`), sehingga kunci yang TIDAK
// ADA di config.json = MATI — padahal komentar di sini dan config.example.json
// sama-sama menyatakan default true. Produksi tak pernah punya kunci itu (config.json
// prod adalah merge-key, tidak pernah ditimpa), jadi halaman ini 404 di KEDUA bot
// tanpa ada yang pernah memutuskan mematikannya. Pola `!== false` di bawah sama
// dengan gerbang default-aktif lain di repo ini (mis. networkAssets.waIntake di
// message/raf.js, messageLogging di repositories/message-log.repository.js) dan
// tahan terhadap instalasi yang belum memerge kunci baru.
router.get('/voucher-sales', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    const cfg = (global.config && global.config.voucherSalesDashboard) || {};
    if (cfg.enabled === false) {
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
