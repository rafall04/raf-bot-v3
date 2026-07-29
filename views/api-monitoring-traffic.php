<?php
/**
 * Header Doc
 * Purpose: Endpoint RINGAN khusus laju trafik untuk grafik dasbor. Hanya dua perintah
 *          RouterOS: `/interface/print` (proplist name,rx-byte,tx-byte — total kumulatif)
 *          dan `/interface/monitor-traffic once` (laju sesaat). Diukur di produksi:
 *          ~0,2 detik, versus ~11 detik untuk `/api/monitoring/live` yang menjalankan
 *          18 perintah demi angka yang sama. Grafik hanya butuh satu laju; ia tak
 *          perlu antrean, ARP, lease DHCP, sesi hotspot, atau tabel rute.
 *          Bentuk balasan SENGAJA sama persis dengan blok `data.traffic` milik
 *          api-monitoring-live.php supaya updateTrafficData() di klien tak perlu diubah.
 * Caller: routes/monitoring-api.js — `GET /api/monitoring/traffic` (lewat executePHP).
 * Deps: views/conn.php (kredensial MikroTik dari .env), env MONITOR_INTERFACE.
 * MainFuncs: -
 * SideEffects: Satu koneksi API RouterOS (dibuka lalu ditutup). Tidak menulis apa pun.
 */

require 'conn.php';

header('Content-Type: application/json');

// Grafik memanggil ini tiap beberapa detik — batas waktu harus pendek. Lebih baik satu
// titik hilang daripada permintaan menggantung dan menumpuk di belakangnya.
$API->timeout = 3;
$API->attempts = 1;
set_time_limit(8);

function kirim_galat($pesan, $kode = 503)
{
    http_response_code($kode);
    echo json_encode([
        'status' => $kode,
        'error' => true,
        'message' => $pesan,
        'data' => null,
    ]);
    if (isset($GLOBALS['API']) && $GLOBALS['API']->connected) {
        $GLOBALS['API']->disconnect();
    }
    exit();
}

if (!isset($API) || !$API->connected) {
    kirim_galat('MikroTik tidak terhubung.');
}

// Saat dijalankan lewat exec(), query string datang dari environment, bukan $_GET.
if (isset($_SERVER['QUERY_STRING']) && empty($_GET)) {
    parse_str(ltrim($_SERVER['QUERY_STRING'], '?'), $_GET);
}

// Urutan yang sama dengan api-monitoring-live.php: permintaan klien, lalu MONITOR_INTERFACE,
// baru fallback terakhir 'ether1'. Beda urutan = grafik dan panel menunjuk interface berbeda.
$requestedInterface = isset($_GET['interface']) ? trim($_GET['interface']) : '';
$configuredInterface = getenv('MONITOR_INTERFACE');
$selectedInterface = $requestedInterface !== ''
    ? $requestedInterface
    : (($configuredInterface !== false && $configuredInterface !== '') ? $configuredInterface : 'ether1');

// Total kumulatif. proplist menekan ukuran balasan; tanpa itu RouterOS mengirim ~40 field
// per interface padahal yang dipakai tiga.
$totalRx = 0;
$totalTx = 0;
$interfaceDitemukan = false;
try {
    $interfaces = $API->comm('/interface/print', ['.proplist' => 'name,rx-byte,tx-byte']);
    if (is_array($interfaces)) {
        foreach ($interfaces as $iface) {
            if (($iface['name'] ?? '') === $selectedInterface) {
                $totalRx = intval($iface['rx-byte'] ?? 0);
                $totalTx = intval($iface['tx-byte'] ?? 0);
                $interfaceDitemukan = true;
                break;
            }
        }
    }
} catch (Exception $e) {
    error_log('[TRAFFIC] Gagal membaca /interface/print: ' . $e->getMessage());
}

// Laju sesaat. Ini satu-satunya sumber angka "current" — /interface/print hanya punya
// pencacah kumulatif, jadi menghitung laju darinya berarti menebak selisih waktu.
$currentRxRate = 0;
$currentTxRate = 0;
$monitorBerhasil = false;
try {
    $monitor = $API->comm('/interface/monitor-traffic', [
        'interface' => $selectedInterface,
        'once' => '',
        'duration' => '1',
    ]);
    if ($monitor && isset($monitor[0]['rx-bits-per-second'])) {
        // Mbps desimal (1e6), konsisten dengan tampilan Winbox — BUKAN 2^20 (Mibit/s)
        // yang membuat angka ~4,86% lebih rendah. Lihat catatan di api-monitoring-live.php.
        $currentRxRate = round($monitor[0]['rx-bits-per-second'] / 1000000, 2);
        $currentTxRate = round(($monitor[0]['tx-bits-per-second'] ?? 0) / 1000000, 2);
        $monitorBerhasil = true;
    }
} catch (Exception $e) {
    error_log('[TRAFFIC] Gagal membaca /interface/monitor-traffic: ' . $e->getMessage());
}

// "Tidak bisa mengamati" bukan "diamati nol". Kalau interface-nya tak ada atau monitor
// gagal, jangan kirim angka 0 — itu tampil di grafik sebagai trafik benar-benar mati.
if (!$interfaceDitemukan && !$monitorBerhasil) {
    kirim_galat('Interface "' . $selectedInterface . '" tidak ditemukan atau tidak bisa dibaca.');
}

echo json_encode([
    'status' => 200,
    'error' => false,
    'data' => [
        'traffic' => [
            'download' => [
                'current' => $currentRxRate,           // Mbps
                'total' => round($totalRx / 1000000000, 2), // GB desimal (1e9)
            ],
            'upload' => [
                'current' => $currentTxRate,
                'total' => round($totalTx / 1000000000, 2),
            ],
        ],
        'selectedInterface' => $selectedInterface,
    ],
]);

if ($API->connected) {
    $API->disconnect();
}
