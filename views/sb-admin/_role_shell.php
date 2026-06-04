<?php
if (!function_exists('resolveShellRoleContext')) {
    function resolveShellRoleContext() {
        if (session_status() === PHP_SESSION_NONE && !headers_sent()) {
            session_start();
        }

        $role = 'guest';

        if (isset($_COOKIE['token']) && !empty($_COOKIE['token'])) {
            try {
                $token = $_COOKIE['token'];
                $parts = explode('.', $token);
                if (count($parts) === 3 && !empty($parts[1])) {
                    $payloadBase64 = str_replace(['-', '_'], ['+', '/'], $parts[1]);
                    $padding = strlen($payloadBase64) % 4;
                    if ($padding > 0) {
                        $payloadBase64 .= str_repeat('=', 4 - $padding);
                    }
                    $decoded = base64_decode($payloadBase64, true);
                    if ($decoded !== false) {
                        $payload = json_decode($decoded, true);
                        if ($payload && is_array($payload) && isset($payload['role']) && !empty(trim($payload['role']))) {
                            $role = trim($payload['role']);
                        }
                    }
                }
            } catch (Exception $e) {
                // Fall back to session role.
            }
        }

        if ($role === 'guest' && isset($_SESSION['role']) && !empty(trim($_SESSION['role']))) {
            $role = trim($_SESSION['role']);
        }

        return [
            'role' => $role,
            'isAdminLike' => in_array($role, ['admin', 'owner', 'superadmin'], true),
            'isTeknisi' => $role === 'teknisi',
        ];
    }
}

$shellRoleContext = resolveShellRoleContext();
