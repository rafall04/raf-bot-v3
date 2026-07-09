/* global fetchConnectedDevicesData */
        // PASTIKAN HALAMAN INI DIAKSES MELALUI HTTPS JIKA BUKAN DARI LOCALHOST
        // Geolocation API membutuhkan konteks aman (HTTPS) untuk berfungsi dengan baik di banyak browser.
        if (window.location.protocol !== "https:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
            // Warning: HTTP access - geolocation may not work
        }

        let createUserMapInstance = null;
        let editUserMapInstance = null;
        let createUserMarker = null;
        let editUserMarker = null;
        let currentUsername = "Admin";
        
        // Update user header dengan helper function (menggunakan name dari JWT)
        // Script helper akan otomatis memprioritaskan payload.name
        // Tidak perlu manual decode karena sudah di-handle oleh helper
        let allOdcList = [];
        let allOdpList = [];
        let dataTableInstance = null;
        let activePppoeUsersMap = new Map(); // Stores PPPoE username -> IP address
        let initialPppoeLoadFailed = false;
        let pppoeDataLoading = true; // Track loading state for PPPoE data

        // Cache untuk metrik utama perangkat (Redaman, Suhu, Tipe Router)
        // Key: deviceId, Value: { redaman: '...', temperature: '...', modemType: '...', _loading: false }
        const deviceDataCache = new Map();
        
        // Debug mode & performance monitoring
        const DEBUG = true;
        let apiCallCount = 0;
        
        // Track intervals to prevent duplicates
        let pppoeRefreshInterval = null;
        let lastPppoeFetch = 0;
        const MIN_FETCH_INTERVAL = 30000; // Minimum 30 seconds between fetches
        let queuedPppoeRefresh = null;
        let lastPppoeUpdatedAt = null;
        let excelImportPreviewReady = false;
        let excelImportBusy = false;
        // Filter tampilan tabel berdasarkan jenis akun: 'pelanggan' (default) | 'infrastruktur' | 'all'.
        // Akun infrastruktur (mis. modem CCTV/monitoring) disembunyikan dari daftar pelanggan default.
        let currentAccountTypeView = 'pelanggan';

        const LOADING_HTML = '<div class="spinner-border spinner-border-sm text-primary" role="status" style="width: 1rem; height: 1rem;"><span class="sr-only">Loading...</span></div>';
        const NOT_APPLICABLE = 'N/A';
        const ERROR_FETCHING = '<span class="text-danger" title="Gagal memuat data">Error</span>';
        const DEVICE_NOT_FOUND = '<span class="text-muted" title="Tidak ada Device ID">N/A</span>';


        let pppoeLoadingInProgress = false;

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
                // PPPoE fetch skipped - already loading
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
                    result.data.forEach(userEntry => {
                        if (userEntry.name && userEntry.address) {
                            activePppoeUsersMap.set(userEntry.name, userEntry.address);
                        }
                    });
                    lastPppoeUpdatedAt = result.last_updated_at || new Date().toISOString();
                    
                    // PPPoE users loaded successfully
                    
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


        async function fetchNetworkAssets() {
            try {
                const response = await fetch(`/api/map/network-assets?_=${new Date().getTime()}`, {
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
            
            // Force update select2 untuk memastikan text terlihat setelah value di-set
            // Gunakan multiple timeout untuk memastikan select2 sudah ter-render
            setTimeout(() => {
                const $container = selectElement.next('.select2-container');
                if ($container.length) {
                    const $rendered = $container.find('.select2-selection__rendered');
                    if ($rendered.length) {
                        $rendered.css({
                            'color': '#212529 !important',
                            'background-color': 'transparent'
                        });
                        // Force update text content jika perlu
                        const selectedText = selectElement.find('option:selected').text();
                        if (selectedText && selectedText !== '-- Pilih ODC --') {
                            $rendered.text(selectedText);
                        }
                    }
                }
            }, 100);
            
            // Double check setelah 200ms
            setTimeout(() => {
                const $container = selectElement.next('.select2-container');
                if ($container.length) {
                    const $rendered = $container.find('.select2-selection__rendered');
                    if ($rendered.length) {
                        $rendered.css('color', '#212529');
                    }
                }
            }, 200);
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
            
            // Force update select2 untuk memastikan text terlihat setelah value di-set
            setTimeout(() => {
                const $container = selectElement.next('.select2-container');
                const $rendered = $container.find('.select2-selection__rendered');
                if ($rendered.length) {
                    $rendered.css({
                        'color': '#212529',
                        'background-color': 'transparent'
                    });
                }
            }, 50);
            
            // Force update select2 untuk memastikan text terlihat
            setTimeout(() => {
                const $rendered = selectElement.next('.select2-container').find('.select2-selection__rendered');
                if ($rendered.length) {
                    $rendered.css('color', '#212529');
                }
            }, 100);
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
                    // User name sudah di-handle oleh topbar.php via /api/me
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


        function handleGeolocationErrorUserModal(error, contextMessage, displayTarget, fallbackLat, fallbackLng, mapUpdaterFn) {
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
            if (fallbackLat && fallbackLng && mapUpdaterFn) {
                 errorText += "<br/>Menampilkan lokasi default.";
                 mapUpdaterFn(L.latLng(fallbackLat, fallbackLng), false);
            }
            displayTarget(errorText, 'danger', true); // Use modal for geolocation errors
        }

        function processSuccessfulGeolocationUserModal(position, contextMessage, displayTarget, mapUpdaterFn, buttonContainer, originalIcon) {
            // GPS location obtained
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
            // GPS accuracy logged

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
                            // Requesting GPS location
                            if (navigator.geolocation) {
                                navigator.geolocation.getCurrentPosition(
                                    (position) => processSuccessfulGeolocationUserModal(position, "Tombol GPS", displayGlobalUserMessage, updateMarkerAndInputsUser, container, originalIconHTML),
                                    (error) => {
                                        handleGeolocationErrorUserModal(error, "Gagal dari Tombol GPS", displayGlobalUserMessage, defaultLat, defaultLng, updateMarkerAndInputsUser);
                                        container.innerHTML = originalIconHTML;
                                    },
                                    geolocationOptions
                                );
                            } else {
                                handleGeolocationErrorUserModal({code: -1, message: "Browser tidak mendukung geolokasi."}, "Gagal dari Tombol GPS", displayGlobalUserMessage, defaultLat, defaultLng, updateMarkerAndInputsUser);
                                container.innerHTML = originalIconHTML;
                            }
                        });
                    return container;
                }
            });
            new GpsControl().addTo(mapInstance);

            if (!isEditMode || (!initialLat || !initialLng)) {
                 // Attempting to get initial GPS location
                 if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(
                        (position) => processSuccessfulGeolocationUserModal(position, "Inisialisasi Peta", displayGlobalUserMessage, updateMarkerAndInputsUser),
                        (error) => {
                            if (!markerInstance) {
                                handleGeolocationErrorUserModal(error, "Gagal Inisialisasi Peta", displayGlobalUserMessage, defaultLat, defaultLng, updateMarkerAndInputsUser);
                            } else {
                                // GPS initialization failed, but marker exists from initial data
                            }
                        },
                        geolocationOptions
                    );
                } else if (!markerInstance) {
                     handleGeolocationErrorUserModal({code: -1, message: "Browser tidak mendukung geolokasi."}, "Gagal Inisialisasi Peta", displayGlobalUserMessage, defaultLat, defaultLng, updateMarkerAndInputsUser);
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
            updatePhoneAddButtonState('create_number_container');
            populateOdcDropdowns('create_connected_odc');
            populateOdpDropdowns('create_connected_odp', null);
            initializeUserMapWithGPS('createUserMap', 'create_latitude', 'create_longitude', null, null, false);
            
            // Clear bulk container on modal open
            $('#bulk-container').empty(); 

            // Reset registration mode to default (Mode New)
            $('#mode_new').prop('checked', true);
            switchRegistrationMode('new');
            resetRegistrationForm();
        });

        $('#editModal').on('shown.bs.modal', function () {
            const lat = $('#edit_latitude').val();
            const lng = $('#edit_longitude').val();
            const connectedOdpId = $(this).find('#edit_connected_odp').data('current-odp');
            const preselectOdcId = $(this).find('#edit_connected_odc').data('current-odc');
            const deviceId = $('#edit_device_id_modal').val(); 
            let existingBulkData = $(this).data('bulk-ssids') || []; 
            // Ensure existingBulkData is an array of strings
            // Handle different formats: string JSON, comma-separated string, or array
            if (typeof existingBulkData === 'string') {
                // Try to parse as JSON first
                try {
                    const parsed = JSON.parse(existingBulkData);
                    if (Array.isArray(parsed)) {
                        existingBulkData = parsed.map(idx => String(idx));
                    } else {
                        // If not array, try comma-separated string
                        existingBulkData = existingBulkData.split(',').filter(Boolean).map(String);
                    }
                } catch (e) {
                    // If JSON parse fails, try comma-separated string
                    existingBulkData = existingBulkData.split(',').filter(Boolean).map(String);
                }
            } else if (Array.isArray(existingBulkData)) {
                // Normalize array values to strings
                existingBulkData = existingBulkData.map(idx => String(idx));
            } else {
                existingBulkData = [];
            }
            
            // Bulk SSIDs loaded for edit modal


            $('#edit_connected_odc').off('change', editOdcChangeHandler);
            populateOdcDropdowns('edit_connected_odc', preselectOdcId);
            populateOdpDropdowns('edit_connected_odp', connectedOdpId, preselectOdcId);
            $('#edit_connected_odc').on('change', editOdcChangeHandler);
            
            // Force update select2 untuk memastikan text terlihat setelah modal dibuka
            setTimeout(() => {
                $('#edit_connected_odc, #edit_connected_odp').each(function() {
                    const $container = $(this).next('.select2-container');
                    if ($container.length) {
                        const $rendered = $container.find('.select2-selection__rendered');
                        if ($rendered.length) {
                            $rendered.css('color', '#212529');
                        }
                    }
                });
            }, 200);
            
            // Force update select2 untuk memastikan text terlihat setelah modal dibuka
            setTimeout(() => {
                $('#edit_connected_odc, #edit_connected_odp').each(function() {
                    const $container = $(this).next('.select2-container');
                    if ($container.length) {
                        const $rendered = $container.find('.select2-selection__rendered');
                        if ($rendered.length) {
                            $rendered.css({
                                'color': '#212529 !important',
                                'background-color': 'transparent'
                            });
                        }
                    }
                });
            }, 150);
            
            // Force update select2 untuk memastikan text terlihat setelah modal dibuka
            setTimeout(() => {
                $('#edit_connected_odc, #edit_connected_odp').each(function() {
                    const $container = $(this).next('.select2-container');
                    const $rendered = $container.find('.select2-selection__rendered');
                    if ($rendered.length) {
                        $rendered.css({
                            'color': '#212529',
                            'background-color': 'transparent'
                        });
                    }
                });
            }, 100);
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
            
            // Reset registration mode to default
            $('#mode_new').prop('checked', true).trigger('change');
            resetRegistrationForm();
        });

        // =====================================================
        // REGISTRATION MODE HANDLING (Mode New & Mode Import)
        // =====================================================
        
        let deviceListCache = []; // Cache for device list
        let pppoeValidationTimeout = null;
        let importValidationResult = null; // Store import validation result
        
        // Switch registration mode
        $('input[name="registration_mode"]').on('change', function() {
            const mode = $(this).val();
            switchRegistrationMode(mode);
        });
        
        function switchRegistrationMode(mode) {
            if (mode === 'new') {
                // Mode: Registrasi Baru (Full Setup)
                $('#mode_description').html('<i class="fas fa-info-circle"></i> Registrasi baru: Setup device, WiFi, dan PPPoE dari awal.');
                
                // Show Mode New sections
                $('#device_section_new').show();
                $('#wifi_config_section').show();
                $('#pppoe_section_new').show();
                
                // Hide Mode Import sections
                $('#device_section_import').hide();
                $('#pppoe_section_import').hide();
                
                // Update submit button
                $('#create_submit_btn').html('<i class="fas fa-save"></i> Simpan & Setup');
                
            } else {
                // Mode: Import Existing
                $('#mode_description').html('<i class="fas fa-info-circle"></i> Import pelanggan yang sudah ada di MikroTik. Hanya menyimpan ke database.');
                
                // Hide Mode New sections
                $('#device_section_new').hide();
                $('#wifi_config_section').hide();
                $('#pppoe_section_new').hide();
                
                // Show Mode Import sections
                $('#device_section_import').show();
                $('#pppoe_section_import').show();
                
                // Update submit button
                $('#create_submit_btn').html('<i class="fas fa-file-import"></i> Import Pelanggan');
                
                // Reset import validation
                importValidationResult = null;
                $('#import_validation_feedback').text('').removeClass('text-success text-danger');
                $('#import_status_display').html('<small class="text-muted">Belum divalidasi</small>');
                $('#import_info_display').hide();
            }
        }
        
        function resetRegistrationForm() {
            // Reset device search
            $('#create_device_sn_search').val('');
            $('#create_device_select').hide().empty().append('<option value="">-- Pilih Device --</option>');
            $('#create_device_id').val('');
            $('#device_info_display').empty();
            
            // Reset WiFi config
            $('#create_wifi_ssid').val('');
            $('#create_wifi_password').val('');
            $('#ssid_checkbox_container').hide();
            $('#ssid_checkboxes').empty();
            
            // Reset PPPoE
            $('#create_pppoe_username').val('');
            $('#create_pppoe_password').val('');
            $('#pppoe_username_status').empty();
            $('#pppoe_username_feedback').text('').removeClass('text-success text-danger text-warning');
            
            // Reset import fields
            $('#create_device_id_import').val('');
            $('#import_pppoe_username').val('');
            $('#import_validation_feedback').text('').removeClass('text-success text-danger');
            $('#import_status_display').html('<small class="text-muted">Belum divalidasi</small>');
            $('#import_info_display').hide();
            importValidationResult = null;
            
            // Reset cache
            deviceListCache = [];
        }
        
        // =====================================================
        // MODE NEW: Device Search & Selection
        // =====================================================
        
        // Update search hint based on filter selection
        $('input[name="device-filter"]').on('change', function() {
            updateDeviceSearchHint();
        });
        
        function updateDeviceSearchHint() {
            const filterType = $('input[name="device-filter"]:checked').val();
            const searchInput = $('#create_device_search');
            const hintEl = $('#device_search_hint');
            
            switch(filterType) {
                case 'default':
                    searchInput.attr('placeholder', 'Opsional: Filter tambahan by SN...');
                    hintEl.html('<i class="fas fa-info-circle"></i> Menampilkan device dengan PPPoE "tes@hw". Klik Cari untuk memuat.');
                    break;
                case 'new':
                    searchInput.attr('placeholder', 'Opsional: Filter tambahan by SN...');
                    hintEl.html('<i class="fas fa-info-circle"></i> Menampilkan device baru (< 1 hari). Klik Cari untuk memuat.');
                    break;
                case 'by-sn':
                    searchInput.attr('placeholder', 'Masukkan Serial Number... (wajib)');
                    hintEl.html('<i class="fas fa-exclamation-circle text-warning"></i> Serial Number wajib diisi untuk filter ini.');
                    break;
                case 'by-pppoe':
                    searchInput.attr('placeholder', 'Masukkan PPPoE Username...');
                    hintEl.html('<i class="fas fa-info-circle"></i> Cari device berdasarkan PPPoE username yang terdaftar di device.');
                    break;
            }
        }
        
        // Search device button click
        $('#search_device_btn').on('click', function() {
            searchDevices();
        });
        
        // Search on Enter key
        $('#create_device_search').on('keypress', function(e) {
            if (e.which === 13) {
                e.preventDefault();
                searchDevices();
            }
        });
        
        // Clear search button
        $('#clear_device_search_btn').on('click', function() {
            $('#create_device_search').val('');
            $('#create_device_select').hide().empty().append('<option value="">-- Pilih Device --</option>');
            $('#create_device_id').val('');
            $('#device_info_display').empty();
            $('#device_count_display').hide();
            $('#ssid_checkbox_container').hide();
            $('#ssid_checkboxes').empty();
            deviceListCache = [];
        });
        
        function searchDevices() {
            const filterType = $('input[name="device-filter"]:checked').val();
            const searchValue = $('#create_device_search').val().trim();
            
            // Validate: by-sn filter requires search value
            if (filterType === 'by-sn' && !searchValue) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Serial Number Kosong',
                    text: 'Filter "By SN" memerlukan Serial Number.'
                });
                $('#create_device_search').focus();
                return;
            }
            
            // Validate: by-pppoe filter requires search value
            if (filterType === 'by-pppoe' && !searchValue) {
                Swal.fire({
                    icon: 'warning',
                    title: 'PPPoE Username Kosong',
                    text: 'Filter "By PPPoE" memerlukan PPPoE Username.'
                });
                $('#create_device_search').focus();
                return;
            }
            
            const btn = $('#search_device_btn');
            btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Mencari...');
            
            // Build query parameters
            let queryParams = `filter=${filterType}`;
            if (searchValue) {
                if (filterType === 'by-pppoe') {
                    queryParams += `&pppoeUsername=${encodeURIComponent(searchValue)}`;
                } else {
                    queryParams += `&serialNumber=${encodeURIComponent(searchValue)}`;
                }
            }
            
            fetch(`/api/psb/list-devices?${queryParams}`, {
                credentials: 'include'
            })
            .then(res => res.json())
            .then(data => {
                btn.prop('disabled', false).html('<i class="fas fa-search"></i> Cari');
                
                if (data.status === 200 && data.data && data.data.length > 0) {
                    deviceListCache = data.data;
                    
                    const select = $('#create_device_select');
                    select.empty().append('<option value="">-- Pilih Device --</option>');
                    
                    data.data.forEach(device => {
                        let displayText = `${device.serialNumber || 'N/A'} - ${device.model || 'Unknown'}`;
                        displayText += ` (PPP: ${device.currentPPPUsername || 'Kosong'})`;
                        select.append(`<option value="${device.deviceId}" data-device='${JSON.stringify(device)}'>${displayText}</option>`);
                    });
                    
                    select.show();
                    $('#device_count_display').text(`${data.data.length} device ditemukan`).show();
                    
                    // Auto-select if only one result
                    if (data.data.length === 1) {
                        select.val(data.data[0].deviceId).trigger('change');
                    }
                    
                } else {
                    $('#create_device_select').hide();
                    $('#device_count_display').hide();
                    
                    let errorMsg = 'Tidak ada device ditemukan.';
                    if (filterType === 'by-sn') {
                        errorMsg = `Tidak ada device dengan Serial Number "${searchValue}".`;
                    } else if (filterType === 'by-pppoe') {
                        errorMsg = `Tidak ada device dengan PPPoE username "${searchValue}".`;
                    } else if (filterType === 'default') {
                        errorMsg = 'Tidak ada device dengan PPPoE "tes@hw".';
                    } else if (filterType === 'new') {
                        errorMsg = 'Tidak ada device baru (< 1 hari).';
                    }
                    
                    Swal.fire({
                        icon: 'info',
                        title: 'Tidak Ditemukan',
                        text: errorMsg
                    });
                }
            })
            .catch(err => {
                btn.prop('disabled', false).html('<i class="fas fa-search"></i> Cari');
                console.error('Search device error:', err);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Gagal mencari device: ' + err.message
                });
            });
        }
        
        // Device selection change
        $('#create_device_select').on('change', function() {
            const deviceId = $(this).val();
            
            if (deviceId) {
                $('#create_device_id').val(deviceId);
                
                // Show device info
                const selectedOption = $(this).find('option:selected');
                try {
                    const device = JSON.parse(selectedOption.attr('data-device'));
                    showDeviceInfo(device);
                    
                    // Auto-fill WiFi SSID from customer name if available
                    const customerName = $('#create_name').val().trim();
                    if (customerName && !$('#create_wifi_ssid').val()) {
                        $('#create_wifi_ssid').val(customerName.replace(/\s+/g, '_').toUpperCase());
                    }
                    
                    // Load SSID checkboxes
                    loadSSIDCheckboxes(deviceId);
                } catch (e) {
                    console.error('Error parsing device data:', e);
                }
            } else {
                $('#create_device_id').val('');
                $('#device_info_display').empty();
                $('#ssid_checkbox_container').hide();
                $('#ssid_checkboxes').empty();
            }
        });
        
        function showDeviceInfo(device) {
            const html = `
                <div class="alert alert-success py-2 mb-0">
                    <small>
                        <strong>Device ID:</strong> <code>${device.deviceId}</code><br>
                        <strong>Serial Number:</strong> ${device.serialNumber || 'N/A'}<br>
                        <strong>Model:</strong> ${device.model || 'N/A'}<br>
                        <strong>Manufacturer:</strong> ${device.manufacturer || 'N/A'}<br>
                        <strong>Current PPP:</strong> ${device.currentPPPUsername || 'Kosong'}
                    </small>
                </div>
            `;
            $('#device_info_display').html(html);
        }
        
        // Load SSID checkboxes from device
        function loadSSIDCheckboxes(deviceId) {
            const container = $('#ssid_checkboxes');
            container.html('<small class="text-muted"><i class="fas fa-spinner fa-spin"></i> Memuat SSID...</small>');
            $('#ssid_checkbox_container').show();
            
            fetch(`/api/customer-wifi-info/${encodeURIComponent(deviceId)}?skipRefresh=true`, {
                credentials: 'include'
            })
            .then(res => res.json())
            .then(result => {
                if (result.status === 200 && result.data && Array.isArray(result.data.ssid)) {
                    container.empty();
                    
                    if (result.data.ssid.length === 0) {
                        container.html('<small class="text-muted">Tidak ada SSID ditemukan.</small>');
                    } else {
                        result.data.ssid.forEach(ssid => {
                            const checkboxHtml = `
                                <div class="form-check">
                                    <input type="checkbox" class="form-check-input ssid-checkbox-create" id="create_ssid_${ssid.id}" value="${ssid.id}" checked>
                                    <label class="form-check-label" for="create_ssid_${ssid.id}">
                                        SSID ${ssid.id} ${ssid.name ? `(${ssid.name})` : ''}
                                    </label>
                                </div>
                            `;
                            container.append(checkboxHtml);
                        });
                    }
                } else {
                    container.html('<small class="text-warning">Gagal memuat SSID.</small>');
                }
            })
            .catch(err => {
                console.error('Load SSID error:', err);
                container.html('<small class="text-danger">Error memuat SSID.</small>');
            });
        }
        
        // =====================================================
        // MODE NEW: PPPoE Username Validation (Real-time)
        // =====================================================
        
        $('#create_pppoe_username').on('input', function() {
            const username = $(this).val().trim();
            const statusEl = $('#pppoe_username_status');
            const feedbackEl = $('#pppoe_username_feedback');
            
            // Clear previous timeout
            if (pppoeValidationTimeout) {
                clearTimeout(pppoeValidationTimeout);
            }
            
            // Reset status
            statusEl.empty();
            feedbackEl.text('').removeClass('text-success text-danger text-warning');
            
            if (!username) return;
            
            // Show loading
            statusEl.html('<i class="fas fa-spinner fa-spin text-muted"></i>');
            
            // Debounce validation
            pppoeValidationTimeout = setTimeout(() => {
                fetch(`/api/psb/validate-pppoe-username?username=${encodeURIComponent(username)}`, {
                    credentials: 'include'
                })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200) {
                        if (data.available) {
                            statusEl.html('<i class="fas fa-check-circle text-success"></i>');
                            feedbackEl.text(data.message || 'Username tersedia').addClass('text-success');
                        } else {
                            statusEl.html('<i class="fas fa-times-circle text-danger"></i>');
                            feedbackEl.text(data.message || 'Username sudah digunakan').addClass('text-danger');
                        }
                    } else {
                        statusEl.html('<i class="fas fa-exclamation-triangle text-warning"></i>');
                        feedbackEl.text('Tidak dapat memvalidasi').addClass('text-warning');
                    }
                })
                .catch(err => {
                    console.error('PPPoE validation error:', err);
                    statusEl.html('<i class="fas fa-exclamation-triangle text-warning"></i>');
                    feedbackEl.text('Error validasi').addClass('text-warning');
                });
            }, 500);
        });
        
        // =====================================================
        // MODE IMPORT: Validate PPPoE Username Exists in MikroTik
        // =====================================================
        
        $('#validate_import_btn').on('click', function() {
            validateImportPPPoE();
        });
        
        $('#import_pppoe_username').on('keypress', function(e) {
            if (e.which === 13) {
                e.preventDefault();
                validateImportPPPoE();
            }
        });
        
        function validateImportPPPoE() {
            const username = $('#import_pppoe_username').val().trim();
            
            if (!username) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Username Kosong',
                    text: 'Masukkan PPPoE username yang akan diimport.'
                });
                return;
            }
            
            const btn = $('#validate_import_btn');
            btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Validasi...');
            
            // Reset previous result
            importValidationResult = null;
            $('#import_validation_feedback').text('').removeClass('text-success text-danger');
            $('#import_status_display').html('<small class="text-muted"><i class="fas fa-spinner fa-spin"></i> Mengecek...</small>');
            $('#import_info_display').hide();
            
            fetch(`/api/users/validate-pppoe-exists?username=${encodeURIComponent(username)}`, {
                credentials: 'include'
            })
            .then(res => res.json())
            .then(data => {
                btn.prop('disabled', false).html('<i class="fas fa-check-circle"></i> Validasi');
                
                if (data.status === 200 && data.exists) {
                    // Transform response to match expected format
                    importValidationResult = {
                        exists: true,
                        alreadyRegistered: false,
                        userInfo: data.data,
                        matchedPackage: data.data?.matchedPackage || null
                    };
                    
                    $('#import_validation_feedback').text('Username ditemukan di MikroTik!').addClass('text-success');
                    $('#import_status_display').html('<span class="text-success"><i class="fas fa-check-circle"></i> Valid</span>');
                    
                    // Show user info
                    const info = data.data || {};
                    let packageInfo = '';
                    if (info.matchedPackage) {
                        packageInfo = `<br>Paket: <strong>${info.matchedPackage.name}</strong> (Rp ${Number(info.matchedPackage.price).toLocaleString('id-ID')})`;
                    }
                    
                    $('#import_info_display').html(`
                        <strong><i class="fas fa-user"></i> Info PPPoE dari MikroTik:</strong><br>
                        <small>
                            Username: <strong>${info.username || username}</strong><br>
                            Profile: <strong>${info.profile || 'N/A'}</strong>${packageInfo}<br>
                            Status: ${info.disabled ? '<span class="text-danger">Disabled</span>' : '<span class="text-success">Active</span>'}
                        </small>
                    `).show();
                    
                    // Auto-select matched package if available
                    if (info.matchedPackage && info.matchedPackage.name) {
                        $('#create_subscription').val(info.matchedPackage.name).trigger('change');
                    }
                    
                } else if (data.status === 400 && data.conflictUser) {
                    // Username already registered in database
                    importValidationResult = null;
                    
                    $('#import_validation_feedback').text(data.message).addClass('text-danger');
                    $('#import_status_display').html('<span class="text-danger"><i class="fas fa-times-circle"></i> Sudah Terdaftar</span>');
                    $('#import_info_display').hide();
                    
                } else {
                    importValidationResult = null;
                    
                    $('#import_validation_feedback').text(data.message || 'Username tidak ditemukan di MikroTik.').addClass('text-danger');
                    $('#import_status_display').html('<span class="text-danger"><i class="fas fa-times-circle"></i> Tidak Valid</span>');
                    $('#import_info_display').hide();
                }
            })
            .catch(err => {
                btn.prop('disabled', false).html('<i class="fas fa-check-circle"></i> Validasi');
                console.error('Import validation error:', err);
                
                importValidationResult = null;
                $('#import_validation_feedback').text('Error saat validasi: ' + err.message).addClass('text-danger');
                $('#import_status_display').html('<span class="text-danger"><i class="fas fa-times-circle"></i> Error</span>');
            });
        }
        
        // Auto-fill WiFi SSID when customer name changes
        $('#create_name').on('blur', function() {
            const name = $(this).val().trim();
            const mode = $('input[name="registration_mode"]:checked').val();
            
            if (mode === 'new' && name && !$('#create_wifi_ssid').val()) {
                $('#create_wifi_ssid').val(name.replace(/\s+/g, '_').toUpperCase());
            }
        });

        $(document).on('click', '.btn-edit', function() {
            const id = $(this).data('id');
            const device_id = $(this).data('device_id') || "";
            let bulkData = $(this).data('bulk');
            
            // Handle different formats of bulk data
            // jQuery data() automatically parses JSON from data-attribute, so bulkData might already be an array
            // But we also need to handle if it's still a string
            if (typeof bulkData === 'string') {
                try {
                    // If it's a string, try to parse it
                    bulkData = JSON.parse(bulkData);
                } catch (e) {
                    console.error("Failed to parse bulk data JSON:", e, bulkData);
                    bulkData = [];
                }
            }
            
            // Ensure it's an array and all values are strings (for comparison with ssid.id)
            if (!Array.isArray(bulkData)) {
                bulkData = [];
            } else {
                // Normalize all values to strings for consistent comparison
                bulkData = bulkData.map(idx => String(idx));
            }
            
            // Debug log untuk verifikasi
            // User bulk SSIDs loaded
            const initialPaidStatusForEdit = $(this).data('paid') === true || String($(this).data('paid')).toLowerCase() === 'true';
            
            const connectedOdpId = $(this).data('connected_odp_id') || "";

            let preselectOdcId = null;
            if (connectedOdpId && connectedOdpId !== "" && allOdpList.length > 0) {
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
            updatePhoneAddButtonState('edit_number_container');

            $('#editModal #edit_address').val($(this).data('address'));
            $('#editModal #edit_subscription').val($(this).data('subscription')).trigger('change');
            $('#editModal #edit_paid').prop("checked", initialPaidStatusForEdit);
            $('#editModal #edit_send_invoice').prop("checked", $(this).data('send_invoice') || false);
            // notify_outage default TRUE bila atribut tidak ada / kosong; eksplisit 'false' => unchecked.
            $('#editModal #edit_notify_outage').prop("checked", String($(this).data('notify_outage')) !== 'false');
            // account_type: 'pelanggan' (default) | 'infrastruktur'.
            $('#editModal #edit_account_type').val(String($(this).data('account_type')).toLowerCase() === 'infrastruktur' ? 'infrastruktur' : 'pelanggan');
            $('#editModal #edit_pppoe_username').val($(this).data('pppoe_username'));
            $('#editModal #edit_pppoe_password').val($(this).data('pppoe_password'));
            $('#editModal #edit_payment_method').val('');
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
            // Fetching device data

            let deviceIdsToProcess = new Set();
            let forceRedraw = false;

            // Determine if any filter is active
            const selectedOdcId = $('#odcFilterDropdown').val();
            const selectedOdpId = $('#odpFilterDropdown').val();
            const isFilterActive = !!selectedOdcId || !!selectedOdpId;

            // Only fetch metrics if a filter is active OR if a single device ID is explicitly requested
            if (!isFilterActive && !singleDeviceIdToFetch) {
                // Device data fetch skipped - no filter active
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
                        const userOdpId = rowData && rowData.connected_odp_id ? String(rowData.connected_odp_id) : null;
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
                // Device data fetch skipped - no unique device IDs found
                if (forceRedraw && dataTableInstance) dataTableInstance.rows().invalidate('data').draw('page');
                return;
            }

            // Batch fetching device data

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
                    // Device data batch fetch completed
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


        // Auto-refresh interval for connected devices modal
        let connectedDevicesRefreshInterval = null;
        let lastDeviceRefreshTime = 0;
        const REFRESH_COOLDOWN = 30000; // 30 seconds cooldown between full refreshes
        
        // NEW: Function to fetch and display connected devices for a single device in the new modal
        async function fetchAndDisplayConnectedDevicesModal(deviceId, customerName) {
            // Clear any existing interval first
            if (connectedDevicesRefreshInterval) {
                clearInterval(connectedDevicesRefreshInterval);
                connectedDevicesRefreshInterval = null;
            }
            
            const modalBody = $('#connectedDevicesModalBody');
            $('#connectedDevicesModalLabel').text(`Detail WiFi & Perangkat Terhubung untuk ${customerName}`);
            $('#connectedDevicesModal').modal('show');

            if (!deviceId) {
                modalBody.html('<p class="text-muted text-center my-3">Device ID tidak tersedia untuk pelanggan ini.</p>');
                return;
            }
            
            // Initial fetch with loading indicator
            modalBody.html('<p class="text-center my-3"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Mengambil data realtime...</p>');
            await fetchConnectedDevicesData(deviceId, customerName, false);
            
            // Setup auto-refresh every 5 seconds
            connectedDevicesRefreshInterval = setInterval(async () => {
                await fetchConnectedDevicesData(deviceId, customerName, true);
            }, 5000);
        }
        
        // Function to actually fetch and display data
        // Make it global for manual refresh button
        window.fetchConnectedDevicesData = async function(deviceId, customerName, isSilentUpdate = false) {
            const modalBody = $('#connectedDevicesModalBody');
            
            try {
                // Determine if we should do a full refresh or just fetch cached data
                const now = Date.now();
                const shouldRefresh = (now - lastDeviceRefreshTime) > REFRESH_COOLDOWN;
                const skipRefresh = !shouldRefresh || isSilentUpdate;
                
                if (shouldRefresh && !isSilentUpdate) {
                    lastDeviceRefreshTime = now;
                }
                
                // Call the API with skipRefresh parameter
                const response = await fetch(`/api/customer-wifi-info/${deviceId}?skipRefresh=${skipRefresh}&_=${new Date().getTime()}`, {
                    credentials: 'include'
                });
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
                                    contentHtml += `<li class="list-group-item py-1">
                                                        ${dev.hostName || 'Tanpa Nama'} <br>
                                                        <small class="text-muted" style="font-size:0.9em;">
                                                            (MAC: ${dev.mac || '-'}, IP: ${dev.ip || '-'}, Sinyal: ${dev.signal ? dev.signal + ' dBm' : '-'})
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

                    // Add refresh status and last update time
                    const updateTime = new Date().toLocaleTimeString('id-ID');
                    const refreshStatus = result.refreshed ? 
                        '<span class="badge badge-success">Data Refreshed</span>' : 
                        '<span class="badge badge-info">Cached Data</span>';
                    
                    // Prepend total count summary and refresh info to the top of all content
                    let overallSummary = `
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <h5 class="mb-0">Total Perangkat: <span class="badge badge-primary">${totalDevicesCount}</span></h5>
                            <div class="text-right">
                                <small class="text-muted">Last Update: ${updateTime} ${refreshStatus}</small>
                                <button class="btn btn-sm btn-link p-0 ml-2" onclick="fetchConnectedDevicesData('${deviceId}', '${customerName.replace(/'/g, "\\'")}')"
                                        title="Refresh Manual">
                                    <i class="fas fa-sync-alt"></i>
                                </button>
                            </div>
                        </div>
                        <div class="alert alert-info py-1 px-2 mb-2">
                            <small><i class="fas fa-info-circle"></i> Data auto-refresh setiap 5 detik. Full refresh dari device setiap 30 detik.</small>
                        </div>
                        <hr>`;
                    modalBody.html(overallSummary + contentHtml);

                } else {
                    modalBody.html('<p class="text-danger text-center my-3">Format data API WiFi tidak sesuai atau data kosong.</p>');
                }
            } catch (error) {
                if (!isSilentUpdate) {
                    modalBody.html(`<p class="text-danger text-center my-3"><strong>Error memuat info perangkat terhubung:</strong> ${error.message}</p>`);
                }
                console.error(`Error fetching connected devices for modal ${deviceId}:`, error);
            }
        }
        
        // Clear interval when modal is closed
        $('#connectedDevicesModal').on('hidden.bs.modal', function () {
            if (connectedDevicesRefreshInterval) {
                clearInterval(connectedDevicesRefreshInterval);
                connectedDevicesRefreshInterval = null;
                    // Connected devices auto-refresh stopped
            }
        });


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
                await fetchNetworkAssets();
                await fetchActivePppoeUsers();
                if (dataTableInstance) {
                    // We don't need to reload DataTable via AJAX if it's already loaded.
                    // Just re-run the draw and then fetch device data based on current filters.
                    dataTableInstance.draw(); // Re-apply current filters and redraw
                    // DataTables redraw triggered
                    
                    // Only fetch GenieACS data if a filter is actually active
                    if (isFilterActive) {
                        debouncedFetchDeviceData(null); 
                    } else {
                        // If no filter is active after refresh (e.g. forceNoFilterCheck was true, but still no filter)
                        // Ensure columns are hidden and cache cleared.
                        toggleDeviceMetricColumns(false);
                        deviceDataCache.clear();
                    }

                    displayGlobalUserMessage("Data pelanggan terfilter berhasil diperbarui.", "success", true);
                }
            } catch (error) {
                console.error("Error during full data refresh:", error);
                displayGlobalUserMessage("Gagal memuat ulang data: " + error.message, "danger", true);
            } finally {
                $('#refreshDataBtn').prop('disabled', false).html('<i class="fas fa-sync-alt"></i> <span>Refresh Data</span>');
            }
        }

        // Toggles visibility of Redaman, Suhu, Tipe Router columns
        function toggleDeviceMetricColumns(show) {
            const table = $('#dataTable').DataTable();
            // Assuming these are columns 12, 13, 14 (0-indexed)
            table.column(12).visible(show); // Redaman
            table.column(13).visible(show); // Suhu
            table.column(14).visible(show); // Tipe Router

            // Note: DataTables `visible` method is usually sufficient.
        }

        async function initializePage() {
            // Fetch network assets first (needed for dropdowns)
            await fetchNetworkAssets();
            
            // Load PPPoE data asynchronously in background without blocking
            // Data will load independently and update UI when ready
            setTimeout(() => {
                fetchActivePppoeUsers(false); // false = don't show loading on initial load
            }, 2000); // Delay 2 seconds to let page load first

            fetch('/api/packages').then(res => res.json().then(({ data }) => {
                const createSubscriptionSelect = document.getElementById('create_subscription');
                const editSubscriptionSelect = document.getElementById('edit_subscription');

                // Store packages data globally for bulk change feature
                window.packagesData = data || [];

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
                            // Users data loaded successfully
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
                    {
                        data: 'name',
                        render: function(data, type, row) {
                            const name = data || '';
                            if (type === 'display' && String(row.account_type || '').toLowerCase() === 'infrastruktur') {
                                return `${name} <span class="badge badge-dark" title="Akun infrastruktur (mis. modem CCTV/monitoring)">INFRA</span>`;
                            }
                            return name;
                        }
                    },
                    { data: 'phone_number', render: (data) => data ? data.split("|").join(", ") : '' },
                    { data: 'device_id' },
                    { data: 'address' },
                    { data: null, render: (data, type, row) => (row.latitude && row.longitude) ? `${parseFloat(row.latitude).toFixed(4)}, ${parseFloat(row.longitude).toFixed(4)}` : 'N/A' },
                    {
                        data: 'connected_odp_id',
                        defaultContent: '',
                        render: function(data, type, row) {
                            if (type === 'display') {
                                if (data && allOdpList.length > 0) {
                                    const odp = allOdpList.find(o => String(o.id) === String(data));
                                    return odp ? `${odp.name || 'ODP Tanpa Nama'} <small>(${odp.id})</small>` : `ID: ${data} (Tidak Ditemukan)`;
                                }
                                return '<span class="text-muted">-</span>';
                            }
                            return data || '';
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
                                // Show loading spinner while fetching PPPoE data
                                if (pppoeDataLoading) {
                                    return '<div class="spinner-border spinner-border-sm text-primary" role="status" style="width: 1rem; height: 1rem;"><span class="sr-only">Loading...</span></div>';
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
                            if (pppoeDataLoading) return 'Loading';
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
                                // Show loading spinner while fetching PPPoE data
                                if (pppoeDataLoading) {
                                    return '<div class="spinner-border spinner-border-sm text-info" role="status" style="width: 1rem; height: 1rem;"><span class="sr-only">Loading...</span></div>';
                                }
                                if (initialPppoeLoadFailed) {
                                    return '<span class="text-muted">Unknown</span>';
                                }
                                const ip = activePppoeUsersMap.get(row.pppoe_username);
                                return ip ? ip : '<span class="text-muted">Offline</span>';
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
                                <div class="device-action-group">
                                    <button class="btn btn-info btn-sm btn-edit" data-id="${row.id}" data-name="${row.name || ''}" data-phone_number="${row.phone_number || ''}" data-device_id="${deviceIdForActions}" data-address="${row.address || ''}" data-subscription="${row.subscription || ''}" data-paid="${row.paid || false}" data-send_invoice="${row.send_invoice || false}" data-notify_outage="${row.notify_outage !== false && row.notify_outage !== 0 ? 'true' : 'false'}" data-account_type="${String(row.account_type || 'pelanggan').toLowerCase() === 'infrastruktur' ? 'infrastruktur' : 'pelanggan'}" data-pppoe_username="${row.pppoe_username || ''}" data-pppoe_password="${row.pppoe_password || ''}" data-latitude="${row.latitude || ''}" data-longitude="${row.longitude || ''}" data-connected_odp_id="${row.connected_odp_id || ''}" data-bulk='${JSON.stringify(Array.isArray(row.bulk) ? row.bulk : (typeof row.bulk === 'string' ? JSON.parse(row.bulk) : []))}' data-toggle="modal" data-target="#editModal" title="Edit User"><i class="fas fa-edit"></i></button>
                                    <button class="btn btn-dark btn-sm btn-manage-credentials" data-id="${row.id}" data-username="${row.username || ''}" data-toggle="modal" data-target="#credentialsModal" title="Kelola Kredensial"><i class="fas fa-key"></i></button>`;

                            // Tombol kirim pesan "selamat datang" (hanya bila pelanggan sudah punya No HP)
                            if (row.phone_number && String(row.phone_number).trim()) {
                                actionButtonsHtml += `
                                    <button class="btn btn-outline-success btn-sm btn-send-welcome" data-id="${row.id}" data-name="${String(row.name || '').replace(/"/g, '&quot;')}" title="Kirim Pesan Selamat Datang"><i class="fas fa-hand-sparkles"></i></button>`;
                            }

                            // Add send invoice button if user has send_invoice enabled and is paid
                            if ((row.send_invoice === true || row.send_invoice === 1) && (row.paid === true || row.paid === 1)) {
                                actionButtonsHtml += `
                                    <button class="btn btn-success btn-sm btn-send-invoice" data-id="${row.id}" data-name="${row.name || ''}" data-phone="${row.phone_number || ''}" title="Kirim Invoice PDF"><i class="fas fa-file-invoice"></i></button>`;
                            }
                            
                            // Always show print button for paid users
                            if (row.paid === true || row.paid === 1) {
                                actionButtonsHtml += `
                                    <button class="btn btn-warning btn-sm btn-print-invoice" data-id="${row.id}" data-name="${row.name || ''}" title="Cetak Invoice"><i class="fas fa-print"></i></button>`;
                            }
                            
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
                            actionButtonsHtml += `</div>
                                <button onclick="deleteData('${row.id}', event)" class="btn btn-danger btn-sm mt-1" title="Hapus User"><i class="fas fa-trash"></i></button>`;

                            return actionButtonsHtml;
                        }
                    }
                ],
                "columnDefs": [
                    { "width": "3%", "targets": 0 },  // ID
                    { "width": "7%", "targets": 10 }, // Status
                    { "width": "10%", "targets": 11}, // IP Pelanggan
                    { "width": "7%", "targets": 12}, // Redaman - index 12
                    { "width": "7%", "targets": 13}, // Suhu - index 13
                    { "width": "7%", "targets": 14}, // Tipe Router - index 14
                    { "width": "18%", "targets": 15 } // Action - now contains all device-related actions and other actions
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
            // Force update select2 untuk memastikan text terlihat setelah value di-set
            setTimeout(() => {
                const $container = $(this).next('.select2-container');
                if ($container.length) {
                    const $rendered = $container.find('.select2-selection__rendered');
                    if ($rendered.length) {
                        $rendered.css('color', '#212529');
                        // Force update text content jika perlu
                        const selectedText = $(this).find('option:selected').text();
                        if (selectedText && selectedText !== '-- Pilih ODC --') {
                            $rendered.text(selectedText);
                        }
                    }
                }
            }, 100);
        }

        // Function to update the state of the "Refresh Data" button
        function updateRefreshButtonState() {
            const selectedOdcId = $('#odcFilterDropdown').val();
            const selectedOdpId = $('#odpFilterDropdown').val();
            const isFilterActive = !!selectedOdcId || !!selectedOdpId;
            $('#refreshDataBtn').prop('disabled', !isFilterActive);
        }

        // Add cleanup on page unload
        window.addEventListener('beforeunload', function() {
            // Clear all intervals
            if (pppoeRefreshInterval) clearInterval(pppoeRefreshInterval);
            if (deviceFetchTimeout) clearTimeout(deviceFetchTimeout);
            
            // Clear caches
            deviceDataCache.clear();
            activePppoeUsersMap.clear();
            
            // Destroy DataTable if exists
            if (dataTableInstance) {
                dataTableInstance.destroy();
            }
        });
        
        // Initialize max phone limit from config
        let maxPhoneLimit = 3; // Default
        
        // Load max phone limit from config
        fetch('/api/stats/config')
            .then(res => {
                if (!res.ok) {
                    throw new Error(`HTTP error! status: ${res.status}`);
                }
                return res.json();
            })
            .then(data => {
                // Handle response format from /api/stats/config: { data: { ...global.config, ...global.cronConfig } }
                let configData = null;
                if (data && data.data) {
                    configData = data.data; // Format: { data: { accessLimit: 5, ... } }
                } else if (data && typeof data === 'object') {
                    configData = data; // Fallback: direct format
                }
                
                // Simpan config data ke window untuk digunakan di tempat lain
                if (configData) {
                    window.configData = configData;
                }
                
                if (configData && configData.accessLimit !== undefined && configData.accessLimit !== null) {
                    const loadedLimit = parseInt(configData.accessLimit);
                    if (!isNaN(loadedLimit) && loadedLimit > 0) {
                        maxPhoneLimit = loadedLimit;
                        // Update UI to show max limit
                        updatePhoneLimitUI();
                    }
                }
            })
            .catch(err => {
                // Silently fail, use default
            });

        $(document).ready(function() {
            // Add performance monitoring if DEBUG
            if (DEBUG) {
                const originalFetch = window.fetch;
                window.fetch = function() {
                    apiCallCount++;
                    // API call made
                    return originalFetch.apply(this, arguments);
                };
                
                // Monitor memory usage
                setInterval(() => {
                    if (performance.memory) {
                        const used = Math.round(performance.memory.usedJSHeapSize / 1048576);
                        const total = Math.round(performance.memory.totalJSHeapSize / 1048576);
                        if (used > 100) {
                            console.warn(`[MEMORY WARNING] High memory usage: ${used}MB / ${total}MB`);
                        }
                    }
                }, 10000);
            }
            
            initializePage();

            // Refresh PPPoE button handler
            $('#refreshPppoeBtn').on('click', function() {
                fetchActivePppoeUsers(true);
            });

            $('#deleteAllUsersForm').on('submit', function(event) {
                event.preventDefault();
                const password = $('#adminPassword').val();
                if (!password) {
                    displayGlobalUserMessage('Please enter your password.', 'warning', true);
                    return;
                }

                // Attempting to delete all users

                fetch('/api/admin/delete-all-users', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify({ password: password })
                })
                .then(response => {
                    // Received response from server
                    return response.json();
                })
                .then(data => {
                    // Parsed response data
                    if (data.status === 200) {
                        displayGlobalUserMessage('All users have been deleted successfully.', 'success', true);
                        $('#deleteAllUsersModal').modal('hide');
                        dataTableInstance.ajax.reload();
                    } else {
                        displayGlobalUserMessage('Error: ' + data.message, 'danger', true);
                    }
                })
                .catch(error => {
                    console.error('Error during fetch:', error);
                    displayGlobalUserMessage('An unexpected error occurred. Please check the console for details.', 'danger', true);
                });
            });

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
                        debouncedFetchDeviceData(null); // Fetch metrics for visible rows
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
                    const userOdpId = rowData && rowData.connected_odp_id ? String(rowData.connected_odp_id) : null;
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

            // Filter jenis akun: sembunyikan akun infrastruktur dari daftar pelanggan default.
            $.fn.dataTable.ext.search.push(
                function(settings, data, dataIndex) {
                    if (settings.nTable.id !== 'dataTable') return true;
                    const rowData = settings.aoData[dataIndex]._aData;
                    const type = String(rowData && rowData.account_type ? rowData.account_type : 'pelanggan').toLowerCase();
                    const isInfra = type === 'infrastruktur';
                    if (currentAccountTypeView === 'infrastruktur') return isInfra;
                    if (currentAccountTypeView === 'all') return true;
                    return !isInfra; // default 'pelanggan'
                }
            );

            // Toggle tampilan jenis akun (Pelanggan / Infrastruktur / Semua).
            $('#accountTypeViewToggle .btn').on('click', function() {
                $('#accountTypeViewToggle .btn').removeClass('active');
                $(this).addClass('active');
                currentAccountTypeView = $(this).data('view') || 'pelanggan';
                if (dataTableInstance) dataTableInstance.draw();
            });

            $('#create_connected_odc').on('change', function() {
                const selectedOdcId = $(this).val();
                populateOdpDropdowns('create_connected_odp', null, selectedOdcId);
                if (!selectedOdcId) {
                    $('#create_connected_odp').val(null).trigger('change.select2');
                }
                // Force update select2 untuk memastikan text terlihat setelah value di-set
                setTimeout(() => {
                    const $container = $(this).next('.select2-container');
                    if ($container.length) {
                        const $rendered = $container.find('.select2-selection__rendered');
                        if ($rendered.length) {
                            $rendered.css('color', '#212529');
                            // Force update text content jika perlu
                            const selectedText = $(this).find('option:selected').text();
                            if (selectedText && selectedText !== '-- Pilih ODC --') {
                                $rendered.text(selectedText);
                            }
                        }
                    }
                }, 100);
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
            
            // Check if max limit reached
            if (fieldCount >= maxPhoneLimit) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Maksimal Nomor HP',
                    text: `Maksimal ${maxPhoneLimit} nomor HP sesuai konfigurasi.`
                });
                return;
            }
            
            // Only disable the delete button if it's the *only* field and it's the first time being added
            const disableDelete = fieldCount === 0 && isFirstCallForContainer; 

            const newFieldHtml = `
                <div class="d-flex todo_field phone-number-item ${id}" style="gap: 0.25rem; margin-top: ${fieldCount > 0 ? '0.25rem' : '0'};">
                    <input type="text" class="form-control form-control-sm" style="width: 100%;" name="phone_number_${id}" value="${value}" placeholder="Masukkan nomor HP di sini" />
                    <button class="btn btn-danger btn-sm py-0 px-1 btn-delete-phone" type="button" data-container="${containerId}" data-field="${id}" ${disableDelete ? 'disabled' : ''}><i class="fas fa-trash"></i></button>
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
            
            // Update add button disabled state
            updatePhoneAddButtonState(containerId);
        }
        
        function updatePhoneAddButtonState(containerId) {
            const container = document.getElementById(containerId);
            if (!container) return;
            
            // Find the add button for this container
            // The add button is typically near the container
            const containerParent = container.closest('.mb-3');
            if (containerParent) {
                const addButton = containerParent.querySelector('button[onclick*="addNumberField"]');
                if (addButton) {
                    const fieldCount = container.querySelectorAll('.phone-number-item').length;
                    addButton.disabled = fieldCount >= maxPhoneLimit;
                    if (addButton.disabled) {
                        addButton.title = `Maksimal ${maxPhoneLimit} nomor HP sesuai konfigurasi`;
                    } else {
                        addButton.title = 'Tambah Nomor HP';
                    }
                }
            }
        }
        
        function updatePhoneLimitUI() {
            // Update max limit text in UI if exists
            const maxLimitElements = document.querySelectorAll('.max-phone-limit-display');
            maxLimitElements.forEach(el => {
                el.textContent = maxPhoneLimit;
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
            
            // Update add button state after deletion
            updatePhoneAddButtonState(containerId);
        }

        function getSyncOutcomeBadge(syncStatus) {
            switch (syncStatus) {
                case 'applied':
                    return 'success';
                case 'applied_locally_sync_disabled':
                case 'skipped_no_pppoe':
                    return 'warning';
                case 'failed_sync':
                    return 'danger';
                default:
                    return 'info';
            }
        }

        function buildSyncOutcomeHtml(result, { isEditForm, registrationMode } = {}) {
            const syncStatus = result?.sync_status || result?.mikrotik_sync?.status || null;
            const syncMessage = result?.sync_message || result?.mikrotik_sync?.message || null;
            const syncPolicy = result?.sync_policy || null;
            const outcomeBadge = getSyncOutcomeBadge(syncStatus);
            const baseTitle = isEditForm ? 'Data pengguna berhasil diperbarui.' : 'Data pengguna berhasil ditambahkan.';
            let html = `<p>${baseTitle}</p>`;

            if (!isEditForm && registrationMode) {
                if (registrationMode === 'new') {
                    html += `<p class="mb-1 text-success"><i class="fas fa-user-plus"></i> <b>Mode: Registrasi Baru</b></p>`;
                } else if (registrationMode === 'import') {
                    html += `<p class="mb-1 text-info"><i class="fas fa-file-import"></i> <b>Mode: Import dari MikroTik</b></p>`;
                }
            }

            if (syncStatus || syncMessage) {
                html += `
                    <div class="alert alert-${outcomeBadge} mt-3 mb-2">
                        <div><strong>Status Sinkronisasi:</strong> ${syncStatus || '-'}</div>
                        <div class="small mt-1">${syncMessage || 'Tidak ada informasi sinkronisasi.'}</div>
                        ${syncPolicy ? `<div class="small mt-1">Policy: <strong>${syncPolicy}</strong></div>` : ''}
                    </div>
                `;
            }

            if (!isEditForm && result?.generated_credentials) {
                const creds = result.generated_credentials;
                html += `
                    <hr>
                    <p class="mb-1"><b>Kredensial Login Pelanggan:</b></p>
                    <div class="alert alert-info" style="font-family: monospace; word-wrap: break-word;">
                        Username: <strong>${creds.username}</strong><br>
                        Password: <strong>${creds.password}</strong>
                    </div>
                    <p class="mt-2 mb-0 small">Harap salin dan berikan informasi ini kepada pelanggan.</p>`;
            }

            return html;
        }
        
        // Event delegation for phone delete buttons
        $(document).on('click', '.btn-delete-phone', function(e) {
            e.preventDefault();
            const containerId = $(this).data('container');
            const fieldId = $(this).data('field');
            deleteField(containerId, fieldId);
        });

        $('#createUserForm, #editUserForm').on('submit', async function(event) { // Make the function async
            event.preventDefault();
            const form = this;
            const isEditForm = form.id === 'editUserForm';
            const userId = isEditForm ? $('#edit_user_id').val() : null;
            
            // Get registration mode (only for create form)
            const registrationMode = !isEditForm ? $('input[name="registration_mode"]:checked').val() : null;
            
            // Validation for Mode New
            if (!isEditForm && registrationMode === 'new') {
                const deviceId = $('#create_device_id').val();
                const wifiSSID = $('#create_wifi_ssid').val().trim();
                const wifiPassword = $('#create_wifi_password').val().trim();
                const pppoeUsername = $('#create_pppoe_username').val().trim();
                
                if (!deviceId) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Device Belum Dipilih',
                        text: 'Silakan cari dan pilih device terlebih dahulu.'
                    });
                    return;
                }
                
                if (!wifiSSID || !wifiPassword) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Konfigurasi WiFi Belum Lengkap',
                        text: 'Nama WiFi (SSID) dan Password WiFi wajib diisi.'
                    });
                    return;
                }
                
                if (!pppoeUsername) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'PPPoE Username Kosong',
                        text: 'PPPoE Username wajib diisi untuk registrasi baru.'
                    });
                    return;
                }
                
                // Check if at least one SSID is selected
                const selectedSSIDs = [];
                $('.ssid-checkbox-create:checked').each(function() {
                    selectedSSIDs.push($(this).val());
                });
                
                if (selectedSSIDs.length === 0) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'SSID Belum Dipilih',
                        text: 'Pilih minimal satu SSID yang akan dikonfigurasi.'
                    });
                    return;
                }
            }
            
            // Validation for Mode Import
            if (!isEditForm && registrationMode === 'import') {
                const importUsername = $('#import_pppoe_username').val().trim();
                
                if (!importUsername) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'PPPoE Username Kosong',
                        text: 'Masukkan PPPoE username yang akan diimport.'
                    });
                    return;
                }
                
                if (!importValidationResult || !importValidationResult.exists) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Validasi Diperlukan',
                        text: 'Silakan validasi PPPoE username terlebih dahulu dengan klik tombol "Validasi".'
                    });
                    return;
                }
                
                if (importValidationResult.alreadyRegistered) {
                    Swal.fire({
                        icon: 'error',
                        title: 'Username Sudah Terdaftar',
                        text: `Username "${importUsername}" sudah terdaftar di sistem.`
                    });
                    return;
                }
            }
            
            const url = isEditForm ? `/api/users/${userId}` : '/api/users';
            const method = 'POST';

            const newPaidStatus = $(form).find('[name="paid"]').is(':checked');
            let paidStatusChangedToTrue = false;

            if (isEditForm) {
                const initialPaidStatus = $(form).data('initial-paid-status');
                if (typeof initialPaidStatus === 'boolean' && initialPaidStatus === false && newPaidStatus === true) {
                    paidStatusChangedToTrue = true;
                }
            } else {
                if (newPaidStatus === true) {
                    paidStatusChangedToTrue = true;
                }
            }

            const paymentMethodField = isEditForm ? $('#edit_payment_method') : $('#create_payment_method');
            const paymentMethod = paymentMethodField.val();
            if (paidStatusChangedToTrue && !paymentMethod) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Metode Pembayaran Wajib Dipilih',
                    text: 'Pilih metode pembayaran sebelum menandai pelanggan sebagai sudah membayar.'
                });
                return;
            }

            const formData = new FormData(form);
            const data = {};
            let phoneNumbers = [];
            let bulkSSIDs = [];

            // Collect all form data
            formData.forEach((value, key) => {
                if (key.startsWith('phone_number_')) {
                    if (value.trim() !== '') phoneNumbers.push(value.trim());
                } else if (key.startsWith('bulk_')) {
                    bulkSSIDs.push(value);
                } else if (key === 'paid'){
                    data[key] = $(form).find('[name="paid"]').is(':checked');
                } else if (key === 'send_invoice'){
                    data[key] = $(form).find('[name="send_invoice"]').is(':checked');
                } else if (key === 'notify_outage'){
                    data[key] = $(form).find('[name="notify_outage"]').is(':checked');
                } else if (key === 'free_first_month'){
                    data[key] = $(form).find('[name="free_first_month"]').is(':checked');
                } else if (key === 'latitude' || key === 'longitude') {
                    data[key] = value.trim() === '' ? null : parseFloat(value);
                } else {
                    data[key] = value;
                }
            });
            
            // Validate phone numbers limit
            if (phoneNumbers.length > maxPhoneLimit) {
                Swal.fire({
                    icon: 'error',
                    title: 'Validasi Gagal',
                    text: `Maksimal ${maxPhoneLimit} nomor HP sesuai konfigurasi. Anda memasukkan ${phoneNumbers.length} nomor.`
                });
                submitButton.prop('disabled', false).html(originalButtonText);
                return;
            }
            
            data.phone_number = phoneNumbers.join('|');
            
            // Handle registration mode specific data
            if (!isEditForm) {
                data.registration_mode = registrationMode;
                
                if (registrationMode === 'new') {
                    // Mode New: Full setup with device, WiFi, and PPPoE
                    data.device_id = $('#create_device_id').val();
                    data.wifi_ssid = $('#create_wifi_ssid').val().trim();
                    data.wifi_password = $('#create_wifi_password').val().trim();
                    data.pppoe_username = $('#create_pppoe_username').val().trim();
                    data.pppoe_password = $('#create_pppoe_password').val().trim() || null;
                    data.add_to_mikrotik = true;
                    
                    // Get selected SSID indices for WiFi configuration
                    const selectedSSIDs = [];
                    $('.ssid-checkbox-create:checked').each(function() {
                        selectedSSIDs.push(parseInt($(this).val()));
                    });
                    data.ssid_indices = selectedSSIDs;
                    data.bulk = selectedSSIDs.map(String);
                    
                } else if (registrationMode === 'import') {
                    // Mode Import: Only save to database, no MikroTik/GenieACS setup
                    data.device_id = $('#create_device_id_import').val().trim() || null;
                    data.pppoe_username = $('#import_pppoe_username').val().trim();
                    data.pppoe_password = importValidationResult?.userInfo?.password || null;
                    data.add_to_mikrotik = false; // Don't create in MikroTik
                    data.skip_mikrotik = true; // Flag to skip MikroTik operations
                    
                    // Use profile from MikroTik to match subscription if available
                    if (importValidationResult?.matchedPackage) {
                        data.subscription = importValidationResult.matchedPackage.name;
                        $('#create_subscription').val(importValidationResult.matchedPackage.name);
                    }
                }
            } else {
                // Edit form - use existing bulk SSIDs logic
                // PENTING: Jika tidak ada SSID yang dicentang, otomatis set default SSID dari config (atau SSID 1 sebagai fallback)
                if (bulkSSIDs.length === 0) {
                    const defaultSSID = (window.configData && window.configData.defaultBulkSSID) 
                        ? String(window.configData.defaultBulkSSID) 
                        : '1';
                    bulkSSIDs = [defaultSSID];
                }
                data.bulk = bulkSSIDs;
            }
            
            if(isEditForm && data.hasOwnProperty('id_user_to_edit')) {
                delete data.id_user_to_edit;
            }
            data.connected_odp_id = $(form).find('[name="connected_odp_id"]').val() || null;
            
            // CRITICAL FIX: Always set paid value (checkbox may not be in FormData if unchecked)
            if (!data.hasOwnProperty('paid')) {
                data.paid = $(form).find('[name="paid"]').is(':checked');
            }
            
            // Ensure send_invoice is always sent, even if unchecked
            if (!data.hasOwnProperty('send_invoice')) {
                data.send_invoice = false;
            }

            // Ensure free_first_month is sent (checkbox hanya ada di form Tambah; default false).
            // Backend hanya membacanya saat CREATE (waiver bulan pertama pelanggan baru).
            if (!data.hasOwnProperty('free_first_month')) {
                data.free_first_month = $(form).find('[name="free_first_month"]').is(':checked');
            }

            // Ensure notify_outage is always sent (unchecked checkbox absen dari FormData).
            if (!data.hasOwnProperty('notify_outage')) {
                data.notify_outage = $(form).find('[name="notify_outage"]').is(':checked');
            }

            if (paymentMethod) {
                data.payment_method = paymentMethod;
            }

            const submitButton = $(form).find('button[type="submit"]');
            const originalButtonText = submitButton.html();
            submitButton.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Menyimpan...');

            // DEBUG: Log data being sent
            // User edit form submission

            try { // Use try-catch for the fetch operation
                const response = await fetch(url, {
                    method: method,
                    headers: {'Content-Type': 'application/json'},
                    credentials: 'include',
                    body: JSON.stringify(data)
                });
                const contentType = response.headers.get("content-type");
                let result;
                if (contentType && contentType.indexOf("application/json") !== -1) {
                    result = await response.json();
                    // User edit response received
                } else {
                    const textData = await response.text();
                    console.error("Server tidak merespons dengan JSON (User Form). Respons mentah:", textData);
                    throw new Error("Format respons server tidak valid. Lihat konsol untuk detail.");
                }

                // MODIFIED: Error handling to use displayGlobalUserMessage modal logic
                if (response.ok) { // Check response.ok for 2xx status codes
                    $('#createModal').modal('hide');
                    $('#editModal').modal('hide');
                    const regMode = result.registration_mode || registrationMode || 'legacy';
                    const syncStatus = result.sync_status || result.mikrotik_sync?.status || null;
                    const successType = syncStatus === 'applied' ? 'success' : 'warning';
                    const formattedMessage = buildSyncOutcomeHtml(result, {
                        isEditForm,
                        registrationMode: regMode
                    });
                    displayGlobalUserMessage(formattedMessage, successType, true);
                    
                    refreshAllData(true); 

                } else {
                    // Jika respons tidak OK (misal status 400, 500), tampilkan pesan error dari server via modal
                    displayGlobalUserMessage(`Gagal ${isEditForm ? 'memperbarui' : 'menambahkan'} pengguna: ${(result && result.message) || 'Error tidak diketahui'} (Status: ${response.status})`, 'danger', true);
                }
            } catch (error) { // Catch any network or parsing errors
                displayGlobalUserMessage('Terjadi kesalahan saat mengirim data: ' + error.message, 'danger', true);
            } finally {
                submitButton.prop('disabled', false).html(originalButtonText);
            }
        });

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
                        // Ensure existingBulkSSIDs is an array of strings for consistent comparison
                        let normalizedBulkSSIDs = Array.isArray(existingBulkSSIDs) 
                            ? existingBulkSSIDs.map(idx => String(idx))
                            : [];
                        
                        // PENTING: Jika tidak ada bulk yang di-set, otomatis set default SSID dari config (atau SSID 1 sebagai fallback)
                        if (normalizedBulkSSIDs.length === 0) {
                            // Ambil default SSID dari config, fallback ke '1' jika tidak ada
                            const defaultSSID = (window.configData && window.configData.defaultBulkSSID) 
                                ? String(window.configData.defaultBulkSSID) 
                                : '1';
                            normalizedBulkSSIDs = [defaultSSID];
                            console.log(`[populateBulkSSIDContainer] Tidak ada bulk existing, otomatis set SSID ${defaultSSID} (dari config)`);
                        }
                        
                        bulkContainer.innerHTML = `<label class="form-label">Samakan SSID</label><div class="">` + json.data.ssid.map((ssid, i) => {
                            // Compare as strings for consistency
                            const ssidIdStr = String(ssid.id);
                            const isChecked = normalizedBulkSSIDs.includes(ssidIdStr);
                            
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
        
        // Fix for device ID update in modals
        $('#load_create_ssid_btn, #load_edit_ssid_btn').on('click', function(e) {
            e.preventDefault();
            const isCreate = this.id === 'load_create_ssid_btn';
            const deviceIdInput = isCreate ? $('#create_device_id') : $('#edit_device_id_modal');
            const deviceId = deviceIdInput.val();
            
            if (!deviceId) {
                displayGlobalUserMessage('Masukkan Device ID terlebih dahulu', 'warning', true);
                return;
            }
            
            // Visual feedback
            const btn = $(this);
            const originalText = btn.text();
            btn.prop('disabled', true).text('Loading...');
            
            // Fetch SSID info
            fetch('/api/ssid/' + deviceId, {
                credentials: 'include'
            }).then(response => {
                    if (!response.ok) {
                        throw new Error(`Failed to load SSID: ${response.status}`);
                    }
                    return response.json();
                })
                .then(result => {
                    if (result.data && result.data.ssid_name) {
                        displayGlobalUserMessage(`SSID loaded: ${result.data.ssid_name}`, 'success');
                    } else {
                        displayGlobalUserMessage('SSID loaded successfully', 'success');
                    }
                })
                .catch(error => {
                    console.error('Failed to load SSID:', error);
                    displayGlobalUserMessage('Gagal memuat SSID: ' + error.message, 'danger', true);
                })
                .finally(() => {
                    btn.prop('disabled', false).text(originalText);
                });
        });

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
            }).then(response => {
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
                                    <input type="text" class="form-control form-control-sm" id="modal_ssid_${s.id}" name="ssid_${s.id}" value="${s.name || ''}">
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

            // --- Credentials Modal Logic ---
            $(document).on('click', '.btn-manage-credentials', function() {
                const userId = $(this).data('id');
                const username = $(this).data('username');

                $('#cred_user_id').val(userId);
                $('#cred_username').val(username || '(Akan dibuat otomatis)');
                $('#cred_password').val(''); // Clear password field
            });

            $('#credentialsForm').on('submit', async function(event) {
                event.preventDefault();
                const form = this;
                const userId = $('#cred_user_id').val();
                const url = `/api/users/${userId}/credentials`;
                const method = 'POST';

                const formData = new FormData(form);
                const data = {
                    username: formData.get('username'),
                    password: formData.get('password')
                };

                const submitButton = $(form).find('button[type="submit"]');
                const originalButtonText = submitButton.html();
                submitButton.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Menyimpan...');

                try {
                    const response = await fetch(url, {
                        method: method,
                        headers: {'Content-Type': 'application/json'},
                        credentials: 'include',
                        body: JSON.stringify(data)
                    });

                    const result = await response.json();

                    if (response.ok) {
                        $('#credentialsModal').modal('hide');

                        const creds = result.generated_credentials;
                        const formattedMessage = `<p>${result.message}</p>
                            <p class="mb-1"><b>Kredensial Login Pelanggan:</b></p>
                            <div class="alert alert-info" style="font-family: monospace; word-wrap: break-word;">
                                Username: <strong>${creds.username}</strong><br>
                                Password: <strong>${creds.password}</strong>
                            </div>
                            <p class="mt-2 mb-0 small">Harap salin dan berikan informasi ini kepada pelanggan.</p>`;

                        displayGlobalUserMessage(formattedMessage, 'success', true);
                        refreshAllData(true); // Refresh table to show new username if it was created

                    } else {
                        displayGlobalUserMessage(`Gagal memperbarui kredensial: ${(result && result.message) || 'Error tidak diketahui'}`, 'danger', true);
                    }
                } catch (error) {
                    displayGlobalUserMessage('Terjadi kesalahan saat mengirim data: ' + error.message, 'danger', true);
                } finally {
                    submitButton.prop('disabled', false).html(originalButtonText);
                }
            });

        // Refactored: Open payment method modal for manual invoice actions
        $(document).on('click', '.btn-send-invoice, .btn-print-invoice', function() {
            const userId = $(this).data('id');
            const userName = $(this).data('name');
            const phoneNumber = $(this).data('phone') || '';
            const actionType = $(this).hasClass('btn-send-invoice') ? 'send' : 'print';

            $('#manualInvoiceUserId').val(userId);
            $('#manualInvoiceUserName').val(userName);
            $('#manualInvoicePhoneNumber').val(phoneNumber);
            $('#manualInvoiceActionType').val(actionType);

            $('#paymentMethodModal').modal('show');
        });

        // Kirim pesan "selamat datang" ke pelanggan (mis. setelah No HP diisi untuk pelanggan yg dibuat tanpa HP).
        $(document).on('click', '.btn-send-welcome', async function() {
            const btn = $(this);
            const userId = btn.data('id');
            const userName = btn.data('name') || 'pelanggan ini';
            if (!confirm(`Kirim pesan selamat datang ke ${userName}?`)) return;
            const originalHtml = btn.html();
            btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i>');
            try {
                const response = await fetch(`/api/users/${userId}/send-welcome`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include'
                });
                const data = await response.json().catch(() => ({}));
                const ok = response.ok;
                if (typeof Swal !== 'undefined') {
                    Swal.fire({ icon: ok ? 'success' : 'error', title: ok ? 'Terkirim' : 'Gagal', text: data.message || (ok ? 'Pesan selamat datang terkirim.' : 'Gagal mengirim.') });
                } else {
                    alert(data.message || (ok ? 'Pesan selamat datang terkirim.' : 'Gagal mengirim.'));
                }
            } catch (err) {
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: err.message });
                else alert('Error: ' + err.message);
            } finally {
                btn.prop('disabled', false).html(originalHtml);
            }
        });

        // New: Handle the confirmation from the payment method modal
        $('#confirmInvoiceActionBtn').on('click', async function() {
            const userId = $('#manualInvoiceUserId').val();
            const userName = $('#manualInvoiceUserName').val();
            const phoneNumber = $('#manualInvoicePhoneNumber').val();
            const actionType = $('#manualInvoiceActionType').val();
            const method = $('#paymentMethodSelect').val();
            
            const btn = $(this);
            const originalHtml = btn.html();
            btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i>');

            try {
                if (actionType === 'send') {
                    if (!confirm(`Anda yakin ingin mengirim invoice ke ${userName} dengan metode ${method}?`)) {
                        btn.prop('disabled', false).html(originalHtml);
                        return;
                    }

                    const response = await fetch('/api/send-invoice-manual', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include', // ✅ Fixed by script
                        body: JSON.stringify({ userId, userName, phoneNumber, method }) // Pass method
                    });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.message || 'Gagal mengirim invoice.');
                    
                    displayGlobalUserMessage(`Invoice berhasil dikirim ke ${userName}.`, 'success', true);

                } else if (actionType === 'print') {
                    // For printing, we always generate a new invoice with the selected method
                    // Generating invoice for printing
                    
                    const generateResponse = await fetch('/api/send-invoice-manual', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include', // ✅ Fixed by script
                        body: JSON.stringify({ userId, userName, phoneNumber: '', method, noSend: true }) // Pass method and noSend flag
                    });
                    const generateResult = await generateResponse.json();
                    if (!generateResponse.ok) throw new Error(generateResult.message || 'Gagal membuat invoice baru untuk dicetak.');

                    const newInvoiceId = generateResult.invoiceId;
                    if (!newInvoiceId) throw new Error('Gagal mendapatkan ID dari invoice yang baru dibuat.');

                    // Now open the new invoice for printing
                    const printUrl = `/api/view-invoice?id=${newInvoiceId}&userId=${userId}`;
                    window.open(printUrl, '_blank');
                }
            } catch (error) {
                displayGlobalUserMessage(`Gagal memproses invoice: ${error.message}`, 'danger', true);
            } finally {
                btn.prop('disabled', false).html(originalHtml);
                $('#paymentMethodModal').modal('hide');
            }
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
            .then(response => {
                // First, parse the JSON body of the response.
                return response.json().then(data => {
                    // If the response was not OK (e.g., status 400, 404, 500),
                    // create a new error object that includes the message from the JSON body.
                    if (!response.ok) {
                        const error = new Error(data.message || `HTTP error! Status: ${response.status}`);
                        error.response = data; // Attach the full JSON data to the error object.
                        throw error;
                    }
                    // If the response is OK, just return the data.
                    return data;
                });
            })
            .then(data => {
                // This block now only executes for successful (2xx) responses.
                $('#ssid-update').modal('hide');
                displayGlobalUserMessage(data.message || 'Perubahan SSID berhasil dikirim.', 'success', true);
            })
            .catch(error => {
                // This single catch block will handle network errors and the errors we threw manually above.
                console.error('Error submitting SSID changes:', error.response || error.message);
                // The error message is now much more informative because it comes from the server's JSON response.
                displayGlobalUserMessage('Terjadi kesalahan fatal saat mengirim perubahan SSID: ' + error.message, 'danger', true);
            })
            .finally(() => {
                submitButton.prop('disabled', false).html(originalButtonText);
            });
        });

        function deleteData(id, event) {
            event.preventDefault();
            if (confirm('Anda yakin ingin menghapus pengguna ini?')) {
                fetch('/api/users/' + id, { 
                    method: 'DELETE',
                    credentials: 'include'
                })
                .then(response => response.json().then(data => ({ok: response.ok, data})))
                .then(result => {
                    if (result.ok) {
                        displayGlobalUserMessage(result.data.message || 'Pengguna berhasil dihapus.', 'success', true);
                        // Call refreshAllData with `true` to force it to run even if no filters are active,
                        // and suppress the "no filter active" message.
                        refreshAllData(true); 
                    } else {
                        displayGlobalUserMessage(result.data.message || 'Gagal menghapus pengguna.', 'danger', true);
                    }
                })
                .catch(error => {
                    displayGlobalUserMessage('Terjadi kesalahan: ' + error.message, 'danger', true);
                });
            }
        }

        $('#confirmDeleteAllUsers').on('click', function() {
            const password = $('#adminPassword').val();
            if (!password) {
                alert('Please enter your password.');
                return;
            }

            fetch('/api/admin/delete-all-users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include', // ✅ Fixed by script
                body: JSON.stringify({ password: password })
            })
            .then(response => response.json().then(data => ({ok: response.ok, status: response.status, data})))
            .then(result => {
                if (result.ok && result.data.status === 200) {
                    displayGlobalUserMessage('Semua pengguna berhasil dihapus.', 'success', true);
                    $('#deleteAllUsersModal').modal('hide');
                    $('#adminPassword').val(''); // Clear password field
                    dataTableInstance.ajax.reload();
                } else {
                    const errorMsg = result.data.message || `Error ${result.status}: Gagal menghapus pengguna`;
                    displayGlobalUserMessage(errorMsg, 'danger', true);
                }
            })
            .catch(error => {
                console.error('Error:', error);
                displayGlobalUserMessage('Terjadi kesalahan jaringan: ' + error.message, 'danger', true);
            });
        });

        // ========== BULK CHANGE PROFILE FUNCTIONS ==========
        
        // Store MikroTik profiles
        let mikrotikProfiles = [];
        
        // Load packages and profiles for bulk change dropdowns
        async function loadPackagesForBulkChange() {
            const packageSelect = $('#bulk-from-package');
            const profileSelect = $('#bulk-to-profile');
            
            // Clear existing options except placeholder
            packageSelect.find('option:not(:first)').remove();
            profileSelect.find('option:not(:first)').remove();
            
            // Get users data from DataTable
            let usersData = [];
            if (dataTableInstance) {
                usersData = dataTableInstance.rows().data().toArray();
            }
            
            // Get unique subscriptions from current users
            const subscriptions = [...new Set(usersData.filter(u => u.subscription).map(u => u.subscription))].sort();
            
            // Populate "Package" dropdown with subscriptions that have users
            subscriptions.forEach(sub => {
                const count = usersData.filter(u => u.subscription === sub && u.pppoe_username).length;
                if (count > 0) {
                    packageSelect.append(`<option value="${sub}">${sub} (${count} pelanggan)</option>`);
                }
            });
            
            // Fetch MikroTik profiles
            try {
                const response = await fetch('/api/mikrotik/ppp-profiles', { credentials: 'include' });
                const result = await response.json();
                
                if (result.status === 200 && result.data) {
                    mikrotikProfiles = result.data;
                    result.data.forEach(profile => {
                        profileSelect.append(`<option value="${profile.name}">${profile.name}</option>`);
                    });
                }
            } catch (error) {
                console.error('Failed to load MikroTik profiles:', error);
                // Fallback: use profiles from packages
                if (window.packagesData && Array.isArray(window.packagesData)) {
                    const profiles = [...new Set(window.packagesData.filter(p => p.profile).map(p => p.profile))];
                    profiles.forEach(profile => {
                        profileSelect.append(`<option value="${profile}">${profile}</option>`);
                    });
                }
            }
        }
        
        // Preview affected customers
        function previewBulkChange() {
            const selectedPackage = $('#bulk-from-package').val();
            const targetProfile = $('#bulk-to-profile').val();
            
            if (!selectedPackage) {
                displayGlobalUserMessage('Pilih paket pelanggan terlebih dahulu.', 'warning', true);
                return;
            }
            
            if (!targetProfile) {
                displayGlobalUserMessage('Pilih profil MikroTik tujuan.', 'warning', true);
                return;
            }
            
            // Get users data from DataTable
            let usersData = [];
            if (dataTableInstance) {
                usersData = dataTableInstance.rows().data().toArray();
            }
            
            // Filter users with matching subscription AND pppoe_username
            const affectedUsers = usersData.filter(u => 
                u.subscription === selectedPackage && u.pppoe_username
            );
            
            const tbody = $('#bulk-preview-table tbody');
            tbody.empty();
            
            if (affectedUsers.length === 0) {
                tbody.append(`<tr><td colspan="4" class="text-center text-muted">Tidak ada pelanggan dengan paket "${selectedPackage}" yang memiliki PPPoE username.</td></tr>`);
                $('#bulk-affected-count').text('0');
                $('#bulk-execute-btn').prop('disabled', true);
            } else {
                affectedUsers.forEach(user => {
                    tbody.append(`
                        <tr>
                            <td>${user.id}</td>
                            <td>${user.name || '-'}</td>
                            <td>${user.pppoe_username || '-'}</td>
                            <td>${user.subscription || '-'}</td>
                        </tr>
                    `);
                });
                $('#bulk-affected-count').text(affectedUsers.length);
                $('#bulk-execute-btn').prop('disabled', false);
            }
            
            $('#bulk-preview-section').show();
        }
        
        // Execute bulk change
        async function executeBulkChange() {
            const selectedPackage = $('#bulk-from-package').val();
            const targetProfile = $('#bulk-to-profile').val();
            
            if (!selectedPackage || !targetProfile) {
                displayGlobalUserMessage('Pilih paket dan profil tujuan.', 'warning', true);
                return;
            }
            
            const affectedCount = parseInt($('#bulk-affected-count').text()) || 0;
            if (affectedCount === 0) {
                displayGlobalUserMessage('Tidak ada pelanggan yang akan diubah.', 'warning', true);
                return;
            }
            
            // Confirmation
            const confirmResult = await Swal.fire({
                title: 'Konfirmasi Perubahan Profil Massal',
                html: `
                    <p>Anda akan mengubah profil MikroTik untuk <strong>${affectedCount}</strong> pelanggan dengan paket <strong>${selectedPackage}</strong>:</p>
                    <p><strong>Profil Baru:</strong> ${targetProfile}</p>
                    <hr>
                    <p class="text-info small"><i class="fas fa-sync-alt"></i> Konfigurasi paket hanya ikut diperbarui jika sinkronisasi semua target user berhasil penuh.</p>
                    <p class="text-danger mt-3"><strong>Apakah Anda yakin?</strong></p>
                `,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#667eea',
                cancelButtonColor: '#6c757d',
                confirmButtonText: 'Ya, Terapkan!',
                cancelButtonText: 'Batal'
            });
            
            if (!confirmResult.isConfirmed) return;
            
            const btn = $('#bulk-execute-btn');
            const originalHtml = btn.html();
            btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Memproses...');
            
            try {
                const response = await fetch('/api/users/bulk-change-profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        packageName: selectedPackage,
                        targetProfile: targetProfile
                    })
                });
                
                const result = await response.json();
                
                if (response.ok && result.status === 200) {
                    $('#bulkChangePackageModal').modal('hide');
                    
                    // Show detailed result
                    let resultHtml = `<p><strong>Berhasil:</strong> ${result.successCount} pelanggan</p>`;
                    if (result.sync_status) {
                        resultHtml += `<p><strong>Sync Status:</strong> <code>${result.sync_status}</code></p>`;
                    }
                    if (result.sync_message) {
                        resultHtml += `<p class="small text-muted mb-2">${result.sync_message}</p>`;
                    }
                    if (result.failedCount > 0) {
                        resultHtml += `<p class="text-danger"><strong>Gagal:</strong> ${result.failedCount} pelanggan</p>`;
                        if (result.errors && result.errors.length > 0) {
                            resultHtml += `<details><summary>Detail Error</summary><ul>`;
                            result.errors.slice(0, 5).forEach(err => {
                                resultHtml += `<li>${err.username}: ${err.error}</li>`;
                            });
                            if (result.errors.length > 5) {
                                resultHtml += `<li>...dan ${result.errors.length - 5} lainnya</li>`;
                            }
                            resultHtml += `</ul></details>`;
                        }
                    }
                    if (!result.packageUpdated) {
                        resultHtml += `<p class="small text-warning mb-0"><i class="fas fa-info-circle"></i> Konfigurasi paket tidak diubah otomatis.</p>`;
                    } else {
                        resultHtml += `<p class="small text-success mb-0"><i class="fas fa-check-circle"></i> Konfigurasi paket ikut diperbarui.</p>`;
                    }
                    
                    displayGlobalUserMessage(resultHtml, result.failedCount > 0 ? 'warning' : 'success', true);
                    
                    // Reset modal
                    resetBulkChangeModal();
                } else {
                    displayGlobalUserMessage(`Gagal: ${result.message || 'Error tidak diketahui'}`, 'danger', true);
                }
            } catch (error) {
                displayGlobalUserMessage(`Terjadi kesalahan: ${error.message}`, 'danger', true);
            } finally {
                btn.prop('disabled', false).html(originalHtml);
            }
        }
        
        // Reset bulk change modal
        function resetBulkChangeModal() {
            $('#bulk-from-package').val('');
            $('#bulk-to-profile').val('');
            $('#bulk-preview-section').hide();
            $('#bulk-preview-table tbody').empty();
            $('#bulk-affected-count').text('0');
            $('#bulk-execute-btn').prop('disabled', true);
        }
        
        // Event handlers for bulk change modal
        $('#bulkChangePackageModal').on('show.bs.modal', function() {
            loadPackagesForBulkChange();
            resetBulkChangeModal();
        });
        
        $('#bulk-preview-btn').on('click', function() {
            previewBulkChange();
        });
        
        $('#bulk-execute-btn').on('click', function() {
            executeBulkChange();
        });
        
        // Auto-preview when both selections are made
        $('#bulk-from-package, #bulk-to-profile').on('change', function() {
            const selectedPackage = $('#bulk-from-package').val();
            const targetProfile = $('#bulk-to-profile').val();
            
            if (selectedPackage && targetProfile) {
                previewBulkChange();
            } else {
                $('#bulk-preview-section').hide();
                $('#bulk-execute-btn').prop('disabled', true);
            }
        });
        
        // ========== END BULK CHANGE PROFILE FUNCTIONS ==========

        // ========== SYNC PROFILE TO MIKROTIK FUNCTIONS ==========
        let syncProfileData = [];
        
        // Scan for profile differences between system and MikroTik
        async function scanProfileDifferences() {
            const scanBtn = $('#scanProfileDiff');
            const statusSpan = $('#syncScanStatus');
            
            scanBtn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Scanning...');
            statusSpan.text('Mengambil data dari MikroTik...');
            
            try {
                const response = await fetch('/api/users/profile-diff');
                const result = await response.json();
                
                if (result.status !== 200) {
                    throw new Error(result.message || 'Gagal scan perbedaan profil');
                }
                
                syncProfileData = result.data.different || [];
                const sameCount = result.data.same || 0;
                const notFoundCount = result.data.notFound || 0;
                
                // Update stats
                $('#syncTotalDiff').text(syncProfileData.length);
                $('#syncTotalSame').text(sameCount);
                $('#syncSelectedCount').text('0');
                $('#syncBtnCount').text('0');
                
                // Render table
                renderSyncProfileTable();
                
                // Show result section
                $('#syncProfileResult').show();
                
                statusSpan.html(`<span class="text-success"><i class="fas fa-check"></i> Scan selesai</span>`);
                
                if (syncProfileData.length === 0) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Semua Profil Sudah Sinkron!',
                        text: `${sameCount} pelanggan sudah memiliki profil yang sama di sistem dan MikroTik.`,
                        timer: 3000
                    });
                }
                
            } catch (error) {
                console.error('Scan error:', error);
                statusSpan.html(`<span class="text-danger"><i class="fas fa-times"></i> ${error.message}</span>`);
                Swal.fire('Error', error.message, 'error');
            } finally {
                scanBtn.prop('disabled', false).html('<i class="fas fa-search"></i> Scan Perbedaan Profil');
            }
        }
        
        // Render sync profile table
        function renderSyncProfileTable() {
            const tbody = $('#syncProfileTableBody');
            
            if (syncProfileData.length === 0) {
                tbody.html('<tr><td colspan="7" class="text-center text-success py-4"><i class="fas fa-check-circle fa-2x mb-2"></i><br>Semua profil sudah sinkron!</td></tr>');
                return;
            }
            
            let html = '';
            syncProfileData.forEach((item, index) => {
                const statusBadge = item.mikrotikProfile 
                    ? '<span class="badge badge-warning"><i class="fas fa-exclamation-triangle"></i> Berbeda</span>'
                    : '<span class="badge badge-secondary"><i class="fas fa-question"></i> Tidak ada di MikroTik</span>';
                
                html += `
                    <tr data-index="${index}">
                        <td><input type="checkbox" class="sync-row-check" data-index="${index}" onchange="updateSyncSelection()"></td>
                        <td>${escapeHtml(item.name)}</td>
                        <td><code>${escapeHtml(item.pppoe_username)}</code></td>
                        <td>${escapeHtml(item.subscription || '-')}</td>
                        <td><span class="badge badge-success">${escapeHtml(item.systemProfile || '-')}</span></td>
                        <td><span class="badge badge-danger">${escapeHtml(item.mikrotikProfile || 'N/A')}</span></td>
                        <td>${statusBadge}</td>
                    </tr>
                `;
            });
            
            tbody.html(html);
        }
        
        // Helper function for escaping HTML
        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function resetExcelImportState() {
            excelImportPreviewReady = false;
            excelImportBusy = false;
            $('#excelImportResult').hide().empty();
            $('#previewExcelImportBtn').prop('disabled', false).html('<i class="fas fa-search"></i> Preview');
            $('#commitExcelImportBtn').prop('disabled', true).html('<i class="fas fa-check"></i> Import ke Sistem');
        }

        function renderExcelImportResult(result) {
            const summary = result.summary || {};
            const rows = Array.isArray(result.rows) ? result.rows : [];
            const warnings = Array.isArray(result.warnings) ? result.warnings : [];
            const hasInvalidRows = (summary.invalidRows || 0) > 0 || rows.some(row => ['invalid', 'failed'].includes(row.status));
            const modeLabel = result.mode === 'commit' ? 'Hasil Import' : 'Hasil Preview';
            const createCount = result.mode === 'commit'
                ? (summary.createdCount || 0)
                : (summary.createRows || 0);
            const updateCount = result.mode === 'commit'
                ? (summary.updatedCount || 0)
                : (summary.updateRows || 0);

            const summaryHtml = `
                <div class="row">
                    <div class="col-md-3 mb-2"><div class="border rounded p-2 text-center"><strong>${summary.totalRows || 0}</strong><br><small>Total Baris</small></div></div>
                    <div class="col-md-3 mb-2"><div class="border rounded p-2 text-center"><strong>${summary.validRows || 0}</strong><br><small>Baris Valid</small></div></div>
                    <div class="col-md-3 mb-2"><div class="border rounded p-2 text-center"><strong>${createCount}</strong><br><small>Create</small></div></div>
                    <div class="col-md-3 mb-2"><div class="border rounded p-2 text-center"><strong>${updateCount}</strong><br><small>Update</small></div></div>
                </div>
            `;

            const warningsHtml = warnings.length > 0
                ? `<div class="alert alert-warning mt-3 mb-3"><strong>Peringatan Header:</strong><ul class="mb-0 mt-2">${warnings.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`
                : '';

            const rowsHtml = rows.length > 0
                ? `
                    <div class="table-responsive mt-3" style="max-height: 320px; overflow-y: auto;">
                        <table class="table table-sm table-bordered">
                            <thead class="thead-light">
                                <tr>
                                    <th>Baris</th>
                                    <th>Aksi</th>
                                    <th>Status</th>
                                    <th>Target</th>
                                    <th>Detail</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows.map((row) => {
                                    const badgeClass = row.status === 'success' || row.status === 'valid'
                                        ? 'success'
                                        : (row.status === 'failed' || row.status === 'invalid' ? 'danger' : 'secondary');
                                    const detailMessages = Array.isArray(row.messages)
                                        ? row.messages
                                        : [row.message || '-'];
                                    return `
                                        <tr>
                                            <td>${escapeHtml(String(row.rowNumber || '-'))}</td>
                                            <td>${escapeHtml(String(row.action || '-'))}</td>
                                            <td><span class="badge badge-${badgeClass}">${escapeHtml(String(row.status || '-'))}</span></td>
                                            <td>${escapeHtml(String(row.targetName || row.targetId || '-'))}</td>
                                            <td><ul class="mb-0 pl-3">${detailMessages.map(message => `<li>${escapeHtml(String(message))}</li>`).join('')}</ul></td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                `
                : '<div class="text-muted mt-3">Belum ada detail baris untuk ditampilkan.</div>';

            const resultClass = hasInvalidRows ? 'warning' : 'success';
            $('#excelImportResult').html(`
                <div class="card border-${resultClass}">
                    <div class="card-body">
                        <h6 class="mb-2"><i class="fas fa-table"></i> ${escapeHtml(modeLabel)}</h6>
                        <p class="mb-2">${escapeHtml(result.message || '-')}</p>
                        ${summaryHtml}
                        ${warningsHtml}
                        ${rowsHtml}
                    </div>
                </div>
            `).show();
        }

        async function submitExcelImport(mode) {
            if (excelImportBusy) {
                return;
            }

            const fileInput = document.getElementById('excelImportFile');
            const file = fileInput && fileInput.files ? fileInput.files[0] : null;

            if (!file) {
                Swal.fire('Peringatan', 'Pilih file Excel terlebih dahulu.', 'warning');
                return;
            }

            excelImportBusy = true;
            const previewBtn = $('#previewExcelImportBtn');
            const commitBtn = $('#commitExcelImportBtn');
            const activeBtn = mode === 'commit' ? commitBtn : previewBtn;
            const originalPreviewHtml = previewBtn.html();
            const originalCommitHtml = commitBtn.html();

            previewBtn.prop('disabled', true);
            commitBtn.prop('disabled', true);
            activeBtn.html('<i class="fas fa-spinner fa-spin"></i> Memproses...');

            try {
                const formData = new FormData();
                formData.append('excel_file', file);
                formData.append('mode', mode);

                const response = await fetch(`/api/users/excel/import?mode=${encodeURIComponent(mode)}`, {
                    method: 'POST',
                    credentials: 'include',
                    body: formData
                });

                const result = await response.json();
                renderExcelImportResult(result);

                if (mode === 'validate') {
                    excelImportPreviewReady = response.ok && (result.summary?.invalidRows || 0) === 0;
                    commitBtn.prop('disabled', !excelImportPreviewReady);
                    if (excelImportPreviewReady) {
                        Swal.fire('Preview Siap', 'Semua baris valid. Anda bisa melanjutkan import ke sistem.', 'success');
                    } else {
                        Swal.fire('Perlu Perbaikan', result.message || 'Masih ada baris yang tidak valid.', 'warning');
                    }
                } else {
                    if (response.ok) {
                        refreshAllData(true);
                        excelImportPreviewReady = false;
                        commitBtn.prop('disabled', true);
                        Swal.fire(
                            (result.summary?.failedCount || 0) > 0 ? 'Import Selesai dengan Catatan' : 'Import Berhasil',
                            result.message || 'Import selesai diproses.',
                            (result.summary?.failedCount || 0) > 0 ? 'warning' : 'success'
                        );
                    } else {
                        Swal.fire('Import Gagal', result.message || 'Import belum dapat dijalankan.', 'warning');
                    }
                }
            } catch (error) {
                console.error('Excel import error:', error);
                Swal.fire('Error', 'Gagal memproses file Excel: ' + error.message, 'error');
            } finally {
                excelImportBusy = false;
                previewBtn.html(originalPreviewHtml).prop('disabled', false);
                commitBtn.html(originalCommitHtml).prop('disabled', !excelImportPreviewReady);
            }
        }

        $('#excelImportFile').on('change', function() {
            const fileName = this.files && this.files[0] ? this.files[0].name : 'Pilih file Excel...';
            $(this).next('.custom-file-label').text(fileName);
            resetExcelImportState();
        });

        $('#previewExcelImportBtn').on('click', function() {
            submitExcelImport('validate');
        });

        $('#commitExcelImportBtn').on('click', async function() {
            if (!excelImportPreviewReady) {
                Swal.fire('Preview Diperlukan', 'Jalankan preview yang valid terlebih dahulu sebelum commit import.', 'warning');
                return;
            }

            const confirmation = await Swal.fire({
                title: 'Lanjutkan Import?',
                text: 'Data pelanggan di file Excel akan diproses ke sistem.',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Ya, Import',
                cancelButtonText: 'Batal'
            });

            if (!confirmation.isConfirmed) {
                return;
            }

            submitExcelImport('commit');
        });

        $('#excelImportModal').on('show.bs.modal', function() {
            resetExcelImportState();
        });

        $('#excelImportModal').on('hidden.bs.modal', function() {
            $('#excelImportFile').val('');
            $('#excelImportFile').next('.custom-file-label').text('Pilih file Excel...');
            resetExcelImportState();
        });
        
        // Toggle check all sync rows
        function toggleSyncCheckAll() {
            const isChecked = $('#syncCheckAll').prop('checked');
            $('.sync-row-check').prop('checked', isChecked);
            updateSyncSelection();
        }
        
        // Select all sync rows
        function selectAllSyncRows() {
            $('.sync-row-check').prop('checked', true);
            $('#syncCheckAll').prop('checked', true);
            updateSyncSelection();
        }
        
        // Deselect all sync rows
        function deselectAllSyncRows() {
            $('.sync-row-check').prop('checked', false);
            $('#syncCheckAll').prop('checked', false);
            updateSyncSelection();
        }
        
        // Update sync selection count
        function updateSyncSelection() {
            const selectedCount = $('.sync-row-check:checked').length;
            $('#syncSelectedCount').text(selectedCount);
            $('#syncBtnCount').text(selectedCount);
            $('#executeSyncBtn').prop('disabled', selectedCount === 0);
        }
        
        // Execute sync profiles to MikroTik
        async function executeSyncProfiles() {
            const selectedIndexes = [];
            $('.sync-row-check:checked').each(function() {
                selectedIndexes.push(parseInt($(this).data('index')));
            });
            
            if (selectedIndexes.length === 0) {
                Swal.fire('Peringatan', 'Pilih minimal satu pelanggan untuk disinkronkan', 'warning');
                return;
            }
            
            // Get selected users data
            const usersToSync = selectedIndexes.map(idx => syncProfileData[idx]);
            
            // Confirm
            const confirm = await Swal.fire({
                title: 'Konfirmasi Sinkronisasi',
                html: `Anda akan menyinkronkan profil <strong>${usersToSync.length}</strong> pelanggan ke MikroTik.<br><br>
                       <small class="text-muted">Profil di MikroTik akan diubah sesuai dengan paket di sistem.</small>`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Ya, Sinkronkan',
                cancelButtonText: 'Batal',
                confirmButtonColor: '#f59e0b'
            });
            
            if (!confirm.isConfirmed) return;
            
            // Show loading
            Swal.fire({
                title: 'Menyinkronkan...',
                html: 'Memproses <b>0</b> dari <b>' + usersToSync.length + '</b> pelanggan',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });
            
            try {
                const response = await fetch('/api/users/sync-profiles', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ users: usersToSync })
                });
                
                const result = await response.json();
                
                if (result.status === 200) {
                    const successCount = result.results?.success?.length || 0;
                    const failedCount = result.results?.failed?.length || 0;
                    
                    let message = `<strong>${successCount}</strong> pelanggan berhasil disinkronkan.`;
                    if (failedCount > 0) {
                        message += `<br><strong>${failedCount}</strong> gagal.`;
                        const failedList = result.results.failed.map(f => 
                            `<li>${f.name}: ${f.reason}</li>`
                        ).join('');
                        message += `<br><br><small>Detail gagal:<ul class="text-left">${failedList}</ul></small>`;
                    }
                    
                    await Swal.fire({
                        title: 'Sinkronisasi Selesai',
                        html: message,
                        icon: successCount > 0 ? 'success' : 'warning'
                    });
                    
                    // Refresh scan
                    scanProfileDifferences();
                    
                } else {
                    Swal.fire('Error', result.message || 'Gagal menyinkronkan profil', 'error');
                }
                
            } catch (error) {
                console.error('Sync error:', error);
                Swal.fire('Error', 'Gagal menghubungi server: ' + error.message, 'error');
            }
        }
        
        // Reset sync modal on show
        $('#syncProfileModal').on('show.bs.modal', function() {
            syncProfileData = [];
            $('#syncProfileResult').hide();
            $('#syncProfileTableBody').html('<tr><td colspan="7" class="text-center text-muted py-4">Klik "Scan Perbedaan Profil" untuk memulai</td></tr>');
            $('#syncScanStatus').text('');
            $('#syncTotalDiff').text('0');
            $('#syncTotalSame').text('0');
            $('#syncSelectedCount').text('0');
            $('#syncBtnCount').text('0');
            $('#executeSyncBtn').prop('disabled', true);
        });
        
        // ========== END SYNC PROFILE FUNCTIONS ==========
