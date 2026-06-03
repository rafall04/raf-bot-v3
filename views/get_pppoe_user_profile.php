<?php
$operation = 'get_pppoe_user_profile';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);
    $username = mikrotik_read_input('username', 1);

    $findUserResponse = $API->comm('/ppp/secret/print', [
        '?name' => $username,
    ]);

    if (mikrotik_is_trap($findUserResponse)) {
        mikrotik_fail($operation, 'Gagal mencari user PPPoE: ' . mikrotik_trap_message($findUserResponse), 'COMMAND_ERROR', $startedAt, 500);
    }

    if (empty($findUserResponse)) {
        mikrotik_fail($operation, "User '{$username}' tidak ditemukan di MikroTik.", 'NOT_FOUND', $startedAt, 404);
    }

    $profile = $findUserResponse[0]['profile'] ?? null;
    if ($profile === null || $profile === '') {
        mikrotik_fail($operation, "Profil untuk user '{$username}' tidak dapat ditentukan.", 'EMPTY_RESULT', $startedAt, 404);
    }

    mikrotik_success($operation, 'Profil PPPoE berhasil diambil.', [
        'username' => $username,
        'profile' => $profile,
    ], $startedAt);
} catch (InvalidArgumentException $e) {
    mikrotik_fail($operation, $e->getMessage(), 'INVALID_ARGUMENT', $startedAt, 400);
} catch (Throwable $e) {
    mikrotik_fail($operation, 'Kesalahan Operasi MikroTik: ' . $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500);
}
