<?php
/**
 * Hapus /system/script berdasarkan daftar .id (batch). ids via env MTIN_ids (csv) atau argv[1].
 * Dipakai cron reconcile voucher untuk prune log Mikhmon SETELAH ingest ke DB.
 */
$operation = 'remove_scripts';
require_once('conn.php');
$startedAt = mikrotik_operation_start();
mikrotik_require_connection($operation, $startedAt);

$idsRaw = mikrotik_read_input('ids', 1, false, '');
$ids = ($idsRaw !== '' && $idsRaw !== null)
    ? array_values(array_filter(array_map('trim', explode(',', $idsRaw))))
    : [];
if (count($ids) === 0) {
    mikrotik_success($operation, 'Tidak ada id', ['removed' => 0], $startedAt, 200);
}

$batch = 500;
$removed = 0;
for ($i = 0; $i < count($ids); $i += $batch) {
    $chunk = array_slice($ids, $i, $batch);
    $API->write('/system/script/remove', false);
    $API->write('=.id=' . implode(',', $chunk), true);
    $API->read(false);
    $removed += count($chunk);
}
mikrotik_success($operation, 'OK', ['removed' => $removed], $startedAt, 201);
