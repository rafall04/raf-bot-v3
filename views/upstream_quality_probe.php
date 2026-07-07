<?php
/**
 * Header Doc
 * Purpose: Bridge probe kualitas jalur upstream — ping per routing-table (policy-routed, BUKAN
 *          interface=) ke target eksternal + snapshot route default per mark, dari router gateway.
 *          Read-only terhadap router (hanya /ping dan /ip route print).
 * Caller: `lib/upstream-quality-poller.js` (spawn php CLI per siklus).
 * Deps: `views/routeros_api.class.php`, `views/mikrotik_helper.php`. Kredensial via env
 *       MTIN_UPQ_HOST / MTIN_UPQ_PORT / MTIN_UPQ_USER / MTIN_UPQ_PASS (tidak lewat argv).
 *       Spesifikasi probe (non-rahasia) via argv[1] JSON: { paths, targets, count,
 *       pingIntervalSeconds, connectTimeoutSeconds }.
 * MainFuncs: main flow prosedural + `upq_parse_ping`.
 * SideEffects: Koneksi API RouterOS + ICMP keluar dari router; stdout JSON envelope
 *              (status/operation/message/data) pola mikrotik_helper.
 */

require __DIR__ . '/routeros_api.class.php';
require __DIR__ . '/mikrotik_helper.php';

$startedAt = mikrotik_operation_start();
$OP = 'upstreamQualityProbe';

$spec = json_decode(isset($argv[1]) ? $argv[1] : '{}', true);
if (!is_array($spec)) {
    $spec = array();
}

$host = mikrotik_read_input('UPQ_HOST', null, false, null);
$port = (int) mikrotik_read_input('UPQ_PORT', null, false, '8728');
$user = mikrotik_read_input('UPQ_USER', null, false, null);
$pass = mikrotik_read_input('UPQ_PASS', null, false, null);

if (!$host || !$user || $pass === null || $pass === false) {
    mikrotik_fail($OP, 'Kredensial router probe tidak lengkap (MTIN_UPQ_HOST/USER/PASS).', 'CONFIG_ERROR', $startedAt);
}

$GLOBALS['MIKROTIK_CONFIG'] = array('host' => $host);

$paths = (isset($spec['paths']) && is_array($spec['paths'])) ? $spec['paths'] : array();
$targets = (isset($spec['targets']) && is_array($spec['targets'])) ? $spec['targets'] : array();
$count = isset($spec['count']) ? max(1, min(20, (int) $spec['count'])) : 5;
$pingInterval = isset($spec['pingIntervalSeconds']) ? (float) $spec['pingIntervalSeconds'] : 0.3;
if ($pingInterval < 0.05 || $pingInterval > 2) {
    $pingInterval = 0.3;
}
$connectTimeout = isset($spec['connectTimeoutSeconds']) ? max(3, min(30, (int) $spec['connectTimeoutSeconds'])) : 8;

if (!count($paths) || !count($targets)) {
    mikrotik_fail($OP, 'Spesifikasi probe kosong (paths/targets).', 'SPEC_ERROR', $startedAt);
}

$API = new RouterosAPI();
$GLOBALS['API'] = $API;
$API->attempts = 1;
$API->timeout = $connectTimeout;
$API->port = $port;

if (!$API->connect($host, $user, $pass)) {
    mikrotik_fail($OP, "Gagal konek API router $host:$port.", 'CONNECT_ERROR', $startedAt);
}

/**
 * Parse balasan streaming /ping RouterOS v6: baris !re per paket (time/received/packet-loss),
 * baris timeout tanpa `time`. Loss & received diambil dari baris TERAKHIR (kumulatif).
 */
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
            if ($key === '!trap' || !is_array($row)) {
                continue;
            }
            if (isset($row['time']) && $row['time'] !== '') {
                // format "25ms" / "1s2ms" — normalisasi kasar ke ms (kasus umum: "NNms")
                $raw = $row['time'];
                $ms = null;
                if (preg_match('/^(\d+)ms$/', $raw, $m)) {
                    $ms = (float) $m[1];
                } elseif (preg_match('/^(\d+)s(\d+)ms$/', $raw, $m)) {
                    $ms = (float) $m[1] * 1000 + (float) $m[2];
                } elseif (is_numeric($raw)) {
                    $ms = (float) $raw;
                }
                if ($ms !== null) {
                    $times[] = $ms;
                }
            }
            if (isset($row['received'])) {
                $received = (int) $row['received'];
            }
            if (isset($row['packet-loss'])) {
                $lossPct = (float) $row['packet-loss'];
            }
        }
    }

    if ($received === null) {
        $received = count($times);
    }
    if ($lossPct === null) {
        $lossPct = $sent > 0 ? round((($sent - $received) / $sent) * 100, 1) : null;
    }

    $stats = array(
        'sent' => $sent,
        'received' => $received,
        'loss_pct' => $lossPct,
        'rtt_min_ms' => null,
        'rtt_avg_ms' => null,
        'rtt_max_ms' => null,
        'jitter_ms' => null,
        'error' => $trap
    );

    if (count($times)) {
        $stats['rtt_min_ms'] = min($times);
        $stats['rtt_max_ms'] = max($times);
        $stats['rtt_avg_ms'] = round(array_sum($times) / count($times), 2);
        if (count($times) > 1) {
            $diffs = array();
            for ($i = 1; $i < count($times); $i++) {
                $diffs[] = abs($times[$i] - $times[$i - 1]);
            }
            $stats['jitter_ms'] = round(array_sum($diffs) / count($diffs), 2);
        } else {
            $stats['jitter_ms'] = 0;
        }
    }

    return $stats;
}

$probes = array();
foreach ($paths as $p) {
    if (!is_array($p) || empty($p['key'])) {
        continue;
    }
    foreach ($targets as $t) {
        if (!is_array($t) || empty($t['address'])) {
            continue;
        }
        $args = array(
            'address' => $t['address'],
            'count' => (string) $count,
            'interval' => (string) $pingInterval
        );
        if (!empty($p['routingTable'])) {
            $args['routing-table'] = $p['routingTable'];
        }
        $res = $API->comm('/ping', $args);
        $stats = upq_parse_ping($res, $count);
        $probes[] = array_merge(array(
            'path' => $p['key'],
            'routing_table' => isset($p['routingTable']) ? $p['routingTable'] : null,
            'target' => $t['address'],
            'target_key' => isset($t['key']) ? $t['key'] : $t['address']
        ), $stats);
    }
}

// Snapshot seluruh route default (semua mark + main) — dipakai Node untuk deteksi failover
// (mis. MNI primary inactive & backup SF active) tanpa query kedua.
$routes = $API->comm('/ip/route/print', array(
    '?dst-address' => '0.0.0.0/0',
    '.proplist' => 'gateway,distance,active,disabled,routing-mark,comment'
));
$routeRows = array();
if (is_array($routes)) {
    foreach ($routes as $key => $row) {
        if ($key === '!trap' || !is_array($row)) {
            continue;
        }
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
    'routes' => $routeRows
), $startedAt);
