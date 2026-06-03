/**
 * Message Templates Routes
 * API compat untuk mengelola template pesan WhatsApp dengan placeholder ${nama}
 */

const express = require('express');
const router = express.Router();
const templateService = require('../lib/template-service');
const { 
    getAllTemplates, 
    getTemplate, 
    saveTemplate, 
    formatMessage,
    formatCurrency,
    formatDate,
    initializeDefaultTemplates 
} = require('../lib/message-template-helper');
const { logActivity } = require('../lib/activity-logger');

// Middleware for admin only
function ensureAdmin(req, res, next) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: "Akses ditolak. Hanya admin yang diizinkan." });
    }
    next();
}

// Initialize default templates on module load
initializeDefaultTemplates();

// GET /api/message-templates - Get all message templates
router.get('/', ensureAdmin, (req, res) => {
    try {
        templateService.loadAllCategories();
        const templates = getAllTemplates();
        const templateList = Object.values(templates);
        
        // Group by category
        const grouped = {};
        templateList.forEach(t => {
            const cat = t.category || 'other';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(t);
        });
        
        res.json({
            status: 200,
            data: {
                templates: templateList,
                grouped,
                total: templateList.length
            }
        });
    } catch (error) {
        console.error('[MESSAGE_TEMPLATES_GET_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengambil templates' });
    }
});

// GET /api/message-templates/diagnostics - Compat diagnostics mapped to unified source
router.get('/diagnostics', ensureAdmin, (req, res) => {
    try {
        templateService.loadAllCategories();
        res.json({
            status: 200,
            data: templateService.getDiagnostics()
        });
    } catch (error) {
        console.error('[MESSAGE_TEMPLATE_DIAGNOSTICS_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengambil diagnostics template' });
    }
});

// GET /api/message-templates/:id - Get specific template
router.get('/:id', ensureAdmin, (req, res) => {
    try {
        const template = getTemplate(req.params.id);
        
        if (!template) {
            return res.status(404).json({ status: 404, message: 'Template tidak ditemukan' });
        }
        
        res.json({ status: 200, data: template });
    } catch (error) {
        console.error('[MESSAGE_TEMPLATE_GET_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengambil template' });
    }
});

// PUT /api/message-templates/:id - Update template
router.put('/:id', ensureAdmin, (req, res) => {
    try {
        const { id } = req.params;
        const { content, name, description, enabled, placeholders } = req.body;
        
        const existingTemplate = getTemplate(id);
        if (!existingTemplate) {
            return res.status(404).json({ status: 404, message: 'Template tidak ditemukan' });
        }
        
        const updatedTemplate = {
            ...existingTemplate,
            content: content !== undefined ? content : existingTemplate.content,
            name: name !== undefined ? name : existingTemplate.name,
            description: description !== undefined ? description : existingTemplate.description,
            enabled: enabled !== undefined ? enabled : existingTemplate.enabled,
            placeholders: placeholders !== undefined ? placeholders : existingTemplate.placeholders,
        };
        
        const success = saveTemplate(id, updatedTemplate);
        
        if (!success) {
            return res.status(500).json({ status: 500, message: 'Gagal menyimpan template' });
        }
        
        // Log activity
        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'UPDATE',
            resourceType: 'message_template',
            resourceId: id,
            resourceName: updatedTemplate.name,
            description: `Admin mengupdate template pesan: ${updatedTemplate.name}`,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch(console.error);
        
        res.json({ 
            status: 200, 
            message: 'Template berhasil diupdate',
            data: updatedTemplate 
        });
    } catch (error) {
        console.error('[MESSAGE_TEMPLATE_UPDATE_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengupdate template' });
    }
});

// POST /api/message-templates - Create new template
router.post('/', ensureAdmin, (req, res) => {
    try {
        const { id, name, description, category, content, placeholders, enabled } = req.body;
        
        if (!id || !name || !content) {
            return res.status(400).json({ 
                status: 400, 
                message: 'ID, nama, dan konten template wajib diisi' 
            });
        }
        
        // Check if template already exists
        const existingTemplate = getTemplate(id);
        if (existingTemplate) {
            return res.status(409).json({ 
                status: 409, 
                message: 'Template dengan ID tersebut sudah ada' 
            });
        }
        
        const newTemplate = {
            id,
            name,
            description: description || '',
            category: category || 'other',
            content,
            placeholders: placeholders || [],
            enabled: enabled !== false,
        };
        
        const success = saveTemplate(id, newTemplate);
        
        if (!success) {
            return res.status(500).json({ status: 500, message: 'Gagal membuat template' });
        }
        
        // Log activity
        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'CREATE',
            resourceType: 'message_template',
            resourceId: id,
            resourceName: name,
            description: `Admin membuat template pesan baru: ${name}`,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch(console.error);
        
        res.status(201).json({ 
            status: 201, 
            message: 'Template berhasil dibuat',
            data: newTemplate 
        });
    } catch (error) {
        console.error('[MESSAGE_TEMPLATE_CREATE_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal membuat template' });
    }
});

// POST /api/message-templates/:id/test - Test template with sample data
router.post('/:id/test', ensureAdmin, (req, res) => {
    try {
        const template = getTemplate(req.params.id);
        
        if (!template) {
            return res.status(404).json({ status: 404, message: 'Template tidak ditemukan' });
        }
        
        // Build sample data from placeholders
        const sampleData = {
            customer_name: 'John Doe',
            customer_id: '12345',
            customer_phone: '081234567890',
            customer_address: 'Jl. Contoh No. 123',
            package_name: 'Paket 100K',
            package_price: formatCurrency(100000),
            base_price: formatCurrency(125000),
            discount_text: formatCurrency(25000),
            discount_amount: formatCurrency(25000),
            discount_percentage: '20%',
            final_price: formatCurrency(100000),
            discount_reason: 'Pelanggan setia',
            valid_until: formatDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
            billing_date: '10',
            current_date: formatDate(new Date()),
            current_time: new Date().toLocaleTimeString('id-ID', { timeStyle: 'short', timeZone: 'Asia/Jakarta' }),
            admin_name: req.user.name || req.user.username,
            technician_name: 'Teknisi A',
            company_name: global.config?.company_name || 'RAF NET',
            kasbon_amount: formatCurrency(500000),
            kasbon_reason: 'Keperluan operasional',
            reject_reason: 'Dana tidak mencukupi',
            old_package: 'Paket 75K',
            new_package: 'Paket 100K',
            new_price: formatCurrency(100000),
            effective_date: formatDate(new Date()),
            ...req.body.data // Allow custom test data
        };
        
        const formattedMessage = formatMessage(template, sampleData);
        
        if (!formattedMessage) {
            return res.json({
                status: 200,
                data: {
                    template_id: template.id,
                    template_name: template.name,
                    enabled: template.enabled,
                    preview: null,
                    message: template.enabled === false ? 'Template dinonaktifkan' : 'Gagal memformat pesan'
                }
            });
        }
        
        res.json({
            status: 200,
            data: {
                template_id: template.id,
                template_name: template.name,
                enabled: template.enabled,
                preview: formattedMessage,
                placeholders_used: template.placeholders,
                sample_data: sampleData
            }
        });
    } catch (error) {
        console.error('[MESSAGE_TEMPLATE_TEST_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal menguji template' });
    }
});

// GET /api/message-templates/categories/list - Get available categories
router.get('/categories/list', ensureAdmin, (req, res) => {
    const categories = [
        { id: 'payment', name: 'Pembayaran', icon: 'fa-money-bill-wave' },
        { id: 'discount', name: 'Diskon', icon: 'fa-tags' },
        { id: 'ticket', name: 'Tiket Support', icon: 'fa-ticket-alt' },
        { id: 'billing', name: 'Tagihan & Invoice', icon: 'fa-file-invoice' },
        { id: 'kasbon', name: 'Kasbon Teknisi', icon: 'fa-hand-holding-usd' },
        { id: 'package', name: 'Perubahan Paket', icon: 'fa-box' },
        { id: 'system', name: 'Sistem', icon: 'fa-cog' },
        { id: 'other', name: 'Lainnya', icon: 'fa-ellipsis-h' }
    ];
    
    res.json({ status: 200, data: categories });
});

// GET /api/message-templates/placeholders/list - Get available placeholders
router.get('/placeholders/list', ensureAdmin, (req, res) => {
    const placeholders = [
        { name: 'customer_name', description: 'Nama pelanggan', category: 'customer' },
        { name: 'customer_id', description: 'ID pelanggan', category: 'customer' },
        { name: 'customer_phone', description: 'Nomor telepon pelanggan', category: 'customer' },
        { name: 'customer_address', description: 'Alamat pelanggan', category: 'customer' },
        { name: 'package_name', description: 'Nama paket langganan', category: 'billing' },
        { name: 'package_price', description: 'Harga paket (formatted)', category: 'billing' },
        { name: 'base_price', description: 'Harga dasar sebelum diskon', category: 'billing' },
        { name: 'final_price', description: 'Harga akhir setelah diskon', category: 'billing' },
        { name: 'discount_text', description: 'Teks diskon (nominal/persen)', category: 'discount' },
        { name: 'discount_amount', description: 'Nominal diskon', category: 'discount' },
        { name: 'discount_percentage', description: 'Persentase diskon', category: 'discount' },
        { name: 'discount_reason', description: 'Alasan diskon', category: 'discount' },
        { name: 'valid_until', description: 'Tanggal berlaku diskon', category: 'discount' },
        { name: 'billing_date', description: 'Tanggal tagihan', category: 'billing' },
        { name: 'current_date', description: 'Tanggal saat ini', category: 'system' },
        { name: 'current_time', description: 'Waktu saat ini', category: 'system' },
        { name: 'admin_name', description: 'Nama admin yang memproses', category: 'system' },
        { name: 'technician_name', description: 'Nama teknisi', category: 'system' },
        { name: 'company_name', description: 'Nama perusahaan', category: 'system' },
        { name: 'kasbon_amount', description: 'Nominal kasbon', category: 'kasbon' },
        { name: 'kasbon_reason', description: 'Keperluan kasbon', category: 'kasbon' },
        { name: 'reject_reason', description: 'Alasan penolakan', category: 'kasbon' },
        { name: 'old_package', description: 'Paket lama', category: 'package' },
        { name: 'new_package', description: 'Paket baru', category: 'package' },
        { name: 'new_price', description: 'Harga paket baru', category: 'package' },
        { name: 'effective_date', description: 'Tanggal efektif perubahan', category: 'package' }
    ];
    
    res.json({ status: 200, data: placeholders });
});

module.exports = router;
