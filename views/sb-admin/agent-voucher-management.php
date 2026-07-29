<!DOCTYPE html>
<html lang="en">
<head>
<?php
    // <head> tulis tangan melewatkan components-modern.css (lapisan komponen bersama).
    $pageTitle = 'Agent Voucher Management - RAF NET';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
?>
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">

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
    
    <script src="/js/agent-voucher-management.js"></script>
</body>
</html>

