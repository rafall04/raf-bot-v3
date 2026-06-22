<?php
/**
 * Batch add hotspot voucher dalam SATU koneksi RouterOS (efisien untuk cetak banyak,
 * mis. 360+). Connect sekali -> validasi profil sekali -> loop N add -> disconnect sekali.
 * Format kode ala Mikhmon: panjang (length), jenis karakter (chartype), prefix.
 * Args (CLI argv / HTTP): profil, count, komen, length, chartype, prefix.
 */
$operation = 'add_hotspot_batch';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);
    $profil   = mikrotik_read_input('profil', 1);
    $count    = (int) mikrotik_read_input('count', 2, false, 0);
    $komen    = mikrotik_read_input('komen', 3, false, 'VoucherPrint');
    $length   = (int) mikrotik_read_input('length', 4, false, 6);
    $chartype = mikrotik_read_input('chartype', 5, false, 'safe');
    $prefix   = mikrotik_read_input('prefix', 6, false, '');
    $usernamesRaw = mikrotik_read_input('usernames', 7, false, '');
} catch (InvalidArgumentException $e) {
    mikrotik_fail($operation, $e->getMessage(), 'INVALID_ARGUMENT', $startedAt, 400);
}

// Mode CUSTOM: bila daftar usernames diberikan, pakai persis itu (bukan acak).
$customNames = ($usernamesRaw !== '' && $usernamesRaw !== null)
    ? array_values(array_unique(array_filter(array_map('trim', explode(',', $usernamesRaw)))))
    : [];

if (count($customNames) === 0 && $count < 1) {
    mikrotik_fail($operation, 'Jumlah voucher minimal 1.', 'INVALID_ARGUMENT', $startedAt, 400);
}
if ($count > 1000) { $count = 1000; }
if (count($customNames) > 1000) { $customNames = array_slice($customNames, 0, 1000); }
if ($length < 3) { $length = 3; }
if ($length > 16) { $length = 16; }

$charsets = [
    'num'       => '0123456789',
    'lower'     => 'abcdefghijklmnopqrstuvwxyz',
    'upper'     => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'lower_num' => 'abcdefghijklmnopqrstuvwxyz0123456789',
    'upper_num' => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    'mix'       => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    'safe'      => '23456789abcdefghjkmnpqrstuvwxyz'
];
$chars = isset($charsets[$chartype]) ? $charsets[$chartype] : $charsets['safe'];
$charsLen = strlen($chars);
$prefix = preg_replace('/[^A-Za-z0-9_.-]/', '', (string) $prefix);

function vp_gen_code($chars, $charsLen, $length, $prefix) {
    $s = $prefix;
    for ($i = 0; $i < $length; $i++) {
        $s .= $chars[random_int(0, $charsLen - 1)];
    }
    return $s;
}

// Validasi profil hotspot sekali (sebelum loop).
$allProfiles = $API->comm('/ip/hotspot/user/profile/print');
$profileExists = false;
if (is_array($allProfiles)) {
    foreach ($allProfiles as $p) {
        if (isset($p['name']) && strcasecmp(trim($p['name']), $profil) === 0) { $profileExists = true; break; }
    }
}
if (!$profileExists) {
    mikrotik_fail($operation, 'Profil Hotspot "' . $profil . '" tidak ditemukan di MikroTik.', 'NOT_FOUND', $startedAt, 404);
}

define('VP_COMMENT_PREFIX', 'vc-BotWa | ');
$full_comment = VP_COMMENT_PREFIX . $komen . ' | ' . $profil . ' | ' . date('d-m-Y H:i:s');

function vp_add_user($API, $username, $full_comment, $profil) {
    $API->write('/ip/hotspot/user/add', false);
    $API->write('=name=' . $username, false);
    $API->write('=password=' . $username, false);
    $API->write('=server=all', false);
    $API->write('=comment=' . $full_comment, false);
    $API->write('=profile=' . $profil);
    $resp = $API->read(false);
    if (!empty($resp) && is_array($resp)) {
        foreach ($resp as $item) {
            if (isset($item['!trap']) || isset($item['!fatal'])) { return false; }
        }
    }
    return true;
}

$created = [];
$failed = 0;

if (count($customNames) > 0) {
    // Mode custom: tambah username persis (anti-acak); trap (mis. sudah ada) = gagal.
    foreach ($customNames as $username) {
        if (vp_add_user($API, $username, $full_comment, $profil)) {
            $created[] = ['username' => $username, 'password' => $username, 'profile' => $profil];
        } else {
            $failed++;
        }
    }
    $count = count($customNames);
} else {
    // Mode acak: generate kode unik; trap = regenerate (terbatas).
    $seen = [];
    $maxRetry = 6;
    for ($i = 0; $i < $count; $i++) {
        $ok = false;
        for ($r = 0; $r < $maxRetry && !$ok; $r++) {
            $username = vp_gen_code($chars, $charsLen, $length, $prefix);
            if (isset($seen[$username])) { continue; }
            $seen[$username] = true;
            if (vp_add_user($API, $username, $full_comment, $profil)) {
                $created[] = ['username' => $username, 'password' => $username, 'profile' => $profil];
                $ok = true;
            } else {
                unset($seen[$username]);
            }
        }
        if (!$ok) { $failed++; }
    }
}

mikrotik_success($operation, 'Batch voucher selesai: ' . count($created) . ' dibuat, ' . $failed . ' gagal.', [
    'vouchers'  => $created,
    'created'   => count($created),
    'failed'    => $failed,
    'requested' => $count,
    'profile'   => $profil
], $startedAt, 201);
