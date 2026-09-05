<?php
// Hapus entri netwatch by .id (daftar CSV lewat MTIN_ids). Sisi Node SUDAH mem-verifikasi bahwa
// tiap .id benar entri milik-CCTV (classifyEntry klass==='cctv') SEBELUM memanggil bridge ini —
// jadi bridge TIDAK pernah menghapus by-host mentah (yang bisa menghajar entri OLT/infra/backhaul
// yang kebetulan sehost). Daftar kosong = sukses no-op (idempoten).
$operation = 'remove_netwatch';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

try {
    mikrotik_require_connection($operation, $startedAt);

    $idsRaw = getenv('MTIN_ids') ?: '';
    $ids = array_values(array_filter(array_map('trim', explode(',', $idsRaw)), function ($x) { return $x !== ''; }));

    if (count($ids) === 0) {
        mikrotik_success($operation, 'Tak ada entri netwatch untuk dihapus.', array('removed' => 0), $startedAt);
    }

    $removed = 0;
    foreach ($ids as $id) {
        $res = $API->comm('/tool/netwatch/remove', array('.id' => $id));
        if (mikrotik_is_trap($res)) {
            // Satu id gagal (mis. sudah terhapus) → lanjut; laporkan yang berhasil.
            continue;
        }
        $removed++;
    }
    mikrotik_success($operation, 'Entri netwatch dihapus.', array('removed' => $removed, 'requested' => count($ids)), $startedAt);
} catch (Throwable $e) {
    mikrotik_fail($operation, 'Kesalahan Operasi MikroTik: ' . $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500, []);
}
