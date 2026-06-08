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
    .los-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 12px 30px rgba(15,23,42,0.06); }
    .los-card .card-header { background: transparent; border-bottom: 1px solid #e5e7eb; }
    .los-metric { border-radius: 12px; padding: 1rem; background: linear-gradient(135deg, #b91c1c, #7f1d1d); color: #fff; min-height: 100px; }
    .los-metric strong { font-size: 1.8rem; display: block; }
    .los-table { font-size: .84rem; }
    .badge-status { font-size: .72rem; padding: .3rem .55rem; border-radius: 999px; }
    .st-broadcasted { background:#fee2e2; color:#991b1b; }
    .st-pending { background:#fef9c3; color:#854d0e; }
    .st-recovered_before_broadcast { background:#dcfce7; color:#166534; }
    .st-low_confidence { background:#e0e7ff; color:#3730a3; }
    .st-no_recipients { background:#f3f4f6; color:#374151; }
    @media (max-width: 991px) { .los-grid { grid-template-columns: 1fr; } }
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
                <p>Saat OLT mendeteksi <strong>LOS (sinyal optik hilang = kemungkinan fiber putus)</strong> — <em>bukan</em> dying-gasp / mati listrik — sistem otomatis broadcast ke seluruh teknisi setelah konfirmasi window.</p>
              </div>
              <div class="d-flex flex-wrap" style="gap:.5rem;">
                <button id="btnRefresh" class="btn btn-light"><i class="fas fa-sync"></i> Refresh</button>
              </div>
            </div>
          </div>

          <div class="alert alert-info" role="alert" style="border-radius:12px;">
            <i class="fas fa-info-circle"></i>
            <strong>Bedanya dengan Auto Outage:</strong> halaman ini berbasis <em>layer optik OLT</em> dan hanya memicu untuk <strong>LOS (fiber)</strong>, ditujukan ke <strong>teknisi</strong> untuk respons cepat. Auto Outage berbasis PPPoE MikroTik &amp; ambang waktu, ditujukan ke pelanggan.
          </div>

          <div class="row mb-4">
            <div class="col-md-3 mb-3"><div class="los-metric"><span>Pending Konfirmasi</span><strong id="metricPending">0</strong><small>menunggu window</small></div></div>
            <div class="col-md-3 mb-3"><div class="los-metric"><span>Broadcasted (24j)</span><strong id="metricBroadcasted">0</strong><small>terkirim ke teknisi</small></div></div>
            <div class="col-md-3 mb-3"><div class="los-metric"><span>Recovered</span><strong id="metricRecovered">0</strong><small>pulih sebelum broadcast</small></div></div>
            <div class="col-md-3 mb-3"><div class="los-metric"><span>Skipped Low-Conf</span><strong id="metricLowConf">0</strong><small>keyakinan rendah</small></div></div>
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
                  <div class="alert alert-light border" style="font-size:.82rem;">
                    <strong>Arti "Ambang Keyakinan" (0–1):</strong> setiap LOS diberi skor keyakinan oleh sistem.
                    <ul class="mb-1 mt-1 pl-3">
                      <li><strong>1.0</strong> = sangat yakin LOS/fiber putus (mis. ada bukti rxPower menurun).</li>
                      <li><strong>0.6</strong> = cukup yakin (default — LOS tanpa dying-gasp).</li>
                      <li><strong>&lt; 0.6</strong> = ragu → <em>tidak</em> auto-broadcast (dicatat sebagai <code>low_confidence</code>).</li>
                    </ul>
                    Naikkan (mis. 0.8) bila ingin lebih hati-hati (lebih sedikit panggilan teknisi, risiko ada yang terlewat).
                    Turunkan (mis. 0.5) bila ingin lebih sensitif (lebih banyak alert, risiko false-alarm).
                  </div>
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
