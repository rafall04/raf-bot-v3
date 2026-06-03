<!DOCTYPE html>
<html lang="en">

<head>

  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
  <meta name="description" content="">
  <meta name="author" content="">

  <title>RAF BOT - Config</title>

  <!-- Custom fonts for this template -->
  <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

  <!-- Custom styles for this template -->
  <link href="/css/sb-admin-2.min.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">

  <!-- Custom styles for this page -->
  <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css">

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

          <!-- Mikrotik Devices Configuration -->
          <!-- Table Section -->
          <h4 class="dashboard-section-title">Konfigurasi MikroTik</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Konfigurasi MikroTik</h6>
            </div>
            <div class="card-body">
              <button class="btn btn-primary mb-3" data-toggle="modal" data-target="#mikrotikDeviceModal" id="addMikrotikDeviceBtn">Tambah Perangkat</button>
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

          <!-- DataTales Example -->
          <form id="configForm" method="POST" onsubmit="return false;">
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
                   <div class="mb-3">
                    <label for="rekening_details" class="form-label">Detail Rekening</label>
                    <textarea class="form-control" id="rekening_details" name="rekening_details" rows="4"></textarea>
                    <small class="form-text text-muted">Informasi rekening yang akan ditampilkan di notifikasi tagihan.</small>
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

            <!-- Table Section -->
          <h4 class="dashboard-section-title">Konfigurasi Teknis</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Konfigurasi Teknis</h6>
              </div>
              <div class="card-body">
                  <div class="mb-3">
                    <label for="site_url_bot" class="form-label">Site URL Bot</label>
                    <input type="text" class="form-control" id="site_url_bot" name="site_url_bot" placeholder="http://127.0.0.1:3100" />
                    <small class="form-text text-muted">URL untuk koneksi ke MikroTik melalui PHP. Contoh: http://127.0.0.1:3100 atau http://localhost:3100</small>
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

            <!-- OLT HIOSO Configuration -->
            <h4 class="dashboard-section-title">Konfigurasi OLT HIOSO</h4>
            
            <!-- Global OLT Settings -->
            <div class="card table-card mb-4">
              <div class="card-header">
                <h6>Pengaturan Global OLT</h6>
              </div>
              <div class="card-body">
                <div class="alert alert-info">
                  <i class="fas fa-info-circle"></i> 
                  <strong>Informasi OLT HIOSO:</strong>
                  <p class="mb-0 mt-2">Konfigurasi ini digunakan untuk mengambil data redaman (RX Power), status ONT, Dying Gasp, dan LOS dari OLT HIOSO via SNMP. Data akan ditampilkan di halaman Pelanggan Teknisi.</p>
                </div>
                
                <div class="mb-3">
                  <label for="oltEnabled" class="form-label">Status OLT</label>
                  <select class="form-control" id="oltEnabled" name="oltEnabled">
                    <option value="true">Aktif</option>
                    <option value="false">Nonaktif</option>
                  </select>
                  <small class="form-text text-muted">Aktifkan untuk mengambil data dari OLT HIOSO</small>
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
                <button class="btn btn-primary mb-3" data-toggle="modal" data-target="#oltDeviceModal" id="addOltDeviceBtn">
                  <i class="fas fa-plus"></i> Tambah OLT
                </button>
                <div class="table-responsive">
                  <table class="table table-bordered" id="oltDevicesTable" width="100%" cellspacing="0">
                    <thead>
                      <tr>
                        <th>Nama</th>
                        <th>IP Address</th>
                        <th>SNMP Port</th>
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

            <div class="d-flex w-100 mb-4" style="justify-content: end;">
              <button type="submit" class="btn btn-primary">Simpan Semua Konfigurasi</button>
            </div>
          </form>
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
            <small class="form-text text-muted">Alamat IP OLT HIOSO</small>
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

  <script>
    document.addEventListener('DOMContentLoaded', function() {
      const form = document.getElementById('configForm');

      // Fetch initial data
      fetch('/api/config', { credentials: 'include' })
        .then(res => res.json())
        .then(json => {
            if (json.data) {
                // Helper to set value
                const setValue = (id, value, fallback = '') => {
                    const el = document.getElementById(id);
                    if (el) el.value = value || fallback;
                };

                // Set values from json.data
                setValue('nama', json.data.nama);
                setValue('namabot', json.data.namabot);
                setValue('telfon', json.data.telfon);
                setValue('adminPhone', json.data.adminPhone || '089685645956');
                setValue('parentbinding', json.data.parentbinding);
                setValue('tanggal_pengingat', json.data.tanggal_pengingat, '1');
                setValue('tanggal_batas_bayar', json.data.tanggal_batas_bayar, '10');
                setValue('teknisiCollectionCommissionEnabled', json.data.teknisiCollectionCommissionEnabled === true ? "true" : "false");
                setValue('teknisiCollectionCommissionAmount', json.data.teknisiCollectionCommissionAmount || '0');
                setValue('tanggal_isolir', json.data.tanggal_isolir, '11');
                setValue('isolir_profile', json.data.isolir_profile);
                setValue('isolirFeatureEnabled', json.data.isolirFeatureEnabled !== false ? "true" : "false");
                setValue('isolirManualEnabled', json.data.isolirManualEnabled !== false ? "true" : "false");
                setValue('isolirManualDefaultProfile', json.data.isolirManualDefaultProfile || json.data.isolir_profile || 'ISOLIR');
                setValue('isolirManualAllowCustomProfile', json.data.isolirManualAllowCustomProfile !== false ? "true" : "false");
                setValue('isolirManualDefaultDisconnect', json.data.isolirManualDefaultDisconnect !== false ? "true" : "false");
                setValue('isolirManualDefaultReboot', json.data.isolirManualDefaultReboot === true ? "true" : "false");
                setValue('isolirOpenDefaultReboot', json.data.isolirOpenDefaultReboot !== false ? "true" : "false");
                setValue('rekening_details', json.data.rekening_details);
                setValue('site_url_bot', json.data.site_url_bot, 'http://127.0.0.1:3100');
                setValue('genieacsBaseUrl', json.data.genieacsBaseUrl);
                setValue('genieacsEnabled', json.data.genieacsEnabled !== false ? "true" : "false");
                setValue('genieacsCustomerRebootEnabled', json.data.genieacsCustomerRebootEnabled !== false ? "true" : "false");
                setValue('genieacsAdminRebootEnabled', json.data.genieacsAdminRebootEnabled !== false ? "true" : "false");
                setValue('genieacsWifiManagementEnabled', json.data.genieacsWifiManagementEnabled !== false ? "true" : "false");
                setValue('genieacsPsbDeviceProvisioningEnabled', json.data.genieacsPsbDeviceProvisioningEnabled !== false ? "true" : "false");
                setValue('accessLimit', json.data.accessLimit);
                setValue('rx_tolerance', json.data.rx_tolerance);
                setValue('ipaymuSecret', json.data.ipaymuSecret);
                setValue('ipaymuVA', json.data.ipaymuVA);
                setValue('ipaymuCallback', json.data.ipaymuCallback);
                setValue('ipaymuProduction', json.data.ipaymuProduction ? "yes" : "no");
                setValue('defaultBulkSSID', json.data.defaultBulkSSID || '1');
                setValue('speedOnDemandEnabled', json.data.speedOnDemandEnabled !== false ? "true" : "false");
                setValue('showPaymentStatus', json.data.showPaymentStatus !== false ? "true" : "false");
        setValue('showDueDate', json.data.showDueDate !== false ? "true" : "false");
        setValue('customerTrafficUsageEnabled', json.data.customerTrafficUsageEnabled === true ? "true" : "false");
        setValue('customerTrafficLiveEnabled', json.data.customerTrafficLiveEnabled === true ? "true" : "false");
                setValue('custom_wifi_modification', json.data.custom_wifi_modification ? "true" : "false");
                setValue('sync_to_mikrotik', json.data.sync_to_mikrotik ? "true" : "false");
                setValue('whatsapp_message_delay', json.data.whatsapp_message_delay, '2000');
                setValue('defaultPPPoEPassword', json.data.defaultPPPoEPassword, '');
                setValue('welcomeMessageEnabled', json.data.welcomeMessage?.enabled !== false ? "true" : "false");
                setValue('customerPortalUrl', json.data.welcomeMessage?.customerPortalUrl || json.data.company?.website || json.data.site_url_bot || 'https://rafnet.my.id/customer');
                
                // Load bank accounts
                if (json.data.bankAccounts) {
                    window.bankAccounts = json.data.bankAccounts;
                    displayBankAccounts();
                } else {
                    window.bankAccounts = [];
                }
            }
        })
        .catch(error => {
            console.error("Error fetching initial config:", error);
            Swal.fire({
                icon: 'error',
                title: 'Gagal Memuat',
                text: 'Tidak dapat memuat konfigurasi awal dari server.'
            });
        });

      fetch('/api/genieacs/feature-status', { credentials: 'include' })
        .then(res => res.json())
        .then(json => {
            const badge = document.getElementById('genieacsCapabilityBadge');
            const reason = document.getElementById('genieacsCapabilityReason');
            if (!badge || !reason) return;
            const data = json.data || {};
            if (data.available) {
                badge.className = 'badge badge-success';
                badge.textContent = data.reachable === false ? 'Configured / Unreachable' : 'Tersedia';
            } else {
                badge.className = 'badge badge-warning';
                badge.textContent = 'Limited';
            }
            reason.textContent = data.reason || 'Status GenieACS berhasil dimuat.';
        })
        .catch(() => {
            const badge = document.getElementById('genieacsCapabilityBadge');
            const reason = document.getElementById('genieacsCapabilityReason');
            if (badge) {
                badge.className = 'badge badge-danger';
                badge.textContent = 'Gagal';
            }
            if (reason) {
                reason.textContent = 'Status capability GenieACS gagal dimuat.';
            }
        });

      // Handle form submission
      form.addEventListener('submit', function(event) {
        event.preventDefault();

        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        
        // Add bank accounts to data
        data.bankAccounts = window.bankAccounts;

        const submitButton = form.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Menyimpan...';

        fetch('/api/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include', // ✅ Fixed by script
          body: JSON.stringify(data),
        })
        .then(response => {
            if (!response.ok) {
                // Try to get error message from JSON response
                return response.json().then(err => { throw new Error(err.message || `HTTP error! status: ${response.status}`) });
            }
            return response.json();
        })
        .then(result => {
          Swal.fire({
            icon: 'success',
            title: 'Berhasil!',
            text: result.message || 'Konfigurasi berhasil disimpan.',
            timer: 2000,
            showConfirmButton: false
          });
        })
        .catch(error => {
          console.error('Error:', error);
          Swal.fire({
            icon: 'error',
            title: 'Oops...',
            text: error.message || 'Terjadi kesalahan saat menyimpan konfigurasi!',
          });
        })
        .finally(() => {
            submitButton.disabled = false;
            submitButton.innerHTML = 'Simpan Semua Konfigurasi';
        });
      });

      // Mikrotik Devices Management
      const mikrotikDevicesTable = document.getElementById('mikrotikDevicesTable').getElementsByTagName('tbody')[0];
      const mikrotikDeviceModal = $('#mikrotikDeviceModal');
      const mikrotikDeviceForm = document.getElementById('mikrotikDeviceForm');
      const saveMikrotikDeviceBtn = document.getElementById('saveMikrotikDeviceBtn');

      function loadMikrotikDevices() {
        fetch('/api/mikrotik-devices', { credentials: 'include' })
          .then(res => res.json())
          .then(devices => {
            mikrotikDevicesTable.innerHTML = '';
            devices.forEach(device => {
              const row = mikrotikDevicesTable.insertRow();
              row.innerHTML = `
                <td>${device.ip}</td>
                <td>${device.name}</td>
                <td>${device.active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-secondary">Inactive</span>'}</td>
                <td>
                  <button class="btn btn-sm btn-info setActiveBtn" data-id="${device.id}" ${device.active ? 'disabled' : ''}>Set Active</button>
                  <button class="btn btn-sm btn-warning editBtn" data-id="${device.id}">Edit</button>
                  <button class="btn btn-sm btn-danger deleteBtn" data-id="${device.id}">Delete</button>
                </td>
              `;
            });
          });
      }

      document.getElementById('addMikrotikDeviceBtn').addEventListener('click', () => {
        mikrotikDeviceForm.reset();
        document.getElementById('mikrotikDeviceId').value = '';
        mikrotikDeviceModal.find('.modal-title').text('Tambah Perangkat MikroTik');
      });

      saveMikrotikDeviceBtn.addEventListener('click', () => {
        const formData = new FormData(mikrotikDeviceForm);
        const data = Object.fromEntries(formData.entries());
        const id = data.id;
        const url = id ? `/api/mikrotik-devices/${id}` : '/api/mikrotik-devices';
        const method = id ? 'PUT' : 'POST';

        // PENTING: Validasi data sebelum submit
        if (!data.ip || !data.name || !data.password) {
          Swal.fire('Error', 'IP Address, Username, dan Password harus diisi', 'error');
          return;
        }

        fetch(url, {
          method: method,
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(data)
        })
        .then(res => {
          if (!res.ok) {
            return res.json().then(err => Promise.reject(err));
          }
          return res.json();
        })
        .then(result => {
          Swal.fire('Success', result.message || 'Perangkat berhasil disimpan', 'success');
          mikrotikDeviceModal.modal('hide');
          loadMikrotikDevices();
        })
        .catch(err => {
          console.error('Error saving device:', err);
          Swal.fire('Error', err.message || 'Gagal menyimpan perangkat', 'error');
        });
      });

      mikrotikDevicesTable.addEventListener('click', (e) => {
        const target = e.target;
        const id = target.dataset.id;

        if (target.classList.contains('editBtn')) {
          // PENTING: Gunakan backtick (`) bukan single quote (') untuk template literal
          fetch(`/api/mikrotik-devices/${id}`, { credentials: 'include' })
            .then(res => {
              if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
              }
              return res.json();
            })
            .then(device => {
              // PENTING: Validasi data device sebelum mengisi form
              if (!device || !device.id) {
                Swal.fire('Error', 'Data perangkat tidak valid atau tidak ditemukan', 'error');
                return;
              }
              
              // Isi form dengan data device
              document.getElementById('mikrotikDeviceId').value = device.id || '';
              document.getElementById('mikrotikIp').value = device.ip || '';
              document.getElementById('mikrotikName').value = device.name || '';
              document.getElementById('mikrotikPassword').value = device.password || '';
              document.getElementById('mikrotikPort').value = device.port || '8728';
              
              mikrotikDeviceModal.find('.modal-title').text('Edit Perangkat MikroTik');
              mikrotikDeviceModal.modal('show');
            })
            .catch(err => {
              console.error('Error loading device:', err);
              Swal.fire('Error', 'Gagal memuat data perangkat: ' + err.message, 'error');
            });
        }

        if (target.classList.contains('deleteBtn')) {
          Swal.fire({
            title: 'Are you sure?',
            text: "You won't be able to revert this!",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#3085d6',
            cancelButtonColor: '#d33',
            confirmButtonText: 'Yes, delete it!'
          }).then((result) => {
            if (result.isConfirmed) {
              fetch(`/api/mikrotik-devices/${id}`, { method: 'DELETE', credentials: 'include' })
                .then(res => res.json())
                .then(result => {
                  Swal.fire('Deleted!', result.message, 'success');
                  loadMikrotikDevices();
                })
                .catch(err => Swal.fire('Error', err.message, 'error'));
            }
          });
        }

        if (target.classList.contains('setActiveBtn')) {
          fetch(`/api/mikrotik-devices/set-active/${id}`, { method: 'POST', credentials: 'include' })
            .then(res => res.json())
            .then(result => {
              Swal.fire('Success', result.message, 'success');
              loadMikrotikDevices();
            })
            .catch(err => Swal.fire('Error', err.message, 'error'));
        }
      });

      loadMikrotikDevices();
    });
    
    // Bank Accounts Management
    window.bankAccounts = [];
    
    function displayBankAccounts() {
      const container = document.getElementById('bankAccountsList');
      if (!container) return;
      
      container.innerHTML = '';
      
      if (window.bankAccounts.length === 0) {
        container.innerHTML = '<div class="alert alert-info">Belum ada rekening bank. Klik tombol "Tambah Rekening" untuk menambahkan.</div>';
        return;
      }
      
      window.bankAccounts.forEach((account, index) => {
        const accountHtml = `
          <div class="card mb-3">
            <div class="card-body">
              <div class="row mb-2">
                <div class="col-md-11">
                  <div class="mb-2">
                    <label class="form-label mb-1 small text-muted">Nama Bank</label>
                    <input type="text" class="form-control" placeholder="Contoh: BCA, BRI, DANA" value="${account.bank || ''}" 
                           onchange="updateBankAccount(${index}, 'bank', this.value)">
                  </div>
                  <div class="mb-2">
                    <label class="form-label mb-1 small text-muted">Nomor Rekening</label>
                    <input type="text" class="form-control" placeholder="Contoh: 1234567890" value="${account.number || ''}"
                           onchange="updateBankAccount(${index}, 'number', this.value)">
                  </div>
                  <div class="mb-0">
                    <label class="form-label mb-1 small text-muted">Atas Nama</label>
                    <input type="text" class="form-control" placeholder="Contoh: MUHAMMAD RAFLI ALDIVA PRATAMA" value="${account.name || ''}"
                           onchange="updateBankAccount(${index}, 'name', this.value)">
                  </div>
                </div>
                <div class="col-md-1 d-flex align-items-center justify-content-center">
                  <button type="button" class="btn btn-danger btn-sm" onclick="removeBankAccount(${index})" title="Hapus Rekening">
                    <i class="fas fa-trash"></i>
                  </button>
                </div>
              </div>
              <div class="mt-3 p-2 bg-light rounded">
                <small class="text-muted d-block mb-1"><strong>Preview format di pesan:</strong></small>
                <small class="d-block" style="white-space: pre-line; font-family: monospace;"> ${account.bank || '[Bank]'}:
${account.number || '[Nomor]'}
a.n ${account.name || '[Nama]'}</small>
              </div>
            </div>
          </div>
        `;
        container.innerHTML += accountHtml;
      });
    }
    
    function addBankAccount() {
      window.bankAccounts.push({
        bank: '',
        number: '',
        name: ''
      });
      displayBankAccounts();
    }
    
    function updateBankAccount(index, field, value) {
      if (window.bankAccounts[index]) {
        window.bankAccounts[index][field] = value;
      }
    }
    
    function removeBankAccount(index) {
      Swal.fire({
        title: 'Hapus Rekening?',
        text: "Rekening bank ini akan dihapus",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#3085d6',
        cancelButtonColor: '#d33',
        confirmButtonText: 'Ya, hapus!',
        cancelButtonText: 'Batal'
      }).then((result) => {
        if (result.isConfirmed) {
          window.bankAccounts.splice(index, 1);
          displayBankAccounts();
        }
      });
    }
    
    // =====================================================
    // TELEGRAM BACKUP CONFIGURATION
    // =====================================================
    
    // Load Telegram config on page load
    function loadTelegramConfig() {
      fetch('/api/telegram-backup/config', { credentials: 'include' })
        .then(res => res.json())
        .then(json => {
          if (json.status === 200 && json.data) {
            document.getElementById('telegramBotToken').value = json.data.botToken || '';
            document.getElementById('telegramChatId').value = json.data.chatId || '';
            
            // Integration enablement is owned by config.php; scheduler is managed from cron.php
            const isEnabled = json.data.enabled === true || json.data.enabled === 'true';
            document.getElementById('telegramBackupEnabled').value = isEnabled ? 'true' : 'false';
          }
        })
        .catch(err => {
          console.error('Error loading Telegram config:', err);
        });
    }
    
    // Save Telegram config
    document.getElementById('saveTelegramConfigBtn').addEventListener('click', function() {
      const btn = this;
      const originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Menyimpan...';
      
      const data = {
        botToken: document.getElementById('telegramBotToken').value.trim(),
        chatId: document.getElementById('telegramChatId').value.trim(),
        enabled: document.getElementById('telegramBackupEnabled').value === 'true'
      };
      
      fetch('/api/telegram-backup/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
      })
      .then(res => res.json())
      .then(result => {
        if (result.status === 200) {
          Swal.fire({
            icon: 'success',
            title: 'Berhasil!',
            text: result.message,
            timer: 2000,
            showConfirmButton: false
          });
        } else {
          throw new Error(result.message);
        }
      })
      .catch(err => {
        Swal.fire({
          icon: 'error',
          title: 'Gagal',
          text: err.message || 'Terjadi kesalahan saat menyimpan konfigurasi'
        });
      })
      .finally(() => {
        btn.disabled = false;
        btn.innerHTML = originalText;
      });
    });
    
    // Test Telegram connection
    document.getElementById('testTelegramBtn').addEventListener('click', function() {
      const btn = this;
      const originalText = btn.innerHTML;
      
      const botToken = document.getElementById('telegramBotToken').value.trim();
      const chatId = document.getElementById('telegramChatId').value.trim();
      
      if (!botToken || !chatId) {
        Swal.fire({
          icon: 'warning',
          title: 'Data Tidak Lengkap',
          text: 'Silakan isi Bot Token dan Chat ID terlebih dahulu'
        });
        return;
      }
      
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Testing...';
      
      fetch('/api/telegram-backup/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ botToken, chatId })
      })
      .then(res => res.json())
      .then(result => {
        if (result.status === 200) {
          Swal.fire({
            icon: 'success',
            title: 'Koneksi Berhasil!',
            text: result.message
          });
        } else {
          throw new Error(result.message);
        }
      })
      .catch(err => {
        Swal.fire({
          icon: 'error',
          title: 'Koneksi Gagal',
          text: err.message || 'Tidak dapat terhubung ke Telegram'
        });
      })
      .finally(() => {
        btn.disabled = false;
        btn.innerHTML = originalText;
      });
    });
    
    // Run backup manually
    document.getElementById('runBackupBtn').addEventListener('click', function() {
      const btn = this;
      const originalText = btn.innerHTML;
      
      Swal.fire({
        title: 'Jalankan Backup?',
        text: 'Database akan di-backup dan dikirim ke Telegram sekarang',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#28a745',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Ya, Backup Sekarang',
        cancelButtonText: 'Batal'
      }).then((result) => {
        if (result.isConfirmed) {
          btn.disabled = true;
          btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Memproses...';
          
          fetch('/api/telegram-backup/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
          })
          .then(res => res.json())
          .then(result => {
            if (result.status === 200) {
              Swal.fire({
                icon: 'success',
                title: 'Backup Dimulai!',
                text: result.message
              });
            } else {
              throw new Error(result.message);
            }
          })
          .catch(err => {
            Swal.fire({
              icon: 'error',
              title: 'Gagal',
              text: err.message || 'Terjadi kesalahan saat menjalankan backup'
            });
          })
          .finally(() => {
            btn.disabled = false;
            btn.innerHTML = originalText;
          });
        }
      });
    });
    
    // Load Telegram config when page loads
    document.addEventListener('DOMContentLoaded', function() {
      loadTelegramConfig();
      loadOltConfig();
    });
    
    // =====================================================
    // OLT HIOSO CONFIGURATION
    // =====================================================
    
    // Load OLT config on page load
    function loadOltConfig() {
      fetch('/api/olt/config', { credentials: 'include' })
        .then(res => res.json())
        .then(json => {
          if (json.status === 200 && json.data) {
            document.getElementById('oltEnabled').value = json.data.enabled ? 'true' : 'false';
            document.getElementById('oltHost').value = json.data.host || '';
            document.getElementById('oltPort').value = json.data.port || 161;
            document.getElementById('oltCommunity').value = json.data.community || 'public';
            document.getElementById('oltTimeout').value = json.data.timeout || 15000;
            // Web OLT config
            document.getElementById('oltWebEnabled').value = json.data.webEnabled ? 'true' : 'false';
            document.getElementById('oltWebUsername').value = json.data.webUsername || '';
            document.getElementById('oltWebPassword').value = json.data.webPassword || '';
            document.getElementById('oltTimeWindow').value = json.data.timeWindow || 10;
            document.getElementById('oltScrapeInterval').value = json.data.scrapeInterval || 1;
            document.getElementById('oltMaxLogPages').value = json.data.maxLogPages || 3;
          }
        })
        .catch(err => {
          console.error('Error loading OLT config:', err);
        });
    }
    
    // ============================================
    // OLT CONFIGURATION - MULTIPLE OLT SUPPORT
    // ============================================
    
    // Save OLT Global Config
    document.getElementById('saveOltGlobalConfigBtn').addEventListener('click', function() {
      const btn = this;
      const originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Menyimpan...';
      
      const data = {
        enabled: document.getElementById('oltEnabled').value === 'true',
        webEnabled: document.getElementById('oltWebEnabled').value === 'true',
        timeWindow: parseInt(document.getElementById('oltTimeWindow').value) || 10,
        scrapeInterval: parseInt(document.getElementById('oltScrapeInterval').value) || 1,
        maxLogPages: parseInt(document.getElementById('oltMaxLogPages').value) || 3
      };
      
      fetch('/api/olt/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
      })
      .then(res => res.json())
      .then(result => {
        if (result.status === 200) {
          Swal.fire({
            icon: 'success',
            title: 'Berhasil!',
            text: result.message,
            timer: 2000,
            showConfirmButton: false
          });
        } else {
          throw new Error(result.message);
        }
      })
      .catch(err => {
        Swal.fire({
          icon: 'error',
          title: 'Gagal',
          text: err.message || 'Terjadi kesalahan saat menyimpan konfigurasi OLT'
        });
      })
      .finally(() => {
        btn.disabled = false;
        btn.innerHTML = originalText;
      });
    });
    
    // Debug Scrape Log
    document.getElementById('debugScrapeBtn').addEventListener('click', function() {
      const btn = this;
      const originalText = btn.innerHTML;
      
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Scraping...';
      
      console.log('[OLT Debug] Starting manual scrape...');
      
      fetch('/api/olt/scrape-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      })
      .then(res => res.json())
      .then(result => {
        console.log('[OLT Debug] Scrape result:', result);
        
        if (result.status === 200) {
          const eventCount = Object.keys(result.data.events || {}).length;
          
          // Show events in console
          console.log('[OLT Debug] Events:', result.data.events);
          console.log('[OLT Debug] Scraper Status:', result.data.scraperStatus);
          
          // Show alert with summary
          Swal.fire({
            icon: 'info',
            title: 'Debug Scrape Selesai',
            html: `
              <div class="text-left">
                <p><strong>Events ditemukan:</strong> ${eventCount}</p>
                <p><strong>Last scrape:</strong> ${result.data.scraperStatus.lastScrapeTime || 'N/A'}</p>
                <p><strong>Status:</strong> ${result.data.scraperStatus.running ? 'Running' : 'Stopped'}</p>
                <hr>
                <p class="text-muted small">Cek console browser (F12) dan server log untuk detail lengkap.</p>
              </div>
            `
          });
        } else {
          throw new Error(result.message);
        }
      })
      .catch(err => {
        Swal.fire({
          icon: 'error',
          title: 'Gagal',
          text: err.message || 'Terjadi kesalahan saat scraping'
        });
      })
      .finally(() => {
        btn.disabled = false;
        btn.innerHTML = originalText;
      });
    });
    
    // ============================================
    // OLT DEVICES MANAGEMENT
    // ============================================
    
    const oltDevicesTable = document.getElementById('oltDevicesTable').getElementsByTagName('tbody')[0];
    const oltDeviceModal = $('#oltDeviceModal');
    const oltDeviceForm = document.getElementById('oltDeviceForm');
    const saveOltDeviceBtn = document.getElementById('saveOltDeviceBtn');
    
    // Load OLT devices
    function loadOltDevices() {
      console.log('[OLT] Loading OLT devices...');
      
      fetch('/api/olt/devices', { credentials: 'include' })
        .then(res => {
          console.log('[OLT] Response status:', res.status);
          return res.json();
        })
        .then(result => {
          console.log('[OLT] Response data:', result);
          
          if (result.status === 200 && result.data) {
            const devices = result.data.devices || [];
            const globalConfig = result.data.globalConfig || {};
            
            console.log('[OLT] Devices:', devices);
            console.log('[OLT] Global config:', globalConfig);
            
            // Update global config fields
            document.getElementById('oltEnabled').value = globalConfig.enabled ? 'true' : 'false';
            document.getElementById('oltWebEnabled').value = globalConfig.webEnabled ? 'true' : 'false';
            document.getElementById('oltTimeWindow').value = globalConfig.timeWindow || 10;
            document.getElementById('oltScrapeInterval').value = globalConfig.scrapeInterval || 1;
            document.getElementById('oltMaxLogPages').value = globalConfig.maxLogPages || 3;
            
            // Populate table
            oltDevicesTable.innerHTML = '';
            
            if (devices.length === 0) {
              const row = oltDevicesTable.insertRow();
              row.innerHTML = '<td colspan="5" class="text-center text-muted">Belum ada perangkat OLT. Klik "Tambah OLT" untuk menambahkan.</td>';
              console.log('[OLT] No devices found');
            } else {
              devices.forEach(device => {
                console.log('[OLT] Adding device to table:', device);
                const row = oltDevicesTable.insertRow();
                row.innerHTML = `
                  <td>${device.name}</td>
                  <td>${device.host}</td>
                  <td>${device.snmpPort || 161}</td>
                  <td>
                    ${device.enabled !== false ? 
                      '<span class="badge badge-success">Aktif</span>' : 
                      '<span class="badge badge-secondary">Nonaktif</span>'}
                  </td>
                  <td>
                    <button class="btn btn-sm btn-info test-olt-device" data-id="${device.id}">
                      <i class="fas fa-plug"></i> Test
                    </button>
                    <button class="btn btn-sm btn-warning edit-olt-device" data-id="${device.id}">
                      <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn btn-sm btn-danger delete-olt-device" data-id="${device.id}">
                      <i class="fas fa-trash"></i> Hapus
                    </button>
                  </td>
                `;
              });
              
              console.log('[OLT] Added', devices.length, 'devices to table');
            }
            
            // Attach event listeners
            document.querySelectorAll('.test-olt-device').forEach(btn => {
              btn.addEventListener('click', function() {
                testOltDevice(this.dataset.id);
              });
            });
            
            document.querySelectorAll('.edit-olt-device').forEach(btn => {
              btn.addEventListener('click', function() {
                editOltDevice(this.dataset.id);
              });
            });
            
            document.querySelectorAll('.delete-olt-device').forEach(btn => {
              btn.addEventListener('click', function() {
                deleteOltDevice(this.dataset.id);
              });
            });
          } else {
            console.error('[OLT] Invalid response:', result);
            Swal.fire('Error', 'Gagal memuat data OLT devices', 'error');
          }
        })
        .catch(err => {
          console.error('[OLT] Error loading OLT devices:', err);
          Swal.fire('Error', 'Gagal memuat data OLT devices: ' + err.message, 'error');
        });
    }
    
    // Add OLT device button
    document.getElementById('addOltDeviceBtn').addEventListener('click', function() {
      oltDeviceForm.reset();
      document.getElementById('oltDeviceId').value = '';
      document.getElementById('oltDeviceSnmpPort').value = '161';
      document.getElementById('oltDeviceSnmpCommunity').value = 'public';
      document.getElementById('oltDeviceSnmpTimeout').value = '30000';
      document.getElementById('oltDeviceSnmpRetries').value = '2';
      document.getElementById('oltDeviceEnabled').value = 'true';
      oltDeviceModal.find('.modal-title').text('Tambah Perangkat OLT');
    });
    
    // Save OLT device
    saveOltDeviceBtn.addEventListener('click', function() {
      const deviceId = document.getElementById('oltDeviceId').value;
      const isEdit = deviceId !== '';
      
      const data = {
        name: document.getElementById('oltDeviceName').value.trim(),
        host: document.getElementById('oltDeviceHost').value.trim(),
        snmpPort: parseInt(document.getElementById('oltDeviceSnmpPort').value) || 161,
        snmpCommunity: document.getElementById('oltDeviceSnmpCommunity').value.trim() || 'public',
        snmpTimeout: parseInt(document.getElementById('oltDeviceSnmpTimeout').value) || 30000,
        snmpRetries: parseInt(document.getElementById('oltDeviceSnmpRetries').value) || 2,
        webUsername: document.getElementById('oltDeviceWebUsername').value.trim(),
        webPassword: document.getElementById('oltDeviceWebPassword').value,
        enabled: document.getElementById('oltDeviceEnabled').value === 'true'
      };
      
      if (!data.name || !data.host) {
        Swal.fire('Error', 'Nama dan IP Address harus diisi', 'error');
        return;
      }
      
      const url = isEdit ? `/api/olt/devices/${deviceId}` : '/api/olt/devices';
      const method = isEdit ? 'PUT' : 'POST';
      
      fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
      })
      .then(res => res.json())
      .then(result => {
        Swal.fire('Success', result.message || 'Perangkat berhasil disimpan', 'success');
        oltDeviceModal.modal('hide');
        loadOltDevices();
      })
      .catch(err => {
        Swal.fire('Error', err.message || 'Gagal menyimpan perangkat', 'error');
      });
    });
    
    // Edit OLT device
    function editOltDevice(deviceId) {
      fetch(`/api/olt/devices`, { credentials: 'include' })
        .then(res => res.json())
        .then(result => {
          if (result.status === 200 && result.data) {
            const device = result.data.devices.find(d => d.id === deviceId);
            if (device) {
              document.getElementById('oltDeviceId').value = device.id;
              document.getElementById('oltDeviceName').value = device.name;
              document.getElementById('oltDeviceHost').value = device.host;
              document.getElementById('oltDeviceSnmpPort').value = device.snmpPort || 161;
              document.getElementById('oltDeviceSnmpCommunity').value = device.snmpCommunity || 'public';
              document.getElementById('oltDeviceSnmpTimeout').value = device.snmpTimeout || 30000;
              document.getElementById('oltDeviceSnmpRetries').value = device.snmpRetries || 2;
              document.getElementById('oltDeviceWebUsername').value = device.webUsername || '';
              document.getElementById('oltDeviceWebPassword').value = device.webPassword || '';
              document.getElementById('oltDeviceEnabled').value = device.enabled !== false ? 'true' : 'false';
              
              oltDeviceModal.find('.modal-title').text('Edit Perangkat OLT');
              oltDeviceModal.modal('show');
            }
          }
        })
        .catch(err => {
          Swal.fire('Error', 'Gagal memuat data perangkat', 'error');
        });
    }
    
    // Delete OLT device
    function deleteOltDevice(deviceId) {
      Swal.fire({
        title: 'Hapus Perangkat OLT?',
        text: 'Data perangkat akan dihapus permanen',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Ya, Hapus!',
        cancelButtonText: 'Batal'
      }).then((result) => {
        if (result.isConfirmed) {
          fetch(`/api/olt/devices/${deviceId}`, {
            method: 'DELETE',
            credentials: 'include'
          })
          .then(res => res.json())
          .then(result => {
            Swal.fire('Terhapus!', result.message || 'Perangkat berhasil dihapus', 'success');
            loadOltDevices();
          })
          .catch(err => {
            Swal.fire('Error', err.message || 'Gagal menghapus perangkat', 'error');
          });
        }
      });
    }
    
    // Test OLT device connection
    function testOltDevice(deviceId) {
      Swal.fire({
        title: 'Testing Koneksi...',
        text: 'Mohon tunggu',
        allowOutsideClick: false,
        didOpen: () => {
          Swal.showLoading();
        }
      });
      
      fetch(`/api/olt/devices/${deviceId}/test`, {
        method: 'POST',
        credentials: 'include'
      })
      .then(res => res.json())
      .then(result => {
        if (result.status === 200) {
          Swal.fire({
            icon: 'success',
            title: 'Koneksi Berhasil!',
            text: result.message
          });
        } else {
          throw new Error(result.message);
        }
      })
      .catch(err => {
        Swal.fire({
          icon: 'error',
          title: 'Koneksi Gagal',
          text: err.message || 'Tidak dapat terhubung ke OLT'
        });
      });
    }
    
    // Load OLT devices on page load
    loadOltDevices();
  </script>

</body>

</html>
