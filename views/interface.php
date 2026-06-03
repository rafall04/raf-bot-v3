<?php
require('conn.php');
$netwatch = $API->comm('/tool/netwatch/print');
$json = json_encode($netwatch);
$result = json_decode($json, true);
// echo $result;
foreach ($result as $data) {
    echo 'NAMA : '. $data['comment'] . ' IP : ' . $data['host'] . ' STATUS : ' . $data['status']. '</br>';
}

$API->disconnect();
