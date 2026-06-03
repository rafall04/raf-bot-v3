<?php
require_once('conn.php');

$operation = 'get_ppp_active_users';
$startedAt = mikrotik_operation_start();

if (isset($API) && $API instanceof RouterosAPI) {
    $API->timeout = 3;
    $API->attempts = 1;
    $API->delay = 0;
}

function build_pppoe_interface_candidates($sessionName, $sessionInterface = null) {
    $candidates = [];
    $normalizedName = trim((string) ($sessionName ?? ''));
    $normalizedInterface = trim((string) ($sessionInterface ?? ''));

    $appendCandidate = static function ($value) use (&$candidates) {
        $normalizedValue = trim((string) $value);
        if ($normalizedValue === '') {
            return;
        }

        $candidates[] = $normalizedValue;
        $candidates[] = strtolower($normalizedValue);
        $candidates[] = '<' . $normalizedValue . '>';
        $candidates[] = '<' . strtolower($normalizedValue) . '>';
    };

    if ($normalizedInterface !== '') {
        $appendCandidate($normalizedInterface);
    }

    if ($normalizedName !== '') {
        $appendCandidate($normalizedName);
        $appendCandidate('pppoe-' . $normalizedName);
        $appendCandidate('pppoe-' . strtolower($normalizedName));

        if (strpos($normalizedName, '@') !== false) {
            $usernameOnly = explode('@', $normalizedName)[0];
            $appendCandidate($usernameOnly);
            $appendCandidate('pppoe-' . $usernameOnly);
            $appendCandidate('pppoe-' . strtolower($usernameOnly));
        }
    }

    return array_values(array_unique(array_filter($candidates)));
}

try {
    mikrotik_require_connection($operation, $startedAt);
    set_time_limit(6);

    $activeSessions = $API->comm('/ppp/active/print');
    if (mikrotik_is_trap($activeSessions)) {
        mikrotik_fail($operation, 'Gagal mengambil sesi PPP aktif: ' . mikrotik_trap_message($activeSessions), 'COMMAND_ERROR', $startedAt, 500);
    }

    $interfaces = $API->comm('/interface/print');
    if (mikrotik_is_trap($interfaces)) {
        mikrotik_fail($operation, 'Gagal mengambil statistik interface PPPoE: ' . mikrotik_trap_message($interfaces), 'COMMAND_ERROR', $startedAt, 500);
    }

    $pppoeInterfaces = [];
    foreach ($interfaces as $iface) {
        $ifaceName = $iface['name'] ?? '';
        if ($ifaceName === '') {
            continue;
        }

        $ifaceType = strtolower((string) ($iface['type'] ?? ''));
        $isPppoe = strpos($ifaceType, 'pppoe') !== false
            || strpos($ifaceType, 'ppp') !== false
            || strpos(strtolower($ifaceName), 'pppoe') !== false
            || strpos(strtolower($ifaceName), 'ppp') !== false;
        if (!$isPppoe) {
            continue;
        }

        $ifaceStats = [
            'rx-byte' => isset($iface['rx-byte']) ? (int) $iface['rx-byte'] : 0,
            'tx-byte' => isset($iface['tx-byte']) ? (int) $iface['tx-byte'] : 0,
        ];

        $pppoeInterfaces[$ifaceName] = $ifaceStats;
        $pppoeInterfaces[strtolower($ifaceName)] = $ifaceStats;

        $trimmedInterfaceName = trim($ifaceName, '<>');
        if ($trimmedInterfaceName !== $ifaceName && $trimmedInterfaceName !== '') {
            $pppoeInterfaces[$trimmedInterfaceName] = $ifaceStats;
            $pppoeInterfaces[strtolower($trimmedInterfaceName)] = $ifaceStats;
        }
    }

    $formatted = [];
    foreach ($activeSessions as $session) {
        if (isset($session['name']) && isset($session['address'])) {
            $resolvedInterface = null;
            foreach (build_pppoe_interface_candidates($session['name'] ?? null, $session['interface'] ?? null) as $candidate) {
                if (isset($pppoeInterfaces[$candidate])) {
                    $resolvedInterface = $candidate;
                    break;
                }
            }

            if ($resolvedInterface === null) {
                $sessionName = (string) ($session['name'] ?? '');
                $sessionNameOnly = strpos($sessionName, '@') !== false ? explode('@', $sessionName)[0] : $sessionName;

                foreach ($pppoeInterfaces as $ifaceName => $ifaceStats) {
                    $canonicalInterfaceName = trim((string) $ifaceName, '<>');
                    $ifaceIdentity = str_replace('pppoe-', '', $canonicalInterfaceName);
                    $ifaceIdentityOnly = strpos($ifaceIdentity, '@') !== false ? explode('@', $ifaceIdentity)[0] : $ifaceIdentity;

                    if (
                        $ifaceIdentity === $sessionName ||
                        $ifaceIdentityOnly === $sessionNameOnly ||
                        $ifaceIdentity === $sessionName ||
                        $ifaceIdentityOnly === $sessionName ||
                        $ifaceIdentity === $sessionNameOnly ||
                        $ifaceIdentityOnly === $sessionNameOnly
                    ) {
                        $resolvedInterface = $ifaceName;
                        break;
                    }
                }
            }

            $rxBytes = null;
            $txBytes = null;
            if ($resolvedInterface !== null && isset($pppoeInterfaces[$resolvedInterface])) {
                $interfaceStats = $pppoeInterfaces[$resolvedInterface];
                $rxBytes = $interfaceStats['tx-byte']; // Router tx = customer download
                $txBytes = $interfaceStats['rx-byte']; // Router rx = customer upload
            }

            $formatted[] = [
                'name' => $session['name'],
                'address' => $session['address'],
                'caller_id' => $session['caller-id'] ?? null,
                'service' => $session['service'] ?? 'pppoe',
                'uptime' => $session['uptime'] ?? null,
                'interface_name' => $resolvedInterface,
                'rx_bytes' => $rxBytes,
                'tx_bytes' => $txBytes,
            ];
        }
    }

    mikrotik_success($operation, 'Berhasil mengambil sesi PPP aktif.', $formatted, $startedAt);
} catch (Throwable $e) {
    mikrotik_fail($operation, $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500, []);
}
