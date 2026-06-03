<?php
$operation = 'get_ppp_active_legacy';
$startedAt = microtime(true);

require_once('conn.php');

// Deprecated bridge kept only for legacy compatibility.
// Active callers must use get_ppp_active_optimized.php through lib/mikrotik.js.
mikrotik_fail(
    $operation,
    'Endpoint legacy dinonaktifkan. Gunakan get_ppp_active_optimized.php melalui gateway MikroTik utama.',
    'DEPRECATED_ENDPOINT',
    $startedAt,
    410,
    []
);
