<?php
// Ambil keanggotaan address-list steering untuk resolusi jalur upstream per-pelanggan LIVE
// (lib/customer-path-resolver.js). READ-ONLY. Dua kelompok:
//   - OVERRIDE per-individu: RAF-STEER-<jalur> (dikelola customerSteering; menang bila ada).
//   - PROFIL per-pool (sumber kebenaran path normal): `freedns` (base MNI) & `lokaldns` (base GMDP).
// Sertakan flag `disabled` supaya pemanggil MENGABAIKAN entri yang di-nonaktifkan (mis. .61 di
// lokaldns yang di-disable saat pelanggan 110k dipindah ke freedns/MNI).
$operation = 'get_steering_lists';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);
    $entries = $API->comm('/ip/firewall/address-list/print');

    if (mikrotik_is_trap($entries)) {
        mikrotik_fail($operation, 'Gagal mengambil address-list: ' . mikrotik_trap_message($entries), 'COMMAND_ERROR', $startedAt, 500, []);
    }

    $wanted = ['RAF-STEER-GMDP', 'RAF-STEER-MNI', 'RAF-STEER-IH', 'RAF-STEER-SF', 'freedns', 'lokaldns'];
    $out = [];
    if (is_array($entries)) {
        foreach ($entries as $e) {
            $list = $e['list'] ?? '';
            if (in_array($list, $wanted, true) && isset($e['address'])) {
                $out[] = [
                    'list' => $list,
                    'address' => $e['address'],
                    // RouterOS kembalikan 'true'/'false' (string) atau absen → anggap aktif.
                    'disabled' => (($e['disabled'] ?? 'false') === 'true'),
                ];
            }
        }
    }

    mikrotik_success($operation, 'Berhasil mengambil list steering pelanggan.', $out, $startedAt);
} catch (Throwable $e) {
    mikrotik_fail($operation, 'Kesalahan Operasi MikroTik: ' . $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500, []);
}
