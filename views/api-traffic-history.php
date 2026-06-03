<?php
/**
 * Traffic History API
 * Returns traffic history data for charts
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

// Generate dummy history data
$points = 20;
$history = [];
$now = time();

for ($i = $points - 1; $i >= 0; $i--) {
    $history[] = [
        'time' => date('c', $now - ($i * 60)),
        'download' => rand(10, 80),
        'upload' => rand(5, 40)
    ];
}

$response = [
    'status' => 200,
    'data' => $history
];

echo json_encode($response);
?>
