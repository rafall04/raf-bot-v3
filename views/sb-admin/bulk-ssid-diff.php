<!DOCTYPE html>
<html lang="id">

<head>
    <?php
    $pageTitle = 'RAF BOT - Penyesuaian Bulk SSID';
    $themeRole = 'admin';
    $pageDescription = 'RAF BOT - Penyesuaian Bulk SSID';
    include __DIR__ . '/_head.php';
    ?>

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

        .bulk-old {
            color: #dc2626;
            text-decoration: line-through;
            font-size: 0.85rem;
        }

        .bulk-new {
            color: #059669;
            font-weight: 700;
        }

        .device-id-mono {
            font-size: 0.75rem;
            color: #6b7280;
            word-break: break-all;
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
                            <h1><i class="fas fa-wifi mr-2"></i>Penyesuaian Bulk SSID</h1>
                            <p class="mb-0">Cocokkan SSID yang dikelola pelanggan (kolom <code>bulk</code>) dengan kapabilitas band modem di GenieACS</p>
                        </div>
                        <div>
                            <button class="btn btn-scan" id="btnScan" onclick="scanBulk()">
                                <i class="fas fa-search mr-2"></i>Scan Perbedaan
                            </button>
                        </div>
                    </div>

                    <!-- Info Box -->
                    <div class="info-box">
                        <h6 class="font-weight-bold mb-2"><i class="fas fa-info-circle mr-2"></i>Cara Kerja</h6>
                        <p>
                            Fitur ini membandingkan SSID yang boleh dikelola pelanggan (kolom <strong>bulk</strong>) dengan
                            kemampuan band modemnya di GenieACS. Modem <strong>dual-band</strong> (mis. Huawei HG8145V5) punya
                            WiFi 2.4GHz (SSID&nbsp;1) dan 5GHz (SSID&nbsp;5), sehingga seharusnya <code>["1","5"]</code>.
                            Berguna setelah <em>Sync Device ID</em> ke modem baru, karena <code>bulk</code> tidak ikut otomatis berubah.
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
                                        <div class="stats-label">Perlu Disesuaikan</div>
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
                                <i class="fas fa-list mr-2"></i>Daftar Pelanggan dengan Bulk SSID Tidak Sesuai
                            </h6>
                            <div>
                                <button class="btn btn-sm btn-outline-primary mr-2" onclick="selectAll()">
                                    <i class="fas fa-check-double mr-1"></i>Pilih Semua
                                </button>
                                <button class="btn btn-sm btn-outline-secondary mr-2" onclick="deselectAll()">
                                    <i class="fas fa-times mr-1"></i>Batal Pilih
                                </button>
                                <button class="btn btn-sync" id="btnSync" onclick="syncBulk()" disabled>
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
                                            <th>Device ID</th>
                                            <th>Model</th>
                                            <th>Bulk Sekarang</th>
                                            <th>Bulk Disarankan</th>
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
                            <i class="fas fa-wifi"></i>
                            <h5>Penyesuaian Bulk SSID</h5>
                            <p>Klik tombol "Scan Perbedaan" untuk mencari pelanggan yang bulk SSID-nya tidak sesuai dengan modem</p>
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

        function fmtBulk(arr) {
            if (!Array.isArray(arr) || arr.length === 0) return '(kosong)';
            return arr.map((x) => 'SSID ' + x).join(', ');
        }

        // Scan perbedaan bulk vs kapabilitas modem
        async function scanBulk() {
            showProgress('Scanning...', 'Mengambil data modem dari GenieACS dan membandingkan dengan kolom bulk...');

            try {
                const response = await fetch('/api/users/bulk-diff');
                const result = await response.json();

                hideProgress();

                if (result.status !== 200) {
                    Swal.fire('Error', result.message || 'Gagal scan bulk SSID', 'error');
                    return;
                }

                diffData = result.data || [];

                document.getElementById('statTotal').textContent = result.stats?.total || 0;
                document.getElementById('statDiff').textContent = result.stats?.different || 0;
                document.getElementById('statSame').textContent = result.stats?.same || 0;
                document.getElementById('statNotFound').textContent = result.stats?.notFound || 0;

                document.getElementById('statsSection').style.display = 'flex';
                document.getElementById('emptyState').style.display = 'none';
                document.getElementById('mainContent').style.display = 'block';

                renderTable();

                if (diffData.length === 0) {
                    Swal.fire('Info', 'Semua bulk SSID sudah sesuai dengan kapabilitas modem', 'info');
                }
            } catch (error) {
                hideProgress();
                Swal.fire('Error', 'Gagal menghubungi server: ' + error.message, 'error');
            }
        }

        function renderTable() {
            const tbody = document.getElementById('tableBody');

            if (diffData.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" class="empty-state">
                            <i class="fas fa-check-circle text-success"></i>
                            <p>Tidak ada bulk SSID yang perlu disesuaikan</p>
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
                        <td><span class="device-id-mono">${escapeHtml(item.device_id || '-')}</span></td>
                        <td><small>${escapeHtml(item.model || '-')}</small> ${item.has5G ? '<span class="badge badge-info">dual-band</span>' : ''}</td>
                        <td><span class="bulk-old">${escapeHtml(fmtBulk(item.current_bulk))}</span></td>
                        <td><span class="bulk-new">${escapeHtml(fmtBulk(item.expected_bulk))}</span></td>
                        <td><span class="badge badge-diff">Perlu Disesuaikan</span></td>
                    </tr>
                `;
            }).join('');

            updateSelection();
        }

        function updateSelection() {
            const checked = document.querySelectorAll('.row-check:checked').length;
            document.getElementById('selectedCount').textContent = checked;
            document.getElementById('btnSync').disabled = checked === 0;
        }

        function toggleCheckAll() {
            const checkAll = document.getElementById('checkAll').checked;
            document.querySelectorAll('.row-check').forEach((cb) => { cb.checked = checkAll; });
            updateSelection();
        }

        function selectAll() {
            document.querySelectorAll('.row-check').forEach((cb) => { cb.checked = true; });
            document.getElementById('checkAll').checked = true;
            updateSelection();
        }

        function deselectAll() {
            document.querySelectorAll('.row-check').forEach((cb) => { cb.checked = false; });
            document.getElementById('checkAll').checked = false;
            updateSelection();
        }

        // Terapkan koreksi bulk
        async function syncBulk() {
            const selectedItems = [];

            document.querySelectorAll('.row-check:checked').forEach((cb) => {
                const index = parseInt(cb.dataset.index);
                selectedItems.push({
                    userId: diffData[index].id,
                    bulk: diffData[index].expected_bulk
                });
            });

            if (selectedItems.length === 0) {
                Swal.fire('Peringatan', 'Pilih minimal satu pelanggan untuk disinkronkan', 'warning');
                return;
            }

            const confirm = await Swal.fire({
                title: 'Konfirmasi Penyesuaian',
                html: `Anda akan menyesuaikan kolom <strong>bulk</strong> untuk <strong>${selectedItems.length}</strong> pelanggan.<br><br>` +
                    `Ini hanya mengubah daftar SSID yang dikelola (tidak mengubah sandi WiFi). Lanjutkan?`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Ya, Sinkronkan',
                cancelButtonText: 'Batal'
            });

            if (!confirm.isConfirmed) return;

            showProgress('Menyinkronkan...', `Mengupdate ${selectedItems.length} kolom bulk...`);

            try {
                const response = await fetch('/api/users/sync-bulk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items: selectedItems })
                });

                const result = await response.json();
                hideProgress();

                if (result.status === 200) {
                    const successCount = result.results?.success?.length || 0;
                    const failedCount = result.results?.failed?.length || 0;

                    let message = `<strong>${successCount}</strong> bulk SSID berhasil disesuaikan.`;
                    if (failedCount > 0) {
                        message += `<br><strong>${failedCount}</strong> gagal.`;
                    }

                    await Swal.fire({
                        title: 'Penyesuaian Selesai',
                        html: message,
                        icon: failedCount > 0 ? 'warning' : 'success'
                    });

                    scanBulk();
                } else {
                    Swal.fire('Error', result.message || 'Gagal sinkronisasi', 'error');
                }
            } catch (error) {
                hideProgress();
                Swal.fire('Error', 'Gagal menghubungi server: ' + error.message, 'error');
            }
        }

        function showProgress(title, text) {
            document.getElementById('progressTitle').textContent = title;
            document.getElementById('progressText').textContent = text;
            document.getElementById('progressOverlay').style.display = 'flex';
        }

        function hideProgress() {
            document.getElementById('progressOverlay').style.display = 'none';
        }

        function escapeHtml(text) {
            if (text === null || text === undefined) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    </script>
</body>
</html>
