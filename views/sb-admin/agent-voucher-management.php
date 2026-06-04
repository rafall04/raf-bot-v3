<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>Agent Voucher Management - RAF NET</title>
    
    <!-- Custom fonts -->
    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    
    <!-- Custom styles -->
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/admin-theme.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
    
    <style>
        .stat-card {
            border-left: 3px solid var(--primary);
            transition: all 0.3s;
            background: #ffffff;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        .stat-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .stat-value {
            font-size: 2rem;
            font-weight: 700;
            color: var(--primary);
        }
        .stat-label {
            font-size: 0.875rem;
            color: #6c757d;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
    </style>
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include 'topbar.php'; ?>
                
                <div class="container-fluid">
                    <div class="dashboard-header">
                        <h1>Agent Voucher Management</h1>
                        <p>Monitor dan kelola voucher reseller agent</p>
                    </div>
                    
                    <!-- Statistics Cards -->
                    <h4 class="dashboard-section-title">Statistik Keseluruhan</h4>
                    <div class="row match-height mb-4" id="statsCards">
                        <!-- Stats will be loaded here -->
                    </div>
                    
                    <!-- Top Agents -->
                    <div class="card shadow mb-4">
                        <div class="card-header py-3">
                            <h6 class="m-0 font-weight-bold text-primary">Top 10 Agent (Berdasarkan Profit)</h6>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered" id="topAgentsTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>Rank</th>
                                            <th>Nama Agent</th>
                                            <th>Area</th>
                                            <th>Total Stok</th>
                                            <th>Total Terjual</th>
                                            <th>Total Revenue</th>
                                            <th>Total Profit</th>
                                            <th>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody></tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                    
                    <!-- All Agents Inventory -->
                    <div class="card shadow mb-4">
                        <div class="card-header py-3 d-flex justify-content-between align-items-center">
                            <h6 class="m-0 font-weight-bold text-primary">Inventory Semua Agent</h6>
                            <div>
                                <button class="btn btn-sm btn-info" onclick="exportInventory()">
                                    <i class="fas fa-download"></i> Export CSV
                                </button>
                            </div>
                        </div>
                        <div class="card-body">
                            <div class="row mb-3">
                                <div class="col-md-4">
                                    <input type="text" class="form-control" id="searchInventory" placeholder="Cari agent...">
                                </div>
                                <div class="col-md-3">
                                    <select class="form-control" id="filterArea">
                                        <option value="">Semua Area</option>
                                    </select>
                                </div>
                                <div class="col-md-3">
                                    <select class="form-control" id="filterSort">
                                        <option value="profit">Sort by Profit</option>
                                        <option value="sales">Sort by Sales</option>
                                        <option value="stok">Sort by Stok</option>
                                        <option value="name">Sort by Name</option>
                                    </select>
                                </div>
                                <div class="col-md-2">
                                    <button class="btn btn-secondary btn-block" onclick="clearFilters()">Clear</button>
                                </div>
                            </div>
                            <div class="table-responsive">
                                <table class="table table-bordered" id="inventoryTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>Nama Agent</th>
                                            <th>Area</th>
                                            <th>Total Stok</th>
                                            <th>Total Terjual</th>
                                            <th>Total Profit</th>
                                            <th>Action</th>
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
    
    <!-- Agent Detail Modal -->
    <div class="modal fade" id="agentDetailModal" tabindex="-1" role="dialog">
        <div class="modal-dialog modal-xl" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Detail Agent Voucher</h5>
                    <button type="button" class="close" data-dismiss="modal">
                        <span>&times;</span>
                    </button>
                </div>
                <div class="modal-body" id="agentDetailContent">
                    <!-- Content will be loaded here -->
                </div>
            </div>
        </div>
    </div>
    
    <!-- Bootstrap core JavaScript-->
    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
    <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>
    
    <script>
        // Format currency
        function formatCurrency(amount) {
            return new Intl.NumberFormat('id-ID', {
                style: 'currency',
                currency: 'IDR',
                minimumFractionDigits: 0
            }).format(amount);
        }
        
        // Load statistics
        function loadStatistics() {
            $.ajax({
                url: '/api/admin/agent-voucher/stats',
                method: 'GET',
                success: function(response) {
                    if (response.status === 200 && response.data) {
                        const stats = response.data.overall;
                        const statsHtml = `
                            <div class="col-xl-3 col-md-6 mb-4">
                                <div class="stat-card card h-100 py-2">
                                    <div class="card-body">
                                        <div class="stat-value">${stats.totalAgents}</div>
                                        <div class="stat-label">Total Agent Aktif</div>
                                    </div>
                                </div>
                            </div>
                            <div class="col-xl-3 col-md-6 mb-4">
                                <div class="stat-card card h-100 py-2">
                                    <div class="card-body">
                                        <div class="stat-value">${stats.totalStok}</div>
                                        <div class="stat-label">Total Stok Voucher</div>
                                    </div>
                                </div>
                            </div>
                            <div class="col-xl-3 col-md-6 mb-4">
                                <div class="stat-card card h-100 py-2">
                                    <div class="card-body">
                                        <div class="stat-value">${stats.totalSales}</div>
                                        <div class="stat-label">Total Terjual</div>
                                    </div>
                                </div>
                            </div>
                            <div class="col-xl-3 col-md-6 mb-4">
                                <div class="stat-card card h-100 py-2">
                                    <div class="card-body">
                                        <div class="stat-value">${formatCurrency(stats.totalProfit)}</div>
                                        <div class="stat-label">Total Profit Agent</div>
                                    </div>
                                </div>
                            </div>
                        `;
                        $('#statsCards').html(statsHtml);
                    }
                },
                error: function() {
                    $('#statsCards').html('<div class="col-12"><div class="alert alert-danger">Gagal memuat statistik</div></div>');
                }
            });
        }
        
        // Load top agents
        function loadTopAgents() {
            if ($.fn.DataTable.isDataTable('#topAgentsTable')) {
                $('#topAgentsTable').DataTable().destroy();
                $('#topAgentsTable tbody').empty();
            }
            $('#topAgentsTable').DataTable({
                ajax: {
                    url: '/api/admin/agent-voucher/top-agents?sortBy=profit&limit=10',
                    dataSrc: 'data.agents',
                    error: function(xhr, error, thrown) {
                        console.error('DataTables AJAX error:', error, thrown);
                        console.error('Response:', xhr.responseText);
                        $('#topAgentsTable').DataTable().clear().draw();
                        alert('Gagal memuat data top agents. Silakan refresh halaman.');
                    }
                },
                columns: [
                    {
                        data: null,
                        render: function(data, type, row, meta) {
                            return meta.row + 1;
                        }
                    },
                    { data: 'agentName' },
                    { data: 'agentArea' },
                    { data: 'totalStok' },
                    { data: 'totalSales' },
                    {
                        data: 'totalRevenue',
                        render: function(data) {
                            return formatCurrency(data || 0);
                        }
                    },
                    {
                        data: 'totalProfit',
                        render: function(data) {
                            return formatCurrency(data || 0);
                        }
                    },
                    {
                        data: null,
                        render: function(data) {
                            return `<button class="btn btn-sm btn-info" onclick="viewAgentDetail('${data.agentId}')">Detail</button>`;
                        }
                    }
                ],
                order: [[6, 'desc']], // Sort by profit
                language: {
                    emptyTable: 'Tidak ada data agent',
                    processing: 'Memuat data...',
                    zeroRecords: 'Tidak ditemukan data yang sesuai'
                }
            });
        }
        
        let inventoryTable;
        
        // Load all inventories
        function loadInventories() {
            if ($.fn.DataTable.isDataTable('#inventoryTable')) {
                $('#inventoryTable').DataTable().destroy();
                $('#inventoryTable tbody').empty();
            }
            inventoryTable = $('#inventoryTable').DataTable({
                ajax: {
                    url: '/api/admin/agent-voucher/inventory',
                    dataSrc: 'data',
                    error: function(xhr, error, thrown) {
                        console.error('DataTables AJAX error:', error, thrown);
                        console.error('Response:', xhr.responseText);
                        $('#inventoryTable').DataTable().clear().draw();
                        alert('Gagal memuat data inventory. Silakan refresh halaman.');
                    }
                },
                columns: [
                    { data: 'agentName' },
                    { data: 'agentArea' },
                    { data: 'inventory.totalStok' },
                    { data: 'inventory.totalTerjual' },
                    {
                        data: 'inventory.totalProfit',
                        render: function(data) {
                            return formatCurrency(data || 0);
                        }
                    },
                    {
                        data: null,
                        render: function(data) {
                            return `<button class="btn btn-sm btn-info" onclick="viewAgentDetail('${data.agentId}')">Detail</button>`;
                        }
                    }
                ],
                order: [[4, 'desc']], // Sort by profit
                dom: 'Bfrtip',
                pageLength: 25,
                language: {
                    emptyTable: 'Tidak ada data inventory',
                    processing: 'Memuat data...',
                    zeroRecords: 'Tidak ditemukan data yang sesuai'
                }
            });
            
            // Load areas for filter
            loadAreas();
        }
        
        // Load areas for filter
        function loadAreas() {
            $.ajax({
                url: '/api/admin/agent-voucher/inventory',
                method: 'GET',
                success: function(response) {
                    if (response.status === 200 && response.data) {
                        const areas = [...new Set(response.data.map(item => item.agentArea).filter(Boolean))];
                        areas.sort();
                        areas.forEach(area => {
                            $('#filterArea').append(`<option value="${area}">${area}</option>`);
                        });
                    }
                }
            });
        }
        
        // Search functionality
        $('#searchInventory').on('keyup', function() {
            inventoryTable.search(this.value).draw();
        });
        
        // Filter by area
        $('#filterArea').on('change', function() {
            inventoryTable.column(1).search(this.value).draw();
        });
        
        // Sort filter
        $('#filterSort').on('change', function() {
            const sortBy = this.value;
            let columnIndex = 0;
            let order = 'desc';
            
            switch(sortBy) {
                case 'profit':
                    columnIndex = 4;
                    break;
                case 'sales':
                    columnIndex = 3;
                    break;
                case 'stok':
                    columnIndex = 2;
                    break;
                case 'name':
                    columnIndex = 0;
                    order = 'asc';
                    break;
            }
            
            inventoryTable.order([columnIndex, order]).draw();
        });
        
        // Clear filters
        function clearFilters() {
            $('#searchInventory').val('');
            $('#filterArea').val('');
            $('#filterSort').val('profit');
            inventoryTable.search('').columns().search('').order([4, 'desc']).draw();
        }
        
        // Export inventory to CSV
        function exportInventory() {
            const visibleData = [];
            inventoryTable.rows({search: 'applied'}).every(function() {
                visibleData.push(this.data());
            });
            
            if (visibleData.length === 0) {
                alert('Tidak ada data untuk di-export');
                return;
            }
            
            // Create CSV content
            let csv = 'Nama Agent,Area,Total Stok,Total Terjual,Total Profit\n';
            const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
            
            visibleData.forEach(row => {
                csv += [
                    escapeCsv(row.agentName || ''),
                    escapeCsv(row.agentArea || ''),
                    escapeCsv(row.inventory.totalStok || 0),
                    escapeCsv(row.inventory.totalTerjual || 0),
                    escapeCsv(row.inventory.totalProfit || 0)
                ].join(',') + '\n';
            });
            
            // Download CSV
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', 'agent_inventory_' + new Date().toISOString().slice(0, 10) + '.csv');
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        
        // View agent detail
        function viewAgentDetail(agentId) {
            // Load inventory, purchases, and sales in parallel
            Promise.all([
                $.ajax({ url: `/api/admin/agent-voucher/agent/${agentId}/inventory`, method: 'GET' }),
                $.ajax({ url: `/api/admin/agent-voucher/agent/${agentId}/purchases?limit=50`, method: 'GET' }),
                $.ajax({ url: `/api/admin/agent-voucher/agent/${agentId}/sales?limit=50`, method: 'GET' })
            ]).then(function([inventoryRes, purchasesRes, salesRes]) {
                if (inventoryRes.status === 200 && inventoryRes.data) {
                    const data = inventoryRes.data;
                    const purchases = purchasesRes.status === 200 ? purchasesRes.data.purchases : [];
                    const sales = salesRes.status === 200 ? salesRes.data.sales : [];
                    
                    let html = `
                        <div class="row mb-3">
                            <div class="col-md-6">
                                <h5>${data.agent.name}</h5>
                                <p><strong>Area:</strong> ${data.agent.area || '-'}</p>
                                <p><strong>Phone:</strong> ${data.agent.phone || '-'}</p>
                            </div>
                            <div class="col-md-6 text-right">
                                <button class="btn btn-sm btn-info" onclick="exportAgentDetail('${agentId}')">
                                    <i class="fas fa-download"></i> Export CSV
                                </button>
                            </div>
                        </div>
                        <hr>
                        
                        <!-- Summary Cards -->
                        <div class="row mb-4">
                            <div class="col-md-3">
                                <div class="card bg-primary text-white">
                                    <div class="card-body">
                                        <h6>Total Stok</h6>
                                        <h3>${data.inventory.totalStok}</h3>
                                    </div>
                                </div>
                            </div>
                            <div class="col-md-3">
                                <div class="card bg-success text-white">
                                    <div class="card-body">
                                        <h6>Total Terjual</h6>
                                        <h3>${data.inventory.totalTerjual}</h3>
                                    </div>
                                </div>
                            </div>
                            <div class="col-md-3">
                                <div class="card bg-info text-white">
                                    <div class="card-body">
                                        <h6>Total Revenue</h6>
                                        <h3>${formatCurrency(data.stats.sales.totalAmount || 0)}</h3>
                                    </div>
                                </div>
                            </div>
                            <div class="col-md-3">
                                <div class="card bg-warning text-white">
                                    <div class="card-body">
                                        <h6>Total Profit</h6>
                                        <h3>${formatCurrency(data.inventory.totalProfit || 0)}</h3>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Tabs -->
                        <ul class="nav nav-tabs" id="agentDetailTabs" role="tablist">
                            <li class="nav-item">
                                <a class="nav-link active" id="inventory-tab" data-toggle="tab" href="#inventory" role="tab">Inventory</a>
                            </li>
                            <li class="nav-item">
                                <a class="nav-link" id="purchases-tab" data-toggle="tab" href="#purchases" role="tab">Purchase History (${purchases.length})</a>
                            </li>
                            <li class="nav-item">
                                <a class="nav-link" id="sales-tab" data-toggle="tab" href="#sales" role="tab">Sales History (${sales.length})</a>
                            </li>
                        </ul>
                        
                        <div class="tab-content" id="agentDetailTabContent">
                            <!-- Inventory Tab -->
                            <div class="tab-pane fade show active" id="inventory" role="tabpanel">
                                <div class="table-responsive mt-3">
                                    <table class="table table-sm table-bordered">
                                        <thead>
                                            <tr>
                                                <th>Voucher</th>
                                                <th>Stok</th>
                                                <th>Terjual</th>
                                                <th>Profit</th>
                                                <th>Harga Reseller</th>
                                                <th>Harga Jual</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                    `;
                    
                    if (data.inventory.inventory && data.inventory.inventory.length > 0) {
                        data.inventory.inventory.forEach(item => {
                            html += `
                                <tr>
                                    <td>${item.voucherProfileName}</td>
                                    <td>${item.stok}</td>
                                    <td>${item.terjual}</td>
                                    <td>${formatCurrency(item.totalProfit || 0)}</td>
                                    <td>${formatCurrency(item.hargaReseller || 0)}</td>
                                    <td>${formatCurrency(item.hargaJual || 0)}</td>
                                </tr>
                            `;
                        });
                    } else {
                        html += '<tr><td colspan="6" class="text-center">Tidak ada inventory</td></tr>';
                    }
                    
                    html += `
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            
                            <!-- Purchases Tab -->
                            <div class="tab-pane fade" id="purchases" role="tabpanel">
                                <div class="table-responsive mt-3">
                                    <table class="table table-sm table-bordered" id="purchasesTable">
                                        <thead>
                                            <tr>
                                                <th>Tanggal</th>
                                                <th>Voucher</th>
                                                <th>Quantity</th>
                                                <th>Harga</th>
                                                <th>Payment</th>
                                                <th>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                    `;
                    
                    if (purchases.length > 0) {
                        purchases.forEach(purchase => {
                            const date = new Date(purchase.created_at).toLocaleString('id-ID');
                            const statusBadge = purchase.status === 'completed' ? '<span class="badge badge-success">Completed</span>' :
                                               purchase.status === 'pending' ? '<span class="badge badge-warning">Pending</span>' :
                                               '<span class="badge badge-danger">Cancelled</span>';
                            
                            html += `
                                <tr>
                                    <td>${date}</td>
                                    <td>${purchase.voucherProfileName}</td>
                                    <td>${purchase.quantity}</td>
                                    <td>${formatCurrency(purchase.totalHarga || 0)}</td>
                                    <td>${purchase.paymentMethod || '-'}</td>
                                    <td>${statusBadge}</td>
                                </tr>
                            `;
                        });
                    } else {
                        html += '<tr><td colspan="6" class="text-center">Tidak ada riwayat pembelian</td></tr>';
                    }
                    
                    html += `
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            
                            <!-- Sales Tab -->
                            <div class="tab-pane fade" id="sales" role="tabpanel">
                                <div class="table-responsive mt-3">
                                    <table class="table table-sm table-bordered" id="salesTable">
                                        <thead>
                                            <tr>
                                                <th>Tanggal</th>
                                                <th>Voucher</th>
                                                <th>Customer</th>
                                                <th>Harga Jual</th>
                                                <th>Profit</th>
                                                <th>Payment</th>
                                                <th>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                    `;
                    
                    if (sales.length > 0) {
                        sales.forEach(sale => {
                            const date = new Date(sale.created_at).toLocaleString('id-ID');
                            const statusBadge = sale.status === 'completed' ? '<span class="badge badge-success">Completed</span>' :
                                               sale.status === 'pending' ? '<span class="badge badge-warning">Pending</span>' :
                                               '<span class="badge badge-danger">Cancelled</span>';
                            
                            html += `
                                <tr>
                                    <td>${date}</td>
                                    <td>${sale.voucherProfileName}</td>
                                    <td>${sale.customerName || '-'}</td>
                                    <td>${formatCurrency(sale.hargaJual || 0)}</td>
                                    <td>${formatCurrency(sale.profit || 0)}</td>
                                    <td>${sale.paymentMethod || '-'}</td>
                                    <td>${statusBadge}</td>
                                </tr>
                            `;
                        });
                    } else {
                        html += '<tr><td colspan="7" class="text-center">Tidak ada riwayat penjualan</td></tr>';
                    }
                    
                    html += `
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    `;
                    
                    $('#agentDetailContent').html(html);
                    $('#agentDetailModal').modal('show');
                    
                    // Initialize DataTables for purchases and sales
                    if (purchases.length > 0) {
                        $('#purchasesTable').DataTable({
                            order: [[0, 'desc']],
                            pageLength: 10
                        });
                    }
                    if (sales.length > 0) {
                        $('#salesTable').DataTable({
                            order: [[0, 'desc']],
                            pageLength: 10
                        });
                    }
                }
            }).catch(function(error) {
                alert('Gagal memuat detail agent');
                console.error(error);
            });
        }
        
        // Export agent detail to CSV
        function exportAgentDetail(agentId) {
            Promise.all([
                $.ajax({ url: `/api/admin/agent-voucher/agent/${agentId}/inventory`, method: 'GET' }),
                $.ajax({ url: `/api/admin/agent-voucher/agent/${agentId}/purchases?limit=1000`, method: 'GET' }),
                $.ajax({ url: `/api/admin/agent-voucher/agent/${agentId}/sales?limit=1000`, method: 'GET' })
            ]).then(function([inventoryRes, purchasesRes, salesRes]) {
                const data = inventoryRes.data;
                const purchases = purchasesRes.data.purchases || [];
                const sales = salesRes.data.sales || [];
                
                // Create CSV content
                let csv = `Agent: ${data.agent.name}\n`;
                csv += `Area: ${data.agent.area || '-'}\n`;
                csv += `Phone: ${data.agent.phone || '-'}\n\n`;
                
                csv += '=== INVENTORY ===\n';
                csv += 'Voucher,Stok,Terjual,Profit,Harga Reseller,Harga Jual\n';
                if (data.inventory.inventory && data.inventory.inventory.length > 0) {
                    data.inventory.inventory.forEach(item => {
                        csv += `"${item.voucherProfileName}",${item.stok},${item.terjual},${item.totalProfit || 0},${item.hargaReseller || 0},${item.hargaJual || 0}\n`;
                    });
                }
                
                csv += '\n=== PURCHASE HISTORY ===\n';
                csv += 'Tanggal,Voucher,Quantity,Harga,Payment,Status\n';
                purchases.forEach(p => {
                    const date = new Date(p.created_at).toLocaleString('id-ID');
                    csv += `"${date}","${p.voucherProfileName}",${p.quantity},${p.totalHarga || 0},"${p.paymentMethod || '-'}","${p.status}"\n`;
                });
                
                csv += '\n=== SALES HISTORY ===\n';
                csv += 'Tanggal,Voucher,Customer,Harga Jual,Profit,Payment,Status\n';
                sales.forEach(s => {
                    const date = new Date(s.created_at).toLocaleString('id-ID');
                    csv += `"${date}","${s.voucherProfileName}","${s.customerName || '-'}",${s.hargaJual || 0},${s.profit || 0},"${s.paymentMethod || '-'}","${s.status}"\n`;
                });
                
                // Download CSV
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                const url = URL.createObjectURL(blob);
                link.setAttribute('href', url);
                link.setAttribute('download', `agent_${data.agent.name}_${new Date().toISOString().slice(0, 10)}.csv`);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            });
        }
        
        // Initialize on page load
        $(document).ready(function() {
            loadStatistics();
            loadTopAgents();
            loadInventories();
        });
    </script>
</body>
</html>

