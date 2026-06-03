/**
 * Header Doc
 * Purpose: Guardrail finalisasi migrasi pesan WhatsApp hardcoded ke responseTemplates untuk flow bot aktif.
 * Caller: Jest test runner.
 * Deps: fs, path, database/response_templates.json, source handler/service aktif.
 * MainFuncs: readSource, expectTemplateKeys, expectNoHardcodedSnippets, expectAllResponseTemplatesCategorized.
 * SideEffects: Membaca source dan JSON template tanpa menjalankan handler.
 */

const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..", "..");

function readSource(relativePath) {
    return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function stripBlockComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function expectTemplateKeys(keys) {
    const responseTemplates = require("../../database/response_templates.json");
    keys.forEach((key) => {
        expect(responseTemplates[key]).toEqual(expect.objectContaining({
            name: expect.any(String),
            template: expect.any(String)
        }));
    });
}

function expectNoHardcodedSnippets(relativePath, snippets) {
    const source = stripBlockComments(readSource(relativePath));
    snippets.forEach((snippet) => {
        expect(source).not.toContain(snippet);
    });
}

function expectAllResponseTemplatesCategorized() {
    const responseTemplates = require("../../database/response_templates.json");
    const missingCategories = Object.entries(responseTemplates)
        .filter(([, value]) => value && typeof value === "object" && !Array.isArray(value) && !value.category)
        .map(([key]) => key);

    expect(missingCategories).toEqual([]);
}

const finalizationKeys = [
    "reporting_photo_progress_received",
    "payment_state_qa_unavailable",
    "teknisi_photo_receive_failed",
    "payment_flow_voucher_purchase_prompt",
    "payment_flow_voucher_purchase_insufficient_balance",
    "payment_flow_voucher_purchase_processing",
    "payment_flow_voucher_purchase_success",
    "payment_flow_voucher_purchase_failure",
    "payment_flow_voucher_price_prompt",
    "payment_flow_voucher_price_not_found",
    "payment_flow_topup_proof_received",
    "payment_flow_topup_proof_admin_notification",
    "payment_flow_topup_proof_upload_failed",
    "speed_payment_no_pending",
    "speed_payment_upload_prompt",
    "speed_payment_proof_received",
    "speed_payment_admin_notification",
    "speed_payment_admin_media_caption",
    "speed_payment_process_error",
    "speed_payment_verification_pending_label",
    "speed_boost_cancelled",
    "speed_boost_invalid_choice",
    "speed_boost_no_duration_options",
    "speed_boost_no_payment_methods",
    "speed_boost_confirmation_invalid",
    "speed_boost_create_failed",
    "speed_boost_admin_new_request",
    "speed_boost_admin_clear_success",
    "speed_boost_admin_clear_empty",
    "speed_boost_validation_disabled",
    "speed_boost_validation_unpaid",
    "speed_boost_status_pending_label",
    "speed_boost_status_active_label",
    "speed_boost_validation_existing_request",
    "speed_boost_validation_active_compensation",
    "speed_boost_validation_missing_pppoe",
    "speed_boost_validation_failed",
    "speed_boost_no_packages",
    "speed_boost_request_process_error",
    "speed_boost_package_list",
    "speed_boost_package_item",
    "speed_boost_package_duration_item",
    "speed_boost_duration_list",
    "speed_boost_duration_item",
    "speed_boost_payment_method_list",
    "speed_boost_payment_method_item",
    "speed_boost_payment_method_cash_icon",
    "speed_boost_payment_method_transfer_icon",
    "speed_boost_payment_method_double_billing_icon",
    "speed_boost_payment_method_cash_description",
    "speed_boost_payment_method_transfer_description",
    "speed_boost_payment_method_double_billing_description",
    "speed_boost_payment_label_cash",
    "speed_boost_payment_label_transfer",
    "speed_boost_payment_label_double_billing",
    "speed_boost_confirmation_note_cash",
    "speed_boost_confirmation_note_transfer",
    "speed_boost_confirmation_note_double_billing",
    "speed_boost_confirmation",
    "speed_boost_success_base",
    "speed_boost_success_cash_section",
    "speed_boost_success_transfer_section",
    "speed_boost_transfer_no_accounts",
    "speed_boost_bank_account_item",
    "speed_boost_success_double_billing_section",
    "speed_status_user_not_found",
    "speed_status_no_history",
    "speed_status_summary",
    "speed_status_admin_user_info",
    "speed_status_active_section",
    "speed_status_active_expiration_section",
    "speed_status_active_expired_warning",
    "speed_status_active_no_expiration_section",
    "speed_status_pending_section",
    "speed_status_pending_waiting_section",
    "speed_status_waiting_transfer",
    "speed_status_waiting_admin_approval",
    "speed_status_waiting_auto_cancel",
    "speed_status_no_active_pending",
    "speed_status_history_section",
    "speed_status_history_item",
    "speed_status_admin_commands",
    "speed_status_check_error",
    "speed_status_payment_method_cash",
    "speed_status_payment_method_transfer",
    "speed_status_payment_method_double_billing",
    "speed_status_payment_method_free",
    "speed_status_payment_unpaid",
    "speed_status_payment_pending",
    "speed_status_payment_paid",
    "speed_status_payment_verified",
    "speed_status_payment_rejected",
    "speed_status_icon_pending",
    "speed_status_icon_active",
    "speed_status_icon_expired",
    "speed_status_icon_completed",
    "speed_status_icon_cancelled",
    "speed_status_icon_cancelled_auto",
    "speed_status_icon_cancelled_admin",
    "speed_status_icon_reverted",
    "speed_status_icon_rejected",
    "wifi_management_name_too_long",
    "wifi_management_name_mode_prompt",
    "wifi_management_password_mode_prompt",
    "wifi_management_customer_not_found",
    "wifi_management_usage_name",
    "wifi_management_usage_password",
    "wifi_management_user_not_registered",
    "wifi_management_monthly_only_name",
    "wifi_management_monthly_only_password",
    "wifi_management_device_missing",
    "wifi_management_checking_info",
    "wifi_management_info_check_failed",
    "other_cancel_ticket_success",
    "other_cancel_ticket_not_found",
    "other_cancel_ticket_completed",
    "other_cancel_ticket_already_cancelled",
    "other_cancel_ticket_confirm_invalid",
    "other_reboot_processing",
    "other_reboot_failed",
    "other_cancelled",
    "other_reboot_confirm_invalid",
    "other_power_level_invalid",
    "other_power_confirm",
    "other_power_processing",
    "other_power_success",
    "other_power_failed",
    "other_power_confirm_invalid",
    "other_choice_invalid",
    "other_sod_confirm",
    "other_sod_payment_success",
    "other_sod_cancelled",
    "other_package_confirm",
    "other_package_success",
    "other_package_cancelled",
    "report_legacy_description_recorded",
    "report_legacy_reboot_yes_prompt",
    "report_legacy_reboot_no_prompt",
    "report_legacy_yes_no_invalid",
    "report_legacy_los_yes_prompt",
    "report_legacy_los_no_prompt",
    "report_legacy_los_invalid",
    "report_legacy_lamp_empty",
    "report_legacy_additional_info_prompt",
    "report_legacy_summary",
    "report_legacy_success",
    "report_legacy_cancelled",
    "report_legacy_confirm_invalid",
    "reporting_domain_checking_device",
    "general_reboot_success",
    "general_reboot_failed",
    "general_reboot_error",
    "general_reboot_cancelled",
    "general_reboot_confirm_invalid",
    "general_payment_proof_prompt",
    "general_complaint_empty",
    "general_complaint_received",
    "general_ticket_process_customer_update",
    "general_ticket_process_success",
    "general_ticket_not_found",
    "general_ticket_process_cancelled",
    "general_ticket_process_confirm_invalid",
    "general_ticket_photo_timeout",
    "general_ticket_state_lost",
    "general_ticket_minimum_photo_required",
    "general_ticket_id_missing",
    "general_ticket_photo_saved_prompt",
    "general_ticket_photo_skipped_prompt",
    "general_ticket_resolution_cancelled",
    "general_ticket_photo_reminder",
    "general_resolution_notes_too_short",
    "general_ticket_resolution_confirm",
    "general_ticket_resolved_customer_message",
    "general_ticket_photo_caption",
    "general_ticket_resolved_success",
    "general_ticket_resolution_edit_prompt",
    "general_ticket_resolution_confirm_invalid",
    "general_question_empty",
    "general_question_forwarded",
    "general_step_unknown",
    "wifi_steps_select_ssid_name",
    "wifi_steps_confirm_all_name",
    "wifi_steps_ask_bulk_name",
    "wifi_steps_invalid_mode",
    "wifi_steps_invalid_ssid",
    "wifi_steps_confirm_single_name",
    "wifi_steps_ask_single_name",
    "wifi_steps_name_cancelled",
    "wifi_steps_name_empty",
    "wifi_steps_name_too_long",
    "wifi_steps_confirm_name",
    "wifi_steps_name_processing",
    "wifi_steps_name_success",
    "wifi_steps_name_partial_failed",
    "wifi_steps_name_failed",
    "wifi_steps_select_ssid_password",
    "wifi_steps_confirm_all_password",
    "wifi_steps_ask_bulk_password",
    "wifi_steps_confirm_single_password",
    "wifi_steps_ask_single_password",
    "wifi_steps_password_cancelled",
    "wifi_steps_password_too_short",
    "wifi_steps_confirm_password",
    "wifi_steps_password_processing",
    "wifi_steps_password_success",
    "wifi_steps_password_partial_failed",
    "wifi_steps_password_failed",
    "wifi_bulk_checking_device",
    "wifi_bulk_password_all_processing",
    "wifi_bulk_password_single_processing",
    "wifi_bulk_password_request_all",
    "wifi_bulk_password_request_single",
    "wifi_bulk_password_success_single",
    "wifi_bulk_password_success_default",
    "wifi_bulk_name_all_processing",
    "wifi_bulk_name_single_processing",
    "wifi_bulk_name_request_all",
    "wifi_bulk_name_request_single",
    "wifi_bulk_name_success_default",
    "wifi_bulk_safe_error_timeout",
    "wifi_bulk_safe_error_server",
    "wifi_bulk_safe_error_request",
    "wifi_bulk_safe_error_network",
    "wifi_bulk_safe_error_generic",
    "wifi_bulk_state_unknown",
    "routes_speed_request_owner_notification",
    "routes_saldo_agent_topup_notification",
    "routes_ticket_created_customer_admin",
    "routes_ticket_created_customer_staff",
    "admin_service_package_change_owner_request",
    "admin_service_package_change_customer_approved",
    "admin_service_package_change_customer_rejected",
    "admin_service_package_change_technician_result",
    "report_notification_new_ticket",
    "report_notification_customer_photo_caption",
    "routes_ticket_working_hours_notice",
    "topup_expiry_expired_notification",
    "topup_expiry_reminder_notification",
    "psb_teknisi_phone_section",
    "alert_system_detail_error_spike",
    "alert_system_detail_high_cpu",
    "alert_system_detail_high_memory",
    "alert_system_detail_whatsapp_disconnected",
    "alert_system_detail_whatsapp_logged_out",
    "alert_system_detail_database_error",
    "alert_system_detail_queue_backlog",
    "alert_system_detail_service_recovered",
    "alert_system_detail_daily_report",
    "alert_system_detail_health_warning",
    "alert_system_detail_critical_error",
    "alert_system_detail_default",
    "alert_system_message",
    "alert_system_recommendation_error_spike",
    "alert_system_recommendation_high_cpu",
    "alert_system_recommendation_high_memory",
    "alert_system_recommendation_whatsapp_disconnected",
    "alert_system_recommendation_whatsapp_logged_out",
    "alert_system_recommendation_database_error",
    "alert_system_recommendation_queue_backlog",
    "alert_system_recommendation_service_recovered",
    "alert_system_stats",
    "alert_system_daily_report",
    "alert_system_test_message",
    "profile_update_default_notification",
    "customer_service_package_change_owner_request",
    "speed_request_service_payment_note_double_billing",
    "speed_request_service_payment_note_waiting_proof",
    "report_service_customer_confirmation",
    "report_service_technician_new_report",
    "routes_speed_payment_proof_owner_notification",
    "routes_speed_payment_verified_customer",
    "routes_speed_payment_rejected_customer",
    "routes_speed_approval_customer_approved",
    "routes_speed_approval_customer_rejected",
    "routes_request_payment_new_owner_notification",
    "routes_request_payment_cancelled_owner_notification",
    "smart_report_text_lid_not_registered",
    "smart_report_text_customer_not_registered",
    "smart_report_text_active_report_found",
    "smart_report_text_main_menu",
    "smart_report_text_contact_customer_service",
    "smart_report_text_invalid_menu_choice",
    "smart_report_text_customer_data_missing",
    "smart_report_text_device_check_failed",
    "smart_report_text_mati_troubleshoot_menu",
    "smart_report_text_lemot_auto_redirect_menu",
    "smart_report_text_lemot_troubleshoot_menu",
    "smart_report_text_mati_option_invalid",
    "smart_report_text_problem_solved",
    "smart_report_text_troubleshoot_result_invalid",
    "smart_report_text_report_cancelled",
    "smart_report_text_yes_no_invalid",
    "smart_report_text_photo_upload_prompt",
    "smart_report_text_restart_guide",
    "smart_report_text_mati_solved",
    "smart_report_text_photo_skipped",
    "smart_report_text_photo_received_more",
    "smart_report_text_photo_received_max",
    "smart_report_text_photo_attached_continue",
    "smart_report_text_photo_upload_invalid",
    "smart_report_text_report_created_success",
    "smart_report_text_report_create_failed",
    "smart_report_text_generic_error",
    "smart_report_handler_lid_not_registered",
    "smart_report_handler_mati_offline_menu",
    "smart_report_handler_mati_online_menu",
    "smart_report_handler_device_check_error",
    "smart_report_handler_lemot_active_report",
    "smart_report_handler_lemot_auto_redirect_menu",
    "smart_report_handler_lemot_menu",
    "smart_report_handler_lemot_error",
    "smart_report_handler_report_cancelled",
    "smart_report_handler_problem_solved",
    "smart_report_handler_mati_photo_prompt",
    "smart_report_handler_mati_restart_guide",
    "smart_report_handler_mati_invalid_response",
    "smart_report_handler_wifi_ticket_technician_notification",
    "smart_report_handler_wifi_ticket_customer_success",
    "smart_report_handler_lemot_ticket_created_success",
    "smart_report_handler_lemot_photo_skipped",
    "smart_report_handler_lemot_photo_received",
    "smart_report_handler_lemot_photo_max",
    "smart_report_handler_lemot_photo_more",
    "smart_report_handler_lemot_photo_invalid",
    "smart_report_handler_speedtest_low",
    "smart_report_handler_speedtest_normal",
    "smart_report_handler_speedtest_recorded",
    "smart_report_handler_lemot_photo_prompt",
    "smart_report_handler_lemot_retry_later",
    "ticket_process_max_active",
    "ticket_process_not_found",
    "ticket_process_already_processed",
    "ticket_process_already_completed",
    "ticket_process_customer_otp_notification",
    "ticket_process_admin_processed_notification",
    "ticket_process_taken_success",
    "ticket_process_error",
    "ticket_process_no_active_ticket",
    "ticket_process_ticket_mismatch",
    "ticket_process_otp_expired",
    "ticket_process_otp_invalid",
    "ticket_process_customer_verified_notification",
    "ticket_process_otp_verified_success",
    "ticket_process_verify_error",
    "ticket_process_completion_not_verified",
    "ticket_process_minimum_photo_required",
    "ticket_process_completion_customer_code",
    "ticket_process_waiting_customer_confirmation",
    "ticket_process_complete_error",
    "ticket_process_final_success",
    "ticket_process_final_error",
    "teknisi_workflow_ticket_not_found",
    "teknisi_workflow_already_processed",
    "teknisi_workflow_already_completed",
    "teknisi_workflow_not_registered",
    "teknisi_workflow_process_customer_otp",
    "teknisi_workflow_process_success",
    "teknisi_workflow_process_error",
    "teknisi_workflow_not_assigned",
    "teknisi_workflow_invalid_status_process_first",
    "teknisi_workflow_otw_customer",
    "teknisi_workflow_otw_success",
    "teknisi_workflow_otw_error",
    "teknisi_workflow_invalid_status",
    "teknisi_workflow_arrived_customer",
    "teknisi_workflow_arrived_success",
    "teknisi_workflow_arrived_error",
    "teknisi_workflow_otp_invalid",
    "teknisi_workflow_repair_started_customer",
    "teknisi_workflow_otp_verified_success",
    "teknisi_workflow_verify_error",
    "teknisi_workflow_photo_problem_prompt",
    "teknisi_workflow_photo_speedtest_prompt",
    "teknisi_workflow_photo_result_prompt",
    "teknisi_workflow_photo_extra_prompt",
    "teknisi_workflow_completion_not_verified",
    "teknisi_workflow_minimum_photo_required",
    "teknisi_workflow_completion_customer_notification",
    "teknisi_workflow_completion_success",
    "teknisi_workflow_completion_error",
    "teknisi_workflow_photo_max_reached",
    "teknisi_workflow_photo_all_complete",
    "teknisi_workflow_photo_legacy_progress",
    "teknisi_workflow_photo_legacy_complete",
    "teknisi_workflow_photo_save_error",
    "teknisi_workflow_resolution_notes_too_short",
    "teknisi_workflow_resolution_review",
    "teknisi_workflow_resolution_edit_prompt",
    "teknisi_workflow_completion_confirm_invalid",
    "teknisi_workflow_complete_ticket_customer_notification",
    "teknisi_workflow_complete_ticket_success",
    "teknisi_workflow_complete_ticket_error"
];

describe("WA hardcoded message finalization wave", () => {
    test("response template keys finalization tersedia", () => {
        expectTemplateKeys(finalizationKeys);
    });

    test("active state/service flow tidak mengirim pesan WhatsApp hardcoded prioritas", () => {
        expectNoHardcodedSnippets("message/handlers/state-domains/payment.state.js", [
            "Maaf, fitur tanya jawab otomatis sudah tidak tersedia."
        ]);

        expectNoHardcodedSnippets("message/handlers/state-domains/reporting.state.js", [
            "Foto ${photoCount} berhasil diterima!"
        ]);

        expectNoHardcodedSnippets("message/handlers/state-domains/teknisi.state.js", [
            "Gagal menerima foto. Silakan coba lagi."
        ]);

        expectNoHardcodedSnippets("services/payment-flow.service.js", [
            "Tentu, Kak ${pushname}! Mau beli voucher yang mana?",
            "Mohon balas dengan *harga* voucher yang ingin Anda beli",
            "Maaf, voucher seharga Rp ${chosenPrice} tidak tersedia."
        ]);

        expectNoHardcodedSnippets("services/wifi-management.service.js", [
            "Nama WiFi terlalu panjang, maksimal 32 karakter.",
            "Pilih mode perubahan nama WiFi:",
            "Pilih mode perubahan kata sandi WiFi:",
            "Silakan hubungi admin untuk bantuan.",
            "Sedang memeriksa informasi WiFi...",
            "Maaf, terjadi kesalahan saat memeriksa informasi WiFi."
        ]);

        expectNoHardcodedSnippets("message/handlers/states/other-state-handler.js", [
            "Tiket Berhasil Dibatalkan",
            "permintaan reboot untuk modem",
            "Level daya tidak valid",
            "Anda memilih Speed on Demand",
            "PESANAN SPEED ON DEMAND BERHASIL",
            "PERUBAHAN PAKET BERHASIL"
        ]);

        expectNoHardcodedSnippets("message/handlers/domains/reporting.domain.js", [
            "Sedang memeriksa status perangkat Anda"
        ]);

        expectNoHardcodedSnippets("message/handlers/steps/general-steps.js", [
            "Sedang mengirim perintah reboot",
            "Silakan kirim bukti pembayaran",
            "Keluhan/Saran Diterima",
            "Tiket Anda sedang ditangani oleh teknisi kami",
            "Tiket Berhasil Diambil",
            "Upload foto dokumentasi",
            "TIKET DISELESAIKAN",
            "Pertanyaan Anda:"
        ]);

        expectNoHardcodedSnippets("message/handlers/steps/wifi-steps.js", [
            "Pilih SSID yang Akan Diubah",
            "Silakan ketik nama WiFi baru",
            "Perubahan nama WiFi dibatalkan",
            "Sedang mengubah nama WiFi",
            "Gagal mengubah nama WiFi",
            "Pilih SSID yang Akan Diubah Sandinya",
            "Silakan ketik sandi WiFi baru",
            "Sandi WiFi terlalu pendek",
            "Sedang mengubah sandi WiFi",
            "Gagal mengubah sandi WiFi"
        ]);

        expectNoHardcodedSnippets("message/handlers/steps/wifi-steps-bulk.js", [
            "Memeriksa status perangkat",
            "Pilih SSID yang Akan Diubah",
            "Perubahan sandi WiFi sedang diproses",
            "Perubahan nama WiFi untuk semua SSID sedang diproses",
            "Silakan ketik sandi WiFi baru",
            "Silakan ketik nama WiFi baru",
            "Gagal mengubah sandi WiFi",
            "Gagal mengubah nama WiFi",
            "State tidak dikenali"
        ]);

        expectNoHardcodedSnippets("routes/public.js", [
            "Permintaan Speed on Demand Baru",
            "Pelanggan telah mengajukan permintaan penambahan kecepatan",
            "Mohon segera ditinjau di halaman admin"
        ]);

        expectNoHardcodedSnippets("routes/saldo.js", [
            "SALDO AGENT DITAMBAHKAN",
            "Saldo agent Anda telah ditambahkan sebesar"
        ]);

        expectNoHardcodedSnippets("routes/tickets.js", [
            "TIKET LAPORAN DIBUAT OLEH ADMIN",
            "TIKET LAPORAN DIBUAT",
            "Tim teknisi kami akan segera menangani laporan ini"
        ]);

        expectNoHardcodedSnippets("services/admin.service.js", [
            "Permintaan Perubahan Paket Baru",
            "Permintaan Perubahan Paket Ditolak",
            "Permintaan perubahan paket yang Anda ajukan telah"
        ]);

        expectNoHardcodedSnippets("lib/report-notification-service.js", [
            "Foto ${index + 1} dari ${photoBuffers.length}",
            "Untuk proses tiket, ketik:"
        ]);

        expectNoHardcodedSnippets("routes/tickets.js", [
            "Laporan Anda diterima di luar jam kerja. Akan diproses pada jam kerja berikutnya."
        ]);

        expectNoHardcodedSnippets("lib/topup-expiry.js", [
            "REQUEST TOPUP EXPIRED",
            "REMINDER TOPUP",
            "Request topup Anda telah kadaluarsa karena tidak ada pembayaran dalam 24 jam.",
            "Anda belum mengirim bukti transfer."
        ]);

        expectNoHardcodedSnippets("lib/psb-notification.js", [
            "Kontak: wa.me/${teknisiPhone}"
        ]);

        expectNoHardcodedSnippets("lib/alert-system.js", [
            "Error rate has increased to {rate} errors/hour",
            "WhatsApp connection lost. Attempting reconnection...",
            "Database error occurred: {error}",
            "Check error logs for patterns. Consider increasing resources or fixing the root cause.",
            "DAILY SYSTEM REPORT",
            "This is a test alert"
        ]);

        expectNoHardcodedSnippets("lib/services/profile-update-service.js", [
            "Profil Anda telah diupdate."
        ]);

        expectNoHardcodedSnippets("lib/services/customer-service.js", [
            "Permintaan Perubahan Paket Baru",
            "Pelanggan telah mengajukan permintaan perubahan paket.",
            "Mohon segera ditinjau di panel admin."
        ]);

        expectNoHardcodedSnippets("lib/services/speed-request-service.js", [
            "Permintaan Speed on Demand Baru",
            "Pelanggan telah mengajukan permintaan penambahan kecepatan.",
            "Akan ditagihkan pada invoice bulan depan",
            "Menunggu bukti pembayaran dari pelanggan",
            "Mohon segera ditinjau di halaman admin"
        ]);

        expectNoHardcodedSnippets("lib/services/report-service.js", [
            "Laporan Anda Telah Diterima",
            "LAPORAN BARU DARI PELANGGAN",
            "Mohon simpan Nomor Tiket ini untuk referensi Anda.",
            "Mohon segera ditindaklanjuti."
        ]);

        expectNoHardcodedSnippets("routes/speed-requests.js", [
            "Bukti Pembayaran Speed Boost",
            "Pembayaran Speed Boost Terverifikasi",
            "Pembayaran Speed Boost Ditolak",
            "Permintaan Speed on Demand Disetujui",
            "Permintaan Speed on Demand Ditolak",
            "Silakan verifikasi di halaman admin."
        ]);

        expectNoHardcodedSnippets("routes/requests.js", [
            "PENGAJUAN PEMBAYARAN BARU",
            "Info: Pengajuan Dibatalkan Teknisi",
            "Mohon segera ditinjau dan diproses di panel admin.",
            "Pengajuan ini akan otomatis dibatalkan jika tidak diproses dalam 7 hari."
        ]);

        expectNoHardcodedSnippets("message/handlers/smart-report-text-menu.js", [
            "LAPORAN AKTIF DITEMUKAN",
            "LAPOR GANGGUAN INTERNET",
            "HUBUNGI CUSTOMER SERVICE",
            "Pilihan tidak valid",
            "GANGGUAN INTERNET MATI",
            "LANGKAH TROUBLESHOOTING",
            "KOREKSI: DEVICE ANDA OFFLINE",
            "TROUBLESHOOTING INTERNET LEMOT",
            "Gagal memeriksa status perangkat",
            "PROBLEM SOLVED",
            "Mohon balas dengan:",
            "Pembuatan laporan dibatalkan",
            "Mohon balas dengan *YA* atau *TIDAK*",
            "UPLOAD BUKTI FOTO",
            "PANDUAN RESTART MODEM",
            "GREAT! MASALAH TERATASI",
            "Upload foto dilewati",
            "berhasil diterima",
            "berhasil dilampirkan",
            "Silakan:",
            "LAPORAN BERHASIL DIBUAT",
            "Gagal membuat laporan",
            "TIKET BARU",
            "AKSI YANG TERSEDIA",
            "Minta kode OTP"
        ]);

        expectNoHardcodedSnippets("message/handlers/smart-report-handler.js", [
            "GANGGUAN TERDETEKSI",
            "ANALISIS STATUS",
            "TROUBLESHOOTING INTERNET LEMOT",
            "UPLOAD FOTO (OPSIONAL)",
            "PANDUAN TROUBLESHOOTING DETAIL",
            "Proses laporan dibatalkan",
            "Mohon balas dengan angka:",
            "ANDA SUDAH MEMILIKI LAPORAN AKTIF",
            "TIKET PRIORITAS TINGGI DIBUAT",
            "TIKET GANGGUAN WiFi",
            "TIKET DIBUAT",
            "TIKET SPEED ISSUE DIBUAT",
            "Upload foto dilewati",
            "foto berhasil diterima",
            "Hasil Speed Test",
            "UPLOAD BUKTI",
            "TIKET INTERNET LEMOT",
            "Baik, silakan coba lagi nanti"
        ]);

        expectNoHardcodedSnippets("message/handlers/ticket-process-handler.js", [
            "MAKSIMAL TIKET TERCAPAI",
            "Tiket dengan ID",
            "TEKNISI SEDANG MENUJU LOKASI",
            "TIKET DIPROSES",
            "TIKET DIAMBIL",
            "VERIFIKASI BERHASIL",
            "PERBAIKAN SELESAI",
            "MENUNGGU KONFIRMASI PELANGGAN",
            "TIKET SELESAI",
            "Kode OTP salah",
            "Minimal 2 foto dokumentasi"
        ]);

        expectNoHardcodedSnippets("message/handlers/teknisi-workflow-handler.js", [
            "TIKET DIPROSES",
            "TIKET BERHASIL DIPROSES",
            "TEKNISI BERANGKAT",
            "MULAI PERJALANAN",
            "TEKNISI SUDAH TIBA",
            "STATUS: SAMPAI DI LOKASI",
            "PENGERJAAN DIMULAI",
            "OTP TERVERIFIKASI - MULAI PERBAIKAN",
            "Kode OTP salah",
            "Anda tidak terdaftar sebagai teknisi",
            "FOTO 1/3 - WAJIB",
            "FOTO 2/3 - WAJIB",
            "FOTO 3/3 - OPSIONAL",
            "FOTO WAJIB LENGKAP",
            "FOTO KURANG",
            "PERBAIKAN SELESAI",
            "TIKET SELESAI",
            "Maksimal 5 foto",
            "SEMUA FOTO DOKUMENTASI LENGKAP",
            "FOTO DOKUMENTASI DITERIMA",
            "REVIEW SEBELUM FINALISASI",
            "Pilihan tidak valid",
            "PERBAIKAN SELESAI - TIKET CLOSED",
            "Gagal menyelesaikan tiket"
        ]);

        expectNoHardcodedSnippets("services/payment-flow.service.js", [
            "Harga Voucher Rp ${price} Tidak Terdaftar",
            "Saldo Anda tidak mencukupi untuk melakukan pembelian voucher",
            "Sedang memproses pembelian voucher Anda",
            "Hore! Voucher Berhasil Dibeli",
            "PEMBELIAN VOUCHER GAGAL",
            "BUKTI TRANSFER TOPUP DITERIMA",
            "BUKTI TRANSFER DITERIMA",
            "Gagal mengupload bukti transfer"
        ]);

        expectNoHardcodedSnippets("message/handlers/speed-payment-handler.js", [
            "tidak memiliki permintaan speed boost yang menunggu pembayaran",
            "Upload Bukti Pembayaran Speed Boost",
            "Bukti Pembayaran Berhasil Diterima",
            "Bukti Pembayaran Speed Boost via WhatsApp",
            "Bukti pembayaran dari ${user.name} untuk Speed Boost",
            "terjadi kesalahan saat memproses bukti pembayaran",
            "Anda belum memiliki permintaan speed boost",
            "Status Speed Boost Anda",
            "Speed Boost Aktif",
            "Permintaan Pending",
            "Kirim foto bukti pembayaran",
            "Request Terakhir",
            "terjadi kesalahan saat mengecek status speed boost",
            "Belum Bayar",
            "Menunggu Verifikasi",
            "Terverifikasi",
            "Dikembalikan"
        ]);

        expectNoHardcodedSnippets("message/handlers/speed-boost-handler.js", [
            "Request Speed Boost dibatalkan.",
            "Pilihan tidak valid. Silakan pilih nomor",
            "Paket ini tidak memiliki opsi Speed Boost",
            "Tidak ada metode pembayaran yang tersedia",
            "Jawaban tidak valid. Ketik *ya*",
            "Gagal membuat request Speed Boost",
            "SPEED BOOST REQUEST BARU",
            "Berhasil clear ${cleared} speed boost request",
            "Tidak ada speed boost aktif/pending",
            "Speed Boost sedang tidak tersedia saat ini",
            "Harap lunasi pembayaran bulan ini terlebih dahulu",
            "Anda sudah memiliki Speed Boost yang",
            "Anda sedang mendapatkan kompensasi",
            "Akun PPPoE Anda belum diatur",
            "Tidak Dapat Request Speed Boost",
            "tidak ada paket Speed Boost yang tersedia",
            "Terjadi kesalahan saat memproses request Speed Boost",
            "REQUEST SPEED BOOST",
            "Pilih Paket Tujuan",
            "Balas dengan nomor paket",
            "PILIH DURASI SPEED BOOST",
            "Balas dengan nomor durasi",
            "PILIH METODE PEMBAYARAN",
            "Metode Pembayaran",
            "Balas dengan nomor metode",
            "KONFIRMASI SPEED BOOST",
            "Detail Order",
            "REQUEST SPEED BOOST BERHASIL",
            "PEMBAYARAN CASH",
            "PEMBAYARAN TRANSFER",
            "TAGIHAN BULAN DEPAN",
            "Silakan transfer ke rekening berikut",
            "Info rekening belum tersedia",
            "WAJIB kirim bukti pembayaran"
        ]);

        expectNoHardcodedSnippets("message/handlers/speed-status-handler.js", [
            "User tidak ditemukan.",
            "tidak memiliki riwayat Speed Boost",
            "STATUS SPEED BOOST",
            "SPEED BOOST AKTIF",
            "SPEED BOOST PENDING",
            "Tidak ada Speed Boost aktif atau pending",
            "RIWAYAT TERAKHIR",
            "Admin Commands",
            "Terjadi kesalahan saat mengecek status Speed Boost",
            "Verifikasi pembayaran",
            "Approval admin",
            "Akan dibatalkan otomatis",
            "Belum Bayar",
            "Menunggu Verifikasi",
            "Terverifikasi"
        ]);
    });

    test("all response template entries have admin category metadata", () => {
        expectAllResponseTemplatesCategorized();
    });
});
