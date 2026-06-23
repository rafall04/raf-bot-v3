/**
 * Header Doc
 * Purpose: Compatibility facade untuk bootstrap SQLite/JSON, state global legacy, dan helper persistence lama.
 * Caller: Route admin/api, startup runtime, dan service legacy yang masih mengimpor `lib/database.js`.
 * Deps: Helper internal JSON/waypoint/network-assets/loader, `sqlite3`, `env-config`, dan state global.
 * MainFuncs: `initializeDatabase`, `withSqliteDatabase`, wrapper save/load JSON, helper waypoint, dan save collection lama.
 * SideEffects: Membaca/menulis file JSON/SQLite, membentuk `global.*`, dan memasang watcher announcements/news.
 */
"use strict";

const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const { dbBasePath, loadJSON, saveJSON } = require("./json-store");
const {
    initializeConnectionWaypointsTable,
    getConnectionWaypoints,
    saveConnectionWaypoints,
    deleteConnectionWaypoints,
    getAllConnectionWaypoints
} = require("./waypoints-repository");
const {
    loadNetworkAssets,
    saveNetworkAssets,
    updateNetworkAssetsWithLock
} = require("./network-assets-persistence");
const {
    loadReports: loadReportsImpl,
    loadSpeedRequests: loadSpeedRequestsImpl,
    loadCompensations: loadCompensationsImpl,
    setupAnnouncementsAndNewsWatchers: _setupAnnouncementsAndNewsWatchersImpl
} = require("./json-collections-loader");
const {
    updateOdpPortUsage: updateOdpPortUsageImpl,
    updateOdcPortUsage: updateOdcPortUsageImpl
} = require("./port-usage-updater");
const { applySqlitePragmas } = require("./sqlite-pragmas");

function withSqliteDatabase(dbFileName, handler) {
    return new Promise((resolve, reject) => {
        const dbPath = path.isAbsolute(dbFileName) ? dbFileName : path.join(dbBasePath, dbFileName);
        const db = new sqlite3.Database(dbPath, async (err) => {
            if (err) {
                reject(err);
                return;
            }

            db.configure('busyTimeout', 10000);

            try {
                // Pastikan WAL + synchronous=NORMAL aktif. Idempotent — aman dipanggil
                // berulang, journal_mode persisten di file header.
                await applySqlitePragmas(db);
                const result = await handler(db);
                db.close((closeError) => {
                    if (closeError) {
                        reject(closeError);
                        return;
                    }
                    resolve(result);
                });
            } catch (error) {
                db.close(() => reject(error));
            }
        });
    });
}

function loadReports() {
    return loadReportsImpl();
}

function loadSpeedRequests() {
    return loadSpeedRequestsImpl();
}

function loadCompensations() {
    return loadCompensationsImpl();
}

function saveReports() {
    saveJSON('reports.json', global.reports);
}

function saveSpeedRequests() {
    saveJSON('speed_requests.json', global.speed_requests);
}

function saveCompensations() {
    saveJSON('compensations.json', global.compensations);
}

function savePackage() {
    saveJSON('packages.json', global.packages);
}
function saveAccounts() {
    saveJSON('accounts.json', global.accounts);
}
function saveStatik() {
    saveJSON('statik.json', global.statik);
}
function saveVoucher() {
    saveJSON('voucher.json', global.voucher);
}
function saveAtm() {
    saveJSON('user/atm.json', global.atm);
}
function savePayment() {
    saveJSON('payment.json', global.payment);
}
function savePaymentMethod() {
    saveJSON('payment-method.json', global.paymentMethod);
}
function saveRequests(){
    saveJSON('requests.json', global.requests);
}

function savePackageChangeRequests() {
    saveJSON('package_change_requests.json', global.packageChangeRequests);
}

/**
 * Setup file watchers untuk announcements dan news agar auto-reload ketika file berubah
 * Mengikuti logika yang sama seperti template pesan di lib/templating.js
 * 
 * PERBAIKAN: Tambahkan delay dan retry mechanism untuk memastikan file sudah selesai ditulis
 * sebelum reload, karena fs.watchFile() di Windows mungkin tidak reliable
 */
function setupAnnouncementsAndNewsWatchers() {
    // Skip watching in test environment to prevent stuck processes
    if (process.env.NODE_ENV === 'test' || process.env.DISABLE_FILE_WATCHERS === 'true') {
        return;
    }

    const announcementsPath = path.join(dbBasePath, 'announcements.json');
    const newsPath = path.join(dbBasePath, 'news.json');

    /**
     * Reload file dengan retry mechanism untuk handle file yang masih dalam proses write
     * @param {string} filePath - Path ke file yang akan di-reload
     * @param {string} globalVarName - Nama global variable (untuk logging)
     * @param {number} retries - Jumlah retry yang tersisa
     * @param {number} delay - Delay dalam milliseconds sebelum retry
     */
    function reloadFileWithRetry(filePath, globalVarName, retries = 3, delay = 100) {
        setTimeout(() => {
            try {
                const data = loadJSON(filePath);
                
                // Update global variable berdasarkan nama
                if (globalVarName === 'announcements') {
                    global.announcements = data;
                    console.log(`[Database] ✅ Reloaded ${Array.isArray(data) ? data.length : 0} announcements.`);
                } else if (globalVarName === 'news') {
                    global.news = data;
                    console.log(`[Database] ✅ Reloaded ${Array.isArray(data) ? data.length : 0} news items.`);
                }
            } catch (error) {
                // Jika error dan masih ada retry, coba lagi
                if (retries > 0) {
                    console.warn(`[Database] ⚠️ Error reloading ${globalVarName}.json (retry ${4 - retries}/3):`, error.message);
                    reloadFileWithRetry(filePath, globalVarName, retries - 1, delay * 2); // Exponential backoff
                } else {
                    console.error(`[Database] ❌ Error reloading ${globalVarName}.json after 3 retries:`, error.message);
                }
            }
        }, delay);
    }

    // Watch announcements.json and news.json
    let dbWatchersCount = 0;
    
    if (fs.existsSync(announcementsPath)) {
        let lastMtime = fs.statSync(announcementsPath).mtime.getTime();
        
        fs.watchFile(announcementsPath, { interval: 1000 }, (curr, prev) => {
            const currMtime = curr.mtime ? curr.mtime.getTime() : 0;
            const prevMtime = prev.mtime ? prev.mtime.getTime() : 0;
            
            if (currMtime !== prevMtime && currMtime !== lastMtime) {
                lastMtime = currMtime;
                console.log('[Database] 🔄 announcements.json changed');
                reloadFileWithRetry('announcements.json', 'announcements', 3, 200);
            }
        });
        dbWatchersCount++;
    }

    if (fs.existsSync(newsPath)) {
        let lastMtime = fs.statSync(newsPath).mtime.getTime();
        
        fs.watchFile(newsPath, { interval: 1000 }, (curr, prev) => {
            const currMtime = curr.mtime ? curr.mtime.getTime() : 0;
            const prevMtime = prev.mtime ? prev.mtime.getTime() : 0;
            
            if (currMtime !== prevMtime && currMtime !== lastMtime) {
                lastMtime = currMtime;
                console.log('[Database] 🔄 news.json changed');
                reloadFileWithRetry('news.json', 'news', 3, 200);
            }
        });
        dbWatchersCount++;
    }
    
    // Single summary log
    if (dbWatchersCount > 0) {
        console.log(`[Database] ✅ ${dbWatchersCount} file watcher(s) aktif`);
    }
}

// Seed akun admin default (admin / admin123) bila accounts.json masih kosong,
// agar bisa langsung login web setelah fresh install tanpa langkah manual.
// CATATAN KEAMANAN: kredensial default ini publik — WAJIB ganti password
// setelah login pertama di lingkungan produksi.
function seedDefaultAdmin() {
    if (!Array.isArray(global.accounts) || global.accounts.length > 0) {
        return;
    }

    const bcrypt = require('bcrypt');
    global.accounts.push({
        id: 1,
        username: 'admin',
        password: bcrypt.hashSync('admin123', 8),
        name: 'Administrator',
        phone_number: '',
        role: 'admin'
    });
    saveJSON('accounts.json', global.accounts);

    const line = '='.repeat(72);
    console.warn(line);
    console.warn('[SEED_ADMIN] Tidak ada akun -> akun default dibuat:');
    console.warn('[SEED_ADMIN]   username: admin');
    console.warn('[SEED_ADMIN]   password: admin123');
    console.warn('[SEED_ADMIN] >> GANTI password ini segera setelah login pertama!');
    console.warn(line);
}

function initializeDatabase() {
    return new Promise((resolve, reject) => {
        global.paymentMethod = loadJSON("payment-method.json");
        global.accounts = loadJSON("accounts.json");
        seedDefaultAdmin();
        global.packages = loadJSON("packages.json");
        global.statik = loadJSON("statik.json");
        global.voucher = loadJSON("voucher.json");
        global.atm = loadJSON("user/atm.json");
        global.payment = loadJSON("payment.json");
        global.cronConfig = loadJSON("cron.json");
        global.requests = loadJSON('requests.json');
        global.packageChangeRequests = loadJSON('package_change_requests.json');
        global.announcements = loadJSON('announcements.json');
        global.news = loadJSON('news.json');

        // Setup file watchers untuk auto-reload announcements dan news (seperti template pesan)
        setupAnnouncementsAndNewsWatchers();

        loadReports();
        loadSpeedRequests();
        loadCompensations();
        global.networkAssets = loadNetworkAssets();
        
        let dbPath;
        try {
            const { getDatabasePath } = require('./env-config');
            dbPath = getDatabasePath('users.sqlite');
        } catch (_e) {
            // Fallback to default if env-config not available
            const dbDir = path.join(__dirname, '..', 'database');
            dbPath = path.join(dbDir, 'users.sqlite');
        }
        
        // Check if old database.sqlite exists and needs migration
        const oldDbPath = dbPath.replace('users.sqlite', 'database.sqlite');
        if (fs.existsSync(oldDbPath) && !fs.existsSync(dbPath)) {
            console.warn('[DB_INIT] Old database.sqlite found. Please run migration script to migrate to users.sqlite');
            console.warn(`[DB_INIT] Old path: ${oldDbPath}`);
            console.warn(`[DB_INIT] New path: ${dbPath}`);
        }
        
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
            console.log("[DB_INIT] Created database directory:", dbDir);
        }
        
        if (!dbPath.includes(path.sep + 'database' + path.sep) && !dbPath.includes('/database/')) {
            console.warn(`[DB_INIT] WARNING: Database path is not in database/ folder: ${dbPath}`);
        }
        
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Error opening database', err.message);
                return reject(err);
            }

            // Tunggu lock alih-alih langsung gagal SQLITE_BUSY saat ada koneksi
            // lain (mis. migration manager) mengakses file yang sama.
            db.configure('busyTimeout', 10000);

            // Aktifkan WAL mode + synchronous=NORMAL. journal_mode persisten
            // di file header, jadi koneksi berikutnya otomatis WAL.
            applySqlitePragmas(db).catch((pragmaErr) => {
                console.warn(`[DB_INIT_PRAGMA_WARN] ${pragmaErr.message}`);
            });

            db.serialize(() => {
                db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", (err, row) => {
                    if (err) {
                        console.error('Error checking users table', err.message);
                        return reject(err);
                    }
                    
                    if (!row) {
                        console.log('[DB] Creating users table...');
                        
                        const createTableSql = `
                            CREATE TABLE IF NOT EXISTS users (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                name TEXT,
                                username TEXT,
                                password TEXT,
                                phone_number TEXT,
                                address TEXT,
                                device_id TEXT,
                                status TEXT DEFAULT 'active',
                                latitude TEXT,
                                longitude TEXT,
                                subscription TEXT,
                                subscription_price INTEGER DEFAULT 0,
                                payment_due_date INTEGER DEFAULT 1,
                                paid INTEGER DEFAULT 0,
                                send_invoice INTEGER DEFAULT 0,
                                is_paid INTEGER DEFAULT 0,
                                auto_isolir INTEGER DEFAULT 1,
                                is_corporate INTEGER DEFAULT 0,
                                corporate_name TEXT,
                                corporate_address TEXT,
                                corporate_npwp TEXT,
                                corporate_pic_name TEXT,
                                corporate_pic_phone TEXT,
                                corporate_pic_email TEXT,
                                pppoe_username TEXT,
                                pppoe_password TEXT,
                                connected_odp_id TEXT,
                                bulk TEXT,
                                odc TEXT,
                                odp TEXT,
                                olt TEXT,
                                maps_url TEXT,
                                otp TEXT,
                                otpTimestamp INTEGER,
                                registration_date TEXT,
                                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                                last_login TEXT,
                                last_payment_date TEXT,
                                reminder_sent INTEGER DEFAULT 0,
                                isolir_sent INTEGER DEFAULT 0,
                                compensation_minutes INTEGER DEFAULT 0,
                                email TEXT,
                                alternative_phone TEXT,
                                notes TEXT,
                                notify_outage INTEGER DEFAULT 1,
                                account_type TEXT DEFAULT 'pelanggan',
                                assigned_agen_id INTEGER
                            )
                        `;
                        
                        const createIndexesSql = [
                            "CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number)",
                            "CREATE INDEX IF NOT EXISTS idx_users_device ON users(device_id)",
                            "CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)",
                            "CREATE INDEX IF NOT EXISTS idx_users_pppoe ON users(pppoe_username)"
                        ];
                        
                        db.run(createTableSql, (createErr) => {
                            if (createErr) {
                                console.error('[DB_ERROR] Gagal membuat tabel users:', createErr.message);
                                return reject(createErr);
                            }
                            
                            console.log('[DB_INIT] Tabel users berhasil dibuat.');
                            
                            let currentIndex = 0;
                            
                            function createNextIndex() {
                                if (currentIndex >= createIndexesSql.length) {
                                    console.log(`[DB_INIT] Semua index berhasil dibuat.`);
                                    loadUsersData();
                                    return;
                                }
                                
                                const indexSql = createIndexesSql[currentIndex];
                                db.run(indexSql, (indexErr) => {
                                    if (indexErr) {
                                        console.warn(`[DB_WARN] Gagal membuat index ${currentIndex + 1}:`, indexErr.message);
                                    } else {
                                        console.log(`[DB_INIT] Index ${currentIndex + 1}/${createIndexesSql.length} berhasil dibuat.`);
                                    }
                                    
                                    currentIndex++;
                                    createNextIndex();
                                });
                            }
                            
                            createNextIndex();
                        });
                        
                        return;
                    }
                    
                    loadUsersData();
                });
                
                function loadUsersData() {
                    db.all('SELECT * FROM users', [], (err, rows) => {
                        if (err) {
                            console.error('[DB_ERROR] Error loading users from database:', err.message);
                            console.error('[DB_ERROR] Error stack:', err.stack);
                            return reject(err);
                        }

                        const transformedUsers = [];
                        let transformErrorCount = 0;
                        
                        if (rows && rows.length > 0) {
                            rows.forEach((user, index) => {
                                try {
                                    const transformed = {
                                        ...user,
                                        paid: user.paid === 1 || user.paid === '1',
                                        send_invoice: user.send_invoice === 1 || user.send_invoice === '1',
                                        is_corporate: user.is_corporate === 1 || user.is_corporate === '1',
                                        // notify_outage default TRUE (butuh info gangguan); hanya 0/'0'/false yang berarti opt-out.
                                        notify_outage: !(user.notify_outage === 0 || user.notify_outage === '0' || user.notify_outage === false),
                                        // account_type: 'pelanggan' (default) | 'infrastruktur' (mis. modem CCTV/monitoring).
                                        // Dinormalisasi agar selalu ada nilai lowercase — dipakai untuk memisahkan akun infra dari data pelanggan.
                                        account_type: (typeof user.account_type === 'string' && user.account_type.trim())
                                            ? user.account_type.trim().toLowerCase()
                                            : 'pelanggan',
                                        bulk: (() => {
                                            try {
                                                if (!user.bulk) return [];
                                                if (typeof user.bulk === 'string') {
                                                    const trimmed = user.bulk.trim();
                                                    if (trimmed === '' || trimmed === '[]' || trimmed === 'null') return [];
                                                    // Handle corrupted data: "[object Object]"
                                                    if (trimmed === '[object Object]' || trimmed.startsWith('[object')) {
                                                        console.warn(`[DB_WARNING] Corrupted bulk data for user ${user.id}: "${trimmed}", resetting to default`);
                                                        return [];
                                                    }
                                                    return JSON.parse(user.bulk);
                                                }
                                                // Jika sudah array, return langsung
                                                if (Array.isArray(user.bulk)) return user.bulk;
                                                return [];
                                            } catch (e) {
                                                console.warn(`[DB_WARNING] Failed to parse bulk for user ${user.id}:`, e.message);
                                                return [];
                                            }
                                        })(),
                                        connected_odp_id: user.connected_odp_id || null,
                                        phone: user.phone_number || user.phone || null,
                                        package: user.subscription || user.package || null
                                    };
                                    transformedUsers.push(transformed);
                                } catch (transformErr) {
                                    transformErrorCount++;
                                    console.error(`[DB_ERROR] Failed to transform user at index ${index} (ID: ${user.id}, Name: ${user.name}):`, transformErr.message);
                                    console.error(`[DB_ERROR] Raw user data:`, JSON.stringify(user, null, 2));
                                    try {
                                        transformedUsers.push({
                                            ...user,
                                            paid: user.paid === 1 || user.paid === '1',
                                            send_invoice: user.send_invoice === 1 || user.send_invoice === '1',
                                            is_corporate: user.is_corporate === 1 || user.is_corporate === '1',
                                            bulk: [],
                                            connected_odp_id: user.connected_odp_id || null,
                                            phone: user.phone_number || user.phone || null,
                                            package: user.subscription || user.package || null
                                        });
                                        console.log(`[DB_WARNING] Added user ${user.id} with minimal transformation after error`);
                                    } catch (minimalErr) {
                                        console.error(`[DB_ERROR] CRITICAL: Cannot add user ${user.id} even with minimal transformation:`, minimalErr.message);
                                    }
                                }
                            });
                        }
                        
                        global.users = transformedUsers;
                        
                        if (transformErrorCount > 0 || global.users.length !== (rows ? rows.length : 0)) {
                            console.log(`[DB] Loaded ${global.users.length} users (${transformErrorCount} errors)`);
                        }
                        
                        if (transformErrorCount > 0) {
                            console.warn(`[DB_WARNING] ${transformErrorCount} user(s) had transformation errors but were still added to memory`);
                        }
                        
                        if (global.users.length === 0 && rows && rows.length > 0) {
                            console.error('[DB_ERROR] CRITICAL: Rows found in database but transformation resulted in 0 users!');
                            console.error('[DB_ERROR] Sample row:', JSON.stringify(rows[0], null, 2));
                        }
                        
                        if (global.users.length < rows.length) {
                            const missingCount = rows.length - global.users.length;
                            console.error(`[DB_ERROR] CRITICAL: ${missingCount} user(s) from database were NOT transformed!`);
                            console.error(`[DB_ERROR] Database has ${rows.length} rows but only ${global.users.length} users in memory`);
                            const loadedIds = new Set(global.users.map(u => String(u.id)));
                            const missingUsers = rows.filter(u => !loadedIds.has(String(u.id)));
                            if (missingUsers.length > 0) {
                                console.error(`[DB_ERROR] Sample missing users:`, missingUsers.slice(0, 5).map(u => ({ id: u.id, name: u.name, phone_number: u.phone_number })));
                            }
                        }
                        
                        global.db = db;

                        // Self-heal konsistensi pembayaran: pastikan ledger payment_history
                        // selaras dengan flag users.paid. Mencegah dashboard (flag-based) dan
                        // halaman Status Pembayaran (ledger-based) menampilkan angka berbeda
                        // setelah migrasi DB legacy yang hanya membawa flag tanpa ledger.
                        // Best-effort, idempoten (dijaga marker), dan tidak memblokir boot.
                        try {
                            require('./payment-status-backfill').runStartupBackfillSafe();
                        } catch (backfillErr) {
                            console.error('[PAID_LEDGER_BACKFILL_HOOK_ERROR]', backfillErr.message);
                        }

                        const { initializeActivityLogTables } = require('./activity-logger');
                        initializeActivityLogTables().catch(err => {
                            console.error('[DB] Activity logging init failed:', err.message);
                        });

                        const odpUsageMap = new Map();
                        const odcChildrenMap = new Map();
                        
                        global.networkAssets.forEach(asset => {
                            if (asset.type === 'ODP' || asset.type === 'ODC') {
                                asset.ports_used = 0;
                            }
                        });
                        
                        global.users.forEach(user => {
                            if (user.connected_odp_id) {
                                odpUsageMap.set(user.connected_odp_id, 
                                    (odpUsageMap.get(user.connected_odp_id) || 0) + 1
                                );
                            }
                        });
                        
                        global.networkAssets.forEach(asset => {
                            if (asset.type === 'ODP') {
                                asset.ports_used = odpUsageMap.get(asset.id) || 0;
                                
                                if (asset.parent_odc_id) {
                                    if (!odcChildrenMap.has(asset.parent_odc_id)) {
                                        odcChildrenMap.set(asset.parent_odc_id, []);
                                    }
                                    odcChildrenMap.get(asset.parent_odc_id).push(asset);
                                }
                            }
                        });
                        
                        global.networkAssets.forEach(asset => {
                            if (asset.type === 'ODC') {
                                const children = odcChildrenMap.get(asset.id) || [];
                                asset.ports_used = children.length;
                            }
                        });
                        
                        saveNetworkAssets(global.networkAssets);

                        const { initializePSBDatabase, loadPSBRecords } = require('./psb-database');
                        initializePSBDatabase()
                            .then(() => loadPSBRecords())
                            .then(() => {
                                return initializeConnectionWaypointsTable();
                            })
                            .then(() => {
                                resolve(db);
                            })
                            .catch(err => {
                                console.error("[DB] PSB/Waypoints init error:", err.message);
                                resolve(db);
                            });
                    });
                }
            });
        });
    });
}

function updateOdpPortUsage(odpId, increment = true, assetsArray) {
    return updateOdpPortUsageImpl(odpId, increment, assetsArray);
}

function updateOdcPortUsage(odcId, assetsArray) {
    return updateOdcPortUsageImpl(odcId, assetsArray);
}

module.exports = {
    initializeDatabase,
    withSqliteDatabase,
    loadJSON,
    saveJSON,
    loadReports,
    saveReports,
    loadSpeedRequests,
    saveSpeedRequests,
    loadNetworkAssets,
    saveNetworkAssets,
    updateNetworkAssetsWithLock,
    loadCompensations,
    saveCompensations,
    updateOdpPortUsage,
    updateOdcPortUsage,
    savePackage,
    saveAccounts,
    saveStatik,
    saveVoucher,
    saveAtm,
    savePayment,
    savePaymentMethod,
    saveRequests,
    initializeConnectionWaypointsTable,
    getConnectionWaypoints,
    saveConnectionWaypoints,
    deleteConnectionWaypoints,
    getAllConnectionWaypoints,
    savePackageChangeRequests
};
