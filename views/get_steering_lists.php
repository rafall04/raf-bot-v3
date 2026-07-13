<?php
// Ambil keanggotaan address-list steering pelanggan (RAF-STEER-<jalur>) untuk resolusi jalur
// upstream per-pelanggan LIVE (lib/customer-path-resolver.js). READ-ONLY.
$operation = 'get_steering_lists';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);
    $entries = $API->comm('/ip/firewall/address-list/print');

    if (mikrotik_is_trap($entries)) {
        mikrotik_fail($operation, 'Gagal mengambil address-list: ' . mikrotik_trap_message($entries), 'COMMAND_ERROR', $startedAt, 500, []);
    }

    $steer = ['RAF-STEER-GMDP', 'RAF-STEER-MNI', 'RAF-STEER-IH', 'RAF-STEER-SF'];
    $out = [];
    if (is_array($entries)) {
        foreach ($entries as $e) {
            $list = $e['list'] ?? '';
            if (in_array($list, $steer, true) && isset($e['address'])) {
                $out[] = ['list' => $list, 'address' => $e['address']];
            }
        }
    }

    mikrotik_success($operation, 'Berhasil mengambil list steering pelanggan.', $out, $startedAt);
} catch (Throwable $e) {
    mikrotik_fail($operation, 'Kesalahan Operasi MikroTik: ' . $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500, []);
}
