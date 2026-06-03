<?php
// api-monitoring-wrapper.php
// Wrapper to communicate with Node.js monitoring API

session_start();

class MonitoringAPIWrapper {
    private $nodeApiUrl = 'http://localhost:3100/api/monitoring';
    private $token;
    
    public function __construct($token = null) {
        $this->token = $token ?: ($_SESSION['token'] ?? '');
    }
    
    /**
     * Get system metrics from Node.js API
     */
    public function getSystemMetrics() {
        return $this->makeRequest('/system');
    }
    
    /**
     * Get MikroTik statistics
     */
    public function getMikrotikStats() {
        return $this->makeRequest('/mikrotik/summary');
    }
    
    /**
     * Get traffic history
     */
    public function getTrafficHistory($period = '1h') {
        return $this->makeRequest('/mikrotik/traffic?' . http_build_query(['period' => $period]));
    }
    
    /**
     * Get active users
     */
    public function getActiveUsers() {
        return $this->makeRequest('/mikrotik/users');
    }
    
    /**
     * Get system health
     */
    public function getSystemHealth() {
        return $this->makeRequest('/health');
    }
    
    /**
     * Get alerts
     */
    public function getAlerts($limit = 50) {
        return $this->makeRequest('/alerts?' . http_build_query(['limit' => $limit]));
    }
    
    /**
     * Trigger action
     */
    public function triggerAction($action, $params = []) {
        return $this->makeRequest('/action', 'POST', [
            'action' => $action,
            'params' => $params
        ]);
    }
    
    /**
     * Make HTTP request to Node.js API
     */
    private function makeRequest($endpoint, $method = 'GET', $data = null) {
        $ch = curl_init($this->nodeApiUrl . $endpoint);
        
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Authorization: Bearer ' . $this->token,
            'Content-Type: application/json'
        ]);
        
        if ($method === 'POST') {
            curl_setopt($ch, CURLOPT_POST, true);
            if ($data) {
                curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
            }
        }
        
        // OPTIMASI: Kurangi timeout untuk menghindari blocking render
        curl_setopt($ch, CURLOPT_TIMEOUT, 1);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 1);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        
        curl_close($ch);
        
        if ($error) {
            return [
                'error' => true,
                'message' => 'Connection error: ' . $error
            ];
        }
        
        if ($httpCode !== 200) {
            // Check if service is not available
            if ($httpCode === 0 || $httpCode === 503) {
                return [
                    'error' => true,
                    'message' => 'Monitoring service not available',
                    'data' => $this->getDefaultData()
                ];
            }
            
            return [
                'error' => true,
                'message' => 'HTTP error: ' . $httpCode
            ];
        }
        
        $result = json_decode($response, true);
        
        // Handle response format from Node.js API
        if (isset($result['status']) && isset($result['data'])) {
            return $result['data'];
        }
        
        return $result;
    }
    
    /**
     * Get default data when service is not available
     */
    private function getDefaultData() {
        return [
            'health' => [
                'score' => 0,
                'status' => 'unavailable'
            ],
            'connections' => [
                'whatsapp' => false,
                'database' => false
            ],
            'system' => [
                'cpu' => 0,
                'memory' => 0,
                'disk' => 0,
                'uptime' => 0
            ],
            'performance' => [
                'queueSize' => 0
            ]
        ];
    }
}

// Handle AJAX requests
if (isset($_GET['action'])) {
    // Check authentication
    if (!isset($_SESSION['user_id']) || !in_array($_SESSION['role'], ['admin', 'owner'])) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }
    
    $api = new MonitoringAPIWrapper($_SESSION['token'] ?? '');
    
    header('Content-Type: application/json');
    
    switch ($_GET['action']) {
        case 'system':
            echo json_encode($api->getSystemMetrics());
            break;
            
        case 'mikrotik':
            echo json_encode($api->getMikrotikStats());
            break;
            
        case 'traffic':
            $period = $_GET['period'] ?? '1h';
            echo json_encode($api->getTrafficHistory($period));
            break;
            
        case 'users':
            echo json_encode($api->getActiveUsers());
            break;
            
        case 'health':
            echo json_encode($api->getSystemHealth());
            break;
            
        case 'alerts':
            $limit = $_GET['limit'] ?? 50;
            echo json_encode($api->getAlerts($limit));
            break;
            
        case 'trigger':
            if ($_SERVER['REQUEST_METHOD'] === 'POST') {
                $input = json_decode(file_get_contents('php://input'), true);
                echo json_encode($api->triggerAction($input['action'], $input['params'] ?? []));
            } else {
                http_response_code(405);
                echo json_encode(['error' => 'Method not allowed']);
            }
            break;
            
        default:
            http_response_code(400);
            echo json_encode(['error' => 'Invalid action']);
    }
    
    exit;
}
