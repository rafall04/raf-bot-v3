<?php
/**
 * Header Doc
 * Purpose: Kerangka bersama SEMUA halaman dompet keuangan pribadi — <head>, header aplikasi,
 *          dan tab navigasi antar-halaman. Dompet ini BERDIRI SENDIRI (tak memuat sidebar/
 *          topbar admin) karena sesinya terpisah; kerangkanya karena itu juga milik sendiri,
 *          bukan `_head.php` milik panel admin.
 *          Sebelumnya seluruh fitur menumpuk di satu halaman panjang; sekarang tiap fungsi
 *          punya halamannya sendiri dan berbagi kerangka ini.
 * Caller: `views/sb-admin/keuangan-pribadi*.php`. Set `$kpPage` (slug tab aktif) dan
 *         `$kpTitle` sebelum include. Halaman menutup dengan `_kp-shell-end.php`.
 * Deps: `_asset.php` (rafAssetUrl), `static/css/keuangan-pribadi.css`,
 *       `static/js/keuangan-pribadi-theme.js` (anti-FOUC), `static/js/theme.js`.
 * SideEffects: echo markup pembuka (sampai <main> terbuka).
 */
require_once __DIR__ . '/_asset.php';
$kpPage  = isset($kpPage) ? $kpPage : 'ringkasan';
$kpTitle = isset($kpTitle) ? $kpTitle : 'Keuangan Pribadi';

$kpNav = [
    ['slug' => 'ringkasan',  'label' => 'Ringkasan',  'href' => '/keuangan-pribadi',            'ikon' => 'fa-chart-pie'],
    ['slug' => 'catatan',    'label' => 'Catatan',    'href' => '/keuangan-pribadi/catatan',    'ikon' => 'fa-list-ul'],
    ['slug' => 'anggaran',   'label' => 'Anggaran',   'href' => '/keuangan-pribadi/anggaran',   'ikon' => 'fa-bullseye'],
    ['slug' => 'panduan',    'label' => 'Panduan',    'href' => '/keuangan-pribadi/panduan',    'ikon' => 'fa-book-open'],
    ['slug' => 'pengaturan', 'label' => 'Pengaturan', 'href' => '/keuangan-pribadi/pengaturan', 'ikon' => 'fa-gear'],
];
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="robots" content="noindex, nofollow">
    <title><?= htmlspecialchars($kpTitle, ENT_QUOTES) ?></title>
    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="<?= rafAssetUrl('/css/tokens.css') ?>">
    <link rel="stylesheet" href="<?= rafAssetUrl('/css/keuangan-pribadi.css') ?>">
    <script src="<?= rafAssetUrl('/js/keuangan-pribadi-theme.js') ?>"></script>
</head>
<body class="kp">
  <header class="kp-head">
    <div class="kp-head__bar">
      <div class="kp-head__brand">
        <span class="kp-head__logo" aria-hidden="true"><i class="fas fa-wallet"></i></span>
        <span class="kp-head__teks">
          <strong>Keuangan Pribadi</strong>
          <small><?= htmlspecialchars($kpTitle, ENT_QUOTES) ?></small>
        </span>
      </div>
      <button type="button" id="tkThemeToggle" class="kp-ikon" title="Ganti mode terang/gelap" aria-label="Ganti mode terang/gelap">
        <i class="fas fa-moon"></i>
      </button>
    </div>

    <nav class="kp-tab" aria-label="Navigasi dompet">
      <?php foreach ($kpNav as $t): ?>
        <a class="kp-tab__item<?= $t['slug'] === $kpPage ? ' is-aktif' : '' ?>"
           href="<?= $t['href'] ?>"<?= $t['slug'] === $kpPage ? ' aria-current="page"' : '' ?>>
          <i class="fas <?= $t['ikon'] ?>" aria-hidden="true"></i><span><?= $t['label'] ?></span>
        </a>
      <?php endforeach; ?>
    </nav>
  </header>

  <main class="kp-main">
    <div id="kp-alert" class="kp-alert" role="status" hidden></div>
