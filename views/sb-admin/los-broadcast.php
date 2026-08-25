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

  <link href="<?= rafAssetUrl('/css/los-broadcast.css') ?>" rel="stylesheet">

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
            <div class="col-6 col-md-4 mb-3"><div class="los-metric m-pending"><span>Pending Konfirmasi</span><strong id="metricPending">0</strong><small>menunggu window</small></div></div>
            <div class="col-6 col-md-4 mb-3"><div class="los-metric m-bc"><span>Broadcasted (24j)</span><strong id="metricBroadcasted">0</strong><small>terkirim ke teknisi</small></div></div>
            <div class="col-6 col-md-4 mb-3"><div class="los-metric m-rec"><span>Recovered</span><strong id="metricRecovered">0</strong><small>pulih sblm broadcast</small></div></div>
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
                      <small class="text-muted">Saklar utama auto-broadcast LOS.</small>
                    </div>
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
                  <div class="alert alert-info" style="font-size:.82rem; border-radius:10px;">
                    <i class="fas fa-check-circle"></i> <strong>Notif PULIH</strong> — saat ONU yang tadinya LOS kembali online, kirim kabar <em>pulih + durasi putus</em> ke grup/teknisi yang sama. Menutup alarm yang tergantung (biar tahu mana yang masih rusak). Tahan sebentar (debounce) untuk pastikan stabil, bukan kedip.
                  </div>
                  <div class="form-row">
                    <div class="form-group col-md-4">
                      <label>Kirim notif PULIH</label>
                      <select class="form-control" name="notifyRecovery"><option value="false">Nonaktif</option><option value="true">Aktif</option></select>
                    </div>
                    <div class="form-group col-md-4">
                      <label>Tunggu stabil (detik)</label>
                      <input type="number" min="5" max="600" class="form-control" name="recoveryConfirmSeconds" value="60">
                      <small class="text-muted">Debounce anti-kedip sebelum vonis pulih.</small>
                    </div>
                    <div class="form-group col-md-4">
                      <label>Gabung pulih serentak (detik)</label>
                      <input type="number" min="1" max="300" class="form-control" name="recoveryClusterFlushSeconds" value="20">
                      <small class="text-muted">Banyak pulih bareng → 1 pesan "area pulih".</small>
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
                  <hr>
                  <div class="alert alert-success" style="font-size:.82rem; border-radius:10px;">
                    <i class="fas fa-shield-alt"></i> <strong>Verifikasi via Web OLT</strong> — sebelum broadcast, cross-check tiap LOS ke <em>log web OLT</em> (sumber otoritatif yang simpan DG+Lost permanen). Yang ternyata <strong>mati listrik (DG) disaring</strong> → cegah salah-alarm & salah-tiket saat mati listrik massal. <strong>Sangat disarankan Aktif.</strong>
                  </div>
                  <div class="form-row">
                    <div class="form-group col-md-4">
                      <label>Verifikasi Scrape</label>
                      <select class="form-control" name="verifyEnabled"><option value="true">Aktif</option><option value="false">Nonaktif</option></select>
                      <small class="text-muted">Nonaktifkan hanya bila web OLT bermasalah.</small>
                    </div>
                    <div class="form-group col-md-4">
                      <label>Kedalaman Baca (halaman)</label>
                      <input type="number" min="3" max="40" class="form-control" name="verifyMaxPages" value="20">
                      <small class="text-muted">Perdalam saat kejadian massal (default 20).</small>
                    </div>
                    <div class="form-group col-md-4">
                      <label>Window Baca (menit)</label>
                      <input type="number" min="3" max="120" class="form-control" name="verifyTimeWindowMinutes" value="15">
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
                  <small class="text-muted">
                    Placeholder: <code>{customer_name}</code>, <code>{address}</code>, <code>{company_name}</code>.
                    <br><b>Tidak boleh</b> memuat data internal jaringan (MAC / slot / ONU / ODP / nama PPPoE)
                    maupun jumlah pelanggan terdampak &mdash; pelanggan cukup tahu ada gangguan, dan simpanan akan ditolak bila memuatnya.
                  </small>
                </div>
                <div class="form-group">
                  <label>Kalimat Penanganan &mdash; DALAM jam kerja</label>
                  <textarea class="form-control" name="customerPenangananTemplate" rows="2"></textarea>
                  <small class="text-muted">Mengisi slot <code>{penanganan}</code> pada template di atas saat gangguan terjadi di dalam jam kerja teknisi.</small>
                </div>
                <div class="form-group">
                  <label>Kalimat Penanganan &mdash; DI LUAR jam kerja</label>
                  <textarea class="form-control" name="customerPenangananLuarJamTemplate" rows="3"></textarea>
                  <small class="text-muted">
                    Dipakai bila gangguan terjadi di luar jam kerja teknisi (mis. kabel putus tengah malam).
                    Placeholder <code>{jam_kerja}</code> &rarr; mis. <i>"besok pada jam kerja (08:00&ndash;17:00 WIB)"</i>.
                    Sengaja RENTANG, bukan jam mulai: menyebut satu jam membuat pelanggan menunggu di jam itu persis,
                    padahal teknisi mendahulukan gangguan yang paling luas. (<code>{waktu_mulai}</code> masih didukung.)
                    <br>Kalau template di atas belum memuat <code>{penanganan}</code>, kalimat ini otomatis
                    disisipkan di atas tanda tangan &mdash; supaya pelanggan tidak pernah dijanjikan
                    penanganan yang belum bisa dikerjakan.
                  </small>
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
  <script src="<?= rafAssetUrl('/js/los-broadcast.js') ?>"></script>

</body>
</html>
