<?php
require('conn.php');
$ARRAY =  $API->comm("/tool/netwatch/print", array(
    ".proplist" => "status",
    "?host"     => "192.168.99.99",
   ));
$API->disconnect();

$status = ($ARRAY[0]['status']);
if($status == "up"){
    echo "INTERNET AMAN";
}else{
    echo "INTERNET GANGGUAN";
}