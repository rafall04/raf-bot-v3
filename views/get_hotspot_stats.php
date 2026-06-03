<?php
require_once('conn.php');

$operation = 'get_hotspot_stats';
$startedAt = mikrotik_operation_start();

mikrotik_require_connection($operation, $startedAt);

$response = ['total' => 0, 'active' => 0];

// Get all configured Hotspot users
$hotspotUsers = $API->comm("/ip/hotspot/user/print");

// Check for API command errors
if (!is_array($hotspotUsers) || mikrotik_is_trap($hotspotUsers)) {
    mikrotik_fail($operation, 'Error fetching Hotspot users from Mikrotik: ' . mikrotik_trap_message($hotspotUsers), 'COMMAND_ERROR', $startedAt, 500);
}
$response['total'] = is_array($hotspotUsers) ? count($hotspotUsers) : 0;


// Get active Hotspot sessions
$activeHotspotSessions = $API->comm("/ip/hotspot/active/print");

// Check for API command errors
if (!is_array($activeHotspotSessions) || mikrotik_is_trap($activeHotspotSessions)) {
    mikrotik_fail($operation, 'Error fetching active Hotspot sessions from Mikrotik: ' . mikrotik_trap_message($activeHotspotSessions), 'COMMAND_ERROR', $startedAt, 500);
}
$response['active'] = is_array($activeHotspotSessions) ? count($activeHotspotSessions) : 0;


mikrotik_success($operation, 'Statistik Hotspot berhasil diambil.', $response, $startedAt);
