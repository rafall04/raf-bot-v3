        // Global data
        let allPPPoEData = [];
        let filteredData = [];
        let packages = [];
        let genieacsDevices = []; // Store GenieACS devices
        let maxPhoneLimit = 3; // Default, will be loaded from config

        // Load config on page load
        document.addEventListener('DOMContentLoaded', function() {
            loadPhoneLimitConfig();
        });

        // Load max phone limit from config
        async function loadPhoneLimitConfig() {
            try {
                const response = await fetch('/api/stats/config');
                const result = await response.json();
                
                if (result.status === 200 && result.data) {
                    const loadedLimit = parseInt(result.data.accessLimit);
                    if (!isNaN(loadedLimit) && loadedLimit > 0) {
                        maxPhoneLimit = loadedLimit;
                        console.log('[IMPORT] Max phone limit loaded:', maxPhoneLimit);
                        // Update UI displays
                        document.querySelectorAll('.max-phone-display').forEach(el => {
                            el.textContent = maxPhoneLimit;
                        });
                    }
                }
            } catch (error) {
                console.warn('[IMPORT] Failed to load phone limit config, using default:', maxPhoneLimit);
            }
        }

        // Scan MikroTik
        async function scanMikrotik() {
            showProgress('Mengambil Data...', 'Menghubungi MikroTik, mohon tunggu...');
            
            try {
                const response = await fetch('/api/mikrotik/unregistered-pppoe');
                const result = await response.json();
                
                hideProgress();
                
                if (result.status !== 200) {
                    Swal.fire('Error', result.message || 'Gagal mengambil data', 'error');
                    return;
                }
                
                allPPPoEData = result.data || [];
                packages = result.packages || [];
                
                // Update stats
                document.getElementById('statTotal').textContent = result.stats?.total || 0;
                document.getElementById('statRegistered').textContent = result.stats?.registered || 0;
                document.getElementById('statUnregistered').textContent = result.stats?.unregistered || 0;
                document.getElementById('statSelected').textContent = '0';
                
                // Populate profile filter
                const profiles = result.profiles || [];
                const filterProfile = document.getElementById('filterProfile');
                filterProfile.innerHTML = '<option value="">Semua Profile</option>';
                profiles.forEach(profile => {
                    filterProfile.add(new Option(profile, profile));
                });
                
                // Show sections
                document.getElementById('statsSection').style.display = 'flex';
                document.getElementById('emptyState').style.display = 'none';
                document.getElementById('mainContent').style.display = 'block';
                
                // Render table
                filteredData = [...allPPPoEData];
                renderTable();
                
                if (allPPPoEData.length === 0) {
                    Swal.fire('Info', 'Semua PPPoE sudah terdaftar di sistem', 'info');
                } else {
                    // Enable auto-sync button
                    document.getElementById('btnAutoSync').disabled = false;
                }
                
            } catch (error) {
                hideProgress();
                Swal.fire('Error', 'Gagal menghubungi server: ' + error.message, 'error');
            }
        }

        // Render table
        function renderTable() {
            const tbody = document.getElementById('tableBody');
            
            if (filteredData.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="11" class="empty-state">
                            <i class="fas fa-search"></i>
                            <p>Tidak ada data yang sesuai filter</p>
                        </td>
                    </tr>
                `;
                return;
            }
            
            // Get default SSID settings
            const defaultSSID = getDefaultSSIDArray();
            
            tbody.innerHTML = filteredData.map((item, index) => {
                const isDisabled = item.disabled;
                const rowClass = isDisabled ? 'disabled-row' : '';
                const statusBadge = isDisabled 
                    ? '<span class="badge badge-disabled">Disabled</span>'
                    : '<span class="badge badge-active">Aktif</span>';
                
                // Find matching package
                const matchedPkg = packages.find(p => p.profile && p.profile.toLowerCase() === (item.profile || '').toLowerCase());
                const subscription = matchedPkg ? matchedPkg.name : '';
                
                // Warning jika profile tidak cocok
                const profileWarning = !matchedPkg && item.profile 
                    ? `<br><small class="text-warning"><i class="fas fa-exclamation-triangle"></i> Profile "${escapeHtml(item.profile)}" tidak ada di paket</small>` 
                    : '';
                
                // Generate SSID checkboxes for this row
                const ssidCheckboxes = generateRowSSIDCheckboxes(index, defaultSSID);
                
                return `
                    <tr class="${rowClass}" data-index="${index}">
                        <td>
                            <input type="checkbox" class="row-check" data-index="${index}" onchange="updateSelection()">
                        </td>
                        <td>
                            <strong>${escapeHtml(item.name)}</strong>
                            ${item.comment ? `<br><small class="text-muted">${escapeHtml(item.comment)}</small>` : ''}
                        </td>
                        <td>
                            <span class="password-text" id="pwd-${index}">••••••</span>
                            <i class="fas fa-eye password-toggle ml-2" onclick="togglePassword(${index}, '${escapeHtml(item.password)}')"></i>
                        </td>
                        <td>
                            <span class="badge badge-profile bg-primary text-white">${escapeHtml(item.profile || '-')}</span>
                            ${profileWarning}
                        </td>
                        <td>${statusBadge}</td>
                        <td>
                            <input type="text" class="form-control input-name" data-index="${index}" 
                                placeholder="Nama pelanggan" value="${escapeHtml(item.comment || '')}"
                                oninput="validateRow(${index})">
                        </td>
                        <td>
                            <div class="phone-container" data-index="${index}">
                                <div class="phone-fields" id="phone-fields-${index}">
                                    <div class="d-flex phone-field-item mb-1" data-phone-index="0">
                                        <input type="text" class="form-control form-control-sm input-phone" 
                                            placeholder="08xxxxxxxxxx" oninput="validateRow(${index})">
                                        <button type="button" class="btn btn-danger btn-sm ml-1 btn-remove-phone" 
                                            onclick="removePhoneField(${index}, 0)" disabled title="Hapus">
                                            <i class="fas fa-times"></i>
                                        </button>
                                    </div>
                                </div>
                                <button type="button" class="btn btn-outline-primary btn-sm btn-add-phone mt-1" 
                                    onclick="addPhoneField(${index})" title="Tambah No HP">
                                    <i class="fas fa-plus"></i> <small>Maks <span class="max-phone-display">${maxPhoneLimit}</span></small>
                                </button>
                            </div>
                        </td>
                        <td>
                            <select class="form-control device-select select-device" data-index="${index}" onchange="validateRow(${index})">
                                <option value="">-- Pilih Device --</option>
                            </select>
                            <input type="text" class="form-control input-device-manual mt-1" data-index="${index}" 
                                placeholder="Atau ketik manual..." oninput="onManualDeviceInput(${index})" style="display:none;">
                            <small class="text-muted device-toggle" style="cursor:pointer;" onclick="toggleDeviceInput(${index})">
                                <i class="fas fa-keyboard"></i> Input manual
                            </small>
                        </td>
                        <td>
                            <div class="ssid-row-selector" data-index="${index}">
                                ${ssidCheckboxes}
                                <div class="ssid-row-buttons">
                                    <button type="button" class="btn btn-outline-primary" onclick="setRowSSID(${index}, 'dual')" title="Dual Band">D</button>
                                    <button type="button" class="btn btn-outline-secondary" onclick="setRowSSID(${index}, 'single')" title="Single Band">S</button>
                                </div>
                            </div>
                        </td>
                        <td>
                            <input type="text" class="form-control input-address" data-index="${index}" 
                                placeholder="Alamat (opsional)">
                        </td>
                        <td class="text-center">
                            <i class="fas fa-times-circle validation-icon invalid" id="valid-${index}"></i>
                        </td>
                    </tr>
                `;
            }).join('');
            
            updateCounters();
        }

        // Generate SSID checkboxes for a row
        function generateRowSSIDCheckboxes(rowIndex, defaultSSID) {
            let html = '<div class="d-flex flex-wrap">';
            for (let i = 1; i <= 8; i++) {
                const checked = defaultSSID.includes(String(i)) ? 'checked' : '';
                html += `
                    <span class="ssid-mini-checkbox" title="SSID ${i}">
                        <input type="checkbox" id="row-ssid-${rowIndex}-${i}" ${checked}>
                        <label for="row-ssid-${rowIndex}-${i}">${i}</label>
                    </span>
                `;
            }
            html += '</div>';
            return html;
        }

        // Get default SSID array from global settings
        function getDefaultSSIDArray() {
            const ssids = [];
            for (let i = 1; i <= 8; i++) {
                if (document.getElementById(`ssid${i}`).checked) {
                    ssids.push(String(i));
                }
            }
            return ssids;
        }

        // Get SSID array for a specific row
        function getRowSSIDArray(rowIndex) {
            const ssids = [];
            for (let i = 1; i <= 8; i++) {
                const checkbox = document.getElementById(`row-ssid-${rowIndex}-${i}`);
                if (checkbox && checkbox.checked) {
                    ssids.push(String(i));
                }
            }
            return ssids;
        }

        // Set SSID for a specific row
        function setRowSSID(rowIndex, preset) {
            // Reset all for this row
            for (let i = 1; i <= 8; i++) {
                const checkbox = document.getElementById(`row-ssid-${rowIndex}-${i}`);
                if (checkbox) checkbox.checked = false;
            }
            
            switch (preset) {
                case 'dual':
                    document.getElementById(`row-ssid-${rowIndex}-1`).checked = true;
                    document.getElementById(`row-ssid-${rowIndex}-5`).checked = true;
                    break;
                case 'single':
                    document.getElementById(`row-ssid-${rowIndex}-1`).checked = true;
                    break;
            }
        }

        // Apply SSID settings to all rows
        function applySSIDToAll() {
            const defaultSSID = getDefaultSSIDArray();
            
            filteredData.forEach((item, index) => {
                for (let i = 1; i <= 8; i++) {
                    const checkbox = document.getElementById(`row-ssid-${index}-${i}`);
                    if (checkbox) {
                        checkbox.checked = defaultSSID.includes(String(i));
                    }
                }
            });
            
            showToast(`SSID diterapkan ke ${filteredData.length} baris`, 'success');
        }

        // Apply SSID settings to selected rows only
        function applySSIDToSelected() {
            const defaultSSID = getDefaultSSIDArray();
            let count = 0;
            
            document.querySelectorAll('.row-check:checked').forEach(cb => {
                const index = parseInt(cb.dataset.index);
                for (let i = 1; i <= 8; i++) {
                    const checkbox = document.getElementById(`row-ssid-${index}-${i}`);
                    if (checkbox) {
                        checkbox.checked = defaultSSID.includes(String(i));
                    }
                }
                count++;
            });
            
            if (count > 0) {
                showToast(`SSID diterapkan ke ${count} baris terpilih`, 'success');
            } else {
                showToast('Tidak ada baris yang dipilih', 'warning');
            }
        }

        // Toggle password visibility
        function togglePassword(index, password) {
            const pwdSpan = document.getElementById(`pwd-${index}`);
            if (pwdSpan.textContent === '••••••') {
                pwdSpan.textContent = password;
            } else {
                pwdSpan.textContent = '••••••';
            }
        }

        // Validate row
        function validateRow(index) {
            const nameInput = document.querySelector(`.input-name[data-index="${index}"]`);
            const phoneContainer = document.querySelector(`#phone-fields-${index}`);
            const deviceSelect = document.querySelector(`.select-device[data-index="${index}"]`);
            const deviceManual = document.querySelector(`.input-device-manual[data-index="${index}"]`);
            const validIcon = document.getElementById(`valid-${index}`);
            
            const name = nameInput.value.trim();
            
            // Get all phone numbers from container
            const phoneInputs = phoneContainer ? phoneContainer.querySelectorAll('.input-phone') : [];
            const phones = Array.from(phoneInputs).map(input => input.value.trim()).filter(p => p);
            
            // Get device ID from dropdown or manual input
            let deviceId = '';
            if (deviceSelect && deviceSelect.value) {
                deviceId = deviceSelect.value;
            } else if (deviceManual && deviceManual.value.trim()) {
                deviceId = deviceManual.value.trim();
            }
            
            // Validate name (min 3 chars) - WAJIB
            const nameValid = name.length >= 3;
            
            // Validate device_id - WAJIB
            const deviceValid = deviceId.length >= 1;
            
            // Validate phones (Indonesian format) - OPSIONAL, tapi jika diisi harus valid
            let phoneValid = true;
            phoneInputs.forEach(input => {
                const phone = input.value.trim();
                if (phone !== '') {
                    const isValidFormat = /^(08|628|\+628)[0-9]{8,12}$/.test(phone.replace(/[\s-]/g, ''));
                    if (!isValidFormat) {
                        phoneValid = false;
                        input.style.borderColor = '#f59e0b';
                    } else {
                        input.style.borderColor = '';
                    }
                } else {
                    input.style.borderColor = '';
                }
            });
            
            // Update validation icon - nama dan device_id wajib
            if (nameValid && deviceValid && phoneValid) {
                validIcon.className = 'fas fa-check-circle validation-icon valid';
            } else {
                validIcon.className = 'fas fa-times-circle validation-icon invalid';
            }
            
            // Update input styles
            nameInput.style.borderColor = nameValid ? '' : '#ef4444';
            if (deviceSelect) deviceSelect.style.borderColor = deviceValid ? '' : '#ef4444';
            if (deviceManual) deviceManual.style.borderColor = deviceValid ? '' : '#ef4444';
            
            updateCounters();
        }

        // Add phone field
        function addPhoneField(rowIndex) {
            const container = document.getElementById(`phone-fields-${rowIndex}`);
            if (!container) return;
            
            const currentFields = container.querySelectorAll('.phone-field-item').length;
            
            if (currentFields >= maxPhoneLimit) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Maksimal Nomor HP',
                    text: `Maksimal ${maxPhoneLimit} nomor HP sesuai konfigurasi.`
                });
                return;
            }
            
            const newIndex = currentFields;
            const newField = document.createElement('div');
            newField.className = 'd-flex phone-field-item mb-1';
            newField.setAttribute('data-phone-index', newIndex);
            newField.innerHTML = `
                <input type="text" class="form-control form-control-sm input-phone" 
                    placeholder="08xxxxxxxxxx" oninput="validateRow(${rowIndex})">
                <button type="button" class="btn btn-danger btn-sm ml-1 btn-remove-phone" 
                    onclick="removePhoneField(${rowIndex}, ${newIndex})" title="Hapus">
                    <i class="fas fa-times"></i>
                </button>
            `;
            container.appendChild(newField);
            
            // Update remove buttons state
            updatePhoneFieldButtons(rowIndex);
            
            // Focus new input
            newField.querySelector('.input-phone').focus();
        }

        // Remove phone field
        function removePhoneField(rowIndex, phoneIndex) {
            const container = document.getElementById(`phone-fields-${rowIndex}`);
            if (!container) return;
            
            const fields = container.querySelectorAll('.phone-field-item');
            if (fields.length <= 1) return; // Keep at least one field
            
            const fieldToRemove = container.querySelector(`.phone-field-item[data-phone-index="${phoneIndex}"]`);
            if (fieldToRemove) {
                fieldToRemove.remove();
            }
            
            // Re-index remaining fields
            container.querySelectorAll('.phone-field-item').forEach((field, idx) => {
                field.setAttribute('data-phone-index', idx);
                const removeBtn = field.querySelector('.btn-remove-phone');
                if (removeBtn) {
                    removeBtn.setAttribute('onclick', `removePhoneField(${rowIndex}, ${idx})`);
                }
            });
            
            updatePhoneFieldButtons(rowIndex);
            validateRow(rowIndex);
        }

        // Update phone field buttons state
        function updatePhoneFieldButtons(rowIndex) {
            const container = document.getElementById(`phone-fields-${rowIndex}`);
            if (!container) return;
            
            const fields = container.querySelectorAll('.phone-field-item');
            const addBtn = container.closest('.phone-container').querySelector('.btn-add-phone');
            
            // Disable/enable remove buttons
            fields.forEach(field => {
                const removeBtn = field.querySelector('.btn-remove-phone');
                if (removeBtn) {
                    removeBtn.disabled = fields.length <= 1;
                }
            });
            
            // Disable/enable add button
            if (addBtn) {
                addBtn.disabled = fields.length >= maxPhoneLimit;
            }
        }

        // Toggle between dropdown and manual input for device
        function toggleDeviceInput(index) {
            const deviceSelect = document.querySelector(`.select-device[data-index="${index}"]`);
            const deviceManual = document.querySelector(`.input-device-manual[data-index="${index}"]`);
            const toggleText = document.querySelectorAll(`.device-toggle`)[index];
            
            if (deviceManual.style.display === 'none') {
                deviceManual.style.display = 'block';
                deviceSelect.style.display = 'none';
                toggleText.innerHTML = '<i class="fas fa-list"></i> Pilih dari list';
            } else {
                deviceManual.style.display = 'none';
                deviceSelect.style.display = 'block';
                toggleText.innerHTML = '<i class="fas fa-keyboard"></i> Input manual';
            }
            validateRow(index);
        }

        // Handle manual device input
        function onManualDeviceInput(index) {
            const deviceSelect = document.querySelector(`.select-device[data-index="${index}"]`);
            if (deviceSelect) deviceSelect.value = ''; // Clear dropdown when typing manual
            validateRow(index);
        }

        // Update selection
        function updateSelection() {
            const checked = document.querySelectorAll('.row-check:checked').length;
            document.getElementById('statSelected').textContent = checked;
            
            // Update row highlighting
            document.querySelectorAll('.row-check').forEach(cb => {
                const row = cb.closest('tr');
                if (cb.checked) {
                    row.classList.add('selected');
                } else {
                    row.classList.remove('selected');
                }
            });
            
            updateCounters();
        }

        // Update counters
        function updateCounters() {
            let ready = 0;
            let incomplete = 0;
            
            document.querySelectorAll('.row-check:checked').forEach(cb => {
                const index = cb.dataset.index;
                const validIcon = document.getElementById(`valid-${index}`);
                if (validIcon.classList.contains('valid')) {
                    ready++;
                } else {
                    incomplete++;
                }
            });
            
            document.getElementById('countReady').textContent = ready;
            document.getElementById('countIncomplete').textContent = incomplete;
            document.getElementById('importCount').textContent = ready;
            document.getElementById('btnImport').disabled = ready === 0;
        }

        // Toggle check all
        function toggleCheckAll() {
            const checkAll = document.getElementById('checkAll').checked;
            document.querySelectorAll('.row-check').forEach(cb => {
                cb.checked = checkAll;
            });
            updateSelection();
        }

        // Select all visible
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

        // Apply filters
        function applyFilters() {
            const profile = document.getElementById('filterProfile').value.toLowerCase();
            const status = document.getElementById('filterStatus').value;
            const search = document.getElementById('searchUsername').value.toLowerCase();
            
            filteredData = allPPPoEData.filter(item => {
                // Profile filter
                if (profile && (item.profile || '').toLowerCase() !== profile) return false;
                
                // Status filter
                if (status === 'active' && item.disabled) return false;
                if (status === 'disabled' && !item.disabled) return false;
                
                // Search filter
                if (search && !(item.name || '').toLowerCase().includes(search)) return false;
                
                return true;
            });
            
            renderTable();
        }

        // Get default settings (without bulk - bulk is now per row)
        function getDefaultSettings() {
            return {
                paid: document.querySelector('input[name="paidStatus"]:checked').value === 'true',
                send_invoice: document.getElementById('sendInvoice').checked,
                send_psb_welcome: document.getElementById('sendPsbWelcome').checked
            };
        }

        // Import users
        async function importUsers() {
            // Collect selected and valid users
            const usersToImport = [];
            
            document.querySelectorAll('.row-check:checked').forEach(cb => {
                const index = parseInt(cb.dataset.index);
                const validIcon = document.getElementById(`valid-${index}`);
                
                if (validIcon.classList.contains('valid')) {
                    const item = filteredData[index];
                    const nameInput = document.querySelector(`.input-name[data-index="${index}"]`);
                    const phoneContainer = document.getElementById(`phone-fields-${index}`);
                    const deviceSelect = document.querySelector(`.select-device[data-index="${index}"]`);
                    const deviceManual = document.querySelector(`.input-device-manual[data-index="${index}"]`);
                    const addressInput = document.querySelector(`.input-address[data-index="${index}"]`);
                    
                    // Get all phone numbers and join with |
                    const phoneInputs = phoneContainer ? phoneContainer.querySelectorAll('.input-phone') : [];
                    const phones = Array.from(phoneInputs)
                        .map(input => input.value.trim())
                        .filter(p => p);
                    const phoneNumber = phones.join('|');
                    
                    // Get device ID from dropdown or manual input
                    let deviceId = '';
                    if (deviceSelect && deviceSelect.value) {
                        deviceId = deviceSelect.value;
                    } else if (deviceManual && deviceManual.value.trim()) {
                        deviceId = deviceManual.value.trim();
                    }
                    
                    // Get SSID/bulk for this specific row
                    const rowBulk = getRowSSIDArray(index);
                    
                    // Find matching package by profile (case-insensitive)
                    const matchedPkg = packages.find(p => p.profile && p.profile.toLowerCase() === (item.profile || '').toLowerCase());
                    
                    // PENTING: Jika tidak ada paket yang cocok, tampilkan warning dan gunakan paket pertama sebagai fallback
                    let subscriptionName = '';
                    if (matchedPkg) {
                        subscriptionName = matchedPkg.name;
                    } else {
                        // Fallback: gunakan paket pertama jika ada, atau kosongkan
                        console.warn(`[IMPORT] Profile "${item.profile}" tidak ditemukan di packages. PPPoE: ${item.name}`);
                        subscriptionName = packages.length > 0 ? packages[0].name : '';
                    }
                    
                    usersToImport.push({
                        pppoe_username: item.name,
                        pppoe_password: item.password,
                        profile: item.profile,
                        subscription: subscriptionName, // Selalu gunakan nama paket, bukan profile MikroTik
                        name: nameInput.value.trim(),
                        phone_number: phoneNumber,
                        device_id: deviceId,
                        address: addressInput.value.trim(),
                        bulk: rowBulk // SSID per row
                    });
                }
            });
            
            if (usersToImport.length === 0) {
                Swal.fire('Peringatan', 'Tidak ada data yang siap di-import. Pastikan nama dan device ID sudah diisi dengan benar.', 'warning');
                return;
            }
            
            // Cek apakah ada user dengan subscription kosong (profile tidak cocok)
            const usersWithoutPackage = usersToImport.filter(u => !u.subscription || u.subscription === '');
            let warningHtml = '';
            if (usersWithoutPackage.length > 0) {
                warningHtml = `<br><br><small class="text-warning"><i class="fas fa-exclamation-triangle"></i> <strong>${usersWithoutPackage.length}</strong> pelanggan memiliki profile yang tidak cocok dengan paket di sistem. Paket akan dikosongkan.</small>`;
            }
            
            // Confirm
            const confirm = await Swal.fire({
                title: 'Konfirmasi Import',
                html: `Anda akan mengimport <strong>${usersToImport.length}</strong> pelanggan.${warningHtml}<br><br>Lanjutkan?`,
                icon: usersWithoutPackage.length > 0 ? 'warning' : 'question',
                showCancelButton: true,
                confirmButtonText: 'Ya, Import',
                cancelButtonText: 'Batal'
            });
            
            if (!confirm.isConfirmed) return;
            
            showProgress('Mengimport Data...', `Memproses ${usersToImport.length} pelanggan...`);
            
            try {
                const response = await fetch('/api/users/bulk-import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        users: usersToImport,
                        defaultSettings: getDefaultSettings()
                    })
                });
                
                const result = await response.json();
                hideProgress();
                
                if (result.status === 200) {
                    const successCount = result.results?.success?.length || 0;
                    const failedCount = result.results?.failed?.length || 0;
                    
                    let message = `<strong>${successCount}</strong> pelanggan berhasil diimport.`;
                    if (failedCount > 0) {
                        message += `<br><strong>${failedCount}</strong> gagal.`;
                        
                        // Show failed details
                        const failedList = result.results.failed.map(f => 
                            `<li>${f.pppoe_username}: ${f.reason}</li>`
                        ).join('');
                        message += `<br><br><small>Detail gagal:<ul class="text-left">${failedList}</ul></small>`;
                    }
                    
                    // Tampilkan info WhatsApp jika send_psb_welcome dicentang
                    if (result.whatsappStatus) {
                        const waStatus = result.whatsappStatus;
                        if (waStatus.sendPsbWelcomeEnabled) {
                            if (waStatus.connected) {
                                message += `<br><br><small class="text-success"><i class="fas fa-check-circle"></i> Notifikasi WhatsApp terkirim</small>`;
                            } else {
                                message += `<br><br><small class="text-warning"><i class="fas fa-exclamation-triangle"></i> WhatsApp tidak terkoneksi (${waStatus.state}), notifikasi tidak terkirim</small>`;
                            }
                        }
                    }
                    
                    await Swal.fire({
                        title: 'Import Selesai',
                        html: message,
                        icon: failedCount > 0 ? 'warning' : 'success'
                    });
                    
                    // Refresh data
                    scanMikrotik();
                } else {
                    Swal.fire('Error', result.message || 'Gagal mengimport data', 'error');
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

        // Delegasi ke helper bersama (static/js/html-escape.js, dimuat lewat _head.php).


        // Implementasi lama memakai `div.textContent -> div.innerHTML`, yang HANYA meloloskan


        // & < > — TIDAK " maupun '. Dipakai untuk atribut atau argumen handler inline, nama


        // ber-apostrof (Ma'ruf, Nur'aini) memutus string dan tombolnya diam total.


        function escapeHtml(text) {


            return typeof rafEscapeHtml === 'function'


                ? rafEscapeHtml(text)


                : String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {


                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];


                });


        }

        // Auto-sync devices from GenieACS
        async function autoSyncDevices() {
            showProgress('Sinkronisasi Device...', 'Mengambil data dari GenieACS...');
            
            try {
                // Fetch all devices from GenieACS
                const response = await fetch('/api/genieacs/devices-for-import');
                const result = await response.json();
                
                if (result.status !== 200) {
                    hideProgress();
                    Swal.fire('Error', result.message || 'Gagal mengambil data GenieACS', 'error');
                    return;
                }
                
                genieacsDevices = result.data || [];
                
                // Match devices with PPPoE usernames
                let matched = 0;
                let manual = 0;
                
                filteredData.forEach((item, index) => {
                    const pppoeUsername = item.name; // PPPoE username from MikroTik
                    const deviceSelect = document.querySelector(`.select-device[data-index="${index}"]`);
                    
                    if (!deviceSelect) return;
                    
                    // Populate dropdown with all devices first
                    populateDeviceDropdown(deviceSelect, genieacsDevices, index);
                    
                    // Try to find matching device by PPPoE username
                    const matchedDevice = genieacsDevices.find(d => 
                        d.pppUsername && d.pppUsername.toLowerCase() === pppoeUsername.toLowerCase()
                    );
                    
                    if (matchedDevice) {
                        // Set value using Select2 API to properly trigger change
                        $(deviceSelect).val(matchedDevice.deviceId).trigger('change');
                        deviceSelect.closest('tr').classList.remove('device-manual');
                        deviceSelect.closest('tr').classList.add('device-matched');
                        matched++;
                    } else {
                        // No match found
                        deviceSelect.closest('tr').classList.remove('device-matched');
                        deviceSelect.closest('tr').classList.add('device-manual');
                        manual++;
                    }
                    
                    validateRow(index);
                });
                
                // Update sync stats
                document.getElementById('syncStats').style.display = 'block';
                document.getElementById('syncMatched').textContent = matched;
                document.getElementById('syncManual').textContent = manual;
                document.getElementById('syncNotFound').textContent = '0';
                
                hideProgress();
                
                Swal.fire({
                    title: 'Sinkronisasi Selesai',
                    html: `<strong>${matched}</strong> device berhasil dicocokkan otomatis.<br>
                           <strong>${manual}</strong> perlu dipilih manual.`,
                    icon: matched > 0 ? 'success' : 'info'
                });
                
            } catch (error) {
                hideProgress();
                Swal.fire('Error', 'Gagal menghubungi GenieACS: ' + error.message, 'error');
            }
        }

        // Populate device dropdown with GenieACS devices
        function populateDeviceDropdown(selectElement, devices, rowIndex) {
            // Destroy existing Select2 if any
            if ($(selectElement).hasClass('select2-hidden-accessible')) {
                $(selectElement).select2('destroy');
            }
            
            // Clear existing options except first
            selectElement.innerHTML = '<option value="">-- Pilih Device --</option>';
            
            devices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                // Display: PPPoE Username - Serial Number (Model)
                const displayPPP = device.pppUsername || 'Belum ada PPP';
                const displaySN = device.serialNumber || device.deviceId;
                option.textContent = `${displayPPP} - ${displaySN}`;
                option.setAttribute('data-device', JSON.stringify(device));
                option.setAttribute('data-ppp', device.pppUsername || '');
                option.setAttribute('data-sn', device.serialNumber || '');
                selectElement.appendChild(option);
            });
            
            // Initialize Select2 for better search - search by PPPoE username
            $(selectElement).select2({
                theme: 'bootstrap',
                placeholder: '-- Pilih Device --',
                allowClear: true,
                width: '100%',
                matcher: function(params, data) {
                    // Custom matcher to search by PPPoE username primarily
                    if ($.trim(params.term) === '') {
                        return data;
                    }
                    
                    const term = params.term.toLowerCase();
                    const ppp = ($(data.element).data('ppp') || '').toLowerCase();
                    const sn = ($(data.element).data('sn') || '').toLowerCase();
                    const text = (data.text || '').toLowerCase();
                    
                    // Search in PPPoE username first, then serial number, then full text
                    if (ppp.indexOf(term) > -1 || sn.indexOf(term) > -1 || text.indexOf(term) > -1) {
                        return data;
                    }
                    
                    return null;
                },
                templateResult: formatDeviceOption,
                templateSelection: formatDeviceSelection
            }).on('change', function() {
                const index = $(this).data('index');
                validateRow(index);
            });
        }

        // Format device option in dropdown
        function formatDeviceOption(device) {
            if (!device.id) return device.text;
            
            const deviceData = $(device.element).data('device');
            if (!deviceData) return device.text;
            
            const pppDisplay = deviceData.pppUsername 
                ? `<strong class="text-success">${deviceData.pppUsername}</strong>` 
                : '<span class="text-muted">Belum ada PPP</span>';
            
            return $(`
                <div>
                    <div>${pppDisplay}</div>
                    <small class="text-muted">
                        SN: ${deviceData.serialNumber || '-'} | 
                        Model: ${deviceData.model || '-'}
                    </small>
                </div>
            `);
        }

        // Format selected device
        function formatDeviceSelection(device) {
            if (!device.id) return device.text;
            
            const deviceData = $(device.element).data('device');
            if (!deviceData) return device.text;
            
            // Show PPPoE username if available, otherwise serial number
            if (deviceData.pppUsername) {
                return deviceData.pppUsername + ' (' + (deviceData.serialNumber || 'N/A') + ')';
            }
            return deviceData.serialNumber || deviceData.deviceId;
        }

        // SSID Preset Selection
        function selectSSIDPreset(preset) {
            // Reset all checkboxes first
            for (let i = 1; i <= 8; i++) {
                document.getElementById(`ssid${i}`).checked = false;
            }
            
            switch (preset) {
                case 'dual':
                    // Dual band: SSID 1 (2.4GHz) + SSID 5 (5GHz)
                    document.getElementById('ssid1').checked = true;
                    document.getElementById('ssid5').checked = true;
                    showToast('Dual Band dipilih: SSID 1 (2.4GHz) + SSID 5 (5GHz)', 'info');
                    break;
                case 'single':
                    // Single band: SSID 1 only (2.4GHz)
                    document.getElementById('ssid1').checked = true;
                    showToast('Single Band dipilih: SSID 1 (2.4GHz)', 'info');
                    break;
                case 'all':
                    // Select all SSIDs
                    for (let i = 1; i <= 8; i++) {
                        document.getElementById(`ssid${i}`).checked = true;
                    }
                    showToast('Semua SSID dipilih', 'info');
                    break;
                case 'none':
                    // Already reset above
                    showToast('Semua SSID direset', 'warning');
                    break;
            }
        }

        // Simple toast notification
        function showToast(message, type = 'info') {
            const Toast = Swal.mixin({
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 2000,
                timerProgressBar: true
            });
            Toast.fire({
                icon: type,
                title: message
            });
        }
