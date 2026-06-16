<?php
/**
 * Header Doc
 * Purpose: Halaman admin Monitor CCTV — 4 tab: Daftar CCTV (CRUD + KPI + status/since + tombol Tes +
 *          badge "tidak di netwatch"), Ditemukan di Netwatch (discovery read-only + adopsi massal),
 *          Pengaturan (toggle/window/notif + template WA & Telegram + guard gangguan massal), dan
 *          Riwayat insiden. Konsisten dgn halaman lain (card/nav-tabs sb-admin) & aman light/dark.
 * Caller: `routes/pages.js` pada path `/cctv-monitor`.
 * Deps: `_navbar.php`, `topbar.php`, API `/api/cctv/*`, admin-theme.css (+tokens.css) untuk dark mode.
 * MainFuncs: render tabel CCTV + modal tambah/edit + tabel discovery + form pengaturan/template.
 */
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'RAF BOT - Monitor CCTV';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>

  <style>
    /* KPI & elemen kustom — pakai design token agar selaras light/dark (lihat tokens.css). */
    .cctv-kpi { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; margin-bottom: 1rem; }
    @media (max-width: 575.98px) { .cctv-kpi { grid-template-columns: repeat(2, 1fr); } }
    .cctv-kpi .stat { background: var(--white); border: 1px solid var(--slate-200); border-radius: var(--radius-sm); padding: 0.85rem 1rem; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
    .cctv-kpi .stat .label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--slate-600); font-weight: 600; }
    .cctv-kpi .stat .value { font-size: 1.6rem; font-weight: 700; line-height: 1.2; }
    .cctv-kpi .stat .value.up { color: var(--color-success); }
    .cctv-kpi .stat .value.down { color: var(--color-danger); }
    .cctv-kpi .stat .value.pending { color: var(--color-warning); }
    .cctv-kpi .stat .value.total { color: var(--indigo-600); }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
    .status-dot.up { background: var(--color-success); box-shadow: 0 0 0 3px rgba(16,185,129,0.18); }
    .status-dot.down { background: var(--color-danger); box-shadow: 0 0 0 3px rgba(239,68,68,0.18); }
    .status-dot.unknown { background: var(--slate-400); }
    .cctv-host { font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 0.85rem; color: var(--slate-600); }
    .cctv-tpl { font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 0.85rem; line-height: 1.5; }
    /* Dark mode — surface & teks via alias --d-* (admin-theme.css), aksen via shade terang token. */
    body.tk-dark .cctv-kpi .stat { background: var(--d-surface); border-color: var(--d-line); }
    body.tk-dark .cctv-kpi .stat .label { color: var(--d-ink-soft); }
    body.tk-dark .cctv-kpi .stat .value.up { color: var(--emerald-400); }
    body.tk-dark .cctv-kpi .stat .value.down { color: var(--red-400); }
    body.tk-dark .cctv-kpi .stat .value.pending { color: var(--amber-400); }
    body.tk-dark .cctv-kpi .stat .value.total { color: var(--indigo-300); }
    body.tk-dark .cctv-host { color: var(--d-ink-soft); }
    /* Picker pelanggan: cari + daftar (ganti <select> panjang) — nyaman light/dark & mobile. */
    .cctv-cust-list { display: none; max-height: 210px; overflow-y: auto; background: var(--white); margin-top: 4px; }
    .cctv-cust-list.show { display: block; }
    .cctv-cust-item { padding: 0.4rem 0.6rem; cursor: pointer; border-bottom: 1px solid var(--slate-100); }
    .cctv-cust-item:last-child { border-bottom: 0; }
    .cctv-cust-item.active, .cctv-cust-item:hover { background: var(--indigo-50); }
    .cctv-cust-item .nm { font-weight: 600; font-size: 0.85rem; }
    .cctv-cust-item .meta { font-size: 0.78rem; color: var(--slate-600); }
    .cctv-cust-empty { padding: 0.5rem 0.6rem; font-size: 0.83rem; color: var(--slate-400); }
    body.tk-dark .cctv-cust-list { background: var(--d-surface); }
    body.tk-dark .cctv-cust-item { border-bottom-color: var(--d-line); }
    body.tk-dark .cctv-cust-item.active, body.tk-dark .cctv-cust-item:hover { background: var(--d-surface-2); }
    body.tk-dark .cctv-cust-item .meta { color: var(--d-ink-soft); }
    body.tk-dark .cctv-cust-empty { color: var(--d-muted); }
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
            <div class="text-right">
              <span id="monitorPill" class="badge badge-secondary">monitor: ?</span>
              <div><small class="text-muted">Update: <span id="lastUpdate">-</span></small></div>
            </div>
          </div>
        </div>

        <div id="alertBox" class="alert alert-info" style="display:none;"></div>

        <ul class="nav nav-tabs mb-3" id="cctvTabs" role="tablist">
          <li class="nav-item">
            <a class="nav-link active" id="tab-list-link" data-toggle="tab" href="#tab-list" role="tab">
              <i class="fas fa-video"></i> Daftar CCTV <span class="badge badge-primary" id="tabCountList">0</span>
            </a>
          </li>
          <li class="nav-item">
            <a class="nav-link" id="tab-discovery-link" data-toggle="tab" href="#tab-discovery" role="tab">
              <i class="fas fa-search-location"></i> Ditemukan di Netwatch <span class="badge badge-primary" id="tabCountDiscovery">0</span>
            </a>
          </li>
          <li class="nav-item">
            <a class="nav-link" id="tab-areas-link" data-toggle="tab" href="#tab-areas" role="tab">
              <i class="fas fa-user-tie"></i> Koordinator <span class="badge badge-primary" id="tabCountAreas">0</span>
            </a>
          </li>
          <li class="nav-item">
            <a class="nav-link" id="tab-settings-link" data-toggle="tab" href="#tab-settings" role="tab">
              <i class="fas fa-sliders-h"></i> Pengaturan
            </a>
          </li>
          <li class="nav-item">
            <a class="nav-link" id="tab-incidents-link" data-toggle="tab" href="#tab-incidents" role="tab">
              <i class="fas fa-history"></i> Riwayat
            </a>
          </li>
        </ul>

        <div class="tab-content">
          <!-- TAB: Daftar CCTV -->
          <div class="tab-pane fade show active" id="tab-list" role="tabpanel">
            <div class="cctv-kpi">
              <div class="stat"><div class="label">Terdaftar</div><div class="value total" id="kpiTotal">-</div></div>
              <div class="stat"><div class="label">Online</div><div class="value up" id="kpiUp">-</div></div>
              <div class="stat"><div class="label">Mati</div><div class="value down" id="kpiDown">-</div></div>
              <div class="stat"><div class="label">Menunggu Konfirmasi</div><div class="value pending" id="kpiPending">-</div></div>
            </div>

            <div class="card shadow mb-4">
              <div class="card-header py-3 d-flex justify-content-between align-items-center">
                <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-video"></i> Daftar CCTV</h6>
                <button class="btn btn-primary-custom btn-sm" id="addCctvBtn"><i class="fas fa-plus"></i> Tambah CCTV</button>
              </div>
              <div class="card-body">
                <div class="table-responsive">
                  <table class="table table-bordered table-hover" id="cctvTable" width="100%">
                    <thead class="thead-light">
                      <tr><th>Nama</th><th>IP</th><th>Pelanggan</th><th>Status</th><th>Uptime 7h</th><th>Window</th><th>Aksi</th></tr>
                    </thead>
                    <tbody></tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <!-- TAB: Ditemukan di Netwatch — discovery READ-ONLY (tidak pernah menulis ke router) -->
          <div class="tab-pane fade" id="tab-discovery" role="tabpanel">
            <div class="card shadow mb-4">
              <div class="card-header py-3 d-flex justify-content-between align-items-center">
                <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-search-location"></i> Ditemukan di Netwatch</h6>
                <button class="btn btn-sm btn-outline-primary" id="rescanBtn"><i class="fas fa-sync"></i> Scan ulang</button>
              </div>
              <div class="card-body">
                <p class="text-muted small mb-2">CCTV yang sudah ada di MikroTik netwatch tapi belum diadopsi ke monitor. Klik <strong>Adopsi</strong> — IP, nama, dan area terisi otomatis, kamu cukup isi nomor WA pelanggan.</p>
                <div id="discoveryStatus" class="small text-muted mb-2">-</div>
                <div class="form-inline mb-2" id="bulkAdoptBar" style="display:none;">
                  <input type="text" class="form-control form-control-sm mr-2" id="bulkAdoptPhone" placeholder="Nomor WA utk semua yang dicentang (mis. RT/komunitas)" style="min-width:240px;">
                  <button class="btn btn-sm btn-primary" id="bulkAdoptBtn"><i class="fas fa-layer-group"></i> Adopsi terpilih (<span id="bulkAdoptCount">0</span>)</button>
                </div>
                <div class="table-responsive">
                  <table class="table table-bordered table-hover" id="discoveryTable" width="100%">
                    <thead class="thead-light">
                      <tr><th style="width:32px;"><input type="checkbox" id="discCheckAll" title="Pilih semua"></th><th>Nama (dari script)</th><th>Area</th><th>IP</th><th>Status</th><th>Format Script</th><th>Aksi</th></tr>
                    </thead>
                    <tbody></tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <!-- TAB: Koordinator Area/RT -->
          <div class="tab-pane fade" id="tab-areas" role="tabpanel">
            <div class="card shadow mb-4">
              <div class="card-header py-3 d-flex justify-content-between align-items-center">
                <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-user-tie"></i> Koordinator Area / RT</h6>
                <button class="btn btn-primary-custom btn-sm" id="addAreaBtn"><i class="fas fa-plus"></i> Tambah Area</button>
              </div>
              <div class="card-body">
                <p class="text-muted small mb-2">Koordinator (mis. ketua RT) dapat notifikasi ringkas saat ada CCTV di areanya mati, agar bisa koordinasi dengan warga. Jam tenang &amp; aturan lain berlaku sama. Area dicocokkan ke field <em>Area</em> tiap CCTV (tak peduli huruf besar/kecil).</p>
                <div class="table-responsive">
                  <table class="table table-bordered table-hover" id="areasTable" width="100%">
                    <thead class="thead-light">
                      <tr><th>Area</th><th>Koordinator</th><th>Nomor WA</th><th>Aksi</th></tr>
                    </thead>
                    <tbody></tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <!-- TAB: Pengaturan -->
          <div class="tab-pane fade" id="tab-settings" role="tabpanel">
            <div class="card shadow mb-4">
              <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-toggle-on"></i> Monitor</h6></div>
              <div class="card-body">
                <div class="form-row align-items-end">
                  <div class="col-auto mb-2">
                    <div class="custom-control custom-switch">
                      <input type="checkbox" class="custom-control-input" id="set_enabled">
                      <label class="custom-control-label" for="set_enabled">Aktifkan monitor</label>
                    </div>
                  </div>
                  <div class="col-auto mb-2">
                    <label class="small mb-0 d-block">Window konfirmasi (menit)</label>
                    <input type="number" min="1" max="1440" class="form-control form-control-sm" id="set_window" style="width:140px;">
                  </div>
                  <div class="col-auto mb-2">
                    <label class="small mb-0 d-block">Gabung notif (detik)</label>
                    <input type="number" min="0" max="600" class="form-control form-control-sm" id="set_aggregate_sec" style="width:140px;" title="Gabung beberapa CCTV ke nomor sama jadi 1 pesan. 0 = kirim segera.">
                  </div>
                  <div class="col-auto mb-2">
                    <div class="custom-control custom-switch">
                      <input type="checkbox" class="custom-control-input" id="set_notify_recovery">
                      <label class="custom-control-label" for="set_notify_recovery">Notifikasi pulih</label>
                    </div>
                  </div>
                </div>
                <small class="text-muted">Saat dimatikan, broadcast WA berhenti; saat dinyalakan langsung jalan tanpa perlu restart aplikasi. Window berlaku sebagai default global (bisa di-override per-CCTV).</small>
                <hr class="my-2">
                <div class="form-row align-items-end">
                  <div class="col-auto mb-2">
                    <div class="custom-control custom-switch">
                      <input type="checkbox" class="custom-control-input" id="set_quiet_enabled">
                      <label class="custom-control-label" for="set_quiet_enabled">Jam tenang (tunda WA pelanggan)</label>
                    </div>
                  </div>
                  <div class="col-auto mb-2">
                    <label class="small mb-0 d-block">Mulai</label>
                    <input type="time" class="form-control form-control-sm" id="set_quiet_start" style="width:130px;">
                  </div>
                  <div class="col-auto mb-2">
                    <label class="small mb-0 d-block">Selesai</label>
                    <input type="time" class="form-control form-control-sm" id="set_quiet_end" style="width:130px;">
                  </div>
                </div>
                <small class="text-muted">Di jam tenang, WA ke pelanggan <strong>ditahan</strong>; bila masih mati saat jam tenang berakhir, baru dikirim. Notifikasi Telegram teknisi tetap instan.</small>
              </div>
            </div>

            <div class="card shadow mb-4">
              <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-comment-dots"></i> Template Pesan Default</h6></div>
              <div class="card-body">
                <div class="form-group">
                  <label class="font-weight-bold">Pesan saat CCTV <span class="text-danger">MATI</span> (DOWN)</label>
                  <textarea class="form-control cctv-tpl" id="set_msg_down" rows="7"></textarea>
                </div>
                <div class="form-group">
                  <label class="font-weight-bold">Pesan saat CCTV <span class="text-success">PULIH</span> (UP)</label>
                  <textarea class="form-control cctv-tpl" id="set_msg_up" rows="4"></textarea>
                </div>
                <div class="form-group">
                  <label class="font-weight-bold">Pesan saat <span class="text-danger">BANYAK CCTV</span> mati (gabungan ke 1 nomor)</label>
                  <textarea class="form-control cctv-tpl" id="set_msg_down_multi" rows="5"></textarea>
                  <small class="form-text text-muted">Variabel khusus gabungan: <code>{customer_name}</code> <code>{count}</code> <code>{list}</code> (daftar CCTV).</small>
                </div>
                <small class="text-muted">
                  Variabel:
                  <code>{customer_name}</code> <code>{cctv_name}</code> <code>{cctv_host}</code>
                  <code>{since_local}</code> <code>{up_local}</code> <code>{minutes_down}</code>
                  <code>{uptime_24h}</code> <code>{uptime_7d}</code> <code>{uptime_30d}</code>.
                  Kosongkan untuk pakai template default bawaan. Pesan khusus per-CCTV tetap bisa diatur di form Tambah/Edit.
                </small>
              </div>
            </div>

            <div class="card shadow mb-4">
              <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-paper-plane"></i> Netwatch &amp; Telegram (notifikasi teknisi)</h6></div>
              <div class="card-body">
                <p class="text-muted small">Dipakai saat menambah CCTV baru: app otomatis membuat entri netwatch + script on-up/on-down yang mengirim notifikasi <strong>realtime ke Telegram</strong> (untuk teknisi &amp; admin). Cukup isi sekali di sini.</p>
                <div class="form-row">
                  <div class="form-group col-md-7">
                    <label class="small mb-0">Bot Token Telegram</label>
                    <input class="form-control form-control-sm cctv-tpl" id="nw_bot" placeholder="123456789:AAE...">
                  </div>
                  <div class="form-group col-md-5">
                    <label class="small mb-0">Chat ID (grup teknisi)</label>
                    <input class="form-control form-control-sm cctv-tpl" id="nw_chat" placeholder="-4707718346">
                  </div>
                  <div class="form-group col-6 col-md-3">
                    <label class="small mb-0">Interval cek</label>
                    <input class="form-control form-control-sm" id="nw_interval" placeholder="5s">
                  </div>
                  <div class="form-group col-6 col-md-3">
                    <label class="small mb-0">Timeout</label>
                    <input class="form-control form-control-sm" id="nw_timeout" placeholder="1s">
                  </div>
                </div>
                <div class="form-group">
                  <label class="small mb-0">Template Telegram — CCTV ONLINE (UP)</label>
                  <textarea class="form-control cctv-tpl" id="nw_msg_up" rows="2"></textarea>
                </div>
                <div class="form-group mb-1">
                  <label class="small mb-0">Template Telegram — CCTV OFFLINE (DOWN)</label>
                  <textarea class="form-control cctv-tpl" id="nw_msg_down" rows="2"></textarea>
                </div>
                <small class="text-muted">Variabel RouterOS: <code>$area</code> <code>$cctv</code> (nama, auto-isi) <code>$time</code> <code>$date</code>. Backslash = escape emoji (mis. <code>\E2\9C\85</code> = ✅).</small>
              </div>
            </div>

            <div class="card shadow mb-4">
              <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-exclamation-triangle"></i> Guard Gangguan Massal</h6></div>
              <div class="card-body">
                <p class="text-muted small">Saat <strong>banyak CCTV mati bersamaan</strong> (mis. PLN/uplink padam), broadcast ke pelanggan otomatis <strong>ditahan</strong> dan diganti 1 ringkasan ke admin — mencegah spam ke banyak orang.</p>
                <div class="form-row align-items-end">
                  <div class="form-group col-6 col-md-3">
                    <label class="small mb-0">Ambang (jumlah CCTV)</label>
                    <input type="number" min="0" max="1000" class="form-control form-control-sm" id="mo_threshold" placeholder="0 = nonaktif">
                  </div>
                  <div class="form-group col-6 col-md-6">
                    <label class="small mb-0">WA admin penerima ringkasan</label>
                    <input class="form-control form-control-sm" id="mo_phone" placeholder="628xxx (pisah | untuk multi)">
                  </div>
                </div>
                <div class="form-group mb-1">
                  <label class="small mb-0">Template ringkasan ke admin</label>
                  <textarea class="form-control cctv-tpl" id="mo_msg" rows="3"></textarea>
                </div>
                <small class="text-muted">Variabel: <code>{count}</code> (jumlah CCTV mati) <code>{time_local}</code>. Ambang <strong>0 = nonaktif</strong> (broadcast per-CCTV seperti biasa).</small>
              </div>
            </div>

            <button class="btn btn-primary" type="button" id="saveSettingsBtn"><i class="fas fa-save"></i> Simpan Pengaturan</button>
          </div>

          <!-- TAB: Riwayat insiden -->
          <div class="tab-pane fade" id="tab-incidents" role="tabpanel">
            <div class="card shadow mb-4">
              <div class="card-header py-3 d-flex justify-content-between align-items-center">
                <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-history"></i> Riwayat Insiden</h6>
                <button class="btn btn-sm btn-outline-primary" id="reloadIncidentsBtn"><i class="fas fa-sync"></i> Muat ulang</button>
              </div>
              <div class="card-body">
                <p class="text-muted small mb-2">Catatan otomatis tiap CCTV mati/pulih: kapan terdeteksi, status broadcast, durasi. Terbaru di atas.</p>
                <div class="table-responsive">
                  <table class="table table-bordered table-hover table-sm" id="incidentsTable" width="100%">
                    <thead class="thead-light">
                      <tr><th>Waktu deteksi</th><th>CCTV</th><th>Status</th><th>Broadcast</th><th>Pulih</th></tr>
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
            <div class="cctv-cust-picker mt-1" id="cctv_cust_picker">
              <input type="text" class="form-control form-control-sm" id="cctv_cust_search" autocomplete="off" placeholder="🔍 Cari pelanggan: nama / nomor / alamat / paket…">
              <div class="cctv-cust-list border rounded" id="cctv_cust_list"></div>
            </div>
            <div class="small text-success mt-1" id="cctv_cust_chosen" style="display:none;"></div>
            <small class="form-text text-muted">Ketik nomor bebas (non-pelanggan) di kolom atas, atau cari &amp; pilih pelanggan agar nama &amp; nomor terisi otomatis.</small>
          </div>
          <div class="form-group">
            <label>Nama Pelanggan (opsional)</label>
            <input class="form-control" id="cctv_customer">
            <small class="form-text text-muted">Dipakai di pesan ({customer_name}).</small>
          </div>
          <div class="form-group">
            <label>Area / Lokasi (opsional)</label>
            <input class="form-control" id="cctv_area" list="cctvAreaList" autocomplete="off" placeholder="mis. DANDER / TANJUNGHARJO">
            <datalist id="cctvAreaList"></datalist>
            <small class="form-text text-muted">Pilih area terkelola (agar koordinatornya ikut dinotif) atau ketik baru. Terisi otomatis saat adopsi.</small>
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
          <div class="form-check mt-2">
            <input class="form-check-input" type="checkbox" id="cctv_notify_customer" checked>
            <label class="form-check-label" for="cctv_notify_customer">Kirim notifikasi WA ke pelanggan</label>
            <small class="form-text text-muted">Matikan untuk <em>pantau saja</em> — admin/Telegram tetap dapat notif, pelanggan tidak.</small>
          </div>
          <div class="form-check mt-2" id="provisionRow">
            <input class="form-check-input" type="checkbox" id="cctv_provision" checked>
            <label class="form-check-label" for="cctv_provision">Sekalian buat entri netwatch + notifikasi Telegram di MikroTik</label>
            <small class="form-text text-muted">Hanya untuk CCTV baru yang IP-nya belum ada di netwatch. Perlu Bot Token &amp; Chat ID terisi di tab Pengaturan.</small>
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

<!-- Modal Area/Koordinator -->
<div class="modal fade" id="areaModal" tabindex="-1">
  <div class="modal-dialog">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title" id="areaModalTitle">Tambah Area</h5>
        <button type="button" class="close" data-dismiss="modal"><span>&times;</span></button>
      </div>
      <div class="modal-body">
        <form id="areaForm">
          <input type="hidden" id="area_id">
          <div class="form-group">
            <label>Nama Area / RT <span class="text-danger">*</span></label>
            <input class="form-control" id="area_name" required placeholder="mis. DANDER / RT 02">
            <small class="form-text text-muted">Harus sama dengan nilai Area di CCTV (cocok otomatis, tak peduli huruf besar/kecil).</small>
          </div>
          <div class="form-group">
            <label>Nama Koordinator (opsional)</label>
            <input class="form-control" id="area_coord_name" placeholder="mis. Pak RT 02">
          </div>
          <div class="form-group">
            <label>Nomor WA Koordinator <span class="text-danger">*</span></label>
            <input class="form-control" id="area_coord_phone" required placeholder="628xxx (pisah | untuk multi)">
          </div>
          <div class="form-check">
            <input class="form-check-input" type="checkbox" id="area_enabled" checked>
            <label class="form-check-label" for="area_enabled">Aktif (kirim notifikasi koordinator)</label>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-dismiss="modal">Batal</button>
        <button class="btn btn-primary" id="areaSaveBtn">Simpan</button>
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
  let devicesCache = []; let statusCache = null; let refreshTimer = null; let discoveryCache = []; let uptimeCache = {}; let areasCache = [];

  $(document).ready(() => {
    loadAll();
    loadDiscovery();
    loadSettings();
    loadCustomers();
    refreshTimer = setInterval(loadStatusOnly, 30000);
    $('#addCctvBtn').on('click', openAdd);
    $('#cctvSaveBtn').on('click', save);
    $('#rescanBtn').on('click', loadDiscovery);
    $('#saveSettingsBtn').on('click', saveSettings);
    $('#cctv_cust_search').on('focus input', function () { renderCustList(this.value); });
    $('#cctv_cust_search').on('keydown', onCustKeydown);
    $(document).on('click', '#cctv_cust_list .cctv-cust-item', function () { pickCustomer($(this).data('idx')); });
    $(document).on('click', function (e) { if (!$(e.target).closest('#cctv_cust_picker').length) $('#cctv_cust_list').removeClass('show'); });
    $(document).on('click', '.btn-edit-cctv', function () { openEdit($(this).data('id')); });
    $(document).on('click', '.btn-del-cctv', function () { confirmDelete($(this).data('id'), $(this).data('name')); });
    $(document).on('click', '.btn-adopt-cctv', function () { adopt($(this).data('host')); });
    $(document).on('click', '.btn-test-cctv', function () { testBroadcast($(this).data('id'), $(this).data('name')); });
    $('#reloadIncidentsBtn').on('click', loadIncidents);
    $('#tab-incidents-link').on('shown.bs.tab', loadIncidents);
    $(document).on('change', '#discCheckAll', function () { $('.disc-check').prop('checked', this.checked); updateBulkCount(); });
    $(document).on('change', '.disc-check', updateBulkCount);
    $('#bulkAdoptBtn').on('click', bulkAdopt);
    loadAreas();
    $('#addAreaBtn').on('click', openAddArea);
    $('#areaSaveBtn').on('click', saveArea);
    $(document).on('click', '.btn-edit-area', function () { openEditArea($(this).data('id')); });
    $(document).on('click', '.btn-del-area', function () { confirmDeleteArea($(this).data('id'), $(this).data('name')); });
  });

  async function loadAll() {
    await Promise.all([loadDevices(), loadStatusOnly()]);
    render();
    loadUptime();
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
        <td><input type="checkbox" class="disc-check" data-host="${escapeHtml(c.host)}"></td>
        <td><strong>${escapeHtml(c.name)}</strong>${offBadge}</td>
        <td>${c.area ? escapeHtml(c.area) : '<span class="text-muted">—</span>'}</td>
        <td><span class="cctv-host">${escapeHtml(c.host)}</span></td>
        <td><span class="status-dot ${dot}"></span>${stLabel}</td>
        <td>${fmt}</td>
        <td><button class="btn btn-sm btn-primary btn-adopt-cctv" data-host="${escapeHtml(c.host)}"><i class="fas fa-plus"></i> Adopsi</button></td>
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
    $('#cctv_area').val(c.area || '');
    // Adopsi = host sudah pasti ada di netwatch → provisioning tak relevan.
    $('#cctv_provision').prop('checked', false);
    $('#provisionRow').hide();
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
        $('#set_msg_down').val(r.data.messageDown || '');
        $('#set_msg_up').val(r.data.messageUp || '');
        $('#set_msg_down_multi').val(r.data.messageDownMulti || '');
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
      messageDown: $('#set_msg_down').val(),
      messageUp: $('#set_msg_up').val(),
      messageDownMulti: $('#set_msg_down_multi').val(),
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
  async function provisionNetwatch(dev) {
    try {
      const r = await fetch('/api/cctv/provision-netwatch', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: dev.host, name: dev.name, area: dev.area }) }).then(r => r.json());
      if (r.status === 200) {
        const exists = r.data && r.data.exists;
        Swal.fire({ icon: 'success', title: 'Tersimpan', html: exists ? 'CCTV tersimpan. Entri netwatch sudah ada sebelumnya (tidak ditimpa).' : 'CCTV tersimpan + entri netwatch &amp; notifikasi Telegram dibuat di MikroTik.', timer: 2400, showConfirmButton: false });
      } else {
        Swal.fire({ icon: 'warning', title: 'CCTV tersimpan, netwatch gagal', text: r.message || 'Cek Bot Token/Chat ID di tab Pengaturan.' });
      }
    } catch (e) { Swal.fire({ icon: 'warning', title: 'CCTV tersimpan, netwatch gagal', text: e.message }); }
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

  function testBroadcast(id, name) {
    Swal.fire({
      icon: 'question', title: 'Kirim pesan tes?',
      html: 'Kirim WA percobaan ke nomor pelanggan <strong>' + escapeHtml(name || '') + '</strong>.',
      showCancelButton: true, confirmButtonText: 'Kirim', cancelButtonText: 'Batal',
    }).then(async (r) => {
      if (!r.isConfirmed) return;
      try {
        const res = await fetch('/api/cctv/test-broadcast', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).then(r => r.json());
        if (res.status === 200) Swal.fire({ icon: 'success', title: 'Terkirim', text: 'Berhasil ke ' + (res.data ? res.data.delivered : 0) + '/' + (res.data ? res.data.recipients : 0) + ' nomor.', timer: 2200, showConfirmButton: false });
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
        <td><small>${escapeHtml(det)}</small></td>
        <td>${escapeHtml(i.cctv_name || '')}<br><span class="cctv-host">${escapeHtml(i.host || '')}</span></td>
        <td>${incidentBadge(i.status)}</td>
        <td><small>${escapeHtml(String(bc))}</small></td>
        <td><small>${escapeHtml(rec)}</small></td>
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
      const sinceTxt = (s && s.since) ? ' <small class="text-muted">· ' + fmtSince(s.since) + '</small>' : '';
      const nwWarn = (statusCache && statusCache.running && s && s.inNetwatch === false)
        ? ' <span class="badge badge-warning" title="Host ini tidak ditemukan di netwatch MikroTik — monitor tak bisa memantau">⚠ tidak di netwatch</span>' : '';
      const u = uptimeCache[(d.host || '').toLowerCase()];
      const up7 = u ? u.uptime7d : null;
      const upCls = up7 == null ? 'text-muted' : up7 >= 99 ? 'text-success' : up7 >= 95 ? 'text-warning' : 'text-danger';
      const upCell = u ? `<span class="${upCls}" title="24 jam: ${u.uptime24h}% · 30 hari: ${u.uptime30d}%">${up7}%</span>` : '<span class="text-muted">—</span>';
      tb.append(`<tr>
        <td><strong>${escapeHtml(d.name)}</strong>${enabledBadge}${optoutBadge}${d.area ? '<br><small class="text-muted">' + escapeHtml(d.area) + '</small>' : ''}</td>
        <td><span class="cctv-host">${escapeHtml(d.host)}</span></td>
        <td>${d.customerName ? escapeHtml(d.customerName) + '<br>' : ''}<small class="text-muted">${escapeHtml(d.phone || '')}</small></td>
        <td><span class="status-dot ${dot}"></span>${stLabel}${sinceTxt}${nwWarn}</td>
        <td>${upCell}</td>
        <td>${win}</td>
        <td class="text-nowrap">
          <button class="btn btn-sm btn-outline-success btn-test-cctv" data-id="${d.id}" data-name="${escapeHtml(d.name)}" title="Kirim pesan tes ke nomor pelanggan"><i class="fas fa-paper-plane"></i></button>
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
    $('#cctv_notify_customer').prop('checked', true);
    $('#cctv_provision').prop('checked', true);
    $('#provisionRow').show();
    resetCustPicker();
    $('#cctvModal').modal('show');
  }
  function openEdit(id) {
    const d = devicesCache.find(x => x.id === id); if (!d) return;
    $('#cctvModalTitle').text('Edit CCTV');
    $('#cctv_id').val(d.id); $('#cctv_name').val(d.name); $('#cctv_host').val(d.host);
    $('#cctv_phone').val(d.phone); $('#cctv_customer').val(d.customerName || '');
    $('#cctv_area').val(d.area || '');
    $('#cctv_window').val(d.confirmationMinutes || ''); $('#cctv_message').val(d.customMessage || '');
    $('#cctv_enabled').prop('checked', d.enabled !== false);
    $('#cctv_notify_customer').prop('checked', d.notifyCustomer !== false);
    $('#provisionRow').hide(); // provisioning hanya untuk CCTV baru
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
        if (!id && $('#cctv_provision').is(':checked')) {
          await provisionNetwatch(payload);
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
          if (res.status === 200) { Swal.fire({ icon: 'success', title: 'Terhapus', timer: 1000, showConfirmButton: false }); loadAll(); loadDiscovery(); }
          else Swal.fire('Gagal', res.message || 'Error', 'error');
        } catch (e) { Swal.fire('Gagal', e.message, 'error'); }
      });
  }
  async function loadAreas() {
    try {
      const r = await fetch('/api/cctv/areas', { credentials: 'include' }).then(r => r.json());
      if (r.status === 200) { areasCache = r.data || []; renderAreas(); populateAreaDatalist(); }
    } catch (_) {}
  }
  function populateAreaDatalist() {
    const dl = $('#cctvAreaList').empty();
    areasCache.forEach(a => dl.append(`<option value="${escapeHtml(a.name)}">`));
  }
  function renderAreas() {
    const tb = $('#areasTable tbody').empty();
    $('#tabCountAreas').text(areasCache.length);
    if (areasCache.length === 0) {
      tb.append('<tr><td colspan="4" class="text-center text-muted">Belum ada koordinator area. Klik "Tambah Area".</td></tr>');
      return;
    }
    areasCache.forEach(a => {
      const off = a.enabled === false ? ' <span class="badge badge-secondary">nonaktif</span>' : '';
      tb.append(`<tr>
        <td><strong>${escapeHtml(a.name)}</strong>${off}</td>
        <td>${escapeHtml(a.coordinatorName || '—')}</td>
        <td><span class="cctv-host">${escapeHtml(a.coordinatorPhone || '')}</span></td>
        <td>
          <button class="btn btn-sm btn-outline-primary btn-edit-area" data-id="${a.id}"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-outline-danger btn-del-area" data-id="${a.id}" data-name="${escapeHtml(a.name)}"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`);
    });
  }
  function openAddArea() {
    $('#areaModalTitle').text('Tambah Area'); $('#areaForm')[0].reset();
    $('#area_id').val(''); $('#area_enabled').prop('checked', true);
    $('#areaModal').modal('show');
  }
  function openEditArea(id) {
    const a = areasCache.find(x => x.id === id); if (!a) return;
    $('#areaModalTitle').text('Edit Area');
    $('#area_id').val(a.id); $('#area_name').val(a.name);
    $('#area_coord_name').val(a.coordinatorName || ''); $('#area_coord_phone').val(a.coordinatorPhone || '');
    $('#area_enabled').prop('checked', a.enabled !== false);
    $('#areaModal').modal('show');
  }
  async function saveArea() {
    const payload = {
      name: $('#area_name').val().trim(),
      coordinatorName: $('#area_coord_name').val().trim(),
      coordinatorPhone: $('#area_coord_phone').val().trim(),
      enabled: $('#area_enabled').is(':checked'),
    };
    if (!payload.name || !payload.coordinatorPhone) { Swal.fire('Lengkapi', 'Nama area & nomor WA koordinator wajib diisi.', 'warning'); return; }
    const id = $('#area_id').val();
    const url = id ? `/api/cctv/areas/${id}` : '/api/cctv/areas';
    const method = id ? 'PUT' : 'POST';
    try {
      const r = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json());
      if (r.status === 200) { $('#areaModal').modal('hide'); Swal.fire({ icon: 'success', title: 'Tersimpan', timer: 1100, showConfirmButton: false }); loadAreas(); }
      else Swal.fire('Gagal', r.message || 'Error', 'error');
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
</script>
</body>
</html>
