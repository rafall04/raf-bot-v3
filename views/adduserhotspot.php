<?php
$operation = 'add_hotspot_user';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);
    $profil = mikrotik_read_input('profil', null);
    $komen = mikrotik_read_input('komen', null);
} catch (InvalidArgumentException $e) {
    mikrotik_fail($operation, $e->getMessage(), 'INVALID_ARGUMENT', $startedAt, 400);
}

function generateRandomString($length = 6) {
    $characters = '23456789abcdefghjkmnpqrstuvwxyz';
    $charactersLength = strlen($characters);
    $randomString = '';
    for ($i = 0; $i < $length; $i++) {
        $randomString .= $characters[rand(0, $charactersLength - 1)];
    }
    return $randomString;
}

define('SERVER', 'all');
define('COMMENT_PREFIX', "vc-BotWa | ");

try {
    $allHotspotProfiles = $API->comm('/ip/hotspot/user/profile/print');
    $profileExists = false;
    foreach ($allHotspotProfiles as $p) {
        if (isset($p['name']) && strcasecmp(trim($p['name']), $profil) === 0) {
            $profileExists = true;
            break;
        }
    }

    if (!$profileExists) {
        mikrotik_fail($operation, 'Gagal: Profil Hotspot "' . $profil . '" tidak ditemukan di Mikrotik.', 'NOT_FOUND', $startedAt, 404);
    }

    $hotspot_username = generateRandomString(6);
    $hotspot_password = $hotspot_username;

    $full_comment = COMMENT_PREFIX . $komen . ' | ' . $profil . ' | ' . date('d-m-Y H:i:s');

    $API->write('/ip/hotspot/user/add', false);
    $API->write('=name=' . $hotspot_username, false);
    $API->write('=password=' . $hotspot_password, false);
    $API->write('=server=' . SERVER, false);
    $API->write('=comment=' . $full_comment, false);
    $API->write('=profile=' . $profil);

    $response = $API->read(false);

    if (!empty($response)) {
        foreach ($response as $item) {
            if (isset($item['!trap'])) {
                $message = $item['message'] ?? 'Terjadi kesalahan Hotspot Mikrotik yang tidak diketahui.';

                if (strpos($message, 'already have user with this name for this server') !== false) {
                    mikrotik_fail($operation, 'Gagal: Voucher dengan username ini (' . $hotspot_username . ') sudah terdaftar.', 'DUPLICATE', $startedAt, 409);
                }
                else if (strpos($message, 'input does not match any value of profile') !== false) {
                    mikrotik_fail($operation, 'Gagal: Profil Hotspot yang dimasukkan salah atau tidak ditemukan.', 'NOT_FOUND', $startedAt, 404);
                }
                else {
                    mikrotik_fail($operation, 'Gagal menambahkan Hotspot User: ' . $message, 'COMMAND_ERROR', $startedAt, 500);
                }
            }
        }
    }

    mikrotik_success($operation, 'Voucher Hotspot berhasil dibuat.', [
        'username' => $hotspot_username,
        'password' => $hotspot_username,
        'profile' => $profil
    ], $startedAt, 201);

} catch (Exception $e) {
    mikrotik_fail($operation, 'Kesalahan Operasi MikroTik Hotspot: ' . $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500);
}
 
