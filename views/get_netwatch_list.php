<?php
$operation = 'get_netwatch_list';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);
    // Ambil daftar netwatch dari MikroTik. /tool/netwatch/print tersedia di RouterOS 6.x & 7.x.
    // Field penting: host (IP), status (up/down/unknown), comment (label admin), since (timestamp).
    $entries = $API->comm('/tool/netwatch/print', array(
        '.proplist' => 'host,status,comment,since,disabled,timeout,interval',
    ));

    if (mikrotik_is_trap($entries)) {
        mikrotik_fail($operation, 'Gagal mengambil netwatch: ' . mikrotik_trap_message($entries), 'COMMAND_ERROR', $startedAt, 500, []);
    }

    $out = [];
    foreach ($entries as $e) {
        $out[] = [
            'host'     => isset($e['host']) ? $e['host'] : null,
            'status'   => isset($e['status']) ? $e['status'] : null,
            'comment'  => isset($e['comment']) ? $e['comment'] : '',
            'since'    => isset($e['since']) ? $e['since'] : null,
            'disabled' => isset($e['disabled']) ? $e['disabled'] : 'false',
        ];
    }

    mikrotik_success($operation, 'Berhasil mengambil daftar netwatch.', $out, $startedAt);
} catch (Throwable $e) {
    mikrotik_fail($operation, 'Kesalahan Operasi MikroTik: ' . $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500, []);
}
