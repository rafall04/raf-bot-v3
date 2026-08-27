        // Global variables
        let dataTableInstance = null;
        let autoRefreshInterval = null;
        let matchedData = [];
        let usersData = [];
        let activePppoeUsersMap = new Map();
        let pppoeUserMacMap = new Map();
        let currentCustomerData = null;
        let oltColdRetryDone = false;
        let currentOltFilter = '';      // '' = belum pilih | 'all' = semua | id OLT tertentu
        let currentViewMode = 'all';    // 'all' | 'bot' | 'mikrotik' | 'tanpa' — lihat saringIdentitas()
        let currentRedaman = '';        // '' | 'kritis' | 'peringatan' | 'baik' | 'takterbaca'
        let oltDevicesList = [];        // daftar OLT dari API (untuk dropdown)
        let oltLoading = false;         // guard supaya tidak dobel-fetch saat load berjalan
        const AUTO_REFRESH_INTERVAL = 30000;

        $(document).ready(async function() {
            loadTechnicianInfo();
            initDataTable();
            initOltViewControls();
            // Pastikan data pelanggan siap sebelum query OLT agar enrichment lengkap di paint pertama
            await loadUsersData();
            await loadDevicesOnly(); // hanya isi dropdown OLT; data ONU dimuat setelah pilih OLT
            
            $('#refreshOltBtn').on('click', () => loadAllData(true, true)); // Refresh = paksa data segar
            $('#autoRefreshToggle').on('change', function() {
                this.checked ? startAutoRefresh() : stopAutoRefresh();
            });
            $('#statusFilter').on('change', function() {
                filterByStatus(this.value);
            });
            $('#redamanFilter').on('change', function () {
                currentRedaman = this.value || '';
                terapkanFilterTabel();
            });
            $('#sortFilter').on('change', function() {
                applySorting(this.value);
            });
            
            // Stats card click to filter
            $('.olt-stats-card').on('click', function() {
                const filter = $(this).data('filter');
                $('#statusFilter').val(filter).trigger('change');
            });
            
            // Refresh button in modal
            $('#refreshCustomerOltBtn').on('click', refreshCustomerOlt);
        });

        function loadTechnicianInfo() {
            fetch('/api/me', { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200 && data.user) {
                        $('#loggedInTechnicianInfo').text(data.user.name || data.user.username);
                    }
                }).catch(console.error);
        }

        async function loadUsersData() {
            try {
                const res = await fetch('/api/users?limit=9999', { credentials: 'include' });
                const result = await res.json();
                if (result.status === 200 && result.data) {
                    usersData = result.data;
                    console.log(`[Users] Loaded ${usersData.length} users`);
                }
            } catch (e) { console.error('Error loading users:', e); }
        }

        function initDataTable() {
            dataTableInstance = $('#oltDataTable').DataTable({
                data: [],
                columns: [
                    {
                        data: null, title: 'Pelanggan / ONU',
                        render: (data, type, row) => {
                            if (type === 'display') {
                                if (row.customer_name) {
                                    let html = `<strong>${row.customer_name}</strong>`;
                                    if (String(row.account_type || '').toLowerCase() === 'infrastruktur') {
                                        html += ` <span class="badge badge-dark" title="Akun infrastruktur (CCTV/monitoring)">INFRA</span>`;
                                    }
                                    if (row.customer_address) {
                                        const addr = row.customer_address.length > 30 ? row.customer_address.substring(0, 30) + '...' : row.customer_address;
                                        html += `<br><small class="customer-info">${addr}</small>`;
                                    }
                                    return html;
                                }
                                // Belum terdaftar di bot — tapi identitasnya mungkin MASIH ADA
                                // di MikroTik (#b284). ONU EPON tak membawa description/serial,
                                // jadi tanpa ini barisnya cuma strip dan tak bisa dikerjakan.
                                if (row.identitas_sumber === 'mikrotik' && row.pppoe_username) {
                                    let h = `<strong class="olt-tak-terdaftar">${row.pppoe_username}</strong>`;
                                    h += ` <span class="badge badge-warning" title="Ada sesi PPPoE aktif di MikroTik, tapi belum didaftarkan di bot">BELUM DIDAFTARKAN</span>`;
                                    if (row.mikrotik_ip) h += `<br><small class="customer-info">IP ${row.mikrotik_ip}</small>`;
                                    return h;
                                }
                                // Tak ada identitas dari sumber mana pun.
                                const ident = row.description || row.serial || '-';
                                return `<span class="text-muted"><i class="fas fa-plug"></i> ${ident}</span><br><small class="text-muted">(tanpa identitas)</small>`;
                            }
                            return row.customer_name || row.description || row.serial || '';
                        }
                    },
                    { 
                        data: 'pppoe_username', title: 'PPPoE',
                        render: (data, type, row) => {
                            if (type === 'display') {
                                let html = data || '-';
                                if (row.is_online) html += ' <span class="badge badge-success">ON</span>';
                                return html;
                            }
                            return data || '';
                        }
                    },
                    { 
                        data: 'rx_power', title: 'Redaman',
                        render: (data, type, row) => {
                            if (type === 'display') return renderRxPower(data, row);
                            if (type === 'sort' || type === 'type') {
                                // N/A → 9999 supaya tersortir ke BAWAH (redaman valid tampil dulu).
                                if (data && data !== 'N/A') {
                                    const num = parseFloat(data);
                                    return isNaN(num) ? 9999 : num;
                                }
                                return 9999;
                            }
                            return data;
                        }
                    },
                    {
                        data: 'tx_power', title: 'ONU Tx',
                        render: (data) => (data && data !== 'N/A') ? data : '<span class="text-muted">-</span>'
                    },
                    {
                        data: 'attenuation', title: 'Atenuasi',
                        render: (data) => (data && data !== 'N/A') ? data : '<span class="text-muted">-</span>'
                    },
                    {
                        data: 'olt_status', title: 'Status',
                        render: (data, type, row) => type === 'display' ? renderOltStatus(row) : data || ''
                    },
                    {
                        data: 'last_down_cause', title: 'Penyebab',
                        render: (data, type, row) => type === 'display' ? renderCause(row) : (data || '')
                    },
                    {
                        data: 'olt_name', title: 'OLT',
                        render: (data, type, row) => type === 'display' ? renderOltName(row) : (data || '')
                    },
                    {
                        data: null, title: 'Slot/ONU',
                        render: (data, type, row) => {
                            if (row.pon_name) return row.pon_name; // GPON: label human (ONU-1:1)
                            return (row.slot_id && row.onu_id) ? `${row.slot_id}/${row.onu_id}` : '-';
                        }
                    },
                    {
                        data: null, title: 'Aksi', orderable: false, searchable: false,
                        render: (data, type, row) => {
                            return `<button class="btn btn-info btn-sm btn-detail" data-key="${row._key}" title="Lihat Detail">
                                <i class="fas fa-info-circle"></i>
                            </button>`;
                        }
                    }
                ],
                order: [[2, 'asc']], // Default: Redaman ascending (terburuk dulu)
                pageLength: 25,
                language: {
                    search: "Cari:", lengthMenu: "Tampilkan _MENU_",
                    info: "_START_-_END_ dari _TOTAL_", infoEmpty: "Tidak ada data",
                    infoFiltered: "(filter dari _MAX_)", zeroRecords: "Tidak ditemukan",
                    paginate: { first: "«", last: "»", next: "›", previous: "‹" }
                },
                dom: '<"row"<"col-sm-12 col-md-6"l><"col-sm-12 col-md-6"f>>rtip',
                createdRow: function(row, data) {
                    $(row).addClass('clickable-row').attr('data-key', data._key);
                }
            });

            // Row click handler
            $('#oltDataTable tbody').on('click', 'tr.clickable-row', function(e) {
                if ($(e.target).closest('button').length) return; // Ignore button clicks
                const key = $(this).data('key');
                if (key) showCustomerDetail(key);
            });

            // Button click handler
            $('#oltDataTable tbody').on('click', '.btn-detail', function(e) {
                e.stopPropagation();
                const key = $(this).data('key');
                if (key) showCustomerDetail(key);
            });
        }

        async function loadAllData(showLoading = false, force = false) {
            // Belum pilih OLT → jangan query apa pun.
            if (!currentOltFilter) { showOltEmptyState(); return; }
            if (oltLoading) return; // cegah dobel-fetch
            oltLoading = true;

            // Overlay penuh hanya untuk load eksplisit / pertama; auto-refresh senyap.
            const explicit = showLoading || matchedData.length === 0;
            if (explicit) {
                setControlsLoading(true);
                const dev = oltDevicesList.find(d => d.id === currentOltFilter);
                const oltName = currentOltFilter === 'all' ? 'semua OLT' : (dev ? dev.name : 'OLT');
                showLoadingOverlay('Memuat data ONU…', 'Menghubungi ' + oltName + ' — OLT besar bisa ~30 detik');
            }

            try {
                await loadPppoeData();
                const result = await loadOltMatchedData(force); // force hanya saat tombol Refresh (bukan saat pilih OLT)
                updateLastUpdateTime(result && result.freshness);
                if (result) reportDataQuality(result);
            } catch (e) {
                console.error('Error:', e);
                showAlert('danger', 'Gagal memuat data: ' + e.message);
            } finally {
                if (explicit) { hideLoadingOverlay(); setControlsLoading(false); }
                oltLoading = false;
            }
        }

        // ── Loading overlay & kontrol ────────────────────────────────────
        function showLoadingOverlay(title, sub) {
            $('#oltLoadingTitle').text(title || 'Memuat data ONU…');
            $('#oltLoadingSub').text(sub || '');
            $('#oltEmptyState').hide();
            $('#oltTableWrap').show();
            $('#oltLoadingOverlay').css('display', 'flex');
            hideAlert();
        }
        function hideLoadingOverlay() { $('#oltLoadingOverlay').hide(); }

        function setControlsLoading(on) {
            $('#oltSelector').prop('disabled', on);
            $('#refreshOltBtn').prop('disabled', on).toggleClass('is-loading', on)
                .html(on ? '<i class="fas fa-spinner fa-spin"></i> Memuat…' : '<i class="fas fa-sync-alt"></i> Refresh');
        }

        async function loadPppoeData() {
            try {
                const res = await fetch('/api/mikrotik/ppp-active-users?_=' + Date.now(), { credentials: 'include' });
                const result = await res.json();
                if (result.status === 200 && Array.isArray(result.data)) {
                    activePppoeUsersMap.clear();
                    pppoeUserMacMap.clear();
                    result.data.forEach(u => {
                        if (u.name) {
                            activePppoeUsersMap.set(u.name, u.address || '');
                            if (u.caller_id) pppoeUserMacMap.set(u.name, u.caller_id);
                        }
                    });
                }
            } catch (e) { console.error('PPPoE error:', e); }
        }

        // Kontrol view OLT-centric: dropdown pilih OLT + toggle Semua ONU / Pelanggan.
        function initOltViewControls() {
            $('#oltSelector').on('change', function () {
                currentOltFilter = this.value; // '' | 'all' | id
                oltColdRetryDone = false;
                if (!currentOltFilter) { showOltEmptyState(); return; }
                loadAllData(true, false); // overlay + SWR (instan bila ter-cache)
            });
            // Penyaring IDENTITAS bekerja di tingkat DATA (bukan pencarian tabel) supaya
            // kartu statistik ikut mengikuti kelompok yang sedang dipilih.
            $('#identitasFilter').on('change', function () {
                currentViewMode = this.value || 'all';
                if (currentOltFilter) renderCurrentView();
            });
        }

        // Hanya isi dropdown OLT (tanpa query ONU). "Pilih OLT dulu, baru ambil data."
        async function loadDevicesOnly() {
            try {
                const res = await fetch('/api/olt/onus?devicesOnly=true&_=' + Date.now(), { credentials: 'include' });
                const result = await res.json();
                if (result.status === 200) {
                    if (!result.enabled) {
                        showAlert('warning', 'OLT tidak diaktifkan. Aktifkan di Konfigurasi.');
                        return;
                    }
                    populateOltSelector(result.oltDevices || []);
                    showOltEmptyState();
                }
            } catch (e) {
                console.error('Load devices error:', e);
                showAlert('danger', 'Gagal memuat daftar OLT: ' + e.message);
            }
        }

        function showOltEmptyState() {
            updateStats(0, 0, 0, 0);
            if (dataTableInstance) dataTableInstance.clear().draw();
            hideLoadingOverlay();
            $('#oltTableWrap').hide();
            $('#oltEmptyState').show();
            hideAlert();
        }

        function populateOltSelector(devices) {
            oltDevicesList = devices || [];
            const opts = ['<option value="">— Pilih OLT —</option>', '<option value="all">Semua OLT</option>'].concat(
                oltDevicesList.map(d => {
                    const tag = d.brand && d.brand !== 'auto' ? ` (${String(d.brand).toUpperCase()})` : '';
                    return `<option value="${d.id}">${d.name}${tag}</option>`;
                })
            );
            const $sel = $('#oltSelector');
            if ($sel.children().length !== opts.length) $sel.html(opts.join(''));
            $sel.val(currentOltFilter);
        }


        // Aturan penyaringan tinggal di SATU modul bersama supaya halaman admin & teknisi
        // tak bisa berbeda pendapat — dan bisa diuji tanpa DOM. Lihat olt-filter-core.js.
        const OltFilter = window.OltFilterCore;
        const saringIdentitas = (rows, mode) => OltFilter.saringIdentitas(rows, mode);
        const kelasRedaman = (row) => OltFilter.kelasRedaman(row);

        function renderCurrentView() {
            const view = saringIdentitas(matchedData, currentViewMode);
            updateStatsFromData(view);
            dataTableInstance.clear().rows.add(view).draw();
            $('#oltEmptyState').hide();
            $('#oltTableWrap').show();
            const $wrap = $('#oltTableWrap').addClass('olt-just-loaded');
            setTimeout(() => $wrap.removeClass('olt-just-loaded'), 400);
        }

        async function loadOltMatchedData(force = false) {
            if (!currentOltFilter) { showOltEmptyState(); return; }
            try {
                const oltParam = (currentOltFilter && currentOltFilter !== 'all')
                    ? '&oltId=' + encodeURIComponent(currentOltFilter) : '';
                const forceParam = force ? '&force=true' : '';
                const res = await fetch('/api/olt/onus?_=' + Date.now() + oltParam + forceParam, { credentials: 'include' });
                const result = await res.json();

                if (result.status === 200) {
                    if (!result.enabled) {
                        showAlert('warning', 'OLT tidak diaktifkan. Aktifkan di Konfigurasi.');
                        updateStats(0, 0, 0, 0);
                        dataTableInstance.clear().draw();
                        return;
                    }
                    if (result.error) {
                        showAlert('danger', result.message || 'Gagal mengambil data OLT');
                        return;
                    }

                    if (Array.isArray(result.oltDevices)) populateOltSelector(result.oltDevices);

                    matchedData = result.data || [];

                    // Enrich with user data and online status
                    matchedData.forEach(item => {
                        item._key = `${item.olt_id}|${item.slot_id}|${item.onu_id}`;
                        item.is_online = activePppoeUsersMap.has(item.pppoe_username);
                        if (item.user_id) {
                            const user = usersData.find(u => u.id == item.user_id);
                            if (user) {
                                item.customer_phone = user.phone || item.customer_phone;
                                item.customer_package = user.subscription || item.customer_package;
                                item.customer_address = user.address || item.customer_address;
                            }
                        }
                    });

                    renderCurrentView();
                    hideAlert();

                    // Cold-start backend: poll OLT/SNMP pertama bisa belum siap sehingga data kosong.
                    // Lakukan satu kali retry otomatis agar teknisi tidak perlu menekan Refresh manual.
                    if (matchedData.length === 0 && !oltColdRetryDone) {
                        oltColdRetryDone = true;
                        showAlert('info', 'Menyiapkan data OLT… memuat ulang otomatis.');
                        setTimeout(() => loadAllData(false), 6000);
                    }
                    return result; // dipakai pemanggil untuk umur data + peringatan mutu data
                }
            } catch (e) {
                console.error('OLT error:', e);
                showAlert('danger', 'Gagal terhubung: ' + e.message);
            }
            return null;
        }

        function showCustomerDetail(key) {
            const customer = matchedData.find(m => m._key === key);
            if (!customer) {
                alert('Data ONU tidak ditemukan');
                return;
            }

            currentCustomerData = customer;

            // Update modal content (ONU belum terdaftar → pakai identitas ONU).
            const displayName = customer.customer_name || customer.pppoe_username || customer.description || customer.serial || 'Detail ONU';
            $('#modalCustomerName').text(displayName);
            // Pelanggan tak terdaftar tetap punya nama kerja: nama PPPoE dari MikroTik (#b284).
            $('#modalName').html(customer.customer_name
                ? customer.customer_name
                : (customer.identitas_sumber === 'mikrotik'
                    ? `${customer.pppoe_username} <span class="badge badge-warning">BELUM DIDAFTARKAN</span>`
                    : '(tanpa identitas)'));
            $('#modalPppoe').text(customer.pppoe_username || '-');
            $('#modalPackage').text(customer.customer_package || '-');
            // Belum terdaftar = tak ada alamat/paket/telepon. Yang BERGUNA untuk teknisi
            // adalah konteks jaringannya; tampilkan itu daripada tiga strip kosong.
            if (!customer.customer_name && customer.identitas_sumber === 'mikrotik') {
                const bagian = [];
                if (customer.mikrotik_ip) bagian.push('IP ' + customer.mikrotik_ip);
                if (customer.mikrotik_uptime) bagian.push('aktif ' + customer.mikrotik_uptime);
                if (customer.mikrotik_interface) bagian.push(customer.mikrotik_interface);
                $('#modalAddress').html(bagian.length
                    ? `<span class="text-muted">${bagian.join(' · ')}</span>`
                    : '<span class="text-muted">— (belum didaftarkan di bot)</span>');
            } else {
                $('#modalAddress').text(customer.customer_address || '-');
            }
            $('#modalPhone').text(customer.customer_phone || '-');
            const brandBadge = customer.olt_brand === 'zte'
                ? ' <span class="badge badge-info" title="GPON">ZTE GPON</span>'
                : (customer.olt_brand === 'hioso' ? ' <span class="badge badge-secondary" title="EPON">HIOSO</span>' : '');
            $('#modalOltName').html((customer.olt_name || '-') + brandBadge);

            // GPON tanpa MAC ONU → tampilkan Serial Number.
            if (customer.mac_olt && customer.mac_olt !== 'N/A') {
                $('#modalMacOlt').text(customer.mac_olt);
            } else if (customer.serial) {
                $('#modalMacOlt').text('SN: ' + customer.serial);
            } else {
                $('#modalMacOlt').text('-');
            }

            // MAC MikroTik dengan indikator source
            let macMikrotikHtml = customer.mac_mikrotik || '-';
            if (customer.mac_source === 'cached') {
                macMikrotikHtml += ' <span class="badge badge-warning" title="MAC dari cache (pelanggan offline)"><i class="fas fa-history"></i></span>';
            } else if (customer.mac_source === 'olt' || (!customer.mac_mikrotik && customer.olt_brand === 'zte')) {
                macMikrotikHtml = '<span class="text-muted">— (match via PPPoE)</span>';
            }
            $('#modalMacMikrotik').html(macMikrotikHtml);

            $('#modalSlotOnu').text(customer.pon_name || ((customer.slot_id && customer.onu_id) ? `${customer.slot_id} / ${customer.onu_id}` : '-'));
            
            // Connection status
            const isOnline = activePppoeUsersMap.has(customer.pppoe_username);
            $('#modalConnectionStatus').html(isOnline ? 
                '<span class="badge badge-success"><i class="fas fa-check"></i> Online</span>' : 
                '<span class="badge badge-secondary"><i class="fas fa-times"></i> Offline</span>');
            
            // RX Power
            updateModalRxPower(customer.rx_power, customer.olt_status, customer.is_dying_gasp, customer.is_los);

            // Optik GPON tambahan (ONU Tx + Atenuasi) — hanya ZTE.
            if (customer.olt_brand === 'zte' && (customer.tx_power || customer.attenuation)) {
                $('#modalOnuTx').text(customer.tx_power && customer.tx_power !== 'N/A' ? customer.tx_power : '-');
                $('#modalAtten').text(customer.attenuation && customer.attenuation !== 'N/A' ? customer.attenuation : '-');
                $('#modalGponOptic').show();
            } else {
                $('#modalGponOptic').hide();
            }

            $('#modalLastCheck').text('Terakhir cek: ' + new Date().toLocaleTimeString('id-ID'));
            
            // Penyebab dari data bulk (instan); waktu dimuat dari OLT di bawah (col5/col6).
            $('#modalCause').html(renderCause(customer, false));
            $('#modalUptime').text('…');
            $('#modalLastDown').text(formatDownSince(customer.down_since) || '…');
            $('#customerDetailModal').modal('show');
            if (customer.slot_id && customer.onu_id && customer.slot_id !== 'N/A') {
                refreshCustomerOlt({ silent: true });
            } else {
                $('#modalUptime').text('-');
                $('#modalLastDown').text('-');
            }
        }

        function updateModalRxPower(rxPower, oltStatus, isDyingGasp, isLos) {
            let rxClass = 'modal-rx-good';
            let rxStatus = 'Bagus';
            
            if (rxPower && rxPower !== 'N/A') {
                const val = parseFloat(rxPower);
                if (!isNaN(val)) {
                    if (val < -25) { rxClass = 'modal-rx-bad'; rxStatus = 'Buruk'; }
                    else if (val < -20) { rxClass = 'modal-rx-warning'; rxStatus = 'Perhatian'; }
                }
                // ONU tidak online → angka ini pembacaan TERAKHIR sebelum putus. Jangan divonis
                // "Bagus": OLT EPON menyimpan nilai lama dan itulah yang bikin ONU mati terbaca sehat.
                if (oltStatus !== 'Online') {
                    rxClass = '';
                    rxStatus = 'terakhir sebelum putus';
                }
                $('#modalRxPower').removeClass('modal-rx-good modal-rx-warning modal-rx-bad').addClass(rxClass).text(rxPower);
                $('#modalRxStatus').text(rxStatus);
            } else {
                $('#modalRxPower').removeClass('modal-rx-good modal-rx-warning modal-rx-bad').text('N/A');
                $('#modalRxStatus').text('-');
            }
            
            // OLT Status
            let statusHtml = '';
            if (isDyingGasp) {
                statusHtml = '<span class="badge badge-danger"><i class="fas fa-bolt"></i> Dying Gasp</span>';
            } else if (isLos) {
                statusHtml = '<span class="badge badge-warning"><i class="fas fa-exclamation-triangle"></i> LOS</span>';
            } else if (oltStatus === 'Online') {
                statusHtml = '<span class="badge badge-success"><i class="fas fa-check"></i> Online</span>';
            } else {
                statusHtml = '<span class="badge badge-secondary"><i class="fas fa-times"></i> Offline</span>';
            }
            $('#modalOltStatus').html(statusHtml);
        }

        async function refreshCustomerOlt(opts = {}) {
            if (!currentCustomerData) return;
            
            // Pastikan ada slot_id dan onu_id
            if (!currentCustomerData.slot_id || !currentCustomerData.onu_id) {
                alert('Data Slot/ONU tidak tersedia untuk pelanggan ini');
                return;
            }
            
            const btn = $('#refreshCustomerOltBtn');
            btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Memuat...');
            
            try {
                // FAST REFRESH - query realtime untuk 1 ONT ini
                const res = await fetch('/api/olt/refresh-single', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        slotId: currentCustomerData.slot_id,
                        onuId: currentCustomerData.onu_id,
                        mac: currentCustomerData.mac_olt || currentCustomerData.mac_mikrotik || undefined
                    })
                });
                const result = await res.json();
                
                if (result.status === 200) {
                    if (result.error) {
                        // Error dari SNMP
                        if (!opts.silent) alert(result.message || 'Gagal mengambil data dari OLT');
                        $('#modalUptime').text('-'); $('#modalLastDown').text(formatDownSince(currentCustomerData && currentCustomerData.down_since) || '-');
                    } else if (result.data) {
                        // Data berhasil diambil (bisa Online atau Offline)
                        const data = result.data;
                        updateModalRxPower(data.rx_power, data.olt_status, data.is_dying_gasp, data.is_los);
                        $('#modalCause').html(renderCause(data, false));
                        const up = computeUptime(data.last_up_at);
                        $('#modalUptime').text(data.olt_status === 'Online' ? (up || '—') : '-');
                        $('#modalLastDown').text(formatDownSince(data.down_since || data.last_down_at) || formatDownSince(currentCustomerData && currentCustomerData.down_since) || '-');
                        $('#modalLastCheck').text('Terakhir cek: ' + new Date().toLocaleTimeString('id-ID'));
                        
                        // Update in matchedData array too
                        const idx = matchedData.findIndex(m => m.user_id == currentCustomerData.user_id);
                        if (idx !== -1) {
                            // Kesahihan redaman ikut diperbarui — kalau tidak, baris tetap memakai
                            // penilaian dari muat sebelumnya dan bisa kembali hijau walau ONU baru
                            // saja terpantau LOS.
                            const rxValid = data.olt_status === 'Online' && !isNaN(parseFloat(data.rx_power));
                            matchedData[idx].rx_power = data.rx_power;
                            matchedData[idx].rx_power_valid = rxValid;
                            matchedData[idx].olt_status = data.olt_status;
                            matchedData[idx].is_dying_gasp = data.is_dying_gasp;
                            matchedData[idx].is_los = data.is_los;
                            matchedData[idx].last_down_cause = data.last_down_cause;

                            // Update currentCustomerData juga
                            currentCustomerData.rx_power = data.rx_power;
                            currentCustomerData.rx_power_valid = rxValid;
                            currentCustomerData.olt_status = data.olt_status;
                            currentCustomerData.is_dying_gasp = data.is_dying_gasp;
                            currentCustomerData.is_los = data.is_los;

                            dataTableInstance.clear().rows.add(matchedData).draw();
                        }
                    } else {
                        // Tidak ada data (seharusnya tidak terjadi dengan perbaikan backend)
                        if (!opts.silent) alert('Data ONT tidak ditemukan di OLT');
                        $('#modalUptime').text('-'); $('#modalLastDown').text(formatDownSince(currentCustomerData && currentCustomerData.down_since) || '-');
                    }
                } else {
                    if (!opts.silent) alert(result.message || 'Gagal refresh data');
                    $('#modalUptime').text('-'); $('#modalLastDown').text(formatDownSince(currentCustomerData && currentCustomerData.down_since) || '-');
                }
            } catch (e) {
                console.error('Refresh error:', e);
                if (!opts.silent) alert('Gagal refresh: ' + e.message);
                $('#modalUptime').text('-'); $('#modalLastDown').text(formatDownSince(currentCustomerData && currentCustomerData.down_since) || '-');
            } finally {
                btn.prop('disabled', false).html('<i class="fas fa-sync-alt"></i> Refresh Redaman');
            }
        }

        // Redaman hanya diwarnai (hijau/kuning/merah) bila memang PENGUKURAN SAAT INI. OLT EPON
        // tetap menyimpan rxPower terakhir untuk ONU yang sudah mati, jadi tanpa penjagaan ini
        // pelanggan LOS bisa tampil "hijau, sinyal bagus" — persis yang bikin teknisi salah baca
        // saat kabel putus. Angkanya tetap ditampilkan (berguna sebagai jejak), tapi redup dan
        // diberi label "terakhir" supaya tak pernah terbaca sebagai kondisi kini.
        function renderRxPower(rxPower, row) {
            if (row && row.status_known === false) {
                return '<span class="text-muted" title="Status ONU tidak terbaca dari OLT (walk SNMP tidak lengkap) — redaman tak bisa dipercaya">'
                    + '<i class="fas fa-question-circle"></i> tak terbaca</span>';
            }
            if (!rxPower || rxPower === 'N/A') return '<span class="text-muted">N/A</span>';
            const val = parseFloat(rxPower);
            if (isNaN(val)) return `<span class="text-muted">${rxPower}</span>`;

            if (row && row.rx_power_valid === false) {
                return `<span class="text-muted" title="ONU tidak online — ini pembacaan TERAKHIR sebelum putus, bukan kondisi sekarang">`
                    + `<i class="fas fa-history"></i> ${rxPower} <small>(terakhir)</small></span>`;
            }

            let cls = 'rx-power-good', icon = 'fa-signal';
            if (val < -25) { cls = 'rx-power-bad'; icon = 'fa-exclamation-circle'; }
            else if (val < -20) { cls = 'rx-power-warning'; icon = 'fa-exclamation-triangle'; }

            return `<span class="${cls}"><i class="fas ${icon}"></i> ${rxPower}</span>`;
        }

        function renderOltStatus(row) {
            // DG/LOS dari syslog adalah bukti MANDIRI (tak lewat SNMP) — tetap dimenangkan.
            if (row.is_dying_gasp) return '<span class="badge badge-danger"><i class="fas fa-bolt"></i> DG</span>';
            if (row.is_los) return '<span class="badge badge-warning"><i class="fas fa-exclamation-triangle"></i> LOS</span>';
            // OLT-nya sendiri tak terbaca → status pelanggan ini TIDAK DIKETAHUI. Dulu ia jatuh ke
            // lencana silang abu-abu yang dibaca teknisi sebagai "mati" — kebutaan alat baca
            // tersaji sebagai vonis.
            if (row.status_known === false) {
                return '<span class="badge badge-light border text-muted" title="OLT tidak menjawab — status pelanggan ini TIDAK diketahui, bukan berarti offline">'
                    + '<i class="fas fa-question-circle"></i> ?</span>';
            }
            if (row.olt_status === 'Online') return '<span class="badge badge-success"><i class="fas fa-check"></i></span>';
            return '<span class="badge badge-secondary"><i class="fas fa-times"></i></span>';
        }

        // Penyebab offline terakhir (ZTE native): LOS/LOSi/SFi/DyingGasp. Online → "-".
        function renderCause(row, showSince = true) {
            if (row.olt_status === 'Online') return '<span class="text-muted">-</span>';
            // Penyebab HYBRID semua merk: klasifikasi LOG (Hioso & semua merk via is_los/
            // is_dying_gasp) diutamakan; fallback last_down_cause granular (ZTE native).
            let label = null, cls = 'badge-secondary';
            if (row.is_dying_gasp) { label = 'Dying Gasp'; cls = 'badge-danger'; }
            else if (row.is_los) { label = 'LOS'; cls = 'badge-warning'; }
            else if (row.last_down_cause) {
                label = row.last_down_cause;
                if (/dyinggasp/i.test(label)) cls = 'badge-danger';
                else if (/los|sfi/i.test(label)) cls = 'badge-warning';
            } else {
                label = 'Offline';
            }
            const badge = `<span class="badge ${cls}">${$('<div>').text(label).html()}</span>`;
            // "sejak" hanya untuk TABEL (tak ada kolom Terakhir-down). Di modal showSince=false
            // karena waktunya ditampilkan di field "Terakhir down" tersendiri (anti-redundan).
            const since = showSince ? formatDownSince(row.down_since) : null;
            return since
                ? `${badge}<br><small class="text-muted" title="Down sejak (waktu real, terkoreksi jam OLT): ${$('<div>').text(row.down_since).html()}">sejak ${since}</small>`
                : badge;
        }

        // Format ISO waktu down → "DD/MM HH:MM" (lokal). null/invalid → null.
        function formatDownSince(iso) {
            if (!iso) return null;
            const t = Date.parse(iso);
            if (isNaN(t)) return null;
            const d = new Date(t);
            const p = (n) => String(n).padStart(2, '0');
            return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
        }

        // Durasi online dari authpass terakhir (jam OLT WIB). Tahun <2025 = jam OLT belum di-set → null.
        function computeUptime(lastUpAt) {
            if (!lastUpAt || parseInt(String(lastUpAt).slice(0, 4), 10) < 2025) return null;
            const t = Date.parse(String(lastUpAt).replace(' ', 'T') + '+07:00');
            if (isNaN(t)) return null;
            let ms = Date.now() - t;
            if (ms < 0) ms = 0;
            const mins = Math.floor(ms / 60000);
            const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
            return (d > 0 ? d + 'h ' : '') + h + 'j ' + m + 'm';
        }

        function renderOltName(row) {
            if (!row.olt_name) return '<span class="text-muted">-</span>';
            const safeName = $('<div>').text(row.olt_name).html();
            const title = row.olt_host ? `Host: ${row.olt_host}` : 'Nama OLT';
            // Tanda "dari cache" hanya untuk EPON (match via MAC). GPON (ZTE) match via
            // PPPoE — mac_olt='N/A' itu normal, bukan tanda offline.
            const isGpon = row.olt_brand === 'zte';
            const cached = (row.mac_olt === 'N/A' && !isGpon)
                ? ' <i class="fas fa-history text-muted" title="Diketahui dari cache (ONT sedang offline)"></i>'
                : '';
            const brandTag = isGpon ? ' <span class="badge badge-info" title="GPON">GPON</span>' : '';
            return `<span class="badge badge-light border" title="${title}"><i class="fas fa-broadcast-tower text-primary mr-1"></i>${safeName}</span>${brandTag}${cached}`;
        }

        function updateStatsFromData(data) {
            let online = 0, offline = 0, los = 0, dyingGasp = 0;
            data.forEach(item => {
                if (item.is_dying_gasp) dyingGasp++;
                else if (item.is_los) los++;
                // Status tak terbaca TIDAK ikut dihitung offline. Menghitungnya membuat OLT yang
                // mati tampil sebagai lonjakan pelanggan mati — angka panik dari data yang justru
                // tidak ada. Jumlah kartu memang jadi tak menjumlah total, dan itu memang jujur.
                else if (item.status_known === false) { /* tak dihitung */ }
                else if (item.olt_status === 'Online') online++;
                else offline++;
            });
            updateStats(online, offline, los, dyingGasp);
        }

        function updateStats(online, offline, los, dyingGasp) {
            $('#statOnline').text(online);
            $('#statOffline').text(offline);
            $('#statLos').text(los);
            $('#statDyingGasp').text(dyingGasp);
        }

        // SATU penyaring gabungan untuk status + redaman.
        //
        // !! `$.fn.dataTable.ext.search` adalah array GLOBAL milik DataTables. Versi lama
        // menimpanya dengan `= []` setiap kali status berubah — menambah penyaring kedua
        // lewat jalur yang sama akan membuat keduanya saling menghapus diam-diam.
        function terapkanFilterTabel() {
            $.fn.dataTable.ext.search = [];
            const status = $('#statusFilter').val() || '';
            const redaman = currentRedaman || '';
            if (status || redaman) {
                $.fn.dataTable.ext.search.push((settings, data, dataIndex) => {
                    const row = dataTableInstance.row(dataIndex).data();
                    if (!row) return false;
                    if (redaman && kelasRedaman(row) !== redaman) return false;
                    switch (status) {
                        case 'online': return row.olt_status === 'Online' && !row.is_los && !row.is_dying_gasp;
                        // Sejalan dengan updateStatsFromData: yang statusnya tak terbaca bukan offline.
                        case 'offline': return row.olt_status !== 'Online' && row.status_known !== false
                            && !row.is_los && !row.is_dying_gasp;
                        case 'los': return row.is_los === true;
                        case 'dying_gasp': return row.is_dying_gasp === true;
                        default: return true;
                    }
                });
            }
            dataTableInstance.draw();
        }

        // Nama lama dipertahankan supaya pemanggil yang sudah ada tetap bekerja.
        function filterByStatus() { terapkanFilterTabel(); }

        function applySorting(sortType) {
            switch (sortType) {
                case 'rx_asc': dataTableInstance.order([2, 'asc']).draw(); break;
                case 'rx_desc': dataTableInstance.order([2, 'desc']).draw(); break;
                case 'name_asc': dataTableInstance.order([0, 'asc']).draw(); break;
                case 'name_desc': dataTableInstance.order([0, 'desc']).draw(); break;
            }
        }

        // UMUR DATA, bukan jam fetch. Jam browser saat fetch selesai TIDAK sama dengan kapan OLT
        // benar-benar dibaca: backend menyajikan snapshot ber-cache (stale-while-revalidate), jadi
        // isi tabel bisa jauh lebih tua dari label "baru saja diperbarui" — itu yang membuat data
        // basi dipercaya sebagai data nyata saat perbaikan kabel kemarin.
        function updateLastUpdateTime(freshness) {
            if (!freshness || !freshness.fetched_at || freshness.age_seconds === null) {
                $('#lastUpdateTime').html('<i class="fas fa-clock"></i> <span class="text-muted">umur data tak diketahui</span>');
                return;
            }
            const age = Number(freshness.age_seconds) || 0;
            const jam = new Date(freshness.fetched_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const umur = age < 60 ? `${age} dtk lalu` : `${Math.round(age / 60)} mnt lalu`;
            const basi = age >= 60;
            const cls = basi ? 'text-warning' : '';
            const icon = freshness.refreshing ? 'fa-sync fa-spin' : (basi ? 'fa-exclamation-triangle' : 'fa-clock');
            $('#lastUpdateTime').html(`<span class="${cls}"><i class="fas ${icon}"></i> data OLT ${jam} (${umur})</span>`);
        }

        // Peringatan sekali-lihat saat snapshot terlalu tua atau walk SNMP tidak lengkap. Diam-diam
        // menyajikan data setengah jadi adalah cara paling cepat membuat teknisi salah vonis.
        function reportDataQuality(result) {
            const walks = Array.isArray(result.incompleteWalks) ? result.incompleteWalks : [];
            if (walks.length) {
                const detail = walks.map(w => `${w.oltName || w.oltId}: ${(w.walks || []).join(', ')}`).join(' | ');
                showAlert('warning', `Data OLT TIDAK LENGKAP — sebagian pembacaan SNMP kosong (${detail}). Status/redaman di tabel belum tentu mencerminkan kondisi sebenarnya.`);
                return true;
            }
            const f = result.freshness;
            if (f && f.age_seconds !== null && f.max_age_seconds && f.age_seconds >= f.max_age_seconds) {
                showAlert('warning', `Data OLT berumur ${Math.round(f.age_seconds / 60)} menit dan belum berhasil diperbarui. Tekan Refresh sebelum mengambil keputusan.`);
                return true;
            }
            return false;
        }

        function startAutoRefresh() {
            if (autoRefreshInterval) return;
            autoRefreshInterval = setInterval(() => loadAllData(false), AUTO_REFRESH_INTERVAL);
        }

        function stopAutoRefresh() {
            if (autoRefreshInterval) { clearInterval(autoRefreshInterval); autoRefreshInterval = null; }
        }

        function showAlert(type, msg) {
            const icons = { info: 'fa-info-circle', warning: 'fa-exclamation-triangle', danger: 'fa-times-circle', success: 'fa-check-circle' };
            $('#oltStatusAlert').removeClass('alert-info alert-warning alert-danger alert-success')
                .addClass('alert-' + type).show();
            $('#oltStatusMessage').html('<i class="fas ' + (icons[type] || 'fa-info-circle') + '"></i> ' + msg);
        }

        function hideAlert() { $('#oltStatusAlert').hide(); }
