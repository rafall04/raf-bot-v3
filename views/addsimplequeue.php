<?php
$operation = 'add_simple_queue';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);
    $comment = mikrotik_read_input('comment', null);
    $name = mikrotik_read_input('name', null);
    $target = mikrotik_read_input('target', null);
    $parent = mikrotik_read_input('parent', null);
    $limitat = mikrotik_read_input('limitat', null);
    $maxlimit = mikrotik_read_input('maxlimit', null);
} catch (InvalidArgumentException $e) {
    mikrotik_fail($operation, $e->getMessage(), 'INVALID_ARGUMENT', $startedAt, 400);
}

$API->write('/queue/simple/add', false);
$API->write('=name=' . $name, false);
$API->write('=target=' . $target, false);
$API->write('=parent=' . $parent, false);
$API->write('=limit-at=' . $limitat, false);
$API->write('=comment=' . $comment, false);
$API->write('=max-limit=' . $maxlimit);

$response = $API->read(false);
if (mikrotik_is_trap($response)) {
    $message = mikrotik_trap_message($response);
    $errorCode = 'COMMAND_ERROR';
    if (strpos($message, 'input does not match any value of parent') !== false) {
        $errorCode = 'NOT_FOUND';
    } elseif (strpos($message, 'already have such name') !== false) {
        $errorCode = 'DUPLICATE';
    } elseif (strpos($message, 'upload-max-limit less than upload-limit') !== false || strpos($message, 'download-max-limit less than download-limit') !== false) {
        $errorCode = 'INVALID_ARGUMENT';
    }
    mikrotik_fail($operation, $message, $errorCode, $startedAt, 400);
}

mikrotik_success($operation, 'Simple queue berhasil dibuat.', [
    'name' => $name,
    'target' => $target,
    'parent' => $parent,
    'limitAt' => $limitat,
    'maxLimit' => $maxlimit,
], $startedAt, 201);
