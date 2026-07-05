<?php
/**
 * Header Doc
 * Purpose: Konten BERSAMA halaman "Log Gangguan OLT" (admin `olt-log.php` & teknisi
 *          `teknisi-olt-log.php`) — kartu ringkasan, filter, dan daftar kejadian OLT
 *          ter-enrich pelanggan + durasi. RESPONSIF: tabel padat di desktop, kartu di HP.
 *          Tampilan OLT peran-sadar: admin lihat IP asli, teknisi lihat NAMA saja
 *          (via $oltLogRole yang di-set wrapper).
 * Caller: views/sb-admin/olt-log.php (admin) & views/sb-admin/teknisi-olt-log.php (teknisi).
 * Deps: API GET /api/olt/event-log (kirim olt_name/olt_ip), FontAwesome, tema (tk-dark).
 */
?>
<style>
  .olt-metric { border-radius: 12px; padding: .85rem 1rem; color: #fff; min-height: 82px; }
  .olt-metric span { opacity: .9; font-size: .8rem; }
  .olt-metric strong { font-size: 1.55rem; display: block; line-height: 1.1; }
  .m-total { background: linear-gradient(135deg,#334155,#0f172a); }
  .m-los { background: linear-gradient(135deg,#b91c1c,#7f1d1d); }
  .m-dg { background: linear-gradient(135deg,#b45309,#78350f); }
  .m-up { background: linear-gradient(135deg,#15803d,#14532d); }
  .badge-ev { font-size: .72rem; padding: .22rem .55rem; border-radius: 999px; font-weight: 600; white-space: nowrap; display: inline-block; line-height: 1.35; }
  .ev-los { background:#fee2e2; color:#991b1b; }
  .ev-dg { background:#fef3c7; color:#92400e; }
  .ev-discovery { background:#dcfce7; color:#166534; }
  .cust-name { font-weight: 600; }
  .cust-sub { font-size: .74rem; opacity: .62; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  /* Desktop: tabel padat */
  .olt-table { font-size: .82rem; }
  .olt-table thead th { border-top: none; font-size: .76rem; text-transform: uppercase; letter-spacing: .02em; opacity: .75; }
  .olt-table td { vertical-align: top; padding: .5rem .55rem; }
  .olt-table .cust-sub { margin-top: .1rem; }
  /* Mobile: kartu */
  .olt-list { display: flex; flex-direction: column; gap: .5rem; }
  .olt-item { border: 1px solid rgba(128,128,128,.22); border-radius: 11px; padding: .6rem .8rem; }
  .olt-item-head { display: flex; align-items: center; gap: .55rem; flex-wrap: wrap; }
  .olt-item-time { font-size: .77rem; opacity: .72; }
  .olt-dur { font-size: .74rem; opacity: .85; font-weight: 600; }
  .olt-item-name { font-weight: 600; margin-top: .28rem; }
  .olt-item-name .ppp { font-weight: 400; opacity: .58; font-size: .84em; }
  .olt-item-meta { font-size: .75rem; opacity: .68; margin-top: .22rem; display: flex; flex-wrap: wrap; gap: .1rem .75rem; }
</style>

<div class="dashboard-header">
  <div class="d-flex align-items-center justify-content-between flex-wrap" style="gap:.5rem;">
    <div>
      <h1>Log Gangguan OLT</h1>
      <p class="mb-0">Riwayat kejadian OLT — <strong>LOS</strong> (fiber putus), <strong>Dying-Gasp</strong> (mati listrik), dan <strong>pulih</strong> — berikut <strong>pelanggan</strong> terdampak &amp; <strong>durasi</strong>.</p>
    </div>
    <button id="btnRefresh" class="btn btn-light"><i class="fas fa-sync"></i> Refresh</button>
  </div>
</div>

<div class="row mb-3">
  <div class="col-6 col-md-3 mb-3"><div class="olt-metric m-total"><span>Total kejadian</span><strong id="mTotal">0</strong></div></div>
  <div class="col-6 col-md-3 mb-3"><div class="olt-metric m-los"><span>LOS (fiber)</span><strong id="mLos">0</strong></div></div>
  <div class="col-6 col-md-3 mb-3"><div class="olt-metric m-dg"><span>Dying-Gasp (listrik)</span><strong id="mDg">0</strong></div></div>
  <div class="col-6 col-md-3 mb-3"><div class="olt-metric m-up"><span>Pulih</span><strong id="mUp">0</strong></div></div>
</div>

<div class="card shadow-sm mb-3" style="border-radius:14px;">
  <div class="card-body py-3">
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
</div>

<div class="card shadow-sm" style="border-radius:14px;">
  <div class="card-header py-3 d-flex justify-content-between align-items-center">
    <h6 class="m-0 font-weight-bold text-dark">Riwayat Kejadian</h6>
    <small id="rowInfo" class="text-muted"></small>
  </div>
  <div class="card-body">
    <div id="oltResult"><div class="text-center text-muted py-4">Memuat…</div></div>
  </div>
</div>

<script>
  (function () {
    var OLT_LOG_ROLE = '<?php echo (isset($oltLogRole) && $oltLogRole === "teknisi") ? "teknisi" : "admin"; ?>';
    var result = document.getElementById('oltResult');
    var lastItems = null;

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
    // OLT: admin = "Nama · IP" (IP asli); teknisi = NAMA saja.
    function oltText(r) {
      var nm = r.olt_name, ip = r.olt_ip;
      if (OLT_LOG_ROLE === 'teknisi') return nm ? esc(nm) : 'OLT';
      if (nm && ip) return esc(nm) + ' · ' + esc(ip);
      if (ip) return esc(ip);
      if (nm) return esc(nm);
      return '—';
    }
    function isWide() { return window.matchMedia('(min-width: 768px)').matches; }

    function cardHtml(r) {
      var name = r.customer_name ? esc(r.customer_name) : '<span class="text-muted">(tak teridentifikasi)</span>';
      var ppp = r.pppoe_username ? ' <span class="ppp">· ' + esc(r.pppoe_username) + '</span>' : '';
      var meta = [];
      if (r.phone) meta.push('<span><i class="fas fa-phone-alt fa-xs mr-1"></i>' + esc(r.phone) + '</span>');
      if (r.address) meta.push('<span><i class="fas fa-map-marker-alt fa-xs mr-1"></i>' + esc(r.address) + '</span>');
      if (r.mac) meta.push('<span class="mono">' + esc(r.mac) + '</span>');
      var po = [];
      if (r.slot != null || r.onu != null) po.push('slot ' + esc(r.slot) + '/onu ' + esc(r.onu));
      po.push('<i class="fas fa-broadcast-tower fa-xs mr-1"></i>' + oltText(r));
      meta.push('<span>' + po.join(' · ') + '</span>');
      var dur = (r.event_type === 'discovery' && r.duration_ms != null)
        ? '<span class="olt-dur">· pulih setelah ' + esc(fmtDur(r.duration_ms)) + '</span>' : '';
      return '<div class="olt-item">'
        + '<div class="olt-item-head">' + badge(r.event_type) + '<span class="olt-item-time mono">' + esc(fmtTime(r.ts)) + '</span>' + dur + '</div>'
        + '<div class="olt-item-name">' + name + ppp + '</div>'
        + (meta.length ? '<div class="olt-item-meta">' + meta.join('') + '</div>' : '')
        + '</div>';
    }

    function tableHtml(items) {
      var oltHead = OLT_LOG_ROLE === 'teknisi' ? 'OLT' : 'OLT (IP)';
      var head = '<thead><tr><th>Waktu</th><th>Kejadian</th><th>Pelanggan</th><th>HP</th><th>Alamat</th><th>ONU</th><th>' + oltHead + '</th></tr></thead>';
      var rows = '';
      for (var i = 0; i < items.length; i++) {
        var r = items[i];
        var name = r.customer_name ? esc(r.customer_name) : '<span class="text-muted">(tak teridentifikasi)</span>';
        var ppp = r.pppoe_username ? '<div class="cust-sub mono">' + esc(r.pppoe_username) + '</div>' : '';
        var dur = (r.event_type === 'discovery' && r.duration_ms != null) ? '<div class="cust-sub">pulih ' + esc(fmtDur(r.duration_ms)) + '</div>' : '';
        var onu = (r.mac ? '<span class="mono">' + esc(r.mac) + '</span>' : '—')
          + ((r.slot != null || r.onu != null) ? '<div class="cust-sub">slot ' + esc(r.slot) + '/onu ' + esc(r.onu) + '</div>' : '');
        rows += '<tr>'
          + '<td class="mono" style="white-space:nowrap">' + esc(fmtTime(r.ts)) + '</td>'
          + '<td>' + badge(r.event_type) + dur + '</td>'
          + '<td><div class="cust-name">' + name + '</div>' + ppp + '</td>'
          + '<td>' + (r.phone ? esc(r.phone) : '—') + '</td>'
          + '<td>' + (r.address ? esc(r.address) : '—') + '</td>'
          + '<td>' + onu + '</td>'
          + '<td>' + oltText(r) + '</td>'
          + '</tr>';
      }
      return '<div class="table-responsive"><table class="table table-hover olt-table mb-0">' + head + '<tbody>' + rows + '</tbody></table></div>';
    }

    function render(items) {
      lastItems = items;
      if (!items || !items.length) {
        result.innerHTML = '<div class="text-center text-muted py-4">Belum ada kejadian sesuai filter.</div>';
        return;
      }
      if (isWide()) {
        result.innerHTML = tableHtml(items);
      } else {
        result.innerHTML = '<div class="olt-list">' + items.map(cardHtml).join('') + '</div>';
      }
    }

    function load() {
      result.innerHTML = '<div class="text-center text-muted py-4">Memuat…</div>';
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
            (data.items ? data.items.length : 0) + ' baris · ' + (data.total || 0) + ' total · ' +
            (stats.distinct_customer || 0) + ' pelanggan';
          render(data.items);
        })
        .catch(function (e) {
          result.innerHTML = '<div class="text-center text-danger py-4">Gagal memuat: ' + esc(e.message) + '</div>';
        });
    }

    // Re-render saat lintas breakpoint (tabel<->kartu) tanpa fetch ulang.
    var wideNow = isWide();
    window.addEventListener('resize', function () {
      var w = isWide();
      if (w !== wideNow) { wideNow = w; if (lastItems) render(lastItems); }
    });

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
