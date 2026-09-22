<?php
$operation = 'check_hotspot_username';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);
    $username = mikrotik_read_input('name', 1);
} catch (InvalidArgumentException $e) {
    mikrotik_fail($operation, $e->getMessage(), 'INVALID_ARGUMENT', $startedAt, 400);
}

// Pre-check sebelum charge: username hotspot kustom pilihan pelanggan tidak boleh
// bentrok dengan user yang sudah ada di MikroTik. Cek final tetap di `user/add`
// (DUPLICATE trap) — ini hanya deteksi dini agar nama bentrok ditolak SEBELUM bayar.
try {
    $existingUsers = $API->comm('/ip/hotspot/user/print', [
        "?name" => $username,
    ]);

    if (mikrotik_is_trap($existingUsers)) {
        mikrotik_fail($operation, 'Error saat mengecek username: ' . mikrotik_trap_message($existingUsers), 'COMMAND_ERROR', $startedAt, 500);
    }

    $exists = !empty($existingUsers);

    mikrotik_success($operation, $exists ? 'Username sudah ada di MikroTik.' : 'Username tersedia.', [
        'username' => $username,
        'exists' => $exists,
    ], $startedAt);

} catch (Exception $e) {
    mikrotik_fail($operation, 'Kesalahan Operasi MikroTik: ' . $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500);
}
?>
