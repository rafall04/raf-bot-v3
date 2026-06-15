<?php
$operation = 'get_netwatch_full';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);
    // Ambil netwatch LENGKAP termasuk up-script & down-script — dipakai fitur
    // discovery CCTV (parse `:local cctv` / `:local area` dari script). Bersifat
    // ON-DEMAND (saat admin buka/scan halaman), BUKAN dipakai poller 60s — poller
    // tetap pakai get_netwatch_list.php yang ringan tanpa isi script.
    $entries = $API->comm('/tool/netwatch/print', array(
        '.proplist' => '.id,host,status,comment,since,disabled,up-script,down-script,interval,timeout',
    ));

    if (mikrotik_is_trap($entries)) {
        mikrotik_fail($operation, 'Gagal mengambil netwatch: ' . mikrotik_trap_message($entries), 'COMMAND_ERROR', $startedAt, 500, []);
    }

    $out = [];
    foreach ($entries as $e) {
        $out[] = [
            'id'          => isset($e['.id']) ? $e['.id'] : null,
            'host'        => isset($e['host']) ? $e['host'] : null,
            'status'      => isset($e['status']) ? $e['status'] : null,
            'comment'     => isset($e['comment']) ? $e['comment'] : '',
            'since'       => isset($e['since']) ? $e['since'] : null,
            'disabled'    => isset($e['disabled']) ? $e['disabled'] : 'false',
            'up_script'   => isset($e['up-script']) ? $e['up-script'] : '',
            'down_script' => isset($e['down-script']) ? $e['down-script'] : '',
            'interval'    => isset($e['interval']) ? $e['interval'] : null,
            'timeout'     => isset($e['timeout']) ? $e['timeout'] : null,
        ];
    }

    mikrotik_success($operation, 'Berhasil mengambil daftar netwatch lengkap.', $out, $startedAt);
} catch (Throwable $e) {
    mikrotik_fail($operation, 'Kesalahan Operasi MikroTik: ' . $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500, []);
}
