<?php

function mikrotik_operation_start() {
    return microtime(true);
}

function mikrotik_env_value($primary, $fallback = null, $default = null) {
    $value = getenv($primary);
    if ($value === false || $value === '') {
        if ($fallback) {
            $value = getenv($fallback);
        }
    }

    if ($value === false || $value === '') {
        return $default;
    }

    return $value;
}

function mikrotik_response_meta($startedAt, $source = 'php-bridge') {
    return [
        'router_host' => $GLOBALS['MIKROTIK_CONFIG']['host'] ?? null,
        'duration_ms' => (int) round((microtime(true) - $startedAt) * 1000),
        'source' => $source,
    ];
}

function mikrotik_disconnect() {
    if (isset($GLOBALS['API']) && $GLOBALS['API'] instanceof RouterosAPI && $GLOBALS['API']->connected) {
        $GLOBALS['API']->disconnect();
    }
}

function mikrotik_respond($status, $operation, $message, $data = null, $errorCode = null, $startedAt = null, $httpCode = 200) {
    if (!headers_sent()) {
        header('Content-Type: application/json');
        http_response_code($httpCode);
    }

    $payload = [
        'status' => $status,
        'operation' => $operation,
        'message' => $message,
        'data' => $data,
        'error_code' => $errorCode,
        'meta' => mikrotik_response_meta($startedAt ?: microtime(true)),
    ];

    echo json_encode($payload);
    mikrotik_disconnect();
    exit();
}

function mikrotik_fail($operation, $message, $errorCode, $startedAt, $httpCode = 500, $data = null) {
    mikrotik_respond('error', $operation, $message, $data, $errorCode, $startedAt, $httpCode);
}

function mikrotik_success($operation, $message, $data, $startedAt, $httpCode = 200) {
    mikrotik_respond('success', $operation, $message, $data, null, $startedAt, $httpCode);
}

function mikrotik_read_input($key, $argvIndex = null, $required = true, $default = null) {
    $value = $default;

    if ($argvIndex !== null && isset($GLOBALS['argv']) && array_key_exists($argvIndex, $GLOBALS['argv'])) {
        $value = $GLOBALS['argv'][$argvIndex];
    } elseif (isset($_GET[$key])) {
        $value = $_GET[$key];
    }

    if ($required && ($value === null || $value === '')) {
        throw new InvalidArgumentException("Parameter '{$key}' wajib diisi.");
    }

    return $value;
}

function mikrotik_is_trap($response) {
    return is_array($response) && (isset($response['!trap']) || isset($response['!fatal']));
}

function mikrotik_trap_message($response, $default = 'RouterOS command failed.') {
    if (!is_array($response)) {
        return $default;
    }

    if (isset($response['!trap'][0]['message'])) {
        return $response['!trap'][0]['message'];
    }

    if (isset($response['!trap']['message'])) {
        return $response['!trap']['message'];
    }

    if (isset($response['!fatal'][0]['message'])) {
        return $response['!fatal'][0]['message'];
    }

    if (isset($response['!fatal']['message'])) {
        return $response['!fatal']['message'];
    }

    return $default;
}

function mikrotik_require_connection($operation, $startedAt) {
    if (!isset($GLOBALS['API']) || !($GLOBALS['API'] instanceof RouterosAPI)) {
        mikrotik_fail($operation, 'Objek RouterosAPI tidak terinisialisasi.', 'CONFIG_ERROR', $startedAt, 500);
    }

    if (!$GLOBALS['API']->connected) {
        mikrotik_fail($operation, 'Gagal terkoneksi ke MikroTik. Periksa host, port, username, password, dan konektivitas router.', 'CONNECT_ERROR', $startedAt, 500);
    }
}

