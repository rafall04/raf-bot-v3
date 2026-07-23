<?php
/**
 * Header Doc
 * Purpose: Penutup kerangka halaman dompet — menutup <main> lalu memuat skrip bersama
 *          (`theme.js` untuk tombol mode gelap, `keuangan-pribadi-common.js` untuk helper
 *          fetch/format/periode). Skrip KHUSUS halaman dimuat lewat `$kpScript`.
 * Caller: `views/sb-admin/keuangan-pribadi*.php` sebagai include terakhir. Set `$kpScript`
 *         (nama berkas di /js) sebelum include bila halaman punya skrip sendiri.
 * Deps: `_asset.php` (rafAssetUrl), `static/js/theme.js`, `static/js/keuangan-pribadi-common.js`.
 * SideEffects: echo markup penutup.
 */
require_once __DIR__ . '/_asset.php';
?>
  </main>

  <script src="<?= rafAssetUrl('/js/theme.js') ?>"></script>
  <script src="<?= rafAssetUrl('/js/keuangan-pribadi-common.js') ?>"></script>
<?php if (!empty($kpScript)): ?>
  <script src="<?= rafAssetUrl('/js/' . $kpScript) ?>"></script>
<?php endif; ?>
</body>
</html>
