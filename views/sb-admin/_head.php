<?php
/**
 * Header Doc
 * - Purpose: Partial <head> bersama (boilerplate) untuk halaman admin & teknisi —
 *   meta dasar, font, FontAwesome, sb-admin-2, tema per-peran, dashboard-modern,
 *   dan components-modern (lapisan komponen bersama, dimuat paling akhir 2 peran).
 *   Satu tempat untuk mengubah aset global (font/meta/CSS dasar) lintas semua halaman.
 *   CSS ekstra per-halaman (DataTables/Leaflet/Select2 dll) & <style> inline TETAP
 *   ditulis di halaman masing-masing SETELAH include ini (verbatim, agar atribut
 *   integrity/crossorigin tidak hilang dan urutan cascade halaman terjaga).
 * - Caller: <head> tiap halaman, mis:
 *     <head>
 *     <?php $pageTitle = 'Judul'; $themeRole = 'admin'; include __DIR__ . '/_head.php'; ?>
 *       <!-- CSS ekstra + <style> khusus halaman -->
 *     </head>
 * - Vars (set sebelum include):
 *     $pageTitle       string  wajib  — judul tab.
 *     $themeRole       string  opsional ('admin'|'teknisi', default 'admin') — pilih tema + urutan.
 *     $pageDescription string  opsional — isi <meta name="description"> (di-escape).
 *     $fontHref        string  opsional — override URL Google Font (default Inter).
 * - Deps: _asset.php → rafAssetUrl($publicPath) untuk cache-bust ?v=<mtime> aset
 *   CSS lokal (URL berubah hanya saat file berubah; revalidasi 304 tetap efektif).
 * - SideEffects: echo markup bagian dalam <head> (TANPA tag <head> pembungkus).
 */
$pageTitle = isset($pageTitle) ? $pageTitle : 'RAF BOT';
$themeRole = (isset($themeRole) && $themeRole === 'teknisi') ? 'teknisi' : 'admin';
$pageDescription = isset($pageDescription) ? $pageDescription : '';
$fontHref = isset($fontHref) ? $fontHref : 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';

// Helper cache-bust aset lokal (rafAssetUrl) dipisah ke _asset.php agar halaman
// <head> manual yang belum memakai _head.php pun bisa ikut memakainya. require_once
// aman dipanggil berulang (fungsi guarded function_exists di dalam _asset.php).
require_once __DIR__ . '/_asset.php';
?>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <meta name="author" content="RAF BOT">
<?php if ($pageDescription !== '') : ?>
    <meta name="description" content="<?= htmlspecialchars($pageDescription, ENT_QUOTES) ?>">
<?php endif; ?>
    <title><?= htmlspecialchars($pageTitle, ENT_QUOTES) ?></title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="<?= $fontHref ?>" rel="stylesheet">
    <link href="<?= rafAssetUrl('/css/sb-admin-2.min.css') ?>" rel="stylesheet">
<?php if ($themeRole === 'teknisi') : ?>
    <link href="<?= rafAssetUrl('/css/dashboard-modern.css') ?>" rel="stylesheet">
    <link href="<?= rafAssetUrl('/css/teknisi-theme.css') ?>" rel="stylesheet">
<?php else : ?>
    <link href="<?= rafAssetUrl('/css/admin-theme.css') ?>" rel="stylesheet">
    <link href="<?= rafAssetUrl('/css/dashboard-modern.css') ?>" rel="stylesheet">
<?php endif; ?>
    <!-- Lapisan komponen bersama (Tahap 2 redesign) — dimuat PALING AKHIR di kedua peran -->
    <link href="<?= rafAssetUrl('/css/components-modern.css') ?>" rel="stylesheet">
    <!-- Pola "tabel ditumpuk jadi kartu di layar HP" (#b291). INERT kecuali <table>
         diberi kelas `tabel-tumpuk-hp`, jadi aman dimuat semua halaman. Dipakai halaman
         staf yang tabelnya lebih lebar dari layar HP — teknisi memakainya di lapangan. -->
    <link href="<?= rafAssetUrl('/css/tabel-hp.css') ?>" rel="stylesheet">

    <!-- Helper escaping bersama (rafEscapeHtml/rafEscapeJsString/rafText). Sengaja di <head>
         TANPA defer: skrip halaman boleh memanggilnya saat render pertama, dan berkasnya
         kecil serta tanpa dependensi. Menggantikan salinan `escapeHtml` berbasis
         textContent yang tersebar di belasan berkas — pola itu meloloskan " dan ',
         sehingga nama ber-apostrof (Ma'ruf, Nur'aini) memutus handler inline. -->
    <script src="<?= rafAssetUrl('/js/html-escape.js') ?>"></script>

    <!-- Bahasa Indonesia bersama untuk SEMUA tabel DataTables (#b294). Sengaja di <head>
         TANPA defer: listener DOMContentLoaded-nya harus terdaftar SEBELUM jQuery dimuat,
         supaya berjalan lebih dulu daripada $(document).ready() milik skrip halaman yang
         menginisialisasi tabelnya. Terjemahannya di-host sendiri sebagai objek JS — versi
         lama mem-fetch //cdn.datatables.net yang TIDAK ADA di CSP, jadi gagal senyap dan
         tabelnya diam-diam berbahasa Inggris. -->
    <script src="<?= rafAssetUrl('/js/datatables-bahasa.js') ?>"></script>
