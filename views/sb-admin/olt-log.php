<?php
/**
 * Header Doc
 * Purpose: Halaman admin "Log Gangguan OLT" — riwayat kejadian OLT (LOS / Dying-Gasp / pulih)
 *          yang sudah di-ENRICH identitas pelanggan (nama/pppoe/HP/alamat) + durasi down→up.
 *          Baca dari log durable `olt_events.sqlite` (via API), bisa difilter.
 * Caller: `routes/pages.js` pada path `/olt-log`.
 * Deps: `_head.php`, `_navbar.php`, `topbar.php`, API `GET /api/olt/event-log`, Bootstrap, jQuery.
 * MainFuncs: Render filter bar, kartu ringkasan, tabel event OLT.
 * SideEffects: Memanggil API untuk membaca log event OLT.
 */
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'RAF BOT - Log Gangguan OLT';
    $themeRole = 'admin';
    $pageDescription = 'Riwayat kejadian OLT (LOS/Dying-Gasp/pulih) berikut pelanggan & durasi';
    include __DIR__ . '/_head.php';
    ?>
  <style>
    .olt-metric { border-radius: 12px; padding: 1rem; color: #fff; min-height: 92px; }
    .olt-metric span { opacity: .9; font-size: .82rem; }
    .olt-metric strong { font-size: 1.7rem; display: block; line-height: 1.1; }
    .m-total { background: linear-gradient(135deg,#334155,#0f172a); }
    .m-los { background: linear-gradient(135deg,#b91c1c,#7f1d1d); }
    .m-dg { background: linear-gradient(135deg,#b45309,#78350f); }
    .m-up { background: linear-gradient(135deg,#15803d,#14532d); }
    .olt-table { font-size: .84rem; }
    .olt-table td { vertical-align: middle; }
    .badge-ev { font-size: .72rem; padding: .3rem .55rem; border-radius: 999px; font-weight: 600; }
    .ev-los { background:#fee2e2; color:#991b1b; }
    .ev-dg { background:#fef3c7; color:#92400e; }
    .ev-discovery { background:#dcfce7; color:#166534; }
    .cust-name { font-weight: 600; }
    .cust-sub { font-size: .74rem; color: #6b7280; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .78rem; }
    .filter-bar { background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:1rem; }
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
                <h1>Log Gangguan OLT</h1>
                <p>Riwayat kejadian OLT — <strong>LOS</strong> (fiber putus), <strong>Dying-Gasp</strong> (mati listrik), dan <strong>pulih</strong> — lengkap dengan <strong>pelanggan</strong> yang terdampak &amp; <strong>durasi</strong> gangguannya.</p>
              </div>
              <div class="d-flex flex-wrap" style="gap:.5rem;">
                <button id="btnRefresh" class="btn btn-light"><i class="fas fa-sync"></i> Refresh</button>
              </div>
            </div>
          </div>

          <div class="row mb-3">
            <div class="col-6 col-md-3 mb-3"><div class="olt-metric m-total"><span>Total kejadian</span><strong id="mTotal">0</strong></div></div>
            <div class="col-6 col-md-3 mb-3"><div class="olt-metric m-los"><span>LOS (fiber)</span><strong id="mLos">0</strong></div></div>
            <div class="col-6 col-md-3 mb-3"><div class="olt-metric m-dg"><span>Dying-Gasp (listrik)</span><strong id="mDg">0</strong></div></div>
            <div class="col-6 col-md-3 mb-3"><div class="olt-metric m-up"><span>Pulih</span><strong id="mUp">0</strong></div></div>
          </div>

          <div class="filter-bar mb-3">
            <div class="form-row align-items-end">
              <div class="form-group col-md-3 mb-2">
                <label class="small mb-1">Cari pelanggan / PPPoE / HP / MAC</label>
                <input type="text" id="fq" class="form-control form-control-sm" placeholder="mis. mbah-uti / 0812 / d4:9e...">
              </div>
              <div class="form-group col-md-2 mb-2">
                <label class="small mb-1">Tipe</label>
                <select id="fType" class="form-control form-control-sm">
                  <option value="">Semua</option>
                  <option value="los">LOS (fiber)</option>
                  <option value="dying-gasp">Dying-Gasp</option>
                  <option value="discovery">Pulih</option>
                </select>
              </div>
              <div class="form-group col-md-2 mb-2">
                <label class="small mb-1">Dari tanggal</label>
                <input type="date" id="fFrom" class="form-control form-control-sm">
              </div>
              <div class="form-group col-md-2 mb-2">
                <label class="small mb-1">Sampai tanggal</label>
                <input type="date" id="fTo" class="form-control form-control-sm">
              </div>
              <div class="form-group col-md-3 mb-2 d-flex" style="gap:.5rem;">
                <button id="btnApply" class="btn btn-primary btn-sm flex-fill"><i class="fas fa-filter"></i> Terapkan</button>
                <button id="btnReset" class="btn btn-light btn-sm">Reset</button>
              </div>
            </div>
          </div>

          <div class="card shadow-sm" style="border-radius:14px;">
            <div class="card-header py-3 d-flex justify-content-between align-items-center">
              <h6 class="m-0 font-weight-bold text-dark">Riwayat Kejadian</h6>
              <small id="rowInfo" class="text-muted"></small>
            </div>
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-hover olt-table" id="oltTable">
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Tipe</th>
                      <th>Pelanggan</th>
                      <th>HP</th>
                      <th>Alamat</th>
                      <th>MAC / Port</th>
                      <th>Durasi down</th>
                    </tr>
                  </thead>
                  <tbody id="oltLogBody"><tr><td colspan="7" class="text-center text-muted py-4">Memuat…</td></tr></tbody>
                </table>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>

  <script>
    (function () {
      var tbody = document.getElementById('oltLogBody');

      function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
      }
      function fmtTime(iso) {
        if (!iso) return '-';
        try { return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' }); }
        catch (e) { return iso; }
      }
      function fmtDur(ms) {
        if (ms == null) return '—';
        var s = Math.round(ms / 1000);
        if (s < 60) return s + ' dtk';
        var m = Math.floor(s / 60);
        if (m < 60) return m + ' mnt';
        var h = Math.floor(m / 60), mm = m % 60;
        if (h < 24) return h + ' jam' + (mm ? ' ' + mm + ' mnt' : '');
        var d = Math.floor(h / 24), hh = h % 24;
        return d + ' hari' + (hh ? ' ' + hh + ' jam' : '');
      }
      function badge(type) {
        if (type === 'los') return '<span class="badge-ev ev-los">LOS</span>';
        if (type === 'dying-gasp') return '<span class="badge-ev ev-dg">Dying-Gasp</span>';
        if (type === 'discovery') return '<span class="badge-ev ev-discovery">Pulih</span>';
        return '<span class="badge-ev">' + esc(type) + '</span>';
      }
      function dayBounds(val, endOfDay) {
        if (!val) return undefined;
        var d = new Date(val + 'T00:00:00');
        if (isNaN(d.getTime())) return undefined;
        if (endOfDay) d.setHours(23, 59, 59, 999);
        return d.getTime();
      }

      function render(items) {
        if (!items || !items.length) {
          tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">Belum ada kejadian sesuai filter.</td></tr>';
          return;
        }
        var html = '';
        for (var i = 0; i < items.length; i++) {
          var r = items[i];
          var name = r.customer_name ? esc(r.customer_name) : '<span class="text-muted">(tak teridentifikasi)</span>';
          var sub = [];
          if (r.pppoe_username) sub.push(esc(r.pppoe_username));
          if (r.account_type && r.account_type !== 'pelanggan') sub.push(esc(r.account_type));
          var port = [];
          if (r.slot != null || r.onu != null) port.push('slot ' + esc(r.slot) + '/onu ' + esc(r.onu));
          if (r.olt_id) port.push('OLT ' + esc(r.olt_id));
          html += '<tr>'
            + '<td class="mono">' + esc(fmtTime(r.ts)) + '</td>'
            + '<td>' + badge(r.event_type) + '</td>'
            + '<td><div class="cust-name">' + name + '</div>' + (sub.length ? '<div class="cust-sub">' + sub.join(' · ') + '</div>' : '') + '</td>'
            + '<td>' + (r.phone ? esc(r.phone) : '—') + '</td>'
            + '<td>' + (r.address ? esc(r.address) : '—') + '</td>'
            + '<td><div class="mono">' + (r.mac ? esc(r.mac) : '—') + '</div>' + (port.length ? '<div class="cust-sub">' + port.join(' · ') + '</div>' : '') + '</td>'
            + '<td>' + (r.event_type === 'discovery' ? esc(fmtDur(r.duration_ms)) : '—') + '</td>'
            + '</tr>';
        }
        tbody.innerHTML = html;
      }

      function load() {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">Memuat…</td></tr>';
        var params = new URLSearchParams();
        var q = document.getElementById('fq').value.trim();
        var type = document.getElementById('fType').value;
        var from = dayBounds(document.getElementById('fFrom').value, false);
        var to = dayBounds(document.getElementById('fTo').value, true);
        if (q) params.set('q', q);
        if (type) params.set('type', type);
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        params.set('limit', '500');

        fetch('/api/olt/event-log?' + params.toString(), { credentials: 'same-origin' })
          .then(function (res) { return res.json(); })
          .then(function (j) {
            var data = (j && j.data) || {};
            var stats = data.stats || {};
            var byType = {};
            (stats.by_type || []).forEach(function (t) { byType[t.event_type] = t.count; });
            document.getElementById('mTotal').textContent = stats.total || 0;
            document.getElementById('mLos').textContent = byType['los'] || 0;
            document.getElementById('mDg').textContent = byType['dying-gasp'] || 0;
            document.getElementById('mUp').textContent = byType['discovery'] || 0;
            document.getElementById('rowInfo').textContent =
              (data.items ? data.items.length : 0) + ' baris ditampilkan · ' + (data.total || 0) + ' total · ' +
              (stats.distinct_customer || 0) + ' pelanggan';
            render(data.items);
          })
          .catch(function (e) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger py-4">Gagal memuat: ' + esc(e.message) + '</td></tr>';
          });
      }

      document.getElementById('btnApply').addEventListener('click', load);
      document.getElementById('btnRefresh').addEventListener('click', load);
      document.getElementById('btnReset').addEventListener('click', function () {
        document.getElementById('fq').value = '';
        document.getElementById('fType').value = '';
        document.getElementById('fFrom').value = '';
        document.getElementById('fTo').value = '';
        load();
      });
      document.getElementById('fq').addEventListener('keydown', function (e) { if (e.key === 'Enter') load(); });
      load();
    })();
  </script>
</body>
</html>
