<?php
require_once('conn.php');

$operation = 'get_hotspot_active_users';
$startedAt = mikrotik_operation_start();

if (isset($API) && $API instanceof RouterosAPI) {
    $API->timeout = 2;
    $API->attempts = 1;
    $API->delay = 0;
}

function normalize_mac_key($value) {
    $normalized = strtolower(trim((string) ($value ?? '')));
    return preg_replace('/[^a-f0-9]/', '', $normalized);
}

try {
    mikrotik_require_connection($operation, $startedAt);
    set_time_limit(5);

    $activeSessions = $API->comm('/ip/hotspot/active/print');
    if (mikrotik_is_trap($activeSessions)) {
        mikrotik_fail($operation, 'Gagal mengambil sesi Hotspot aktif: ' . mikrotik_trap_message($activeSessions), 'COMMAND_ERROR', $startedAt, 500);
    }

    $hostnameByMac = [];
    $dhcpLeases = $API->comm('/ip/dhcp-server/lease/print');
    if (is_array($dhcpLeases) && !mikrotik_is_trap($dhcpLeases)) {
        foreach ($dhcpLeases as $lease) {
            $macKey = normalize_mac_key($lease['mac-address'] ?? '');
            if (!$macKey) {
                continue;
            }

            $hostname = $lease['host-name'] ?? $lease['comment'] ?? '';
            if ($hostname !== '') {
                $hostnameByMac[$macKey] = $hostname;
            }
        }
    }

    $formatted = [];
    foreach ($activeSessions as $session) {
        $mac = $session['mac-address'] ?? null;
        $hostname = $hostnameByMac[normalize_mac_key($mac)] ?? null;

        $formatted[] = [
            'user' => $session['user'] ?? null,
            'address' => $session['address'] ?? null,
            'mac' => $mac,
            'hostname' => $hostname,
            'uptime' => $session['uptime'] ?? null,
            'rx_bytes' => isset($session['bytes-in']) ? (int) $session['bytes-in'] : 0,
            'tx_bytes' => isset($session['bytes-out']) ? (int) $session['bytes-out'] : 0,
        ];
    }

    mikrotik_success($operation, 'Berhasil mengambil sesi Hotspot aktif.', $formatted, $startedAt);
} catch (Throwable $e) {
    mikrotik_fail($operation, $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500, []);
}
