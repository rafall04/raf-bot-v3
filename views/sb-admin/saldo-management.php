<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
  <meta name="description" content="">
  <meta name="author" content="">

  <title>RAF BOT - Saldo & Voucher Management</title>

  <!-- Custom fonts for this template -->
  <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="/css/sb-admin-2.min.css" rel="stylesheet">
  <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css" rel="stylesheet">

  <style>
    .topup-request-card {
      border-left: 3px solid var(--primary);
      margin-bottom: 15px;
      transition: all 0.3s;
      background: #ffffff;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    .topup-request-card:hover {
      box-shadow: 0 5px 15px rgba(0,0,0,0.15);
      transform: translateY(-2px);
    }
    
    .credit { color: var(--success); font-weight: bold; }
    .debit { color: var(--danger); font-weight: bold; }
  </style>
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
        <?php include 'topbar.php'; ?>
        <!-- End of Topbar -->

        <!-- Begin Page Content -->
        <div class="container-fluid">

          <!-- Page Heading -->
          <div class="dashboard-header">
            <div class="d-flex align-items-center justify-content-between">
              <div>
                <h1>Manajemen Saldo & Voucher</h1>
                <p>Kelola saldo user, voucher, dan transaksi</p>
              </div>
              <button class="btn btn-success-custom" id="btnAddSaldoManual" data-action="showAddSaldoModal">
                <i class="fas fa-plus-circle"></i> Tambah Saldo Manual
              </button>
            </div>
          </div>

          <!-- Statistics Cards -->
          <h4 class="dashboard-section-title">Statistik</h4>
          <div class="row match-height mb-4">
            <div class="col-xl-3 col-md-6 mb-4">
              <div class="card dashboard-card card-primary">
                <div class="card-body">
                  <div class="card-content">
                    <div class="card-info">
                      <div class="card-title-text">Total Saldo Sistem</div>
                      <div class="card-value" id="totalSaldo">Rp 0</div>
                      <div class="card-subtitle">
                        <i class="fas fa-circle" style="font-size: 8px;"></i>
                        <span>Keseluruhan</span>
                      </div>
                    </div>
                    <div class="card-icon-container">
                      <i class="fas fa-wallet"></i>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="col-xl-3 col-md-6 mb-4">
              <div class="card dashboard-card card-success">
                <div class="card-body">
                  <div class="card-content">
                    <div class="card-info">
                      <div class="card-title-text">User Aktif (Saldo > 0)</div>
                      <div class="card-value" id="activeUsers">0</div>
                      <div class="card-subtitle">
                        <span class="card-change positive">
                          <i class="fas fa-check-circle"></i> Active
                        </span>
                      </div>
                    </div>
                    <div class="card-icon-container">
                      <i class="fas fa-users"></i>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="col-xl-3 col-md-6 mb-4">
              <div class="card dashboard-card card-info">
                <div class="card-body">
                  <div class="card-content">
                    <div class="card-info">
                      <div class="card-title-text">Topup Pending</div>
                      <div class="card-value" id="pendingTopups">0</div>
                      <div class="card-subtitle">
                        <span class="card-change warning">
                          <i class="fas fa-clock"></i> Waiting
                        </span>
                      </div>
                    </div>
                    <div class="card-icon-container">
                      <i class="fas fa-clock"></i>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="col-xl-3 col-md-6 mb-4">
              <div class="card dashboard-card card-warning">
                <div class="card-body">
                  <div class="card-content">
                    <div class="card-info">
                      <div class="card-title-text">Transaksi Hari Ini</div>
                      <div class="card-value" id="todayTransactions">0</div>
                      <div class="card-subtitle">
                        <i class="fas fa-circle" style="font-size: 8px;"></i>
                        <span>Today</span>
                      </div>
                    </div>
                    <div class="card-icon-container">
                      <i class="fas fa-exchange-alt"></i>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Tabs -->
          <ul class="nav nav-tabs" role="tablist">
            <li class="nav-item">
              <a class="nav-link active" data-toggle="tab" href="#topupRequests">
                <i class="fas fa-hand-holding-usd"></i> Request Topup
                <span class="badge badge-danger" id="pendingBadge">0</span>
              </a>
            </li>
            <li class="nav-item">
              <a class="nav-link" data-toggle="tab" href="#userSaldo">
                <i class="fas fa-users"></i> Saldo User
              </a>
            </li>
            <li class="nav-item">
              <a class="nav-link" data-toggle="tab" href="#agentSaldo">
                <i class="fas fa-store"></i> Saldo Agent
              </a>
            </li>
            <li class="nav-item">
              <a class="nav-link" data-toggle="tab" href="#transactions">
                <i class="fas fa-history"></i> Riwayat Transaksi
              </a>
            </li>
          </ul>

          <!-- Tab Content -->
          <div class="tab-content">
            <!-- Topup Requests Tab -->
            <div id="topupRequests" class="tab-pane fade show active">
              <div class="card shadow mb-4">
                <div class="card-header py-3">
                  <h6 class="m-0 font-weight-bold text-primary">
                    Request Topup Pending
                  </h6>
                </div>
                <div class="card-body">
                  <div id="topupRequestsList"></div>
                </div>
              </div>
            </div>

            <!-- User Saldo Tab -->
            <div id="userSaldo" class="tab-pane fade">
              <div class="card shadow mb-4">
                <div class="card-header py-3">
                  <h6 class="m-0 font-weight-bold text-primary">
                    Daftar Saldo User
                  </h6>
                </div>
                <div class="card-body">
                  <div class="table-responsive">
                    <table class="table table-bordered" id="saldoTable" width="100%">
                      <thead>
                        <tr>
                          <th>No</th>
                          <th>User ID</th>
                          <th>Nama</th>
                          <th>Saldo</th>
                          <th>Last Update</th>
                          <th>Aksi</th>
                        </tr>
                      </thead>
                      <tbody></tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            <!-- Agent Saldo Tab -->
            <div id="agentSaldo" class="tab-pane fade">
              <div class="card shadow mb-4">
                <div class="card-header py-3 d-flex justify-content-between align-items-center">
                  <h6 class="m-0 font-weight-bold text-primary">
                    Daftar Saldo Agent
                  </h6>
                  <button class="btn btn-sm btn-success" id="btnAddAgentSaldo" data-action="showAddAgentSaldoModal">
                    <i class="fas fa-plus-circle"></i> Topup Saldo Agent
                  </button>
                </div>
                <div class="card-body">
                  <div class="table-responsive">
                    <table class="table table-bordered" id="agentSaldoTable" width="100%">
                      <thead>
                        <tr>
                          <th>No</th>
                          <th>Nama Agent</th>
                          <th>Area</th>
                          <th>Phone</th>
                          <th>Saldo</th>
                          <th>Last Update</th>
                          <th>Aksi</th>
                        </tr>
                      </thead>
                      <tbody></tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            <!-- Transactions Tab -->
            <div id="transactions" class="tab-pane fade">
              <div class="card shadow mb-4">
                <div class="card-header py-3">
                  <h6 class="m-0 font-weight-bold text-primary">
                    Riwayat Transaksi
                  </h6>
                </div>
                <div class="card-body">
                  <div class="table-responsive">
                    <table class="table table-bordered" id="transactionTable" width="100%">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Tanggal</th>
                          <th>User</th>
                          <th>Tipe</th>
                          <th>Jumlah</th>
                          <th>Keterangan</th>
                          <th>Saldo Akhir</th>
                          <th>Bukti</th>
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
        <!-- /.container-fluid -->

      </div>
      <!-- End of Main Content -->

      <!-- Footer -->
      <?php include '_footer.php'; ?>
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
          <a class="btn btn-primary" href="/api/logout">Logout</a>
        </div>
      </div>
    </div>
  </div>

  <!-- Add Saldo Modal -->
  <div class="modal fade" id="addSaldoModal" tabindex="-1">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">Tambah Saldo Manual</h5>
          <button type="button" class="close" data-dismiss="modal">
            <span>&times;</span>
          </button>
        </div>
        <div class="modal-body">
          <form id="addSaldoForm">
            <div class="form-group">
              <label>User ID / No WhatsApp</label>
              <input type="text" class="form-control" id="addSaldoUserId" required>
              <small class="form-text text-muted">Format: 628xxx atau 628xxx@s.whatsapp.net</small>
            </div>
            <div class="form-group">
              <label>Jumlah Saldo</label>
              <input type="number" class="form-control" id="addSaldoAmount" min="1000" required>
            </div>
            <div class="form-group">
              <label>Keterangan</label>
              <input type="text" class="form-control" id="addSaldoDescription" value="Topup manual by admin">
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
          <button type="button" class="btn btn-success" id="btnSubmitAddSaldo" data-action="addSaldoManual">
            <i class="fas fa-plus-circle"></i> Tambah Saldo
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Add Agent Saldo Modal -->
  <div class="modal fade" id="addAgentSaldoModal" tabindex="-1">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">Topup Saldo Agent</h5>
          <button type="button" class="close" data-dismiss="modal">
            <span>&times;</span>
          </button>
        </div>
        <div class="modal-body">
          <form id="addAgentSaldoForm">
            <div class="form-group">
              <label>Pilih Agent</label>
              <select class="form-control" id="addAgentSaldoAgentId" required>
                <option value="">-- Pilih Agent --</option>
              </select>
            </div>
            <div class="form-group">
              <label>Jumlah Saldo</label>
              <input type="number" class="form-control" id="addAgentSaldoAmount" min="1000" required>
            </div>
            <div class="form-group">
              <label>Keterangan</label>
              <input type="text" class="form-control" id="addAgentSaldoDescription" value="Topup saldo agent by admin">
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
          <button type="button" class="btn btn-success" id="btnSubmitAddAgentSaldo" data-action="addAgentSaldoManual">
            <i class="fas fa-plus-circle"></i> Topup Saldo
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Bootstrap core JavaScript-->
  <script src="/static/vendor/jquery/jquery.min.js"></script>
  <script src="/static/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>

  <!-- Core plugin JavaScript-->
  <script src="/static/vendor/jquery-easing/jquery.easing.min.js"></script>

  <!-- Custom scripts for all pages-->
  <script src="/static/js/sb-admin-2.min.js"></script>

  <!-- Page level plugins -->
  <script src="/static/vendor/datatables/jquery.dataTables.min.js"></script>
  <script src="/static/vendor/datatables/dataTables.bootstrap4.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

  <!-- Page level custom scripts -->
  <script src="/static/js/saldo-management.js"></script>

  <script>
    // Agent Saldo Management
    let agentSaldoTable;
    
    // Load agent saldo table
    function loadAgentSaldoTable() {
      if (agentSaldoTable) {
        agentSaldoTable.destroy();
      }
      
      agentSaldoTable = $('#agentSaldoTable').DataTable({
        ajax: {
          url: '/api/saldo/agents',
          dataSrc: 'data',
          error: function(xhr, error, thrown) {
            console.error('DataTables AJAX error:', error, thrown);
            Swal.fire({
              icon: 'error',
              title: 'Gagal Memuat Data',
              text: 'Error: ' + thrown
            });
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
          { data: 'agentPhone' },
          {
            data: 'saldo',
            render: function(data) {
              return new Intl.NumberFormat('id-ID', {
                style: 'currency',
                currency: 'IDR',
                minimumFractionDigits: 0
              }).format(data || 0);
            }
          },
          {
            data: 'lastUpdate',
            render: function(data) {
              if (!data) return '-';
              return new Date(data).toLocaleString('id-ID');
            }
          },
          {
            data: null,
            render: function(data) {
              const safeAgentId = (data.agentId || '').replace(/"/g, '&quot;');
              const safeAgentName = (data.agentName || '').replace(/"/g, '&quot;');
              return `<button class="btn btn-sm btn-success btn-topup-agent" data-agent-id="${safeAgentId}" data-agent-name="${safeAgentName}">
                <i class="fas fa-plus-circle"></i> Topup
              </button>`;
            }
          }
        ],
        order: [[4, 'desc']], // Sort by saldo
        language: {
          emptyTable: 'Tidak ada data agent',
          processing: 'Memuat data...',
          zeroRecords: 'Tidak ditemukan data yang sesuai'
        }
      });
    }
    
    // Show add agent saldo modal - Make globally accessible
    window.showAddAgentSaldoModal = function() {
      // Load agents for dropdown
      $.ajax({
        url: '/api/agents/list',
        method: 'GET',
        success: function(response) {
          if (response.success && response.data && Array.isArray(response.data)) {
            const select = $('#addAgentSaldoAgentId');
            select.empty().append('<option value="">-- Pilih Agent --</option>');
            
            if (response.data.length === 0) {
              select.append('<option value="" disabled>Tidak ada agent aktif</option>');
              Swal.fire({
                icon: 'warning',
                title: 'Tidak Ada Agent',
                text: 'Tidak ada agent aktif yang ditemukan'
              });
              return;
            }
            
            response.data.forEach(agent => {
              if (agent.active) {
                // Ensure phone is a string and not empty
                const phone = agent.phone ? String(agent.phone).trim() : '';
                if (phone) {
                  select.append(`<option value="${agent.id}" data-phone="${phone}">${agent.name} (${agent.area || '-'})</option>`);
                } else {
                  select.append(`<option value="${agent.id}" data-phone="" disabled>${agent.name} (${agent.area || '-'}) - No Phone</option>`);
                }
              }
            });
            
            // Check if any active agents were added
            if (select.find('option').length === 1) {
              select.append('<option value="" disabled>Tidak ada agent aktif</option>');
              Swal.fire({
                icon: 'warning',
                title: 'Tidak Ada Agent Aktif',
                text: 'Semua agent saat ini tidak aktif'
              });
            } else {
              $('#addAgentSaldoModal').modal('show');
            }
          } else {
            console.error('[AGENT_SALDO] Invalid response format:', response);
            Swal.fire({
              icon: 'error',
              title: 'Error',
              text: 'Format response tidak valid dari server'
            });
          }
        },
        error: function(xhr, status, error) {
          console.error('[AGENT_SALDO] AJAX error:', xhr, status, error);
          const errorMsg = xhr.responseJSON?.message || xhr.statusText || 'Gagal memuat daftar agent';
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: errorMsg
          });
        }
      });
    };
    
    // Topup agent saldo (quick action from table) - Make globally accessible
    window.topupAgentSaldo = function(agentId, agentName) {
      // Load agents first to populate dropdown
      $.ajax({
        url: '/api/agents/list',
        method: 'GET',
        success: function(response) {
          if (response.success && response.data && Array.isArray(response.data)) {
            const select = $('#addAgentSaldoAgentId');
            select.empty().append('<option value="">-- Pilih Agent --</option>');
            
            response.data.forEach(agent => {
              if (agent.active) {
                // Ensure phone is a string and not empty
                const phone = agent.phone ? String(agent.phone).trim() : '';
                const selected = agent.id === agentId ? 'selected' : '';
                if (phone) {
                  select.append(`<option value="${agent.id}" data-phone="${phone}" ${selected}>${agent.name} (${agent.area || '-'})</option>`);
                } else {
                  select.append(`<option value="${agent.id}" data-phone="" disabled ${selected}>${agent.name} (${agent.area || '-'}) - No Phone</option>`);
                }
              }
            });
            
            // Set values
            $('#addAgentSaldoAmount').val('');
            $('#addAgentSaldoDescription').val(`Topup saldo agent ${agentName} by admin`);
            $('#addAgentSaldoModal').modal('show');
          } else {
            console.error('[AGENT_SALDO] Invalid response when opening from table:', response);
            Swal.fire({
              icon: 'error',
              title: 'Error',
              text: 'Gagal memuat data agent'
            });
          }
        },
        error: function(xhr, status, error) {
          console.error('[AGENT_SALDO] AJAX error when opening from table:', xhr, status, error);
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Gagal memuat daftar agent'
          });
        }
      });
    };
    
    // Load agent phone when selection changes
    // Remove old listener first to prevent memory leaks
    $('#addAgentSaldoAgentId').off('change.agentSaldo');
    $('#addAgentSaldoAgentId').on('change.agentSaldo', function() {
      const selectedOption = $(this).find('option:selected');
      // Phone is already in data-phone attribute, no need to do anything
    });
    
    // Add agent saldo manual - Make globally accessible
    window.addAgentSaldoManual = function() {
      const agentId = $('#addAgentSaldoAgentId').val();
      const amount = $('#addAgentSaldoAmount').val();
      const description = $('#addAgentSaldoDescription').val();
      
      if (!agentId || !amount) {
        Swal.fire({
          icon: 'warning',
          title: 'Data Tidak Lengkap',
          text: 'Harap pilih agent dan isi jumlah saldo'
        });
        return;
      }
      
      // Get agent phone from selected option
      const selectedOption = $('#addAgentSaldoAgentId option:selected');
      let agentPhone = selectedOption.data('phone');
      
      // Validate and convert to string
      if (!agentPhone || agentPhone === '') {
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'Nomor WhatsApp agent tidak ditemukan. Pastikan agent memiliki nomor WhatsApp yang valid.'
        });
        return;
      }
      
      // Ensure agentPhone is a string
      agentPhone = String(agentPhone).trim();
      
      if (!agentPhone || agentPhone === '') {
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'Nomor WhatsApp agent tidak valid'
        });
        return;
      }
      
      // Format phone to JID
      let userId = agentPhone;
      if (typeof userId === 'string' && !userId.includes('@')) {
        // Remove any non-digit characters except +
        userId = userId.replace(/[^\d+]/g, '');
        
        // Normalize phone number
        if (userId.startsWith('0')) {
          userId = '62' + userId.substring(1);
        } else if (!userId.startsWith('62') && !userId.startsWith('+62')) {
          userId = '62' + userId;
        }
        
        // Remove + if present
        userId = userId.replace(/^\+/, '');
        
        // Add @s.whatsapp.net
        userId = userId + '@s.whatsapp.net';
      } else if (typeof userId !== 'string') {
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'Format nomor WhatsApp tidak valid'
        });
        return;
      }
      
      Swal.fire({
        title: 'Konfirmasi Topup',
        html: `Topup saldo untuk agent <strong>${selectedOption.text()}</strong><br>Jumlah: <strong>Rp ${parseInt(amount).toLocaleString('id-ID')}</strong>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Ya, Topup',
        cancelButtonText: 'Batal'
      }).then((result) => {
        if (result.isConfirmed) {
          $.ajax({
            url: '/api/saldo/agent-topup',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
              agentId: agentId,
              userId: userId,
              amount: parseInt(amount),
              description: description || `Topup saldo agent by admin`
            }),
            success: function(response) {
              if (response.success) {
                Swal.fire({
                  icon: 'success',
                  title: 'Berhasil!',
                  text: response.message || 'Saldo agent berhasil ditambahkan'
                });
                $('#addAgentSaldoModal').modal('hide');
                $('#addAgentSaldoForm')[0].reset();
                if (agentSaldoTable) {
                  agentSaldoTable.ajax.reload();
                }
              } else {
                Swal.fire({
                  icon: 'error',
                  title: 'Gagal',
                  text: response.message || 'Gagal menambah saldo agent'
                });
              }
            },
            error: function(xhr) {
              const errorMsg = xhr.responseJSON?.message || 'Server error';
              Swal.fire({
                icon: 'error',
                title: 'Error',
                text: errorMsg
              });
            }
          });
        }
      });
    }
    
    // Initialize agent saldo table when tab is shown
    // Remove old listeners first to prevent memory leaks
    $('a[data-toggle="tab"]').off('shown.bs.tab.agentSaldo');
    $('a[data-toggle="tab"]').on('shown.bs.tab.agentSaldo', function (e) {
      if ($(e.target).attr('href') === '#agentSaldo') {
        if (!agentSaldoTable) {
          loadAgentSaldoTable();
        } else {
          agentSaldoTable.ajax.reload();
        }
      }
    });
    
    // Fix for addAgentSaldoModal aria-hidden issue
    // Remove old listeners first to prevent memory leaks
    $('#addAgentSaldoModal').off('show.bs.modal.agentSaldo shown.bs.modal.agentSaldo hide.bs.modal.agentSaldo hidden.bs.modal.agentSaldo');
    $('#addAgentSaldoModal').on('show.bs.modal.agentSaldo', function () {
      // Remove focus from any active element before showing modal
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
    });
    
    $('#addAgentSaldoModal').on('shown.bs.modal.agentSaldo', function () {
      $(this).removeAttr('aria-hidden');
      $(this).attr('aria-modal', 'true');
      // Focus on first input
      $('#addAgentSaldoAgentId').focus();
    });
    
    $('#addAgentSaldoModal').on('hide.bs.modal.agentSaldo', function () {
      // Blur any focused element in the modal before hiding
      $(this).find(':focus').blur();
    });
    
    $('#addAgentSaldoModal').on('hidden.bs.modal.agentSaldo', function () {
      // Reset form after modal is completely hidden
      $('#addAgentSaldoForm')[0].reset();
      $('#addAgentSaldoAgentId').empty().append('<option value="">-- Pilih Agent --</option>');
    });
    
    // Cleanup on page unload
    $(window).on('beforeunload.agentSaldo', function() {
      $('a[data-toggle="tab"]').off('shown.bs.tab.agentSaldo');
      $('#addAgentSaldoAgentId').off('change.agentSaldo');
      $('#addAgentSaldoModal').off('show.bs.modal.agentSaldo shown.bs.modal.agentSaldo hide.bs.modal.agentSaldo hidden.bs.modal.agentSaldo');
    });
  </script>

</body>

</html>
