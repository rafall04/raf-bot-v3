<?php
$operation = 'get_hotspot_profiles';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);
    $profiles = $API->comm('/ip/hotspot/user/profile/print');

    if (mikrotik_is_trap($profiles)) {
        mikrotik_fail($operation, 'Gagal mengambil profil Hotspot: ' . mikrotik_trap_message($profiles), 'COMMAND_ERROR', $startedAt, 500, []);
    }

    $profileNames = [];
    foreach ($profiles as $profile) {
        if (isset($profile['name'])) {
            $profileNames[] = $profile['name'];
        }
    }

    mikrotik_success($operation, 'Berhasil mengambil daftar profil Hotspot.', $profileNames, $startedAt);
} catch (Throwable $e) {
    mikrotik_fail($operation, 'Kesalahan Operasi MikroTik: ' . $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500, []);
}
