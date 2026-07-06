<?php
/**
 * Hapus PPPoE user dari MikroTik SECARA TUNTAS: hapus /ppp/secret (kredensial, agar
 * tak bisa konek lagi) DAN putus /ppp/active (sesi berjalan, agar terputus sekarang).
 * Idempoten: bila secret tidak ada (sudah terhapus) tetap sukses. Dipakai saat pelanggan
 * dihapus dari bot supaya bersih total di MikroTik (lib/mikrotik.removePPPoESecret).
 */
$operation = 'delete_pppoe_secret';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);
    $username = mikrotik_read_input('username', 1);

    // 1) Hapus SECRET (kredensial) — cegah user konek lagi.
    $secrets = $API->comm('/ppp/secret/print', ['?name' => $username]);
    if (mikrotik_is_trap($secrets)) {
        mikrotik_fail($operation, 'Gagal mencari PPPoE secret: ' . mikrotik_trap_message($secrets), 'COMMAND_ERROR', $startedAt, 500);
    }

    $secretRemoved = false;
    if (!empty($secrets)) {
        $secretId = $secrets[0]['.id'] ?? null;
        if (!$secretId) {
            mikrotik_fail($operation, "Secret '{$username}' ditemukan tetapi ID tidak tersedia.", 'EMPTY_RESULT', $startedAt, 500);
        }
        $removeResponse = $API->comm('/ppp/secret/remove', ['.id' => $secretId]);
        if (mikrotik_is_trap($removeResponse)) {
            mikrotik_fail($operation, 'Gagal menghapus PPPoE secret: ' . mikrotik_trap_message($removeResponse), 'COMMAND_ERROR', $startedAt, 500);
        }
        $secretRemoved = true;
    }

    // 2) Putus SESI AKTIF (kalau ada) — best-effort, tak menggagalkan operasi.
    $sessionRemoved = false;
    $active = $API->comm('/ppp/active/print', ['?name' => $username]);
    if (!mikrotik_is_trap($active) && !empty($active)) {
        $activeId = $active[0]['.id'] ?? null;
        if ($activeId) {
            $removeActive = $API->comm('/ppp/active/remove', ['.id' => $activeId]);
            if (!mikrotik_is_trap($removeActive)) {
                $sessionRemoved = true;
            }
        }
    }

    $msg = $secretRemoved
        ? "PPPoE '{$username}' dihapus dari MikroTik (secret" . ($sessionRemoved ? ' + sesi aktif diputus' : '') . ').'
        : "PPPoE secret '{$username}' tidak ditemukan (mungkin sudah terhapus).";
    mikrotik_success($operation, $msg, [
        'username' => $username,
        'secret_removed' => $secretRemoved,
        'session_removed' => $sessionRemoved,
    ], $startedAt);
} catch (InvalidArgumentException $e) {
    mikrotik_fail($operation, $e->getMessage(), 'INVALID_ARGUMENT', $startedAt, 400);
} catch (Throwable $e) {
    mikrotik_fail($operation, 'Kesalahan Operasi MikroTik: ' . $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500);
}
