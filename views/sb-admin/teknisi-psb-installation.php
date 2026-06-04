<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>RAF BOT - Proses Instalasi PSB</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/css/teknisi-theme.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />
    <style>
        .form-label { margin-bottom: .3rem; font-size: 0.8rem; font-weight: 500; }
        .form-control-sm { font-size: 0.8rem; padding: .25rem .5rem; height: calc(1.5em + .5rem + 2px); }
        .btn-sm { padding: .25rem .5rem; font-size: .75rem; }
        .status-badge {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        .status-phase1 { background: #fff3cd; color: #856404; }
        .status-teknisi-meluncur { background: #cfe2ff; color: #084298; }
        .status-phase2 { background: #d1ecf1; color: #0c5460; }
        .status-completed { background: #d4edda; color: #155724; }
        
        /* Mobile Responsive Styles */
        @media (max-width: 768px) {
            .container-fluid {
                padding: 0.75rem;
            }
            
            /* Page Header */
            .d-sm-flex {
                flex-direction: column !important;
                align-items: flex-start !important;
            }
            
            .d-sm-flex > div {
                width: 100%;
                margin-top: 1rem;
            }
            
            .d-sm-flex .btn {
                width: 100%;
                margin-bottom: 0.5rem;
            }
            
            .d-sm-flex .btn:last-child {
                margin-bottom: 0;
            }
            
            /* Table responsive */
            .table-responsive {
                overflow-x: auto;
                -webkit-overflow-scrolling: touch;
            }
            
            .table {
                font-size: 0.85rem;
            }
            
            .table th, .table td {
                padding: 0.5rem;
                white-space: nowrap;
            }
            
            /* Buttons in table */
            .table .btn {
                font-size: 0.75rem;
                padding: 0.25rem 0.5rem;
                white-space: nowrap;
            }
            
            /* Modal adjustments */
            .modal-dialog {
                margin: 0.5rem;
                max-width: calc(100% - 1rem);
            }
            
            .modal-body {
                max-height: calc(100vh - 150px);
                padding: 1rem;
                overflow-y: auto;
            }
            
            /* Form in modal */
            .modal-body .form-control,
            .modal-body select {
                font-size: 16px !important; /* Prevents zoom on iOS */
            }
            
            /* Select2 mobile */
            .select2-container {
                width: 100% !important;
            }
            
            /* Card body padding */
            .card-body {
                padding: 1rem;
            }
        }
        
        @media (max-width: 576px) {
            .container-fluid {
                padding: 0.5rem;
            }
            
            h1.h3 {
                font-size: 1.25rem;
            }
            
            .table {
                font-size: 0.75rem;
            }
            
            .table th, .table td {
                padding: 0.375rem;
            }
            
            .table .btn {
                font-size: 0.7rem;
                padding: 0.2rem 0.4rem;
            }
            
            .card-body {
                padding: 0.75rem;
            }
            
            /* Hide some columns on very small screens */
            .table th:nth-child(3),
            .table td:nth-child(3) {
                display: none;
            }
        }
    </style>
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
                            <span class="tk-title-icon"><i class="fas fa-tools"></i></span>
                            <div>
                                <h1>Proses Instalasi PSB</h1>
                                <p class="tk-subtitle">Kelola progres instalasi perangkat pelanggan baru</p>
                            </div>
                        </div>
                        <div class="tk-actions">
                            <a href="/teknisi-psb" class="btn btn-outline-primary">
                                <i class="fas fa-user-plus"></i> Daftar Pelanggan Baru
                            </a>
                            <a href="/teknisi-psb-setup" class="btn btn-outline-primary">
                                <i class="fas fa-wifi"></i> Setup Pelanggan
                            </a>
                        </div>
                    </div>

                    <!-- Messages -->
                    <div id="message-container"></div>

                    <!-- Installation List -->
                    <div class="card shadow mb-4">
                        <div class="card-header py-3">
                            <h6 class="m-0 font-weight-bold text-primary">
                                <i class="fas fa-list"></i> Daftar Pelanggan untuk Instalasi
                            </h6>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered table-sm" id="installationTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Nama</th>
                                            <th>HP</th>
                                            <th>Alamat</th>
                                            <th>Status</th>
                                            <th>Tanggal Daftar</th>
                                            <th>Aksi</th>
                                        </tr>
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

    <!-- Installation Modal -->
    <div class="modal fade" id="installationModal" tabindex="-1" role="dialog">
        <div class="modal-dialog modal-lg" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Proses Instalasi</h5>
                    <button type="button" class="close" data-dismiss="modal">
                        <span>&times;</span>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="alert alert-info">
                        <strong>Info Pelanggan:</strong> 
                        <span id="modal-customer-info">-</span>
                    </div>
                    
                    <form id="installation-form">
                        <input type="hidden" id="modal-customer-id" name="customer_id" />
                        
                        <!-- ODP/ODC yang Digunakan Saat Instalasi -->
                        <div class="row mb-4">
                            <div class="col-md-12">
                                <h5 class="mb-3"><i class="fas fa-network-wired"></i> ODP/ODC yang Digunakan</h5>
                            </div>
                            <div class="col-md-6 mb-3">
                                <label for="modal-installed-odc-id" class="form-label">ODC yang Digunakan <small class="text-muted">(optional)</small></label>
                                <select class="form-control form-control-sm" id="modal-installed-odc-id" name="installed_odc_id" style="width: 100%;">
                                    <option value="">Pilih ODC...</option>
                                </select>
                                <small class="form-text text-muted">ODC yang digunakan saat instalasi (opsional)</small>
                            </div>
                            <div class="col-md-6 mb-3">
                                <label for="modal-installed-odp-id" class="form-label">ODP yang Digunakan <small class="text-muted">(optional)</small></label>
                                <select class="form-control form-control-sm" id="modal-installed-odp-id" name="installed_odp_id" style="width: 100%;" disabled>
                                    <option value="">Pilih ODP...</option>
                                </select>
                                <small class="form-text text-muted">Pilih ODC terlebih dahulu untuk memilih ODP (opsional)</small>
                            </div>
                            <div class="col-md-6 mb-3">
                                <label for="modal-port-number" class="form-label">Port yang Digunakan</label>
                                <input type="number" class="form-control form-control-sm" id="modal-port-number" name="port_number" min="1" placeholder="Port number (optional)" />
                                <small class="form-text text-muted">Nomor port yang digunakan di ODP</small>
                            </div>
                        </div>

                        <hr class="my-4">

                        <!-- Catatan Instalasi -->
                        <div class="row mb-4">
                            <div class="col-md-12">
                                <h5 class="mb-3"><i class="fas fa-sticky-note"></i> Catatan Instalasi</h5>
                            </div>
                            <div class="col-md-12 mb-3">
                                <label for="modal-installation-notes" class="form-label">Catatan Instalasi</label>
                                <textarea class="form-control form-control-sm" id="modal-installation-notes" name="installation_notes" rows="4" placeholder="Catatan tambahan tentang proses instalasi (optional)"></textarea>
                                <small class="form-text text-muted">Catatan tentang kondisi instalasi, kendala, atau informasi penting lainnya</small>
                            </div>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-success" id="submit-installation-btn">
                        <i class="fas fa-check"></i> Selesai Pemasangan
                    </button>
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
    <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
    <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

    <script>
        let installationTable = null;
        let allOdcList = [];
        let allOdpList = [];

        $(document).ready(function() {
            loadNetworkAssets();
            initializeTable();
            setupEventHandlers();
        });

        // Load network assets
        function loadNetworkAssets() {
            fetch(`/api/map/network-assets?_=${new Date().getTime()}`, { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200 && Array.isArray(data.data)) {
                        allOdcList = data.data.filter(asset => asset.type === 'ODC').sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                        allOdpList = data.data.filter(asset => asset.type === 'ODP').sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                    }
                })
                .catch(err => {
                    console.error('Error loading network assets:', err);
                });
        }

        // Initialize DataTable
        function initializeTable() {
            installationTable = $('#installationTable').DataTable({
                processing: true,
                serverSide: false,
                ajax: {
                    url: '/api/psb/list-customers',
                    dataSrc: function(json) {
                        // Filter only PSB customers (phase1_completed, teknisi_meluncur, or phase2_completed)
                        if (json.data && Array.isArray(json.data)) {
                            return json.data.filter(customer => 
                                customer.psb_status === 'phase1_completed' || 
                                customer.psb_status === 'teknisi_meluncur' ||
                                customer.psb_status === 'phase2_completed'
                            );
                        }
                        return [];
                    }
                },
                pageLength: 10,
                lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, "Semua"]],
                columns: [
                    { data: 'id' },
                    { data: 'name' },
                    { data: 'phone_number' },
                    { data: 'address', defaultContent: '-' },
                    { 
                        data: 'psb_status',
                        render: function(data) {
                            if (data === 'phase1_completed') {
                                return '<span class="status-badge status-phase1">Menunggu Instalasi</span>';
                            } else if (data === 'teknisi_meluncur') {
                                return '<span class="status-badge status-teknisi-meluncur">Teknisi Meluncur</span>';
                            } else if (data === 'phase2_completed') {
                                return '<span class="status-badge status-phase2">Selesai Instalasi</span>';
                            }
                            return '<span class="status-badge">-</span>';
                        }
                    },
                    { 
                        data: 'created_at',
                        render: function(data) {
                            if (data) {
                                const date = new Date(data);
                                return date.toLocaleDateString('id-ID');
                            }
                            return '-';
                        }
                    },
                    {
                        data: null,
                        orderable: false,
                        render: function(data, type, row) {
                            let buttons = '';
                            
                            if (row.psb_status === 'phase1_completed') {
                                buttons += `<button class="btn btn-sm btn-info mr-1 mb-1" onclick="updateStatusToMeluncur(${row.id}, '${row.name.replace(/'/g, "\\'")}')" title="Teknisi sedang meluncur ke lokasi">
                                    <i class="fas fa-car"></i> Teknisi Meluncur
                                </button>`;
                                buttons += `<button class="btn btn-sm btn-primary mb-1" onclick="openInstallationModal(${row.id}, '${row.name.replace(/'/g, "\\'")}', '${row.phone_number}')">
                                    <i class="fas fa-tools"></i> Proses Instalasi
                                </button>`;
                            } else if (row.psb_status === 'teknisi_meluncur') {
                                buttons += `<button class="btn btn-sm btn-primary mb-1" onclick="openInstallationModal(${row.id}, '${row.name.replace(/'/g, "\\'")}', '${row.phone_number}')">
                                    <i class="fas fa-tools"></i> Proses Instalasi
                                </button>`;
                            } else if (row.psb_status === 'phase2_completed') {
                                buttons += `<a href="/teknisi-psb-setup?customerId=${row.id}" class="btn btn-sm btn-success">
                                    <i class="fas fa-wifi"></i> Setup
                                </a>`;
                            }
                            
                            return buttons || '-';
                        }
                    }
                ],
                order: [[0, 'desc']],
                language: {
                    "emptyTable": "Tidak ada data yang tersedia",
                    "info": "Menampilkan _START_ sampai _END_ dari _TOTAL_ entri",
                    "infoEmpty": "Menampilkan 0 sampai 0 dari 0 entri",
                    "infoFiltered": "(disaring dari _MAX_ total entri)",
                    "lengthMenu": "Tampilkan _MENU_ entri",
                    "loadingRecords": "Memuat...",
                    "processing": "Memproses...",
                    "search": "Cari:",
                    "zeroRecords": "Tidak ditemukan data yang cocok",
                    "paginate": {
                        "first": "Pertama",
                        "last": "Terakhir",
                        "next": "Selanjutnya",
                        "previous": "Sebelumnya"
                    }
                }
            });
        }

        // Setup event handlers
        function setupEventHandlers() {
            // ODC change handler - ODP depends on ODC selection
            $('#modal-installed-odc-id').on('change', function() {
                const selectedOdcId = $(this).val();
                updateModalOdpDropdown(selectedOdcId);
            });

            // Submit installation
            $('#submit-installation-btn').on('click', function() {
                submitInstallation();
            });
        }

        // Open installation modal
        function openInstallationModal(customerId, name, phone) {
            $('#modal-customer-id').val(customerId);
            $('#modal-customer-info').text(`${name} (${phone}) - ID: ${customerId}`);
            
            // Populate ODC dropdown
            const odcSelect = $('#modal-installed-odc-id');
            odcSelect.empty();
            odcSelect.append('<option value="">Pilih ODC...</option>');
            allOdcList.forEach(odc => {
                const displayName = `${odc.name || odc.id}${odc.address ? ' - ' + odc.address : ''}`;
                odcSelect.append(`<option value="${odc.id}">${displayName}</option>`);
            });
            
            // Initialize Select2
            if (!odcSelect.data('select2')) {
                odcSelect.select2({
                    theme: 'bootstrap',
                    placeholder: 'Pilih ODC...',
                    allowClear: true,
                    width: '100%',
                    dropdownParent: $('#installationModal')
                });
            }
            
            const odpSelect = $('#modal-installed-odp-id');
            if (!odpSelect.data('select2')) {
                odpSelect.select2({
                    theme: 'bootstrap',
                    placeholder: 'Pilih ODP...',
                    allowClear: true,
                    width: '100%',
                    dropdownParent: $('#installationModal')
                });
            }
            
            // Reset form
            $('#installation-form')[0].reset();
            
            // Reset ODP dropdown (disabled until ODC is selected)
            odpSelect.empty();
            odpSelect.append('<option value="">Pilih ODP...</option>');
            odpSelect.prop('disabled', true);
            odpSelect.val('').trigger('change');
            
            $('#installationModal').modal('show');
        }

        // Update ODP dropdown in modal
        // ODC and ODP are optional, but if filled, must follow order: ODC first, then ODP
        function updateModalOdpDropdown(odcId) {
            const odpSelect = $('#modal-installed-odp-id');
            odpSelect.empty();
            
            if (!odcId || odcId === '') {
                // If ODC is not selected or cleared, disable and clear ODP
                odpSelect.append('<option value="">Pilih ODP...</option>');
                odpSelect.prop('disabled', true);
                odpSelect.val('').trigger('change');
                return;
            }
            
            // Filter ODP by parent ODC
            const filteredOdp = allOdpList.filter(odp => String(odp.parent_odc_id) === String(odcId));
            
            odpSelect.append('<option value="">Pilih ODP...</option>');
            if (filteredOdp.length > 0) {
                // If there are ODPs for the selected ODC, enable dropdown and populate
                filteredOdp.forEach(odp => {
                    const displayName = `${odp.name || odp.id}${odp.address ? ' - ' + odp.address : ''}`;
                    odpSelect.append(`<option value="${odp.id}">${displayName}</option>`);
                });
                odpSelect.prop('disabled', false);
            } else {
                // If no ODPs for the selected ODC, show message and keep disabled
                odpSelect.append('<option value="">Tidak ada ODP untuk ODC ini</option>');
                odpSelect.prop('disabled', true);
            }
            
            odpSelect.trigger('change');
        }

        // Submit installation
        function submitInstallation() {
            const formData = {
                customerId: $('#modal-customer-id').val(),
                installed_odc_id: $('#modal-installed-odc-id').val(),
                installed_odp_id: $('#modal-installed-odp-id').val(),
                port_number: $('#modal-port-number').val() || null,
                installation_notes: $('#modal-installation-notes').val() || null
            };

            // ODC and ODP are now optional - no validation needed
            // Set to null if empty
            formData.installed_odc_id = formData.installed_odc_id || null;
            formData.installed_odp_id = formData.installed_odp_id || null;

            Swal.fire({
                title: 'Menyimpan data instalasi...',
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });

            fetch('/api/psb/submit-phase2', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData),
                credentials: 'include'
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 200) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Berhasil!',
                        html: `Data instalasi berhasil disimpan!<br><br>
                            Pelanggan sekarang siap untuk setup awal.<br><br>
                            <strong>Customer ID:</strong> ${formData.customerId}`,
                        confirmButtonText: 'Lanjut ke Setup',
                        showCancelButton: true,
                        cancelButtonText: 'Tetap di Halaman Ini'
                    }).then((result) => {
                        $('#installationModal').modal('hide');
                        installationTable.ajax.reload();
                        
                        if (result.isConfirmed) {
                            // Redirect ke Phase 3 dengan customerId
                            window.location.href = `/teknisi-psb-setup?customerId=${formData.customerId}`;
                        }
                    });
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: data.message || 'Gagal menyimpan data instalasi'
                    });
                }
            })
            .catch(err => {
                console.error('Submit installation error:', err);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Error saat menyimpan data instalasi'
                });
            });
        }

        // Update status to teknisi_meluncur
        function updateStatusToMeluncur(customerId, customerName) {
            Swal.fire({
                title: 'Konfirmasi',
                html: `Apakah Anda yakin teknisi sedang meluncur ke lokasi <strong>${customerName}</strong>?<br><br>Pelanggan akan menerima notifikasi WhatsApp.`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#3085d6',
                cancelButtonColor: '#d33',
                confirmButtonText: 'Ya, Teknisi Meluncur',
                cancelButtonText: 'Batal'
            }).then((result) => {
                if (result.isConfirmed) {
                    Swal.fire({
                        title: 'Mengupdate status...',
                        allowOutsideClick: false,
                        didOpen: () => {
                            Swal.showLoading();
                        }
                    });

                    fetch('/api/psb/update-status', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            customerId: customerId,
                            status: 'teknisi_meluncur'
                        }),
                        credentials: 'include'
                    })
                    .then(res => res.json())
                    .then(data => {
                        if (data.status === 200) {
                            Swal.fire({
                                icon: 'success',
                                title: 'Berhasil!',
                                html: `Status berhasil diupdate menjadi "Teknisi Meluncur".<br><br>Pelanggan telah menerima notifikasi WhatsApp.`,
                                confirmButtonText: 'OK'
                            }).then(() => {
                                installationTable.ajax.reload();
                            });
                        } else {
                            Swal.fire({
                                icon: 'error',
                                title: 'Error',
                                text: data.message || 'Gagal mengupdate status'
                            });
                        }
                    })
                    .catch(err => {
                        console.error('Update status error:', err);
                        Swal.fire({
                            icon: 'error',
                            title: 'Error',
                            text: 'Error saat mengupdate status'
                        });
                    });
                }
            });
        }

        // Show message
        function showMessage(type, message) {
            const alertClass = type === 'success' ? 'alert-success' : type === 'error' ? 'alert-danger' : 'alert-warning';
            const html = `<div class="alert ${alertClass} alert-dismissible fade show" role="alert">
                ${message}
                <button type="button" class="close" data-dismiss="alert">
                    <span>&times;</span>
                </button>
            </div>`;
            $('#message-container').html(html);
            setTimeout(() => {
                $('.alert').fadeOut();
            }, 5000);
        }
    </script>
</body>

</html>

