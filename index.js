/**
 * Header Doc
 * Purpose: Composition root aplikasi untuk bootstrap runtime, HTTP server, Socket.IO, dan lifecycle WhatsApp.
 * Caller: Node.js runtime melalui `npm start` / `node index.js`.
 * Deps: `lib/app-runtime`, `lib/http-app`, `lib/public-site-app`, `lib/process-lifecycle`, `lib/http-security`, `lib/http-auth-bootstrap`, `lib/http-socket-bootstrap`, `lib/routes-registry`, `lib/whatsapp-bootstrap`, database, cron, dan router existing.
 * MainFuncs: Inisialisasi config, membuat runtime bersama, memasang bootstrap middleware/process/socket, lalu memulai HTTP + WhatsApp.
 * SideEffects: Membuka server HTTP, menginisialisasi database, menulis `global.*`, dan menjaga koneksi WhatsApp aktif.
 */
process.env.TZ = 'Asia/Jakarta';

const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const { createServer } = require('http');
const { Server } = require('socket.io');
const phpExpress = require('php-express')({
    binPath: 'php'
});

// Cek binary PHP saat startup: view engine admin/teknisi adalah .php (php-express).
// Tanpa `php` di PATH, halaman tersebut diam-diam error 500 — beri peringatan jelas.
try {
    require('child_process').execSync('php -v', { stdio: 'ignore' });
} catch (_e) {
    const line = '='.repeat(72);
    console.warn(line);
    console.warn('[PHP_CHECK] Binary `php` tidak ditemukan di PATH.');
    console.warn('[PHP_CHECK] Halaman admin & teknisi (.php) akan error 500.');
    console.warn('[PHP_CHECK] Install PHP (mis. `apt install php-cli`) lalu jalankan ulang.');
    console.warn('[PHP_CHECK] (API JSON tetap berfungsi tanpa PHP.)');
    console.warn(line);
}
const qrcode = require('qrcode');
const P = require('pino');
// HTTPS enforcement removed - Cloudflare Tunnel handles HTTPS


global.conn = null;
global.whatsappConnectionState = 'close';
global.users = [];
global.packages = [];
global.reports = [];
global.compensations = [];
global.speed_requests = [];
global.packageChangeRequests = [];
global.accounts = [];
global.payment = [];
global.paymentMethod = [];
global.statik = [];
global.voucher = [];
global.atm = [];
global.networkAssets = [];
global.cronConfig = {};

try {
    const { loadConfig, validateEnvironment } = require('./lib/env-config');
    global.config = loadConfig();
    
    try {
        const validationResult = validateEnvironment();
        if (validationResult.warnings && validationResult.warnings.length > 0) {
            console.log(`[ENV_INFO] Environment validation passed with ${validationResult.warnings.length} warning(s) - auto-migration will handle database relocation`);
        }
    } catch (e) {
        const isCriticalError = !e.message.includes('old location') && !e.message.includes('auto-migrated');
        if (isCriticalError && process.env.NODE_ENV === 'production') {
            console.error(`[ENV_ERROR] Critical environment validation failed: ${e.message}`);
            process.exit(1);
        } else {
            console.warn(`[ENV_WARN] Environment validation warning: ${e.message} (will attempt auto-migration)`);
        }
    }
} catch (e) {
    // loadConfig() sudah auto-bootstrap config.json dari config.example.json bila perlu.
    // Sampai di sini berarti config benar-benar tidak bisa dimuat (mis. JSON rusak,
    // atau config.json DAN config.example.json sama-sama hilang). Beri instruksi jelas
    // alih-alih crash mentah dengan ENOENT.
    console.error('='.repeat(72));
    console.error(`[CONFIG_FATAL] Gagal memuat konfigurasi: ${e.message}`);
    console.error('[CONFIG_FATAL] Pastikan config.json ada & valid. Setelah git clone:');
    console.error('[CONFIG_FATAL]   cp config.example.json config.json');
    console.error('[CONFIG_FATAL] lalu isi kredensial asli, kemudian jalankan ulang.');
    console.error('='.repeat(72));
    process.exit(1);
}
const { initializeDatabase, loadJSON, saveJSON } = require('./lib/database');
const { createAppRuntime } = require('./lib/app-runtime');
const { authCache } = require('./lib/auth-cache');
const { initializeAllCronTasks } = require('./lib/cron');
const { createHttpApp } = require('./lib/http-app');
const { createPublicSiteApp } = require('./lib/public-site-app');
const { registerRoutes } = require('./lib/routes-registry');
const { registerProcessLifecycleHandlers } = require('./lib/process-lifecycle');
const { registerHttpSecurity } = require('./lib/http-security');
const { registerHttpAuth, requirePhpPageAuth } = require('./lib/http-auth-bootstrap');
const { createHttpSocketBootstrap } = require('./lib/http-socket-bootstrap');
const { initializeUploadDirs } = require('./lib/upload-helper');
const { startWhatsApp, registerWhatsAppStarter, syncWhatsAppRuntime, clearWhatsAppRuntime } = require('./lib/whatsapp-bootstrap');
const { errorHandler } = require('./lib/error-handler');
const CustomerTrafficUsageService = require('./lib/customer-traffic-usage-service');
const msgHandler = require('./message/raf');
const { getMonitoringConfig } = require('./lib/env-config');
const { buildWhatsAppSocketPayload } = require('./lib/whatsapp-runtime');

const ErrorRecovery = require('./lib/error-recovery');
const MonitoringService = require('./lib/monitoring-service');
const AlertSystem = require('./lib/alert-system');
const oltLogScraper = require('./lib/olt-log-scraper');

global.errorRecovery = new ErrorRecovery();
global.monitoring = new MonitoringService();
global.alertSystem = new AlertSystem();
global.db = null;
global.io = null;
global.__dbInitPromise = initializeDatabase();

const PORT = process.env.PORT || 3100;
const config = global.config;
// Override opsional dari environment — HANYA di composition root (konsisten dgn PORT). Sumber
// utama tetap config.json; env berguna untuk deployment/PM2 tanpa menyunting config.json.
if (process.env.PUBLIC_SITE_ENABLED != null || process.env.PUBLIC_PORT != null) {
    config.publicSite = config.publicSite || {};
    if (process.env.PUBLIC_SITE_ENABLED != null) config.publicSite.enabled = process.env.PUBLIC_SITE_ENABLED === 'true';
    if (process.env.PUBLIC_PORT != null) config.publicSite.port = parseInt(process.env.PUBLIC_PORT, 10) || config.publicSite.port;
}
if (process.env.TURNSTILE_ENABLED != null || process.env.TURNSTILE_SITE_KEY != null || process.env.TURNSTILE_SECRET_KEY != null) {
    config.turnstile = config.turnstile || {};
    if (process.env.TURNSTILE_ENABLED != null) config.turnstile.enabled = process.env.TURNSTILE_ENABLED === 'true';
    if (process.env.TURNSTILE_SITE_KEY != null) config.turnstile.siteKey = process.env.TURNSTILE_SITE_KEY;
    if (process.env.TURNSTILE_SECRET_KEY != null) config.turnstile.secretKey = process.env.TURNSTILE_SECRET_KEY;
}
const PUBLIC_PORT = (config.publicSite && config.publicSite.port) || 3200;
global.monitoringConfig = getMonitoringConfig(config);
const runtime = createAppRuntime({
    globalScope: global,
    config,
    port: PORT,
    monitoringConfig: global.monitoringConfig,
    dbInitPromise: global.__dbInitPromise,
    services: {
        initializeAllCronTasks,
        initializeUploadDirs,
        CustomerTrafficUsageService,
        oltLogScraper
    }
});
const app = createHttpApp(runtime, express);
const allowedPortalOrigins = (process.env.PORTAL_ALLOWED_ORIGINS || process.env.CUSTOMER_PORTAL_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
const defaultTrustedOrigins = new Set([
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    `https://localhost:${PORT}`,
    `https://127.0.0.1:${PORT}`
]);

function isAllowedPortalOrigin(origin) {
    if (!origin) {
        return true;
    }

    if (defaultTrustedOrigins.has(origin)) {
        return true;
    }

    try {
        const parsed = new URL(origin);
        const isLocalHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
        if (isLocalHost && String(parsed.port || (parsed.protocol === 'https:' ? '443' : '80')) === String(PORT)) {
            return true;
        }
    } catch (error) {
        console.warn('[CORS_ORIGIN_PARSE_WARN]', { origin, message: error.message });
    }

    if (allowedPortalOrigins.length === 0) {
        return process.env.NODE_ENV !== 'production';
    }

    return allowedPortalOrigins.includes(origin);
}

global.__dbInitPromise
    .then((db) => {
        runtime.setDb(db || global.db || null);
    })
    .catch((error) => {
        console.error('[RUNTIME_DB_SYNC_ERROR] Failed to sync runtime DB state:', error);
    });

registerProcessLifecycleHandlers({
    runtime,
    CustomerTrafficUsageService,
    closeLogsDatabase: require('./lib/activity-logger').closeLogsDatabase
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser('rweutkhdrt'));
const { globalLimiter, authLimiter } = registerHttpSecurity(app, { express, projectRoot: __dirname, isAllowedPortalOrigin });
registerHttpAuth(app, { runtime, config, authCache, loadJSON });
app.use('/api/', globalLimiter);
app.use('/api/login', authLimiter);
app.use('/api/customer/login', authLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/otp/request', authLimiter);
registerRoutes(app, runtime);

// --- VIEW ENGINE AND PHP SETUP ---
app.set('views', 'views');
app.engine('php', phpExpress.engine);
app.set('view engine', 'php');

// PHP file handler — di-guard agar halaman/endpoint .php hanya dapat dirender untuk
// akun staf yang terautentikasi (menutup bypass auth via URL .php; lihat http-auth-bootstrap).
app.all(/.+\.php$/, requirePhpPageAuth, phpExpress.router);
app.use(errorHandler);

const {
    server: _server,
    io,
    cleanupOldPendingRequests: _cleanupOldPendingRequests,
    startHttpServer
} = createHttpSocketBootstrap({
    app,
    createServer,
    SocketIOServer: Server,
    runtime,
    port: PORT,
    config,
    loadJSON,
    saveJSON,
    startWhatsApp
});

async function startApp() {
    // Load ESM modules first
    const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, delay, fetchLatestWaWebVersion } = await import('@whiskeysockets/baileys');

    runtime.initializeBackgroundServices();

    // Start the HTTP server (utama)
    startHttpServer(connect);

    // Listener publik KEDUA (site anonim: landing/registrasi/beli voucher) dalam PROSES yang SAMA.
    // Flag-gated + non-fatal: gagal bind port publik TIDAK menjatuhkan server utama. SENGAJA tidak
    // memanggil initializeBackgroundServices()/startWhatsApp()/Socket.IO → invariant single-instance
    // (satu koneksi WA, satu cron) tetap terjaga; publicApp berbagi runtime & global.* yang sama.
    if (config.publicSite && config.publicSite.enabled) {
        try {
            const publicApp = createPublicSiteApp(runtime, express, { projectRoot: __dirname });
            const publicServer = createServer(publicApp);
            publicServer.on('error', (err) => {
                console.error(`[PUBLIC_SITE] Gagal bind port ${PUBLIC_PORT} (diabaikan; server utama tetap jalan):`, err.message);
            });
            publicServer.listen(PUBLIC_PORT, () => {
                console.log(`[PUBLIC_SITE] Listening on port ${PUBLIC_PORT} (site publik anonim)`);
            });
        } catch (e) {
            console.error('[PUBLIC_SITE] Gagal start (diabaikan; server utama tetap jalan):', e.message);
        }
    }

    // Guard anti koneksi-ganda: mencegah dua socket WhatsApp hidup bersamaan
    // (mis. klik Connect dashboard saat reconnect 515 sedang berjalan). Socket
    // ganda memicu connectionReplaced yang sebelumnya meng-logout & menghapus
    // sesi sehingga QR muncul terus.
    let waConnecting = false;

    // Define the connect function inside startApp to have access to Baileys modules
    async function connect() {
        if (waConnecting) {
            console.log('[WA] connect() diabaikan: koneksi sedang berlangsung.');
            return global.conn;
        }
        waConnecting = true;

        let version, isLatest;
        try {
            ({ version, isLatest } = await fetchLatestWaWebVersion());
        } catch (e) {
            waConnecting = false;
            throw e;
        }
        console.log(`Using: ${version}, newer: ${isLatest}`);
        const { state, saveCreds: saveState } = await useMultiFileAuthState(`sessions/${config.sessionName}`)
        const raf = makeWASocket({
            version,
            logger: P({ level: 'fatal' }),
            browser: ["RAF BOT MD BETA", "safari", "1.0.0"],
            auth: state,
            // Keep-alive configuration untuk mencegah stream timeout (error 515)
            keepAliveIntervalMs: 30000,        // Kirim heartbeat setiap 30 detik
            connectTimeoutMs: 60000,           // Timeout koneksi 60 detik
            retryRequestDelayMs: 2000,         // Delay retry request 2 detik
            defaultQueryTimeoutMs: 60000,      // Timeout query default 60 detik
            markOnlineOnConnect: true,         // Mark online saat connect
            syncFullHistory: false,            // Tidak perlu sync full history
            generateHighQualityLinkPreview: false, // Hemat resource
        });
        raf.multi = true
        raf.nopref = false
        raf.prefa = 'anjing'
        raf.mode = 'public'

        // Assign delay to global scope if needed elsewhere
        global.delay = delay;

        // Listen for LID mapping updates
        raf.ev.on('lid-mapping.update', async (update) => {
            console.log('[LID_MAPPING_UPDATE] Received new LID<->PN mapping:', update);
            // Mapping is automatically handled by signalRepository
        });
        
        // Message deduplication tracker
        // Dedup pesan pakai per-message TTL (Map id→timestamp), BUKAN clear-all.
        // clear-all menghapus seluruh state serentak → pesan di detik ke-59 bisa
        // diproses ulang di detik ke-61. Dengan TTL per-message, tiap id terlindungi
        // penuh selama window-nya.
        const processedMessages = new Map(); // messageId -> timestamp(ms)
        const MESSAGE_CACHE_DURATION = 60000; // 1 minute

        // Prune hanya entry yang sudah lewat TTL (bukan wipe semua).
        setInterval(() => {
            const cutoff = Date.now() - MESSAGE_CACHE_DURATION;
            for (const [id, ts] of processedMessages) {
                if (ts < cutoff) processedMessages.delete(id);
            }
        }, MESSAGE_CACHE_DURATION);
        
        raf.ev.on('messages.upsert', async m => {
            if (!m.messages || !m.messages[0]?.message) return;
            
            const msg = m.messages[0];
            const messageId = msg.key?.id;
            
            if (messageId && processedMessages.has(messageId)) {
                console.log('[MESSAGE_SKIP] Message already processed:', messageId);
                return;
            }
            
            if (messageId) {
                processedMessages.set(messageId, Date.now());
            }
            
            try {
                global.monitoring.incrementMetric('messages.received');
                await msgHandler(raf, msg, m, { runtime });
                global.monitoring.incrementMetric('messages.sent');
                
            } catch (error) {
                console.error('[MESSAGE_ERROR] Error processing message:', error);
                global.monitoring.incrementMetric('messages.failed');
                global.monitoring.logError(error, { context: 'message_processing' });
                
                if (!error.message?.includes('Bad MAC') && !error.message?.includes('decrypt')) {
                    const recovery = await global.errorRecovery.handleError(error, { 
                        context: 'message_processing',
                        retryable: true,
                        identifier: `msg_${messageId || 'unknown'}`
                    });
                    
                    if (recovery.retry && recovery.delay) {
                        setTimeout(async () => {
                            try {
                                if (messageId) processedMessages.delete(messageId);
                                await msgHandler(raf, msg, m, { runtime });
                            } catch (retryError) {
                                console.error('[MESSAGE_RETRY_ERROR] Retry failed:', retryError);
                            }
                        }, recovery.delay);
                    }
                } else {
                    console.log('[MESSAGE_SKIP] Skipping retry for decryption error');
                }
            }
        });

        raf.ev.on('connection.update', async update => {
            const { connection, lastDisconnect, qr: _qr } = update
            
            global.monitoring.updateConnectionStatus('whatsapp', connection);
            
            if (connection === 'open') {
                waConnecting = false;
                global.whatsappConnectionState = syncWhatsAppRuntime({
                    socket: raf,
                    connection,
                    currentState: global.whatsappConnectionState,
                    hasActiveSession: true
                });
                console.log("✅ WhatsApp connection is open.");
                
                const { initializeWrapper } = require('./lib/whatsapp-notification-wrapper');
                if (initializeWrapper(raf)) {
                    console.log("✅ Notification duplicate prevention activated.");
                } else {
                    console.log("⚠️ Failed to initialize notification wrapper.");
                }

                // Pre-warm pemetaan LID↔PN dari daftar pelanggan via USync (non-blocking),
                // agar pesan pertama berformat @lid bisa langsung terdeteksi otomatis.
                try {
                    const { prewarmLidMappings } = require('./lib/lid-prewarm');
                    setTimeout(() => {
                        prewarmLidMappings(raf, global.users || [], { logger: console })
                            .catch((err) => console.error('[LID_PREWARM_ERROR]', err.message));
                    }, 8000);
                } catch (prewarmInitError) {
                    console.error('[LID_PREWARM_INIT_ERROR]', prewarmInitError.message);
                }

                io.emit('message', buildWhatsAppSocketPayload('open'));

                if (global.wasDisconnected) {
                    await global.alertSystem.sendAlert('info', 'SERVICE_RECOVERED', {
                        service: 'WhatsApp'
                    });
                    global.wasDisconnected = false;
                }

                // Flush pesan kritis yang gagal terkirim saat WA down (dead-letter).
                // Kode voucher / notifikasi transfer yang tertahan otomatis dikirim
                // ulang begitu koneksi pulih. Non-blocking + delay supaya socket stabil.
                try {
                    const { retryFailedDeliveries } = require('./lib/whatsapp-critical-delivery');
                    setTimeout(() => {
                        retryFailedDeliveries()
                            .then((r) => {
                                if (r.attempted > 0) {
                                    console.log(`[WA_CRITICAL] Reconnect flush: ${r.delivered}/${r.attempted} pesan kritis terkirim ulang`);
                                }
                            })
                            .catch((err) => console.error('[WA_CRITICAL] Reconnect flush error:', err.message));
                    }, 10000);
                } catch (flushInitError) {
                    console.error('[WA_CRITICAL] Flush init error:', flushInitError.message);
                }
                
            } else if (connection === 'connecting') {
                global.whatsappConnectionState = syncWhatsAppRuntime({
                    connection,
                    currentState: global.whatsappConnectionState
                });
                console.log("🔄 WhatsApp is connecting...");
            } else if (connection === 'close') {
                let reason = lastDisconnect?.error?.output?.statusCode;
                const isLoggedOut = reason === DisconnectReason.loggedOut;
                global.whatsappConnectionState = syncWhatsAppRuntime({
                    connection,
                    reason: isLoggedOut ? 'logged_out' : undefined,
                    currentState: global.whatsappConnectionState,
                    hasActiveSession: !!(raf?.user || global.conn?.user)
                });
                global.wasDisconnected = !isLoggedOut;
                console.log("❌ WhatsApp connection is closed.");
                
                const error = lastDisconnect?.error || new Error('Connection closed');
                error.code = reason || 'CONNECTION_CLOSED';
                
                global.monitoring.logError(error, { 
                    context: 'whatsapp_connection',
                    reason: reason 
                });
                
                if (reason === DisconnectReason.connectionReplaced) {
                    // PENTING: JANGAN raf.logout() — itu menghapus kredensial sesi
                    // dan memaksa scan QR ulang. Sesi digantikan socket lain;
                    // cukup berhenti & pertahankan sesi agar bisa reconnect manual.
                    console.log("Koneksi digantikan sesi lain. Sesi dipertahankan (tidak logout).");
                    waConnecting = false;
                    if (global.conn === raf) {
                        clearWhatsAppRuntime({ nextState: 'close' });
                    }
                    io.emit('message', buildWhatsAppSocketPayload('temporary_disconnect'));
                } else if (reason === DisconnectReason.loggedOut) {
                    console.log(`Device Logged Out, Please Scan Again`);
                    waConnecting = false;
                    clearWhatsAppRuntime({ nextState: 'logged_out' });
                    io.emit('message', buildWhatsAppSocketPayload('logged_out'));
                    await global.alertSystem.sendAlert('warning', 'WHATSAPP_LOGGED_OUT', {
                        action: 'Scan ulang QR WhatsApp diperlukan'
                    });
                } else {
                    console.log("Connection lost, initiating recovery...");
                    io.emit('message', buildWhatsAppSocketPayload('temporary_disconnect'));

                    // Tahan guard selama jeda agar tidak ada socket ganda yang
                    // dibuat oleh connect() lain sebelum reconnect terjadwal.
                    waConnecting = true;

                    // Reset retry counter untuk whatsapp_connection agar bisa retry terus
                    global.errorRecovery.resetRetryCount('whatsapp_connection');

                    // Langsung reconnect dengan delay, tanpa melalui error recovery yang punya max retries
                    // Karena untuk WhatsApp, kita ingin terus mencoba reconnect selama session valid.
                    // waConnecting sengaja dibiarkan true selama jeda agar tidak ada
                    // connect() lain (mis. /api/start) menyelinap & membuat socket ganda;
                    // di-reset tepat sebelum reconnect tunggal.
                    const reconnectDelay = 5000; // 5 detik
                    console.log(`⏱️ Will retry connection in ${reconnectDelay}ms`);

                    setTimeout(() => {
                        console.log("🔄 Attempting to reconnect WhatsApp...");
                        waConnecting = false;
                        connect();
                    }, reconnectDelay);
                }
            } else if (update.qr) {
                console.log("Please scan QR code");
                global.whatsappConnectionState = syncWhatsAppRuntime({
                    connection: 'close',
                    reason: 'logged_out',
                    currentState: global.whatsappConnectionState
                });
                qrcode.toString(update.qr, { type: 'terminal', small: true }, (err, qrString) => {
                    if (err) throw err;
                    console.log(qrString);
                });
                qrcode.toDataURL(update.qr, (err, url) => {
                    io.emit('qr', url);
                });
            }
        });

        raf.ev.on('creds.update', saveState);
        return raf;
    }

    registerWhatsAppStarter(runtime, connect);

    // Keep global bridges temporarily for legacy compatibility only
    global.connect = connect;
    global.startBot = connect;  // Alias for error recovery system
    global.rafect = connect;    // Alias for API compatibility
}

startApp().catch(err => {
    console.error("[FATAL_STARTUP_ERROR] Failed to start the application.", err);
    process.exit(1);
});
