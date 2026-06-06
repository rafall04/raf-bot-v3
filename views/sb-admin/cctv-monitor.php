<?php
/**
 * Header Doc
 * Purpose: Halaman admin CRUD daftar CCTV publik + status monitor + log insiden auto-broadcast.
 * Caller: `routes/pages.js` pada path `/cctv-monitor`.
 * Deps: `_navbar.php`, `topbar.php`, API `/api/cctv/*`, admin-theme.css (auto dark mode).
 * MainFuncs: render tabel CCTV + modal tambah/edit + tabel insiden + kartu status.
 */
?>
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
  <title>RAF BOT - Monitor CCTV</title>
  <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="/css/sb-admin-2.min.css" rel="stylesheet">
  <link href="/css/admin-theme.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">
  <style>
    .cctv-kpi { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; margin-bottom: 1rem; }
    @media (max-width: 575.98px) { .cctv-kpi { grid-template-columns: repeat(2, 1fr); } }
    .cctv-kpi .stat { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 0.85rem 1rem; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
    .cctv-kpi .stat .label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 600; }
    .cctv-kpi .stat .value { font-size: 1.6rem; font-weight: 700; line-height: 1.2; }
    .cctv-kpi .stat .value.up { color: #16a34a; } .cctv-kpi .stat .value.down { color: #dc2626; }
    .cctv-kpi .stat .value.pending { color: #d97706; } .cctv-kpi .stat .value.total { color: #4f46e5; }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
    .status-dot.up { background: #16a34a; box-shadow: 0 0 0 3px rgba(22,163,74,0.18); }
    .status-dot.down { background: #dc2626; box-shadow: 0 0 0 3px rgba(220,38,38,0.18); }
    .status-dot.unknown { background: #9ca3af; }
    .cctv-host { font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 0.85rem; color: #4b5563; }
    body.tk-dark .cctv-kpi .stat { background: var(--d-surface); border-color: var(--d-line); }
    body.tk-dark .cctv-kpi .stat .label { color: var(--d-ink-soft); }
    body.tk-dark .cctv-host { color: var(--d-ink-soft); }
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
              <h1>Monitor CCTV Publik</h1>
              <p>Auto-broadcast WhatsApp ke pelanggan ketika CCTV mati > <span id="windowLabel">window</span> menit.</p>
            </div>
            <button class="btn btn-primary-custom" id="addCctvBtn"><i class="fas fa-plus"></i> Tambah CCTV</button>
          </div>
        </div>

        <div id="alertBox" class="alert alert-info" style="display:none;"></div>

        <div class="cctv-kpi">
          <div class="stat"><div class="label">Terdaftar</div><div class="value total" id="kpiTotal">-</div></div>
          <div class="stat"><div class="label">Online</div><div class="value up" id="kpiUp">-</div></div>
          <div class="stat"><div class="label">Mati</div><div class="value down" id="kpiDown">-</div></div>
          <div class="stat"><div class="label">Menunggu Konfirmasi</div><div class="value pending" id="kpiPending">-</div></div>
        </div>

        <div class="card shadow mb-4">
          <div class="card-header py-3 d-flex justify-content-between align-items-center">
            <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-video"></i> Daftar CCTV</h6>
            <small class="text-muted"><span id="monitorPill" class="badge badge-secondary">monitor:?</span> Update: <span id="lastUpdate">-</span></small>
          </div>
          <div class="card-body">
            <div class="table-responsive">
              <table class="table table-bordered table-hover" id="cctvTable" width="100%">
                <thead class="thead-light">
                  <tr><th>Nama</th><th>IP</th><th>Pelanggan</th><th>Status</th><th>Window</th><th>Aksi</th></tr>
                </thead>
                <tbody></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Modal Tambah/Edit -->
<div class="modal fade" id="cctvModal" tabindex="-1">
  <div class="modal-dialog">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title" id="cctvModalTitle">Tambah CCTV</h5>
        <button type="button" class="close" data-dismiss="modal"><span>&times;</span></button>
      </div>
      <div class="modal-body">
        <form id="cctvForm">
          <input type="hidden" id="cctv_id">
          <div class="form-group">
            <label>Nama CCTV <span class="text-danger">*</span></label>
            <input class="form-control" id="cctv_name" required placeholder="CCTV Pasar Depan">
          </div>
          <div class="form-group">
            <label>IP CCTV <span class="text-danger">*</span></label>
            <input class="form-control" id="cctv_host" required placeholder="192.168.99.10">
            <small class="form-text text-muted">Pastikan IP ini sudah ada di MikroTik /tool/netwatch.</small>
          </div>
          <div class="form-group">
            <label>Nomor WA Pelanggan <span class="text-danger">*</span></label>
            <input class="form-control" id="cctv_phone" required placeholder="6281234567890 (pisah | untuk multi)">
          </div>
          <div class="form-group">
            <label>Nama Pelanggan (opsional)</label>
            <input class="form-control" id="cctv_customer">
            <small class="form-text text-muted">Dipakai di pesan ({customer_name}).</small>
          </div>
          <div class="form-group">
            <label>Window Konfirmasi (menit, opsional)</label>
            <input type="number" class="form-control" id="cctv_window" placeholder="kosong = pakai default global">
            <small class="form-text text-muted">Setelah X menit terus mati baru broadcast. Anti-flap PLN-blink.</small>
          </div>
          <div class="form-group">
            <label>Template Pesan Khusus (opsional)</label>
            <textarea class="form-control" id="cctv_message" rows="3" placeholder="Kosongkan untuk pakai template default. Variabel: {customer_name}, {cctv_name}, {cctv_host}, {since_local}, {minutes_down}"></textarea>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="checkbox" id="cctv_enabled" checked>
            <label class="form-check-label" for="cctv_enabled">Aktif (dipantau)</label>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-dismiss="modal">Batal</button>
        <button class="btn btn-primary" id="cctvSaveBtn">Simpan</button>
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
  let devicesCache = []; let statusCache = null; let refreshTimer = null;

  $(document).ready(() => {
    loadAll();
    refreshTimer = setInterval(loadStatusOnly, 30000);
    $('#addCctvBtn').on('click', openAdd);
    $('#cctvSaveBtn').on('click', save);
    $(document).on('click', '.btn-edit-cctv', function () { openEdit($(this).data('id')); });
    $(document).on('click', '.btn-del-cctv', function () { confirmDelete($(this).data('id'), $(this).data('name')); });
  });

  async function loadAll() {
    await Promise.all([loadDevices(), loadStatusOnly()]);
    render();
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

  function statusOf(host) {
    if (!statusCache || !Array.isArray(statusCache.devices)) return null;
    return statusCache.devices.find(d => d.host === (host || '').toLowerCase());
  }

  function render() {
    const tb = $('#cctvTable tbody').empty();
    if (devicesCache.length === 0) {
      tb.append('<tr><td colspan="6" class="text-center text-muted">Belum ada CCTV terdaftar.</td></tr>');
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
      tb.append(`<tr>
        <td><strong>${escapeHtml(d.name)}</strong>${enabledBadge}</td>
        <td><span class="cctv-host">${escapeHtml(d.host)}</span></td>
        <td>${d.customerName ? escapeHtml(d.customerName) + '<br>' : ''}<small class="text-muted">${escapeHtml(d.phone || '')}</small></td>
        <td><span class="status-dot ${dot}"></span>${stLabel}</td>
        <td>${win}</td>
        <td>
          <button class="btn btn-sm btn-outline-primary btn-edit-cctv" data-id="${d.id}"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-outline-danger btn-del-cctv" data-id="${d.id}" data-name="${escapeHtml(d.name)}"><i class="fas fa-trash"></i></button>
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
    $('#cctvModal').modal('show');
  }
  function openEdit(id) {
    const d = devicesCache.find(x => x.id === id); if (!d) return;
    $('#cctvModalTitle').text('Edit CCTV');
    $('#cctv_id').val(d.id); $('#cctv_name').val(d.name); $('#cctv_host').val(d.host);
    $('#cctv_phone').val(d.phone); $('#cctv_customer').val(d.customerName || '');
    $('#cctv_window').val(d.confirmationMinutes || ''); $('#cctv_message').val(d.customMessage || '');
    $('#cctv_enabled').prop('checked', d.enabled !== false);
    $('#cctvModal').modal('show');
  }
  async function save() {
    const payload = {
      name: $('#cctv_name').val().trim(),
      host: $('#cctv_host').val().trim(),
      phone: $('#cctv_phone').val().trim(),
      customerName: $('#cctv_customer').val().trim(),
      confirmationMinutes: $('#cctv_window').val() ? Number($('#cctv_window').val()) : null,
      customMessage: $('#cctv_message').val().trim(),
      enabled: $('#cctv_enabled').is(':checked'),
    };
    if (!payload.name || !payload.host || !payload.phone) {
      Swal.fire('Lengkapi', 'Nama, IP, dan Nomor WA wajib diisi.', 'warning'); return;
    }
    const id = $('#cctv_id').val();
    const url = id ? `/api/cctv/devices/${id}` : '/api/cctv/devices';
    const method = id ? 'PUT' : 'POST';
    try {
      const r = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json());
      if (r.status === 200) {
        $('#cctvModal').modal('hide');
        Swal.fire({ icon: 'success', title: 'Tersimpan', timer: 1200, showConfirmButton: false });
        await loadAll();
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
          if (res.status === 200) { Swal.fire({ icon: 'success', title: 'Terhapus', timer: 1000, showConfirmButton: false }); loadAll(); }
          else Swal.fire('Gagal', res.message || 'Error', 'error');
        } catch (e) { Swal.fire('Gagal', e.message, 'error'); }
      });
  }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
</script>
</body>
</html>
