<?php
/**
 * Header Doc
 * - Purpose: Helper cache-busting aset statik lokal bersama. rafAssetUrl() menempel
 *   ?v=<filemtime> ke URL aset lokal (/css, /js, /img, /vendor, /static) agar
 *   perubahan file (mis. patch dark mode di admin-theme.css) langsung dipakai
 *   browser/Cloudflare tanpa hard-refresh, namun URL tetap stabil saat file tak
 *   berubah sehingga revalidasi 304 tetap efektif (beda dari ?v=time() yang selalu
 *   cache-miss). Dipisah dari _head.php agar halaman <head> manual yang BELUM pakai
 *   _head.php pun bisa ikut memakainya.
 * - Caller: _head.php (require_once) + halaman <head> manual (index.php, map-viewer.php,
 *   accounts.php, saldo-management.php, tiket.php, dll). Include sekali sebelum <link>.
 * - MainFuncs: rafAssetUrl($publicPath)
 * - SideEffects: baca filemtime() file aset lokal; TIDAK mengeluarkan output.
 */
if (!function_exists('rafAssetUrl')) {
    function rafAssetUrl($publicPath) {
        // Semua mount statik (/static,/css,/js,/img,/vendor di lib/http-security.js)
        // berakar di folder static/. Prefix '/static' dipotong agar tak ganda saat
        // dipetakan ke path fisik. @ agar file hilang -> fallback tanpa query (bukan
        // warning yang merusak output PHP-CLI php-express).
        $relative = (strncmp($publicPath, '/static/', 8) === 0)
            ? substr($publicPath, 7)
            : $publicPath;
        $absolute = __DIR__ . '/../../static' . $relative;
        $mtime = @filemtime($absolute);
        return $mtime !== false ? $publicPath . '?v=' . $mtime : $publicPath;
    }
}
