<?php
/**
 * Traffic Statistics API
 * Returns real-time network traffic data from MikroTik
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

// Initialize response
$response = [
    'status' => 200,
    'timestamp' => date('c'),
    'data' => [
        'connected' => false,
        'total_download' => 0,
        'total_upload' => 0,
        'current_download_rate' => 0,
        'current_upload_rate' => 0,
        'interfaces' => [],
        'queues' => [],
        'connections' => 0
    ]
];

// Session to store previous values for rate calculation
session_start();

try {
    // Include connection
    require_once('conn.php');
    
    if ($API->connected) {
        $response['data']['connected'] = true;
        
        // 1. Get Interface Traffic
        $interfaces = $API->comm('/interface/print');
        
        $total_rx = 0;
        $total_tx = 0;
        $current_time = time();
        
        if ($interfaces && is_array($interfaces)) {
            foreach ($interfaces as $iface) {
                $name = $iface['name'] ?? '';
                $type = $iface['type'] ?? '';
                
                // Skip loopback and internal interfaces
                if ($name === 'lo' || strpos($name, 'dummy') !== false) {
                    continue;
                }
                
                $rx_bytes = intval($iface['rx-byte'] ?? 0);
                $tx_bytes = intval($iface['tx-byte'] ?? 0);
                
                $total_rx += $rx_bytes;
                $total_tx += $tx_bytes;
                
                // Calculate rate if we have previous data
                $rx_rate = 0;
                $tx_rate = 0;
                
                if (isset($_SESSION['iface_stats'][$name])) {
                    $prev = $_SESSION['iface_stats'][$name];
                    $time_diff = $current_time - $prev['time'];
                    
                    if ($time_diff > 0) {
                        // Calculate bits per second
                        $rx_rate = ($rx_bytes - $prev['rx']) * 8 / $time_diff;
                        $tx_rate = ($tx_bytes - $prev['tx']) * 8 / $time_diff;
                        
                        // Ensure positive values (handle counter resets)
                        $rx_rate = max(0, $rx_rate);
                        $tx_rate = max(0, $tx_rate);
                    }
                }
                
                // Store current values for next calculation
                $_SESSION['iface_stats'][$name] = [
                    'rx' => $rx_bytes,
                    'tx' => $tx_bytes,
                    'time' => $current_time
                ];
                
                // Only include active interfaces
                if ($iface['running'] === 'true' || $iface['running'] === true) {
                    $response['data']['interfaces'][] = [
                        'name' => $name,
                        'type' => $type,
                        'rx_bytes' => $rx_bytes,
                        'tx_bytes' => $tx_bytes,
                        'rx_rate' => round($rx_rate),  // bits per second
                        'tx_rate' => round($tx_rate),  // bits per second
                        'rx_rate_mbps' => round($rx_rate / 1048576, 2), // Mbps
                        'tx_rate_mbps' => round($tx_rate / 1048576, 2), // Mbps
                        'comment' => $iface['comment'] ?? ''
                    ];
                    
                    $response['data']['current_download_rate'] += $rx_rate;
                    $response['data']['current_upload_rate'] += $tx_rate;
                }
            }
        }
        
        // Convert totals to human readable
        $response['data']['total_download'] = [
            'bytes' => $total_rx,
            'gb' => round($total_rx / 1073741824, 2), // GB
            'mb' => round($total_rx / 1048576, 2) // MB
        ];
        
        $response['data']['total_upload'] = [
            'bytes' => $total_tx,
            'gb' => round($total_tx / 1073741824, 2), // GB
            'mb' => round($total_tx / 1048576, 2) // MB
        ];
        
        // Convert rates to Mbps
        $response['data']['current_download_rate'] = [
            'bps' => round($response['data']['current_download_rate']),
            'mbps' => round($response['data']['current_download_rate'] / 1048576, 2),
            'kbps' => round($response['data']['current_download_rate'] / 1024, 2)
        ];
        
        $response['data']['current_upload_rate'] = [
            'bps' => round($response['data']['current_upload_rate']),
            'mbps' => round($response['data']['current_upload_rate'] / 1048576, 2),
            'kbps' => round($response['data']['current_upload_rate'] / 1024, 2)
        ];
        
        // 2. Get Simple Queue Stats (for per-user bandwidth)
        $queues = $API->comm('/queue/simple/print');
        
        if ($queues && is_array($queues)) {
            $active_queues = 0;
            foreach ($queues as $queue) {
                // Check if queue is active (has traffic)
                $bytes = intval($queue['bytes'] ?? 0);
                if ($bytes > 0 || (isset($queue['rate']) && $queue['rate'] !== '0bps/0bps')) {
                    $active_queues++;
                    
                    // Parse rate (format: "upload/download")
                    $rate_parts = explode('/', $queue['rate'] ?? '0bps/0bps');
                    $upload_rate = $rate_parts[0] ?? '0bps';
                    $download_rate = $rate_parts[1] ?? '0bps';
                    
                    $response['data']['queues'][] = [
                        'name' => $queue['name'] ?? '',
                        'target' => $queue['target'] ?? '',
                        'rate' => $queue['rate'] ?? '0bps/0bps',
                        'upload' => $upload_rate,
                        'download' => $download_rate,
                        'bytes' => $bytes,
                        'packets' => intval($queue['packets'] ?? 0),
                        'disabled' => $queue['disabled'] ?? false
                    ];
                }
            }
            $response['data']['active_queues'] = $active_queues;
            $response['data']['total_queues'] = count($queues);
        }
        
        // 3. Get Connection Tracking Stats
        $conntrack = $API->comm('/ip/firewall/connection/print', [
            'count-only' => ''
        ]);
        
        if (isset($conntrack['after']['ret'])) {
            $response['data']['connections'] = intval($conntrack['after']['ret']);
        }
        
        // 4. Get Torch Data for Top Talkers (if needed)
        // This is resource intensive, so only run if specifically requested
        if (isset($_GET['torch']) && $_GET['torch'] === 'true') {
            // Run torch for 2 seconds on main interface
            $torch = $API->comm('/tool/torch', [
                'interface' => 'ether1', // Or your WAN interface
                'src-address' => '0.0.0.0/0',
                'dst-address' => '0.0.0.0/0',
                'duration' => '2'
            ]);
            
            if ($torch && is_array($torch)) {
                $response['data']['top_talkers'] = [];
                foreach (array_slice($torch, 0, 10) as $talker) {
                    $response['data']['top_talkers'][] = [
                        'src' => $talker['src-address'] ?? '',
                        'dst' => $talker['dst-address'] ?? '',
                        'tx_rate' => $talker['tx'] ?? 0,
                        'rx_rate' => $talker['rx'] ?? 0
                    ];
                }
            }
        }
        
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
