<!DOCTYPE html>
<html lang="en">

<head>
    <?php
    $pageTitle = 'RAF BOT - Pelanggan Teknisi';
    $themeRole = 'teknisi';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />
    <link href="/css/teknisi-pelanggan.css" rel="stylesheet">
</head>

<body id="page-top">
    <div id="wrapper">
    <?php include '_role_aware_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include '_role_aware_teknisi_topbar.php'; ?>

                <div class="container-fluid">
                    <div class="tk-page-head">
                        <div class="tk-title">
                            <span class="tk-title-icon"><i class="fas fa-users"></i></span>
                            <div>
                                <h1>Kelola Pelanggan</h1>
                                <p class="tk-subtitle">Daftar & manajemen data pelanggan terpasang</p>
                            </div>
                        </div>
                    </div>
                    <div class="card shadow mb-4">
                        <div class="card-header py-3">
                            <div class="d-flex justify-content-between align-items-center">
                                <h6 class="m-0 font-weight-bold text-primary">Semua Pelanggan</h6>
                                <div>
                                    <button id="refreshPppoeBtn" class="btn btn-info btn-sm mr-2" title="Refresh data PPPoE dari MikroTik">
                                        <i class="fas fa-sync-alt"></i> <span id="pppoeStatusText">Refresh PPPoE</span>
                                    </button>
                                    <button id="refreshDataBtn" class="btn btn-primary btn-sm" disabled>
                                        <i class="fas fa-sync-alt"></i> <span>Refresh Data</span>
                                    </button>
                                </div>
                            </div>
                            <div class="row mt-3 gx-2">
                                <div class="col-md-3 mb-2 mb-md-0">
                                    <label for="odcFilterDropdown" class="form-label mb-1 d-block" style="font-size: 0.8rem;">Filter ODC</label>
                                    <select id="odcFilterDropdown" class="form-control form-control-sm" style="width: 100%;"></select>
                                </div>
                                <div class="col-md-3 mb-2 mb-md-0">
                                    <label for="odpFilterDropdown" class="form-label mb-1 d-block" style="font-size: 0.8rem;">Filter ODP</label>
                                    <select id="odpFilterDropdown" class="form-control form-control-sm" style="width: 100%;"></select>
                                </div>
                                <div class="col-md-3 d-flex align-items-end mb-2 mb-md-0">
                                    <button id="applyUserFilters" class="btn btn-primary btn-sm w-100">Terapkan Filter</button>
                                </div>
                                <div class="col-md-3 d-flex align-items-end">
                                    <button id="clearUserFilters" class="btn btn-outline-secondary btn-sm w-100">Bersihkan Filter</button>
                                </div>
                            </div>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered table-sm" id="dataTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Nama</th>
                                            <th>Telepon</th>
                                            <th>Device ID</th>
                                            <th>Alamat</th>
                                            <th>Koordinat</th>
                                            <th>ODP Terhubung</th>
                                            <th>Paket</th>
                                            <th>Bayar</th>
                                            <th>PPPoE User</th>
                                            <th>Status</th>
                                            <th>IP Pelanggan</th>
                                            <th class="redaman-column">Redaman (dBm)</th>
                                            <th class="redaman-olt-column">Redaman OLT</th>
                                            <th class="olt-status-column">Status OLT</th>
                                            <th class="suhu-column">Suhu (°C)</th>
                                            <th class="tipe-router-column">Tipe Router</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody></tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <footer class="sticky-footer bg-white"><div class="container my-auto"><div class="copyright text-center my-auto"><span>Copyright &copy; RAF BOT 2025</span></div></div></footer>
        </div>
    </div>

    <a class="scroll-to-top rounded" href="#page-top"><i class="fas fa-angle-up"></i></a>
    <div class="modal fade" id="logoutModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">Ready to Leave?</h5><button class="close" type="button" data-dismiss="modal">&times;</button></div><div class="modal-body">Select "Logout" to end session.</div><div class="modal-footer"><button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button><a class="btn btn-primary" href="/logout">Logout</a></div></div></div></div>

    <div class="modal fade" id="ssid-update" data-backdrop="static" tabindex="-1">
        <div class="modal-dialog"> <form class="modal-content" id="ssidUpdateForm">
                <div class="modal-header"><h5 class="modal-title" id="ssidUpdateModalTitle">Perbarui SSID</h5><button type="button" class="close" data-dismiss="modal" aria-label="Close">&times;</button></div>
                <div class="modal-body">
                    <input type="hidden" id="ssid_update_device_id" name="device_id_for_ssid_update">
                    <div id="edit-ssid-container" class="mb-3">
                        <div class="loading-spinner-container"><i class="fas fa-spinner fa-spin fa-2x"></i> <p>Memuat data SSID...</p></div>
                    </div>
                    <div id="edit-ssid-passwd-container" class="mb-3">
                        </div>
                     <hr>
                    <div class="mb-3">
                        <label for="transmit_power" class="form-label">Transmit Power (WLAN 1)</label>
                        <select name="transmit_power" id="transmit_power" class="form-control form-control-sm">
                            <option value="">-- Pilih Transmit Power --</option>
                            <option value="20">20%</option>
                            <option value="40">40%</option>
                            <option value="60">60%</option>
                            <option value="80">80%</option>
                            <option value="100">100%</option>
                            </select>
                    </div>
                    <small class="form-text text-muted">Kosongkan password jika tidak ingin mengubahnya. Perubahan akan dikirim ke perangkat.</small>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-outline-secondary btn-sm" data-dismiss="modal">Batal</button>
                    <button type="submit" class="btn btn-primary btn-sm" id="saveSsidChangesBtn">Simpan Perubahan SSID</button>
                </div>
            </form>
        </div>
    </div>

    <div class="modal fade" id="connectedDevicesModal" data-backdrop="static" tabindex="-1" role="dialog" aria-labelledby="connectedDevicesModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-lg" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="connectedDevicesModalLabel">Perangkat Terhubung</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <div class="modal-body" id="connectedDevicesModalBody" style="max-height: 75vh; overflow-y: auto;">
                    <p class="text-center my-3"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Memuat informasi...</p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary btn-sm" data-dismiss="modal">Tutup</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="errorModal" tabindex="-1" role="dialog" aria-labelledby="errorModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered" role="document">
            <div class="modal-content">
                <div class="modal-header bg-danger text-white">
                    <h5 class="modal-title" id="errorModalLabel"><i class="fas fa-exclamation-triangle"></i> Terjadi Kesalahan!</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <div class="modal-body" id="errorModalBody">
                    </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-danger btn-sm" data-dismiss="modal">Tutup</button>
                </div>
            </div>
        </div>
    </div>


    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
    <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>

    <script src="/js/teknisi-pelanggan.js"></script>
</body>
</html>
