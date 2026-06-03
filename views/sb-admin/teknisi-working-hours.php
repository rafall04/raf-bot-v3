<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>Pengaturan Jam Kerja Teknisi - RAF NET</title>
    
    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    
    <style>
        .time-input {
            max-width: 120px;
        }
        .settings-card {
            margin-bottom: 20px;
        }
        .status-badge {
            font-size: 0.9rem;
            padding: 0.5rem 1rem;
        }
        .day-setting {
            background: #f8f9fa;
            transition: all 0.3s;
        }
        .day-setting:hover {
            background: #e9ecef;
        }
        .day-hours {
            opacity: 1;
            transition: opacity 0.3s;
        }
        .day-hours.disabled {
            opacity: 0.5;
            pointer-events: none;
        }
        
        /* ===== MOBILE RESPONSIVE STYLES ===== */
        @media (max-width: 768px) {
            .container-fluid {
                padding: 0.75rem;
            }
            
            .dashboard-header h1 {
                font-size: 1.25rem;
            }
            
            .dashboard-header p {
                font-size: 0.9rem;
            }
            
            /* Card adjustments */
            .card-body {
                padding: 1rem;
            }
            
            .card-header {
                padding: 0.75rem 1rem;
            }
            
            /* Time input */
            .time-input {
                max-width: 100%;
            }
            
            /* Day setting row */
            .day-setting .row {
                flex-direction: column;
            }
            
            .day-setting .col-md-2,
            .day-setting .col-md-3,
            .day-setting .col-md-4 {
                margin-bottom: 0.5rem;
            }
            
            /* Form controls */
            .form-control, select, input[type="time"] {
                font-size: 16px !important; /* Prevents zoom on iOS */
            }
            
            /* Button */
            .btn {
                width: 100%;
                margin-bottom: 0.5rem;
            }
        }
        
        @media (max-width: 576px) {
            .container-fluid {
                padding: 0.5rem;
            }
            
            .dashboard-header h1 {
                font-size: 1.1rem;
            }
            
            .card-body {
                padding: 0.75rem;
            }
            
            .status-badge {
                font-size: 0.8rem;
                padding: 0.4rem 0.8rem;
            }
        }
    </style>
</head>

<body id="page-top">
    <div id="wrapper">
        <!-- Sidebar -->
        <?php include '_navbar.php'; ?>
        <!-- End of Sidebar -->
        
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <!-- Topbar -->
                <?php include 'topbar.php'; ?>
                <!-- End of Topbar -->
                
                <div class="container-fluid">
                    <!-- Page Heading -->
                    <div class="dashboard-header">
                        <h1><i class="fas fa-clock"></i> Pengaturan Jam Kerja Teknisi</h1>
                        <p>Atur jam operasional teknisi untuk response time yang akurat</p>
                    </div>
                    
                    <!-- Status Card -->
                    <h4 class="dashboard-section-title">Status Saat Ini</h4>
                    <div class="row match-height mb-4">
                        <div class="col-lg-12">
                            <div class="card dashboard-card card-primary">
                                <div class="card-body">
                                    <div class="card-content">
                                        <div class="card-info">
                                            <div class="card-title-text">Status Saat Ini</div>
                                            <div class="card-value" id="currentStatus">
                                                <i class="fas fa-spinner fa-spin"></i> Memuat...
                                            </div>
                                            <div class="card-subtitle">
                                                <i class="fas fa-circle" style="font-size: 8px;"></i>
                                                <span>Real-time</span>
                                            </div>
                                        </div>
                                        <div class="card-icon-container">
                                            <i class="fas fa-business-time"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Settings Form -->
                    <h4 class="dashboard-section-title">Konfigurasi Jam Kerja</h4>
                    <div class="row">
                        <div class="col-lg-8">
                            <div class="card table-card mb-4 settings-card">
                                <div class="card-header">
                                    <h6><i class="fas fa-cog"></i> Pengaturan Jam Kerja</h6>
                                </div>
                                <div class="card-body">
                                    <form id="workingHoursForm">
                                        <!-- Enable/Disable -->
                                        <div class="form-group">
                                            <div class="custom-control custom-switch">
                                                <input type="checkbox" class="custom-control-input" id="enableWorkingHours" name="enabled">
                                                <label class="custom-control-label" for="enableWorkingHours">
                                                    <strong>Aktifkan Jam Kerja Teknisi</strong>
                                                    <small class="form-text text-muted">Jika dinonaktifkan, sistem akan menampilkan layanan 24/7</small>
                                                </label>
                                            </div>
                                        </div>
                                        
                                        <hr>
                                        
                                        <!-- Per Day Settings -->
                                        <div class="form-group">
                                            <label class="font-weight-bold">
                                                <i class="fas fa-calendar-week"></i> Pengaturan Per Hari
                                            </label>
                                            
                                            <!-- Monday -->
                                            <div class="day-setting mb-3 p-3 border rounded">
                                                <div class="d-flex justify-content-between align-items-center mb-2">
                                                    <label class="mb-0"><i class="fas fa-calendar-day"></i> <strong>Senin</strong></label>
                                                    <div class="custom-control custom-switch">
                                                        <input type="checkbox" class="custom-control-input day-enabled" id="mondayEnabled" data-day="monday">
                                                        <label class="custom-control-label" for="mondayEnabled">Aktif</label>
                                                    </div>
                                                </div>
                                                <div class="row day-hours" id="mondayHours">
                                                    <div class="col-md-6">
                                                        <input type="time" class="form-control time-input" id="mondayStart" value="08:00">
                                                    </div>
                                                    <div class="col-md-6">
                                                        <input type="time" class="form-control time-input" id="mondayEnd" value="17:00">
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <!-- Tuesday -->
                                            <div class="day-setting mb-3 p-3 border rounded">
                                                <div class="d-flex justify-content-between align-items-center mb-2">
                                                    <label class="mb-0"><i class="fas fa-calendar-day"></i> <strong>Selasa</strong></label>
                                                    <div class="custom-control custom-switch">
                                                        <input type="checkbox" class="custom-control-input day-enabled" id="tuesdayEnabled" data-day="tuesday">
                                                        <label class="custom-control-label" for="tuesdayEnabled">Aktif</label>
                                                    </div>
                                                </div>
                                                <div class="row day-hours" id="tuesdayHours">
                                                    <div class="col-md-6">
                                                        <input type="time" class="form-control time-input" id="tuesdayStart" value="08:00">
                                                    </div>
                                                    <div class="col-md-6">
                                                        <input type="time" class="form-control time-input" id="tuesdayEnd" value="17:00">
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <!-- Wednesday -->
                                            <div class="day-setting mb-3 p-3 border rounded">
                                                <div class="d-flex justify-content-between align-items-center mb-2">
                                                    <label class="mb-0"><i class="fas fa-calendar-day"></i> <strong>Rabu</strong></label>
                                                    <div class="custom-control custom-switch">
                                                        <input type="checkbox" class="custom-control-input day-enabled" id="wednesdayEnabled" data-day="wednesday">
                                                        <label class="custom-control-label" for="wednesdayEnabled">Aktif</label>
                                                    </div>
                                                </div>
                                                <div class="row day-hours" id="wednesdayHours">
                                                    <div class="col-md-6">
                                                        <input type="time" class="form-control time-input" id="wednesdayStart" value="08:00">
                                                    </div>
                                                    <div class="col-md-6">
                                                        <input type="time" class="form-control time-input" id="wednesdayEnd" value="17:00">
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <!-- Thursday -->
                                            <div class="day-setting mb-3 p-3 border rounded">
                                                <div class="d-flex justify-content-between align-items-center mb-2">
                                                    <label class="mb-0"><i class="fas fa-calendar-day"></i> <strong>Kamis</strong></label>
                                                    <div class="custom-control custom-switch">
                                                        <input type="checkbox" class="custom-control-input day-enabled" id="thursdayEnabled" data-day="thursday">
                                                        <label class="custom-control-label" for="thursdayEnabled">Aktif</label>
                                                    </div>
                                                </div>
                                                <div class="row day-hours" id="thursdayHours">
                                                    <div class="col-md-6">
                                                        <input type="time" class="form-control time-input" id="thursdayStart" value="08:00">
                                                    </div>
                                                    <div class="col-md-6">
                                                        <input type="time" class="form-control time-input" id="thursdayEnd" value="17:00">
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <!-- Friday -->
                                            <div class="day-setting mb-3 p-3 border rounded">
                                                <div class="d-flex justify-content-between align-items-center mb-2">
                                                    <label class="mb-0"><i class="fas fa-calendar-day"></i> <strong>Jumat</strong></label>
                                                    <div class="custom-control custom-switch">
                                                        <input type="checkbox" class="custom-control-input day-enabled" id="fridayEnabled" data-day="friday">
                                                        <label class="custom-control-label" for="fridayEnabled">Aktif</label>
                                                    </div>
                                                </div>
                                                <div class="row day-hours" id="fridayHours">
                                                    <div class="col-md-6">
                                                        <input type="time" class="form-control time-input" id="fridayStart" value="08:00">
                                                    </div>
                                                    <div class="col-md-6">
                                                        <input type="time" class="form-control time-input" id="fridayEnd" value="17:00">
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <!-- Saturday -->
                                            <div class="day-setting mb-3 p-3 border rounded">
                                                <div class="d-flex justify-content-between align-items-center mb-2">
                                                    <label class="mb-0"><i class="fas fa-calendar-day"></i> <strong>Sabtu</strong></label>
                                                    <div class="custom-control custom-switch">
                                                        <input type="checkbox" class="custom-control-input day-enabled" id="saturdayEnabled" data-day="saturday">
                                                        <label class="custom-control-label" for="saturdayEnabled">Aktif</label>
                                                    </div>
                                                </div>
                                                <div class="row day-hours" id="saturdayHours">
                                                    <div class="col-md-6">
                                                        <input type="time" class="form-control time-input" id="saturdayStart" value="08:00">
                                                    </div>
                                                    <div class="col-md-6">
                                                        <input type="time" class="form-control time-input" id="saturdayEnd" value="13:00">
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <!-- Sunday -->
                                            <div class="day-setting mb-3 p-3 border rounded">
                                                <div class="d-flex justify-content-between align-items-center mb-2">
                                                    <label class="mb-0"><i class="fas fa-calendar-day"></i> <strong>Minggu</strong></label>
                                                    <div class="custom-control custom-switch">
                                                        <input type="checkbox" class="custom-control-input day-enabled" id="sundayEnabled" data-day="sunday">
                                                        <label class="custom-control-label" for="sundayEnabled">Aktif</label>
                                                    </div>
                                                </div>
                                                <div class="row day-hours" id="sundayHours">
                                                    <div class="col-md-6">
                                                        <input type="time" class="form-control time-input" id="sundayStart" value="00:00">
                                                    </div>
                                                    <div class="col-md-6">
                                                        <input type="time" class="form-control time-input" id="sundayEnd" value="00:00">
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <hr>
                                        
                                        <!-- Response Time Messages -->
                                        <div class="form-group">
                                            <label class="font-weight-bold">
                                                <i class="fas fa-hourglass-half"></i> Pesan Estimasi Waktu Response
                                            </label>
                                            
                                            <div class="mb-3">
                                                <label for="highPriorityWithin">Prioritas TINGGI (dalam jam kerja)</label>
                                                <input type="text" class="form-control" id="highPriorityWithin" name="highPriorityWithin" 
                                                       placeholder="contoh: maksimal 2 jam" required>
                                                <small class="form-text text-muted">Untuk gangguan internet mati dalam jam kerja</small>
                                            </div>
                                            
                                            <div class="mb-3">
                                                <label for="highPriorityOutside">Prioritas TINGGI (di luar jam kerja)</label>
                                                <input type="text" class="form-control" id="highPriorityOutside" name="highPriorityOutside" 
                                                       placeholder="contoh: keesokan hari jam kerja" required>
                                                <small class="form-text text-muted">Untuk gangguan internet mati di luar jam kerja</small>
                                            </div>
                                            
                                            <div class="mb-3">
                                                <label for="mediumPriority">Prioritas SEDANG</label>
                                                <input type="text" class="form-control" id="mediumPriority" name="mediumPriority" 
                                                       placeholder="contoh: 1x24 jam kerja" required>
                                                <small class="form-text text-muted">Untuk gangguan internet lemot/lambat</small>
                                            </div>
                                            
                                            <div class="mb-3">
                                                <label for="outOfHoursMessage">Pesan Di Luar Jam Kerja</label>
                                                <textarea class="form-control" id="outOfHoursMessage" name="outOfHoursMessage" rows="2"
                                                          placeholder="Laporan Anda diterima di luar jam kerja. Akan diproses pada jam kerja berikutnya."></textarea>
                                                <small class="form-text text-muted">Pesan yang ditampilkan saat laporan diterima di luar jam kerja</small>
                                            </div>
                                            
                                            <div class="mb-3">
                                                <label for="holidayMessage">Pesan Hari Libur</label>
                                                <textarea class="form-control" id="holidayMessage" name="holidayMessage" rows="2"
                                                          placeholder="Laporan Anda diterima pada hari libur. Akan diproses pada hari kerja berikutnya."></textarea>
                                                <small class="form-text text-muted">Pesan yang ditampilkan saat laporan diterima pada hari libur</small>
                                            </div>
                                        </div>
                                        
                                        <hr>
                                        
                                        <!-- PSB Estimation Time -->
                                        <div class="form-group">
                                            <label class="font-weight-bold">
                                                <i class="fas fa-car"></i> Estimasi Tiba Teknisi (PSB)
                                            </label>
                                            
                                            <div class="mb-3">
                                                <label for="psbEstimationTime">Estimasi Tiba Teknisi</label>
                                                <input type="text" class="form-control" id="psbEstimationTime" name="psbEstimationTime" 
                                                       placeholder="contoh: 30-60 menit" value="30-60 menit">
                                                <small class="form-text text-muted">Estimasi waktu tiba teknisi yang akan dikirim ke pelanggan saat teknisi meluncur (untuk PSB). Contoh: "30-60 menit", "1-2 jam", dll.</small>
                                            </div>
                                        </div>
                                        
                                        <div class="text-right">
                                            <button type="button" class="btn btn-secondary" onclick="loadSettings()">
                                                <i class="fas fa-redo"></i> Reset
                                            </button>
                                            <button type="submit" class="btn btn-primary">
                                                <i class="fas fa-save"></i> Simpan Pengaturan
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Info Panel -->
                        <div class="col-lg-4">
                            <div class="card shadow mb-4">
                                <div class="card-header py-3">
                                    <h6 class="m-0 font-weight-bold text-info">
                                        <i class="fas fa-info-circle"></i> Informasi
                                    </h6>
                                </div>
                                <div class="card-body">
                                    <h6 class="font-weight-bold">Cara Kerja:</h6>
                                    <ul class="small">
                                        <li>Sistem akan otomatis menghitung estimasi waktu response berdasarkan jam kerja</li>
                                        <li>Laporan prioritas TINGGI (internet mati) akan mendapat estimasi berbeda jika di luar jam kerja</li>
                                        <li>Laporan prioritas SEDANG (internet lemot) menggunakan estimasi standar</li>
                                    </ul>
                                    
                                    <h6 class="font-weight-bold mt-3">Contoh Pesan:</h6>
                                    <div class="small">
                                        <strong>Dalam jam kerja:</strong><br>
                                        <em>"Estimasi: maksimal 2 jam"</em>
                                        
                                        <br><br>
                                        
                                        <strong>Di luar jam kerja:</strong><br>
                                        <em>"Estimasi: keesokan hari jam kerja"</em>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                </div>
            </div>
            
            <!-- Footer -->
            <?php include 'footer.php'; ?>
            <!-- End of Footer -->
        </div>
    </div>
    
    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.min.js"></script>
    
    <script>
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
    </script>
    
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
</body>
</html>
