<!DOCTYPE html>
<html lang="id">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <meta name="description" content="RAF BOT - Sinkronisasi Device ID">
    <meta name="author" content="RAF BOT">
    <title>RAF BOT - Sinkronisasi Device ID</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <style>
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --success: #10b981;
            --info: #3b82f6;
            --warning: #f59e0b;
            --danger: #ef4444;
            --dark: #1f2937;
            --light: #f9fafb;
            --border-radius: 12px;
        }

        body {
            font-family: 'Inter', sans-serif;
            background: #f3f4f6;
        }

        .dashboard-header h1 {
            font-size: 1.875rem;
            font-weight: 700;
            color: var(--dark);
            margin-bottom: 0.25rem;
        }

        .dashboard-header p {
            color: #6b7280;
            font-size: 0.95rem;
        }

        .stats-card {
            background: white;
            border-radius: var(--border-radius);
            padding: 1.25rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border: 1px solid #e5e7eb;
        }

        .stats-card .stats-icon {
            width: 48px;
            height: 48px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.25rem;
        }

        .stats-card .stats-value {
            font-size: 1.75rem;
            font-weight: 700;
            color: var(--dark);
        }

        .stats-card .stats-label {
            color: #6b7280;
            font-size: 0.875rem;
        }

        .card-modern {
            background: white;
            border-radius: var(--border-radius);
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border: 1px solid #e5e7eb;
        }

        .card-modern .card-header {
            background: transparent;
            border-bottom: 1px solid #e5e7eb;
            padding: 1rem 1.25rem;
        }

        .card-modern .card-body {
            padding: 1.25rem;
        }

        .btn-scan {
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
            border: none;
            border-radius: 10px;
            padding: 0.875rem 1.75rem;
            font-weight: 600;
            color: white;
            transition: all 0.2s;
            box-shadow: 0 4px 15px rgba(59, 130, 246, 0.3);
        }

        .btn-scan:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(59, 130, 246, 0.5);
            color: white;
        }

        .btn-sync {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            border: none;
            border-radius: 10px;
            padding: 0.875rem 1.75rem;
            font-weight: 600;
            color: white;
            transition: all 0.2s;
            box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);
        }

        .btn-sync:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(16, 185, 129, 0.5);
            color: white;
        }

        .table-sync {
            font-size: 0.875rem;
        }

        .table-sync th {
            background: #f9fafb;
            font-weight: 600;
            color: var(--dark);
            border-bottom: 2px solid #e5e7eb;
            white-space: nowrap;
        }

        .table-sync td {
            vertical-align: middle;
        }

        .badge-diff {
            background-color: #fef3c7;
            color: #92400e;
            font-size: 0.75rem;
            padding: 0.35rem 0.65rem;
            border-radius: 6px;
        }

        .badge-same {
            background-color: #d1fae5;
            color: #065f46;
            font-size: 0.75rem;
            padding: 0.35rem 0.65rem;
            border-radius: 6px;
        }

        .badge-notfound {
            background-color: #fee2e2;
            color: #991b1b;
            font-size: 0.75rem;
            padding: 0.35rem 0.65rem;
            border-radius: 6px;
        }

        .device-id-old {
            color: #dc2626;
            text-decoration: line-through;
            font-size: 0.8rem;
        }

        .device-id-new {
            color: #059669;
            font-weight: 600;
        }

        .empty-state {
            text-align: center;
            padding: 3rem;
            color: #6b7280;
        }

        .empty-state i {
            font-size: 4rem;
            margin-bottom: 1rem;
            opacity: 0.5;
        }

        .progress-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
        }

        .progress-card {
            background: white;
            border-radius: var(--border-radius);
            padding: 2rem;
            min-width: 400px;
            text-align: center;
        }

        .info-box {
            background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
            border: 1px solid #93c5fd;
            border-radius: 8px;
            padding: 1rem;
            margin-bottom: 1rem;
        }

        .info-box h6 {
            color: #1e40af;
        }

        .info-box p {
            color: #1e3a8a;
            margin-bottom: 0;
            font-size: 0.875rem;
        }
    </style>
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include __DIR__ . '/_navbar.php'; ?>

        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include __DIR__ . '/topbar.php'; ?>

                <div class="container-fluid">
                    <!-- Header -->
                    <div class="dashboard-header d-flex justify-content-between align-items-center flex-wrap mb-4">
                        <div>
                            <h1><i class="fas fa-sync-alt mr-2"></i>Sinkronisasi Device ID</h1>
                            <p class="mb-0">Update Device ID pelanggan berdasarkan PPPoE username di GenieACS</p>
                        </div>
                        <div>
                            <button class="btn btn-scan" id="btnScan" onclick="scanDevices()">
                                <i class="fas fa-search mr-2"></i>Scan Perbedaan
                            </button>
                        </div>
                    </div>

                    <!-- Info Box -->
                    <div class="info-box">
                        <h6 class="font-weight-bold mb-2"><i class="fas fa-info-circle mr-2"></i>Cara Kerja</h6>
                        <p>
                            Fitur ini akan mencocokkan <strong>PPPoE Username</strong> pelanggan di sistem dengan device di GenieACS.
                            Jika ditemukan device dengan PPPoE username yang sama tapi Device ID berbeda, maka Device ID akan diupdate ke yang baru.
                            Ini berguna ketika alat pelanggan sudah diganti dengan yang baru.
                        </p>
                    </div>

                    <!-- Stats Cards -->
                    <div class="row mb-4" id="statsSection" style="display: none;">
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="stats-card">
                                <div class="d-flex align-items-center">
                                    <div class="stats-icon bg-primary text-white mr-3">
                                        <i class="fas fa-users"></i>
                                    </div>
                                    <div>
                                        <div class="stats-value" id="statTotal">0</div>
                                        <div class="stats-label">Total Pelanggan</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="stats-card">
                                <div class="d-flex align-items-center">
                                    <div class="stats-icon bg-warning text-white mr-3">
                                        <i class="fas fa-exchange-alt"></i>
                                    </div>
                                    <div>
                                        <div class="stats-value" id="statDiff">0</div>
                                        <div class="stats-label">Perlu Update</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="stats-card">
                                <div class="d-flex align-items-center">
                                    <div class="stats-icon bg-success text-white mr-3">
                                        <i class="fas fa-check-circle"></i>
                                    </div>
                                    <div>
                                        <div class="stats-value" id="statSame">0</div>
                                        <div class="stats-label">Sudah Sesuai</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="stats-card">
                                <div class="d-flex align-items-center">
                                    <div class="stats-icon bg-danger text-white mr-3">
                                        <i class="fas fa-question-circle"></i>
                                    </div>
                                    <div>
                                        <div class="stats-value" id="statNotFound">0</div>
                                        <div class="stats-label">Tidak Ditemukan</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Main Content -->
                    <div class="card-modern" id="mainContent" style="display: none;">
                        <div class="card-header d-flex justify-content-between align-items-center">
                            <h6 class="m-0 font-weight-bold text-primary">
                                <i class="fas fa-list mr-2"></i>Daftar Pelanggan dengan Device ID Berbeda
                            </h6>
                            <div>
                                <button class="btn btn-sm btn-outline-primary mr-2" onclick="selectAll()">
                                    <i class="fas fa-check-double mr-1"></i>Pilih Semua
                                </button>
                                <button class="btn btn-sm btn-outline-secondary mr-2" onclick="deselectAll()">
                                    <i class="fas fa-times mr-1"></i>Batal Pilih
                                </button>
                                <button class="btn btn-sync" id="btnSync" onclick="syncDevices()" disabled>
                                    <i class="fas fa-sync mr-2"></i>Sinkronkan (<span id="selectedCount">0</span>)
                                </button>
                            </div>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-sync table-hover" id="syncTable">
                                    <thead>
                                        <tr>
                                            <th width="40">
                                                <input type="checkbox" id="checkAll" onchange="toggleCheckAll()">
                                            </th>
                                            <th>Nama Pelanggan</th>
                                            <th>PPPoE Username</th>
                                            <th>Device ID Lama</th>
                                            <th>Device ID Baru</th>
                                            <th>Model</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody id="tableBody">
                                        <tr>
                                            <td colspan="7" class="empty-state">
                                                <i class="fas fa-search"></i>
                                                <p>Klik tombol "Scan Perbedaan" untuk memulai</p>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <!-- Empty State -->
                    <div class="card-modern" id="emptyState">
                        <div class="card-body empty-state">
                            <i class="fas fa-sync-alt"></i>
                            <h5>Sinkronisasi Device ID</h5>
                            <p>Klik tombol "Scan Perbedaan" untuk mencari pelanggan yang Device ID-nya perlu diupdate</p>
                        </div>
                    </div>
                </div>
            </div>

            <?php include __DIR__ . '/footer.php'; ?>
        </div>
    </div>

    <!-- Progress Overlay -->
    <div class="progress-overlay" id="progressOverlay" style="display: none;">
        <div class="progress-card">
            <div class="spinner-border text-primary mb-3" role="status">
                <span class="sr-only">Loading...</span>
            </div>
            <h5 id="progressTitle">Memproses...</h5>
            <p id="progressText" class="text-muted mb-0">Mohon tunggu</p>
        </div>
    </div>

    <!-- Scripts -->
    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

    <script>
        let diffData = [];

        // Scan devices for differences
        async function scanDevices() {
            showProgress('Scanning...', 'Mengambil data dari GenieACS dan mencocokkan dengan database...');
            
            try {
                const response = await fetch('/api/users/device-id-diff');
                const result = await response.json();
                
                hideProgress();
                
                if (result.status !== 200) {
                    Swal.fire('Error', result.message || 'Gagal scan device', 'error');
                    return;
                }
                
                diffData = result.data || [];
                
                // Update stats
                document.getElementById('statTotal').textContent = result.stats?.total || 0;
                document.getElementById('statDiff').textContent = result.stats?.different || 0;
                document.getElementById('statSame').textContent = result.stats?.same || 0;
                document.getElementById('statNotFound').textContent = result.stats?.notFound || 0;
                
                // Show sections
                document.getElementById('statsSection').style.display = 'flex';
                document.getElementById('emptyState').style.display = 'none';
                document.getElementById('mainContent').style.display = 'block';
                
                // Render table
                renderTable();
                
                if (diffData.length === 0) {
                    Swal.fire('Info', 'Semua Device ID sudah sesuai atau tidak ditemukan perbedaan', 'info');
                }
                
            } catch (error) {
                hideProgress();
                Swal.fire('Error', 'Gagal menghubungi server: ' + error.message, 'error');
            }
        }

        // Render table
        function renderTable() {
            const tbody = document.getElementById('tableBody');
            
            if (diffData.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" class="empty-state">
                            <i class="fas fa-check-circle text-success"></i>
                            <p>Tidak ada Device ID yang perlu diupdate</p>
                        </td>
                    </tr>
                `;
                return;
            }
            
            tbody.innerHTML = diffData.map((item, index) => {
                return `
                    <tr data-index="${index}">
                        <td>
                            <input type="checkbox" class="row-check" data-index="${index}" onchange="updateSelection()">
                        </td>
                        <td>
                            <strong>${escapeHtml(item.name)}</strong>
                            <br><small class="text-muted">ID: ${item.id}</small>
                        </td>
                        <td><code>${escapeHtml(item.pppoe_username)}</code></td>
                        <td>
                            <span class="device-id-old">${escapeHtml(item.old_device_id || '-')}</span>
                        </td>
                        <td>
                            <span class="device-id-new">${escapeHtml(item.new_device_id)}</span>
                        </td>
                        <td><small>${escapeHtml(item.model || '-')}</small></td>
                        <td><span class="badge badge-diff">Perlu Update</span></td>
                    </tr>
                `;
            }).join('');
            
            updateSelection();
        }

        // Update selection count
        function updateSelection() {
            const checked = document.querySelectorAll('.row-check:checked').length;
            document.getElementById('selectedCount').textContent = checked;
            document.getElementById('btnSync').disabled = checked === 0;
        }

        // Toggle check all
        function toggleCheckAll() {
            const checkAll = document.getElementById('checkAll').checked;
            document.querySelectorAll('.row-check').forEach(cb => {
                cb.checked = checkAll;
            });
            updateSelection();
        }

        // Select all
        function selectAll() {
            document.querySelectorAll('.row-check').forEach(cb => {
                cb.checked = true;
            });
            document.getElementById('checkAll').checked = true;
            updateSelection();
        }

        // Deselect all
        function deselectAll() {
            document.querySelectorAll('.row-check').forEach(cb => {
                cb.checked = false;
            });
            document.getElementById('checkAll').checked = false;
            updateSelection();
        }

        // Sync devices
        async function syncDevices() {
            const selectedItems = [];
            
            document.querySelectorAll('.row-check:checked').forEach(cb => {
                const index = parseInt(cb.dataset.index);
                selectedItems.push({
                    userId: diffData[index].id,
                    newDeviceId: diffData[index].new_device_id
                });
            });
            
            if (selectedItems.length === 0) {
                Swal.fire('Peringatan', 'Pilih minimal satu pelanggan untuk disinkronkan', 'warning');
                return;
            }
            
            const confirm = await Swal.fire({
                title: 'Konfirmasi Sinkronisasi',
                html: `Anda akan mengupdate Device ID untuk <strong>${selectedItems.length}</strong> pelanggan.<br><br>Lanjutkan?`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Ya, Sinkronkan',
                cancelButtonText: 'Batal'
            });
            
            if (!confirm.isConfirmed) return;
            
            showProgress('Menyinkronkan...', `Mengupdate ${selectedItems.length} Device ID...`);
            
            try {
                const response = await fetch('/api/users/sync-device-ids', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items: selectedItems })
                });
                
                const result = await response.json();
                hideProgress();
                
                if (result.status === 200) {
                    const successCount = result.results?.success?.length || 0;
                    const failedCount = result.results?.failed?.length || 0;
                    
                    let message = `<strong>${successCount}</strong> Device ID berhasil diupdate.`;
                    if (failedCount > 0) {
                        message += `<br><strong>${failedCount}</strong> gagal.`;
                    }
                    
                    await Swal.fire({
                        title: 'Sinkronisasi Selesai',
                        html: message,
                        icon: failedCount > 0 ? 'warning' : 'success'
                    });
                    
                    // Refresh data
                    scanDevices();
                } else {
                    Swal.fire('Error', result.message || 'Gagal sinkronisasi', 'error');
                }
                
            } catch (error) {
                hideProgress();
                Swal.fire('Error', 'Gagal menghubungi server: ' + error.message, 'error');
            }
        }

        // Helper functions
        function showProgress(title, text) {
            document.getElementById('progressTitle').textContent = title;
            document.getElementById('progressText').textContent = text;
            document.getElementById('progressOverlay').style.display = 'flex';
        }

        function hideProgress() {
            document.getElementById('progressOverlay').style.display = 'none';
        }

        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    </script>
</body>
</html>
