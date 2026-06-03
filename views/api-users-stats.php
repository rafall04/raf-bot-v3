<?php
/**
 * Users Statistics API
 * Returns comprehensive PPPoE and Hotspot user data from MikroTik
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

// Initialize response
$response = [
    'status' => 200,
    'timestamp' => date('c'),
    'data' => [
        'connected' => false,
        'pppoe' => [
            'total' => 0,
            'online' => 0,
            'offline' => 0,
            'active_sessions' => [],
            'offline_users' => []
        ],
        'hotspot' => [
            'total' => 0,
            'active' => 0,
            'inactive' => 0,
            'active_sessions' => [],
            'profiles' => []
        ],
        'summary' => [
            'total_users' => 0,
            'total_active' => 0,
            'bandwidth_used' => 0
        ]
    ]
];

try {
    // Include connection
    require_once('conn.php');
    
    if ($API->connected) {
        $response['data']['connected'] = true;
        
        // ===== PPPoE STATISTICS =====
        
        // 1. Get all PPPoE secrets (configured users)
        $pppSecrets = $API->comm('/ppp/secret/print');
        
        if ($pppSecrets && is_array($pppSecrets)) {
            $response['data']['pppoe']['total'] = count($pppSecrets);
            
            // Create array of all secret names for quick lookup
            $secretNames = [];
            foreach ($pppSecrets as $secret) {
                $secretNames[] = $secret['name'] ?? '';
                
                // Store user info
                $response['data']['pppoe']['users'][] = [
                    'name' => $secret['name'] ?? '',
                    'profile' => $secret['profile'] ?? 'default',
                    'service' => $secret['service'] ?? 'pppoe',
                    'disabled' => $secret['disabled'] ?? false,
                    'comment' => $secret['comment'] ?? ''
                ];
            }
        }
        
        // 2. Get active PPPoE connections
        $pppActive = $API->comm('/ppp/active/print');
        
        if ($pppActive && is_array($pppActive)) {
            $activeNames = [];
            
            foreach ($pppActive as $active) {
                $name = $active['name'] ?? '';
                $activeNames[] = $name;
                
                // Calculate session duration
                $uptime = $active['uptime'] ?? '0s';
                
                // Parse bytes for bandwidth calculation
                $rx_bytes = 0;
                $tx_bytes = 0;
                
                // Handle different byte format in response
                if (isset($active['bytes'])) {
                    $bytes_parts = explode('/', $active['bytes']);
                    $rx_bytes = intval($bytes_parts[0] ?? 0);
                    $tx_bytes = intval($bytes_parts[1] ?? 0);
                }
                
                $response['data']['pppoe']['active_sessions'][] = [
                    'name' => $name,
                    'service' => $active['service'] ?? 'pppoe',
                    'caller_id' => $active['caller-id'] ?? '',
                    'address' => $active['address'] ?? '',
                    'uptime' => $uptime,
                    'rx_bytes' => $rx_bytes,
                    'tx_bytes' => $tx_bytes,
                    'rx_mb' => round($rx_bytes / 1048576, 2),
                    'tx_mb' => round($tx_bytes / 1048576, 2),
                    'encoding' => $active['encoding'] ?? ''
                ];
                
                $response['data']['summary']['bandwidth_used'] += $rx_bytes + $tx_bytes;
            }
            
            $response['data']['pppoe']['online'] = count($activeNames);
            
            // Find offline users
            foreach ($secretNames as $secretName) {
                if (!in_array($secretName, $activeNames)) {
                    $response['data']['pppoe']['offline_users'][] = $secretName;
                }
            }
            
            $response['data']['pppoe']['offline'] = count($response['data']['pppoe']['offline_users']);
        }
        
        // ===== HOTSPOT STATISTICS =====
        
        // 3. Get all Hotspot users
        $hotspotUsers = $API->comm('/ip/hotspot/user/print');
        
        if ($hotspotUsers && is_array($hotspotUsers)) {
            $response['data']['hotspot']['total'] = count($hotspotUsers);
            
            // Store hotspot user details
            foreach ($hotspotUsers as $user) {
                $response['data']['hotspot']['users'][] = [
                    'name' => $user['name'] ?? '',
                    'password' => isset($user['password']) ? '***' : '', // Hide actual password
                    'profile' => $user['profile'] ?? 'default',
                    'uptime_limit' => $user['limit-uptime'] ?? '',
                    'bytes_limit' => $user['limit-bytes-total'] ?? '',
                    'disabled' => $user['disabled'] ?? false,
                    'comment' => $user['comment'] ?? ''
                ];
            }
        }
        
        // 4. Get active Hotspot sessions
        $hotspotActive = $API->comm('/ip/hotspot/active/print');
        
        if ($hotspotActive && is_array($hotspotActive)) {
            $response['data']['hotspot']['active'] = count($hotspotActive);
            
            foreach ($hotspotActive as $session) {
                // Parse bytes
                $rx_bytes = intval($session['bytes-in'] ?? 0);
                $tx_bytes = intval($session['bytes-out'] ?? 0);
                
                $response['data']['hotspot']['active_sessions'][] = [
                    'user' => $session['user'] ?? '',
                    'address' => $session['address'] ?? '',
                    'mac_address' => $session['mac-address'] ?? '',
                    'uptime' => $session['uptime'] ?? '0s',
                    'idle_time' => $session['idle-time'] ?? '0s',
                    'rx_bytes' => $rx_bytes,
                    'tx_bytes' => $tx_bytes,
                    'rx_mb' => round($rx_bytes / 1048576, 2),
                    'tx_mb' => round($tx_bytes / 1048576, 2),
                    'server' => $session['server'] ?? ''
                ];
                
                $response['data']['summary']['bandwidth_used'] += $rx_bytes + $tx_bytes;
            }
            
            $response['data']['hotspot']['inactive'] = $response['data']['hotspot']['total'] - $response['data']['hotspot']['active'];
        }
        
        // 5. Get Hotspot profiles
        $hotspotProfiles = $API->comm('/ip/hotspot/user/profile/print');
        
        if ($hotspotProfiles && is_array($hotspotProfiles)) {
            foreach ($hotspotProfiles as $profile) {
                $response['data']['hotspot']['profiles'][] = [
                    'name' => $profile['name'] ?? '',
                    'rate_limit' => $profile['rate-limit'] ?? '',
                    'session_timeout' => $profile['session-timeout'] ?? '',
                    'idle_timeout' => $profile['idle-timeout'] ?? '',
                    'keepalive_timeout' => $profile['keepalive-timeout'] ?? '',
                    'shared_users' => $profile['shared-users'] ?? 1
                ];
            }
        }
        
        // ===== SUMMARY =====
        $response['data']['summary']['total_users'] = 
            $response['data']['pppoe']['total'] + $response['data']['hotspot']['total'];
            
        $response['data']['summary']['total_active'] = 
            $response['data']['pppoe']['online'] + $response['data']['hotspot']['active'];
            
        // Convert bandwidth to human readable
        $response['data']['summary']['bandwidth_used'] = [
            'bytes' => $response['data']['summary']['bandwidth_used'],
            'gb' => round($response['data']['summary']['bandwidth_used'] / 1073741824, 2),
            'mb' => round($response['data']['summary']['bandwidth_used'] / 1048576, 2)
        ];
        
        // Calculate usage percentage
        if ($response['data']['summary']['total_users'] > 0) {
            $response['data']['summary']['active_percentage'] = round(
                ($response['data']['summary']['total_active'] / $response['data']['summary']['total_users']) * 100, 
                1
            );
        } else {
            $response['data']['summary']['active_percentage'] = 0;
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
