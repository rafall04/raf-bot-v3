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
    $pageTitle = 'RAF BOT - Monitor CCTV Publik';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>

  <link href="<?= rafAssetUrl('/css/cctv-monitor.css') ?>" rel="stylesheet">
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
                  <table class="table table-bordered table-hover tabel-tumpuk-hp" id="cctvTable" width="100%">
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
                      <tr><th>Area</th><th>Koordinator</th><th>Tujuan Notifikasi</th><th>Aksi</th></tr>
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
                <div class="form-row align-items-center">
                  <div class="col-auto"><span class="small text-muted">Berlaku untuk:</span></div>
                  <div class="col-auto mb-1"><div class="custom-control custom-checkbox">
                    <input type="checkbox" class="custom-control-input" id="set_quiet_customer"><label class="custom-control-label" for="set_quiet_customer">Pelanggan</label>
                  </div></div>
                  <div class="col-auto mb-1"><div class="custom-control custom-checkbox">
                    <input type="checkbox" class="custom-control-input" id="set_quiet_coordinator"><label class="custom-control-label" for="set_quiet_coordinator">Koordinator</label>
                  </div></div>
                  <div class="col-auto mb-1"><div class="custom-control custom-checkbox">
                    <input type="checkbox" class="custom-control-input" id="set_quiet_group"><label class="custom-control-label" for="set_quiet_group">Grup</label>
                  </div></div>
                </div>
                <small class="text-muted">Di jam tenang, WA ke jenis yang <strong>dicentang</strong> ditahan sampai jam tenang berakhir (lalu dikirim bila masih mati); jenis yang tak dicentang tetap dikirim langsung. Mis. matikan <em>Koordinator</em> agar petugas on-call selalu dapat alert. Notifikasi Telegram teknisi tetap instan.</small>
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
                <div class="form-group">
                  <label class="font-weight-bold">Pesan ke <span class="text-info">KOORDINATOR</span> area (saat CCTV di areanya mati)</label>
                  <textarea class="form-control cctv-tpl" id="set_msg_coord" rows="5"></textarea>
                  <small class="form-text text-muted">Variabel: <code>{coordinator_name}</code> <code>{area}</code> <code>{count}</code> <code>{list}</code>.</small>
                </div>
                <div class="form-group">
                  <label class="font-weight-bold">Pesan ke <span class="text-info">GRUP WA RT</span> (saat CCTV di areanya mati)</label>
                  <textarea class="form-control cctv-tpl" id="set_msg_group" rows="5"></textarea>
                  <small class="form-text text-muted">Variabel: <code>{area}</code> <code>{count}</code> <code>{list}</code> (menyapa warga, tanpa nama koordinator).</small>
                </div>
                <div class="form-group">
                  <label class="font-weight-bold">Pesan <span class="text-success">PULIH</span> ke KOORDINATOR/GRUP (saat CCTV nyala lagi)</label>
                  <textarea class="form-control cctv-tpl" id="set_msg_group_up" rows="4"></textarea>
                  <small class="form-text text-muted">Variabel: <code>{area}</code> <code>{cctv_name}</code> <code>{up_local}</code>. Pelanggan tetap pakai template PULIH di atas.</small>
                </div>
                <small class="text-muted">
                  Variabel:
                  <code>{customer_name}</code> <code>{cctv_name}</code>
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
            <select class="form-control" id="cctv_area">
              <option value="">— tanpa area —</option>
            </select>
            <small class="form-text text-muted">Pilih area terkelola (koordinatornya ikut dinotif). Daftar area dikelola di tab <em>Koordinator</em>.</small>
            <div id="cctv_area_coord" class="small mt-1"></div>
          </div>
          <div class="form-group">
            <label>Window Konfirmasi (menit, opsional)</label>
            <input type="number" class="form-control" id="cctv_window" placeholder="kosong = pakai default global">
            <small class="form-text text-muted">Setelah X menit terus mati baru broadcast. Anti-flap PLN-blink.</small>
          </div>
          <div class="form-group">
            <label>Template Pesan Khusus (opsional)</label>
            <textarea class="form-control" id="cctv_message" rows="3" placeholder="Kosongkan untuk pakai template default. Variabel: {customer_name}, {cctv_name}, {since_local}, {minutes_down}"></textarea>
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
            <label>Nomor WA Koordinator</label>
            <input class="form-control" id="area_coord_phone" placeholder="628xxx (pisah | untuk multi)">
            <small class="form-text text-muted">Isi nomor, <em>atau</em> pilih Grup WA RT di bawah (boleh dua-duanya). Minimal salah satu.</small>
          </div>
          <div class="form-group">
            <label>Grup WA RT (opsional)</label>
            <div class="input-group">
              <select class="form-control" id="area_group">
                <option value="">— tanpa grup —</option>
              </select>
              <div class="input-group-append">
                <button class="btn btn-outline-secondary" type="button" id="area_load_groups"><i class="fas fa-sync"></i> Muat</button>
              </div>
            </div>
            <input type="hidden" id="area_group_name">
            <small class="form-text text-muted" id="area_group_hint">Klik <strong>Muat</strong> untuk ambil daftar grup yang bot ikuti — bot harus jadi anggota grup RT lebih dulu. Pesan "CCTV mati" akan dikirim ke grup ini (koordinasi RT + warga).</small>
          </div>
          <div class="form-check mb-2">
            <input class="form-check-input" type="checkbox" id="area_customers_in_group">
            <label class="form-check-label" for="area_customers_in_group">Warga area ini sudah tergabung di grup — cukup kirim ke grup (jangan japri pelanggan). <span class="text-muted">Centang hanya bila yakin semua warga ada di grup.</span></label>
          </div>
          <div class="form-check mb-2">
            <input class="form-check-input" type="checkbox" id="area_coord_in_group">
            <label class="form-check-label" for="area_coord_in_group">Koordinator juga ada di grup — jangan japri nomornya, cukup grup. <span class="text-muted">Notifikasi terpusat ke grup (hanya berlaku bila grup diisi).</span></label>
          </div>
          <div class="form-group">
            <label>Jam tenang area</label>
            <select class="form-control" id="area_quiet_mode">
              <option value="inherit">Ikuti pengaturan global (default)</option>
              <option value="custom">Atur jendela sendiri</option>
              <option value="off">Tanpa jam tenang (alert kapan saja)</option>
            </select>
            <div class="form-row mt-2" id="area_quiet_window" style="display:none;">
              <div class="col-auto">
                <label class="small mb-0 d-block">Mulai</label>
                <input type="time" class="form-control form-control-sm" id="area_quiet_start" style="width:130px;">
              </div>
              <div class="col-auto">
                <label class="small mb-0 d-block">Selesai</label>
                <input type="time" class="form-control form-control-sm" id="area_quiet_end" style="width:130px;">
              </div>
            </div>
            <small class="form-text text-muted">Override jam tenang khusus area ini (mis. pasar 00:00–05:00, pos jaga "tanpa jam tenang"). Jenis penerima yang kena (pelanggan/koordinator/grup) tetap mengikuti pengaturan global.</small>
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
<script src="<?= rafAssetUrl('/js/cctv-monitor.js') ?>"></script>
</body>
</html>
