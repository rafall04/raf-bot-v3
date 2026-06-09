<!DOCTYPE html>
<html lang="en">

<head>
    <?php
    $pageTitle = 'RAF BOT - Setup Awal Pelanggan PSB';
    $themeRole = 'teknisi';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />
    <link href="/css/teknisi-psb-setup.css" rel="stylesheet">
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_role_aware_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include '_role_aware_teknisi_topbar.php'; ?>

                <div class="container-fluid">
                    <!-- Page Header -->
                    <div class="tk-page-head">
                        <div class="tk-title">
                            <span class="tk-title-icon"><i class="fas fa-wifi"></i></span>
                            <div>
                                <h1>Setup Awal Pelanggan PSB</h1>
                                <p class="tk-subtitle">Konfigurasi WiFi & aktivasi layanan pelanggan baru</p>
                            </div>
                        </div>
                        <div class="tk-actions">
                            <a href="/teknisi-psb" class="btn btn-outline-primary">
                                <i class="fas fa-user-plus"></i> Daftar Pelanggan Baru
                            </a>
                            <a href="/teknisi-psb-installation" class="btn btn-outline-primary">
                                <i class="fas fa-list"></i> Daftar Instalasi
                            </a>
                        </div>
                    </div>

                    <!-- Messages -->
                    <div id="message-container"></div>

                    <!-- Customer Selection -->
                    <div class="card shadow mb-4">
                        <div class="card-header py-3">
                            <h6 class="m-0 font-weight-bold text-primary">
                                <i class="fas fa-user"></i> Pilih Pelanggan
                            </h6>
                        </div>
                        <div class="card-body">
                            <div class="row">
                                <div class="col-md-6">
                                    <label for="customer-select" class="form-label">Pilih Pelanggan yang Sudah Diinstalasi <span class="text-danger">*</span></label>
                                    <select class="form-control" id="customer-select" style="width: 100%;">
                                        <option value="">Pilih Pelanggan...</option>
                                    </select>
                                    <small class="form-text text-muted">Pilih pelanggan dengan status "Selesai Instalasi"</small>
                                </div>
                                <div class="col-md-6 d-flex align-items-end">
                                    <button type="button" class="btn btn-primary" id="load-customer-btn" disabled>
                                        <i class="fas fa-arrow-right"></i> Load Data
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Setup Form (Hidden Initially) -->
                    <div id="setup-form-container" style="display: none;">
                        <div class="card shadow mb-4">
                            <div class="card-header py-3">
                                <h6 class="m-0 font-weight-bold text-primary">
                                    <i class="fas fa-wifi"></i> Konfigurasi Modem
                                </h6>
                            </div>
                            <div class="card-body">
                                <div class="alert alert-info">
                                    <i class="fas fa-info-circle"></i> 
                                    <strong>Info Pelanggan:</strong> 
                                    <span id="customer-info">-</span>
                                </div>
                                
                                <form id="setup-form">
                                    <input type="hidden" id="customer_id" name="customer_id" />
                                    
                                    <!-- PPPoE Configuration -->
                                    <div class="row mb-4">
                                        <div class="col-md-12">
                                            <h5 class="mb-3"><i class="fas fa-network-wired"></i> Konfigurasi PPPoE</h5>
                                        </div>
                                        <div class="col-md-6 mb-3">
                                            <label for="pppoe_username" class="form-label">PPPoE Username <span class="text-danger">*</span></label>
                                            <div class="input-group">
                                                <input type="text" class="form-control form-control-sm" id="pppoe_username" name="pppoe_username" required placeholder="pelanggan001" />
                                                <div class="input-group-append">
                                                    <span class="input-group-text" id="pppoe_username_status" style="min-width: 30px;">
                                                        <i class="fas fa-spinner fa-spin" style="display: none;" id="pppoe_username_loading"></i>
                                                    </span>
                                                </div>
                                            </div>
                                            <small class="form-text text-muted" id="pppoe_username_feedback"></small>
                                        </div>
                                        <div class="col-md-6 mb-3">
                                            <label for="pppoe_password" class="form-label">PPPoE Password</label>
                                            <input type="text" class="form-control form-control-sm" id="pppoe_password" name="pppoe_password" placeholder="Kosongkan untuk menggunakan password default" />
                                            <small class="form-text text-muted">Jika kosong, akan menggunakan password default dari config</small>
                                        </div>
                                        <div class="col-md-12 mb-3">
                                            <label for="subscription" class="form-label">Paket Langganan <span class="text-danger">*</span></label>
                                            <select class="form-control form-control-sm" id="subscription" name="subscription" required>
                                                <option value="">Pilih Paket...</option>
                                            </select>
                                        </div>
                                    </div>

                                    <hr class="my-4">

                                    <!-- Device & WiFi Configuration -->
                                    <div class="row mb-4">
                                        <div class="col-md-12">
                                            <h5 class="mb-3"><i class="fas fa-router"></i> Konfigurasi Device & WiFi</h5>
                                        </div>
                                        <div class="col-md-6 mb-3">
                                            <label for="device_id" class="form-label">Pilih Device <span class="text-danger">*</span></label>
                                            <div class="mb-2">
                                                <label class="form-label small">Filter Device:</label>
                                                <div class="btn-group btn-group-sm" role="group" id="device-filter-group">
                                                    <input type="radio" class="btn-check" name="device-filter" id="filter-default" value="default" checked>
                                <label class="btn btn-outline-primary" for="filter-default" title="Device dengan username 'tes@hw'">
                                                        <i class="fas fa-filter"></i> Default
                                                    </label>
                                                    
                                                    <input type="radio" class="btn-check" name="device-filter" id="filter-new" value="new">
                                                    <label class="btn btn-outline-primary" for="filter-new" title="Device baru (< 1 hari)">
                                                        <i class="fas fa-clock"></i> Baru
                                                    </label>
                                                    
                                                    <input type="radio" class="btn-check" name="device-filter" id="filter-by-sn" value="by-sn">
                                                    <label class="btn btn-outline-primary" for="filter-by-sn" title="Filter berdasarkan Serial Number (SN harus diisi)">
                                                        <i class="fas fa-barcode"></i> By SN
                                                    </label>
                                                </div>
                                            </div>
                                            <div class="mb-2">
                                                <label class="form-label small">Filter Serial Number (SN):</label>
                                                <div class="input-group input-group-sm">
                                                    <input type="text" class="form-control" id="filter-serial-number" placeholder="Masukkan Serial Number untuk filter..." autocomplete="off">
                                                    <div class="input-group-append">
                                                        <button type="button" class="btn btn-outline-primary" id="search-sn-btn" title="Cari device berdasarkan SN">
                                                            <i class="fas fa-search"></i> <span class="d-none d-md-inline">Cari</span>
                                                        </button>
                                                        <button type="button" class="btn btn-outline-secondary" id="clear-sn-filter-btn" title="Hapus filter SN">
                                                            <i class="fas fa-times"></i>
                                                        </button>
                                                    </div>
                                                </div>
                                                <small class="form-text text-muted" id="sn-filter-hint">Wajib diisi jika filter "By SN" dipilih</small>
                                            </div>
                                            <div class="input-group">
                                                <select class="form-control form-control-sm" id="device_id" name="device_id" required style="width: 100%;">
                                                    <option value="">Pilih Device...</option>
                                                </select>
                                                <div class="input-group-append">
                                                    <button type="button" class="btn btn-sm btn-outline-primary" id="refresh-devices-btn">
                                                        <i class="fas fa-sync-alt"></i> Refresh
                                                    </button>
                                                </div>
                                            </div>
                                            <small class="form-text text-muted">
                                                <span id="filter-description">Pilih device dengan default username "tes@hw" dari GenieACS</span>
                                                <span id="device-count" class="ml-2 font-weight-bold"></span>
                                            </small>
                                            <div id="device-info" class="mt-2"></div>
                                        </div>
                                        <div class="col-md-6 mb-3">
                                            <label class="form-label">Konfigurasi WiFi</label>
                                            <div class="input-group mb-2">
                                                <input type="text" class="form-control form-control-sm" id="device_id_for_ssid" placeholder="Device ID" readonly />
                                                <div class="input-group-append">
                                                    <button type="button" class="btn btn-sm btn-outline-primary" id="load-ssid-btn" disabled>
                                                        <i class="fas fa-wifi"></i> Muat SSID
                                                    </button>
                                                </div>
                                            </div>
                                            <div id="ssid-checkbox-container" class="mb-2" style="display: none;">
                                                <label class="form-label small">Pilih SSID yang akan disamakan:</label>
                                                <div id="ssid-checkboxes" class="border rounded p-2 bg-light"></div>
                                            </div>
                                            <div class="row">
                                                <div class="col-md-6">
                                                    <label for="wifi_ssid" class="form-label">Nama WiFi (SSID) <span class="text-danger">*</span></label>
                                                    <input type="text" class="form-control form-control-sm" id="wifi_ssid" name="wifi_ssid" required placeholder="Nama_WiFi" />
                                                    <small class="form-text text-muted">Akan diterapkan ke SSID yang dicentang</small>
                                                </div>
                                                <div class="col-md-6">
                                                    <label for="wifi_password" class="form-label">Password WiFi <span class="text-danger">*</span></label>
                                                    <input type="text" class="form-control form-control-sm" id="wifi_password" name="wifi_password" required placeholder="password_wifi" />
                                                    <small class="form-text text-muted">Akan diterapkan ke SSID yang dicentang</small>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div class="row mt-4">
                                        <div class="col-md-12">
                                            <button type="submit" class="btn btn-success" id="submit-setup-btn">
                                                <i class="fas fa-check"></i> Simpan & Konfigurasi Modem
                                            </button>
                                            <a href="/teknisi-psb-installation" class="btn btn-secondary">
                                                <i class="fas fa-arrow-left"></i> Kembali
                                            </a>
                                        </div>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Logout Modal -->
    <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Konfirmasi Logout</h5>
                    <button type="button" class="close" data-dismiss="modal">
                        <span>&times;</span>
                    </button>
                </div>
                <div class="modal-body">
                    Apakah Anda yakin ingin logout?
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <a href="/logout" class="btn btn-primary">Logout</a>
                </div>
            </div>
        </div>
    </div>

    <!-- Scripts -->
    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

    <script src="/js/teknisi-psb-setup.js"></script>
</body>

</html>

