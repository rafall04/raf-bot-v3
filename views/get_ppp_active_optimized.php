<?php
/**
 * Optimized PPP Active Users Fetcher
 * With timeout and error handling
 */

require 'conn.php';

// Set shorter timeout for MikroTik connection
$API->timeout = 2; // 2 seconds timeout instead of default 3
$API->attempts = 1; // Only 1 attempt instead of default 5
$API->delay = 0; // No delay between attempts

$formattedActiveUsers = [];
$error = null;

try {
    // Check if API is connected
    if (!$API->connected) {
        throw new Exception("Failed to connect to MikroTik router");
    }
    
    // Set execution timeout for this script
    set_time_limit(5); // Maximum 5 seconds execution time
    
    // Fetch active PPP sessions
    $activeSessions = @$API->comm("/ppp/active/print");
    
    if ($activeSessions === false || is_null($activeSessions)) {
        throw new Exception("Failed to retrieve PPP active sessions");
    }
    
    if (!empty($activeSessions)) {
        foreach ($activeSessions as $session) {
            if (isset($session['name']) && isset($session['address'])) {
                $formattedActiveUsers[] = [
                    "name" => $session['name'],
                    "address" => $session['address'],
                    "caller_id" => isset($session['caller-id']) ? $session['caller-id'] : null
                ];
            }
        }
    }
} catch (Exception $e) {
    $error = $e->getMessage();
    error_log("[PPP_ACTIVE_OPTIMIZED] Error: " . $error);
}

// Always disconnect if connected
if ($API && $API->connected) {
    @$API->disconnect();
}

// Return response
header('Content-Type: application/json');

if ($error) {
    http_response_code(500);
    echo json_encode([
        'error' => true,
        'message' => $error,
        'data' => []
    ]);
} else {
    echo json_encode([
        'error' => false,
        'data' => $formattedActiveUsers
    ]);
}
?>
