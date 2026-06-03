<?php
/**
 * Traffic History API
 * Mengembalikan history trafik untuk chart.
 *
 * CATATAN: RouterOS tidak menyimpan time-series rate, dan saat ini tidak ada buffer
 * history yang dipersist di sisi server. Maka endpoint ini mengembalikan array KOSONG
 * (bukan data acak) sehingga chart mulai bersih lalu diisi oleh data live (poll 5 detik).
 *
 * Sebelumnya endpoint ini mengisi data dummy via rand() sehingga chart menampilkan
 * angka palsu (10-80/5-40 Mbps) setiap kali halaman dibuka — itu BUG dan sudah dihapus.
 * Jika kelak ingin history nyata, isi $history dari buffer rate yang dipersist
 * (mis. ring-buffer di Node/SQLite), bukan dari angka acak.
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$history = [];

$response = [
    'status' => 200,
    'data' => $history
];

echo json_encode($response);
?>
