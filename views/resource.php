<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="refresh" content="5" />
    <title>Aldi MikroTik</title>
</head>
<body>
</body>
</html>
<?php
require('conn.php');
$resource = $API->comm('/system/resource/print');
$json = json_encode($resource);
$result = json_decode($json, true);
// echo $json;
foreach ($result as $data) {
    $uptime = $data['uptime'];
    $cpu= $data['cpu'];
    $cpucount = $data['cpu-count'];
    $cpufrekuensi = $data['cpu-frequency'];
    $cpuload = $data['cpu-load'];
    echo "<p>UP TIME MikroTik : $uptime </br> CPU : $cpu </br> CPU COUNT : $cpucount </br> CPU Frekuensi : $cpufrekuensi </br> CPU LOAD : $cpuload % </br></p>"; 
}
$API->disconnect();
