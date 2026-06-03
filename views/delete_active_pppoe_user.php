<?php
$operation = 'delete_active_pppoe_user';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);
    $username = mikrotik_read_input('username', 1);

    $activeSessions = $API->comm('/ppp/active/print', [
        '?name' => $username,
    ]);

    if (mikrotik_is_trap($activeSessions)) {
        mikrotik_fail($operation, 'Gagal mencari sesi aktif PPPoE: ' . mikrotik_trap_message($activeSessions), 'COMMAND_ERROR', $startedAt, 500);
    }

    if (empty($activeSessions)) {
        mikrotik_success($operation, "Pengguna '{$username}' sedang tidak aktif. Tidak ada sesi yang perlu dihapus.", [
            'username' => $username,
            'removed' => false,
            'active_session_id' => null,
        ], $startedAt);
    }

    $sessionId = $activeSessions[0]['.id'] ?? null;
    if (!$sessionId) {
        mikrotik_fail($operation, "Sesi aktif untuk '{$username}' ditemukan tetapi ID sesi tidak tersedia.", 'EMPTY_RESULT', $startedAt, 500);
    }

    $removeResponse = $API->comm('/ppp/active/remove', [
        '.id' => $sessionId,
    ]);

    if (mikrotik_is_trap($removeResponse)) {
        mikrotik_fail($operation, 'Gagal menghapus sesi aktif PPPoE: ' . mikrotik_trap_message($removeResponse), 'COMMAND_ERROR', $startedAt, 500);
    }

    mikrotik_success($operation, "Sesi PPPoE aktif untuk '{$username}' berhasil dihapus.", [
        'username' => $username,
        'removed' => true,
        'active_session_id' => $sessionId,
    ], $startedAt);
} catch (InvalidArgumentException $e) {
    mikrotik_fail($operation, $e->getMessage(), 'INVALID_ARGUMENT', $startedAt, 400);
} catch (Throwable $e) {
    mikrotik_fail($operation, 'Kesalahan Operasi MikroTik: ' . $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500);
}
