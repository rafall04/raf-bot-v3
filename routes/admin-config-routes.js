/**
 * Header Doc
 * Purpose: Registrar route admin untuk konfigurasi sistem, cron, feature flag GenieACS, konfigurasi parameter GenieACS, dan device MikroTik.
 * Caller: `routes/admin-router.js`.
 * Deps: Router Express, auth staff middleware, runtime config, cron helper, backup helper, `services/genieacs-parameter-config.service`, dan `services/mikrotik-device-config.service`.
 * MainFuncs: `registerAdminConfigRoutes`.
 * SideEffects: Menulis `config.json`, `database/cron.json`, dan `genieacs_parameters.json`.
 */
"use strict";

const fs = require('fs');
const path = require('path');
const { asyncHandler, createError, ErrorTypes } = require('../lib/error-handler');
const { createGenieAcsParameterConfigService } = require('../services/genieacs-parameter-config.service');
const { createMikrotikDeviceConfigService } = require('../services/mikrotik-device-config.service');

const {
    initializeAllCronTasks,
    isValidCron
} = require('../lib/cron');
const {
    getGenieAcsFeatureStatus,
} = require('../lib/genieacs');
const {
    testTelegramConnection,
    performDatabaseBackup,
    getTelegramConfig
} = require('../lib/telegram-backup');

const CRON_SCHEDULE_FIELDS = [
    'unpaid_schedule',
    'schedule',
    'schedule_masa_tenggang',
    'schedule_unpaid_action',
    'schedule_isolir_notification',
    'schedule_compensation_revert',
    'check_schedule',
    'schedule_telegram_backup',
    'schedule_rating_survey',
    'schedule_rating_digest'
];

const CRON_BOOLEAN_FIELDS = [
    'status_unpaid_schedule',
    'status_schedule',
    'status_masa_tenggang',
    'status_message_paid_notification',
    'status_schedule_unpaid_action',
    'status_message_isolir_notification',
    'status_compensation_revert',
    'status_message_compensation_reverted',
    'status_message_compensation_applied',
    'status_speed_boost_revert',
    'status_message_sod_applied',
    'status_message_sod_reverted',
    'status_check_schedule',
    'status_telegram_backup',
    'status_rating_survey',
    'status_rating_digest'
];

const CRON_ALLOWED_FIELDS = new Set([
    ...CRON_SCHEDULE_FIELDS,
    ...CRON_BOOLEAN_FIELDS
]);

function normalizeCronPatch(input = {}) {
    const normalized = {};
    for (const [key, rawValue] of Object.entries(input)) {
        if (!CRON_ALLOWED_FIELDS.has(key)) {
            continue;
        }

        if (CRON_SCHEDULE_FIELDS.includes(key)) {
            normalized[key] = String(rawValue || '').trim();
            continue;
        }

        normalized[key] = rawValue === true || rawValue === 'true';
    }
    return normalized;
}

function validateCronPatch(cronPatch = {}) {
    for (const field of CRON_SCHEDULE_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(cronPatch, field)) {
            continue;
        }

        const value = String(cronPatch[field] || '').trim();
        if (value === '') {
            return {
                ok: false,
                field,
                message: `Jadwal cron untuk '${field}' tidak boleh kosong.`
            };
        }

        if (value.startsWith('#')) {
            continue;
        }

        if (!isValidCron(value)) {
            return {
                ok: false,
                field,
                message: `Jadwal cron tidak valid untuk kolom '${field}'. Gunakan format cron yang benar atau awali dengan # untuk menonaktifkan.`
            };
        }
    }

    return { ok: true };
}

function loadCronConfigFromFile() {
    const cronConfigPath = path.join(__dirname, '..', 'database', 'cron.json');
    return JSON.parse(fs.readFileSync(cronConfigPath, 'utf8'));
}

function registerAdminConfigRoutes({ router, ensureAuthenticatedStaff, logActivity, loadJSON, saveJSON, runtime }) {
    const genieAcsParameterConfigService = createGenieAcsParameterConfigService({ loadJSON, saveJSON });
    const mikrotikDeviceConfigService = createMikrotikDeviceConfigService();

    function requireRuntimeConfig() {
        if (!runtime || typeof runtime.setConfig !== 'function' || typeof runtime.getConfig !== 'function') {
            throw new Error('Runtime config belum tersedia.');
        }
        return runtime;
    }

    function requireAdmin(req) {
        if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
            throw createError(ErrorTypes.AUTHORIZATION_ERROR, "Akses ditolak.", 403);
        }
    }

    router.get('/api/config', ensureAuthenticatedStaff, (req, res) => {
        if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ message: "Akses ditolak." });
        }

        try {
            const mainConfigPath = path.join(__dirname, '..', 'config.json');
            const speedBoostConfigPath = path.join(__dirname, '..', 'database', 'speed_boost_matrix.json');

            const mainConfig = runtime && typeof runtime.getConfig === 'function'
                ? (runtime.getConfig() || JSON.parse(fs.readFileSync(mainConfigPath, 'utf8')))
                : JSON.parse(fs.readFileSync(mainConfigPath, 'utf8'));

            let speedOnDemandEnabled = true;
            try {
                if (fs.existsSync(speedBoostConfigPath)) {
                    const speedBoostConfig = JSON.parse(fs.readFileSync(speedBoostConfigPath, 'utf8'));
                    speedOnDemandEnabled = speedBoostConfig.enabled !== false;
                }
            } catch (err) {
                console.warn('[API_CONFIG_GET] Failed to load speed boost config:', err.message);
            }

            const configPayload = {
                ...mainConfig,
                speedOnDemandEnabled,
                showPaymentStatus: mainConfig.showPaymentStatus !== false,
                showDueDate: mainConfig.showDueDate !== false,
                customerTrafficUsageEnabled: mainConfig.customerTrafficUsageEnabled === true,
                customerTrafficLiveEnabled: mainConfig.customerTrafficLiveEnabled === true,
                genieacsEnabled: mainConfig.genieacsEnabled !== false,
                genieacsCustomerRebootEnabled: mainConfig.genieacsCustomerRebootEnabled !== false,
                genieacsAdminRebootEnabled: mainConfig.genieacsAdminRebootEnabled !== false,
                genieacsWifiManagementEnabled: mainConfig.genieacsWifiManagementEnabled !== false,
                genieacsPsbDeviceProvisioningEnabled: mainConfig.genieacsPsbDeviceProvisioningEnabled !== false,
                isolirFeatureEnabled: mainConfig.isolirFeatureEnabled !== false,
                isolirManualEnabled: mainConfig.isolirManualEnabled !== false,
                isolirManualDefaultProfile: mainConfig.isolirManualDefaultProfile || mainConfig.isolir_profile || 'ISOLIR',
                isolirManualAllowCustomProfile: mainConfig.isolirManualAllowCustomProfile !== false,
                isolirManualDefaultDisconnect: mainConfig.isolirManualDefaultDisconnect !== false,
                isolirManualDefaultReboot: mainConfig.isolirManualDefaultReboot === true,
                isolirOpenDefaultReboot: mainConfig.isolirOpenDefaultReboot === true,
                psbIntake: {
                    enabled: !!(mainConfig.psbIntake && mainConfig.psbIntake.enabled),
                    groupId: (mainConfig.psbIntake && mainConfig.psbIntake.groupId) || '',
                    allowedRoles: (mainConfig.psbIntake && mainConfig.psbIntake.allowedRoles) || ['teknisi', 'admin', 'owner'],
                    recencyWindowMinutes: (mainConfig.psbIntake && mainConfig.psbIntake.recencyWindowMinutes) || 120,
                    freeInstallMonth: !!(mainConfig.psbIntake && mainConfig.psbIntake.freeInstallMonth),
                    // Alamat pelanggan dirakit bot: `Dsn. <dusun> RT/RW Ds. <desa> Kec. <kecamatan>`.
                    // dusunList = pilihan bernomor di wizard WA (ejaan konsisten → username PPPoE konsisten).
                    desa: (mainConfig.psbIntake && mainConfig.psbIntake.desa) || '',
                    kecamatan: (mainConfig.psbIntake && mainConfig.psbIntake.kecamatan) || '',
                    dusunList: (mainConfig.psbIntake && Array.isArray(mainConfig.psbIntake.dusunList))
                        ? mainConfig.psbIntake.dusunList
                        : []
                },
                repairNotif: {
                    enabled: !!(mainConfig.repairNotif && mainConfig.repairNotif.enabled),
                    groupId: (mainConfig.repairNotif && mainConfig.repairNotif.groupId) || '',
                    notifyNewTicket: !(mainConfig.repairNotif && mainConfig.repairNotif.notifyNewTicket === false),
                    notifyCompleted: !(mainConfig.repairNotif && mainConfig.repairNotif.notifyCompleted === false)
                },
                teknisiTutorialUrl: mainConfig.teknisiTutorialUrl || ''
            };

            res.status(200).json({
                status: 200,
                data: configPayload
            });
        } catch (error) {
            console.error('[API_CONFIG_GET_ERROR]', error);
            res.status(500).json({
                status: 500,
                message: 'Gagal mengambil konfigurasi.',
                error: error.message
            });
        }
    });

    router.get('/api/cron', ensureAuthenticatedStaff, (req, res) => {
        if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ message: "Akses ditolak." });
        }

        try {
            res.status(200).json({
                status: 200,
                data: loadCronConfigFromFile()
            });
        } catch (error) {
            console.error('[API_CRON_GET_ERROR]', error);
            res.status(500).json({
                status: 500,
                message: 'Gagal mengambil konfigurasi cron.',
                error: error.message
            });
        }
    });

    router.get('/api/genieacs/feature-status', ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!req.user || !['admin', 'owner', 'superadmin', 'teknisi'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Akses ditolak.' });
        }

        try {
            const status = await getGenieAcsFeatureStatus({
                feature: 'adminReboot',
                includeDiagnostics: true,
                caller: 'admin.genieacs-feature-status',
            });
            return res.status(200).json({
                status: 200,
                data: status,
            });
        } catch (error) {
            return res.status(500).json({
                status: 500,
                message: error.message || 'Gagal mengambil status GenieACS.',
            });
        }
    }));

    router.post('/api/cron', ensureAuthenticatedStaff, (req, res) => {
        if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ message: "Akses ditolak." });
        }

        const cronDbPath = path.join(__dirname, '..', 'database', 'cron.json');
        const cronPatch = normalizeCronPatch(req.body);
        const validation = validateCronPatch(cronPatch);
        if (!validation.ok) {
            return res.status(400).json({
                message: validation.message,
                field: validation.field
            });
        }

        try {
            const nextCronConfig = {
                ...loadCronConfigFromFile(),
                ...cronPatch
            };

            fs.writeFileSync(cronDbPath, JSON.stringify(nextCronConfig, null, 2), 'utf8');
            global.cronConfig = nextCronConfig;
            initializeAllCronTasks();

            res.status(200).json({ message: 'Konfigurasi cron berhasil diperbarui dan jadwal telah dimuat ulang.' });
        } catch (error) {
            console.error('[API_CRON_SAVE_ERROR]', error);
            res.status(500).json({ message: 'Gagal menyimpan konfigurasi cron.', error: error.message });
        }
    });

    router.post('/api/config', ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ message: "Akses ditolak." });
        }

        const mainConfigPath = path.join(__dirname, '..', 'config.json');

        try {
            const receivedConfig = req.body;
            const currentMainConfig = JSON.parse(fs.readFileSync(mainConfigPath, 'utf8'));
            const newMainConfig = {};

            for (const key in receivedConfig) {
                if (!Object.prototype.hasOwnProperty.call(receivedConfig, key)) {
                    continue;
                }

                if (key === 'ipaymuProduction' || key === 'tripayProduction' || key === 'mayarSandbox') {
                    newMainConfig[key] = receivedConfig[key] === 'yes';
                    continue;
                }

                if (key === 'custom_wifi_modification' || key === 'sync_to_mikrotik') {
                    newMainConfig[key] = receivedConfig[key] === 'true';
                    continue;
                }

                if (key === 'speedOnDemandEnabled') {
                    const speedBoostConfigPath = path.join(__dirname, '..', 'database', 'speed_boost_matrix.json');
                    try {
                        let speedBoostConfig = { enabled: true };
                        if (fs.existsSync(speedBoostConfigPath)) {
                            speedBoostConfig = JSON.parse(fs.readFileSync(speedBoostConfigPath, 'utf8'));
                        }
                        speedBoostConfig.enabled = receivedConfig[key] === 'true';
                        speedBoostConfig.lastUpdated = new Date().toISOString();
                        fs.writeFileSync(speedBoostConfigPath, JSON.stringify(speedBoostConfig, null, 2), 'utf8');

                        if (global.speedBoostConfig) {
                            global.speedBoostConfig = speedBoostConfig;
                        }

                        console.log('[CONFIG_SAVE] Speed On Demand updated:', speedBoostConfig.enabled);
                    } catch (err) {
                        console.error('[CONFIG_SAVE] Failed to update speed boost config:', err);
                    }
                    continue;
                }

                if (
                    key === 'showPaymentStatus' ||
                    key === 'showDueDate' ||
                    key === 'teknisiCollectionCommissionEnabled' ||
                    key === 'agenCollectionCommissionEnabled' ||
                    key === 'customerTrafficUsageEnabled' ||
                    key === 'customerTrafficLiveEnabled' ||
                    key === 'genieacsEnabled' ||
                    key === 'genieacsCustomerRebootEnabled' ||
                    key === 'genieacsAdminRebootEnabled' ||
                    key === 'genieacsWifiManagementEnabled' ||
                    key === 'genieacsPsbDeviceProvisioningEnabled' ||
                    key === 'isolirFeatureEnabled' ||
                    key === 'isolirManualEnabled' ||
                    key === 'isolirManualAllowCustomProfile' ||
                    key === 'isolirManualDefaultDisconnect' ||
                    key === 'isolirManualDefaultReboot' ||
                    key === 'isolirOpenDefaultReboot'
                ) {
                    newMainConfig[key] = receivedConfig[key] === 'true';
                    continue;
                }

                if (key === 'isolirManualDefaultProfile') {
                    newMainConfig[key] = String(receivedConfig[key] || '').trim();
                    continue;
                }

                // Alert redaman → objek nested `redamanAlert`. Penerima dulu DI-HARDCODE
                // "semua akun berponsel" tanpa filter peran; kini pemilik bisa membatasi
                // (mis. teknisi saja) + menambah nomor di luar akun.
                if (key === 'redamanAlertEnabled' || key === 'redamanAlertRoles' || key === 'redamanAlertExtraNumbers'
                    || key === 'redamanAlertHanyaPelangganSendiri' || key === 'redamanAlertMaxDataAgeMinutes'
                    || key === 'redamanAlertCooldownHours') {
                    if (!newMainConfig.redamanAlert) newMainConfig.redamanAlert = {};
                    if (key === 'redamanAlertHanyaPelangganSendiri') {
                        newMainConfig.redamanAlert.hanyaPelangganSendiri = receivedConfig[key] === 'true';
                        continue;
                    }
                    if (key === 'redamanAlertMaxDataAgeMinutes' || key === 'redamanAlertCooldownHours') {
                        // Kotak KOSONG = "pakai bawaan", jadi key-nya DIHAPUS, bukan disimpan 0 —
                        // menyimpan 0 berarti "matikan gerbang", makna yang sama sekali berbeda.
                        const target = key === 'redamanAlertMaxDataAgeMinutes' ? 'maxDataAgeMinutes' : 'cooldownHours';
                        const mentah = String(receivedConfig[key] ?? '').trim();
                        const angka = Number.parseFloat(mentah);
                        if (mentah === '' || !Number.isFinite(angka) || angka < 0) {
                            delete newMainConfig.redamanAlert[target];
                        } else {
                            newMainConfig.redamanAlert[target] = angka;
                        }
                        continue;
                    }
                    if (key === 'redamanAlertEnabled') {
                        newMainConfig.redamanAlert.enabled = receivedConfig[key] === 'true';
                    } else if (key === 'redamanAlertRoles') {
                        // Datang sebagai ARRAY dari <select multiple>. Array KOSONG sah dan
                        // WAJIB tersimpan apa adanya — artinya "tak ada peran yang dialerti",
                        // beda dari `roles` yang absen (= semua peran, perilaku lama).
                        const nilai = receivedConfig[key];
                        newMainConfig.redamanAlert.roles = (Array.isArray(nilai) ? nilai : String(nilai || '').split(','))
                            .map((r) => String(r || '').trim().toLowerCase())
                            .filter(Boolean);
                    } else {
                        newMainConfig.redamanAlert.extraNumbers = String(receivedConfig[key] || '')
                            .split(',')
                            .map((n) => n.trim())
                            .filter(Boolean);
                    }
                    continue;
                }

                if (key === 'teknisiCollectionCommissionAmount' || key === 'agenCollectionCommissionAmount') {
                    newMainConfig[key] = Math.max(0, parseInt(receivedConfig[key], 10) || 0);
                    continue;
                }

                if (key === 'welcomeMessageEnabled' || key === 'customerPortalUrl') {
                    if (!newMainConfig.welcomeMessage) {
                        newMainConfig.welcomeMessage = {};
                    }
                    if (key === 'welcomeMessageEnabled') {
                        newMainConfig.welcomeMessage.enabled = receivedConfig[key] === 'true';
                    } else {
                        newMainConfig.welcomeMessage.customerPortalUrl = receivedConfig[key];
                    }
                    continue;
                }

                // Intake PSB Grup → objek nested `psbIntake`. allowedRoles tidak diedit dari UI
                // (dipertahankan dari config lama saat merge). Feature-flag default OFF.
                if (key === 'psbIntakeEnabled' || key === 'psbIntakeGroupId' || key === 'psbIntakeRecency'
                    || key === 'psbIntakeFreeInstallMonth' || key === 'psbIntakeDesa'
                    || key === 'psbIntakeKecamatan' || key === 'psbIntakeDusunList') {
                    if (!newMainConfig.psbIntake) {
                        newMainConfig.psbIntake = {};
                    }
                    if (key === 'psbIntakeEnabled') {
                        newMainConfig.psbIntake.enabled = receivedConfig[key] === 'true';
                    } else if (key === 'psbIntakeGroupId') {
                        newMainConfig.psbIntake.groupId = String(receivedConfig[key] || '').trim();
                    } else if (key === 'psbIntakeFreeInstallMonth') {
                        newMainConfig.psbIntake.freeInstallMonth = receivedConfig[key] === 'true';
                    } else if (key === 'psbIntakeDesa') {
                        newMainConfig.psbIntake.desa = String(receivedConfig[key] || '').trim();
                    } else if (key === 'psbIntakeKecamatan') {
                        newMainConfig.psbIntake.kecamatan = String(receivedConfig[key] || '').trim();
                    } else if (key === 'psbIntakeDusunList') {
                        // Dikirim sebagai teks dipisah koma/baris baru → array bersih & unik (urutan dipertahankan,
                        // karena NOMOR pilihan di WA mengikuti urutan daftar ini).
                        const seen = new Set();
                        newMainConfig.psbIntake.dusunList = String(receivedConfig[key] || '')
                            .split(/[,\n]/)
                            .map((s) => s.trim())
                            .filter((s) => {
                                if (!s) return false;
                                const k = s.toLowerCase();
                                if (seen.has(k)) return false;
                                seen.add(k);
                                return true;
                            });
                    } else {
                        const n = parseInt(receivedConfig[key], 10);
                        newMainConfig.psbIntake.recencyWindowMinutes = (Number.isFinite(n) && n > 0) ? Math.min(1440, Math.max(5, n)) : 120;
                    }
                    continue;
                }

                // Notif Perbaikan (grup terpisah) → objek nested `repairNotif`. notifyNewTicket/notifyCompleted
                // tak diedit dari UI (dipertahankan saat merge). Feature-flag default OFF.
                if (key === 'repairNotifEnabled' || key === 'repairNotifGroupId') {
                    if (!newMainConfig.repairNotif) {
                        newMainConfig.repairNotif = {};
                    }
                    if (key === 'repairNotifEnabled') {
                        newMainConfig.repairNotif.enabled = receivedConfig[key] === 'true';
                    } else {
                        newMainConfig.repairNotif.groupId = String(receivedConfig[key] || '').trim();
                    }
                    continue;
                }

                if (key === 'teknisiTutorialUrl') {
                    newMainConfig.teknisiTutorialUrl = String(receivedConfig[key] == null ? '' : receivedConfig[key]).trim();
                    continue;
                }

                // Panduan "Cara pakai voucher" di halaman beli publik → objek nested `voucherGuide`.
                // steps = teks multi-baris (1 langkah/baris); loginUrl opsional (link login hotspot).
                if (key === 'voucherGuideSteps' || key === 'voucherLoginUrl') {
                    if (!newMainConfig.voucherGuide) {
                        newMainConfig.voucherGuide = {};
                    }
                    if (key === 'voucherGuideSteps') {
                        newMainConfig.voucherGuide.steps = String(receivedConfig[key] == null ? '' : receivedConfig[key]);
                    } else {
                        newMainConfig.voucherGuide.loginUrl = String(receivedConfig[key] == null ? '' : receivedConfig[key]).trim();
                    }
                    continue;
                }

                // Identitas & Kontak Usaha → dipetakan ke objek nested `company` (dipakai halaman
                // publik FAQ/Refund/Syarat/Kontak). company_name juga menyinkron `nama` (brand global).
                if (key === 'company_name' || key === 'company_phone' || key === 'company_email'
                    || key === 'company_address' || key === 'company_website') {
                    if (!newMainConfig.company) {
                        newMainConfig.company = {};
                    }
                    const sub = key.slice('company_'.length);
                    newMainConfig.company[sub] = String(receivedConfig[key] == null ? '' : receivedConfig[key]).trim();
                    if (key === 'company_name' && newMainConfig.company.name) {
                        newMainConfig.nama = newMainConfig.company.name;
                    }
                    continue;
                }

                if (CRON_ALLOWED_FIELDS.has(key)) {
                    console.warn(`[API_CONFIG_SAVE] Ignoring cron-owned config key from /api/config: ${key}`);
                    continue;
                }

                newMainConfig[key] = receivedConfig[key];
            }

            const finalMainConfig = { ...currentMainConfig, ...newMainConfig };
            if (newMainConfig.welcomeMessage) {
                finalMainConfig.welcomeMessage = {
                    ...(currentMainConfig.welcomeMessage || {}),
                    ...newMainConfig.welcomeMessage
                };
            }
            if (newMainConfig.company) {
                finalMainConfig.company = {
                    ...(currentMainConfig.company || {}),
                    ...newMainConfig.company
                };
            }
            if (newMainConfig.psbIntake) {
                finalMainConfig.psbIntake = {
                    ...(currentMainConfig.psbIntake || {}),
                    ...newMainConfig.psbIntake
                };
            }
            if (newMainConfig.repairNotif) {
                finalMainConfig.repairNotif = {
                    ...(currentMainConfig.repairNotif || {}),
                    ...newMainConfig.repairNotif
                };
            }
            if (newMainConfig.voucherGuide) {
                finalMainConfig.voucherGuide = {
                    ...(currentMainConfig.voucherGuide || {}),
                    ...newMainConfig.voucherGuide
                };
            }

            fs.writeFileSync(mainConfigPath, JSON.stringify(finalMainConfig, null, 4), 'utf8');
            requireRuntimeConfig().setConfig(finalMainConfig);

            console.log('[CONFIG_SAVE] Config saved. accessLimit:', finalMainConfig.accessLimit || 'not set');

            try {
                const changedKeys = Object.keys(newMainConfig);
                await logActivity({
                    userId: req.user.id,
                    username: req.user.username,
                    role: req.user.role,
                    actionType: 'UPDATE',
                    resourceType: 'config',
                    resourceId: 'system',
                    resourceName: 'System Configuration',
                    description: `Updated system configuration (${changedKeys.length} keys changed)`,
                    oldValue: currentMainConfig,
                    newValue: finalMainConfig,
                    ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
                    userAgent: req.headers['user-agent']
                });
            } catch (logErr) {
                console.error('[ACTIVITY_LOG_ERROR] Failed to log config change:', logErr);
            }

            initializeAllCronTasks();

            res.status(200).json({ message: 'Konfigurasi berhasil disimpan dan diterapkan.' });
        } catch (error) {
            console.error('[API_CONFIG_SAVE_ERROR]', error);
            res.status(500).json({ message: 'Gagal memproses konfigurasi.', error: error.message });
        }
    }));

    // Daftar grup WhatsApp tempat bot jadi member — untuk dropdown pemilih grup PSB di halaman Config.
    router.get('/api/whatsapp/groups', ensureAuthenticatedStaff, asyncHandler(async (_req, res) => {
        try {
            const waAdapter = require('../lib/whatsapp.adapter');
            const groups = await waAdapter.getGroups();
            res.status(200).json({ success: true, groups });
        } catch (err) {
            res.status(503).json({ success: false, message: err.message || 'WhatsApp belum terkoneksi', groups: [] });
        }
    }));

    router.get('/api/telegram-backup/config', ensureAuthenticatedStaff, (req, res) => {
        if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: "Akses ditolak." });
        }

        try {
            const mainConfigPath = path.join(__dirname, '..', 'config.json');
            const mainConfig = runtime && typeof runtime.getConfig === 'function'
                ? { ...(runtime.getConfig() || {}) }
                : JSON.parse(fs.readFileSync(mainConfigPath, 'utf8'));

            res.json({
                status: 200,
                message: 'Telegram backup config retrieved',
                data: {
                    botToken: mainConfig.telegramBackup?.botToken || '',
                    chatId: mainConfig.telegramBackup?.chatId || '',
                    enabled: mainConfig.telegramBackup?.enabled === true
                }
            });
        } catch (error) {
            console.error('[TELEGRAM_BACKUP_CONFIG_GET] Error:', error);
            res.status(500).json({
                status: 500,
                message: 'Gagal mengambil konfigurasi Telegram backup',
                error: error.message
            });
        }
    });

    router.post('/api/telegram-backup/config', ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: "Akses ditolak." });
        }

        try {
            const { botToken, chatId, enabled } = req.body;
            const mainConfigPath = path.join(__dirname, '..', 'config.json');
            const mainConfig = JSON.parse(fs.readFileSync(mainConfigPath, 'utf8'));

            mainConfig.telegramBackup = {
                botToken: botToken || '',
                chatId: chatId || '',
                enabled: enabled === true || enabled === 'true'
            };

            fs.writeFileSync(mainConfigPath, JSON.stringify(mainConfig, null, 4), 'utf8');
            requireRuntimeConfig().setConfig(mainConfig);
            initializeAllCronTasks();

            try {
                await logActivity({
                    userId: req.user.id,
                    username: req.user.username,
                    role: req.user.role,
                    actionType: 'UPDATE',
                    resourceType: 'config',
                    resourceId: 'telegram-backup',
                    resourceName: 'Telegram Backup Configuration',
                    description: `Updated Telegram backup configuration (enabled: ${mainConfig.telegramBackup.enabled})`,
                    ipAddress: req.ip || req.connection.remoteAddress,
                    userAgent: req.headers['user-agent']
                });
            } catch (logErr) {
                console.error('[ACTIVITY_LOG_ERROR] Failed to log telegram config change:', logErr);
            }

            res.json({
                status: 200,
                message: 'Konfigurasi Telegram backup berhasil disimpan'
            });
        } catch (error) {
            console.error('[TELEGRAM_BACKUP_CONFIG_SAVE] Error:', error);
            res.status(500).json({
                status: 500,
                message: 'Gagal menyimpan konfigurasi Telegram backup',
                error: error.message
            });
        }
    }));

    router.post('/api/telegram-backup/test', ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: "Akses ditolak." });
        }

        try {
            const { botToken, chatId } = req.body;

            if (!botToken || !chatId) {
                return res.status(400).json({
                    status: 400,
                    message: 'Bot Token dan Chat ID harus diisi'
                });
            }

            const result = await testTelegramConnection(botToken, chatId);
            res.json({
                status: 200,
                message: result.message
            });
        } catch (error) {
            console.error('[TELEGRAM_BACKUP_TEST] Error:', error);
            res.status(400).json({
                status: 400,
                message: error.message
            });
        }
    }));

    router.post('/api/telegram-backup/run', ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: "Akses ditolak." });
        }

        try {
            const config = getTelegramConfig();

            if (!config.botToken || !config.chatId) {
                return res.status(400).json({
                    status: 400,
                    message: 'Konfigurasi Telegram belum lengkap. Silakan isi Bot Token dan Chat ID terlebih dahulu.'
                });
            }

            console.log(`[TELEGRAM_BACKUP] Manual backup triggered by ${req.user.username}`);

            performDatabaseBackup().then(result => {
                console.log('[TELEGRAM_BACKUP] Manual backup completed:', result);
            }).catch(err => {
                console.error('[TELEGRAM_BACKUP] Manual backup error:', err);
            });

            try {
                await logActivity({
                    userId: req.user.id,
                    username: req.user.username,
                    role: req.user.role,
                    actionType: 'CREATE',
                    resourceType: 'backup',
                    resourceId: 'telegram-backup',
                    resourceName: 'Manual Telegram Backup',
                    description: 'Triggered manual database backup to Telegram',
                    ipAddress: req.ip || req.connection.remoteAddress,
                    userAgent: req.headers['user-agent']
                });
            } catch (logErr) {
                console.error('[ACTIVITY_LOG_ERROR] Failed to log manual backup:', logErr);
            }

            res.json({
                status: 200,
                message: 'Backup sedang diproses. File akan dikirim ke Telegram dalam beberapa saat.'
            });
        } catch (error) {
            console.error('[TELEGRAM_BACKUP_RUN] Error:', error);
            res.status(500).json({
                status: 500,
                message: 'Gagal menjalankan backup: ' + error.message
            });
        }
    }));

    router.get('/api/genieacs-parameters', ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        requireAdmin(req);
        const data = genieAcsParameterConfigService.listParameters();
        res.status(200).json({
            status: 200,
            message: "Parameters retrieved successfully",
            data
        });
    }));

    router.post('/api/genieacs-parameters', ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        requireAdmin(req);
        const data = genieAcsParameterConfigService.createParameter(req.body, { username: req.user.username });
        res.status(200).json({
            status: 200,
            message: "Parameter created successfully",
            data
        });
    }));

    router.put('/api/genieacs-parameters/:id', ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        requireAdmin(req);
        const data = genieAcsParameterConfigService.updateParameter(req.params.id, req.body, { username: req.user.username });
        res.status(200).json({
            status: 200,
            message: "Parameter updated successfully",
            data
        });
    }));

    router.delete('/api/genieacs-parameters/:id', ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        requireAdmin(req);
        genieAcsParameterConfigService.deleteParameter(req.params.id);
        res.status(200).json({
            status: 200,
            message: "Parameter deleted successfully"
        });
    }));

    // !! MEMBACA daftar perangkat = MEMBACA KREDENSIAL ROUTER INTI.
    // `listDevices()` memulangkan isi `database/mikrotik_devices.json` APA ADANYA — host, port,
    // user, dan `password` tanpa redaksi. Dulu kedua GET ini hanya bergerbang
    // `ensureAuthenticatedStaff`, yang MEMASUKKAN peran `teknisi` (routes/admin-auth.js) —
    // sementara POST/PUT/set-active di bawah sudah memanggil `requireAdmin`. Terbukti di produksi
    // 2026-08-21: akun teknisi memanggil GET ini dan menerima host 192.168.252.1:8799 beserta
    // sandinya. Asumsi "yang berbahaya cuma menulis" itu salah: membaca kredensial sama
    // berbahayanya. Satu-satunya pemakai sah adalah halaman /config yang memang admin-only.
    router.get('/api/mikrotik-devices', ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        requireAdmin(req);
        const result = mikrotikDeviceConfigService.listDevices();
        return res.status(result.status).json(result.body);
    }));

    router.get('/api/mikrotik-devices/:id', ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        requireAdmin(req);
        const result = mikrotikDeviceConfigService.getDeviceById(req.params.id);
        return res.status(result.status).json(result.body);
    }));

    router.post('/api/mikrotik-devices', ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        requireAdmin(req);
        const result = mikrotikDeviceConfigService.createDevice(req.body);
        return res.status(result.status).json(result.body);
    }));

    router.put('/api/mikrotik-devices/:id', ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        requireAdmin(req);
        const result = mikrotikDeviceConfigService.updateDevice(req.params.id, req.body);
        return res.status(result.status).json(result.body);
    }));

    router.post('/api/mikrotik-devices/set-active/:id', ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        requireAdmin(req);
        const result = mikrotikDeviceConfigService.setActiveDevice(req.params.id);
        return res.status(result.status).json(result.body);
    }));
}

module.exports = {
    registerAdminConfigRoutes,
    CRON_ALLOWED_FIELDS
};
