/**
 * Header Doc
 * Purpose: CRUD katalog paket langganan (`database/packages.json` / `global.packages`) plus
 *          varian publik yang sudah meredaksi field internal.
 * Caller: `lib/routes-registry.js` (`app.use("/", packagesRouter)`); konsumen UI = halaman admin
 *         (packages, users, payment-status, admin-diskon, kompensasi, speed-boost-config) dan
 *         halaman TEKNISI (teknisi-pelanggan, teknisi-pembayaran).
 * Deps: `routes/api-route-helpers` (ensureAdmin/ensureAuthenticatedStaff), `global.packages`.
 * MainFuncs: `savePackages`, handler GET/POST/PUT/DELETE `/api/packages`.
 * SideEffects: Menulis `database/packages.json` dan memutakhirkan `global.packages`.
 * INVARIAN: Harga di katalog ini dipakai `getPackagePrice`/`getEffectivePrice`, cron pengingat,
 *           rekap tunggakan, dan broadcast tagihan — jadi MUTASI wajib admin. Berkas ini dulu
 *           TANPA satu pun penjaga sementara `/api/packages` terdaftar publik di
 *           `lib/http-auth-bootstrap.js`, sehingga POST/PUT/DELETE terbuka tanpa login.
 *           Hanya `/api/packages/public` yang boleh anonim.
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { ensureAdmin, ensureAuthenticatedStaff } = require('./api-route-helpers');

// Helper function to save packages
function savePackages() {
    try {
        const packagesPath = path.join(__dirname, '..', 'database', 'packages.json');
        fs.writeFileSync(packagesPath, JSON.stringify(global.packages, null, 2));
        return true;
    } catch (error) {
        console.error('[SAVE_PACKAGES_ERROR]', error);
        return false;
    }
}

// GET /api/packages - katalog LENGKAP (membawa `profile` MikroTik internal).
// Staf, bukan admin-saja: halaman teknisi-pelanggan & teknisi-pembayaran ikut memakainya.
router.get('/api/packages', ensureAuthenticatedStaff, (req, res) => {
    try {
        const packages = global.packages || [];
        res.json({ data: packages });
    } catch (error) {
        console.error('[GET_PACKAGES_ERROR]', error);
        res.status(500).json({ message: 'Gagal memuat daftar paket' });
    }
});

// GET /api/packages/public - Get packages for public display
router.get('/api/packages/public', (req, res) => {
    try {
        // Filter only packages that should be shown publicly
        const packages = (global.packages || [])
            .filter(pkg => pkg.showInMonthly !== false)
            .map(pkg => ({
                id: pkg.id,
                name: pkg.name,
                price: pkg.price,
                // HANYA label tampilan. Dulu di sini ada fallback `|| pkg.profile`, sehingga
                // paket yang belum diisi `displayProfile` justru menyiarkan nama profil
                // MikroTik ASLI ke endpoint tanpa login — persis yang hendak disembunyikan.
                // Kosong lebih baik daripada bocor: tak ada konsumen yang mewajibkan isi.
                profile: pkg.displayProfile || '',
                description: pkg.description || '',
            }));
        
        res.json({ 
            success: true,
            data: packages 
        });
    } catch (error) {
        console.error('[GET_PUBLIC_PACKAGES_ERROR]', error);
        res.status(500).json({ 
            success: false,
            message: 'Gagal memuat daftar paket' 
        });
    }
});

// POST /api/packages - Create new package
// isolir_day per PAKET (#b305): hari isolir kustom (1-28, aman utk semua bulan). Kosong/invalid = null
// (ikut tanggal isolir GLOBAL config.tanggal_isolir). Ditangani cron `isolir-paket` yang gated OFF.
function parseIsolirDay(v) {
    if (v === undefined || v === null || v === '' ) return null;
    const n = parseInt(v, 10);
    return (Number.isInteger(n) && n >= 1 && n <= 28) ? n : null;
}

router.post('/api/packages', ensureAdmin, (req, res) => {
    try {
        const newPackage = {
            id: Date.now().toString(),
            name: req.body.name,
            price: parseInt(req.body.price) || 0,
            profile: req.body.profile || '',
            displayProfile: req.body.displayProfile || req.body.profile || '',
            description: req.body.description || '',
            showInMonthly: req.body.showInMonthly !== 'false' && req.body.showInMonthly !== false,
            whitelist: req.body.whitelist === 'true' || req.body.whitelist === true,
            isolir_day: parseIsolirDay(req.body.isolir_day),
            created_at: new Date().toISOString()
        };
        
        global.packages.push(newPackage);
        
        if (savePackages()) {
            res.json({ message: 'Paket berhasil ditambahkan', data: newPackage });
        } else {
            res.status(500).json({ message: 'Gagal menyimpan paket' });
        }
    } catch (error) {
        console.error('[CREATE_PACKAGE_ERROR]', error);
        res.status(500).json({ message: 'Gagal menambahkan paket' });
    }
});

// PUT /api/packages/:id - Update package
router.put('/api/packages/:id', ensureAdmin, (req, res) => {
    try {
        const packageId = req.params.id;
        const packageIndex = global.packages.findIndex(p => p.id == packageId);
        
        if (packageIndex === -1) {
            return res.status(404).json({ message: 'Paket tidak ditemukan' });
        }
        
        const updatedPackage = {
            ...global.packages[packageIndex],
            name: req.body.name || global.packages[packageIndex].name,
            price: parseInt(req.body.price) || global.packages[packageIndex].price,
            profile: req.body.profile || global.packages[packageIndex].profile,
            displayProfile: req.body.displayProfile !== undefined ? 
                req.body.displayProfile : 
                (global.packages[packageIndex].displayProfile || global.packages[packageIndex].profile),
            description: req.body.description || global.packages[packageIndex].description,
            showInMonthly: req.body.showInMonthly !== undefined ? 
                (req.body.showInMonthly !== 'false' && req.body.showInMonthly !== false) : 
                global.packages[packageIndex].showInMonthly,
            whitelist: req.body.whitelist !== undefined ?
                (req.body.whitelist === 'true' || req.body.whitelist === true) :
                global.packages[packageIndex].whitelist,
            isolir_day: req.body.isolir_day !== undefined ?
                parseIsolirDay(req.body.isolir_day) :
                (global.packages[packageIndex].isolir_day ?? null),
            updated_at: new Date().toISOString()
        };
        
        global.packages[packageIndex] = updatedPackage;
        
        if (savePackages()) {
            res.json({ message: 'Paket berhasil diperbarui', data: updatedPackage });
        } else {
            res.status(500).json({ message: 'Gagal menyimpan perubahan' });
        }
    } catch (error) {
        console.error('[UPDATE_PACKAGE_ERROR]', error);
        res.status(500).json({ message: 'Gagal memperbarui paket' });
    }
});

// DELETE /api/packages/:id - Delete package
router.delete('/api/packages/:id', ensureAdmin, (req, res) => {
    try {
        const packageId = req.params.id;
        const packageIndex = global.packages.findIndex(p => p.id == packageId);
        
        if (packageIndex === -1) {
            return res.status(404).json({ message: 'Paket tidak ditemukan' });
        }
        
        global.packages.splice(packageIndex, 1);
        
        if (savePackages()) {
            res.json({ message: 'Paket berhasil dihapus' });
        } else {
            res.status(500).json({ message: 'Gagal menyimpan perubahan' });
        }
    } catch (error) {
        console.error('[DELETE_PACKAGE_ERROR]', error);
        res.status(500).json({ message: 'Gagal menghapus paket' });
    }
});

module.exports = router;
