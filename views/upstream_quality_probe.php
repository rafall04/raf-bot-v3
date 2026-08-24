<?php
/**
 * Header Doc
 * Purpose: Bridge probe kualitas jalur upstream multi-ISP dari router gateway. Mode `probe`
 *          (default): ping policy-routed per routing-table ke target jauh + ping GATEWAY tiap
 *          WAN (pemisah segmen last-mile vs dalam-ISP) + counter interface WAN (byte/error/drop/
 *          link-downs utk utilisasi & flap) + monitor tunnel l2tp/sstp (uptime & remote) +
 *          snapshot route default. Mode `trace`: traceroute policy-routed satu putaran (bukti
 *          hop bermasalah utk komplain ke ISP). Read-only terhadap router.
 * Caller: `lib/upstream-quality-poller.js` (spawn php CLI per siklus / on-demand trace).
 * Deps: `views/routeros_api.class.php`, `views/mikrotik_helper.php`. Kredensial via env
 *       MTIN_UPQ_HOST/PORT/USER/PASS; spesifikasi non-rahasia via argv[1] JSON.
 * MainFuncs: alur prosedural + `upq_parse_ping`, `upq_uptime_to_seconds`, `upq_run_trace`.
 * SideEffects: Koneksi API RouterOS + ICMP keluar dari router; stdout JSON envelope mikrotik_helper.
 */

require __DIR__ . '/routeros_api.class.php';
require __DIR__ . '/mikrotik_helper.php';

$startedAt = mikrotik_operation_start();
$OP = 'upstreamQualityProbe';

$spec = json_decode(isset($argv[1]) ? $argv[1] : '{}', true);
if (!is_array($spec)) {
    $spec = array();
}
$mode = isset($spec['mode']) ? $spec['mode'] : 'probe';

$host = mikrotik_read_input('UPQ_HOST', null, false, null);
$port = (int) mikrotik_read_input('UPQ_PORT', null, false, '8728');
$user = mikrotik_read_input('UPQ_USER', null, false, null);
$pass = mikrotik_read_input('UPQ_PASS', null, false, null);

if (!$host || !$user || $pass === null || $pass === false) {
    mikrotik_fail($OP, 'Kredensial router probe tidak lengkap (MTIN_UPQ_HOST/USER/PASS).', 'CONFIG_ERROR', $startedAt);
}

$GLOBALS['MIKROTIK_CONFIG'] = array('host' => $host);

$connectTimeout = isset($spec['connectTimeoutSeconds']) ? max(3, min(30, (int) $spec['connectTimeoutSeconds'])) : 8;

$API = new RouterosAPI();
$GLOBALS['API'] = $API;
$API->attempts = 1;
$API->timeout = $connectTimeout;
$API->port = $port;

if (!$API->connect($host, $user, $pass)) {
    mikrotik_fail($OP, "Gagal konek API router $host:$port.", 'CONNECT_ERROR', $startedAt);
}

/** Parse balasan /ping v6 (baris kumulatif; timeout tanpa `time`). */
function upq_parse_ping($res, $sent) {
    $times = array();
    $received = null;
    $lossPct = null;
    $trap = null;

    if (isset($res['!trap'])) {
        $t = $res['!trap'];
        if (is_array($t)) {
            $first = reset($t);
            $trap = is_array($first) && isset($first['message']) ? $first['message'] : json_encode($t);
        } else {
            $trap = (string) $t;
        }
    }

    if (is_array($res)) {
        foreach ($res as $key => $row) {
            if ($key === '!trap' || !is_array($row)) continue;
            if (isset($row['time']) && $row['time'] !== '') {
                $raw = $row['time'];
                $ms = null;
                if (preg_match('/^(\d+)ms$/', $raw, $m)) {
                    $ms = (float) $m[1];
                } elseif (preg_match('/^(\d+)s(\d+)ms$/', $raw, $m)) {
                    $ms = (float) $m[1] * 1000 + (float) $m[2];
                } elseif (is_numeric($raw)) {
                    $ms = (float) $raw;
                }
                if ($ms !== null) $times[] = $ms;
            }
            if (isset($row['received'])) $received = (int) $row['received'];
            if (isset($row['packet-loss'])) $lossPct = (float) $row['packet-loss'];
        }
    }

    if ($received === null) $received = count($times);
    if ($lossPct === null) $lossPct = $sent > 0 ? round((($sent - $received) / $sent) * 100, 1) : null;

    $stats = array(
        'sent' => $sent, 'received' => $received, 'loss_pct' => $lossPct,
        'rtt_min_ms' => null, 'rtt_avg_ms' => null, 'rtt_max_ms' => null, 'jitter_ms' => null,
        'error' => $trap
    );
    if (count($times)) {
        $stats['rtt_min_ms'] = min($times);
        $stats['rtt_max_ms'] = max($times);
        $stats['rtt_avg_ms'] = round(array_sum($times) / count($times), 2);
        if (count($times) > 1) {
            $diffs = array();
            for ($i = 1; $i < count($times); $i++) $diffs[] = abs($times[$i] - $times[$i - 1]);
            $stats['jitter_ms'] = round(array_sum($diffs) / count($diffs), 2);
        } else {
            $stats['jitter_ms'] = 0;
        }
    }
    return $stats;
}

/** "2h57m33s" / "1d2h3m4s" → detik. Format tak dikenal → null. */
function upq_uptime_to_seconds($raw) {
    if (!is_string($raw) || $raw === '') return null;
    if (!preg_match_all('/(\d+)([wdhms])/', $raw, $m, PREG_SET_ORDER)) return null;
    $mul = array('w' => 604800, 'd' => 86400, 'h' => 3600, 'm' => 60, 's' => 1);
    $sec = 0;
    foreach ($m as $part) $sec += ((int) $part[1]) * $mul[$part[2]];
    return $sec;
}

function upq_ping($API, $address, $count, $interval, $routingTable = null) {
    $args = array('address' => $address, 'count' => (string) $count, 'interval' => (string) $interval);
    if ($routingTable) $args['routing-table'] = $routingTable;
    return upq_parse_ping($API->comm('/ping', $args), $count);
}

// ================= MODE TRACE =================
if ($mode === 'trace') {
    $address = isset($spec['address']) ? $spec['address'] : '8.8.4.4';
    $routingTable = isset($spec['routingTable']) ? $spec['routingTable'] : null;
    // !! JUMLAH PROBE PER HOP MENENTUKAN APAKAH BUKTI INI BISA DIPAKAI. Dengan count=1, tiap hop
    // cuma diprobe SEKALI, sehingga loss per hop hanya bisa bernilai 0% atau 100% — terukur di
    // 78 trace produksi: 1181 baris bernilai 0%, 184 bernilai 100%, TIDAK ADA nilai di antaranya.
    // Kehilangan paket sebagian (justru yang bikin game tersendat) mustahil terlihat. count=10
    // memberi resolusi 10 poin per hop. Biayanya waktu (~1 detik per ronde), masih jauh di bawah
    // batas tunggu bridge 60 detik.
    $count = isset($spec['count']) ? (int) $spec['count'] : 10;
    if ($count < 1) $count = 1;
    if ($count > 30) $count = 30;
    $args = array('address' => $address, 'count' => (string) $count);
    if ($routingTable) $args['routing-table'] = $routingTable;
    $res = $API->comm('/tool/traceroute', $args);
    $hops = array();
    if (is_array($res)) {
        foreach ($res as $key => $row) {
            if ($key === '!trap' || !is_array($row)) continue;
            $hops[] = array(
                'address' => isset($row['address']) ? $row['address'] : null,
                'loss_pct' => isset($row['loss']) ? (float) $row['loss'] : null,
                'avg_ms' => isset($row['avg']) ? (float) $row['avg'] : (isset($row['last']) && is_numeric($row['last']) ? (float) $row['last'] : null),
                'status' => isset($row['status']) ? $row['status'] : null
            );
        }
    }
    $trap = null;
    if (isset($res['!trap'])) {
        $t = is_array($res['!trap']) ? reset($res['!trap']) : $res['!trap'];
        $trap = is_array($t) && isset($t['message']) ? $t['message'] : json_encode($t);
    }
    mikrotik_success($OP, 'Traceroute selesai.', array(
        'mode' => 'trace', 'address' => $address, 'routing_table' => $routingTable,
        'hops' => $hops, 'error' => $trap
    ), $startedAt);
}

// ================= MODE PROBE =================
$paths = (isset($spec['paths']) && is_array($spec['paths'])) ? $spec['paths'] : array();
$targets = (isset($spec['targets']) && is_array($spec['targets'])) ? $spec['targets'] : array();
$count = isset($spec['count']) ? max(1, min(20, (int) $spec['count'])) : 5;
$gwCount = isset($spec['gatewayPingCount']) ? max(1, min(10, (int) $spec['gatewayPingCount'])) : 3;
$pingInterval = isset($spec['pingIntervalSeconds']) ? (float) $spec['pingIntervalSeconds'] : 0.3;
if ($pingInterval < 0.05 || $pingInterval > 2) $pingInterval = 0.3;

if (!count($paths) || !count($targets)) {
    mikrotik_fail($OP, 'Spesifikasi probe kosong (paths/targets).', 'SPEC_ERROR', $startedAt);
}

// 1) Monitor tunnel (uptime + remote-address) — juga sumber target gateway utk path tunnel.
$tunnels = array();
foreach ($paths as $p) {
    if (!is_array($p) || empty($p['key']) || empty($p['tunnelType']) || empty($p['iface'])) continue;
    $cmd = $p['tunnelType'] === 'sstp' ? '/interface/sstp-client/monitor' : '/interface/l2tp-client/monitor';
    $mon = $API->comm($cmd, array('numbers' => $p['iface'], 'once' => ''));
    $row = null;
    if (is_array($mon)) {
        foreach ($mon as $k => $r) { if ($k !== '!trap' && is_array($r)) { $row = $r; break; } }
    }
    $tunnels[] = array(
        'path' => $p['key'],
        'iface' => $p['iface'],
        'status' => $row && isset($row['status']) ? $row['status'] : null,
        'uptime_s' => $row && isset($row['uptime']) ? upq_uptime_to_seconds($row['uptime']) : null,
        'remote' => $row && isset($row['remote-address']) ? $row['remote-address'] : null
    );
}
$tunnelRemoteByPath = array();
foreach ($tunnels as $t) {
    if (!empty($t['remote'])) $tunnelRemoteByPath[$t['path']] = $t['remote'];
}

// 2) Ping target JAUH per routing-table (kualitas end-to-end per ISP).
$probes = array();
foreach ($paths as $p) {
    if (!is_array($p) || empty($p['key'])) continue;
    foreach ($targets as $t) {
        if (!is_array($t) || empty($t['address'])) continue;
        $stats = upq_ping($API, $t['address'], $count, $pingInterval, !empty($p['routingTable']) ? $p['routingTable'] : null);
        $probes[] = array_merge(array(
            'path' => $p['key'],
            'routing_table' => isset($p['routingTable']) ? $p['routingTable'] : null,
            'target' => $t['address'],
            'target_key' => isset($t['key']) ? $t['key'] : $t['address']
        ), $stats);
    }
}

// 3) Ping GATEWAY per WAN — TANPA routing-table (next-hop selalu connected route).
//    Loss di sini = masalah segmen link ke ISP (last-mile), bukan di dalam ISP.
foreach ($paths as $p) {
    if (!is_array($p) || empty($p['key'])) continue;
    $gwTarget = null;
    if (!empty($p['gatewayTarget'])) {
        $gwTarget = $p['gatewayTarget'];
    } elseif (isset($tunnelRemoteByPath[$p['key']])) {
        $gwTarget = $tunnelRemoteByPath[$p['key']];
    }
    if (!$gwTarget) continue;
    $stats = upq_ping($API, $gwTarget, $gwCount, $pingInterval, null);
    $probes[] = array_merge(array(
        'path' => $p['key'],
        'routing_table' => null,
        'target' => $gwTarget,
        'target_key' => 'gateway'
    ), $stats);
}

// 4) Counter interface WAN (byte/error/drop/link-downs) — delta dihitung di sisi Node.
$links = array();
foreach ($paths as $p) {
    if (!is_array($p) || empty($p['key']) || empty($p['iface'])) continue;
    $res = $API->comm('/interface/print', array(
        'stats' => '',
        '?name' => $p['iface'],
        '.proplist' => 'name,rx-byte,tx-byte,rx-error,tx-error,rx-drop,tx-drop,link-downs'
    ));
    $row = null;
    if (is_array($res)) {
        foreach ($res as $k => $r) { if ($k !== '!trap' && is_array($r)) { $row = $r; break; } }
    }
    if ($row) {
        $links[] = array(
            'path' => $p['key'],
            'iface' => $p['iface'],
            'rx_byte' => isset($row['rx-byte']) ? (float) $row['rx-byte'] : null,
            'tx_byte' => isset($row['tx-byte']) ? (float) $row['tx-byte'] : null,
            'rx_error' => isset($row['rx-error']) ? (float) $row['rx-error'] : null,
            'tx_error' => isset($row['tx-error']) ? (float) $row['tx-error'] : null,
            'rx_drop' => isset($row['rx-drop']) ? (float) $row['rx-drop'] : null,
            'tx_drop' => isset($row['tx-drop']) ? (float) $row['tx-drop'] : null,
            'link_downs' => isset($row['link-downs']) ? (int) $row['link-downs'] : null
        );
    }
}

// 5) Snapshot route default per mark (deteksi failover).
$routes = $API->comm('/ip/route/print', array(
    '?dst-address' => '0.0.0.0/0',
    '.proplist' => 'gateway,distance,active,disabled,routing-mark,comment'
));
$routeRows = array();
if (is_array($routes)) {
    foreach ($routes as $key => $row) {
        if ($key === '!trap' || !is_array($row)) continue;
        $routeRows[] = array(
            'mark' => isset($row['routing-mark']) ? $row['routing-mark'] : 'main',
            'gateway' => isset($row['gateway']) ? $row['gateway'] : null,
            'distance' => isset($row['distance']) ? (int) $row['distance'] : null,
            'active' => isset($row['active']) && $row['active'] === 'true' ? 1 : 0,
            'disabled' => isset($row['disabled']) && $row['disabled'] === 'true' ? 1 : 0,
            'comment' => isset($row['comment']) ? $row['comment'] : null
        );
    }
}

mikrotik_success($OP, 'Probe kualitas jalur selesai.', array(
    'probes' => $probes,
    'links' => $links,
    'tunnels' => $tunnels,
    'routes' => $routeRows
), $startedAt);
