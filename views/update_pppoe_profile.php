<?php
$operation = 'update_pppoe_profile';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);
    $username = mikrotik_read_input('username', 1);
    $newProfile = mikrotik_read_input('profile', 2);

    $findUserResponse = $API->comm('/ppp/secret/print', [
        '?name' => $username,
    ]);

    if (mikrotik_is_trap($findUserResponse)) {
        mikrotik_fail($operation, 'Gagal mencari user PPPoE: ' . mikrotik_trap_message($findUserResponse), 'COMMAND_ERROR', $startedAt, 500);
    }

    if (empty($findUserResponse)) {
        mikrotik_fail($operation, "User '{$username}' tidak ditemukan.", 'NOT_FOUND', $startedAt, 404);
    }

    $internalId = $findUserResponse[0]['.id'] ?? null;
    if (!$internalId) {
        mikrotik_fail($operation, "Internal ID untuk user '{$username}' tidak ditemukan.", 'EMPTY_RESULT', $startedAt, 500);
    }

    $response = $API->comm('/ppp/secret/set', [
        '.id' => $internalId,
        'profile' => $newProfile,
    ]);

    if (mikrotik_is_trap($response)) {
        mikrotik_fail($operation, 'Gagal memperbarui profil PPPoE: ' . mikrotik_trap_message($response), 'COMMAND_ERROR', $startedAt, 500);
    }

    mikrotik_success($operation, "Profil {$username} berhasil diubah ke {$newProfile}.", [
        'username' => $username,
        'profile' => $newProfile,
        'internal_id' => $internalId,
    ], $startedAt);
} catch (InvalidArgumentException $e) {
    mikrotik_fail($operation, $e->getMessage(), 'INVALID_ARGUMENT', $startedAt, 400);
} catch (Throwable $e) {
    mikrotik_fail($operation, 'Kesalahan Operasi MikroTik: ' . $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500);
}
