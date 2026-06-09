<!DOCTYPE html>
<html lang="en">

<head>
    <?php
    $pageTitle = 'RAF BOT - Parameter Management';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="/css/parameter-management.css" rel="stylesheet">
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <nav class="navbar navbar-expand navbar-light bg-white topbar mb-4 static-top shadow">
                    <form class="form-inline">
                        <button type="button" id="sidebarToggleTop" class="btn btn-link d-md-none rounded-circle mr-3">
                            <i class="fa fa-bars"></i>
                        </button>
                    </form>
                    <ul class="navbar-nav ml-auto">
                        <li class="nav-item dropdown no-arrow">
                            <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button" data-toggle="dropdown">
                                <span id="username-placeholder" class="mr-2 d-none d-lg-inline text-gray-600 small">Admin</span>
                                <img class="img-profile rounded-circle" src="/img/undraw_profile.svg">
                            </a>
                            <div class="dropdown-menu dropdown-menu-right shadow animated--grow-in" aria-labelledby="userDropdown">
                                <a class="dropdown-item" href="#" data-toggle="modal" data-target="#logoutModal">
                                    <i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i>Logout
                                </a>
                            </div>
                        </li>
                    </ul>
                </nav>

                <div class="container-fluid">
                    <div class="d-sm-flex align-items-center justify-content-between mb-4">
                        <!-- Page Header -->
          <div class="dashboard-header">
            <h1>Parameter Management</h1>
            <p>Kelola dan monitor parameter management</p>
          </div>
                        <button class="btn btn-primary btn-sm" data-toggle="modal" data-target="#addParameterModal">
                            <i class="fas fa-plus fa-sm"></i> Tambah Parameter Baru
                        </button>
                    </div>

                    <div class="row">
                        <div class="col-lg-12">
                            <!-- Table Section -->
          <h4 class="dashboard-section-title">GenieACS Parameter Configuration</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>GenieACS Parameter Configuration</h6>
                                    <small class="text-muted">Kelola parameter GenieACS untuk redaman, temperature, dan tipe modem</small>
                                </div>
                                <div class="card-body">
                                    <div id="parametersContainer">
                                        <!-- Parameters will be loaded here -->
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Test Parameter Card (Registered) -->
                    <div class="row">
                        <div class="col-lg-12">
                            <div class="card shadow mb-4">
                                <div class="card-header py-3">
                                    <h6 class="m-0 font-weight-bold text-success">Test Parameter (Terdaftar)</h6>
                                    <small class="text-muted">Test parameter yang sudah terdaftar di sistem</small>
                                </div>
                                <div class="card-body">
                                    <div class="row">
                                        <div class="col-md-6">
                                            <div class="form-group">
                                                <label for="testDeviceId">Device ID</label>
                                                <input type="text" class="form-control" id="testDeviceId" placeholder="Masukkan Device ID untuk test">
                                            </div>
                                        </div>
                                        <div class="col-md-3">
                                            <div class="form-group">
                                                <label for="testParameterType">Parameter Type</label>
                                                <select class="form-control" id="testParameterType">
                                                    <option value="redaman">Redaman</option>
                                                    <option value="temperature">Temperature</option>
                                                    <option value="modemType">Modem Type</option>
                                                    <option value="serialNumber">Serial Number</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div class="col-md-3">
                                            <div class="form-group">
                                                <label>&nbsp;</label>
                                                <button type="button" class="btn btn-success btn-block" id="testParameterBtn">
                                                    <i class="fas fa-vial"></i> Test Parameter
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <div id="testResults"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Test Parameter Custom Card (Not Registered) -->
                    <div class="row">
                        <div class="col-lg-12">
                            <div class="card shadow mb-4">
                                <div class="card-header py-3">
                                    <h6 class="m-0 font-weight-bold text-primary">Test Parameter Custom</h6>
                                    <small class="text-muted">Test parameter langsung dengan path GenieACS tanpa perlu mendaftar</small>
                                </div>
                                <div class="card-body">
                                    <div class="row">
                                        <div class="col-md-4">
                                            <div class="form-group">
                                                <label for="testCustomDeviceId">Device ID <span class="text-danger">*</span></label>
                                                <input type="text" class="form-control" id="testCustomDeviceId" placeholder="e.g., 94BF80-F663NV3A-ZTEGCB683800">
                                                <small class="form-text text-muted">Device ID dari GenieACS</small>
                                            </div>
                                        </div>
                                        <div class="col-md-6">
                                            <div class="form-group">
                                                <label for="testCustomParameterPath">GenieACS Parameter Path <span class="text-danger">*</span></label>
                                                <input type="text" class="form-control" id="testCustomParameterPath" placeholder="e.g., Events.Registered, VirtualParameters.RXPower">
                                                <small class="form-text text-muted">Path parameter GenieACS (gunakan dot notation, contoh: Events.Registered)</small>
                                            </div>
                                        </div>
                                        <div class="col-md-2">
                                            <div class="form-group">
                                                <label>&nbsp;</label>
                                                <button type="button" class="btn btn-primary btn-block" id="testCustomParameterBtn">
                                                    <i class="fas fa-flask"></i> Test
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <div id="testCustomResults"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <footer class="sticky-footer bg-white">
                <div class="container my-auto">
                    <div class="copyright text-center my-auto">
                        <span>Copyright &copy; RAF BOT 2025</span>
                    </div>
                </div>
            </footer>
        </div>
    </div>

    <a class="scroll-to-top rounded" href="#page-top">
        <i class="fas fa-angle-up"></i>
    </a>

    <!-- Logout Modal -->
    <div class="modal fade" id="logoutModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Ready to Leave?</h5>
                    <button class="close" type="button" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">Select "Logout" to end session.</div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button>
                    <a class="btn btn-primary" href="/logout">Logout</a>
                </div>
            </div>
        </div>
    </div>

    <!-- Add Parameter Modal -->
    <div class="modal fade" id="addParameterModal" tabindex="-1">
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Tambah Parameter Baru</h5>
                    <button type="button" class="close" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="addParameterForm">
                        <div class="form-group">
                            <label for="parameterType">Tipe Parameter</label>
                            <select class="form-control" id="parameterType" required>
                                <option value="">-- Pilih Tipe Parameter --</option>
                                <option value="redaman">Redaman (Signal Strength)</option>
                                <option value="temperature">Temperature</option>
                                <option value="modemType">Modem Type</option>
                                <option value="serialNumber">Serial Number</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="parameterName">Nama Parameter</label>
                            <input type="text" class="form-control" id="parameterName" required placeholder="e.g., RX Power, Temperature Sensor">
                        </div>
                        <div class="form-group">
                            <label for="parameterDescription">Deskripsi</label>
                            <textarea class="form-control" id="parameterDescription" rows="2" placeholder="Deskripsi parameter ini"></textarea>
                        </div>
                        <div class="form-group">
                            <label>GenieACS Paths</label>
                            <div id="pathsContainer">
                                <div class="path-item">
                                    <input type="text" class="form-control path-input" placeholder="e.g., VirtualParameters.RXPower" required>
                                    <button type="button" class="btn btn-danger btn-sm btn-remove" onclick="removePath(this)">
                                        <i class="fas fa-times"></i>
                                    </button>
                                </div>
                            </div>
                            <button type="button" class="btn btn-outline-primary btn-sm add-path-btn w-100" onclick="addPath()">
                                <i class="fas fa-plus"></i> Tambah Path
                            </button>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-primary" onclick="saveParameter()">Simpan Parameter</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Edit Parameter Modal -->
    <div class="modal fade" id="editParameterModal" tabindex="-1">
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Edit Parameter</h5>
                    <button type="button" class="close" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="editParameterForm">
                        <input type="hidden" id="editParameterId">
                        <div class="form-group">
                            <label for="editParameterType">Tipe Parameter</label>
                            <select class="form-control" id="editParameterType" required>
                                <option value="redaman">Redaman (Signal Strength)</option>
                                <option value="temperature">Temperature</option>
                                <option value="modemType">Modem Type</option>
                                <option value="serialNumber">Serial Number</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="editParameterName">Nama Parameter</label>
                            <input type="text" class="form-control" id="editParameterName" required>
                        </div>
                        <div class="form-group">
                            <label for="editParameterDescription">Deskripsi</label>
                            <textarea class="form-control" id="editParameterDescription" rows="2"></textarea>
                        </div>
                        <div class="form-group">
                            <label>GenieACS Paths</label>
                            <div id="editPathsContainer">
                                <!-- Paths will be loaded here -->
                            </div>
                            <button type="button" class="btn btn-outline-primary btn-sm add-path-btn w-100" onclick="addEditPath()">
                                <i class="fas fa-plus"></i> Tambah Path
                            </button>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-primary" onclick="updateParameter()">Update Parameter</button>
                </div>
            </div>
        </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>

    <script src="/js/parameter-management.js"></script>
</body>

</html>
