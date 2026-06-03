<?php
$operation = 'add_pppoe_user';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);
    $user = mikrotik_read_input('user', 1);
    $pw = mikrotik_read_input('pw', 2);
    $profil = mikrotik_read_input('profil', 3);
} catch (InvalidArgumentException $e) {
    mikrotik_fail($operation, $e->getMessage(), 'INVALID_ARGUMENT', $startedAt, 400);
}

define('SERVICE', 'any');
define('COMMENT', 'By-Bot');

try {
    $existingSecrets = $API->comm('/ppp/secret/print', [
        "?name" => $user,
    ]);

    if (mikrotik_is_trap($existingSecrets)) {
        mikrotik_fail($operation, 'Gagal mengecek duplikasi PPPoE: ' . mikrotik_trap_message($existingSecrets), 'COMMAND_ERROR', $startedAt, 500);
    }

    if (!empty($existingSecrets)) {
        mikrotik_fail($operation, 'Akun PPPoE dengan nama yang sama sudah ada.', 'DUPLICATE', $startedAt, 409);
    }

    $API->write('/ppp/secret/add', false);
    $API->write('=name=' . $user, false);
    $API->write('=password=' . $pw, false);
    $API->write('=service=' . SERVICE, false);
    $API->write('=comment=' . COMMENT, false);
    $API->write('=profile=' . $profil);

    $response = $API->read(false);
    $API->disconnect();

    if (!empty($response)) {
        foreach ($response as $item) {
            if (isset($item['!trap'])) {
                $message = $item['message'] ?? 'Terjadi kesalahan Mikrotik yang tidak diketahui.';
                mikrotik_fail($operation, 'Gagal menambahkan PPPoE: ' . $message, 'COMMAND_ERROR', $startedAt, 500);
            }
        }
    }

    mikrotik_success($operation, 'Akun PPPoE berhasil ditambahkan.', [
        'username' => $user,
        'profile' => $profil,
        'service' => SERVICE,
    ], $startedAt, 201);

} catch (Exception $e) {
    mikrotik_fail($operation, 'Kesalahan Operasi MikroTik: ' . $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500);
}
?>
