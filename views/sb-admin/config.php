<!DOCTYPE html>
<html lang="en">

<head>

    <?php
    $pageTitle = 'RAF BOT - Config';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>

  <!-- Custom styles for this page -->
  <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css">

  <style>
    .config-nav { display: flex; flex-wrap: wrap; gap: .5rem; margin-bottom: 1.5rem; padding: 0; list-style: none; border: none; }
    .config-nav .nav-link { cursor: pointer; border: 1px solid #d1d3e2; border-radius: .5rem; color: #5a5c69; background: #fff; padding: .5rem 1rem; font-weight: 600; }
    .config-nav .nav-link:hover { background: #eaecf4; }
    .config-nav .nav-link.active { background: #4e73df; color: #fff; border-color: #4e73df; }
    /* dark mode: samakan dengan permukaan tema gelap */
    body.tk-dark .config-nav .nav-link { background: var(--d-surface); color: var(--d-ink-soft); border-color: var(--d-line); }
    body.tk-dark .config-nav .nav-link:hover { background: var(--d-surface-2); color: var(--d-ink); border-color: var(--d-line); }
    body.tk-dark .config-nav .nav-link.active { background: var(--primary); color: #fff; border-color: var(--primary); }
    .config-pane { display: none; }
    .config-pane.active { display: block; }
  </style>

</head>

<body id="page-top">

  <!-- Page Wrapper -->
  <div id="wrapper">

    <!-- Sidebar -->
    <?php include '_navbar.php'; ?>
    <!-- End of Sidebar -->

    <!-- Content Wrapper -->
    <div id="content-wrapper" class="d-flex flex-column">

      <!-- Main Content -->
      <div id="content">

        <!-- Topbar -->
        <?php include 'topbar.php'; ?>
        <!-- End of Topbar -->

        <!-- Begin Page Content -->
        <div class="container-fluid">

          <!-- Page Heading -->
          <!-- Page Header -->
          <div class="dashboard-header">
            <h1>Perbarui Konfigurasi</h1>
            <p>Kelola dan monitor perbarui konfigurasi</p>
          </div>

          <!-- Tab navigation -->
          <ul class="nav config-nav" id="configNav">
            <li><a class="nav-link active" data-pane="pane-mikrotik">MikroTik</a></li>
            <li><a class="nav-link" data-pane="pane-bot">Wifi &amp; Bot</a></li>
            <li><a class="nav-link" data-pane="pane-company">Identitas &amp; Kontak</a></li>
            <li><a class="nav-link" data-pane="pane-welcome">Pesan Selamat Datang</a></li>
            <li><a class="nav-link" data-pane="pane-psb">Intake PSB</a></li>
            <li><a class="nav-link" data-pane="pane-billing">Penagihan &amp; Isolir</a></li>
            <li><a class="nav-link" data-pane="pane-technical">Teknis</a></li>
            <li><a class="nav-link" data-pane="pane-payment">Pembayaran</a></li>
            <li><a class="nav-link" data-pane="pane-backup">Backup Telegram</a></li>
            <li><a class="nav-link" data-pane="pane-olt">OLT</a></li>
          </ul>

          <div id="configForm">

          <!-- Mikrotik Devices Configuration -->
          <div class="config-pane active" id="pane-mikrotik">
          <h4 class="dashboard-section-title">Konfigurasi MikroTik</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Konfigurasi MikroTik</h6>
            </div>
            <div class="card-body">
              <button type="button" class="btn btn-primary mb-3" data-toggle="modal" data-target="#mikrotikDeviceModal" id="addMikrotikDeviceBtn">Tambah Perangkat</button>
              <div class="table-responsive">
                <table class="table table-bordered" id="mikrotikDevicesTable" width="100%" cellspacing="0">
                  <thead>
                    <tr>
                      <th>IP Address</th>
                      <th>Username</th>
                      <th>Status</th>
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    <!-- Data will be populated by JavaScript -->
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          </div><!-- /#pane-mikrotik -->

          <div class="config-pane" id="pane-bot">
            <!-- Table Section -->
          <h4 class="dashboard-section-title">Konfigurasi Wifi & Bot</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Konfigurasi Wifi & Bot</h6>
              </div>
              <div class="card-body">
                  <div class="mb-3">
                    <label for="nama" class="form-label">Nama Wifi</label>
                    <input type="text" class="form-control" id="nama" name="nama" />
                  </div>
                  <div class="mb-3">
                    <label for="namabot" class="form-label">Nama Bot</label>
                    <input type="text" class="form-control" id="namabot" name="namabot" />
                  </div>
                  <div class="mb-3">
                    <label for="telfon" class="form-label">Nomor Telfon Kontak</label>
                    <input type="text" class="form-control" id="telfon" name="telfon" />
                  </div>
                  <div class="mb-3">
                    <label for="adminPhone" class="form-label">Nomor Admin WhatsApp</label>
                    <input type="text" class="form-control" id="adminPhone" name="adminPhone" placeholder="089685645956" />
                    <small class="form-text text-muted">Nomor WhatsApp admin yang akan digunakan di template pesan. Format: 08xxxx atau 628xxxx. Link WhatsApp akan otomatis dibuat dari nomor ini.</small>
                  </div>
                  <div class="mb-3">
                    <label for="parentbinding" class="form-label">Parent Binding</label>
                    <input type="text" class="form-control" id="parentbinding" name="parentbinding" />
                  </div>
                  <div class="mb-3">
                    <label for="custom_wifi_modification">Mode Kustom Ganti WiFi</label>
                    <select class="form-control" id="custom_wifi_modification" name="custom_wifi_modification">
                        <option value="true">Aktif</option>
                        <option value="false">Nonaktif</option>
                    </select>
                    <small class="form-text text-muted">Jika Aktif, bot akan menawarkan pilihan SSID saat pelanggan (yang punya >1 SSID) ingin ganti nama/sandi. Jika Nonaktif, akan langsung mengubah semua SSID.</small>
                  </div>
                  <div class="mb-3">
                    <label for="sync_to_mikrotik">Sinkronisasi ke MikroTik</label>
                    <select class="form-control" id="sync_to_mikrotik" name="sync_to_mikrotik">
                        <option value="true">Aktif</option>
                        <option value="false">Nonaktif</option>
                    </select>
                    <small class="form-text text-muted">Jika Aktif, perubahan profil pelanggan di halaman user akan otomatis disinkronkan ke MikroTik. Jika Nonaktif, perubahan hanya tersimpan di sistem tanpa mempengaruhi data di MikroTik.</small>
                  </div>
                  <div class="mb-3">
                    <label for="whatsapp_message_delay" class="form-label">Delay Pesan WhatsApp (ms)</label>
                    <input type="number" class="form-control" id="whatsapp_message_delay" name="whatsapp_message_delay" min="500" max="5000" step="100" />
                    <small class="form-text text-muted">Jeda waktu (dalam milidetik) antara pengiriman pesan WhatsApp oleh cron jobs. Default: 2000ms (2 detik). Minimum: 500ms. Digunakan untuk mencegah spam dan rate limiting.</small>
                  </div>
                  <div class="mb-3">
                    <label for="defaultPPPoEPassword" class="form-label">Password PPPoE Default</label>
                    <input type="text" class="form-control" id="defaultPPPoEPassword" name="defaultPPPoEPassword" />
                    <small class="form-text text-muted">Password default yang akan digunakan untuk PPPoE saat teknisi melakukan PSB (Pasang Baru) tanpa mengisi password secara manual. Jika kosong, sistem akan generate random password.</small>
                  </div>
              </div>
            </div>

            <div class="card table-card mb-4">
              <div class="card-header">
                <h6>Panduan Pakai Voucher (Halaman Beli Publik)</h6>
              </div>
              <div class="card-body">
                <p class="text-muted" style="font-size:13px">Teks <b>"Cara pakai voucher"</b> yang tampil di halaman beli voucher publik setelah pembayaran berhasil. Kosongkan untuk memakai teks default.</p>
                <div class="mb-3">
                  <label for="voucherGuideSteps" class="form-label">Langkah Pakai Voucher</label>
                  <textarea class="form-control" id="voucherGuideSteps" name="voucherGuideSteps" rows="5" placeholder="Sambungkan HP ke WiFi RAF NET / RAF NET 5G (disarankan RAF NET 5G agar lebih stabil).&#10;Buka browser — halaman login otomatis muncul.&#10;Masukkan kode voucher di atas, lalu tekan Connect."></textarea>
                  <small class="form-text text-muted"><b>1 langkah per baris.</b> Boleh sebut nama WiFi spesifik &amp; rekomendasi (mis. "disarankan konek ke RAF NET 5G agar lebih stabil"). Kosong = pakai 3 langkah default.</small>
                </div>
                <div class="mb-3">
                  <label for="voucherLoginUrl" class="form-label">URL Login Hotspot (opsional)</label>
                  <input type="text" class="form-control" id="voucherLoginUrl" name="voucherLoginUrl" placeholder="http://192.168.88.1 atau http://login.rafnet.net" />
                  <small class="form-text text-muted">Ditampilkan sebagai link "buka URL di browser" kalau halaman login tidak muncul otomatis. Kosong = tidak ditampilkan.</small>
                </div>
              </div>
            </div>

            <div class="d-flex justify-content-end mb-4">
              <button type="button" class="btn btn-primary config-save-btn" data-pane="pane-bot"><i class="fas fa-save"></i> Simpan Wifi &amp; Bot</button>
            </div>
          </div><!-- /#pane-bot -->

          <div class="config-pane" id="pane-company">
          <h4 class="dashboard-section-title">Identitas &amp; Kontak Usaha</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Identitas &amp; Kontak Usaha</h6>
            </div>
            <div class="card-body">
              <p class="text-muted" style="font-size:13px">Data ini ditampilkan di halaman publik <b>FAQ / Kebijakan Refund / Syarat &amp; Ketentuan / Kontak</b> (untuk verifikasi merchant gateway pembayaran seperti iPaymu). Halaman Kontak wajib menampilkan <b>email, telepon, dan alamat usaha</b>.</p>
              <div class="mb-3">
                <label for="company_name">Nama Usaha</label>
                <input type="text" class="form-control" id="company_name" name="company_name" placeholder="Contoh: VANS 45 NET" />
                <small class="form-text text-muted">Nama usaha yang tampil di halaman publik. Juga dipakai sebagai nama brand.</small>
              </div>
              <div class="mb-3">
                <label for="company_phone">Nomor Telepon / WhatsApp</label>
                <input type="text" class="form-control" id="company_phone" name="company_phone" placeholder="Contoh: 08123456789" />
                <small class="form-text text-muted">Nomor kontak resmi yang tampil di halaman Kontak (wajib untuk verifikasi gateway).</small>
              </div>
              <div class="mb-3">
                <label for="company_email">Email</label>
                <input type="email" class="form-control" id="company_email" name="company_email" placeholder="Contoh: usaha@email.com" />
                <small class="form-text text-muted">Email resmi usaha (wajib untuk verifikasi gateway).</small>
              </div>
              <div class="mb-3">
                <label for="company_address">Alamat Usaha</label>
                <input type="text" class="form-control" id="company_address" name="company_address" placeholder="Alamat lengkap usaha" />
                <small class="form-text text-muted">Alamat usaha yang tampil di halaman Kontak (wajib untuk verifikasi gateway).</small>
              </div>
              <div class="mb-3">
                <label for="company_website">Website (opsional)</label>
                <input type="text" class="form-control" id="company_website" name="company_website" placeholder="https://..." />
                <small class="form-text text-muted">Alamat website utama, jika ada. Kosongkan bila tidak ada.</small>
              </div>
            </div>
          </div>
          <div class="d-flex justify-content-end mb-4">
            <button type="button" class="btn btn-primary config-save-btn" data-pane="pane-company"><i class="fas fa-save"></i> Simpan Identitas &amp; Kontak</button>
          </div>
          </div><!-- /#pane-company -->

          <div class="config-pane" id="pane-welcome">
            <!-- Table Section -->
          <h4 class="dashboard-section-title">Konfigurasi Pesan Selamat Datang</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Konfigurasi Pesan Selamat Datang</h6>
              </div>
              <div class="card-body">
                  <div class="mb-3">
                    <label for="welcomeMessageEnabled">Aktifkan Pesan Selamat Datang</label>
                    <select class="form-control" id="welcomeMessageEnabled" name="welcomeMessageEnabled">
                        <option value="true">Aktif</option>
                        <option value="false">Nonaktif</option>
                    </select>
                    <small class="form-text text-muted">Jika Aktif, pesan selamat datang akan otomatis dikirim ke pelanggan baru saat mereka dibuat (baik dari web admin atau setup teknisi). Pesan berisi username, password, dan URL portal pelanggan.</small>
                  </div>
                  <div class="mb-3">
                    <label for="customerPortalUrl" class="form-label">URL Portal Pelanggan</label>
                    <input type="text" class="form-control" id="customerPortalUrl" name="customerPortalUrl" placeholder="https://rafnet.my.id/customer" />
                    <small class="form-text text-muted">URL portal pelanggan yang akan ditampilkan di pesan selamat datang. Pelanggan dapat menggunakan URL ini untuk login ke portal pelanggan.</small>
                  </div>
              </div>
            </div>

            <div class="d-flex justify-content-end mb-4">
              <button type="button" class="btn btn-primary config-save-btn" data-pane="pane-welcome"><i class="fas fa-save"></i> Simpan Pesan Selamat Datang</button>
            </div>
          </div><!-- /#pane-welcome -->

          <div class="config-pane" id="pane-psb">
          <h4 class="dashboard-section-title">Intake PSB (via DM Teknisi)</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Intake PSB via DM Teknisi</h6>
            </div>
            <div class="card-body">
                <div class="mb-3">
                  <label for="psbIntakeEnabled">Aktifkan Intake PSB</label>
                  <select class="form-control" id="psbIntakeEnabled" name="psbIntakeEnabled">
                      <option value="false">Nonaktif</option>
                      <option value="true">Aktif</option>
                  </select>
                  <small class="form-text text-muted">Jika Aktif, teknisi cukup <b>DM (japri) bot ini</b> (bot area masing-masing) dengan <b>foto KTP + caption</b> (diawali <code>#PSB</code>) berisi Nama, Paket, WiFi, Sandi, No HP. Bot memandu: kirim foto rumah + share lokasi → bot baca SN modem dari GenieACS untuk <b>dicocokkan teknisi (YA/TIDAK)</b> → hanya setelah <b>YA</b> bot buat pelanggan + push PPPoE &amp; WiFi ke modem + kirim welcome. Hanya akun teknisi/admin/owner yang dilayani.</small>
                </div>
                <div class="mb-3">
                  <label for="psbIntakeGroupId">Grup Ringkasan PSB (opsional)</label>
                  <div class="d-flex" style="gap:.5rem;">
                    <select class="form-control" id="psbIntakeGroupId" name="psbIntakeGroupId" style="flex:1;">
                        <option value="">— tidak ada / pilih grup —</option>
                    </select>
                    <button type="button" class="btn btn-outline-primary" id="btnLoadPsbGroups" style="white-space:nowrap;"><i class="fas fa-sync"></i> Muat Grup</button>
                  </div>
                  <small class="form-text text-muted">Grup tempat bot <b>posting ringkasan hasil PSB</b> ("✅ PSB selesai …") untuk visibility tim/admin — <b>bukan</b> tempat input (input via DM). Klik <b>Muat Grup</b> (bot harus online), lalu pilih grup PSB bersama. Kosongkan bila tak perlu ringkasan.</small>
                </div>
                <div class="mb-3">
                  <label for="psbIntakeRecency">Window deteksi modem (menit)</label>
                  <input type="number" class="form-control" id="psbIntakeRecency" name="psbIntakeRecency" min="5" max="1440" placeholder="120" />
                  <small class="form-text text-muted">Bot menganggap "modem baru dipasang" = modem yang registrasi ke GenieACS dalam N menit terakhir (default 120). Perbesar bila ACS sering telat inform.</small>
                </div>
                <div class="mb-3">
                  <label for="psbIntakeDusunList">Daftar Dusun (pilihan bernomor di WA)</label>
                  <textarea class="form-control" id="psbIntakeDusunList" name="psbIntakeDusunList" rows="3" placeholder="Ngitik, Karang, Krajan"></textarea>
                  <small class="form-text text-muted">Pisah dengan <b>koma</b> atau <b>baris baru</b>. Teknisi memilih dusun dengan <b>balas angka</b> — urutan di sini = nomor pilihannya. Ini penting: dusun ikut jadi bagian <b>username PPPoE yang permanen</b>, jadi salah ketik (<code>ngitik</code> vs <code>ngitk</code>) menetap selamanya. Kosongkan bila ingin teknisi mengetik dusun bebas.</small>
                </div>
                <div class="row">
                  <div class="col-md-6 mb-3">
                    <label for="psbIntakeDesa">Desa</label>
                    <input type="text" class="form-control" id="psbIntakeDesa" name="psbIntakeDesa" placeholder="Tanjungharjo" />
                  </div>
                  <div class="col-md-6 mb-3">
                    <label for="psbIntakeKecamatan">Kecamatan</label>
                    <input type="text" class="form-control" id="psbIntakeKecamatan" name="psbIntakeKecamatan" placeholder="Kapas" />
                  </div>
                </div>
                <div class="mb-3">
                  <small class="form-text text-muted">Desa &amp; Kecamatan dipakai bot untuk <b>merakit alamat pelanggan</b>: <code>Dsn. Ngitik RT 014 RW 002 Ds. Tanjungharjo Kec. Kapas</code>. Teknisi hanya mengetik <b>RT/RW</b> (mis. <code>14/2</code>) — sisanya otomatis.</small>
                </div>
                <div class="mb-3">
                  <label for="psbIntakeFreeInstallMonth">Gratis Bulan Pemasangan (otomatis saat PSB selesai)</label>
                  <select class="form-control" id="psbIntakeFreeInstallMonth" name="psbIntakeFreeInstallMonth">
                      <option value="false">Nonaktif</option>
                      <option value="true">Aktif</option>
                  </select>
                  <small class="form-text text-muted">Jika <b>Aktif</b>, setiap pelanggan PSB baru otomatis <b>dibebaskan tagihan bulan pemasangan</b>: periode ini dihitung lunas (kebal isolir) <b>tanpa masuk pemasukan</b>, dan pelanggan mulai bayar <b>bulan depan</b>. Hanya berlaku untuk paket bertagihan. Untuk pelanggan yang <b>sudah terlanjur</b> terpasang, pakai halaman <b>Pembayaran → Gratis Bulan Ini</b>.</small>
                </div>

                <hr>
                <h6 class="mb-2" style="font-weight:700;">Notifikasi Perbaikan &amp; Tutorial Teknisi</h6>
                <div class="mb-3">
                  <label for="repairNotifEnabled">Notif Perbaikan ke Grup</label>
                  <select class="form-control" id="repairNotifEnabled" name="repairNotifEnabled">
                      <option value="false">Nonaktif</option>
                      <option value="true">Aktif</option>
                  </select>
                  <small class="form-text text-muted">Jika Aktif, bot otomatis posting ke grup perbaikan saat <b>tiket baru masuk</b> ("🔧 Tiket baru…") dan <b>tiket selesai</b> ("✅ Selesai…", berisi teknisi + durasi). Papan pengumuman perbaikan untuk tim/admin.</small>
                </div>
                <div class="mb-3">
                  <label for="repairNotifGroupId">Grup Perbaikan (terpisah dari grup PSB)</label>
                  <div class="d-flex" style="gap:.5rem;">
                    <select class="form-control" id="repairNotifGroupId" name="repairNotifGroupId" style="flex:1;">
                        <option value="">— tidak ada / pilih grup —</option>
                    </select>
                    <button type="button" class="btn btn-outline-primary" id="btnLoadPsbGroups2" style="white-space:nowrap;"><i class="fas fa-sync"></i> Muat Grup</button>
                  </div>
                  <small class="form-text text-muted">Grup khusus notifikasi perbaikan. Klik <b>Muat Grup</b> (bot online), lalu pilih. Bisa sama atau beda dengan grup PSB.</small>
                </div>
                <div class="mb-3">
                  <label for="teknisiTutorialUrl">Link Tutorial Teknisi</label>
                  <input type="text" class="form-control" id="teknisiTutorialUrl" name="teknisiTutorialUrl" placeholder="https://…" />
                  <small class="form-text text-muted">Link halaman panduan bergambar. Dikirim bot saat teknisi ketik <code>panduan teknisi</code> / <code>tutorial teknisi</code>.</small>
                </div>
            </div>
          </div>
          <div class="d-flex justify-content-end mb-4">
            <button type="button" class="btn btn-primary config-save-btn" data-pane="pane-psb"><i class="fas fa-save"></i> Simpan Intake PSB</button>
          </div>
          </div><!-- /#pane-psb -->

          <div class="config-pane" id="pane-billing">
            <!-- Table Section -->
          <h4 class="dashboard-section-title">Konfigurasi Penagihan & Isolir</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Konfigurasi Penagihan & Isolir</h6>
              </div>
              <div class="card-body">
                  <div class="mb-3">
                    <label for="tanggal_pengingat" class="form-label">Tanggal Pengingat Tagihan (1-28)</label>
                    <input type="number" class="form-control" id="tanggal_pengingat" name="tanggal_pengingat" min="1" max="28" />
                    <small class="form-text text-muted">Notifikasi pengingat akan dikirim mulai tanggal ini setiap bulan.</small>
                  </div>
                  <div class="mb-3">
                    <label for="tanggal_batas_bayar" class="form-label">Tanggal Batas Pembayaran (1-28)</label>
                    <input type="number" class="form-control" id="tanggal_batas_bayar" name="tanggal_batas_bayar" min="1" max="28" />
                     <small class="form-text text-muted">Tanggal terakhir pembayaran. Digunakan sebagai `dueDate` di API.</small>
                  </div>
                  <div class="mb-3">
                    <label for="teknisiCollectionCommissionEnabled" class="form-label">Komisi Collection Teknisi</label>
                    <select class="form-control" id="teknisiCollectionCommissionEnabled" name="teknisiCollectionCommissionEnabled">
                      <option value="true">Aktif</option>
                      <option value="false">Nonaktif</option>
                    </select>
                    <small class="form-text text-muted">Jika aktif, teknisi mendapat komisi otomatis saat pelanggan periode berjalan benar-benar lunas.</small>
                  </div>
                  <div class="mb-3">
                    <label for="teknisiCollectionCommissionAmount" class="form-label">Nominal Komisi Per Pelanggan</label>
                    <input type="number" class="form-control" id="teknisiCollectionCommissionAmount" name="teknisiCollectionCommissionAmount" min="0" step="500" />
                    <small class="form-text text-muted">Nominal komisi collection yang didapat teknisi per pelanggan lunas. Contoh: 5000.</small>
                  </div>
                  <div class="mb-3">
                    <label for="agenCollectionCommissionEnabled" class="form-label">Komisi Collection Agen</label>
                    <select class="form-control" id="agenCollectionCommissionEnabled" name="agenCollectionCommissionEnabled">
                      <option value="true">Aktif</option>
                      <option value="false">Nonaktif</option>
                    </select>
                    <small class="form-text text-muted">Jika aktif, agen mendapat fee otomatis saat pelanggan yang ditagihnya benar-benar lunas. Terpisah dari komisi teknisi.</small>
                  </div>
                  <div class="mb-3">
                    <label for="agenCollectionCommissionAmount" class="form-label">Nominal Fee Agen Per Pelanggan</label>
                    <input type="number" class="form-control" id="agenCollectionCommissionAmount" name="agenCollectionCommissionAmount" min="0" step="500" />
                    <small class="form-text text-muted">Nominal fee yang didapat agen per pelanggan lunas. Contoh: 5000.</small>
                  </div>
                  <div class="mb-3">
                    <label for="tanggal_isolir" class="form-label">Tanggal Isolir (1-28)</label>
                    <input type="number" class="form-control" id="tanggal_isolir" name="tanggal_isolir" min="1" max="28" />
                     <small class="form-text text-muted">Pelanggan yang belum bayar akan diisolir mulai tanggal ini.</small>
                  </div>
                  <div class="mb-3">
                    <label for="isolir_profile" class="form-label">Profil PPPoE Isolir</label>
                    <input type="text" class="form-control" id="isolir_profile" name="isolir_profile" />
                    <small class="form-text text-muted">Nama profil di MikroTik untuk pelanggan yang diisolir.</small>
                  </div>
                  <div class="mb-3">
                    <label for="isolirFeatureEnabled" class="form-label">Fitur Isolir</label>
                    <select class="form-control" id="isolirFeatureEnabled" name="isolirFeatureEnabled">
                      <option value="true">Aktif</option>
                      <option value="false">Nonaktif</option>
                    </select>
                    <small class="form-text text-muted">Jika nonaktif, cron isolir dan isolir manual tidak dijalankan.</small>
                  </div>
                  <div class="mb-3">
                    <label for="isolirManualEnabled" class="form-label">Isolir Manual</label>
                    <select class="form-control" id="isolirManualEnabled" name="isolirManualEnabled">
                      <option value="true">Aktif</option>
                      <option value="false">Nonaktif</option>
                    </select>
                    <small class="form-text text-muted">Aktifkan halaman custom isolir untuk tindakan manual oleh admin.</small>
                  </div>
                  <div class="mb-3">
                    <label for="isolirManualDefaultProfile" class="form-label">Default Profile Custom Isolir</label>
                    <input type="text" class="form-control" id="isolirManualDefaultProfile" name="isolirManualDefaultProfile" />
                    <small class="form-text text-muted">Profile default untuk isolir manual. Default aman: profile isolir utama.</small>
                  </div>
                  <div class="mb-3">
                    <label for="isolirManualAllowCustomProfile" class="form-label">Izinkan Custom Profile Saat Isolir Manual</label>
                    <select class="form-control" id="isolirManualAllowCustomProfile" name="isolirManualAllowCustomProfile">
                      <option value="true">Aktif</option>
                      <option value="false">Nonaktif</option>
                    </select>
                    <small class="form-text text-muted">Jika nonaktif, admin hanya bisa memakai default profile isolir manual.</small>
                  </div>
                  <div class="mb-3">
                    <label for="isolirManualDefaultDisconnect" class="form-label">Default Disconnect Saat Isolir Manual</label>
                    <select class="form-control" id="isolirManualDefaultDisconnect" name="isolirManualDefaultDisconnect">
                      <option value="true">Aktif</option>
                      <option value="false">Nonaktif</option>
                    </select>
                  </div>
                  <div class="mb-3">
                    <label for="isolirManualDefaultReboot" class="form-label">Default Reboot Saat Isolir Manual</label>
                    <select class="form-control" id="isolirManualDefaultReboot" name="isolirManualDefaultReboot">
                      <option value="true">Aktif</option>
                      <option value="false">Nonaktif</option>
                    </select>
                    <small class="form-text text-muted">Reboot hanya akan dicoba jika device_id ada dan capability reboot admin GenieACS tersedia.</small>
                  </div>
                  <div class="mb-3">
                    <label for="isolirOpenDefaultReboot" class="form-label">Default Reboot Saat Buka Isolir</label>
                    <select class="form-control" id="isolirOpenDefaultReboot" name="isolirOpenDefaultReboot">
                      <option value="true">Aktif</option>
                      <option value="false">Nonaktif</option>
                    </select>
                  </div>
              </div>
            </div>

            <!-- Bank Accounts Section -->
            <div class="card shadow mb-4">
              <div class="card-header py-3 d-flex justify-content-between align-items-center">
                <h6 class="m-0 font-weight-bold text-primary">Rekening Bank</h6>
                <button type="button" class="btn btn-sm btn-success" onclick="addBankAccount()">
                  <i class="fas fa-plus"></i> Tambah Rekening
                </button>
              </div>
              <div class="card-body">
                <div id="bankAccountsList">
                  <!-- Bank accounts will be populated here -->
                </div>
                <small class="form-text text-muted">Rekening bank yang akan ditampilkan untuk pembayaran transfer.</small>
              </div>
            </div>

            <div class="d-flex justify-content-end mb-4">
              <button type="button" class="btn btn-primary config-save-btn" data-pane="pane-billing"><i class="fas fa-save"></i> Simpan Penagihan &amp; Isolir</button>
            </div>
          </div><!-- /#pane-billing -->

          <div class="config-pane" id="pane-technical">
            <!-- Table Section -->
          <h4 class="dashboard-section-title">Konfigurasi Teknis</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Konfigurasi Teknis</h6>
              </div>
              <div class="card-body">
                  <div class="mb-3">
                    <label for="site_url_bot" class="form-label">Site URL Bot (Internal)</label>
                    <input type="text" class="form-control" id="site_url_bot" name="site_url_bot" placeholder="http://127.0.0.1:3100" />
                    <small class="form-text text-muted">Alamat INTERNAL untuk koneksi Node ke MikroTik via PHP. Biarkan localhost. Contoh: http://127.0.0.1:3100</small>
                  </div>
                  <div class="mb-3">
                    <label for="public_url" class="form-label">URL Publik (Link Pembayaran Pelanggan)</label>
                    <input type="text" class="form-control" id="public_url" name="public_url" placeholder="https://dander.rafnet.my.id" />
                    <small class="form-text text-muted">Domain publik (Cloudflare/tunnel) untuk link bayar yang dikirim ke pelanggan. Beda dari Site URL Bot internal. Kosongkan = otomatis dari host Callback iPaymu.</small>
                  </div>
                  <div class="mb-3">
                    <label for="genieacsBaseUrl" class="form-label">Genieacs URL</label>
                    <input type="text" class="form-control" id="genieacsBaseUrl" name="genieacsBaseUrl" />
                  </div>
                  <div class="card border-left-info shadow-sm mb-3">
                    <div class="card-body py-3">
                      <div class="d-flex justify-content-between align-items-center mb-2">
                        <strong>Capability & Integrasi GenieACS</strong>
                        <span class="badge badge-secondary" id="genieacsCapabilityBadge">Memuat...</span>
                      </div>
                      <div class="small text-muted" id="genieacsCapabilityReason">Status integrasi sedang diperiksa.</div>
                    </div>
                  </div>
                  <div class="mb-3">
                    <label for="genieacsEnabled" class="form-label">GenieACS Global</label>
                    <select class="form-control" id="genieacsEnabled" name="genieacsEnabled">
                      <option value="true">Aktif</option>
                      <option value="false">Nonaktif</option>
                    </select>
                  </div>
                  <div class="mb-3">
                    <label for="genieacsCustomerRebootEnabled" class="form-label">Reboot Pelanggan</label>
                    <select class="form-control" id="genieacsCustomerRebootEnabled" name="genieacsCustomerRebootEnabled">
                      <option value="true">Aktif</option>
                      <option value="false">Nonaktif</option>
                    </select>
                  </div>
                  <div class="mb-3">
                    <label for="genieacsAdminRebootEnabled" class="form-label">Reboot Admin / Sistem</label>
                    <select class="form-control" id="genieacsAdminRebootEnabled" name="genieacsAdminRebootEnabled">
                      <option value="true">Aktif</option>
                      <option value="false">Nonaktif</option>
                    </select>
                  </div>
                  <div class="mb-3">
                    <label for="genieacsWifiManagementEnabled" class="form-label">Manajemen WiFi</label>
                    <select class="form-control" id="genieacsWifiManagementEnabled" name="genieacsWifiManagementEnabled">
                      <option value="true">Aktif</option>
                      <option value="false">Nonaktif</option>
                    </select>
                  </div>
                  <div class="mb-3">
                    <label for="genieacsPsbDeviceProvisioningEnabled" class="form-label">Provisioning PSB</label>
                    <select class="form-control" id="genieacsPsbDeviceProvisioningEnabled" name="genieacsPsbDeviceProvisioningEnabled">
                      <option value="true">Aktif</option>
                      <option value="false">Nonaktif</option>
                    </select>
                  </div>
                  <div class="mb-3">
                    <label for="accessLimit" class="form-label">Maksimal akses</label>
                    <input type="number" class="form-control" id="accessLimit" name="accessLimit" />
                  </div>
                  <div class="mb-3">
                    <label for="rx_tolerance">Toleransi Redaman</label>
                    <input type="number" class="form-control" id="rx_tolerance" name="rx_tolerance" />
                  </div>

                  <hr>
                  <div class="mb-3">
                    <label for="defaultBulkSSID" class="form-label">Default SSID Bulk</label>
                    <input type="number" class="form-control" id="defaultBulkSSID" name="defaultBulkSSID" min="1" max="8" />
                    <small class="form-text text-muted">SSID default yang akan otomatis tercentang saat membuat user baru jika tidak ada SSID yang dipilih. Range: 1-8 (default: 1)</small>
                  </div>
                  <div class="mb-3">
                    <label for="speedOnDemandEnabled" class="form-label">Speed On Demand</label>
                    <select class="form-control" id="speedOnDemandEnabled" name="speedOnDemandEnabled">
                      <option value="true">Aktif</option>
                      <option value="false">Nonaktif</option>
                    </select>
                    <small class="form-text text-muted">Aktifkan atau nonaktifkan fitur Speed On Demand untuk pelanggan</small>
                  </div>
                  <div class="mb-3">
                    <label for="showPaymentStatus" class="form-label">Tampilkan Status Pembayaran</label>
                    <select class="form-control" id="showPaymentStatus" name="showPaymentStatus">
                      <option value="true">Tampilkan</option>
                      <option value="false">Sembunyikan</option>
                    </select>
                    <small class="form-text text-muted">Tampilkan atau sembunyikan status pembayaran (PAID/UNPAID) di profil pelanggan</small>
                  </div>
                  <div class="mb-3">
                    <label for="showDueDate" class="form-label">Tampilkan Jatuh Tempo</label>
                    <select class="form-control" id="showDueDate" name="showDueDate">
                      <option value="true">Tampilkan</option>
                      <option value="false">Sembunyikan</option>
                    </select>
                    <small class="form-text text-muted">Tampilkan atau sembunyikan tanggal jatuh tempo pembayaran di profil pelanggan</small>
                  </div>
                  <div class="mb-3">
                    <label for="customerTrafficUsageEnabled" class="form-label">Traffic Usage Portal Pelanggan</label>
                    <select class="form-control" id="customerTrafficUsageEnabled" name="customerTrafficUsageEnabled">
                      <option value="true">Aktif</option>
                      <option value="false">Nonaktif</option>
                    </select>
                    <small class="form-text text-muted">Aktifkan atau nonaktifkan fitur pemakaian trafik harian dan bulanan di portal pelanggan</small>
                  </div>
                  <div class="mb-3">
                    <label for="customerTrafficLiveEnabled" class="form-label">Bandwidth Live Portal Pelanggan</label>
                    <select class="form-control" id="customerTrafficLiveEnabled" name="customerTrafficLiveEnabled">
                      <option value="true">Aktif</option>
                      <option value="false">Nonaktif</option>
                    </select>
                    <small class="form-text text-muted">Aktifkan atau nonaktifkan bandwidth live pelanggan. Fitur ini terpisah dari usage harian/bulanan untuk kontrol beban MikroTik yang lebih presisi.</small>
                  </div>
              </div>
            </div>

            <div class="d-flex justify-content-end mb-4">
              <button type="button" class="btn btn-primary config-save-btn" data-pane="pane-technical"><i class="fas fa-save"></i> Simpan Konfigurasi Teknis</button>
            </div>
          </div><!-- /#pane-technical -->

          <div class="config-pane" id="pane-payment">
          <h4 class="dashboard-section-title">Konfigurasi Pembayaran (Payment Gateway)</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Payment Gateway — iPaymu / Tripay / Mayar</h6>
            </div>
            <div class="card-body">
                  <p class="text-muted" style="font-size:13px">Kredensial gateway pembayaran. <b>iPaymu</b> dipakai untuk voucher &amp; topup; <b>Payment Gateway Aktif</b> di bawah menentukan gateway untuk <b>bayar tagihan</b>. Dipisah dari tab Teknis agar tidak tercampur konfigurasi teknis lain.</p>
                  <div class="mb-3">
                    <label for="ipaymuSecret">Secret Ipaymu</label>
                    <input type="text" class="form-control" id="ipaymuSecret" name="ipaymuSecret" />
                  </div>
                  <div class="mb-3">
                    <label for="ipaymuVA">VA Ipaymu</label>
                    <input type="text" class="form-control" id="ipaymuVA" name="ipaymuVA" />
                  </div>
                  <div class="mb-3">
                    <label for="ipaymuCallback">Callback Ipaymu</label>
                    <input type="text" class="form-control" id="ipaymuCallback" name="ipaymuCallback" />
                  </div>
                  <div class="mb-3">
                    <label for="ipaymuProduction">Production Ipaymu</label>
                    <input type="text" class="form-control" id="ipaymuProduction" name="ipaymuProduction" />
                  </div>
                  <hr>
                  <div class="mb-3">
                    <label for="paymentGateway" class="form-label">Payment Gateway Aktif (Bayar Tagihan)</label>
                    <select class="form-control" id="paymentGateway" name="paymentGateway">
                      <option value="ipaymu">iPaymu</option>
                      <option value="tripay">Tripay</option>
                      <option value="mayar">Mayar</option>
                    </select>
                    <small class="form-text text-muted">Gateway untuk halaman bayar tagihan. <b>Tripay/Mayar auto-settle</b> (dana cair otomatis, tanpa "Unsettled/klarifikasi" seperti iPaymu).</small>
                  </div>
                  <div class="mb-3">
                    <label for="tripayApiKey">API Key Tripay</label>
                    <input type="text" class="form-control" id="tripayApiKey" name="tripayApiKey" />
                  </div>
                  <div class="mb-3">
                    <label for="tripayPrivateKey">Private Key Tripay</label>
                    <input type="text" class="form-control" id="tripayPrivateKey" name="tripayPrivateKey" />
                  </div>
                  <div class="mb-3">
                    <label for="tripayMerchantCode">Merchant Code Tripay</label>
                    <input type="text" class="form-control" id="tripayMerchantCode" name="tripayMerchantCode" />
                  </div>
                  <div class="mb-3">
                    <label for="tripayProduction">Production Tripay</label>
                    <select class="form-control" id="tripayProduction" name="tripayProduction">
                      <option value="no">no (sandbox)</option>
                      <option value="yes">yes (produksi)</option>
                    </select>
                  </div>
                  <div class="mb-3">
                    <label for="tripayDefaultMethod">Metode Default Tripay</label>
                    <input type="text" class="form-control" id="tripayDefaultMethod" name="tripayDefaultMethod" placeholder="QRIS" />
                    <small class="form-text text-muted">Channel default saat redirect (mis. QRIS / BRIVA / BNIVA). Kosong = QRIS.</small>
                  </div>
                  <div class="mb-3">
                    <label for="mayarApiKey">API Key Mayar (Produksi)</label>
                    <input type="text" class="form-control" id="mayarApiKey" name="mayarApiKey" />
                    <small class="form-text text-muted">Dari web.mayar.id → Integration → API Key (untuk api.mayar.id).</small>
                  </div>
                  <div class="mb-3">
                    <label for="mayarSandboxApiKey">API Key Mayar (Sandbox)</label>
                    <input type="text" class="form-control" id="mayarSandboxApiKey" name="mayarSandboxApiKey" />
                    <small class="form-text text-muted">Dari web.mayar.club (sandbox, untuk api.mayar.club). Untuk uji coba tanpa uang asli.</small>
                  </div>
                  <div class="mb-3">
                    <label for="mayarSandbox">Mode Mayar</label>
                    <select class="form-control" id="mayarSandbox" name="mayarSandbox">
                      <option value="yes">Sandbox (api.mayar.club)</option>
                      <option value="no">Produksi (api.mayar.id)</option>
                    </select>
                    <small class="form-text text-muted">Sandbox memakai <b>API Key Sandbox</b> di atas. Ganti ke Produksi hanya setelah uji sandbox lolos.</small>
                  </div>
            </div>
          </div>
          <div class="d-flex justify-content-end mb-4">
            <button type="button" class="btn btn-primary config-save-btn" data-pane="pane-payment"><i class="fas fa-save"></i> Simpan Konfigurasi Pembayaran</button>
          </div>
          </div><!-- /#pane-payment -->

          <div class="config-pane" id="pane-backup">
            <!-- Telegram Backup Configuration -->
            <h4 class="dashboard-section-title">Backup Database ke Telegram</h4>
            <div class="card table-card mb-4">
              <div class="card-header d-flex justify-content-between align-items-center">
                <h6>Konfigurasi Backup Telegram</h6>
                <div>
                  <button type="button" class="btn btn-info btn-sm mr-2" id="testTelegramBtn">
                    <i class="fas fa-paper-plane"></i> Test Koneksi
                  </button>
                  <button type="button" class="btn btn-success btn-sm" id="runBackupBtn">
                    <i class="fas fa-cloud-upload-alt"></i> Backup Sekarang
                  </button>
                </div>
              </div>
              <div class="card-body">
                <div class="alert alert-info">
                  <i class="fas fa-info-circle"></i> 
                  <strong>Cara mendapatkan Bot Token & Chat ID:</strong>
                  <ol class="mb-0 mt-2">
                    <li>Buat bot baru di <a href="https://t.me/BotFather" target="_blank">@BotFather</a> dan dapatkan Bot Token</li>
                    <li>Untuk Chat ID pribadi: kirim pesan ke bot Anda, lalu buka <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code></li>
                    <li>Untuk Group: tambahkan bot ke group, kirim pesan, lalu cek getUpdates (Chat ID group biasanya negatif, contoh: -123456789)</li>
                  </ol>
                </div>
                <div class="mb-3">
                  <label for="telegramBotToken" class="form-label">Bot Token</label>
                  <input type="text" class="form-control" id="telegramBotToken" placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz" />
                  <small class="form-text text-muted">Token bot Telegram dari @BotFather</small>
                </div>
                <div class="mb-3">
                  <label for="telegramChatId" class="form-label">Chat ID</label>
                  <input type="text" class="form-control" id="telegramChatId" placeholder="123456789 atau -123456789" />
                  <small class="form-text text-muted">ID chat/group Telegram untuk menerima backup. Gunakan angka negatif untuk group.</small>
                </div>
                <div class="mb-3">
                  <label for="telegramBackupEnabled" class="form-label">Status Integrasi Telegram Backup</label>
                  <select class="form-control" id="telegramBackupEnabled" name="telegramBackupEnabled">
                    <option value="true">Aktif</option>
                    <option value="false">Nonaktif</option>
                  </select>
                  <small class="form-text text-muted">Toggle ini hanya mengaktifkan integrasi Telegram. Jadwal dan status cron backup otomatis dikelola di halaman Cron Jobs.</small>
                </div>
                <div class="d-flex justify-content-end">
                  <button type="button" class="btn btn-primary" id="saveTelegramConfigBtn">
                    <i class="fas fa-save"></i> Simpan Konfigurasi Telegram
                  </button>
                </div>
              </div>
            </div>

          </div><!-- /#pane-backup -->

          <div class="config-pane" id="pane-olt">
            <!-- OLT Configuration -->
            <h4 class="dashboard-section-title">Konfigurasi OLT</h4>
            
            <!-- Global OLT Settings -->
            <div class="card table-card mb-4">
              <div class="card-header">
                <h6>Pengaturan Global OLT</h6>
              </div>
              <div class="card-body">
                <div class="alert alert-info">
                  <i class="fas fa-info-circle"></i> 
                  <strong>Informasi OLT:</strong>
                  <p class="mb-0 mt-2">Konfigurasi ini digunakan untuk mengambil data redaman (RX Power), status ONT, Dying Gasp, dan LOS dari OLT via SNMP. Data akan ditampilkan di halaman Pelanggan Teknisi.</p>
                </div>
                
                <div class="mb-3">
                  <label for="oltEnabled" class="form-label">Status OLT</label>
                  <select class="form-control" id="oltEnabled" name="oltEnabled">
                    <option value="true">Aktif</option>
                    <option value="false">Nonaktif</option>
                  </select>
                  <small class="form-text text-muted">Aktifkan untuk mengambil data dari OLT</small>
                </div>
                
                <hr class="my-4">
                <h6 class="text-primary mb-3"><i class="fas fa-globe"></i> Deteksi LOS/Dying Gasp (Web Scraping)</h6>
                <div class="alert alert-warning">
                  <i class="fas fa-exclamation-triangle"></i> 
                  <strong>Fitur Deteksi LOS/Dying Gasp:</strong>
                  <p class="mb-0 mt-2">Sistem akan scrape log dari web interface OLT untuk mendeteksi perbedaan antara LOS (fiber putus) dan Dying Gasp (adaptor mati). Pastikan kredensial web OLT sudah benar di setiap device.</p>
                </div>
                
                <div class="mb-3">
                  <label for="oltWebEnabled" class="form-label">Aktifkan Deteksi LOS/Dying Gasp</label>
                  <select class="form-control" id="oltWebEnabled" name="oltWebEnabled">
                    <option value="false">Nonaktif</option>
                    <option value="true">Aktif</option>
                  </select>
                  <small class="form-text text-muted">Aktifkan untuk scrape log OLT dan deteksi LOS/Dying Gasp secara akurat</small>
                </div>
                
                <div class="mb-3">
                  <label for="oltTimeWindow" class="form-label">Time Window (menit)</label>
                  <input type="number" class="form-control" id="oltTimeWindow" placeholder="10" min="1" max="60" />
                  <small class="form-text text-muted">
                    Hanya proses log dalam X menit terakhir. Berguna untuk OLT yang waktu nya tidak sinkron. 
                    Default: 10 menit.
                  </small>
                </div>
                
                <div class="mb-3">
                  <label for="oltScrapeInterval" class="form-label">Interval Scraping (menit)</label>
                  <input type="number" class="form-control" id="oltScrapeInterval" placeholder="1" min="1" max="60" />
                  <small class="form-text text-muted">
                    Seberapa sering scraper mengambil log dari OLT. Default: 1 menit. 
                    Semakin kecil interval, semakin cepat deteksi tapi lebih banyak request ke OLT.
                  </small>
                </div>
                
                <div class="mb-3">
                  <label for="oltMaxLogPages" class="form-label">Max Log Pages</label>
                  <input type="number" class="form-control" id="oltMaxLogPages" placeholder="3" min="1" max="10" />
                  <small class="form-text text-muted">
                    Berapa halaman log yang akan di-scrape. Default: 3 halaman. 
                    Berguna saat mati listrik massal agar semua log terdeteksi. 1 page ≈ 15-20 log.
                  </small>
                </div>
                
                <div class="mb-3">
                  <button type="button" class="btn btn-warning btn-sm" id="debugScrapeBtn">
                    <i class="fas fa-bug"></i> Debug Scrape Log
                  </button>
                  <small class="text-muted ml-2">
                    Trigger manual scraping untuk melihat log detail di console browser dan server.
                  </small>
                </div>
                
                <div class="d-flex justify-content-end">
                  <button type="button" class="btn btn-primary" id="saveOltGlobalConfigBtn">
                    <i class="fas fa-save"></i> Simpan Pengaturan Global
                  </button>
                </div>
              </div>
            </div>
            
            <!-- OLT Devices List -->
            <div class="card table-card mb-4">
              <div class="card-header">
                <h6>Daftar Perangkat OLT</h6>
              </div>
              <div class="card-body">
                <button type="button" class="btn btn-primary mb-3" data-toggle="modal" data-target="#oltDeviceModal" id="addOltDeviceBtn">
                  <i class="fas fa-plus"></i> Tambah OLT
                </button>
                <div class="table-responsive">
                  <table class="table table-bordered" id="oltDevicesTable" width="100%" cellspacing="0">
                    <thead>
                      <tr>
                        <th>Nama</th>
                        <th>IP Address</th>
                        <th>Merk</th>
                        <th>SNMP</th>
                        <th>SSH</th>
                        <th>ACS</th>
                        <th>Status</th>
                        <th class="text-center">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      <!-- Data will be populated by JavaScript -->
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

          </div><!-- /#pane-olt -->
          </div><!-- /#configForm -->
        </div>
        <!-- /.container-fluid -->

      </div>
      <!-- End of Main Content -->

      <!-- Footer -->
      <footer class="sticky-footer bg-white">
        <div class="container my-auto">
          <div class="copyright text-center my-auto">
            <span>Copyright &copy; Your Website 2020</span>
          </div>
        </div>
      </footer>
      <!-- End of Footer -->

    </div>
    <!-- End of Content Wrapper -->

  </div>
  <!-- End of Page Wrapper -->

  <!-- Scroll to Top Button-->
  <a class="scroll-to-top rounded" href="#page-top">
    <i class="fas fa-angle-up"></i>
  </a>

  <!-- Logout Modal-->
  <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog" role="document">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title" id="exampleModalLabel">Ready to Leave?</h5>
          <button class="close" type="button" data-dismiss="modal" aria-label="Close">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div class="modal-body">Select "Logout" below if you are ready to end your current session.</div>
        <div class="modal-footer">
          <button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button>
          <a class="btn btn-primary" href="/logout">Logout</a>
        </div>
      </div>
    </div>
  </div>

  <!-- Mikrotik Device Modal -->
<div class="modal fade" id="mikrotikDeviceModal" tabindex="-1" role="dialog" aria-labelledby="mikrotikDeviceModalLabel" aria-hidden="true">
  <div class="modal-dialog" role="document">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title" id="mikrotikDeviceModalLabel">Tambah Perangkat MikroTik</h5>
        <button type="button" class="close" data-dismiss="modal" aria-label="Close">
          <span aria-hidden="true">&times;</span>
        </button>
      </div>
      <div class="modal-body">
        <form id="mikrotikDeviceForm">
          <input type="hidden" id="mikrotikDeviceId" name="id">
          <div class="form-group">
            <label for="mikrotikIp">IP Address</label>
            <input type="text" class="form-control" id="mikrotikIp" name="ip" required>
          </div>
          <div class="form-group">
            <label for="mikrotikName">Username</label>
            <input type="text" class="form-control" id="mikrotikName" name="name" required>
          </div>
          <div class="form-group">
            <label for="mikrotikPassword">Password</label>
            <input type="password" class="form-control" id="mikrotikPassword" name="password" required autocomplete="current-password">
          </div>
          <div class="form-group">
            <label for="mikrotikPort">API Port</label>
            <input type="number" class="form-control" id="mikrotikPort" name="port" placeholder="8728" required>
            <small class="form-text text-muted">Port API di Mikrotik. Default: 8728, SSL: 8729.</small>
          </div>
          <div class="form-group">
            <label for="mikrotikMonitorInterface">Interface Monitoring</label>
            <input type="text" class="form-control" id="mikrotikMonitorInterface" name="monitoring_interface" placeholder="ether1">
            <small class="form-text text-muted">Interface yang dipantau di Network Traffic Monitor (mis. ether1, sfp-sfpplus1). Default: ether1.</small>
          </div>

        </form>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
        <button type="button" class="btn btn-primary" id="saveMikrotikDeviceBtn">Simpan</button>
      </div>
    </div>
  </div>
</div>

  <!-- OLT Device Modal -->
<div class="modal fade" id="oltDeviceModal" tabindex="-1" role="dialog" aria-labelledby="oltDeviceModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-lg" role="document">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title" id="oltDeviceModalLabel">Tambah Perangkat OLT</h5>
        <button type="button" class="close" data-dismiss="modal" aria-label="Close">
          <span aria-hidden="true">&times;</span>
        </button>
      </div>
      <div class="modal-body">
        <form id="oltDeviceForm">
          <input type="hidden" id="oltDeviceId" name="id">
          
          <h6 class="text-primary mb-3"><i class="fas fa-info-circle"></i> Informasi Dasar</h6>
          <div class="form-group">
            <label for="oltDeviceName">Nama OLT</label>
            <input type="text" class="form-control" id="oltDeviceName" name="name" placeholder="OLT Pusat" required>
            <small class="form-text text-muted">Nama untuk identifikasi OLT (contoh: OLT Pusat, OLT Cabang A)</small>
          </div>
          
          <div class="form-group">
            <label for="oltDeviceHost">IP Address</label>
            <input type="text" class="form-control" id="oltDeviceHost" name="host" placeholder="192.168.1.100" required>
            <small class="form-text text-muted">Alamat IP OLT</small>
          </div>

          <div class="form-group">
            <label for="oltDeviceBrand">Merk OLT</label>
            <select class="form-control" id="oltDeviceBrand" name="brand">
              <option value="auto">Auto-deteksi (rekomendasi)</option>
              <option value="hioso">HIOSO EPON</option>
              <option value="zte">ZTE C320/C300 GPON</option>
            </select>
            <small class="form-text text-muted">Pilih merk, atau "Auto-deteksi" untuk kenali otomatis via SNMP saat test koneksi.</small>
          </div>

          <hr class="my-4">
          <h6 class="text-primary mb-3"><i class="fas fa-network-wired"></i> Konfigurasi SNMP</h6>
          
          <div class="form-group">
            <label for="oltDeviceSnmpPort">Port SNMP</label>
            <input type="number" class="form-control" id="oltDeviceSnmpPort" name="snmpPort" placeholder="161" value="161">
            <small class="form-text text-muted">Port SNMP OLT (default: 161)</small>
          </div>
          
          <div class="form-group">
            <label for="oltDeviceSnmpCommunity">SNMP Community</label>
            <input type="text" class="form-control" id="oltDeviceSnmpCommunity" name="snmpCommunity" placeholder="public" value="public">
            <small class="form-text text-muted">SNMP Community string (default: public)</small>
          </div>
          
          <div class="form-group">
            <label for="oltDeviceSnmpTimeout">Timeout (ms)</label>
            <input type="number" class="form-control" id="oltDeviceSnmpTimeout" name="snmpTimeout" placeholder="30000" value="30000">
            <small class="form-text text-muted">Timeout koneksi SNMP dalam milidetik (default: 30000)</small>
          </div>
          
          <div class="form-group">
            <label for="oltDeviceSnmpRetries">Retries</label>
            <input type="number" class="form-control" id="oltDeviceSnmpRetries" name="snmpRetries" placeholder="2" value="2">
            <small class="form-text text-muted">Jumlah retry jika koneksi gagal (default: 2)</small>
          </div>
          
          <hr class="my-4">
          <h6 class="text-primary mb-3"><i class="fas fa-globe"></i> Kredensial Web Interface</h6>
          
          <div class="form-group">
            <label for="oltDeviceWebUsername">Username Web</label>
            <input type="text" class="form-control" id="oltDeviceWebUsername" name="webUsername" placeholder="admin">
            <small class="form-text text-muted">Username untuk login ke web interface OLT (untuk scraping log)</small>
          </div>
          
          <div class="form-group">
            <label for="oltDeviceWebPassword">Password Web</label>
            <input type="password" class="form-control" id="oltDeviceWebPassword" name="webPassword" placeholder="********">
            <small class="form-text text-muted">Password untuk login ke web interface OLT</small>
          </div>

          <hr class="my-4">
          <h6 class="text-primary mb-3"><i class="fas fa-terminal"></i> Kredensial SSH (Provisioning &amp; Backup)</h6>
          <p class="small text-muted mb-3">Dipakai halaman <b>Provisioning OLT</b> untuk registrasi ONU via CLI dan backup <code>running-config</code> (ZTE C320/C300).</p>

          <div class="form-group">
            <label for="oltDeviceSshPort">Port SSH</label>
            <input type="number" class="form-control" id="oltDeviceSshPort" name="sshPort" placeholder="22" value="22">
            <small class="form-text text-muted">Port SSH OLT (default: 22)</small>
          </div>

          <div class="form-group">
            <label for="oltDeviceSshUsername">Username SSH</label>
            <input type="text" class="form-control" id="oltDeviceSshUsername" name="sshUsername" placeholder="zte" autocomplete="off">
            <small class="form-text text-muted">User CLI dengan hak konfigurasi (privileged)</small>
          </div>

          <div class="form-group">
            <label for="oltDeviceSshPassword">Password SSH</label>
            <input type="password" class="form-control" id="oltDeviceSshPassword" name="sshPassword" placeholder="********" autocomplete="new-password">
            <small class="form-text text-muted">Kosongkan keduanya bila tidak memakai fitur provisioning/backup</small>
          </div>

          <div class="form-group">
            <label for="oltDeviceEnabled">Status</label>
            <select class="form-control" id="oltDeviceEnabled" name="enabled">
              <option value="true">Aktif</option>
              <option value="false">Nonaktif</option>
            </select>
            <small class="form-text text-muted">Nonaktifkan untuk sementara melewati OLT ini tanpa menghapus konfigurasi</small>
          </div>

        </form>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
        <button type="button" class="btn btn-primary" id="saveOltDeviceBtn">Simpan</button>
      </div>
    </div>
  </div>
</div>


  <!-- Bootstrap core JavaScript-->
  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>

  <!-- Core plugin JavaScript-->
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>

  <!-- Custom scripts for all pages-->
  <script src="/js/sb-admin-2.js"></script>

  <!-- Page level plugins -->
  <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
  <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>

  <!-- Page level custom scripts -->
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

    <script src="/js/config.js"></script>

</body>

</html>
