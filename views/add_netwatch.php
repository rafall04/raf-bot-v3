<?php
$operation = 'add_netwatch';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);

    // Param via env (MTIN_*) — script panjang + token rahasia tak boleh lewat argv (ps aux).
    $host       = getenv('MTIN_host') ?: '';
    $comment    = getenv('MTIN_comment') ?: '';
    $interval   = getenv('MTIN_interval') ?: '5s';
    $timeout    = getenv('MTIN_timeout') ?: '1s';
    $upScript   = getenv('MTIN_upscript') ?: '';
    $downScript = getenv('MTIN_downscript') ?: '';
    $disabled   = (getenv('MTIN_disabled') === 'yes') ? 'yes' : 'no';

    if ($host === '') {
        mikrotik_fail($operation, 'Host wajib diisi.', 'VALIDATION_ERROR', $startedAt, 400, []);
    }

    // Kebijakan "buat-baru saja": jika host sudah ada di netwatch, JANGAN timpa.
    $existing = $API->comm('/tool/netwatch/print', array('?host' => $host, '.proplist' => '.id'));
    if (mikrotik_is_trap($existing)) {
        mikrotik_fail($operation, 'Gagal cek netwatch: ' . mikrotik_trap_message($existing), 'COMMAND_ERROR', $startedAt, 500, []);
    }

    if (is_array($existing) && isset($existing[0]['.id'])) {
        mikrotik_success($operation, 'Host sudah ada di netwatch — dilewati (tidak ditimpa).', array(
            'host' => $host, 'added' => false, 'exists' => true,
        ), $startedAt);
    } else {
        $res = $API->comm('/tool/netwatch/add', array(
            'host'        => $host,
            'comment'     => $comment,
            'interval'    => $interval,
            'timeout'     => $timeout,
            'up-script'   => $upScript,
            'down-script' => $downScript,
            'disabled'    => $disabled,
        ));
        if (mikrotik_is_trap($res)) {
            mikrotik_fail($operation, 'Gagal menambah netwatch: ' . mikrotik_trap_message($res), 'COMMAND_ERROR', $startedAt, 500, []);
        }
        mikrotik_success($operation, 'Entri netwatch berhasil dibuat.', array(
            'host' => $host, 'added' => true, 'exists' => false,
        ), $startedAt);
    }
} catch (Throwable $e) {
    mikrotik_fail($operation, 'Kesalahan Operasi MikroTik: ' . $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500, []);
}
