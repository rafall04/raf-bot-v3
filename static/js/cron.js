/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/cron.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/cron.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

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
    
