/**
 * Header Doc
 * Purpose: Membentuk runtime aplikasi tunggal yang membungkus config, state bersama, repository state, dan startup background services.
 * Caller: `index.js` sebagai composition root utama.
 * Deps: `./runtime-state`, `./runtime-repositories`, script startup, dan service background existing.
 * MainFuncs: `createAppRuntime`, getter/setter runtime state penting, dan bootstrap background services.
 * SideEffects: Menulis `global.__appRuntime`, menjadwalkan background services, dan menjaga kompatibilitas `global.*`.
 */
"use strict";

const { createRuntimeState, ensureDefaultState } = require("./runtime-state");
const { createRuntimeRepositories } = require("./runtime-repositories");

function createAppRuntime(options = {}) {
    const globalScope = options.globalScope || global;
    ensureDefaultState(globalScope);

    const runtimeState = createRuntimeState(globalScope);
    const runtime = {
        globalScope,
        state: runtimeState,
        repositories: createRuntimeRepositories(runtimeState),
        config: options.config || globalScope.config || null,
        monitoringConfig: options.monitoringConfig || globalScope.monitoringConfig || null,
        port: options.port || process.env.PORT || 3100,
        dbInitPromise: options.dbInitPromise || globalScope.__dbInitPromise || Promise.resolve(),
        services: options.services || {},
        gateways: options.gateways || {},
        adapters: options.adapters || {},
        caches: options.caches || {},
        backgroundServicesStarted: false,
        setConfig(nextConfig) {
            this.config = nextConfig;
            globalScope.config = nextConfig;
            this.repositories.config.set(nextConfig);
            return nextConfig;
        },
        getConfig() {
            return this.repositories.config.get() || this.config || null;
        },
        setMonitoringConfig(nextConfig) {
            this.monitoringConfig = nextConfig;
            globalScope.monitoringConfig = nextConfig;
            this.repositories.monitoringConfig.set(nextConfig);
            return nextConfig;
        },
        getMonitoringConfig() {
            return this.repositories.monitoringConfig.get() || this.monitoringConfig || null;
        },
        setDb(db) {
            this.repositories.db.set(db);
            globalScope.db = db;
            return db;
        },
        getDb() {
            return this.repositories.db.get() || globalScope.db || null;
        },
        setIo(io) {
            this.repositories.io.set(io);
            globalScope.io = io;
            return io;
        },
        getIo() {
            return this.repositories.io.get() || globalScope.io || null;
        },
        getRepository(name) {
            const repository = this.repositories[name];
            if (!repository) {
                throw new Error(`Runtime repository '${name}' tidak terdaftar.`);
            }
            return repository;
        },
        async initializeBackgroundServices() {
            if (this.backgroundServicesStarted) {
                return;
            }

            this.backgroundServicesStarted = true;

            const {
                initializeAllCronTasks,
                initializeUploadDirs,
                CustomerTrafficUsageService,
                oltLogScraper
            } = this.services;

            const { runAutoMigration } = require("../scripts/auto-migrate-on-startup");
            const { initTopupExpiryChecker } = require("./topup-expiry");
            const { scheduleSpeedBoostCleanup } = require("./speed-boost-cleanup");

            scheduleSpeedBoostCleanup();

            this.dbInitPromise.then(async () => {
                runAutoMigration().catch((err) => {
                    console.error("[STARTUP] Auto-migration failed:", err.message);
                });

                if (typeof initializeAllCronTasks === "function") {
                    initializeAllCronTasks();
                }

                if (typeof initializeUploadDirs === "function") {
                    initializeUploadDirs();
                }

                require("./temp-cleanup");
                initTopupExpiryChecker();

                try {
                    if (oltLogScraper && typeof oltLogScraper.startScraper === "function") {
                        oltLogScraper.startScraper();
                    }
                } catch (err) {
                    console.error("[OLT-Scraper] Failed to start:", err.message);
                }

                // OLT syslog receiver — push-based alternative ke web scrape.
                // Berjalan parallel; admin enable lewat config.oltSyslog.enabled=true
                // setelah OLT-side `logging host` di-config (lihat docs).
                try {
                    const oltSyslog = require("./olt-syslog-receiver");
                    if (oltSyslog && typeof oltSyslog.startSyslogReceiver === "function") {
                        oltSyslog.startSyslogReceiver();
                    }
                } catch (err) {
                    console.error("[OLT-Syslog] Failed to start:", err.message);
                }

                // OLT event-log — prune retensi berkala untuk log durable enriched
                // (olt_events.sqlite). Never-throw; timer harian ber-unref.
                try {
                    const oltEventRepo = require("../repositories/olt-event.repository").getOltEventRepository();
                    const oltLogCfg = (global.config && global.config.oltEventLog) || {};
                    const retentionDays = Number.isFinite(oltLogCfg.retentionDays) ? oltLogCfg.retentionDays : 90;
                    oltEventRepo.pruneOld(retentionDays).catch(() => {});
                    const pruneTimer = setInterval(() => {
                        oltEventRepo.pruneOld(retentionDays).catch(() => {});
                    }, 24 * 60 * 60 * 1000);
                    if (pruneTimer && typeof pruneTimer.unref === "function") pruneTimer.unref();
                } catch (err) {
                    console.error("[OLT-EventLog] Prune init gagal:", err.message);
                }

                // OLT state — perawatan state modem OLT (reconcile insiden nyangkut + prune +
                // backfill-if-empty dari olt_events). Shadow: tabel baru olt_state.sqlite, gated
                // `config.oltModemState`, never-throw. Lihat docs/olt-modem-state-blueprint.md.
                try {
                    require("./olt-state-maintenance").startOltStateMaintenance();
                } catch (err) {
                    console.error("[OLT-State] maintenance init gagal:", err.message);
                }

                // Warm-up index GenieACS MAC→pelanggan (resolver log & broadcaster LOS) supaya
                // event OLT pertama pun sudah ter-enrich. Fire-and-forget, never-throw.
                try {
                    require("./olt-genieacs-resolver").ensureFresh();
                } catch (err) {
                    console.error("[OLT-EventLog] Warm-up resolver GenieACS gagal:", err.message);
                }

                // OLT rxPower poller — sampling optik berkala untuk perkuat
                // klasifikasi DG vs LOS (Phase 2). Enable via config.oltRxPowerHistory.enabled.
                try {
                    const oltRxPoller = require("./olt-rxpower-poller");
                    if (oltRxPoller && typeof oltRxPoller.startRxPowerPoller === "function") {
                        oltRxPoller.startRxPowerPoller();
                    }
                } catch (err) {
                    console.error("[OLT-rxPoller] Failed to start:", err.message);
                }

                // OLT SNMP LOS poller — untuk brand GPON yang lapor status via SNMP
                // (mis. ZTE C320). Deteksi transisi LOS → feed broadcaster. HIOSO pakai
                // scraper/syslog, bukan ini. Aktif bila config.oltLosBroadcast.enabled.
                try {
                    const oltSnmpLos = require("./olt-snmp-los-poller");
                    if (oltSnmpLos && typeof oltSnmpLos.startSnmpLosPoller === "function") {
                        oltSnmpLos.startSnmpLosPoller();
                    }
                } catch (err) {
                    console.error("[OLT-SNMP-LOS] Failed to start:", err.message);
                }

                // CCTV monitor — poll netwatch MikroTik tiap config.cctvMonitor.pollIntervalMs;
                // saat host CCTV terdaftar down > confirmation window → broadcast WA ke pelanggan.
                try {
                    const cctv = require("./cctv-monitor");
                    if (cctv && typeof cctv.startCctvMonitor === "function") {
                        cctv.startCctvMonitor();
                    }
                } catch (err) {
                    console.error("[CCTV] Failed to start:", err.message);
                }

                // Poller kualitas jalur upstream — ping policy-routed per routing-table dari
                // router gateway (GMDP/IH/MNI/SF), simpan loss/RTT ke upstream_quality.sqlite.
                // Aktif bila config.upstreamMonitor.enabled + kredensial API terisi.
                try {
                    const upq = require("./upstream-quality-poller");
                    if (upq && typeof upq.startUpstreamQualityPoller === "function") {
                        upq.startUpstreamQualityPoller();
                    }
                } catch (err) {
                    console.error("[UPQ-Poller] Failed to start:", err.message);
                }

                // Follow-up reboot modem — tick memindai `database/reboot-followups.json` dan
                // MEMVERIFIKASI modem benar-benar kembali sebelum bertanya ke pelanggan.
                // Job dibaca dari disk tiap tick → selamat dari pm2 restart. Gate config.rebootAssist.enabled.
                try {
                    const rebootFu = require("./reboot-followup-service");
                    if (rebootFu && typeof rebootFu.startRebootFollowupScheduler === "function") {
                        rebootFu.startRebootFollowupScheduler();
                    }
                } catch (err) {
                    console.error("[REBOOTFU] Failed to start:", err.message);
                }

                // Digest notifikasi pengajuan pembayaran — tick memindai bucket tertahan di
                // database/notification-digest.json dan mengirim ringkasan saat jendela tutup.
                // Bucket dibaca dari disk tiap tick → selamat dari pm2 restart. Gate config.paymentRequestDigest.enabled.
                try {
                    const digest = require("./notification-digest");
                    if (digest && typeof digest.startDigestScheduler === "function") {
                        digest.startDigestScheduler();
                    }
                } catch (err) {
                    console.error("[NOTIF_DIGEST] Failed to start:", err.message);
                }

                // Prober reachability per-layanan per-jalur (TCP+TLS bind source-IP).
                // Aktif bila config.serviceMonitor.enabled + ada jalur ber-srcIp.
                try {
                    const svcProber = require("./service-reachability-prober");
                    if (svcProber && typeof svcProber.startServiceProber === "function") {
                        svcProber.startServiceProber();
                    }
                } catch (err) {
                    console.error("[SvcProber] Failed to start:", err.message);
                }

                // Reconciler steering pelanggan — jaga entri /32 RAF-STEER mengikuti IP PPPoE
                // yang berubah saat reconnect. Aktif bila config.customerSteering.enabled.
                try {
                    const custSteer = require("./customer-steering-service");
                    if (custSteer && typeof custSteer.startCustomerSteeringReconciler === "function") {
                        custSteer.startCustomerSteeringReconciler();
                    }
                } catch (err) {
                    console.error("[CustSteer] Failed to start:", err.message);
                }

                // Pemantau drift steering — ingatkan admin bila peta pool (jaring pengaman resolver
                // jalur) tak lagi cocok dengan address-list live freedns/lokaldns. READ-ONLY router.
                // Tick harian + sekali saat boot. Gate config.steeringDriftMonitor.enabled (default MATI).
                try {
                    const driftMon = require("./steering-drift-monitor");
                    if (driftMon && typeof driftMon.startSteeringDriftMonitor === "function") {
                        driftMon.startSteeringDriftMonitor();
                    }
                } catch (err) {
                    console.error("[STEER-DRIFT] Failed to start:", err.message);
                }

                // Bot Telegram teknisi — long-poll getUpdates (single-consumer, cocok dengan
                // invariant single-instance). READ-ONLY: cek redaman/koneksi/modem/olt/pelanggan.
                // Aktif bila config.telegramTeknisi.enabled && botToken terisi (token WAJIB beda
                // dari telegramBackup agar tidak konflik 409).
                try {
                    const tgTeknisi = require("./telegram/telegram-teknisi-bootstrap");
                    if (tgTeknisi && typeof tgTeknisi.startTelegramTeknisiBot === "function") {
                        tgTeknisi.startTelegramTeknisiBot();
                    }
                } catch (err) {
                    console.error("[TELEGRAM_TEKNISI] Failed to start:", err.message);
                }

                try {
                    if (CustomerTrafficUsageService && typeof CustomerTrafficUsageService.startCollector === "function") {
                        await CustomerTrafficUsageService.startCollector();
                    }
                } catch (err) {
                    console.error("[CUSTOMER_TRAFFIC] Failed to start collector:", err.message);
                }
            }).catch((err) => {
                console.error("[DATABASE] Failed to initialize database:", err);
            });
        }
    };

    runtime.repositories.config.set(runtime.config);
    runtime.repositories.monitoringConfig.set(runtime.monitoringConfig);
    runtime.repositories.db.set(globalScope.db || null);
    runtime.repositories.io.set(globalScope.io || null);

    globalScope.__appRuntime = runtime;
    return runtime;
}

module.exports = {
    createAppRuntime
};
