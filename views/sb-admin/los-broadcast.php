<?php
/**
 * Header Doc
 * Purpose: Halaman admin konfigurasi & monitoring auto-broadcast LOS (fiber putus) ke teknisi.
 * Caller: `routes/pages.js` pada path `/los-broadcast`.
 * Deps: `_navbar.php`, `topbar.php`, API `/api/admin/los-broadcast/*`, Bootstrap, jQuery, SweetAlert2.
 * MainFuncs: Render form config, kartu runtime-state, tabel insiden LOS.
 * SideEffects: Memanggil API admin untuk membaca/menyimpan config dan membaca insiden.
 */
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <?php
    $pageTitle = 'RAF BOT - LOS Broadcast';
    $themeRole = 'admin';
    $pageDescription = 'RAF BOT LOS Broadcast';
    include __DIR__ . '/_head.php';
    ?>

  <style>
    .los-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .los-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 4px 16px rgba(15,23,42,0.05); }
    .los-card .card-header { background: transparent; border-bottom: 1px solid #e5e7eb; }
    /* Metrik ringkas + warna semantik (pending=amber, broadcast=merah, pulih=hijau, low-conf=slate) */
    .los-metric { border-radius: 12px; padding: .8rem .95rem; color:#fff; min-height: 74px; box-shadow: 0 4px 14px rgba(15,23,42,.10); }
    .los-metric span { opacity:.92; font-size:.76rem; display:block; line-height:1.2; }
    .los-metric strong { font-size: 1.55rem; display:block; line-height:1.1; margin:.06rem 0; }
    .los-metric small { opacity:.8; font-size:.66rem; }
    .m-pending { background: linear-gradient(135deg,#b45309,#78350f); }
    .m-bc { background: linear-gradient(135deg,#b91c1c,#7f1d1d); }
    .m-rec { background: linear-gradient(135deg,#15803d,#14532d); }
    .m-low { background: linear-gradient(135deg,#475569,#1e293b); }
    /* Catatan collapsible — hemat ruang di HP */
    .los-note { border:1px solid #e5e7eb; border-radius:12px; padding:.55rem .9rem; font-size:.85rem; }
    .los-note summary { cursor:pointer; font-weight:600; outline:none; list-style:none; }
    .los-note summary::-webkit-details-marker { display:none; }
    .los-note[open] summary { margin-bottom:.45rem; }
    .los-table { font-size: .84rem; }
    .badge-status { font-size: .72rem; padding: .3rem .55rem; border-radius: 999px; }
    .st-broadcasted { background:#fee2e2; color:#991b1b; }
    .st-pending { background:#fef9c3; color:#854d0e; }
    .st-recovered_before_broadcast { background:#dcfce7; color:#166534; }
    .st-low_confidence { background:#e0e7ff; color:#3730a3; }
    .st-no_recipients { background:#f3f4f6; color:#374151; }
    @media (max-width: 991px) { .los-grid { grid-template-columns: 1fr; } }
    @media (max-width: 575px) {
      .los-metric { min-height: 66px; padding:.65rem .8rem; }
      .los-metric strong { font-size: 1.4rem; }
    }
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
                <h1>LOS Auto-Broadcast ke Teknisi</h1>
                <p class="mb-0">Begitu OLT melaporkan <strong>LOS (fiber putus)</strong> — bukan mati listrik — sistem otomatis mengabari <strong>teknisi</strong> setelah window konfirmasi.</p>
              </div>
              <div class="d-flex flex-wrap" style="gap:.5rem;">
                <button id="btnRefresh" class="btn btn-light"><i class="fas fa-sync"></i> Refresh</button>
              </div>
            </div>
          </div>

          <details class="los-note mb-3">
            <summary><i class="fas fa-info-circle text-info mr-1"></i>Apa bedanya dengan Auto Outage?</summary>
            <div class="text-muted mt-1">Halaman ini berbasis <em>layer optik OLT</em> &amp; hanya memicu untuk <strong>LOS (fiber putus)</strong> → ke <strong>teknisi</strong> untuk respons cepat. <em>Auto Outage</em> berbasis PPPoE MikroTik &amp; ambang waktu → ke <strong>pelanggan</strong>.</div>
          </details>

          <div class="row mb-3">
            <div class="col-6 col-md-3 mb-3"><div class="los-metric m-pending"><span>Pending Konfirmasi</span><strong id="metricPending">0</strong><small>menunggu window</small></div></div>
            <div class="col-6 col-md-3 mb-3"><div class="los-metric m-bc"><span>Broadcasted (24j)</span><strong id="metricBroadcasted">0</strong><small>terkirim ke teknisi</small></div></div>
            <div class="col-6 col-md-3 mb-3"><div class="los-metric m-rec"><span>Recovered</span><strong id="metricRecovered">0</strong><small>pulih sblm broadcast</small></div></div>
            <div class="col-6 col-md-3 mb-3"><div class="los-metric m-low"><span>Skipped Low-Conf</span><strong id="metricLowConf">0</strong><small>keyakinan rendah</small></div></div>
          </div>

          <div class="los-grid">
            <div class="los-card">
              <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-dark">Konfigurasi</h6></div>
              <div class="card-body">
                <form id="cfgForm">
                  <div class="form-row">
                    <div class="form-group col-md-6">
                      <label>Status Fitur</label>
                      <select class="form-control" name="enabled"><option value="true">Aktif</option><option value="false">Nonaktif</option></select>
                    </div>
                    <div class="form-group col-md-6">
                      <label>Ambang Keyakinan (0–1)</label>
                      <input type="number" step="0.05" min="0" max="1" class="form-control" name="confidenceThreshold" value="0.6">
                      <small class="text-muted">Tingkat keyakinan sistem bahwa ini benar LOS (fiber), bukan dying-gasp.</small>
                    </div>
                  </div>
                  <details class="los-note mb-3" style="font-size:.82rem;">
                    <summary><i class="fas fa-question-circle text-info mr-1"></i>Arti "Ambang Keyakinan" (0–1)</summary>
                    <div class="text-muted mt-1">
                      Setiap LOS diberi skor keyakinan oleh sistem:
                      <ul class="mb-1 mt-1 pl-3">
                        <li><strong>1.0</strong> = sangat yakin fiber putus (mis. rxPower menurun).</li>
                        <li><strong>0.6</strong> = cukup yakin (default — LOS tanpa dying-gasp).</li>
                        <li><strong>&lt; 0.6</strong> = ragu → <em>tidak</em> auto-broadcast (<code>low_confidence</code>).</li>
                      </ul>
                      Naikkan (0.8) = lebih hati-hati; turunkan (0.5) = lebih sensitif.
                    </div>
                  </details>
                  <div class="form-row">
                    <div class="form-group col-md-6">
                      <label>Window Konfirmasi (menit)</label>
                      <input type="number" min="1" max="60" class="form-control" name="confirmationWindowMinutes" value="3">
                      <small class="text-muted">Tunggu sekian menit; jika ONU pulih (Discovery) → broadcast dibatalkan.</small>
                    </div>
                    <div class="form-group col-md-6">
                      <label>Jeda Anti-Kedip / Flapping (menit)</label>
                      <input type="number" min="1" max="720" class="form-control" name="rebroadcastCooldownMinutes" value="30">
                      <small class="text-muted"><strong>Bukan pengulangan broadcast.</strong> 1 insiden = 1 broadcast. Ini hanya mencegah modem yang turun-naik-turun cepat memicu alert berkali-kali dalam jeda ini.</small>
                    </div>
                  </div>
                  <div class="form-row">
                    <div class="form-group col-md-6">
                      <label>Jeda Agregasi Cluster (detik)</label>
                      <input type="number" min="1" max="300" class="form-control" name="clusterFlushSeconds" value="20">
                      <small class="text-muted">LOS yang terkonfirmasi dalam jeda ini digabung jadi 1 pesan.</small>
                    </div>
                    <div class="form-group col-md-6">
                      <label>Ambang "Gangguan Area" (jumlah ONU)</label>
                      <input type="number" min="2" max="100" class="form-control" name="clusterThreshold" value="3">
                      <small class="text-muted">≥ nilai ini dalam 1 OLT → framing dugaan gangguan area/uplink.</small>
                    </div>
                  </div>
                  <hr>
                  <div class="alert alert-primary" style="font-size:.82rem; border-radius:10px;">
                    <i class="fas fa-users"></i> <strong>Kirim alarm LOS ke GRUP WhatsApp</strong> (grup khusus alarm OLT). <em>Dying-Gasp / mati listrik TIDAK dikirim ke grup</em> — hanya LOS (fiber putus).
                  </div>
                  <div class="form-row">
                    <div class="form-group col-md-4">
                      <label>Kirim ke Grup</label>
                      <select class="form-control" name="notifyGroup"><option value="false">Nonaktif</option><option value="true">Aktif</option></select>
                    </div>
                    <div class="form-group col-md-8">
                      <label>Grup Alarm OLT</label>
                      <div class="input-group">
                        <select class="form-control" name="groupId" id="groupIdSelect"><option value="">— pilih grup —</option></select>
                        <div class="input-group-append">
                          <button type="button" class="btn btn-outline-secondary" id="btnLoadGroups"><i class="fas fa-sync"></i> Muat Grup</button>
                        </div>
                      </div>
                      <small class="text-muted">Klik "Muat Grup" untuk mengambil daftar grup tempat bot menjadi anggota.</small>
                    </div>
                  </div>
                  <div class="form-row">
                    <div class="form-group col-md-6">
                      <label>Juga japri tiap teknisi?</label>
                      <select class="form-control" name="notifyTeknisi"><option value="true">Ya</option><option value="false">Tidak (cukup grup)</option></select>
                      <small class="text-muted">Bila sudah pakai grup, biasanya "Tidak" sudah cukup.</small>
                    </div>
                  </div>
                  <hr>
                  <div class="alert alert-success" style="font-size:.82rem; border-radius:10px;">
                    <i class="fas fa-headset"></i> <strong>Auto-Tiket Teknisi</strong> — saat LOS <em>terkonfirmasi</em> (fiber putus), sistem otomatis membuat tiket &amp; meng-assign ke teknisi. Tiket <strong>otomatis dibatalkan</strong> bila ONU pulih sebelum ditangani. Notifikasi tiket mengikuti pengaturan grup/japri di atas.
                  </div>
                  <div class="form-row">
                    <div class="form-group col-md-4">
                      <label>Buat Tiket Otomatis</label>
                      <select class="form-control" name="autoTicketEnabled"><option value="false">Nonaktif</option><option value="true">Aktif</option></select>
                    </div>
                    <div class="form-group col-md-4">
                      <label>Assign ke Teknisi</label>
                      <input type="text" class="form-control" name="autoTicketAssignTeknisi" placeholder="(otomatis — beban paling ringan)">
                      <small class="text-muted">Kosongkan = auto ke teknisi dengan tiket terbuka paling sedikit. Isi <em>username</em> teknisi untuk memaksa.</small>
                    </div>
                    <div class="form-group col-md-4">
                      <label>Prioritas Tiket</label>
                      <select class="form-control" name="autoTicketPriority"><option value="HIGH">Tinggi (URGENT)</option><option value="MEDIUM">Sedang (NORMAL)</option></select>
                    </div>
                  </div>
                  <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Simpan Konfigurasi</button>
                </form>
              </div>
            </div>

            <div class="los-card">
              <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-dark">Runtime &amp; Penerima</h6></div>
              <div class="card-body">
                <p class="mb-2"><strong>Penerima:</strong> seluruh akun ber-role <code>teknisi</code> yang punya nomor WhatsApp.</p>
                <p class="mb-2"><strong>Pengiriman:</strong> via <code>sendCritical</code> (retry + dead-letter) agar tidak hilang saat WA sedang reconnect.</p>
                <hr>
                <p class="mb-1"><strong>LOS sedang pending:</strong> <span id="statePendingCount">0</span></p>
                <pre id="statePendingMacs" class="bg-light p-2 rounded" style="min-height:60px; max-height:160px; overflow:auto;">-</pre>
                <p class="mb-1"><strong>Insiden aktif (sudah broadcast, belum pulih):</strong> <span id="stateActiveCount">0</span></p>
                <p class="text-muted mb-0"><small>Timer in-memory: jika proses restart saat window berjalan, insiden tetap tercatat untuk review manual.</small></p>
              </div>
            </div>
          </div>

          <div class="los-card mt-4">
            <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-dark"><i class="fas fa-user-clock"></i> Notifikasi Otomatis ke Pelanggan</h6></div>
            <div class="card-body">
              <p class="text-muted">Setelah teknisi diberi tahu, sistem bisa otomatis memberi tahu <strong>pelanggan</strong> bahwa koneksinya terdeteksi putus — <em>setelah jeda tertentu</em> (mis. 1 jam), dan <strong>hanya jika modem masih belum pulih</strong>.</p>
              <form id="custForm">
                <div class="form-row">
                  <div class="form-group col-md-4">
                    <label>Status</label>
                    <select class="form-control" name="notifyCustomerEnabled"><option value="false">Nonaktif</option><option value="true">Aktif</option></select>
                  </div>
                  <div class="form-group col-md-4">
                    <label>Jeda Setelah Teknisi (menit)</label>
                    <input type="number" min="1" max="1440" class="form-control" name="customerNotifyDelayMinutes" value="60">
                    <small class="text-muted">Default 60 = 1 jam.</small>
                  </div>
                  <div class="form-group col-md-4">
                    <label>Hanya jika masih putus?</label>
                    <select class="form-control" name="customerOnlyIfStillDown"><option value="true">Ya (disarankan)</option><option value="false">Tetap kirim</option></select>
                    <small class="text-muted">"Ya" → batal kirim bila modem sudah pulih sebelum jeda.</small>
                  </div>
                </div>
                <div class="form-group">
                  <label>Template Pesan ke Pelanggan</label>
                  <textarea class="form-control" name="customerMessageTemplate" rows="6"></textarea>
                  <small class="text-muted">Placeholder: <code>{customer_name}</code>, <code>{address}</code>, <code>{mac}</code>, <code>{slot}</code>, <code>{onu}</code>, <code>{company_name}</code>.</small>
                </div>
                <div class="alert alert-warning" style="font-size:.82rem;">
                  <i class="fas fa-exclamation-triangle"></i> Pelanggan hanya bisa dinotifikasi bila MAC ONU bisa dipetakan ke data pelanggan (mis. nomor WA tersimpan). Jika tidak teridentifikasi, insiden ditandai <code>customer_unresolved</code> agar admin bisa info manual.
                </div>
                <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Simpan Notifikasi Pelanggan</button>
              </form>
            </div>
          </div>

          <div class="los-card mt-4 mb-4">
            <div class="card-header py-3 d-flex justify-content-between align-items-center">
              <h6 class="m-0 font-weight-bold text-dark">Riwayat Insiden LOS</h6>
              <select id="statusFilter" class="form-control form-control-sm" style="width:auto;">
                <option value="">Semua status</option>
                <option value="broadcasted">Broadcasted</option>
                <option value="pending">Pending</option>
                <option value="recovered_before_broadcast">Recovered</option>
                <option value="low_confidence">Low confidence</option>
                <option value="no_recipients">No recipients</option>
              </select>
            </div>
            <div class="card-body table-responsive">
              <table class="table table-bordered los-table" id="incidentsTable">
                <thead><tr><th>Terdeteksi</th><th>Status</th><th>MAC</th><th>Slot/ONU</th><th>OLT</th><th>Pelanggan</th><th>Conf</th><th>Area?</th><th>Terkirim</th><th>Notif Pelanggan</th></tr></thead>
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
    const apiBase = '/api/admin/los-broadcast';
    function asBool(v) { return v === true || v === 'true' || v === '1'; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

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

    function fillConfig(cfg) {
      const f = document.getElementById('cfgForm');
      f.elements.enabled.value = cfg.enabled ? 'true' : 'false';
      f.elements.confidenceThreshold.value = cfg.confidenceThreshold;
      f.elements.confirmationWindowMinutes.value = cfg.confirmationWindowMinutes;
      f.elements.rebroadcastCooldownMinutes.value = cfg.rebroadcastCooldownMinutes;
      f.elements.clusterFlushSeconds.value = cfg.clusterFlushSeconds;
      f.elements.clusterThreshold.value = cfg.clusterThreshold;
      f.elements.notifyGroup.value = cfg.notifyGroup ? 'true' : 'false';
      f.elements.notifyTeknisi.value = (cfg.notifyTeknisi === false) ? 'false' : 'true';
      // Auto-tiket
      const at = cfg.autoTicket || {};
      f.elements.autoTicketEnabled.value = at.enabled ? 'true' : 'false';
      f.elements.autoTicketAssignTeknisi.value = at.assignTeknisi || '';
      f.elements.autoTicketPriority.value = (at.priority === 'MEDIUM') ? 'MEDIUM' : 'HIGH';
      setGroupSelect(cfg.groupId || '');
      // Notifikasi pelanggan
      const nc = cfg.notifyCustomer || {};
      const c = document.getElementById('custForm');
      c.elements.notifyCustomerEnabled.value = nc.enabled ? 'true' : 'false';
      c.elements.customerNotifyDelayMinutes.value = nc.delayMinutes != null ? nc.delayMinutes : 60;
      c.elements.customerOnlyIfStillDown.value = (nc.onlyIfStillDown === false) ? 'false' : 'true';
      c.elements.customerMessageTemplate.value = nc.messageTemplate || '';
    }
    // Endpoint /config mengganti SELURUH config, jadi payload selalu gabungan kedua form.
    function configPayload() {
      const f = document.getElementById('cfgForm');
      const c = document.getElementById('custForm');
      return {
        enabled: asBool(f.elements.enabled.value),
        confidenceThreshold: Number(f.elements.confidenceThreshold.value),
        confirmationWindowMinutes: Number(f.elements.confirmationWindowMinutes.value),
        rebroadcastCooldownMinutes: Number(f.elements.rebroadcastCooldownMinutes.value),
        clusterFlushSeconds: Number(f.elements.clusterFlushSeconds.value),
        clusterThreshold: Number(f.elements.clusterThreshold.value),
        notifyGroup: asBool(f.elements.notifyGroup.value),
        groupId: f.elements.groupId.value,
        notifyTeknisi: asBool(f.elements.notifyTeknisi.value),
        autoTicketEnabled: asBool(f.elements.autoTicketEnabled.value),
        autoTicketAssignTeknisi: f.elements.autoTicketAssignTeknisi.value,
        autoTicketPriority: f.elements.autoTicketPriority.value,
        notifyCustomerEnabled: asBool(c.elements.notifyCustomerEnabled.value),
        customerNotifyDelayMinutes: Number(c.elements.customerNotifyDelayMinutes.value),
        customerOnlyIfStillDown: asBool(c.elements.customerOnlyIfStillDown.value),
        customerMessageTemplate: c.elements.customerMessageTemplate.value
      };
    }

    async function loadConfig() {
      const payload = await request('/config');
      fillConfig(payload.data);
    }
    async function loadState() {
      const payload = await request('/state');
      const s = payload.data || {};
      document.getElementById('statePendingCount').textContent = s.pendingCount || 0;
      document.getElementById('metricPending').textContent = s.pendingCount || 0;
      document.getElementById('statePendingMacs').textContent = (s.pendingMacs && s.pendingMacs.length) ? s.pendingMacs.join('\n') : '-';
      const ac = document.getElementById('stateActiveCount');
      if (ac) ac.textContent = s.activeIncidentCount || 0;
    }
    async function loadIncidents() {
      const status = document.getElementById('statusFilter').value;
      const payload = await request('/incidents?limit=200' + (status ? '&status=' + encodeURIComponent(status) : ''));
      const items = payload.data.items || [];
      const tbody = document.querySelector('#incidentsTable tbody');
      tbody.innerHTML = '';
      const dayAgo = Date.now() - 24 * 3600 * 1000;
      let bc = 0, rec = 0, low = 0;
      items.forEach((it) => {
        const t = it.detectedAt ? new Date(it.detectedAt) : null;
        if (it.status === 'broadcasted' && t && t.getTime() >= dayAgo) bc++;
        if (it.status === 'recovered_before_broadcast') rec++;
        if (it.status === 'low_confidence') low++;
        const cust = it.customer ? (it.customer.name || '-') + (it.customer.address ? ' — ' + it.customer.address : '') : '-';
        const slotOnu = (it.slot != null || it.onu != null) ? esc(it.slot) + '/' + esc(it.onu) : '-';
        const delivered = (it.deliveredCount != null && it.recipientsCount != null) ? (it.deliveredCount + '/' + it.recipientsCount) : '-';
        const cnotif = it.customerNotifyStatus || '-';
        tbody.insertAdjacentHTML('beforeend',
          `<tr><td>${esc(it.detectedAt)}</td>`
          + `<td><span class="badge-status st-${esc(it.status)}">${esc(it.status)}</span></td>`
          + `<td>${esc(it.mac)}</td><td>${slotOnu}</td><td>${esc(it.oltId)}</td>`
          + `<td>${esc(cust)}</td><td>${it.confidence != null ? esc(it.confidence) : '-'}</td>`
          + `<td>${it.areaOutage ? 'Ya' : '-'}</td><td>${esc(delivered)}</td><td>${esc(cnotif)}</td></tr>`);
      });
      document.getElementById('metricBroadcasted').textContent = bc;
      document.getElementById('metricRecovered').textContent = rec;
      document.getElementById('metricLowConf').textContent = low;
    }
    async function refreshAll() {
      await Promise.all([loadConfig(), loadState(), loadIncidents()]);
    }

    async function saveConfig(successMsg) {
      try {
        await request('/config', { method: 'POST', body: JSON.stringify(configPayload()) });
        Swal.fire('Tersimpan', successMsg, 'success');
        await loadConfig();
      } catch (err) { Swal.fire('Gagal', err.message, 'error'); }
    }
    async function loadGroups() {
      const sel = document.getElementById('groupIdSelect');
      const cur = sel.value;
      const btn = document.getElementById('btnLoadGroups');
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memuat…';
      try {
        const res = await fetch('/api/whatsapp/groups', { credentials: 'include' });
        const json = await res.json();
        if (!json.success || !Array.isArray(json.groups)) throw new Error(json.message || 'Bot WhatsApp belum terkoneksi.');
        sel.innerHTML = '<option value="">— pilih grup —</option>';
        json.groups.forEach((g) => {
          const opt = document.createElement('option');
          opt.value = g.id; opt.textContent = g.subject + (g.size != null ? ' (' + g.size + ' anggota)' : '');
          sel.appendChild(opt);
        });
        if (cur && Array.prototype.some.call(sel.options, (o) => o.value === cur)) sel.value = cur;
        Swal.fire({ icon: 'success', title: 'Grup dimuat', text: json.groups.length + ' grup ditemukan.', timer: 1500, showConfirmButton: false });
      } catch (e) {
        Swal.fire('Gagal memuat grup', e.message, 'error');
      } finally {
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync"></i> Muat Grup';
      }
    }
    function setGroupSelect(groupId) {
      const sel = document.getElementById('groupIdSelect');
      if (!sel) return;
      if (groupId && !Array.prototype.some.call(sel.options, (o) => o.value === groupId)) {
        const opt = document.createElement('option');
        opt.value = groupId; opt.textContent = groupId + ' (tersimpan)';
        sel.appendChild(opt);
      }
      sel.value = groupId || '';
    }
    document.getElementById('btnLoadGroups').addEventListener('click', loadGroups);
    document.getElementById('cfgForm').addEventListener('submit', (e) => {
      e.preventDefault();
      saveConfig('Konfigurasi LOS broadcast berhasil disimpan.');
    });
    document.getElementById('custForm').addEventListener('submit', (e) => {
      e.preventDefault();
      saveConfig('Konfigurasi notifikasi pelanggan berhasil disimpan.');
    });
    document.getElementById('btnRefresh').onclick = () => refreshAll().catch((e) => Swal.fire('Gagal', e.message, 'error'));
    document.getElementById('statusFilter').onchange = () => loadIncidents().catch(() => {});
    refreshAll().catch((e) => Swal.fire('Gagal memuat', e.message, 'error'));
    setInterval(() => { loadState().catch(() => {}); loadIncidents().catch(() => {}); }, 30000);
  </script>
</body>
</html>
