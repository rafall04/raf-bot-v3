/**
 * Header Doc
 * Purpose: Router saldo/topup/voucher untuk operasi admin dan notifikasi outbound WhatsApp terkait saldo.
 * Caller: Express route registry.
 * Deps: saldo-manager, voucher-manager, agent-manager, upload-helper, templating, template-service, whatsapp-delivery-service.
 * MainFuncs: resolveStoredUploadPath, routes saldo statistics/users/topup/manual/voucher/agent-topup.
 * SideEffects: Menulis saldo/topup/voucher state, menyimpan upload bukti, mengirim notifikasi WhatsApp.
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const saldoManager = require('../lib/saldo-manager');
const voucherManager = require('../lib/voucher-manager');
const agentManager = require('../lib/agent-manager');
const { getUploadDir, getUploadPath, generateFilename } = require('../lib/upload-helper');
const { renderTemplate } = require('../lib/templating');
const { renderCategoryTemplate } = require('../lib/template-service');
const { sendMessage, sendMessageToMany } = require('../lib/whatsapp-delivery-service');

function renderResponseTemplate(key, data = {}) {
    return renderCategoryTemplate("responseTemplates", key, data).text;
}

function resolveStoredUploadPath(storedPath) {
    if (!storedPath) {
        return null;
    }

    if (storedPath.startsWith('/static/')) {
        return path.join(__dirname, '..', storedPath.replace(/^\/+/, ''));
    }

    return path.join(__dirname, '../temp/topup_proofs', storedPath);
}

// Configure multer for file uploads (Topup proofs)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = getUploadDir('topup-requests');
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const userId = req.body.userId || 'unknown';
        const filename = generateFilename('topup', userId, file.originalname);
        cb(null, filename);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|pdf/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image and PDF files are allowed'));
        }
    }
});

// Get saldo statistics
router.get('/statistics', async (req, res) => {
    try {
        // Data sudah di memory dan selalu up-to-date karena langsung di-update saat write operations
        // Reload hanya diperlukan jika ada perubahan dari luar (jarang terjadi)
        // Gunakan ?forceReload=true jika perlu refresh manual
        if (req.query.forceReload === 'true') {
            saldoManager.reloadTopupRequests();
            saldoManager.reloadTransactions();
        }
        
        const stats = await saldoManager.getSaldoStatistics();
        const txStats = saldoManager.getTransactionStatistics();
        const topupRequests = saldoManager.getAllTopupRequests();
        
        // Count pending topups (include both pending AND waiting_verification)
        // These are requests that need admin action
        const pendingTopups = topupRequests.filter(r => 
            r.status === 'pending' || r.status === 'waiting_verification'
        ).length;
        
        // Count today's transactions
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTransactions = saldoManager.getAllTransactions()
            .filter(tx => new Date(tx.created_at) >= today).length;
        
        res.json({
            ...stats,
            ...txStats,
            pendingTopups,
            todayTransactions
        });
    } catch (error) {
        console.error('Error getting statistics:', error);
        res.status(500).json({ error: 'Failed to get statistics' });
    }
});

// Get all users with saldo
router.get('/users', async (req, res) => {
    try {
        const saldoData = await saldoManager.getAllSaldoData();
        
        // Map with user names from database if available
        const users = global.users || [];
        const enrichedData = saldoData.map(saldo => {
            // Priority: 1) Pushname from saldo, 2) Name from users DB, 3) Phone number
            let displayName = saldo.pushname; // First priority: WhatsApp pushname
            
            if (!displayName) {
                // Try to get name from users database
                const user = users.find(u => 
                    u.phone_number === saldo.id.replace('@s.whatsapp.net', '') ||
                    u.phone_number === '0' + saldo.id.replace('@s.whatsapp.net', '').substring(2)
                );
                
                if (user && user.name) {
                    displayName = user.name;
                } else {
                    // Fallback: Format phone number nicely
                    const phoneNumber = saldo.id.replace('@s.whatsapp.net', '');
                    // Format: 628xxx → +62 8xxx or keep as is if short
                    if (phoneNumber.startsWith('62') && phoneNumber.length > 10) {
                        displayName = '+' + phoneNumber.substring(0, 2) + ' ' + phoneNumber.substring(2);
                    } else {
                        displayName = phoneNumber;
                    }
                }
            }
            
            return {
                ...saldo,
                name: displayName
            };
        });
        
        res.json(enrichedData);
    } catch (error) {
        console.error('Error getting users:', error);
        res.status(500).json({ error: 'Failed to get users' });
    }
});

// OLD ENDPOINT REMOVED - Using new enriched endpoint below (line ~465)
// This old endpoint returned raw data without hasProof field

// Get topup requests
router.get('/topup-requests', (req, res) => {
    try {
        const { status } = req.query;
        let requests = saldoManager.getAllTopupRequests();
        
        if (status) {
            requests = requests.filter(r => r.status === status);
        }
        
        // Sort by date ascending for pending, descending for others
        requests.sort((a, b) => {
            if (status === 'pending') {
                return new Date(a.created_at) - new Date(b.created_at);
            }
            return new Date(b.created_at) - new Date(a.created_at);
        });
        
        res.json(requests);
    } catch (error) {
        console.error('Error getting topup requests:', error);
        res.status(500).json({ error: 'Failed to get topup requests' });
    }
});

// Add saldo manually (admin only)
router.post('/add-manual', async (req, res) => {
    try {
        const { userId, amount, description } = req.body;
        
        if (!userId || !amount) {
            return res.status(400).json({ 
                success: false, 
                message: 'User ID dan jumlah harus diisi' 
            });
        }
        
        // Ensure user exists in saldo database
        await saldoManager.createUserSaldo(userId);
        
        // Add saldo (sekarang async, perlu await)
        let success = false;
        try {
            success = await saldoManager.addSaldo(userId, amount, description || 'Topup manual by admin');
        } catch (error) {
            console.error('[SALDO_API] Error adding saldo:', error);
            console.error('[SALDO_API] Error stack:', error.stack);
            return res.status(500).json({ 
                success: false, 
                message: 'Gagal menambah saldo: ' + error.message,
                error: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
        
        if (success) {
            try {
                const currentSaldo = await saldoManager.getUserSaldo(userId);
                const message = renderTemplate('saldo_ditambahkan', {
                    harga: amount,
                    formattedSaldo: currentSaldo,
                    keterangan: description || 'Topup manual by admin'
                });
                const delivery = await sendMessage(userId, { text: message });
                if (delivery.sent) {
                    console.log(`[SALDO] Notifikasi WhatsApp terkirim ke ${userId}`);
                } else {
                    console.warn('[SALDO] Notifikasi WhatsApp tidak terkirim', {
                        userId,
                        errorCode: delivery.errorCode
                    });
                }
            } catch (error) {
                console.error('[SALDO] Error mengirim notifikasi:', error);
            }

            res.json({ success: true, message: 'Saldo berhasil ditambahkan' });
        } else {
            res.status(500).json({ success: false, message: 'Gagal menambah saldo' });
        }
    } catch (error) {
        console.error('Error adding saldo:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Create topup request
router.post('/topup-request', upload.single('proof'), async (req, res) => {
    try {
        const { userId, amount, paymentMethod } = req.body;
        const paymentProof = req.file ? getUploadPath('topup-requests', req.file.filename) : null;
        
        if (!userId || !amount || !paymentMethod) {
            return res.status(400).json({ 
                success: false, 
                message: 'Data tidak lengkap' 
            });
        }
        
        // Create topup request
        const request = saldoManager.createTopupRequest(userId, amount, paymentMethod, paymentProof);
        
        const adminMessage = renderTemplate('topup_request_admin', {
            user_id: userId,
            harga: saldoManager.formatCurrency(amount),
            metode_pembayaran: paymentMethod,
            bukti_section: paymentProof ? 'Bukti: ✅ Sudah upload' : 'Bukti: ⏳ Belum upload',
            request_id: request.id
        });
        const admins = global.accounts?.filter(acc =>
            acc.role === 'owner' || acc.role === 'admin' || acc.role === 'superadmin'
        ) || [];
        const adminRecipients = admins.map((admin) => admin.phone || admin.phone_number).filter(Boolean);
        await sendMessageToMany(adminRecipients, { text: adminMessage });
        
        res.json({ 
            success: true, 
            message: 'Request topup berhasil dibuat',
            requestId: request.id 
        });
    } catch (error) {
        console.error('Error creating topup request:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Verify topup request (admin only)
router.post('/verify-topup', async (req, res) => {
    try {
        const { requestId, approved, notes } = req.body;
        const adminName = req.session?.username || 'admin';
        
        if (!requestId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Request ID harus diisi' 
            });
        }
        
        // Use the new handler for verification
        const { handleTopupVerification } = require('../message/handlers/topup-handler');
        const result = await handleTopupVerification(requestId, approved, adminName, notes);
        
        res.json(result);
    } catch (error) {
        console.error('Error verifying topup:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message || 'Server error' 
        });
    }
});

// Get voucher profiles
router.get('/vouchers', (req, res) => {
    try {
        const vouchers = voucherManager.getVoucherProfiles();
        res.json(vouchers);
    } catch (error) {
        console.error('Error getting vouchers:', error);
        res.status(500).json({ error: 'Failed to get vouchers' });
    }
});

// Get voucher statistics
router.get('/voucher-stats', (req, res) => {
    try {
        const stats = voucherManager.getVoucherStatistics();
        res.json(stats);
    } catch (error) {
        console.error('Error getting voucher stats:', error);
        res.status(500).json({ error: 'Failed to get statistics' });
    }
});

// Get user purchase history
router.get('/voucher-history/:userId', (req, res) => {
    try {
        const { userId } = req.params;
        const history = voucherManager.getUserPurchaseHistory(userId);
        res.json(history);
    } catch (error) {
        console.error('Error getting purchase history:', error);
        res.status(500).json({ error: 'Failed to get history' });
    }
});

// Add voucher profile
router.post('/add-voucher', (req, res) => {
    try {
        const { prof, namavc, durasivc, hargavc } = req.body;
        
        if (!prof || !namavc || !durasivc || !hargavc) {
            return res.status(400).json({ 
                success: false, 
                message: 'Data voucher tidak lengkap' 
            });
        }
        
        const result = voucherManager.addVoucherProfile({
            prof,
            namavc,
            durasivc,
            hargavc: String(hargavc)
        });
        
        res.json(result);
    } catch (error) {
        console.error('Error adding voucher:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Update voucher profile
router.post('/update-voucher', (req, res) => {
    try {
        const { prof, namavc, durasivc, hargavc } = req.body;
        
        if (!prof) {
            return res.status(400).json({ 
                success: false, 
                message: 'Profile voucher harus diisi' 
            });
        }
        
        const updates = {};
        if (namavc) updates.namavc = namavc;
        if (durasivc) updates.durasivc = durasivc;
        if (hargavc) updates.hargavc = String(hargavc);
        
        const result = voucherManager.updateVoucherProfile(prof, updates);
        
        if (!result.success) {
            return res.status(404).json(result);
        }
        
        res.json(result);
    } catch (error) {
        console.error('Error updating voucher:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Delete voucher profile
router.post('/delete-voucher', (req, res) => {
    try {
        const { prof } = req.body;
        
        if (!prof) {
            return res.status(400).json({ 
                success: false, 
                message: 'Profile voucher harus diisi' 
            });
        }
        
        const result = voucherManager.deleteVoucherProfile(prof);
        
        if (!result.success) {
            return res.status(404).json(result);
        }
        
        res.json(result);
    } catch (error) {
        console.error('Error deleting voucher:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Purchase voucher with saldo (auto-generate from MikroTik)
router.post('/purchase-voucher', async (req, res) => {
    try {
        const { userId, voucherProfile } = req.body;
        
        if (!userId || !voucherProfile) {
            return res.status(400).json({ 
                success: false, 
                message: 'User ID dan voucher harus dipilih' 
            });
        }
        
        // Use new voucher manager for auto-generation
        const result = await voucherManager.purchaseVoucherWithSaldo(userId, voucherProfile, saldoManager);
        
        if (result.success) {
            const message = renderTemplate('voucher_purchase_admin', {
                nama_paket: result.voucher.profile,
                durasi: result.voucher.duration,
                harga: saldoManager.formatCurrency(result.voucher.price),
                username: result.voucher.code,
                password: result.voucher.password,
                sisa_saldo: saldoManager.formatCurrency(result.remainingSaldo)
            });
            sendMessage(userId, { text: message }).catch(console.error);
        }
        
        res.json(result);
    } catch (error) {
        console.error('Error purchasing voucher:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

// Get all transactions with topup request info
router.get('/transactions', async (req, res) => {
    try {
        // Data sudah di memory dan selalu up-to-date karena langsung di-update saat write operations
        // Reload hanya diperlukan jika ada perubahan dari luar (jarang terjadi)
        // Gunakan ?forceReload=true jika perlu refresh manual
        if (req.query.forceReload === 'true') {
            saldoManager.reloadTransactions();
            saldoManager.reloadTopupRequests();
        }
        
        const transactions = saldoManager.getAllTransactions();
        
        // Enrich with user names and topup request info
        const users = global.users || [];
        const saldoData = await saldoManager.getAllSaldoData();
        
        const enrichedTransactions = transactions.map(tx => {
            const saldoUser = saldoData.find(s => s.id === tx.userId);
            const rawUserId = typeof tx.userId === 'string' ? tx.userId : '';
            const fallbackIdentifier = rawUserId
                ? rawUserId.replace('@s.whatsapp.net', '')
                : (tx.agentId || tx.created_by || tx.id || '-');
            let displayName = saldoUser?.pushname || fallbackIdentifier;
            
            // Try from users database if no pushname
            if (!saldoUser?.pushname && rawUserId) {
                const user = users.find(u => 
                    u.phone_number === rawUserId.replace('@s.whatsapp.net', '') ||
                    u.phone_number === '0' + rawUserId.replace('@s.whatsapp.net', '').substring(2)
                );
                if (user?.name) displayName = user.name;
            }
            
            // Check if has topup request with proof
            let hasProof = false;
            if (tx.topupRequestId) {
                const topupRequest = saldoManager.getTopupRequest(tx.topupRequestId);

                if (topupRequest && topupRequest.paymentProof) {
                    hasProof = true;
                }
            }
            
            const result = {
                ...tx,
                userName: displayName,
                userId: rawUserId || null,
                hasProof: hasProof
            };

            return result;
        });
        
        res.json({ success: true, data: enrichedTransactions });
    } catch (error) {
        console.error('Error getting transactions:', error);
        res.status(500).json({ success: false, message: 'Failed to get transactions' });
    }
});

// View topup proof from transaction
router.get('/transaction/:id/proof', (req, res) => {
    try {
        const { id } = req.params;

        // IMPORTANT: Reload data to get latest from database
        saldoManager.reloadTransactions();
        saldoManager.reloadTopupRequests();
        
        // Get transaction
        const transactions = saldoManager.getAllTransactions();
        const transaction = transactions.find(t => t.id === id);
        
        if (!transaction) {
            return res.status(404).json({ success: false, message: 'Transaction not found' });
        }
        
        if (!transaction.topupRequestId) {
            return res.status(404).json({ success: false, message: 'No topup request linked to this transaction' });
        }
        
        // Get topup request
        const topupRequest = saldoManager.getTopupRequest(transaction.topupRequestId);
        
        if (!topupRequest) {
            return res.status(404).json({ success: false, message: 'Topup request not found' });
        }
        
        if (!topupRequest.paymentProof) {
            return res.status(404).json({ success: false, message: 'No payment proof for this topup request' });
        }
        
        const proofPath = resolveStoredUploadPath(topupRequest.paymentProof);
        
        if (!proofPath || !fs.existsSync(proofPath)) {
            return res.status(404).json({ success: false, message: 'Proof file not found' });
        }
        
        // Send file
        res.sendFile(proofPath);
    } catch (error) {
        console.error('Error getting topup proof:', error);
        res.status(500).json({ success: false, message: 'Failed to get proof: ' + error.message });
    }
});

/**
 * GET /api/saldo/agents
 * Get all agents with their saldo
 */
router.get('/agents', async (req, res) => {
    try {
        const agents = agentManager.getAllAgents(true); // active only
        
        // Get saldo data sekali untuk semua agents
        const saldoData = await saldoManager.getAllSaldoData();
        
        // Map agents dengan saldo (await semua Promise sekaligus)
        const agentsWithSaldoPromises = agents.map(async (agent) => {
            // Format agent phone to JID for saldo lookup
            let userId = agent.phone;
            if (userId) {
                if (!userId.includes('@')) {
                    userId = userId.startsWith('0') ? '62' + userId.substring(1) : userId;
                    userId = userId.startsWith('62') ? userId : '62' + userId;
                    userId = userId + '@s.whatsapp.net';
                }
            }
            
            // Get saldo (await karena getUserSaldo return Promise)
            const saldo = userId ? await saldoManager.getUserSaldo(userId) : 0;
            
            // Get last update from saldo data
            const userSaldoData = saldoData.find(u => u.id === userId);
            const lastUpdate = userSaldoData?.updated_at || null;
            
            return {
                agentId: agent.id,
                agentName: agent.name,
                agentArea: agent.area,
                agentPhone: agent.phone,
                saldo: saldo || 0,
                lastUpdate: lastUpdate
            };
        });
        
        // Tunggu semua Promise selesai
        const agentsWithSaldo = await Promise.all(agentsWithSaldoPromises);
        
        res.json({
            status: 200,
            message: 'Agent saldo retrieved successfully',
            data: agentsWithSaldo
        });
        
    } catch (error) {
        console.error('[SALDO_AGENTS] Error:', error);
        res.status(500).json({
            status: 500,
            message: 'Error retrieving agent saldo: ' + error.message,
            data: null
        });
    }
});

/**
 * POST /api/saldo/agent-topup
 * Topup saldo for agent
 */
router.post('/agent-topup', async (req, res) => {
    try {
        const { agentId, userId, amount, description } = req.body;
        
        if (!agentId || !userId || !amount) {
            return res.status(400).json({
                success: false,
                message: 'Agent ID, User ID, dan jumlah harus diisi'
            });
        }
        
        // Verify agent exists
        const agent = agentManager.getAgentById(agentId);
        if (!agent) {
            return res.status(404).json({
                success: false,
                message: 'Agent tidak ditemukan'
            });
        }
        
        // Ensure user exists in saldo database
        await saldoManager.createUserSaldo(userId, agent.name);
        
        // Add saldo (sekarang async, perlu await)
        const success = await saldoManager.addSaldo(
            userId,
            parseInt(amount),
            description || `Topup saldo agent ${agent.name} by admin`
        );
        
        if (success) {
            try {
                const currentSaldo = await saldoManager.getUserSaldo(userId);
                const message = renderResponseTemplate("routes_saldo_agent_topup_notification", {
                    agentName: agent.name,
                    amount: saldoManager.formatCurrency(parseInt(amount)),
                    currentSaldo: saldoManager.formatCurrency(currentSaldo),
                    description: description || 'Topup saldo agent by admin'
                });
                const delivery = await sendMessage(userId, { text: message });
                if (delivery.sent) {
                    console.log(`[SALDO_AGENT] Notifikasi WhatsApp terkirim ke ${userId}`);
                } else {
                    console.warn('[SALDO_AGENT] Notifikasi WhatsApp tidak terkirim', {
                        userId,
                        errorCode: delivery.errorCode
                    });
                }
            } catch (error) {
                console.error('[SALDO_AGENT] Error:', error);
            }

            // Ambil saldo untuk response (await karena getUserSaldo return Promise)
            const newSaldo = await saldoManager.getUserSaldo(userId);
            res.json({
                success: true,
                message: `Saldo agent ${agent.name} berhasil ditambahkan`,
                data: {
                    agentId: agentId,
                    agentName: agent.name,
                    newSaldo: newSaldo
                }
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Gagal menambah saldo agent'
            });
        }
    } catch (error) {
        console.error('Error adding agent saldo:', error);
        res.status(500).json({
            success: false,
            message: 'Server error: ' + error.message
        });
    }
});

module.exports = router;
