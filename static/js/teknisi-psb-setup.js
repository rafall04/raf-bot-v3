        // Get customerId from URL parameter
        const urlParams = new URLSearchParams(window.location.search);
        const urlCustomerId = urlParams.get('customerId');

        $(document).ready(function() {
            loadPackages();
            loadCustomers();
            setupEventHandlers();
            updateFilterDescription(); // Initialize filter description
            
            // If customerId in URL, auto-load
            if (urlCustomerId) {
                $('#customer-select').val(urlCustomerId).trigger('change');
                setTimeout(() => {
                    $('#load-customer-btn').click();
                }, 500);
            }
        });

        // Load packages
        function loadPackages() {
            fetch('/api/packages', { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    // Handle both response formats: { data: packages } or { status: 200, data: packages }
                    const packages = data.data || data;
                    if (Array.isArray(packages) && packages.length > 0) {
                        const select = $('#subscription');
                        select.empty();
                        select.append('<option value="">Pilih Paket...</option>');
                        packages.forEach(pkg => {
                            select.append(`<option value="${pkg.name}">${pkg.name}</option>`);
                        });
                        console.log(`[PSB_SETUP] Loaded ${packages.length} packages`);
                    } else {
                        console.warn('[PSB_SETUP] No packages found or invalid format:', data);
                    }
                })
                .catch(err => {
                    console.error('Error loading packages:', err);
                });
        }

        // Load customers with phase2_completed status
        function loadCustomers() {
            fetch('/api/psb/list-customers?status=phase2_completed', { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200 && data.data) {
                        const customers = data.data;
                        const select = $('#customer-select');
                        select.empty();
                        select.append('<option value="">Pilih Pelanggan...</option>');
                        customers.forEach(customer => {
                            select.append(`<option value="${customer.id}" data-name="${customer.name}" data-phone="${customer.phone_number}">${customer.id} - ${customer.name} (${customer.phone_number})</option>`);
                        });
                        
                        // Initialize Select2
                        select.select2({
                            theme: 'bootstrap',
                            placeholder: 'Pilih Pelanggan...',
                            allowClear: true,
                            width: '100%'
                        });
                    }
                })
                .catch(err => {
                    console.error('Error loading customers:', err);
                });
        }

        // Setup event handlers
        function setupEventHandlers() {
            // Customer select change
            $('#customer-select').on('change', function() {
                const customerId = $(this).val();
                $('#load-customer-btn').prop('disabled', !customerId);
            });

            // Load customer button
            $('#load-customer-btn').on('click', function() {
                const customerId = $('#customer-select').val();
                if (customerId) {
                    loadCustomerData(customerId);
                }
            });

            // Device filter change
            $('input[name="device-filter"]').on('change', function() {
                updateFilterDescription();
                
                // If "By SN" is selected, clear and focus on SN input
                if ($(this).val() === 'by-sn') {
                    const snInput = $('#filter-serial-number');
                    if (!snInput.val().trim()) {
                        snInput.focus();
                        // Don't load devices yet, wait for SN input
                        return;
                    }
                }
                
                loadDevices();
            });

            // Handle Serial Number filter input - manual search only
            $('#filter-serial-number').on('keypress', function(e) {
                // Load devices when Enter is pressed
                if (e.which === 13) {
                    e.preventDefault();
                    loadDevices();
                }
            });
            
            // Handle search button click - manual search only
            $('#search-sn-btn').on('click', function() {
                loadDevices();
            });

            // Handle clear SN filter button
            $('#clear-sn-filter-btn').on('click', function() {
                $('#filter-serial-number').val('');
                // If "By SN" is selected, switch to default filter
                if ($('input[name="device-filter"]:checked').val() === 'by-sn') {
                    $('#filter-default').prop('checked', true).trigger('change');
                } else {
                    loadDevices();
                }
            });

            // Refresh devices button
            $('#refresh-devices-btn').on('click', function() {
                loadDevices();
            });

            // Device selection change
            $('#device_id').on('change', function() {
                const selectedDeviceId = $(this).val();
                if (selectedDeviceId) {
                    showDeviceInfo(selectedDeviceId);
                    // Update device ID for SSID loading
                    $('#device_id_for_ssid').val(selectedDeviceId);
                    $('#load-ssid-btn').prop('disabled', false);
                    // Clear previous SSID checkboxes
                    $('#ssid-checkbox-container').hide();
                    $('#ssid-checkboxes').empty();
                } else {
                    $('#device-info').empty();
                    $('#device_id_for_ssid').val('');
                    $('#load-ssid-btn').prop('disabled', true);
                    $('#ssid-checkbox-container').hide();
                    $('#ssid-checkboxes').empty();
                }
            });

            // Load SSID button
            $('#load-ssid-btn').on('click', function() {
                const deviceId = $('#device_id_for_ssid').val();
                if (!deviceId) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Peringatan',
                        text: 'Pilih Device ID terlebih dahulu'
                    });
                    return;
                }
                loadSSIDInfo(deviceId);
            });

            // Real-time validation untuk PPPoE username
            let usernameValidationTimeout;
            $('#pppoe_username').on('input', function() {
                const username = $(this).val().trim();
                const statusIcon = $('#pppoe_username_status');
                const feedback = $('#pppoe_username_feedback');
                const loadingIcon = $('#pppoe_username_loading');
                
                // Clear previous timeout
                clearTimeout(usernameValidationTimeout);
                
                // Reset status
                statusIcon.removeClass('text-success text-danger text-warning');
                statusIcon.find('i').hide();
                feedback.text('').removeClass('text-success text-danger text-warning');
                
                if (username === '') {
                    return;
                }
                
                // Show loading
                loadingIcon.show();
                
                // Debounce: validate after 500ms of no typing
                usernameValidationTimeout = setTimeout(() => {
                    fetch(`/api/psb/validate-pppoe-username?username=${encodeURIComponent(username)}`, {
                        credentials: 'include'
                    })
                    .then(res => res.json())
                    .then(data => {
                        loadingIcon.hide();
                        
                        if (data.status === 200) {
                            if (data.available) {
                                statusIcon.addClass('text-success');
                                statusIcon.html('<i class="fas fa-check-circle"></i>');
                                feedback.text(data.message || 'Username tersedia').addClass('text-success');
                            } else {
                                statusIcon.addClass('text-danger');
                                statusIcon.html('<i class="fas fa-times-circle"></i>');
                                feedback.text(data.message || 'Username sudah ada').addClass('text-danger');
                            }
                            
                            if (data.warning) {
                                statusIcon.addClass('text-warning');
                                feedback.addClass('text-warning').removeClass('text-success text-danger');
                            }
                        } else {
                            statusIcon.addClass('text-warning');
                            statusIcon.html('<i class="fas fa-exclamation-triangle"></i>');
                            feedback.text(data.message || 'Tidak dapat mengecek username').addClass('text-warning');
                        }
                    })
                    .catch(err => {
                        loadingIcon.hide();
                        console.error('Username validation error:', err);
                        statusIcon.addClass('text-warning');
                        statusIcon.html('<i class="fas fa-exclamation-triangle"></i>');
                        feedback.text('Error saat mengecek username').addClass('text-warning');
                    });
                }, 500);
            });
            
            // Setup form submit
            $('#setup-form').on('submit', function(e) {
                e.preventDefault();
                submitSetup();
            });
        }

        // Load customer data
        function loadCustomerData(customerId) {
            fetch(`/api/psb/list-customers?status=phase2_completed`, { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200 && data.data) {
                        const customer = data.data.find(c => String(c.id) === String(customerId));
                        if (customer) {
                            if (customer.psb_status !== 'phase2_completed') {
                                Swal.fire({
                                    icon: 'error',
                                    title: 'Error',
                                    text: 'Pelanggan belum menyelesaikan instalasi. Status: ' + (customer.psb_status || 'unknown')
                                });
                                return;
                            }

                            $('#customer_id').val(customer.id);
                            $('#customer-info').text(`${customer.name} (${customer.phone_number}) - ID: ${customer.id}`);
                            
                            // Auto-fill WiFi SSID from customer name
                            const wifiSSID = customer.name.replace(/\s+/g, '_').toUpperCase();
                            $('#wifi_ssid').val(wifiSSID);
                            
                            // Load devices
                            loadDevices();
                            
                            // Show setup form
                            $('#setup-form-container').slideDown();
                        } else {
                            Swal.fire({
                                icon: 'error',
                                title: 'Error',
                                text: 'Pelanggan tidak ditemukan'
                            });
                        }
                    }
                })
                .catch(err => {
                    console.error('Error loading customer:', err);
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: 'Error saat memuat data pelanggan'
                    });
                });
        }

        // Update filter description
        function updateFilterDescription() {
            const filterType = $('input[name="device-filter"]:checked').val();
            let description = '';
            
            switch(filterType) {
                case 'default':
                    description = 'Pilih device dengan default username "tes@hw" dari GenieACS';
                    $('#sn-filter-hint').text('Opsional: Filter tambahan berdasarkan Serial Number').removeClass('text-danger');
                    break;
                case 'new':
                    description = 'Pilih device yang baru terdaftar di GenieACS (kurang dari 1 hari yang lalu)';
                    $('#sn-filter-hint').text('Opsional: Filter tambahan berdasarkan Serial Number').removeClass('text-danger');
                    break;
                case 'by-sn':
                    description = 'Pilih device berdasarkan Serial Number (SN wajib diisi)';
                    $('#sn-filter-hint').html('Wajib diisi untuk filter "By SN". Klik tombol <i class="fas fa-search"></i> Cari atau tekan Enter untuk mencari.').addClass('text-danger');
                    break;
            }
            
            $('#filter-description').text(description);
        }

        // Load devices from GenieACS
        function loadDevices() {
            const filterType = $('input[name="device-filter"]:checked').val() || 'default';
            const serialNumber = $('#filter-serial-number').val().trim();
            
            // Validate: "By SN" filter requires Serial Number
            if (filterType === 'by-sn' && !serialNumber) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Serial Number Wajib',
                    text: 'Filter "By SN" memerlukan Serial Number. Silakan masukkan Serial Number terlebih dahulu.',
                    confirmButtonText: 'OK'
                });
                $('#filter-serial-number').focus();
                return;
            }
            
            // Build query parameters
            let queryParams = `filter=${filterType}`;
            if (serialNumber) {
                queryParams += `&serialNumber=${encodeURIComponent(serialNumber)}`;
            }
            
            // For "by-sn" filter, Serial Number is required
            if (filterType === 'by-sn' && serialNumber) {
                queryParams += `&serialNumber=${encodeURIComponent(serialNumber)}`;
            }
            
            let filterDescription = filterType === 'default' ? 'Default' : filterType === 'new' ? 'Baru' : 'By SN';
            if (serialNumber) {
                filterDescription += ` (SN: ${serialNumber})`;
            } else if (filterType === 'by-sn') {
                filterDescription += ' (SN: -)';
            }
            
            Swal.fire({
                title: 'Memuat devices...',
                html: `Filter: <strong>${filterDescription}</strong>`,
                allowOutsideClick: false,
                allowEscapeKey: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });

            fetch(`/api/psb/list-devices?${queryParams}`, {
                method: 'GET',
                credentials: 'include'
            })
            .then(res => res.json())
            .then(data => {
                Swal.close();
                if (data.status === 200 && data.data) {
                    const select = $('#device_id');
                    select.empty();
                    select.append('<option value="">Pilih Device...</option>');
                    
                    data.data.forEach(device => {
                        // device.deviceId is the _id from GenieACS - this will be used for device registration
                        let displayText = `${device.serialNumber} - ${device.model} (${device.manufacturer}) - PPP: ${device.currentPPPUsername || 'Kosong'}`;
                        
                        // Add registered date info for new devices
                        if (filterType === 'new' && device.registeredDate) {
                            const regDate = new Date(device.registeredDate);
                            const hoursAgo = Math.round((Date.now() - regDate.getTime()) / (1000 * 60 * 60));
                            displayText += ` [Baru: ${hoursAgo} jam lalu]`;
                        }
                        
                        // Store deviceId (which is _id from GenieACS) as option value
                        select.append(`<option value="${device.deviceId}" data-device='${JSON.stringify(device)}'>${displayText}</option>`);
                    });
                    
                    // Update device count
                    $('#device-count').text(`(${data.count || data.data.length} device ditemukan)`);
                    
                    // Initialize Select2
                    if (!select.data('select2')) {
                        select.select2({
                            theme: 'bootstrap',
                            placeholder: 'Pilih Device...',
                            allowClear: true,
                            width: '100%'
                        });
                    } else {
                        select.trigger('change');
                    }
                    
                    if (data.count === 0) {
                        let message = '';
                        if (filterType === 'by-sn') {
                            message = `Tidak ada device ditemukan dengan Serial Number "${serialNumber}".`;
                            message += '\n\nPeriksa kembali Serial Number yang Anda masukkan.';
                        } else {
                            message = `Tidak ada device ditemukan dengan filter "${filterType === 'default' ? 'Default' : filterType === 'new' ? 'Baru' : 'By SN'}"`;
                            if (serialNumber) {
                                message += ` dan Serial Number "${serialNumber}"`;
                            }
                            message += '. Coba filter lain.';
                        }
                        
                        Swal.fire({
                            icon: 'info',
                            title: 'Info',
                            text: message
                        });
                    }
                } else {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Peringatan',
                        text: data.message || 'Tidak ada device ditemukan'
                    });
                }
            })
            .catch(err => {
                Swal.close();
                console.error('Load devices error:', err);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Error saat memuat list devices dari GenieACS'
                });
            });
        }

        // Show device info
        function showDeviceInfo(deviceId) {
            const select = $('#device_id');
            const selectedOption = select.find(`option[value="${deviceId}"]`);
            if (selectedOption.length > 0) {
                try {
                    const device = JSON.parse(selectedOption.attr('data-device'));
                    
                    // Device ID is the _id from GenieACS - this is what will be used for registration
                    const deviceIdDisplay = device.deviceId || deviceId;
                    
                    // Serial Number is important - highlight if N/A
                    const serialNumberDisplay = device.serialNumber && device.serialNumber !== 'N/A' 
                        ? `<strong>${device.serialNumber}</strong>` 
                        : `<span class="text-warning"><strong>N/A</strong> (Serial Number tidak ditemukan)</span>`;
                    
                    let infoHtml = `<div class="alert alert-info">
                        <strong>Device Info:</strong><br>
                        <strong>Device ID:</strong> <code>${deviceIdDisplay}</code><br>
                        Serial Number: ${serialNumberDisplay}<br>
                        Model: <strong>${device.model || 'N/A'}</strong><br>
                        Manufacturer: ${device.manufacturer || 'N/A'}<br>
                        Current PPP Username: <strong>${device.currentPPPUsername || 'Kosong'}</strong>
                    </div>`;
                    $('#device-info').html(infoHtml);
                } catch (e) {
                    console.error('Error parsing device data:', e);
                    $('#device-info').html(`<div class="alert alert-warning">Error parsing device data: ${e.message}</div>`);
                }
            }
        }

        // Load SSID info from device
        function loadSSIDInfo(deviceId) {
            const btn = $('#load-ssid-btn');
            const originalText = btn.html();
            btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Memuat...');

            fetch(`/api/customer-wifi-info/${deviceId}?skipRefresh=true`, {
                credentials: 'include'
            })
            .then(res => res.json())
            .then(result => {
                btn.prop('disabled', false).html(originalText);
                
                if (result.status === 200 && result.data && Array.isArray(result.data.ssid)) {
                    const ssidCheckboxes = $('#ssid-checkboxes');
                    ssidCheckboxes.empty();
                    
                    if (result.data.ssid.length === 0) {
                        ssidCheckboxes.html('<small class="text-muted">Tidak ada SSID yang ditemukan untuk Device ID ini.</small>');
                    } else {
                        result.data.ssid.forEach(ssid => {
                            const checkboxHtml = `
                                <div class="form-check">
                                    <input type="checkbox" class="form-check-input ssid-checkbox" id="ssid_${ssid.id}" name="selected_ssid[]" value="${ssid.id}" />
                                    <label class="form-check-label" for="ssid_${ssid.id}">
                                        SSID ${ssid.id} ${ssid.name ? `(${ssid.name})` : ''}
                                    </label>
                                </div>
                            `;
                            ssidCheckboxes.append(checkboxHtml);
                        });
                        $('#ssid-checkbox-container').slideDown();
                    }
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: 'Format data SSID tidak sesuai atau data tidak ditemukan.'
                    });
                }
            })
            .catch(err => {
                btn.prop('disabled', false).html(originalText);
                console.error('Error loading SSID:', err);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Gagal memuat SSID: ' + err.message
                });
            });
        }

        // Test connections sebelum submit
        async function testConnections(deviceId) {
            try {
                const url = deviceId 
                    ? `/api/psb/test-connections?deviceId=${encodeURIComponent(deviceId)}`
                    : '/api/psb/test-connections';
                
                const res = await fetch(url, { credentials: 'include' });
                const data = await res.json();
                
                return data;
            } catch (error) {
                console.error('Connection test error:', error);
                return {
                    status: 500,
                    allOk: false,
                    message: 'Error saat mengetes koneksi',
                    results: {
                        genieacs: { connected: false, message: 'Error: ' + error.message },
                        mikrotik: { connected: false, message: 'Error: ' + error.message },
                        device: { online: false, message: 'Error: ' + error.message }
                    }
                };
            }
        }

        // Show preview modal sebelum submit
        function showPreviewModal(formData, onConfirm) {
            const subscriptionText = $('#subscription option:selected').text();
            const deviceText = $('#device_id option:selected').text();
            const selectedSSIDs = formData.ssid_indices || [];
            
            Swal.fire({
                title: 'Preview Konfigurasi',
                html: `
                    <div class="text-left">
                        <h6 class="mb-3"><i class="fas fa-user"></i> Data Pelanggan</h6>
                        <p><strong>Customer ID:</strong> ${formData.customerId}</p>
                        
                        <hr>
                        <h6 class="mb-3"><i class="fas fa-network-wired"></i> Konfigurasi PPPoE</h6>
                        <p><strong>Username:</strong> ${formData.pppoe_username}</p>
                        <p><strong>Password:</strong> ${formData.pppoe_password ? '***' : '(Default dari config)'}</p>
                        <p><strong>Paket:</strong> ${subscriptionText}</p>
                        
                        <hr>
                        <h6 class="mb-3"><i class="fas fa-router"></i> Konfigurasi Device & WiFi</h6>
                        <p><strong>Device:</strong> ${deviceText}</p>
                        <p><strong>WiFi SSID:</strong> ${formData.wifi_ssid}</p>
                        <p><strong>WiFi Password:</strong> ${formData.wifi_password ? '***' : '(Tidak diisi)'}</p>
                        <p><strong>SSID Indices:</strong> ${selectedSSIDs.length > 0 ? selectedSSIDs.join(', ') : 'Tidak ada'}</p>
                    </div>
                `,
                icon: 'info',
                showCancelButton: true,
                confirmButtonText: 'Ya, Lanjutkan',
                cancelButtonText: 'Batal',
                confirmButtonColor: '#3085d6',
                cancelButtonColor: '#d33',
                reverseButtons: true
            }).then((result) => {
                if (result.isConfirmed) {
                    onConfirm();
                }
            });
        }

        // Submit setup
        function submitSetup() {
            // Get selected SSID indices
            const selectedSSIDs = [];
            $('.ssid-checkbox:checked').each(function() {
                selectedSSIDs.push(parseInt($(this).val()));
            });
            
            if (selectedSSIDs.length === 0) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Peringatan',
                    text: 'Pilih minimal satu SSID yang akan dikonfigurasi'
                });
                return;
            }

            const formData = {
                customerId: $('#customer_id').val(),
                pppoe_username: $('#pppoe_username').val(),
                pppoe_password: $('#pppoe_password').val() || null,
                subscription: $('#subscription').val(),
                device_id: $('#device_id').val(), // This is the _id from GenieACS - used for device registration
                wifi_ssid: $('#wifi_ssid').val(),
                wifi_password: $('#wifi_password').val(),
                ssid_indices: selectedSSIDs // Array of SSID indices to update
            };

            // Validasi required fields
            if (!formData.customerId || !formData.pppoe_username || !formData.subscription || 
                !formData.device_id || !formData.wifi_ssid || !formData.wifi_password) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Peringatan',
                    text: 'Semua field wajib harus diisi'
                });
                return;
            }

            // Cek apakah username sudah divalidasi (optional check)
            const usernameStatus = $('#pppoe_username_status').hasClass('text-danger');
            if (usernameStatus) {
                Swal.fire({
                    icon: 'error',
                    title: 'Username Tidak Valid',
                    text: 'PPPoE username sudah ada di MikroTik. Silakan gunakan username lain.'
                });
                return;
            }

            // Show preview modal
            showPreviewModal(formData, async () => {
                // Test connections sebelum submit
                Swal.fire({
                    title: 'Mengecek koneksi...',
                    html: 'Sedang mengetes koneksi ke GenieACS dan MikroTik...',
                    allowOutsideClick: false,
                    didOpen: () => {
                        Swal.showLoading();
                    }
                });

                const connectionTest = await testConnections(formData.device_id);
                
                if (!connectionTest.allOk) {
                    // Show connection test results
                    const results = connectionTest.results || {};
                    Swal.fire({
                        icon: 'warning',
                        title: 'Peringatan Koneksi',
                        html: `
                            <p>Beberapa koneksi bermasalah:</p>
                            <ul class="text-left">
                                <li><strong>GenieACS:</strong> ${results.genieacs?.message || 'Tidak diketahui'}</li>
                                <li><strong>MikroTik:</strong> ${results.mikrotik?.message || 'Tidak diketahui'}</li>
                                ${formData.device_id ? `<li><strong>Device:</strong> ${results.device?.message || 'Tidak diketahui'}</li>` : ''}
                            </ul>
                            <p class="mt-3">Apakah Anda ingin melanjutkan?</p>
                        `,
                        showCancelButton: true,
                        confirmButtonText: 'Ya, Lanjutkan',
                        cancelButtonText: 'Batal',
                        confirmButtonColor: '#3085d6',
                        cancelButtonColor: '#d33'
                    }).then((result) => {
                        if (result.isConfirmed) {
                            proceedWithSubmit(formData);
                        }
                    });
                } else {
                    // All connections OK, proceed
                    proceedWithSubmit(formData);
                }
            });
        }

        // Proceed with actual submit
        function proceedWithSubmit(formData) {
            Swal.fire({
                title: 'Menyimpan konfigurasi...',
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });

            fetch('/api/psb/submit-phase3', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData),
                credentials: 'include'
            })
            .then(async res => {
                const data = await res.json();
                // Check if response is OK (status 200-299) or error (400-599)
                if (!res.ok || data.status !== 200) {
                    // If it's a duplicate username error, show specific message
                    if (data.errorType === 'duplicate_username' || 
                        (data.message && (data.message.includes('sudah ada') || data.message.includes('already')))) {
                        Swal.fire({
                            icon: 'error',
                            title: 'Username Sudah Ada!',
                            html: `<strong>Error:</strong> ${data.message || 'PPPoE username sudah ada di MikroTik'}<br><br>
                                <strong>PPPoE Username:</strong> ${formData.pppoe_username}<br><br>
                                Silakan gunakan username lain.`,
                            confirmButtonText: 'OK'
                        });
                    } else {
                        // Other errors
                        Swal.fire({
                            icon: 'error',
                            title: 'Error',
                            html: `<strong>Error:</strong> ${data.message || 'Gagal menyelesaikan setup pelanggan'}<br><br>
                                ${data.error ? `<small>Detail: ${data.error}</small>` : ''}`,
                            confirmButtonText: 'OK'
                        });
                    }
                    return;
                }
                
                // Success - Show summary modal dengan credentials
                const pppoePassword = data.data.pppoe_password || formData.pppoe_password || '(Default dari config)';
                const wifiPassword = data.data.wifi_password || formData.wifi_password;
                
                Swal.fire({
                    title: '✅ Setup Berhasil!',
                    html: `
                        <div class="text-left">
                            <h6 class="mb-3"><i class="fas fa-user"></i> Data Pelanggan</h6>
                            <p><strong>Nama:</strong> ${data.data.name || 'N/A'}</p>
                            <p><strong>PSB ID:</strong> ${data.data.psbCustomerId || 'N/A'}</p>
                            <p><strong>User ID (Final):</strong> ${data.data.finalUserId || 'N/A'}</p>
                            
                            <hr>
                            <h6 class="mb-3"><i class="fas fa-network-wired"></i> Credentials PPPoE</h6>
                            <div class="alert alert-info">
                                <p class="mb-1"><strong>Username:</strong> <code id="summary_pppoe_username">${data.data.pppoe_username || 'N/A'}</code></p>
                                <p class="mb-0"><strong>Password:</strong> <code id="summary_pppoe_password">${pppoePassword}</code></p>
                            </div>
                            <button class="btn btn-sm btn-outline-primary mb-2" onclick="copyToClipboard('summary_pppoe_username', 'summary_pppoe_password')">
                                <i class="fas fa-copy"></i> Copy Credentials PPPoE
                            </button>
                            
                            <hr>
                            <h6 class="mb-3"><i class="fas fa-wifi"></i> Credentials WiFi</h6>
                            <div class="alert alert-info">
                                <p class="mb-1"><strong>SSID:</strong> <code id="summary_wifi_ssid">${data.data.wifi_ssid || 'N/A'}</code></p>
                                <p class="mb-0"><strong>Password:</strong> <code id="summary_wifi_password">${wifiPassword || 'N/A'}</code></p>
                            </div>
                            <button class="btn btn-sm btn-outline-primary mb-2" onclick="copyToClipboard('summary_wifi_ssid', 'summary_wifi_password')">
                                <i class="fas fa-copy"></i> Copy Credentials WiFi
                            </button>
                            
                            <hr>
                            <h6 class="mb-3"><i class="fas fa-info-circle"></i> Status</h6>
                            <p><strong>Device ID:</strong> ${data.data.device_id || 'N/A'}</p>
                            <p><strong>MikroTik:</strong> ${data.data.mikrotikRegistered ? '<span class="text-success">✓ Berhasil</span>' : '<span class="text-danger">✗ Gagal</span>'}</p>
                            <p><strong>GenieACS:</strong> ${data.data.genieacsUpdated ? '<span class="text-success">✓ Berhasil</span>' : '<span class="text-warning">⚠ Warning</span>'}</p>
                            
                            <hr>
                            <p class="text-muted"><small>Pelanggan akan menerima notifikasi WhatsApp.</small></p>
                        </div>
                    `,
                    icon: 'success',
                    width: '600px',
                    confirmButtonText: 'Selesai',
                    didOpen: () => {
                        // Add copy function to window
                        window.copyToClipboard = function(usernameId, passwordId) {
                            const username = document.getElementById(usernameId).textContent;
                            const password = document.getElementById(passwordId).textContent;
                            const text = `Username: ${username}\nPassword: ${password}`;
                            
                            navigator.clipboard.writeText(text).then(() => {
                                Swal.fire({
                                    icon: 'success',
                                    title: 'Copied!',
                                    text: 'Credentials berhasil disalin ke clipboard',
                                    timer: 2000,
                                    showConfirmButton: false
                                });
                            }).catch(err => {
                                console.error('Copy failed:', err);
                                Swal.fire({
                                    icon: 'error',
                                    title: 'Error',
                                    text: 'Gagal menyalin ke clipboard'
                                });
                            });
                        };
                    }
                }).then(() => {
                    window.location.href = '/teknisi-psb-installation';
                });
            })
            .catch(err => {
                console.error('Submit setup error:', err);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Error saat menyimpan konfigurasi. Pastikan koneksi ke server berjalan dengan baik.'
                });
            });
        }
