<!DOCTYPE html>
<html lang="id">
<head>
<?php
    // <head> tulis tangan melewatkan components-modern.css (lapisan komponen bersama).
    $pageTitle = 'Pengaturan Jam Kerja Teknisi - RAF NET';
    $themeRole = 'teknisi';
    include __DIR__ . '/_head.php';
?>
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">

    <link href="<?= rafAssetUrl('/css/teknisi-working-hours.css') ?>" rel="stylesheet">
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
                    <div class="tk-page-head">
                        <div class="tk-title">
                            <span class="tk-title-icon"><i class="fas fa-clock"></i></span>
                            <div>
                                <h1>Pengaturan Jam Kerja Teknisi</h1>
                                <p class="tk-subtitle">Atur jam operasional teknisi untuk response time yang akurat</p>
                            </div>
                        </div>
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
    
    <script src="<?= rafAssetUrl('/js/teknisi-working-hours.js') ?>"></script>
    
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
</body>
</html>
