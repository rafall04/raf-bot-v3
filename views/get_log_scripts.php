<?php
/**
 * List /system/script (id+name) milik log Mikhmon (nama mengandung "-|-").
 * Dipakai cron reconcile voucher untuk ingest lalu prune. Ringan (proplist .id,name).
 */
$operation = 'get_log_scripts';
require_once('conn.php');
$startedAt = mikrotik_operation_start();
mikrotik_require_connection($operation, $startedAt);

$scripts = $API->comm('/system/script/print', array('.proplist' => '.id,name'));
$out = [];
foreach ((is_array($scripts) ? $scripts : []) as $s) {
    $name = isset($s['name']) ? $s['name'] : '';
    if ($name !== '' && strpos($name, '-|-') !== false && isset($s['.id'])) {
        $out[] = ['id' => $s['.id'], 'name' => $name];
    }
}
mikrotik_success($operation, 'OK', ['scripts' => $out, 'count' => count($out)], $startedAt, 200);
