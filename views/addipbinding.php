<?php
$operation = 'add_ip_binding';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);
    $comment = mikrotik_read_input('comment', null);
    $ip = mikrotik_read_input('ip', null);
    $mac = mikrotik_read_input('mac', null, false, '');
} catch (InvalidArgumentException $e) {
    mikrotik_fail($operation, $e->getMessage(), 'INVALID_ARGUMENT', $startedAt, 400);
}

$params = [
    '=comment=' . $comment,
    '=address=' . $ip,
    '=to-address=' . $ip,
    '=type=bypassed',
];

if ($mac !== '') {
    $params[] = '=mac-address=' . $mac;
}

$API->write('/ip/hotspot/ip-binding/add', false);
for ($i = 0; $i < count($params) - 1; $i++) {
    $API->write($params[$i], false);
}
$API->write($params[count($params) - 1]);

$response = $API->read(false);
if (mikrotik_is_trap($response)) {
    $message = mikrotik_trap_message($response);
    $errorCode = 'COMMAND_ERROR';
    if (strpos($message, 'such client already exists') !== false) {
        $errorCode = 'DUPLICATE';
    } elseif (strpos($message, 'expects range of ip addresses') !== false) {
        $errorCode = 'INVALID_ARGUMENT';
    } elseif (strpos($message, 'invalid value of mac-address') !== false) {
        $errorCode = 'INVALID_ARGUMENT';
    }
    mikrotik_fail($operation, $message, $errorCode, $startedAt, 400);
}

mikrotik_success($operation, 'IP binding berhasil dibuat.', [
    'comment' => $comment,
    'ip' => $ip,
    'mac' => $mac !== '' ? $mac : null,
], $startedAt, 201);
