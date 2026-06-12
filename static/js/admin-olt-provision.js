/**
 * Header Doc
 * Purpose: Logika halaman Provisioning OLT ZTE — scan ONU uncfg, form registrasi dinamis per
 *          tipe modem (placeholder template → input), preview script, eksekusi + log per
 *          perintah + verifikasi status/optik, rollback, CRUD profil tipe modem, dan
 *          konfigurasi/eksekusi backup OLT.
 * Caller: views/sb-admin/admin-olt-provision.php.
 * Deps: jQuery, Bootstrap 4 (modal/tab/collapse), API /api/olt/provision/*, /api/users.
 * MainFuncs: scanUncfg, checkOccupancy, buildAdvancedVars, doPreview, doExecute, verifyOnu,
 *            loadOnuTypes, saveType, loadBackupCfg, runBackupAll.
 * SideEffects: Memicu eksekusi konfigurasi OLT & penulisan backup via backend.
 */

/* eslint-disable no-unused-vars */

// Field inti yang punya input tetap di form (BUKAN bagian panel "parameter lanjutan").
const CORE_FIELDS = ['ponPort', 'onuId', 'sn', 'name', 'description', 'pppoeUser', 'pppoePassword'];

let provDevices = [];      // daftar OLT dari API
let onuTypes = [];         // profil tipe modem
let placeholderDocs = [];  // cheatsheet placeholder dari API
let usersData = [];        // pelanggan untuk autofill
let lastExec = null;       // { deviceId, ponPort, onuId } konteks hasil eksekusi terakhir
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
    $('#testSshBtn').on('click', testSsh);
    $('#provOltSelect').on('change', function () { loadOltFacts(false); });
    $('#toolStatusBtn').on('click', toolCheckStatus);
    $('#toolConfigBtn').on('click', toolShowConfig);
    $('#toolDeleteBtn').on('click', toolDeleteOnu);
    $('#checkOccupancyBtn').on('click', function (e) { e.preventDefault(); checkOccupancy(); });
    $('#regPonPort').on('change', function () { if (this.value) checkOccupancy(true); });
    $('#regOnuType').on('change', onTypeChange);
    $('#regCustomer').on('change input', onCustomerPicked);
    $('#copyNameToPppoeBtn').on('click', function () {
        $('#regPppoeUser').val($('#regName').val());
        if (!$('#regPppoePassword').val()) $('#regPppoePassword').val($('#regName').val());
    });
    $('#resetFormBtn').on('click', resetRegisterForm);
    $('#previewBtn').on('click', doPreview);
    $('#confirmExecuteCheck').on('change', function () { $('#executeBtn').prop('disabled', !this.checked); });
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
        checkOccupancy(true);
        $('#regName').focus();
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
        if (!silent) showAlert('warning', 'Isi Port PON dengan format slot/kartu/port, contoh 1/3/16.');
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
        if (!$('#regPppoePassword').val()) $('#regPppoePassword').val(pppoe);
        // Konvensi lapangan: nama ONU = username PPPoE (tanpa spasi, unik per pelanggan).
        if (!$('#regName').val()) $('#regName').val(pppoe.replace(/\s+/g, '-'));
    } else if (!$('#regName').val()) {
        $('#regName').val(String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
    }
}

// ════════ Preview & eksekusi ════════

function collectVars() {
    const vars = {
        ponPort: $('#regPonPort').val().trim(),
        onuId: $('#regOnuId').val().trim(),
        sn: $('#regSn').val().trim().toUpperCase(),
        name: $('#regName').val().trim(),
        description: $('#regDescription').val().trim(),
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
    if (!vars.ponPort) errs.push('Port PON wajib diisi (contoh 1/3/16).');
    if (!vars.onuId) errs.push('ONU ID wajib diisi (klik "cek slot" untuk saran).');
    // Hanya wajibkan field yang memang dipakai template profil terpilih.
    const used = type ? templatePlaceholders(type.scriptTemplate) : [];
    ['name', 'description', 'pppoeUser', 'pppoePassword'].forEach((k) => {
        if (used.includes(k) && !vars[k]) errs.push(`Field "${k}" dipakai template ini — wajib diisi.`);
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

    setBusy('#previewBtn', true, 'Merender…');
    try {
        const json = await api('POST', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/preview`,
            { onuTypeId: type.id, vars });
        if (json.status !== 200) {
            showAlert('danger', escapeHtml(json.message) + (json.errors ? '<br>• ' + json.errors.map(escapeHtml).join('<br>• ') : ''), true);
            return;
        }
        $('#previewMeta').text(`${type.name} → ${dev.name} • gpon-onu_${vars.ponPort}:${vars.onuId} • SN ${vars.sn}`);
        $('#previewScript').text(json.data.script);
        $('#confirmExecuteCheck').prop('checked', false);
        $('#executeBtn').prop('disabled', true);
        // Preferensi write terakhir (default: aktif).
        try { $('#saveConfigCheck').prop('checked', localStorage.getItem('oltProvSaveConfig') !== '0'); } catch (_e) { /* abaikan */ }
        if (!json.data.ready) {
            showAlert('warning', 'Placeholder belum terisi: ' + json.data.missing.map(escapeHtml).join(', '), true);
            return;
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
    try { localStorage.setItem('oltProvSaveConfig', saveConfig ? '1' : '0'); } catch (_e) { /* private mode */ }
    setBusy('#executeBtn', true, 'Eksekusi via SSH…');
    try {
        const json = await api('POST', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/register`,
            { onuTypeId: type.id, vars, saveConfig });
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
        $('#confirmExecuteCheck').prop('checked', false);
        $('#executeBtn').prop('disabled', true);
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

// ── Tools: ONU terdaftar (cek status / lihat konfig / hapus) ─────────────

function toolTarget() {
    const ponPort = $('#toolPonPort').val().trim();
    const onuId = $('#toolOnuId').val().trim();
    if (!/^\d{1,2}\/\d{1,2}\/\d{1,2}$/.test(ponPort) || !onuId) {
        $('#toolsResult').html('<span class="text-warning">Isi Port PON (mis. 1/2/1) dan ONU ID dulu.</span>');
        return null;
    }
    return { ponPort, onuId };
}

async function toolCheckStatus() {
    const dev = requireDevice();
    const t = dev && toolTarget();
    if (!t) return;
    setBusy('#toolStatusBtn', true, '');
    $('#toolsResult').html('<i class="fas fa-spinner fa-spin"></i> Mengambil status…');
    try {
        const q = `ponPort=${encodeURIComponent(t.ponPort)}&onuId=${encodeURIComponent(t.onuId)}`;
        const json = await api('GET', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/onu-status?${q}`);
        if (json.status !== 200) { $('#toolsResult').html('<span class="text-danger">' + escapeHtml(json.message) + '</span>'); return; }
        const det = (json.data && json.data.detail) || {};
        const power = (json.data && json.data.power) || {};
        const onuRx = power.down && power.down.onuRx != null ? power.down.onuRx.toFixed(2) + ' dBm' : '-';
        const phase = (det.phaseState || '').toLowerCase() === 'working'
            ? '<span class="badge badge-success">working</span>'
            : `<span class="badge badge-warning">${escapeHtml(det.phaseState || 'tidak terdeteksi')}</span>`;
        $('#toolsResult').html(
            `<b>gpon-onu_${escapeHtml(t.ponPort)}:${escapeHtml(t.onuId)}</b> ${phase} ` +
            `• ${escapeHtml(det.name || '-')} • ${escapeHtml(det.type || '-')} • SN ${escapeHtml(det.serial || '-')} ` +
            `• Rx <b>${escapeHtml(onuRx)}</b> • online ${escapeHtml(det.onlineDuration || '-')}`);
    } catch (e) {
        $('#toolsResult').html('<span class="text-danger">Gagal: ' + escapeHtml(e.message) + '</span>');
    } finally {
        setBusy('#toolStatusBtn', false);
    }
}

async function toolShowConfig() {
    const dev = requireDevice();
    const t = dev && toolTarget();
    if (!t) return;
    setBusy('#toolConfigBtn', true, '');
    try {
        const q = `ponPort=${encodeURIComponent(t.ponPort)}&onuId=${encodeURIComponent(t.onuId)}`;
        const json = await api('GET', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/onu-config?${q}`);
        if (json.status !== 200) { $('#toolsResult').html('<span class="text-danger">' + escapeHtml(json.message) + '</span>'); return; }
        $('#onuConfigTarget').text(`gpon-onu_${t.ponPort}:${t.onuId} (${dev.name})`);
        $('#onuConfigInterface').text(json.data.interfaceConfig || '(kosong)');
        $('#onuConfigMng').text(json.data.onuMngConfig || '(kosong)');
        $('#onuConfigModal').modal('show');
    } catch (e) {
        $('#toolsResult').html('<span class="text-danger">Gagal: ' + escapeHtml(e.message) + '</span>');
    } finally {
        setBusy('#toolConfigBtn', false);
    }
}

async function toolDeleteOnu() {
    const dev = requireDevice();
    const t = dev && toolTarget();
    if (!t) return;
    if (!confirm(`HAPUS ONU gpon-onu_${t.ponPort}:${t.onuId} dari ${dev.name}?\n\nKonfigurasi ONU tersebut dihapus permanen dari OLT (pelanggan putus). Lanjutkan?`)) return;
    let saveConfig = true;
    try { saveConfig = localStorage.getItem('oltProvSaveConfig') !== '0'; } catch (_e) { /* abaikan */ }
    setBusy('#toolDeleteBtn', true, '');
    $('#toolsResult').html('<i class="fas fa-spinner fa-spin"></i> Menghapus ONU…');
    try {
        const json = await api('POST', `/api/olt/provision/devices/${encodeURIComponent(dev.id)}/delete-onu`,
            { ponPort: t.ponPort, onuId: t.onuId, saveConfig });
        if (json.status === 200) {
            const persisted = json.data && json.data.persist && json.data.persist.saved;
            $('#toolsResult').html('<span class="text-success"><i class="fas fa-check"></i> ONU dihapus.' +
                (persisted ? ' Tersimpan permanen (write OK).' : ' <b>Belum write</b> — simpan permanen bila perlu.') + '</span>');
        } else {
            $('#toolsResult').html('<span class="text-danger">Gagal hapus: ' + escapeHtml(json.message) + '</span>');
        }
    } catch (e) {
        $('#toolsResult').html('<span class="text-danger">Gagal: ' + escapeHtml(e.message) + '</span>');
    } finally {
        setBusy('#toolDeleteBtn', false);
    }
}

function resetRegisterForm() {
    ['#regSn', '#regPonPort', '#regOnuId', '#regCustomer', '#regName', '#regDescription', '#regPppoeUser', '#regPppoePassword']
        .forEach((s) => $(s).val(''));
    $('#occupancyInfo').hide().empty();
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
