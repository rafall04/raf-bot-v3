    let agentTable;
    
    $(document).ready(function() {
        loadAgents();
        loadStatistics();
    });
    
    // Toast notification function
    function showToast(message, type = 'success', title = null) {
        const toastId = 'toast-' + new Date().getTime();
        const bgClass = type === 'success' ? 'bg-success' : 
                       type === 'error' ? 'bg-danger' : 
                       type === 'warning' ? 'bg-warning' : 'bg-info';
        
        const toastTitle = title || (type === 'success' ? 'Berhasil' : 
                                    type === 'error' ? 'Error' : 
                                    type === 'warning' ? 'Peringatan' : 'Info');
        
        const icon = type === 'success' ? 'fa-check-circle' : 
                    type === 'error' ? 'fa-times-circle' : 
                    type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle';
        
        const toastHtml = `
            <div id="${toastId}" class="toast ${bgClass} text-white" role="alert" aria-live="assertive" aria-atomic="true" data-delay="5000">
                <div class="toast-header ${bgClass} text-white">
                    <i class="fas ${icon} mr-2"></i>
                    <strong class="mr-auto">${toastTitle}</strong>
                    <button type="button" class="ml-2 mb-1 close text-white" data-dismiss="toast" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <div class="toast-body">
                    ${message}
                </div>
            </div>`;
        
        $('.toast-container').append(toastHtml);
        $(`#${toastId}`).toast('show');
        
        // Remove toast from DOM after it's hidden
        $(`#${toastId}`).on('hidden.bs.toast', function () {
            $(this).remove();
        });
    }
    
    function loadAgents() {
        $.get('/api/agents/list', function(response) {
            if (response.success) {
                const agents = response.data;
                let html = '';
                
                agents.forEach(agent => {
                    const services = agent.services.map(s => {
                        let className = 'service-' + s;
                        let label = s;
                        if (s === 'topup') label = 'Topup';
                        else if (s === 'voucher') label = 'Voucher';
                        else if (s === 'pembayaran') label = 'Pembayaran';
                        return `<span class="service-badge ${className}">${label}</span>`;
                    }).join('');
                    
                    const statusClass = agent.active ? 'status-active' : 'status-inactive';
                    const statusText = agent.active ? 'Aktif' : 'Nonaktif';
                    
                    // PIN status will be loaded asynchronously
                    const pinStatusId = `pin-status-${agent.id}`;
                    
                    html += `
                        <tr>
                            <td>${agent.id}</td>
                            <td><strong>${agent.name}</strong></td>
                            <td>${agent.phone}</td>
                            <td>${agent.area}</td>
                            <td>${agent.address}</td>
                            <td>${services}</td>
                            <td>${agent.operational_hours}</td>
                            <td><span class="${statusClass}"><i class="fas fa-circle"></i> ${statusText}</span></td>
                            <td id="${pinStatusId}">
                                <span class="text-muted"><i class="fas fa-spinner fa-spin"></i> Loading...</span>
                            </td>
                            <td>
                                <button class="btn btn-sm btn-info" onclick="editAgent('${agent.id}')" title="Edit Agent">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-sm btn-warning" onclick="managePin('${agent.id}')" title="Manage PIN">
                                    <i class="fas fa-key"></i>
                                </button>
                                <button class="btn btn-sm btn-danger" onclick="deleteAgent('${agent.id}')" title="Hapus Agent">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </td>
                        </tr>
                    `;
                });
                
                $('#agentTableBody').html(html);
                
                // Load PIN status for each agent
                agents.forEach(agent => {
                    loadPinStatus(agent.id);
                });
                
                // Initialize DataTable
                if (agentTable) {
                    agentTable.destroy();
                }
                
                agentTable = $('#agentTable').DataTable({
                    "language": {
                        "sProcessing": "Sedang memproses...",
                        "sLengthMenu": "Tampilkan _MENU_ entri",
                        "sZeroRecords": "Tidak ditemukan data yang sesuai",
                        "sInfo": "Menampilkan _START_ sampai _END_ dari _TOTAL_ entri",
                        "sInfoEmpty": "Menampilkan 0 sampai 0 dari 0 entri",
                        "sInfoFiltered": "(disaring dari _MAX_ entri keseluruhan)",
                        "sInfoPostFix": "",
                        "sSearch": "Cari:",
                        "sUrl": "",
                        "oPaginate": {
                            "sFirst": "Pertama",
                            "sPrevious": "Sebelumnya",
                            "sNext": "Selanjutnya",
                            "sLast": "Terakhir"
                        }
                    },
                    "pageLength": 25,
                    "order": [[0, "desc"]]
                });
            }
        });
    }
    
    function loadStatistics() {
        $.get('/api/agents/statistics')
            .done(function(response) {
                if (response.success) {
                    const stats = response.data;
                    $('#totalAgents').text(stats.total || 0);
                    $('#activeAgents').text(stats.active || 0);
                    $('#totalAreas').text(Object.keys(stats.byArea || {}).length);
                    
                    // Count total services
                    let totalServices = 0;
                    for (let service in stats.byService) {
                        totalServices += stats.byService[service];
                    }
                    $('#totalServices').text(totalServices);
                } else {
                    // Set default values on error
                    $('#totalAgents').text('0');
                    $('#activeAgents').text('0');
                    $('#totalAreas').text('0');
                    $('#totalServices').text('0');
                }
            })
            .fail(function(xhr, status, error) {
                // Set default values on error
                $('#totalAgents').text('0');
                $('#activeAgents').text('0');
                $('#totalAreas').text('0');
                $('#totalServices').text('0');
            });
    }
    
    function showAddAgentModal() {
        $('#agentModalTitle').text('Tambah Agent');
        $('#agentForm')[0].reset();
        $('#agentId').val('');
        $('#agentModal').modal('show');
    }
    
    function editAgent(agentId) {
        $.get(`/api/agents/detail/${agentId}`)
            .done(function(response) {
                if (response.success) {
                    const agent = response.data;
                    $('#agentModalTitle').text('Edit Agent');
                    $('#agentId').val(agent.id);
                    $('#agentName').val(agent.name);
                    $('#agentPhone').val(agent.phone);
                    $('#agentArea').val(agent.area);
                    $('#agentAddress').val(agent.address);
                    $('#agentHours').val(agent.operational_hours);
                    
                    // Set services
                    $('#serviceTopup').prop('checked', agent.services && agent.services.includes('topup'));
                    $('#serviceVoucher').prop('checked', agent.services && agent.services.includes('voucher'));
                    $('#servicePembayaran').prop('checked', agent.services && agent.services.includes('pembayaran'));
                    
                    // Set location if available
                    if (agent.location) {
                        $('#agentLat').val(agent.location.lat);
                        $('#agentLng').val(agent.location.lng);
                    } else {
                        $('#agentLat').val('');
                        $('#agentLng').val('');
                    }
                    
                    $('#agentModal').modal('show');
                } else {
                    showToast(response.message || 'Gagal memuat data agent', 'error', 'Error');
                }
            })
            .fail(function(xhr, status, error) {
                let errorMsg = 'Gagal memuat data agent';
                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMsg = xhr.responseJSON.message;
                } else if (xhr.status === 404) {
                    errorMsg = 'Agent tidak ditemukan';
                } else if (xhr.status === 401) {
                    errorMsg = 'Sesi Anda telah berakhir. Silakan login kembali.';
                }
                showToast(errorMsg, 'error', 'Error');
            });
    }
    
    // Validate phone number format
    function validatePhoneNumber(phone) {
        if (!phone || phone.trim() === '') {
            return { valid: false, message: 'Nomor telepon tidak boleh kosong' };
        }
        
        // Remove spaces, dashes, parentheses
        const cleaned = phone.replace(/[\s\-\(\)]/g, '');
        
        // Check if contains only digits and optional + at start
        if (!/^\+?[0-9]+$/.test(cleaned)) {
            return { valid: false, message: 'Nomor telepon hanya boleh berisi angka' };
        }
        
        // Check length (minimum 10 digits, maximum 15 digits for international)
        const digits = cleaned.replace(/^\+/, '');
        if (digits.length < 10 || digits.length > 15) {
            return { valid: false, message: 'Nomor telepon harus 10-15 digit' };
        }
        
        // Check Indonesian format (08xx, 628xx, +628xx)
        if (cleaned.startsWith('08') || cleaned.startsWith('628') || cleaned.startsWith('+628')) {
            // Indonesian format - validate length
            const idDigits = cleaned.replace(/^\+?628?/, '').replace(/^0/, '');
            if (idDigits.length < 9 || idDigits.length > 11) {
                return { valid: false, message: 'Format nomor Indonesia tidak valid (min 9, max 11 digit setelah 08/628)' };
            }
        }
        
        return { valid: true, message: 'OK' };
    }
    
    // Validate coordinates
    function validateCoordinates(lat, lng) {
        const latNum = parseFloat(lat);
        const lngNum = parseFloat(lng);
        
        if (isNaN(latNum) || isNaN(lngNum)) {
            return { valid: false, message: 'Koordinat harus berupa angka' };
        }
        
        if (latNum < -90 || latNum > 90) {
            return { valid: false, message: 'Latitude harus antara -90 sampai 90' };
        }
        
        if (lngNum < -180 || lngNum > 180) {
            return { valid: false, message: 'Longitude harus antara -180 sampai 180' };
        }
        
        return { valid: true, message: 'OK', lat: latNum, lng: lngNum };
    }
    
    function saveAgent() {
        const agentId = $('#agentId').val();
        const services = [];
        if ($('#serviceTopup').is(':checked')) services.push('topup');
        if ($('#serviceVoucher').is(':checked')) services.push('voucher');
        if ($('#servicePembayaran').is(':checked')) services.push('pembayaran');
        
        // Validate required fields
        const name = $('#agentName').val().trim();
        const phone = $('#agentPhone').val().trim();
        const area = $('#agentArea').val().trim();
        const address = $('#agentAddress').val().trim();
        
        if (!name || !phone || !area || !address) {
            showToast('Nama, nomor telepon, area, dan alamat wajib diisi!', 'error', 'Validasi Gagal');
            return;
        }
        
        // Validate phone number
        const phoneValidation = validatePhoneNumber(phone);
        if (!phoneValidation.valid) {
            showToast(phoneValidation.message, 'error', 'Validasi Nomor Telepon');
            $('#agentPhone').focus();
            return;
        }
        
        // Normalize phone number (remove spaces, dashes, etc)
        const normalizedPhone = phone.replace(/[\s\-\(\)]/g, '');
        
        const data = {
            name: name,
            phone: normalizedPhone,
            area: area,
            address: address,
            operational_hours: $('#agentHours').val() || '08:00 - 20:00',
            services: services
        };
        
        // Validate and add location if provided
        const lat = $('#agentLat').val().trim();
        const lng = $('#agentLng').val().trim();
        if (lat || lng) {
            // Both must be provided
            if (!lat || !lng) {
                showToast('Jika ingin menambahkan koordinat, latitude dan longitude harus diisi keduanya!', 'warning', 'Validasi Koordinat');
                return;
            }
            
            const coordValidation = validateCoordinates(lat, lng);
            if (!coordValidation.valid) {
                showToast(coordValidation.message, 'error', 'Validasi Koordinat');
                return;
            }
            
            data.location = {
                lat: coordValidation.lat,
                lng: coordValidation.lng
            };
        }
        
        const url = agentId ? `/api/agents/update/${agentId}` : '/api/agents/add';
        const method = agentId ? 'PUT' : 'POST';
        
        $.ajax({
            url: url,
            method: method,
            data: JSON.stringify(data),
            contentType: 'application/json',
            success: function(response) {
                if (response.success) {
                    showToast(
                        agentId ? 'Data agent berhasil diperbarui!' : 'Agent baru berhasil ditambahkan!',
                        'success',
                        agentId ? 'Update Berhasil' : 'Tambah Berhasil'
                    );
                    $('#agentModal').modal('hide');
                    loadAgents();
                    loadStatistics();
                } else {
                    showToast(response.message || 'Gagal menyimpan agent', 'error', 'Gagal Menyimpan');
                }
            },
            error: function(xhr, status, error) {
                let errorMsg = 'Terjadi kesalahan saat menyimpan agent';
                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMsg = xhr.responseJSON.message;
                } else if (xhr.status === 400) {
                    errorMsg = 'Data yang dimasukkan tidak valid. Periksa kembali form.';
                } else if (xhr.status === 401) {
                    errorMsg = 'Sesi Anda telah berakhir. Silakan login kembali.';
                } else if (xhr.status >= 500) {
                    errorMsg = 'Terjadi kesalahan pada server. Silakan coba lagi nanti.';
                }
                showToast(errorMsg, 'error', 'Error');
            }
        });
    }
    
    function deleteAgent(agentId) {
        if (!confirm('Apakah Anda yakin ingin menonaktifkan agent ini?')) {
            return;
        }
        
        $.ajax({
            url: `/api/agents/delete/${agentId}`,
            method: 'DELETE',
            success: function(response) {
                if (response.success) {
                    showToast('Agent berhasil dinonaktifkan!', 'success', 'Berhasil');
                    loadAgents();
                    loadStatistics();
                } else {
                    showToast(response.message || 'Gagal menonaktifkan agent', 'error', 'Gagal');
                }
            },
            error: function(xhr, status, error) {
                let errorMsg = 'Terjadi kesalahan saat menonaktifkan agent';
                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMsg = xhr.responseJSON.message;
                } else if (xhr.status === 404) {
                    errorMsg = 'Agent tidak ditemukan';
                } else if (xhr.status === 401) {
                    errorMsg = 'Sesi Anda telah berakhir. Silakan login kembali.';
                } else if (xhr.status >= 500) {
                    errorMsg = 'Terjadi kesalahan pada server. Silakan coba lagi nanti.';
                }
                showToast(errorMsg, 'error', 'Error');
            }
        });
    }
    
    // Load PIN status for an agent
    function loadPinStatus(agentId) {
        $.get(`/api/agents/${agentId}/pin/status`)
            .done(function(response) {
                const statusId = `#pin-status-${agentId}`;
                if (response.hasPin) {
                    $(statusId).html(`
                        <span class="badge badge-success">
                            <i class="fas fa-check-circle"></i> Terdaftar
                        </span>
                    `);
                } else {
                    $(statusId).html(`
                        <span class="badge badge-secondary">
                            <i class="fas fa-times-circle"></i> Belum Terdaftar
                        </span>
                    `);
                }
            })
            .fail(function() {
                const statusId = `#pin-status-${agentId}`;
                $(statusId).html(`
                    <span class="badge badge-danger">
                        <i class="fas fa-exclamation-triangle"></i> Error
                    </span>
                `);
            });
    }
    
    // Manage PIN modal
    function managePin(agentId) {
        // Get agent details first
        $.get(`/api/agents/detail/${agentId}`)
            .done(function(agentResponse) {
                if (!agentResponse.success) {
                    showToast('Agent tidak ditemukan', 'error', 'Error');
                    return;
                }
                
                const agent = agentResponse.data;
                $('#pinAgentId').val(agent.id);
                $('#pinAgentPhone').val(agent.phone);
                $('#pinAgentName').val(agent.name);
                
                // Load PIN status
                $.get(`/api/agents/${agentId}/pin/status`)
                    .done(function(pinResponse) {
                        if (pinResponse.hasPin) {
                            $('#pinStatusText').text(`Agent ${agent.name} sudah memiliki PIN.`);
                            $('#pinStatusInfo').removeClass('alert-info').addClass('alert-success');
                            $('#pinModalTitle').text(`Reset PIN - ${agent.name}`);
                            
                            // Show reset mode
                            $('#createPinMode').hide();
                            $('#changePinMode').hide();
                            $('#resetPinMode').show();
                            $('#savePinBtn').text('Reset PIN').removeClass('btn-primary').addClass('btn-warning');
                        } else {
                            $('#pinStatusText').text(`Agent ${agent.name} belum memiliki PIN.`);
                            $('#pinStatusInfo').removeClass('alert-success').addClass('alert-info');
                            $('#pinModalTitle').text(`Buat PIN - ${agent.name}`);
                            
                            // Show create mode
                            $('#resetPinMode').hide();
                            $('#changePinMode').hide();
                            $('#createPinMode').show();
                            $('#savePinBtn').text('Buat PIN').removeClass('btn-warning').addClass('btn-primary');
                        }
                        
                        // Clear all form fields
                        $('#newPin, #confirmPin, #whatsappNumber, #resetNewPin, #resetConfirmPin, #oldPin, #changeNewPin, #changeConfirmPin').val('');
                        
                        $('#pinModal').modal('show');
                    })
                    .fail(function() {
                        showToast('Gagal memuat status PIN', 'error', 'Error');
                    });
            })
            .fail(function() {
                showToast('Gagal memuat data agent', 'error', 'Error');
            });
    }
    
    // Validate PIN format
    function validatePinFormat(pin) {
        if (!pin || pin.trim() === '') {
            return { valid: false, message: 'PIN tidak boleh kosong' };
        }
        if (!/^[0-9]+$/.test(pin)) {
            return { valid: false, message: 'PIN hanya boleh berisi angka' };
        }
        if (pin.length < 4 || pin.length > 6) {
            return { valid: false, message: 'PIN harus 4-6 digit' };
        }
        return { valid: true };
    }
    
    // Save PIN (Create, Reset, or Change)
    function savePin() {
        const agentId = $('#pinAgentId').val();
        const agentPhone = $('#pinAgentPhone').val();
        const agentName = $('#pinAgentName').val();
        
        if (!agentId) {
            showToast('Agent ID tidak ditemukan', 'error', 'Error');
            return;
        }
        
        // Determine which mode is active
        let mode = '';
        let pin = '';
        let confirmPin = '';
        let oldPin = '';
        let whatsappNumber = '';
        
        if ($('#createPinMode').is(':visible')) {
            mode = 'create';
            pin = $('#newPin').val().trim();
            confirmPin = $('#confirmPin').val().trim();
            whatsappNumber = $('#whatsappNumber').val().trim() || agentPhone;
        } else if ($('#resetPinMode').is(':visible')) {
            mode = 'reset';
            pin = $('#resetNewPin').val().trim();
            confirmPin = $('#resetConfirmPin').val().trim();
        } else if ($('#changePinMode').is(':visible')) {
            mode = 'change';
            oldPin = $('#oldPin').val().trim();
            pin = $('#changeNewPin').val().trim();
            confirmPin = $('#changeConfirmPin').val().trim();
            whatsappNumber = agentPhone;
        } else {
            showToast('Mode tidak valid', 'error', 'Error');
            return;
        }
        
        // Validate PIN format
        const pinValidation = validatePinFormat(pin);
        if (!pinValidation.valid) {
            showToast(pinValidation.message, 'error', 'Validasi Gagal');
            return;
        }
        
        // Check PIN confirmation
        if (pin !== confirmPin) {
            showToast('PIN dan konfirmasi PIN tidak cocok', 'error', 'Validasi Gagal');
            return;
        }
        
        // Disable button during request
        const $saveBtn = $('#savePinBtn');
        const originalText = $saveBtn.text();
        $saveBtn.prop('disabled', true).text('Memproses...');
        
        // Make API call based on mode
        let apiUrl = '';
        let apiMethod = '';
        let requestData = {};
        
        if (mode === 'create') {
            apiUrl = `/api/agents/${agentId}/pin/create`;
            apiMethod = 'POST';
            requestData = { pin: pin, whatsappNumber: whatsappNumber };
        } else if (mode === 'reset') {
            apiUrl = `/api/agents/${agentId}/pin/reset`;
            apiMethod = 'PUT';
            requestData = { pin: pin };
        } else if (mode === 'change') {
            apiUrl = `/api/agents/${agentId}/pin/change`;
            apiMethod = 'PUT';
            requestData = { oldPin: oldPin, newPin: pin, whatsappNumber: whatsappNumber };
        }
        
        $.ajax({
            url: apiUrl,
            method: apiMethod,
            contentType: 'application/json',
            data: JSON.stringify(requestData),
            success: function(response) {
                if (response.success) {
                    showToast(response.message || 'PIN berhasil disimpan', 'success', 'Berhasil');
                    $('#pinModal').modal('hide');
                    
                    // Reload PIN status in table
                    loadPinStatus(agentId);
                } else {
                    showToast(response.message || 'Gagal menyimpan PIN', 'error', 'Gagal');
                }
            },
            error: function(xhr, status, error) {
                let errorMsg = 'Terjadi kesalahan saat menyimpan PIN';
                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMsg = xhr.responseJSON.message;
                } else if (xhr.status === 404) {
                    errorMsg = 'Agent tidak ditemukan';
                } else if (xhr.status === 401) {
                    errorMsg = 'Sesi Anda telah berakhir. Silakan login kembali.';
                } else if (xhr.status >= 500) {
                    errorMsg = 'Terjadi kesalahan pada server. Silakan coba lagi nanti.';
                }
                showToast(errorMsg, 'error', 'Error');
            },
            complete: function() {
                $saveBtn.prop('disabled', false).text(originalText);
            }
        });
    }
