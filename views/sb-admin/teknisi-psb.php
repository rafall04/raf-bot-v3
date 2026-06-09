<!DOCTYPE html>
<html lang="en">

<head>
    <?php
    $pageTitle = 'RAF BOT - Pasang Baru (PSB)';
    $themeRole = 'teknisi';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />
    <link href="/css/teknisi-psb.css" rel="stylesheet">
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
                            <span class="tk-title-icon"><i class="fas fa-user-plus"></i></span>
                            <div>
                                <h1>Daftar Calon Pelanggan</h1>
                                <p class="tk-subtitle">Registrasi data awal calon pelanggan Pasang Baru</p>
                            </div>
                        </div>
                        <div class="tk-actions">
                            <a href="/teknisi-psb-installation" class="btn btn-primary">
                                <i class="fas fa-list"></i> Lihat Daftar Instalasi
                            </a>
                        </div>
                    </div>

                    <!-- Messages -->
                    <div id="message-container"></div>

                    <!-- Phase 1: Data Awal -->
                    <div id="phase1-container">
                        <div class="card shadow mb-4">
                            <div class="card-header py-3">
                                <h6 class="m-0 font-weight-bold text-primary">
                                    <i class="fas fa-user-plus"></i> Data Pelanggan Baru
                                </h6>
                            </div>
                            <div class="card-body">
                                <form id="phase1-form">
                                    <!-- Data Pelanggan -->
                                    <div class="row mb-4">
                                        <div class="col-md-12">
                                            <h5 class="mb-3"><i class="fas fa-user"></i> Data Pelanggan</h5>
                                        </div>
                                        <div class="col-md-6 mb-3">
                                            <label class="form-label">Nomor HP <span class="text-danger">*</span></label>
                                            <div id="phone_number_container">
                                                <!-- Phone number fields will be added here -->
                                            </div>
                                            <button type="button" class="btn btn-sm btn-outline-primary mt-2" id="add-phone-btn" title="Tambah nomor HP">
                                                <i class="fas fa-plus"></i> Tambah Nomor HP
                                            </button>
                                            <small class="form-text text-muted d-block mt-2">
                                                <strong>Format yang direkomendasikan:</strong><br>
                                                • Indonesia: 081234567890 atau 6281234567890<br>
                                                • Thailand: <strong>66812345678</strong> (wajib dengan country code 66, jangan 08xx)<br>
                                                • Philippines: <strong>639123456789</strong> (wajib dengan country code 63, jangan 09xx)<br>
                                                • Malaysia: 60123456789 (country code 60)<br>
                                                • Singapore: 6512345678 (country code 65)<br>
                                                • Negara lain: gunakan format dengan country code (contoh: 1xxx untuk USA, 44xxx untuk UK)<br>
                                                <strong>⚠️ Penting:</strong> Untuk negara non-Indonesia, gunakan format dengan country code untuk menghindari konflik (tanpa tanda +).<br>
                                                Maksimal <span id="max-phone-limit">3</span> nomor sesuai konfigurasi.
                                            </small>
                                        </div>
                                        <div class="col-md-6 mb-3">
                                            <label for="name" class="form-label">Nama Pelanggan <span class="text-danger">*</span></label>
                                            <input type="text" class="form-control form-control-sm" id="name" name="name" required placeholder="Nama Lengkap" />
                                        </div>
                                        <div class="col-md-12 mb-3">
                                            <label for="address" class="form-label">Alamat <span class="text-danger">*</span></label>
                                            <textarea class="form-control form-control-sm" id="address" name="address" rows="3" required placeholder="Alamat lengkap pelanggan"></textarea>
                                        </div>
                                        <div class="col-md-6 mb-3">
                                            <label for="odc_id" class="form-label">ODC <small class="text-muted">(optional)</small></label>
                                            <select class="form-control form-control-sm" id="odc_id" name="odc_id" style="width: 100%;">
                                                <option value="">Pilih ODC...</option>
                                            </select>
                                            <small class="form-text text-muted">Pilih ODC terlebih dahulu</small>
                                        </div>
                                        <div class="col-md-6 mb-3">
                                            <label for="odp_id" class="form-label">ODP <small class="text-muted">(optional)</small></label>
                                            <select class="form-control form-control-sm" id="odp_id" name="odp_id" style="width: 100%;" disabled>
                                                <option value="">Pilih ODP...</option>
                                            </select>
                                            <small class="form-text text-muted">Pilih ODC terlebih dahulu untuk memilih ODP (opsional)</small>
                                        </div>
                                    </div>

                                    <hr class="my-4">

                                    <!-- Upload Foto -->
                                    <div class="row mb-4">
                                        <div class="col-md-12">
                                            <h5 class="mb-3"><i class="fas fa-camera"></i> Upload Dokumen</h5>
                                        </div>
                                        <div class="col-md-6 mb-3">
                                            <label class="form-label">Foto KTP <span class="text-danger">*</span></label>
                                            <label for="ktp_photo" class="photo-upload-container" id="ktp-upload-container">
                                                <i class="fas fa-cloud-upload-alt fa-3x mb-3 text-muted"></i>
                                                <p class="mb-2">Klik atau drag & drop foto KTP di sini</p>
                                                <small class="text-muted">Format: JPG, PNG, Max 5MB</small>
                                                <input type="file" id="ktp_photo" name="ktp_photo" accept="image/*" style="position: absolute; opacity: 0; width: 0; height: 0; overflow: hidden; pointer-events: none;" />
                                            </label>
                                            <button type="button" class="btn btn-sm btn-outline-primary mt-2" id="ktp-select-btn">
                                                <i class="fas fa-folder-open"></i> Pilih File dari Komputer
                                            </button>
                                            <div class="photo-preview" id="ktp-preview"></div>
                                        </div>
                                        <div class="col-md-6 mb-3">
                                            <label class="form-label">Foto Depan Rumah <span class="text-danger">*</span></label>
                                            <label for="house_photo" class="photo-upload-container" id="house-upload-container">
                                                <i class="fas fa-cloud-upload-alt fa-3x mb-3 text-muted"></i>
                                                <p class="mb-2">Klik atau drag & drop foto depan rumah di sini</p>
                                                <small class="text-muted">Format: JPG, PNG, Max 5MB</small>
                                                <input type="file" id="house_photo" name="house_photo" accept="image/*" style="position: absolute; opacity: 0; width: 0; height: 0; overflow: hidden; pointer-events: none;" />
                                            </label>
                                            <button type="button" class="btn btn-sm btn-outline-primary mt-2" id="house-select-btn">
                                                <i class="fas fa-folder-open"></i> Pilih File dari Komputer
                                            </button>
                                            <div class="photo-preview" id="house-preview"></div>
                                        </div>
                                    </div>

                                    <hr class="my-4">

                                    <!-- Lokasi -->
                                    <div class="row mb-4">
                                        <div class="col-md-12">
                                            <h5 class="mb-3"><i class="fas fa-map-marker-alt"></i> Lokasi Rumah</h5>
                                        </div>
                                        <div class="col-md-12 mb-3">
                                            <label for="location_url" class="form-label">Google Maps Link (Optional)</label>
                                            <input type="text" class="form-control form-control-sm" id="location_url" name="location_url" placeholder="https://maps.google.com/?q=-7.1500,111.8817" />
                                            <small class="form-text text-muted">Atau paste link Google Maps di sini. Koordinat akan otomatis diambil.</small>
                                        </div>
                                        <div class="col-md-6 mb-3">
                                            <label for="latitude" class="form-label">Latitude</label>
                                            <input type="number" step="any" class="form-control form-control-sm" id="latitude" name="latitude" placeholder="-7.1500" />
                                        </div>
                                        <div class="col-md-6 mb-3">
                                            <label for="longitude" class="form-label">Longitude</label>
                                            <input type="number" step="any" class="form-control form-control-sm" id="longitude" name="longitude" placeholder="111.8817" />
                                            <button type="button" class="btn btn-sm btn-primary mt-2" id="get-location-btn">
                                                <i class="fas fa-map-marker-alt"></i> Ambil Lokasi Saat Ini
                                            </button>
                                        </div>
                                        <div class="col-md-12">
                                            <div class="map-container" id="location-map"></div>
                                            <small class="form-text text-muted">Klik peta untuk menandai lokasi atau gunakan tombol GPS.</small>
                                        </div>
                                    </div>

                                    <div class="row mt-4">
                                        <div class="col-md-12">
                                            <button type="submit" class="btn btn-primary" id="submit-phase1-btn">
                                                <i class="fas fa-save"></i> Simpan Data Pelanggan
                                            </button>
                                            <button type="button" class="btn btn-secondary" id="reset-phase1-btn">
                                                <i class="fas fa-redo"></i> Reset
                                            </button>
                                            <a href="/teknisi-psb-installation" class="btn btn-outline-primary">
                                                <i class="fas fa-list"></i> Lihat Daftar Instalasi
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

    <!-- Loading Overlay -->
    <div class="loading-overlay" id="loading-overlay">
        <div class="loading-content">
            <div class="spinner-border text-primary" role="status">
                <span class="sr-only">Loading...</span>
            </div>
            <p class="mt-3" id="loading-message">Memproses...</p>
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
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

    <script src="/js/teknisi-psb.js"></script>
</body>

</html>

