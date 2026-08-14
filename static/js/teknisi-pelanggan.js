        // PASTIKAN HALAMAN INI DIAKSES MELALUI HTTPS JIKA BUKAN DARI LOCALHOST
        // Geolocation API membutuhkan konteks aman (HTTPS) untuk berfungsi dengan baik di banyak browser.
        if (window.location.protocol !== "https:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
            console.warn("PERINGATAN: Halaman ini diakses melalui HTTP. Fitur geolokasi mungkin tidak berfungsi atau tidak meminta izin. Silakan gunakan HTTPS.");
        }

        let createUserMapInstance = null;
        let editUserMapInstance = null;
        let createUserMarker = null;
        let editUserMarker = null;
        let currentUsername = "Admin";
        let allOdcList = [];
        let allOdpList = [];
        let dataTableInstance = null;
        let activePppoeUsersMap = new Map(); // Stores PPPoE username -> IP address
        let initialPppoeLoadFailed = false;
        let pppoeDataLoading = false;
        let lastPppoeFetch = 0;
        const MIN_FETCH_INTERVAL = 5000; // 5 seconds minimum between fetches

        // Cache untuk metrik utama perangkat (Redaman, Suhu, Tipe Router)
        // Key: deviceId, Value: { redaman: '...', temperature: '...', modemType: '...', _loading: false }
        const deviceDataCache = new Map();

        // Cache untuk data OLT HIOSO (Redaman OLT, Status OLT, Dying Gasp, LOS)
        // Key: MAC prefix (10 digit pertama), Value: { rx_power, olt_status, is_dying_gasp, is_los }
        const oltDataCache = new Map();
        let oltEnabled = false;
        let oltDataLoading = false;

        // Map untuk menyimpan MAC address dari PPPoE active session
        // Key: pppoe_username, Value: caller_id (MAC address)
        const pppoeUserMacMap = new Map();

        const LOADING_HTML = '<div class="spinner-border spinner-border-sm text-primary" role="status" style="width: 1rem; height: 1rem;"><span class="sr-only">Loading...</span></div>';
        const NOT_APPLICABLE = 'N/A';
        const ERROR_FETCHING = '<span class="text-danger" title="Gagal memuat data">Error</span>';
        const DEVICE_NOT_FOUND = '<span class="text-muted" title="Tidak ada Device ID">N/A</span>';


        let pppoeLoadingInProgress = false;
        let queuedPppoeRefresh = null;
        let lastPppoeUpdatedAt = null;

        function formatPppoeUpdatedAt(value) {
            if (!value) return '';
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return '';
            return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }

        function renderPppoeStatus(iconClass, label, stale = false) {
            const updatedLabel = formatPppoeUpdatedAt(lastPppoeUpdatedAt);
            const suffix = updatedLabel ? ` <small class="text-${stale ? 'warning' : 'light'}">(${updatedLabel})</small>` : '';
            $('#pppoeStatusText').html(`<i class="${iconClass}"></i> ${label}${suffix}`);
        }
        
        async function fetchActivePppoeUsers(showLoading = true) {
            // Prevent too frequent calls
            const now = Date.now();
            if (now - lastPppoeFetch < MIN_FETCH_INTERVAL) {
                const waitMs = MIN_FETCH_INTERVAL - (now - lastPppoeFetch);
                if (!queuedPppoeRefresh) {
                    queuedPppoeRefresh = setTimeout(() => {
                        queuedPppoeRefresh = null;
                        fetchActivePppoeUsers(showLoading);
                    }, waitMs);
                }
                if (activePppoeUsersMap.size > 0) {
                    renderPppoeStatus('fas fa-clock', `${activePppoeUsersMap.size} Online (cached)`, true);
                }
                return;
            }
            
            if (pppoeLoadingInProgress) {
                console.log("[fetchActivePppoeUsers] Already loading PPPoE data, skipping...");
                return;
            }
            
            lastPppoeFetch = now;
            
            pppoeLoadingInProgress = true;
            pppoeDataLoading = true;
            initialPppoeLoadFailed = false;
            
            // Update button state to show loading
            if (showLoading) {
                $('#refreshPppoeBtn').prop('disabled', true);
                $('#pppoeStatusText').html('<i class="fas fa-spinner fa-spin"></i> Loading...');
            }
            
            // Update DataTable to show loading state immediately
            if (dataTableInstance) {
                dataTableInstance.rows().invalidate('data').draw(false);
            }
            
            try {
                const response = await fetch(`/api/mikrotik/ppp-active-users?_=${new Date().getTime()}`, {
                    credentials: 'include'
                });
                const result = await response.json();
                
                if (result.status === 200 && Array.isArray(result.data) && result.error !== true) {
                    // Clear and update map with new data
                    activePppoeUsersMap.clear();
                    pppoeUserMacMap.clear();
                    result.data.forEach(userEntry => {
                        if (userEntry.name && userEntry.address) {
                            activePppoeUsersMap.set(userEntry.name, userEntry.address);
                            // Store MAC address (caller_id) if available
                            if (userEntry.caller_id) {
                                pppoeUserMacMap.set(userEntry.name, userEntry.caller_id);
                            }
                        }
                    });
                    lastPppoeUpdatedAt = result.last_updated_at || new Date().toISOString();
                    
                    console.log(`[fetchActivePppoeUsers] Loaded ${activePppoeUsersMap.size} PPPoE users, ${pppoeUserMacMap.size} with MAC`);
                    
                    // Update button to show success
                    renderPppoeStatus('fas fa-check', `${activePppoeUsersMap.size} Online`);
                    pppoeDataLoading = false;
                    
                    // Update DataTable to show actual data
                    if (dataTableInstance) {
                        dataTableInstance.rows().invalidate('data').draw(false);
                    }
                } else if (result.error) {
                    console.warn("[fetchActivePppoeUsers] PPPoE data not available:", result.message);
                    renderPppoeStatus(
                        'fas fa-exclamation-triangle',
                        activePppoeUsersMap.size > 0 ? `${activePppoeUsersMap.size} Online (stale)` : 'Offline',
                        activePppoeUsersMap.size > 0
                    );
                    initialPppoeLoadFailed = activePppoeUsersMap.size === 0;
                    pppoeDataLoading = false;
                    
                    // Update DataTable to show error state
                    if (dataTableInstance) {
                        dataTableInstance.rows().invalidate('data').draw(false);
                    }
                }
            } catch (error) {
                console.error("[fetchActivePppoeUsers] Error:", error);
                renderPppoeStatus(
                    'fas fa-times',
                    activePppoeUsersMap.size > 0 ? `${activePppoeUsersMap.size} Online (stale)` : 'Error',
                    activePppoeUsersMap.size > 0
                );
                initialPppoeLoadFailed = activePppoeUsersMap.size === 0;
                pppoeDataLoading = false;
                
                // Update DataTable to show error state
                if (dataTableInstance) {
                    dataTableInstance.rows().invalidate('data').draw(false);
                }
            } finally {
                pppoeLoadingInProgress = false;
                $('#refreshPppoeBtn').prop('disabled', false);
            }
        }


        // Fetch OLT data from HIOSO OLT via SNMP
        async function fetchOltData(showLoading = true) {
            if (oltDataLoading) {
                console.log("[fetchOltData] Already loading OLT data, skipping...");
                return;
            }

            oltDataLoading = true;

            try {
                const response = await fetch(`/api/olt/status?_=${new Date().getTime()}`, {
                    credentials: 'include'
                });
                const result = await response.json();

                if (result.status === 200) {
                    oltEnabled = result.enabled === true;
                    
                    if (result.enabled && Array.isArray(result.data)) {
                        // Clear and rebuild cache
                        oltDataCache.clear();
                        
                        result.data.forEach(onu => {
                            if (onu.macAddress && onu.macAddress !== 'N/A') {
                                // Normalize MAC and use 10-digit prefix as key
                                const normalizedMac = onu.macAddress.replace(/[:\-\s]/g, '').toUpperCase();
                                const macPrefix = normalizedMac.substring(0, 10);
                                
                                oltDataCache.set(macPrefix, {
                                    mac_olt: onu.macAddress,
                                    rx_power: onu.rxPower || 'N/A',
                                    olt_status: onu.status || 'N/A',
                                    is_dying_gasp: onu.isDyingGasp || false,
                                    is_los: onu.isLos || false
                                });
                            }
                        });
                        
                        console.log(`[fetchOltData] Loaded ${oltDataCache.size} ONT from OLT`);
                    } else if (!result.enabled) {
                        console.log("[fetchOltData] OLT is disabled");
                        oltDataCache.clear();
                    }
                } else {
                    console.warn("[fetchOltData] Error:", result.message);
                    oltEnabled = false;
                }
            } catch (error) {
                console.error("[fetchOltData] Error:", error);
                oltEnabled = false;
            } finally {
                oltDataLoading = false;
                
                // Update DataTable to show OLT data
                if (dataTableInstance) {
                    dataTableInstance.rows().invalidate('data').draw(false);
                }
            }
        }

        // Get OLT data for a specific MAC address (from MikroTik caller-id)
        function getOltDataByMac(mikrotikMac) {
            if (!mikrotikMac || !oltEnabled) return null;
            
            // Normalize MAC and get 10-digit prefix
            const normalizedMac = mikrotikMac.replace(/[:\-\s]/g, '').toUpperCase();
            const macPrefix = normalizedMac.substring(0, 10);
            
            return oltDataCache.get(macPrefix) || null;
        }

        // Render OLT status with badge
        function renderOltStatus(oltData) {
            if (!oltData) return '<span class="text-muted">-</span>';
            
            let statusHtml = '';
            const status = oltData.olt_status;
            
            if (oltData.is_dying_gasp) {
                statusHtml = '<span class="badge badge-danger" title="Dying Gasp - Perangkat mati mendadak"><i class="fas fa-bolt"></i> Dying Gasp</span>';
            } else if (oltData.is_los) {
                statusHtml = '<span class="badge badge-warning" title="Loss of Signal - Sinyal hilang"><i class="fas fa-exclamation-triangle"></i> LOS</span>';
            } else if (status === 'Online') {
                statusHtml = '<span class="badge badge-success"><i class="fas fa-check-circle"></i> Online</span>';
            } else if (status === 'Offline') {
                statusHtml = '<span class="badge badge-secondary"><i class="fas fa-times-circle"></i> Offline</span>';
            } else {
                statusHtml = `<span class="badge badge-light">${status}</span>`;
            }
            
            return statusHtml;
        }

        async function fetchNetworkAssets() {
            try {
                const response = await fetch('/api/map/network-assets?_=' + new Date().getTime(), {
                    credentials: 'include'
                });
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Gagal mengambil data aset jaringan: ${response.status} ${response.statusText}. Server: ${errorText.substring(0,100)}`);
                }
                const result = await response.json();
                if (result.status === 200 && Array.isArray(result.data)) {
                    allOdpList = result.data.filter(asset => asset.type === 'ODP');
                    allOdcList = result.data.filter(asset => asset.type === 'ODC');
                    console.log("ODP List fetched:", allOdpList.length);
                    console.log("ODC List fetched:", allOdcList.length);
                    return true;
                } else {
                    console.error("Data aset jaringan tidak valid dari server:", result);
                    displayGlobalUserMessage(`Gagal memuat daftar aset jaringan: ${result.message || 'Format data tidak sesuai.'}`, "warning", true); // Make it persistent if needed
                    return false;
                }
            } catch (error) {
                console.error("Error fetching network assets list:", error);
                displayGlobalUserMessage(`Gagal memuat daftar aset jaringan: ${error.message}`, "danger", true); // Make it persistent if needed
                return false;
            }
        }

        function populateOdcDropdowns(selectElementId, selectedOdcIdToSet = null) {
            const selectElement = $(`#${selectElementId}`);
            if (!selectElement.length) {
                console.warn("Select element with ID", selectElementId, "not found for ODC dropdown.");
                return;
            }
            const currentValue = selectedOdcIdToSet || selectElement.val();

            selectElement.empty().append(new Option('-- Pilih ODC --', ''));

            if (allOdcList.length > 0) {
                allOdcList.sort((a, b) => (a.name || 'Z').localeCompare(b.name || 'Z')).forEach(odc => {
                    const displayText = `${odc.name || 'Tanpa Nama'} (ID: ${odc.id || 'N/A'})`;
                    selectElement.append(new Option(displayText, odc.id));
                });
            }

            if (selectElement.data('select2')) {
                 selectElement.select2('destroy');
            }
            selectElement.select2({
                theme: "bootstrap",
                dropdownParent: selectElement.closest('.modal'),
                placeholder: '-- Pilih ODC --',
                allowClear: true
            });

            selectElement.val(currentValue || '').trigger('change.select2');
        }

        function populateOdpDropdowns(selectElementId, selectedOdpIdToSet = null, odcIdFilter = null) {
            const selectElement = $(`#${selectElementId}`);
            if (!selectElement.length) {
                console.warn("Select element with ID", selectElementId, "not found for ODP dropdown.");
                return;
            }
            selectElement.empty();

            let placeholderText = '-- Pilih ODC Dahulu --';
            let hasValidOdpOptions = false;
            let tempFilteredOdpList = [];

            if (odcIdFilter) {
                tempFilteredOdpList = allOdpList.filter(odp => {
                    const odpParentId = odp.parent_odc_id !== undefined && odp.parent_odc_id !== null ? String(odp.parent_odc_id) : null;
                    return odpParentId === String(odcIdFilter);
                });

                tempFilteredOdpList.sort((a, b) => (a.name || 'Z').localeCompare(b.name || 'Z'));

                if (tempFilteredOdpList.length > 0) {
                    placeholderText = '-- Pilih ODP --';
                    selectElement.append(new Option(placeholderText, ''));
                    tempFilteredOdpList.forEach(odp => {
                        const odpCapacity = parseInt(odp.capacity_ports) || 0;
                        const portsUsed = parseInt(odp.ports_used) || 0;
                        const isFull = (odpCapacity > 0 && portsUsed >= odpCapacity);
                        // Allow selecting an already connected ODP even if it's full (for edit mode)
                        const isCurrentlyConnectedOdp = (selectElementId === 'edit_connected_odp') && (String(odp.id) === String(selectedOdpIdToSet));
                        const isDisabled = isFull && !isCurrentlyConnectedOdp;

                        let displayText = `${odp.name || 'Tanpa Nama'} (ID: ${odp.id || 'N/A'}) - Port: ${portsUsed}/${odpCapacity || 'N/A'}`;
                        if (isFull && !isCurrentlyConnectedOdp) {
                            displayText += ' (PENUH)';
                        } else if (isCurrentlyConnectedOdp && isFull) {
                            displayText += ' (Sedang Digunakan - PENUH)'; // Clarify for the current user
                        }

                        const option = new Option(displayText, odp.id);
                        if (isDisabled) {
                            option.disabled = true;
                        }
                        selectElement.append(option);
                    });
                    hasValidOdpOptions = true;
                } else {
                    placeholderText = '-- Tidak ada ODP untuk ODC ini --';
                    selectElement.append(new Option(placeholderText, ''));
                }
            } else {
                selectElement.append(new Option(placeholderText, ''));
            }

            if (selectElement.data('select2')) {
                selectElement.select2('destroy');
            }
            selectElement.select2({
                theme: "bootstrap",
                dropdownParent: selectElement.closest('.modal'),
                placeholder: placeholderText,
                allowClear: true
            });

            if (selectedOdpIdToSet && hasValidOdpOptions && tempFilteredOdpList.some(odp => String(odp.id) === String(selectedOdpIdToSet))) {
                selectElement.val(selectedOdpIdToSet).trigger('change.select2'); // Use current value if valid
            } else {
                selectElement.val('').trigger('change.select2');
            }
            selectElement.prop('disabled', !odcIdFilter);
        }

        function populateOdcFilterDropdown() {
            const selectElement = $('#odcFilterDropdown');
            const currentValue = selectElement.val();
            selectElement.empty().append(new Option('Semua ODC', ''));
            if (allOdcList.length > 0) {
                allOdcList.sort((a, b) => (a.name || 'Z').localeCompare(b.name || 'Z')).forEach(odc => {
                    const displayText = `${odc.name || 'Tanpa Nama'} (ID: ${odc.id || 'N/A'})`;
                    selectElement.append(new Option(displayText, odc.id));
                });
            }
            if (selectElement.data('select2')) { selectElement.select2('destroy'); }
            selectElement.select2({ theme: "bootstrap", placeholder: 'Pilih ODC', allowClear: true, width: '100%' });
            selectElement.val(currentValue || '').trigger('change.select2');
        }

        function populateOdpFilterDropdown(filteredOdps = null) {
            const selectElement = $('#odpFilterDropdown');
            const selectedOdcId = $('#odcFilterDropdown').val();
            const currentValue = selectElement.val();

            let placeholderText = 'Semua ODP';
            selectElement.empty();

            const odpsToDisplay = filteredOdps ? filteredOdps : allOdpList;

            if (selectedOdcId && selectedOdcId !== "") {
                placeholderText = filteredOdps && filteredOdps.length > 0 ? 'Semua ODP (di ODC ini)' : 'Tidak ada ODP di ODC ini';
            }

            selectElement.append(new Option(placeholderText, ''));

            if (odpsToDisplay.length > 0) {
                odpsToDisplay.sort((a, b) => (a.name || 'Z').localeCompare(b.name || 'Z')).forEach(odp => {
                    const displayText = `${odp.name || 'Tanpa Nama'} (ID: ${odp.id || 'N/A'}) - Port: ${odp.ports_used || 0}/${odp.capacity_ports || 'N/A'}`;
                    selectElement.append(new Option(displayText, odp.id));
                });
            }

            if (selectElement.data('select2')) { selectElement.select2('destroy'); }
            selectElement.select2({ theme: "bootstrap", placeholder: placeholderText, allowClear: true, width: '100%' });

            if (currentValue && odpsToDisplay.some(odp => String(odp.id) === String(currentValue))) {
                selectElement.val(currentValue).trigger('change.select2');
            } else {
                selectElement.val('').trigger('change.select2');
            }
        }

        fetch('/api/me', { credentials: 'include' })
            .then(response => response.json())
            .then(data => {
                if (data.status === 200 && data.data && data.data.username) {
                    currentUsername = data.data.username;
                    $('#loggedInTechnicianInfo').text(currentUsername);
                }
            }).catch(err => console.warn("Could not fetch user data: ", err));

        // MODIFIED: displayGlobalUserMessage to use a modal
        function displayGlobalUserMessage(message, type = 'info', useModal = false) {
            const modalTitle = $('#errorModalLabel');
            const modalBody = $('#errorModalBody');
            const modalHeader = modalTitle.parent(); // Get the .modal-header element

            modalHeader.removeClass('bg-danger bg-warning bg-info bg-success').addClass(`bg-${type}`);

            let iconHtml = '';
            let titleText = '';

            switch (type) {
                case 'danger':
                    iconHtml = '<i class="fas fa-times-circle"></i>';
                    titleText = 'Terjadi Kesalahan!';
                    break;
                case 'warning':
                    iconHtml = '<i class="fas fa-exclamation-triangle"></i>';
                    titleText = 'Peringatan!';
                    break;
                case 'success':
                    iconHtml = '<i class="fas fa-check-circle"></i>';
                    titleText = 'Berhasil!';
                    break;
                case 'info':
                default:
                    iconHtml = '<i class="fas fa-info-circle"></i>';
                    titleText = 'Informasi';
                    break;
            }

            modalTitle.html(`${iconHtml} ${titleText}`);
            modalBody.html(`<div class="alert alert-${type} mb-0">${message}</div>`); // mb-0 to remove bottom margin
            $('#errorModal').modal('show');
        }


        // `mapViewFn` SENGAJA hanya boleh menggeser tampilan peta (bukan penulis input lat/lng) —
        // kegagalan GPS tak boleh berubah jadi koordinat pelanggan. Lihat catatan di bawah.
        function handleGeolocationErrorUserModal(error, contextMessage, displayTarget, fallbackLat, fallbackLng, mapViewFn) {
            console.warn(`${contextMessage} - Error Code: ${error.code}, Message: ${error.message}`);
            let errorText = `<b>${contextMessage}</b><br/>`;
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    errorText += "IZIN LOKASI DITOLAK. Periksa pengaturan lokasi di OS & Browser Anda.";
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorText += "INFORMASI LOKASI TIDAK TERSEDIA. Pastikan GPS/Layanan Lokasi aktif.";
                    break;
                case error.TIMEOUT:
                    errorText += "WAKTU PERMINTAAN LOKASI HABIS. Sinyal mungkin lemah.";
                    break;
                default:
                    errorText += `Kesalahan (Code: ${error.code || 'N/A'}). Cek koneksi & HTTPS.`;
                    break;
            }
            // HANYA geser TAMPILAN peta — JANGAN menulis input lat/lng.
            // Dulu baris ini memanggil updateMarkerAndInputsUser, sehingga koordinat DEFAULT
            // (-7.24139, 111.83833) ikut TERSIMPAN sebagai lokasi rumah pelanggan setiap kali
            // form disimpan dengan izin GPS ditolak — walau yang diubah cuma nomor HP.
            // Itulah sebab puluhan pelanggan menumpuk di satu titik yang sama PERSIS.
            if (fallbackLat && fallbackLng && mapViewFn) {
                 errorText += "<br/>Peta digeser ke lokasi default. <b>Koordinat pelanggan TIDAK diubah</b> — klik peta atau geser marker bila memang ingin menandai lokasi.";
                 mapViewFn(L.latLng(fallbackLat, fallbackLng));
            }
            displayTarget(errorText, 'danger', true); // Use modal for geolocation errors
        }

        function processSuccessfulGeolocationUserModal(position, contextMessage, displayTarget, mapUpdaterFn, buttonContainer, originalIcon) {
            console.log(`${contextMessage} - Coords: Lat=${position.coords.latitude}, Lng=${position.coords.longitude}, Accuracy=${position.coords.accuracy}m`);
            const userLat = position.coords.latitude;
            const userLng = position.coords.longitude;

            if (mapUpdaterFn) {
                mapUpdaterFn(L.latLng(userLat, userLng), true); // Update map and inputs, and set view
            }

            let accuracyMessage = "";
            let accuracyType = "info";
            if (position.coords.accuracy > 1000) {
                accuracyMessage = `PERINGATAN: Akurasi lokasi sangat rendah (${Math.round(position.coords.accuracy)}m). Mungkin lokasi jaringan/IP, bukan GPS.`;
                accuracyType = "warning"; // Changed to warning, not danger unless truly critical
            } else if (position.coords.accuracy > 150) {
                 accuracyMessage = `Info: Akurasi lokasi sedang (${Math.round(position.coords.accuracy)}m). Mungkin dari Wi-Fi.`;
                 accuracyType = "info";
            } else if (position.coords.accuracy > 0) {
                 accuracyMessage = `Lokasi GPS ditemukan dengan akurasi baik (${Math.round(position.coords.accuracy)}m).`;
                 accuracyType = "success";
            }
            // Log to console for successful geolocation
            console.log(accuracyMessage);

            if (buttonContainer && originalIcon) {
                buttonContainer.innerHTML = originalIcon;
            }
        }

        // MODIFIED: initializeUserMapWithGPS to include satellite layers
        function initializeUserMapWithGPS(mapId, latInputId, lngInputId, initialLat, initialLng, isEditMode = false) {
            let mapInstance = (mapId === 'createUserMap') ? createUserMapInstance : editUserMapInstance;
            let markerInstance = (mapId === 'createUserMap') ? createUserMarker : editUserMarker;

            const latInput = $(`#${latInputId}`);
            const lngInput = $(`#${lngInputId}`);

            if (mapInstance) { mapInstance.remove(); mapInstance = null; }
            if (markerInstance) { markerInstance.remove(); markerInstance = null; }

            let defaultLat = -7.24139;
            let defaultLng = 111.83833;
            let defaultZoom = 12;

            const viewLat = (initialLat && !isNaN(parseFloat(initialLat))) ? parseFloat(initialLat) : defaultLat;
            const viewLng = (initialLng && !isNaN(parseFloat(initialLng))) ? parseFloat(initialLng) : defaultLng;
            // Pastikan viewZoom tidak melebihi maxZoom (18 untuk satellite)
            const calculatedZoom = (initialLat && initialLng && !isNaN(parseFloat(initialLat)) && !isNaN(parseFloat(initialLng))) ? 18 : defaultZoom;
            const viewZoom = Math.min(calculatedZoom, 18); // Maksimal 18 untuk mencegah error

            const osmMaxZoom = 22;
            const satelliteMaxZoom = 18; // Esri World Imagery hanya support sampai level 18

            const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: osmMaxZoom,
                attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            });
            const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: satelliteMaxZoom,
                maxNativeZoom: 18, // Esri World Imagery hanya support sampai level 18
                attribution: 'Tiles &copy; Esri',
                errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' // Transparent 1x1 pixel
            });

            mapInstance = L.map(mapId, {
                layers: [satelliteLayer], // Default layer
                maxZoom: satelliteMaxZoom  // Initial maxZoom for the map
            }).setView([viewLat, viewLng], viewZoom);

            const baseMaps = {
                "Satelit": satelliteLayer,
                "OpenStreetMap": osmLayer
            };
            L.control.layers(baseMaps, null, { collapsed: true, position: 'topright' }).addTo(mapInstance);

            mapInstance.on('baselayerchange', function (e) {
                let newMaxZoom = (e.name === "Satelit") ? satelliteMaxZoom : osmMaxZoom;
                if (mapInstance.options.maxZoom !== newMaxZoom) {
                    mapInstance.options.maxZoom = newMaxZoom;
                    if (mapInstance.getZoom() > newMaxZoom) {
                        mapInstance.setZoom(newMaxZoom);
                    }
                }
            });

            const geolocationOptions = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };

            function updateMarkerAndInputsUser(latlng, setView = false) {
                latInput.val(latlng.lat.toFixed(6));
                lngInput.val(latlng.lng.toFixed(6));
                if (!markerInstance) {
                    markerInstance = L.marker(latlng, { draggable: true }).addTo(mapInstance);
                    if (mapId === 'createUserMap') createUserMarker = markerInstance; else editUserMarker = markerInstance;

                    markerInstance.on('dragend', function (event) {
                        const pos = event.target.getLatLng();
                        latInput.val(pos.lat.toFixed(6));
                        lngInput.val(pos.lng.toFixed(6));
                    });
                } else {
                    markerInstance.setLatLng(latlng);
                }
                if (setView) {
                    mapInstance.setView(latlng, Math.max(mapInstance.getZoom(), 16));
                }
            }

            // Geser TAMPILAN peta saja — tanpa marker, tanpa menyentuh input lat/lng.
            // ATURAN: koordinat pelanggan HANYA boleh berubah karena tindakan SENGAJA —
            // klik peta, geser marker, atau tombol GPS yang BERHASIL. Inisialisasi otomatis dan
            // kegagalan GPS tidak boleh menulis apa pun, karena form sering disimpan untuk
            // urusan lain (ubah No HP, tandai lunas) dan koordinatnya ikut tertimpa tanpa disadari.
            function moveMapViewOnly(latlng) {
                if (mapInstance) mapInstance.setView(latlng, mapInstance.getZoom());
            }

            if (initialLat && initialLng && !isNaN(parseFloat(initialLat)) && !isNaN(parseFloat(initialLng))) {
                 updateMarkerAndInputsUser(L.latLng(parseFloat(initialLat), parseFloat(initialLng)), false);
            }

            const GpsControl = L.Control.extend({
                options: { position: 'topleft' },
                onAdd: function (mapCtrl) {
                    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
                    const originalIconHTML = '<i class="fas fa-map-marker-alt"></i>';
                    const loadingIconHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    container.innerHTML = originalIconHTML;
                    container.title = 'Dapatkan Lokasi GPS Saat Ini';

                    L.DomEvent.on(container, 'click', L.DomEvent.stopPropagation)
                        .on(container, 'click', L.DomEvent.preventDefault)
                        .on(container, 'click', function () {
                            container.innerHTML = loadingIconHTML;
                            console.log("Meminta lokasi GPS Anda..."); // Log to console, no modal here
                            if (navigator.geolocation) {
                                navigator.geolocation.getCurrentPosition(
                                    (position) => processSuccessfulGeolocationUserModal(position, "Tombol GPS", displayGlobalUserMessage, updateMarkerAndInputsUser, container, originalIconHTML),
                                    (error) => {
                                        handleGeolocationErrorUserModal(error, "Gagal dari Tombol GPS", displayGlobalUserMessage, defaultLat, defaultLng, moveMapViewOnly);
                                        container.innerHTML = originalIconHTML;
                                    },
                                    geolocationOptions
                                );
                            } else {
                                handleGeolocationErrorUserModal({code: -1, message: "Browser tidak mendukung geolokasi."}, "Gagal dari Tombol GPS", displayGlobalUserMessage, defaultLat, defaultLng, moveMapViewOnly);
                                container.innerHTML = originalIconHTML;
                            }
                        });
                    return container;
                }
            });
            new GpsControl().addTo(mapInstance);

            if (!isEditMode || (!initialLat || !initialLng)) {
                 console.log("Mencoba mendapatkan lokasi GPS awal..."); // Log to console, no modal here
                 if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(
                        // Inisialisasi = geser tampilan saja. Lokasi PETUGAS bukan lokasi rumah pelanggan;
                        // dulu ini menuliskannya ke input sehingga ikut tersimpan bila form disubmit.
                        (position) => processSuccessfulGeolocationUserModal(position, "Inisialisasi Peta", displayGlobalUserMessage, moveMapViewOnly),
                        (error) => {
                            if (!markerInstance) {
                                handleGeolocationErrorUserModal(error, "Gagal Inisialisasi Peta", displayGlobalUserMessage, defaultLat, defaultLng, moveMapViewOnly);
                            } else {
                                console.warn("Inisialisasi GPS gagal, namun marker sudah ada dari data awal.");
                            }
                        },
                        geolocationOptions
                    );
                } else if (!markerInstance) {
                     handleGeolocationErrorUserModal({code: -1, message: "Browser tidak mendukung geolokasi."}, "Gagal Inisialisasi Peta", displayGlobalUserMessage, defaultLat, defaultLng, moveMapViewOnly);
                }
            }

            mapInstance.on('click', function (e) {
                updateMarkerAndInputsUser(e.latlng);
            });

            if (mapId === 'createUserMap') createUserMapInstance = mapInstance; else editUserMapInstance = mapInstance;

            const modalTarget = (mapId === 'createUserMap' ? '#createModal' : '#editModal');
            $(modalTarget).off('shown.bs.modal.usermapfix').on('shown.bs.modal.usermapfix', function() {
                 setTimeout(function () { if (mapInstance) mapInstance.invalidateSize(); }, 10);
            });
             if ($(modalTarget).is(':visible')) {
                 setTimeout(function () { if (mapInstance) mapInstance.invalidateSize(); }, 10);
            }
        }

        $('#createModal').on('shown.bs.modal', function () {
            $('#createUserForm')[0].reset();
            $('#create_number_container').empty();
            addNumberField('create_number_container', "", true);
            populateOdcDropdowns('create_connected_odc', null);
            populateOdpDropdowns('create_connected_odp', null, null);
            initializeUserMapWithGPS('createUserMap', 'create_latitude', 'create_longitude', null, null, false);

            // Clear bulk container on modal open
            $('#bulk-container').empty();

            // NEW: Set initial state for add to MikroTik checkbox and fields
            $('#create_add_to_mikrotik').prop('checked', false); // Default unchecked
            // PPPoE fields are now always visible, but required status depends on checkbox
            $('#create_pppoe_username').prop('required', false);
            $('#create_pppoe_password').prop('required', false);
        });

        $('#editModal').on('shown.bs.modal', function () {
            const lat = $('#edit_latitude').val();
            const lng = $('#edit_longitude').val();
            const connectedOdpId = $(this).find('#edit_connected_odp').data('current-odp');
            const preselectOdcId = $(this).find('#edit_connected_odc').data('current-odc');
            const deviceId = $('#edit_device_id_modal').val();
            let existingBulkData = $(this).data('bulk-ssids') || [];
            // Ensure existingBulkData is an array of strings
            if (typeof existingBulkData === 'string') {
                existingBulkData = existingBulkData.split(',').filter(Boolean).map(String);
            } else if (!Array.isArray(existingBulkData)) {
                existingBulkData = [];
            }


            $('#edit_connected_odc').off('change', editOdcChangeHandler);
            populateOdcDropdowns('edit_connected_odc', preselectOdcId);
            populateOdpDropdowns('edit_connected_odp', connectedOdpId, preselectOdcId);
            $('#edit_connected_odc').on('change', editOdcChangeHandler);
            initializeUserMapWithGPS('editUserMap', 'edit_latitude', 'edit_longitude', lat, lng, true);

            // Populate bulk SSID for edit modal on open with existing data
            populateBulkSSIDContainer('edit-bulk-container', deviceId, existingBulkData);
        });

        $('#createModal, #editModal').on('hidden.bs.modal', function (e) {
            const modalId = $(e.target).attr('id');
            if (modalId === 'createModal' && createUserMapInstance) {
                createUserMapInstance.remove(); createUserMapInstance = null; createUserMarker = null;
            } else if (modalId === 'editModal' && editUserMapInstance) {
                editUserMapInstance.remove(); editUserMapInstance = null; editUserMarker = null;
            }
            $('#create_subscription').val(null).trigger('change');
            $('#edit_subscription').val(null).trigger('change');
            $('#create_connected_odc, #edit_connected_odc').val(null).trigger('change.select2');
            $('#create_connected_odp, #edit_connected_odp').val(null).trigger('change.select2');
            $('#create_connected_odp, #edit_connected_odp').prop('disabled', true).empty().append(new Option('-- Pilih ODC Dahulu --', '')).trigger('change.select2');
            // Clear SSID bulk container when modal is hidden
            $('#bulk-container').empty();
            $('#edit-bulk-container').empty();
        });

        // ── Titik lokasi pelanggan ────────────────────────────────────────────────────────────
        // Gerbangnya ada di SERVER (`POST /api/users/:id/location`), sama persis dengan wizard WA &
        // panel admin: halaman ini hanya menampilkan. "Cek titik" = pratinjau (tanpa confirm) →
        // server balas titik LAMA, jarak geser, tetangga/ODP terdekat, dan peringatan. Simpan baru
        // dikirim setelah teknisi melihat hasilnya. JANGAN menyalin aturan presisi ke sini.
        let lokasiTargetId = null;
        let lokasiInputTerakhir = null;

        $(document).on('click', '.btn-set-lokasi', function() {
            const b = $(this);
            lokasiTargetId = b.data('id');
            lokasiInputTerakhir = null;
            $('#lokasi_nama').text(b.data('name') || '');
            $('#lokasi_input').val('');
            $('#lokasi_hasil').empty();
            $('#lokasi_gps_info').empty();
            $('#lokasi_simpan').prop('disabled', true);

            const lat = b.data('lat'), lng = b.data('lng');
            if (lat && lng) {
                const sumber = b.data('source') ? ` · sumber: <b>${b.data('source')}</b>` : '';
                const kapan = b.data('updated') ? ` · ${String(b.data('updated')).slice(0, 10)}` : '';
                $('#lokasi_lama').removeClass('alert-warning').addClass('alert-secondary').html(
                    `<b>📌 Titik LAMA tersimpan:</b> ${lat}, ${lng}${sumber}${kapan}<br/>`
                    + `<a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" rel="noopener">Buka di Maps</a>`
                    + `<br/><span class="text-danger">Titik baru akan menimpa titik ini.</span>`
                );
            } else {
                $('#lokasi_lama').removeClass('alert-secondary').addClass('alert-warning')
                    .html('<b>Belum ada titik sama sekali</b> untuk pelanggan ini.');
            }
            $('#lokasiModal').modal('show');
        });

        // GPS HP teknisi. Akurasi IKUT DITAMPILKAN dan tidak disembunyikan: pembacaan >100 m biasanya
        // berasal dari jaringan/WiFi, bukan satelit — dan titik semacam itulah yang dulu membuat
        // puluhan pelanggan menumpuk di satu koordinat. Hasilnya hanya MENGISI kotak; teknisi tetap
        // harus menekan "Cek titik" sehingga gerbang server tetap jadi penentu terakhir.
        $(document).on('click', '#lokasi_gps', function() {
            const btn = $(this);
            if (!navigator.geolocation) {
                $('#lokasi_gps_info').html('<div class="alert alert-warning py-2 mb-0" style="font-size:.85rem;">Perangkat/browser ini tak mendukung GPS. Tempel koordinat manual di bawah.</div>');
                return;
            }
            btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Mencari sinyal GPS…');
            navigator.geolocation.getCurrentPosition(function(pos) {
                const akurasi = Math.round(pos.coords.accuracy);
                $('#lokasi_input').val(`${pos.coords.latitude}, ${pos.coords.longitude}`);
                const kelas = akurasi <= 30 ? 'success' : (akurasi <= 100 ? 'info' : 'warning');
                const catatan = akurasi <= 30
                    ? 'Akurasi baik (sinyal satelit).'
                    : (akurasi <= 100
                        ? 'Akurasi sedang — pastikan Anda memang di depan rumah pelanggan.'
                        : 'Akurasi RENDAH — ini kemungkinan lokasi jaringan/WiFi, bukan GPS. Keluar ke area terbuka lalu ulangi, atau tempel koordinat manual.');
                $('#lokasi_gps_info').html(
                    `<div class="alert alert-${kelas} py-2 mb-0" style="font-size:.85rem;">📍 Lokasi Anda terbaca (±${akurasi} m). ${catatan}</div>`
                );
                $('#lokasi_simpan').prop('disabled', true); // wajib "Cek titik" dulu
                btn.prop('disabled', false).html('<i class="fas fa-crosshairs"></i> Pakai lokasi saya sekarang');
            }, function(err) {
                let pesan = 'Gagal membaca GPS.';
                if (err.code === 1) pesan = 'Izin lokasi DITOLAK. Aktifkan izin lokasi untuk situs ini di pengaturan browser/HP.';
                else if (err.code === 2) pesan = 'Lokasi tidak tersedia. Pastikan GPS/Layanan Lokasi menyala.';
                else if (err.code === 3) pesan = 'Waktu habis mencari sinyal. Coba keluar ke area terbuka lalu ulangi.';
                if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
                    pesan += ' (Halaman ini diakses lewat HTTP — GPS browser umumnya hanya jalan di HTTPS.)';
                }
                $('#lokasi_gps_info').html(`<div class="alert alert-danger py-2 mb-0" style="font-size:.85rem;">⛔ ${pesan}</div>`);
                btn.prop('disabled', false).html('<i class="fas fa-crosshairs"></i> Pakai lokasi saya sekarang');
            }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
        });

        $(document).on('click', '#lokasi_cek', function() {
            const input = $('#lokasi_input').val();
            if (!input || !lokasiTargetId) return;
            const btn = $(this).prop('disabled', true);
            $.ajax({
                url: `/api/users/${lokasiTargetId}/location`, method: 'POST',
                contentType: 'application/json', data: JSON.stringify({ input })
            }).done(function(res) {
                const v = res.verdict || {};
                lokasiInputTerakhir = input;
                let html = `<div class="alert alert-info py-2 mb-2" style="font-size:.9rem;">`
                    + `<b>🆕 Titik baru:</b> ${v.point.lat}, ${v.point.lng} — `
                    + `<a href="${v.mapsUrl}" target="_blank" rel="noopener">buka di Maps</a>`;
                if (v.previous) html += `<br/><b>↔️ Bergeser</b> ${v.previous.distanceM} m dari titik lama.`;
                if (v.nearestCustomer) html += `<br/>📏 ${v.nearestCustomer.meters} m dari rumah ${v.nearestCustomer.name}`;
                if (v.nearestAsset) html += ` · ${v.nearestAsset.meters} m dari ${v.nearestAsset.name}`;
                html += `</div>`;
                (v.warnings || []).forEach(w => {
                    html += `<div class="alert alert-warning py-2 mb-2" style="font-size:.9rem;">⚠️ ${w.message}</div>`;
                });
                $('#lokasi_hasil').html(html);
                $('#lokasi_simpan').prop('disabled', false);
            }).fail(function(xhr) {
                lokasiInputTerakhir = null;
                $('#lokasi_simpan').prop('disabled', true);
                const m = (xhr.responseJSON && xhr.responseJSON.message) || 'Titik tidak terbaca.';
                $('#lokasi_hasil').html(`<div class="alert alert-danger py-2" style="font-size:.9rem;">⛔ ${m}</div>`);
            }).always(function() { btn.prop('disabled', false); });
        });

        $(document).on('click', '#lokasi_simpan', function() {
            if (!lokasiTargetId || !lokasiInputTerakhir) return;
            const btn = $(this).prop('disabled', true);
            $.ajax({
                url: `/api/users/${lokasiTargetId}/location`, method: 'POST',
                contentType: 'application/json', data: JSON.stringify({ input: lokasiInputTerakhir, confirm: true })
            }).done(function() {
                $('#lokasiModal').modal('hide');
                displayGlobalUserMessage('Titik rumah pelanggan tersimpan.', 'success', true);
                if (dataTableInstance) dataTableInstance.ajax.reload(null, false);
            }).fail(function(xhr) {
                const m = (xhr.responseJSON && xhr.responseJSON.message) || 'Gagal menyimpan titik.';
                displayGlobalUserMessage(m, 'danger', true);
            }).always(function() { btn.prop('disabled', false); });
        });

        $(document).on('click', '.btn-edit', function() {
            const id = $(this).data('id');
            const device_id = $(this).data('device_id') || "";
            let bulkData = $(this).data('bulk');
            if (typeof bulkData === 'string') {
                try {
                    bulkData = JSON.parse(bulkData);
                } catch (e) {
                    console.error("Failed to parse bulk data JSON:", e, bulkData);
                    bulkData = [];
                }
            }
            if (!Array.isArray(bulkData)) {
                bulkData = [];
            }
            const initialPaidStatusForEdit = $(this).data('paid') === true || String($(this).data('paid')).toLowerCase() === 'true';

            const connectedOdpId = $(this).data('connected_odp_id') || "";

            let preselectOdcId = null;
            if (connectedOdpId && allOdpList.length > 0) {
                const selectedOdp = allOdpList.find(odp => String(odp.id) === String(connectedOdpId));
                if (selectedOdp && selectedOdp.parent_odc_id) {
                    preselectOdcId = selectedOdp.parent_odc_id;
                }
            }

            $('#edit_user_id').val(id);
            $('#editModal #edit_connected_odc').data('current-odc', preselectOdcId);
            $('#editModal #edit_connected_odp').data('current-odp', connectedOdpId);
            $('#editUserForm').data('initial-paid-status', initialPaidStatusForEdit);
            $('#editModal').data('bulk-ssids', bulkData);

            $('#editModal #edit_name').val($(this).data('name'));
            $('#editModal #edit_device_id_modal').val(device_id);

            $('#edit_number_container').empty();
            const phoneNumbers = $(this).data('phone_number')?.toString().split("|") || [];
            if (phoneNumbers.length > 0 && phoneNumbers[0] !== "") {
                phoneNumbers.forEach((v, i) => { addNumberField("edit_number_container", v, i === 0); });
            } else {
                 addNumberField("edit_number_container", "", true);
            }

            $('#editModal #edit_address').val($(this).data('address'));
            $('#editModal #edit_subscription').val($(this).data('subscription')).trigger('change');
            $('#editModal #edit_paid').prop("checked", initialPaidStatusForEdit);
            $('#editModal #edit_pppoe_username').val($(this).data('pppoe_username'));
            $('#editModal #edit_pppoe_password').val($(this).data('pppoe_password'));
            $('#editModal #edit_latitude').val($(this).data('latitude') || '');
            $('#editModal #edit_longitude').val($(this).data('longitude') || '');
        });

        // Function to format uptime from seconds to human-readable string
        function formatUptime(seconds) {
            if (seconds === null || isNaN(seconds)) return NOT_APPLICABLE;
            const days = Math.floor(seconds / (3600 * 24));
            seconds -= days * 3600 * 24;
            const hours = Math.floor(seconds / 3600);
            seconds -= hours * 3600;
            const minutes = Math.floor(seconds / 60);

            let parts = [];
            if (days > 0) parts.push(`${days}h`);
            if (hours > 0) parts.push(`${hours}j`);
            if (minutes > 0) parts.push(`${minutes}m`);

            if (parts.length === 0) return `0m`;
            return parts.join(' ');
        }


        // Function to fetch device metrics in batch (for Redaman, Suhu, Tipe Router)
        // Uptime dihapus dari batch karena sering tidak terdeteksi di batch, akan diambil via individual API.
        // Debounce helper for device data fetching
        let deviceFetchTimeout = null;
        function debouncedFetchDeviceData(singleDeviceId = null) {
            clearTimeout(deviceFetchTimeout);
            deviceFetchTimeout = setTimeout(() => {
                fetchAndCacheDeviceData(singleDeviceId);
            }, 500);
        }
        
        async function fetchAndCacheDeviceData(singleDeviceIdToFetch = null) {
            console.log(`[fetchAndCacheDeviceData] Called. Single Device ID to fetch: ${singleDeviceIdToFetch}`);

            let deviceIdsToProcess = new Set();
            let forceRedraw = false;

            // Determine if any filter is active
            const selectedOdcId = $('#odcFilterDropdown').val();
            const selectedOdpId = $('#odpFilterDropdown').val();
            const isFilterActive = !!selectedOdcId || !!selectedOdpId;

            // Only fetch metrics if a filter is active OR if a single device ID is explicitly requested
            if (!isFilterActive && !singleDeviceIdToFetch) {
                console.log("[fetchAndCacheDeviceData] No filter active and no single device requested, skipping batch fetch for metrics.");
                deviceDataCache.clear(); // Clear cached data if no filter is active
                if (dataTableInstance) dataTableInstance.rows().invalidate('data').draw('page'); // Redraw to clear values in table
                return;
            }

            if (singleDeviceIdToFetch) {
                if (!deviceDataCache.has(singleDeviceIdToFetch) || !deviceDataCache.get(singleDeviceIdToFetch)._loading) {
                    deviceIdsToProcess.add(singleDeviceIdToFetch);
                    deviceDataCache.set(singleDeviceIdToFetch, {
                        redaman: LOADING_HTML, temperature: LOADING_HTML, modemType: LOADING_HTML, _loading: true
                    });
                    forceRedraw = true;
                }
            } else { // Batch fetch for active filters
                if (dataTableInstance && dataTableInstance.rows().data().any()) {
                    dataTableInstance.rows().every(function() {
                        const rowData = this.data();
                        // Apply filter logic directly here to determine which devices to fetch metrics for
                        const userOdpId = rowData.connected_odp_id ? String(rowData.connected_odp_id) : null;
                        let matchesFilter = true;

                        if (selectedOdpId && selectedOdpId !== "") {
                            matchesFilter = (userOdpId === selectedOdpId);
                        } else if (selectedOdcId && selectedOdcId !== "") {
                            if (!userOdpId) matchesFilter = false;
                            else {
                                const userOdpDetails = allOdpList.find(odp => String(odp.id) === userOdpId);
                                matchesFilter = userOdpDetails ? String(userOdpDetails.parent_odc_id) === selectedOdcId : false;
                            }
                        }

                        if (matchesFilter && rowData.device_id && (!deviceDataCache.has(rowData.device_id) || !deviceDataCache.get(rowData.device_id)._loading)) {
                            deviceIdsToProcess.add(rowData.device_id);
                            deviceDataCache.set(rowData.device_id, {
                                redaman: LOADING_HTML, temperature: LOADING_HTML, modemType: LOADING_HTML, _loading: true
                            });
                            forceRedraw = true;
                        }
                    });
                }
            }

            const uniqueDeviceIds = Array.from(deviceIdsToProcess);

            if (uniqueDeviceIds.length === 0) {
                console.log("[fetchAndCacheDeviceData] No unique device IDs found for batch fetch based on current filters.");
                if (forceRedraw && dataTableInstance) dataTableInstance.rows().invalidate('data').draw('page');
                return;
            }

            console.log(`[fetchAndCacheDeviceData] Initiating batch fetch for ${uniqueDeviceIds.length} devices: ${JSON.stringify(uniqueDeviceIds)}`);

            if (dataTableInstance && forceRedraw) {
                dataTableInstance.rows().invalidate('data').draw('page');
            }

            try {
                const response = await fetch('/api/customer-metrics-batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify({ deviceIds: uniqueDeviceIds })
                });

                if (!response.ok) {
                    const errorJson = await response.json().catch(() => ({ message: response.statusText }));
                    throw new Error(errorJson.message || `Gagal mengambil data metrik batch: ${response.status}`);
                }
                const result = await response.json();

                if (result.status === 200 && Array.isArray(result.data)) {
                    result.data.forEach(metric => {
                        const formattedMetrics = {
                            redaman: metric.redaman || NOT_APPLICABLE,
                            temperature: metric.temperature || NOT_APPLICABLE,
                            modemType: metric.modemType || NOT_APPLICABLE,
                            _loading: false // Mark as no longer loading
                        };
                        deviceDataCache.set(metric.deviceId, formattedMetrics);
                    });
                    console.log(`[fetchAndCacheDeviceData] Batch fetch completed. Cached data for ${result.data.length} devices.`);
                } else {
                    console.error("[fetchAndCacheDeviceData] Invalid batch metrics data:", result);
                    uniqueDeviceIds.forEach(id => {
                        deviceDataCache.set(id, { redaman: ERROR_FETCHING, temperature: ERROR_FETCHING, modemType: ERROR_FETCHING, _loading: false });
                    });
                }
            } catch (error) {
                console.error(`[fetchAndCacheDeviceData] Error during batch fetch: ${error.message}`, error);
                uniqueDeviceIds.forEach(id => {
                    deviceDataCache.set(id, { redaman: ERROR_FETCHING, temperature: ERROR_FETCHING, modemType: ERROR_FETCHING, _loading: false });
                });
            } finally {
                uniqueDeviceIds.forEach(id => {
                    if (deviceDataCache.has(id)) {
                        deviceDataCache.get(id)._loading = false;
                    }
                });
                if (dataTableInstance) {
                    dataTableInstance.rows().invalidate('data').draw('page');
                }
            }
        }


        // NEW: Function to fetch and display connected devices for a single device in the new modal
        async function fetchAndDisplayConnectedDevicesModal(deviceId, customerName) {
            const modalBody = $('#connectedDevicesModalBody');
            $('#connectedDevicesModalLabel').text(`Detail WiFi & Perangkat Terhubung untuk ${customerName}`);
            modalBody.html('<p class="text-center my-3"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Memuat informasi...</p>');
            $('#connectedDevicesModal').modal('show');

            if (!deviceId) {
                modalBody.html('<p class="text-muted text-center my-3">Device ID tidak tersedia untuk pelanggan ini.</p>');
                return;
            }

            try {
                // Call the existing API endpoint that performs refresh and gets full SSID info
                // This is the /api/customer-wifi-info/:deviceId endpoint in index.js,
                // which in turn calls getSSIDInfo in wifi.js.
                const response = await fetch(`/api/customer-wifi-info/${deviceId}?_=${new Date().getTime()}`, { credentials: 'include' });
                const result = await response.json();

                if (!response.ok || result.status !== 200) {
                    throw new Error(result.message || `Gagal mengambil info WiFi (HTTP ${response.status})`);
                }

                if (result.data && Array.isArray(result.data.ssid)) {
                    let contentHtml = '';
                    let totalDevicesCount = 0;

                    // Display Uptime (now fetched from this individual API call) at the top of the modal
                    contentHtml += `<p class="mb-2"><strong><i class="fas fa-clock"></i> Uptime Modem:</strong> ${result.data.uptime || 'N/A'}</p><hr class="mt-1 mb-3">`;


                    if (result.data.ssid.length > 0) {
                        contentHtml += `<h5><i class="fas fa-wifi"></i> Daftar SSID</h5>`; // Changed H6 to H5 for hierarchy
                        result.data.ssid.forEach(s => {
                            if (!s || typeof s !== 'object') return; // Skip invalid SSID entry

                            contentHtml += `<div class="card mb-3 shadow-sm">
                                <div class="card-header py-2">
                                    <strong>SSID ${s.id || 'N/A'}: <span class="text-primary font-weight-bold">${s.name || 'N/A'}</span></strong>
                                </div>
                                <div class="card-body py-2 px-3">
                                    <p class="mb-1 small"><strong>Transmit Power:</strong> ${s.transmitPower != null ? s.transmitPower + '%' : 'N/A'}</p>`;

                            if (s.associatedDevices && s.associatedDevices.length > 0) {
                                totalDevicesCount += s.associatedDevices.length;
                                contentHtml += `<p class="mb-1 small mt-2"><strong><i class="fas fa-users"></i> Perangkat Terhubung (${s.associatedDevices.length}):</strong></p>
                                                <ul class="list-group list-group-flush device-list small">`;
                                s.associatedDevices.forEach(dev => {
                                    if (!dev || typeof dev !== 'object') return; // Skip invalid device entry
                                    contentHtml += `<li class="list-group-item py-1 px-0">
                                                        ${rafEscapeHtml(dev.hostName || 'Tanpa Nama')} <br>
                                                        <small class="text-muted" style="font-size:0.9em;">
                                                            (MAC: ${rafEscapeHtml(dev.mac || '-')}, IP: ${rafEscapeHtml(dev.ip || '-')}, Sinyal: ${dev.signal ? dev.signal + ' dBm' : '-'})
                                                        </small>
                                                    </li>`;
                                });
                                contentHtml += `</ul>`;
                            } else {
                                contentHtml += `<p class="mb-1 small mt-2"><em>Tidak ada perangkat terhubung ke SSID ini.</em></p>`;
                            }
                            contentHtml += `</div></div>`;
                        });
                    } else {
                        contentHtml = '<p class="text-muted text-center my-3">Tidak ada SSID aktif ditemukan untuk perangkat ini.</p>';
                    }

                    // Prepend total count summary to the top of all content
                    let overallSummary = `<h5 class="mb-3">Total Perangkat Terhubung: <span class="badge badge-primary">${totalDevicesCount}</span></h5><hr>`;
                    modalBody.html(overallSummary + contentHtml);

                } else {
                    modalBody.html('<p class="text-danger text-center my-3">Format data API WiFi tidak sesuai atau data kosong.</p>');
                }
            } catch (error) {
                modalBody.html(`<p class="text-danger text-center my-3"><strong>Error memuat info perangkat terhubung:</strong> ${error.message}</p>`);
                console.error(`Error fetching connected devices for modal ${deviceId}:`, error);
            }
        }


        // Function to refresh data based on context
        // Added forceNoFilterCheck parameter to skip filter validation if needed (e.g., after CRUD ops)
        async function refreshAllData(forceNoFilterCheck = false) {
            const selectedOdcId = $('#odcFilterDropdown').val();
            const selectedOdpId = $('#odpFilterDropdown').val();
            const isFilterActive = !!selectedOdcId || !!selectedOdpId;

            if (!isFilterActive && !forceNoFilterCheck) {
                displayGlobalUserMessage("Tidak ada filter ODC atau ODP yang aktif. Silakan pilih filter terlebih dahulu.", "warning", true);
                return;
            }

            displayGlobalUserMessage("Memuat ulang data pelanggan yang terfilter...", "info", true);
            $('#refreshDataBtn').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Refreshing...');

            try {
                deviceDataCache.clear(); // Clear the entire cache
                oltDataCache.clear(); // Clear OLT cache
                pppoeUserMacMap.clear(); // Clear PPPoE MAC cache
                await fetchNetworkAssets();
                await fetchActivePppoeUsers();
                await fetchOltData(); // Fetch OLT data
                if (dataTableInstance) {
                    // We don't need to reload DataTable via AJAX if it's already loaded.
                    // Just re-run the draw and then fetch device data based on current filters.
                    dataTableInstance.draw(); // Re-apply current filters and redraw
                    console.log("[refreshAllData] DataTables redraw triggered. Initiating device metrics fetch for filtered data.");

                    // Only fetch GenieACS data if a filter is actually active
                    if (isFilterActive) {
                        fetchAndCacheDeviceData(null);
                    } else {
                        // If no filter is active after refresh (e.g. forceNoFilterCheck was true, but still no filter)
                        // Ensure columns are hidden and cache cleared.
                        toggleDeviceMetricColumns(false);
                        deviceDataCache.clear();
                        oltDataCache.clear();
                        pppoeUserMacMap.clear();
                    }

                    displayGlobalUserMessage("Data pelanggan terfilter berhasil diperbarui.", "success", true);
                }
            } catch (error) {
                console.error("Error during full data refresh:", error);
                displayGlobalUserMessage("Gagal memuat ulang data: " + error.message, "danger", true);
            } finally {
                $('#refreshDataBtn').prop('disabled', false).html('Refresh Data');
            }
        }

        // Toggles visibility of Redaman, Redaman OLT, Status OLT, Suhu, Tipe Router columns
        function toggleDeviceMetricColumns(show) {
            const table = $('#dataTable').DataTable();
            // Columns: 12=Redaman GenieACS, 13=Redaman OLT, 14=Status OLT, 15=Suhu, 16=Tipe Router (0-indexed)
            table.column(12).visible(show); // Redaman GenieACS
            table.column(13).visible(show); // Redaman OLT
            table.column(14).visible(show); // Status OLT
            table.column(15).visible(show); // Suhu
            table.column(16).visible(show); // Tipe Router

            // Note: DataTables `visible` method is usually sufficient.
        }

        async function initializePage() {
            // Fetch initial data needed for dropdowns
            await fetchNetworkAssets();
            
            // Load PPPoE data asynchronously in background without blocking
            // Data will load independently and update UI when ready
            setTimeout(() => {
                fetchActivePppoeUsers(false); // false = don't show loading on initial load
            }, 2000); // Delay 2 seconds to let page load first

            // Load OLT data asynchronously in background
            setTimeout(() => {
                fetchOltData(false); // false = don't show loading on initial load
            }, 3000); // Delay 3 seconds to let page load first

            fetch('/api/packages').then(res => res.json().then(({ data }) => {
                const createSubscriptionSelect = document.getElementById('create_subscription');
                const editSubscriptionSelect = document.getElementById('edit_subscription');

                if(createSubscriptionSelect) createSubscriptionSelect.innerHTML = '<option value="">-- Pilih Paket --</option>';
                if(editSubscriptionSelect) editSubscriptionSelect.innerHTML = '<option value="">-- Pilih Paket --</option>';

                if(data && Array.isArray(data)){
                    data.forEach(v => {
                        if(createSubscriptionSelect) createSubscriptionSelect.add(new Option(v.name, v.name));
                        if(editSubscriptionSelect) editSubscriptionSelect.add(new Option(v.name, v.name));
                    });
                }

                if (createSubscriptionSelect) {
                    if ($(createSubscriptionSelect).data('select2')) { $(createSubscriptionSelect).select2('destroy'); }
                    $(createSubscriptionSelect).select2({
                        theme: "bootstrap",
                        dropdownParent: $('#createModal'),
                        placeholder: '-- Pilih Paket --'
                    });
                }
                if (editSubscriptionSelect) {
                    if ($(editSubscriptionSelect).data('select2')) { $(editSubscriptionSelect).select2('destroy'); }
                    $(editSubscriptionSelect).select2({
                        theme: "bootstrap",
                        dropdownParent: $('#editModal'),
                        placeholder: '-- Pilih Paket --'
                    });
                }
            }));

            populateOdcDropdowns('create_connected_odc');
            populateOdcDropdowns('edit_connected_odc');
            populateOdcFilterDropdown();
            populateOdpFilterDropdown(null);

            if (dataTableInstance) {
                dataTableInstance.destroy();
            }
            dataTableInstance = $('#dataTable').DataTable({
                destroy: true,
                processing: true,
                serverSide: false, // Set to false if all data is loaded at once
                ajax: {
                    url: '/api/users',
                    dataSrc: 'data', // Ensure this matches your backend response structure { data: [...] }
                    complete: function(xhr, status) {
                        if (status === 'success') {
                            console.log("Users data loaded successfully. Initial column visibility set.");
                             // Initially hide the columns
                            toggleDeviceMetricColumns(false);
                            // Set refresh button state
                            updateRefreshButtonState();
                        } else {
                            console.error("Failed to load users data for DataTables. Status:", status, "XHR:", xhr);
                            displayGlobalUserMessage(`Gagal memuat data pelanggan: ${xhr.statusText || 'Error tidak diketahui'}`, 'danger', true); // Use modal for this error
                        }
                    }
                },
                columns: [
                    { data: 'id' },
                    { data: 'name' },
                    { data: 'phone_number', render: (data) => data ? data.split("|").join(", ") : '' },
                    { data: 'device_id' },
                    { data: 'address' },
                    // Kolom TITIK sekaligus jadi tombol (kembar dgn panel admin). Sel kosong bukan
                    // "N/A" pasif melainkan ajakan bertindak — mengisi titik adalah pekerjaan yang
                    // memang menumpuk, dan teknisi-lah yang paling sering ada di depan rumahnya.
                    {
                        data: null,
                        render: (data, type, row) => {
                            const punya = row.latitude && row.longitude;
                            const label = punya
                                ? `${parseFloat(row.latitude).toFixed(4)}, ${parseFloat(row.longitude).toFixed(4)}`
                                : '❌ belum ada';
                            const sumber = row.location_source ? ` title="sumber: ${row.location_source}"` : '';
                            return `<button type="button" class="btn btn-sm ${punya ? 'btn-outline-secondary' : 'btn-outline-warning'} btn-set-lokasi"`
                                + ` data-id="${row.id}" data-name="${(row.name || '').replace(/"/g, '&quot;')}"`
                                + ` data-lat="${row.latitude || ''}" data-lng="${row.longitude || ''}"`
                                + ` data-source="${row.location_source || ''}" data-updated="${row.location_updated_at || ''}"${sumber}>`
                                + `<i class="fas fa-map-pin"></i> ${label}</button>`;
                        }
                    },
                    {
                        data: 'connected_odp_id',
                        render: function(data, type, row) {
                            if (type === 'display') {
                                if (data && allOdpList.length > 0) {
                                    const odp = allOdpList.find(o => String(o.id) === String(data));
                                    return odp ? `${odp.name || 'ODP Tanpa Nama'} <small>(${odp.id})</small>` : `ID: ${data} (Tidak Ditemukan)`;
                                }
                                return 'Tidak Terhubung';
                            }
                            return data;
                        }
                    },
                    { data: 'subscription' },
                    { data: 'paid', render: (data) => (data === true || String(data).toLowerCase() === 'true' ? "Sudah " : "Belum ") + "Bayar" },
                    { data: 'pppoe_username' },
                    {
                        data: 'pppoe_username',
                        title: 'Status',
                        render: function(data, type, row) {
                            if (type === 'display') {
                                if (!row.pppoe_username) {
                                    return '<span class="badge badge-secondary">N/A</span>';
                                }
                                if (initialPppoeLoadFailed) {
                                    return '<span class="badge badge-warning">Unknown</span>';
                                }
                                if (activePppoeUsersMap.has(row.pppoe_username)) {
                                    return '<span class="badge badge-success">Online</span>';
                                } else {
                                    return '<span class="badge badge-danger">Offline</span>';
                                }
                            }
                            if (!row.pppoe_username) return 'N/A';
                            if (initialPppoeLoadFailed) return 'Unknown';
                            return activePppoeUsersMap.has(row.pppoe_username) ? 'Online' : 'Offline';
                        }
                    },
                    {
                        data: 'pppoe_username',
                        title: 'IP Pelanggan',
                        render: function(data, type, row) {
                            if (type === 'display') {
                                if (!row.pppoe_username) {
                                    return 'N/A';
                                }
                                if (initialPppoeLoadFailed) {
                                    return 'Unknown';
                                }
                                const ip = activePppoeUsersMap.get(row.pppoe_username);
                                return ip ? ip : 'Offline';
                            }
                            const ipForSort = activePppoeUsersMap.get(row.pppoe_username);
                            return ipForSort ? ipForSort : '';
                        }
                    },
                    // Display columns for main metrics (Redaman, Suhu, Tipe Router)
                    // These columns will be hidden/shown by JS
                    {
                        data: 'device_id',
                        title: 'Redaman (dBm)',
                        className: 'redaman-column', // Add class for easy targeting
                        render: function(data, type, row) {
                            // Only display data if a filter is active
                            const selectedOdcId = $('#odcFilterDropdown').val();
                            const selectedOdpId = $('#odpFilterDropdown').val();
                            if (type === 'display' && (selectedOdcId || selectedOdpId)) {
                                if (!data) return DEVICE_NOT_FOUND;
                                const cached = deviceDataCache.get(data);
                                if (cached) return cached.redaman;
                                return LOADING_HTML;
                            }
                            return ''; // Hide content if no filter selected
                        }
                    },
                    // Redaman OLT column - RX Power from OLT HIOSO
                    {
                        data: 'pppoe_username',
                        title: 'Redaman OLT',
                        className: 'redaman-olt-column',
                        render: function(data, type, row) {
                            const selectedOdcId = $('#odcFilterDropdown').val();
                            const selectedOdpId = $('#odpFilterDropdown').val();
                            
                            if (type === 'display' && (selectedOdcId || selectedOdpId)) {
                                if (!oltEnabled) {
                                    return '<span class="text-muted" title="OLT tidak aktif">-</span>';
                                }
                                
                                if (!row.pppoe_username) {
                                    return '<span class="text-muted">-</span>';
                                }
                                
                                if (oltDataLoading) {
                                    return LOADING_HTML;
                                }
                                
                                // Get MAC address from pppoeUserMacMap
                                const mikrotikMac = pppoeUserMacMap.get(row.pppoe_username);
                                if (!mikrotikMac) {
                                    if (!activePppoeUsersMap.has(row.pppoe_username)) {
                                        return '<span class="text-muted" title="Pelanggan offline">-</span>';
                                    }
                                    return '<span class="text-muted" title="MAC tidak tersedia">-</span>';
                                }
                                
                                // Get OLT data by MAC
                                const oltData = getOltDataByMac(mikrotikMac);
                                if (!oltData) {
                                    return '<span class="text-muted" title="Data OLT tidak ditemukan">-</span>';
                                }
                                
                                // Render RX Power with color coding
                                const rxPower = oltData.rx_power;
                                if (!rxPower || rxPower === 'N/A') {
                                    return '<span class="text-muted">N/A</span>';
                                }
                                
                                // Parse numeric value for color coding
                                const rxValue = parseFloat(rxPower);
                                let colorClass = 'text-success'; // Good signal
                                if (rxValue < -25) {
                                    colorClass = 'text-danger'; // Bad signal
                                } else if (rxValue < -20) {
                                    colorClass = 'text-warning'; // Warning
                                }
                                
                                return `<span class="${colorClass}" title="RX Power dari OLT">${rxPower}</span>`;
                            }
                            return '';
                        }
                    },
                    // OLT Status column - shows status from OLT HIOSO (Dying Gasp, LOS, Online/Offline)
                    {
                        data: 'pppoe_username',
                        title: 'Status OLT',
                        className: 'olt-status-column',
                        render: function(data, type, row) {
                            const selectedOdcId = $('#odcFilterDropdown').val();
                            const selectedOdpId = $('#odpFilterDropdown').val();
                            
                            if (type === 'display' && (selectedOdcId || selectedOdpId)) {
                                if (!oltEnabled) {
                                    return '<span class="text-muted" title="OLT tidak aktif">-</span>';
                                }
                                
                                // Get MAC from PPPoE active session (caller-id)
                                if (!row.pppoe_username) {
                                    return '<span class="text-muted">-</span>';
                                }
                                
                                // Check if OLT data is still loading
                                if (oltDataLoading) {
                                    return LOADING_HTML;
                                }
                                
                                // Get MAC address from pppoeUserMacMap
                                const mikrotikMac = pppoeUserMacMap.get(row.pppoe_username);
                                if (!mikrotikMac) {
                                    // User is offline or MAC not available
                                    if (!activePppoeUsersMap.has(row.pppoe_username)) {
                                        return '<span class="text-muted" title="Pelanggan offline">-</span>';
                                    }
                                    return '<span class="text-muted" title="MAC tidak tersedia">-</span>';
                                }
                                
                                // Get OLT data by MAC
                                const oltData = getOltDataByMac(mikrotikMac);
                                return renderOltStatus(oltData);
                            }
                            return '';
                        }
                    },
                    {
                        data: 'device_id',
                        title: 'Suhu (°C)',
                        className: 'suhu-column', // Add class for easy targeting
                        render: function(data, type, row) {
                             // Only display data if a filter is active
                            const selectedOdcId = $('#odcFilterDropdown').val();
                            const selectedOdpId = $('#odpFilterDropdown').val();
                            if (type === 'display' && (selectedOdcId || selectedOdpId)) {
                                if (!data) return DEVICE_NOT_FOUND;
                                const cached = deviceDataCache.get(data);
                                if (cached) return cached.temperature;
                                return LOADING_HTML;
                            }
                            return ''; // Hide content if no filter selected
                        }
                    },
                    {
                        data: 'device_id',
                        title: 'Tipe Router',
                        className: 'tipe-router-column', // Add class for easy targeting
                        render: function(data, type, row) {
                            // Only display data if a filter is active
                            const selectedOdcId = $('#odcFilterDropdown').val();
                            const selectedOdpId = $('#odpFilterDropdown').val();
                            if (type === 'display' && (selectedOdcId || selectedOdpId)) {
                                if (!data) return DEVICE_NOT_FOUND;
                                const cached = deviceDataCache.get(data);
                                if (cached) return cached.modemType;
                                return LOADING_HTML;
                            }
                            return ''; // Hide content if no filter selected
                        }
                    },
                    {
                        data: null,
                        "orderable": false,
                        "searchable": false,
                        render: function(data, type, row) {
                            const deviceIdForActions = row.device_id || '';
                            const customerName = row.name || `Pelanggan ${row.id}`; // Get customer name for modal title

                            // MODIFIED: All action buttons within a single flex container for horizontal layout
                            let actionButtonsHtml = `
                                <div class="device-action-group">`;

                            if (deviceIdForActions && deviceIdForActions.length > 0) {
                                actionButtonsHtml += `
                                    <button class='btn btn-secondary btn-sm btn-update-ssid' data-id='${deviceIdForActions}' title='Update SSID'><i class='fas fa-wifi'></i></button>
                                    <button class='btn btn-primary btn-sm btn-view-connected-devices' data-device-id='${deviceIdForActions}' data-customer-name='${customerName}' title='Lihat Perangkat Terhubung'>
                                        <i class='fas fa-users'></i>
                                    </button>
                                    <a class='btn btn-warning btn-sm btn-reboot-device' href='#' data-device='${deviceIdForActions}' title='Reboot Device (${deviceIdForActions})'><i class='fas fa-power-off'></i></a>
                                `;
                            } else {
                                actionButtonsHtml += `<span class="text-muted small ml-1">No Device ID</span>`;
                            }

                            // Close the action group div. The delete button now sits outside this flex container
                            // to ensure it's on a new line, but still within the overall cell.
                            actionButtonsHtml += `</div>`;

                            return actionButtonsHtml;
                        }
                    }
                ],
                "columnDefs": [
                    { "width": "3%", "targets": 0 },  // ID
                    { "width": "7%", "targets": 10 }, // Status
                    { "width": "10%", "targets": 11}, // IP Pelanggan
                    { "width": "7%", "targets": 12}, // Redaman GenieACS - index 12
                    { "width": "7%", "targets": 13}, // Redaman OLT - index 13
                    { "width": "7%", "targets": 14}, // Status OLT - index 14
                    { "width": "7%", "targets": 15}, // Suhu - index 15
                    { "width": "7%", "targets": 16}, // Tipe Router - index 16
                    { "width": "15%", "targets": 17 } // Action - index 17
                ],
                "order": [[0, 'desc']]
            });
            // Initial hide of device metric columns
            toggleDeviceMetricColumns(false);
            // DO NOT trigger fetchAndCacheDeviceData(null) here. It will be called on filter change.
        }

        function editOdcChangeHandler() {
            const selectedOdcId = $(this).val();
            const currentOdpId = $('#edit_connected_odp').data('current-odp'); // Get the user's *current* connected ODP
            populateOdpDropdowns('edit_connected_odp', currentOdpId, selectedOdcId);
            if (!selectedOdcId) {
                $('#edit_connected_odp').val(null).trigger('change.select2');
            }
        }

        // Function to update the state of the "Refresh Data" button
        function updateRefreshButtonState() {
            const selectedOdcId = $('#odcFilterDropdown').val();
            const selectedOdpId = $('#odpFilterDropdown').val();
            const isFilterActive = !!selectedOdcId || !!selectedOdpId;
            $('#refreshDataBtn').prop('disabled', !isFilterActive);
        }

        $(document).ready(function() {
            initializePage();

            // NEW: Event listener for "Tambahkan ke MikroTik" checkbox
            $('#create_add_to_mikrotik').on('change', function() {
                const isChecked = $(this).is(':checked');
                // PPPoE fields are now always visible, only required status is toggled
                $('#create_pppoe_username').prop('required', isChecked);
                $('#create_pppoe_password').prop('required', isChecked);
            });
            // Set initial required state on page load (for create modal)
            $('#create_pppoe_username').prop('required', $('#create_add_to_mikrotik').is(':checked'));
            $('#create_pppoe_password').prop('required', $('#create_add_to_mikrotik').is(':checked'));


            // === START PERFECT FIX FOR SIDEBAR AUTO-TOGGLE ===

            // Disable all scroll-based sidebar behavior from SB Admin 2
            // This includes the automatic collapse/expand and scroll wheel handling.
            $(window).off('scroll.sb_admin_2'); // Remove window scroll listener
            $('body.fixed-nav .sidebar').off('mousewheel DOMMouseScroll wheel'); // Remove sidebar scroll listener

            // Override the default SB Admin 2 toggle function to only use click
            // This targets the function that changes 'body' classes and ensures it's only called on click.
            $("#sidebarToggle, #sidebarToggleTop").off('click').on('click', function(e) {
                e.preventDefault(); // Prevent default button behavior

                // Toggle the classes responsible for showing/hiding sidebar
                $("body").toggleClass("sidebar-toggled");
                $(".sidebar").toggleClass("toggled");

                // On desktop, if sidebar is toggled (minimized to icons), ensure open collapse menus are closed
                // This is the default SB Admin 2 behavior for clean icon view.
                if ($(".sidebar").hasClass("toggled")) {
                    $('.sidebar .collapse').collapse('hide');
                } else {
                    // When sidebar is NOT toggled (expanded), allow collapse menus to be managed normally.
                    // This is crucial for sub-menus to stay open when you manually expand the sidebar.
                    // We specifically do NOT call collapse('hide') here.
                }

                // If on mobile (d-md-none), after clicking to open, you might want to click outside to close.
                // SB Admin 2 handles this via its CSS overlay; no extra JS needed here usually.
            });

            // Ensure collapse menus do not auto-hide/toggle based on sidebar state changes
            // This prevents the problem where sub-menus close when you try to scroll.
            $('.sidebar .collapse').on('hide.bs.collapse', function(event) {
                // Only allow hiding if the sidebar is currently minimized by the user's action
                // OR if it's explicitly hidden by Bootstrap's collapse mechanism (e.e., another menu opened)
                // The "sidebar-toggled" check here ensures that when the sidebar becomes minimized,
                // any currently open sub-menu (collapse) is properly hidden. This is correct behavior
                // for the "icon-only" view.
                // The problem was when EXPANDING the sidebar, and then scrolling.
                // The main fix is preventing the *scroll* listener from toggling the sidebar.
            });

            // On larger screens (non-mobile), if sidebar starts collapsed or is manually collapsed,
            // the content area should adjust. This CSS is usually tied to .sidebar-toggled.
            // We just need to ensure .sidebar-toggled is only set/unset by the button click.

            // Ensure the main sidebar button also triggers the same logic as sidebarToggleTop
            $('#sidebarToggle').off('click').on('click', function(e) {
                e.preventDefault();
                $("#sidebarToggleTop").trigger('click'); // Simply trigger the top button's logic
            });

            // === END PERFECT FIX FOR SIDEBAR AUTO-TOGGLE ===


            $('#createModal').on('show.bs.modal', function () {
                $('#create_number_container').empty();
                addNumberField('create_number_container', "", true);
            });

            // Refresh PPPoE button handler
            $('#refreshPppoeBtn').on('click', function() {
                fetchActivePppoeUsers(true);
            });

            // Event handler for reboot device button
            $(document).on('click', '.btn-reboot-device', function(e) {
                e.preventDefault();
                const deviceId = $(this).data('device');
                
                if (!confirm(`Anda yakin ingin reboot device ini (${deviceId})?`)) {
                    return;
                }
                
                fetch(`/api/reboot/${deviceId}`, { method: 'GET', credentials: 'include' })
                    .then(res => {
                        if (!res.ok) {
                            return res.json().then(errData => {
                                throw new Error(errData.message || 'Server error: ' + res.status);
                            }).catch(() => {
                                throw new Error('Server error: ' + res.status + ', respons tidak valid.');
                            });
                        }
                        return res.json();
                    })
                    .then(data => {
                        displayGlobalUserMessage(data.message || 'Perintah reboot dikirim.', data.status === 200 ? 'success' : 'warning');
                        deviceDataCache.delete(deviceId);
                        debouncedFetchDeviceData(deviceId);
                    })
                    .catch(err => {
                        displayGlobalUserMessage('Gagal mengirim perintah reboot: ' + err.message, 'danger');
                    });
            });

            // Filter dropdowns only update other dropdowns, not trigger filtering directly
            $('#odcFilterDropdown').on('change', function() {
                const selectedOdcId = $(this).val();
                populateOdpFilterDropdown(selectedOdcId ? allOdpList.filter(odp => String(odp.parent_odc_id) === selectedOdcId) : null);
                updateRefreshButtonState();
            });

            $('#odpFilterDropdown').on('change', function() {
                updateRefreshButtonState();
            });

            // New: Event listener for "Terapkan Filter" button
            $('#applyUserFilters').on('click', function() {
                const selectedOdcId = $('#odcFilterDropdown').val();
                const selectedOdpId = $('#odpFilterDropdown').val();

                deviceDataCache.clear(); // Clear cache before applying new filter

                if (selectedOdcId || selectedOdpId) {
                    toggleDeviceMetricColumns(true); // Show columns
                    // Re-draw DataTable first to apply filters, then fetch GenieACS data for the visible rows
                    if (dataTableInstance) {
                        dataTableInstance.draw();
                        fetchAndCacheDeviceData(null); // Fetch metrics for visible rows
                    }
                } else {
                    // If no filter is selected when "Apply Filter" is clicked, clear all filters
                    // and hide columns
                    clearUserFilters();
                    displayGlobalUserMessage("Tidak ada filter ODC atau ODP yang dipilih. Menampilkan semua data.", "info", true);
                }
                updateRefreshButtonState();
            });

            // Clear filter button behavior
            $('#clearUserFilters').on('click', function() {
                clearUserFilters();
                updateRefreshButtonState();
            });

            function clearUserFilters() {
                $('#odcFilterDropdown').val("").trigger('change.select2'); // This will also reset ODP dropdown via change handler
                $('#odpFilterDropdown').val("").trigger('change.select2'); // Ensure ODP filter is also cleared

                toggleDeviceMetricColumns(false); // Explicitly hide when clearing all filters
                deviceDataCache.clear(); // Clear cache when filters are cleared
                if (dataTableInstance) dataTableInstance.rows().invalidate('data').draw('page'); // Redraw to clear values
                updateRefreshButtonState();
            }

            // "Refresh Data" button now directly triggers the refreshAllData function
            $('#refreshDataBtn').on('click', function() {
                refreshAllData();
            });


            $.fn.dataTable.ext.search.push(
                function(settings, data, dataIndex) {
                    if (settings.nTable.id !== 'dataTable') return true;

                    const rowData = settings.aoData[dataIndex]._aData;
                    const userOdpId = rowData.connected_odp_id ? String(rowData.connected_odp_id) : null;
                    const selectedOdcId = $('#odcFilterDropdown').val();
                    const selectedOdpId = $('#odpFilterDropdown').val();

                    if (selectedOdpId && selectedOdpId !== "") {
                        return userOdpId === selectedOdpId;
                    } else if (selectedOdcId && selectedOdcId !== "") {
                        if (!userOdpId) return false;
                        const userOdpDetails = allOdpList.find(odp => String(odp.id) === userOdpId);
                        return userOdpDetails ? String(userOdpDetails.parent_odc_id) === selectedOdcId : false;
                    }
                    return true;
                }
            );

            $('#create_connected_odc').on('change', function() {
                const selectedOdcId = $(this).val();
                populateOdpDropdowns('create_connected_odp', null, selectedOdcId);
                if (!selectedOdcId) {
                    $('#create_connected_odp').val(null).trigger('change.select2');
                }
            });

            $('#edit_connected_odc').on('change', editOdcChangeHandler);

            // Event listener for "Muat SSID" button in Create modal
            $('#load_create_ssid_btn').on('click', function() {
                const deviceId = $('#create_device_id').val();
                const btn = $(this);
                const originalText = btn.html();
                btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Memuat...');
                populateBulkSSIDContainer('bulk-container', deviceId).finally(() => {
                    btn.prop('disabled', false).html(originalText);
                });
            });

            // Event listener for "Muat SSID" button in Edit modal
            $('#load_edit_ssid_btn').on('click', function() {
                const deviceId = $('#edit_device_id_modal').val();
                let existingBulkDataForCurrentUser = $('#editModal').data('bulk-ssids') || [];
                if (typeof existingBulkDataForCurrentUser === 'string') {
                    existingBulkDataForCurrentUser = existingBulkDataForCurrentUser.split(',').filter(Boolean).map(String);
                } else if (!Array.isArray(existingBulkDataForCurrentUser)) {
                    existingBulkDataForCurrentUser = [];
                }
                const btn = $(this);
                const originalText = btn.html();
                btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Memuat...');
                populateBulkSSIDContainer('edit-bulk-container', deviceId, existingBulkDataForCurrentUser).finally(() => {
                    btn.prop('disabled', false).html(originalText);
                });
            });

            // Event listener for 'Lihat Perangkat Terhubung' button
            $(document).on('click', '.btn-view-connected-devices', function() {
                const deviceId = $(this).data('device-id');
                const customerName = $(this).data('customer-name');
                fetchAndDisplayConnectedDevicesModal(deviceId, customerName);
            });
        });

        function addNumberField(containerId, value = "", isFirstCallForContainer = false) {
            const id = `tel_${new Date().getTime()}_${Math.random().toString(16).slice(2)}`;
            const container = document.getElementById(containerId);
            if (!container) return;

            // When it's the first call for a container, clear existing content
            if(isFirstCallForContainer){
                container.innerHTML = '';
            }

            const fieldCount = container.querySelectorAll('.phone-number-item').length;
            // Only disable the delete button if it's the *only* field and it's the first time being added
            const disableDelete = fieldCount === 0 && isFirstCallForContainer;

            const newFieldHtml = `
                <div class="d-flex todo_field phone-number-item ${id}" style="gap: 0.25rem; margin-top: ${fieldCount > 0 ? '0.25rem' : '0'};">
                    <input type="number" class="form-control form-control-sm" style="width: 100%;" name="phone_number_${id}" value="${value}" placeholder="Contoh: 6281234567890" />
                    <button class="btn btn-danger btn-sm py-0 px-1" type="button" onclick="deleteField('${containerId}', '${id}')" ${disableDelete ? 'disabled' : ''}><i class="fas fa-trash"></i></button>
                </div>`;
            container.insertAdjacentHTML("beforeend", newFieldHtml);

            // Re-evaluate all delete buttons' disabled state after adding a new field
            const allCurrentFields = container.querySelectorAll('.phone-number-item');
            allCurrentFields.forEach(field => {
                const deleteButton = field.querySelector('button.btn-danger');
                if (deleteButton) {
                    deleteButton.disabled = (allCurrentFields.length === 1);
                }
            });
        }

        function deleteField(containerId, fieldClassId) {
            const fieldToRemove = document.querySelector(`#${containerId} .${fieldClassId}`);
            const container = document.getElementById(containerId);
            if (fieldToRemove) fieldToRemove.remove();

            const allCurrentFields = container.querySelectorAll('.phone-number-item');
            if (allCurrentFields.length === 0) {
                // If all fields are removed, add a fresh, empty, disabled-delete field
                addNumberField(containerId, "", true);
            } else if (allCurrentFields.length === 1) {
                // If only one field remains, disable its delete button
                const lastFieldDeleteButton = container.querySelector('.phone-number-item button.btn-danger');
                if (lastFieldDeleteButton) lastFieldDeleteButton.disabled = true;
            }
        }

        // Fungsi terpisah untuk mengisi container SSID
        async function populateBulkSSIDContainer(containerId, deviceId, existingBulkSSIDs = []) {
            const bulkContainer = document.getElementById(containerId);
            if (!bulkContainer) return;

            // Clear container first
            bulkContainer.innerHTML = '';

            if (!deviceId) {
                bulkContainer.innerHTML = '<small class="text-muted">Isi Device ID dan klik "Muat SSID" untuk memuat SSID.</small>';
                return;
            }

            bulkContainer.innerHTML = '<div class="loading-spinner-container"><i class="fas fa-spinner fa-spin"></i> Memuat SSID...</div>';

            try {
                const res = await fetch("/api/ssid/" + deviceId, {
                    credentials: 'include'
                });
                if (!res.ok) {
                    const errorJson = await res.json().catch(() => ({ message: res.statusText }));
                    throw new Error(errorJson.message || `Gagal mengambil data SSID: ${res.status}`);
                }
                const json = await res.json();

                if (json.data && Array.isArray(json.data.ssid)) {
                    if (json.data.ssid.length === 0) {
                        bulkContainer.innerHTML = '<small class="text-muted">Tidak ada SSID yang ditemukan untuk Device ID ini.</small>';
                    } else {
                        bulkContainer.innerHTML = `<label class="form-label">Samakan SSID</label><div class="">` + json.data.ssid.map((ssid, i) => {
                            const isChecked = existingBulkSSIDs.includes(String(ssid.id));
                            return `
                                <div class="form-check">
                                    <input type="checkbox" class="form-check-input" id="${containerId.replace('-', '_')}_bulk_${ssid.id}" name="bulk_${ssid.id}" value="${ssid.id}" ${isChecked ? 'checked' : ''}/>
                                    <label for="${containerId.replace('-', '_')}_bulk_${ssid.id}" class="form-check-label">SSID ${ssid.id}</label>
                                </div>`;
                        }).join("") + "</div>";
                    }
                } else {
                    bulkContainer.innerHTML = '<small class="text-muted">Format data SSID tidak sesuai atau data tidak ditemukan.</small>';
                }
            } catch (err) {
                bulkContainer.innerHTML = `<small class="text-danger">Gagal memuat SSID: ${err.message}.</small>`;
                console.error("Error loading SSID for bulk container:", err);
            }
        }

        // Removed Device ID input 'on input' debounce listeners as they are replaced by explicit buttons.

        $(document).on('click', '.btn-update-ssid', function() {
            const deviceId = $(this).data('id');
            if (!deviceId) {
                displayGlobalUserMessage('Device ID tidak ditemukan untuk tombol ini.', 'warning', true);
                return;
            }

            $('#ssid_update_device_id').val(deviceId);
            $('#ssidUpdateModalTitle').text('Perbarui SSID untuk Device: ' + deviceId);

            const ssidContainer = $('#edit-ssid-container');
            const passwordContainer = $('#edit-ssid-passwd-container');
            const transmitPowerSelect = $('#transmit_power');
            const loadingHtml = '<div class="loading-spinner-container"><i class="fas fa-spinner fa-spin"></i> <p>Memuat...</p></div>';

            ssidContainer.html(loadingHtml);
            passwordContainer.empty();
            transmitPowerSelect.val('');

            fetch('/api/ssid/' + deviceId, {
                credentials: 'include'
            })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(errData => {throw new Error(errData.message || `Gagal mengambil data SSID: ${response.status}`);}).catch(()=> {throw new Error(`Gagal mengambil data SSID: ${response.status}, respons tidak valid.`);});
                }
                return response.json();
            })
            .then(result => {
                ssidContainer.empty();
                if (result.data && Array.isArray(result.data.ssid)) {
                    if (result.data.ssid.length === 0) {
                        ssidContainer.html('<p class="text-muted">Tidak ada SSID yang terkonfigurasi atau ditemukan untuk perangkat ini.</p>');
                    }
                    
                    result.data.ssid.forEach(s => {
                        const ssidField = `
                            <div class="form-group">
                                <label for="modal_ssid_${s.id}" class="form-label">Nama SSID Baru (ID: ${s.id})</label>
                                <input type="text" class="form-control form-control-sm" id="modal_ssid_${s.id}" name="ssid_${s.id}" value="${rafEscapeHtml(s.name || '')}">
                            </div>`;
                        ssidContainer.append(ssidField);

                        const passwordField = `
                            <div class="form-group">
                                <label for="modal_ssid_password_${s.id}" class="form-label">Password Baru (ID: ${s.id})</label>
                                <input type="text" class="form-control form-control-sm" id="modal_ssid_password_${s.id}" name="ssid_password_${s.id}" placeholder="Kosongkan jika tidak diubah">
                            </div>`;
                        passwordContainer.append(passwordField);
                    });

                    if (result.data.ssid[0] && result.data.ssid[0].transmitPower) {
                         transmitPowerSelect.val(result.data.ssid[0].transmitPower);
                    } else if (result.data.transmitPower) {
                        transmitPowerSelect.val(result.data.transmitPower);
                    } else {
                         transmitPowerSelect.val('');
                    }

                    } else {
                        ssidContainer.html('<p class="text-danger">Format data SSID tidak sesuai atau data tidak ditemukan.</p>');
                    }
                    $('#ssid-update').modal('show');
                })
                .catch(error => {
                    console.error('Error fetching SSID info:', error);
                    ssidContainer.html(`<p class="text-danger">Terjadi kesalahan saat memuat data SSID: ${error.message}</p>`);
                    $('#ssid-update').modal('show');
                });
        });

        $('#ssidUpdateForm').on('submit', function(event) {
            event.preventDefault();
            const deviceId = $('#ssid_update_device_id').val();
            if (!deviceId) {
                displayGlobalUserMessage('Device ID tidak ada untuk menyimpan perubahan SSID.', 'danger', true);
                return;
            }

            const formData = new FormData(this);
            const payload = {};

            for (let [key, value] of formData.entries()) {
                if (key === "device_id_for_ssid_update") continue;
                if (key.startsWith('ssid_password_') && value.trim() === '') {
                    continue;
                }
                 payload[key] = value;
            }

            const submitButton = $('#saveSsidChangesBtn');
            const originalButtonText = submitButton.html();
            submitButton.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Menyimpan...');

            fetch('/api/ssid/' + deviceId, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                credentials: 'include', // ✅ Fixed by script
                body: JSON.stringify(payload)
            })
            .then(response => response.json().then(data => ({ ok: response.ok, status: response.status, data })))
            .then(result => {
                if (result.ok && result.data.status === 200) {
                    $('#ssid-update').modal('hide');
                    displayGlobalUserMessage(result.data.message || 'Perubahan SSID berhasil dikirim.', 'success', true);
                } else {
                    displayGlobalUserMessage(`Gagal mengirim perubahan SSID: ${result.data.message || 'Error tidak diketahui'} (Status: ${result.status})`, 'danger', true);
                }
            })
            .catch(error => {
                console.error('Error submitting SSID changes:', error);
                displayGlobalUserMessage('Terjadi kesalahan fatal saat mengirim perubahan SSID: ' + error.message, 'danger', true);
            })
            .finally(() => {
                submitButton.prop('disabled', false).html(originalButtonText);
            });
        });
