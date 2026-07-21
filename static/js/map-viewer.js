/* global getRouteCoordinates */
        // Version check - Plugin re-enabled to match teknisi version
        console.log("[MAP-VIEWER] Version: WORKING-COPY-2025-11-07");
        console.log("[MAP-VIEWER] Plugin enabled - same as teknisi-map-viewer.php");
        
        if (window.location.protocol !== "https:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
            console.warn("PERINGATAN: Halaman ini diakses melalui HTTP. Fitur geolokasi mungkin tidak berfungsi optimal. Silakan gunakan HTTPS.");
        }

        let currentUser = null;
        let map;
        let myLocationMarker = null;
        let networkMarkersLayer = L.layerGroup();
        let customerMarkersLayer = L.layerGroup();
        let linesLayer = L.layerGroup();
        
        // Global config untuk routing
        let globalConfig = null;

        // SATU sumber kebenaran penyaringan. Sebelumnya kotak centang legenda menambah/menghapus marker
// LANGSUNG tanpa mencatat apa pun, sehingga pilihannya lenyap diam-diam tiap auto-refresh 30 detik
// atau tiap tombol Quick Filter ditekan — kotak tetap tercentang, peta berkata lain.
const filterState = window.MapFilterCore.buatFilterState();

let allOdcData = [];
        let allNetworkAssetsData = [];
        let allCustomerData = [];
        let activePppoeUsersMap = new Map();
        let initialPppoeLoadFailed = false;

        let odcMarkers = [];
        let odpMarkers = [];
        let customerMarkers = [];
        let odpToOdcLines = [];
        let customerToOdpLines = [];
        
        // Waypoint Editor State
        let waypointEditorMode = false;
        let currentEditingConnection = null; // { type: 'odc-odp'|'customer-odp', sourceId, targetId }
        let waypointMarkers = []; // Array of waypoint markers
        let waypointLayer = L.layerGroup();
        
        let labelVisibility = {
            odc: true,
            odp: true,
            customer: true
        };

        let selectedOdcIds = new Set();
        let selectedOdpIds = new Set();
        let selectedCustomerIds = new Set();
        let isInitialLoad = true;
        let autoRefreshIntervalId = null;
        const AUTO_REFRESH_INTERVAL_MS = 30000; // 30 detik
        
        // Chart.js variables (lazy loaded)
        let Chart = null;
        let monitoringCharts = {
            online: null,
            offline: null,
            total: null,
            uptime: null
        };
        
        // Data history untuk charts (24 jam terakhir, per jam)
        let monitoringHistory = {
            timestamps: [],
            online: [],
            offline: [],
            total: [],
            uptime: []
        };
        
        // Debounce untuk chart updates
        let chartUpdateTimeout = null;
        const CHART_UPDATE_DEBOUNCE_MS = 5000; // 5 detik

        // Mini-map specific variables
        let assetModalMapInstance = null;
        let assetModalMapMarker = null;

        const ICON_WIDTH = 30; // Standard width for our custom icons
        const ICON_HEIGHT = 24; // Standard height of FontAwesome icon (from font-size)
        // Note: For tooltips, their position is relative to the marker's anchor,
        // so we don't need to calculate label height into the main icon's size/anchor.

        /**
         * Creates a custom DivIcon with FontAwesome icon. This icon will NOT contain the label HTML.
         * The label will be handled by L.tooltip separately.
         * @param {string} faClassName - FontAwesome class (e.g., 'fa-server', 'fa-map-marker-alt').
         * @param {string} colorClass - Custom CSS class for color (e.g., 'icon-odc').
         * @returns {L.DivIcon} - A Leaflet DivIcon instance for the icon only.
         */
// Modifikasi createBaseIcon untuk menerima parameter anchor kustom
const createBaseIcon = (faClassName, colorClass, customAnchor = null) => {
    // Default anchor di tengah icon
    let iconAnchor = [ICON_WIDTH/2, ICON_HEIGHT/2];
    
    // Jika ada custom anchor, gunakan itu
    if (customAnchor) {
        iconAnchor = customAnchor;
    }
    
    return L.divIcon({
        html: `<div class="custom-div-icon ${colorClass}"><i class="fas ${faClassName}"></i></div>`,
        className: 'leaflet-div-icon',
        iconSize: [ICON_WIDTH, ICON_HEIGHT],
        iconAnchor: iconAnchor,
        popupAnchor: [0, -ICON_HEIGHT/2]
    });
};
        
/**
 * Ikon aset. Untuk ODP, `info` (opsional) membuat boks itu MELAPORKAN DIRINYA tanpa perlu diklik:
 *   - lencana hunian `3/8` (kuning bila hampir penuh, merah bila penuh) → saat pasang baru, ODP yang
 *     masih bersisa langsung kelihatan tanpa membuka satu per satu.
 *   - cincin merah berdenyut bila MAYORITAS penghuninya offline → itu jawaban atas pertanyaan
 *     pertama tiap laporan gangguan: "ODP-nya, atau cuma rumah orang itu?".
 * Tanpa `info`, perilakunya sama persis seperti sebelumnya.
 */
const createAssetIcon = (asset, info = null) => {
    let iconClass, colorClass;
    if (asset.type === 'ODC') {
        iconClass = 'fa-server';
        colorClass = 'icon-odc';
    } else { // ODP
        iconClass = 'fa-network-wired';
        colorClass = 'icon-odp';
    }
    if (!info) return createBaseIcon(iconClass, colorClass);

    const hunian = info.hunian;
    const kelasHunian = hunian.penuh ? 'odp-badge-penuh' : (hunian.hampirPenuh ? 'odp-badge-hampir' : '');
    const badge = hunian.kapasitas || hunian.terpakai
        ? `<span class="odp-badge ${kelasHunian}">${hunian.teks}</span>`
        : '';
    const curiga = info.sehat && info.sehat.curiga ? ' odp-curiga' : '';

    return L.divIcon({
        html: `<div class="custom-div-icon ${colorClass}${curiga}"><i class="fas ${iconClass}"></i>${badge}</div>`,
        className: 'leaflet-div-icon',
        iconSize: [ICON_WIDTH, ICON_HEIGHT],
        iconAnchor: [ICON_WIDTH / 2, ICON_HEIGHT / 2],
        popupAnchor: [0, -ICON_HEIGHT / 2]
    });
};

/** Status online tiap pelanggan sebuah ODP — dipakai ikon MAUPUN popup, jadi hitungannya satu. */
const kesehatanOdp = (odpId, customers, activeMap, pppoeGagal) => {
    const anggota = (customers || []).filter((c) => String(c.connected_odp_id) === String(odpId));
    const daftar = anggota.map((c) => {
        let status = 'unknown';
        if (c.pppoe_username) status = activeMap && activeMap.has(c.pppoe_username) ? 'online' : 'offline';
        if (pppoeGagal && c.pppoe_username) status = 'unknown'; // daftar sesi gagal dibaca = BUTA, bukan mati
        return { id: c.id, name: c.name, status };
    });
    return { anggota, daftar, sehat: window.MapFilterCore.hitungKesehatanOdp(daftar) };
};

const myLocationIcon = createBaseIcon('fa-street-view', 'icon-customer-unknown'); 

const createCustomerStatusIcon = (status) => {
    let colorClass = 'icon-customer-unknown';
    if (status === 'online') {
        colorClass = 'icon-customer-online';
    } else if (status === 'offline') {
        colorClass = 'icon-customer-offline';
    }
    
    // Untuk icon marker, anchor harus di bagian bawah tengah
    // Nilai Y yang lebih besar berarti lebih ke bawah
    return createBaseIcon('fa-map-marker-alt', colorClass, [ICON_WIDTH/2, ICON_HEIGHT]);
};


        fetch('/api/me', { credentials: 'include' }).then(response => response.json()).then(data => {
            if (data.status === 200 && data.data) {
                document.getElementById('username-placeholder').textContent = data.data.username;
                currentUser = data.data;
            }
        }).catch(err => console.error("[MainScript] Error fetching user data:", err));
        
        // Load config untuk routing
        fetch('/api/config', { credentials: 'include' }).then(response => response.json()).then(data => {
            if (data.status === 200 && data.config) {
                globalConfig = data.config;
                // Make config available globally for routing helper
                window.globalConfig = globalConfig;
                console.log("[MAP-VIEWER] Config loaded successfully for routing");
            }
        }).catch(err => console.warn("[MAP-VIEWER] Error loading config (routing will use defaults):", err));

        function displayGlobalMapMessage(message, type = 'info', duration = 7000) {
            const globalMessageDiv = $('#globalMessageMap');
            globalMessageDiv.html(`<div class="alert alert-${type} alert-dismissible fade show" role="alert">
                                ${message}
                                <button type="button" class="close" data-dismiss="alert" aria-label="Close">
                                    <span aria-hidden="true">&times;</span>
                                </button>
                            </div>`);
            if (duration > 0 && type !== 'danger' && type !== 'warning') {
                 setTimeout(() => {
                    globalMessageDiv.find('.alert').alert('close');
                }, duration);
            }
        }

        function handleGeolocationErrorMapViewer(error, contextMessage, displayTarget) {
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
            displayTarget(errorText, 'danger', 15000);
        }

        function processSuccessfulGeolocationMapViewer(position, contextMessage, displayTarget, mapInstanceToUpdate, buttonContainer, originalIcon) {
            const userLat = position.coords.latitude;
            const userLng = position.coords.longitude;
            const accuracy = position.coords.accuracy;
            console.log(`${contextMessage} - Coords: Lat=${userLat}, Lng=${userLng}, Accuracy=${accuracy}m`);

            if (mapInstanceToUpdate) {
                mapInstanceToUpdate.setView([userLat, userLng], 18);
                if (myLocationMarker) {
                    myLocationMarker.setLatLng([userLat, userLng])
                                    .setTooltipContent(`Lokasi Saya (Akurasi: ${accuracy.toFixed(0)}m)`);
                } else {
                    myLocationMarker = L.marker([userLat, userLng], {icon: myLocationIcon, zIndexOffset: 1000})
                                         .bindTooltip(`Lokasi Saya (Akurasi: ${accuracy.toFixed(0)}m)`, {permanent: true, direction: 'top', className: 'marker-label-tooltip', offset: [0, -ICON_HEIGHT/2 - 5]}) // Offset to put label above icon
                                         .addTo(mapInstanceToUpdate);
                }
                // Ensure myLocationMarker tooltip is visible
                myLocationMarker.getTooltip().setOpacity(1); 
            }

            let accuracyMessage = `Lokasi GPS ditemukan (Akurasi: ${accuracy.toFixed(0)}m).`;
            let accuracyType = "success";
            if (accuracy > 1000) {
                accuracyMessage = `PERINGATAN: Akurasi lokasi sangat rendah (${Math.round(accuracy)}m). Mungkin lokasi jaringan/IP.`;
                accuracyType = "danger";
            } else if (accuracy > 150) {
                 accuracyMessage = `Info: Akurasi lokasi sedang (${Math.round(accuracy)}m).`;
                 accuracyType = "warning";
            }
            displayTarget(accuracyMessage, accuracyType, 10000);

            if (buttonContainer && originalIcon) {
                buttonContainer.innerHTML = originalIcon;
            }
        }


        function haversineDistance(coords1, coords2) {
            function toRad(x) { return x * Math.PI / 180; }
            const R = 6371;
            const dLat = toRad(coords2.latitude - coords1.latitude);
            const dLon = toRad(coords2.longitude - coords1.longitude);
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos(toRad(coords1.latitude)) * Math.cos(toRad(coords2.latitude)) *
                      Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c * 1000;
        }

        function getRedamanPresentation(redaman) {
            const val = parseFloat(redaman);
            let color = 'grey';
            let text;

            if (redaman === null || typeof redaman === 'undefined') {
                 text = 'RX: -';
                 color = '#6c757d';
            } else if (isNaN(val)) {
                text = 'RX: N/A';
                 color = '#6c757d';
            } else {
                 text = `RX: ${val.toFixed(2)} dBm`;
                 if (val > -20) color = '#28a745';
                 else if (val > -24) color = '#76ff03';
                 else if (val > -27) color = '#ffc107';
                 else if (val > -30) color = '#fd7e14';
                 else color = '#dc3545';
            }
            return { text, color };
        }

        async function updateCustomerPopupDetails(marker, customer) {
            const customerId = customer.id;
            const deviceId = customer.device_id;

            const modemTypeSpan = document.getElementById(`modem-type-${customerId}`);
            const redamanSpan = document.getElementById(`redaman-val-${customerId}`);

            if (!deviceId) {
                if (modemTypeSpan) modemTypeSpan.textContent = 'N/A (No Device ID)';
                if (redamanSpan) redamanSpan.innerHTML = getRedamanPresentation(null).text;
                return;
            }

            // Use the batch metrics API to get both redaman and modem type
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
                console.error(`Error fetching metrics for popup ${deviceId}:`, error);
                if (modemTypeSpan) modemTypeSpan.textContent = 'Error saat memuat';
                if (redamanSpan) {
                    const presentation = getRedamanPresentation('Error');
                    redamanSpan.innerHTML = `<span style="color: ${presentation.color}; font-weight: bold;">${presentation.text}</span>`;
                }
            }
        }


        async function fetchActivePppoeUsers() {
            initialPppoeLoadFailed = false;
            activePppoeUsersMap.clear();
            try {
                const response = await fetch('/api/mikrotik/ppp-active-users?_=${new Date().getTime()}', { credentials: 'include' });
                if (!response.ok) {
                    const errorResult = await response.json().catch(() => ({ message: response.statusText }));
                    console.error("[fetchActivePppoeUsers MapPage] API Error:", response.status, errorResult.message, errorResult.stderr || '');
                    displayGlobalMapMessage(`Gagal mengambil data PPPoE aktif: ${errorResult.message || response.statusText}. Status dan IP pelanggan mungkin tidak akurat.`, 'warning', 0);
                    initialPppoeLoadFailed = true;
                    return;
                }
                const result = await response.json();
                if (result.status === 200 && Array.isArray(result.data)) {
                    result.data.forEach(userEntry => {
                        if (userEntry.name && userEntry.address) {
                            activePppoeUsersMap.set(userEntry.name, userEntry.address);
                        } else {
                             console.warn("[fetchActivePppoeUsers MapPage] Entri pengguna dari API tidak lengkap:", userEntry);
                        }
                    });
                    console.log("Active PPPoE users and IPs fetched for Map Page:", activePppoeUsersMap.size);
                } else {
                    console.warn("[fetchActivePppoeUsers MapPage] Format data PPPoE aktif tidak sesuai atau status API bukan 200:", result);
                    displayGlobalMapMessage('Format data PPPoE aktif dari server tidak sesuai. Status dan IP pelanggan mungkin tidak akurat.', 'warning', 0);
                    initialPppoeLoadFailed = true;
                }
            } catch (error) {
                console.error("[fetchActivePppoeUsers MapPage] Error fetching active PPPoE data:", error);
                displayGlobalMapMessage('Kesalahan koneksi saat mengambil data PPPoE aktif. Status dan IP pelanggan mungkin tidak akurat.', 'danger', 0);
                initialPppoeLoadFailed = true;
            }
        }


        function initializeMap() {
            // Clean previous map instance
            if (map) { 
                map.remove(); 
                map = null; 
                if(myLocationMarker) myLocationMarker = null;
            }
            
            // Esri World Imagery hanya support sampai zoom level 18 (native)
            // maxZoom 19+ akan menyebabkan "map data not yet available" karena tile tidak tersedia
            // Diperbaiki: Set ke 18 untuk memastikan tidak ada error
            const satelliteMaxZoom = 18; // Diperbaiki: Esri hanya support sampai level 18
            const osmMaxZoom = 22;
            
            // Create map - simple like teknisi version
            map = L.map('interactiveMap', {
                maxZoom: satelliteMaxZoom
            }).setView([-7.2430309,111.846867], 15);

            // Create tile layers - simple like teknisi
            const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
                maxZoom: osmMaxZoom, 
                attribution: '&copy; OSM Contributors' 
            });
            // Perbaikan: Gunakan maxNativeZoom untuk mencegah zoom melebihi kemampuan tile server
            // maxNativeZoom: zoom maksimal yang didukung oleh tile server (18 untuk Esri)
            // maxZoom: zoom maksimal yang diizinkan Leaflet (harus sama dengan maxNativeZoom untuk mencegah error)
            const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
                maxZoom: satelliteMaxZoom,
                maxNativeZoom: 18, // Esri World Imagery hanya support sampai level 18
                attribution: 'Tiles &copy; Esri',
                // Tambahkan error handling untuk tile yang gagal load
                errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' // Transparent 1x1 pixel
            }).addTo(map);
            
            // Fungsi untuk menghapus text node yang berisi pesan error
            function removeErrorTextNodes() {
                // Cari semua tile container
                const tileContainers = document.querySelectorAll('.leaflet-tile-container');
                tileContainers.forEach(container => {
                    // Iterasi semua child nodes (termasuk text nodes)
                    const walker = document.createTreeWalker(
                        container,
                        NodeFilter.SHOW_TEXT,
                        null,
                        false
                    );
                    let node;
                    const nodesToRemove = [];
                    while (node = walker.nextNode()) {
                        const text = node.textContent.trim();
                        // Hapus text node yang berisi pesan error
                        if (text.includes('not yet') || 
                            text.includes('not available') || 
                            text.includes('map data') ||
                            text.toLowerCase().includes('error') ||
                            text.length > 0 && !text.match(/^\s*$/)) {
                            nodesToRemove.push(node);
                        }
                    }
                    // Hapus text nodes yang ditemukan
                    nodesToRemove.forEach(node => {
                        try {
                            node.parentNode.removeChild(node);
                        } catch (e) {
                            // Ignore jika node sudah dihapus
                        }
                    });
                });
            }
            
            // Handle tile loading errors untuk mencegah pesan "map data not yet available"
            satelliteLayer.on('tileerror', function(error, tile) {
                // Log error untuk debugging (hanya di development)
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    console.warn('[MAP] Tile error pada zoom level:', map.getZoom(), 'Tile:', tile);
                }
                // Hapus text node error setelah error terjadi
                setTimeout(removeErrorTextNodes, 100);
                // Jika zoom level melebihi maxNativeZoom, turunkan zoom level
                if (map.getZoom() > 18) {
                    console.warn('[MAP] Zoom level melebihi maxNativeZoom (18), menurunkan zoom...');
                    map.setZoom(18);
                }
            });
            
            // Handle tile loading errors untuk OSM layer juga
            osmLayer.on('tileerror', function(error, tile) {
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    console.warn('[MAP] OSM Tile error pada zoom level:', map.getZoom(), 'Tile:', tile);
                }
                setTimeout(removeErrorTextNodes, 100);
            });
            
            // Gunakan MutationObserver untuk memantau dan menghapus text node error secara real-time
            const errorTextObserver = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    if (mutation.addedNodes.length > 0) {
                        // Cek setiap node yang ditambahkan
                        mutation.addedNodes.forEach(function(node) {
                            if (node.nodeType === Node.TEXT_NODE) {
                                const text = node.textContent.trim();
                                if (text.includes('not yet') || 
                                    text.includes('not available') || 
                                    text.includes('map data')) {
                                    try {
                                        node.parentNode.removeChild(node);
                                    } catch (e) {
                                        // Ignore jika node sudah dihapus
                                    }
                                }
                            } else if (node.nodeType === Node.ELEMENT_NODE) {
                                // Cek juga text content di dalam element
                                const text = node.textContent || '';
                                if (text.includes('not yet') || 
                                    text.includes('not available') || 
                                    text.includes('map data')) {
                                    node.style.display = 'none';
                                    node.style.visibility = 'hidden';
                                    node.style.opacity = '0';
                                    node.style.fontSize = '0';
                                }
                            }
                        });
                    }
                });
            });
            
            // Mulai observe tile pane untuk perubahan DOM
            map.whenReady(function() {
                const tilePane = document.querySelector('.leaflet-tile-pane');
                if (tilePane) {
                    errorTextObserver.observe(tilePane, {
                        childList: true,
                        subtree: true,
                        characterData: true
                    });
                }
            });
            
            // Juga observe saat map di-update
            map.on('moveend', function() {
                setTimeout(removeErrorTextNodes, 200);
            });
            
            map.on('zoomend', function() {
                setTimeout(removeErrorTextNodes, 200);
            });
            
            // Add layers
            networkMarkersLayer.addTo(map); 
            customerMarkersLayer.addTo(map); 
            linesLayer.addTo(map);
            
            // ── Hybrid = citra satelit + JALAN ──
            // DULU: overlay `voyager_only_labels`. Diukur di area layanan (Tanjungharjo, z16/17/18)
            // ubinnya HANYA 116 byte = PNG kosong — jadi hybrid tak pernah menggambar apa pun, tak ada
            // jalan MAUPUN nama jalan. Lapisan referensi Esri (World_Transportation /
            // World_Boundaries_and_Places) juga kosong di sini (872 byte). Tak ada satu pun overlay
            // "jalan-saja" gratis yang punya data di pedesaan ini.
            //
            // SOLUSINYA: pakai peta OSM UTUH (jalan+nama+sungai, 8–17 KB di sini = jelas berisi) tapi
            // dipasang di pane sendiri dengan `mix-blend-mode: multiply` → latar putih OSM hilang
            // (putih × X = X) dan yang tersisa hanya garis gelap jalan + teksnya di atas citra.
            // Dibandingkan visual dgn opacity polos: opacity membuat citra pudar keabu-abuan,
            // multiply mempertahankan warna citra.
            //
            // Blend dipasang di PANE, bukan di `.leaflet-tile` — `admin-theme.css` mengunci
            // `.leaflet-tile { mix-blend-mode: normal !important }` untuk mode gelap.
            map.createPane('hybridRoads');
            const hybridRoadsPane = map.getPane('hybridRoads');
            hybridRoadsPane.style.zIndex = 250; // di atas tilePane (200), di bawah overlayPane (400)
            hybridRoadsPane.style.mixBlendMode = 'multiply';
            hybridRoadsPane.style.pointerEvents = 'none';

            const hybridLabelsLayer = L.tileLayer(
                'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                {
                    maxZoom: satelliteMaxZoom, maxNativeZoom: 18,
                    opacity: 0.9,
                    pane: 'hybridRoads',
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                }
            );
            const hybridLayer = L.layerGroup([
                L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                    maxZoom: satelliteMaxZoom, maxNativeZoom: 18, attribution: 'Tiles &copy; Esri'
                }),
                hybridLabelsLayer
            ]);

            // Add layer control
            const baseMaps = { "Hybrid": hybridLayer, "Satelit": satelliteLayer, "OpenStreetMap": osmLayer };
            const overlayMaps = {
                "Aset Jaringan": networkMarkersLayer,
                "Pelanggan": customerMarkersLayer,
                "Koneksi Antar Aset": linesLayer
            };
            L.control.layers(baseMaps, overlayMaps, {collapsed: true}).addTo(map);

            // Add GPS control - simplified like teknisi
            const GpsMapControl = L.Control.extend({
                options: { position: 'topleft'},
                onAdd: function(mapInstanceCtrl) {
                    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom-gps');
                    const iconHTML = '<i class="fas fa-crosshairs"></i>';
                    const loadingIconHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    container.innerHTML = iconHTML; 
                    container.title = 'Lokasi Saya';
                    
                    L.DomEvent.on(container, 'click', L.DomEvent.stopPropagation)
                        .on(container, 'click', L.DomEvent.preventDefault)
                        .on(container, 'click', function () {
                            container.innerHTML = loadingIconHTML; 
                            displayGlobalMapMessage("Meminta lokasi GPS...", "info", 3000);
                            if (navigator.geolocation) {
                                navigator.geolocation.getCurrentPosition(
                                    (pos) => processSuccessfulGeolocationMapViewer(pos, "GPS Peta", displayGlobalMapMessage, map, container, iconHTML),
                                    (err) => { 
                                        handleGeolocationErrorMapViewer(err, "GPS Gagal", displayGlobalMapMessage); 
                                        container.innerHTML = iconHTML; 
                                    },
                                    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
                                );
                            } else { 
                                handleGeolocationErrorMapViewer({code: -1, message: "Geolokasi tidak didukung."}, "GPS Gagal", displayGlobalMapMessage); 
                                container.innerHTML = iconHTML; 
                            }
                        });
                    return container;
                }
            });
            if (map) new GpsMapControl().addTo(map);

            // Setup Advanced Legend
            setupAdvancedLegend();
            
            // Event listeners - exactly like teknisi
            map.on('baselayerchange', e => {
                const newMaxZoom = (e.name === "Satelit" || e.name === "Hybrid") ? satelliteMaxZoom : osmMaxZoom;
                map.options.maxZoom = newMaxZoom;
                // Pastikan zoom tidak melebihi maxZoom yang didukung
                if (map.getZoom() > newMaxZoom) {
                    map.setZoom(newMaxZoom);
                }
                // Update maxNativeZoom untuk layer yang aktif
                const activeLayer = e.layer;
                if (activeLayer && activeLayer.options) {
                    if (e.name === "Satelit" && activeLayer.options.maxNativeZoom) {
                        // Pastikan maxNativeZoom tidak melebihi kemampuan tile server
                        activeLayer.options.maxNativeZoom = 18;
                    }
                }
            });
            
            map.on('fullscreenchange', () => { 
                $('#manualFullscreenBtn i').toggleClass('fa-expand fa-compress'); 
                if(map) map.invalidateSize(); 
                // Hapus error text setelah fullscreen change
                setTimeout(removeErrorTextNodes, 300);
            });
            
            // Hapus error text secara berkala untuk memastikan tidak ada yang terlewat
            setInterval(removeErrorTextNodes, 1000); // Setiap 1 detik
            
            document.addEventListener('fullscreenchange', handleFullscreenGlobal);
            document.addEventListener('webkitfullscreenchange', handleFullscreenGlobal);
            document.addEventListener('mozfullscreenchange', handleFullscreenGlobal);
            document.addEventListener('MSFullscreenChange', handleFullscreenGlobal);

            
            // Load map data
            loadAllMapData();
        }
        
        /**
         * Redraws markers of a specific type by updating their icons AND tooltip visibility.
         * This is called when label visibility changes.
         * @param {string} markerType - 'odc', 'odp', or 'customer'.
         */
function redrawMarkers(markerType) {
    let markersToRedraw = [];
    if(markerType === 'odc') {
        markersToRedraw = odcMarkers;
    } else if (markerType === 'odp') {
        markersToRedraw = odpMarkers;
    } else if (markerType === 'customer') {
        markersToRedraw = customerMarkers;
    }

    const currentLabelVisibility = labelVisibility[markerType];

    markersToRedraw.forEach(marker => {
        if(marker && marker.options && typeof marker.setIcon === 'function') {
            // Update icon (which is now just the base icon)
            if (marker.assetData) {
                marker.setIcon(createAssetIcon(marker.assetData));
                
                // Set tooltip content and visibility for asset
                if (marker.assetData.name) {
                    if (!marker.getTooltip()) {
                        marker.bindTooltip(marker.assetData.name, {
                            permanent: true,
                            direction: 'top',
                            className: 'marker-label-tooltip',
                            offset: [0, -ICON_HEIGHT/2 - 5]
                        });
                    } else {
                        marker.getTooltip().setContent(marker.assetData.name);
                    }
                    
                    // Kontrol visibilitas tooltip tanpa mempengaruhi posisi marker
                    if (currentLabelVisibility) {
                        marker.getTooltip().setOpacity(1);
                    } else {
                        marker.getTooltip().setOpacity(0);
                    }
                }
            } else if (marker.customerData) {
                // Update icon for customer
                marker.setIcon(createCustomerStatusIcon(marker.customerOnlineStatus));
                
                // Set tooltip content and visibility for customer
                let customerLabel = marker.customerData.pppoe_username || marker.customerData.name || `Cust. ID ${marker.customerData.id}`;
                if (!marker.getTooltip()) {
                    marker.bindTooltip(customerLabel, {
                        permanent: true,
                        direction: 'top',
                        className: 'marker-label-tooltip',
                        offset: [0, -ICON_HEIGHT/2 - 5]
                    });
                } else {
                    marker.getTooltip().setContent(customerLabel);
                }
                
                // Kontrol visibilitas tooltip tanpa mempengaruhi posisi marker
                if (currentLabelVisibility) {
                    marker.getTooltip().setOpacity(1);
                } else {
                    marker.getTooltip().setOpacity(0);
                }
            }
        }
    });
}

        // Store original parent of modals
        let modalOriginalParents = new Map();
        
        function moveModalsToFullscreen() {
            // Find all modals
            const modals = document.querySelectorAll('.modal');
            const mapContainer = document.getElementById('mapContainer');
            
            modals.forEach(modal => {
                // Store original parent
                modalOriginalParents.set(modal, modal.parentNode);
                // Move modal into mapContainer
                mapContainer.appendChild(modal);
            });
        }
        
        function restoreModalsPosition() {
            // Restore modals to original position
            modalOriginalParents.forEach((parent, modal) => {
                parent.appendChild(modal);
            });
            modalOriginalParents.clear();
        }

        function toggleFullScreenManual() {
            const mapContainer = document.getElementById('mapContainer');
            
            if (!document.fullscreenElement && !document.mozFullScreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
                // Move modals into mapContainer before going fullscreen
                moveModalsToFullscreen();
                
                if (mapContainer.requestFullscreen) {
                    mapContainer.requestFullscreen().catch(err => {
                        console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
                        restoreModalsPosition(); // Restore if fullscreen fails
                    });
                } else if (mapContainer.mozRequestFullScreen) { /* Firefox */
                    mapContainer.mozRequestFullScreen();
                } else if (mapContainer.webkitRequestFullscreen) { /* Chrome, Safari and Opera */
                    mapContainer.webkitRequestFullscreen();
                } else if (mapContainer.msRequestFullscreen) { /* IE/Edge */
                    mapContainer.msRequestFullscreen();
                }
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                } else if (document.mozCancelFullScreen) { /* Firefox */
                    document.mozCancelFullScreen();
                } else if (document.webkitExitFullscreen) { /* Chrome, Safari and Opera */
                    document.webkitExitFullscreen();
                } else if (document.msExitFullscreen) { /* IE/Edge */
                    document.msExitFullscreen();
                }
            }
        }

        function handleFullscreenGlobal() {
            const isActuallyFullscreen = !!(document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
            $('#manualFullscreenBtn i').toggleClass('fa-expand', !isActuallyFullscreen).toggleClass('fa-compress', isActuallyFullscreen);
            $('#manualFullscreenBtn').attr('title', isActuallyFullscreen ? 'Keluar Layar Penuh (Kustom)' : 'Layar Penuh Peta (Kustom)');
            if (map) { setTimeout(function() { map.invalidateSize(); }, 250); }
            // Restore modals when EXITING fullscreen (not entering)
            if (!isActuallyFullscreen) {
                restoreModalsPosition();
            }
        }

        function updateSelectAllCheckbox(type, totalItems, selectedItems) {
            const selectAllCb = $(`#selectAll${type}`);
            if (totalItems > 0 && selectedItems === totalItems) {
                selectAllCb.prop('checked', true).prop('indeterminate', false);
            } else if (selectedItems === 0 || totalItems === 0) {
                selectAllCb.prop('checked', false).prop('indeterminate', false);
            } else {
                selectAllCb.prop('checked', false).prop('indeterminate', true);
            }
        }

        function openCustomFilterModalWithCurrentSelections() {
            console.log("[OpenCustomFilterModal] Populating modal based on current map filter state...");
            $('#searchOdcFilter').val('').trigger('keyup');
            $('#searchOdpFilter').val('').trigger('keyup');
            $('#searchCustomerFilter').val('').trigger('keyup');

            const odcListElement = $('#odcFilterList');
            const allOdcsFromData = allNetworkAssetsData.filter(a => a.type === 'ODC').sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            odcListElement.empty();
            allOdcsFromData.forEach(odc => {
                const isChecked = isInitialLoad ? true : selectedOdcIds.has(String(odc.id));
                odcListElement.append(
                    `<li class="list-group-item">
                        <label><input type="checkbox" class="filter-item-checkbox" data-type="odc" data-id="${odc.id}" ${isChecked ? 'checked' : ''}> ${odc.name || `ODC ID ${odc.id}`}</label>
                    </li>`
                );
            });
            updateSelectAllCheckbox('Odc', allOdcsFromData.length, odcListElement.find('.filter-item-checkbox:checked').length);

            updateOdpFilterListFromModal(isInitialLoad);
            $('#customFilterModal').modal('show');
        }

        function updateOdpFilterListFromModal(checkAllChildrenIfParentIsAll = false) {
            const currentlySelectedOdcIdsInModal = new Set();
            $('#odcFilterList .filter-item-checkbox:checked').each(function() {
                currentlySelectedOdcIdsInModal.add($(this).data('id').toString());
            });

            const odpListElement = $('#odpFilterList');
            odpListElement.empty();
            $('#searchOdpFilter').val('').trigger('keyup');

            if (currentlySelectedOdcIdsInModal.size === 0) {
                odpListElement.append('<li class="list-group-item text-muted small">Pilih ODC untuk melihat daftar ODP terkait.</li>');
                updateSelectAllCheckbox('Odp', 0, 0);
                updateCustomerFilterListFromModal(false);
                return;
            }

            const relevantOdps = allNetworkAssetsData.filter(asset =>
                asset.type === 'ODP' && asset.parent_odc_id && currentlySelectedOdcIdsInModal.has(String(asset.parent_odc_id))
            ).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            relevantOdps.forEach(odp => {
                const isChecked = checkAllChildrenIfParentIsAll ? true : selectedOdpIds.has(String(odp.id));
                odpListElement.append(
                    `<li class="list-group-item">
                        <label><input type="checkbox" class="filter-item-checkbox" data-type="odp" data-id="${odp.id}" ${isChecked ? 'checked' : ''}> ${odp.name || `ODP ID ${odp.id}`}</label>
                    </li>`
                );
            });
            updateSelectAllCheckbox('Odp', relevantOdps.length, odpListElement.find('.filter-item-checkbox:checked').length);
            updateCustomerFilterListFromModal(checkAllChildrenIfParentIsAll);
        }

        function updateCustomerFilterListFromModal(checkAllChildrenIfParentIsAll = false) {
            const currentlySelectedOdpIdsInModal = new Set();
            $('#odpFilterList .filter-item-checkbox:checked').each(function() {
                currentlySelectedOdpIdsInModal.add($(this).data('id').toString());
            });

            const customerListElement = $('#customerFilterList');
            customerListElement.empty();
            $('#searchCustomerFilter').val('').trigger('keyup');

            if (currentlySelectedOdpIdsInModal.size === 0) {
                customerListElement.append('<li class="list-group-item text-muted small">Pilih ODP untuk melihat daftar Pelanggan terkait.</li>');
                updateSelectAllCheckbox('Customer', 0, 0);
                return;
            }

            const relevantCustomers = allCustomerData.filter(customer =>
                customer.connected_odp_id && currentlySelectedOdpIdsInModal.has(String(customer.connected_odp_id))
            ).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            relevantCustomers.forEach(customer => {
                const isChecked = checkAllChildrenIfParentIsAll ? true : selectedCustomerIds.has(String(customer.id));
                customerListElement.append(
                    `<li class="list-group-item">
                        <label><input type="checkbox" class="filter-item-checkbox" data-type="customer" data-id="${customer.id}" ${isChecked ? 'checked' : ''}> ${customer.name || `Cust. ID ${customer.id}`}</label>
                    </li>`
                );
            });
            updateSelectAllCheckbox('Customer', relevantCustomers.length, customerListElement.find('.filter-item-checkbox:checked').length);
        }

        $('#openCustomFilterModalBtn').on('click', openCustomFilterModalWithCurrentSelections);

        $(document).on('change', '#customFilterModal .filter-item-checkbox', function() {
            const type = $(this).data('type');
            if (type === 'odc') {
                updateSelectAllCheckbox('Odc', $('#odcFilterList .filter-item-checkbox').length, $('#odcFilterList .filter-item-checkbox:checked').length);
                updateOdpFilterListFromModal(false);
            } else if (type === 'odp') {
                updateSelectAllCheckbox('Odp', $('#odpFilterList .filter-item-checkbox').length, $('#odpFilterList .filter-item-checkbox:checked').length);
                updateCustomerFilterListFromModal(false);
            } else if (type === 'customer') {
                updateSelectAllCheckbox('Customer', $('#customerFilterList .filter-item-checkbox').length, $('#customerFilterList .filter-item-checkbox:checked').length);
            }
        });

        $(document).on('change', '#selectAllOdc, #selectAllOdp, #selectAllCustomer', function() {
            const type = $(this).attr('id').replace('selectAll', '').toLowerCase();
            const listElement = $(`#${type}FilterList`);
            const isChecked = $(this).is(':checked');

            listElement.find('.filter-item-checkbox').prop('checked', isChecked); 

            if (type === 'odc') {
                updateOdpFilterListFromModal(isChecked);
                updateSelectAllCheckbox('Odc', listElement.find('.filter-item-checkbox').length, isChecked ? listElement.find('.filter-item-checkbox').length : 0);
            } else if (type === 'odp') {
                updateCustomerFilterListFromModal(isChecked);
                updateSelectAllCheckbox('Odp', listElement.find('.filter-item-checkbox').length, isChecked ? listElement.find('.filter-item-checkbox').length : 0);
            } else if (type === 'customer') {
                 updateSelectAllCheckbox('Customer', listElement.find('.filter-item-checkbox').length, isChecked ? listElement.find('.filter-item-checkbox').length : 0);
            }
        });


        $('#applyCustomFilterBtn').on('click', function() {
            console.log("[ApplyCustomFilterBtn] Applying custom filter...");
            selectedOdcIds.clear();
            selectedOdpIds.clear();
            selectedCustomerIds.clear();

            $('#odcFilterList .filter-item-checkbox:checked').each(function() { selectedOdcIds.add($(this).data('id').toString()); });
            $('#odpFilterList .filter-item-checkbox:checked').each(function() { selectedOdpIds.add($(this).data('id').toString()); });
            $('#customerFilterList .filter-item-checkbox:checked').each(function() { selectedCustomerIds.add($(this).data('id').toString()); });

            isInitialLoad = false;
            applyFilters();
            $('#customFilterModal').modal('hide');
            displayGlobalMapMessage('Filter kustom diterapkan.', 'success', 3000);
        });

        $('#resetCustomFilterBtn').on('click', function() {
            $('#odcFilterList .filter-item-checkbox').prop('checked', true);
            updateSelectAllCheckbox('Odc', $('#odcFilterList .filter-item-checkbox').length, $('#odcFilterList .filter-item-checkbox').length);
            updateOdpFilterListFromModal(true);

            displayGlobalMapMessage('Filter direset untuk menampilkan semua. Klik "Terapkan Filter" untuk menyimpan.', 'info', 5000);
        });

        $('.filter-search-input').on('keyup', function() {
            const searchTerm = $(this).val().toLowerCase();
            const listId = $(this).nextAll('.filter-list-column').first().attr('id');
            $(`#${listId} li`).each(function() {
                const itemText = $(this).text().toLowerCase();
                if (itemText.includes(searchTerm)) {
                    $(this).show();
                } else {
                    $(this).hide();
                }
            });
        });

        function applyFilters() {
            if (!map) return;
            const Core = window.MapFilterCore;

            networkMarkersLayer.clearLayers();
            customerMarkersLayer.clearLayers();
            linesLayer.clearLayers();

            // Dikumpulkan supaya GARIS memakai kebenaran yang sama dengan MARKER — dulu garis diuji
            // dengan daftar pilihan saja, jadi bisa tergambar menuju ODP yang sedang disembunyikan.
            const odcTampil = new Set();
            const odpTampil = new Set();
            const pelangganTampil = new Set();

            odcMarkers.forEach(marker => {
                if (!Core.bolehTampilAset(filterState, marker.assetData, selectedOdcIds)) return;
                odcTampil.add(String(marker.assetData.id));
                networkMarkersLayer.addLayer(marker);
                if (marker.getTooltip()) marker.getTooltip().setOpacity(labelVisibility.odc ? 1 : 0);
            });

            odpMarkers.forEach(marker => {
                if (!Core.bolehTampilAset(filterState, marker.assetData, selectedOdpIds)) return;
                odpTampil.add(String(marker.assetData.id));
                networkMarkersLayer.addLayer(marker);
                if (marker.getTooltip()) marker.getTooltip().setOpacity(labelVisibility.odp ? 1 : 0);
            });

            customerMarkers.forEach(marker => {
                const id = String(marker.customerData.id);
                if (!Core.bolehTampilPelanggan(filterState, marker.customerOnlineStatus, id, selectedCustomerIds)) return;
                pelangganTampil.add(id);
                customerMarkersLayer.addLayer(marker);
                if (marker.getTooltip()) marker.getTooltip().setOpacity(labelVisibility.customer ? 1 : 0);
            });

            odpToOdcLines.forEach(line => {
                const e = line.connectedEntities;
                if (e && odcTampil.has(String(e.odcId)) && odpTampil.has(String(e.odpId))) linesLayer.addLayer(line);
            });

            customerToOdpLines.forEach(line => {
                const e = line.connectedEntities;
                if (e && pelangganTampil.has(String(e.customerId)) && odpTampil.has(String(e.odpId))) linesLayer.addLayer(line);
            });

            updateLegendCounters();
            sinkronkanKontrolFilter();
        }

        /** Legenda & tombol quick filter SELALU menggambarkan state, bukan sebaliknya. */
        function sinkronkanKontrolFilter() {
            window.MapFilterCore.KATEGORI.forEach((cat) => {
                const box = document.getElementById(`legend-toggle-${cat}`);
                if (box) box.checked = !!filterState.kategori[cat];
            });
            currentQuickFilter = filterState.quick;
            updateFilterButtons();
        }

        // Apply Quick Filter
        function applyQuickFilter(filter) {
            if (!map) return;

            // Quick Filter kini PRASETEL KATEGORI, bukan penulis daftar pilihan. Dampak terpenting:
            // "Online"/"Offline" tak lagi menghapus ODC/ODP dari peta — dulu memilih Offline membuat
            // boks induknya ikut lenyap, padahal justru pola "3 dari 4 di ODP ini mati" yang dicari.
            window.MapFilterCore.terapkanQuickFilter(filterState, filter);

            applyFilters();
            updateConnectionMonitoring();

            const filterLabels = {
                'all': 'Semua', 'online': 'Online', 'offline': 'Offline',
                'assets': 'Aset Jaringan', 'customers': 'Pelanggan', 'custom': 'Kustom'
            };
            displayGlobalMapMessage(`Filter: ${filterLabels[filterState.quick] || filterState.quick}`, 'info', 2000);
        }

        function updateFilterButtons() {
            $('.quick-filter-btn').removeClass('active');
            $(`.quick-filter-btn[data-filter="${currentQuickFilter}"]`).addClass('active');
        }
        
        // Setup Advanced Legend
        function setupAdvancedLegend() {
            if (!map) return;
            
            // Remove existing legend if any
            if (advancedLegendControl) {
                map.removeControl(advancedLegendControl);
            }
            
            // Create advanced legend control
            advancedLegendControl = L.control({ position: 'bottomright' });
            
            advancedLegendControl.onAdd = function(mapInstance) {
                const div = L.DomUtil.create('div', 'advanced-legend');
                
                // Header
                const header = L.DomUtil.create('div', 'advanced-legend-header', div);
                const title = L.DomUtil.create('h4', '', header);
                title.textContent = 'Legenda Peta';
                const toggleBtn = L.DomUtil.create('button', 'advanced-legend-toggle-btn', header);
                toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i>';
                toggleBtn.title = 'Sembunyikan/Tampilkan';
                
                // Content container
                const content = L.DomUtil.create('div', 'advanced-legend-content', div);
                content.style.display = 'block';
                
                // Categories
                const categories = [
                    { id: 'odc', name: 'ODC', icon: 'fa-server', color: '#8A2BE2', class: 'legend-category-odc' },
                    { id: 'odp', name: 'ODP', icon: 'fa-network-wired', color: '#FFA500', class: 'legend-category-odp' },
                    { id: 'online', name: 'Pelanggan Online', icon: 'fa-user-alt', color: '#28a745', class: 'legend-category-online' },
                    { id: 'offline', name: 'Pelanggan Offline', icon: 'fa-user-alt', color: '#dc3545', class: 'legend-category-offline' },
                    { id: 'unknown', name: 'Pelanggan (Status Lain)', icon: 'fa-user-alt', color: '#007bff', class: 'legend-category-unknown' }
                ];
                
                categories.forEach(cat => {
                    const categoryDiv = L.DomUtil.create('div', `legend-category ${cat.class}`, content);
                    
                    const categoryHeader = L.DomUtil.create('div', 'legend-category-header', categoryDiv);
                    const label = L.DomUtil.create('div', 'legend-category-label', categoryHeader);
                    const icon = L.DomUtil.create('i', `fas ${cat.icon} legend-category-icon`, label);
                    icon.style.color = cat.color;
                    const name = L.DomUtil.create('span', '', label);
                    name.textContent = cat.name;
                    
                    const counter = L.DomUtil.create('span', 'legend-category-counter', categoryHeader);
                    counter.id = `legend-counter-${cat.id}`;
                    counter.textContent = '0';
                    
                    const toggle = L.DomUtil.create('div', 'legend-category-toggle', categoryDiv);
                    const checkbox = L.DomUtil.create('input', '', toggle);
                    checkbox.type = 'checkbox';
                    checkbox.id = `legend-toggle-${cat.id}`;
                    checkbox.checked = true;
                    checkbox.dataset.category = cat.id;
                    
                    const checkboxLabel = L.DomUtil.create('label', '', toggle);
                    checkboxLabel.htmlFor = `legend-toggle-${cat.id}`;
                    checkboxLabel.textContent = 'Tampilkan';
                    
                    // Event listener untuk toggle
                    checkbox.addEventListener('change', function() {
                        toggleLayerVisibility(cat.id, this.checked);
                    });
                });
                
                // Mini Map Container
                const minimapContainer = L.DomUtil.create('div', 'legend-minimap-container', content);
                const minimapLabel = L.DomUtil.create('div', 'text-xs font-weight-bold text-uppercase mb-2', minimapContainer);
                minimapLabel.textContent = 'Overview';
                const minimapDiv = L.DomUtil.create('div', 'legend-minimap', minimapContainer);
                minimapDiv.id = 'legendMinimap';
                
                // Tools Section
                const toolsContainer = L.DomUtil.create('div', 'legend-tools', content);
                const toolsLabel = L.DomUtil.create('div', 'text-xs font-weight-bold text-uppercase mb-2', toolsContainer);
                toolsLabel.textContent = 'Tools';
                const resetViewBtn = L.DomUtil.create('button', 'btn btn-sm btn-outline-secondary legend-tools-btn', toolsContainer);
                resetViewBtn.innerHTML = '<i class="fas fa-home"></i> Reset View';
                resetViewBtn.title = 'Kembali ke view default';
                resetViewBtn.addEventListener('click', function() {
                    if (map) {
                        map.setView([-7.2430309, 111.846867], 15);
                    }
                });
                
                // Toggle collapse/expand
                let isCollapsed = false;
                toggleBtn.addEventListener('click', function() {
                    isCollapsed = !isCollapsed;
                    content.style.display = isCollapsed ? 'none' : 'block';
                    toggleBtn.innerHTML = isCollapsed ? '<i class="fas fa-chevron-down"></i>' : '<i class="fas fa-chevron-up"></i>';
                });
                
                // Initialize mini map
                setTimeout(() => {
                    initLegendMinimap();
                }, 500);
                
                // Prevent map clicks from propagating
                L.DomEvent.disableClickPropagation(div);
                L.DomEvent.disableScrollPropagation(div);
                
                return div;
            };
            
            advancedLegendControl.addTo(map);
            updateLegendCounters();
        }
        
        function toggleLayerVisibility(category, visible) {
            if (!map) return;
            // DULU: menambah/menghapus marker langsung dari layer tanpa mencatat apa pun, sehingga
            // pilihan ini hilang senyap pada refresh berikutnya. SEKARANG: menulis ke state bersama
            // lalu peta digambar ulang — hasilnya bertahan melewati auto-refresh & quick filter.
            window.MapFilterCore.setelKategori(filterState, category, visible);
            applyFilters();
        }

        function updateLegendCounters() {
            legendCounters.odc = odcMarkers.length;
            legendCounters.odp = odpMarkers.length;
            
            let online = 0, offline = 0, unknown = 0;
            customerMarkers.forEach(marker => {
                const status = marker.customerOnlineStatus || 'unknown';
                if (status === 'online') online++;
                else if (status === 'offline') offline++;
                else unknown++;
            });
            legendCounters.online = online;
            legendCounters.offline = offline;
            legendCounters.unknown = unknown;
            
            // Update counter displays
            const odcCounter = document.getElementById('legend-counter-odc');
            const odpCounter = document.getElementById('legend-counter-odp');
            const onlineCounter = document.getElementById('legend-counter-online');
            const offlineCounter = document.getElementById('legend-counter-offline');
            const unknownCounter = document.getElementById('legend-counter-unknown');
            
            if (odcCounter) odcCounter.textContent = legendCounters.odc;
            if (odpCounter) odpCounter.textContent = legendCounters.odp;
            if (onlineCounter) onlineCounter.textContent = legendCounters.online;
            if (offlineCounter) offlineCounter.textContent = legendCounters.offline;
            if (unknownCounter) unknownCounter.textContent = legendCounters.unknown;
        }
        
        function initLegendMinimap() {
            const minimapDiv = document.getElementById('legendMinimap');
            if (!minimapDiv || !map) return;
            
            try {
                // Create mini map
                legendMinimap = L.map('legendMinimap', {
                    zoomControl: false,
                    attributionControl: false,
                    dragging: false,
                    touchZoom: false,
                    doubleClickZoom: false,
                    scrollWheelZoom: false,
                    boxZoom: false,
                    keyboard: false
                });
                
                // Add tile layer
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 13,
                    attribution: ''
                }).addTo(legendMinimap);
                
                // Sync with main map
                map.on('moveend', function() {
                    if (legendMinimap) {
                        legendMinimap.setView(map.getCenter(), Math.min(map.getZoom(), 13));
                    }
                });
                
                map.on('zoomend', function() {
                    if (legendMinimap) {
                        legendMinimap.setView(map.getCenter(), Math.min(map.getZoom(), 13));
                    }
                });
                
                // Set initial view
                legendMinimap.setView(map.getCenter(), Math.min(map.getZoom(), 13));
                
                // Add rectangle to show main map bounds
                const updateBounds = function() {
                    if (legendMinimap && map) {
                        const bounds = map.getBounds();
                        if (legendMinimap._boundsRectangle) {
                            legendMinimap.removeLayer(legendMinimap._boundsRectangle);
                        }
                        legendMinimap._boundsRectangle = L.rectangle(bounds, {
                            color: '#ff7800',
                            weight: 2,
                            fill: false
                        }).addTo(legendMinimap);
                    }
                };
                
                map.on('moveend', updateBounds);
                map.on('zoomend', updateBounds);
                updateBounds();
                
            } catch (error) {
                console.error('[Legend] Error initializing mini map:', error);
            }
        }

        // MODIFIED: populateParentOdcDropdown to include capacity and disable full ODCs
        function populateParentOdcDropdown(selectedParentId = null) {
            const select = $('#assetParentOdc');
            const currentValue = selectedParentId || select.val();
            select.empty().append('<option value="">-- Tidak ada / ODC Induk --</option>');

            const odcsForDropdown = allNetworkAssetsData.filter(a => a.type === 'ODC');

            if(odcsForDropdown && odcsForDropdown.length > 0){
                odcsForDropdown.sort((a,b) => (a.name || '').localeCompare(b.name || '')).forEach(odc => {
                    const odcCapacity = parseInt(odc.capacity_ports) || 0;
                    const portsUsed = parseInt(odc.ports_used) || 0; // ODC ports_used counts connected ODPs
                    const isFull = (odcCapacity > 0 && portsUsed >= odcCapacity);

                    // Check if the current ODP being edited is already connected to this ODC
                    const isCurrentOdcForEditedOdp = (selectedParentId !== null && String(odc.id) === String(selectedParentId));

                    let displayText = `${odc.name} (ID: ${odc.id}) - ODP: ${portsUsed}/${odcCapacity || 'N/A'}`;
                    if (isFull && !isCurrentOdcForEditedOdp) {
                        displayText += ' (PENUH)';
                    } else if (isCurrentOdcForEditedOdp && isFull) {
                        displayText += ' (Sedang Digunakan - PENUH)'; // Clarify for the current ODP
                    }

                    const option = new Option(displayText, odc.id);
                    if (isFull && !isCurrentOdcForEditedOdp) {
                        option.disabled = true;
                    }
                    select.append(option);
                });
            }
            if(currentValue && select.find(`option[value="${currentValue}"]`).length > 0) {
                 select.val(currentValue);
            } else {
                 select.val("");
            }
            if (select.hasClass("select2-hidden-accessible")) {
                 select.trigger('change.select2');
            }
        }

        $('#assetType').on('change', function() {
            const type = $(this).val();
            const isNewAsset = !$('#assetId').val();
            $('#odcPortsUsedLabelInfo').hide();
            $('#odpPortsUsedLabelInfo').hide();

            if (type === 'ODP') {
                $('#parentOdcGroup').slideDown();
                // Pass current parent ID if editing an ODP to ensure its current ODC option isn't disabled due to being "full"
                populateParentOdcDropdown($('#assetParentOdc').data('current-odp-parent') || null);
                $('#assetPortsUsed').prop('readonly', true).attr('placeholder', 'Otomatis');
                $('#odpPortsUsedLabelInfo').show();
                if (isNewAsset) {
                    $('#assetPortsUsed').val('');
                }
            } else { // ODC
                $('#parentOdcGroup').slideUp();
                $('#assetPortsUsed').prop('readonly', true).attr('placeholder', 'Otomatis');
                $('#odcPortsUsedLabelInfo').show();
                 if (isNewAsset) {
                     $('#assetPortsUsed').val('');
                }
            }
        });

        $('#useParentOdcLocation').on('change', function() {
            if ($(this).is(':checked')) {
                const parentOdcId = $('#assetParentOdc').val();
                if (parentOdcId) {
                    const selectedOdc = allNetworkAssetsData.find(odc => odc.type === 'ODC' && odc.id == parentOdcId);
                    if (selectedOdc) {
                        const lat = parseFloat(selectedOdc.latitude).toFixed(5);
                        const lng = parseFloat(selectedOdc.longitude).toFixed(5);
                        $('#assetLatitude').val(lat).prop('readonly', true);
                        $('#assetLongitude').val(lng).prop('readonly', true);
                        if (assetModalMapInstance && assetModalMapMarker) {
                            assetModalMapMarker.setLatLng([lat, lng]);
                            assetModalMapInstance.setView([lat, lng], assetModalMapInstance.getZoom());
                        }
                    }
                } else {
                    displayGlobalMapMessage('Pilih ODC Induk terlebih dahulu untuk menggunakan lokasinya.', 'warning');
                    $(this).prop('checked', false);
                }
            } else {
                $('#assetLatitude').prop('readonly', false);
                $('#assetLongitude').prop('readonly', false);
            }
        });

        // New function for the map inside asset modal
        function initializeAssetModalMap(mapId, latInputId, lngInputId, initialLat, initialLng) {
            if (assetModalMapInstance) { assetModalMapInstance.remove(); assetModalMapInstance = null; }
            if (assetModalMapMarker) { assetModalMapMarker.remove(); assetModalMapMarker = null; }

            const latInput = $(`#${latInputId}`);
            const lngInput = $(`#${lngInputId}`);

            const defaultLat = -7.24139; // Default central location for asset modal map
            const defaultLng = 111.83833;
            const defaultZoom = 15;

            const viewLat = (initialLat && !isNaN(parseFloat(initialLat))) ? parseFloat(initialLat) : defaultLat;
            const viewLng = (initialLng && !isNaN(parseFloat(initialLng))) ? parseFloat(initialLng) : defaultLng;
            // Pastikan viewZoom tidak melebihi maxZoom (18 untuk satellite)
            const calculatedZoom = (initialLat && initialLng && !isNaN(parseFloat(initialLat)) && !isNaN(parseFloat(initialLng))) ? 18 : defaultZoom;
            const viewZoom = Math.min(calculatedZoom, 18); // Maksimal 18 untuk mencegah error

            const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 22,
                attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            });
            const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: 18,
                maxNativeZoom: 18, // Esri World Imagery hanya support sampai level 18
                attribution: 'Tiles &copy; Esri',
                errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' // Transparent 1x1 pixel
            });

            assetModalMapInstance = L.map(mapId, {
                layers: [satelliteLayer], // Default layer
                maxZoom: 18 // Sesuaikan dengan maxZoom satellite layer
            }).setView([viewLat, viewLng], viewZoom);

            const baseMaps = { "Satelit": satelliteLayer, "OpenStreetMap": osmLayer };
            L.control.layers(baseMaps, null, { collapsed: true, position: 'topright' }).addTo(assetModalMapInstance);
            
            // Handle baselayerchange untuk asset modal map
            assetModalMapInstance.on('baselayerchange', function(e) {
                const newMaxZoom = e.name === "Satelit" ? 18 : 22;
                assetModalMapInstance.options.maxZoom = newMaxZoom;
                if (assetModalMapInstance.getZoom() > newMaxZoom) {
                    assetModalMapInstance.setZoom(newMaxZoom);
                }
            });

            function updateMarkerAndInputs(latlng, setView = false) {
                latInput.val(latlng.lat.toFixed(5));
                lngInput.val(latlng.lng.toFixed(5));
                if (!assetModalMapMarker) {
                    assetModalMapMarker = L.marker(latlng, { draggable: true }).addTo(assetModalMapInstance);
                    assetModalMapMarker.on('dragend', function (event) {
                        const pos = event.target.getLatLng();
                        latInput.val(pos.lat.toFixed(5));
                        lngInput.val(pos.lng.toFixed(5));
                    });
                } else {
                    assetModalMapMarker.setLatLng(latlng);
                }
                if (setView) {
                    assetModalMapInstance.setView(latlng, Math.max(assetModalMapInstance.getZoom(), 16));
                }
            }

            if (initialLat != null && initialLng != null && !isNaN(parseFloat(initialLat)) && !isNaN(parseFloat(initialLng))) {
                 updateMarkerAndInputs(L.latLng(parseFloat(initialLat), parseFloat(initialLng)), false);
            }

            const GpsControl = L.Control.extend({
                options: { position: 'topleft' },
                onAdd: function (mapCtrl) {
                    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom-gps');
                    const originalIconHTML = '<i class="fas fa-map-marker-alt"></i>';
                    const loadingIconHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    container.innerHTML = originalIconHTML;
                    container.title = 'Dapatkan Lokasi GPS Saat Ini';

                    L.DomEvent.on(container, 'click', L.DomEvent.stopPropagation)
                        .on(container, 'click', L.DomEvent.preventDefault)
                        .on(container, 'click', function () {
                            container.innerHTML = loadingIconHTML;
                            // Re-use global map message for consistent display
                            displayGlobalMapMessage("Meminta lokasi GPS Anda...", "info", 3000);
                            if (navigator.geolocation) {
                                navigator.geolocation.getCurrentPosition(
                                    (position) => processSuccessfulGeolocationMapViewer(position, "Tombol GPS Modal", displayGlobalMapMessage, assetModalMapInstance, container, originalIconHTML),
                                    (error) => {
                                        handleGeolocationErrorMapViewer(error, "Gagal dari Tombol GPS Modal", displayGlobalMapMessage);
                                        container.innerHTML = originalIconHTML;
                                    },
                                    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
                                );
                            } else {
                                handleGeolocationErrorMapViewer({code: -1, message: "Browser tidak mendukung geolokasi."}, "Gagal dari Tombol GPS Modal", displayGlobalMapMessage);
                                container.innerHTML = originalIconHTML;
                            }
                        });
                    return container;
                }
            });
            new GpsControl().addTo(assetModalMapInstance);

            assetModalMapInstance.on('click', function (e) {
                updateMarkerAndInputs(e.latlng);
            });
            // Ensure map resizes correctly when modal is shown
            $('#assetModal').off('shown.bs.modal.assetmapfix').on('shown.bs.modal.assetmapfix', function() {
                 setTimeout(function () { if (assetModalMapInstance) assetModalMapInstance.invalidateSize(); }, 10);
            });
             if ($('#assetModal').is(':visible')) {
                 setTimeout(function () { if (assetModalMapInstance) assetModalMapInstance.invalidateSize(); }, 10);
            }
        }


        function openAssetModal(assetData = null, lat, lng) {
            $('#assetForm')[0].reset();
            $('#useParentOdcLocation').prop('checked', false);
            $('#deleteAssetBtn').hide();
            $('#assetLatitude').prop('readonly', false);
            $('#assetLongitude').prop('readonly', false);
            $('#assetId').val('');
            $('#assetParentOdc').data('current-odp-parent', null);
            $('#odcPortsUsedLabelInfo').hide();
            $('#odpPortsUsedLabelInfo').hide();
            $('#assetPortsUsed').val(''); // Clear on open

            let initialLat = lat;
            let initialLng = lng;

            if (assetData && assetData.id) {
                $('#assetModalLabel').text(`Edit Aset: ${assetData.name || assetData.id} (${assetData.type})`);
                $('#assetId').val(assetData.id);
                $('#assetType').val(assetData.type);
                $('#assetName').val(assetData.name);
                $('#assetAddress').val(assetData.address);
                $('#assetLatitude').val(assetData.latitude != null ? parseFloat(assetData.latitude).toFixed(5) : '');
                $('#assetLongitude').val(assetData.longitude != null ? parseFloat(assetData.longitude).toFixed(5) : '');
                $('#assetCapacity').val(assetData.capacity_ports);
                $('#assetNotes').val(assetData.notes);

                let portsUsedForDisplay = assetData.ports_used || 0;
                // Recalculate ports_used for ODPs based on current customer data
                if(assetData.type === 'ODP'){
                    const connectedCustomersToThisOdp = allCustomerData.filter(cust => String(cust.connected_odp_id) === String(assetData.id));
                    portsUsedForDisplay = connectedCustomersToThisOdp.length;
                }
                $('#assetPortsUsed').val(portsUsedForDisplay);


                $('#assetType').trigger('change');

                if (assetData.type === 'ODP') {
                    $('#assetParentOdc').data('current-odp-parent', assetData.parent_odc_id);
                }
                $('#deleteAssetBtn').show();
                initialLat = assetData.latitude;
                initialLng = assetData.longitude;
            } else {
                $('#assetModalLabel').text('Tambah Aset Jaringan Baru');
                $('#assetType').val('ODC').trigger('change');
            }

            // Always re-initialize select2 for the parent ODC dropdown
            if ($('#assetParentOdc').data('select2')) {
                 try { $('#assetParentOdc').select2('destroy'); } catch(e){}
            }
            $('#assetParentOdc').select2({
                theme: "bootstrap",
                dropdownParent: $('#assetModal'),
                placeholder: '-- Pilih ODC Induk --',
                allowClear: true
            });

            // Set parent ODC value and trigger change event to re-populate if necessary
            if (assetData && assetData.type === 'ODP' && assetData.parent_odc_id) {
                $('#assetParentOdc').val(assetData.parent_odc_id).trigger('change.select2');
            } else if (!assetData || assetData.type === 'ODC') {
                 $('#assetParentOdc').val(null).trigger('change.select2');
            }

            // Initialize the mini map within the modal
            initializeAssetModalMap('assetModalMap', 'assetLatitude', 'assetLongitude', initialLat, initialLng);

            $('#assetModal').modal('show');
        }


        $('#assetForm').on('submit', async function(event) {
            event.preventDefault();
            const assetIdFromForm = $('#assetId').val();
            const assetType = $('#assetType').val();
            const name = $('#assetName').val().trim();
            const latitudeVal = $('#assetLatitude').val();
            const longitudeVal = $('#assetLongitude').val();

            if (!name) { displayGlobalMapMessage('Nama aset wajib diisi.', 'warning'); return; }
            if (latitudeVal === '' || longitudeVal === '' || isNaN(parseFloat(latitudeVal)) || isNaN(parseFloat(longitudeVal))) {
                displayGlobalMapMessage('Latitude dan Longitude harus berupa angka yang valid dan tidak boleh kosong.', 'warning'); return;
            }

            const data = {
                type: assetType,
                name: name,
                address: $('#assetAddress').val().trim(),
                latitude: parseFloat(latitudeVal),
                longitude: parseFloat(longitudeVal),
                capacity_ports: parseInt($('#assetCapacity').val()) || null,
                notes: $('#assetNotes').val().trim(),
                parent_odc_id: assetType === 'ODP' ? ($('#assetParentOdc').val() || null) : null
            };
             data.capacity_ports = data.capacity_ports === 0 ? null : data.capacity_ports;


            const url = assetIdFromForm ? `/api/map/network-assets/${assetIdFromForm}` : '/api/map/network-assets';
            const method = assetIdFromForm ? 'PUT' : 'POST';
            const saveButton = $('#saveAssetBtn');
            const originalButtonText = saveButton.html();
            saveButton.prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span> Menyimpan...');

            try {
                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const result = await response.json();

                if (response.ok && (result.status === 200 || result.status === 201)) {
                    $('#assetModal').modal('hide');

                    if (!assetIdFromForm && result.data && result.data.id) {
                        const newAssetId = String(result.data.id);
                        if (result.data.type === 'ODC') selectedOdcIds.add(newAssetId);
                        else if (result.data.type === 'ODP') selectedOdpIds.add(newAssetId);
                    }

                    await loadAllMapData();

                    if (!assetIdFromForm && result.data && result.data.type === 'ODC') {
                        document.getElementById('addOdpAfterOdcMessageText').textContent = `ODC "${result.data.name}" (ID: ${result.data.id}) berhasil disimpan.`;
                        const yesBtn = document.getElementById('yesAddOdpBtn');
                        yesBtn.setAttribute('data-odc-id', result.data.id);
                        yesBtn.setAttribute('data-lat', result.data.latitude);
                        yesBtn.setAttribute('data-lng', result.data.longitude);
                        $('#addOdpAfterOdcModal').modal('show');
                    } else {
                        displayGlobalMapMessage(result.message, 'success');
                    }
                } else {
                    displayGlobalMapMessage(`Error Simpan: ${result.message || `Gagal menyimpan aset (Status: ${response.status})`}`, 'danger');
                }
            } catch (error) {
                console.error("[AssetFormSubmit] Error saving asset:", error);
                displayGlobalMapMessage('Kesalahan koneksi atau format respons tidak valid saat menyimpan aset.', 'danger');
            } finally {
                saveButton.prop('disabled', false).html(originalButtonText);
            }
        });

        $('#deleteAssetBtn').on('click', async function() {
            const assetId = $('#assetId').val();
            const assetType = $('#assetType').val();
            const originalButtonText = $(this).html();
            if (!assetId) {
                displayGlobalMapMessage('ID Aset tidak ditemukan untuk dihapus.', 'warning'); return;
            }
            if (confirm(`Apakah Anda yakin ingin menghapus aset ini (ID: ${assetId})? Jika ini ODC, ODP yang terhubung tidak akan otomatis terhapus namun relasinya akan hilang. Tindakan ini tidak dapat dibatalkan.`)) {
                const deleteButton = $(this);
                deleteButton.prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span> Menghapus...');
                try {
                    const response = await fetch(`/api/map/network-assets/${assetId}`, { method: 'DELETE' });
                    const result = await response.json();
                    if (response.ok && result.status === 200) {
                        displayGlobalMapMessage(result.message, 'success');
                        $('#assetModal').modal('hide');
                        if (assetType === 'ODC') selectedOdcIds.delete(String(assetId));
                        else if (assetType === 'ODP') selectedOdpIds.delete(String(assetId));
                        loadAllMapData();
                    } else {
                        displayGlobalMapMessage(result.message || `Gagal menghapus aset (Status: ${response.status})`, 'danger');
                    }
                } catch (error) {
                    console.error("[DeleteAsset] Error deleting asset:", error);
                    displayGlobalMapMessage('Terjadi kesalahan koneksi saat menghapus aset.', 'danger');
                } finally {
                    deleteButton.prop('disabled', false).html(originalButtonText);
                }
            }
        });

        $('#assetModal').on('hidden.bs.modal', function () {
             // Destroy the mini map instance when the modal is hidden
            if (assetModalMapInstance) {
                assetModalMapInstance.remove();
                assetModalMapInstance = null;
                assetModalMapMarker = null;
            }
        });

        async function fetchAllCustomerData() {
            console.log("[fetchAllCustomerData] Memulai pemuatan data pelanggan...");
            try {
                const response = await fetch('/api/users?_=${new Date().getTime()}', { credentials: 'include' });
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error("[fetchAllCustomerData] API Error:", response.status, errorText.substring(0, 200));
                    displayGlobalMapMessage(`Gagal memuat data pelanggan awal: Status ${response.status}.`, 'danger');
                    allCustomerData = [];
                    throw new Error(`API Users error for prefetch: ${response.status}`);
                }
                const result = await response.json();
                if (result.data && Array.isArray(result.data)) {
                    allCustomerData = result.data;
                    console.log("[fetchAllCustomerData] Data pelanggan berhasil dimuat:", allCustomerData.length);
                    return true;
                } else {
                    console.warn("[fetchAllCustomerData] Format API pelanggan salah atau tidak ada data. Result:", result);
                    allCustomerData = [];
                    return false;
                }
            } catch (error) {
                console.error("[fetchAllCustomerData] Kesalahan saat mengambil data pelanggan:", error);
                displayGlobalMapMessage("Kesalahan koneksi saat mengambil data pelanggan awal. Cek konsol.", 'danger');
                allCustomerData = [];
                throw error;
            }
        }
        
        async function fetchAllNetworkAssets() {
            console.log("[fetchAllNetworkAssets] Memulai pemuatan data aset jaringan...");
            try {
                const response = await fetch('/api/map/network-assets?_=${new Date().getTime()}', { credentials: 'include' });
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error("[fetchAllNetworkAssets] API Error:", response.status, errorText.substring(0, 500));
                    displayGlobalMapMessage(`Gagal memuat data aset jaringan awal: Status ${response.status}.`, 'danger');
                    allNetworkAssetsData = [];
                    throw new Error(`API Network Assets error: ${response.status}`);
                }
                const result = await response.json();
                if (result.status === 200 && Array.isArray(result.data)) {
                    allNetworkAssetsData = result.data;
                    console.log("[fetchAllNetworkAssets] Data aset jaringan berhasil dimuat:", allNetworkAssetsData.length);
                    return true;
                } else {
                    console.warn("[fetchAllNetworkAssets] Format API aset salah atau tidak ada data. Result:", result);
                    allNetworkAssetsData = [];
                    return false;
                }
            } catch (error) {
                console.error("[fetchAllNetworkAssets] Kesalahan saat mengambil data aset jaringan:", error);
                displayGlobalMapMessage("Kesalahan koneksi saat mengambil data aset jaringan. Cek konsol.", 'danger');
                allNetworkAssetsData = [];
                throw error;
            }
        }


        async function loadAllMapData() {
            console.log("[loadAllMapData] Memulai pemuatan semua data peta...");
            const initialMessageDiv = $('#globalMessageMap .alert-info');
            if (!initialMessageDiv.hasClass('alert-danger') && !initialMessageDiv.hasClass('alert-warning')) {
                displayGlobalMapMessage("Memuat data peta, mohon tunggu...", "info", 20000);
            }

            odcMarkers = []; 
            odpMarkers = [];
            customerMarkers = [];
            odpToOdcLines = [];
            customerToOdpLines = [];


            let networkLoadedSuccessfully = false;
            let customerDataFetchedSuccessfully = false;
            let markersProcessedSuccessfully = false;
            let pppoeStatusLoadedSuccessfully = false;

            try {
                // Jalur manual dimuat SEKALI di depan — sesudah ini penggambaran garis tak menyentuh
                // jaringan lagi (dulu: satu permintaan per koneksi, berurutan, tiap peta dibuka).
                await preloadManualRoutes();

                await fetchActivePppoeUsers();
                pppoeStatusLoadedSuccessfully = !initialPppoeLoadFailed;

                await fetchAllCustomerData();
                customerDataFetchedSuccessfully = true;

                await fetchAllNetworkAssets();
                networkLoadedSuccessfully = true;

                if (networkLoadedSuccessfully && customerDataFetchedSuccessfully) {
                    await loadNetworkAssetMarkers();
                    await loadCustomerMarkers();
                    markersProcessedSuccessfully = true;
                    // Update sidebar stats
                    updateQuickStats();
                }

            } catch (error) {
                console.error("[loadAllMapData] Gagal selama fase pemuatan atau pemrosesan data:", error);
            }


            if (isInitialLoad) {
                console.log("[loadAllMapData] Initial load, selecting all items for filter sets.");
                selectedOdcIds.clear();
                selectedOdpIds.clear();
                selectedCustomerIds.clear();
                allNetworkAssetsData.forEach(asset => {
                    if (asset.type === 'ODC') selectedOdcIds.add(String(asset.id));
                    else if (asset.type === 'ODP') selectedOdpIds.add(String(asset.id));
                });
                allCustomerData.forEach(customer => selectedCustomerIds.add(String(customer.id)));
                // Mark initial load complete
                isInitialLoad = false;
            }
            
            // Call applyFilters *after* all marker arrays are populated
            applyFilters(); // Apply filters to actually add markers to layers

            const currentMessageDiv = $('#globalMessageMap .alert');
            if (networkLoadedSuccessfully && customerDataFetchedSuccessfully && markersProcessedSuccessfully) {
                 if (!pppoeStatusLoadedSuccessfully) {
                    if (!currentMessageDiv.hasClass('alert-danger') && !currentMessageDiv.hasClass('alert-warning')) {
                        displayGlobalMapMessage("Data peta dimuat, status online pelanggan mungkin tidak akurat (gagal ambil data PPPoE).", "warning", 10000);
                    }
                } else if (allNetworkAssetsData.length === 0 && allCustomerData.length === 0) {
                     if (!currentMessageDiv.hasClass('alert-danger') && !currentMessageDiv.hasClass('alert-warning')) {
                        displayGlobalMapMessage("Belum ada data aset jaringan atau pelanggan. Klik peta untuk menambah aset baru.", "info", 10000);
                    }
                } else {
                     if (currentMessageDiv.hasClass('alert-info') && currentMessageDiv.text().includes("Memuat data peta")) {
                         currentMessageDiv.alert('close');
                    }
                }
            } else {
                if (!currentMessageDiv.hasClass('alert-danger') && !currentMessageDiv.hasClass('alert-warning')) {
                     displayGlobalMapMessage("Sebagian data peta gagal dimuat. Beberapa informasi mungkin tidak lengkap atau akurat. Periksa konsol.", "warning", 0);
                }
            }
        }


        async function loadNetworkAssetMarkers() {
            console.log("[loadNetworkAssetMarkers] Memulai pemrosesan marker aset jaringan...");
            try {
                const assets = allNetworkAssetsData;
                allOdcData = assets.filter(asset => asset.type === 'ODC' && asset.latitude != null && asset.longitude != null)
                                   .map(asset => JSON.parse(JSON.stringify(asset)));
                populateParentOdcDropdown();

                const assetsByLocation = new Map();
                assets.forEach(asset => {
                    if (asset.latitude != null && asset.longitude != null) {
                        const locKey = `${parseFloat(asset.latitude).toFixed(5)},${parseFloat(asset.longitude).toFixed(5)}`;
                        if (!assetsByLocation.has(locKey)) assetsByLocation.set(locKey, []);
                        assetsByLocation.get(locKey).push(asset);
                    }
                });


                assets.forEach(asset => {
                    if (asset.latitude != null && asset.longitude != null) {
                        let plotLat = parseFloat(asset.latitude);
                        let plotLng = parseFloat(asset.longitude);
                        if (isNaN(plotLat) || isNaN(plotLng)) { console.warn("Koordinat tidak valid:", asset); return; }

                        const infoOdp = asset.type === 'ODP'
                            ? (() => {
                                const k = kesehatanOdp(asset.id, allCustomerData, activePppoeUsersMap, initialPppoeLoadFailed);
                                return { ...k, hunian: window.MapFilterCore.ringkasHunian(k.anggota.length, asset.capacity_ports) };
                            })()
                            : null;
                        let iconToUse = createAssetIcon(asset, infoOdp);

                        if (asset.type === 'ODP' && asset.parent_odc_id) {
                            const parentOdc = allOdcData.find(o => o.id == asset.parent_odc_id);
                            // Only apply offset if ODP is at the exact same coordinates as its parent ODC
                            if (parentOdc && parentOdc.latitude != null && parentOdc.longitude != null &&
                                Math.abs(parseFloat(parentOdc.latitude) - parseFloat(asset.latitude)) < 0.000001 &&
                                Math.abs(parseFloat(parentOdc.longitude) - parseFloat(asset.longitude)) < 0.000001) {
                                const randomAngle = Math.random() * 2 * Math.PI;
                                const offsetDistance = 0.00003 + (Math.random() * 0.00002); // 3-5 meters offset
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
                                         `<p>Kapasitas: ${asset.capacity_ports || 'N/A'} Port / Status: ${portsUsedDisplay}</p>`;

                        // VONIS DULUAN, daftar belakangan. Yang dicari orang saat membuka popup ODP
                        // bukan daftar nama — melainkan "ini ODP-nya atau bukan".
                        if (infoOdp) {
                            const s = infoOdp.sehat;
                            const kalimat = window.MapFilterCore.ringkasKesehatan(s);
                            const warna = s.curiga ? 'danger' : (s.offline ? 'warning' : 'success');
                            popupContent += `<div class="alert alert-${warna} py-1 px-2 mb-2" style="font-size:0.85em;">`
                                + `<i class="fas ${s.curiga ? 'fa-exclamation-triangle' : 'fa-heartbeat'}"></i> ${kalimat}</div>`;
                        }

                        const originalLocKey = `${parseFloat(asset.latitude).toFixed(5)},${parseFloat(asset.longitude).toFixed(5)}`;
                        const coLocatedAssets = (assetsByLocation.get(originalLocKey) || []).filter(a => a.id !== asset.id);
                        if (coLocatedAssets.length > 0) {
                            popupContent += `<hr class="my-1" style="border-top: 1px dashed #ccc;"><em><small>Juga di lokasi ini:</small></em>`;
                            coLocatedAssets.forEach(other => { popupContent += `<p class="mb-0 ml-2 small">- ${other.type}: ${other.name} (ID: ${other.id})</p>`; });
                        }

                        if (asset.type === 'ODC') {
                            const connectedOdps = allNetworkAssetsData.filter(odp => odp.type === 'ODP' && String(odp.parent_odc_id) === String(asset.id));
                            if (connectedOdps.length > 0) {
                                popupContent += `<hr class="my-1"><p class="mb-1"><strong><i class="fas fa-network-wired"></i> ODP Terhubung (${connectedOdps.length}):</strong></p><ul class="list-unstyled ml-3 mb-1" style="font-size:0.85em;">`;
                                connectedOdps.sort((a,b) => (a.name || '').localeCompare(b.name || '')).forEach(odp => {
                                    const odpConnectedCustomersCount = allCustomerData.filter(cust => String(cust.connected_odp_id) === String(odp.id)).length;
                                    popupContent += `<li>- ${odp.name || `ODP ID ${odp.id}`} (Kap: ${odp.capacity_ports || 'N/A'}, Pakai: ${odpConnectedCustomersCount})</li>`;
                                });
                                popupContent += `</ul>`;
                            } else {
                                popupContent += `<p class="small text-muted mt-1"><em>Tidak ada ODP terhubung ke ODC ini.</em></p>`;
                            }
                        }

                        if (asset.type === 'ODP') {
                            if (asset.parent_odc_id) {
                                const parent = allOdcData.find(o => String(o.id) === String(asset.parent_odc_id));
                                popupContent += `<p>Induk ODC: ${parent ? `${parent.name} (ID: ${asset.parent_odc_id})` : `ID ${asset.parent_odc_id || '-'}`}</p>`;
                                if (parent && parent.latitude != null && parent.longitude != null) {
                                    const dist = haversineDistance({ latitude: parseFloat(asset.latitude), longitude: parseFloat(asset.longitude) }, { latitude: parseFloat(parent.latitude), longitude: parseFloat(parent.longitude) });
                                    if (!isNaN(dist)) popupContent += `<p>Jarak ke ODC Induk: ${dist.toFixed(0)} meter</p>`;

                                    // Panjang JALUR (kalau sudah direkam) — inilah perkiraan kebutuhan
                                    // kabel yang sebenarnya; jarak lurus di atas selalu lebih pendek.
                                    const jalur = manualRouteCache ? manualRouteCache.get(manualRouteKey('odc-odp', parent.id, asset.id)) : null;
                                    if (jalur && jalur.meters) {
                                        popupContent += `<p><i class="fas fa-route text-primary"></i> Jalur kabel terekam: <strong>${jalur.meters} m</strong> (${jalur.points.length} titik)</p>`;
                                    } else {
                                        popupContent += `<p class="text-muted small"><i class="fas fa-route"></i> Jalur kabel belum direkam — WhatsApp: <code>#JALUR ${asset.name || ''}</code></p>`;
                                    }
                                }
                            }
                            // Dari melihat langsung ke MENGABARI: broadcast mode `odp` sudah lama ada di
                            // service, tapi tak ada pintunya dari peta — padahal urutan alaminya persis
                            // begini (lihat ODP merah → kabari penghuninya). Berhenti di layar tulis
                            // pesan, tidak mengirim dari peta.
                            if (infoOdp && infoOdp.anggota.length) {
                                popupContent += `<a href="/broadcast?mode=odp&target=${encodeURIComponent(asset.id)}" `
                                    + `class="btn btn-sm btn-outline-primary btn-block mt-1" style="font-size:0.8em;">`
                                    + `<i class="fas fa-bullhorn"></i> Beri tahu ${infoOdp.anggota.length} pelanggan ODP ini</a>`;
                            }

                            const connectedCustomers = allCustomerData.filter(cust => String(cust.connected_odp_id) === String(asset.id));
                            if (connectedCustomers.length > 0) {
                                popupContent += `<hr class="my-1"><p class="mb-1"><strong><i class="fas fa-users"></i> Pelanggan Terhubung (${connectedCustomers.length}):</strong></p><ul class="list-unstyled ml-3 mb-1" style="font-size:0.85em;">`;
                                // MODIFIED: Display pppoe_username for connected customers
                                connectedCustomers.sort((a,b) => (a.name || '').localeCompare(b.name || '')).forEach(customer => {
                                    let onlineStatus = 'unknown';
                                    if (customer.pppoe_username) onlineStatus = activePppoeUsersMap.has(customer.pppoe_username) ? 'online' : 'offline';
                                    if (initialPppoeLoadFailed && customer.pppoe_username) onlineStatus = 'unknown'; else if (!customer.pppoe_username) onlineStatus = 'offline';
                                    const statusColor = onlineStatus === 'online' ? 'text-success' : (onlineStatus === 'offline' ? 'text-danger' : 'text-muted');
                                    // Use pppoe_username if available, otherwise fallback to customer name
                                    const customerDisplayId = customer.pppoe_username || customer.name || `Cust. ID ${customer.id}`;
                                    popupContent += `<li>- ${customerDisplayId} <span class="${statusColor}" style="font-weight:bold;">(${onlineStatus.charAt(0).toUpperCase() + onlineStatus.slice(1)})</span></li>`;
                                });
                                popupContent += `</ul>`;
                            } else {
                                popupContent += `<p class="small text-muted mt-1"><em>Tidak ada pelanggan terhubung ke ODP ini.</em></p>`;
                            }
                        }

                        popupContent += `<p>Lat: ${parseFloat(asset.latitude).toFixed(5)}, Lng: ${parseFloat(asset.longitude).toFixed(5)}</p>`;
                        if(asset.notes) popupContent += `<p>Catatan: ${asset.notes}</p>`;
                        if(asset.createdBy) popupContent += `<p><small>Dibuat: ${asset.createdBy} (${new Date(asset.createdAt).toLocaleDateString('id-ID', {day:'2-digit',month:'short',year:'numeric'})})</small></p>`;
                        if(asset.updatedBy && asset.updatedAt && asset.createdAt && new Date(asset.updatedAt).getTime() !== new Date(asset.createdAt).getTime()) {
                            popupContent += `<p><small>Diupdate: ${asset.updatedBy} (${new Date(asset.updatedAt).toLocaleDateString('id-ID', {day:'2-digit',month:'short',year:'numeric'})})</small></p>`;
                        }
                        popupContent += `<button class="btn btn-sm btn-primary btn-edit-asset">Edit Aset Ini</button>`;

                        const marker = L.marker([plotLat, plotLng], { icon: iconToUse }).bindPopup(popupContent);
                        marker.assetData = JSON.parse(JSON.stringify(asset));
                        // Bind tooltip for assets (ODC/ODP)
                        if (asset.name) {
                            marker.bindTooltip(asset.name, {
                                permanent: true, // Always show unless hidden by control
                                direction: 'top',
                                className: 'marker-label-tooltip',
                                offset: [0, -ICON_HEIGHT/2 - 5] // Adjust offset to position above icon
                            });
                            // Set initial visibility
                            if (!labelVisibility[asset.type.toLowerCase()]) {
                                marker.getTooltip().setOpacity(0);
                            }
                        }

                        if (asset.type === 'ODC') odcMarkers.push(marker);
                        else if (asset.type === 'ODP') odpMarkers.push(marker);
                    }
                });

                // Create routes from ODP to parent ODC dengan routing helper
                for (const odpMarker of odpMarkers) {
                    const odpAsset = odpMarker.assetData;
                    if (odpAsset.parent_odc_id) {
                        const parentOdcMarker = odcMarkers.find(m => String(m.assetData.id) === String(odpAsset.parent_odc_id));
                        if (parentOdcMarker) {
                            const startLatLng = parentOdcMarker.getLatLng();
                            const endLatLng = odpMarker.getLatLng();
                            
                            // Get routing profile dari config (default: 'driving-car' untuk ODC-ODP)
                            let routingProfile = 'driving-car';
                            if (typeof window !== 'undefined' && window.globalConfig && window.globalConfig.openRouteService) {
                                routingProfile = window.globalConfig.openRouteService.profiles?.odcToOdp || 'driving-car';
                            }
                            
                            // Jalur manual (rekaman lapangan) → routing API → garis lurus "belum dipetakan".
                            const odcOdpRoute = await resolveConnectionRoute(
                                'odc-odp', parentOdcMarker.assetData.id, odpAsset.id,
                                { lat: startLatLng.lat, lng: startLatLng.lng },
                                { lat: endLatLng.lat, lng: endLatLng.lng },
                                { profile: routingProfile }
                            );
                            const routeCoordinates = odcOdpRoute.coordinates;
                            const odcOdpHint = routeStyleHint(odcOdpRoute.source);

                            // Create elegant animated line dengan route coordinates - Multi-layer untuk depth effect
                            // Base layer - subtle shadow untuk depth
                            const baseLine = L.polyline(routeCoordinates, {
                                color: '#ff7800',
                                weight: 4,
                                opacity: 0.12,
                                className: 'connection-line-base',
                                ...odcOdpHint
                            });
                            baseLine.connectedEntities = { odcId: parentOdcMarker.assetData.id, odpId: odpAsset.id };
                            odpToOdcLines.push(baseLine);
                            // Attach waypoint editor to base line
                            attachWaypointEditorToLine(baseLine, 'odc-odp', parentOdcMarker.assetData.id, odpAsset.id);
                            
                            // Main animated line - elegant and smooth
                            const line = L.polyline.antPath(routeCoordinates, {
                                color: '#ff7800', // Orange
                                weight: 2.5,
                                opacity: 0.75,
                                delay: 6000, // Slow, elegant animation
                                dashArray: [35, 55], // Long dashes for elegant look
                                pulseColor: '#ffaa44', // Soft orange pulse (lighter than line)
                                hardwareAccelerated: true,
                                ...odcOdpHint
                            });
                            line.connectedEntities = { odcId: parentOdcMarker.assetData.id, odpId: odpAsset.id };
                            odpToOdcLines.push(line);
                            // Attach waypoint editor to main line
                            attachWaypointEditorToLine(line, 'odc-odp', parentOdcMarker.assetData.id, odpAsset.id);
                        }
                    }
                }

            } catch (error) {
                console.error("[loadNetworkAssetMarkers] Error processing assets:", error);
                throw error;
            }
        }

        // Lazy load Chart.js library
        function loadChartJS() {
            return new Promise((resolve, reject) => {
                if (window.Chart) {
                    Chart = window.Chart;
                    resolve();
                    return;
                }
                
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js';
                script.onload = () => {
                    Chart = window.Chart;
                    console.log('[ChartJS] Chart.js loaded successfully');
                    resolve();
                };
                script.onerror = () => {
                    console.error('[ChartJS] Failed to load Chart.js');
                    reject(new Error('Failed to load Chart.js'));
                };
                document.head.appendChild(script);
            });
        }
        
        // Initialize monitoring charts
        async function initMonitoringCharts() {
            // Lazy load Chart.js hanya jika dashboard visible
            const dashboard = document.getElementById('connectionMonitoringDashboard');
            if (!dashboard || dashboard.style.display === 'none') {
                return; // Dashboard belum visible, skip init
            }
            
            try {
                await loadChartJS();
                
                if (!Chart) {
                    console.warn('[ChartJS] Chart.js not available, skipping chart initialization');
                    return;
                }
                
                const chartOptions = {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false }
                    },
                    scales: {
                        x: { display: false },
                        y: { display: false }
                    },
                    elements: {
                        point: { radius: 0 },
                        line: { borderWidth: 2, tension: 0.4 }
                    },
                    animation: { duration: 0 }
                };
                
                // Online Chart
                const onlineCtx = document.getElementById('chart-online');
                if (onlineCtx && !monitoringCharts.online) {
                    monitoringCharts.online = new Chart(onlineCtx, {
                        type: 'line',
                        data: {
                            labels: monitoringHistory.timestamps,
                            datasets: [{
                                data: monitoringHistory.online,
                                borderColor: '#28a745',
                                backgroundColor: 'rgba(40, 167, 69, 0.1)',
                                fill: true
                            }]
                        },
                        options: chartOptions
                    });
                }
                
                // Offline Chart
                const offlineCtx = document.getElementById('chart-offline');
                if (offlineCtx && !monitoringCharts.offline) {
                    monitoringCharts.offline = new Chart(offlineCtx, {
                        type: 'line',
                        data: {
                            labels: monitoringHistory.timestamps,
                            datasets: [{
                                data: monitoringHistory.offline,
                                borderColor: '#dc3545',
                                backgroundColor: 'rgba(220, 53, 69, 0.1)',
                                fill: true
                            }]
                        },
                        options: chartOptions
                    });
                }
                
                // Total Chart
                const totalCtx = document.getElementById('chart-total');
                if (totalCtx && !monitoringCharts.total) {
                    monitoringCharts.total = new Chart(totalCtx, {
                        type: 'line',
                        data: {
                            labels: monitoringHistory.timestamps,
                            datasets: [{
                                data: monitoringHistory.total,
                                borderColor: '#17a2b8',
                                backgroundColor: 'rgba(23, 162, 184, 0.1)',
                                fill: true
                            }]
                        },
                        options: chartOptions
                    });
                }
                
                // Uptime Chart
                const uptimeCtx = document.getElementById('chart-uptime');
                if (uptimeCtx && !monitoringCharts.uptime) {
                    monitoringCharts.uptime = new Chart(uptimeCtx, {
                        type: 'line',
                        data: {
                            labels: monitoringHistory.timestamps,
                            datasets: [{
                                data: monitoringHistory.uptime,
                                borderColor: '#ffc107',
                                backgroundColor: 'rgba(255, 193, 7, 0.1)',
                                fill: true
                            }]
                        },
                        options: chartOptions
                    });
                }
                
                console.log('[ChartJS] Monitoring charts initialized');
            } catch (error) {
                console.error('[ChartJS] Error initializing charts:', error);
            }
        }
        
        // Update monitoring charts dengan debounce
        function updateMonitoringCharts(online, offline, total, uptime) {
            // Clear existing timeout
            if (chartUpdateTimeout) {
                clearTimeout(chartUpdateTimeout);
            }
            
            // Add current data to history
            const now = new Date();
            const hourLabel = now.getHours().toString().padStart(2, '0') + ':00';
            
            // Keep only last 24 hours
            monitoringHistory.timestamps.push(hourLabel);
            monitoringHistory.online.push(online);
            monitoringHistory.offline.push(offline);
            monitoringHistory.total.push(total);
            monitoringHistory.uptime.push(uptime);
            
            // Limit to 24 entries (24 hours)
            if (monitoringHistory.timestamps.length > 24) {
                monitoringHistory.timestamps.shift();
                monitoringHistory.online.shift();
                monitoringHistory.offline.shift();
                monitoringHistory.total.shift();
                monitoringHistory.uptime.shift();
            }
            
            // Debounce chart updates
            chartUpdateTimeout = setTimeout(() => {
                if (!Chart) {
                    // Try to init charts if not initialized
                    initMonitoringCharts();
                    return;
                }
                
                // Update charts jika sudah initialized
                if (monitoringCharts.online) {
                    monitoringCharts.online.data.labels = monitoringHistory.timestamps;
                    monitoringCharts.online.data.datasets[0].data = monitoringHistory.online;
                    monitoringCharts.online.update('none'); // 'none' mode = no animation
                }
                
                if (monitoringCharts.offline) {
                    monitoringCharts.offline.data.labels = monitoringHistory.timestamps;
                    monitoringCharts.offline.data.datasets[0].data = monitoringHistory.offline;
                    monitoringCharts.offline.update('none');
                }
                
                if (monitoringCharts.total) {
                    monitoringCharts.total.data.labels = monitoringHistory.timestamps;
                    monitoringCharts.total.data.datasets[0].data = monitoringHistory.total;
                    monitoringCharts.total.update('none');
                }
                
                if (monitoringCharts.uptime) {
                    monitoringCharts.uptime.data.labels = monitoringHistory.timestamps;
                    monitoringCharts.uptime.data.datasets[0].data = monitoringHistory.uptime;
                    monitoringCharts.uptime.update('none');
                }
            }, CHART_UPDATE_DEBOUNCE_MS);
        }
        
        // Function to update connection monitoring dashboard (moved before loadCustomerMarkers)
        function updateConnectionMonitoring() {
            // Show dashboard jika belum ditampilkan
            const dashboard = $('#connectionMonitoringDashboard');
            if (dashboard.length && dashboard.css('display') === 'none') {
                dashboard.slideDown(300);
                // Initialize charts saat dashboard ditampilkan pertama kali
                setTimeout(() => {
                    initMonitoringCharts();
                }, 350);
            }
            
            if (!customerMarkers || customerMarkers.length === 0) {
                $('#monitoring-online-count').text('0');
                $('#monitoring-offline-count').text('0');
                $('#monitoring-total-count').text('0');
                $('#monitoring-uptime-rate').text('0%');
                updateMonitoringCharts(0, 0, 0, 0);
                return;
            }
            
            let onlineCount = 0;
            let offlineCount = 0;
            let unknownCount = 0;
            
            customerMarkers.forEach(marker => {
                const status = marker.customerOnlineStatus;
                if (status === 'online') onlineCount++;
                else if (status === 'offline') offlineCount++;
                else unknownCount++;
            });
            
            const totalCount = customerMarkers.length;
            const uptimeRate = totalCount > 0 ? ((onlineCount / totalCount) * 100).toFixed(1) : 0;
            
            $('#monitoring-online-count').text(onlineCount);
            $('#monitoring-offline-count').text(offlineCount);
            $('#monitoring-total-count').text(totalCount);
            $('#monitoring-uptime-rate').text(uptimeRate + '%');
            
            // Update charts dengan debounce
            updateMonitoringCharts(onlineCount, offlineCount, totalCount, parseFloat(uptimeRate));
        }

        async function loadCustomerMarkers() {
            console.log("[loadCustomerMarkers] Memulai pemrosesan marker pelanggan (menggunakan data yang sudah ada)...");

            if (!allCustomerData || !Array.isArray(allCustomerData)) {
                console.error("[loadCustomerMarkers] allCustomerData tidak valid atau bukan array.");
                displayGlobalMapMessage("Data pelanggan tidak valid untuk diproses.", "danger", 0);
                allCustomerData = [];
            }

            if (allCustomerData.length === 0) {
                console.warn("[loadCustomerMarkers] Tidak ada data pelanggan untuk diproses.");
                return;
            }

            try {
                for (const customer of allCustomerData) {
                    if (customer.latitude != null && customer.longitude != null) {
                        let lat = parseFloat(customer.latitude);
                        let lng = parseFloat(customer.longitude);
                        if (isNaN(lat) || isNaN(lng)) { console.warn("Koordinat pelanggan tidak valid:", customer); continue; }

                        let onlineStatus = 'unknown';
                        let customerIpAddress = 'N/A';

                        if (customer.pppoe_username) {
                            if (activePppoeUsersMap.has(customer.pppoe_username)) {
                                onlineStatus = 'online';
                                customerIpAddress = activePppoeUsersMap.get(customer.pppoe_username);
                            } else {
                                onlineStatus = 'offline';
                                customerIpAddress = 'Offline';
                            }
                        } else {
                            onlineStatus = 'offline';
                        }

                        if (initialPppoeLoadFailed && customer.pppoe_username) {
                            onlineStatus = 'unknown';
                            customerIpAddress = 'Unknown';
                        }

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
                            popupContent += `<p>Redaman: <span id="redaman-val-${customer.id}">Memuat...</span></p>`;
                            popupContent += `<p>Tipe Modem: <span id="modem-type-${customer.id}">Memuat...</span></p>`;
                        } else {
                            popupContent += '<p>Redaman: <span class="text-muted">N/A (No Device ID)</span></p>';
                            popupContent += '<p>Tipe Modem: <span class="text-muted">N/A (No Device ID)</span></p>';
                        }

                        popupContent += `<p><small>Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}</small></p>`;
                        let odpDetailsHtml = '';
                        let odcDetailsHtml = '';

                        if (customer.connected_odp_id) {
                            const odpMarker = odpMarkers.find(m => String(m.assetData.id) === String(customer.connected_odp_id));
                            if (odpMarker && odpMarker.assetData) {
                                const odpAsset = odpMarker.assetData;
                                const connectedCustomersToThisOdp = allCustomerData.filter(cust => String(cust.connected_odp_id) === String(odpAsset.id));

                                odpDetailsHtml = `<p class="mt-2 pt-2 border-top"><strong><i class="fas fa-network-wired"></i> ODP Terhubung:</strong> ${odpAsset.name || `ID ${odpAsset.id}`}</p>`;

                                if (odpAsset.address) {
                                    odpDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Alamat ODP: ${odpAsset.address}</p>`;
                                } else {
                                    odpDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Alamat ODP: Tidak tersedia</p>`;
                                }
                                odpDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Kapasitas ODP: ${odpAsset.capacity_ports || 'N/A'} Port</p>`;
                                odpDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Port Terpakai ODP: ${connectedCustomersToThisOdp.length}</p>`;


                                if (odpAsset.latitude != null && odpAsset.longitude != null) {
                                    const custLatForDist = lat;
                                    const custLngForDist = lng;
                                    const odpAssetLatForDist = parseFloat(odpAsset.latitude);
                                    const odpAssetLngForDist = parseFloat(odpAsset.longitude);

                                    if (!isNaN(custLatForDist) && !isNaN(custLngForDist) && !isNaN(odpAssetLatForDist) && !isNaN(odpAssetLngForDist)) {
                                        const dist = haversineDistance(
                                            { latitude: custLatForDist, longitude: custLngForDist },
                                            { latitude: odpAssetLatForDist, longitude: odpAssetLngForDist }
                                        );
                                        if (!isNaN(dist)) {
                                            odpDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Jarak ke ODP: ${dist.toFixed(0)} m</p>`;
                                        }
                                    }
                                }
                                // NEW LOGIC: Differentiate line types based on status dengan routing
                                // Get routing profile dari config (default: 'foot-walking' untuk Customer-ODP)
                                let routingProfile = 'foot-walking';
                                if (typeof window !== 'undefined' && window.globalConfig && window.globalConfig.openRouteService) {
                                    routingProfile = window.globalConfig.openRouteService.profiles?.customerToOdp || 'foot-walking';
                                }
                                
                                // KABEL DROP TIDAK DI-ROUTE. Drop ODP→rumah cuma puluhan meter dan memotong
                                // pekarangan; dipaksa memutar lewat jalan justru LEBIH salah daripada garis
                                // lurus. Router mengikuti jalan kendaraan, kabel mengikuti tiang.
                                // Nyalakan sadar-risiko lewat `openRouteService.routeDropCable = true`.
                                const routeDropCable = !!(typeof window !== 'undefined' && window.globalConfig
                                    && window.globalConfig.openRouteService
                                    && window.globalConfig.openRouteService.routeDropCable === true);

                                const custRoute = await resolveConnectionRoute(
                                    'customer-odp', customer.id, odpAsset.id,
                                    { lat: lat, lng: lng },
                                    { lat: odpMarker.getLatLng().lat, lng: odpMarker.getLatLng().lng },
                                    { profile: routingProfile, allowRouting: routeDropCable }
                                );
                                const customerToOdpRouteCoordinates = custRoute.coordinates;
                                const custHint = routeStyleHint(custRoute.source);

                                if (onlineStatus === 'online') {
                                    // Elegant multi-layer animated line untuk online customers
                                    // Base layer - subtle glow
                                    const baseGlow = L.polyline(customerToOdpRouteCoordinates, {
                                        color: '#28a745',
                                        weight: 5,
                                        opacity: 0.15,
                                        className: 'connection-line-glow',
                                        ...custHint
                                    });
                                    baseGlow.connectedEntities = { customerId: customer.id, odpId: odpAsset.id };
                                    customerToOdpLines.push(baseGlow);
                                    // Attach waypoint editor to base glow
                                    attachWaypointEditorToLine(baseGlow, 'customer-odp', customer.id, odpAsset.id);
                                    
                                    // Main animated line - elegant and smooth
                                    const lineDots = L.polyline.antPath(customerToOdpRouteCoordinates, {
                                        color: '#28a745', // Green
                                        weight: 2.5,
                                        opacity: 0.8,
                                        delay: 7000, // Slow, elegant animation
                                        dashArray: [40, 60], // Long dashes for elegant look
                                        pulseColor: '#4ade80', // Soft green pulse (lighter)
                                        hardwareAccelerated: true,
                                        ...custHint
                                    });
                                    lineDots.connectedEntities = { customerId: customer.id, odpId: odpAsset.id };
                                    customerToOdpLines.push(lineDots);
                                    // Attach waypoint editor to main line
                                    attachWaypointEditorToLine(lineDots, 'customer-odp', customer.id, odpAsset.id);
                                } else {
                                    // For 'offline' or 'unknown' status - elegant subtle line
                                    let lineColor = (onlineStatus === 'offline') ? '#dc3545' : '#6c757d'; // Red for offline, grey for unknown
                                    let pulseColor = (onlineStatus === 'offline') ? '#f87171' : '#94a3b8'; // Soft red/grey pulse

                                    // Base layer - subtle shadow
                                    const baseShadow = L.polyline(customerToOdpRouteCoordinates, {
                                        color: lineColor,
                                        weight: 4,
                                        opacity: 0.1,
                                        className: 'connection-line-shadow',
                                        ...custHint
                                    });
                                    baseShadow.connectedEntities = { customerId: customer.id, odpId: odpAsset.id };
                                    customerToOdpLines.push(baseShadow);
                                    
                                    // Attach waypoint editor to base shadow
                                    attachWaypointEditorToLine(baseShadow, 'customer-odp', customer.id, odpAsset.id);

                                    // Main animated line
                                    const offlineLine = L.polyline.antPath(customerToOdpRouteCoordinates, {
                                        color: lineColor,
                                        weight: 2.5,
                                        opacity: 0.6,
                                        delay: 8000, // Very slow, elegant animation
                                        dashArray: [45, 65], // Long dashes for elegant look
                                        pulseColor: pulseColor, // Soft pulse color
                                        hardwareAccelerated: true,
                                        ...custHint
                                    });
                                    offlineLine.connectedEntities = { customerId: customer.id, odpId: odpAsset.id };
                                    customerToOdpLines.push(offlineLine);
                                    
                                    // Attach waypoint editor to main line
                                    attachWaypointEditorToLine(offlineLine, 'customer-odp', customer.id, odpAsset.id);
                                }

                                if (odpAsset.parent_odc_id) {
                                    const parentOdc = allOdcData.find(o => String(o.id) === String(odpAsset.parent_odc_id));
                                    if (parentOdc) {
                                        odcDetailsHtml = `<p><strong><i class="fas fa-server"></i> Induk ODC:</strong> ${parentOdc.name || `ID ${parentOdc.id}`}</p>`;
                                        if (parentOdc.address) {
                                            odcDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Alamat ODC: ${parentOdc.address}</p>`;
                                        } else {
                                             odcDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Alamat ODC: Tidak tersedia</p>`;
                                        }
                                        odcDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Kapasitas ODC: ${parentOdc.capacity_ports || 'N/A'} Port</p>`;
                                        odcDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Port Terpakai ODC: ${parentOdc.ports_used || 0} (ODP)</p>`;
                                    } else {
                                        odcDetailsHtml = `<p><strong><i class="fas fa-server"></i> Induk ODC:</strong> ID ${odpAsset.parent_odc_id} (Detail tidak ditemukan atau ODC tidak difilter)</p>`;
                                    }
                                } else {
                                    odcDetailsHtml = `<p><strong><i class="fas fa-server"></i> Induk ODC:</strong> Tidak terhubung ke ODC.`;
                                }
                            } else {
                                odpDetailsHtml = `<p class="mt-2 pt-2 border-top"><strong><i class="fas fa-network-wired"></i> ODP Terhubung:</strong> ID ${customer.connected_odp_id} (Detail ODP tidak ditemukan/difilter)</p>`;
                            }
                        }
                        popupContent += odpDetailsHtml;
                        popupContent += odcDetailsHtml;

                        if (customer.device_id) {
                            popupContent += `<div class="mt-2"><button class="btn btn-sm btn-info btn-show-wifi-info" data-device-id="${customer.device_id}" data-customer-name="${customer.name||'Pelanggan'}"><i class="fas fa-wifi"></i> Detail Perangkat</button> ` +
                                            `<button class="btn btn-sm btn-warning btn-manage-wifi" data-device-id="${customer.device_id}" data-customer-name="${customer.name||'Pelanggan'}"><i class="fas fa-edit"></i> Kelola WiFi</button></div>`;
                        }
                        
                        const icon = createCustomerStatusIcon(onlineStatus); // Icon only, label is tooltip
                        const marker = L.marker([lat, lng], { icon: icon }).bindPopup(popupContent);
                        marker.customerData = JSON.parse(JSON.stringify(customer));
                        marker.customerOnlineStatus = onlineStatus;
                        marker.customerIpAddress = customerIpAddress;

                        // Bind tooltip for customer
                        let customerLabel = customer.pppoe_username || customer.name || `Cust. ID ${customer.id}`;
                        marker.bindTooltip(customerLabel, {
                            permanent: true, // Always show unless hidden by control
                            direction: 'top',
                            className: 'marker-label-tooltip', // Apply custom styling to tooltip
                            offset: [0, -ICON_HEIGHT/2 - 5] // Offset to position above icon
                        });
                        // Set initial visibility
                        if (!labelVisibility.customer) {
                            marker.getTooltip().setOpacity(0);
                        }

                        marker.on('popupopen', function(e) {
                            updateCustomerPopupDetails(e.target, e.target.customerData);
                        });

                        customerMarkers.push(marker);
                        
                        // Update monitoring statistics
                        updateConnectionMonitoring();
                        updateLegendCounters();
                    }
                }
            } catch(processingError) {
                console.error("[loadCustomerMarkers] Error processing customer data for markers:", processingError);
                displayGlobalMapMessage("Gagal memproses data pelanggan untuk ditampilkan di peta. Cek konsol.", "danger", 0);
                throw processingError;
            }
        }

        $(document).on('click', '.btn-edit-asset', function(e) {
            e.stopPropagation();
            const activePopup = map ? map._popup : null;
            if (activePopup && activePopup._source && activePopup._source.assetData) {
                const assetDataForModal = JSON.parse(JSON.stringify(activePopup._source.assetData));
                openAssetModal(assetDataForModal, null, null); 
                if (map) map.closePopup();
            }
        });

        $(document).on('click', '.btn-show-wifi-info', async function(e) {
            e.stopPropagation();
            if (map && map._popup && map._popup.isOpen()) map.closePopup();

            const deviceId = $(this).data('device-id');
            let customerName = $(this).data('customer-name') || "Pelanggan";
            const popupContentElement = $(this).closest('.leaflet-popup-content');
            if (popupContentElement.length > 0) {
                const nameFromPopup = popupContentElement.find('b').first().text().replace('Pelanggan: ','').trim();
                if (nameFromPopup && nameFromPopup !== 'N/A') customerName = nameFromPopup;
            }

            $('#wifiInfoModalLabel').text(`Detail Perangkat & WiFi untuk ${customerName}`);
            const modalBody = $('#wifiInfoModalBody');
            modalBody.html('<p class="text-center my-3"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Memuat informasi...</p>');
            $('#wifiInfoModal').modal('show');

            let deviceDetailsContent = '';
            if (deviceId) {
                try {
                    const response = await fetch('/api/device-details/${deviceId}?_=${new Date().getTime()}', { credentials: 'include' });
                    if (!response.ok) {
                         console.warn(`Gagal mengambil detail perangkat untuk modal (${deviceId}): ${response.status}`);
                         deviceDetailsContent += `<p class="mb-1"><strong><i class="fas fa-microchip"></i> Tipe Modem:</strong> Tidak tersedia (Server Error)</p>`;
                    } else {
                        const result = await response.json();
                        if (result.data && result.data.modemType) {
                            deviceDetailsContent += `<p class="mb-1"><strong><i class="fas fa-microchip"></i> Tipe Modem:</strong> ${result.data.modemType}</p>`;
                        } else {
                            deviceDetailsContent += `<p class="mb-1"><strong><i class="fas fa-microchip"></i> Tipe Modem:</strong> Tidak terdeteksi/N/A</p>`;
                        }
                    }
                } catch (devError) {
                    console.error("Error fetching device details for modal:", devError);
                    deviceDetailsContent += `<p class="mb-1"><strong><i class="fas fa-microchip"></i> Tipe Modem:</strong> Error saat memuat</p>`;
                }
            } else {
                 deviceDetailsContent += `<p class="mb-1"><strong><i class="fas fa-microchip"></i> Tipe Modem:</strong> N/A (No Device ID)</p>`;
            }


            try {
                const response = await fetch('/api/customer-wifi-info/${deviceId}?_=${new Date().getTime()}', { credentials: 'include' });
                const result = await response.json();
                if (!response.ok || result.status !== 200) throw new Error(result.message || `Gagal ambil info WiFi (HTTP ${response.status})`);

                if (result.data && Array.isArray(result.data.ssid)) {
                    let content = deviceDetailsContent;
                    content += `<p class="mb-2"><strong><i class="fas fa-clock"></i> Uptime Modem (dari WiFi API):</strong> ${result.data.uptime || 'N/A'}</p><hr class="mt-1 mb-3">`;
                    if (result.data.ssid.length > 0) {
                        content += `<h5><i class="fas fa-wifi"></i> Daftar SSID</h6>`;
                        result.data.ssid.forEach(s => {
                            if (!s || typeof s !== 'object') return;
                            content += `<div class="card mb-3 shadow-sm"><div class="card-header py-2"><strong>SSID ${s.id||'N/A'}: <span class="text-primary font-weight-bold">${s.name||'N/A'}</span></strong></div>`+
                                       `<div class="card-body py-2 px-3"><p class="mb-1 small"><strong>Transmit Power:</strong> ${s.transmitPower != null ? s.transmitPower + '%' : 'N/A'}</p>`;
                            if (s.associatedDevices && s.associatedDevices.length > 0) {
                                content += `<p class="mb-1 small mt-2"><strong><i class="fas fa-users"></i> Perangkat Terhubung (${s.associatedDevices.length}):</strong></p><ul class="list-group list-group-flush device-list small">`;
                                s.associatedDevices.forEach(dev => {
                                     if (!dev || typeof dev !== 'object') return;
                                    content += `<li class="list-group-item py-1 px-0">${dev.hostName||'Tanpa Nama'} <br><small class="text-muted" style="font-size:0.9em;">(MAC: ${dev.mac||'-'}, IP: ${dev.ip||'-'}, Sinyal: ${dev.signal ? dev.signal+' dBm':'-'})</small></li>`;
                                });
                                content += `</ul>`;
                            } else content += `<p class="mb-1 small mt-2"><em>Tidak ada perangkat terhubung.</em></p>`;
                            content += `</div></div>`;
                        });
                    } else content += '<p class="text-muted">Tidak ada SSID aktif ditemukan.</p>';
                    modalBody.html(content);
                } else modalBody.html(deviceDetailsContent + '<p class="text-danger">Format data API WiFi tidak sesuai.</p>');
            } catch (error) {
                modalBody.html(deviceDetailsContent + `<p class="text-danger"><strong>Error memuat info WiFi:</strong> ${error.message}</p>`);
            }
        });

        $(document).on('click', '.btn-manage-wifi', async function(e) {
            e.stopPropagation();
            if (map && map._popup) map.closePopup();

            const deviceId = $(this).data('device-id');
            let customerName = $(this).data('customer-name') || "Pelanggan";
             const popupContentElement = $(this).closest('.leaflet-popup-content');
             if (popupContentElement.length > 0) {
                const nameFromPopup = popupContentElement.find('b').first().text().replace('Pelanggan: ','').trim();
                if (nameFromPopup && nameFromPopup !== 'N/A') customerName = nameFromPopup;
             }

            $('#wifi_manage_device_id').val(deviceId);
            $('#wifi_manage_customer_name').val(customerName);
            $('#wifiManagementModalLabel').text(`Kelola WiFi untuk ${customerName}`);
            const formContainer = $('#wifiManagementFormContainer');
            formContainer.html('<p class="text-center my-3"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Memuat...</p>');
            $('#wifi_manage_transmit_power').val('');
            $('#wifiManagementModal').modal('show');

            try {
                const response = await fetch('/api/customer-wifi-info/${deviceId}?_=${new Date().getTime()}', { credentials: 'include' });
                const result = await response.json();
                if (!response.ok || result.status !== 200 ) throw new Error(result.message || `Gagal ambil data SSID (HTTP ${response.status})`);

                if (result.data && result.data.ssid && Array.isArray(result.data.ssid)) {
                    let formContent = '';
                    if (result.data.ssid.length > 0) {
                        result.data.ssid.forEach(s => {
                            if(!s || typeof s !== 'object') return;
                            formContent += `<div class="card card-body mb-2 p-2 shadow-sm">
                                <p class="mb-1"><strong>SSID ID: ${s.id} (Nama: <span class="text-info font-weight-bold">${s.name||'N/A'}</span>)</strong></p>
                                <div class="form-group mb-2"><label for="wifi_manage_ssid_name_${s.id}" class="form-label mb-0">Nama SSID Baru</label><input type="text" class="form-control form-control-sm" id="wifi_manage_ssid_name_${s.id}" name="ssid_${s.id}" placeholder="Kosong jika tidak diubah"></div>
                                <div class="form-group mb-1"><label for="wifi_manage_ssid_password_${s.id}" class="form-label mb-0">Password Baru</label><input type="password" class="form-control form-control-sm" id="wifi_manage_ssid_password_${s.id}" name="ssid_password_${s.id}" placeholder="Min. 8 karakter, kosong jika tidak diubah"></div>
                                </div>`;
                        });
                    } else formContent = '<p class="text-muted">Tidak ada SSID terkonfigurasi.</p>';
                    formContainer.html(formContent);
                    if(result.data.ssid.length > 0 && result.data.ssid[0].transmitPower != null) {
                        $('#wifi_manage_transmit_power').val(result.data.ssid[0].transmitPower);
                    }
                } else formContainer.html('<p class="text-danger">Format data API tidak sesuai.</p>');
            } catch (error) {
                formContainer.html(`<p class="text-danger">Error: ${error.message}</p>`);
            }
        });

        $('#wifiManagementForm').on('submit', async function(event) {
            event.preventDefault();
            const deviceId = $('#wifi_manage_device_id').val();
            const customerName = $('#wifi_manage_customer_name').val();
            const formData = new FormData(this);
            const dataToSend = {};
            let hasChanges = false;
            formData.forEach((value, key) => {
                if (value && value.trim() !== '') {
                    dataToSend[key] = value.trim();
                    if (!['device_id_for_wifi_manage', 'customer_name_for_wifi_manage'].includes(key)) hasChanges = true;
                }
            });
            delete dataToSend.device_id_for_wifi_manage;
            delete dataToSend.customer_name_for_wifi_manage;

            if (!hasChanges) {
                displayGlobalMapMessage('Tidak ada perubahan dimasukkan.', 'info');
                $('#wifiManagementModal').modal('hide'); return;
            }

            const saveButton = $('#saveWifiManagementBtn');
            const originalButtonText = saveButton.html();
            saveButton.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Menyimpan...');

            try {
                const response = await fetch(`/api/ssid/${deviceId}`, { 
                    method: 'POST', 
                    headers: {'Content-Type':'application/json'}, 
                    credentials: 'include',
                    body: JSON.stringify(dataToSend) 
                });
                const result = await response.json();
                if (response.ok && result.status === 200) {
                    displayGlobalMapMessage(`Perubahan WiFi untuk ${customerName} berhasil dikirim.`, 'success');
                    $('#wifiManagementModal').modal('hide');
                } else displayGlobalMapMessage(`Gagal simpan: ${result.message || `Status ${response.status}`}`, 'danger');
            } catch (error) {
                displayGlobalMapMessage(`Error koneksi: ${error.message}`, 'danger');
            } finally {
                saveButton.prop('disabled', false).html(originalButtonText);
            }
        });


        // Map Sidebar Variables
        let sidebarSearchTimeout = null;
        let sidebarAlerts = [];
        
        // Advanced Legend Variables
        let advancedLegendControl = null;
        let legendMinimap = null;
        let legendCounters = {
            odc: 0,
            odp: 0,
            online: 0,
            offline: 0,
            unknown: 0
        };
        
        // Alert System Variables
        let alertSystem = null;
        let activeAlerts = [];
        let alertSoundEnabled = false;
        
        // Quick Filter Variables
        let currentQuickFilter = 'all';
        
        // Map Sidebar Functions
        function toggleMapSidebar() {
            const sidebar = document.getElementById('mapSidebar');
            const overlay = document.getElementById('mapSidebarOverlay');
            
            if (sidebar.classList.contains('open')) {
                sidebar.classList.remove('open');
                if (overlay) overlay.classList.remove('active');
            } else {
                sidebar.classList.add('open');
                if (overlay) overlay.classList.add('active');
                updateQuickStats();
            }
        }
        
        function updateQuickStats() {
            const odcCount = allNetworkAssetsData.filter(a => a.type === 'ODC').length;
            const odpCount = allNetworkAssetsData.filter(a => a.type === 'ODP').length;
            const customerCount = allCustomerData.length;
            
            $('#sidebar-odc-count').text(odcCount);
            $('#sidebar-odp-count').text(odpCount);
            $('#sidebar-customer-count').text(customerCount);
        }
        
        function performSidebarSearch(query) {
            if (!query || query.trim().length < 2) {
                $('#sidebarSearchResults').hide().empty();
                return;
            }
            
            const searchTerm = query.toLowerCase().trim();
            const results = [];
            
            // Search customers
            allCustomerData.forEach(customer => {
                const name = (customer.name || '').toLowerCase();
                const phone = (customer.phone_number || '').toLowerCase();
                const address = (customer.address || '').toLowerCase();
                
                if (name.includes(searchTerm) || phone.includes(searchTerm) || address.includes(searchTerm)) {
                    results.push({
                        type: 'customer',
                        id: customer.id,
                        name: customer.name || 'N/A',
                        phone: customer.phone_number || 'N/A',
                        data: customer
                    });
                }
            });
            
            // Search network assets
            allNetworkAssetsData.forEach(asset => {
                const name = (asset.name || '').toLowerCase();
                const address = (asset.address || '').toLowerCase();
                
                if (name.includes(searchTerm) || address.includes(searchTerm)) {
                    results.push({
                        type: asset.type.toLowerCase(),
                        id: asset.id,
                        name: asset.name || 'N/A',
                        address: asset.address || 'N/A',
                        data: asset
                    });
                }
            });
            
            // Display results
            const resultsContainer = $('#sidebarSearchResults');
            resultsContainer.empty();
            
            if (results.length === 0) {
                resultsContainer.html('<div class="search-result-item text-muted p-2">Tidak ada hasil ditemukan</div>');
            } else {
                results.slice(0, 10).forEach(result => {
                    const icon = result.type === 'customer' ? 'fa-user' : 
                                result.type === 'odc' ? 'fa-server' : 'fa-network-wired';
                    const color = result.type === 'customer' ? 'text-primary' : 
                                 result.type === 'odc' ? 'text-purple' : 'text-orange';
                    
                    const item = $(`
                        <div class="search-result-item" data-type="${result.type}" data-id="${result.id}">
                            <i class="fas ${icon} ${color}"></i>
                            <strong>${result.name}</strong>
                            <small class="text-muted d-block">${result.type === 'customer' ? result.phone : result.address}</small>
                        </div>
                    `);
                    
                    item.on('click', function() {
                        handleSearchResultClick(result);
                    });
                    
                    resultsContainer.append(item);
                });
            }
            
            resultsContainer.show();
        }
        
        function handleSearchResultClick(result) {
            if (result.type === 'customer' && map) {
                // Find customer marker and open popup
                const marker = customerMarkers.find(m => m.customerData && m.customerData.id === result.id);
                if (marker) {
                    map.setView([marker.getLatLng().lat, marker.getLatLng().lng], 18);
                    marker.openPopup();
                }
            } else if ((result.type === 'odc' || result.type === 'odp') && map) {
                // Find asset marker and open popup
                const allAssetMarkers = [...odcMarkers, ...odpMarkers];
                const marker = allAssetMarkers.find(m => m.assetData && m.assetData.id === result.id);
                if (marker) {
                    map.setView([marker.getLatLng().lat, marker.getLatLng().lng], 18);
                    marker.openPopup();
                }
            }
            
            // Close sidebar on mobile
            if (window.innerWidth <= 768) {
                toggleMapSidebar();
            }
        }
        
        function applySidebarFilters() {
            const showOnline = $('#sidebarFilterOnline').is(':checked');
            const showOffline = $('#sidebarFilterOffline').is(':checked');
            const showOdc = $('#sidebarFilterOdc').is(':checked');
            const showOdp = $('#sidebarFilterOdp').is(':checked');
            
            // Update selected sets based on filters
            if (!showOdc) {
                selectedOdcIds.clear();
            } else {
                allNetworkAssetsData.filter(a => a.type === 'ODC').forEach(a => {
                    selectedOdcIds.add(String(a.id));
                });
            }
            
            if (!showOdp) {
                selectedOdpIds.clear();
            } else {
                allNetworkAssetsData.filter(a => a.type === 'ODP').forEach(a => {
                    selectedOdpIds.add(String(a.id));
                });
            }
            
            // Filter customers by online/offline status
            if (!showOnline || !showOffline) {
                selectedCustomerIds.clear();
                customerMarkers.forEach(marker => {
                    const status = marker.customerOnlineStatus;
                    if ((showOnline && status === 'online') || (showOffline && status === 'offline')) {
                        selectedCustomerIds.add(String(marker.customerData.id));
                    }
                });
            } else {
                allCustomerData.forEach(c => selectedCustomerIds.add(String(c.id)));
            }
            
            // Apply filters
            applyFilters();
            updateConnectionMonitoring();
        }
        
        function updateSidebarAlerts() {
            const alertsList = $('#sidebarAlertsList');
            alertsList.empty();
            
            if (sidebarAlerts.length === 0) {
                alertsList.html('<div class="alert-item alert-info"><i class="fas fa-info-circle"></i><span>Belum ada alert</span></div>');
                return;
            }
            
            sidebarAlerts.slice(0, 5).forEach(alert => {
                const alertClass = alert.severity === 'critical' ? 'alert-danger' :
                                  alert.severity === 'warning' ? 'alert-warning' :
                                  alert.severity === 'info' ? 'alert-info' : 'alert-success';
                
                const item = $(`
                    <div class="alert-item ${alertClass}">
                        <i class="fas ${alert.icon || 'fa-exclamation-circle'}"></i>
                        <div>
                            <strong>${alert.title}</strong>
                            <small class="d-block">${alert.message}</small>
                        </div>
                    </div>
                `);
                
                alertsList.append(item);
            });
        }
        
        function exportCustomers() {
            try {
                const csv = ['ID,Nama,No HP,Alamat,Status,PPPoE Username'];
                allCustomerData.forEach(customer => {
                    const status = customerMarkers.find(m => m.customerData && m.customerData.id === customer.id)?.customerOnlineStatus || 'unknown';
                    csv.push([
                        customer.id,
                        customer.name || '',
                        customer.phone_number || '',
                        (customer.address || '').replace(/,/g, ';'),
                        status,
                        customer.pppoe_username || ''
                    ].join(','));
                });
                
                const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `pelanggan_${new Date().toISOString().split('T')[0]}.csv`;
                link.click();
                
                displayGlobalMapMessage('Export pelanggan berhasil!', 'success');
            } catch (error) {
                console.error('Export error:', error);
                displayGlobalMapMessage('Gagal export pelanggan', 'danger');
            }
        }
        
        function exportAssets() {
            try {
                const csv = ['ID,Tipe,Nama,Alamat,Latitude,Longitude'];
                allNetworkAssetsData.forEach(asset => {
                    csv.push([
                        asset.id,
                        asset.type,
                        asset.name || '',
                        (asset.address || '').replace(/,/g, ';'),
                        asset.latitude || '',
                        asset.longitude || ''
                    ].join(','));
                });
                
                const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `aset_jaringan_${new Date().toISOString().split('T')[0]}.csv`;
                link.click();
                
                displayGlobalMapMessage('Export aset berhasil!', 'success');
            } catch (error) {
                console.error('Export error:', error);
                displayGlobalMapMessage('Gagal export aset', 'danger');
            }
        }
        
        function exportMap() {
            if (!map) {
                displayGlobalMapMessage('Peta belum siap', 'warning');
                return;
            }
            
            try {
                map.once('rendercomplete', function() {
                    html2canvas(document.getElementById('interactiveMap'), {
                        useCORS: true,
                        logging: false
                    }).then(canvas => {
                        canvas.toBlob(function(blob) {
                            const link = document.createElement('a');
                            link.href = URL.createObjectURL(blob);
                            link.download = `peta_jaringan_${new Date().toISOString().split('T')[0]}.png`;
                            link.click();
                            displayGlobalMapMessage('Export peta berhasil!', 'success');
                        }, 'image/png');
                    });
                });
                
                map.fire('rendercomplete');
            } catch (error) {
                console.error('Export map error:', error);
                displayGlobalMapMessage('Gagal export peta. Pastikan html2canvas tersedia.', 'danger');
            }
        }
        
        // Alert System Class
        class AlertSystem {
            constructor() {
                this.activeAlerts = [];
                this.toastContainer = document.getElementById('toastNotificationsContainer');
                this.alertPanel = document.getElementById('alertPanel');
                this.alertPanelContent = document.getElementById('alertPanelContent');
                this.alertBadge = document.getElementById('alertBadge');
                this.soundEnabled = false;
            }
            
            showToast(alert) {
                const toast = document.createElement('div');
                toast.className = `toast-notification toast-${alert.severity}`;
                
                const iconMap = {
                    'critical': 'fa-exclamation-circle',
                    'warning': 'fa-exclamation-triangle',
                    'info': 'fa-info-circle',
                    'success': 'fa-check-circle'
                };
                
                toast.innerHTML = `
                    <i class="fas ${iconMap[alert.severity] || 'fa-info-circle'} toast-icon toast-${alert.severity}"></i>
                    <div class="toast-content">
                        <div class="toast-title">${alert.title}</div>
                        <p class="toast-message">${alert.message}</p>
                    </div>
                    <button class="toast-close" onclick="this.parentElement.remove()">
                        <i class="fas fa-times"></i>
                    </button>
                `;
                
                this.toastContainer.appendChild(toast);
                
                // Auto-dismiss untuk non-critical alerts
                if (alert.severity !== 'critical') {
                    setTimeout(() => {
                        toast.classList.add('removing');
                        setTimeout(() => toast.remove(), 300);
                    }, alert.duration || 5000);
                }
                
                // Play sound untuk critical alerts
                if (alert.severity === 'critical' && this.soundEnabled) {
                    this.playAlertSound();
                }
            }
            
            addAlert(alert) {
                const alertId = alert.id || `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                const newAlert = {
                    id: alertId,
                    title: alert.title || 'Alert',
                    message: alert.message || '',
                    severity: alert.severity || 'info',
                    timestamp: new Date(),
                    acknowledged: false,
                    duration: alert.duration || 5000
                };
                
                // Check if alert already exists
                const existingIndex = this.activeAlerts.findIndex(a => a.id === alertId);
                if (existingIndex >= 0) {
                    this.activeAlerts[existingIndex] = newAlert;
                } else {
                    this.activeAlerts.push(newAlert);
                }
                
                // Show toast
                this.showToast(newAlert);
                
                // Update alert panel
                this.updateAlertPanel();
                
                // Update badge
                this.updateBadge();
                
                return alertId;
            }
            
            acknowledgeAlert(alertId) {
                const alert = this.activeAlerts.find(a => a.id === alertId);
                if (alert) {
                    alert.acknowledged = true;
                    this.removeAlert(alertId);
                }
            }
            
            removeAlert(alertId) {
                this.activeAlerts = this.activeAlerts.filter(a => a.id !== alertId);
                this.updateAlertPanel();
                this.updateBadge();
            }
            
            updateAlertPanel() {
                const unacknowledgedAlerts = this.activeAlerts.filter(a => !a.acknowledged);
                
                if (unacknowledgedAlerts.length === 0) {
                    this.alertPanelContent.innerHTML = `
                        <div class="alert-panel-empty">
                            <i class="fas fa-check-circle text-success"></i>
                            <p>Tidak ada alert aktif</p>
                        </div>
                    `;
                    return;
                }
                
                this.alertPanelContent.innerHTML = unacknowledgedAlerts.map(alert => {
                    const severityLabels = {
                        'critical': 'Critical',
                        'warning': 'Warning',
                        'info': 'Info',
                        'success': 'Success'
                    };
                    
                    const timeAgo = this.getTimeAgo(alert.timestamp);
                    
                    return `
                        <div class="alert-panel-item alert-${alert.severity}">
                            <div class="alert-panel-item-header">
                                <div class="alert-panel-item-title">${alert.title}</div>
                                <span class="alert-panel-item-severity severity-${alert.severity}">
                                    ${severityLabels[alert.severity] || 'Info'}
                                </span>
                            </div>
                            <div class="alert-panel-item-message">${alert.message}</div>
                            <div class="alert-panel-item-time">${timeAgo}</div>
                            <div class="alert-panel-item-actions">
                                <button class="btn btn-sm btn-primary" onclick="alertSystem.acknowledgeAlert('${alert.id}')">
                                    <i class="fas fa-check"></i> Acknowledge
                                </button>
                                <button class="btn btn-sm btn-secondary" onclick="alertSystem.removeAlert('${alert.id}')">
                                    <i class="fas fa-times"></i> Dismiss
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');
            }
            
            updateBadge() {
                const unacknowledgedCount = this.activeAlerts.filter(a => !a.acknowledged).length;
                if (unacknowledgedCount > 0) {
                    this.alertBadge.textContent = unacknowledgedCount;
                    this.alertBadge.style.display = 'flex';
                } else {
                    this.alertBadge.style.display = 'none';
                }
            }
            
            getTimeAgo(timestamp) {
                const now = new Date();
                const diff = now - timestamp;
                const seconds = Math.floor(diff / 1000);
                const minutes = Math.floor(seconds / 60);
                const hours = Math.floor(minutes / 60);
                
                if (seconds < 60) return `${seconds} detik yang lalu`;
                if (minutes < 60) return `${minutes} menit yang lalu`;
                if (hours < 24) return `${hours} jam yang lalu`;
                return timestamp.toLocaleString('id-ID');
            }
            
            playAlertSound() {
                // Create audio context untuk sound alert (optional)
                try {
                    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    const oscillator = audioContext.createOscillator();
                    const gainNode = audioContext.createGain();
                    
                    oscillator.connect(gainNode);
                    gainNode.connect(audioContext.destination);
                    
                    oscillator.frequency.value = 800;
                    oscillator.type = 'sine';
                    
                    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
                    
                    oscillator.start(audioContext.currentTime);
                    oscillator.stop(audioContext.currentTime + 0.5);
                } catch (error) {
                    console.warn('Sound alert tidak didukung:', error);
                }
            }
            
            enableSound() {
                this.soundEnabled = true;
            }
            
            disableSound() {
                this.soundEnabled = false;
            }
        }

        document.addEventListener('DOMContentLoaded', function() {
            console.log("[DOMReady] DOM fully loaded. Initializing application...");
            
            // Start with sidebar collapsed for more map space on desktop
            if (window.innerWidth >= 768) {
                $('body').addClass('sidebar-toggled');
                $('.sidebar').addClass('toggled');
            }
            
            try {
                initializeMap();
            } catch(e) {
                console.error("[DOMReady] FATAL ERROR during initializeMap:", e);
                 $('#interactiveMap').html('<div class="alert alert-danger text-center"><strong>Peta Gagal Dimuat!</strong> Error kritis. Cek konsol.</div>');
            }

            $('#manualFullscreenBtn').on('click', toggleFullScreenManual);
            
            // Map Sidebar Event Handlers
            $('#openMapSidebarBtn').on('click', toggleMapSidebar);
            $('#toggleMapSidebar').on('click', toggleMapSidebar);
            $('#mapSidebarOverlay').on('click', toggleMapSidebar);
            
            // Search functionality
            $('#sidebarSearchInput').on('input', function() {
                const query = $(this).val();
                if (sidebarSearchTimeout) clearTimeout(sidebarSearchTimeout);
                sidebarSearchTimeout = setTimeout(() => {
                    performSidebarSearch(query);
                }, 300);
            });
            
            $('#sidebarSearchBtn').on('click', function() {
                performSidebarSearch($('#sidebarSearchInput').val());
            });
            
            // Quick filters
            $('#sidebarFilterOnline, #sidebarFilterOffline, #sidebarFilterOdc, #sidebarFilterOdp').on('change', function() {
                applySidebarFilters();
            });
            
            // Export buttons
            $('#exportCustomersBtn').on('click', exportCustomers);
            $('#exportAssetsBtn').on('click', exportAssets);
            $('#exportMapBtn').on('click', exportMap);
            
            // Initialize alerts
            updateSidebarAlerts();
            
            // Initialize Alert System
            alertSystem = new AlertSystem();
            
            // Quick Filter Buttons Event Handlers
            $('.quick-filter-btn').on('click', function() {
                const filter = $(this).data('filter');
                applyQuickFilter(filter);
            });
            
            $('#resetQuickFilterBtn').on('click', function() {
                applyQuickFilter('all');
            });
            
            // Alert Panel Event Handlers
            $('#openAlertPanelBtn').on('click', function() {
                $('#alertPanel').addClass('open');
                $(this).hide();
            });
            
            $('#closeAlertPanel').on('click', function() {
                $('#alertPanel').removeClass('open');
                $('#openAlertPanelBtn').show();
            });
            
            $('#toggleAlertPanel').on('click', function() {
                $('#alertPanel').toggleClass('minimized');
                const icon = $(this).find('i');
                if ($('#alertPanel').hasClass('minimized')) {
                    icon.removeClass('fa-minus').addClass('fa-plus');
                } else {
                    icon.removeClass('fa-plus').addClass('fa-minus');
                }
            });
            
            // Example: Test alerts (can be removed in production)
            // Uncomment to test alert system
            /*
            setTimeout(() => {
                alertSystem.addAlert({
                    title: 'Pelanggan Offline',
                    message: '5 pelanggan terdeteksi offline',
                    severity: 'warning'
                });
            }, 3000);
            
            setTimeout(() => {
                alertSystem.addAlert({
                    title: 'Koneksi Gagal',
                    message: 'Gagal mengambil data dari MikroTik',
                    severity: 'critical'
                });
            }, 5000);
            */
            
            // Monitor untuk auto-generate alerts (contoh: banyak pelanggan offline)
            setInterval(() => {
                if (alertSystem && customerMarkers && customerMarkers.length > 0) {
                    const offlineCount = customerMarkers.filter(m => m.customerOnlineStatus === 'offline').length;
                    const totalCount = customerMarkers.length;
                    const offlinePercentage = (offlineCount / totalCount) * 100;
                    
                    // Alert jika > 20% pelanggan offline
                    if (offlinePercentage > 20 && offlineCount > 5) {
                        const existingAlert = alertSystem.activeAlerts.find(a => a.id === 'high-offline-alert');
                        if (!existingAlert) {
                            alertSystem.addAlert({
                                id: 'high-offline-alert',
                                title: 'Tingkat Offline Tinggi',
                                message: `${offlineCount} dari ${totalCount} pelanggan offline (${offlinePercentage.toFixed(1)}%)`,
                                severity: 'warning',
                                duration: 10000
                            });
                        }
                    }
                }
            }, 60000); // Check setiap 1 menit

            $('#yesAddOdpBtn').on('click', async function() {
                const parentOdcId = this.getAttribute('data-odc-id');
                const lat = parseFloat(this.getAttribute('data-lat'));
                const lng = parseFloat(this.getAttribute('data-lng'));
                $('#addOdpAfterOdcModal').modal('hide');
                openAssetModal(null, lat, lng); 
                setTimeout(() => {
                    $('#assetType').val('ODP').trigger('change');
                    setTimeout(() => { 
                        $('#assetParentOdc').val(parentOdcId).trigger('change.select2');
                        $('#useParentOdcLocation').prop('checked', true).trigger('change');
                        const parentOdcAsset = allNetworkAssetsData.find(odc => odc.type === 'ODC' && odc.id == parentOdcId);
                        const parentOdcName = parentOdcAsset ? parentOdcAsset.name : `ODC-${parentOdcId}`;
                        const existingOdps = allNetworkAssetsData.filter(a => a.type === 'ODP' && a.parent_odc_id == parentOdcId &&
                                                Math.abs(parseFloat(a.latitude) - lat) < 0.00001 && Math.abs(parseFloat(a.longitude) - lng) < 0.00001).length;
                        $('#assetName').val(`${parentOdcName} - ODP ${String(existingOdps + 1).padStart(2, '0')}`).focus();
                    }, 150);
                }, 50);
            });

            $('#noAddOdpBtn').on('click', () => {
                $('#addOdpAfterOdcModal').modal('hide');
                displayGlobalMapMessage('ODC berhasil disimpan.', 'success');
            });
            
            
            $('#refreshAllDataBtn').on('click', async function() {
                if (!map) { displayGlobalMapMessage("Peta belum siap.", "warning"); return; }
                const button = $(this);
                const originalHtml = button.html();
                button.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Refreshing...');

                await loadAllMapData();
                updateConnectionMonitoring(); // Update monitoring setelah refresh

                let msg = `Refresh data selesai.`;
                 if (initialPppoeLoadFailed) {
                    msg = `Refresh selesai, namun pengambilan status PPPoE gagal.`;
                    displayGlobalMapMessage(msg, "warning", 10000);
                } else {
                    displayGlobalMapMessage(msg, "success", 7000);
                }

                button.prop('disabled', false).html(originalHtml);
            });

            const AUTO_REFRESH_INTERVAL_MS = 30000; // 30 detik
            $('#autoRefreshToggle').on('change', function() {
                if ($(this).is(':checked')) {
                    if (autoRefreshIntervalId) clearInterval(autoRefreshIntervalId);

                    const runAutoRefresh = async () => {
                        console.log(`[AutoRefresh] Running automatic data refresh at ${new Date().toLocaleTimeString()}`);
                        const refreshBtn = $('#refreshAllDataBtn');
                        if (refreshBtn.prop('disabled')) {
                            console.log('[AutoRefresh] Skipping as a manual refresh is already in progress.');
                            return;
                        }
                        
                        await loadAllMapData();
                        updateConnectionMonitoring(); // Update monitoring setelah refresh 
                        console.log('[AutoRefresh] Automatic data refresh finished.');
                    };

                    runAutoRefresh();
                    autoRefreshIntervalId = setInterval(runAutoRefresh, AUTO_REFRESH_INTERVAL_MS);
                    
                    const label = $(this).next('label');
                    displayGlobalMapMessage(`Auto refresh diaktifkan setiap ${AUTO_REFRESH_INTERVAL_MS / 1000} detik.`, 'info', 5000);
                    label.attr('title', `Nonaktifkan refresh data otomatis (interval ${AUTO_REFRESH_INTERVAL_MS / 1000} detik)`);

                } else {
                    if (autoRefreshIntervalId) {
                        clearInterval(autoRefreshIntervalId);
                        autoRefreshIntervalId = null;
                        console.log('[AutoRefresh] Stopped.');
                        displayGlobalMapMessage('Auto refresh dinonaktifkan.', 'info', 5000);
                        $(this).next('label').attr('title', 'Aktifkan refresh data otomatis setiap 30 detik');
                    }
                }
            });

            console.log("[DOMReady] Event listeners and page setup complete.");
        });
        
        // ============================================
        // Waypoint Editor Functions
        // ============================================

        // Cache SEMUA jalur manual, diambil SEKALI per muat peta. Sebelumnya tiap koneksi memanggil
        // `/api/map/waypoints` sendiri di dalam loop ber-await — 100 ODP = 100 permintaan berurutan
        // setiap kali peta dibuka.
        let manualRouteCache = null;

        function manualRouteKey(connectionType, sourceId, targetId) {
            return `${String(connectionType).toLowerCase()}|${sourceId}|${targetId}`;
        }

        async function preloadManualRoutes() {
            try {
                const response = await fetch('/api/map/waypoints/all', { credentials: 'include' });
                if (!response.ok) {
                    // Jangan diam: dulu 404 endpoint ini ditelan `if (response.ok)` tanpa cabang else,
                    // sehingga SEMUA garis diam-diam jatuh ke garis lurus tanpa seorang pun tahu.
                    console.warn(`[WAYPOINTS] Gagal memuat jalur manual (HTTP ${response.status}) — garis memakai routing/lurus.`);
                    manualRouteCache = new Map();
                    return manualRouteCache;
                }
                const data = await response.json();
                const rows = (data && data.data && Array.isArray(data.data.routes)) ? data.data.routes : [];
                // Simpan METER juga: panjang jalur = perkiraan kebutuhan kabel, dipakai popup ODP.
                manualRouteCache = new Map(rows.map(r => [r.key, { points: r.points, meters: r.meters || 0 }]));
                console.log(`[WAYPOINTS] ${manualRouteCache.size} jalur manual dimuat.`);
            } catch (error) {
                console.warn('[WAYPOINTS] Gagal memuat jalur manual:', error);
                manualRouteCache = new Map();
            }
            return manualRouteCache;
        }

        /**
         * Bentuk garis untuk satu koneksi, dengan urutan kepercayaan:
         *   1. JALUR MANUAL  — direkam manusia (web/`#JALUR` WA). Ini kebenaran.
         *   2. ROUTING API   — tebakan mesin yang mengikuti jalan (kalau dinyalakan).
         *   3. GARIS LURUS   — BELUM DIPETAKAN. Dikembalikan dengan tanda `straight` supaya bisa
         *                      digambar putus-putus: garis lurus yang menyamar jadi jalur = peta bohong.
         */
        async function resolveConnectionRoute(connectionType, sourceId, targetId, start, end, options = {}) {
            const straight = [[start.lat, start.lng], [end.lat, end.lng]];

            const cached = manualRouteCache ? manualRouteCache.get(manualRouteKey(connectionType, sourceId, targetId)) : null;
            const titikManual = cached && Array.isArray(cached.points) ? cached.points : null;
            if (titikManual && titikManual.length >= 2) {
                return { coordinates: titikManual, source: 'manual' };
            }

            if (options.allowRouting === false) return { coordinates: straight, source: 'straight' };

            try {
                const coordinates = await getRouteCoordinates(start.lat, start.lng, end.lat, end.lng, options.profile);
                // 2 titik = routing tak menghasilkan apa-apa (mati / gagal) → jujur: itu garis lurus.
                if (Array.isArray(coordinates) && coordinates.length > 2) {
                    return { coordinates, source: 'routing' };
                }
            } catch (error) {
                console.error(`[ROUTING_ERROR] ${connectionType}: ${sourceId} → ${targetId}:`, error);
            }
            return { coordinates: straight, source: 'straight' };
        }

        /** Garis lurus (= belum dipetakan) digambar putus-putus tipis, bukan seperti jalur sungguhan. */
        function routeStyleHint(source) {
            return source === 'straight' ? { dashArray: '6, 10', opacity: 0.45 } : {};
        }

        /**
         * Start editing waypoints for a connection
         */
        function startWaypointEditor(connectionType, sourceId, targetId) {
            if (!waypointEditorMode) {
                displayGlobalMapMessage('Aktifkan mode Edit Waypoint terlebih dahulu.', 'warning', 3000);
                return;
            }
            
            currentEditingConnection = { connectionType, sourceId, targetId };
            
            // Load existing waypoints
            loadWaypointsForEditing(connectionType, sourceId, targetId);
            
            // Enable map click untuk add waypoint
            map.on('click', onMapClickAddWaypoint);
            
            displayGlobalMapMessage(`Edit waypoint: ${connectionType} (${sourceId} → ${targetId}). Klik di map untuk tambah waypoint.`, 'info', 5000);
            
            // Update controls
            updateWaypointEditorControls();
        }
        
        /**
         * Load waypoints for editing
         */
        async function loadWaypointsForEditing(connectionType, sourceId, targetId) {
            try {
                const response = await fetch(`/api/map/waypoints?connectionType=${connectionType}&sourceId=${sourceId}&targetId=${targetId}`, {
                    credentials: 'include'
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.status === 200 && data.data && data.data.waypoints) {
                        // Clear existing waypoints
                        clearWaypointMarkers();
                        
                        // Add waypoint markers
                        data.data.waypoints.forEach((waypoint, index) => {
                            addWaypointMarker(waypoint[0], waypoint[1], index);
                        });
                    } else {
                        // No waypoints yet, create default (start and end points)
                        const startPoint = getStartPoint(connectionType, sourceId);
                        const endPoint = getEndPoint(connectionType, targetId);
                        
                        if (startPoint && endPoint) {
                            clearWaypointMarkers();
                            addWaypointMarker(startPoint.lat, startPoint.lng, 0);
                            addWaypointMarker(endPoint.lat, endPoint.lng, 1);
                        }
                    }
                }
            } catch (error) {
                console.error('[WAYPOINT_EDITOR] Error loading waypoints:', error);
                displayGlobalMapMessage('Gagal memuat waypoint.', 'danger', 3000);
            }
        }
        
        /**
         * Get start point coordinates
         */
        function getStartPoint(connectionType, sourceId) {
            if (connectionType === 'odc-odp') {
                const odcMarker = odcMarkers.find(m => String(m.assetData.id) === String(sourceId));
                if (odcMarker) {
                    const latLng = odcMarker.getLatLng();
                    return { lat: latLng.lat, lng: latLng.lng };
                }
            } else if (connectionType === 'customer-odp') {
                const customerMarker = customerMarkers.find(m => String(m.customerData?.id) === String(sourceId));
                if (customerMarker) {
                    const latLng = customerMarker.getLatLng();
                    return { lat: latLng.lat, lng: latLng.lng };
                }
            }
            return null;
        }
        
        /**
         * Get end point coordinates
         */
        function getEndPoint(connectionType, targetId) {
            const odpMarker = odpMarkers.find(m => String(m.assetData.id) === String(targetId));
            if (odpMarker) {
                const latLng = odpMarker.getLatLng();
                return { lat: latLng.lat, lng: latLng.lng };
            }
            return null;
        }
        
        /**
         * Add waypoint marker
         */
        function addWaypointMarker(lat, lng, index) {
            const waypointIcon = L.divIcon({
                className: 'waypoint-marker',
                html: `<div class="waypoint-marker-inner">
                    <i class="fas fa-map-marker-alt"></i>
                    <span class="waypoint-index">${index + 1}</span>
                </div>`,
                iconSize: [30, 40],
                iconAnchor: [15, 40]
            });
            
            const marker = L.marker([lat, lng], {
                icon: waypointIcon,
                draggable: true,
                zIndexOffset: 1000
            });
            
            marker.waypointIndex = index;
            
            // Drag event
            marker.on('dragend', function() {
                updateWaypointOrder();
            });
            
            // Click to delete (with confirmation)
            marker.on('click', function(e) {
                if (e.originalEvent.ctrlKey || e.originalEvent.metaKey) {
                    // Ctrl/Cmd + Click to delete
                    if (waypointMarkers.length <= 2) {
                        displayGlobalMapMessage('Minimal harus ada 2 waypoint (start dan end).', 'warning', 3000);
                        return;
                    }
                    
                    if (confirm(`Hapus waypoint ${index + 1}?`)) {
                        const markerIndex = waypointMarkers.indexOf(marker);
                        if (markerIndex > -1) {
                            waypointMarkers.splice(markerIndex, 1);
                            waypointLayer.removeLayer(marker);
                            map.removeLayer(marker);
                            updateWaypointOrder();
                            displayGlobalMapMessage(`Waypoint ${index + 1} dihapus.`, 'success', 2000);
                        }
                    }
                }
            });
            
            waypointMarkers.push(marker);
            waypointLayer.addLayer(marker);
            marker.addTo(map);
            
            // Update controls
            updateWaypointEditorControls();
        }
        
        /**
         * Clear all waypoint markers
         */
        function clearWaypointMarkers() {
            waypointMarkers.forEach(marker => {
                waypointLayer.removeLayer(marker);
                map.removeLayer(marker);
            });
            waypointMarkers = [];
            
            // Update controls
            updateWaypointEditorControls();
        }
        
        /**
         * Update waypoint order after drag
         */
        function updateWaypointOrder() {
            waypointMarkers.forEach((marker, index) => {
                marker.waypointIndex = index;
                const icon = marker.getIcon();
                if (icon && icon.options && icon.options.html) {
                    icon.options.html = `<div class="waypoint-marker-inner">
                        <i class="fas fa-map-marker-alt"></i>
                        <span class="waypoint-index">${index + 1}</span>
                    </div>`;
                    marker.setIcon(icon);
                }
            });
        }
        
        /**
         * Handle map click to add waypoint
         */
        function onMapClickAddWaypoint(e) {
            if (!waypointEditorMode || !currentEditingConnection) return;
            
            const { lat, lng } = e.latlng;
            const newIndex = waypointMarkers.length;
            addWaypointMarker(lat, lng, newIndex);
            
            displayGlobalMapMessage(`Waypoint ${newIndex + 1} ditambahkan. Drag untuk pindahkan, Ctrl+Click untuk hapus.`, 'success', 3000);
        }
        
        /**
         * Save waypoints
         */
        async function saveWaypoints() {
            if (!currentEditingConnection || waypointMarkers.length < 2) {
                displayGlobalMapMessage('Minimal harus ada 2 waypoint (start dan end).', 'warning', 3000);
                return;
            }
            
            const waypoints = waypointMarkers.map(marker => {
                const latLng = marker.getLatLng();
                return [latLng.lat, latLng.lng];
            });
            
            try {
                const response = await fetch('/api/map/waypoints', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        connectionType: currentEditingConnection.connectionType,
                        sourceId: currentEditingConnection.sourceId,
                        targetId: currentEditingConnection.targetId,
                        waypoints: waypoints
                    })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.status === 200) {
                        displayGlobalMapMessage('Waypoint berhasil disimpan! Refresh map untuk melihat perubahan.', 'success', 5000);
                        exitWaypointEditor();
                        // Auto refresh setelah 2 detik
                        setTimeout(() => {
                            loadAllMapData();
                        }, 2000);
                    } else {
                        displayGlobalMapMessage(data.message || 'Gagal menyimpan waypoint.', 'danger', 3000);
                    }
                } else {
                    const errorData = await response.json().catch(() => ({ message: 'Gagal menyimpan waypoint.' }));
                    displayGlobalMapMessage(errorData.message || 'Gagal menyimpan waypoint.', 'danger', 3000);
                }
            } catch (error) {
                console.error('[WAYPOINT_EDITOR] Error saving waypoints:', error);
                displayGlobalMapMessage('Gagal menyimpan waypoint.', 'danger', 3000);
            }
        }
        
        /**
         * Delete waypoints
         */
        async function deleteWaypoints() {
            if (!currentEditingConnection) return;
            
            if (!confirm('Hapus waypoint manual untuk koneksi ini? Garis akan kembali menggunakan routing API atau straight line.')) {
                return;
            }
            
            try {
                const response = await fetch(`/api/map/waypoints?connectionType=${currentEditingConnection.connectionType}&sourceId=${currentEditingConnection.sourceId}&targetId=${currentEditingConnection.targetId}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
                
                if (response.ok) {
                    displayGlobalMapMessage('Waypoint berhasil dihapus! Refresh map untuk melihat perubahan.', 'success', 5000);
                    exitWaypointEditor();
                    // Auto refresh setelah 2 detik
                    setTimeout(() => {
                        loadAllMapData();
                    }, 2000);
                } else {
                    const errorData = await response.json().catch(() => ({ message: 'Gagal menghapus waypoint.' }));
                    displayGlobalMapMessage(errorData.message || 'Gagal menghapus waypoint.', 'danger', 3000);
                }
            } catch (error) {
                console.error('[WAYPOINT_EDITOR] Error deleting waypoints:', error);
                displayGlobalMapMessage('Gagal menghapus waypoint.', 'danger', 3000);
            }
        }
        
        /**
         * Exit waypoint editor
         */
        function exitWaypointEditor() {
            waypointEditorMode = false;
            currentEditingConnection = null;
            clearWaypointMarkers();
            map.off('click', onMapClickAddWaypoint);
            $('#editWaypointBtn').removeClass('active').html('<i class="fas fa-route"></i> Edit Waypoint');
            
            // Hide controls
            $('.waypoint-editor-controls').remove();
        }
        
        /**
         * Attach waypoint editor to connection line
         */
        function attachWaypointEditorToLine(line, connectionType, sourceId, targetId) {
            if (!line) return;
            
            // Make line clickable
            line.setStyle({ interactive: true });
            
            line.on('click', function(e) {
                if (waypointEditorMode) {
                    e.originalEvent.stopPropagation();
                    startWaypointEditor(connectionType, sourceId, targetId);
                }
            });
            
            // Add context menu hint
            line.on('mouseover', function() {
                if (waypointEditorMode) {
                    line.setStyle({ weight: line.options.weight + 1, opacity: 0.9 });
                }
            });
            
            line.on('mouseout', function() {
                if (waypointEditorMode) {
                    line.setStyle({ weight: line.options.weight - 1, opacity: line.options.opacity });
                }
            });
        }
        
        // Global functions untuk context menu
        window.startWaypointEditor = function(connectionType, sourceId, targetId) {
            if (!waypointEditorMode) {
                $('#editWaypointBtn').click();
            }
            startWaypointEditor(connectionType, sourceId, targetId);
        };
        
        window.deleteWaypointsForConnection = async function(connectionType, sourceId, targetId) {
            if (!confirm('Hapus waypoint manual untuk koneksi ini?')) return;
            
            try {
                const response = await fetch(`/api/map/waypoints?connectionType=${connectionType}&sourceId=${sourceId}&targetId=${targetId}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
                
                if (response.ok) {
                    displayGlobalMapMessage('Waypoint berhasil dihapus! Refresh map untuk melihat perubahan.', 'success', 5000);
                    // Reload map data
                    setTimeout(() => {
                        loadAllMapData();
                    }, 2000);
                }
            } catch (error) {
                console.error('[WAYPOINT_EDITOR] Error deleting waypoints:', error);
                displayGlobalMapMessage('Gagal menghapus waypoint.', 'danger', 3000);
            }
        };
        
        // Add save/delete buttons to waypoint editor
        function showWaypointEditorControls() {
            if (!currentEditingConnection) return;
            
            // Remove existing controls if any
            $('.waypoint-editor-controls').remove();
            
            const controls = $(`
                <div class="waypoint-editor-controls" style="position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 2000; background: white; padding: 15px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
                    <div class="d-flex align-items-center gap-2">
                        <button class="btn btn-success btn-sm" onclick="saveWaypoints()">
                            <i class="fas fa-save"></i> Simpan Waypoint
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="deleteWaypoints()">
                            <i class="fas fa-trash"></i> Hapus Waypoint
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="exitWaypointEditor()">
                            <i class="fas fa-times"></i> Batal
                        </button>
                        <span class="ml-2 text-muted">${waypointMarkers.length} waypoint</span>
                    </div>
                </div>
            `);
            
            $('body').append(controls);
        }
        
        // Update waypoint editor controls
        function updateWaypointEditorControls() {
            if (currentEditingConnection) {
                showWaypointEditorControls();
            } else {
                $('.waypoint-editor-controls').remove();
            }
        }
        
        // Make functions global
        window.saveWaypoints = saveWaypoints;
        window.deleteWaypoints = deleteWaypoints;
        window.exitWaypointEditor = exitWaypointEditor;
        
        // Update controls when waypoints change - call updateWaypointEditorControls() in relevant functions
        // This is done inline in addWaypointMarker, clearWaypointMarkers, startWaypointEditor, exitWaypointEditor
