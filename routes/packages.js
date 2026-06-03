const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

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

// GET /api/packages - Get all packages (admin)
router.get('/api/packages', (req, res) => {
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
                profile: pkg.displayProfile || pkg.profile || '',  // Use displayProfile for public
                description: pkg.description || '',
                // Hide internal/technical fields like actual MikroTik profile
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
router.post('/api/packages', (req, res) => {
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
router.put('/api/packages/:id', (req, res) => {
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
router.delete('/api/packages/:id', (req, res) => {
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
