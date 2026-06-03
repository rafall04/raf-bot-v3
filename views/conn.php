<?php

require_once('dotenv.class.php');
require_once('routeros_api.class.php');
require_once('mikrotik_helper.php');

$dotenv = new DotEnv();
$dotenv->load(__DIR__ . '/../');

$resolvedHost = mikrotik_env_value('IP_MC', 'MIKROTIK_HOST');
$resolvedUsername = mikrotik_env_value('NAME_MC', 'MIKROTIK_USER');
$resolvedPassword = mikrotik_env_value('PASSWORD_MC', 'MIKROTIK_PASSWORD');
$resolvedSsl = mikrotik_env_value('SSL_MC', 'MIKROTIK_SSL', 'false');
$resolvedPort = mikrotik_env_value('PORT_MC', 'MIKROTIK_PORT');
$ssl = filter_var($resolvedSsl, FILTER_VALIDATE_BOOLEAN);
$port = $resolvedPort !== null && $resolvedPort !== ''
    ? (int) $resolvedPort
    : ($ssl ? 8729 : 8728);

$GLOBALS['MIKROTIK_CONFIG'] = [
    'host' => $resolvedHost,
    'username' => $resolvedUsername,
    'password' => $resolvedPassword,
    'port' => $port,
    'ssl' => $ssl,
];

$ip = $resolvedHost;
$name = $resolvedUsername;
$password = $resolvedPassword;

$API = new RouterosAPI();
$API->port = $port;
$API->ssl = $ssl;
$API->timeout = 2;
$API->attempts = 2;
$API->delay = 1;

if (!$resolvedHost || !$resolvedUsername || !$resolvedPassword) {
    return;
}

$API->connect($resolvedHost, $resolvedUsername, $resolvedPassword);
