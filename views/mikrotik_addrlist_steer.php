<?php
/**
 * Header Doc
 * Purpose: Bridge steering pelanggan berbasis address-list — mode `list` (read-only entri per
 *          daftar), `entry-add`/`entry-remove`/`entry-toggle` (tulis entri address-list pada
 *          daftar yang DIIZINKAN Node), dan `setup` (pasang idempoten 4 rule mangle override
 *          RAF-CUSTSTEER di ANCHOR sebelum rule mark-routing pertama chain prerouting; check=true
 *          hanya melapor). Bridge hanya eksekutor — daftar/rule berasal dari allowlist config di
 *          Node, bukan input bebas. Entri dynamic TIDAK pernah disentuh.
 * Caller: `lib/customer-steering-service.js` (spawn php CLI).
 * Deps: `views/routeros_api.class.php`, `views/mikrotik_helper.php`. Kredensial via env
 *       MTIN_UPQ_HOST/PORT/USER/PASS; spesifikasi via argv[1] JSON.
 * MainFuncs: alur prosedural + `als_entries`, `als_rule_view`.
 * SideEffects: Koneksi API RouterOS; mode tulis mengubah address-list / menambah rule mangle
 *              ber-comment RAF-CUSTSTEER. NEVER menghapus/mengubah rule tanpa comment itu.
 */

require __DIR__ . '/routeros_api.class.php';
require __DIR__ . '/mikrotik_helper.php';

$startedAt = mikrotik_operation_start();
$OP = 'customerSteer';

$spec = json_decode(isset($argv[1]) ? $argv[1] : '{}', true);
if (!is_array($spec)) $spec = array();
$mode = isset($spec['mode']) ? $spec['mode'] : 'list';

$host = mikrotik_read_input('UPQ_HOST', null, false, null);
$port = (int) mikrotik_read_input('UPQ_PORT', null, false, '8728');
$user = mikrotik_read_input('UPQ_USER', null, false, null);
$pass = mikrotik_read_input('UPQ_PASS', null, false, null);
if (!$host || !$user || $pass === null || $pass === false) {
    mikrotik_fail($OP, 'Kredensial router tidak lengkap (MTIN_UPQ_*).', 'CONFIG_ERROR', $startedAt);
}

$GLOBALS['MIKROTIK_CONFIG'] = array('host' => $host);
$API = new RouterosAPI();
$GLOBALS['API'] = $API;
$API->attempts = 1;
$API->timeout = 12;
$API->port = $port;
if (!$API->connect($host, $user, $pass)) {
    mikrotik_fail($OP, "Gagal konek API router $host:$port.", 'CONNECT_ERROR', $startedAt);
}

function als_entries($API, $listName) {
    $rows = $API->comm('/ip/firewall/address-list/print', array('?list' => $listName));
    $out = array();
    if (!is_array($rows)) return $out;
    foreach ($rows as $k => $r) {
        if ($k === '!trap' || !is_array($r) || !isset($r['address'])) continue;
        $out[] = array(
            'id' => isset($r['.id']) ? $r['.id'] : null,
            'list' => $listName,
            'address' => $r['address'],
            'disabled' => isset($r['disabled']) && $r['disabled'] === 'true' ? 1 : 0,
            'dynamic' => isset($r['dynamic']) && $r['dynamic'] === 'true' ? 1 : 0,
            'comment' => isset($r['comment']) ? $r['comment'] : ''
        );
    }
    return $out;
}

function als_trap_message($res) {
    if (!is_array($res) || !isset($res['!trap'])) return null;
    $t = is_array($res['!trap']) ? reset($res['!trap']) : $res['!trap'];
    return is_array($t) && isset($t['message']) ? $t['message'] : json_encode($t);
}

// ============== MODE LIST (read-only) ==============
if ($mode === 'list') {
    $lists = (isset($spec['lists']) && is_array($spec['lists'])) ? $spec['lists'] : array();
    if (!count($lists)) mikrotik_fail($OP, 'Daftar list kosong.', 'SPEC_ERROR', $startedAt);
    $out = array();
    foreach ($lists as $name) {
        $out[$name] = als_entries($API, (string) $name);
    }
    mikrotik_success($OP, 'Entri address-list terbaca.', array('mode' => 'list', 'lists' => $out), $startedAt);
}

// ============== MODE ENTRY-ADD ==============
if ($mode === 'entry-add') {
    $list = isset($spec['list']) ? (string) $spec['list'] : '';
    $address = isset($spec['address']) ? (string) $spec['address'] : '';
    $comment = isset($spec['comment']) ? (string) $spec['comment'] : '';
    if ($list === '' || $address === '') mikrotik_fail($OP, 'list/address wajib.', 'SPEC_ERROR', $startedAt);
    $res = $API->comm('/ip/firewall/address-list/add', array(
        'list' => $list, 'address' => $address, 'comment' => $comment
    ));
    $err = als_trap_message($res);
    if ($err) mikrotik_fail($OP, "Gagal tambah entri: $err", 'WRITE_ERROR', $startedAt);
    mikrotik_success($OP, 'Entri ditambahkan.', array('mode' => 'entry-add', 'entries' => als_entries($API, $list)), $startedAt);
}

// ============== MODE ENTRY-REMOVE / ENTRY-TOGGLE (by .id, cek non-dynamic dulu) ==============
if ($mode === 'entry-remove' || $mode === 'entry-toggle') {
    $list = isset($spec['list']) ? (string) $spec['list'] : '';
    $id = isset($spec['id']) ? (string) $spec['id'] : '';
    if ($list === '' || $id === '') mikrotik_fail($OP, 'list/id wajib.', 'SPEC_ERROR', $startedAt);
    // Verifikasi id memang milik list itu & bukan dynamic — anti salah sasaran.
    $target = null;
    foreach (als_entries($API, $list) as $e) {
        if ($e['id'] === $id) { $target = $e; break; }
    }
    if (!$target) mikrotik_fail($OP, 'Entri tidak ditemukan pada list itu.', 'NOT_FOUND', $startedAt);
    if ($target['dynamic']) mikrotik_fail($OP, 'Entri dynamic tidak boleh disentuh.', 'GUARD_ERROR', $startedAt);
    if ($mode === 'entry-remove') {
        $res = $API->comm('/ip/firewall/address-list/remove', array('.id' => $id));
    } else {
        $dis = isset($spec['disabled']) && $spec['disabled'] ? 'yes' : 'no';
        $res = $API->comm('/ip/firewall/address-list/set', array('.id' => $id, 'disabled' => $dis));
    }
    $err = als_trap_message($res);
    if ($err) mikrotik_fail($OP, "Gagal ubah entri: $err", 'WRITE_ERROR', $startedAt);
    mikrotik_success($OP, 'Entri diubah.', array('mode' => $mode, 'entries' => als_entries($API, $list)), $startedAt);
}

// ============== MODE SETUP (idempoten; check=true read-only) ==============
if ($mode === 'setup') {
    $rules = (isset($spec['rules']) && is_array($spec['rules'])) ? $spec['rules'] : array();
    $checkOnly = isset($spec['check']) && $spec['check'];
    if (!count($rules)) mikrotik_fail($OP, 'Spesifikasi rules kosong.', 'SPEC_ERROR', $startedAt);

    $rows = $API->comm('/ip/firewall/mangle/print', array('?chain' => 'prerouting'));
    $existing = array(); // comment → row
    $anchorId = null;    // rule mark-routing PERTAMA (tempat place-before)
    if (is_array($rows)) {
        foreach ($rows as $k => $r) {
            if ($k === '!trap' || !is_array($r)) continue;
            $cm = isset($r['comment']) ? $r['comment'] : '';
            if (strpos($cm, 'RAF-CUSTSTEER') === 0) $existing[$cm] = $r;
            if ($anchorId === null && isset($r['action']) && $r['action'] === 'mark-routing'
                && strpos($cm, 'RAF-CUSTSTEER') !== 0) {
                $anchorId = isset($r['.id']) ? $r['.id'] : null;
            }
        }
    }

    $report = array();
    foreach ($rules as $rule) {
        $comment = isset($rule['comment']) ? (string) $rule['comment'] : '';
        $srcList = isset($rule['srcList']) ? (string) $rule['srcList'] : '';
        $kind = isset($rule['kind']) ? (string) $rule['kind'] : 'mark';
        $mark = isset($rule['mark']) ? (string) $rule['mark'] : '';
        if ($comment === '' || strpos($comment, 'RAF-CUSTSTEER') !== 0 || $srcList === '') {
            mikrotik_fail($OP, 'Rule setup tidak valid (comment wajib berawalan RAF-CUSTSTEER).', 'SPEC_ERROR', $startedAt);
        }
        if (isset($existing[$comment])) {
            $report[] = array('comment' => $comment, 'status' => 'ada', 'id' => $existing[$comment]['.id']);
            continue;
        }
        if ($checkOnly) {
            $report[] = array('comment' => $comment, 'status' => 'belum');
            continue;
        }
        $args = array(
            'chain' => 'prerouting',
            'src-address-list' => $srcList,
            'comment' => $comment
        );
        if ($kind === 'accept') {
            $args['action'] = 'accept';
        } else {
            if ($mark === '') mikrotik_fail($OP, "Rule $comment tanpa mark.", 'SPEC_ERROR', $startedAt);
            $args['action'] = 'mark-routing';
            $args['new-routing-mark'] = $mark;
            $args['passthrough'] = 'no';
        }
        if ($anchorId) $args['place-before'] = $anchorId;
        $res = $API->comm('/ip/firewall/mangle/add', $args);
        $err = als_trap_message($res);
        if ($err) mikrotik_fail($OP, "Gagal pasang rule $comment: $err", 'WRITE_ERROR', $startedAt);
        $report[] = array('comment' => $comment, 'status' => 'dibuat');
    }
    mikrotik_success($OP, $checkOnly ? 'Status rule steering.' : 'Rule steering terpasang.', array(
        'mode' => 'setup', 'check' => $checkOnly ? 1 : 0, 'anchor' => $anchorId, 'rules' => $report
    ), $startedAt);
}

mikrotik_fail($OP, "Mode tidak dikenal: $mode", 'SPEC_ERROR', $startedAt);
