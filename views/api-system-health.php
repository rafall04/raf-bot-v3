<?php
/**
 * System Health API
 * Returns comprehensive system health data from MikroTik
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

// Initialize response
$response = [
    'status' => 200,
    'timestamp' => date('c'),
    'data' => [
        'connected' => false,
        'health_score' => 0,
        'system' => null,
        'interfaces' => [],
        'netwatch' => [],
        'logs' => []
    ]
];

try {
    // Include connection
    require_once('conn.php');
    
    if ($API->connected) {
        $response['data']['connected'] = true;
        
        // 1. Get System Resource
        $resource = $API->comm('/system/resource/print');
        if ($resource && isset($resource[0])) {
            $res = $resource[0];
            $response['data']['system'] = [
                'uptime' => $res['uptime'] ?? 'N/A',
                'cpu_load' => intval($res['cpu-load'] ?? 0),
                'cpu_count' => intval($res['cpu-count'] ?? 1),
                'cpu_frequency' => intval($res['cpu-frequency'] ?? 0),
                'memory_used' => isset($res['total-memory']) && isset($res['free-memory']) 
                    ? round(($res['total-memory'] - $res['free-memory']) / $res['total-memory'] * 100, 1)
                    : 0,
                'memory_total' => intval($res['total-memory'] ?? 0) / 1048576, // Convert to MB
                'memory_free' => intval($res['free-memory'] ?? 0) / 1048576,
                'disk_used' => isset($res['total-hdd-space']) && isset($res['free-hdd-space'])
                    ? round(($res['total-hdd-space'] - $res['free-hdd-space']) / $res['total-hdd-space'] * 100, 1)
                    : 0,
                'disk_total' => intval($res['total-hdd-space'] ?? 0) / 1048576, // Convert to MB
                'disk_free' => intval($res['free-hdd-space'] ?? 0) / 1048576,
                'version' => $res['version'] ?? 'N/A',
                'board_name' => $res['board-name'] ?? 'N/A',
                'architecture' => $res['architecture-name'] ?? 'N/A'
            ];
        }
        
        // 2. Get System Health (temperature etc)
        $health = $API->comm('/system/health/print');
        if ($health && isset($health[0])) {
            if (isset($health[0]['temperature'])) {
                $response['data']['system']['temperature'] = intval($health[0]['temperature']);
            }
            if (isset($health[0]['voltage'])) {
                $response['data']['system']['voltage'] = floatval($health[0]['voltage']);
            }
            if (isset($health[0]['current'])) {
                $response['data']['system']['current'] = floatval($health[0]['current']);
            }
        }
        
        // 3. Get Interface Statistics
        $interfaces = $API->comm('/interface/print');
        if ($interfaces && is_array($interfaces)) {
            foreach ($interfaces as $iface) {
                // Only get main interfaces (ether, wlan, pppoe, bridge)
                $type = $iface['type'] ?? '';
                $name = $iface['name'] ?? '';
                
                // Filter important interfaces
                if (in_array($type, ['ether', 'wlan', 'pppoe', 'bridge']) || 
                    strpos($name, 'ether') === 0 || 
                    strpos($name, 'wlan') === 0 ||
                    strpos($name, 'pppoe') === 0 ||
                    strpos($name, 'bridge') === 0) {
                    
                    $response['data']['interfaces'][] = [
                        'name' => $name,
                        'type' => $type,
                        'running' => $iface['running'] ?? false,
                        'disabled' => $iface['disabled'] ?? false,
                        'rx_bytes' => intval($iface['rx-byte'] ?? 0),
                        'tx_bytes' => intval($iface['tx-byte'] ?? 0),
                        'rx_packets' => intval($iface['rx-packet'] ?? 0),
                        'tx_packets' => intval($iface['tx-packet'] ?? 0),
                        'rx_errors' => intval($iface['rx-error'] ?? 0),
                        'tx_errors' => intval($iface['tx-error'] ?? 0),
                        'comment' => $iface['comment'] ?? ''
                    ];
                }
            }
        }
        
        // 4. Get Netwatch Status
        $netwatch = $API->comm('/tool/netwatch/print');
        if ($netwatch && is_array($netwatch)) {
            foreach ($netwatch as $watch) {
                $response['data']['netwatch'][] = [
                    'name' => $watch['comment'] ?? $watch['host'] ?? 'Unknown',
                    'host' => $watch['host'] ?? '',
                    'status' => $watch['status'] ?? 'unknown',
                    'since' => $watch['since'] ?? '',
                    'timeout' => $watch['timeout'] ?? '1s',
                    'interval' => $watch['interval'] ?? '10s'
                ];
            }
        }
        
        // 5. Get Recent Critical Logs (last 10)
        $logs = $API->comm('/log/print', [
            '?topics' => 'critical,error,warning',
            '.proplist' => 'time,topics,message',
            '?time' => '>1d'  // Last 24 hours
        ]);
        
        if ($logs && is_array($logs)) {
            // Get last 10 entries
            $logs = array_slice($logs, -10);
            foreach ($logs as $log) {
                $response['data']['logs'][] = [
                    'time' => $log['time'] ?? '',
                    'topics' => $log['topics'] ?? '',
                    'message' => $log['message'] ?? ''
                ];
            }
        }
        
        // Calculate health score based on various factors
        $health_score = 100;
        
        // CPU load factor (reduce score if high)
        if (isset($response['data']['system']['cpu_load'])) {
            $cpu = $response['data']['system']['cpu_load'];
            if ($cpu > 80) $health_score -= 20;
            elseif ($cpu > 60) $health_score -= 10;
            elseif ($cpu > 40) $health_score -= 5;
        }
        
        // Memory usage factor
        if (isset($response['data']['system']['memory_used'])) {
            $mem = $response['data']['system']['memory_used'];
            if ($mem > 90) $health_score -= 15;
            elseif ($mem > 75) $health_score -= 10;
            elseif ($mem > 60) $health_score -= 5;
        }
        
        // Temperature factor (if available)
        if (isset($response['data']['system']['temperature'])) {
            $temp = $response['data']['system']['temperature'];
            if ($temp > 80) $health_score -= 20;
            elseif ($temp > 70) $health_score -= 10;
            elseif ($temp > 60) $health_score -= 5;
        }
        
        // Interface errors factor
        $total_errors = 0;
        foreach ($response['data']['interfaces'] as $iface) {
            $total_errors += $iface['rx_errors'] + $iface['tx_errors'];
        }
        if ($total_errors > 1000) $health_score -= 10;
        elseif ($total_errors > 100) $health_score -= 5;
        
        // Netwatch factor (if any host is down)
        foreach ($response['data']['netwatch'] as $watch) {
            if ($watch['status'] !== 'up') {
                $health_score -= 5;
                break;
            }
        }
        
        // Critical logs factor
        if (count($response['data']['logs']) > 5) $health_score -= 10;
        elseif (count($response['data']['logs']) > 2) $health_score -= 5;
        
        $response['data']['health_score'] = max(0, min(100, $health_score));
        
        // Disconnect API
        $API->disconnect();
        
    } else {
        $response['status'] = 503;
        $response['data']['error'] = 'Failed to connect to MikroTik';
    }
    
} catch (Exception $e) {
    $response['status'] = 500;
    $response['data']['error'] = $e->getMessage();
}

echo json_encode($response);
?>
