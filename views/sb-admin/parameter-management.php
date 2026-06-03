<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>RAF BOT - Parameter Management</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <style>
        .parameter-card {
            border-left: 4px solid #4e73df;
            margin-bottom: 1rem;
        }
        .parameter-type-badge {
            font-size: 0.75rem;
            padding: 0.25rem 0.5rem;
        }
        .path-item {
            background-color: #f8f9fc;
            border: 1px solid #e3e6f0;
            border-radius: 0.35rem;
            padding: 0.5rem;
            margin-bottom: 0.5rem;
            position: relative;
        }
        .path-item .btn-remove {
            position: absolute;
            top: 0.25rem;
            right: 0.25rem;
            padding: 0.125rem 0.25rem;
            font-size: 0.75rem;
        }
        .add-path-btn {
            border: 2px dashed #d1d3e2;
            background: transparent;
            color: #6c757d;
            padding: 1rem;
            text-align: center;
            border-radius: 0.35rem;
            transition: all 0.2s;
        }
        .add-path-btn:hover {
            border-color: #4e73df;
            color: #4e73df;
            background-color: rgba(78, 115, 223, 0.05);
        }
        .test-result {
            margin-top: 1rem;
            padding: 1rem;
            border-radius: 0.35rem;
        }
        .test-success {
            background-color: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
        }
        .test-error {
            background-color: #f8d7da;
            border: 1px solid #f5c6cb;
            color: #721c24;
        }
        .test-warning {
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            color: #856404;
        }
    </style>
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

    <script>
        let parameters = [];

        // Load parameters on page load
        $(document).ready(function() {
            loadParameters();
            
            // Get current user
            fetch('/api/me', { credentials: 'include' })
                .then(response => response.json())
                .then(data => {
                    if (data.status === 200 && data.data && data.data.username) {
                        $('#username-placeholder').text(data.data.username);
                    }
                }).catch(err => console.warn("Could not fetch user data: ", err));
        });

        async function loadParameters() {
            try {
                const response = await fetch('/api/genieacs-parameters', { credentials: 'include' });
                const result = await response.json();
                
                if (result.status === 200) {
                    parameters = result.data;
                    renderParameters();
                } else {
                    console.error('Failed to load parameters:', result.message);
                    showAlert('Gagal memuat parameter: ' + result.message, 'danger');
                }
            } catch (error) {
                console.error('Error loading parameters:', error);
                showAlert('Error memuat parameter: ' + error.message, 'danger');
            }
        }

        function renderParameters() {
            const container = $('#parametersContainer');
            container.empty();

            if (parameters.length === 0) {
                container.html(`
                    <div class="text-center py-4">
                        <i class="fas fa-cogs fa-3x text-gray-300 mb-3"></i>
                        <h5 class="text-gray-500">Belum ada parameter yang dikonfigurasi</h5>
                        <p class="text-gray-400">Klik "Tambah Parameter Baru" untuk memulai</p>
                    </div>
                `);
                return;
            }

            parameters.forEach(param => {
                let badgeColor = 'info';
                if (param.type === 'redaman') badgeColor = 'primary';
                else if (param.type === 'temperature') badgeColor = 'warning';
                else if (param.type === 'serialNumber') badgeColor = 'success';
                
                const pathsHtml = param.paths.map(path => 
                    `<code class="d-block mb-1">${path}</code>`
                ).join('');

                const card = $(`
                    <div class="parameter-card card">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-start mb-2">
                                <div>
                                    <h6 class="card-title mb-1">
                                        ${param.name}
                                        <span class="badge badge-${badgeColor} parameter-type-badge ml-2">${param.type.toUpperCase()}</span>
                                    </h6>
                                    <p class="card-text text-muted small mb-2">${param.description || 'Tidak ada deskripsi'}</p>
                                </div>
                                <div class="btn-group">
                                    <button class="btn btn-sm btn-outline-primary" onclick="editParameter('${param.id}')">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn btn-sm btn-outline-danger" onclick="deleteParameter('${param.id}')">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                            </div>
                            <div>
                                <small class="text-muted d-block mb-1"><strong>GenieACS Paths:</strong></small>
                                ${pathsHtml}
                            </div>
                        </div>
                    </div>
                `);
                
                container.append(card);
            });
        }

        function addPath() {
            const pathItem = $(`
                <div class="path-item">
                    <input type="text" class="form-control path-input" placeholder="e.g., VirtualParameters.Temperature" required>
                    <button type="button" class="btn btn-danger btn-sm btn-remove" onclick="removePath(this)">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `);
            $('#pathsContainer').append(pathItem);
        }

        function addEditPath() {
            const pathItem = $(`
                <div class="path-item">
                    <input type="text" class="form-control path-input" placeholder="e.g., VirtualParameters.Temperature" required>
                    <button type="button" class="btn btn-danger btn-sm btn-remove" onclick="removePath(this)">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `);
            $('#editPathsContainer').append(pathItem);
        }

        function removePath(button) {
            $(button).closest('.path-item').remove();
        }

        async function saveParameter() {
            const type = $('#parameterType').val();
            const name = $('#parameterName').val();
            const description = $('#parameterDescription').val();
            const paths = [];
            
            $('#pathsContainer .path-input').each(function() {
                const path = $(this).val().trim();
                if (path) paths.push(path);
            });

            if (!type || !name || paths.length === 0) {
                showAlert('Semua field wajib diisi dan minimal satu path harus ada', 'warning');
                return;
            }

            try {
                const response = await fetch('/api/genieacs-parameters', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify({
                        type,
                        name,
                        description,
                        paths
                    })
                });

                const result = await response.json();
                
                if (result.status === 200) {
                    $('#addParameterModal').modal('hide');
                    $('#addParameterForm')[0].reset();
                    $('#pathsContainer').html(`
                        <div class="path-item">
                            <input type="text" class="form-control path-input" placeholder="e.g., VirtualParameters.RXPower" required>
                            <button type="button" class="btn btn-danger btn-sm btn-remove" onclick="removePath(this)">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    `);
                    loadParameters();
                    showAlert('Parameter berhasil disimpan', 'success');
                } else {
                    showAlert('Gagal menyimpan parameter: ' + result.message, 'danger');
                }
            } catch (error) {
                console.error('Error saving parameter:', error);
                showAlert('Error menyimpan parameter: ' + error.message, 'danger');
            }
        }

        function editParameter(id) {
            const param = parameters.find(p => p.id === id);
            if (!param) return;

            $('#editParameterId').val(param.id);
            $('#editParameterType').val(param.type);
            $('#editParameterName').val(param.name);
            $('#editParameterDescription').val(param.description || '');
            
            // Clear and populate paths
            const pathsContainer = $('#editPathsContainer');
            pathsContainer.empty();
            
            param.paths.forEach(path => {
                const pathItem = $(`
                    <div class="path-item">
                        <input type="text" class="form-control path-input" value="${path}" required>
                        <button type="button" class="btn btn-danger btn-sm btn-remove" onclick="removePath(this)">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                `);
                pathsContainer.append(pathItem);
            });

            $('#editParameterModal').modal('show');
        }

        async function updateParameter() {
            const id = $('#editParameterId').val();
            const type = $('#editParameterType').val();
            const name = $('#editParameterName').val();
            const description = $('#editParameterDescription').val();
            const paths = [];
            
            $('#editPathsContainer .path-input').each(function() {
                const path = $(this).val().trim();
                if (path) paths.push(path);
            });

            if (!type || !name || paths.length === 0) {
                showAlert('Semua field wajib diisi dan minimal satu path harus ada', 'warning');
                return;
            }

            try {
                const response = await fetch(`/api/genieacs-parameters/${id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify({
                        type,
                        name,
                        description,
                        paths
                    })
                });

                const result = await response.json();
                
                if (result.status === 200) {
                    $('#editParameterModal').modal('hide');
                    loadParameters();
                    showAlert('Parameter berhasil diupdate', 'success');
                } else {
                    showAlert('Gagal mengupdate parameter: ' + result.message, 'danger');
                }
            } catch (error) {
                console.error('Error updating parameter:', error);
                showAlert('Error mengupdate parameter: ' + error.message, 'danger');
            }
        }

        async function deleteParameter(id) {
            if (!confirm('Yakin ingin menghapus parameter ini?')) return;

            try {
                const response = await fetch(`/api/genieacs-parameters/${id}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });

                const result = await response.json();
                
                if (result.status === 200) {
                    loadParameters();
                    showAlert('Parameter berhasil dihapus', 'success');
                } else {
                    showAlert('Gagal menghapus parameter: ' + result.message, 'danger');
                }
            } catch (error) {
                console.error('Error deleting parameter:', error);
                showAlert('Error menghapus parameter: ' + error.message, 'danger');
            }
        }

        async function testParameter() {
            const deviceId = $('#testDeviceId').val().trim();
            const parameterType = $('#testParameterType').val();
            
            if (!deviceId) {
                showAlert('Device ID harus diisi', 'warning');
                return;
            }

            $('#testParameterBtn').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Testing...');
            $('#testResults').empty();

            try {
                const response = await fetch('/api/test-parameter', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify({
                        deviceId,
                        parameterType
                    })
                });

                const result = await response.json();
                
                let resultClass = 'test-success';
                let icon = 'fas fa-check-circle';
                
                if (result.status !== 200) {
                    resultClass = 'test-error';
                    icon = 'fas fa-times-circle';
                } else if (!result.data.value) {
                    resultClass = 'test-warning';
                    icon = 'fas fa-exclamation-triangle';
                }

                const messageHtml = result.message ? '<p><strong>Message:</strong> ' + result.message + '</p>' : '';
                $('#testResults').html(`
                    <div class="${resultClass}">
                        <h6><i class="${icon}"></i> Test Result</h6>
                        <p><strong>Device ID:</strong> ${deviceId}</p>
                        <p><strong>Parameter:</strong> ${parameterType}</p>
                        <p><strong>Value:</strong> ${result.data?.value || 'N/A'}</p>
                        <p><strong>Path Found:</strong> ${result.data?.pathFound || 'None'}</p>
                        ${messageHtml}
                    </div>
                `);
                
            } catch (error) {
                console.error('Error testing parameter:', error);
                $('#testResults').html(`
                    <div class="test-error">
                        <h6><i class="fas fa-times-circle"></i> Test Error</h6>
                        <p>Error: ${error.message}</p>
                    </div>
                `);
            } finally {
                $('#testParameterBtn').prop('disabled', false).html('<i class="fas fa-vial"></i> Test Parameter');
            }
        }

        $('#testParameterBtn').click(testParameter);

        // Test Custom Parameter (not registered)
        async function testCustomParameter() {
            const deviceId = $('#testCustomDeviceId').val().trim();
            const parameterPath = $('#testCustomParameterPath').val().trim();
            
            if (!deviceId) {
                showAlert('Device ID harus diisi', 'warning');
                return;
            }
            
            if (!parameterPath) {
                showAlert('Parameter Path harus diisi', 'warning');
                return;
            }

            $('#testCustomParameterBtn').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Testing...');
            $('#testCustomResults').empty();

            try {
                const response = await fetch('/api/test-parameter-custom', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        deviceId,
                        parameterPath
                    })
                });

                const result = await response.json();
                
                let resultClass = 'test-success';
                let icon = 'fas fa-check-circle';
                
                if (result.status !== 200) {
                    resultClass = 'test-error';
                    icon = 'fas fa-times-circle';
                } else if (result.data.value === null || result.data.value === undefined) {
                    resultClass = 'test-warning';
                    icon = 'fas fa-exclamation-triangle';
                }

                let valueDisplay = 'N/A';
                if (result.data.value !== null && result.data.value !== undefined) {
                    if (typeof result.data.value === 'object') {
                        valueDisplay = JSON.stringify(result.data.value, null, 2);
                    } else {
                        valueDisplay = String(result.data.value);
                    }
                }

                const messageHtml = result.message ? '<p><strong>Message:</strong> ' + result.message + '</p>' : '';
                const rawValueHtml = result.data.rawValue ? '<p><strong>Raw Value (JSON):</strong><pre class="bg-light p-2 rounded mt-2" style="max-height: 200px; overflow-y: auto;">' + JSON.stringify(result.data.rawValue, null, 2) + '</pre></p>' : '';
                
                $('#testCustomResults').html(`
                    <div class="test-result ${resultClass}">
                        <h6><i class="${icon}"></i> Test Result</h6>
                        <p><strong>Device ID:</strong> ${deviceId}</p>
                        <p><strong>Parameter Path:</strong> <code>${parameterPath}</code></p>
                        <p><strong>Value:</strong> <code>${valueDisplay}</code></p>
                        <p><strong>Value Type:</strong> ${result.data.valueType || 'N/A'}</p>
                        ${rawValueHtml}
                        ${messageHtml}
                    </div>
                `);
                
            } catch (error) {
                console.error('Error testing custom parameter:', error);
                $('#testCustomResults').html(`
                    <div class="test-result test-error">
                        <h6><i class="fas fa-times-circle"></i> Test Error</h6>
                        <p>Error: ${error.message}</p>
                    </div>
                `);
            } finally {
                $('#testCustomParameterBtn').prop('disabled', false).html('<i class="fas fa-flask"></i> Test');
            }
        }

        $('#testCustomParameterBtn').click(testCustomParameter);

        function showAlert(message, type) {
            const alert = $(`
                <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                    ${message}
                    <button type="button" class="close" data-dismiss="alert" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
            `);
            
            $('.container-fluid').prepend(alert);
            
            setTimeout(() => {
                alert.alert('close');
            }, 5000);
        }
    </script>
</body>

</html>
