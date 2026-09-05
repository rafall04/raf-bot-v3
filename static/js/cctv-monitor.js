/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/cctv-monitor.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/cctv-monitor.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

  let devicesCache = []; let statusCache = null; let refreshTimer = null; let discoveryCache = []; let uptimeCache = {}; let areasCache = []; let selectAreaAfterSave = false; let reopenCctvAfterArea = false; let netwatchHealthCache = {};

  $(document).ready(() => {
    loadAll();
    loadDiscovery();
    loadSettings();
    loadCustomers();
    refreshTimer = setInterval(loadStatusOnly, 30000);
    $('#addCctvBtn').on('click', openAdd);
    $('#cctvSaveBtn').on('click', save);
    $('#cctv_area').on('change', onAreaChange);
    $('#rescanBtn').on('click', loadDiscovery);
    $('#saveSettingsBtn').on('click', saveSettings);
    $('#cctv_cust_search').on('focus input', function () { renderCustList(this.value); });
    $('#cctv_cust_search').on('keydown', onCustKeydown);
    $(document).on('click', '#cctv_cust_list .cctv-cust-item', function () { pickCustomer($(this).data('idx')); });
    $(document).on('click', function (e) { if (!$(e.target).closest('#cctv_cust_picker').length) $('#cctv_cust_list').removeClass('show'); });
    $(document).on('click', '.btn-edit-cctv', function () { openEdit($(this).data('id')); });
    $(document).on('click', '.btn-del-cctv', function () { confirmDelete($(this).data('id'), $(this).data('name')); });
    $(document).on('click', '.btn-resync-cctv', function () { resyncOne($(this).data('id'), $(this).data('name')); });
    $(document).on('click', '#resyncAllBtn', resyncAll);
    $(document).on('click', '.btn-adopt-cctv', function () { adopt($(this).data('host')); });
    $(document).on('click', '.btn-test-cctv', function () { testBroadcast($(this).data('id'), $(this).data('name')); });
    $(document).on('click', '.btn-snooze-cctv', function () { snoozeCctv($(this).data('id'), $(this).data('name')); });
    $('#reloadIncidentsBtn').on('click', loadIncidents);
    $('#tab-incidents-link').on('shown.bs.tab', loadIncidents);
    $(document).on('change', '#discCheckAll', function () { $('.disc-check').prop('checked', this.checked); updateBulkCount(); });
    $(document).on('change', '.disc-check', updateBulkCount);
    $('#bulkAdoptBtn').on('click', bulkAdopt);
    loadAreas();
    $('#addAreaBtn').on('click', openAddArea);
    $('#areaSaveBtn').on('click', saveArea);
    $('#area_load_groups').on('click', loadGroups);
    $('#area_group').on('change', onAreaGroupChange);
    $('#area_quiet_mode').on('change', toggleAreaQuietWindow);
    // Modal area dibuka menggantikan modal CCTV (bukan ditumpuk); saat ditutup, kembalikan modal CCTV bila perlu.
    $('#areaModal').on('hidden.bs.modal', function () { if (reopenCctvAfterArea) { reopenCctvAfterArea = false; $('#cctvModal').modal('show'); } });
    $(document).on('click', '.btn-test-area', function () { testArea($(this).data('id'), $(this).data('name')); });
    $(document).on('click', '.btn-edit-area', function () { openEditArea($(this).data('id')); });
    $(document).on('click', '.btn-del-area', function () { confirmDeleteArea($(this).data('id'), $(this).data('name')); });
  });

  async function loadAll() {
    await Promise.all([loadDevices(), loadStatusOnly()]);
    render();
    loadUptime();
    loadNetwatchHealth();
  }
  // Status netwatch per-CCTV (terpasang? milik-CCTV? ada notif Telegram?) → badge kolom Status.
  async function loadNetwatchHealth() {
    try {
      const r = await fetch('/api/cctv/netwatch-health', { credentials: 'include' }).then(r => r.json());
      if (r.status === 200 && r.data && Array.isArray(r.data.devices)) {
        const map = {};
        r.data.devices.forEach(d => { map[(d.host || '').toLowerCase()] = d; });
        netwatchHealthCache = map;
        render();
      }
    } catch (_) {}
  }
  async function loadUptime() {
    try {
      const r = await fetch('/api/cctv/uptime', { credentials: 'include' }).then(r => r.json());
      if (r.status === 200) { uptimeCache = r.data || {}; render(); }
    } catch (_) {}
  }
  async function loadStatusOnly() {
    try {
      const r = await fetch('/api/cctv/status', { credentials: 'include' }).then(r => r.json());
      if (r.status === 200) { statusCache = r.data; updateStatusUI(); }
    } catch (_) {}
  }
  async function loadDevices() {
    try {
      const r = await fetch('/api/cctv/devices', { credentials: 'include' }).then(r => r.json());
      if (r.status === 200) devicesCache = r.data || [];
    } catch (_) { devicesCache = []; }
  }

  async function loadDiscovery() {
    $('#discoveryStatus').text('Memindai netwatch MikroTik…');
    $('#discoveryTable tbody').empty();
    try {
      const r = await fetch('/api/cctv/discovery', { credentials: 'include' }).then(r => r.json());
      if (r.status === 200) { discoveryCache = r.data || []; renderDiscovery(); }
      else { $('#discoveryStatus').html('<span class="text-danger">' + escapeHtml(r.message || 'Gagal memindai netwatch.') + '</span>'); }
    } catch (e) { $('#discoveryStatus').html('<span class="text-danger">Gagal memindai: ' + escapeHtml(e.message) + '</span>'); }
  }

  function renderDiscovery() {
    const tb = $('#discoveryTable tbody').empty();
    const notAdopted = discoveryCache.filter(c => !c.alreadyRegistered);
    const adopted = discoveryCache.length - notAdopted.length;
    $('#tabCountDiscovery').text(notAdopted.length);
    $('#discoveryStatus').text(`${discoveryCache.length} CCTV terdeteksi di netwatch · ${adopted} sudah diadopsi · ${notAdopted.length} belum.`);
    $('#discCheckAll').prop('checked', false);
    $('#bulkAdoptBar').toggle(notAdopted.length > 0);
    updateBulkCount();
    if (notAdopted.length === 0) {
      tb.append('<tr><td colspan="7" class="text-center text-muted">Semua CCTV di netwatch sudah diadopsi. 🎉</td></tr>');
      return;
    }
    notAdopted.forEach(c => {
      const dot = c.status === 'up' ? 'up' : c.status === 'down' ? 'down' : 'unknown';
      const stLabel = c.status === 'up' ? 'Online' : c.status === 'down' ? 'Mati' : (c.status || '—');
      const fmt = c.conformant
        ? '<span class="badge badge-success">sesuai</span>'
        : '<span class="badge badge-warning">belum standar</span>';
      const offBadge = c.disabled ? ' <span class="badge badge-secondary">netwatch off</span>' : '';
      tb.append(`<tr>
        <td data-label="Pilih"><input type="checkbox" class="disc-check" data-host="${escapeHtml(c.host)}"></td>
        <td class="tumpuk-judul" data-label="Nama"><strong>${escapeHtml(c.name)}</strong>${offBadge}</td>
        <td data-label="Area">${c.area ? escapeHtml(c.area) : '<span class="text-muted">—</span>'}</td>
        <td data-label="IP"><span class="cctv-host">${escapeHtml(c.host)}</span></td>
        <td data-label="Status"><span class="status-dot ${dot}"></span>${stLabel}</td>
        <td data-label="Format Script">${fmt}</td>
        <td data-label="Aksi"><button class="btn btn-sm btn-primary btn-adopt-cctv" data-host="${escapeHtml(c.host)}"><i class="fas fa-plus"></i> Adopsi</button></td>
      </tr>`);
    });
  }

  function adopt(host) {
    const c = discoveryCache.find(x => x.host === host);
    if (!c) return;
    openAdd();
    $('#cctvModalTitle').text('Adopsi CCTV dari Netwatch');
    $('#cctv_name').val(c.name);
    $('#cctv_host').val(c.host);
    setAreaValue(c.area);
    setTimeout(() => $('#cctv_phone').focus(), 300);
  }

  async function loadSettings() {
    try {
      const r = await fetch('/api/cctv/config', { credentials: 'include' }).then(r => r.json());
      if (r.status === 200 && r.data) {
        $('#set_enabled').prop('checked', r.data.enabled === true);
        $('#set_window').val(r.data.confirmationMinutes);
        $('#set_notify_recovery').prop('checked', r.data.notifyRecovery !== false);
        $('#set_quiet_enabled').prop('checked', r.data.quietHoursEnabled === true);
        $('#set_quiet_start').val(r.data.quietStart || '22:00');
        $('#set_quiet_end').val(r.data.quietEnd || '06:00');
        $('#set_quiet_customer').prop('checked', r.data.quietApplyCustomer !== false);
        $('#set_quiet_coordinator').prop('checked', r.data.quietApplyCoordinator !== false);
        $('#set_quiet_group').prop('checked', r.data.quietApplyGroup !== false);
        $('#set_msg_down').val(r.data.messageDown || '');
        $('#set_msg_up').val(r.data.messageUp || '');
        $('#set_msg_down_multi').val(r.data.messageDownMulti || '');
        $('#set_msg_coord').val(r.data.messageCoordDown || '');
        $('#set_msg_group').val(r.data.messageGroupDown || '');
        $('#set_msg_group_up').val(r.data.messageGroupUp || '');
        $('#set_aggregate_sec').val(Math.round((r.data.aggregateWindowMs != null ? r.data.aggregateWindowMs : 90000) / 1000));
        const nw = r.data.netwatch || {};
        $('#nw_bot').val(nw.botToken || ''); $('#nw_chat').val(nw.chatId || '');
        $('#nw_interval').val(nw.interval || '5s'); $('#nw_timeout').val(nw.timeout || '1s');
        $('#nw_msg_up').val(nw.msgUp || ''); $('#nw_msg_down').val(nw.msgDown || '');
        $('#mo_threshold').val(r.data.massOutageThreshold || 0);
        $('#mo_phone').val(r.data.massOutageAdminPhone || '');
        $('#mo_msg').val(r.data.messageMassOutage || '');
        if (r.data.confirmationMinutes) $('#windowLabel').text(r.data.confirmationMinutes);
      }
    } catch (_) {}
  }
  async function saveSettings() {
    const payload = {
      enabled: $('#set_enabled').is(':checked'),
      confirmationMinutes: $('#set_window').val(),
      notifyRecovery: $('#set_notify_recovery').is(':checked'),
      quietHoursEnabled: $('#set_quiet_enabled').is(':checked'),
      quietStart: $('#set_quiet_start').val(),
      quietEnd: $('#set_quiet_end').val(),
      quietApplyCustomer: $('#set_quiet_customer').is(':checked'),
      quietApplyCoordinator: $('#set_quiet_coordinator').is(':checked'),
      quietApplyGroup: $('#set_quiet_group').is(':checked'),
      messageDown: $('#set_msg_down').val(),
      messageUp: $('#set_msg_up').val(),
      messageDownMulti: $('#set_msg_down_multi').val(),
      messageCoordDown: $('#set_msg_coord').val(),
      messageGroupDown: $('#set_msg_group').val(),
      messageGroupUp: $('#set_msg_group_up').val(),
      aggregateWindowMs: (parseInt($('#set_aggregate_sec').val(), 10) || 0) * 1000,
      netwatch: {
        botToken: $('#nw_bot').val(), chatId: $('#nw_chat').val(),
        interval: $('#nw_interval').val(), timeout: $('#nw_timeout').val(),
        msgUp: $('#nw_msg_up').val(), msgDown: $('#nw_msg_down').val(),
      },
      massOutageThreshold: $('#mo_threshold').val(),
      massOutageAdminPhone: $('#mo_phone').val(),
      messageMassOutage: $('#mo_msg').val(),
    };
    try {
      const r = await fetch('/api/cctv/config', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json());
      if (r.status === 200) {
        Swal.fire({ icon: 'success', title: r.data && r.data.enabled ? 'Monitor aktif' : 'Monitor dimatikan', timer: 1300, showConfirmButton: false });
        if (r.data && r.data.confirmationMinutes) $('#windowLabel').text(r.data.confirmationMinutes);
        loadStatusOnly();
      } else {
        Swal.fire('Gagal', r.message || 'Error', 'error');
      }
    } catch (e) { Swal.fire('Gagal', e.message, 'error'); }
  }

  let customersCache = [];
  let custFiltered = [];
  let custActiveIdx = -1;
  const CUST_MAX_SHOW = 60;

  function custPhone(u) { return u.phone || u.phone_number || u.nomor || u.no_hp || u.whatsapp || u.wa || ''; }
  function custName(u) { return u.name || u.nama || u.username || '(tanpa nama)'; }
  function custMeta(u) {
    return [custPhone(u), u.address || u.alamat, u.subscription || u.paket].filter(Boolean).join(' · ');
  }
  async function loadCustomers() {
    try {
      const r = await fetch('/api/users', { credentials: 'include' }).then(r => r.json());
      const list = Array.isArray(r) ? r : (r.data || r.users || []);
      customersCache = (Array.isArray(list) ? list : []).filter((u) => custPhone(u));
    } catch (_) { customersCache = []; }
  }
  function filterCustomers(q) {
    const s = String(q || '').trim().toLowerCase();
    if (!s) return customersCache;
    return customersCache.filter((u) => {
      const hay = [u.name, u.nama, custPhone(u), u.address, u.alamat, u.subscription, u.paket, u.pppoe_username]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(s);
    });
  }
  function renderCustList(q) {
    const box = $('#cctv_cust_list');
    custFiltered = filterCustomers(q);
    custActiveIdx = -1;
    if (customersCache.length === 0) { box.html('<div class="cctv-cust-empty">Daftar pelanggan tak tersedia.</div>').addClass('show'); return; }
    if (custFiltered.length === 0) { box.html('<div class="cctv-cust-empty">Tidak ada pelanggan cocok.</div>').addClass('show'); return; }
    const shown = custFiltered.slice(0, CUST_MAX_SHOW);
    let html = shown.map((u, i) =>
      `<div class="cctv-cust-item" data-idx="${i}"><div class="nm">${escapeHtml(custName(u))}</div><div class="meta">${escapeHtml(custMeta(u))}</div></div>`
    ).join('');
    if (custFiltered.length > CUST_MAX_SHOW) html += `<div class="cctv-cust-empty">…dan ${custFiltered.length - CUST_MAX_SHOW} lagi — persempit pencarian.</div>`;
    box.html(html).addClass('show');
  }
  function pickCustomer(i) {
    const u = custFiltered[i]; if (!u) return;
    const phone = custPhone(u); const nm = custName(u);
    $('#cctv_phone').val(phone);
    if (nm && nm !== '(tanpa nama)') $('#cctv_customer').val(nm);
    $('#cctv_cust_search').val('');
    $('#cctv_cust_list').removeClass('show').empty();
    $('#cctv_cust_chosen').html('✓ Dipilih: <strong>' + escapeHtml(nm) + '</strong> — ' + escapeHtml(phone)).show();
  }
  function resetCustPicker() {
    $('#cctv_cust_search').val('');
    $('#cctv_cust_list').removeClass('show').empty();
    $('#cctv_cust_chosen').hide().text('');
    custActiveIdx = -1;
  }
  function setCustActive(idx) {
    const items = $('#cctv_cust_list .cctv-cust-item');
    if (!items.length) return;
    custActiveIdx = Math.max(0, Math.min(idx, items.length - 1));
    items.removeClass('active');
    const el = items.eq(custActiveIdx).addClass('active');
    const box = document.getElementById('cctv_cust_list'); const node = el.get(0);
    if (node && box) {
      if (node.offsetTop < box.scrollTop) box.scrollTop = node.offsetTop;
      else if (node.offsetTop + node.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = node.offsetTop + node.offsetHeight - box.clientHeight;
    }
  }
  function onCustKeydown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!$('#cctv_cust_list').hasClass('show')) renderCustList(e.target.value); setCustActive(custActiveIdx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCustActive(custActiveIdx - 1); }
    else if (e.key === 'Enter') { const n = $('#cctv_cust_list .cctv-cust-item').length; if (custActiveIdx >= 0 && n) { e.preventDefault(); pickCustomer(custActiveIdx); } }
    else if (e.key === 'Escape') { $('#cctv_cust_list').removeClass('show'); }
  }
  // Ringkas status auto-sync netwatch dari respons server (dipakai setelah simpan/hapus/sinkron).
  function nwText(nw) {
    if (!nw || nw.skipped) return '';
    if (nw.ok) {
      let t = nw.mode === 'add' ? 'Entri netwatch dibuat di MikroTik.' : (nw.mode === 'set' ? 'Entri netwatch disinkron.' : (nw.message || 'Netwatch OK.'));
      if (nw.telegram === false) t += ' (Tanpa notif Telegram — isi Bot Token/Chat ID di Pengaturan.)';
      if (Array.isArray(nw.warnings) && nw.warnings.length) t += '\n⚠ ' + nw.warnings.join('\n⚠ ');
      return t;
    }
    return '⚠ ' + (nw.message || 'Netwatch gagal disinkron.');
  }
  async function resyncOne(id, name) {
    try {
      const r = await fetch('/api/cctv/devices/' + id + '/resync-netwatch', { method: 'POST', credentials: 'include' }).then(x => x.json());
      const nw = r.data || {};
      Swal.fire({ icon: r.status === 200 ? 'success' : 'warning', title: r.status === 200 ? 'Netwatch tersinkron' : 'Perlu perhatian', text: (name ? name + ': ' : '') + (nwText(nw) || r.message || '') });
      loadAll();
    } catch (e) { Swal.fire('Gagal', e.message, 'error'); }
  }
  async function resyncAll() {
    const c = await Swal.fire({ icon: 'question', title: 'Sinkronkan semua CCTV ke netwatch?', text: 'Membuat/memperbaiki entri netwatch di MikroTik untuk semua CCTV terdaftar. Entri OLT/infra tidak disentuh.', showCancelButton: true, confirmButtonText: 'Sinkronkan', cancelButtonText: 'Batal' });
    if (!c.isConfirmed) return;
    try {
      const r = await fetch('/api/cctv/resync-netwatch', { method: 'POST', credentials: 'include' }).then(x => x.json());
      const rows = (r.data || []);
      const fail = rows.filter(x => !x.ok);
      const html = r.message + (fail.length ? '<br><br><b>Perlu perhatian:</b><br>' + fail.map(x => escapeHtml(x.name) + ': ' + escapeHtml(x.message || '')).join('<br>') : '');
      Swal.fire({ icon: fail.length ? 'warning' : 'success', title: 'Sinkron netwatch', html });
      loadAll();
    } catch (e) { Swal.fire('Gagal', e.message, 'error'); }
  }

  function fmtSince(ms) {
    const diff = Date.now() - ms;
    if (!isFinite(diff) || diff < 0) return '';
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'baru saja';
    if (m < 60) return m + ' menit';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' jam' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
    return Math.floor(h / 24) + ' hari';
  }

  function roleLabel(role) { return role === 'coordinator' ? 'Koordinator' : (role === 'group' ? 'Grup WA' : 'Pelanggan'); }
  function maskRecipient(p) {
    p = String(p || '');
    if (p.indexOf('@g.us') >= 0) return 'grup';
    const d = p.replace(/[^0-9]/g, '');
    return d.length <= 6 ? (d || p) : (d.slice(0, 4) + '***' + d.slice(-2));
  }
  function testResultHtml(data) {
    if (!data) return 'Selesai.';
    const lines = (data.recipients || []).map(r => (r.delivered ? '✅' : '❌') + ' ' + roleLabel(r.role) + ' <span class="text-muted">(' + maskRecipient(r.phone) + ')</span>').join('<br>');
    return '<div class="text-left">Terkirim <strong>' + (data.delivered || 0) + '/' + (data.total || 0) + '</strong>:<br>' + (lines || '—') + '</div>';
  }
  function snoozeCctv(id, name) {
    Swal.fire({
      title: 'Snooze / Maintenance',
      html: 'Bisukan alert <strong>' + escapeHtml(name || '') + '</strong> sementara — otomatis aktif lagi saat kedaluwarsa.',
      input: 'select',
      inputOptions: { '60': '1 jam', '240': '4 jam', '1440': '1 hari', '4320': '3 hari', '0': 'Aktifkan lagi (batalkan snooze)' },
      inputValue: '60',
      showCancelButton: true, confirmButtonText: 'Terapkan', cancelButtonText: 'Batal',
    }).then(async (r) => {
      if (!r.isConfirmed) return;
      const minutes = parseInt(r.value, 10) || 0;
      try {
        const res = await fetch('/api/cctv/devices/' + id + '/snooze', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes }) }).then(x => x.json());
        if (res.status === 200) { Swal.fire({ icon: 'success', title: minutes > 0 ? 'Di-snooze' : 'Snooze dibatalkan', timer: 1500, showConfirmButton: false }); loadAll(); }
        else Swal.fire('Gagal', res.message || 'Error', 'error');
      } catch (e) { Swal.fire('Gagal', e.message, 'error'); }
    });
  }
  function testBroadcast(id, name) {
    Swal.fire({
      icon: 'question', title: 'Kirim pesan tes?',
      html: 'Kirim WA percobaan untuk <strong>' + escapeHtml(name || '') + '</strong> ke <strong>semua penerima</strong> (pelanggan / koordinator / grup) sesuai pengaturan.',
      showCancelButton: true, confirmButtonText: 'Kirim', cancelButtonText: 'Batal',
    }).then(async (r) => {
      if (!r.isConfirmed) return;
      try {
        const res = await fetch('/api/cctv/test-broadcast', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).then(r => r.json());
        if (res.status === 200) Swal.fire({ icon: 'success', title: 'Terkirim', html: testResultHtml(res.data), timer: 3500, showConfirmButton: false });
        else Swal.fire('Gagal', res.message || 'Error', 'error');
      } catch (e) { Swal.fire('Gagal', e.message, 'error'); }
    });
  }
  function testArea(id, name) {
    Swal.fire({
      icon: 'question', title: 'Kirim pesan tes?',
      html: 'Kirim WA percobaan ke <strong>koordinator/grup</strong> area <strong>' + escapeHtml(name || '') + '</strong>.',
      showCancelButton: true, confirmButtonText: 'Kirim', cancelButtonText: 'Batal',
    }).then(async (r) => {
      if (!r.isConfirmed) return;
      try {
        const res = await fetch('/api/cctv/areas/' + id + '/test', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json());
        if (res.status === 200) Swal.fire({ icon: 'success', title: 'Terkirim', html: testResultHtml(res.data), timer: 3500, showConfirmButton: false });
        else Swal.fire('Gagal', res.message || 'Error', 'error');
      } catch (e) { Swal.fire('Gagal', e.message, 'error'); }
    });
  }

  async function loadIncidents() {
    const tb = $('#incidentsTable tbody').empty();
    tb.append('<tr><td colspan="5" class="text-center text-muted">Memuat…</td></tr>');
    try {
      const r = await fetch('/api/cctv/incidents?limit=200', { credentials: 'include' }).then(r => r.json());
      renderIncidents(r.status === 200 ? (r.data || []) : []);
    } catch (_) { renderIncidents([]); }
  }
  function incidentBadge(st) {
    const map = {
      broadcasted: 'badge-danger', recovered: 'badge-success', pending: 'badge-warning',
      cooldown_skipped: 'badge-secondary', cancelled: 'badge-secondary',
      recovered_before_broadcast: 'badge-info', mass_suppressed: 'badge-dark',
    };
    return '<span class="badge ' + (map[st] || 'badge-light') + '">' + escapeHtml(st || '-') + '</span>';
  }
  function renderIncidents(list) {
    const tb = $('#incidentsTable tbody').empty();
    if (!list.length) { tb.append('<tr><td colspan="5" class="text-center text-muted">Belum ada insiden tercatat.</td></tr>'); return; }
    list.forEach(i => {
      const det = i.detectedAt ? new Date(i.detectedAt).toLocaleString('id-ID') : '-';
      const bc = (i.notify_down_delivered != null)
        ? (i.notify_down_delivered + '/' + (i.notify_down_recipients || 0))
        : (i.status === 'mass_suppressed' ? 'ditahan (massal)' : '—');
      const rec = i.recoveredAt ? new Date(i.recoveredAt).toLocaleTimeString('id-ID') : '—';
      tb.append(`<tr>
        <td data-label="Waktu deteksi"><small>${escapeHtml(det)}</small></td>
        <td class="tumpuk-judul" data-label="CCTV">${escapeHtml(i.cctv_name || '')}<br><span class="cctv-host">${escapeHtml(i.host || '')}</span></td>
        <td data-label="Status">${incidentBadge(i.status)}</td>
        <td data-label="Broadcast"><small>${escapeHtml(String(bc))}</small></td>
        <td data-label="Pulih"><small>${escapeHtml(rec)}</small></td>
      </tr>`);
    });
  }

  function updateBulkCount() { $('#bulkAdoptCount').text($('.disc-check:checked').length); }
  async function bulkAdopt() {
    const hosts = $('.disc-check:checked').map(function () { return $(this).data('host'); }).get();
    if (hosts.length === 0) { Swal.fire('Pilih dulu', 'Centang minimal satu CCTV.', 'warning'); return; }
    const phone = $('#bulkAdoptPhone').val().trim();
    if (!phone) { Swal.fire('Lengkapi', 'Isi nomor WA untuk CCTV yang dicentang.', 'warning'); return; }
    const r = await Swal.fire({ icon: 'question', title: 'Adopsi ' + hosts.length + ' CCTV?', html: 'Semua diberi nomor WA <strong>' + escapeHtml(phone) + '</strong>. Bisa diubah per-CCTV nanti.', showCancelButton: true, confirmButtonText: 'Adopsi', cancelButtonText: 'Batal' });
    if (!r.isConfirmed) return;
    let ok = 0, fail = 0;
    for (const host of hosts) {
      const c = discoveryCache.find(x => x.host === host); if (!c) { fail++; continue; }
      try {
        const res = await fetch('/api/cctv/devices', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: c.name, host: c.host, area: c.area || '', phone }) }).then(r => r.json());
        if (res.status === 200) ok++; else fail++;
      } catch (_) { fail++; }
    }
    Swal.fire({ icon: ok ? 'success' : 'error', title: 'Adopsi selesai', text: ok + ' berhasil' + (fail ? ', ' + fail + ' gagal' : '') + '.', timer: 2400, showConfirmButton: false });
    $('#bulkAdoptPhone').val('');
    await loadAll();
    loadDiscovery();
  }

  function statusOf(host) {
    if (!statusCache || !Array.isArray(statusCache.devices)) return null;
    return statusCache.devices.find(d => d.host === (host || '').toLowerCase());
  }

  function render() {
    const tb = $('#cctvTable tbody').empty();
    $('#tabCountList').text(devicesCache.length);
    if (devicesCache.length === 0) {
      tb.append('<tr><td colspan="7" class="text-center text-muted">Belum ada CCTV terdaftar.</td></tr>');
      $('#kpiTotal').text(0); $('#kpiUp').text(0); $('#kpiDown').text(0); $('#kpiPending').text(0);
      return;
    }
    let up = 0, down = 0, pending = 0;
    devicesCache.forEach(d => {
      const s = statusOf(d.host);
      const st = s ? s.status : null;
      const isPending = s && s.pending;
      const dot = st === 'up' ? 'up' : st === 'down' ? 'down' : 'unknown';
      const stLabel = st === 'up' ? 'Online' : st === 'down' ? (isPending ? 'Mati (menunggu konfirmasi)' : 'Mati') : '—';
      if (st === 'up') up++; else if (st === 'down') down++;
      if (isPending) pending++;
      const win = d.confirmationMinutes ? (d.confirmationMinutes + ' menit') : '<span class="text-muted">default</span>';
      const enabled = d.enabled !== false;
      const enabledBadge = enabled ? '' : ' <span class="badge badge-secondary">nonaktif</span>';
      const optoutBadge = d.notifyCustomer === false ? ' <span class="badge badge-info" title="Pantau saja — pelanggan tidak di-WA">pantau saja</span>' : '';
      const snoozeActive = d.snoozeUntil && Date.now() < d.snoozeUntil;
      const snoozeBadge = snoozeActive ? ' <span class="badge badge-dark" title="Alert dibisukan (maintenance) sampai ' + new Date(d.snoozeUntil).toLocaleString('id-ID') + '"><i class="fas fa-bell-slash"></i> snooze s/d ' + new Date(d.snoozeUntil).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + '</span>' : '';
      const sinceTxt = (s && s.since) ? ' <small class="text-muted">· ' + fmtSince(s.since) + '</small>' : '';
      // Badge kesehatan netwatch (dari /netwatch-health): terpasang & milik-CCTV? ada notif Telegram?
      const h = netwatchHealthCache[(d.host || '').toLowerCase()];
      let nwWarn;
      if (h) {
        if (!h.inNetwatch) nwWarn = ' <span class="badge badge-danger" title="Belum ada entri netwatch di MikroTik — klik Sinkron untuk membuatnya">✗ belum di netwatch</span>';
        else if (!h.cctvOwned) nwWarn = ' <span class="badge badge-warning" title="IP ada di netwatch tapi BUKAN entri CCTV (mungkin OLT/AP/infra) — cek IP-nya">⚠ IP dipakai entri lain</span>';
        else if (!h.telegramScript) nwWarn = ' <span class="badge badge-info" title="Entri netwatch CCTV terpasang, tapi tanpa notif Telegram (isi Bot Token/Chat ID di Pengaturan)">✓ netwatch (tanpa TG)</span>';
        else nwWarn = ' <span class="badge badge-success" title="Entri netwatch CCTV + notifikasi Telegram terpasang">✓ netwatch</span>';
      } else {
        nwWarn = (statusCache && statusCache.running && s && s.inNetwatch === false)
          ? ' <span class="badge badge-warning" title="Host ini tidak ditemukan di netwatch MikroTik — monitor tak bisa memantau">⚠ tidak di netwatch</span>' : '';
      }
      const u = uptimeCache[(d.host || '').toLowerCase()];
      const up7 = u ? u.uptime7d : null;
      const upCls = up7 == null ? 'text-muted' : up7 >= 99 ? 'text-success' : up7 >= 95 ? 'text-warning' : 'text-danger';
      const upCell = u ? `<span class="${upCls}" title="24 jam: ${u.uptime24h}% · 30 hari: ${u.uptime30d}%">${up7}%</span>` : '<span class="text-muted">—</span>';
      tb.append(`<tr>
        <td class="tumpuk-judul" data-label="Nama"><strong>${escapeHtml(d.name)}</strong>${enabledBadge}${optoutBadge}${snoozeBadge}${d.area ? '<br><small class="text-muted">' + escapeHtml(d.area) + '</small>' : ''}</td>
        <td data-label="IP"><span class="cctv-host">${escapeHtml(d.host)}</span></td>
        <td data-label="Pelanggan">${d.customerName ? escapeHtml(d.customerName) + '<br>' : ''}<small class="text-muted">${escapeHtml(d.phone || '')}</small></td>
        <td data-label="Status"><span class="status-dot ${dot}"></span>${stLabel}${sinceTxt}${nwWarn}</td>
        <td data-label="Uptime 7h">${upCell}</td>
        <td data-label="Window">${win}</td>
        <td data-label="Aksi" class="text-nowrap">
          <div class="aksi-group btn-actions">
          <button class="btn btn-sm btn-outline-success btn-test-cctv" data-id="${d.id}" data-name="${escapeHtml(d.name)}" title="Kirim pesan tes ke semua penerima (pelanggan/koordinator/grup)"><i class="fas fa-paper-plane"></i></button>
          <button class="btn btn-sm ${snoozeActive ? 'btn-secondary' : 'btn-outline-secondary'} btn-snooze-cctv" data-id="${d.id}" data-name="${escapeHtml(d.name)}" title="Snooze / mode maintenance — bisukan alert sementara"><i class="fas fa-bell-slash"></i></button>
          <button class="btn btn-sm btn-outline-info btn-resync-cctv" data-id="${d.id}" data-name="${escapeHtml(d.name)}" title="Sinkron ulang entri netwatch (buat/perbaiki di MikroTik)"><i class="fas fa-sync"></i></button>
          <button class="btn btn-sm btn-outline-primary btn-edit-cctv" data-id="${d.id}" title="Edit"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-outline-danger btn-del-cctv" data-id="${d.id}" data-name="${escapeHtml(d.name)}" title="Hapus"><i class="fas fa-trash"></i></button>
          </div>
        </td>
      </tr>`);
    });
    $('#kpiTotal').text(devicesCache.length);
    $('#kpiUp').text(up); $('#kpiDown').text(down); $('#kpiPending').text(pending);
  }

  function updateStatusUI() {
    if (!statusCache) return;
    const pill = $('#monitorPill');
    if (statusCache.running) pill.removeClass('badge-secondary badge-warning').addClass('badge-success').text('monitor: ON');
    else pill.removeClass('badge-success badge-warning').addClass('badge-secondary').text('monitor: OFF');
    $('#lastUpdate').text(statusCache.stats && statusCache.stats.last_poll_at ? new Date(statusCache.stats.last_poll_at).toLocaleTimeString('id-ID') : '-');
    render();
  }

  function openAdd() {
    $('#cctvModalTitle').text('Tambah CCTV'); $('#cctvForm')[0].reset();
    $('#cctv_id').val(''); $('#cctv_enabled').prop('checked', true);
    $('#cctv_notify_customer').prop('checked', true);
    resetCustPicker();
    selectAreaAfterSave = false;
    setAreaValue('');
    $('#cctvModal').modal('show');
  }
  function openEdit(id) {
    const d = devicesCache.find(x => x.id === id); if (!d) return;
    $('#cctvModalTitle').text('Edit CCTV');
    $('#cctv_id').val(d.id); $('#cctv_name').val(d.name); $('#cctv_host').val(d.host);
    $('#cctv_phone').val(d.phone); $('#cctv_customer').val(d.customerName || '');
    setAreaValue(d.area);
    $('#cctv_window').val(d.confirmationMinutes || ''); $('#cctv_message').val(d.customMessage || '');
    $('#cctv_enabled').prop('checked', d.enabled !== false);
    $('#cctv_notify_customer').prop('checked', d.notifyCustomer !== false);
    resetCustPicker();
    $('#cctvModal').modal('show');
  }
  async function save() {
    const payload = {
      name: $('#cctv_name').val().trim(),
      host: $('#cctv_host').val().trim(),
      phone: $('#cctv_phone').val().trim(),
      customerName: $('#cctv_customer').val().trim(),
      area: $('#cctv_area').val().trim(),
      confirmationMinutes: $('#cctv_window').val() ? Number($('#cctv_window').val()) : null,
      customMessage: $('#cctv_message').val().trim(),
      enabled: $('#cctv_enabled').is(':checked'),
      notifyCustomer: $('#cctv_notify_customer').is(':checked'),
    };
    if (!payload.name || !payload.host) {
      Swal.fire('Lengkapi', 'Nama & IP wajib diisi.', 'warning'); return;
    }
    if (!payload.phone) {
      const hasCoord = areasCache.some(a => a.enabled !== false && a.coordinatorPhone && (a.name || '').toLowerCase() === (payload.area || '').toLowerCase());
      if (!hasCoord) { Swal.fire('Lengkapi', 'Nomor WA wajib diisi, atau tetapkan koordinator untuk areanya (tab Koordinator).', 'warning'); return; }
    }
    const id = $('#cctv_id').val();
    const url = id ? `/api/cctv/devices/${id}` : '/api/cctv/devices';
    const method = id ? 'PUT' : 'POST';
    try {
      const r = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json());
      if (r.status === 200) {
        $('#cctvModal').modal('hide');
        // Netwatch kini otomatis di server (auto-sync). Tampilkan hasilnya bila ada.
        const t = nwText(r.netwatch);
        if (t && r.netwatch && !r.netwatch.ok) {
          Swal.fire({ icon: 'warning', title: 'CCTV tersimpan — cek netwatch', text: t });
        } else if (t) {
          Swal.fire({ icon: 'success', title: 'Tersimpan', text: t, timer: 2200, showConfirmButton: false });
        } else {
          Swal.fire({ icon: 'success', title: 'Tersimpan', timer: 1200, showConfirmButton: false });
        }
        await loadAll();
        loadDiscovery();
      } else {
        Swal.fire('Gagal', r.message || 'Error', 'error');
      }
    } catch (e) { Swal.fire('Gagal', e.message, 'error'); }
  }
  function confirmDelete(id, name) {
    Swal.fire({ icon: 'warning', title: 'Hapus CCTV?', text: name, showCancelButton: true, confirmButtonText: 'Hapus', cancelButtonText: 'Batal', confirmButtonColor: '#dc3545' })
      .then(async (r) => {
        if (!r.isConfirmed) return;
        try {
          const res = await fetch(`/api/cctv/devices/${id}`, { method: 'DELETE', credentials: 'include' }).then(r => r.json());
          if (res.status === 200) {
            const nw = res.netwatch || {};
            const extra = (nw.skippedNonCctv && nw.skippedNonCctv.length) ? ' (' + nw.skippedNonCctv.length + ' entri non-CCTV di IP sama dibiarkan)' : '';
            Swal.fire({ icon: 'success', title: 'Terhapus', text: 'CCTV & entri netwatch-nya dihapus.' + extra, timer: 1800, showConfirmButton: false }); loadAll(); loadDiscovery();
          } else if (res.status === 502) {
            // Netwatch gagal dihapus → device SENGAJA dipertahankan (bukan yatim). Admin bisa retry.
            Swal.fire({ icon: 'warning', title: 'Belum terhapus', text: res.message || 'Gagal hapus entri netwatch di MikroTik. CCTV dipertahankan — coba lagi (tombol Sinkron) atau cek MikroTik.' });
          } else Swal.fire('Gagal', res.message || 'Error', 'error');
        } catch (e) { Swal.fire('Gagal', e.message, 'error'); }
      });
  }
  async function loadAreas() {
    try {
      const r = await fetch('/api/cctv/areas', { credentials: 'include' }).then(r => r.json());
      if (r.status === 200) { areasCache = r.data || []; renderAreas(); populateAreaSelect(); }
    } catch (_) {}
  }
  function populateAreaSelect() {
    const cur = $('#cctv_area').val();
    const sel = $('#cctv_area').empty();
    sel.append('<option value="">— tanpa area —</option>');
    areasCache.forEach(a => {
      const off = a.enabled === false ? ' (nonaktif)' : '';
      sel.append(`<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)}${off}</option>`);
    });
    sel.append('<option value="__new__">➕ Tambah area baru…</option>');
    if (cur && cur !== '__new__') setAreaValue(cur);
  }
  // Pilih area di dropdown; bila area belum terkelola (mis. hasil adopsi), suntik opsi sementara agar nilainya tetap tersimpan saat Simpan.
  function setAreaValue(area) {
    const sel = $('#cctv_area');
    sel.find('option.cctv-area-temp').remove();
    area = (area || '').trim();
    if (!area) { sel.val(''); updateAreaCoordHint(); return; }
    const match = areasCache.find(a => (a.name || '').toLowerCase() === area.toLowerCase());
    if (match) {
      sel.val(match.name);
    } else {
      $('<option class="cctv-area-temp"></option>').val(area).text(area + ' (belum terkelola)')
        .insertBefore(sel.find('option[value="__new__"]'));
      sel.val(area);
    }
    updateAreaCoordHint();
  }
  // Opsi "➕ Tambah area baru…" → buka modal area; setelah tersimpan, area baru otomatis terpilih di form CCTV.
  function onAreaChange() {
    if ($('#cctv_area').val() === '__new__') {
      selectAreaAfterSave = true;
      reopenCctvAfterArea = true;
      $('#cctv_area').val('');
      // Tutup modal CCTV dulu lalu buka modal area (hindari modal bertumpuk yg bermasalah di Bootstrap 4).
      $('#cctvModal').one('hidden.bs.modal', openAddArea);
      $('#cctvModal').modal('hide');
      return;
    }
    updateAreaCoordHint();
  }
  // Tampilkan koordinator yang ter-link dgn area yang dipilih (koordinator dicocokkan via nama area).
  function updateAreaCoordHint() {
    const area = ($('#cctv_area').val() || '').trim().toLowerCase();
    const box = $('#cctv_area_coord');
    if (!area) { box.empty(); return; }
    const a = areasCache.find(x => (x.name || '').toLowerCase() === area);
    if (a && a.enabled !== false && a.coordinatorPhone) {
      box.html('📣 <span class="text-success">Koordinator <strong>' + escapeHtml(a.coordinatorName || a.name) + '</strong> (' + escapeHtml(a.coordinatorPhone) + ') akan ikut dinotif untuk area ini.</span>');
    } else if (a && a.enabled === false) {
      box.html('<span class="text-muted">Koordinator area ini sedang nonaktif.</span>');
    } else {
      box.html('<span class="text-muted">Area ini belum punya koordinator — tambahkan di tab <em>Koordinator</em> bila perlu.</span>');
    }
  }
  const GROUP_HINT_DEFAULT = 'Klik <strong>Muat</strong> untuk ambil daftar grup yang bot ikuti — bot harus jadi anggota grup RT lebih dulu.';
  function resetGroupHint() { $('#area_group_hint').html(GROUP_HINT_DEFAULT); }
  // Pastikan grup tersimpan tetap tampil di <select> walau daftar belum dimuat (suntik opsi bila perlu).
  function setAreaGroupValue(id, name) {
    const sel = $('#area_group');
    if (id) {
      let has = false;
      sel.find('option').each(function () { if (this.value === id) has = true; });
      if (!has) sel.append($('<option>').val(id).text(name || id));
    }
    sel.val(id || '');
    $('#area_group_name').val(id ? (name || sel.find('option:selected').text() || '') : '');
  }
  function onAreaGroupChange() {
    const o = this.options[this.selectedIndex];
    $('#area_group_name').val(this.value ? (o ? o.text : '') : '');
  }
  // Muat daftar grup WA yang bot ikuti (butuh WA online). Pertahankan pilihan saat edit.
  async function loadGroups() {
    const btn = $('#area_load_groups'); const hint = $('#area_group_hint');
    btn.prop('disabled', true); hint.text('Memuat daftar grup…');
    try {
      const r = await fetch('/api/cctv/groups', { credentials: 'include' }).then(x => x.json());
      if (r.status !== 200) { hint.html('<span class="text-danger">' + escapeHtml(r.message || 'Gagal memuat grup') + '</span>'); return; }
      const cur = $('#area_group').val(); const curName = $('#area_group_name').val();
      const sel = $('#area_group').empty();
      sel.append('<option value="">— tanpa grup —</option>');
      (r.data || []).forEach(g => sel.append($('<option>').val(g.id).text(g.subject + (g.size ? ' (' + g.size + ' anggota)' : ''))));
      setAreaGroupValue(cur, curName); // pulihkan pilihan sebelumnya
      hint.html('<span class="text-success">' + ((r.data || []).length) + ' grup ditemukan. Pilih grup RT.</span>');
    } catch (e) {
      hint.html('<span class="text-danger">Gagal: ' + escapeHtml(e.message) + '</span>');
    } finally { btn.prop('disabled', false); }
  }
  function toggleAreaQuietWindow() { $('#area_quiet_window').toggle($('#area_quiet_mode').val() === 'custom'); }
  function renderAreas() {
    const tb = $('#areasTable tbody').empty();
    $('#tabCountAreas').text(areasCache.length);
    if (areasCache.length === 0) {
      tb.append('<tr><td colspan="4" class="text-center text-muted">Belum ada koordinator area. Klik "Tambah Area".</td></tr>');
      return;
    }
    areasCache.forEach(a => {
      const off = a.enabled === false ? ' <span class="badge badge-secondary">nonaktif</span>' : '';
      const qz = a.quietMode === 'off' ? 'tanpa jam tenang' : a.quietMode === 'custom' ? ('jam tenang ' + (a.quietStart || '?') + '–' + (a.quietEnd || '?')) : '';
      tb.append(`<tr>
        <td class="tumpuk-judul" data-label="Area"><strong>${escapeHtml(a.name)}</strong>${off}${qz ? '<br><small class="text-muted"><i class="fas fa-moon"></i> ' + escapeHtml(qz) + '</small>' : ''}</td>
        <td data-label="Koordinator">${escapeHtml(a.coordinatorName || '—')}</td>
        <td data-label="Tujuan Notifikasi">
          ${a.coordinatorPhone ? '<div><span class="cctv-host">' + escapeHtml(a.coordinatorPhone) + '</span>' + (a.coordinatorInGroup && a.coordinatorGroupId ? ' <span class="badge badge-light" title="Nomor koordinator tak dijapri, cukup lewat grup">via grup</span>' : '') + '</div>' : ''}
          ${a.coordinatorGroupId ? '<div><span class="badge badge-info"><i class="fas fa-users"></i> Grup: ' + escapeHtml(a.coordinatorGroupName || a.coordinatorGroupId) + '</span>' + (a.customersInGroup ? ' <span class="badge badge-light" title="Pelanggan tak dijapri, cukup lewat grup">warga di grup</span>' : '') + '</div>' : ''}
          ${(!a.coordinatorPhone && !a.coordinatorGroupId) ? '<span class="text-muted">—</span>' : ''}
        </td>
        <td data-label="Aksi" class="text-nowrap">
          <div class="aksi-group btn-actions">
          <button class="btn btn-sm btn-outline-success btn-test-area" data-id="${a.id}" data-name="${escapeHtml(a.name)}" title="Kirim pesan tes ke koordinator/grup area ini"><i class="fas fa-paper-plane"></i></button>
          <button class="btn btn-sm btn-outline-primary btn-edit-area" data-id="${a.id}" title="Edit"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-outline-danger btn-del-area" data-id="${a.id}" data-name="${escapeHtml(a.name)}" title="Hapus"><i class="fas fa-trash"></i></button>
          </div>
        </td>
      </tr>`);
    });
  }
  function openAddArea() {
    $('#areaModalTitle').text('Tambah Area'); $('#areaForm')[0].reset();
    $('#area_id').val(''); $('#area_enabled').prop('checked', true);
    $('#area_group').val(''); $('#area_group_name').val(''); $('#area_customers_in_group').prop('checked', false); $('#area_coord_in_group').prop('checked', false); resetGroupHint();
    $('#area_quiet_mode').val('inherit'); $('#area_quiet_start').val(''); $('#area_quiet_end').val(''); toggleAreaQuietWindow();
    $('#areaModal').modal('show');
  }
  function openEditArea(id) {
    const a = areasCache.find(x => x.id === id); if (!a) return;
    $('#areaModalTitle').text('Edit Area');
    $('#area_id').val(a.id); $('#area_name').val(a.name);
    $('#area_coord_name').val(a.coordinatorName || ''); $('#area_coord_phone').val(a.coordinatorPhone || '');
    setAreaGroupValue(a.coordinatorGroupId || '', a.coordinatorGroupName || ''); resetGroupHint();
    $('#area_customers_in_group').prop('checked', a.customersInGroup === true);
    $('#area_coord_in_group').prop('checked', a.coordinatorInGroup === true);
    $('#area_quiet_mode').val(a.quietMode || 'inherit'); $('#area_quiet_start').val(a.quietStart || ''); $('#area_quiet_end').val(a.quietEnd || ''); toggleAreaQuietWindow();
    $('#area_enabled').prop('checked', a.enabled !== false);
    $('#areaModal').modal('show');
  }
  async function saveArea() {
    const payload = {
      name: $('#area_name').val().trim(),
      coordinatorName: $('#area_coord_name').val().trim(),
      coordinatorPhone: $('#area_coord_phone').val().trim(),
      coordinatorGroupId: $('#area_group').val().trim(),
      coordinatorGroupName: $('#area_group_name').val().trim(),
      customersInGroup: $('#area_customers_in_group').is(':checked'),
      coordinatorInGroup: $('#area_coord_in_group').is(':checked'),
      quietMode: $('#area_quiet_mode').val(),
      quietStart: $('#area_quiet_start').val(),
      quietEnd: $('#area_quiet_end').val(),
      enabled: $('#area_enabled').is(':checked'),
    };
    if (!payload.name) { Swal.fire('Lengkapi', 'Nama area wajib diisi.', 'warning'); return; }
    if (!payload.coordinatorPhone && !payload.coordinatorGroupId) { Swal.fire('Lengkapi', 'Isi nomor WA koordinator ATAU pilih Grup WA RT.', 'warning'); return; }
    if (payload.quietMode === 'custom' && (!payload.quietStart || !payload.quietEnd)) { Swal.fire('Lengkapi', 'Jam tenang "Atur sendiri": isi jam mulai & selesai.', 'warning'); return; }
    const id = $('#area_id').val();
    const url = id ? `/api/cctv/areas/${id}` : '/api/cctv/areas';
    const method = id ? 'PUT' : 'POST';
    try {
      const r = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json());
      if (r.status === 200) {
        $('#areaModal').modal('hide');
        Swal.fire({ icon: 'success', title: 'Tersimpan', timer: 1100, showConfirmButton: false });
        await loadAreas();
        if (selectAreaAfterSave) { selectAreaAfterSave = false; setAreaValue(payload.name); }
      } else Swal.fire('Gagal', r.message || 'Error', 'error');
    } catch (e) { Swal.fire('Gagal', e.message, 'error'); }
  }
  function confirmDeleteArea(id, name) {
    Swal.fire({ icon: 'warning', title: 'Hapus area?', text: name, showCancelButton: true, confirmButtonText: 'Hapus', cancelButtonText: 'Batal', confirmButtonColor: '#dc3545' })
      .then(async (r) => {
        if (!r.isConfirmed) return;
        try {
          const res = await fetch(`/api/cctv/areas/${id}`, { method: 'DELETE', credentials: 'include' }).then(r => r.json());
          if (res.status === 200) { Swal.fire({ icon: 'success', title: 'Terhapus', timer: 1000, showConfirmButton: false }); loadAreas(); }
          else Swal.fire('Gagal', res.message || 'Error', 'error');
        } catch (e) { Swal.fire('Gagal', e.message, 'error'); }
      });
  }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
