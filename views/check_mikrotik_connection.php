<?php
require_once('conn.php');

$operation = 'check_mikrotik_connection';
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);

    $response = $API->comm('/system/resource/print');
    if (mikrotik_is_trap($response)) {
        mikrotik_fail($operation, 'Router terhubung tetapi perintah dasar gagal: ' . mikrotik_trap_message($response), 'COMMAND_ERROR', $startedAt, 500);
    }

    $resource = is_array($response) && isset($response[0]) ? $response[0] : [];
    mikrotik_success($operation, 'Berhasil terkoneksi dan terautentikasi ke MikroTik.', [
        'connected' => true,
        'identity' => $resource['name'] ?? null,
        'version' => $resource['version'] ?? null,
        'uptime' => $resource['uptime'] ?? null,
    ], $startedAt);
} catch (Throwable $e) {
    mikrotik_fail($operation, 'Kesalahan internal saat mengecek koneksi MikroTik: ' . $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500);
}
