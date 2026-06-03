<?php
$operation = 'check_pppoe_username_exists';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);
    $username = mikrotik_read_input('username', 1);
} catch (InvalidArgumentException $e) {
    mikrotik_fail($operation, $e->getMessage(), 'INVALID_ARGUMENT', $startedAt, 400);
}

try {
    $existingSecrets = $API->comm('/ppp/secret/print', [
        "?name" => $username,
    ]);

    if (mikrotik_is_trap($existingSecrets)) {
        mikrotik_fail($operation, 'Error saat mengecek username: ' . mikrotik_trap_message($existingSecrets), 'COMMAND_ERROR', $startedAt, 500);
    }

    $exists = !empty($existingSecrets);

    mikrotik_success($operation, $exists ? 'Username sudah ada di MikroTik.' : 'Username tersedia.', [
        'username' => $username,
        'exists' => $exists,
    ], $startedAt);

} catch (Exception $e) {
    mikrotik_fail($operation, 'Kesalahan Operasi MikroTik: ' . $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500);
}
?>

