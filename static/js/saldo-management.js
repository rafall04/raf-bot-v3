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
