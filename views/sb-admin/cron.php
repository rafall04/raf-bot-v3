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


    <script>
        async function fetchCronConfig() {
            try {
                const response = await fetch('/api/cron', { credentials: 'include' });
                const result = await response.json();

                // Log for debugging
                console.log("Fetched Config:", result);

                if (result.data) {
                    document.getElementById("unpaid_schedule").value = result.data.unpaid_schedule || "";
                    document.getElementById("status_unpaid_schedule").checked = result.data.status_unpaid_schedule || false;
                    document.getElementById("schedule").value = result.data.schedule || "";
                    document.getElementById("status_schedule").checked = result.data.status_schedule || false;
                    document.getElementById("status_message_paid_notification").checked = result.data.status_message_paid_notification || false;
                    document.getElementById("schedule_masa_tenggang").value = result.data.schedule_masa_tenggang || "0 8 11 * *";
                    document.getElementById("status_masa_tenggang").checked = result.data.status_masa_tenggang !== false;
                    document.getElementById("schedule_unpaid_action").value = result.data.schedule_unpaid_action || "";
                    document.getElementById("status_schedule_unpaid_action").checked = result.data.status_schedule_unpaid_action || false;
                    document.getElementById("schedule_isolir_notification").value = result.data.schedule_isolir_notification || "";
                    document.getElementById("status_message_isolir_notification").checked = result.data.status_message_isolir_notification || false;
                    document.getElementById("schedule_compensation_revert").value = result.data.schedule_compensation_revert || "";
                    document.getElementById("status_compensation_revert").checked = result.data.status_compensation_revert || false;
                    document.getElementById("status_message_compensation_reverted").checked = result.data.status_message_compensation_reverted || false;
                    document.getElementById("status_message_compensation_applied").checked = result.data.status_message_compensation_applied || false;
                    document.getElementById("status_speed_boost_revert").checked = result.data.status_speed_boost_revert || false;
                    document.getElementById("status_message_sod_applied").checked = result.data.status_message_sod_applied || false;
                    document.getElementById("status_message_sod_reverted").checked = result.data.status_message_sod_reverted || false;
                    document.getElementById("check_schedule").value = result.data.check_schedule || "0 */6 * * *";
                    document.getElementById("status_check_schedule").checked = result.data.status_check_schedule !== false;
                    document.getElementById("schedule_telegram_backup").value = result.data.schedule_telegram_backup || "0 4 * * *";
                    document.getElementById("status_telegram_backup").checked = result.data.status_telegram_backup === true;
                    document.getElementById("schedule_rating_survey").value = result.data.schedule_rating_survey || "0 9 22 * *";
                    document.getElementById("status_rating_survey").checked = result.data.status_rating_survey === true;
                    document.getElementById("schedule_rating_digest").value = result.data.schedule_rating_digest || "0 9 27 * *";
                    document.getElementById("status_rating_digest").checked = result.data.status_rating_digest === true;
                } else {
                    console.error("No data found in the response:", result);
                     Swal.fire({
                        icon: 'error',
                        title: 'Oops...',
                        text: 'Tidak ada data konfigurasi yang ditemukan!',
                    });
                }
            } catch (error) {
                console.error("Error fetching cron configuration:", error);
                Swal.fire({
                    icon: 'error',
                    title: 'Gagal Memuat Konfigurasi',
                    text: 'Terjadi kesalahan saat mengambil data konfigurasi. Silakan coba lagi nanti.',
                });
            }
        }

        async function saveCronConfig(event) {
            event.preventDefault();

            // Don't clean cron expressions - allow # for disabled
            const config = {
                unpaid_schedule: document.getElementById("unpaid_schedule").value.trim(),
                status_unpaid_schedule: document.getElementById("status_unpaid_schedule").checked,
                schedule: document.getElementById("schedule").value.trim(),
                status_schedule: document.getElementById("status_schedule").checked,
                status_message_paid_notification: document.getElementById("status_message_paid_notification").checked,
                schedule_masa_tenggang: document.getElementById("schedule_masa_tenggang").value.trim(),
                status_masa_tenggang: document.getElementById("status_masa_tenggang").checked,
                schedule_unpaid_action: document.getElementById("schedule_unpaid_action").value.trim(),
                status_schedule_unpaid_action: document.getElementById("status_schedule_unpaid_action").checked,
                schedule_isolir_notification: document.getElementById("schedule_isolir_notification").value.trim(),
                status_message_isolir_notification: document.getElementById("status_message_isolir_notification").checked,
                schedule_compensation_revert: document.getElementById("schedule_compensation_revert").value.trim(),
                status_compensation_revert: document.getElementById("status_compensation_revert").checked,
                status_message_compensation_reverted: document.getElementById("status_message_compensation_reverted").checked,
                status_message_compensation_applied: document.getElementById("status_message_compensation_applied").checked,
                status_speed_boost_revert: document.getElementById("status_speed_boost_revert").checked,
                status_message_sod_applied: document.getElementById("status_message_sod_applied").checked,
                status_message_sod_reverted: document.getElementById("status_message_sod_reverted").checked,
                check_schedule: document.getElementById("check_schedule").value.trim(),
                status_check_schedule: document.getElementById("status_check_schedule").checked,
                schedule_telegram_backup: document.getElementById("schedule_telegram_backup").value.trim(),
                status_telegram_backup: document.getElementById("status_telegram_backup").checked,
                schedule_rating_survey: document.getElementById("schedule_rating_survey").value.trim(),
                status_rating_survey: document.getElementById("status_rating_survey").checked,
                schedule_rating_digest: document.getElementById("schedule_rating_digest").value.trim(),
                status_rating_digest: document.getElementById("status_rating_digest").checked
            };

            try {
                console.log("Sending cron config:", config); // Log sebelum mengirim
                const response = await fetch("/api/cron", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify(config)
                });

                const result = await response.json();
                console.log("Server response:", result); // Log setelah respons diterima

                if (response.ok) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Berhasil!',
                        text: 'Konfigurasi berhasil diperbarui.',
                        timer: 2000, // Popup akan hilang setelah 2 detik
                        showConfirmButton: false
                    });
                } else {
                    console.error("Failed to update configuration:", result.message);
                    Swal.fire({
                        icon: 'error',
                        title: 'Gagal Memperbarui Konfigurasi',
                        text: result.message || 'Terjadi kesalahan yang tidak diketahui.',
                    });
                }
            } catch (error) {
                console.error("Error saving cron configuration:", error);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Gagal menyimpan konfigurasi. Periksa konsol untuk detailnya.',
                });
            }
        }

        document.getElementById("cronConfigForm").addEventListener("submit", saveCronConfig);

        document.addEventListener("DOMContentLoaded", fetchCronConfig);
    </script>

</body>

</html>
