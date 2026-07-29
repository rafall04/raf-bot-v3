<!DOCTYPE html>
<html lang="en">

<head>

    <?php
    $pageTitle = 'RAF BOT - Cron';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">

    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css">

</head>

<body id="page-top">

    <div id="wrapper">

    <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">

            <div id="content">

                <nav class="navbar navbar-expand navbar-light bg-white topbar mb-4 static-top shadow">

                    <form class="form-inline">
                        <button type="button" id="sidebarToggleTop" class="btn btn-link d-md-none rounded-circle mr-3">
                            <i class="fa fa-bars"></i>
                        </button>
                    </form>


                    <ul class="navbar-nav ml-auto">


                        <li class="nav-item dropdown no-arrow">
                            <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button"
                                data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                                <span class="mr-2 d-none d-lg-inline text-gray-600 small">Admin</span>
                                <img class="img-profile rounded-circle"
                                    src="/img/undraw_profile.svg">
                            </a>
                            <div class="dropdown-menu dropdown-menu-right shadow animated--grow-in"
                                aria-labelledby="userDropdown">
                                <a class="dropdown-item" href="#" data-toggle="modal" data-target="#logoutModal">
                                    <i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i>
                                    Logout
                                </a>
                            </div>
                        </li>

                    </ul>

                </nav>
                <div class="container-fluid">

                    <!-- Page Header -->
          <div class="dashboard-header">
            <h1>Perbarui Jadwal</h1>
            <p>Kelola dan monitor perbarui jadwal</p>
          </div>
                    <div class="card shadow mb-4">
                        <div class="card-header py-3">
                            </div>
                        <div class="card-body">
                            <form id="cronConfigForm" action="/api/cron" method="post">
                                <div class="mb-3">
                                    <label for="unpaid_schedule" class="form-label">Jadwal Unpaid Pelanggan</label>
                                    <input type="text" class="form-control" id="unpaid_schedule" name="unpaid_schedule" 
                                           placeholder="Contoh: */5 * * * * atau # */5 * * * * untuk disable" />
                                    <small class="form-text text-muted">Awali dengan # untuk menonaktifkan jadwal</small>
                                </div>
                                <div class="mb-3">
                                    <input type="checkbox" name="status_unpaid_schedule" id="status_unpaid_schedule">
                                    <label for="status_unpaid_schedule" class="form-label">Enable / Disable Jadwal Unpaid Pelanggan</label>
                                </div>
                                <div class="mb-3">
                                    <label for="schedule" class="form-label">Jadwal Pemberitahuan Pembayaran</label>
                                    <input type="text" class="form-control" id="schedule" name="schedule" />
                                </div>
                                <div class="mb-3">
                                    <input type="checkbox" name="status_schedule" id="status_schedule">
                                    <label for="status_schedule" class="form-label">Enable / Disable Jadwal Pemberitahuan Pembayaran</label>
                                </div>
                                <hr>
                                <div class="mb-3">
                                    <input type="checkbox" name="status_message_paid_notification" id="status_message_paid_notification">
                                    <label for="status_message_paid_notification" class="form-label">Enable / Disable Notifikasi "Telah Bayar"</label>
                                </div>
                                <hr>
                                <div class="mb-3">
                                    <label for="schedule_masa_tenggang" class="form-label">Jadwal Masa Tenggang (sebelum isolir)</label>
                                    <input type="text" class="form-control" id="schedule_masa_tenggang" name="schedule_masa_tenggang" placeholder="0 8 11 * * (Default: tgl 11 jam 08:00)" />
                                </div>
                                <div class="mb-3">
                                    <input type="checkbox" name="status_masa_tenggang" id="status_masa_tenggang">
                                    <label for="status_masa_tenggang" class="form-label">Enable / Disable Pesan Masa Tenggang</label>
                                </div>
                                <hr>
                                <div class="mb-3">
                                    <label for="schedule_unpaid_action" class="form-label">Jadwal Isolir</label>
                                    <input type="text" class="form-control" id="schedule_unpaid_action" name="schedule_unpaid_action" />
                                </div>
                                <div class="mb-3">
                                    <input type="checkbox" name="status_schedule_unpaid_action" id="status_schedule_unpaid_action">
                                    <label for="status_schedule_unpaid_action" class="form-label">Enable / Disable Jadwal Isolir</label>
                                </div>
                                <hr>
                                <div class="mb-3">
                                    <label for="schedule_isolir_notification" class="form-label">Jadwal Pemberitahuan Isolir</label>
                                    <input type="text" class="form-control" id="schedule_isolir_notification" name="schedule_isolir_notification" />
                                </div>
                                <div class="mb-3">
                                    <input type="checkbox" name="status_message_isolir_notification" id="status_message_isolir_notification">
                                    <label for="status_message_isolir_notification" class="form-label">Enable / Disable Pesan Pemberitahuan Isolir</label>
                                </div>
                                <hr>
                                <div class="mb-3">
                                    <label for="schedule_compensation_revert" class="form-label">Jadwal Revert Kompensasi</label>
                                    <input type="text" class="form-control" id="schedule_compensation_revert" name="schedule_compensation_revert" />
                                </div>
                                <div class="mb-3">
                                    <input type="checkbox" name="status_compensation_revert" id="status_compensation_revert">
                                    <label for="status_compensation_revert" class="form-label">Enable / Disable Jadwal Revert Kompensasi</label>
                                </div>
                                <div class="mb-3">
                                    <input type="checkbox" name="status_message_compensation_reverted" id="status_message_compensation_reverted">
                                    <label for="status_message_compensation_reverted" class="form-label">Enable / Disable Notifikasi Saat Kompensasi Selesai (Reverted)</label>
                                </div>
                                <hr>
                                <div class="mb-3">
                                    <input type="checkbox" name="status_message_compensation_applied" id="status_message_compensation_applied">
                                    <label for="status_message_compensation_applied" class="form-label">Enable / Disable Notifikasi Saat Kompensasi Diberikan</label>
                                </div>
                                <hr>
                                <div class="mb-3">
                                    <input type="checkbox" name="status_speed_boost_revert" id="status_speed_boost_revert">
                                    <label for="status_speed_boost_revert" class="form-label">Status Auto Revert Speed Boost (cek tiap menit)</label>
                                    <small class="form-text text-muted">Task revert Speed Boost tidak memakai cron custom. Sistem selalu mengecek tiap menit, dan toggle ini hanya mengaktifkan atau menonaktifkan prosesnya.</small>
                                </div>
                                <div class="mb-3">
                                    <input type="checkbox" name="status_message_sod_applied" id="status_message_sod_applied">
                                    <label for="status_message_sod_applied" class="form-label">Enable / Disable Notifikasi Saat Speed on Demand Diberikan</label>
                                </div>
                                <div class="mb-3">
                                    <input type="checkbox" name="status_message_sod_reverted" id="status_message_sod_reverted">
                                    <label for="status_message_sod_reverted" class="form-label">Enable / Disable Notifikasi Saat Speed on Demand Berakhir</label>
                                </div>
                                <hr>
                                <div class="mb-3">
                                    <label for="check_schedule" class="form-label">Jadwal Cek Redaman (Cron Expression)</label>
                                    <input type="text" class="form-control" id="check_schedule" name="check_schedule" placeholder="0 */6 * * * (Default: setiap 6 jam)" />
                                    <small class="text-muted">Format: menit jam tanggal bulan hari. Contoh: "0 */6 * * *" untuk setiap 6 jam</small>
                                </div>
                                <div class="mb-3">
                                    <input type="checkbox" name="status_check_schedule" id="status_check_schedule">
                                    <label for="status_check_schedule" class="form-label">Enable / Disable Jadwal Cek Redaman</label>
                                </div>
                                <hr>
                                <div class="mb-3">
                                    <label for="schedule_telegram_backup" class="form-label">Jadwal Backup Telegram</label>
                                    <input type="text" class="form-control" id="schedule_telegram_backup" name="schedule_telegram_backup" placeholder="0 4 * * *" />
                                    <small class="form-text text-muted">Jadwal backup otomatis Telegram. Kredensial bot dan chat ID tetap dikelola di halaman Setting Admin.</small>
                                </div>
                                <div class="mb-3">
                                    <input type="checkbox" name="status_telegram_backup" id="status_telegram_backup">
                                    <label for="status_telegram_backup" class="form-label">Aktifkan Cron Backup Telegram</label>
                                    <small class="form-text text-muted">Backup otomatis hanya berjalan jika integrasi Telegram aktif di Setting Admin dan cron backup ini juga aktif.</small>
                                </div>
                                <hr>
                                <div class="mb-3">
                                    <label for="schedule_rating_survey" class="form-label">⭐ Jadwal Survei Kepuasan (CSAT)</label>
                                    <input type="text" class="form-control" id="schedule_rating_survey" name="schedule_rating_survey" placeholder="0 9 22 * * (Default: tgl 22 jam 09:00)" />
                                    <small class="form-text text-muted">Kapan survei rating dikirim ke pelanggan. Format: menit jam tanggal bulan hari. Awali # untuk nonaktif. Butuh fitur survei aktif.</small>
                                </div>
                                <div class="mb-3">
                                    <input type="checkbox" name="status_rating_survey" id="status_rating_survey">
                                    <label for="status_rating_survey" class="form-label">Enable / Disable Jadwal Survei Kepuasan</label>
                                </div>
                                <div class="mb-3">
                                    <label for="schedule_rating_digest" class="form-label">📊 Jadwal Rekap Survei ke Owner</label>
                                    <input type="text" class="form-control" id="schedule_rating_digest" name="schedule_rating_digest" placeholder="0 9 27 * * (Default: tgl 27 jam 09:00)" />
                                    <small class="form-text text-muted">Kapan ringkasan hasil survei dikirim ke owner/admin via WhatsApp.</small>
                                </div>
                                <div class="mb-3">
                                    <input type="checkbox" name="status_rating_digest" id="status_rating_digest">
                                    <label for="status_rating_digest" class="form-label">Enable / Disable Rekap Survei ke Owner</label>
                                </div>
                                <button type="submit" class="btn btn-primary">Simpan</button>
                            </form>
                        </div>
                    </div>

                </div>
                </div>
            <footer class="sticky-footer bg-white">
                <div class="container my-auto">
                    <div class="copyright text-center my-auto">
                        <span>Copyright &copy; Your Website 2020</span>
                    </div>
                </div>
            </footer>
            </div>
        </div>
    <a class="scroll-to-top rounded" href="#page-top">
        <i class="fas fa-angle-up"></i>
    </a>

    <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel"
        aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="exampleModalLabel">Ready to Leave?</h5>
                    <button class="close" type="button" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">×</span>
                    </button>
                </div>
                <div class="modal-body">Select "Logout" below if you are ready to end your current session.</div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button>
                    <a class="btn btn-primary" href="/logout">Logout</a>
                </div>
            </div>
        </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>

    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>

    <script src="/js/sb-admin-2.js"></script>

    <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
    <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>

    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>


    <script src="<?= rafAssetUrl('/js/cron.js') ?>"></script>


</body>

</html>
