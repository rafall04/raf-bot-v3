const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { saveAccounts, loadJSON, saveJSON } = require('../lib/database');

// Middleware untuk memastikan hanya admin yang bisa akses
const adminOnly = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ 
            success: false, 
            message: 'Akses ditolak. Hanya admin yang dapat mengakses fitur ini.' 
        });
    }
    next();
};

// GET /api/accounts - Get all accounts
router.get('/accounts', adminOnly, (req, res) => {
    try {
        // Reload accounts from file to ensure fresh data
        global.accounts = loadJSON("accounts.json");
        
        // Return accounts without password field
        const accountsWithoutPassword = global.accounts.map(account => ({
            id: account.id,
            username: account.username,
            name: account.name || account.username, // ✅ ADD name field with fallback
            phone_number: account.phone_number || '',
            role: account.role
        }));
        
        res.json({
            draw: req.query.draw || 1,
            recordsTotal: accountsWithoutPassword.length,
            recordsFiltered: accountsWithoutPassword.length,
            data: accountsWithoutPassword
        });
    } catch (error) {
        console.error('[GET /api/accounts] Error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Gagal mengambil data akun: ' + error.message 
        });
    }
});

// POST /api/accounts - Create new account
router.post('/accounts', adminOnly, async (req, res) => {
    try {
        const { username, password, name, phone_number, role } = req.body;
        
        // Validation
        if (!username || !password || !role) {
            return res.status(400).json({ 
                success: false, 
                message: 'Username, password, dan role wajib diisi!' 
            });
        }
        
        // Check if username already exists
        const exists = global.accounts.some(acc => acc.username === username);
        if (exists) {
            return res.status(400).json({ 
                success: false, 
                message: 'Username sudah digunakan!' 
            });
        }
        
        // Validate role
        if (!['admin', 'teknisi'].includes(role)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Role harus admin atau teknisi!' 
            });
        }
        
        // Generate new ID (find max ID and add 1)
        const maxId = global.accounts.reduce((max, acc) => {
            const id = parseInt(acc.id) || 0;
            return id > max ? id : max;
        }, 0);
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create new account
        const newAccount = {
            id: maxId + 1,
            username: username.trim(),
            password: hashedPassword,
            name: name || username.trim(), // Use username as default if name not provided
            phone_number: phone_number || '',
            role: role
        };
        
        // Add to global accounts
        global.accounts.push(newAccount);
        
        // Save to file
        saveAccounts();
        
        console.log(`[POST /api/accounts] New account created: ${username} (${role})`);
        
        res.status(201).json({ 
            success: true, 
            status: 201,
            message: 'Akun berhasil ditambahkan!',
            data: {
                id: newAccount.id,
                username: newAccount.username,
                phone_number: newAccount.phone_number,
                role: newAccount.role
            }
        });
        
    } catch (error) {
        console.error('[POST /api/accounts] Error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Gagal menambahkan akun: ' + error.message 
        });
    }
});

// POST /api/accounts/:id - Update account (using POST instead of PUT for compatibility)
router.post('/accounts/:id', adminOnly, async (req, res) => {
    try {
        const accountId = parseInt(req.params.id);
        const { username, password, name, phone_number, role } = req.body;
        
        // Find account
        const accountIndex = global.accounts.findIndex(acc => 
            parseInt(acc.id) === accountId
        );
        
        if (accountIndex === -1) {
            return res.status(404).json({ 
                success: false, 
                message: 'Akun tidak ditemukan!' 
            });
        }
        
        const account = global.accounts[accountIndex];
        
        // Check if new username is already taken by another account
        if (username && username !== account.username) {
            const existingAccount = global.accounts.find(acc => 
                acc.username.toLowerCase() === username.toLowerCase() && 
                parseInt(acc.id) !== accountId
            );
            
            if (existingAccount) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Username sudah digunakan oleh akun lain!' 
                });
            }
        }
        
        // Validate role if provided
        if (role && !['admin', 'teknisi'].includes(role)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Role harus admin atau teknisi!' 
            });
        }
        
        // Update fields
        if (username) global.accounts[accountIndex].username = username.trim();
        if (name !== undefined) global.accounts[accountIndex].name = name.trim();
        if (phone_number !== undefined) global.accounts[accountIndex].phone_number = phone_number;
        if (role) global.accounts[accountIndex].role = role;
        
        // Update password if provided
        if (password && password.trim() !== '') {
            account.password = await bcrypt.hash(password, 10);
            console.log(`[POST /api/accounts/${accountId}] Password updated for ${account.username}`);
        }
        
        // Save to file
        saveAccounts();
        
        // Only log on error, not on every update
        
        res.status(200).json({ 
            success: true, 
            status: 200,
            message: 'Akun berhasil diperbarui!',
            data: {
                id: account.id,
                username: account.username,
                phone_number: account.phone_number,
                role: account.role
            }
        });
        
    } catch (error) {
        console.error(`[POST /api/accounts/${req.params.id}] Error:`, error);
        res.status(500).json({ 
            success: false, 
            message: 'Gagal memperbarui akun: ' + error.message 
        });
    }
});

// DELETE /api/accounts/:id - Delete account
router.delete('/accounts/:id', adminOnly, (req, res) => {
    try {
        const accountId = parseInt(req.params.id);
        
        // Find account index
        const accountIndex = global.accounts.findIndex(acc => 
            parseInt(acc.id) === accountId
        );
        
        if (accountIndex === -1) {
            return res.status(404).json({ 
                success: false, 
                message: 'Akun tidak ditemukan!' 
            });
        }
        
        const account = global.accounts[accountIndex];
        
        // Prevent deleting own account
        if (parseInt(req.user.id) === accountId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Anda tidak dapat menghapus akun Anda sendiri!' 
            });
        }
        
        // Prevent deleting the last admin
        const adminCount = global.accounts.filter(acc => acc.role === 'admin').length;
        if (account.role === 'admin' && adminCount <= 1) {
            return res.status(400).json({ 
                success: false, 
                message: 'Tidak dapat menghapus admin terakhir!' 
            });
        }
        
        // Remove account
        global.accounts.splice(accountIndex, 1);
        
        // Save to file
        saveAccounts();
        
        console.log(`[DELETE /api/accounts/${accountId}] Account deleted: ${account.username}`);
        
        res.json({ 
            success: true, 
            message: 'Akun berhasil dihapus!' 
        });
        
    } catch (error) {
        console.error(`[DELETE /api/accounts/${req.params.id}] Error:`, error);
        res.status(500).json({ 
            success: false, 
            message: 'Gagal menghapus akun: ' + error.message 
        });
    }
});

module.exports = router;
