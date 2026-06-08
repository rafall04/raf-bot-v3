<?php
/**
 * Header Doc
 * - Purpose: Partial <head> bersama (boilerplate) untuk halaman admin & teknisi —
 *   meta dasar, font, FontAwesome, sb-admin-2, tema per-peran, dashboard-modern.
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
 * - SideEffects: echo markup bagian dalam <head> (TANPA tag <head> pembungkus).
 */
$pageTitle = isset($pageTitle) ? $pageTitle : 'RAF BOT';
$themeRole = (isset($themeRole) && $themeRole === 'teknisi') ? 'teknisi' : 'admin';
$pageDescription = isset($pageDescription) ? $pageDescription : '';
$fontHref = isset($fontHref) ? $fontHref : 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
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
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
<?php if ($themeRole === 'teknisi') : ?>
    <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/css/teknisi-theme.css" rel="stylesheet">
<?php else : ?>
    <link href="/css/admin-theme.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
<?php endif; ?>
