/* global getRouteCoordinates, updateConnectionMonitoringTechnicianPage */
        if (window.location.protocol !== "https:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
            console.warn("PERINGATAN: Halaman ini diakses melalui HTTP. Fitur geolokasi mungkin tidak berfungsi optimal. Silakan gunakan HTTPS.");
        }

        let map;
        let myLocationMarker = null;
        let networkMarkersLayer = L.layerGroup();
        let customerMarkersLayer = L.layerGroup();
        let linesLayer = L.layerGroup();
        
        // Global config untuk routing
        let globalConfig = null;

        let allOdcDataTechnicianPage = [];
        let allNetworkAssetsData = [];
        let allCustomerData = [];
        let activePppoeUsersMap = new Map();
        let initialPppoeLoadFailed = false;
        let currentUsername = "Teknisi";

        let odcMarkersTechnicianPage = [];
        let odpMarkersTechnicianPage = [];
        let customerMarkersTechnicianPage = [];
        let odpToOdcLinesTechnicianPage = [];
        let customerToOdpLinesTechnicianPage = [];
        let legendControlInstance = null;

        let selectedOdcIdsTechnicianPage = new Set();
        let selectedOdpIdsTechnicianPage = new Set();
        
        // Auto-refresh variables
        let autoRefreshIntervalId = null;
        const AUTO_REFRESH_INTERVAL_MS = 30000; // 30 seconds
        
        // Connection lines visibility
        let connectionLinesVisible = true; // Lines visible by default
        
        let selectedCustomerIdsTechnicianPage = new Set();
        let isInitialLoadTechnicianPage = true;


        const createFaIcon = (faClassName, colorClass) => L.divIcon({
            html: `<div class="custom-div-icon ${colorClass}"><i class="fas ${faClassName}"></i></div>`,
            className: 'leaflet-div-icon', iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -28]
        });
        const odcIcon = createFaIcon('fa-server', 'icon-odc');
        const odpIcon = createFaIcon('fa-network-wired', 'icon-odp');

        /**
         * Ikon ODP yang MELAPORKAN DIRI: lencana hunian (3/8) + cincin merah bila mayoritas
         * penghuninya offline. Teknisi di lapangan adalah orang yang paling sering bertanya
         * "ini ODP-nya atau rumahnya?" — jawabannya sekarang terlihat sebelum marker diklik.
         */
        const buatIkonOdp = (info) => {
            const h = info.hunian;
            const kelas = h.penuh ? 'odp-badge-penuh' : (h.hampirPenuh ? 'odp-badge-hampir' : '');
            const badge = (h.kapasitas || h.terpakai) ? `<span class="odp-badge ${kelas}">${h.teks}</span>` : '';
            const curiga = info.sehat && info.sehat.curiga ? ' odp-curiga' : '';
            return L.divIcon({
                html: `<div class="custom-div-icon icon-odp${curiga}"><i class="fas fa-network-wired"></i>${badge}</div>`,
                className: 'leaflet-div-icon', iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -28]
            });
        };

        /** Hitungan status penghuni satu ODP — dipakai ikon MAUPUN popup supaya angkanya satu sumber. */
        const kesehatanOdpTeknisi = (odpId) => {
            const anggota = allCustomerData.filter((c) => String(c.connected_odp_id) === String(odpId));
            const daftar = anggota.map((c) => {
                let status = 'unknown';
                if (c.pppoe_username) status = activePppoeUsersMap.has(c.pppoe_username) ? 'online' : 'offline';
                if (initialPppoeLoadFailed && c.pppoe_username) status = 'unknown';
                return { id: c.id, status };
            });
            return { anggota, sehat: window.MapFilterCore.hitungKesehatanOdp(daftar) };
        };
        const myLocationIconTechnicianPage = createFaIcon('fa-street-view', 'icon-my-location');
        const createCustomerStatusIcon = (status) => {
            let colorClass = 'icon-customer-unknown';
            if (status === 'online') colorClass = 'icon-customer-online';
            else if (status === 'offline') colorClass = 'icon-customer-offline';
            return createFaIcon('fa-user-alt', colorClass);
        };


        fetch('/api/me', { credentials: 'include' }).then(response => response.json()).then(data => {
            if (data.status === 200 && data.data) {
                currentUsername = data.data.username || "Teknisi";
                $('#loggedInTechnicianInfo').text(currentUsername);
            }
        }).catch(err => console.warn("Error fetching user data:", err));
        
        // Load config untuk routing
        fetch('/api/config', { credentials: 'include' }).then(response => response.json()).then(data => {
            if (data.status === 200 && data.config) {
                globalConfig = data.config;
                // Make config available globally for routing helper
                window.globalConfig = globalConfig;
                console.log("[TEKNISI-MAP-VIEWER] Config loaded successfully for routing");
            }
        }).catch(err => console.warn("[TEKNISI-MAP-VIEWER] Error loading config (routing will use defaults):", err));

        function displayGlobalMapMessage(message, type = 'info', duration = 7000) {
            const globalMessageDiv = $('#globalMessageMap');
            globalMessageDiv.html(`<div class="alert alert-${type} alert-dismissible fade show" role="alert">
                                ${message}
                                <button type="button" class="close" data-dismiss="alert" aria-label="Close">
                                    <span aria-hidden="true">&times;</span>
                                </button>
                            </div>`);
            if (duration > 0 && type !== 'danger' && type !== 'warning') {
                 setTimeout(() => { globalMessageDiv.find('.alert').alert('close'); }, duration);
            }
        }

        function handleGeolocationErrorMapViewer(error, contextMessage, displayTarget) {
            console.warn(`${contextMessage} - Error Code: ${error.code}, Message: ${error.message}`);
            let errorText = `<b>${contextMessage}</b><br/>`;
            switch(error.code) {
                case error.PERMISSION_DENIED: errorText += "IZIN LOKASI DITOLAK."; break;
                case error.POSITION_UNAVAILABLE: errorText += "LOKASI TIDAK TERSEDIA."; break;
                case error.TIMEOUT: errorText += "WAKTU HABIS."; break;
                default: errorText += `Error (Code: ${error.code || 'N/A'}).`; break;
            }
            displayTarget(errorText, 'danger', 15000);
        }

        function processSuccessfulGeolocationMapViewer(position, contextMessage, displayTarget, mapInstanceToUpdate, buttonContainer, originalIcon) {
            const userLat = position.coords.latitude; const userLng = position.coords.longitude; const accuracy = position.coords.accuracy;
            console.log(`${contextMessage} - Coords: Lat=${userLat}, Lng=${userLng}, Accuracy=${accuracy}m`);
            if (mapInstanceToUpdate) {
                mapInstanceToUpdate.setView([userLat, userLng], 17);
                if (myLocationMarker) { myLocationMarker.setLatLng([userLat, userLng]).setTooltipContent(`Lokasi Saya (Akurasi: ${accuracy.toFixed(0)}m)`); }
                else { myLocationMarker = L.marker([userLat, userLng], {icon: myLocationIconTechnicianPage, zIndexOffset: 1000}).bindTooltip(`Lokasi Saya (Akurasi: ${accuracy.toFixed(0)}m)`, {permanent: false, direction: 'top', offset: [0,-28]}).addTo(mapInstanceToUpdate); }
            }
            let accuracyMessage = `Lokasi GPS ditemukan (Akurasi: ${accuracy.toFixed(0)}m).`;
            let accuracyType = "success";
            if (accuracy > 1000) { accuracyMessage = `PERINGATAN: Akurasi lokasi rendah (${Math.round(accuracy)}m).`; accuracyType = "danger"; }
            else if (accuracy > 150) { accuracyMessage = `Info: Akurasi lokasi sedang (${Math.round(accuracy)}m).`; accuracyType = "warning"; }
            displayTarget(accuracyMessage, accuracyType, 10000);
            if (buttonContainer && originalIcon) { buttonContainer.innerHTML = originalIcon; }
        }

        function haversineDistance(coords1, coords2) {
            function toRad(x) { return x * Math.PI / 180; }
            const R = 6371;
            const dLat = toRad(coords2.latitude - coords1.latitude);
            const dLon = toRad(coords2.longitude - coords1.longitude);
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(coords1.latitude)) * Math.cos(toRad(coords2.latitude)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c * 1000;
        }

        function getRedamanPresentation(redaman) {
            const val = parseFloat(redaman); let color = 'grey'; let text;
            if (redaman === null || typeof redaman === 'undefined') {text = 'RX: -'; color = '#6c757d';}
            else if (isNaN(val)) {text = 'RX: N/A'; color = '#6c757d';}
            else {
                 text = `RX: ${val.toFixed(2)} dBm`;
                 if (val > -20) color = '#28a745'; else if (val > -24) color = '#76ff03';
                 else if (val > -27) color = '#ffc107'; else if (val > -30) color = '#fd7e14';
                 else color = '#dc3545';
            }
            return { text, color };
        }

        async function fetchRedamanForMarker(marker, deviceId, isManualRefresh = false) {
            const loadingIconHtml = `<i class="fas fa-spinner fa-spin fa-xs"></i>`;
            const defaultTooltipOptions = { permanent: true, direction: 'top', offset: [0, -32], className: 'customer-redaman-tooltip' };
            if (!deviceId) {
                const p = getRedamanPresentation(null);
                marker.getTooltip() ? marker.setTooltipContent(`<span style="color: ${p.color};">${p.text}</span>`) : marker.bindTooltip(`<span style="color: ${p.color};">${p.text}</span>`, defaultTooltipOptions).openTooltip();
                return;
            }
            if (isManualRefresh && marker.getTooltip()) { marker.setTooltipContent(`<span style="color: #FFF;">RX: ${loadingIconHtml}</span>`);}
            else if (isManualRefresh && !marker.getTooltip()){
                marker.bindTooltip(`<span style="color: #FFF;">RX: ${loadingIconHtml}</span>`, defaultTooltipOptions).openTooltip();
            }

            try {
                const response = await fetch(`/api/customer-redaman/${deviceId}?_=${new Date().getTime()}`, { credentials: 'include' });
                const result = await response.json();
                let redamanValue = (result.status === 200 && result.data) ? result.data.redaman : null;
                const p = getRedamanPresentation(redamanValue);
                marker.getTooltip() ? marker.setTooltipContent(`<span style="color: ${p.color};">${p.text}</span>`) : marker.bindTooltip(`<span style="color: ${p.color};">${p.text}</span>`, defaultTooltipOptions).openTooltip();
            } catch (error) {
                console.error("Error fetching redaman for marker:", error);
                const p = getRedamanPresentation('Error');
                marker.getTooltip() ? marker.setTooltipContent(`<span style="color: ${p.color};">${p.text}</span>`) : marker.bindTooltip(`<span style="color: ${p.color};">${p.text}</span>`, defaultTooltipOptions).openTooltip();
            }
        }

        async function fetchActivePppoeUsers() {
            initialPppoeLoadFailed = false;
            activePppoeUsersMap.clear();
            try {
                const response = await fetch(`/api/mikrotik/ppp-active-users?_=${new Date().getTime()}`, { credentials: 'include' });
                if (!response.ok) {
                    const errorResult = await response.json().catch(() => ({ message: response.statusText }));
                    console.error("[TechMap] API Error fetching PPPoE:", response.status, errorResult.message);
                    throw new Error(errorResult.message || response.statusText);
                }
                const result = await response.json();
                if (result.status === 200 && Array.isArray(result.data)) {
                     result.data.forEach(userEntry => {
                        if (userEntry.name && userEntry.address) {
                            activePppoeUsersMap.set(userEntry.name, userEntry.address);
                        } else {
                             console.warn("[TechMap] PPPoE user entry from API incomplete:", userEntry);
                        }
                    });
                     console.log("[TechMap] Active PPPoE users fetched:", activePppoeUsersMap.size);
                } else {
                     console.warn("[TechMap] Invalid PPPoE data format or API status not 200:", result);
                     initialPppoeLoadFailed = true;
                }
            } catch (error) {
                console.error("[TechMap] Error fetching active PPPoE data:", error);
                displayGlobalMapMessage('Gagal mengambil status PPPoE. Status pelanggan mungkin tidak akurat.', 'warning', 0);
                initialPppoeLoadFailed = true;
            }
        }

        async function updateCustomerPopupDetailsTechnicianPage(marker, customer) {
            const customerId = customer.id;
            const deviceId = customer.device_id;
            const modemTypeSpan = document.getElementById(`modem-type-${customerId}`);
            const redamanSpan = document.getElementById(`redaman-val-${customerId}`);

            if (!deviceId) {
                if (modemTypeSpan) modemTypeSpan.textContent = 'N/A (No Device ID)';
                if (redamanSpan) redamanSpan.innerHTML = getRedamanPresentation(null).text;
                return;
            }

            // Use batch metrics API for both modem type and redaman
            try {
                const response = await fetch('/api/customer-metrics-batch', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify({
                        deviceIds: [deviceId]
                    })
                });

                if (!response.ok) {
                    console.warn(`Failed to fetch metrics for ${deviceId}: ${response.status}`);
                    if (modemTypeSpan) modemTypeSpan.textContent = 'Tidak tersedia (Server Error)';
                    if (redamanSpan) {
                        const presentation = getRedamanPresentation('Error');
                        redamanSpan.innerHTML = `<span style="color: ${presentation.color}; font-weight: bold;">${presentation.text}</span>`;
                    }
                    return;
                }

                const result = await response.json();
                
                // API returns an array, find the device data by deviceId
                let deviceMetrics = null;
                if (result.status === 200 && Array.isArray(result.data)) {
                    deviceMetrics = result.data.find(metric => metric.deviceId === deviceId);
                }

                // Update modem type
                if (modemTypeSpan) {
                    if (deviceMetrics && deviceMetrics.modemType) {
                        modemTypeSpan.textContent = deviceMetrics.modemType;
                    } else {
                        modemTypeSpan.textContent = 'Tidak terdeteksi/N/A';
                    }
                }

                // Update redaman
                if (redamanSpan) {
                    let redamanValue = null;
                    if (deviceMetrics && deviceMetrics.redaman) {
                        // Remove the " dBm" suffix that's added by the API
                        redamanValue = deviceMetrics.redaman.replace(' dBm', '');
                    }
                    const presentation = getRedamanPresentation(redamanValue);
                    redamanSpan.innerHTML = `<span style="color: ${presentation.color}; font-weight: bold;">${presentation.text}</span>`;
                }

            } catch (error) {
                console.error(`Error fetching metrics for popup ${deviceId} (Teknisi):`, error);
                if (modemTypeSpan) modemTypeSpan.textContent = 'Error saat memuat';
                if (redamanSpan) {
                    console.error(`Error fetching redaman for popup ${deviceId} (Teknisi):`, error);
                    const presentation = getRedamanPresentation('Error');
                    redamanSpan.innerHTML = `<span style="color: ${presentation.color}; font-weight: bold;">${presentation.text}</span>`;
                }
            }
        }


        function initializeMap() {
            if (map) { map.remove(); map = null; if(legendControlInstance) legendControlInstance = null; }
            $('#interactiveMap .loading-spinner-container').show();

            const satelliteMaxZoom = 18; // Esri World Imagery hanya support sampai level 18
            const osmMaxZoom = 22;
            map = L.map('interactiveMap', {
                // fullscreenControl disabled - manual fullscreen button used instead
                // fullscreenControl: { pseudoFullscreen: false, title: { 'false': 'Layar Penuh', 'true': 'Keluar Layar Penuh' }},
                maxZoom: satelliteMaxZoom
            }).setView([-7.2430309,111.846867], 15);

            const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: osmMaxZoom, attribution: '&copy; OSM Contributors' });
            const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
                maxZoom: satelliteMaxZoom,
                maxNativeZoom: 18, // Esri World Imagery hanya support sampai level 18
                attribution: 'Tiles &copy; Esri',
                errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' // Transparent 1x1 pixel
            }).addTo(map);

            networkMarkersLayer.addTo(map); customerMarkersLayer.addTo(map); linesLayer.addTo(map);

            // Hybrid = citra satelit + JALAN. Overlay `voyager_only_labels` yang lama TERUKUR KOSONG
            // (116 byte = PNG hampa) di area layanan, begitu pula lapisan referensi Esri — teknisi
            // melihat citra tanpa satu pun jalan. Peta OSM utuh dipasang di pane sendiri dengan
            // `mix-blend-mode: multiply`: latar putihnya hilang, tinggal garis jalan + namanya.
            // Sama persis dengan /map-viewer admin — jangan sampai dua peta ini berbeda perilaku.
            map.createPane('hybridRoads');
            const hybridRoadsPane = map.getPane('hybridRoads');
            hybridRoadsPane.style.zIndex = 250;
            hybridRoadsPane.style.mixBlendMode = 'multiply';
            hybridRoadsPane.style.pointerEvents = 'none';

            const hybridLayer = L.layerGroup([
                L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                    maxZoom: satelliteMaxZoom, maxNativeZoom: 18, attribution: 'Tiles &copy; Esri'
                }),
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: satelliteMaxZoom, maxNativeZoom: 18, opacity: 0.9,
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                    pane: 'hybridRoads'
                })
            ]);

            const baseMaps = { "Hybrid": hybridLayer, "Satelit": satelliteLayer, "OpenStreetMap": osmLayer };
            const overlayMaps = { "Aset Jaringan": networkMarkersLayer, "Pelanggan": customerMarkersLayer, "Koneksi Antar Aset": linesLayer };
            L.control.layers(baseMaps, overlayMaps, {collapsed: true}).addTo(map);

            const GpsMapControl = L.Control.extend({
                options: { position: 'topleft'},
                onAdd: function(mapInstanceCtrl) {
                    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom-gps');
                    const iconHTML = '<i class="fas fa-crosshairs"></i>';
                    const loadingIconHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    container.innerHTML = iconHTML; container.title = 'Lokasi Saya';
                    L.DomEvent.on(container, 'click', L.DomEvent.stopPropagation).on(container, 'click', L.DomEvent.preventDefault)
                        .on(container, 'click', function () {
                            container.innerHTML = loadingIconHTML; displayGlobalMapMessage("Meminta lokasi GPS...", "info", 3000);
                            if (navigator.geolocation) {
                                navigator.geolocation.getCurrentPosition(
                                    (pos) => processSuccessfulGeolocationMapViewer(pos, "GPS Peta Teknisi", displayGlobalMapMessage, map, container, iconHTML),
                                    (err) => { handleGeolocationErrorMapViewer(err, "GPS Peta Teknisi Gagal", displayGlobalMapMessage); container.innerHTML = iconHTML; },
                                    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
                                );
                            } else { handleGeolocationErrorMapViewer({code: -1, message: "Geolokasi tidak didukung."}, "GPS Peta Teknisi Gagal", displayGlobalMapMessage); container.innerHTML = iconHTML; }
                        });
                    return container;
                }
            });
            if (map) new GpsMapControl().addTo(map);

            map.on('baselayerchange', e => {
                const newMaxZoom = (e.name === "Satelit" || e.name === "Hybrid") ? satelliteMaxZoom : osmMaxZoom;
                map.options.maxZoom = newMaxZoom;
                if (map.getZoom() > newMaxZoom) map.setZoom(newMaxZoom);
                // Update maxNativeZoom untuk layer yang aktif
                const activeLayer = e.layer;
                if (activeLayer && activeLayer.options) {
                    if ((e.name === "Satelit" || e.name === "Hybrid") && activeLayer.options.maxNativeZoom) {
                        activeLayer.options.maxNativeZoom = 18;
                    }
                }
            });
            map.on('fullscreenchange', () => { $('#manualFullscreenBtn i').toggleClass('fa-expand fa-compress'); if(map) map.invalidateSize(); });
            document.addEventListener('fullscreenchange', handleFullscreenGlobal);
            document.addEventListener('webkitfullscreenchange', handleFullscreenGlobal);
            document.addEventListener('mozfullscreenchange', handleFullscreenGlobal);
            document.addEventListener('MSFullscreenChange', handleFullscreenGlobal);

            loadAllMapDataTechnicianPage();
        }
        
        // Store original parent of modals for fullscreen fix
        let modalOriginalParents = new Map();
        
        function moveModalsToFullscreen() {
            const modals = document.querySelectorAll('.modal');
            const mapContainer = document.getElementById('mapContainer');
            modals.forEach(modal => {
                modalOriginalParents.set(modal, modal.parentNode);
                mapContainer.appendChild(modal);
            });
        }
        
        function restoreModalsPosition() {
            modalOriginalParents.forEach((parent, modal) => {
                parent.appendChild(modal);
            });
            modalOriginalParents.clear();
        }

        function toggleFullScreenManual() {
            const mapContainer = document.getElementById('mapContainer');
            if (!document.fullscreenElement && !document.mozFullScreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
                // Move modals into mapContainer before fullscreen
                moveModalsToFullscreen();
                if (mapContainer.requestFullscreen) mapContainer.requestFullscreen().catch(err => {
                    console.error(`Error fullscreen: ${err.message}`);
                    restoreModalsPosition();
                });
                else if (mapContainer.mozRequestFullScreen) mapContainer.mozRequestFullScreen();
                else if (mapContainer.webkitRequestFullscreen) mapContainer.webkitRequestFullscreen();
                else if (mapContainer.msRequestFullscreen) mapContainer.msRequestFullscreen();
            } else {
                if (document.exitFullscreen) document.exitFullscreen();
                else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
                else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                else if (document.msExitFullscreen) document.msExitFullscreen();
            }
        }
        
        function handleFullscreenGlobal() {
            const isFull = !!(document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
            $('#manualFullscreenBtn i').toggleClass('fa-expand', !isFull).toggleClass('fa-compress', isFull);
            if (map) setTimeout(() => map.invalidateSize(), 250);
            // Restore modals when exiting fullscreen
            if (!isFull) {
                restoreModalsPosition();
            }
        }

        function setupLegend() {
            if (map && legendControlInstance) { map.removeControl(legendControlInstance); legendControlInstance = null; }
            if (map && !legendControlInstance) {
                const legend = L.control({position: 'bottomright'});
                legend.onAdd = function (mapInstance) {
                    const div = L.DomUtil.create('div', 'info legend');
                    const types = [
                        {name: 'ODC', iconHtml: '<span class="icon-odc"><i class="fas fa-server"></i></span>'},
                        {name: 'ODP', iconHtml: '<span class="icon-odp"><i class="fas fa-network-wired"></i></span>'},
                        {name: 'Pelanggan Online', iconHtml: '<span class="icon-customer-online"><i class="fas fa-user-alt"></i></span>'},
                        {name: 'Pelanggan Offline', iconHtml: '<span class="icon-customer-offline"><i class="fas fa-user-alt"></i></span>'},
                        {name: 'Pelanggan (Status Lain)', iconHtml: '<span class="icon-customer-unknown"><i class="fas fa-user-alt"></i></span>'},
                        {name: 'Lokasi Saya (GPS)', iconHtml: '<span class="icon-my-location"><i class="fas fa-street-view"></i></span>'}
                    ];
                    div.innerHTML = "<h4>Legenda Peta</h4>";
                    types.forEach(type => div.innerHTML += `${type.iconHtml} ${type.name}<br>`);
                    L.DomEvent.disableClickPropagation(div);
                    return div;
                };
                legend.addTo(map); legendControlInstance = legend;
            }
        }

        async function createNetworkAssetMarkersTechnicianPage() {
            console.log("[TechMap] Creating network asset markers...");
            odcMarkersTechnicianPage = [];
            odpMarkersTechnicianPage = [];
            odpToOdcLinesTechnicianPage = [];
            allOdcDataTechnicianPage = allNetworkAssetsData.filter(asset => asset.type === 'ODC' && asset.latitude != null && asset.longitude != null)
                                       .map(asset => JSON.parse(JSON.stringify(asset)));

            const assetsByLocation = new Map();
            allNetworkAssetsData.forEach(asset => {
                if (asset.latitude != null && asset.longitude != null) {
                    const locKey = `${parseFloat(asset.latitude).toFixed(5)},${parseFloat(asset.longitude).toFixed(5)}`;
                    if (!assetsByLocation.has(locKey)) assetsByLocation.set(locKey, []);
                    assetsByLocation.get(locKey).push(asset);
                }
            });

            allNetworkAssetsData.forEach(asset => {
                if (asset.latitude == null || asset.longitude == null) return;
                let plotLat = parseFloat(asset.latitude);
                let plotLng = parseFloat(asset.longitude);
                if (isNaN(plotLat) || isNaN(plotLng)) { console.warn("Koordinat aset tidak valid:", asset); return; }

                const infoOdpTek = asset.type === 'ODP'
                    ? (() => {
                        const k = kesehatanOdpTeknisi(asset.id);
                        return { ...k, hunian: window.MapFilterCore.ringkasHunian(k.anggota.length, asset.capacity_ports) };
                    })()
                    : null;
                let iconToUse = asset.type === 'ODC' ? odcIcon : buatIkonOdp(infoOdpTek);

                if (asset.type === 'ODP' && asset.parent_odc_id) {
                    const parentOdc = allOdcDataTechnicianPage.find(o => o.id == asset.parent_odc_id);
                    if (parentOdc && parentOdc.latitude != null && parentOdc.longitude != null &&
                        Math.abs(parseFloat(parentOdc.latitude) - plotLat) < 0.000001 &&
                        Math.abs(parseFloat(parentOdc.longitude) - plotLng) < 0.000001) {
                        const randomAngle = Math.random() * 2 * Math.PI;
                        const offsetDistance = 0.00003 + (Math.random() * 0.00002);
                        plotLat += Math.sin(randomAngle) * offsetDistance;
                        plotLng += Math.cos(randomAngle) * offsetDistance;
                    }
                }

                let portsUsedDisplay;
                if (asset.type === 'ODC') {
                    portsUsedDisplay = `${asset.ports_used || 0} ODP terhubung`;
                } else if (asset.type === 'ODP') {
                    const connectedCustomersToThisOdp = allCustomerData.filter(cust => String(cust.connected_odp_id) === String(asset.id));
                    portsUsedDisplay = `${connectedCustomersToThisOdp.length} port terpakai`;
                } else {
                    portsUsedDisplay = `${asset.ports_used || 0} (status tidak diketahui)`;
                }

                let popupContent = `<b>${asset.name || 'Aset'} (${asset.type})</b><p>ID: ${asset.id}</p>` +
                                 (asset.address ? `<p>Alamat: ${asset.address}</p>` : '') +
                                 `<p>Kapasitas: ${asset.capacity_ports || 'N/A'} Port</p>` +
                                 `<p>Status Port: ${portsUsedDisplay}</p>`;

                if (infoOdpTek) {
                    const sh = infoOdpTek.sehat;
                    const warna = sh.curiga ? 'danger' : (sh.offline ? 'warning' : 'success');
                    popupContent += `<div class="alert alert-${warna} py-1 px-2 mb-2" style="font-size:0.85em;">`
                        + `<i class="fas ${sh.curiga ? 'fa-exclamation-triangle' : 'fa-heartbeat'}"></i> `
                        + `${window.MapFilterCore.ringkasKesehatan(sh)}</div>`;
                }

                const originalLocKey = `${parseFloat(asset.latitude).toFixed(5)},${parseFloat(asset.longitude).toFixed(5)}`;
                const coLocatedAssets = (assetsByLocation.get(originalLocKey) || []).filter(a => a.id !== asset.id);
                if (coLocatedAssets.length > 0) {
                    popupContent += `<hr class="my-1" style="border-top: 1px dashed #ccc;"><em><small>Juga di lokasi ini:</small></em>`;
                    coLocatedAssets.forEach(other => { popupContent += `<p class="mb-0 ml-2 small">- ${other.type}: ${other.name} (ID: ${other.id})</p>`; });
                }

                if (asset.type === 'ODC') {
                    const connectedOdps = allNetworkAssetsData.filter(odp => String(odp.parent_odc_id) === String(asset.id) && odp.type === 'ODP');
                    if (connectedOdps.length > 0) {
                        popupContent += `<hr class="my-1"><p class="mb-1"><strong><i class="fas fa-network-wired"></i> ODP Terhubung (${connectedOdps.length}):</strong></p><ul class="list-unstyled ml-3 mb-1" style="font-size:0.85em;">`;
                        connectedOdps.sort((a,b) => (a.name || '').localeCompare(b.name || '')).forEach(odp => {
                            const odpConnectedCustomersCount = allCustomerData.filter(cust => String(cust.connected_odp_id) === String(odp.id)).length;
                            popupContent += `<li>- ${odp.name || `ODP ID ${odp.id}`} (Kap: ${odp.capacity_ports || 'N/A'}, Pakai: ${odpConnectedCustomersCount})</li>`;
                        });
                        popupContent += `</ul>`;
                    } else {
                        popupContent += `<p class="small text-muted mt-1"><em>Tidak ada ODP terhubung.</em></p>`;
                    }
                }

                if (asset.type === 'ODP') {
                    if (asset.parent_odc_id) {
                        const parent = allOdcDataTechnicianPage.find(o => String(o.id) === String(asset.parent_odc_id));
                        popupContent += `<p>Induk ODC: ${parent ? `${parent.name} (ID: ${asset.parent_odc_id})` : `ID ${asset.parent_odc_id || '-'}`}</p>`;
                        if (parent && parent.latitude != null && parent.longitude != null) {
                            const dist = haversineDistance({ latitude: parseFloat(asset.latitude), longitude: parseFloat(asset.longitude) }, { latitude: parseFloat(parent.latitude), longitude: parseFloat(parent.longitude) });
                            if (!isNaN(dist)) popupContent += `<p>Jarak ke ODC Induk: ${dist.toFixed(0)} meter</p>`;
                        }
                    }
                    const connectedCustomers = allCustomerData.filter(cust => String(cust.connected_odp_id) === String(asset.id));
                     if (connectedCustomers.length > 0) {
                        popupContent += `<hr class="my-1"><p class="mb-1"><strong><i class="fas fa-users"></i> Pelanggan Terhubung (${connectedCustomers.length}):</strong></p><ul class="list-unstyled ml-3 mb-1" style="font-size:0.85em;">`;
                        connectedCustomers.sort((a,b) => (a.name || '').localeCompare(b.name || '')).forEach(customer => {
                            let onlineStatus = 'unknown';
                            if (customer.pppoe_username) onlineStatus = activePppoeUsersMap.has(customer.pppoe_username) ? 'online' : 'offline';
                            if (initialPppoeLoadFailed && customer.pppoe_username) onlineStatus = 'unknown'; else if (!customer.pppoe_username) onlineStatus = 'offline';
                            const statusColor = onlineStatus === 'online' ? 'text-success' : (onlineStatus === 'offline' ? 'text-danger' : 'text-muted');
                            popupContent += `<li>- ${customer.name || `Cust. ID ${customer.id}`} <span class="${statusColor}" style="font-weight:bold;">(${onlineStatus})</span></li>`;
                        });
                        popupContent += `</ul>`;
                    } else {
                        popupContent += `<p class="small text-muted mt-1"><em>Tidak ada pelanggan terhubung.</em></p>`;
                    }
                }
                popupContent += `<p><small>Lat: ${parseFloat(asset.latitude).toFixed(5)}, Lng: ${parseFloat(asset.longitude).toFixed(5)}</small></p>`;

                const marker = L.marker([plotLat, plotLng], { icon: iconToUse, draggable: false }).bindPopup(popupContent);
                marker.assetData = JSON.parse(JSON.stringify(asset));
                if (asset.type === 'ODC') odcMarkersTechnicianPage.push(marker);
                else if (asset.type === 'ODP') odpMarkersTechnicianPage.push(marker);
            });

            // Create routes from ODP to parent ODC dengan routing helper
            for (const odpMarker of odpMarkersTechnicianPage) {
                const odpAsset = odpMarker.assetData;
                if (odpAsset.parent_odc_id) {
                    const parentOdcMarker = odcMarkersTechnicianPage.find(m => String(m.assetData.id) === String(odpAsset.parent_odc_id));
                    if (parentOdcMarker) {
                        const startLatLng = parentOdcMarker.getLatLng();
                        const endLatLng = odpMarker.getLatLng();
                        
                        // Get routing profile dari config (default: 'driving-car' untuk ODC-ODP)
                        let routingProfile = 'driving-car';
                        if (typeof window !== 'undefined' && window.globalConfig && window.globalConfig.openRouteService) {
                            routingProfile = window.globalConfig.openRouteService.profiles?.odcToOdp || 'driving-car';
                        }
                        
                        // Get route coordinates menggunakan routing helper
                        const routeCoordinates = await getRouteCoordinates(
                            startLatLng.lat,
                            startLatLng.lng,
                            endLatLng.lat,
                            endLatLng.lng,
                            routingProfile
                        );
                        
                        // Create animated line dengan route coordinates
                        const line = L.polyline.antPath(routeCoordinates, {
                            color: '#ff7800',           // Orange - backbone infrastructure
                            weight: 2,
                            opacity: 0.7,
                            delay: 2000,                // Medium speed animation
                            dashArray: [10, 15],
                            pulseColor: '#FFB84D',      // Lighter orange pulse
                            hardwareAccelerated: true   // Performance optimization
                        });
                        line.connectedEntities = { odcId: parentOdcMarker.assetData.id, odpId: odpAsset.id };
                        odpToOdcLinesTechnicianPage.push(line);
                    }
                }
            }
        }

        async function createCustomerMarkersTechnicianPage() {
            console.log("[TechMap] Creating customer markers...");
            customerMarkersTechnicianPage = [];
            customerToOdpLinesTechnicianPage = [];

            if (allCustomerData.length === 0) return;

            for (const customer of allCustomerData) {
                if (customer.latitude == null || customer.longitude == null) continue;
                let lat = parseFloat(customer.latitude), lng = parseFloat(customer.longitude);
                if (isNaN(lat) || isNaN(lng)) { console.warn("Koordinat pelanggan tidak valid:", customer); continue; }

                let onlineStatus = 'unknown';
                let customerIpAddress = 'N/A';
                if (customer.pppoe_username) {
                    if (activePppoeUsersMap.has(customer.pppoe_username)) {
                        onlineStatus = 'online'; customerIpAddress = activePppoeUsersMap.get(customer.pppoe_username);
                    } else { onlineStatus = 'offline'; customerIpAddress = 'Offline'; }
                } else { onlineStatus = 'offline';}
                if (initialPppoeLoadFailed && customer.pppoe_username) { onlineStatus = 'unknown'; customerIpAddress = 'Unknown';}

                const statusColor = onlineStatus === 'online' ? '#28a745' : (onlineStatus === 'offline' ? '#dc3545' : '#6c757d');
                const statusIcon = onlineStatus === 'online' ? '<i class="fas fa-circle text-success"></i>' : 
                                  (onlineStatus === 'offline' ? '<i class="fas fa-circle text-danger"></i>' : 
                                  '<i class="fas fa-circle text-muted"></i>');
                const statusBadge = onlineStatus === 'online' ? 
                    '<span class="badge badge-success badge-lg"><i class="fas fa-check-circle"></i> ONLINE</span>' : 
                    (onlineStatus === 'offline' ? 
                    '<span class="badge badge-danger badge-lg"><i class="fas fa-times-circle"></i> OFFLINE</span>' : 
                    '<span class="badge badge-secondary badge-lg"><i class="fas fa-question-circle"></i> UNKNOWN</span>');

                let popupContent = `<div class="mb-3">
                    <h5 class="mb-2"><b>${customer.name || 'N/A'}</b></h5>
                    <div class="mb-2">${statusBadge}</div>
                </div>
                <hr>
                <div class="mb-2">
                    <strong><i class="fas fa-id-card"></i> ID Pelanggan:</strong> ${customer.id}
                </div>
                ${customer.phone_number ? `<div class="mb-2"><strong><i class="fas fa-phone-alt"></i> No. HP:</strong> ${customer.phone_number}</div>` : ''}
                ${customer.address ? `<div class="mb-2"><strong><i class="fas fa-map-marker-alt"></i> Alamat:</strong> ${customer.address}</div>` : ''}
                <div class="mb-2"><strong><i class="fas fa-box"></i> Paket:</strong> ${customer.subscription || 'N/A'}</div>
                <div class="mb-2">
                    <strong><i class="fas fa-money-bill-wave"></i> Status Bayar:</strong> 
                    ${customer.paid ? '<span class="badge badge-success">Lunas</span>' : '<span class="badge badge-danger">Belum Lunas</span>'}
                </div>
                <hr>
                <div class="mb-2">
                    <strong><i class="fas fa-network-wired"></i> Status Koneksi:</strong>
                    <div class="mt-1 p-2 rounded" style="background-color: ${onlineStatus === 'online' ? '#d4edda' : (onlineStatus === 'offline' ? '#f8d7da' : '#e2e3e5')};">
                        <div class="d-flex align-items-center">
                            ${statusIcon}
                            <span class="ml-2" style="font-weight:bold; color:${statusColor};">${onlineStatus.toUpperCase()}</span>
                        </div>
                        ${customer.pppoe_username ? `<div class="mt-1"><small><strong>PPPoE User:</strong> ${customer.pppoe_username}</small></div>` : ''}
                        <div class="mt-1"><small><strong>IP Address:</strong> ${customerIpAddress}</small></div>
                    </div>
                </div>`;

                if (customer.device_id) {
                    popupContent += `<p>Tipe Modem: <span id="modem-type-${customer.id}">Memuat...</span></p>`;
                    popupContent += `<p>Redaman: <span id="redaman-val-${customer.id}">Memuat...</span></p>`;
                } else {
                    popupContent += '<p>Tipe Modem: <span class="text-muted">N/A (No Device ID)</span></p>';
                    popupContent += '<p>Redaman: <span class="text-muted">N/A (No Device ID)</span></p>';
                }
                popupContent += `<p><small>Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}</small></p>`;

                let odpDetailsHtml = ''; let odcDetailsHtml = '';
                if (customer.connected_odp_id) {
                    const odpMarker = odpMarkersTechnicianPage.find(m => String(m.assetData.id) === String(customer.connected_odp_id));
                    if (odpMarker && odpMarker.assetData) {
                        const odpAsset = odpMarker.assetData;
                        const connectedCustomersToThisOdp = allCustomerData.filter(cust => String(cust.connected_odp_id) === String(odpAsset.id));

                        odpDetailsHtml = `<p class="mt-2 pt-2 border-top"><strong><i class="fas fa-network-wired"></i> ODP:</strong> ${odpAsset.name || `ID ${odpAsset.id}`}</p>`;
                        if (odpAsset.address) odpDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Alamat ODP: ${odpAsset.address}</p>`;
                        odpDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Kapasitas ODP: ${odpAsset.capacity_ports || 'N/A'} Port</p>`;
                        odpDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Port Terpakai ODP: ${connectedCustomersToThisOdp.length}</p>`; // Dynamic count
                        if (odpAsset.latitude != null && odpAsset.longitude != null) {
                            const dist = haversineDistance({ latitude: lat, longitude: lng }, { latitude: parseFloat(odpAsset.latitude), longitude: parseFloat(odpAsset.longitude) });
                            if (!isNaN(dist)) odpDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Jarak ke ODP: ${dist.toFixed(0)} m</p>`;
                        }
                        
                        // Create animated line from customer to ODP dengan routing helper
                        // Get routing profile dari config (default: 'foot-walking' untuk Customer-ODP)
                        let routingProfile = 'foot-walking';
                        if (typeof window !== 'undefined' && window.globalConfig && window.globalConfig.openRouteService) {
                            routingProfile = window.globalConfig.openRouteService.profiles?.customerToOdp || 'foot-walking';
                        }
                        
                        // Get route coordinates menggunakan routing helper
                        const customerToOdpRouteCoordinates = await getRouteCoordinates(
                            lat,
                            lng,
                            odpMarker.getLatLng().lat,
                            odpMarker.getLatLng().lng,
                            routingProfile
                        );
                        
                        // Create animated line dengan route coordinates (color-coded by online status)
                        let line;
                        if (onlineStatus === 'online') {
                            // Green animated line for online customers (fast animation)
                            line = L.polyline.antPath(customerToOdpRouteCoordinates, {
                                color: '#28a745',           // Green - online
                                weight: 6,
                                opacity: 0.8,
                                delay: 1000,                // Fast animation for active connections
                                dashArray: [10, 20],
                                pulseColor: '#00FF00',      // Bright green pulse
                                hardwareAccelerated: true
                            });
                        } else if (onlineStatus === 'offline') {
                            // Red animated line for offline customers (slow animation)
                            line = L.polyline.antPath(customerToOdpRouteCoordinates, {
                                color: '#dc3545',           // Red - offline
                                weight: 4,
                                opacity: 0.6,
                                delay: 3000,                // Slower animation for problems
                                dashArray: [5, 10],
                                pulseColor: '#a92b38',      // Darker red pulse
                                hardwareAccelerated: true
                            });
                        } else {
                            // Grey animated line for unknown status (medium animation)
                            line = L.polyline.antPath(customerToOdpRouteCoordinates, {
                                color: '#6c757d',           // Grey - unknown
                                weight: 3,
                                opacity: 0.5,
                                delay: 2500,                // Medium-slow animation
                                dashArray: [5, 10],
                                pulseColor: '#495057',      // Darker grey pulse
                                hardwareAccelerated: true
                            });
                        }
                        
                        line.connectedEntities = { customerId: customer.id, odpId: odpAsset.id };
                        customerToOdpLinesTechnicianPage.push(line);

                        if (odpAsset.parent_odc_id) {
                            const parentOdc = allOdcDataTechnicianPage.find(o => String(o.id) === String(odpAsset.parent_odc_id));
                            if (parentOdc) {
                                odcDetailsHtml = `<p><strong><i class="fas fa-server"></i> Induk ODC:</strong> ${parentOdc.name || `ID ${parentOdc.id}`}</p>`;
                                if (parentOdc.address) odcDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Alamat ODC: ${parentOdc.address}</p>`;
                                odcDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Kapasitas ODC: ${parentOdc.capacity_ports || 'N/A'} Port</p>`;
                                odcDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Port Terpakai ODC: ${parentOdc.ports_used || 0} (ODP)</p>`; // ODC ports_used is from backend
                            } else { odcDetailsHtml = `<p><strong><i class="fas fa-server"></i> Induk ODC:</strong> ID ${odpAsset.parent_odc_id} (Detail tidak ditemukan)</p>`; }
                        } else { odcDetailsHtml = `<p><strong><i class="fas fa-server"></i> Induk ODC:</strong> Tidak terhubung.</p>`; }
                    } else { odpDetailsHtml = `<p class="mt-2 pt-2 border-top"><strong><i class="fas fa-network-wired"></i> ODP:</strong> ID ${customer.connected_odp_id} (Detail tidak ditemukan)</p>`;}
                }
                popupContent += odpDetailsHtml + odcDetailsHtml;

                if (customer.device_id) {
                    popupContent += `<div class="mt-2 btn-group-vertical btn-block">` +
                                   `<button class="btn btn-info btn-sm" onclick="showWifiInfo('${customer.device_id}', '${customer.name || 'Pelanggan'}')"><i class="fas fa-wifi"></i> Info WiFi</button>` +
                                   `<button class="btn btn-primary btn-sm" onclick="manageWifi('${customer.device_id}', '${customer.name || 'Pelanggan'}')"><i class="fas fa-edit"></i> Kelola WiFi</button>` +
                                   `<button class="btn btn-warning btn-sm" onclick="showRedamanInfo('${customer.device_id}', '${customer.name || 'Pelanggan'}')"><i class="fas fa-wave-square"></i> Redaman</button>` +
                                   `<button class="btn btn-danger btn-sm" onclick="rebootDeviceMap('${customer.device_id}', '${customer.name || 'Pelanggan'}')"><i class="fas fa-power-off"></i> Reboot Router</button>` +
                                   `</div>`;
                }

                const marker = L.marker([lat, lng], { icon: createCustomerStatusIcon(onlineStatus) }).bindPopup(popupContent);
                marker.customerData = JSON.parse(JSON.stringify(customer));
                marker.customerOnlineStatus = onlineStatus; marker.customerIpAddress = customerIpAddress;
                marker.on('popupopen', function(e) { updateCustomerPopupDetailsTechnicianPage(e.target, e.target.customerData); });
                customerMarkersTechnicianPage.push(marker);
                await fetchRedamanForMarker(marker, customer.device_id);
                
                // Update monitoring statistics
                updateConnectionMonitoringTechnicianPage();
            }
            
            // Tampilkan dashboard setelah semua marker dibuat
            $('#connectionMonitoringDashboard').slideDown();
        }

        async function loadAllMapDataTechnicianPage() {
            displayGlobalMapMessage("Memuat data peta...", "info", 30000);
            $('#interactiveMap .loading-spinner-container').show();

            let pppoeLoaded = false, assetsFetched = false, customersFetched = false;

            try { await fetchActivePppoeUsers(); pppoeLoaded = true; }
            catch(e) { console.error("Gagal memuat status PPPoE:", e); }

            try {
                const response = await fetch(`/api/map/network-assets?_=${new Date().getTime()}`, { credentials: 'include' });
                if (!response.ok) throw new Error(`API Aset error: ${response.status}`);
                const result = await response.json();
                if (result.status !== 200 || !Array.isArray(result.data)) throw new Error("Format data aset salah");
                allNetworkAssetsData = result.data;
                assetsFetched = true;
            } catch(e) { console.error("Gagal memuat data aset:", e); displayGlobalMapMessage("Gagal memuat data aset jaringan.", 'danger', 0);}

            try {
                const response = await fetch(`/api/users?_=${new Date().getTime()}`, { credentials: 'include' });
                if (!response.ok) throw new Error(`API Pelanggan error: ${response.status}`);
                const result = await response.json();
                if (!result.data || !Array.isArray(result.data)) throw new Error("Format data pelanggan salah");
                allCustomerData = result.data;
                customersFetched = true;
            } catch(e) { console.error("Gagal memuat data pelanggan:", e); displayGlobalMapMessage("Gagal memuat data pelanggan.", 'danger', 0);}

            if (assetsFetched && customersFetched) {
                await createNetworkAssetMarkersTechnicianPage(); // Creates ODC/ODP markers & ODC-ODP lines
                await createCustomerMarkersTechnicianPage();   // Creates Customer markers & Cust-ODP lines

                if (isInitialLoadTechnicianPage) {
                    selectedOdcIdsTechnicianPage.clear(); selectedOdpIdsTechnicianPage.clear(); selectedCustomerIdsTechnicianPage.clear();
                    allNetworkAssetsData.forEach(asset => {
                        if (asset.type === 'ODC') selectedOdcIdsTechnicianPage.add(String(asset.id));
                        else if (asset.type === 'ODP') selectedOdpIdsTechnicianPage.add(String(asset.id));
                    });
                    allCustomerData.forEach(customer => selectedCustomerIdsTechnicianPage.add(String(customer.id)));
                }
                applyFiltersTechnicianPage();
            }

            if (map && !legendControlInstance) setupLegend();
            $('#interactiveMap .loading-spinner-container').hide();

            const msgDiv = $('#globalMessageMap .alert');
            if (assetsFetched && customersFetched) {
                if (!pppoeLoaded && !msgDiv.hasClass('alert-danger') && !msgDiv.hasClass('alert-warning')) {
                    displayGlobalMapMessage("Data peta dimuat. Status online pelanggan mungkin tidak akurat karena gagal mengambil data PPPoE.", "warning", 10000);
                } else if (allNetworkAssetsData.length === 0 && allCustomerData.length === 0 && !msgDiv.hasClass('alert-danger') && !msgDiv.hasClass('alert-warning')) {
                    displayGlobalMapMessage("Belum ada data aset jaringan atau pelanggan yang tersedia.", "info", 10000);
                } else if (msgDiv.hasClass('alert-info') && msgDiv.text().includes("Memuat data peta")) {
                    msgDiv.alert('close');
                }
            } else if (!msgDiv.hasClass('alert-danger') && !msgDiv.hasClass('alert-warning')) {
                displayGlobalMapMessage("Sebagian data peta gagal dimuat. Periksa konsol.", "warning", 0);
            }
        }

        function updateSelectAllCheckboxTechnicianPage(type, totalItems, selectedItems) {
            const selectAllCb = $(`#selectAll${type}Map`);
            if (totalItems > 0 && selectedItems === totalItems) selectAllCb.prop('checked', true).prop('indeterminate', false);
            else if (selectedItems === 0 || totalItems === 0) selectAllCb.prop('checked', false).prop('indeterminate', false);
            else selectAllCb.prop('checked', false).prop('indeterminate', true);
        }

        function openCustomFilterModalWithCurrentSelectionsTechnicianPage() {
            $('#searchOdcFilterMap, #searchOdpFilterMap, #searchCustomerFilterMap').val('').trigger('keyup');
            const odcListEl = $('#odcFilterListMap');
            const allOdcs = allNetworkAssetsData.filter(a => a.type === 'ODC').sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            odcListEl.empty();
            allOdcs.forEach(odc => {
                const isChecked = isInitialLoadTechnicianPage ? true : selectedOdcIdsTechnicianPage.has(String(odc.id));
                odcListEl.append(`<li class="list-group-item"><label><input type="checkbox" class="filter-item-checkbox-map" data-type="odc" data-id="${odc.id}" ${isChecked ? 'checked' : ''}> ${odc.name || `ODC ID ${odc.id}`}</label></li>`);
            });
            updateSelectAllCheckboxTechnicianPage('Odc', allOdcs.length, odcListEl.find('.filter-item-checkbox-map:checked').length);
            updateOdpFilterListFromModalTechnicianPage(isInitialLoadTechnicianPage); // Propagate initial load state
            $('#customFilterModalMap').modal('show');
        }

        function updateOdpFilterListFromModalTechnicianPage(checkAllChildrenIfParentSelected = false) {
            const currentlySelectedOdcIdsInModal = new Set();
            $('#odcFilterListMap .filter-item-checkbox-map:checked').each(function() { currentlySelectedOdcIdsInModal.add($(this).data('id').toString()); });

            const odpListEl = $('#odpFilterListMap');
            odpListEl.empty(); $('#searchOdpFilterMap').val('').trigger('keyup');

            if (currentlySelectedOdcIdsInModal.size === 0) {
                odpListEl.html('<li class="list-group-item text-muted small">Pilih ODC untuk melihat ODP terkait.</li>');
                updateSelectAllCheckboxTechnicianPage('Odp', 0, 0);
                updateCustomerFilterListFromModalTechnicianPage(false);
                return;
            }
            const relevantOdps = allNetworkAssetsData.filter(a => a.type === 'ODP' && a.parent_odc_id && currentlySelectedOdcIdsInModal.has(String(a.parent_odc_id))).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            relevantOdps.forEach(odp => {
                const isChecked = checkAllChildrenIfParentSelected ? true : selectedOdpIdsTechnicianPage.has(String(odp.id));
                odpListEl.append(`<li class="list-group-item"><label><input type="checkbox" class="filter-item-checkbox-map" data-type="odp" data-id="${odp.id}" ${isChecked ? 'checked' : ''}> ${odp.name || `ODP ID ${odp.id}`}</label></li>`);
            });
            updateSelectAllCheckboxTechnicianPage('Odp', relevantOdps.length, odpListEl.find('.filter-item-checkbox-map:checked').length);
            updateCustomerFilterListFromModalTechnicianPage(checkAllChildrenIfParentSelected);
        }

        function updateCustomerFilterListFromModalTechnicianPage(checkAllChildrenIfParentSelected = false) {
            const currentlySelectedOdpIdsInModal = new Set();
            $('#odpFilterListMap .filter-item-checkbox-map:checked').each(function() { currentlySelectedOdpIdsInModal.add($(this).data('id').toString()); });

            const customerListEl = $('#customerFilterListMap');
            customerListEl.empty(); $('#searchCustomerFilterMap').val('').trigger('keyup');

            if (currentlySelectedOdpIdsInModal.size === 0) {
                customerListEl.html('<li class="list-group-item text-muted small">Pilih ODP untuk melihat Pelanggan terkait.</li>');
                updateSelectAllCheckboxTechnicianPage('Customer', 0, 0);
                return;
            }
            const relevantCustomers = allCustomerData.filter(c => c.connected_odp_id && currentlySelectedOdpIdsInModal.has(String(c.connected_odp_id))).sort((a,b) => (a.name||'').localeCompare(b.name||''));
            relevantCustomers.forEach(cust => {
                const isChecked = checkAllChildrenIfParentSelected ? true : selectedCustomerIdsTechnicianPage.has(String(cust.id));
                customerListEl.append(`<li class="list-group-item"><label><input type="checkbox" class="filter-item-checkbox-map" data-type="customer" data-id="${cust.id}" ${isChecked ? 'checked' : ''}> ${cust.name || `Cust. ID ${cust.id}`}</label></li>`);
            });
            updateSelectAllCheckboxTechnicianPage('Customer', relevantCustomers.length, customerListEl.find('.filter-item-checkbox-map:checked').length);
        }


        function applyFiltersTechnicianPage() {
            if (!map) return;
            networkMarkersLayer.clearLayers(); customerMarkersLayer.clearLayers(); linesLayer.clearLayers();

            odcMarkersTechnicianPage.forEach(marker => { if (selectedOdcIdsTechnicianPage.has(String(marker.assetData.id))) networkMarkersLayer.addLayer(marker); });
            odpMarkersTechnicianPage.forEach(marker => { if (selectedOdpIdsTechnicianPage.has(String(marker.assetData.id))) networkMarkersLayer.addLayer(marker); });
            customerMarkersTechnicianPage.forEach(marker => { if (selectedCustomerIdsTechnicianPage.has(String(marker.customerData.id))) customerMarkersLayer.addLayer(marker); });

            // Only show connection lines if visibility is enabled
            if (connectionLinesVisible) {
                odpToOdcLinesTechnicianPage.forEach(line => { if (line.connectedEntities && selectedOdcIdsTechnicianPage.has(String(line.connectedEntities.odcId)) && selectedOdpIdsTechnicianPage.has(String(line.connectedEntities.odpId))) linesLayer.addLayer(line); });
                customerToOdpLinesTechnicianPage.forEach(line => { if (line.connectedEntities && selectedCustomerIdsTechnicianPage.has(String(line.connectedEntities.customerId)) && selectedOdpIdsTechnicianPage.has(String(line.connectedEntities.odpId))) linesLayer.addLayer(line); });
            }

            if (myLocationMarker && map.hasLayer(myLocationMarker)) {
                myLocationMarker.bringToFront();
            }
        }

        function showWifiInfo(deviceId, userName) {
            $('#wifiInfoModalLabel').text(`Info WiFi: ${userName}`);
            const modalBody = $('#wifiInfoModalBody');
            modalBody.html('<div class="loading-spinner-container"><i class="fas fa-spinner fa-spin fa-2x"></i><p>Memuat informasi WiFi...</p></div>');
            $('#wifiInfoModal').modal('show');

            let deviceDetailsHtml = '';

            // Use batch metrics API instead of non-existent /api/device-details
            fetch('/api/customer-metrics-batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ deviceIds: [deviceId] })
            })
                .then(response => response.json())
                .then(metricsResult => {
                    // Extract modem type from batch metrics
                    let modemType = 'N/A';
                    if (metricsResult.status === 200 && Array.isArray(metricsResult.data)) {
                        const deviceMetrics = metricsResult.data.find(m => m.deviceId === deviceId);
                        if (deviceMetrics && deviceMetrics.modemType) {
                            modemType = deviceMetrics.modemType;
                        }
                    }
                    deviceDetailsHtml = `<p><strong>Tipe Modem:</strong> ${modemType}</p>`;
                    
                    return fetch(`/api/customer-wifi-info/${deviceId}?_=${new Date().getTime()}`, {
                        credentials: 'include'
                    });
                })
                .then(response => response.json())
                .then(result => {
                    let content = deviceDetailsHtml;
                    if (result.status === 200 && result.data) {
                        content += `<p><strong>Uptime Perangkat (dari WiFi API):</strong> ${result.data.uptime || "N/A"}</p><hr>`;
                        if (result.data.ssid && result.data.ssid.length > 0) {
                            content += `<h6>Daftar SSID:</h6>`;
                            result.data.ssid.forEach(s => {
                                if (!s || typeof s !== 'object') return;
                                content += `<div class="card mb-2 shadow-sm"><div class="card-header py-2"><strong>SSID ${s.id || 'N/A'}: <span class="text-primary font-weight-bold">${s.name || 'N/A'}</span></strong></div><div class="card-body py-2 px-3">`;
                                content += `<p class="mb-1 small"><strong>Transmit Power:</strong> ${s.transmitPower != null ? s.transmitPower + '%' : 'N/A'}</p>`;
                                if (s.associatedDevices && s.associatedDevices.length > 0) {
                                    content += `<p class="mb-1 small mt-2"><strong><i class="fas fa-users"></i> Perangkat Terhubung (${s.associatedDevices.length}):</strong></p><ul class="list-group list-group-flush device-list small">`;
                                    s.associatedDevices.forEach(dev => {
                                        if (!dev || typeof dev !== 'object') return;
                                        content += `<li class="list-group-item py-1 px-0">${dev.hostName || 'N/A'} <br><small class="text-muted" style="font-size: 0.9em;">(MAC: ${dev.mac || '-'}, IP: ${dev.ip || '-'}, Sinyal: ${dev.signal ? dev.signal + ' dBm' : '-'})</small></li>`;
                                    });
                                    content += `</ul>`;
                                } else { content += `<p class="mb-1 small mt-2"><em>Tidak ada perangkat terhubung.</em></p>`; }
                                content += `</div></div>`;
                            });
                        } else { content += '<p>Tidak ada data SSID.</p>'; }
                    } else { content += `<p class="text-danger">${result.message || 'Gagal mengambil data WiFi.'}</p>`; }
                    modalBody.html(content);
                })
                .catch(error => {
                    modalBody.html(deviceDetailsHtml + `<p class="text-danger">Error memuat detail WiFi: ${error.message}</p>`);
                });
        }

        function manageWifi(deviceId, userName) {
            $('#manageWifiModalLabel').text(`Kelola WiFi: ${userName}`);
            $('#map_ssid_update_device_id').val(deviceId);
            $('#map_ssid_manage_customer_name').val(userName);

            const formContainer = $('#manageWifiFormContainer');
            const loadingSpinner = $('#manageWifiLoading');
            const transmitContainer = $('#manageWifiTransmitContainer');
            const helpText = $('#manageWifiHelpText');

            formContainer.empty().append(loadingSpinner.clone().show());
            transmitContainer.hide(); helpText.hide();
            $('#map_transmit_power').val('');
            $('#manageWifiModal').modal('show');

            fetch(`/api/customer-wifi-info/${deviceId}?_=${new Date().getTime()}`, {
                credentials: 'include'
            })
                .then(response => response.json())
                .then(result => {
                    formContainer.find('.loading-spinner-container').remove();
                    transmitContainer.show(); helpText.show();
                    if (result.status === 200 && result.data && Array.isArray(result.data.ssid)) {
                        if (result.data.ssid.length === 0) {
                            formContainer.html('<p class="text-muted">Tidak ada SSID terkonfigurasi yang dapat dikelola.</p>');
                            return;
                        }
                        let formContent = '';
                        result.data.ssid.forEach(s => {
                            if(!s || typeof s !== 'object') return;
                             formContent += `<div class="card card-body mb-2 p-2 shadow-sm">
                                <p class="mb-1"><strong>SSID ID: ${s.id} (Nama Saat Ini: <span class="text-info font-weight-bold">${s.name||'N/A'}</span>)</strong></p>
                                <div class="form-group mb-2"><label for="map_modal_ssid_name_${s.id}" class="form-label mb-0">Nama SSID Baru</label><input type="text" class="form-control form-control-sm" id="map_modal_ssid_name_${s.id}" name="ssid_${s.id}" placeholder="Kosong jika tidak diubah"></div>
                                <div class="form-group mb-1"><label for="map_modal_ssid_password_${s.id}" class="form-label mb-0">Password Baru</label><input type="password" class="form-control form-control-sm" id="map_modal_ssid_password_${s.id}" name="ssid_password_${s.id}" placeholder="Min. 8 karakter, kosong jika tidak diubah"></div>
                                </div>`;
                        });
                        formContainer.html(formContent);

                        if (result.data.ssid.length > 0 && result.data.ssid[0].transmitPower != null) {
                            $('#map_transmit_power').val(result.data.ssid[0].transmitPower);
                        } else {
                             $('#map_transmit_power').val('');
                        }
                    } else {
                        formContainer.html(`<p class="text-danger">${result.message || 'Gagal memuat konfigurasi SSID.'}</p>`);
                    }
                })
                .catch(error => {
                    formContainer.find('.loading-spinner-container').remove();
                    transmitContainer.show(); helpText.show();
                    formContainer.html(`<p class="text-danger">Error: ${error.message}</p>`);
                });
        }

        $('#ssidUpdateFormMap').on('submit', async function(event) {
            event.preventDefault();
            const deviceId = $('#map_ssid_update_device_id').val();
            const customerName = $('#map_ssid_manage_customer_name').val();
            const formData = new FormData(this);
            const payload = {};
            let hasChanges = false;

            formData.forEach((value, key) => {
                if (value && value.trim() !== '') {
                    payload[key] = value.trim();
                    if (key !== 'device_id_for_ssid_update' && key !== 'customer_name_for_wifi_manage') {
                        hasChanges = true;
                    }
                }
            });
            delete payload.device_id_for_ssid_update;
            delete payload.customer_name_for_wifi_manage;


            if (!hasChanges) {
                displayGlobalMapMessage('Tidak ada perubahan yang dimasukkan.', 'info');
                $('#manageWifiModal').modal('hide');
                return;
            }

            const btn = $('#mapSaveSsidChangesBtn');
            const originalText = btn.html();
            btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Menyimpan...');

            try {
                const response = await fetch(`/api/ssid/${deviceId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                if (response.ok && result.status === 200) {
                    $('#manageWifiModal').modal('hide');
                    displayGlobalMapMessage(result.message || `Perubahan WiFi untuk ${customerName} berhasil dikirim.`, 'success');
                } else {
                    displayGlobalMapMessage(`Gagal simpan: ${result.message || 'Error tidak diketahui dari server.'}`, 'danger');
                }
            } catch (error) {
                displayGlobalMapMessage(`Error koneksi atau sistem: ${error.message}`, 'danger');
            } finally {
                btn.prop('disabled', false).html(originalText);
            }
        });


        function showRedamanInfo(deviceId, userName, isRefresh = false) {
            $('#redamanInfoModalLabel').text(`Redaman Optik: ${userName}`);
            $('#redaman_device_id').text(deviceId);
            $('#redaman_customer_name').text(userName);

            const loadingSpinner = $('#redamanInfoModal #redamanLoadingSpinner');
            const contentDiv = $('#redamanInfoContent');
            const valueSpan = $('#redaman_value');
            const messageSmall = $('#redaman_message');

            if (!isRefresh) {
                contentDiv.hide();
                loadingSpinner.show();
                $('#redamanInfoModal').modal('show');
            } else {
                valueSpan.html('<i class="fas fa-spinner fa-spin fa-xs"></i>');
            }
            messageSmall.text('').removeClass('text-danger text-warning text-success text-muted');


            fetch(`/api/customer-redaman/${deviceId}?force_refresh=true&_=${new Date().getTime()}`, { credentials: 'include' })
                .then(response => response.json())
                .then(result => {
                    loadingSpinner.hide(); contentDiv.show();
                    if (result.status === 200 && result.data) {
                        const presentation = getRedamanPresentation(result.data.redaman);
                        valueSpan.html(`<span style="color: ${presentation.color}">${presentation.text}</span>`);
                        messageSmall.text(result.message || "Data redaman berhasil diambil.").addClass(result.data.redaman != null ? 'text-success' : (result.message && result.message.includes("tidak tersedia") ? 'text-warning' : 'text-muted'));
                    } else {
                        valueSpan.html(`<span style="color: ${getRedamanPresentation(null).color}">${getRedamanPresentation(null).text}</span>`);
                        messageSmall.text(result.message || 'Gagal mengambil data redaman.').addClass('text-danger');
                    }
                    $('#refreshRedamanButtonInModal').off('click').on('click', () => showRedamanInfo(deviceId, userName, true));
                })
                .catch(error => {
                    loadingSpinner.hide(); contentDiv.show();
                    valueSpan.html(`<span style="color: ${getRedamanPresentation('Error').color}">${getRedamanPresentation('Error').text}</span>`);
                    messageSmall.text(`Error koneksi: ${error.message}`).addClass('text-danger');
                     $('#refreshRedamanButtonInModal').off('click').on('click', () => showRedamanInfo(deviceId, userName, true));
                });
        }

        function rebootDeviceMap(deviceId, userName) {
            if (!deviceId) { displayGlobalMapMessage('Device ID tidak valid untuk reboot.', 'danger'); return; }
            if (confirm(`Apakah Anda yakin ingin me-reboot router untuk pelanggan ${userName} (Device ID: ${deviceId})?`)) {
                displayGlobalMapMessage(`Mengirim perintah reboot ke perangkat ${deviceId}...`, 'info');
                fetch(`/api/reboot/${deviceId}`, { method: 'GET' })
                    .then(response => {
                        if (!response.ok) {
                            return response.json().then(err => { throw new Error(err.message || `Status server: ${response.status}`) });
                        }
                        return response.json();
                    })
                    .then(data => {
                        displayGlobalMapMessage(data.message || `Perintah reboot untuk ${userName} berhasil dikirim.`, data.status === 200 ? 'success' : 'warning');
                    })
                    .catch(err => {
                        displayGlobalMapMessage(`Gagal mengirim perintah reboot untuk ${userName}: ${err.message}`, 'danger');
                    });
            }
        }


        $(document).ready(function() {
            initializeMap();
            
            // Set initial state for connection toggle button (lines visible by default)
            $('#toggleConnectionLinesBtn').removeClass('btn-outline-success').addClass('btn-success');
            
            $('#manualFullscreenBtn').on('click', toggleFullScreenManual);
             // Function to update connection monitoring dashboard
            function updateConnectionMonitoringTechnicianPage() {
                if (!customerMarkersTechnicianPage || customerMarkersTechnicianPage.length === 0) {
                    $('#monitoring-online-count').text('0');
                    $('#monitoring-offline-count').text('0');
                    $('#monitoring-total-count').text('0');
                    $('#monitoring-uptime-rate').text('0%');
                    return;
                }
                
                let onlineCount = 0;
                let offlineCount = 0;
                let unknownCount = 0;
                
                customerMarkersTechnicianPage.forEach(marker => {
                    const status = marker.customerOnlineStatus;
                    if (status === 'online') onlineCount++;
                    else if (status === 'offline') offlineCount++;
                    else unknownCount++;
                });
                
                const totalCount = customerMarkersTechnicianPage.length;
                const uptimeRate = totalCount > 0 ? ((onlineCount / totalCount) * 100).toFixed(1) : 0;
                
                $('#monitoring-online-count').text(onlineCount);
                $('#monitoring-offline-count').text(offlineCount);
                $('#monitoring-total-count').text(totalCount);
                $('#monitoring-uptime-rate').text(uptimeRate + '%');
            }
            
             $('#refreshAllDataBtnMap').on('click', async function() {
                const button = $(this); const originalHtml = button.html();
                button.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Refresh Data...');
                await loadAllMapDataTechnicianPage();
                updateConnectionMonitoringTechnicianPage(); // Update monitoring setelah refresh
                button.prop('disabled', false).html(originalHtml);
                // Check if there's an error/warning message already, if not, show success.
                if (!$('#globalMessageMap .alert-danger').length && !$('#globalMessageMap .alert-warning').length) {
                    displayGlobalMapMessage("Data peta telah direfresh.", "success", 5000);
                }
            });

            // Auto-refresh toggle event handler
            $('#autoRefreshToggle').on('change', function() {
                if ($(this).is(':checked')) {
                    // Clear any existing interval
                    if (autoRefreshIntervalId) {
                        clearInterval(autoRefreshIntervalId);
                    }

                    // Define the auto-refresh function
                    const runAutoRefresh = async () => {
                        console.log(`[AutoRefresh] Running automatic data refresh at ${new Date().toLocaleTimeString()}`);
                        const refreshBtn = $('#refreshAllDataBtnMap');
                        
                        // Skip if manual refresh is already in progress
                        if (refreshBtn.prop('disabled')) {
                            console.log('[AutoRefresh] Skipping - manual refresh already in progress.');
                            return;
                        }
                        
                        try {
                            await loadAllMapDataTechnicianPage();
                            updateConnectionMonitoringTechnicianPage(); // Update monitoring setelah refresh
                            console.log('[AutoRefresh] Automatic data refresh finished successfully.');
                        } catch (error) {
                            console.error('[AutoRefresh] Error during automatic refresh:', error);
                        }
                    };

                    // Run immediately when enabled
                    runAutoRefresh();
                    
                    // Set up interval for periodic refresh
                    autoRefreshIntervalId = setInterval(runAutoRefresh, AUTO_REFRESH_INTERVAL_MS);
                    
                    // Update label and show notification
                    const label = $(this).next('label');
                    displayGlobalMapMessage(
                        `Auto refresh diaktifkan. Data akan diperbarui setiap ${AUTO_REFRESH_INTERVAL_MS / 1000} detik.`, 
                        'info', 
                        5000
                    );
                    label.attr('title', `Nonaktifkan refresh data otomatis (interval ${AUTO_REFRESH_INTERVAL_MS / 1000} detik)`);

                } else {
                    // Disable auto-refresh
                    if (autoRefreshIntervalId) {
                        clearInterval(autoRefreshIntervalId);
                        autoRefreshIntervalId = null;
                        console.log('[AutoRefresh] Auto-refresh stopped.');
                        displayGlobalMapMessage('Auto refresh dinonaktifkan.', 'info', 5000);
                        $(this).next('label').attr('title', 'Aktifkan refresh data otomatis setiap 30 detik');
                    }
                }
            });

            // Connection lines toggle event handler
            $('#toggleConnectionLinesBtn').on('click', function() {
                connectionLinesVisible = !connectionLinesVisible; // Toggle state
                
                const btn = $(this);
                if (connectionLinesVisible) {
                    // Lines are now VISIBLE
                    btn.removeClass('btn-outline-success').addClass('btn-success');
                    btn.html('<i class="fas fa-project-diagram"></i> <span class="d-none d-sm-inline">Koneksi</span>');
                    btn.attr('title', 'Sembunyikan Garis Koneksi Jaringan');
                    displayGlobalMapMessage('Garis koneksi jaringan ditampilkan.', 'success', 3000);
                    console.log('[ConnectionLines] Connection lines shown.');
                } else {
                    // Lines are now HIDDEN
                    btn.removeClass('btn-success').addClass('btn-outline-success');
                    btn.html('<i class="fas fa-project-diagram"></i> <span class="d-none d-sm-inline">Koneksi</span>');
                    btn.attr('title', 'Tampilkan Garis Koneksi Jaringan');
                    displayGlobalMapMessage('Garis koneksi jaringan disembunyikan.', 'info', 3000);
                    console.log('[ConnectionLines] Connection lines hidden.');
                }
                
                // Re-apply filters to show/hide lines based on new state
                applyFiltersTechnicianPage();
            });

            $('#openCustomFilterModalBtnMap').on('click', openCustomFilterModalWithCurrentSelectionsTechnicianPage);

            $(document).on('change', '#customFilterModalMap .filter-item-checkbox-map', function() {
                const type = $(this).data('type');
                if (type === 'odc') {
                    updateSelectAllCheckboxTechnicianPage('Odc', $('#odcFilterListMap .filter-item-checkbox-map').length, $('#odcFilterListMap .filter-item-checkbox-map:checked').length);
                    updateOdpFilterListFromModalTechnicianPage(false);
                } else if (type === 'odp') {
                    updateSelectAllCheckboxTechnicianPage('Odp', $('#odpFilterListMap .filter-item-checkbox-map').length, $('#odpFilterListMap .filter-item-checkbox-map:checked').length);
                    updateCustomerFilterListFromModalTechnicianPage(false);
                } else if (type === 'customer') {
                    updateSelectAllCheckboxTechnicianPage('Customer', $('#customerFilterListMap .filter-item-checkbox-map').length, $('#customerFilterListMap .filter-item-checkbox-map:checked').length);
                }
            });

            $(document).on('change', '#selectAllOdcMap, #selectAllOdpMap, #selectAllCustomerMap', function() {
                const type = $(this).attr('id').replace('selectAll', '').replace('Map','').toLowerCase();
                const listElement = $(`#${type}FilterListMap`);
                const isChecked = $(this).is(':checked');

                listElement.find('.filter-item-checkbox-map').prop('checked', isChecked);

                if (type === 'odc') {
                    updateOdpFilterListFromModalTechnicianPage(isChecked);
                    updateSelectAllCheckboxTechnicianPage('Odc', listElement.find('.filter-item-checkbox-map').length, isChecked ? listElement.find('.filter-item-checkbox-map').length : 0);
                } else if (type === 'odp') {
                    updateCustomerFilterListFromModalTechnicianPage(isChecked);
                    updateSelectAllCheckboxTechnicianPage('Odp', listElement.find('.filter-item-checkbox-map').length, isChecked ? listElement.find('.filter-item-checkbox-map').length : 0);
                } else if (type === 'customer') {
                     updateSelectAllCheckboxTechnicianPage('Customer', listElement.find('.filter-item-checkbox-map').length, isChecked ? listElement.find('.filter-item-checkbox-map').length : 0);
                }
            });


            $('#applyCustomFilterBtnMap').on('click', function() {
                selectedOdcIdsTechnicianPage.clear(); selectedOdpIdsTechnicianPage.clear(); selectedCustomerIdsTechnicianPage.clear();
                $('#odcFilterListMap .filter-item-checkbox-map:checked').each(function() { selectedOdcIdsTechnicianPage.add($(this).data('id').toString()); });
                $('#odpFilterListMap .filter-item-checkbox-map:checked').each(function() { selectedOdpIdsTechnicianPage.add($(this).data('id').toString()); });
                $('#customerFilterListMap .filter-item-checkbox-map:checked').each(function() { selectedCustomerIdsTechnicianPage.add($(this).data('id').toString()); });
                isInitialLoadTechnicianPage = false;
                applyFiltersTechnicianPage();
                $('#customFilterModalMap').modal('hide'); displayGlobalMapMessage('Filter kustom diterapkan.', 'success', 3000);
            });

            $('#resetCustomFilterBtnMap').on('click', function() {
                $('#odcFilterListMap .filter-item-checkbox-map').prop('checked', true);
                updateSelectAllCheckboxTechnicianPage('Odc', $('#odcFilterListMap .filter-item-checkbox-map').length, $('#odcFilterListMap .filter-item-checkbox-map').length);
                updateOdpFilterListFromModalTechnicianPage(true);

                displayGlobalMapMessage('Filter direset untuk menampilkan semua. Klik "Terapkan Filter" untuk menyimpan.', 'info', 5000);
            });

            $('.filter-search-input').on('keyup', function() {
                const searchTerm = $(this).val().toLowerCase(); const listId = $(this).nextAll('.filter-list-column').first().attr('id');
                $(`#${listId} li`).each(function() { $(this).toggle($(this).text().toLowerCase().includes(searchTerm)); });
            });
        });

        // Cleanup auto-refresh interval on page unload to prevent memory leaks
        $(window).on('beforeunload', function() {
            if (autoRefreshIntervalId) {
                clearInterval(autoRefreshIntervalId);
                autoRefreshIntervalId = null;
                console.log('[AutoRefresh] Cleaned up on page unload.');
            }
        });
