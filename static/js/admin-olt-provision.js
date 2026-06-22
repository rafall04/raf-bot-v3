/**
 * Header Doc
 * Purpose: Logika halaman Provisioning OLT ZTE — scan ONU uncfg, form registrasi dinamis per
 *          tipe modem (placeholder template → input), preview script, eksekusi + log per
 *          perintah + verifikasi status/optik, rollback, CRUD profil tipe modem, dan
 *          konfigurasi/eksekusi backup OLT.
 * Caller: views/sb-admin/admin-olt-provision.php.
 * Deps: jQuery, Bootstrap 4 (modal/tab/collapse), API /api/olt/provision/*, /api/users.
 * MainFuncs: scanUncfg, checkOccupancy, classifySn/onSnInput (auto-pilih profil), buildAdvancedVars,
 *            doPreview, doExecute, verifyOnu, loadPortOnus (browser ONU per port), loadOnuTypes,
 *            saveType, loadBackupCfg, runBackupAll.
 * SideEffects: Memicu eksekusi konfigurasi OLT & penulisan backup via backend.
 */

/* eslint-disable no-unused-vars */

// Field inti yang punya input tetap di form (BUKAN bagian panel "parameter lanjutan").
// Nama ONU di VANS = username PPPoE (template pakai {{pppoeUser}}), jadi tak ada field nama/deskripsi terpisah.
const CORE_FIELDS = ['ponPort', 'onuId', 'sn', 'pppoeUser', 'pppoePassword'];

let provDevices = [];      // daftar OLT dari API
let onuTypes = [];         // profil tipe modem
let placeholderDocs = [];  // cheatsheet placeholder dari API
let vendorTiers = [];      // tabel prefix SN → tier vendor (auto-pilih profil)
let usersData = [];        // pelanggan untuk autofill
let lastExec = null;       // { deviceId, ponPort, onuId } konteks hasil eksekusi terakhir
let healthLoaded = false;  // tab kesehatan: sudah dimuat untuk device terpilih?
let bwTimer = null;        // interval auto-refresh tab bandwidth
let verifyTimer = null;
let oltFacts = null;       // fakta OLT terpilih (port PON, tipe ONU, profil, VLAN)

$(document).ready(function () {
    loadDevices();
    loadOnuTypes();
    loadUsers();
    loadBackupCfg();
    loadBackups();

    // ── Tab 1: registrasi ───────────────────────────────────────────────
    $('#scanUncfgBtn').on('click', scanUncfg);
    // Job-picker Registrasi (Fase 2): Pasang Baru / Ganti Modem / Kelola ONU.
    $('#provJobPicker button').on('click', function () {
        const job = $(this).data('job');
        $('#provJobPicker button').removeClass('btn-primary').addClass('btn-outline-primary');
        $(this).removeClass('btn-outline-primary').addClass('btn-primary');
        $('#wsPsb').toggle(job === 'psb' || job === 'ganti');
        $('#wsKelola').toggle(job === 'kelola');
        $('#gantiBanner').toggle(job === 'ganti');
    });
    $('#gantiGoKelola').on('click', function (e) { e.preventDefault(); $('#provJobPicker button[data-job="kelola"]').trigger('click'); });
    $('#testSshBtn').on('click', testSsh);
    $('#provOltSelect').on('change', function () { loadOltFacts(false); });
    $('#browseLoadBtn').on('click', loadPortOnus);
    $('#browsePort').on('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); loadPortOnus(); } });
    $('#browseSearch').on('input', renderBrowseTable);
    $('#browseTable').on('click', '.btn-row-status', function () { rowStatus($(this).data('pon'), $(this).data('onu')); });
    $('#browseTable').on('click', '.btn-row-config', function () { rowConfig($(this).data('pon'), $(this).data('onu')); });
    $('#browseTable').on('click', '.btn-row-delete', function () { rowDelete($(this).data('pon'), $(this).data('onu'), $(this).data('sn')); });
    $('#checkOccupancyBtn').on('click', function (e) { e.preventDefault(); checkOccupancy(); });
    $('#regPonPort').on('change', function () { if (this.value) checkOccupancy(true); });
    $('#regOnuType').on('change', onTypeChange);
    $('#regSn').on('input', function () { onSnInput(false); });
    $('#regSn').on('change', function () { onSnInput(true); });
    $('#regCustomer').on('change input', onCustomerPicked);
    $('#resetFormBtn').on('click', resetRegisterForm);
    $('#previewBtn').on('click', doPreview);
    $('#executeBtn').on('click', doExecute);
    $('#copyScriptBtn').on('click', function () {
        navigator.clipboard.writeText($('#previewScript').text()).then(() => flashBtn(this, 'Tersalin!'));
    });
    $('#checkStatusBtn').on('click', function () { verifyOnu(true); });
    $('#rollbackBtn').on('click', doRollback);
    $('#uncfgTable').on('click', '.btn-register-uncfg', function () {
        $('#regSn').val($(this).data('sn'));
        $('#regPonPort').val($(this).data('pon'));
        $('a[href="#tab-register"]').tab('show');
        onSnInput(true); // auto-pilih profil sesuai vendor SN
        checkOccupancy(true);
        $('#regPppoeUser').focus();
    });

    // ── Tab 2: tipe modem ───────────────────────────────────────────────
    $('#addTypeBtn').on('click', function () { openTypeModal(null); });
    $('#restoreBuiltinBtn').on('click', restoreBuiltin);
    $('#saveTypeBtn').on('click', saveType);
    $('#addVarRowBtn').on('click', function () { addVarRow('', ''); });
    $('#typesTable').on('click', '.btn-edit-type', function () { openTypeModal($(this).data('id')); });
    $('#typesTable').on('click', '.btn-dup-type', function () { openTypeModal($(this).data('id'), true); });
    $('#typesTable').on('click', '.btn-del-type', function () { deleteType($(this).data('id')); });
    $('#typeVarsRows').on('click', '.btn-del-var', function () { $(this).closest('.var-row').remove(); });

    // ── Tab 3: backup ───────────────────────────────────────────────────
    $('#bkSchedulePreset').on('change', function () {
        $('#bkSchedule').toggle(this.value === 'custom');
        if (this.value !== 'custom') $('#bkSchedule').val(this.value);
    });
    $('#saveBackupCfgBtn').on('click', saveBackupCfg);
    $('#backupAllBtn').on('click', runBackupAll);
    $('#refreshBackupsBtn').on('click', loadBackups);

    // Sorot tombol "Lanjutan" saat salah satu tab di dalam dropdown-nya aktif.
    $('#provTabs a[data-toggle="tab"]').on('shown.bs.tab', function () {
        const advanced = ['#tab-types', '#tab-vlan', '#tab-bandwidth', '#tab-console', '#tab-backup'];
        $('#provTabs .dropdown-toggle').toggleClass('active', advanced.indexOf($(this).attr('href')) !== -1);
    });

    // ── Tab 4: ACS / TR069 ──────────────────────────────────────────────
    $('a[href="#tab-acs"]').on('shown.bs.tab', function () { loadAcsSettings(); });
    $('#provOltSelect').on('change', function () { if ($('#tab-acs').hasClass('active')) loadAcsSettings(); });
    $('#saveAcsBtn').on('click', saveAcsSettings);
    $('#acsLoadBtn').on('click', function () { loadTr069Status(true); });
    $('#acsBulkBtn').on('click', bulkApplyTr069);
    $('#acsFilter').on('change', renderAcsTable);
    $('#acsSearch').on('input', renderAcsTable);
    $('#acsTable').on('click', '.btn-acs-apply', function () { applyTr069($(this).data('pon'), $(this).data('onu'), $(this).data('sn')); });
    $('#acsTable').on('click', '.btn-acs-remove', function () { removeTr069($(this).data('pon'), $(this).data('onu')); });

    // ── Tab 5: Kesehatan OLT ────────────────────────────────────────────
    $('a[href="#tab-health"]').on('shown.bs.tab', function () { if (!healthLoaded) loadHealth(); });
    $('#healthRefreshBtn').on('click', function () { loadHealth(true); });
    $('#provOltSelect').on('change', function () { healthLoaded = false; if ($('#tab-health').hasClass('active')) loadHealth(); });

    // ── Tab 6: Konsol show (read-only) ──────────────────────────────────
    $('#consoleRunBtn').on('click', runShowConsole);
    $('#consoleCmd').on('keydown', function (e) { if (e.key === 'Enter') runShowConsole(); });
    $('#consoleQuick').on('click', 'button[data-cmd]', function () { $('#consoleCmd').val($(this).data('cmd')); runShowConsole(); });

    // ── Tab 7: VLAN (config-write, preview wajib) ───────────────────────
    $('a[href="#tab-vlan"]').on('shown.bs.tab', loadVlans);
    $('#vlanRefreshBtn').on('click', loadVlans);
    $('#tab-vlan').on('click', 'button[data-vlan-action]', function () { vlanAction($(this).data('vlan-action')); });
    $('#spLoadBtn').on('click', loadServicePorts);
    $('#tab-vlan').on('click', 'button[data-sp-action]', function () { servicePortAction($(this).data('sp-action')); });
    $('#tab-vlan').on('click', 'button[data-sp-del]', function () { servicePortAction('delete', $(this).data('sp-del')); });

    // ── Tab 8: Bandwidth (monitoring read-only) ─────────────────────────
    $('a[href="#tab-bandwidth"]').on('shown.bs.tab', loadBandwidth);
    $('#bwRefreshBtn').on('click', loadBandwidth);
    $('#bwAuto').on('change', function () {
        if (bwTimer) { clearInterval(bwTimer); bwTimer = null; }
        if (this.checked) bwTimer = setInterval(function () { if ($('#tab-bandwidth').hasClass('active')) loadBandwidth(); }, 60000);
    });
});

// ════════ Util ════════

function escapeHtml(s) {
    return $('<div>').text(s == null ? '' : String(s)).html();
}

function showAlert(type, msg, sticky) {
    const icons = { info: 'fa-info-circle', warning: 'fa-exclamation-triangle', danger: 'fa-times-circle', success: 'fa-check-circle' };
    $('#provAlert').removeClass('alert-info alert-warning alert-danger alert-success').addClass('alert-' + type).show();
    $('#provAlertMsg').html('<i class="fas ' + (icons[type] || 'fa-info-circle') + '"></i> ' + msg);
    if (!sticky) setTimeout(() => $('#provAlert').fadeOut(300), 8000);
}

function flashBtn(btn, text) {
    const $b = $(btn); const orig = $b.html();
    $b.html('<i class="fas fa-check"></i> ' + text);
    setTimeout(() => $b.html(orig), 1500);
}

function setBusy(sel, busy, busyText) {
    const $b = $(sel);
    if (busy) {
        $b.data('orig-html', $b.html()).prop('disabled', true)
            .html('<i class="fas fa-spinner fa-spin"></i> ' + (busyText || 'Memproses…'));
    } else {
        $b.prop('disabled', false).html($b.data('orig-html') || $b.html());
    }
}

async function api(method, url, body) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let json = null;
    try { json = await res.json(); } catch (_e) { json = { status: res.status, message: 'Respons bukan JSON' }; }
    return json;
}

function currentDevice() {
    const id = $('#provOltSelect').val();
    return provDevices.find((d) => d.id === id) || null;
}

function requireDevice() {
    const dev = currentDevice();
    if (!dev) { showAlert('warning', 'Pilih OLT terlebih dahulu.'); return null; }
    if (!dev.sshReady) {
        showAlert('warning', `Kredensial SSH OLT "${escapeHtml(dev.name)}" belum diisi. Atur di <a href="/config">Konfigurasi → OLT</a>.`, true);
        return null;
    }
    return dev;
}

// ════════ Kesehatan OLT ════════

function healthLevelBadge(level) {
    return level === 'critical' ? 'danger' : (level === 'warn' ? 'warning' : 'secondary');
}

async function loadHealth(force) {
    const dev = requireDevice();
    if (!dev) return;
    $('#healthBody').html('<div class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin"></i> Mengambil data kesehatan dari OLT…</div>');
    $('#healthAlerts').empty();
    if (force) setBusy('#healthRefreshBtn', true, 'Memuat…');
    try {
        const json = await api('GET', '/api/olt/provision/devices/' + encodeURIComponent(dev.id) + '/health' + (force ? '?refresh=1' : ''));
        if (!json || !json.data) {
            showAlert('danger', (json && json.message) || 'Gagal memuat kesehatan OLT');
            $('#healthBody').html('<div class="alert alert-danger">Gagal memuat data.</div>');
            return;
        }
        renderHealth(json.data);
        healthLoaded = true;
    } catch (e) {
        showAlert('danger', 'Error: ' + e.message);
    } finally {
        if (force) setBusy('#healthRefreshBtn', false);
    }
}

function renderHealth(h) {
    const dash = (v) => (v == null ? '–' : v);
    if (!h.ok) {
        $('#healthUpdated').text('');
        $('#healthAlerts').empty();
        $('#healthBody').html('<div class="alert alert-danger"><i class="fas fa-times-circle"></i> OLT tak terjangkau: ' + escapeHtml(h.error || 'tidak diketahui') + '</div>');
        return;
    }
    $('#healthUpdated').text(
        'Diperbarui: ' + new Date(h.fetchedAt).toLocaleString('id-ID') + (h.cached ? ' (cache)' : '') + (h.source ? ' · ' + h.source : '')
    );

    const alerts = h.alerts || [];
    $('#healthAlerts').html(alerts.length
        ? alerts.map((a) => '<div class="alert alert-' + healthLevelBadge(a.level) + ' py-2 mb-2"><i class="fas fa-exclamation-triangle"></i> ' + escapeHtml(a.message) + '</div>').join('')
        : '<div class="alert alert-success py-2 mb-2"><i class="fas fa-check-circle"></i> Semua metrik dalam batas normal.</div>');

    const t = h.temperature || {};
    let tempLevel = 'success';
    if (t.envTempC != null && t.criticalTempC != null && t.envTempC >= t.criticalTempC) tempLevel = 'danger';
    else if (t.envTempC != null && t.highTempC != null && t.envTempC >= t.highTempC) tempLevel = 'danger';
    else if (t.envTempC != null && t.highTempC != null && t.envTempC >= t.highTempC - 10) tempLevel = 'warning';
    const fansHtml = (t.fans || []).map((f) => 'Kipas ' + f.id + ': ' + f.rpm + ' RPM (lvl ' + f.speedLevel + ')').join('<br>') || '–';

    const id = h.identity || {};
    const v = h.vlans || {};
    const pe = h.powerEnv || {};
    const peActive = (pe.activeAlarms || []).length;
    const peHtml = pe.catalog
        ? '<hr class="my-2"><small class="text-muted">Power/Env (EMU): ' +
          (peActive
              ? '<span class="badge badge-danger">' + peActive + ' alarm aktif</span>'
              : '<span class="badge badge-success">normal</span>') +
          ' <small class="text-muted">(' + (pe.mappedCount || 0) + '/' + (pe.channels || []).length + ' input dikabeli)</small></small>'
        : '';
    const procRows = (h.processors || []).map((p) =>
        '<tr><td>' + p.slot + '</td><td>' + dash(p.cpu5s) + '% / ' + dash(p.cpu1m) + '% / ' + dash(p.cpu5m) + '%</td><td>' + dash(p.memPct) + '% <small class="text-muted">(' + dash(p.phyMemMb) + 'MB)</small></td></tr>').join('');
    const cardRows = (h.cards || []).map((c) =>
        '<tr class="' + (c.ok ? '' : 'table-danger') + '"><td>' + c.slot + '</td><td>' + escapeHtml((c.cfgType || '') + '/' + (c.realType || '-')) + '</td><td>' + dash(c.port) + '</td><td><span class="badge badge-' + (c.ok ? 'success' : 'danger') + '">' + escapeHtml(c.status) + '</span></td></tr>').join('');
    const upRows = (h.uplinks || []).map((u) => {
        const ok = u.up && u.protoUp;
        return '<tr class="' + (ok ? '' : 'table-danger') + '"><td>' + escapeHtml(u.name) + '</td><td><span class="badge badge-' + (ok ? 'success' : 'danger') + '">' + (ok ? 'UP' : 'DOWN') + '</span> <small>' + escapeHtml(u.media || '') + '</small></td><td>in ' + dash(u.utilIn) + '% / out ' + dash(u.utilOut) + '%</td><td>CRC ' + dash(u.crcError) + ' / drop ' + dash(u.drops) + '</td></tr>';
    }).join('');
    const l3Rows = (h.l3 || []).map((x) =>
        '<tr><td>' + escapeHtml(x.interface) + '</td><td>' + escapeHtml(x.ip) + '</td><td><span class="badge badge-' + (x.prot === 'up' ? 'success' : 'secondary') + '">' + escapeHtml(x.prot) + '</span></td></tr>').join('');

    $('#healthBody').html(
        '<div class="row">' +
          '<div class="col-md-4 mb-4"><div class="card shadow h-100 border-left-' + tempLevel + '"><div class="card-body">' +
            '<div class="text-xs font-weight-bold text-' + tempLevel + ' text-uppercase mb-1">Suhu Lingkungan</div>' +
            '<div class="h2 mb-0 font-weight-bold">' + dash(t.envTempC) + '°C</div>' +
            '<small class="text-muted">Ambang tinggi ' + dash(t.highTempC) + '°C · kritis ' + dash(t.criticalTempC) + '°C · ' + escapeHtml(t.powerMode || '') + '</small>' +
            '<hr class="my-2"><small>' + fansHtml + '</small>' +
          '</div></div></div>' +
          '<div class="col-md-4 mb-4"><div class="card shadow h-100"><div class="card-body">' +
            '<div class="text-xs font-weight-bold text-primary text-uppercase mb-1">Perangkat</div>' +
            '<div class="h5 mb-0">' + escapeHtml(id.name || '-') + ' <small class="text-muted">' + escapeHtml(id.version || '') + '</small></div>' +
            '<small class="text-muted d-block mt-1">Uptime: ' + escapeHtml(id.uptime || '-') + '</small>' +
            '<small class="text-muted d-block">' + escapeHtml(id.location || '') + '</small>' +
          '</div></div></div>' +
          '<div class="col-md-4 mb-4"><div class="card shadow h-100"><div class="card-body">' +
            '<div class="text-xs font-weight-bold text-primary text-uppercase mb-1">VLAN &amp; Penyimpanan</div>' +
            '<div class="h5 mb-0">' + dash(v.count) + ' VLAN</div>' +
            '<small class="text-muted d-block">' + escapeHtml((v.list || []).join(', ')) + '</small>' +
            '<hr class="my-2"><small class="text-muted">Penyimpanan/flash &amp; voltase PSU: <span class="badge badge-secondary">N/A</span> <span title="Firmware ZXAN C320 ini tak mengekspos flash-usage / voltase PSU internal via CLI maupun SNMP.">(tak diekspos firmware)</span></small>' +
            peHtml +
          '</div></div></div>' +
        '</div>' +
        '<div class="row">' +
          '<div class="col-lg-6 mb-4"><div class="card shadow h-100"><div class="card-header py-2"><h6 class="m-0 font-weight-bold text-primary">CPU &amp; Memori per Slot</h6></div><div class="card-body p-2"><div class="table-responsive"><table class="table table-sm table-bordered mb-0"><thead class="thead-light"><tr><th>Slot</th><th>CPU 5s/1m/5m</th><th>Memori</th></tr></thead><tbody>' + (procRows || '<tr><td colspan="3" class="text-center text-muted">–</td></tr>') + '</tbody></table></div></div></div></div>' +
          '<div class="col-lg-6 mb-4"><div class="card shadow h-100"><div class="card-header py-2"><h6 class="m-0 font-weight-bold text-primary">Kartu / Slot</h6></div><div class="card-body p-2"><div class="table-responsive"><table class="table table-sm table-bordered mb-0"><thead class="thead-light"><tr><th>Slot</th><th>Tipe</th><th>Port</th><th>Status</th></tr></thead><tbody>' + (cardRows || '<tr><td colspan="4" class="text-center text-muted">–</td></tr>') + '</tbody></table></div></div></div></div>' +
        '</div>' +
        '<div class="row">' +
          '<div class="col-lg-7 mb-4"><div class="card shadow h-100"><div class="card-header py-2"><h6 class="m-0 font-weight-bold text-primary">Uplink (port fisik)</h6></div><div class="card-body p-2"><div class="table-responsive"><table class="table table-sm table-bordered mb-0"><thead class="thead-light"><tr><th>Port</th><th>Status</th><th>Utilisasi</th><th>Error</th></tr></thead><tbody>' + (upRows || '<tr><td colspan="4" class="text-center text-muted">–</td></tr>') + '</tbody></table></div></div></div></div>' +
          '<div class="col-lg-5 mb-4"><div class="card shadow h-100"><div class="card-header py-2"><h6 class="m-0 font-weight-bold text-primary">Interface L3</h6></div><div class="card-body p-2"><div class="table-responsive"><table class="table table-sm table-bordered mb-0"><thead class="thead-light"><tr><th>Interface</th><th>IP</th><th>Proto</th></tr></thead><tbody>' + (l3Rows || '<tr><td colspan="3" class="text-center text-muted">–</td></tr>') + '</tbody></table></div></div></div></div>' +
        '</div>'
    );
}

// ════════ Konsol show (read-only) ════════

async function runShowConsole() {
    const dev = requireDevice();
    if (!dev) return;
    const cmd = ($('#consoleCmd').val() || '').trim();
    if (!cmd) {
        showAlert('warning', 'Ketik perintah show dulu.');
        return;
    }
    $('#consoleOut').text('⏳ Menjalankan: ' + cmd);
    setBusy('#consoleRunBtn', true, 'Menjalankan…');
    try {
        const json = await api('POST', '/api/olt/provision/devices/' + encodeURIComponent(dev.id) + '/show', { command: cmd });
        const d = json && json.data;
        if (d && d.ok) {
            $('#consoleOut').text('$ ' + d.command + '\n\n' + (d.output || '(output kosong)'));
        } else {
            $('#consoleOut').text('✖ ' + ((d && d.error) || (json && json.message) || 'Gagal menjalankan perintah'));
        }
    } catch (e) {
        $('#consoleOut').text('✖ Error: ' + e.message);
    } finally {
        setBusy('#consoleRunBtn', false);
    }
}

// ════════ VLAN (config-write, preview wajib) ════════

async function loadVlans() {
    const dev = requireDevice();
    if (!dev) return;
    $('#vlanList').html('<i class="fas fa-spinner fa-spin"></i> Memuat…');
    try {
        const json = await api('GET', '/api/olt/provision/devices/' + encodeURIComponent(dev.id) + '/vlans');
        const v = json && json.data;
        if (v) {
            $('#vlanList').html(
                '<b>' + (v.count != null ? v.count : '?') + ' VLAN aktif:</b><br>' +
                    (v.list || []).map((x) => '<span class="badge badge-info mr-1 mb-1">' + escapeHtml(x) + '</span>').join('')
            );
        } else {
            $('#vlanList').text('Gagal memuat daftar VLAN.');
        }
    } catch (e) {
        $('#vlanList').text('Error: ' + e.message);
    }
}

function vlanActionBody(action) {
    const isTrunk = action.indexOf('trunk') === 0;
    const body = { action, id: isTrunk ? $('#vlanTrunkId').val() : $('#vlanId').val() };
    if (action === 'create') {
        body.name = $('#vlanName').val();
        body.description = $('#vlanDesc').val();
    }
    if (isTrunk) body.port = $('#vlanTrunkPort').val();
    return body;
}

async function vlanAction(action) {
    const dev = requireDevice();
    if (!dev) return;
    const body = vlanActionBody(action);
    try {
        // 1) Preview (generate + guard) — tanpa eksekusi.
        const pv = await api('POST', '/api/olt/provision/devices/' + encodeURIComponent(dev.id) + '/vlan/preview', body);
        if (!pv || pv.status !== 200 || !pv.data) {
            showAlert('danger', (pv && pv.message) || 'Preview gagal.');
            return;
        }
        // 2) Konfirmasi eksplisit dengan ringkasan + script.
        const ok = window.confirm(
            'KONFIRMASI KONFIG OLT\n\n' + pv.data.summary + '\n\nPerintah yang dijalankan:\n' + pv.data.commands.join('\n') + '\n\nJalankan ke OLT sekarang (write/persist)?'
        );
        if (!ok) return;
        // 3) Apply (eksekusi + audit).
        const ap = await api('POST', '/api/olt/provision/devices/' + encodeURIComponent(dev.id) + '/vlan/apply', body);
        if (ap && ap.status === 200) {
            showAlert('success', '✅ ' + (ap.message || 'Berhasil dijalankan.'));
            loadVlans();
        } else {
            const errs = ap && ap.data && ap.data.results ? ap.data.results.filter((r) => r.error).map((r) => r.command + ': ' + r.error).join('; ') : '';
            showAlert('danger', '✖ ' + ((ap && ap.message) || 'Gagal') + (errs ? ' — ' + errs : ''), true);
        }
    } catch (e) {
        showAlert('danger', 'Error: ' + e.message);
    }
}

// ════════ Service-port per ONU (config-write per-pelanggan) ════════

async function loadServicePorts() {
    const dev = requireDevice();
    if (!dev) return;
    const onu = ($('#spOnu').val() || '').trim();
    if (!onu) {
        showAlert('warning', 'Isi interface ONU dulu (mis. gpon-onu_1/2/2:33).');
        return;
    }
    $('#spList').html('<i class="fas fa-spinner fa-spin"></i> Memuat…');
    try {
        const json = await api('GET', '/api/olt/provision/devices/' + encodeURIComponent(dev.id) + '/onu-serviceports?onu=' + encodeURIComponent(onu));
        if (!json || !json.data) {
            $('#spList').text((json && json.message) || 'Gagal memuat (format ONU salah?).');
            return;
        }
        const d = json.data;
        const rows = (d.servicePorts || [])
            .map((s) =>
                '<tr><td>' + s.index + '</td><td>' + s.vport + '</td><td>' + s.userVlan + '</td><td>' + s.svlan +
                    '</td><td><button class="btn btn-outline-danger btn-sm py-0" data-sp-del="' + s.index + '"><i class="fas fa-trash"></i></button></td></tr>'
            )
            .join('');
        $('#spList').html(
            '<b>' + escapeHtml(d.name || onu) + '</b>' +
                '<div class="table-responsive mt-1"><table class="table table-sm table-bordered mb-0"><thead class="thead-light"><tr><th>idx</th><th>vport</th><th>user-vlan</th><th>svlan</th><th>aksi</th></tr></thead><tbody>' +
                (rows || '<tr><td colspan="5" class="text-center text-muted">tak ada service-port</td></tr>') +
                '</tbody></table></div>'
        );
    } catch (e) {
        $('#spList').text('Error: ' + e.message);
    }
}

async function servicePortAction(action, delIndex) {
    const dev = requireDevice();
    if (!dev) return;
    const onu = ($('#spOnu').val() || '').trim();
    const body = { action, onu };
    if (action === 'add') {
        body.index = $('#spIndex').val();
        body.vport = $('#spVport').val();
        body.userVlan = $('#spUserVlan').val();
        body.svlan = $('#spSvlan').val();
    } else {
        body.index = delIndex;
    }
    try {
        const pv = await api('POST', '/api/olt/provision/devices/' + encodeURIComponent(dev.id) + '/serviceport/preview', body);
        if (!pv || pv.status !== 200 || !pv.data) {
            showAlert('danger', (pv && pv.message) || 'Preview gagal.');
            return;
        }
        const ok = window.confirm(
            'KONFIRMASI SERVICE-PORT (per pelanggan!)\n\n' + pv.data.summary + '\n\nPerintah:\n' + pv.data.commands.join('\n') + '\n\nMengubah service-port pelanggan aktif bisa memutus layanannya. Jalankan (write/persist)?'
        );
        if (!ok) return;
        const ap = await api('POST', '/api/olt/provision/devices/' + encodeURIComponent(dev.id) + '/serviceport/apply', body);
        if (ap && ap.status === 200) {
            showAlert('success', '✅ ' + (ap.message || 'Berhasil dijalankan.'));
            loadServicePorts();
        } else {
            const errs = ap && ap.data && ap.data.results ? ap.data.results.filter((r) => r.error).map((r) => r.command + ': ' + r.error).join('; ') : '';
            showAlert('danger', '✖ ' + ((ap && ap.message) || 'Gagal') + (errs ? ' — ' + errs : ''), true);
        }
    } catch (e) {
        showAlert('danger', 'Error: ' + e.message);
    }
}

// ════════ Bandwidth (monitoring read-only) ════════

function fmtMbps(bps) {
    if (bps == null) return '–';
    const mbps = (bps * 8) / 1e6;
    return mbps >= 1 ? mbps.toFixed(1) + ' Mbps' : ((bps * 8) / 1e3).toFixed(0) + ' Kbps';
}

function bwSpark(arr, field) {
    if (!arr || arr.length < 2) return '';
    const vals = arr.map((p) => (p[field] == null ? 0 : p[field]));
    const max = Math.max.apply(null, vals.concat([1]));
    const W = 110;
    const H = 22;
    const n = vals.length;
    const pts = vals.map((v, i) => ((i / (n - 1)) * W).toFixed(1) + ',' + (H - (v / max) * H).toFixed(1)).join(' ');
    return '<svg width="' + W + '" height="' + H + '"><polyline fill="none" stroke="currentColor" stroke-width="1.5" points="' + pts + '"></polyline></svg>';
}

async function loadBandwidth() {
    const dev = requireDevice();
    if (!dev) return;
    $('#bwBody').html('<div class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin"></i> Mengambil rate dari OLT…</div>');
    try {
        const json = await api('GET', '/api/olt/provision/devices/' + encodeURIComponent(dev.id) + '/bandwidth');
        const d = json && json.data;
        if (!d || d.ok === false) {
            $('#bwBody').html('<div class="alert alert-danger">' + escapeHtml((d && d.error) || (json && json.message) || 'Gagal memuat bandwidth.') + '</div>');
            return;
        }
        let hist = {};
        try {
            const h = await api('GET', '/api/olt/provision/devices/' + encodeURIComponent(dev.id) + '/bandwidth/history');
            hist = (h && h.data) || {};
        } catch (_e) {
            hist = {};
        }
        renderBandwidth(d, hist);
    } catch (e) {
        $('#bwBody').html('<div class="alert alert-danger">Error: ' + escapeHtml(e.message) + '</div>');
    }
}

function renderBandwidth(d, hist) {
    $('#bwUpdated').text('Diperbarui: ' + new Date(d.fetchedAt).toLocaleTimeString('id-ID') + (d.cached ? ' (cache)' : ''));
    const utilStr = (a, b) => (a != null ? a.toFixed(1) : '–') + '% / ' + (b != null ? b.toFixed(1) : '–') + '%';
    const upRows = (d.uplinks || [])
        .map((u) =>
            '<tr class="' + (u.up ? '' : 'table-danger') + '"><td>' + escapeHtml(u.name) + '</td><td>' + fmtMbps(u.inBps) + '</td><td>' + fmtMbps(u.outBps) +
                '</td><td>' + utilStr(u.utilIn, u.utilOut) + '</td><td class="text-primary">' + bwSpark(hist[u.name], 'outBps') + '</td></tr>'
        )
        .join('');
    const ponRows = (d.pons || [])
        .map((p) => {
            const busy = (p.utilOut || 0) >= 70 || (p.utilIn || 0) >= 70;
            return '<tr class="' + (busy ? 'table-warning' : '') + '"><td>' + escapeHtml(p.name) + '</td><td>' +
                (p.onuRegistered != null ? p.onuRegistered : '–') + '/' + (p.onuCapacity != null ? p.onuCapacity : '–') + '</td><td>' +
                fmtMbps(p.inBps) + '</td><td>' + fmtMbps(p.outBps) + '</td><td>' + utilStr(p.utilIn, p.utilOut) +
                '</td><td class="text-success">' + bwSpark(hist[p.name], 'outBps') + '</td></tr>';
        })
        .join('');
    $('#bwBody').html(
        '<div class="card shadow mb-3"><div class="card-header py-2"><h6 class="m-0 font-weight-bold text-primary">Uplink</h6></div><div class="card-body p-2"><div class="table-responsive"><table class="table table-sm table-bordered mb-0"><thead class="thead-light"><tr><th>Port</th><th>&darr; In</th><th>&uarr; Out</th><th>Util in/out</th><th>Tren out</th></tr></thead><tbody>' +
            (upRows || '<tr><td colspan="5" class="text-center text-muted">–</td></tr>') +
            '</tbody></table></div></div></div>' +
            '<div class="card shadow"><div class="card-header py-2"><h6 class="m-0 font-weight-bold text-primary">Per PON</h6></div><div class="card-body p-2"><div class="table-responsive"><table class="table table-sm table-bordered mb-0"><thead class="thead-light"><tr><th>PON</th><th>ONU</th><th>&darr; In</th><th>&uarr; Out</th><th>Util in/out</th><th>Tren out</th></tr></thead><tbody>' +
            (ponRows || '<tr><td colspan="6" class="text-center text-muted">–</td></tr>') +
            '</tbody></table></div></div></div>'
    );
}

// ════════ Devices ════════

async function loadDevices() {
    try {
        const json = await api('GET', '/api/olt/provision/devices');
        if (json.status !== 200) { showAlert('danger', json.message || 'Gagal memuat daftar OLT'); return; }
        provDevices = json.data || [];
        const opts = ['<option value="">— Pilih OLT —</option>'].concat(provDevices.map((d) => {
            const sshTag = d.sshReady ? '' : ' — SSH belum diisi';
            return `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)} (${escapeHtml(d.host)})${sshTag}</option>`;
        }));
        $('#provOltSelect').html(opts.join(''));
        const ready = provDevices.find((d) => d.sshReady);
        if (ready) {
            $('#provOltSelect').val(ready.id);
            loadOltFacts(false);
        }
    } catch (e) {
        showAlert('danger', 'Gagal memuat daftar OLT: ' + escapeHtml(e.message));
    }
}

// ── Fakta OLT (port PON / tipe ONU / profil / VLAN) → datalist form ─────

async function loadOltFacts(force) {
    oltFacts = null;
    $('#ponPortList').empty();
    const dev = currentDevice();
    if (!dev || !dev.sshReady) { $('#oltFactsInfo').empty(); return; }
    $('#oltFactsInfo').html('<i class="fas fa-spinner fa-spin"></i> Membaca data OLT (port PON, profil, VLAN)…');
    try {
        const json = await api('GET', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/facts${force ? '?force=true' : ''}`);
        if (json.status !== 200) {
            $('#oltFactsInfo').html('<span class="text-warning"><i class="fas fa-exclamation-triangle"></i> ' + escapeHtml(json.message || 'Gagal baca data OLT') + '</span>');
            return;
        }
        oltFacts = json.data;
        $('#ponPortList').html((oltFacts.ponPorts || []).map((p) => `<option value="${escapeHtml(p)}">`).join(''));
        $('#oltFactsInfo').html(
            `<i class="fas fa-check-circle text-success"></i> ${(oltFacts.ponPorts || []).length} port PON • ` +
            `${(oltFacts.onuTypes || []).length} tipe ONU • tcont: ${(oltFacts.tcontProfiles || []).join(', ') || '-'} • ` +
            `VLAN: ${(oltFacts.vlans || []).join(', ') || '-'} ` +
            `<a href="#" id="refreshFactsLink" title="Baca ulang dari OLT"><i class="fas fa-sync-alt"></i></a>`);
        $('#refreshFactsLink').on('click', function (e) { e.preventDefault(); loadOltFacts(true); });
        rebuildFactDatalists();
        onTypeChange(); // pasang datalist ke input parameter lanjutan yang sudah dirender
    } catch (e) {
        $('#oltFactsInfo').html('<span class="text-warning">Gagal baca data OLT: ' + escapeHtml(e.message) + '</span>');
    }
}

/** Datalist global dari fakta OLT (dipakai input parameter lanjutan). */
function rebuildFactDatalists() {
    $('#factDatalists').remove();
    if (!oltFacts) return;
    const dl = (id, values) => `<datalist id="${id}">${(values || []).map((v) => `<option value="${escapeHtml(v)}">`).join('')}</datalist>`;
    $('body').append(`<div id="factDatalists" style="display:none">
        ${dl('dlOnuType', (oltFacts.onuTypes || []).map((t) => t.name))}
        ${dl('dlTcont', oltFacts.tcontProfiles)}
        ${dl('dlTraffic', oltFacts.trafficProfiles)}
        ${dl('dlVlan', oltFacts.vlans)}
    </div>`);
}

/** Map key parameter → datalist fakta OLT (null bila tak ada saran). */
function datalistForKey(key) {
    if (!oltFacts) return null;
    if (key === 'onuType') return 'dlOnuType';
    if (key === 'tcontProfile') return 'dlTcont';
    if (key === 'downProfile') return 'dlTraffic';
    if (/Vlan$/.test(key)) return 'dlVlan';
    return null;
}

async function testSsh() {
    const dev = requireDevice();
    if (!dev) return;
    setBusy('#testSshBtn', true, '');
    try {
        const json = await api('POST', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/test-ssh`);
        if (json.status === 200) showAlert('success', `SSH OK — ${escapeHtml(json.message)}`);
        else showAlert('danger', 'SSH gagal: ' + escapeHtml(json.message), true);
    } finally {
        setBusy('#testSshBtn', false);
    }
}

// ════════ Scan uncfg ════════

async function scanUncfg() {
    const dev = requireDevice();
    if (!dev) return;
    setBusy('#scanUncfgBtn', true, 'Scan via SSH…');
    const $tb = $('#uncfgTable tbody');
    try {
        const json = await api('GET', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/uncfg`);
        if (json.status !== 200) { showAlert('danger', escapeHtml(json.message || 'Scan gagal'), true); return; }
        const onus = json.data || [];
        if (!onus.length) {
            $tb.html('<tr><td colspan="4" class="text-center text-muted">Tidak ada ONU baru yang menunggu registrasi</td></tr>');
            showAlert('info', 'Scan selesai — tidak ada ONU belum teregistrasi.');
            return;
        }
        $tb.html(onus.map((o) => `
            <tr>
                <td class="mono">${escapeHtml(o.sn)}</td>
                <td>${escapeHtml(o.ponPort)}</td>
                <td><span class="badge badge-warning">${escapeHtml(o.state)}</span></td>
                <td><button class="btn btn-primary btn-sm btn-register-uncfg" data-sn="${escapeHtml(o.sn)}" data-pon="${escapeHtml(o.ponPort)}">
                    <i class="fas fa-user-plus"></i> Daftarkan</button></td>
            </tr>`).join(''));
        showAlert('success', `Ditemukan ${onus.length} ONU belum teregistrasi.`);
    } catch (e) {
        showAlert('danger', 'Scan gagal: ' + escapeHtml(e.message), true);
    } finally {
        setBusy('#scanUncfgBtn', false);
    }
}

// ════════ Okupansi & saran ONU ID ════════

async function checkOccupancy(silent) {
    const dev = requireDevice();
    if (!dev) return;
    const ponPort = $('#regPonPort').val().trim();
    if (!/^\d{1,2}\/\d{1,2}\/\d{1,2}$/.test(ponPort)) {
        if (!silent) {
            // Beri umpan balik DI TEMPAT (dekat tombol), bukan cuma alert di atas yang gampang terlewat.
            $('#occupancyInfo').show().html('<span class="text-warning"><i class="fas fa-exclamation-triangle"></i> Isi <b>Port PON</b> dulu (mis. <code>1/2/1</code>). "cek slot" membaca ONU ID yang sudah terpakai di port itu lalu mengisi <b>ONU ID</b> kosong otomatis.</span>');
            $('#regPonPort').focus();
        }
        return;
    }
    $('#occupancyInfo').show().html('<i class="fas fa-spinner fa-spin"></i> Mengecek slot ONU terpakai…');
    try {
        const json = await api('GET', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/occupancy?ponPort=${encodeURIComponent(ponPort)}`);
        if (json.status !== 200) { $('#occupancyInfo').html('<span class="text-danger">' + escapeHtml(json.message) + '</span>'); return; }
        const d = json.data;
        if (d.suggestedId && !$('#regOnuId').val()) $('#regOnuId').val(d.suggestedId);
        const usedStr = d.usedIds.length ? summarizeIds(d.usedIds) : 'kosong';
        $('#occupancyInfo').html(
            `<i class="fas fa-info-circle"></i> Port <b>${escapeHtml(ponPort)}</b>: ${d.usedIds.length} ONU terpakai (${escapeHtml(usedStr)}) — ` +
            (d.suggestedId ? `saran ID berikutnya: <b>${d.suggestedId}</b>` : '<span class="text-danger">PENUH (128)</span>'));
    } catch (e) {
        $('#occupancyInfo').html('<span class="text-danger">Gagal cek slot: ' + escapeHtml(e.message) + '</span>');
    }
}

/** Ringkas [1,2,3,5,7,8] → "1-3, 5, 7-8" supaya info okupansi tetap pendek. */
function summarizeIds(ids) {
    const s = [...ids].sort((a, b) => a - b);
    const parts = [];
    let start = s[0], prev = s[0];
    for (let i = 1; i <= s.length; i++) {
        if (s[i] === prev + 1) { prev = s[i]; continue; }
        parts.push(start === prev ? String(start) : `${start}-${prev}`);
        start = prev = s[i];
    }
    return parts.join(', ');
}

// ════════ Tipe modem → form dinamis ════════

async function loadOnuTypes() {
    try {
        const json = await api('GET', '/api/olt/provision/onu-types');
        if (json.status !== 200) return;
        onuTypes = json.data || [];
        placeholderDocs = json.placeholders || [];
        vendorTiers = json.vendorTiers || [];
        const opts = onuTypes.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`);
        $('#regOnuType').html(opts.join(''));
        onTypeChange();
        renderTypesTable();
        renderPlaceholderHelp();
    } catch (e) {
        showAlert('danger', 'Gagal memuat profil tipe modem: ' + escapeHtml(e.message));
    }
}

function selectedType() {
    return onuTypes.find((t) => t.id === $('#regOnuType').val()) || null;
}

function onTypeChange() {
    const t = selectedType();
    $('#regOnuTypeNotes').text(t ? (t.notes || '') : '');
    buildAdvancedVars(t);
}

// ════════ Klasifikasi SN → auto-pilih profil (anti salah-klik teknisi) ════════

/** Klasifikasi vendor dari prefix SN memakai tabel dari server (sumber kebenaran tunggal). */
function classifySn(sn) {
    const prefix = String(sn || '').toUpperCase().slice(0, 4);
    const hit = vendorTiers.find((v) => v.prefix === prefix);
    return hit ? { ...hit, prefix } : { prefix, vendor: 'Tidak dikenal', tier: 'unknown', oltPushable: false };
}

/** Profil yang vendorMatch-nya memuat tier ini (profil rekomendasi). */
function recommendedTypeFor(tier) {
    return onuTypes.find((t) => Array.isArray(t.vendorMatch) && t.vendorMatch.includes(tier)) || null;
}

const VENDOR_BADGE = {
    zte: { cls: 'success', note: 'ZTE asli — ACS via OLT otomatis (tr069-mgmt).' },
    clone: { cls: 'warning', note: 'Clone/OEM — ACS harus diset DI MODEM (in-band).' },
    huawei: { cls: 'secondary', note: 'Huawei — pakai mode Bridge, WAN diurus di modem.' },
    unknown: { cls: 'light', note: 'Prefix SN tak dikenal — pilih tipe modem manual.' },
};

/**
 * Klasifikasi SN saat ini → badge vendor + auto-pilih profil yang cocok.
 * @param {boolean} autoSelect true: ganti dropdown tipe modem ke profil rekomendasi
 */
function onSnInput(autoSelect) {
    const sn = $('#regSn').val().trim().toUpperCase();
    const $info = $('#snVendorInfo');
    if (sn.length < 4) { $info.empty(); return; }
    const c = classifySn(sn);
    const b = VENDOR_BADGE[c.tier] || VENDOR_BADGE.unknown;
    const rec = recommendedTypeFor(c.tier);
    let html = `<span class="badge badge-${b.cls}">${escapeHtml(c.vendor)}</span> <span class="text-muted">${escapeHtml(b.note)}</span>`;
    if (rec) html += ` &rarr; profil: <b>${escapeHtml(rec.name)}</b>`;
    $info.html(html);
    if (autoSelect && rec && $('#regOnuType').val() !== rec.id) {
        $('#regOnuType').val(rec.id);
        onTypeChange();
    }
}

/** Placeholder yang dipakai template (urutan kemunculan, tanpa duplikat). */
function templatePlaceholders(template) {
    const found = [];
    const re = /\{\{\s*([\w.-]+)\s*\}\}/g;
    let m;
    while ((m = re.exec(template || '')) !== null) {
        if (!found.includes(m[1])) found.push(m[1]);
    }
    return found;
}

/** Bangun panel "parameter lanjutan": placeholder template ∪ vars profil, minus field inti. */
function buildAdvancedVars(type) {
    const $body = $('#advancedVarsBody');
    if (!type) { $body.html('<div class="text-muted small">Pilih tipe modem dulu.</div>'); return; }
    const keys = templatePlaceholders(type.scriptTemplate);
    Object.keys(type.vars || {}).forEach((k) => { if (!keys.includes(k)) keys.push(k); });
    const advanced = keys.filter((k) => !CORE_FIELDS.includes(k));
    if (!advanced.length) { $body.html('<div class="text-muted small">Profil ini tidak punya parameter tambahan.</div>'); return; }
    const docMap = {};
    placeholderDocs.forEach((p) => { docMap[p.key] = p.desc; });
    $body.html('<div class="form-row">' + advanced.map((k) => {
        const dl = datalistForKey(k);
        return `
        <div class="form-group col-md-4 mb-2">
            <label class="small mb-0" for="adv_${escapeHtml(k)}" title="${escapeHtml(docMap[k] || '')}">${escapeHtml(k)}</label>
            <input type="text" class="form-control form-control-sm adv-var" id="adv_${escapeHtml(k)}" data-key="${escapeHtml(k)}"
                   ${dl ? `list="${dl}"` : ''} value="${escapeHtml((type.vars && type.vars[k]) || '')}" autocomplete="off">
        </div>`;
    }).join('') + '</div>');
}

// ════════ Pelanggan → autofill ════════

async function loadUsers() {
    try {
        const res = await fetch('/api/users?limit=9999', { credentials: 'include' });
        const json = await res.json();
        if (json.status === 200 && Array.isArray(json.data)) {
            usersData = json.data;
            $('#customerList').html(usersData
                .filter((u) => u && u.name)
                .map((u) => `<option value="${escapeHtml(u.name)}">${escapeHtml(u.pppoe_username || '')}</option>`)
                .join(''));
        }
    } catch (_e) { /* autofill opsional — halaman tetap berfungsi */ }
}

function onCustomerPicked() {
    const name = $('#regCustomer').val();
    const user = usersData.find((u) => u.name === name);
    if (!user) return;
    const pppoe = user.pppoe_username || '';
    if (pppoe) {
        $('#regPppoeUser').val(pppoe);
        if (!$('#regPppoePassword').val()) $('#regPppoePassword').val(user.pppoe_password || pppoe);
    }
}

// ════════ Preview & eksekusi ════════

function collectVars() {
    const vars = {
        ponPort: $('#regPonPort').val().trim(),
        onuId: $('#regOnuId').val().trim(),
        sn: $('#regSn').val().trim().toUpperCase(),
        pppoeUser: $('#regPppoeUser').val().trim(),
        pppoePassword: $('#regPppoePassword').val().trim(),
    };
    $('.adv-var').each(function () {
        const v = $(this).val().trim();
        if (v !== '') vars[$(this).data('key')] = v;
    });
    // Buang field kosong supaya default profil dipakai (server merge profile.vars dulu).
    Object.keys(vars).forEach((k) => { if (vars[k] === '') delete vars[k]; });
    return vars;
}

function validateFormQuick(vars, type) {
    const errs = [];
    if (!type) errs.push('Pilih tipe modem.');
    if (!vars.sn) errs.push('Serial Number wajib diisi (scan atau ketik manual).');
    if (!vars.ponPort) errs.push('Port PON wajib diisi (contoh 1/2/1).');
    if (!vars.onuId) errs.push('ONU ID wajib diisi (klik "cek slot" untuk saran).');
    // Hanya wajibkan field yang memang dipakai template profil terpilih.
    const used = type ? templatePlaceholders(type.scriptTemplate) : [];
    const labels = { pppoeUser: 'Username PPPoE', pppoePassword: 'Password PPPoE' };
    ['pppoeUser', 'pppoePassword'].forEach((k) => {
        if (used.includes(k) && !vars[k]) errs.push(`${labels[k]} dipakai template ini — wajib diisi.`);
    });
    return errs;
}

async function doPreview() {
    // Preview hanya merender script (tanpa SSH) — cukup pastikan OLT terpilih.
    const dev = currentDevice();
    if (!dev) { showAlert('warning', 'Pilih OLT terlebih dahulu.'); return; }
    const type = selectedType();
    const vars = collectVars();
    const errs = validateFormQuick(vars, type);
    if (errs.length) { showAlert('warning', errs.join('<br>'), true); return; }

    // Anti salah-klik: profil terpilih harus cocok dengan vendor SN (kalau profil ber-vendorMatch).
    if (type && Array.isArray(type.vendorMatch) && type.vendorMatch.length) {
        const c = classifySn(vars.sn);
        if (!type.vendorMatch.includes(c.tier)) {
            const ok = confirm(`Perhatian: SN ${vars.sn} terdeteksi "${c.vendor}" (${c.tier}), tapi profil "${type.name}" ditujukan untuk ${type.vendorMatch.join('/')}.\n\nLanjut tetap?`);
            if (!ok) return;
        }
    }

    setBusy('#previewBtn', true, 'Merender…');
    try {
        const json = await api('POST', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/preview`,
            { onuTypeId: type.id, vars });
        if (json.status !== 200) {
            showAlert('danger', escapeHtml(json.message) + (json.errors ? '<br>• ' + json.errors.map(escapeHtml).join('<br>• ') : ''), true);
            return;
        }
        $('#previewMeta').html(`<b>${escapeHtml(type.name)}</b> &rarr; ${escapeHtml(dev.name)} • <span class="mono">gpon-onu_${escapeHtml(vars.ponPort)}:${escapeHtml(vars.onuId)}</span> • SN ${escapeHtml(vars.sn)}`);
        $('#previewScript').text(json.data.script);
        $('#previewScriptWrap').removeClass('show');
        $('#forceExecuteCheck').prop('checked', false);
        $('#executeBtn').prop('disabled', false);
        // Preferensi write terakhir (default: aktif).
        try { $('#saveConfigCheck').prop('checked', localStorage.getItem('oltProvSaveConfig') !== '0'); } catch (_e) { /* abaikan */ }

        if (json.data.missing && json.data.missing.length) {
            showAlert('warning', 'Placeholder belum terisi: ' + json.data.missing.map(escapeHtml).join(', '), true);
            return;
        }
        // Hasil validasi terhadap kondisi nyata OLT (profil/VLAN/port harus ada).
        const issues = json.data.factIssues || [];
        const $fi = $('#previewFactIssues');
        if (issues.length) {
            $fi.removeClass('alert-success').addClass('alert-danger').show().html(
                '<b><i class="fas fa-shield-alt"></i> Tidak cocok dengan kondisi OLT:</b><br>• ' +
                issues.map(escapeHtml).join('<br>• '));
            $('#forceWrap').show();
        } else if (json.data.factsChecked) {
            $fi.removeClass('alert-danger').addClass('alert-success').show().html(
                '<i class="fas fa-shield-alt"></i> Semua nilai cocok dengan kondisi OLT (port, tipe ONU, profil, VLAN).');
            $('#forceWrap').hide();
        } else {
            $fi.hide().empty();
            $('#forceWrap').hide();
        }
        $('#previewModal').modal('show');
    } finally {
        setBusy('#previewBtn', false);
    }
}

async function doExecute() {
    const dev = requireDevice();
    if (!dev) return;
    const type = selectedType();
    const vars = collectVars();
    const saveConfig = $('#saveConfigCheck').is(':checked');
    const force = $('#forceWrap').is(':visible') && $('#forceExecuteCheck').is(':checked');
    try { localStorage.setItem('oltProvSaveConfig', saveConfig ? '1' : '0'); } catch (_e) { /* private mode */ }
    setBusy('#executeBtn', true, 'Eksekusi via SSH…');
    try {
        const json = await api('POST', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/register`,
            { onuTypeId: type.id, vars, saveConfig, force });
        if (json.status === 409) {
            // Guard pra-eksekusi server (fakta OLT / okupansi) — tampilkan tanpa menutup preview.
            $('#previewFactIssues').show().removeClass('alert-success').addClass('alert-danger').html(
                '<b><i class="fas fa-shield-alt"></i> Ditolak guard pra-eksekusi:</b><br>' +
                escapeHtml(json.message || '') +
                (json.errors ? '<br>• ' + json.errors.map(escapeHtml).join('<br>• ') : ''));
            if (json.errors && json.errors.length) $('#forceWrap').show();
            return;
        }
        $('#previewModal').modal('hide');
        const data = json.data || {};
        lastExec = { deviceId: dev.id, ponPort: vars.ponPort, onuId: vars.onuId, sn: vars.sn };
        renderExecResult(json.status === 200, json.message, data);
        $('#resultModal').modal('show');
        if (json.status === 200) {
            // ONU butuh beberapa detik untuk sinkron — verifikasi otomatis sesaat kemudian.
            $('#verifyPanel').html('<i class="fas fa-spinner fa-spin"></i> Menunggu ONU sinkron… verifikasi otomatis dalam 8 detik.');
            clearTimeout(verifyTimer);
            verifyTimer = setTimeout(() => verifyOnu(false), 8000);
        }
    } catch (e) {
        showAlert('danger', 'Eksekusi gagal: ' + escapeHtml(e.message), true);
    } finally {
        setBusy('#executeBtn', false);
    }
}

function renderExecResult(ok, message, data) {
    $('#resultTitle').html(ok
        ? '<i class="fas fa-check-circle text-success"></i> Registrasi Berhasil'
        : '<i class="fas fa-times-circle text-danger"></i> Registrasi Gagal');
    let persistHtml = '';
    if (data && data.persist) {
        persistHtml = data.persist.saved
            ? '<div class="small text-success"><i class="fas fa-save"></i> Konfigurasi tersimpan permanen (write OK).</div>'
            : `<div class="small text-danger"><i class="fas fa-exclamation-triangle"></i> Registrasi masuk tapi <b>write GAGAL</b>: ${escapeHtml(data.persist.error || '')} — jalankan write manual atau ulangi dari sini.</div>`;
    } else if (ok) {
        persistHtml = '<div class="small text-warning"><i class="fas fa-info-circle"></i> Belum disimpan permanen (write) — registrasi hilang bila OLT reboot.</div>';
    }
    $('#resultSummary').html(`<div class="alert alert-${ok ? 'success' : 'danger'} py-2 mb-2">${escapeHtml(message || '')}</div>` + persistHtml);
    const results = (data && data.results) || [];
    $('#resultLog').html(results.map((r, i) => `
        <div class="cli-line ${r.ok ? 'ok' : 'fail'}">
            <span class="cli-status">${r.ok ? '<i class="fas fa-check"></i>' : '<i class="fas fa-times"></i>'}</span>
            <code>${escapeHtml(r.command)}</code>
            ${r.error ? `<div class="cli-error">${escapeHtml(r.error)}</div>` : ''}
            ${(!r.ok && r.output) ? `<pre class="cli-output">${escapeHtml(r.output)}</pre>` : ''}
        </div>`).join('') || '<div class="text-muted small">Tidak ada perintah dieksekusi.</div>');
    $('#rollbackBtn').toggle(!ok && !!lastExec);
    $('#verifyPanel').html(ok ? 'Menunggu verifikasi…' : '<span class="text-muted">Registrasi gagal — perbaiki lalu ulangi. Bila ONU sempat dibuat, gunakan Rollback.</span>');
}

async function verifyOnu(manual) {
    if (!lastExec) { if (manual) showAlert('info', 'Belum ada registrasi pada sesi ini.'); return; }
    if (manual) setBusy('#checkStatusBtn', true, 'Cek…');
    $('#verifyPanel').html('<i class="fas fa-spinner fa-spin"></i> Mengambil status ONU dari OLT…');
    try {
        const q = `ponPort=${encodeURIComponent(lastExec.ponPort)}&onuId=${encodeURIComponent(lastExec.onuId)}`;
        const json = await api('GET', `/api/olt/provision/devices/${encodeURIComponent(lastExec.deviceId)}/onu-status?${q}`);
        if (json.status !== 200) { $('#verifyPanel').html('<span class="text-danger">' + escapeHtml(json.message) + '</span>'); return; }
        const d = json.data || {};
        const det = d.detail || {};
        const phase = (det.phaseState || '').toLowerCase();
        const phaseBadge = phase === 'working'
            ? '<span class="badge badge-success">working</span>'
            : `<span class="badge badge-warning">${escapeHtml(det.phaseState || 'belum terdeteksi')}</span>`;
        const power = d.power || {};
        const onuRx = power.down && power.down.onuRx != null ? power.down.onuRx.toFixed(2) + ' dBm' : '-';
        const att = power.down && power.down.attenuation != null ? power.down.attenuation.toFixed(2) + ' dB' : '-';
        $('#verifyPanel').html(`
            <div class="row">
                <div class="col-md-6">
                    <div><b>gpon-onu_${escapeHtml(lastExec.ponPort)}:${escapeHtml(lastExec.onuId)}</b> — SN ${escapeHtml(det.serial || lastExec.sn || '-')}</div>
                    <div>Phase state: ${phaseBadge} &nbsp; Admin: ${escapeHtml(det.state || '-')}</div>
                    <div>Nama: ${escapeHtml(det.name || '-')} &nbsp; Tipe: ${escapeHtml(det.type || '-')}</div>
                </div>
                <div class="col-md-6">
                    <div>Redaman (ONU Rx): <b>${escapeHtml(onuRx)}</b></div>
                    <div>Atenuasi down: ${escapeHtml(att)}</div>
                    <div>Online: ${escapeHtml(det.onlineDuration || '-')}</div>
                </div>
            </div>
            ${phase !== 'working' ? '<div class="text-muted mt-1">ONU belum "working" — tunggu ±30 detik lalu klik "Cek Status ONU" lagi.</div>' : ''}`);
    } catch (e) {
        $('#verifyPanel').html('<span class="text-danger">Gagal verifikasi: ' + escapeHtml(e.message) + '</span>');
    } finally {
        if (manual) setBusy('#checkStatusBtn', false);
    }
}

async function doRollback() {
    if (!lastExec) return;
    if (!confirm(`Hapus ONU gpon-onu_${lastExec.ponPort}:${lastExec.onuId} dari OLT? Tindakan ini menghapus konfigurasi ONU tersebut.`)) return;
    let saveConfig = true;
    try { saveConfig = localStorage.getItem('oltProvSaveConfig') !== '0'; } catch (_e) { /* abaikan */ }
    setBusy('#rollbackBtn', true, 'Menghapus…');
    try {
        const json = await api('POST', `/api/olt/provision/devices/${encodeURIComponent(lastExec.deviceId)}/delete-onu`,
            { ponPort: lastExec.ponPort, onuId: lastExec.onuId, saveConfig });
        if (json.status === 200) {
            showAlert('success', 'ONU dihapus dari OLT (rollback selesai).');
            $('#rollbackBtn').hide();
            $('#verifyPanel').html('<span class="text-muted">ONU sudah dihapus (rollback).</span>');
        } else {
            showAlert('danger', 'Rollback gagal: ' + escapeHtml(json.message), true);
        }
    } finally {
        setBusy('#rollbackBtn', false);
    }
}

// ── Browser ONU terdaftar per Port (cek status / lihat konfig / hapus) ────

let browseRows = [];     // baris ONU pada port terpilih
let browsePortCur = '';  // port yang sedang ditampilkan

async function loadPortOnus() {
    const dev = requireDevice();
    if (!dev) return;
    const ponPort = $('#browsePort').val().trim();
    if (!/^\d{1,2}\/\d{1,2}\/\d{1,2}$/.test(ponPort)) { showAlert('warning', 'Isi Port PON (mis. 1/2/1) untuk memuat ONU.'); return; }
    const names = $('#browseNames').is(':checked');
    setBusy('#browseLoadBtn', true, 'Memuat…');
    $('#browseTable tbody').html(`<tr><td colspan="6" class="text-center text-muted"><i class="fas fa-spinner fa-spin"></i> Membaca ONU di port ${escapeHtml(ponPort)}${names ? ' + nama tiap ONU (bisa beberapa detik utk port padat)' : ''}…</td></tr>`);
    $('#browseNote').text('');
    try {
        const json = await api('GET', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/port-onus?ponPort=${encodeURIComponent(ponPort)}${names ? '&names=1' : ''}`);
        if (json.status !== 200) { $('#browseTable tbody').html(`<tr><td colspan="6" class="text-center text-danger">${escapeHtml(json.message || 'Gagal memuat')}</td></tr>`); return; }
        browseRows = (json.data && json.data.onus) || [];
        browsePortCur = ponPort;
        $('#browseSearch').toggle(browseRows.length > 0).val('');
        renderBrowseTable();
    } catch (e) {
        $('#browseTable tbody').html(`<tr><td colspan="6" class="text-center text-danger">${escapeHtml(e.message)}</td></tr>`);
    } finally {
        setBusy('#browseLoadBtn', false);
    }
}

/** Cari pelanggan dari nama ONU (= username PPPoE) di data /api/users. */
function customerForName(name) {
    if (!name) return null;
    const lc = String(name).toLowerCase();
    return usersData.find((u) => (u.pppoe_username || '').toLowerCase() === lc) || null;
}

function vendorBadgeSmall(tier) {
    const m = { zte: ['success', 'ZTE'], clone: ['warning', 'Clone'], huawei: ['secondary', 'Huawei'], unknown: ['light', '?'] };
    const v = m[tier] || m.unknown;
    return `<span class="badge badge-${v[0]}">${v[1]}</span>`;
}

function renderBrowseTable() {
    const q = $('#browseSearch').val().trim().toLowerCase();
    const $tb = $('#browseTable tbody');
    if (!browseRows.length) { $tb.html('<tr><td colspan="6" class="text-center text-muted">Tak ada ONU terdaftar di port ini.</td></tr>'); $('#browseNote').text(''); return; }
    let rows = browseRows;
    if (q) rows = rows.filter((r) => {
        const cust = customerForName(r.name);
        return (r.sn || '').toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q) || (cust && (cust.name || '').toLowerCase().includes(q));
    });
    if (!rows.length) { $tb.html('<tr><td colspan="6" class="text-center text-muted">Tak ada yang cocok dengan pencarian.</td></tr>'); $('#browseNote').text(''); return; }
    $tb.html(rows.map((r) => {
        const cust = customerForName(r.name);
        const onu = String(r.onuId);
        return `<tr>
            <td class="mono">${escapeHtml(onu)}</td>
            <td class="mono">${escapeHtml(r.sn)}</td>
            <td>${vendorBadgeSmall(r.tier)} <small class="text-muted">${escapeHtml(r.type || '')}</small></td>
            <td class="mono">${escapeHtml(r.name || '—')}</td>
            <td>${cust ? escapeHtml(cust.name) : '<span class="text-muted">—</span>'}</td>
            <td>
                <button class="btn btn-outline-primary btn-sm btn-row-status" data-pon="${escapeHtml(browsePortCur)}" data-onu="${escapeHtml(onu)}" title="Status & redaman"><i class="fas fa-heartbeat"></i></button>
                <button class="btn btn-outline-secondary btn-sm btn-row-config" data-pon="${escapeHtml(browsePortCur)}" data-onu="${escapeHtml(onu)}" title="Lihat konfigurasi"><i class="fas fa-file-alt"></i></button>
                <button class="btn btn-outline-danger btn-sm btn-row-delete" data-pon="${escapeHtml(browsePortCur)}" data-onu="${escapeHtml(onu)}" data-sn="${escapeHtml(r.sn)}" title="Hapus ONU"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
    }).join(''));
    $('#browseNote').text(`${rows.length}${q ? ' dari ' + browseRows.length : ''} ONU di port ${browsePortCur}.`);
}

async function rowStatus(ponPort, onuId) {
    const dev = requireDevice();
    if (!dev) return;
    $('#browseNote').html('<i class="fas fa-spinner fa-spin"></i> Mengambil status ONU…');
    try {
        const q = `ponPort=${encodeURIComponent(ponPort)}&onuId=${encodeURIComponent(onuId)}`;
        const json = await api('GET', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/onu-status?${q}`);
        if (json.status !== 200) { $('#browseNote').html('<span class="text-danger">' + escapeHtml(json.message) + '</span>'); return; }
        const det = (json.data && json.data.detail) || {};
        const power = (json.data && json.data.power) || {};
        const onuRx = power.down && power.down.onuRx != null ? power.down.onuRx.toFixed(2) + ' dBm' : '-';
        const phase = (det.phaseState || '').toLowerCase() === 'working'
            ? '<span class="badge badge-success">working</span>'
            : `<span class="badge badge-warning">${escapeHtml(det.phaseState || 'tidak terdeteksi')}</span>`;
        $('#browseNote').html(
            `<b>gpon-onu_${escapeHtml(ponPort)}:${escapeHtml(String(onuId))}</b> ${phase} ` +
            `• ${escapeHtml(det.name || '-')} • SN ${escapeHtml(det.serial || '-')} ` +
            `• Rx <b>${escapeHtml(onuRx)}</b> • online ${escapeHtml(det.onlineDuration || '-')}`);
    } catch (e) {
        $('#browseNote').html('<span class="text-danger">Gagal: ' + escapeHtml(e.message) + '</span>');
    }
}

async function rowConfig(ponPort, onuId) {
    const dev = requireDevice();
    if (!dev) return;
    try {
        const q = `ponPort=${encodeURIComponent(ponPort)}&onuId=${encodeURIComponent(onuId)}`;
        const json = await api('GET', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/onu-config?${q}`);
        if (json.status !== 200) { showAlert('danger', escapeHtml(json.message), true); return; }
        $('#onuConfigTarget').text(`gpon-onu_${ponPort}:${onuId} (${dev.name})`);
        $('#onuConfigInterface').text(json.data.interfaceConfig || '(kosong)');
        $('#onuConfigMng').text(json.data.onuMngConfig || '(kosong)');
        $('#onuConfigModal').modal('show');
    } catch (e) {
        showAlert('danger', escapeHtml(e.message), true);
    }
}

async function rowDelete(ponPort, onuId, sn) {
    const dev = requireDevice();
    if (!dev) return;
    if (!confirm(`HAPUS ONU gpon-onu_${ponPort}:${onuId} (SN ${sn}) dari ${dev.name}?\n\nKonfigurasi ONU dihapus permanen dari OLT (pelanggan putus). Lanjutkan?`)) return;
    let saveConfig = true;
    try { saveConfig = localStorage.getItem('oltProvSaveConfig') !== '0'; } catch (_e) { /* abaikan */ }
    $('#browseNote').html('<i class="fas fa-spinner fa-spin"></i> Menghapus ONU…');
    try {
        const json = await api('POST', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/delete-onu`, { ponPort, onuId, saveConfig });
        if (json.status === 200) {
            showAlert('success', `ONU gpon-onu_${ponPort}:${onuId} dihapus dari OLT.`);
            loadPortOnus(); // muat ulang daftar port supaya baris hilang
        } else {
            $('#browseNote').html('<span class="text-danger">Gagal hapus: ' + escapeHtml(json.message) + '</span>');
        }
    } catch (e) {
        $('#browseNote').html('<span class="text-danger">Gagal: ' + escapeHtml(e.message) + '</span>');
    }
}

function resetRegisterForm() {
    ['#regSn', '#regPonPort', '#regOnuId', '#regCustomer', '#regPppoeUser', '#regPppoePassword']
        .forEach((s) => $(s).val(''));
    $('#occupancyInfo').hide().empty();
    $('#snVendorInfo').empty();
    onTypeChange(); // kembalikan parameter lanjutan ke default profil
}

// ════════ Tab 2: profil tipe modem ════════

function renderTypesTable() {
    const $tb = $('#typesTable tbody');
    if (!onuTypes.length) { $tb.html('<tr><td colspan="4" class="text-center text-muted">Belum ada profil</td></tr>'); return; }
    $tb.html(onuTypes.map((t) => {
        const varsPreview = Object.entries(t.vars || {}).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(', ');
        const more = Object.keys(t.vars || {}).length > 4 ? ', …' : '';
        return `<tr>
            <td><b>${escapeHtml(t.name)}</b>${t.builtin ? ' <span class="badge badge-secondary">bawaan</span>' : ''}<br><small class="text-muted mono">${escapeHtml(t.id)}</small></td>
            <td class="small">${escapeHtml(t.notes || '-')}</td>
            <td class="small mono">${escapeHtml(varsPreview + more) || '-'}</td>
            <td>
                <button class="btn btn-info btn-sm btn-edit-type" data-id="${escapeHtml(t.id)}" title="Edit"><i class="fas fa-edit"></i></button>
                <button class="btn btn-secondary btn-sm btn-dup-type" data-id="${escapeHtml(t.id)}" title="Duplikat"><i class="fas fa-copy"></i></button>
                <button class="btn btn-danger btn-sm btn-del-type" data-id="${escapeHtml(t.id)}" title="Hapus"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
    }).join(''));
}

function renderPlaceholderHelp() {
    $('#placeholderTable tbody').html(placeholderDocs.map((p) =>
        `<tr><td class="mono">{{${escapeHtml(p.key)}}}</td><td>${escapeHtml(p.desc)}</td></tr>`).join(''));
}

function addVarRow(key, value) {
    $('#typeVarsRows').append(`
        <div class="form-row var-row mb-1">
            <div class="col-5"><input type="text" class="form-control form-control-sm var-key" placeholder="nama" value="${escapeHtml(key)}"></div>
            <div class="col-6"><input type="text" class="form-control form-control-sm var-val" placeholder="nilai default" value="${escapeHtml(value)}"></div>
            <div class="col-1 px-0"><button class="btn btn-outline-danger btn-sm btn-del-var" type="button" tabindex="-1"><i class="fas fa-times"></i></button></div>
        </div>`);
}

function openTypeModal(typeId, duplicate) {
    const t = typeId ? onuTypes.find((x) => x.id === typeId) : null;
    $('#typeModalTitle').text(t ? (duplicate ? 'Duplikat Profil' : 'Edit Profil — ' + t.name) : 'Tambah Profil Tipe Modem');
    $('#typeId').val(t && !duplicate ? t.id : '');
    $('#typeName').val(t ? (duplicate ? t.name + ' (copy)' : t.name) : '');
    $('#typeNotes').val(t ? t.notes || '' : '');
    $('#typeTemplate').val(t ? t.scriptTemplate : defaultTemplateSkeleton());
    $('#typeVarsRows').empty();
    const vars = t ? t.vars || {} : { onuType: 'ALL', tcontProfile: '', downProfile: '', pppoeVlan: '' };
    Object.entries(vars).forEach(([k, v]) => addVarRow(k, v));
    $('#typeModal').modal('show');
}

function defaultTemplateSkeleton() {
    return ['conf t', 'int gpon-olt_{{ponPort}}', 'onu {{onuId}} type {{onuType}} sn {{sn}}', '!',
        'int gpon-onu_{{ponPort}}:{{onuId}}', 'name {{name}}', 'description {{description}}',
        'tcont 1 profile {{tcontProfile}}', 'gemport 1 name Internet tcont 1', '!',
        'pon-onu-mng gpon-onu_{{ponPort}}:{{onuId}}', '… lengkapi sesuai layanan …', 'end'].join('\n');
}

async function saveType() {
    const body = {
        id: $('#typeId').val() || undefined,
        name: $('#typeName').val().trim(),
        notes: $('#typeNotes').val().trim(),
        scriptTemplate: $('#typeTemplate').val(),
        vars: {},
    };
    $('#typeVarsRows .var-row').each(function () {
        const k = $(this).find('.var-key').val().trim();
        const v = $(this).find('.var-val').val();
        if (k) body.vars[k] = v;
    });
    if (!body.name || !body.scriptTemplate.trim()) { showAlert('warning', 'Nama profil dan template wajib diisi.'); return; }
    setBusy('#saveTypeBtn', true, 'Menyimpan…');
    try {
        const json = await api('POST', '/api/olt/provision/onu-types', body);
        if (json.status === 200) {
            $('#typeModal').modal('hide');
            showAlert('success', 'Profil tersimpan.');
            await loadOnuTypes();
        } else {
            showAlert('danger', escapeHtml(json.message || 'Gagal menyimpan profil'), true);
        }
    } finally {
        setBusy('#saveTypeBtn', false);
    }
}

async function deleteType(typeId) {
    if (!confirm('Hapus profil tipe modem ini?')) return;
    const json = await api('DELETE', `/api/olt/provision/onu-types/${encodeURIComponent(typeId)}`);
    if (json.status === 200) { showAlert('success', 'Profil dihapus.'); await loadOnuTypes(); }
    else showAlert('danger', escapeHtml(json.message || 'Gagal menghapus'), true);
}

async function restoreBuiltin() {
    const json = await api('POST', '/api/olt/provision/onu-types/restore-builtin');
    showAlert(json.status === 200 ? 'success' : 'danger', escapeHtml(json.message || ''));
    if (json.status === 200) await loadOnuTypes();
}

// ════════ Tab 3: backup ════════

async function loadBackupCfg() {
    try {
        const json = await api('GET', '/api/olt/provision/backup/config');
        if (json.status !== 200) return;
        const d = json.data;
        $('#bkEnabled').val(String(d.enabled));
        $('#bkKeep').val(d.keep);
        $('#bkTelegram').val(String(d.sendTelegram));
        $('#bkMethod').val(d.method || 'ftp');
        $('#bkFtpSelfHost').val(d.ftpSelfHost || '');
        $('#bkFtpPort').val(d.ftpPort || 21);
        $('#bkFtpFields').toggle(($('#bkMethod').val()) === 'ftp');
        $('#bkMethod').off('change.ftpfields').on('change.ftpfields', function () {
            $('#bkFtpFields').toggle(this.value === 'ftp');
        });
        const presets = ['30 2 * * *', '0 3 * * 0', '0 3 1 * *'];
        if (presets.includes(d.schedule)) {
            $('#bkSchedulePreset').val(d.schedule);
            $('#bkSchedule').hide().val(d.schedule);
        } else {
            $('#bkSchedulePreset').val('custom');
            $('#bkSchedule').show().val(d.schedule);
        }
    } catch (_e) { /* setting backup opsional di load awal */ }
}

async function saveBackupCfg() {
    const schedule = $('#bkSchedulePreset').val() === 'custom' ? $('#bkSchedule').val().trim() : $('#bkSchedulePreset').val();
    setBusy('#saveBackupCfgBtn', true, 'Menyimpan…');
    try {
        const json = await api('POST', '/api/olt/provision/backup/config', {
            enabled: $('#bkEnabled').val() === 'true',
            schedule,
            keep: parseInt($('#bkKeep').val(), 10) || 30,
            sendTelegram: $('#bkTelegram').val() === 'true',
            method: $('#bkMethod').val(),
            ftpSelfHost: $('#bkFtpSelfHost').val().trim(),
            ftpPort: parseInt($('#bkFtpPort').val(), 10) || 21,
        });
        if (json.status === 200) showAlert('success', 'Setting backup tersimpan. Jadwal: ' + escapeHtml(json.data.schedule));
        else showAlert('danger', escapeHtml(json.message || 'Gagal menyimpan'), true);
    } finally {
        setBusy('#saveBackupCfgBtn', false);
    }
}

async function runBackupAll() {
    if (!confirm('Backup semua OLT sekarang? Proses bisa memakan waktu beberapa menit (capture running-config via SSH).')) return;
    setBusy('#backupAllBtn', true, 'Backup berjalan…');
    try {
        const json = await api('POST', '/api/olt/provision/backup/run-all');
        if (json.status === 200) {
            const d = json.data || {};
            const detail = (d.results || []).map((r) =>
                `• ${escapeHtml(r.deviceName || r.deviceId)}: ${r.ok ? '✅ ' + escapeHtml(r.file) : '❌ ' + escapeHtml(r.error || 'gagal')}`).join('<br>');
            showAlert(d.failCount > 0 ? 'warning' : 'success', escapeHtml(json.message) + '<br>' + detail, true);
            loadBackups();
        } else {
            showAlert('danger', escapeHtml(json.message || 'Backup gagal'), true);
        }
    } catch (e) {
        showAlert('danger', 'Backup gagal: ' + escapeHtml(e.message), true);
    } finally {
        setBusy('#backupAllBtn', false);
    }
}

async function loadBackups() {
    const $tb = $('#backupsTable tbody');
    try {
        const json = await api('GET', '/api/olt/provision/backups');
        if (json.status !== 200) { $tb.html(`<tr><td colspan="5" class="text-center text-danger">${escapeHtml(json.message)}</td></tr>`); return; }
        const rows = json.data || [];
        if (!rows.length) { $tb.html('<tr><td colspan="5" class="text-center text-muted">Belum ada backup</td></tr>'); return; }
        const nameOf = (id) => {
            const d = provDevices.find((x) => x.id === id);
            return d ? d.name : id;
        };
        $tb.html(rows.map((r) => `
            <tr>
                <td>${escapeHtml(nameOf(r.deviceId))}</td>
                <td class="mono small">${escapeHtml(r.file)}</td>
                <td>${(r.sizeBytes / 1024).toFixed(1)} KB</td>
                <td class="small">${new Date(r.mtime).toLocaleString('id-ID')}</td>
                <td><a class="btn btn-outline-primary btn-sm" href="/api/olt/provision/backups/download?deviceId=${encodeURIComponent(r.deviceId)}&file=${encodeURIComponent(r.file)}">
                    <i class="fas fa-download"></i></a></td>
            </tr>`).join(''));
    } catch (e) {
        $tb.html(`<tr><td colspan="5" class="text-center text-danger">${escapeHtml(e.message)}</td></tr>`);
    }
}

// ════════ Tab 4: ACS / TR069 ════════

let acsRows = [];

async function loadAcsSettings() {
    const dev = currentDevice();
    $('#acsSettingsInfo').empty();
    if (!dev) { ['#acsUrl', '#acsUser', '#acsPass', '#acsMgmtVlan'].forEach((s) => $(s).val('')); return; }
    try {
        const json = await api('GET', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/acs-settings`);
        if (json.status === 403) {
            $('#acsSettingsInfo').html('<span class="text-muted"><i class="fas fa-lock"></i> Hanya admin yang bisa mengubah setting ACS.</span>');
            $('#saveAcsBtn').prop('disabled', true);
            return;
        }
        if (json.status !== 200) { $('#acsSettingsInfo').html('<span class="text-danger">' + escapeHtml(json.message || 'Gagal memuat setting') + '</span>'); return; }
        const d = json.data || {};
        $('#acsUrl').val(d.url || '');
        $('#acsUser').val(d.user || '');
        $('#acsPass').val('');
        $('#acsMgmtVlan').val(d.mgmtVlan || 100);
        $('#saveAcsBtn').prop('disabled', false);
        $('#acsSettingsInfo').html(d.passwordSet
            ? '<span class="text-success"><i class="fas fa-check"></i> Password ACS tersimpan (kosongkan untuk pertahankan).</span>'
            : '<span class="text-warning"><i class="fas fa-exclamation-triangle"></i> Password ACS belum diisi.</span>');
    } catch (e) {
        $('#acsSettingsInfo').html('<span class="text-danger">Gagal: ' + escapeHtml(e.message) + '</span>');
    }
}

async function saveAcsSettings() {
    const dev = currentDevice();
    if (!dev) { showAlert('warning', 'Pilih OLT dulu.'); return; }
    const body = {
        url: $('#acsUrl').val().trim(),
        user: $('#acsUser').val().trim(),
        pass: $('#acsPass').val(),
        mgmtVlan: parseInt($('#acsMgmtVlan').val(), 10) || 100,
    };
    if (!body.url || !body.user) { showAlert('warning', 'URL dan username ACS wajib diisi.'); return; }
    setBusy('#saveAcsBtn', true, 'Menyimpan…');
    try {
        const json = await api('POST', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/acs-settings`, body);
        if (json.status === 200) { showAlert('success', 'Setting ACS tersimpan.'); loadAcsSettings(); }
        else showAlert('danger', escapeHtml(json.message || 'Gagal menyimpan') + (json.errors ? '<br>• ' + json.errors.map(escapeHtml).join('<br>• ') : ''), true);
    } finally {
        setBusy('#saveAcsBtn', false);
    }
}

async function loadTr069Status(force) {
    const dev = requireDevice();
    if (!dev) return;
    setBusy('#acsLoadBtn', true, 'Membaca…');
    $('#acsTable tbody').html('<tr><td colspan="7" class="text-center text-muted"><i class="fas fa-spinner fa-spin"></i> Membaca inventaris OLT (belasan detik) &amp; status GenieACS…</td></tr>');
    try {
        const json = await api('GET', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/tr069/status${force ? '?force=true' : ''}`);
        if (json.status !== 200) {
            $('#acsTable tbody').html('<tr><td colspan="7" class="text-center text-danger">' + escapeHtml(json.message || 'Gagal') + '</td></tr>');
            return;
        }
        const d = json.data || {};
        acsRows = d.onus || [];
        const s = d.summary || {};
        $('#acsSumTotal').text(s.total != null ? s.total : '–');
        $('#acsSumInformed').text(s.informed != null ? s.informed : '–');
        $('#acsSumPush').text(s.oltPush != null ? s.oltPush : '–');
        $('#acsSumModem').text(s.modem != null ? s.modem : '–');
        if (!s.acsConfigured) showAlert('warning', 'Setting ACS OLT ini belum diisi — tombol "Aktifkan" akan ditolak sampai URL ACS diisi.', true);
        renderAcsTable();
    } catch (e) {
        $('#acsTable tbody').html('<tr><td colspan="7" class="text-center text-danger">' + escapeHtml(e.message) + '</td></tr>');
    } finally {
        setBusy('#acsLoadBtn', false);
    }
}

function acsStatusBadge(row) {
    if (row.informed) return '<span class="badge badge-success">ACS aktif</span>';
    if (row.action === 'olt-push') return '<span class="badge badge-info">siap OLT-push</span>';
    return '<span class="badge badge-secondary">set di modem</span>';
}

// Status fisik ONU di OLT (dari SNMP). null = SNMP tak tersedia / ONU tak terbaca.
function oltStatusBadge(row) {
    switch (row.oltStatus) {
        case 'Online': return '<span class="badge badge-success">Online</span>';
        case 'Offline': return '<span class="badge badge-secondary">Offline</span>';
        case 'LOS': return '<span class="badge badge-danger">LOS</span>';
        case 'Dying Gasp': return '<span class="badge badge-warning">Dying Gasp</span>';
        default: return '<span class="badge badge-light" title="Status OLT tidak tersedia">?</span>';
    }
}

function renderAcsTable() {
    const filter = $('#acsFilter').val();
    const q = $('#acsSearch').val().trim().toUpperCase();
    const $tb = $('#acsTable tbody');
    if (!acsRows.length) { $tb.html('<tr><td colspan="7" class="text-center text-muted">Belum dimuat.</td></tr>'); $('#acsTableNote').text(''); return; }
    let rows = acsRows;
    if (filter !== 'all') rows = rows.filter((r) => r.action === filter);
    if (q) rows = rows.filter((r) => (r.sn || '').toUpperCase().includes(q) || (r.id || '').includes(q) || (r.pppoe || '').toUpperCase().includes(q) || (r.customerName || '').toUpperCase().includes(q));
    if (!rows.length) { $tb.html('<tr><td colspan="7" class="text-center text-muted">Tidak ada ONU pada filter ini.</td></tr>'); $('#acsTableNote').text(''); return; }
    const CAP = 400;
    const shown = rows.slice(0, CAP);
    $tb.html(shown.map((r) => {
        let aksi;
        if (r.informed) {
            aksi = `<button class="btn btn-outline-danger btn-sm btn-acs-remove" data-pon="${escapeHtml(r.ponPort)}" data-onu="${escapeHtml(r.onuId)}" title="Lepas TR069"><i class="fas fa-unlink"></i></button>`;
        } else if (r.oltPushable) {
            aksi = `<button class="btn btn-success btn-sm btn-acs-apply" data-pon="${escapeHtml(r.ponPort)}" data-onu="${escapeHtml(r.onuId)}" data-sn="${escapeHtml(r.sn)}"><i class="fas fa-bolt"></i> Aktifkan</button>`;
        } else {
            aksi = '<span class="small text-muted">set di modem</span>';
        }
        const ident = r.pppoe
            ? '<span class="mono">' + escapeHtml(r.pppoe) + '</span>' + (r.customerName ? '<br><small class="text-muted">' + escapeHtml(r.customerName) + '</small>' : '')
            : '<span class="text-muted">-</span>';
        return `<tr>
            <td class="mono">${escapeHtml(r.id)}</td>
            <td class="mono">${escapeHtml(r.sn)}</td>
            <td>${ident}</td>
            <td class="small">${escapeHtml(r.vendor)}</td>
            <td>${oltStatusBadge(r)}</td>
            <td>${acsStatusBadge(r)}${r.lastInform ? '<br><small class="text-muted">' + escapeHtml(new Date(r.lastInform).toLocaleString('id-ID')) + '</small>' : ''}</td>
            <td>${aksi}</td>
        </tr>`;
    }).join(''));
    $('#acsTableNote').text(rows.length > CAP
        ? `Menampilkan ${CAP} dari ${rows.length} — perketat filter/pencarian untuk melihat sisanya.`
        : `${rows.length} ONU.`);
}

async function applyTr069(ponPort, onuId, sn) {
    const dev = requireDevice();
    if (!dev) return;
    const json = await api('POST', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/tr069/apply`,
        { ponPort, onuId, sn, saveConfig: true });
    if (json.status === 200) {
        showAlert('success', `ACS diaktifkan ke gpon-onu_${escapeHtml(String(ponPort))}:${escapeHtml(String(onuId))}. Tunggu 1-5 menit, lalu Muat Status.`);
    } else {
        showAlert(json.status === 409 ? 'warning' : 'danger', escapeHtml(json.message || 'Gagal'), true);
    }
}

async function removeTr069(ponPort, onuId) {
    const dev = requireDevice();
    if (!dev) return;
    if (!confirm(`Lepas TR069 dari gpon-onu_${ponPort}:${onuId}? (ACS berhenti mengelola ONU ini)`)) return;
    const json = await api('POST', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/tr069/remove`,
        { ponPort, onuId, saveConfig: true });
    showAlert(json.status === 200 ? 'success' : 'danger', escapeHtml(json.message || ''), json.status !== 200);
}

// Rollout massal di-PECAH per batch ~50 ONU (verif live: ~2,9 dtk/ONU → 476 ≈ 23 mnt
// dalam 1 sesi = terlalu lama/berisiko). Tiap batch = 1 request/sesi SSH + write tersendiri
// (persist inkremental; bila putus di tengah, batch yang sudah jadi tetap aman). Sisa yang
// tak inform setelah rollout = kemungkinan ONU ex-ISP/terkunci → tangani di modem.
const ACS_BULK_BATCH = 50;

async function bulkApplyTr069() {
    const dev = requireDevice();
    if (!dev) return;
    const pending = acsRows.filter((r) => r.action === 'olt-push')
        .map((r) => ({ ponPort: r.ponPort, onuId: r.onuId, sn: r.sn }));
    if (!pending.length) { showAlert('info', 'Muat status dulu, atau tidak ada ONU ZTE yang perlu di-push.'); return; }
    const batches = Math.ceil(pending.length / ACS_BULK_BATCH);
    if (!confirm(`Aktifkan ACS untuk ${pending.length} ONU ZTE belum-inform?\n\nDikerjakan ${batches} batch × ≤${ACS_BULK_BATCH} ONU (tiap batch 1 sesi SSH + write). Bisa belasan menit — JANGAN tutup halaman. Lanjutkan?`)) return;
    setBusy('#acsBulkBtn', true, 'Batch…');
    let ok = 0, fail = 0;
    try {
        for (let i = 0; i < pending.length; i += ACS_BULK_BATCH) {
            const chunk = pending.slice(i, i + ACS_BULK_BATCH);
            const n = Math.floor(i / ACS_BULK_BATCH) + 1;
            $('#acsBulkBtn').html(`<i class="fas fa-spinner fa-spin"></i> Batch ${n}/${batches}…`);
            showAlert('info', `Batch ${n}/${batches}: push ${chunk.length} ONU via SSH… (sejauh ini ok ${ok} / gagal ${fail})`, true);
            try {
                const json = await api('POST', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/tr069/apply-bulk`,
                    { targets: chunk, saveConfig: true });
                if (json.status === 200 && json.data) { ok += json.data.okCount || 0; fail += json.data.failCount || 0; }
                else { fail += chunk.length; showAlert('danger', `Batch ${n} gagal: ${escapeHtml(json.message || '')}`, true); }
            } catch (e) {
                fail += chunk.length;
                showAlert('danger', `Batch ${n} error: ${escapeHtml(e.message)} — lanjut batch berikutnya.`, true);
            }
        }
        showAlert(fail > 0 ? 'warning' : 'success',
            `Rollout selesai: ${ok} OK, ${fail} gagal dari ${pending.length} ONU. Tunggu 2-5 menit lalu klik "Muat Status" — yang masih "belum inform" padahal ZTE = kemungkinan ex-ISP/terkunci, tangani di modem.`, true);
    } finally {
        setBusy('#acsBulkBtn', false);
    }
}
