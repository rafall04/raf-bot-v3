<?php
// Set/Add entri netwatch untuk CCTV. Dua mode:
//   - MTIN_id terisi  → SET entri itu (by .id). Hanya field yang MTIN-nya NON-KOSONG yang ditulis;
//                        field kosong DIOMIT → nilai lama di router DIPERTAHANKAN (preserve-on-empty).
//                        Ini mencegah re-save tak sengaja mengosongkan script Telegram / me-reset
//                        interval / me-enable entri yang sengaja di-disable di Winbox.
//   - MTIN_id kosong  → ADD entri baru (butuh host). interval/timeout default 5s/1s.
// Kepemilikan (entri ini benar CCTV, bukan OLT/infra) DIPUTUSKAN di sisi Node (classifyEntry) SEBELUM
// memanggil bridge ini — bridge hanya menulis .id yang sudah diverifikasi Node. Param via env MTIN_*
// (script panjang + token rahasia tak boleh lewat argv/ps aux).
$operation = 'set_netwatch';
require_once('conn.php');
$startedAt = mikrotik_operation_start();

// Buang newline/control char dari nilai API (routeros_api write() memecah command pada "\n").
function nw_oneline($s) {
    $s = preg_replace('/[\r\n\t]+/', ' ', (string) $s);
    $s = preg_replace('/[\x00-\x1F\x7F]/', '', $s);
    return trim($s);
}

try {
    mikrotik_require_connection($operation, $startedAt);

    $id         = getenv('MTIN_id') ?: '';
    $host       = getenv('MTIN_host') ?: '';
    $comment    = nw_oneline(getenv('MTIN_comment') ?: '');
    $interval   = getenv('MTIN_interval') ?: '';
    $timeout    = getenv('MTIN_timeout') ?: '';
    $upScript   = getenv('MTIN_upscript') ?: '';
    $downScript = getenv('MTIN_downscript') ?: '';
    $disabled   = getenv('MTIN_disabled') ?: ''; // 'yes'|'no'|'' ('' = jangan sentuh saat SET)

    if ($id !== '') {
        // ===== SET (by .id) — preserve-on-empty =====
        $args = array('.id' => $id);
        if ($comment !== '')    { $args['comment'] = $comment; }
        if ($interval !== '')   { $args['interval'] = $interval; }
        if ($timeout !== '')    { $args['timeout'] = $timeout; }
        if ($upScript !== '')   { $args['up-script'] = $upScript; }
        if ($downScript !== '') { $args['down-script'] = $downScript; }
        if ($disabled === 'yes' || $disabled === 'no') { $args['disabled'] = $disabled; }

        $res = $API->comm('/tool/netwatch/set', $args);
        if (mikrotik_is_trap($res)) {
            mikrotik_fail($operation, 'Gagal set netwatch: ' . mikrotik_trap_message($res), 'COMMAND_ERROR', $startedAt, 500, []);
        }
        mikrotik_success($operation, 'Entri netwatch diperbarui.', array('mode' => 'set', 'id' => $id, 'host' => $host), $startedAt);
    } else {
        // ===== ADD (entri baru) =====
        if ($host === '') {
            mikrotik_fail($operation, 'Host wajib diisi untuk menambah netwatch.', 'VALIDATION_ERROR', $startedAt, 400, []);
        }
        $args = array(
            'host'     => $host,
            'comment'  => $comment,
            'interval' => $interval !== '' ? $interval : '5s',
            'timeout'  => $timeout !== '' ? $timeout : '1s',
            'disabled' => ($disabled === 'yes') ? 'yes' : 'no',
        );
        if ($upScript !== '')   { $args['up-script'] = $upScript; }
        if ($downScript !== '') { $args['down-script'] = $downScript; }

        $res = $API->comm('/tool/netwatch/add', $args);
        if (mikrotik_is_trap($res)) {
            mikrotik_fail($operation, 'Gagal menambah netwatch: ' . mikrotik_trap_message($res), 'COMMAND_ERROR', $startedAt, 500, []);
        }
        // Ambil .id entri baru (print by host) untuk dicatat di registry Node.
        $newId = null;
        $found = $API->comm('/tool/netwatch/print', array('?host' => $host, '.proplist' => '.id'));
        if (is_array($found) && isset($found[0]['.id'])) { $newId = $found[0]['.id']; }
        mikrotik_success($operation, 'Entri netwatch dibuat.', array('mode' => 'add', 'id' => $newId, 'host' => $host), $startedAt);
    }
} catch (Throwable $e) {
    mikrotik_fail($operation, 'Kesalahan Operasi MikroTik: ' . $e->getMessage(), 'COMMAND_ERROR', $startedAt, 500, []);
}
