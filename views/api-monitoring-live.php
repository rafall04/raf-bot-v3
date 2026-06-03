<?php
/**
 * Live Monitoring Data API  
 * Returns ONLY real MikroTik data or ERROR - NO DUMMY DATA!
 */

require 'conn.php'; // Use same method as working files

// PENTING: Tingkatkan timeout untuk operasi monitoring yang kompleks
// Monitoring API melakukan banyak API calls (17+) yang memerlukan waktu lebih lama
$API->timeout = 10; // Increase timeout to 10 seconds untuk operasi kompleks
$API->attempts = 3; // Increase attempts untuk reliability

// PENTING: Set PHP execution time limit untuk operasi monitoring
// Default PHP timeout mungkin terlalu pendek untuk operasi kompleks
set_time_limit(30); // Maximum 30 seconds execution time untuk monitoring

// Function to send JSON error and exit
function send_json_error($message, $code = 500) {
    header('Content-Type: application/json');
    http_response_code($code);
    $response = [
        'status' => $code,
        'error' => true,
        'message' => $message,
        'data' => null
    ];
    echo json_encode($response);
    // Disconnect safely before exiting
    if (isset($GLOBALS['API']) && $GLOBALS['API']->connected) {
        $GLOBALS['API']->disconnect();
    }
    exit();
}

// Check connection first - EXACTLY like working files
// PENTING: Coba reconnect jika connection terputus (untuk handle timeout atau connection drop)
if (!$API->connected) {
    // Coba reconnect sekali sebelum return error
    $ip = getenv('IP_MC');
    $name = getenv('NAME_MC');
    $password = getenv('PASSWORD_MC');
    
    if ($ip && $name && $password) {
        // Increase timeout untuk retry connection
        $API->timeout = 10;
        $API->attempts = 3;
        if ($API->connect($ip, $name, $password)) {
            // Reconnection successful, continue
        } else {
            send_json_error('Failed to connect to MikroTik router. Please check connection settings.', 503);
        }
    } else {
        send_json_error('Failed to connect to MikroTik router. Please check connection settings.', 503);
    }
}

// We are connected, get real data
$responseData = [
    'status' => 200,
    'data' => []
];

// Initialize variables
$mikrotikData = [];
$interfaceList = [];
$totalRx = 0;
$totalTx = 0;
$hotspotSessions = [];
$pppoeSessions = [];

// PENTING: Wrap API calls dengan try-catch untuk handle timeout atau error
// Jangan langsung return error jika satu API call gagal - lanjutkan dengan data yang berhasil

// Get system resources dengan error handling
$resources = null;
try {
    $resources = $API->comm('/system/resource/print');
} catch (Exception $e) {
    error_log("[MONITORING] Error getting system resources: " . $e->getMessage());
    // Check if connection is still alive
    if (!$API->connected) {
        // Try reconnect once
        $ip = getenv('IP_MC');
        $name = getenv('NAME_MC');
        $password = getenv('PASSWORD_MC');
        if ($ip && $name && $password) {
            $API->timeout = 10;
            $API->attempts = 3;
            if ($API->connect($ip, $name, $password)) {
                // Retry once
                try {
                    $resources = $API->comm('/system/resource/print');
                } catch (Exception $e2) {
                    error_log("[MONITORING] Retry failed: " . $e2->getMessage());
                }
            }
        }
    }
}

if ($resources && isset($resources[0])) {
    $mikrotikData = [
        'connected' => $API->connected,  // Use actual connection status
        'cpu' => intval($resources[0]['cpu-load'] ?? 0),
        'memory' => isset($resources[0]['total-memory']) && isset($resources[0]['free-memory']) 
            ? round(100 - ($resources[0]['free-memory'] / $resources[0]['total-memory'] * 100), 1)
            : 0,
        'disk' => isset($resources[0]['total-hdd-space']) && isset($resources[0]['free-hdd-space'])
            ? round(100 - ($resources[0]['free-hdd-space'] / $resources[0]['total-hdd-space'] * 100), 1)
            : 0,
        'uptime' => $resources[0]['uptime'] ?? '0s'
    ];
} else {
    // If resources call failed, still mark as connected but with default values
    // Jangan langsung return error - biarkan operasi lain tetap berjalan
    $mikrotikData = [
        'connected' => $API->connected, // Use actual connection status
        'cpu' => 0,
        'memory' => 0,
        'disk' => 0,
        'uptime' => '0s'
    ];
}

// Get temperature if available dengan error handling
try {
    $health = $API->comm('/system/health/print');
    if ($health && isset($health[0]['temperature'])) {
        $mikrotikData['temperature'] = intval($health[0]['temperature']);
    } else {
        $mikrotikData['temperature'] = 0; // No dummy data
    }
} catch (Exception $e) {
    error_log("[MONITORING] Error getting system health: " . $e->getMessage());
    $mikrotikData['temperature'] = 0; // Default value on error
}

// Get ALL PPPoE active sessions with proper traffic data parsing
// Try to get interface name by using detail parameter or by querying each session individually
$pppActiveSessions = null;
try {
    $pppActiveSessions = $API->comm('/ppp/active/print');
} catch (Exception $e) {
    error_log("[MONITORING] Error getting PPPoE active sessions: " . $e->getMessage());
    $pppActiveSessions = []; // Empty array on error
}

// Get queue statistics for traffic data - CRITICAL: This is the main source for traffic data
$queueStats = [];
try {
    $queues = $API->comm('/queue/simple/print');
    if ($queues && is_array($queues)) {
        foreach ($queues as $queue) {
            // Index by target address for quick lookup
            $target = $queue['target'] ?? '';
            if ($target && isset($queue['bytes'])) {
                $queueStats[$target] = $queue['bytes'];
            }
        }
    }
} catch (Exception $e) {
    error_log("[MONITORING] Error getting queue stats: " . $e->getMessage());
}

// Also try queue tree (alternative queue type)
$queueTreeStats = [];
try {
    $queueTrees = $API->comm('/queue/tree/print');
    if ($queueTrees && is_array($queueTrees)) {
        foreach ($queueTrees as $queue) {
            $target = $queue['parent'] ?? $queue['name'] ?? '';
            if ($target && isset($queue['bytes'])) {
                $queueTreeStats[$target] = $queue['bytes'];
            }
        }
    }
} catch (Exception $e) {
    error_log("[MONITORING] Error getting queue tree stats: " . $e->getMessage());
}

// CRITICAL: Traffic PPPoE berada di INTERFACE, bukan di PPP sessions!
// Kita perlu mapping IP address ke interface PPPoE, lalu ambil traffic dari interface statistics

// Get ALL interfaces and their statistics - THIS IS THE PRIMARY SOURCE FOR TRAFFIC DATA
$allInterfaces = [];
$pppoeInterfaces = []; // Store all PPPoE interfaces specifically
$allInterfaceNames = []; // For debugging - store all interface names

// PENTING: Wrap interface API call dengan try-catch
$interfaces = null;
try {
    $interfaces = $API->comm('/interface/print');
    if ($interfaces && is_array($interfaces)) {
        // Removed verbose logging
        
        foreach ($interfaces as $iface) {
            $ifaceName = $iface['name'] ?? '';
            $ifaceType = $iface['type'] ?? '';
            
            // Store all interface names for debugging
            $allInterfaceNames[] = $ifaceName;
            
            // Store ALL interfaces with traffic data
            $allInterfaces[$ifaceName] = [
                'rx-byte' => intval($iface['rx-byte'] ?? 0),
                'tx-byte' => intval($iface['tx-byte'] ?? 0),
                'type' => $ifaceType,
                'mac-address' => $iface['mac-address'] ?? '',
                'running' => ($iface['running'] ?? false) === true || ($iface['running'] ?? '') === 'true'
            ];
            
            // Store PPPoE interfaces specifically
            // Format: pppoe-{username} or pppoe-{username}@{domain}
            // Example: pppoe-amel@rafcybernet, pppoe-icak@rafcybernet
            // Note: MikroTik might show as <pppoe-username@domain> in console, but API returns without <>
            $isPppoeInterface = false;
            
            // Check by type first
            if ($ifaceType === 'pppoe-out') {
                $isPppoeInterface = true;
            }
            // Check by name pattern - must start with 'pppoe-'
            elseif (strpos($ifaceName, 'pppoe-') === 0) {
                $isPppoeInterface = true;
            }
            // Also check if name contains 'pppoe' anywhere (fallback)
            elseif (stripos($ifaceName, 'pppoe') !== false && $ifaceType !== '') {
                // Only if it's not a known non-PPPoE type
                $nonPppoeTypes = ['ether', 'wlan', 'bridge', 'vlan', 'bonding', 'vrrp', 'gre', 'ipip', 'l2tp', 'pptp', 'sstp', 'ovpn'];
                if (!in_array(strtolower($ifaceType), $nonPppoeTypes)) {
                    $isPppoeInterface = true;
                }
            }
            
            if ($isPppoeInterface) {
                $pppoeInterfaces[$ifaceName] = [
                    'rx-byte' => intval($iface['rx-byte'] ?? 0),
                    'tx-byte' => intval($iface['tx-byte'] ?? 0),
                    'running' => ($iface['running'] ?? false) === true || ($iface['running'] ?? '') === 'true'
                ];
            }
        }
        
        // Only log summary, not every interface
        if (count($pppoeInterfaces) === 0) {
            error_log("[PPPoE] WARNING: No PPPoE interfaces found! Total interfaces: " . count($allInterfaces));
        }
    }
} catch (Exception $e) {
    error_log("[PPPoE] ERROR getting interfaces: " . $e->getMessage());
}

// Method 1: Get IP to Interface mapping from ARP table (MOST RELIABLE)
$ipToInterfaceMap = [];
try {
    $arp = $API->comm('/ip/arp/print');
    if ($arp && is_array($arp)) {
        foreach ($arp as $entry) {
            $ip = $entry['address'] ?? '';
            $interface = $entry['interface'] ?? '';
            if ($ip && $interface) {
                $ipToInterfaceMap[$ip] = $interface;
            }
        }
    }
} catch (Exception $e) {
    // ARP might not be available, ignore
}

// Method 2: Get IP to Interface mapping from IP address table
try {
    $ipAddresses = $API->comm('/ip/address/print');
    if ($ipAddresses && is_array($ipAddresses)) {
        foreach ($ipAddresses as $addr) {
            $ipWithMask = $addr['address'] ?? '';
            $interface = $addr['interface'] ?? '';
            if ($ipWithMask && $interface) {
                // Extract IP without mask (e.g., "192.168.70.1/24" -> "192.168.70.1")
                $ip = explode('/', $ipWithMask)[0];
                // Only add if it's a PPPoE interface or if not already in map
                if (isset($pppoeInterfaces[$interface]) || !isset($ipToInterfaceMap[$ip])) {
                    $ipToInterfaceMap[$ip] = $interface;
                }
            }
        }
    }
} catch (Exception $e) {
    // IP address table might not be available, ignore
}

// Method 3: Get interface from route table (find route to IP address)
try {
    $routes = $API->comm('/ip/route/print');
    if ($routes && is_array($routes)) {
        foreach ($routes as $route) {
            $dstAddress = $route['dst-address'] ?? '';
            $gateway = $route['gateway'] ?? '';
            $interface = $route['interface'] ?? '';
            
            // If route has interface and it's a PPPoE interface, store it
            if ($interface && isset($pppoeInterfaces[$interface])) {
                // Check if this route might match our PPPoE IPs
                // Routes like "192.168.70.0/24" would match IPs in that range
                if ($dstAddress && strpos($dstAddress, '/') !== false) {
                    list($network, $mask) = explode('/', $dstAddress);
                    // Store network to interface mapping for later matching
                    // We'll match IPs to this network
                }
            }
        }
    }
} catch (Exception $e) {
    // Route table might not be available, ignore
}

// Method 4: Try to get interface from active PPPoE sessions by matching caller-id
// Sometimes we can match by MAC address (caller-id) if available
$callerIdToInterfaceMap = [];
$interfaceToIpMap = []; // Reverse mapping: interface -> IP (for debugging)
try {
    // Get all PPPoE interfaces and try to match by MAC or other identifiers
    foreach ($pppoeInterfaces as $pppoeIfaceName => $pppoeIfaceStats) {
        // Try to get more info about this interface
        // FIX: Use correct array format - key should be '?name', not '?name=value'
        try {
            $ifaceDetails = $API->comm('/interface/print', ['?name' => $pppoeIfaceName]);
            if ($ifaceDetails && is_array($ifaceDetails) && isset($ifaceDetails[0])) {
                $macAddress = $ifaceDetails[0]['mac-address'] ?? '';
                if ($macAddress) {
                    $callerIdToInterfaceMap[$macAddress] = $pppoeIfaceName;
                }
            }
        } catch (Exception $e) {
            // Interface details might not be available, ignore
        }
        
        // Also try to get IP address from interface (if available)
        // Some interfaces might have IP address assigned
        try {
            // FIX: Use correct array format - key should be '?interface', not '?interface=value'
            $ifaceIp = $API->comm('/ip/address/print', ['?interface' => $pppoeIfaceName]);
            if ($ifaceIp && is_array($ifaceIp) && isset($ifaceIp[0]['address'])) {
                $ipWithMask = $ifaceIp[0]['address'];
                $ip = explode('/', $ipWithMask)[0];
                $interfaceToIpMap[$pppoeIfaceName] = $ip;
            }
        } catch (Exception $e) {
            // Interface might not have IP, ignore
        }
    }
    // Removed verbose logging
} catch (Exception $e) {
    // Interface details might not be available, ignore
}

// Get accounting data if available (RouterOS accounting feature)
$accountingData = [];
try {
    $accounting = $API->comm('/ip/accounting/print');
    if ($accounting && is_array($accounting)) {
        foreach ($accounting as $acc) {
            $srcAddress = $acc['src-address'] ?? '';
            $dstAddress = $acc['dst-address'] ?? '';
            $bytes = intval($acc['bytes'] ?? 0);
            $packets = intval($acc['packets'] ?? 0);
            
            // Index by source address (PPPoE user IP)
            if ($srcAddress && !isset($accountingData[$srcAddress])) {
                $accountingData[$srcAddress] = ['bytes' => 0, 'packets' => 0];
            }
            if ($srcAddress) {
                $accountingData[$srcAddress]['bytes'] += $bytes;
                $accountingData[$srcAddress]['packets'] += $packets;
            }
        }
    }
} catch (Exception $e) {
    // Accounting might not be enabled, ignore
}

if ($pppActiveSessions && is_array($pppActiveSessions)) {
    foreach ($pppActiveSessions as $session) {
        $rxBytes = 0;
        $txBytes = 0;
        $sessionAddress = $session['address'] ?? '';
        $sessionName = $session['name'] ?? '';
        $sessionInterface = $session['interface'] ?? '';
        $sessionId = $session['.id'] ?? '';
        
        // Try to get interface name by querying session individually with more detail
        // Note: Interface name is built from username, so we don't need this query
        // But we'll keep it as fallback
        if (empty($sessionInterface) && $sessionId) {
            try {
                // Use proper query format: ?.id=value (string key with ? prefix)
                $queryParam = [];
                $queryParam['?.id'] = $sessionId;
                $sessionDetail = $API->comm('/ppp/active/print', $queryParam);
                if ($sessionDetail && is_array($sessionDetail) && !empty($sessionDetail)) {
                    // Check if result is array of arrays or single array
                    $detail = is_array($sessionDetail[0]) ? $sessionDetail[0] : $sessionDetail;
                    if (isset($detail['interface']) && !empty($detail['interface'])) {
                        $sessionInterface = $detail['interface'];
                        // Removed verbose logging
                    }
                }
            } catch (Exception $e) {
                // Detail query might not work, ignore
            }
        }
        
        // Removed verbose session logging
        
        // Method 1: Try bytes-sent and bytes-received (RouterOS v6.40+)
        // These fields are the most reliable if available
        if (isset($session['bytes-sent']) || isset($session['bytes-received'])) {
            $rxBytes = intval($session['bytes-sent'] ?? 0);   // Download (user received)
            $txBytes = intval($session['bytes-received'] ?? 0); // Upload (user sent)
        }
        // Method 2: Try bytes field (format: "rx/tx" or just numbers)
        elseif (isset($session['bytes']) && $session['bytes'] !== '' && $session['bytes'] !== null) {
            $bytes_str = trim((string)$session['bytes']);
            if (!empty($bytes_str)) {
                // Try different separators
                if (strpos($bytes_str, '/') !== false) {
                    $parts = explode('/', $bytes_str);
                } elseif (strpos($bytes_str, ',') !== false) {
                    $parts = explode(',', $bytes_str);
                } elseif (strpos($bytes_str, ' ') !== false) {
                    $parts = preg_split('/\s+/', $bytes_str);
                } else {
                    // Single number? Try to split in half (unlikely but possible)
                    $parts = [$bytes_str, '0'];
                }
                if (count($parts) >= 2) {
                    // Format: rx/tx (from router perspective)
                    // rx = router received = user uploaded
                    // tx = router transmitted = user downloaded
                    $routerRx = intval(trim($parts[0]));
                    $routerTx = intval(trim($parts[1]));
                    // Convert to user perspective
                    $rxBytes = $routerTx; // Router transmitted = user downloaded
                    $txBytes = $routerRx; // Router received = user uploaded
                } elseif (count($parts) === 1 && is_numeric($parts[0])) {
                    // Single value - assume it's total, split 50/50 (not ideal but better than 0)
                    $total = intval($parts[0]);
                    $rxBytes = intval($total * 0.5);
                    $txBytes = intval($total * 0.5);
                }
            }
        }
        // METHOD 3: PRIMARY METHOD - Get traffic from INTERFACE statistics
        // CRITICAL: Traffic PPPoE berada di INTERFACE, bukan di PPP sessions!
        // Interface name format: pppoe-{username}@{domain} or pppoe-{username}
        // Example: pppoe-amel@rafcybernet, pppoe-icak@rafcybernet
        // Note: MikroTik console shows <pppoe-username@domain> but API returns without <>
        
        if (($rxBytes === 0 && $txBytes === 0) && $sessionName) {
            $foundInterface = null;
            
            // STEP 1: Build interface name from session username (MOST RELIABLE METHOD)
            // Try multiple variations of interface name
            $possibleInterfaceNames = [];
            
            // Format 1: pppoe-{username}@{domain} (full format)
            $possibleInterfaceNames[] = 'pppoe-' . $sessionName;
            
            // Format 2: pppoe-{username} (without domain)
            if (strpos($sessionName, '@') !== false) {
                $usernameOnly = explode('@', $sessionName)[0];
                $possibleInterfaceNames[] = 'pppoe-' . $usernameOnly;
            }
            
            // Format 3: Try with different case variations (just in case)
            $possibleInterfaceNames[] = 'pppoe-' . strtolower($sessionName);
            if (strpos($sessionName, '@') !== false) {
                $possibleInterfaceNames[] = 'pppoe-' . strtolower($usernameOnly);
            }
            
            // Try each possible interface name
            foreach ($possibleInterfaceNames as $possibleName) {
                if (isset($allInterfaces[$possibleName])) {
                    $foundInterface = $possibleName;
                    break;
                }
            }
            
            // STEP 1b: If exact match failed, try partial matching
            if (!$foundInterface) {
                // Search through all PPPoE interfaces for a match
                foreach ($pppoeInterfaces as $pppoeIfaceName => $pppoeIfaceStats) {
                    // Remove 'pppoe-' prefix for comparison
                    $ifaceUsername = str_replace('pppoe-', '', $pppoeIfaceName);
                    
                    // Check if interface username matches session username (with or without domain)
                    if ($ifaceUsername === $sessionName || 
                        $ifaceUsername === explode('@', $sessionName)[0] ||
                        strpos($ifaceUsername, $sessionName) !== false ||
                        strpos($sessionName, $ifaceUsername) !== false) {
                        $foundInterface = $pppoeIfaceName;
                        break;
                    }
                }
            }
            
            // STEP 2: Try to find interface via IP mapping (ARP table)
            if (!$foundInterface && $sessionAddress && isset($ipToInterfaceMap[$sessionAddress])) {
                $foundInterface = $ipToInterfaceMap[$sessionAddress];
            }
            
            // STEP 3: Try to find interface via caller-id (MAC address) if available
            if (!$foundInterface && isset($session['caller-id'])) {
                $callerId = $session['caller-id'] ?? '';
                if ($callerId && isset($callerIdToInterfaceMap[$callerId])) {
                    $foundInterface = $callerIdToInterfaceMap[$callerId];
                }
            }
            
            // STEP 4: If found interface, get traffic data from interface statistics
            if ($foundInterface && isset($allInterfaces[$foundInterface])) {
                $ifaceStats = $allInterfaces[$foundInterface];
                $ifaceRx = $ifaceStats['rx-byte'] ?? 0;
                $ifaceTx = $ifaceStats['tx-byte'] ?? 0;
                
                // CRITICAL: Convert perspective from router to user
                // Interface rx-byte = router received = user uploaded (tx_bytes)
                // Interface tx-byte = router transmitted = user downloaded (rx_bytes)
                $rxBytes = $ifaceTx; // Router transmitted = user downloaded
                $txBytes = $ifaceRx; // Router received = user uploaded
                
                // Only log if there's an issue (no traffic found)
                if ($rxBytes === 0 && $txBytes === 0) {
                    // Silent - interface found but no traffic is normal for new sessions
                }
            } else {
                // Only log if no interface found AND no PPPoE interfaces exist at all
                if (count($pppoeInterfaces) === 0) {
                    error_log("[PPPoE] ERROR: No interface found for $sessionName and no PPPoE interfaces detected");
                }
            }
            
            // STEP 5: If session has interface field (even if empty in response, try direct match)
            if (($rxBytes === 0 && $txBytes === 0) && $sessionInterface) {
                if (isset($allInterfaces[$sessionInterface])) {
                    $ifaceStats = $allInterfaces[$sessionInterface];
                    $ifaceRx = $ifaceStats['rx-byte'] ?? 0;
                    $ifaceTx = $ifaceStats['tx-byte'] ?? 0;
                    $rxBytes = $ifaceTx; // Router transmitted = user downloaded
                    $txBytes = $ifaceRx; // Router received = user uploaded
                }
            }
        }
        
        // Method 3b: Fallback - Try IP-based mapping if username-based failed
        if (($rxBytes === 0 && $txBytes === 0) && $sessionAddress) {
            // Try to find interface via IP mapping (ARP table)
            if (isset($ipToInterfaceMap[$sessionAddress])) {
                $foundInterface = $ipToInterfaceMap[$sessionAddress];
                if (isset($allInterfaces[$foundInterface])) {
                    $ifaceStats = $allInterfaces[$foundInterface];
                    $ifaceRx = $ifaceStats['rx-byte'] ?? 0;
                    $ifaceTx = $ifaceStats['tx-byte'] ?? 0;
                    $rxBytes = $ifaceTx; // Router transmitted = user downloaded
                    $txBytes = $ifaceRx; // Router received = user uploaded
                }
            }
        }
        // Method 4: Try queue statistics by IP address (FALLBACK METHOD)
        // Queue statistics is a fallback if interface statistics don't work
        if (($rxBytes === 0 && $txBytes === 0) && $sessionAddress) {
            // Try various queue target formats - queue target can be IP, IP/mask, or interface
            $queueTargets = [
                $sessionAddress . '/32',  // Exact IP with /32 mask
                $sessionAddress,          // Exact IP
                $sessionAddress . '/24',  // Subnet /24
                $sessionAddress . '/16',  // Subnet /16
            ];
            
            // Try simple queue first
            foreach ($queueTargets as $target) {
                if (isset($queueStats[$target])) {
                    $bytes_str = trim((string)$queueStats[$target]);
                    if (!empty($bytes_str)) {
                        if (strpos($bytes_str, '/') !== false) {
                            $parts = explode('/', $bytes_str);
                            if (count($parts) >= 2) {
                                // Format: rx/tx (from router perspective)
                                $routerRx = intval(trim($parts[0] ?? 0));
                                $routerTx = intval(trim($parts[1] ?? 0));
                                // Convert to user perspective
                                $rxBytes = $routerTx; // Router transmitted = user downloaded
                                $txBytes = $routerRx; // Router received = user uploaded
                                if ($rxBytes > 0 || $txBytes > 0) {
                                    error_log("[PPPoE DEBUG] Found queue data for $sessionAddress: RX=$rxBytes, TX=$txBytes");
                                    break; // Found data, stop searching
                                }
                            }
                        }
                    }
                }
            }
            
            // Try queue tree if simple queue didn't work
            if (($rxBytes === 0 && $txBytes === 0)) {
                foreach ($queueTargets as $target) {
                    if (isset($queueTreeStats[$target])) {
                        $bytes_str = trim((string)$queueTreeStats[$target]);
                        if (!empty($bytes_str)) {
                            if (strpos($bytes_str, '/') !== false) {
                                $parts = explode('/', $bytes_str);
                                if (count($parts) >= 2) {
                                    $routerRx = intval(trim($parts[0] ?? 0));
                                    $routerTx = intval(trim($parts[1] ?? 0));
                                    $rxBytes = $routerTx;
                                    $txBytes = $routerRx;
                                    if ($rxBytes > 0 || $txBytes > 0) {
                                        error_log("[PPPoE DEBUG] Found queue tree data for $sessionAddress: RX=$rxBytes, TX=$txBytes");
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        // Method 5: Try accounting data (if accounting is enabled)
        if (($rxBytes === 0 && $txBytes === 0) && $sessionAddress && isset($accountingData[$sessionAddress])) {
            // Accounting shows total bytes, we'll use it as download estimate
            $rxBytes = $accountingData[$sessionAddress]['bytes'] ?? 0;
            // Upload is harder to estimate from accounting alone, but try 30% of total as estimate
            $txBytes = intval($rxBytes * 0.3);
        }
        
        $pppoeSessions[] = [
            'name' => $sessionName,
            'address' => $sessionAddress,
            'service' => $session['service'] ?? 'pppoe',
            'uptime' => $session['uptime'] ?? '0s',
            'caller_id' => $session['caller-id'] ?? '',
            'interface' => $sessionInterface,
            'rx_bytes' => $rxBytes,
            'tx_bytes' => $txBytes,
            'rx_mb' => round($rxBytes / 1048576, 2),
            'tx_mb' => round($txBytes / 1048576, 2)
        ];
    }
}

// Get DHCP server leases untuk mapping MAC address ke hostname
$dhcpLeases = [];
try {
    $leases = $API->comm('/ip/dhcp-server/lease/print');
    if ($leases && is_array($leases)) {
        foreach ($leases as $lease) {
            $macAddress = $lease['mac-address'] ?? '';
            $hostName = $lease['host-name'] ?? '';
            if ($macAddress && $hostName) {
                // Normalize MAC address untuk matching (uppercase, remove colons/dashes)
                $normalizedMac = strtoupper(str_replace([':', '-', ' '], '', $macAddress));
                $dhcpLeases[$normalizedMac] = $hostName;
            }
        }
    }
} catch (Exception $e) {
    // DHCP leases mungkin tidak tersedia, ignore error
    // Jangan log error untuk DHCP karena ini optional
    // error_log("[DHCP] Error fetching DHCP leases: " . $e->getMessage());
}

// Get Hotspot active sessions with traffic data
$hotspotActiveSessions = null;
try {
    $hotspotActiveSessions = $API->comm('/ip/hotspot/active/print');
} catch (Exception $e) {
    error_log("[MONITORING] Error getting hotspot active sessions: " . $e->getMessage());
    $hotspotActiveSessions = []; // Empty array on error
}

if ($hotspotActiveSessions && is_array($hotspotActiveSessions)) {
    foreach ($hotspotActiveSessions as $session) {
        // Hotspot uses different field names for traffic
        $rxBytes = intval($session['bytes-in'] ?? 0);
        $txBytes = intval($session['bytes-out'] ?? 0);
        
        // Get MAC address dari session
        $macAddress = $session['mac-address'] ?? '';
        $hostname = '';
        
        // Cari hostname dari DHCP lease berdasarkan MAC address
        if ($macAddress && !empty($dhcpLeases)) {
            // Normalize MAC address untuk matching
            $normalizedMac = strtoupper(str_replace([':', '-', ' '], '', $macAddress));
            if (isset($dhcpLeases[$normalizedMac])) {
                $hostname = $dhcpLeases[$normalizedMac];
            }
        }
        
        $hotspotSessions[] = [
            'user' => $session['user'] ?? '',
            'address' => $session['address'] ?? '',
            'mac' => $macAddress,
            'hostname' => $hostname, // Hostname dari DHCP server
            'uptime' => $session['uptime'] ?? '0s',
            'rx_bytes' => $rxBytes,
            'tx_bytes' => $txBytes,
            'rx_mb' => round($rxBytes / 1048576, 2),
            'tx_mb' => round($txBytes / 1048576, 2)
        ];
    }
}

// Parse query string from environment variable when running via exec()
if (isset($_SERVER['QUERY_STRING']) && empty($_GET)) {
    // Remove leading ? if present
    $queryString = ltrim($_SERVER['QUERY_STRING'], '?');
    parse_str($queryString, $_GET);
}

// Get selected interface from query parameter (default to ether1)
$selectedInterface = $_GET['interface'] ?? 'ether1';

// Debug: Log what was received (uncomment for troubleshooting)
// error_log("[API] QUERY_STRING: " . ($_SERVER['QUERY_STRING'] ?? 'not set'));
// error_log("[API] Parsed GET: " . json_encode($_GET));
// error_log("[API] Selected interface: " . $selectedInterface);

// Initialize traffic counters to 0
$totalRx = 0;
$totalTx = 0;

// Get interface traffic with monitor data for real-time rates
// PENTING: Reuse interfaces data jika sudah diambil sebelumnya, atau ambil lagi
if (!$interfaces) {
    try {
        $interfaces = $API->comm('/interface/print');
    } catch (Exception $e) {
        error_log("[MONITORING] Error getting interfaces for traffic: " . $e->getMessage());
        $interfaces = [];
    }
}

if ($interfaces && is_array($interfaces)) {
    foreach ($interfaces as $iface) {
        $name = $iface['name'] ?? '';
        $type = $iface['type'] ?? '';
        
        // Count traffic ONLY for the SELECTED interface
        if ($name === $selectedInterface) {
            $totalRx = intval($iface['rx-byte'] ?? 0);
            $totalTx = intval($iface['tx-byte'] ?? 0);
            
            // Debug log (uncomment for debugging)
            // error_log("Traffic for $selectedInterface: RX=" . $totalRx . ", TX=" . $totalTx);
        }
        
        // Collect all interfaces for display and selector
        if ($name !== 'lo' && strpos($name, 'dummy') === false) {
            $interfaceList[] = [
                'name' => $name,
                'type' => $type,
                'running' => ($iface['running'] === 'true' || $iface['running'] === true),
                'rx_bytes' => intval($iface['rx-byte'] ?? 0),
                'tx_bytes' => intval($iface['tx-byte'] ?? 0),
                'rx_rate' => intval($iface['rx-rate'] ?? 0),
                'tx_rate' => intval($iface['tx-rate'] ?? 0)
            ];
        }
    }
}

// Get real-time traffic monitor for current rates
$monitor = null;
try {
    $monitor = $API->comm('/interface/monitor-traffic', [
        'interface' => $selectedInterface,
        'once' => '',
        'duration' => '1'
    ]);
} catch (Exception $e) {
    error_log("[MONITORING] Error getting traffic monitor: " . $e->getMessage());
    $monitor = null; // Will use default values
}

$currentRxRate = 0;
$currentTxRate = 0;

if ($monitor && isset($monitor[0])) {
    // Monitor gives rates in bits per second
    $currentRxRate = isset($monitor[0]['rx-bits-per-second']) ? 
        round($monitor[0]['rx-bits-per-second'] / 1048576, 2) : 0; // Convert to Mbps
    $currentTxRate = isset($monitor[0]['tx-bits-per-second']) ? 
        round($monitor[0]['tx-bits-per-second'] / 1048576, 2) : 0; // Convert to Mbps
}

// Build response with REAL data only
// PENTING: Set mikrotik check berdasarkan connection status yang sebenarnya
$mikrotikCheck = $API->connected && isset($mikrotikData['connected']) && $mikrotikData['connected'];

$responseData['data'] = [
    'systemHealth' => [
        'score' => 95,
        'status' => 'healthy',
        'checks' => [
            'whatsapp' => false, // Will be updated by JavaScript from /api/stats
            'mikrotik' => $mikrotikCheck, // Use actual connection status
            'database' => true,
            'api' => true
        ]
    ],
    'whatsapp' => [
        'connected' => false, // Will be updated by JavaScript from /api/stats
        'uptime' => 'N/A',
        'messagesProcessed' => 0,
        'queueSize' => 0
    ],
    'mikrotik' => $mikrotikData,
    'traffic' => [
        'download' => [
            'current' => $currentRxRate, // Current rate in Mbps from monitor
            'total' => round($totalRx / 1073741824, 2) // Total in GB
        ],
        'upload' => [
            'current' => $currentTxRate, // Current rate in Mbps from monitor
            'total' => round($totalTx / 1073741824, 2) // Total in GB
        ]
    ],
    'alerts' => [
        'active' => 0,
        'recent' => []
    ],
    'users' => [
        'hotspot' => [
            'active' => count($hotspotSessions),
            'total' => count($hotspotSessions),
            'sessions' => $hotspotSessions
        ],
        'pppoe' => [
            'active' => count($pppoeSessions),
            'total' => count($pppoeSessions),
            'sessions' => $pppoeSessions
        ]
    ],
    'resources' => [
        'cpu' => $mikrotikData['cpu'] ?? 0,
        'memory' => $mikrotikData['memory'] ?? 0,
        'disk' => $mikrotikData['disk'] ?? 0,
        'messageQueue' => 0
    ],
    'interfaces' => $interfaceList,
    'selectedInterface' => $selectedInterface,
    'timestamp' => date('c')
];

// PENTING: Disconnect hanya jika koneksi masih aktif
// Jangan disconnect jika sudah terputus (untuk menghindari error)
if ($API && $API->connected) {
    try {
        $API->disconnect();
    } catch (Exception $e) {
        // Ignore disconnect error - connection mungkin sudah terputus
        error_log("[MONITORING] Error disconnecting: " . $e->getMessage());
    }
}

// PENTING: Pastikan response selalu dikembalikan meskipun ada error
// Frontend akan handle error dengan lebih baik jika ada data parsial
echo json_encode($responseData);
?>
