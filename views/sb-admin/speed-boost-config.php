<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
  <meta name="description" content="RAF BOT Speed Boost Configuration">
  <meta name="author" content="RAF BOT">
  <title>RAF BOT - Speed Boost Configuration</title>

  <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="/css/sb-admin-2.min.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">
  <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
  <link href="/css/speed-boost-config.css" rel="stylesheet">
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
        <nav class="navbar navbar-expand navbar-light bg-white topbar mb-4 static-top shadow-sm">
          <button type="button" id="sidebarToggleTop" class="btn btn-link d-md-none rounded-circle mr-3">
            <i class="fa fa-bars"></i>
          </button>
          <ul class="navbar-nav ml-auto">
            <li class="nav-item dropdown no-arrow">
              <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                <span class="mr-2 d-none d-lg-inline text-gray-600 small">Admin</span>
                <img class="img-profile rounded-circle" src="/img/undraw_profile.svg">
              </a>
              <div class="dropdown-menu dropdown-menu-right shadow animated--grow-in" aria-labelledby="userDropdown">
                <a class="dropdown-item" href="#" data-toggle="modal" data-target="#logoutModal">
                  <i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i>
                  Logout
                </a>
              </div>
            </li>
          </ul>
        </nav>
        <!-- End of Topbar -->

        <!-- Begin Page Content -->
        <div class="container-fluid">
          
          <!-- Page Header -->
          <div class="dashboard-header">
            <div class="d-flex align-items-center justify-content-between">
              <div>
                <h1>Speed Boost Configuration</h1>
                <p>Kelola harga dan konfigurasi Speed Boost On Demand</p>
              </div>
              <div>
                <button class="btn btn-success" onclick="saveConfiguration()">
                  <i class="fas fa-save"></i> Simpan Konfigurasi
                </button>
              </div>
            </div>
          </div>

          <!-- Navigation Tabs -->
          <ul class="nav nav-tabs mb-4" id="speedBoostTabs" role="tablist">
            <li class="nav-item">
              <a class="nav-link active" id="general-tab" data-toggle="tab" href="#general" role="tab">
                <i class="fas fa-cog"></i> Pengaturan Umum
              </a>
            </li>
            <li class="nav-item">
              <a class="nav-link" id="pricing-tab" data-toggle="tab" href="#pricing" role="tab">
                <i class="fas fa-tags"></i> Pricing Matrix
              </a>
            </li>
            <li class="nav-item">
              <a class="nav-link" id="packages-tab" data-toggle="tab" href="#packages" role="tab">
                <i class="fas fa-box"></i> Custom Packages
              </a>
            </li>
            <li class="nav-item">
              <a class="nav-link" id="payment-tab" data-toggle="tab" href="#payment" role="tab">
                <i class="fas fa-credit-card"></i> Metode Pembayaran
              </a>
            </li>
            <li class="nav-item">
              <a class="nav-link" id="templates-tab" data-toggle="tab" href="#templates" role="tab">
                <i class="fas fa-comment-alt"></i> Template Pesan
              </a>
            </li>
          </ul>

          <!-- Tab Content -->
          <div class="tab-content" id="speedBoostTabContent">
            
            <!-- General Settings Tab -->
            <div class="tab-pane fade show active" id="general" role="tabpanel">
              <div class="settings-section">
                <h4 class="mb-3"><i class="fas fa-cog"></i> Pengaturan Global</h4>
                <div class="settings-grid">
                  <div class="form-group">
                    <label>Status Speed Boost</label>
                    <select class="form-control" id="speedBoostEnabled">
                      <option value="true">Aktif</option>
                      <option value="false">Nonaktif</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Multiple Boost</label>
                    <select class="form-control" id="allowMultipleBoosts">
                      <option value="false">Tidak Diizinkan</option>
                      <option value="true">Diizinkan</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Wajib Bayar Dulu</label>
                    <select class="form-control" id="requirePaymentFirst">
                      <option value="true">Ya</option>
                      <option value="false">Tidak</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Auto Approve Double Billing</label>
                    <select class="form-control" id="autoApproveDoubleBoost">
                      <option value="true">Ya</option>
                      <option value="false">Tidak</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Max Durasi (hari)</label>
                    <input type="number" class="form-control" id="maxBoostDuration" value="30">
                  </div>
                  <div class="form-group">
                    <label>Min Durasi (hari)</label>
                    <input type="number" class="form-control" id="minBoostDuration" value="1">
                  </div>
                </div>
              </div>
            </div>

            <!-- Pricing Matrix Tab -->
            <div class="tab-pane fade" id="pricing" role="tabpanel">
              <div class="settings-section">
                <h4 class="mb-3"><i class="fas fa-plus-circle"></i> Tambah Pricing Matrix Baru</h4>
                <div class="row">
                  <div class="col-md-5">
                    <div class="form-group">
                      <label>Dari Paket</label>
                      <select class="form-control select2" id="fromPackage" multiple="multiple">
                        <!-- Will be populated by JavaScript -->
                      </select>
                      <small class="text-muted">Pilih satu atau lebih paket asal</small>
                    </div>
                  </div>
                  <div class="col-md-5">
                    <div class="form-group">
                      <label>Ke Paket</label>
                      <select class="form-control select2" id="toPackage">
                        <!-- Will be populated by JavaScript -->
                      </select>
                      <small class="text-muted">Pilih paket tujuan boost</small>
                    </div>
                  </div>
                  <div class="col-md-2">
                    <div class="form-group">
                      <label>&nbsp;</label>
                      <button class="btn btn-primary btn-block" onclick="addPricingMatrix()">
                        <i class="fas fa-plus"></i> Tambah
                      </button>
                    </div>
                  </div>
                </div>
                
                <div id="newMatrixPricing" style="display: none;">
                  <hr>
                  <h5>Set Harga untuk Matrix Baru</h5>
                  <div class="duration-prices" id="newMatrixDurations">
                    <div class="duration-item">
                      <label>Harga 1 Hari</label>
                      <input type="number" class="form-control" id="price_1_day" placeholder="20000">
                    </div>
                    <div class="duration-item">
                      <label>Harga 3 Hari</label>
                      <input type="number" class="form-control" id="price_3_days" placeholder="50000">
                    </div>
                    <div class="duration-item">
                      <label>Harga 7 Hari</label>
                      <input type="number" class="form-control" id="price_7_days" placeholder="100000">
                    </div>
                  </div>
                  <button class="btn btn-success mt-3" onclick="saveTempMatrix()">
                    <i class="fas fa-save"></i> Simpan Matrix
                  </button>
                  <button class="btn btn-info btn-add-duration mt-3" onclick="addCustomDuration()">
                    <i class="fas fa-plus"></i> Tambah Durasi Custom
                  </button>
                  <div id="customDurations"></div>
                </div>
              </div>

              <div class="settings-section">
                <h4 class="mb-3"><i class="fas fa-table"></i> Pricing Matrix Aktif</h4>
                <div id="pricingMatrixList">
                  <!-- Will be populated by JavaScript -->
                </div>
              </div>
            </div>

            <!-- Custom Packages Tab -->
            <div class="tab-pane fade" id="packages" role="tabpanel">
              <div class="settings-section">
                <h4 class="mb-3"><i class="fas fa-box-open"></i> Custom Speed Boost Packages</h4>
                <button class="btn btn-primary mb-3" onclick="addCustomPackage()">
                  <i class="fas fa-plus"></i> Tambah Custom Package
                </button>
                <div id="customPackagesList">
                  <!-- Will be populated by JavaScript -->
                </div>
              </div>
            </div>

            <!-- Payment Methods Tab -->
            <div class="tab-pane fade" id="payment" role="tabpanel">
              <div class="settings-section">
                <h4 class="mb-3"><i class="fas fa-credit-card"></i> Metode Pembayaran</h4>
                <div class="row">
                  <div class="col-md-4">
                    <div class="card">
                      <div class="card-body">
                        <h5>Cash</h5>
                        <div class="form-group">
                          <label>Status</label>
                          <select class="form-control" id="payment_cash_enabled">
                            <option value="true">Aktif</option>
                            <option value="false">Nonaktif</option>
                          </select>
                        </div>
                        <div class="form-group">
                          <label>Auto Approve</label>
                          <select class="form-control" id="payment_cash_autoApprove">
                            <option value="false">Tidak</option>
                            <option value="true">Ya</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="col-md-4">
                    <div class="card">
                      <div class="card-body">
                        <h5>Transfer</h5>
                        <div class="form-group">
                          <label>Status</label>
                          <select class="form-control" id="payment_transfer_enabled">
                            <option value="true">Aktif</option>
                            <option value="false">Nonaktif</option>
                          </select>
                        </div>
                        <div class="form-group">
                          <label>Wajib Bukti</label>
                          <select class="form-control" id="payment_transfer_requireProof">
                            <option value="true">Ya</option>
                            <option value="false">Tidak</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="col-md-4">
                    <div class="card">
                      <div class="card-body">
                        <h5>Double Billing</h5>
                        <div class="form-group">
                          <label>Status</label>
                          <select class="form-control" id="payment_double_enabled">
                            <option value="true">Aktif</option>
                            <option value="false">Nonaktif</option>
                          </select>
                        </div>
                        <div class="form-group">
                          <label>Max Amount</label>
                          <input type="number" class="form-control" id="payment_double_maxAmount" value="500000">
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Message Templates Tab -->
            <div class="tab-pane fade" id="templates" role="tabpanel">
              <div class="settings-section">
                <h4 class="mb-3"><i class="fas fa-comment-alt"></i> Template Pesan</h4>
                <div class="form-group">
                  <label>Welcome Message</label>
                  <textarea class="form-control" id="template_welcome" rows="3"></textarea>
                </div>
                <div class="form-group">
                  <label>Success Message</label>
                  <textarea class="form-control" id="template_success" rows="4"></textarea>
                  <small class="text-muted">Variables: {requestId}, {packageName}, {duration}, {price}</small>
                </div>
                <div class="form-group">
                  <label>Rejection Message</label>
                  <textarea class="form-control" id="template_rejection" rows="3"></textarea>
                  <small class="text-muted">Variables: {reason}</small>
                </div>
              </div>
            </div>

          </div>

        </div>
        <!-- /.container-fluid -->

      </div>
      <!-- End of Main Content -->

      <!-- Footer -->
      <footer class="sticky-footer bg-white">
        <div class="container my-auto">
          <div class="copyright text-center my-auto">
            <span>Copyright &copy; RAF BOT 2024</span>
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

  <!-- Bootstrap core JavaScript-->
  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
  <script src="/js/sb-admin-2.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
  <script src="/js/speed-boost-config.js"></script>

</body>

</html>
