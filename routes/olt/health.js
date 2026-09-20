/**
 * Header Doc
 * Purpose: Sub-router health & admin device OLT — /config, /test, /test-web, /scraper-status, /events, /devices CRUD + test, /drivers, /event-log.
 * Caller: `routes/olt.js` (composer) — jangan mount langsung.
 * MainFuncs: GET/POST `/config`, GET `/test`, POST `/test-web`, `/devices` CRUD, GET `/drivers`, GET `/event-log`.
 * SideEffects: sama seperti routes/olt.js asli (split #b395 — murni pemindahan kode).
 */
const log = require('../../lib/logger').logger.child('HEALTH');
const express = require('express');
const router = express.Router();
const oltLogScraper = require('../../lib/olt-log-scraper');
const oltManager = require('../../lib/olt-manager');
const { resolveDriver, getDriver, listDrivers, detectBrand } = require('../../lib/olt-drivers');
const { loadConfig, saveConfig, nextOltDeviceId } = require('./shared');

/**
 * GET /api/olt/config
 * Get OLT configuration
 */
router.get('/config', (req, res) => {
    try {
        // Check if user is admin
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const config = loadConfig();
        const oltConfig = config.olt || {
            enabled: false,
            host: '',
            port: 161,
            community: 'public',
            timeout: 15000,
            retries: 2,
            webEnabled: false,
            webUsername: '',
            webPassword: ''
        };

        res.json({
            status: 200,
            data: oltConfig
        });
    } catch (error) {
        log.error('[OLT] Error getting config:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});


/**
 * POST /api/olt/config
 * Save OLT global configuration (interval, timeWindow, etc)
 */
router.post('/config', (req, res) => {
    try {
        // Check if user is admin
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const { enabled, webEnabled, timeWindow, scrapeInterval, maxLogPages } = req.body;

        const config = loadConfig();
        
        // Preserve devices array if exists
        const existingDevices = config.olt?.devices || [];
        
        config.olt = {
            enabled: enabled === true || enabled === 'true',
            webEnabled: webEnabled === true || webEnabled === 'true',
            timeWindow: parseInt(timeWindow) || 10,
            scrapeInterval: parseInt(scrapeInterval) || 1,
            maxLogPages: parseInt(maxLogPages) || 3,
            devices: existingDevices
        };

        if (saveConfig(config)) {
            // Restart log scraper jika config berubah
            const { restartLogScraper } = require('../../lib/olt-log-scraper');
            if (typeof restartLogScraper === 'function') {
                restartLogScraper();
            }
            // Restart juga poller SNMP-LOS (mis. ZTE) supaya device baru langsung dipantau.
            try {
                const { restartSnmpLosPoller } = require('../../lib/olt-snmp-los-poller');
                if (typeof restartSnmpLosPoller === 'function') restartSnmpLosPoller();
            } catch (__e) { /* ignore */ }
            
            res.json({
                status: 200,
                message: 'Konfigurasi OLT berhasil disimpan',
                data: config.olt
            });
        } else {
            res.status(500).json({ status: 500, message: 'Gagal menyimpan konfigurasi' });
        }
    } catch (error) {
        log.error('[OLT] Error saving config:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});


/**
 * GET /api/olt/test
 * Test OLT connection
 */
router.get('/test', async (req, res) => {
    try {
        // Check if user is admin
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const config = loadConfig();
        const oltConfig = config.olt;

        if (!oltConfig || !oltConfig.enabled) {
            return res.status(400).json({ 
                status: 400, 
                message: 'OLT tidak diaktifkan. Aktifkan terlebih dahulu di konfigurasi.' 
            });
        }

        if (!oltConfig.host) {
            return res.status(400).json({ 
                status: 400, 
                message: 'Host OLT belum dikonfigurasi' 
            });
        }

        log.info(`[OLT] Testing connection to ${oltConfig.host}:${oltConfig.port}`);
        
        // Lewat driver merek — HIOSO dibaca via web (SNMP HIOSO dilarang, bikin OLT hang).
        const result = await resolveDriver({ host: oltConfig.host, brand: oltConfig.brand }).getOltData(oltConfig);

        if (result.status === 'success') {
            res.json({
                status: 200,
                message: `Koneksi berhasil! Ditemukan ${result.onus.length} ONT`,
                data: {
                    timestamp: result.timestamp,
                    onuCount: result.onus.length
                }
            });
        } else {
            res.status(500).json({
                status: 500,
                message: result.message || 'Gagal koneksi ke OLT'
            });
        }
    } catch (error) {
        log.error('[OLT] Error testing connection:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});


/**
 * POST /api/olt/test-web
 * Test OLT Web connection for log scraping
 */
router.post('/test-web', async (req, res) => {
    try {
        // Check if user is admin
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const { host, username, password } = req.body;

        if (!host || !username || !password) {
            return res.status(400).json({ 
                status: 400, 
                message: 'Host, username, dan password diperlukan' 
            });
        }

        log.info(`[OLT] Testing web connection to ${host}`);
        
        const result = await oltLogScraper.testWebConnection(host, username, password);

        if (result.success) {
            res.json({
                status: 200,
                message: result.message
            });
        } else {
            res.status(400).json({
                status: 400,
                message: result.message
            });
        }
    } catch (error) {
        log.error('[OLT] Error testing web connection:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});


/**
 * GET /api/olt/scraper-status
 * Get OLT log scraper status
 */
router.get('/scraper-status', (req, res) => {
    try {
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const status = oltLogScraper.getScraperStatus();
        res.json({
            status: 200,
            data: status
        });
    } catch (error) {
        log.error('[OLT] Error getting scraper status:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});


/**
 * GET /api/olt/events
 * Get all OLT events (LOS/Dying Gasp)
 */
router.get('/events', (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ status: 401, message: 'Unauthorized' });
        }

        const events = oltLogScraper.getAllEvents();
        res.json({
            status: 200,
            data: events
        });
    } catch (error) {
        log.error('[OLT] Error getting events:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});


/**
 * GET /api/olt/devices
 * Get all OLT devices
 */
router.get('/devices', (req, res) => {
    try {
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const devices = oltManager.getOltDevices();
        const globalConfig = oltManager.getOltGlobalConfig();

        res.json({
            status: 200,
            data: {
                devices: devices,
                globalConfig: globalConfig,
                brands: listDrivers() // daftar merk OLT yang didukung (untuk dropdown UI)
            }
        });
    } catch (error) {
        log.error('[OLT] Error getting devices:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});


/**
 * POST /api/olt/devices
 * Add new OLT device
 */
router.post('/devices', (req, res) => {
    try {
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const { name, host, brand, snmpPort, snmpCommunity, snmpTimeout, snmpRetries, webUsername, webPassword, sshPort, sshUsername, sshPassword } = req.body;

        if (!name || !host) {
            return res.status(400).json({
                status: 400,
                message: 'Nama dan host OLT diperlukan'
            });
        }

        const config = loadConfig();
        
        if (!config.olt) {
            config.olt = {
                enabled: true,
                webEnabled: true,
                scrapeInterval: 1,
                timeWindow: 10,
                maxLogPages: 3,
                devices: []
            };
        }
        
        if (!config.olt.devices) {
            config.olt.devices = [];
        }

        // Generate ID — WAJIB unik. Dulu `olt${length+1}` BENTROK setelah hapus device tengah
        // (DELETE splice tanpa renumber) → dua device ber-id sama → lookup .find()/findIndex first-match
        // kena OLT FISIK yang SALAH (kredensial ACS/SSH/provisioning nyasar; sebagian OLT milik teman/VANS).
        const newId = nextOltDeviceId(config.olt.devices);

        // Add new device
        const newDevice = {
            id: newId,
            name: name,
            host: host,
            brand: brand || 'auto',
            snmpPort: parseInt(snmpPort) || 161,
            snmpCommunity: snmpCommunity || 'public',
            snmpTimeout: parseInt(snmpTimeout) || 30000,
            snmpRetries: parseInt(snmpRetries) || 2,
            webUsername: webUsername || '',
            webPassword: webPassword || '',
            // Kredensial SSH untuk provisioning ONU & backup config (ZTE C320 dkk).
            sshPort: parseInt(sshPort) || 22,
            sshUsername: sshUsername || '',
            sshPassword: sshPassword || '',
            enabled: true
        };

        config.olt.devices.push(newDevice);

        if (saveConfig(config)) {
            // Restart scraper untuk include OLT baru
            const { restartLogScraper } = require('../../lib/olt-log-scraper');
            if (typeof restartLogScraper === 'function') {
                restartLogScraper();
            }
            // Restart juga poller SNMP-LOS (mis. ZTE) supaya device baru langsung dipantau.
            try {
                const { restartSnmpLosPoller } = require('../../lib/olt-snmp-los-poller');
                if (typeof restartSnmpLosPoller === 'function') restartSnmpLosPoller();
            } catch (__e) { /* ignore */ }
            
            res.json({
                status: 200,
                message: 'OLT berhasil ditambahkan',
                data: newDevice
            });
        } else {
            res.status(500).json({ status: 500, message: 'Gagal menyimpan konfigurasi' });
        }
    } catch (error) {
        log.error('[OLT] Error adding device:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});


/**
 * PUT /api/olt/devices/:id
 * Update OLT device
 */
router.put('/devices/:id', (req, res) => {
    try {
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const { id } = req.params;
        const { name, host, brand, snmpPort, snmpCommunity, snmpTimeout, snmpRetries, webUsername, webPassword, sshPort, sshUsername, sshPassword, enabled } = req.body;

        const config = loadConfig();

        if (!config.olt || !config.olt.devices) {
            return res.status(404).json({ status: 404, message: 'OLT tidak ditemukan' });
        }

        const deviceIndex = config.olt.devices.findIndex(d => d.id === id);
        if (deviceIndex === -1) {
            return res.status(404).json({ status: 404, message: 'OLT tidak ditemukan' });
        }

        // Update device
        config.olt.devices[deviceIndex] = {
            ...config.olt.devices[deviceIndex],
            name: name || config.olt.devices[deviceIndex].name,
            host: host || config.olt.devices[deviceIndex].host,
            brand: brand || config.olt.devices[deviceIndex].brand || 'auto',
            snmpPort: parseInt(snmpPort) || config.olt.devices[deviceIndex].snmpPort,
            snmpCommunity: snmpCommunity || config.olt.devices[deviceIndex].snmpCommunity,
            snmpTimeout: parseInt(snmpTimeout) || config.olt.devices[deviceIndex].snmpTimeout,
            snmpRetries: parseInt(snmpRetries) || config.olt.devices[deviceIndex].snmpRetries,
            webUsername: webUsername !== undefined ? webUsername : config.olt.devices[deviceIndex].webUsername,
            webPassword: webPassword !== undefined ? webPassword : config.olt.devices[deviceIndex].webPassword,
            // Kredensial SSH (provisioning/backup); undefined = pertahankan nilai lama.
            sshPort: sshPort !== undefined ? (parseInt(sshPort) || 22) : (config.olt.devices[deviceIndex].sshPort || 22),
            sshUsername: sshUsername !== undefined ? sshUsername : (config.olt.devices[deviceIndex].sshUsername || ''),
            sshPassword: sshPassword !== undefined ? sshPassword : (config.olt.devices[deviceIndex].sshPassword || ''),
            enabled: enabled !== undefined ? (enabled === true || enabled === 'true') : config.olt.devices[deviceIndex].enabled
        };

        if (saveConfig(config)) {
            // Restart scraper untuk apply perubahan
            const { restartLogScraper } = require('../../lib/olt-log-scraper');
            if (typeof restartLogScraper === 'function') {
                restartLogScraper();
            }
            // Restart juga poller SNMP-LOS (mis. ZTE) supaya device baru langsung dipantau.
            try {
                const { restartSnmpLosPoller } = require('../../lib/olt-snmp-los-poller');
                if (typeof restartSnmpLosPoller === 'function') restartSnmpLosPoller();
            } catch (__e) { /* ignore */ }
            
            res.json({
                status: 200,
                message: 'OLT berhasil diupdate',
                data: config.olt.devices[deviceIndex]
            });
        } else {
            res.status(500).json({ status: 500, message: 'Gagal menyimpan konfigurasi' });
        }
    } catch (error) {
        log.error('[OLT] Error updating device:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});


/**
 * DELETE /api/olt/devices/:id
 * Delete OLT device
 */
router.delete('/devices/:id', (req, res) => {
    try {
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const { id } = req.params;

        const config = loadConfig();
        
        if (!config.olt || !config.olt.devices) {
            return res.status(404).json({ status: 404, message: 'OLT tidak ditemukan' });
        }

        const deviceIndex = config.olt.devices.findIndex(d => d.id === id);
        if (deviceIndex === -1) {
            return res.status(404).json({ status: 404, message: 'OLT tidak ditemukan' });
        }

        // Remove device
        const deletedDevice = config.olt.devices.splice(deviceIndex, 1)[0];

        if (saveConfig(config)) {
            // Restart scraper untuk remove OLT
            const { restartLogScraper } = require('../../lib/olt-log-scraper');
            if (typeof restartLogScraper === 'function') {
                restartLogScraper();
            }
            // Restart juga poller SNMP-LOS (mis. ZTE) supaya device baru langsung dipantau.
            try {
                const { restartSnmpLosPoller } = require('../../lib/olt-snmp-los-poller');
                if (typeof restartSnmpLosPoller === 'function') restartSnmpLosPoller();
            } catch (__e) { /* ignore */ }
            
            res.json({
                status: 200,
                message: 'OLT berhasil dihapus',
                data: deletedDevice
            });
        } else {
            res.status(500).json({ status: 500, message: 'Gagal menyimpan konfigurasi' });
        }
    } catch (error) {
        log.error('[OLT] Error deleting device:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});


/**
 * POST /api/olt/devices/:id/test
 * Test connection to specific OLT device
 */
router.post('/devices/:id/test', async (req, res) => {
    try {
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const { id } = req.params;
        const device = oltManager.getOltDevice(id);

        if (!device) {
            return res.status(404).json({ status: 404, message: 'OLT tidak ditemukan' });
        }

        log.info(`[OLT] Testing connection to ${device.name} (${device.host}) brand=${device.brand || 'auto'}`);

        const config = {
            host: device.host,
            port: device.snmpPort || 161,
            community: device.snmpCommunity || 'public',
            timeout: device.snmpTimeout || 15000,
            retries: device.snmpRetries || 2,
            // Field web WAJIB ikut: `detectBrand` mencoba mengenali HIOSO lewat halamannya
            // DULU supaya merek itu tak perlu di-SNMP sama sekali (#b283). Tanpa field ini
            // jalur web-nya diam-diam mati dan probe jatuh balik ke SNMP.
            brand: device.brand || 'auto',
            webUsername: device.webUsername,
            webPassword: device.webPassword,
            webPort: device.webPort || 80,
            webTimeoutMs: device.webTimeoutMs,
        };

        // Auto-deteksi merk via sysObjectID bila brand 'auto'/kosong, lalu simpan balik ke config
        // supaya query berikutnya langsung pakai driver yang benar tanpa probe lagi.
        let brand = device.brand || 'auto';
        let detectedBrand = null;
        if (brand === 'auto') {
            detectedBrand = await detectBrand(config);
            brand = detectedBrand;
            const cfg = loadConfig();
            const dev = cfg.olt && cfg.olt.devices && cfg.olt.devices.find(d => d.id === id);
            if (dev) { dev.brand = detectedBrand; saveConfig(cfg); }
        }

        const driver = getDriver(brand);
        const result = await driver.getOltData(config);

        if (result.status === 'success') {
            const detectNote = detectedBrand ? ` (terdeteksi: ${driver.label})` : '';
            res.json({
                status: 200,
                message: `Koneksi berhasil! Ditemukan ${result.onus.length} ONT${detectNote}`,
                data: {
                    timestamp: result.timestamp,
                    onuCount: result.onus.length,
                    brand: brand,
                    brandLabel: driver.label
                }
            });
        } else {
            res.status(500).json({
                status: 500,
                message: result.message || 'Gagal koneksi ke OLT'
            });
        }
    } catch (error) {
        log.error('[OLT] Error testing device:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});


/**
 * GET /api/olt/drivers
 * Daftar merk OLT yang didukung (untuk dropdown brand di form device).
 */
router.get('/drivers', (req, res) => {
    try {
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }
        res.json({ status: 200, data: listDrivers() });
    } catch (error) {
        log.error('[OLT] Error listing drivers:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});


/**
 * GET /api/olt/event-log
 * Log durable kejadian OLT (LOS / Dying-Gasp / pulih) ter-ENRICH identitas pelanggan.
 * Query: from,to (epoch ms atau ISO), type (los|dying-gasp|discovery), q (cari
 * nama/pppoe/HP/MAC/alamat), oltId, mac, limit, offset.
 */
router.get('/event-log', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ status: 401, message: 'Unauthorized' });
        }
        const repo = require('../../repositories/olt-event.repository').getOltEventRepository();
        const q = req.query || {};
        const toMs = (v) => {
            if (v == null || v === '') return undefined;
            const n = Number(v);
            if (Number.isFinite(n)) return n;
            const d = Date.parse(v);
            return Number.isNaN(d) ? undefined : d;
        };
        const filters = {
            from: toMs(q.from),
            to: toMs(q.to),
            type: q.type || undefined,
            q: q.q || undefined,
            oltId: q.oltId || undefined,
            mac: q.mac || undefined,
            source: q.source || undefined,
            limit: q.limit ? Number(q.limit) : 200,
            offset: q.offset ? Number(q.offset) : 0,
        };
        const [rawItems, total, stats] = await Promise.all([
            repo.listEvents(filters),
            repo.countEvents(filters),
            repo.getStats(filters),
        ]);
        // Enrich tampilan OLT (read-time): olt_id mentah (IP OLT asli / IP MikroTik ke-NAT)
        // → {olt_name, olt_ip} manusiawi. Tanpa migrasi/backfill.
        const { resolveOltDisplay } = require('../../lib/olt-name-resolver');
        const items = rawItems.map((r) => {
            const o = resolveOltDisplay(r.olt_id);
            return Object.assign({}, r, { olt_name: o.name, olt_ip: o.ip });
        });
        res.json({ status: 200, data: { items, total, stats } });
    } catch (error) {
        log.error('[OLT] Error event-log:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});


module.exports = router;
