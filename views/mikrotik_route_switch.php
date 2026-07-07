<?php
/**
 * Header Doc
 * Purpose: Bridge switch koneksi WAN — enable/disable route default (0.0.0.0/0) untuk mengalihkan
 *          trafik antar-ISP secara instan. Mode `status`/`plan` (read-only: cocokkan operasi ke
 *          route + lapor kondisi sekarang) dan `apply` (tulis: set flag disabled per route yang
 *          cocok, kembalikan before/after). Operasi dikirim Node dari allowlist config (bukan
 *          kriteria bebas dari user) — bridge hanya eksekutor.
 * Caller: `lib/wan-switch-service.js` (spawn php CLI).
 * Deps: `views/routeros_api.class.php`, `views/mikrotik_helper.php`. Kredensial via env
 *       MTIN_UPQ_HOST/PORT/USER/PASS; operasi via argv[1] JSON { mode, ops:[{match,disabled}] }.
 *       match: { table:'main'|null, routingMark, gateway, comment, distance } (semua opsional; AND).
 * MainFuncs: alur prosedural + `rsw_match`.
 * SideEffects: Koneksi API RouterOS; mode apply menulis `/ip/route/set disabled=`. NEVER hapus route.
 */

require __DIR__ . '/routeros_api.class.php';
require __DIR__ . '/mikrotik_helper.php';

$startedAt = mikrotik_operation_start();
$OP = 'wanRouteSwitch';

$spec = json_decode(isset($argv[1]) ? $argv[1] : '{}', true);
if (!is_array($spec)) $spec = array();
$mode = isset($spec['mode']) ? $spec['mode'] : 'status';
$ops = (isset($spec['ops']) && is_array($spec['ops'])) ? $spec['ops'] : array();

$host = mikrotik_read_input('UPQ_HOST', null, false, null);
$port = (int) mikrotik_read_input('UPQ_PORT', null, false, '8728');
$user = mikrotik_read_input('UPQ_USER', null, false, null);
$pass = mikrotik_read_input('UPQ_PASS', null, false, null);
if (!$host || !$user || $pass === null || $pass === false) {
    mikrotik_fail($OP, 'Kredensial router tidak lengkap (MTIN_UPQ_*).', 'CONFIG_ERROR', $startedAt);
}
if (!count($ops)) {
    mikrotik_fail($OP, 'Operasi kosong.', 'SPEC_ERROR', $startedAt);
}

$GLOBALS['MIKROTIK_CONFIG'] = array('host' => $host);
$API = new RouterosAPI();
$GLOBALS['API'] = $API;
$API->attempts = 1;
$API->timeout = 12;
$API->port = $port;
if (!$API->connect($host, $user, $pass)) {
    mikrotik_fail($OP, "Gagal konek API router $host:$port.", 'CONNECT_ERROR', $startedAt);
}

// Cocokkan satu route ke kriteria match (semua field yang diisi harus cocok / AND).
function rsw_match($route, $match) {
    if (isset($match['table'])) {
        $hasMark = isset($route['routing-mark']) && $route['routing-mark'] !== '';
        if ($match['table'] === 'main' && $hasMark) return false;
        if ($match['table'] !== 'main' && (!$hasMark || $route['routing-mark'] !== $match['table'])) return false;
    }
    if (isset($match['routingMark'])) {
        $rm = isset($route['routing-mark']) ? $route['routing-mark'] : '';
        if ($rm !== $match['routingMark']) return false;
    }
    if (isset($match['gateway'])) {
        $gw = isset($route['gateway']) ? $route['gateway'] : '';
        if ($gw !== $match['gateway']) return false;
    }
    if (isset($match['comment'])) {
        $cm = isset($route['comment']) ? $route['comment'] : '';
        if ($cm !== $match['comment']) return false;
    }
    if (isset($match['distance'])) {
        $ds = isset($route['distance']) ? (int) $route['distance'] : null;
        if ($ds !== (int) $match['distance']) return false;
    }
    return true;
}

// Ambil semua default route sekali.
$routes = $API->comm('/ip/route/print', array(
    '?dst-address' => '0.0.0.0/0',
    '.proplist' => '.id,gateway,gateway-status,distance,active,disabled,routing-mark,comment'
));
$allRoutes = array();
if (is_array($routes)) {
    foreach ($routes as $k => $r) {
        if ($k === '!trap' || !is_array($r)) continue;
        $allRoutes[] = $r;
    }
}

function rsw_route_view($r) {
    return array(
        'id' => isset($r['.id']) ? $r['.id'] : null,
        'gateway' => isset($r['gateway']) ? $r['gateway'] : null,
        'routing_mark' => isset($r['routing-mark']) ? $r['routing-mark'] : 'main',
        'distance' => isset($r['distance']) ? (int) $r['distance'] : null,
        'active' => isset($r['active']) && $r['active'] === 'true' ? 1 : 0,
        'disabled' => isset($r['disabled']) && $r['disabled'] === 'true' ? 1 : 0,
        'comment' => isset($r['comment']) ? $r['comment'] : null
    );
}

// Resolusi tiap operasi → route yang cocok + target disabled.
$plan = array();
foreach ($ops as $op) {
    if (!isset($op['match']) || !is_array($op['match'])) continue;
    $desiredDisabled = isset($op['disabled']) ? (bool) $op['disabled'] : false;
    $matched = array();
    foreach ($allRoutes as $r) {
        if (rsw_match($r, $op['match'])) $matched[] = $r;
    }
    $plan[] = array('match' => $op['match'], 'desired_disabled' => $desiredDisabled ? 1 : 0, 'routes' => $matched);
}

if ($mode === 'status' || $mode === 'plan') {
    $out = array();
    foreach ($plan as $p) {
        $out[] = array(
            'match' => $p['match'],
            'desired_disabled' => $p['desired_disabled'],
            'matched' => array_map('rsw_route_view', $p['routes']),
            'matched_count' => count($p['routes'])
        );
    }
    mikrotik_success($OP, 'Rencana switch dihitung.', array('mode' => $mode, 'operations' => $out), $startedAt);
}

if ($mode === 'apply') {
    $applied = array();
    foreach ($plan as $p) {
        foreach ($p['routes'] as $r) {
            $before = rsw_route_view($r);
            $val = $p['desired_disabled'] ? 'yes' : 'no';
            $set = $API->comm('/ip/route/set', array('.id' => $r['.id'], 'disabled' => $val));
            $err = null;
            if (isset($set['!trap'])) {
                $t = is_array($set['!trap']) ? reset($set['!trap']) : $set['!trap'];
                $err = is_array($t) && isset($t['message']) ? $t['message'] : json_encode($t);
            }
            $applied[] = array('before' => $before, 'set_disabled' => $p['desired_disabled'], 'error' => $err);
        }
    }
    // Baca ulang kondisi setelah set (verifikasi + laporan active/inactive baru).
    $after = $API->comm('/ip/route/print', array(
        '?dst-address' => '0.0.0.0/0',
        '.proplist' => '.id,gateway,distance,active,disabled,routing-mark,comment'
    ));
    $afterRows = array();
    if (is_array($after)) {
        foreach ($after as $k => $r) {
            if ($k === '!trap' || !is_array($r)) continue;
            $afterRows[] = rsw_route_view($r);
        }
    }
    mikrotik_success($OP, 'Switch diterapkan.', array('mode' => 'apply', 'applied' => $applied, 'routes_after' => $afterRows), $startedAt);
}

mikrotik_fail($OP, "Mode tidak dikenal: $mode", 'SPEC_ERROR', $startedAt);
