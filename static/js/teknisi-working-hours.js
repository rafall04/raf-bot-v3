/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/teknisi-working-hours.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/teknisi-working-hours.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

        // Load current settings
        async function loadSettings() {
            try {
                const response = await fetch('/api/working-hours', { credentials: 'include' });
                const data = await response.json();
                
                if (data.success && data.settings) {
                    const settings = data.settings;
                    
                    // Enable/Disable
                    $('#enableWorkingHours').prop('checked', settings.enabled);
                    
                    // Check if using new per-day structure or old structure
                    if (settings.days) {
                        // New per-day structure
                        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
                        
                        days.forEach(day => {
                            const daySettings = settings.days[day];
                            if (daySettings) {
                                $(`#${day}Enabled`).prop('checked', daySettings.enabled);
                                $(`#${day}Start`).val(daySettings.start);
                                $(`#${day}End`).val(daySettings.end);
                                toggleDayHours(day);
                            }
                        });
                    } else {
                        // Old structure - migrate to new UI
                        // Weekdays (Mon-Fri)
                        if (settings.weekdays) {
                            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].forEach(day => {
                                $(`#${day}Enabled`).prop('checked', true);
                                $(`#${day}Start`).val(settings.weekdays.start);
                                $(`#${day}End`).val(settings.weekdays.end);
                                toggleDayHours(day);
                            });
                        }
                        
                        // Saturday
                        if (settings.saturday) {
                            $('#saturdayEnabled').prop('checked', true);
                            $('#saturdayStart').val(settings.saturday.start);
                            $('#saturdayEnd').val(settings.saturday.end);
                            toggleDayHours('saturday');
                        }
                        
                        // Sunday
                        if (settings.sunday) {
                            $('#sundayEnabled').prop('checked', settings.sunday.enabled);
                            $('#sundayStart').val(settings.sunday.start || '00:00');
                            $('#sundayEnd').val(settings.sunday.end || '00:00');
                            toggleDayHours('sunday');
                        }
                    }
                    
                    // Response times
                    if (settings.responseTime) {
                        $('#highPriorityWithin').val(settings.responseTime.high_priority_within_hours);
                        $('#highPriorityOutside').val(settings.responseTime.high_priority_outside_hours);
                        $('#mediumPriority').val(settings.responseTime.medium_priority);
                    }
                    
                    // Messages
                    if (settings.outOfHoursMessage) {
                        $('#outOfHoursMessage').val(settings.outOfHoursMessage);
                    }
                    if (settings.holidayMessage) {
                        $('#holidayMessage').val(settings.holidayMessage);
                    }
                    
                    // PSB Estimation Time
                    if (settings.psbEstimationTime) {
                        $('#psbEstimationTime').val(settings.psbEstimationTime);
                    } else {
                        $('#psbEstimationTime').val('30-60 menit'); // Default value
                    }
                }
                
                // Update status
                updateStatus(data.status);
                
            } catch (error) {
                console.error('Error loading settings:', error);
                Swal.fire('Error', 'Gagal memuat pengaturan', 'error');
            }
        }
        
        // Update status display
        function updateStatus(status) {
            if (!status) return;
            
            let html = '';
            if (status.isWithinHours) {
                html = '<span class="badge badge-success status-badge"><i class="fas fa-check-circle"></i> Dalam Jam Kerja</span>';
                html += `<br><small class="text-muted">${status.message}</small>`;
            } else {
                html = '<span class="badge badge-warning status-badge"><i class="fas fa-moon"></i> Di Luar Jam Kerja</span>';
                html += `<br><small class="text-muted">${status.message}</small>`;
                if (status.nextAvailable) {
                    html += `<br><small>${status.nextAvailable}</small>`;
                }
            }
            
            $('#currentStatus').html(html);
        }
        
        // Toggle day hours based on enabled status
        function toggleDayHours(day) {
            const enabled = $(`#${day}Enabled`).is(':checked');
            const hoursDiv = $(`#${day}Hours`);
            
            if (enabled) {
                hoursDiv.removeClass('disabled');
            } else {
                hoursDiv.addClass('disabled');
            }
        }
        
        // Setup day toggle handlers
        $('.day-enabled').change(function() {
            const day = $(this).data('day');
            toggleDayHours(day);
        });
        
        // Save settings
        $('#workingHoursForm').on('submit', async function(e) {
            e.preventDefault();
            
            // Build per-day structure
            const days = {};
            const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
            
            dayNames.forEach(day => {
                days[day] = {
                    enabled: $(`#${day}Enabled`).is(':checked'),
                    start: $(`#${day}Start`).val() || '08:00',
                    end: $(`#${day}End`).val() || '17:00'
                };
            });
            
            const settings = {
                enabled: $('#enableWorkingHours').is(':checked'),
                days: days,
                responseTime: {
                    high_priority_within_hours: $('#highPriorityWithin').val(),
                    high_priority_outside_hours: $('#highPriorityOutside').val(),
                    medium_priority: $('#mediumPriority').val()
                },
                outOfHoursMessage: $('#outOfHoursMessage').val() || 'Laporan Anda diterima di luar jam kerja. Akan diproses pada jam kerja berikutnya.',
                holidayMessage: $('#holidayMessage').val() || 'Laporan Anda diterima pada hari libur. Akan diproses pada hari kerja berikutnya.',
                psbEstimationTime: $('#psbEstimationTime').val() || '30-60 menit'
            };
            
            try {
                const response = await fetch('/api/working-hours', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify(settings)
                });
                
                const result = await response.json();
                
                if (result.success) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Berhasil!',
                        text: 'Pengaturan jam kerja berhasil disimpan',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    loadSettings(); // Reload to show updated status
                } else {
                    Swal.fire('Error', result.message || 'Gagal menyimpan pengaturan', 'error');
                }
            } catch (error) {
                console.error('Error saving settings:', error);
                Swal.fire('Error', 'Gagal menyimpan pengaturan', 'error');
            }
        });
        
        // Initialize day toggles on page load
        function initializeDayToggles() {
            const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
            dayNames.forEach(day => {
                toggleDayHours(day);
            });
        }
        
        // Load settings on page load
        $(document).ready(function() {
            // Check authentication first
            fetch('/api/me', { credentials: 'include' })
                .then(response => response.json())
                .then(data => {
                    if (data.status === 200 && data.data) {
                        // Check if user is admin
                        const userRole = data.data.role;
                        if (!userRole || !['admin', 'owner', 'superadmin'].includes(userRole)) {
                            Swal.fire({
                                icon: 'error',
                                title: 'Akses Ditolak',
                                text: 'Halaman ini khusus untuk administrator.',
                                timer: 2000,
                                showConfirmButton: false
                            });
                            setTimeout(() => window.location.href = '/', 2000);
                            return;
                        }
                        
                        // User is authenticated and authorized, load settings
                        loadSettings();
                    } else {
                        // Not authenticated
                        Swal.fire({
                            icon: 'warning',
                            title: 'Sesi Berakhir',
                            text: 'Silakan login kembali.',
                            timer: 2000,
                            showConfirmButton: false
                        });
                        setTimeout(() => window.location.href = '/login', 2000);
                    }
                })
                .catch(error => {
                    console.error('Authentication error:', error);
                    window.location.href = '/login';
                });
        });
    
