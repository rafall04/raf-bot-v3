<?php
require('conn.php');
$userhotspot = $API->comm('/ip/hotspot/user/print');
$json = json_encode($userhotspot);
$result = json_decode($json, true);
// echo $result;
foreach ($result as $data) {
    echo 'Username = '. $data['name'] . ' Password = ' . $data['password'] . ' Profil : ' . $data['profile']. '<br>';
}
$API->disconnect();
