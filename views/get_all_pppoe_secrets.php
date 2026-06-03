<?php
$operation = 'get_all_pppoe_secrets';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);
} catch (Throwable $e) {
    mikrotik_fail($operation, $e->getMessage(), 'CONNECT_ERROR', $startedAt, 500, []);
}

try {
    // Get all PPPoE secrets
    $secrets = $API->comm('/ppp/secret/print');

    if (mikrotik_is_trap($secrets)) {
        mikrotik_fail($operation, 'Error saat mengambil data PPPoE: ' . mikrotik_trap_message($secrets), 'COMMAND_ERROR', $startedAt, 500, []);
    }

    // Format the response
    $formattedSecrets = [];
    foreach ($secrets as $secret) {
        $formattedSecrets[] = [
            'name' => $secret['name'] ?? '',
            'password' => $secret['password'] ?? '',
            'profile' => $secret['profile'] ?? '',
            'comment' => $secret['comment'] ?? '',
            'disabled' => isset($secret['disabled']) && $secret['disabled'] === 'true',
            'service' => $secret['service'] ?? 'pppoe',
            'last_logged_out' => $secret['last-logged-out'] ?? '',
            'caller_id' => $secret['caller-id'] ?? ''
        ];
    }

    mikrotik_success($operation, 'Berhasil mengambil ' . count($formattedSecrets) . ' PPPoE secrets.', [
        'count' => count($formattedSecrets),
        'secrets' => $formattedSecrets,
    ], $startedAt);

} catch (Exception $e) {
    mikrotik_fail($operation, 'Kesalahan Operasi MikroTik: ' . $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500, []);
}
 
