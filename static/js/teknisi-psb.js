        // Global variables
        let map = null;
        let marker = null;
        let tempId = 'TEMP_' + Date.now();
        let ktpPhotoPath = null;
        let housePhotoPath = null;
        let currentCustomerId = null;

        // Initialize page
        // Get max phone limit from config
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
                
                if (configData && configData.accessLimit !== undefined && configData.accessLimit !== null) {
                    const loadedLimit = parseInt(configData.accessLimit);
                    if (!isNaN(loadedLimit) && loadedLimit > 0) {
                        maxPhoneLimit = loadedLimit;
                        $('#max-phone-limit').text(maxPhoneLimit);
                        // Update add button disabled state after load
                        const fieldCount = $('#phone_number_container .phone-number-item').length;
                        $('#add-phone-btn').prop('disabled', fieldCount >= maxPhoneLimit);
                    }
                }
            })
            .catch(err => {
                console.error('[PSB] ✗ Failed to load config for phone limit:', err);
                console.warn('[PSB] Using default max phone limit:', maxPhoneLimit);
            });

        // Add phone number field function
        function addPhoneNumberField(value = '', isFirst = false) {
            const container = document.getElementById('phone_number_container');
            if (!container) return;

            if (isFirst) {
                container.innerHTML = '';
            }

            const fieldCount = container.querySelectorAll('.phone-number-item').length;
            if (fieldCount >= maxPhoneLimit) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Maksimal Nomor HP',
                    text: `Maksimal ${maxPhoneLimit} nomor HP sesuai konfigurasi.`
                });
                return;
            }

            const id = `phone_${new Date().getTime()}_${Math.random().toString(16).slice(2)}`;
            const disableDelete = fieldCount === 0 && isFirst;

            const fieldHtml = `
                <div class="d-flex phone-number-item ${id}" style="gap: 0.25rem; margin-top: ${fieldCount > 0 ? '0.25rem' : '0'};">
                    <input type="text" class="form-control form-control-sm" style="width: 100%;" 
                           name="phone_number_${id}" 
                           value="${value}" 
                           placeholder="Masukkan nomor HP di sini" 
                           autocomplete="tel" />
                    <button class="btn btn-danger btn-sm py-0 px-1" type="button" 
                            onclick="deletePhoneField('${id}')" 
                            ${disableDelete ? 'disabled' : ''}
                            title="Hapus nomor HP">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', fieldHtml);

            // Update delete buttons state
            const allFields = container.querySelectorAll('.phone-number-item');
            allFields.forEach(field => {
                const deleteBtn = field.querySelector('button.btn-danger');
                if (deleteBtn) {
                    deleteBtn.disabled = (allFields.length === 1);
                }
            });

            // Update add button state
            $('#add-phone-btn').prop('disabled', allFields.length >= maxPhoneLimit);
        }

        // Delete phone number field function
        function deletePhoneField(fieldId) {
            const container = document.getElementById('phone_number_container');
            if (!container) return;

            const field = container.querySelector(`.${fieldId}`);
            if (field) field.remove();

            const allFields = container.querySelectorAll('.phone-number-item');
            
            // If no fields left, add one empty field
            if (allFields.length === 0) {
                addPhoneNumberField('', true);
            } else {
                // Update delete buttons state
                allFields.forEach(field => {
                    const deleteBtn = field.querySelector('button.btn-danger');
                    if (deleteBtn) {
                        deleteBtn.disabled = (allFields.length === 1);
                    }
                });
            }

            // Update add button state
            $('#add-phone-btn').prop('disabled', allFields.length >= maxPhoneLimit);
        }

        // Add phone button click handler
        $('#add-phone-btn').on('click', function() {
            addPhoneNumberField();
        });

        $(document).ready(function() {
            // Initialize with one phone number field
            addPhoneNumberField('', true);
            console.log('[PSB] Document ready, initializing...');
            
            // Wait a bit to ensure all elements are rendered
            setTimeout(function() {
                loadPackages();
                loadNetworkAssets();
                initializeMap();
                setupEventHandlers();
                console.log('[PSB] Initialization complete');
            }, 100);
        });

        // Load packages for subscription dropdown
        function loadPackages() {
            fetch('/api/packages', { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200 && data.data) {
                        const select = $('#subscription');
                        select.empty();
                        select.append('<option value="">Pilih Paket...</option>');
                        data.data.forEach(pkg => {
                            select.append(`<option value="${pkg.name}">${pkg.name}</option>`);
                        });
                    }
                })
                .catch(err => {
                    console.error('Error loading packages:', err);
                    showMessage('error', 'Gagal memuat daftar paket');
                });
        }

        // Global variables for network assets
        let allNetworkAssets = [];
        let allOdcList = [];
        let allOdpList = [];

        // Load network assets (ODC & ODP) for cascading dropdown
        function loadNetworkAssets() {
            fetch(`/api/map/network-assets?_=${new Date().getTime()}`, { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200 && Array.isArray(data.data)) {
                        allNetworkAssets = data.data;
                        allOdcList = data.data.filter(asset => asset.type === 'ODC');
                        allOdpList = data.data.filter(asset => asset.type === 'ODP');
                        
                        // Sort by name
                        allOdcList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                        allOdpList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                        
                        // Populate ODC dropdown
                        const odcSelect = $('#odc_id');
                        odcSelect.empty();
                        odcSelect.append('<option value="">Pilih ODC...</option>');
                        allOdcList.forEach(odc => {
                            const displayName = `${odc.name || odc.id}${odc.address ? ' - ' + odc.address : ''}`;
                            odcSelect.append(`<option value="${odc.id}">${displayName}</option>`);
                        });
                        
                        // Initialize Select2 for ODC
                        odcSelect.select2({
                            theme: 'bootstrap',
                            placeholder: 'Pilih ODC...',
                            allowClear: true,
                            width: '100%'
                        });
                        
                        // Initialize Select2 for ODP (disabled initially, must select ODC first)
                        const odpSelect = $('#odp_id');
                        odpSelect.empty();
                        odpSelect.append('<option value="">Pilih ODP...</option>');
                        odpSelect.prop('disabled', true);
                        odpSelect.select2({
                            theme: 'bootstrap',
                            placeholder: 'Pilih ODC terlebih dahulu...',
                            allowClear: true,
                            width: '100%'
                        });
                        
                        // Handle ODC change event - ODP depends on ODC selection
                        odcSelect.on('change', function() {
                            const selectedOdcId = $(this).val();
                            updateOdpDropdown(selectedOdcId);
                        });
                    } else {
                        console.error('Invalid network assets data:', data);
                        showMessage('warning', 'Gagal memuat daftar ODP/ODC');
                    }
                })
                .catch(err => {
                    console.error('Error loading network assets:', err);
                    showMessage('warning', 'Gagal memuat daftar ODP/ODC');
                });
        }

        // Update ODP dropdown based on selected ODC
        // ODC and ODP are optional, but if filled, must follow order: ODC first, then ODP
        function updateOdpDropdown(odcId) {
            const odpSelect = $('#odp_id');
            odpSelect.empty();
            
            if (!odcId || odcId === '') {
                // If ODC is not selected or cleared, disable and clear ODP
                odpSelect.append('<option value="">Pilih ODP...</option>');
                odpSelect.prop('disabled', true);
                odpSelect.val('').trigger('change');
                return;
            }
            
            // Filter ODP by parent ODC
            const filteredOdp = allOdpList.filter(odp => String(odp.parent_odc_id) === String(odcId));
            
            odpSelect.append('<option value="">Pilih ODP...</option>');
            if (filteredOdp.length > 0) {
                // If there are ODPs for the selected ODC, enable dropdown and populate
                filteredOdp.forEach(odp => {
                    const displayName = `${odp.name || odp.id}${odp.address ? ' - ' + odp.address : ''}`;
                    odpSelect.append(`<option value="${odp.id}">${displayName}</option>`);
                });
                odpSelect.prop('disabled', false);
            } else {
                // If no ODPs for the selected ODC, show message and keep disabled
                odpSelect.append('<option value="">Tidak ada ODP untuk ODC ini</option>');
                odpSelect.prop('disabled', true);
            }
            
            odpSelect.trigger('change');
        }

        // Initialize Leaflet map
        function initializeMap() {
            // Default ke Bojonegoro, Jawa Timur
            const defaultLat = -7.1500;
            const defaultLng = 111.8817;
            const defaultZoom = 13;
            
            // Max zoom untuk setiap layer
            const osmMaxZoom = 22;
            const satelliteMaxZoom = 18; // Esri World Imagery hanya support sampai level 18
            
            // Buat OpenStreetMap layer
            const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: osmMaxZoom,
                attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            });
            
            // Buat Satellite layer (Esri World Imagery)
            const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: satelliteMaxZoom,
                maxNativeZoom: 18, // Esri World Imagery hanya support sampai level 18
                attribution: 'Tiles &copy; Esri',
                errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' // Transparent 1x1 pixel
            });
            
            // Initialize map dengan satellite layer sebagai default
            map = L.map('location-map', {
                layers: [satelliteLayer], // Default layer
                maxZoom: satelliteMaxZoom // Initial maxZoom for the map
            }).setView([defaultLat, defaultLng], defaultZoom);
            
            // Tambahkan layer control
            const baseMaps = {
                "Satelit": satelliteLayer,
                "OpenStreetMap": osmLayer
            };
            L.control.layers(baseMaps, null, { collapsed: true, position: 'topright' }).addTo(map);
            
            // Handle baselayer change untuk update maxZoom
            map.on('baselayerchange', function(e) {
                let newMaxZoom = (e.name === "Satelit") ? satelliteMaxZoom : osmMaxZoom;
                if (map.options.maxZoom !== newMaxZoom) {
                    map.options.maxZoom = newMaxZoom;
                    // Update zoom jika current zoom melebihi maxZoom baru
                    if (map.getZoom() > newMaxZoom) {
                        map.setZoom(newMaxZoom);
                    }
                }
            });

            map.on('click', function(e) {
                const lat = e.latlng.lat;
                const lng = e.latlng.lng;
                updateLocation(lat, lng);
            });

            // Tambahkan GPS control button di map
            const GpsControl = L.Control.extend({
                options: { position: 'topleft' },
                onAdd: function(mapInstance) {
                    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom-gps');
                    const iconHTML = '<i class="fas fa-crosshairs"></i>';
                    const loadingIconHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    container.innerHTML = iconHTML;
                    container.title = 'Dapatkan Lokasi GPS Saat Ini';
                    
                    L.DomEvent.on(container, 'click', L.DomEvent.stopPropagation)
                        .on(container, 'click', L.DomEvent.preventDefault)
                        .on(container, 'click', function() {
                            container.innerHTML = loadingIconHTML;
                            showMessage('info', 'Meminta lokasi GPS...');
                            
                            if (navigator.geolocation) {
                                navigator.geolocation.getCurrentPosition(
                                    function(position) {
                                        container.innerHTML = iconHTML;
                                        const lat = position.coords.latitude;
                                        const lng = position.coords.longitude;
                                        const accuracy = position.coords.accuracy || 0;
                                        
                                        updateLocation(lat, lng);
                                        
                                        let accuracyMessage = '';
                                        if (accuracy > 1000) {
                                            accuracyMessage = ` (Akurasi rendah: ${Math.round(accuracy)}m)`;
                                        } else if (accuracy > 150) {
                                            accuracyMessage = ` (Akurasi sedang: ${Math.round(accuracy)}m)`;
                                        } else {
                                            accuracyMessage = ` (Akurasi baik: ${Math.round(accuracy)}m)`;
                                        }
                                        
                                        showMessage('success', 'Lokasi GPS berhasil diambil' + accuracyMessage);
                                    },
                                    function(error) {
                                        container.innerHTML = iconHTML;
                                        handleGeolocationError(error);
                                    },
                                    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
                                );
                            } else {
                                container.innerHTML = iconHTML;
                                showMessage('error', 'Browser tidak mendukung geolocation');
                            }
                        });
                    
                    return container;
                }
            });
            
            new GpsControl().addTo(map);
        }

        // Handle geolocation error
        function handleGeolocationError(error) {
            let errorMessage = 'Gagal mengambil lokasi: ';
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    errorMessage += 'Izin lokasi ditolak. Periksa pengaturan lokasi di OS & Browser Anda.';
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorMessage += 'Informasi lokasi tidak tersedia. Pastikan GPS/Layanan Lokasi aktif.';
                    break;
                case error.TIMEOUT:
                    errorMessage += 'Waktu permintaan lokasi habis. Sinyal mungkin lemah.';
                    break;
                default:
                    errorMessage += `Kesalahan (Code: ${error.code || 'N/A'}). Cek koneksi & HTTPS.`;
                    break;
            }
            showMessage('error', errorMessage);
        }

        // Update location coordinates and marker
        function updateLocation(lat, lng) {
            $('#latitude').val(lat);
            $('#longitude').val(lng);
            
            if (marker) {
                map.removeLayer(marker);
            }
            marker = L.marker([lat, lng]).addTo(map);
            map.setView([lat, lng], 15);
        }

        // Setup event handlers
        function setupEventHandlers() {
            console.log('[PSB] Setting up event handlers...');
            
            // Verify elements exist before setting up handlers
            const ktpInput = $('#ktp_photo');
            const ktpContainer = $('#ktp-upload-container');
            const ktpBtn = $('#ktp-select-btn');
            const houseInput = $('#house_photo');
            const houseContainer = $('#house-upload-container');
            const houseBtn = $('#house-select-btn');
            
            console.log('[PSB] Element check:', {
                ktpInput: ktpInput.length,
                ktpContainer: ktpContainer.length,
                ktpBtn: ktpBtn.length,
                houseInput: houseInput.length,
                houseContainer: houseContainer.length,
                houseBtn: houseBtn.length
            });
            
            // Photo upload handlers
            if (ktpInput.length && ktpContainer.length) {
                setupPhotoUpload('ktp_photo', 'ktp-upload-container', 'ktp-preview', 'ktp');
            } else {
                console.error('[PSB] KTP elements not found!');
            }
            
            if (houseInput.length && houseContainer.length) {
                setupPhotoUpload('house_photo', 'house-upload-container', 'house-preview', 'house');
            } else {
                console.error('[PSB] House elements not found!');
            }
            
            // File select buttons - use direct event binding
            if (ktpBtn.length) {
                ktpBtn.off('click').on('click', function(e) {
                    e.preventDefault();
                    console.log('[PSB] KTP select button clicked');
                    const input = document.getElementById('ktp_photo');
                    if (input) {
                        console.log('[PSB] Triggering KTP input click');
                        // Use setTimeout to ensure click happens after event propagation
                        setTimeout(function() {
                            input.click();
                        }, 0);
                    } else {
                        console.error('[PSB] KTP input not found');
                    }
                });
            } else {
                console.error('[PSB] KTP select button not found!');
            }
            
            if (houseBtn.length) {
                houseBtn.off('click').on('click', function(e) {
                    e.preventDefault();
                    console.log('[PSB] House select button clicked');
                    const input = document.getElementById('house_photo');
                    if (input) {
                        console.log('[PSB] Triggering house input click');
                        // Use setTimeout to ensure click happens after event propagation
                        setTimeout(function() {
                            input.click();
                        }, 0);
                    } else {
                        console.error('[PSB] House input not found');
                    }
                });
            } else {
                console.error('[PSB] House select button not found!');
            }

            // Google Maps link parser
            $('#location_url').on('blur', function() {
                const url = $(this).val();
                if (url) {
                    parseGoogleMapsLink(url);
                }
            });

            // Get current location button
            $('#get-location-btn').on('click', function() {
                if (navigator.geolocation) {
                    showLoading('Mengambil lokasi saat ini...');
                    navigator.geolocation.getCurrentPosition(
                        function(position) {
                            hideLoading();
                            const lat = position.coords.latitude;
                            const lng = position.coords.longitude;
                            updateLocation(lat, lng);
                            showMessage('success', 'Lokasi berhasil diambil');
                        },
                        function(error) {
                            hideLoading();
                            showMessage('error', 'Gagal mengambil lokasi: ' + error.message);
                        }
                    );
                } else {
                    showMessage('error', 'Browser tidak mendukung geolocation');
                }
            });

            // Phase 1 form submit
            $('#phase1-form').on('submit', function(e) {
                e.preventDefault();
                submitPhase1();
            });

            // Reset button
            $('#reset-phase1-btn').on('click', function() {
                resetPhase1();
            });
        }

        // Setup photo upload with drag & drop
        function setupPhotoUpload(inputId, containerId, previewId, type) {
            const input = $('#' + inputId);
            const container = $('#' + containerId);
            const preview = $('#' + previewId);

            // Check if elements exist
            if (input.length === 0 || container.length === 0) {
                console.error(`[PSB] Elements not found: input=${inputId}, container=${containerId}`);
                return;
            }

            console.log(`[PSB] Setting up photo upload for ${type}:`, {
                input: input.length,
                container: container.length,
                preview: preview.length
            });

            // Click to upload - label will handle click automatically
            // But we still need to handle drag & drop
            container.off('click').on('click', function(e) {
                // Label will automatically trigger input click, so we just log
                console.log(`[PSB] Container (label) clicked for ${type}`);
                // No need to manually trigger click - label does it automatically
            });

            // File change
            input.off('change').on('change', function(e) {
                e.preventDefault();
                e.stopPropagation();
                const file = e.target.files[0];
                console.log(`[PSB] File selected for ${type}:`, file ? file.name : 'none');
                if (file) {
                    uploadPhoto(file, type, preview);
                }
            });

            // Drag & drop
            container.on('dragover', function(e) {
                e.preventDefault();
                container.addClass('dragover');
            });

            container.on('dragleave', function(e) {
                e.preventDefault();
                container.removeClass('dragover');
            });

            container.on('drop', function(e) {
                e.preventDefault();
                container.removeClass('dragover');
                const file = e.originalEvent.dataTransfer.files[0];
                if (file && file.type.startsWith('image/')) {
                    uploadPhoto(file, type, preview);
                } else {
                    showMessage('error', 'Hanya file gambar yang diperbolehkan');
                }
            });
        }

        // Upload photo
        function uploadPhoto(file, type, previewContainer) {
            // Validate file
            if (file.size > 5 * 1024 * 1024) {
                showMessage('error', 'Ukuran file maksimal 5MB');
                return;
            }

            if (!file.type.startsWith('image/')) {
                showMessage('error', 'Hanya file gambar yang diperbolehkan');
                return;
            }

            const formData = new FormData();
            formData.append('photo', file);
            formData.append('tempId', tempId);
            formData.append('fieldname', type + '_photo');

            showLoading('Mengupload foto...');

            // Tambahkan tempId dan fieldname ke URL sebagai query parameter untuk memastikan tersedia
            const uploadUrl = `/api/psb/upload-photo?tempId=${encodeURIComponent(tempId)}&fieldname=${encodeURIComponent(type + '_photo')}`;
            
            fetch(uploadUrl, {
                method: 'POST',
                body: formData,
                credentials: 'include'
            })
            .then(res => res.json())
            .then(data => {
                hideLoading();
                if (data.status === 200) {
                    if (type === 'ktp') {
                        ktpPhotoPath = data.data.path;
                    } else {
                        housePhotoPath = data.data.path;
                    }
                    // Show preview with file info
                    showPhotoPreview(data.data.path, previewContainer, type, {
                        filename: data.data.filename,
                        size: data.data.size,
                        tempId: data.data.tempId,
                        storagePath: data.data.storagePath
                    });
                    showMessage('success', `Foto ${type === 'ktp' ? 'KTP' : 'Rumah'} berhasil diupload`);
                } else {
                    showMessage('error', data.message || 'Gagal upload foto');
                }
            })
            .catch(err => {
                hideLoading();
                console.error('Upload error:', err);
                showMessage('error', 'Error saat upload foto');
            });
        }

        // Show photo preview
        function showPhotoPreview(path, container, type, fileInfo = {}) {
            // Add timestamp to prevent caching issues
            const timestamp = new Date().getTime();
            const pathWithCache = path.includes('?') ? `${path}&t=${timestamp}` : `${path}?t=${timestamp}`;
            
            // Extract filename from path for display
            const filename = fileInfo.filename || path.split('/').pop() || 'photo';
            const fileSize = fileInfo.size ? `(${(fileInfo.size / 1024).toFixed(2)} KB)` : '';
            
            // Get full storage path info
            const pathParts = path.split('/');
            let storageInfo = '';
            if (fileInfo.storagePath) {
                storageInfo = `Lokasi: ${fileInfo.storagePath}`;
            } else if (pathParts.length >= 5) {
                const year = pathParts[2] || '';
                const month = pathParts[3] || '';
                storageInfo = `Lokasi: uploads/psb/${year}/${month}/.../${pathParts[pathParts.length - 1]}`;
            } else {
                storageInfo = `Path: ${path}`;
            }
            
            const previewHtml = `
                <div class="photo-preview-item" style="position: relative;">
                    <img src="${pathWithCache}" 
                         alt="Preview ${type}" 
                         style="width: 100%; height: 100%; object-fit: cover;"
                         onload="console.log('[PSB] Photo loaded successfully:', '${path}')"
                         onerror="console.error('[PSB] Photo failed to load:', '${path}'); this.onerror=null; this.src='/img/no-image.png';" />
                    <button type="button" class="remove-photo" onclick="removePhoto('${type}')" title="Hapus foto">
                        <i class="fas fa-times"></i>
                    </button>
                    <div style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.7); color: white; padding: 5px; font-size: 0.7rem; text-align: center;">
                        <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${filename}">
                            ${filename}
                        </div>
                        ${fileSize ? `<div style="font-size: 0.65rem; opacity: 0.8;">${fileSize}</div>` : ''}
                    </div>
                </div>
            `;
            container.html(previewHtml);
            
            // Verify image loads successfully
            const img = new Image();
            img.onload = function() {
                console.log('[PSB] Photo preview verified:', path);
            };
            img.onerror = function() {
                console.error('[PSB] Photo preview failed to load:', path);
                showMessage('warning', 'Foto berhasil diupload tapi preview tidak dapat dimuat. Silakan refresh halaman.');
            };
            img.src = pathWithCache;
        }

        // Remove photo
        function removePhoto(type) {
            if (type === 'ktp') {
                ktpPhotoPath = null;
                $('#ktp_photo').val('');
                $('#ktp-preview').empty();
            } else {
                housePhotoPath = null;
                $('#house_photo').val('');
                $('#house-preview').empty();
            }
        }

        // Parse Google Maps link
        function parseGoogleMapsLink(url) {
            try {
                // Format 1: https://maps.google.com/?q=lat,lng
                const qMatch = url.match(/[?&]q=([^&]+)/);
                if (qMatch) {
                    const coords = qMatch[1].split(',');
                    if (coords.length === 2) {
                        const lat = parseFloat(coords[0].trim());
                        const lng = parseFloat(coords[1].trim());
                        if (!isNaN(lat) && !isNaN(lng)) {
                            updateLocation(lat, lng);
                            return true;
                        }
                    }
                }
                
                // Format 2: https://www.google.com/maps/place/.../@lat,lng
                const placeMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
                if (placeMatch) {
                    const lat = parseFloat(placeMatch[1]);
                    const lng = parseFloat(placeMatch[2]);
                    if (!isNaN(lat) && !isNaN(lng)) {
                        updateLocation(lat, lng);
                        return true;
                    }
                }
                
                showMessage('error', 'Format Google Maps link tidak valid');
                return false;
            } catch (error) {
                showMessage('error', 'Error parsing Google Maps link');
                return false;
            }
        }

        // Submit Phase 1
        function submitPhase1() {
            // Validate
            if (!ktpPhotoPath || !housePhotoPath) {
                showMessage('error', 'Foto KTP dan foto rumah harus diupload');
                return;
            }

            // Collect phone numbers from multiple fields
            const phoneNumbers = [];
            $('#phone_number_container .phone-number-item input').each(function() {
                const value = $(this).val().trim();
                if (value) {
                    phoneNumbers.push(value);
                }
            });

            if (phoneNumbers.length === 0) {
                showMessage('error', 'Minimal 1 nomor HP harus diisi');
                return;
            }

            if (phoneNumbers.length > maxPhoneLimit) {
                showMessage('error', `Maksimal ${maxPhoneLimit} nomor HP sesuai konfigurasi`);
                return;
            }

            // Join phone numbers with pipe separator (same format as users table)
            const phone_number = phoneNumbers.join('|');

            const formData = {
                phone_number: phone_number,
                name: $('#name').val(),
                address: $('#address').val(),
                odc_id: $('#odc_id').val() || null,
                odp_id: $('#odp_id').val() || null,
                location_url: $('#location_url').val() || null,
                latitude: $('#latitude').val() || null,
                longitude: $('#longitude').val() || null,
                ktp_photo_path: ktpPhotoPath,
                house_photo_path: housePhotoPath,
                temp_id: tempId
            };

            showLoading('Menyimpan data awal...');

            fetch('/api/psb/submit-phase1', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData),
                credentials: 'include'
            })
            .then(res => res.json())
            .then(data => {
                hideLoading();
                if (data.status === 200) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Berhasil!',
                        html: `Data pelanggan berhasil disimpan!<br><br>
                            <strong>Detail:</strong><br>
                            Customer ID: ${data.data.customerId}<br>
                            Nama: ${data.data.name}<br>
                            HP: ${data.data.phone_number ? data.data.phone_number.split('|').join(', ') : '-'}<br><br>
                            Silakan lanjut ke halaman instalasi untuk proses pemasangan.`,
                        confirmButtonText: 'Lanjut ke Instalasi'
                    }).then(() => {
                        // Redirect to installation page
                        window.location.href = '/teknisi-psb-installation';
                    });
                } else {
                    showMessage('error', data.message || 'Gagal menyimpan data pelanggan');
                }
            })
            .catch(err => {
                hideLoading();
                console.error('Submit error:', err);
                showMessage('error', 'Error saat menyimpan data');
            });
        }

        // Reset Phase 1
        function resetPhase1() {
            if (confirm('Apakah Anda yakin ingin reset form? Semua data yang sudah diinput akan hilang.')) {
                $('#phase1-form')[0].reset();
                ktpPhotoPath = null;
                housePhotoPath = null;
                $('#ktp-preview').empty();
                $('#house-preview').empty();
                $('#latitude').val('');
                $('#longitude').val('');
                if (marker) {
                    map.removeLayer(marker);
                    marker = null;
                }
                // Reset ke Bojonegoro, Jawa Timur
                map.setView([-7.1500, 111.8817], 13);
                tempId = 'TEMP_' + Date.now();
            }
        }

        // Show loading overlay
        function showLoading(message) {
            $('#loading-message').text(message || 'Memproses...');
            $('#loading-overlay').addClass('active');
        }

        // Hide loading overlay
        function hideLoading() {
            $('#loading-overlay').removeClass('active');
        }

        // Show message
        function showMessage(type, message) {
            const alertClass = type === 'error' ? 'alert-danger' : 'alert-success';
            const icon = type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle';
            const html = `
                <div class="alert ${alertClass} alert-dismissible fade show" role="alert">
                    <i class="fas ${icon}"></i> ${message}
                    <button type="button" class="close" data-dismiss="alert">
                        <span>&times;</span>
                    </button>
                </div>
            `;
            $('#message-container').html(html);
            
            // Auto dismiss after 5 seconds
            setTimeout(() => {
                $('#message-container .alert').fadeOut();
            }, 5000);
        }
