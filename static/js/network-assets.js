        // ===== PERBAIKAN DIMULAI DI SINI =====

        if (window.location.protocol !== "https:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
            console.warn("PERINGATAN: Halaman ini diakses melalui HTTP. Fitur geolokasi mungkin tidak berfungsi atau tidak meminta izin. Silakan gunakan HTTPS.");
        }

        let addAssetMapInstance = null;
        let editAssetMapInstance = null;
        let addAssetMarker = null;
        let editAssetMarker = null;
        let assetsDataTable = null;
        let allAssetsData = []; 
        let allOdcData = []; 

        function displayGlobalAssetMessage(message, type = 'info', duration = 5000) {
            const globalMessageDiv = $('#globalAssetMessage');
            globalMessageDiv.empty(); 
            globalMessageDiv.html(`<div class="alert alert-${type} alert-dismissible fade show" role="alert">${message}<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>`);
            if (duration > 0) {
                setTimeout(() => { globalMessageDiv.find('.alert').alert('close'); }, duration);
            }
        }
        
        function handleGeolocationError(error, contextMessage, displayTarget, fallbackLat, fallbackLng, mapUpdaterFn) {
            console.warn(`${contextMessage} - Error Code: ${error.code}, Message: ${error.message}`);
            let errorText = `<b>${contextMessage}</b><br/>`;
            switch(error.code) {
                case error.PERMISSION_DENIED: errorText += "IZIN LOKASI DITOLAK. Periksa izin di OS & Browser."; break;
                case error.POSITION_UNAVAILABLE: errorText += "INFORMASI LOKASI TIDAK TERSEDIA. Pastikan GPS aktif."; break;
                case error.TIMEOUT: errorText += "WAKTU PERMINTAAN LOKASI HABIS. Sinyal mungkin lemah."; break;
                default: errorText += `Kesalahan (Code: ${error.code || 'N/A'}). Cek koneksi & HTTPS.`; break;
            }
            if (fallbackLat && fallbackLng && mapUpdaterFn) {
                 errorText += "<br/>Menampilkan lokasi default.";
                 mapUpdaterFn(L.latLng(fallbackLat, fallbackLng), false);
            }
            displayTarget(errorText, 'danger', 20000);
        }

        function initializeModalMapAsset(mapId, latInputId, lngInputId, initialLat, initialLng, isEditMode = false) {
            let mapInstanceVar = (mapId === 'addAssetMap') ? addAssetMapInstance : editAssetMapInstance;
            let markerInstanceVar = (mapId === 'addAssetMap') ? addAssetMarker : editAssetMarker;

            const latInput = $(`#${latInputId}`);
            const lngInput = $(`#${lngInputId}`);

            if (mapInstanceVar) { mapInstanceVar.remove(); }
            mapInstanceVar = null; markerInstanceVar = null;

            let defaultLat = -7.24917; 
            let defaultLng = 112.75083; 
            let defaultZoom = 12;

            const viewLat = (initialLat && !isNaN(parseFloat(initialLat))) ? parseFloat(initialLat) : defaultLat;
            const viewLng = (initialLng && !isNaN(parseFloat(initialLng))) ? parseFloat(initialLng) : defaultLng;
            // Pastikan viewZoom tidak melebihi maxZoom (18 untuk satellite)
            const calculatedZoom = (initialLat && initialLng && !isNaN(parseFloat(initialLat)) && !isNaN(parseFloat(initialLng))) ? 18 : defaultZoom;
            const viewZoom = Math.min(calculatedZoom, 18); // Maksimal 18 untuk mencegah error
            
            const osmMaxZoom = 22;
            const satelliteMaxZoom = 18; // Esri World Imagery hanya support sampai level 18

            const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: osmMaxZoom, attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OSM</a>' });
            const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
                maxZoom: satelliteMaxZoom,
                maxNativeZoom: 18, // Esri World Imagery hanya support sampai level 18
                attribution: 'Tiles &copy; Esri',
                errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' // Transparent 1x1 pixel
            });

            mapInstanceVar = L.map(mapId, { layers: [satelliteLayer], maxZoom: satelliteMaxZoom }).setView([viewLat, viewLng], viewZoom);
            
            L.control.layers({ "Satelit": satelliteLayer, "OpenStreetMap": osmLayer }, null, { collapsed: true, position: 'topright' }).addTo(mapInstanceVar);
            mapInstanceVar.on('baselayerchange', function(e) { mapInstanceVar.options.maxZoom = (e.name === "Satelit") ? satelliteMaxZoom : osmMaxZoom; });

            const geolocationOptions = { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 };

            function updateMarkerAndInputs(latlng, setView = false) {
                latInput.val(latlng.lat.toFixed(6));
                lngInput.val(latlng.lng.toFixed(6));
                if (!markerInstanceVar) {
                    markerInstanceVar = L.marker(latlng, { draggable: true }).addTo(mapInstanceVar);
                    if (mapId === 'addAssetMap') addAssetMarker = markerInstanceVar; else editAssetMarker = markerInstanceVar;
                    markerInstanceVar.on('dragend', function(event) {
                        const pos = event.target.getLatLng();
                        latInput.val(pos.lat.toFixed(6));
                        lngInput.val(pos.lng.toFixed(6));
                    });
                } else {
                    markerInstanceVar.setLatLng(latlng);
                }
                if (setView) { mapInstanceVar.setView(latlng, Math.max(mapInstanceVar.getZoom(), 16)); }
            }
            
            function processSuccessfulGeolocation(position, contextMessage, buttonContainer, originalIcon) {
                const userLat = position.coords.latitude;
                const userLng = position.coords.longitude;
                updateMarkerAndInputs(L.latLng(userLat, userLng), true);
                let accuracyMessage = `Lokasi GPS ditemukan (Akurasi: ${Math.round(position.coords.accuracy)}m).`;
                let accuracyType = "success";
                if (position.coords.accuracy > 1000) { accuracyMessage = `Akurasi lokasi sangat rendah (${Math.round(position.coords.accuracy)}m).`; accuracyType = "danger"; } 
                else if (position.coords.accuracy > 150) { accuracyMessage = `Akurasi lokasi sedang (${Math.round(position.coords.accuracy)}m).`; accuracyType = "warning"; }
                displayGlobalAssetMessage(accuracyMessage, accuracyType, 15000);
                if (buttonContainer && originalIcon) { buttonContainer.innerHTML = originalIcon; }
            }

            const GpsControl = L.Control.extend({
                options: { position: 'topleft' },
                onAdd: function (mapCtrl) {
                    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
                    const originalIconHTML = '<i class="fas fa-map-marker-alt"></i>';
                    container.innerHTML = originalIconHTML; container.title = 'Dapatkan Lokasi GPS Saat Ini';
                    L.DomEvent.on(container, 'click', L.DomEvent.stopPropagation).on(container, 'click', L.DomEvent.preventDefault)
                        .on(container, 'click', function() {
                            container.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                            displayGlobalAssetMessage("Meminta lokasi GPS...", "info", 3000);
                            if (navigator.geolocation) {
                                navigator.geolocation.getCurrentPosition(
                                    (pos) => processSuccessfulGeolocation(pos, "Tombol GPS", container, originalIconHTML),
                                    (err) => { handleGeolocationError(err, "Gagal dari Tombol GPS", displayGlobalAssetMessage); container.innerHTML = originalIconHTML; },
                                    geolocationOptions
                                );
                            } else {
                                handleGeolocationError({code: -1, message: "Browser tidak dukung geolokasi."}, "Tombol GPS", displayGlobalAssetMessage); container.innerHTML = originalIconHTML;
                            }
                        });
                    return container;
                }
            });
            new GpsControl().addTo(mapInstanceVar);
            
            if (isEditMode) {
                if (initialLat && initialLng && !isNaN(parseFloat(initialLat)) && !isNaN(parseFloat(initialLng))) {
                    updateMarkerAndInputs(L.latLng(parseFloat(initialLat), parseFloat(initialLng))); 
                }
            } else { 
                if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(
                        (pos) => processSuccessfulGeolocation(pos, "Inisialisasi Peta"),
                        (err) => handleGeolocationError(err, "Inisialisasi Peta", displayGlobalAssetMessage, defaultLat, defaultLng, updateMarkerAndInputs),
                        geolocationOptions 
                    );
                } else {
                     handleGeolocationError({code: -1, message: "Browser tidak dukung geolokasi."}, "Inisialisasi Peta", displayGlobalAssetMessage, defaultLat, defaultLng, updateMarkerAndInputs);
                }
            }

            mapInstanceVar.on('click', function (e) { updateMarkerAndInputs(e.latlng); });
            
            if (mapId === 'addAssetMap') addAssetMapInstance = mapInstanceVar; else editAssetMapInstance = mapInstanceVar;
            
            const modalId = mapId === 'addAssetMap' ? '#addAssetModal' : '#editAssetModal';
            $(modalId).off('shown.bs.modal.mapfix').on('shown.bs.modal.mapfix', function() {
                 setTimeout(function () { if (mapInstanceVar) mapInstanceVar.invalidateSize(); }, 100);
            });
        }

        function handleAssetTypeChange(mode, typeValue) {
            const $capacityField = $(`#assetCapacity${mode}`);
            const $parentOdcGroup = $(`#parentOdcGroup${mode}`);
            const isAddMode = mode === 'Add';

            $parentOdcGroup.hide();
            
            if (typeValue === 'ODP') {
                $parentOdcGroup.show();
                // Set default ODP capacity only if it's currently a default ODC capacity or 0/empty
                if (isAddMode || $capacityField.val() == 144 || $capacityField.val() == 0 || !$capacityField.val()) {
                    $capacityField.val(8);
                }
                if (isAddMode) { loadParentOdcOptions(`parentOdcId${mode}`); }
            } else if (typeValue === 'ODC') {
                // Set default ODC capacity only if it's currently a default ODP capacity or 0/empty
                if (isAddMode || $capacityField.val() == 8 || $capacityField.val() == 0 || !$capacityField.val()) {
                    $capacityField.val(144);
                }
            } else { 
                if (isAddMode) $capacityField.val(0);
            }
        }
        
        /**
         * PERBAIKAN #2: Fungsi ini dirombak total untuk menampilkan kapasitas dan menonaktifkan ODC yang penuh.
         * Membutuhkan variabel global 'allAssetsData' untuk menghitung ODP yang terhubung.
         */
        function loadParentOdcOptions(selectElementId, selectedOdcId = null) {
            const $select = $(`#${selectElementId}`);
            $select.html('<option value="">Memuat ODC...</option>');

            if (allOdcData.length > 0) {
                $select.html('<option value="">Tidak ada induk ODC</option>'); 
                
                allOdcData.forEach(odc => {
                    const odcCapacity = parseInt(odc.capacity_ports) || 0;
                    // Kalkulasi jumlah ODP anak yang sudah terhubung ke ODC ini
                    const childOdpsCount = allAssetsData.filter(asset => asset.type === 'ODP' && String(asset.parent_odc_id) === String(odc.id)).length;
                    
                    const isFull = odcCapacity > 0 && childOdpsCount >= odcCapacity;
                    const statusText = isFull 
                        ? `(Penuh ${childOdpsCount}/${odcCapacity})` 
                        : `(${childOdpsCount}/${odcCapacity || 'N/A'})`;
                    
                    const displayText = `${odc.name} ${statusText}`;
                    
                    const option = new Option(displayText, odc.id);

                    // Nonaktifkan opsi jika ODC penuh, KECUALI jika itu adalah ODC yang sedang dipilih saat ini (untuk mode edit)
                    if (isFull && String(odc.id) !== String(selectedOdcId)) {
                        $(option).prop('disabled', true);
                    }
                    
                    $select.append(option);
                });
            } else {
                $select.html('<option value="" disabled>Tidak ada data ODC yang ditemukan</option>');
            }

            // Inisialisasi atau re-inisialisasi Select2
            if ($select.data('select2')) { $select.select2('destroy'); }
            $select.select2({ 
                theme: "bootstrap", 
                dropdownParent: $select.closest('.modal'), 
                placeholder: 'Pilih Induk ODC', 
                allowClear: true 
            });

            // Set nilai yang dipilih setelah Select2 diinisialisasi
            if (selectedOdcId) {
                $select.val(selectedOdcId).trigger('change.select2');
            } else {
                $select.val(null).trigger('change.select2');
            }
        }
        
        async function fetchAllAssetsAndInitialize() {
            try {
                const response = await $.ajax({ url: '/api/map/network-assets?_=' + new Date().getTime(), method: 'GET' });
                if (response.status === 200 && Array.isArray(response.data)) {
                    allAssetsData = response.data;
                    allOdcData = allAssetsData.filter(asset => asset.type === 'ODC').sort((a,b) => (a.name || "").localeCompare(b.name || ""));
                    
                    if (assetsDataTable) { assetsDataTable.destroy(); $('#assetsDataTable tbody').empty(); }

                    assetsDataTable = $('#assetsDataTable').DataTable({
                        data: allAssetsData,
                        columns: [
                            { data: 'id', width: '10%', className: 'text-monospace small'}, { data: 'name' },
                            { data: 'type', width: '5%', className: "text-center" }, { data: 'address', render: data => data || '-' },
                            { data: null, render: (data, type, row) => (row.latitude && row.longitude) ? `${parseFloat(row.latitude).toFixed(5)}, ${parseFloat(row.longitude).toFixed(5)}` : 'N/A' },
                            { data: 'capacity_ports', className: "text-center", width: '5%' },
                            // Hunian sekali-lihat: "5/8" + warna. Untuk ODC angka ini = jumlah ODP anak,
                            // untuk ODP = jumlah pelanggan (satu makna, diturunkan dari data — lihat
                            // lib/network-assets-service.recomputePortUsage).
                            { data: 'ports_used', className: "text-center", width: '7%', render: (data, type, row) => {
                                const used = data != null ? parseInt(data, 10) || 0 : 0;
                                const cap = parseInt(row.capacity_ports, 10) || 0;
                                if (cap <= 0) return `<span class="badge badge-secondary">${used}</span>`;
                                const penuh = used >= cap;
                                const hampir = !penuh && used >= cap - 1;
                                const warna = penuh ? 'danger' : (hampir ? 'warning' : 'success');
                                return `<span class="badge badge-${warna}">${used}/${cap}</span>`;
                            } },
                            { data: 'parent_odc_id', render: function(data, type, row) {
                                if (row.type === 'ODP' && data) {
                                    const parentOdc = allOdcData.find(odc => String(odc.id) === String(data));
                                    return parentOdc ? `<span title="ID: ${parentOdc.id}">${parentOdc.name}</span>` : `ID: ${data} (Tidak Ditemukan)`;
                                } return '-';
                            }},
                            { data: null, orderable: false, searchable: false, width: '10%', className: "text-center", render: (data, type, row) => 
                                `<button class="btn btn-action btn-info btn-edit-asset" data-id="${row.id}" title="Edit"><i class="fas fa-edit"></i></button> <button class="btn btn-action btn-danger btn-delete-asset" data-id="${row.id}" data-name="${row.name}" title="Hapus"><i class="fas fa-trash"></i></button>`
                            }
                        ],
                        order: [[0, 'desc']], language: { search: "", searchPlaceholder: "Cari aset..." }
                    });
                    
                    $('#assetTypeFilter').select2({ theme: "bootstrap", minimumResultsForSearch: Infinity, width: '100%' });
                    const $parentOdcFilter = $('#parentOdcFilter');
                    $parentOdcFilter.html('<option value="">Semua ODC Induk</option>');
                    allOdcData.forEach(odc => $parentOdcFilter.append(`<option value="${odc.id}">${odc.name} (ID: ${odc.id})</option>`));
                    $parentOdcFilter.select2({ theme: "bootstrap", placeholder: 'Pilih Induk ODC', allowClear: true, width: '100%' });
                    $parentOdcFilter.prop('disabled', $('#assetTypeFilter').val() !== 'ODP').val(null).trigger('change.select2');
                } else { displayGlobalAssetMessage('Gagal memuat data aset: ' + (response.message || 'Format salah.'), 'warning'); }
            } catch (error) { displayGlobalAssetMessage('Error server: ' + (error.responseJSON?.message || error.statusText || error.message), 'danger'); }
        }

        function initializePage() {
            $.get('/api/me', data => { if (data.status === 200 && data.data) $('#adminUsername').text(data.data.username); })
             .fail(() => $('#adminUsername').text("Admin"));
            fetchAllAssetsAndInitialize();
        }
        
        $(document).ready(function () {
            initializePage();

            $('#addAssetModal').on('shown.bs.modal', function () {
                $('#addAssetForm')[0].reset(); $('#addFormStatus').html('');
                $('#assetTypeAdd').val("").trigger('change'); 
                initializeModalMapAsset('addAssetMap', 'assetLatitudeAdd', 'assetLongitudeAdd', null, null, false);
            });
            $('#assetTypeAdd, #assetTypeEdit').change(function() {
                const mode = $(this).attr('id').includes('Add') ? 'Add' : 'Edit';
                handleAssetTypeChange(mode, $(this).val());
            });
            
            $('#addAssetForm, #editAssetForm').submit(function (event) {
                event.preventDefault();
                const isEdit = this.id === 'editAssetForm';
                const mode = isEdit ? 'Edit' : 'Add';
                const assetId = isEdit ? $('#editAssetId').val() : null;

                const $statusDiv = $(`#${mode.toLowerCase()}FormStatus`).html('<div class="alert alert-info">Mengirim...</div>').show();
                const $submitBtn = $(this).find('button[type="submit"]').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i>');
                
                const lat = $(`#assetLatitude${mode}`).val(), lng = $(`#assetLongitude${mode}`).val();
                if (!lat || !lng || isNaN(parseFloat(lat)) || isNaN(parseFloat(lng))) {
                    $statusDiv.html('<div class="alert alert-danger">Latitude & Longitude wajib valid dan ditandai di peta.</div>');
                    $submitBtn.prop('disabled', false).html(isEdit ? 'Simpan Perubahan' : 'Simpan Aset'); return;
                }
                
                const assetType = $(`#assetType${mode}`).val();
                const formData = { 
                    type: assetType, 
                    name: $(`#assetName${mode}`).val(), 
                    address: $(`#assetAddress${mode}`).val(),
                    capacity_ports: parseInt($(`#assetCapacity${mode}`).val()) || 0, 
                    notes: $(`#assetNotes${mode}`).val(), 
                    latitude: parseFloat(lat), 
                    longitude: parseFloat(lng),
                    parent_odc_id: assetType === 'ODP' ? ($(`#parentOdcId${mode}`).val() || null) : null
                };
                
                $.ajax({
                    url: isEdit ? `/api/map/network-assets/${assetId}` : '/api/map/network-assets',
                    method: isEdit ? 'PUT' : 'POST',
                    contentType: 'application/json',
                    data: JSON.stringify(formData),
                    success: res => {
                        if (res.status === 200 || res.status === 201) {
                            $(`#${mode.toLowerCase()}AssetModal`).modal('hide');
                            displayGlobalAssetMessage(res.message || `Aset berhasil di${isEdit ? 'perbarui' : 'tambah'}.`, 'success');
                            fetchAllAssetsAndInitialize();
                        } else {
                            $statusDiv.html(`<div class="alert alert-warning">${res.message || 'Gagal.'}</div>`);
                        }
                    },
                    error: xhr => $statusDiv.html(`<div class="alert alert-danger">${xhr.responseJSON?.message || 'Terjadi kesalahan pada server.'}</div>`),
                    complete: () => $submitBtn.prop('disabled', false).html(isEdit ? 'Simpan Perubahan' : 'Simpan Aset')
                });
            });

            $('#assetsDataTable').on('click', '.btn-edit-asset', function () {
                const assetId = $(this).data('id');
                const assetData = allAssetsData.find(a => String(a.id) === String(assetId));
                if (assetData) {
                    $('#editAssetForm')[0].reset(); 
                    $('#editAssetId').val(assetData.id);
                    $('#assetTypeEdit').val(assetData.type); 
                    $('#assetNameEdit').val(assetData.name);
                    $('#assetAddressEdit').val(assetData.address || '');
                    $('#assetCapacityEdit').val(assetData.capacity_ports);
                    $('#assetNotesEdit').val(assetData.notes || '');
                    $('#assetLatitudeEdit').val(assetData.latitude || ''); 
                    $('#assetLongitudeEdit').val(assetData.longitude || '');
                    $('#assetPortsUsedOdpDisplayEdit').val(assetData.ports_used != null ? assetData.ports_used : 'N/A');
                    $('#assetPortsUsedDisplayEdit').val(assetData.ports_used != null ? assetData.ports_used : 'N/A');
                    
                    // Muat opsi ODC dengan data kapasitas terbaru
                    if (assetData.type === 'ODP') {
                        loadParentOdcOptions('parentOdcIdEdit', assetData.parent_odc_id || null);
                    }
                    
                    // ===== PERBAIKAN #1: MENGHINDARI BUG RESET KAPASITAS =====
                    // Logika .trigger('change') dihapus dan diganti dengan pengaturan UI manual
                    // untuk mencegah side effect yang tidak diinginkan (reset nilai kapasitas).
                    const $parentOdcGroup = $('#parentOdcGroupEdit');
                    const $portsUsedOdcGroup = $('#portsUsedDisplayGroupEdit');
                    const $portsUsedOdpGroup = $('#portsUsedDisplayOdpGroupEdit');

                    $parentOdcGroup.hide(); $portsUsedOdcGroup.hide(); $portsUsedOdpGroup.hide();

                    if (assetData.type === 'ODP') {
                        $parentOdcGroup.show();
                        $portsUsedOdpGroup.show();
                    } else if (assetData.type === 'ODC') {
                        $portsUsedOdcGroup.show();
                    }
                    // ===== PERBAIKAN #1 SELESAI =====

                    $('#editAssetModal').modal('show'); 
                    $('#editAssetModal').off('shown.bs.modal.editmapinit').on('shown.bs.modal.editmapinit', function() {
                        initializeModalMapAsset('editAssetMap', 'assetLatitudeEdit', 'assetLongitudeEdit', assetData.latitude, assetData.longitude, true);
                    });
                } else { displayGlobalAssetMessage('Data aset tidak ditemukan (ID: '+assetId+').', 'warning'); }
            });

            $('#assetsDataTable').on('click', '.btn-delete-asset', function () {
                const assetId = $(this).data('id'), assetName = $(this).data('name');
                if (confirm(`Yakin hapus aset "${assetName}" (ID: ${assetId})? Menghapus ODC akan melepaskan ODP anaknya.`)) {
                    $.ajax({ url: `/api/map/network-assets/${assetId}`, method: 'DELETE',
                        success: res => { if (res.status === 200) { displayGlobalAssetMessage(res.message || 'Aset dihapus.', 'success'); fetchAllAssetsAndInitialize(); } else displayGlobalAssetMessage(res.message || 'Gagal.', 'warning'); },
                        error: xhr => displayGlobalAssetMessage(xhr.responseJSON?.message || 'Error server.', 'danger')
                    });
                }
            });

            $('#assetTypeFilter').on('change', () => {
                if ($('#assetTypeFilter').val() === 'ODP') {
                    $('#parentOdcFilter').prop('disabled', false);
                } else {
                    $('#parentOdcFilter').val(null).prop('disabled', true);
                }
                $('#parentOdcFilter').trigger('change.select2'); // Re-render select2
                if(assetsDataTable) assetsDataTable.draw();
            });

            $('#parentOdcFilter').on('change', () => {
                 if(assetsDataTable) assetsDataTable.draw();
            });

            $('#clearAssetFilters').on('click', () => {
                 $('#assetTypeFilter').val("").trigger('change'); // Ini akan otomatis men-disable dan mereset filter ODC
            });

            $.fn.dataTable.ext.search.push(
                (settings, data, dataIndex) => {
                    if (settings.nTable.id !== 'assetsDataTable') return true;
                    const typeFilter = $('#assetTypeFilter').val(), odcFilter = $('#parentOdcFilter').val();
                    const row = allAssetsData[dataIndex]; if (!row) return false; 
                    
                    const typeMatch = !typeFilter || row.type === typeFilter;
                    let odcMatch = true;
                    if (typeFilter === 'ODP' && odcFilter) { 
                        odcMatch = (String(row.parent_odc_id) === String(odcFilter));
                    }
                    
                    return typeMatch && odcMatch;
                }
            );
        });
        
        // ===== PERBAIKAN SELESAI =====
