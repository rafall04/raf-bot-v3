<?php
/**
 * Header Doc
 * Purpose: Halaman admin untuk konfigurasi rule, scan manual, dry-run, dan broadcast auto outage berbasis PPPoE MikroTik.
 * Caller: `routes/pages.js` pada path `/auto-outage`.
 * Deps: `_navbar.php`, `topbar.php`, API `/api/admin/auto-outage/*`, Bootstrap, jQuery, SweetAlert2.
 * MainFuncs: Render form rule, tombol scan/dry-run/broadcast, tabel state offline, dan scan logs.
 * SideEffects: Memanggil API admin untuk menyimpan rule, membaca state, menjalankan scan, dan memulai broadcast WhatsApp.
 */
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <?php
    $pageTitle = 'RAF BOT - Auto Outage';
    $themeRole = 'admin';
    $pageDescription = 'RAF BOT Auto Outage';
    include __DIR__ . '/_head.php';
    ?>

  <style>
    .ao-grid { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 1rem; }
    .ao-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 12px 30px rgba(15,23,42,0.06); }
    .ao-card .card-header { background: transparent; border-bottom: 1px solid #e5e7eb; }
    .ao-pill { display: inline-flex; align-items: center; gap: .35rem; padding: .35rem .6rem; border-radius: 999px; font-size: .78rem; background: #eef2ff; color: #1e3a8a; }
    .ao-metric { border-radius: 12px; padding: 1rem; background: linear-gradient(135deg, #0f766e, #115e59); color: #fff; min-height: 100px; }
    .ao-metric strong { font-size: 1.8rem; display: block; }
    .ao-table { font-size: .86rem; }
    @media (max-width: 991px) { .ao-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body id="page-top">
  <div id="wrapper">
    <?php include '_navbar.php'; ?>
    <div id="content-wrapper" class="d-flex flex-column">
      <div id="content">
        <?php include 'topbar.php'; ?>
        <div class="container-fluid">
          <div class="dashboard-header">
            <div class="d-flex align-items-center justify-content-between flex-wrap">
              <div>
                <h1>Auto Outage Broadcast</h1>
                <p>Deteksi pelanggan offline dari PPPoE MikroTik, validasi ke database pelanggan, lalu broadcast interaktif.</p>
              </div>
              <div class="d-flex flex-wrap" style="gap:.5rem;">
                <button id="btnScan" class="btn btn-primary-custom"><i class="fas fa-sync"></i> Scan PPPoE</button>
                <button id="btnRefresh" class="btn btn-light"><i class="fas fa-list"></i> Refresh</button>
              </div>
            </div>
          </div>

          <div class="row mb-4">
            <div class="col-md-3 mb-3"><div class="ao-metric"><span>Offline</span><strong id="metricOffline">0</strong><small>state pelanggan DB</small></div></div>
            <div class="col-md-3 mb-3"><div class="ao-metric"><span>Eligible</span><strong id="metricEligible">0</strong><small>sesuai rule aktif</small></div></div>
            <div class="col-md-3 mb-3"><div class="ao-metric"><span>Online</span><strong id="metricOnline">0</strong><small>kembali aktif</small></div></div>
            <div class="col-md-3 mb-3"><div class="ao-metric"><span>Ignored PPP</span><strong id="metricIgnored">0</strong><small>tidak ada di DB</small></div></div>
          </div>

          <div class="ao-grid">
            <div class="ao-card">
              <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-dark">Rule Deteksi dan Broadcast</h6></div>
              <div class="card-body">
                <form id="ruleForm">
                  <input type="hidden" id="ruleId" name="id">
                  <div class="form-row">
                    <div class="form-group col-md-8">
                      <label>Nama Rule</label>
                      <input class="form-control" name="name" value="Auto Outage Utama" required>
                    </div>
                    <div class="form-group col-md-4">
                      <label>Status</label>
                      <select class="form-control" name="enabled"><option value="true">Aktif</option><option value="false">Nonaktif</option></select>
                    </div>
                  </div>
                  <div class="form-row">
                    <div class="form-group col-md-4"><label>Router ID</label><input class="form-control" name="router_id" value="default"></div>
                    <div class="form-group col-md-4"><label>Offline Minimal (jam)</label><input type="number" min="1" class="form-control" name="offline_threshold_hours" value="3"></div>
                    <div class="form-group col-md-4"><label>Scan Interval (menit)</label><input type="number" min="5" class="form-control" name="scan_interval_minutes" value="30"></div>
                  </div>
                  <div class="form-row">
                    <div class="form-group col-md-4"><label>Cooldown Broadcast (menit)</label><input type="number" min="5" class="form-control" name="broadcast_cooldown_minutes" value="720"></div>
                    <div class="form-group col-md-4"><label>Maks Broadcast / Insiden</label><input type="number" min="1" class="form-control" name="max_broadcast_per_incident" value="1"></div>
                    <div class="form-group col-md-4">
                      <label>Target</label>
                      <select class="form-control" name="target_scope" id="targetScope">
                        <option value="all">Semua pelanggan DB</option>
                        <option value="area">Per Area</option>
                        <option value="odp">Per ODP</option>
                        <option value="profile">Per Profile</option>
                        <option value="router">Per Router</option>
                        <option value="custom">Custom JSON</option>
                      </select>
                    </div>
                  </div>
                  <div class="form-group">
                    <label>Filter Target JSON</label>
                    <textarea class="form-control" name="target_filter_json" rows="3" placeholder='{"area":"Area A"}'>{}</textarea>
                    <small class="text-muted">Contoh area: {"area":"Area A"}, ODP: {"odp":"ODP-01"}, profile: {"profile":"10M"}.</small>
                  </div>
                  <div class="form-group">
                    <label>Pesan Awal Custom</label>
                    <textarea class="form-control" name="template_initial" rows="4">Halo ${nama}, sistem kami mendeteksi koneksi PPPoE ${pppoe_username} tidak aktif sejak ${offline_since}. Apakah ada kendala pada WiFi-nya? Balas 1/AMAN jika aman, atau 2/ADA KENDALA jika butuh bantuan.</textarea>
                  </div>
                  <div class="form-group">
                    <label>Opsi Jawaban JSON</label>
                    <textarea class="form-control" name="options_json" rows="3">[{"key":"1","label":"Aman"},{"key":"2","label":"Ada kendala"},{"key":"lainnya","label":"Tulis keluhan bebas"}]</textarea>
                  </div>
                  <div class="d-flex flex-wrap" style="gap:.5rem;">
                    <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Simpan Rule</button>
                    <button type="button" id="btnDryRun" class="btn btn-info"><i class="fas fa-vial"></i> Dry Run</button>
                    <button type="button" id="btnBroadcast" class="btn btn-warning"><i class="fas fa-paper-plane"></i> Broadcast Eligible</button>
                  </div>
                </form>
              </div>
            </div>

            <div class="ao-card">
              <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-dark">Ringkasan Rule dan Scan</h6></div>
              <div class="card-body">
                <div id="rulesList" class="mb-3"><span class="text-muted">Memuat rule...</span></div>
                <pre id="lastResult" class="bg-light p-3 rounded" style="min-height:240px; max-height:420px; overflow:auto;">Belum ada proses.</pre>
              </div>
            </div>
          </div>

          <div class="ao-card mt-4">
            <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-dark">State Pelanggan</h6></div>
            <div class="card-body table-responsive">
              <table class="table table-bordered ao-table" id="statesTable">
                <thead><tr><th>Status</th><th>User ID</th><th>PPPoE</th><th>Router</th><th>Offline Since</th><th>Last Logout</th><th>Broadcast</th><th>Reason</th></tr></thead>
                <tbody></tbody>
              </table>
            </div>
          </div>

          <div class="ao-card mt-4 mb-4">
            <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-dark">Scan Logs</h6></div>
            <div class="card-body table-responsive">
              <table class="table table-bordered ao-table" id="logsTable">
                <thead><tr><th>Started</th><th>Router</th><th>DB Users</th><th>PPP Active</th><th>Offline</th><th>Skipped</th><th>Error</th></tr></thead>
                <tbody></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
  <script src="/js/sb-admin-2.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
  <script>
    const apiBase = '/api/admin/auto-outage';
    let currentRule = null;

    function asBool(value) { return value === true || value === 'true' || value === '1'; }
    function showResult(value) { document.getElementById('lastResult').textContent = JSON.stringify(value, null, 2); }
    function jsonField(form, name, fallback) {
      const raw = form.elements[name].value.trim();
      if (!raw) return fallback;
      return JSON.parse(raw);
    }
    async function request(path, options = {}) {
      const response = await fetch(apiBase + path, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Request gagal');
      return payload;
    }
    function rulePayload() {
      const form = document.getElementById('ruleForm');
      return {
        id: form.elements.id.value || undefined,
        name: form.elements.name.value,
        enabled: asBool(form.elements.enabled.value),
        router_id: form.elements.router_id.value || 'default',
        offline_threshold_hours: Number(form.elements.offline_threshold_hours.value || 3),
        scan_interval_minutes: Number(form.elements.scan_interval_minutes.value || 30),
        broadcast_cooldown_minutes: Number(form.elements.broadcast_cooldown_minutes.value || 720),
        max_broadcast_per_incident: Number(form.elements.max_broadcast_per_incident.value || 1),
        target_scope: form.elements.target_scope.value,
        target_filter_json: jsonField(form, 'target_filter_json', {}),
        template_initial: form.elements.template_initial.value,
        options_json: jsonField(form, 'options_json', []),
        auto_ticket_enabled: true
      };
    }
    function fillRule(rule) {
      if (!rule) return;
      currentRule = rule;
      const form = document.getElementById('ruleForm');
      form.elements.id.value = rule.id || '';
      form.elements.name.value = rule.name || 'Auto Outage Utama';
      form.elements.enabled.value = rule.enabled ? 'true' : 'false';
      form.elements.router_id.value = rule.router_id || 'default';
      form.elements.offline_threshold_hours.value = Math.max(1, Math.round((rule.offline_threshold_minutes || 180) / 60));
      form.elements.scan_interval_minutes.value = rule.scan_interval_minutes || 30;
      form.elements.broadcast_cooldown_minutes.value = rule.broadcast_cooldown_minutes || 720;
      form.elements.max_broadcast_per_incident.value = rule.max_broadcast_per_incident || 1;
      form.elements.target_scope.value = rule.target_scope || 'all';
      form.elements.target_filter_json.value = JSON.stringify(rule.target_filter_json || {}, null, 2);
      if (rule.template_initial) form.elements.template_initial.value = rule.template_initial;
      form.elements.options_json.value = JSON.stringify(rule.options_json || [], null, 2);
    }
    async function loadRules() {
      const payload = await request('/rules');
      const rules = payload.data.items || [];
      const box = document.getElementById('rulesList');
      box.innerHTML = rules.length ? '' : '<span class="text-muted">Belum ada rule. Simpan rule terlebih dahulu.</span>';
      rules.forEach((rule) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'btn btn-sm btn-outline-primary mr-2 mb-2';
        item.textContent = `${rule.enabled ? 'Aktif' : 'Nonaktif'} - ${rule.name}`;
        item.onclick = () => fillRule(rule);
        box.appendChild(item);
      });
      if (!currentRule && rules[0]) fillRule(rules[0]);
    }
    async function loadStates() {
      const payload = await request('/states?limit=200');
      const items = payload.data.items || [];
      const tbody = document.querySelector('#statesTable tbody');
      tbody.innerHTML = '';
      const counts = items.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {});
      document.getElementById('metricOffline').textContent = counts.offline || 0;
      document.getElementById('metricOnline').textContent = counts.online || 0;
      const escapeHtml = (value) => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      items.forEach((item) => {
        tbody.insertAdjacentHTML('beforeend', `<tr><td><span class="ao-pill">${escapeHtml(item.status || '-')}</span></td><td>${escapeHtml(item.user_id || '-')}</td><td>${escapeHtml(item.pppoe_username || '-')}</td><td>${escapeHtml(item.router_id || '-')}</td><td>${escapeHtml(item.offline_since || '-')}</td><td>${escapeHtml(item.last_logged_out || '-')}</td><td>${item.broadcast_count || 0}</td><td>${escapeHtml(item.last_detection_reason || '-')}</td></tr>`);
      });
    }
    async function loadLogs() {
      const payload = await request('/scan-logs?limit=20');
      const items = payload.data.items || [];
      const tbody = document.querySelector('#logsTable tbody');
      tbody.innerHTML = '';
      const latest = items[0];
      document.getElementById('metricIgnored').textContent = latest?.summary_json?.ignored_active_ppp || 0;
      const escapeHtml = (value) => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      items.forEach((item) => {
        tbody.insertAdjacentHTML('beforeend', `<tr><td>${escapeHtml(item.started_at || '-')}</td><td>${escapeHtml(item.router_id || '-')}</td><td>${item.total_db_users || 0}</td><td>${item.total_active_ppp || 0}</td><td>${item.total_offline_candidates || 0}</td><td>${item.total_skipped || 0}</td><td>${escapeHtml(item.error_message || '-')}</td></tr>`);
      });
    }
    async function refreshAll() { await Promise.all([loadRules(), loadStates(), loadLogs()]); }

    document.getElementById('ruleForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const payload = await request('/rules', { method: 'POST', body: JSON.stringify(rulePayload()) });
        fillRule(payload.data);
        showResult(payload);
        await loadRules();
        Swal.fire('Tersimpan', 'Rule auto outage berhasil disimpan.', 'success');
      } catch (error) { Swal.fire('Gagal', error.message, 'error'); }
    });
    document.getElementById('btnScan').onclick = async () => {
      try {
        const payload = await request('/scan', { method: 'POST', body: JSON.stringify({ router_id: document.querySelector('[name="router_id"]').value || 'default' }) });
        showResult(payload);
        await Promise.all([loadStates(), loadLogs()]);
        Swal.fire('Scan selesai', payload.message, 'success');
      } catch (error) { Swal.fire('Gagal scan', error.message, 'error'); }
    };
    document.getElementById('btnDryRun').onclick = async () => {
      try {
        const payload = await request('/dry-run', { method: 'POST', body: JSON.stringify(rulePayload()) });
        document.getElementById('metricEligible').textContent = payload.data.summary.total_eligible || 0;
        showResult(payload);
      } catch (error) { Swal.fire('Dry-run gagal', error.message, 'error'); }
    };
    document.getElementById('btnBroadcast').onclick = async () => {
      const confirm = await Swal.fire({ title: 'Broadcast pelanggan eligible?', text: 'Pesan akan dikirim hanya ke pelanggan DB yang offline dan lolos rule.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Kirim' });
      if (!confirm.isConfirmed) return;
      try {
        const payload = await request('/broadcast', { method: 'POST', body: JSON.stringify(rulePayload()) });
        showResult(payload);
        await loadStates();
        Swal.fire('Broadcast selesai', `${payload.data.summary.total_sent} pesan diproses.`, 'success');
      } catch (error) { Swal.fire('Broadcast gagal', error.message, 'error'); }
    };
    document.getElementById('btnRefresh').onclick = refreshAll;
    refreshAll().catch((error) => showResult({ error: error.message }));
  </script>
</body>
</html>
