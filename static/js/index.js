        const socket = io();
        const startBtn = document.getElementById('start_btn');
        const qrImg = document.getElementById('qr_img');
        const qrContainerParent = document.getElementById('qr_container_parent');
        let financeOverviewLoaded = false;

        const showLoadingSpinner = (elementId) => {
            const el = document.getElementById(elementId);
            if (el) {
                el.innerHTML = `<div class="spinner-border spinner-border-sm" role="status"><span class="sr-only">Loading...</span></div>`;
            }
        };

        const animateCountUp = (elementId, endValue, isCurrency = false, duration = 1000) => {
            const element = document.getElementById(elementId);
            if (!element) return;

            // Hapus spinner jika ada sebelum animasi
            const spinner = element.querySelector('.spinner-border');
            if(spinner) spinner.remove();

            // Jika elemen sudah menampilkan 'N/A' atau 'Error', jangan animasi
            if (element.classList.contains('error-text')) {
                if (typeof endValue === 'string') element.textContent = endValue;
                return;
            }

            let startValue = 0;
            // Coba baca nilai numerik saat ini jika ada, untuk animasi dari nilai tersebut
            const currentText = element.textContent.replace(/[^\d,-]/g, '').replace(',', '.');
            const currentNumericValue = parseFloat(currentText);
            if (!isNaN(currentNumericValue) && element.textContent.trim() !== '') {
                startValue = currentNumericValue;
            }


            const startTime = Date.now();

            const formatValue = (value) => {
                if (isCurrency) {
                    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(value);
                }
                return Math.round(value).toLocaleString('id-ID');
            };

            if (typeof endValue !== 'number' || isNaN(endValue)) {
                 element.textContent = endValue;
                 if(endValue === 'N/A' || endValue === 'Error') element.classList.add('error-text');
                 else element.classList.remove('error-text');
                 return;
            }
            element.classList.remove('error-text');


            function updateCount() {
                const now = Date.now();
                const progress = Math.min(1, (now - startTime) / duration);
                let currentValue = startValue + (endValue - startValue) * progress;

                if (!isCurrency && Number.isInteger(startValue) && Number.isInteger(endValue)) {
                    currentValue = Math.round(currentValue);
                }

                element.textContent = formatValue(currentValue);

                if (progress < 1) {
                    requestAnimationFrame(updateCount);
                } else {
                    element.textContent = formatValue(endValue);
                }
            }
            requestAnimationFrame(updateCount);
        };

        const updateDashboardCard = (elementId, value, isCurrency = false, hasError = false) => {
            const el = document.getElementById(elementId);
            if(!el) {
                console.warn(`[DASHBOARD_CARD] Element not found: ${elementId}`);
                return;
            }


            // PENTING: Hapus semua konten (termasuk spinner) sebelum update value
            // Gunakan innerHTML = '' untuk memastikan spinner HTML benar-benar dihapus
            const spinner = el.querySelector('.spinner-border');
            if(spinner) {
                spinner.remove();
            }
            // Juga hapus semua child nodes untuk memastikan tidak ada sisa HTML
            while(el.firstChild) {
                el.removeChild(el.firstChild);
            }

            if(hasError){
                el.textContent = 'N/A';
                el.classList.add('error-text');
                return;
            }
            el.classList.remove('error-text');

            if (typeof value === 'number' && !isNaN(value)) {
                animateCountUp(elementId, value, isCurrency);
            } else { // Untuk status teks seperti "Online", "Offline"
                const textValue = value || 'Loading...';
                // PENTING: Gunakan innerHTML = '' dulu untuk clear, baru set textContent
                // Ini memastikan tidak ada sisa HTML yang tersembunyi
                el.innerHTML = '';
                el.textContent = textValue;
                
                // Force reflow untuk memastikan browser render perubahan
                void el.offsetHeight;
                
                // Double check setelah reflow
                const afterText = el.textContent.trim();
                if (afterText !== textValue) {
                    el.textContent = textValue;
                }
                
                // Jika masih tidak match, force update sekali lagi
                const finalText = el.textContent.trim();
                if (finalText !== textValue && elementId === 'bot_status_value') {
                    el.innerHTML = '';
                    el.textContent = textValue;
                    void el.offsetHeight;
                }
            }
        };

        function setFinanceValue(elementId, value, isCurrency = true) {
            const element = document.getElementById(elementId);
            if (!element) return;
            if (isCurrency) {
                element.textContent = new Intl.NumberFormat('id-ID', {
                    style: 'currency',
                    currency: 'IDR',
                    maximumFractionDigits: 0
                }).format(Number(value || 0));
            } else {
                element.textContent = value;
            }
        }

        function escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function renderFinanceSummaryList(containerId, rows, formatter, emptyMessage) {
            const container = document.getElementById(containerId);
            if (!container) return;
            if (!rows || rows.length === 0) {
                container.innerHTML = `<div class="text-muted small">${emptyMessage}</div>`;
                return;
            }
            container.innerHTML = rows.map(formatter).join('');
        }

        async function fetchFinanceOverview() {
            try {
                const now = new Date();
                const response = await fetch(`/api/rekap-keuangan?month=${now.getMonth() + 1}&year=${now.getFullYear()}&type=month`, {
                    credentials: 'include'
                });
                const payload = await response.json();
                if (!response.ok || payload.status !== 200) {
                    throw new Error(payload.message || 'Failed to load finance overview');
                }

                const data = payload.data || {};
                const summary = data.summary || {};
                const largestExpense = (data.largestExpenses || [])[0] || null;
                setFinanceValue('finance_income_value', summary.totalIncome || 0, true);
                setFinanceValue('finance_expense_value', summary.totalExpense || 0, true);
                setFinanceValue('finance_net_value', summary.netTotal || 0, true);
                setFinanceValue('finance_largest_expense_value', largestExpense ? largestExpense.amount : 0, true);

                const largestLabel = document.getElementById('finance_largest_expense_label');
                if (largestLabel) {
                    largestLabel.textContent = largestExpense ? largestExpense.title : 'Belum ada data';
                }

                const categories = Object.entries(data.expenseCategorySummary || {})
                    .sort((left, right) => (right[1]?.amount || 0) - (left[1]?.amount || 0))
                    .slice(0, 5);

                renderFinanceSummaryList(
                    'finance_expense_categories',
                    categories,
                    ([category, item]) => `
                        <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
                            <div>
                                <div class="font-weight-bold text-capitalize">${String(category).replace(/_/g, ' ')}</div>
                                <div class="small text-muted">${item.count || 0} transaksi</div>
                            </div>
                            <div class="font-weight-bold text-danger">${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(item.amount || 0))}</div>
                        </div>
                    `,
                    'Belum ada kategori pengeluaran.'
                );

                const warnings = data.cashflowHealth?.warnings || [];
                renderFinanceSummaryList(
                    'finance_health_alerts',
                    warnings.length ? warnings : [{ message: 'Cashflow sehat untuk periode ini.', healthy: true }],
                    (item) => `
                        <div class="alert ${item.healthy ? 'alert-success' : 'alert-warning'} py-2 mb-2">
                            <div class="small mb-0">${item.message}</div>
                        </div>
                    `,
                    'Belum ada alert cashflow.'
                );
                financeOverviewLoaded = true;
            } catch (error) {
                console.warn('[DASHBOARD_FINANCE_OVERVIEW_ERROR]', error.message);
                if (!financeOverviewLoaded) {
                    const categoryBox = document.getElementById('finance_expense_categories');
                    const healthBox = document.getElementById('finance_health_alerts');
                    if (categoryBox) categoryBox.innerHTML = '<div class="text-danger small">Gagal memuat kategori pengeluaran.</div>';
                    if (healthBox) healthBox.innerHTML = '<div class="text-danger small">Gagal memuat finance overview.</div>';
                }
            }
        }

        const cardValueIds = [
            'bot_status_value', 'users_total_value', 'users_paid_value', 'users_unpaid_value',
            'ppp_online_value', 'ppp_offline_value', 'hotspot_total_value', 'hotspot_active_value',
            'total_revenue_value',
            'mikrotik_status_value', // Tambahkan ini
            'genieacs_status_value'  // Tambahkan ini
        ];

        // Flag untuk mencegah multiple calls bersamaan
        let isFetchingDashboard = false;
        
        async function fetchDashboardData() {
            // Prevent multiple simultaneous calls
            if (isFetchingDashboard) {
                return;
            }
            
            isFetchingDashboard = true;
            
            // Hanya show spinner untuk card yang belum punya value valid
            // PENTING: Jangan timpa value yang sudah valid seperti "Online", "Offline", atau angka
            // PENTING: Jangan timpa teks "Checking..." dengan spinner, biarkan sebagai teks
            // PENTING: Jangan timpa "Online" atau "Offline" dengan spinner
            cardValueIds.forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                
                const currentText = el.textContent.trim();
                const hasSpinner = el.querySelector('.spinner-border');
                
                // Jangan show spinner jika sudah ada value valid
                const hasValidValue = currentText === 'Online' || 
                                     currentText === 'Offline' || 
                                     currentText === 'Checking...' ||
                                     /^\d/.test(currentText); // Angka (untuk statistik)
                
                // Hanya show spinner jika:
                // 1. Element benar-benar kosong (tidak ada teks dan tidak ada spinner)
                // 2. Sudah ada spinner (untuk maintain spinner yang sudah ada)
                // 3. Value adalah "N/A" atau "Error" (bisa diganti dengan spinner)
                // PENTING: Jangan timpa value yang valid
                const shouldShowSpinner = (!hasValidValue && !currentText && !hasSpinner) || 
                                         hasSpinner ||
                                         (currentText === 'N/A' || currentText === 'Error');
                
                if (shouldShowSpinner) {
                    showLoadingSpinner(id);
                }
            });

            try {
                const response = await fetch('/api/stats', { credentials: 'include' });
                if (!response.ok) {
                    throw new Error(`API request failed with status ${response.status}`);
                }
                const data = await response.json();

                // Update all cards from a single data source
                // PENTING: botStatus harus boolean (true/false), bukan undefined/null
                let botStatusValue = 'Checking...';
                let botStatusHasError = false;
                
                // Pastikan botStatus selalu ter-definisi dengan benar
                // Strict check: hanya true/false yang valid, selain itu tetap "Checking..."
                if (data.botStatus === true || data.botStatus === 1 || data.botStatus === 'true') {
                    botStatusValue = 'Online';
                } else if (data.botStatus === false || data.botStatus === 0 || data.botStatus === 'false') {
                    botStatusValue = 'Offline';
                } else {
                    // Jika undefined/null/unknown, tampilkan "Checking..." sebagai teks
                    botStatusValue = 'Checking...';
                }
                
                // PENTING: Update bot_status_value PERTAMA sebelum card lainnya
                // Ini memastikan tidak ada race condition dengan spinner logic
                
                // Clear spinner dulu jika ada, baru update
                const botStatusEl = document.getElementById('bot_status_value');
                if (botStatusEl) {
                    const spinner = botStatusEl.querySelector('.spinner-border');
                    if (spinner) {
                        spinner.remove();
                    }
                }
                
                // PENTING: Update bot_status_value dengan mekanisme yang lebih agresif
                // Pastikan tidak ada yang menimpa setelah update
                const botStatusElForUpdate = document.getElementById('bot_status_value');
                if (botStatusElForUpdate) {
                    // Clear semua konten dulu
                    botStatusElForUpdate.innerHTML = '';
                    // Set textContent langsung
                    botStatusElForUpdate.textContent = botStatusValue;
                    // Force reflow
                    void botStatusElForUpdate.offsetHeight;
                }
                
                // Juga panggil updateDashboardCard untuk konsistensi
                updateDashboardCard('bot_status_value', botStatusValue, false, botStatusHasError);
                
                // PENTING: Update juga wa-status (monitoring widget) dan elemen lain yang relevan
                const waStatusEl = document.getElementById('wa-status');
                if (waStatusEl) {
                    const waStatusText = botStatusValue === 'Online' ? 'Online' : botStatusValue === 'Offline' ? 'Offline' : 'Checking...';
                    waStatusEl.textContent = waStatusText;
                }
                
                // PENTING: Update semua elemen yang mungkin menampilkan status WhatsApp
                // Cari semua elemen yang mengandung "Checking..." dan update dengan status yang benar
                setTimeout(() => {
                    const allCheckingElements = Array.from(document.querySelectorAll('*')).filter(el => {
                        const text = el.textContent?.trim();
                        return text === 'Checking...' && 
                               el.id !== 'bot_status_value' && 
                               (el.id === 'wa-status' || 
                                el.className?.includes('whatsapp') || 
                                el.className?.includes('bot') ||
                                el.closest('[id*="bot"]') ||
                                el.closest('[id*="whatsapp"]') ||
                                el.closest('[id*="wa"]'));
                    });
                    
                    if (allCheckingElements.length > 0) {
                        allCheckingElements.forEach(el => {
                            const statusText = botStatusValue === 'Online' ? 'Online' : botStatusValue === 'Offline' ? 'Offline' : 'Checking...';
                            el.textContent = statusText;
                        });
                    }
                }, 50);
                
                // PENTING: Final check langsung setelah update untuk memastikan tidak ada yang menimpa
                requestAnimationFrame(() => {
                    const immediateCheck = document.getElementById('bot_status_value');
                    if (immediateCheck && immediateCheck.textContent.trim() !== botStatusValue && botStatusValue !== 'Checking...') {
                        immediateCheck.innerHTML = '';
                        immediateCheck.textContent = botStatusValue;
                        void immediateCheck.offsetHeight;
                    }
                });
                
                // Verify update setelah 100ms dan force update jika masih "Checking..."
                setTimeout(() => {
                    const botStatusElAfter = document.getElementById('bot_status_value');
                    if (botStatusElAfter) {
                        const actualText = botStatusElAfter.textContent.trim();
                        
                        // PENTING: Cek apakah ada elemen lain yang menampilkan "Checking..."
                        const allElementsWithChecking = Array.from(document.querySelectorAll('*')).filter(el => {
                            const text = el.textContent?.trim();
                            return text === 'Checking...' && el.id !== 'bot_status_value';
                        });
                        if (allElementsWithChecking.length > 0) {
                            // PENTING: Update semua elemen yang menampilkan "Checking..." dengan status yang benar
                            allElementsWithChecking.forEach(el => {
                                // Update wa-status jika ada (monitoring widget)
                                if (el.id === 'wa-status') {
                                    const statusText = botStatusValue === 'Online' ? 'Online' : botStatusValue === 'Offline' ? 'Offline' : 'Checking...';
                                    el.textContent = statusText;
                                }
                            });
                        }
                        
                        if (actualText !== botStatusValue && botStatusValue !== 'Checking...') {
                            // Force update dengan menghapus semua child nodes dulu
                            while(botStatusElAfter.firstChild) {
                                botStatusElAfter.removeChild(botStatusElAfter.firstChild);
                            }
                            botStatusElAfter.textContent = botStatusValue;
                            void botStatusElAfter.offsetHeight;
                            
                            // Verify sekali lagi setelah force update
                            setTimeout(() => {
                                const finalText = botStatusElAfter.textContent.trim();
                                if (finalText !== botStatusValue) {
                                    botStatusElAfter.innerHTML = botStatusValue;
                                }
                            }, 50);
                        }
                    }
                }, 100);
                updateDashboardCard('users_total_value', data.users, false, data.users === undefined);
                updateDashboardCard('users_paid_value', data.paidUsers, false, data.paidUsers === undefined);
                updateDashboardCard('users_unpaid_value', data.unpaidUsers, false, data.unpaidUsers === undefined);
                updateDashboardCard('total_revenue_value', data.totalRevenue, true, data.totalRevenue === undefined);

                updateDashboardCard('ppp_online_value', data.pppStats?.online, false, data.pppStats?.online === undefined);
                updateDashboardCard('ppp_offline_value', data.pppStats?.offline, false, data.pppStats?.offline === undefined);

                updateDashboardCard('hotspot_total_value', data.hotspotStats?.total, false, data.hotspotStats?.total === undefined);
                updateDashboardCard('hotspot_active_value', data.hotspotStats?.active, false, data.hotspotStats?.active === undefined);

                // PENTING: Perbaiki logika status Mikrotik dan GenieACS
                // Backend sudah memastikan selalu ada property connected (true/false)
                // Jika status object tidak ada sama sekali → N/A (hasError = true)
                // Jika connected === true → Online
                // Jika connected === false → Offline
                const mikrotikHasError = !data.mikrotikStatus || data.mikrotikStatus.connected === undefined;
                const mikrotikStatusValue = mikrotikHasError ? 'N/A' : (data.mikrotikStatus.connected ? 'Online' : 'Offline');
                updateDashboardCard('mikrotik_status_value', mikrotikStatusValue, false, mikrotikHasError);
                
                const genieacsHasError = !data.genieAcsStatus || data.genieAcsStatus.connected === undefined;
                const genieacsStatusValue = genieacsHasError ? 'N/A' : (data.genieAcsStatus.connected ? 'Online' : 'Offline');
                updateDashboardCard('genieacs_status_value', genieacsStatusValue, false, genieacsHasError);

                 // Optional: Show toast notifications for offline systems
                if (!data.mikrotikStatus?.connected && typeof $ !== 'undefined' && $.fn.Toasts) {
                    $(document).Toasts('create', {
                        class: 'bg-warning',
                        title: 'Mikrotik Status',
                        body: data.mikrotikStatus.message || 'Could not connect.',
                        autohide: true, delay: 7000, icon: 'fas fa-exclamation-triangle'
                    });
                }
                if (!data.genieAcsStatus?.connected && typeof $ !== 'undefined' && $.fn.Toasts) {
                     $(document).Toasts('create', {
                        class: 'bg-warning',
                        title: 'GenieACS Status',
                        body: data.genieAcsStatus.message || 'Could not connect.',
                        autohide: true, delay: 7000, icon: 'fas fa-exclamation-triangle'
                    });
                }

                fetchFinanceOverview();


            } catch (error) {
                console.error("Fatal error fetching or processing dashboard data:", error);
                cardValueIds.forEach(id => {
                    const isCurrency = id === 'total_revenue_value';
                    updateDashboardCard(id, 'Error', isCurrency, true);
                });
                if (typeof $ !== 'undefined' && $.fn.Toasts) {
                    $(document).Toasts('create', {
                        class: 'bg-danger',
                        title: 'Dashboard Error',
                        body: 'Could not load dashboard data. Please check the connection and try again.',
                        autohide: true,
                        delay: 7000,
                        icon: 'fas fa-times-circle'
                    });
                }
            } finally {
                isFetchingDashboard = false;
            }
        }

        socket.on('qr', (base64) => {
            qrContainerParent.classList.remove('d-none');
            qrImg.src = base64;
            qrImg.style.display = 'block';
        });

        socket.on('message', (msg) => {
            const state = typeof msg === 'string'
                ? (msg === 'connected' ? 'open' : (msg === 'disconnected' || msg === 'close' ? 'temporary_disconnect' : msg))
                : msg?.state;

            if (state === 'open') {
                // Update bot status langsung tanpa fetch ulang (karena sudah tahu statusnya Online)
                updateDashboardCard('bot_status_value', 'Online', false, false);
                // Delay sedikit sebelum fetch ulang untuk memastikan update pertama sudah selesai
                setTimeout(() => {
                    fetchDashboardData();
                }, 500);
                qrContainerParent.classList.add('d-none');
                if (typeof $ !== 'undefined' && $.fn.Toasts) {
                    $(document).Toasts('create', {
                        class: 'bg-success',
                        title: 'BOT Connected',
                        body: 'WhatsApp BOT berhasil terhubung.',
                        autohide: true,
                        delay: 5000,
                        icon: 'fas fa-check-circle'
                    });
                } else {
                    alert('BOT Connected: WhatsApp BOT berhasil terhubung.');
                }
            } else if (state === 'logged_out') {
                 updateDashboardCard('bot_status_value', 'Logged Out', false, false);
                 if (typeof $ !== 'undefined' && $.fn.Toasts) {
                     $(document).Toasts('create', {
                        class: 'bg-warning',
                        title: 'BOT Logged Out',
                        body: 'Sesi WhatsApp keluar. Scan ulang QR diperlukan.',
                        autohide: true,
                        delay: 7000,
                        icon: 'fas fa-qrcode'
                    });
                 } else {
                    alert('BOT Logged Out: Scan ulang QR diperlukan.');
                 }
            } else if (state === 'temporary_disconnect' || state === 'disconnected' || state === 'close') {
                 updateDashboardCard('bot_status_value', 'Offline', false, false); // Set to Offline, no error
                 if (typeof $ !== 'undefined' && $.fn.Toasts) {
                     $(document).Toasts('create', {
                        class: 'bg-danger',
                        title: 'BOT Disconnected',
                        body: 'WhatsApp BOT telah terputus.',
                        autohide: true,
                        delay: 5000,
                        icon: 'fas fa-times-circle'
                    });
                 } else {
                    alert('BOT Disconnected: WhatsApp BOT telah terputus.');
                 }
            }
        });

        // Load Pengumuman/Notifications
        function loadAnnouncements() {
            fetch('/api/announcements/recent?limit=5')
                .then(response => response.json())
                .then(data => {
                    const container = document.getElementById('alertsContainer');
                    const countBadge = document.getElementById('alertCount');
                    
                    if (data.success && data.data && data.data.length > 0) {
                        const announcements = data.data;
                        countBadge.textContent = announcements.length;
                        countBadge.style.display = 'inline-block';
                        
                        let html = '';
                        announcements.forEach(item => {
                            const date = new Date(item.created_at).toLocaleDateString('id-ID', { 
                                day: 'numeric', 
                                month: 'short', 
                                year: 'numeric' 
                            });
                            
                            // Jika ada gambar, tampilkan gambar thumbnail
                            const imageHtml = item.image 
                                ? `<img src="${item.image}" alt="Pengumuman" style="width: 50px; height: 50px; object-fit: cover; border-radius: 8px;">`
                                : `<div class="icon-circle bg-primary" style="width: 50px; height: 50px; display: flex; align-items: center; justify-content: center;">
                                       <i class="fas fa-bullhorn text-white"></i>
                                   </div>`;
                            
                            html += `
                                <a class="dropdown-item d-flex align-items-center" href="/announcements">
                                    <div class="mr-3">
                                        ${imageHtml}
                                    </div>
                                    <div style="flex: 1; min-width: 0;">
                                        <div class="small text-gray-500 mb-1">${date}</div>
                                        <span class="font-weight-bold" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4;">${item.title || item.message}</span>
                                    </div>
                                </a>
                            `;
                        });
                        
                        container.innerHTML = html;
                    } else {
                        countBadge.style.display = 'none';
                        container.innerHTML = `
                            <a class="dropdown-item text-center small text-gray-500" href="#">
                                <i class="fas fa-inbox"></i> Tidak ada pengumuman terbaru
                            </a>
                        `;
                    }
                })
                .catch(error => {
                    console.error('Error loading announcements:', error);
                    document.getElementById('alertsContainer').innerHTML = `
                        <a class="dropdown-item text-center small text-gray-500" href="#">
                            <i class="fas fa-exclamation-triangle"></i> Gagal memuat pengumuman
                        </a>
                    `;
                });
        }
        
        // Load announcements on page load
        loadAnnouncements();
        
        // Reload announcements every 5 minutes
        setInterval(loadAnnouncements, 5 * 60 * 1000);

        // Load Login & Logout History
        function loadRecentLoginLogs() {
            fetch('/api/logs/login?limit=8&offset=0', {
                credentials: 'same-origin',
                headers: {
                    'Accept': 'application/json'
                }
            })
            .then(response => {
                if (response.status === 403) {
                    // If 403, show error message
                    const tbody = document.getElementById('recentLoginLogsBody');
                    if (tbody) {
                        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted small">Akses ditolak. Silakan login ulang.</td></tr>';
                    }
                    return null;
                }
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(result => {
                const tbody = document.getElementById('recentLoginLogsBody');
                const meta = document.getElementById('recentLoginLogsMeta');
                if (!tbody) return;

                if (!result || result.status !== 200 || !result.data) {
                    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted small">Tidak ada data login/logout logs</td></tr>';
                    if (meta) meta.textContent = 'Tidak ada data';
                    return;
                }

                const logs = result.data;
                if (logs.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted small">Belum ada history login/logout</td></tr>';
                    if (meta) meta.textContent = '0 aktivitas';
                    return;
                }

                if (meta) {
                    meta.textContent = `${logs.length} aktivitas terbaru`;
                }

                let html = '';
                logs.forEach(log => {
                    // Determine action type (login or logout)
                    const actionType = log.action_type || (log.logout_time ? 'logout' : 'login');
                    const isLogout = actionType === 'logout';
                    
                    // Use logout_time for logout events, login_time for login events
                    const timeField = isLogout && log.logout_time ? log.logout_time : (log.login_time || log.timestamp);
                    
                    // Format timestamp with Asia/Jakarta timezone
                    const timestamp = timeField ? new Date(timeField).toLocaleString('id-ID', {
                        timeZone: 'Asia/Jakarta',
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    }) : '-';
                    
                    const success = log.success === 1 || log.success === true;
                    const actionBadgeClass = isLogout ? 'badge-warning' : 'badge-primary';
                    const actionBadgeText = isLogout ? 'Logout' : 'Login';
                    const statusBadgeClass = success ? 'badge-success' : 'badge-danger';
                    const statusBadgeText = success ? 'Success' : 'Failed';
                    const roleText = log.role ? escapeHtml(log.role) : '-';
                    const roleCell = log.role
                        ? `<span class="badge badge-info badge-sm">${roleText}</span>`
                        : '<span class="text-muted small">-</span>';
                    const usernameText = log.username ? escapeHtml(log.username) : '-';
                    const ipText = escapeHtml(log.ip_address || log.ipAddress || '-');
                    
                    html += `
                        <tr>
                            <td><span class="badge ${actionBadgeClass} badge-sm">${actionBadgeText}</span></td>
                            <td class="login-history-time">${escapeHtml(timestamp)}</td>
                            <td><span class="login-history-username">${usernameText}</span></td>
                            <td>${roleCell}</td>
                            <td><span class="badge ${statusBadgeClass} badge-sm">${statusBadgeText}</span></td>
                            <td class="login-history-ip" title="${ipText}">${ipText}</td>
                        </tr>
                    `;
                });
                tbody.innerHTML = html;
            })
            .catch(error => {
                console.error('Error loading login/logout logs:', error);
                const tbody = document.getElementById('recentLoginLogsBody');
                const meta = document.getElementById('recentLoginLogsMeta');
                if (tbody) {
                    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted small">Error loading login/logout logs</td></tr>';
                }
                if (meta) {
                    meta.textContent = 'Gagal memuat data';
                }
            });
        }

        // Load login/logout history on page load
        loadRecentLoginLogs();
        
        // Reload login/logout history every 2 minutes
        setInterval(loadRecentLoginLogs, 2 * 60 * 1000);

        startBtn.addEventListener("click", () => {
            startBtn.disabled = true;
            startBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Connecting...`;
            fetch('/api/start', { credentials: 'include' })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Start API error! Status: ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    // API response received
                })
                .catch(error => {
                    console.error("Error starting bot:", error);
                    if (typeof $ !== 'undefined' && $.fn.Toasts) {
                        $(document).Toasts('create', {
                            class: 'bg-danger',
                            title: 'Connection Error',
                            body: 'Gagal memulai koneksi BOT. Cek konsol.',
                            autohide: true,
                            delay: 5000,
                            icon: 'fas fa-exclamation-triangle'
                        });
                    } else {
                        alert('Connection Error: Gagal memulai koneksi BOT. Cek konsol.');
                    }
                })
                .finally(() => {
                    startBtn.disabled = false;
                    startBtn.innerHTML = `<i class="fas fa-rocket"></i> Connect BOT`;
                });
        });

        // OPTIMASI: Tampilkan default values terlebih dahulu untuk UX yang lebih baik
        // Halaman akan langsung ter-render tanpa menunggu API calls
        // Untuk bot_status_value, set "Checking..." sebagai teks (bukan spinner) agar tidak stuck
        const botStatusEl = document.getElementById('bot_status_value');
        if (botStatusEl && !botStatusEl.textContent.trim()) {
            botStatusEl.textContent = 'Checking...';
        }
        showLoadingSpinner('mikrotik_status_value');
        showLoadingSpinner('genieacs_status_value');
        
        // OPTIMASI: Delay lebih lama untuk memastikan halaman benar-benar ter-render dulu
        // Ini memastikan login response cepat, dashboard load di background
        window.addEventListener('load', () => {
            // Delay 2 detik untuk memastikan halaman sudah fully rendered
            // User akan melihat halaman dulu, data load di background
            setTimeout(() => {
                fetchDashboardData();
                fetchFinanceOverview();
            }, 2000);
            
            // Set interval untuk refresh status setiap 5 detik (untuk memastikan status ter-update)
            // Hanya refresh jika masih "Checking..." untuk menghindari flickering
            setInterval(() => {
                const botStatusEl = document.getElementById('bot_status_value');
                if (botStatusEl) {
                    const currentText = botStatusEl.textContent.trim();
                    // Hanya refresh jika masih "Checking..." atau kosong
                    if (currentText === 'Checking...' || !currentText) {
                        fetchDashboardData();
                    }
                }
            }, 5000);
        });
        
        // Refresh dashboard data every 30 seconds (hanya setelah page load)
        let refreshInterval = null;
        window.addEventListener('load', () => {
            refreshInterval = setInterval(() => {
                fetchDashboardData();
            }, 30000);
            setInterval(() => {
                fetchFinanceOverview();
            }, 60000);
        });
