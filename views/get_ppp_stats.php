<?php
require_once('conn.php');

$operation = 'get_ppp_stats';
$startedAt = mikrotik_operation_start();

mikrotik_require_connection($operation, $startedAt);

$response = [
    'online' => 0,
    'offline' => 0,
    'total' => 0,
    'inactive_users_list' => []
];

// Get all configured PPP secrets
$pppSecrets = $API->comm("/ppp/secret/print");

// Check for API command errors
if (!is_array($pppSecrets) || mikrotik_is_trap($pppSecrets)) {
    mikrotik_fail($operation, 'Error fetching PPP secrets from Mikrotik: ' . mikrotik_trap_message($pppSecrets), 'COMMAND_ERROR', $startedAt, 500);
}

$allSecretNames = [];
// Process only if we have a valid array of secrets
if (!empty($pppSecrets)) {
    foreach ($pppSecrets as $secret) {
        if (isset($secret['name'])) {
            $allSecretNames[] = $secret['name'];
        }
    }
}
$response['total'] = count($allSecretNames);

// Get active PPP sessions
$activeSessions = $API->comm("/ppp/active/print");

// Check for API command errors
if (!is_array($activeSessions) || mikrotik_is_trap($activeSessions)) {
    mikrotik_fail($operation, 'Error fetching active PPP sessions from Mikrotik: ' . mikrotik_trap_message($activeSessions), 'COMMAND_ERROR', $startedAt, 500);
}

$activeUserNames = [];
// Process only if we have a valid array of active sessions
if (!empty($activeSessions)) {
    foreach ($activeSessions as $session) {
        if (isset($session['name'])) {
            $activeUserNames[] = $session['name'];
        }
    }
    $activeUserNames = array_unique($activeUserNames);
}
$response['online'] = count($activeUserNames);

// Calculate offline users and list them
$inactiveUsersList = array_diff($allSecretNames, $activeUserNames);
$response['offline'] = count($inactiveUsersList);
$response['inactive_users_list'] = array_values($inactiveUsersList); // Re-index for clean JSON

mikrotik_success($operation, 'Statistik PPP berhasil diambil.', $response, $startedAt);
