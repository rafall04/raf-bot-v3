const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { renderTemplate } = require('../lib/templating');
const { sendMessageToMany } = require('../lib/whatsapp-delivery-service');
const { normalizeUserPaymentMethod } = require('../lib/payment-finance-service');

const router = express.Router();

// Configure multer for logo upload
const logoStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '..', 'static', 'uploads', 'logos');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'company-logo-' + uniqueSuffix + ext);
    }
});

const uploadLogo = multer({ 
    storage: logoStorage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif|svg/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files (JPEG, PNG, GIF, SVG) are allowed'));
        }
    }
});

// Middleware for admin-only routes
function ensureAdmin(req, res, next) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: "Akses ditolak." });
    }
    next();
}

// GET /api/get-latest-invoice
router.get('/get-latest-invoice', async (req, res) => {
    try {
        const userId = req.query.userId;
        if (!userId) {
            return res.status(400).json({ message: 'User ID required' });
        }
        
        // Load invoices
        const invoicesPath = './database/invoices.json';
        let invoices = [];
        if (fs.existsSync(invoicesPath)) {
            invoices = JSON.parse(fs.readFileSync(invoicesPath, 'utf8'));
        }
        
        // Find latest invoice for user
        console.log(`[GET_LATEST_INVOICE] Looking for userId: ${userId}, type: ${typeof userId}`);
        console.log(`[GET_LATEST_INVOICE] Total invoices: ${invoices.length}`);
        
        const userInvoices = invoices.filter(inv => {
            const customerId = inv.customer.id;
            const match = String(customerId) === String(userId) || Number(customerId) === Number(userId);
            return match;
        });
        
        console.log(`[GET_LATEST_INVOICE] Found ${userInvoices.length} invoices for userId ${userId}`);
        
        if (userInvoices.length === 0) {
            return res.status(404).json({ message: 'No invoices found for this user' });
        }
        
        // Sort by date and get latest
        userInvoices.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const latestInvoice = userInvoices[0];
        
        console.log(`[GET_LATEST_INVOICE] Returning latest invoice: ${latestInvoice.invoiceNumber}`);
        
        return res.json({ 
            invoiceId: latestInvoice.invoiceNumber,
            invoice: latestInvoice 
        });
    } catch (error) {
        console.error('[GET_LATEST_INVOICE_ERROR]', error);
        return res.status(500).json({ message: error.message });
    }
});

// GET /api/view-invoice
router.get('/view-invoice', async (req, res) => {
    try {
        const { id: invoiceId, userId } = req.query;
        
        if (!invoiceId || !userId) {
            return res.status(400).json({ message: 'Invalid parameters' });
        }
        
        // Load invoices
        const invoicesPath = './database/invoices.json';
        let invoices = [];
        if (fs.existsSync(invoicesPath)) {
            invoices = JSON.parse(fs.readFileSync(invoicesPath, 'utf8'));
        }
        
        // Find invoice
        const invoice = invoices.find(inv => 
            inv.invoiceNumber === invoiceId && 
            String(inv.customer.id) === String(userId)
        );
        
        if (!invoice) {
            return res.status(404).json({ message: 'Invoice not found' });
        }
        
        // Get customization settings
        const config = global.config;
        const customization = {
            theme: config.pdfCustomization?.theme || 'blue',
            headerText: config.pdfCustomization?.headerText || 'INVOICE',
            footerText: config.pdfCustomization?.footerText || 'Terima kasih atas kepercayaan Anda.',
            billingTitle: config.pdfCustomization?.billingTitle || 'TAGIHAN KEPADA:',
            serviceTitle: config.pdfCustomization?.serviceTitle || 'DETAIL LAYANAN:',
            showCustomerID: config.pdfCustomization?.showCustomerID !== false,
            showCustomerPhone: config.pdfCustomization?.showCustomerPhone !== false,
            showServiceSpeed: config.pdfCustomization?.showServiceSpeed !== false,
            showServiceDescription: config.pdfCustomization?.showServiceDescription !== false,
            showNPWP: config.pdfCustomization?.showNPWP !== false,
            showDueDate: config.pdfCustomization?.showDueDate !== false,
            paymentMethods: config.pdfCustomization?.paymentMethods || 'cash_transfer',
            showNotes: config.pdfCustomization?.showNotes !== false,
            additionalNotes: config.pdfCustomization?.additionalNotes || ''
        };
        
        // Generate HTML
        const { generateInvoiceHTML } = require('../lib/pdf-invoice-generator');
        const html = generateInvoiceHTML(invoice, customization);
        
        // Send HTML content
        res.setHeader('Content-Type', 'text/html');
        return res.end(html);
    } catch (error) {
        console.error('[VIEW_INVOICE_ERROR]', error);
        return res.status(500).json({ message: error.message });
    }
});

// GET /api/download-invoice-pdf
router.get('/download-invoice-pdf', async (req, res) => {
    try {
        const { id: invoiceId, userId } = req.query;
        
        if (!invoiceId || !userId) {
            return res.status(400).json({ message: 'Invalid parameters' });
        }
        
        // Load invoices
        const invoicesPath = './database/invoices.json';
        let invoices = [];
        if (fs.existsSync(invoicesPath)) {
            invoices = JSON.parse(fs.readFileSync(invoicesPath, 'utf8'));
        }
        
        // Find invoice
        const invoice = invoices.find(inv => 
            inv.invoiceNumber === invoiceId && 
            String(inv.customer.id) === String(userId)
        );
        
        if (!invoice) {
            return res.status(404).json({ message: 'Invoice not found' });
        }
        
        // Get customization settings
        const config = global.config;
        const customization = {
            theme: config.pdfCustomization?.theme || 'blue',
            headerText: config.pdfCustomization?.headerText || 'INVOICE',
            footerText: config.pdfCustomization?.footerText || 'Terima kasih atas kepercayaan Anda.',
            billingTitle: config.pdfCustomization?.billingTitle || 'TAGIHAN KEPADA:',
            serviceTitle: config.pdfCustomization?.serviceTitle || 'DETAIL LAYANAN:',
            showCustomerID: config.pdfCustomization?.showCustomerID !== false,
            showCustomerPhone: config.pdfCustomization?.showCustomerPhone !== false,
            showServiceSpeed: config.pdfCustomization?.showServiceSpeed !== false,
            showServiceDescription: config.pdfCustomization?.showServiceDescription !== false,
            showNPWP: config.pdfCustomization?.showNPWP !== false,
            showDueDate: config.pdfCustomization?.showDueDate !== false,
            paymentMethods: config.pdfCustomization?.paymentMethods || 'cash_transfer',
            showNotes: config.pdfCustomization?.showNotes !== false,
            additionalNotes: config.pdfCustomization?.additionalNotes || ''
        };
        
        // Generate PDF
        const { generatePDFInvoice } = require('../lib/pdf-invoice-generator');
        const pdfBuffer = await generatePDFInvoice(invoice, null, customization);
        
        // Send PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Invoice_${invoiceId}.pdf"`);
        return res.end(pdfBuffer);
    } catch (error) {
        console.error('[DOWNLOAD_INVOICE_PDF_ERROR]', error);
        return res.status(500).json({ message: error.message });
    }
});

// POST /api/send-invoice-manual
router.post('/send-invoice-manual', ensureAdmin, async (req, res) => {
    try {
        const { userId, userName, phoneNumber, method, noSend } = req.body;
        const normalizedMethod = method ? normalizeUserPaymentMethod(method) : 'TRANSFER_BANK';

        if (method && !normalizedMethod) {
            return res.status(400).json({ message: 'Metode pembayaran invoice harus CASH atau TRANSFER_BANK.' });
        }
        
        // Find user
        const user = global.users.find(u => String(u.id) === String(userId));
        if (!user) {
            return res.status(404).json({ message: 'User tidak ditemukan' });
        }
        
        // Generate invoice
        const { createInvoice, calculateInvoiceDueDate: _calculateInvoiceDueDate, getInvoiceSettings: _getInvoiceSettings } = require('../lib/invoice-generator');
        const { createInvoicePDF } = require('../lib/pdf-invoice-generator');
        
        const invoiceData = createInvoice(user, {
            paidDate: new Date().toISOString(),
            method: normalizedMethod,
            approvedBy: req.user ? req.user.username : 'Admin',
            notes: 'Invoice dikirim ulang secara manual'
        });
        
        if (!invoiceData) {
            return res.status(400).json({ message: 'Gagal membuat invoice data' });
        }
        
        // Get customization settings from config
        const config = global.config;
        const customization = {
            theme: config.pdfCustomization?.theme || 'blue',
            headerText: config.pdfCustomization?.headerText || 'INVOICE',
            footerText: config.pdfCustomization?.footerText || 'Terima kasih atas kepercayaan Anda.',
            billingTitle: config.pdfCustomization?.billingTitle || 'TAGIHAN KEPADA:',
            serviceTitle: config.pdfCustomization?.serviceTitle || 'DETAIL LAYANAN:',
            showCustomerID: config.pdfCustomization?.showCustomerID !== false,
            showCustomerPhone: config.pdfCustomization?.showCustomerPhone !== false,
            showServiceSpeed: config.pdfCustomization?.showServiceSpeed !== false,
            showServiceDescription: config.pdfCustomization?.showServiceDescription !== false,
            showNPWP: config.pdfCustomization?.showNPWP !== false,
            paymentMethods: config.pdfCustomization?.paymentMethods || 'cash_transfer',
            showNotes: config.pdfCustomization?.showNotes !== false,
            additionalNotes: config.pdfCustomization?.additionalNotes || ''
        };
        
        // Generate PDF with customization
        const pdfResult = await createInvoicePDF(invoiceData, customization);
        
        // If noSend is true, just return the invoiceId and don't send via WhatsApp
        if (noSend) {
            return res.json({ message: 'Invoice generated for printing.', invoiceId: invoiceData.invoiceNumber });
        }

        // Send via WhatsApp
        if (phoneNumber) {
            try {
                const phoneNumberStr = String(phoneNumber || '');
                const phoneNumbers = phoneNumberStr.split('|').map((number) => number.trim()).filter(Boolean);
                const invoiceCaption = renderTemplate('invoice_caption', {
                    nama_pelanggan: userName
                });
                const delivery = await sendMessageToMany(phoneNumbers, {
                    document: pdfResult.buffer,
                    fileName: `Invoice_${invoiceData.invoiceNumber}.pdf`,
                    mimetype: 'application/pdf',
                    caption: invoiceCaption
                });
                if (!delivery.sent) {
                    return res.status(500).json({
                        message: delivery.errorCode === 'WHATSAPP_NOT_CONNECTED'
                            ? 'WhatsApp tidak terhubung'
                            : 'Invoice gagal dikirim'
                    });
                }

                return res.json({ message: 'Invoice berhasil dikirim', invoiceId: invoiceData.invoiceNumber });
            } finally {
                if (pdfResult.path && fs.existsSync(pdfResult.path)) {
                    fs.unlinkSync(pdfResult.path);
                }
            }
        } else if (!phoneNumber) {
            return res.status(400).json({ message: 'Nomor telepon tidak tersedia untuk pengiriman.' });
        }
    } catch (error) {
        console.error('[SEND_INVOICE_MANUAL_ERROR]', error);
        return res.status(500).json({ message: error.message });
    }
});

// GET/POST /api/invoice-settings
router.route('/invoice-settings')
    .get(ensureAdmin, (req, res) => {
        try {
            const config = global.config;
            const invoiceSettings = {
                company: {
                    name: config.company?.name || '',
                    address: config.company?.address || '',
                    phone: config.company?.phone || '',
                    email: config.company?.email || '',
                    npwp: config.company?.npwp || '',
                    website: config.company?.website || '',
                    logoPath: config.company?.logoPath || ''
                },
                invoice: {
                    enableTax: config.invoice?.enableTax !== false,
                    taxRate: config.invoice?.taxRate || 11,
                    prefix: config.invoice?.prefix || 'INV',
                    dueDays: config.invoice?.dueDays || 30,
                    dueDateType: config.invoice?.dueDateType || 'fixed',
                    dueDateDay: config.invoice?.dueDateDay || 10,
                    autoSend: config.invoice?.autoSend === true,
                    sendPDF: config.invoice?.sendPDF !== false
                },
                bankAccount: {
                    bankName: config.bankAccount?.bankName || '',
                    accountNumber: config.bankAccount?.accountNumber || '',
                    accountName: config.bankAccount?.accountName || '',
                    branch: config.bankAccount?.branch || '',
                    paymentInstructions: config.bankAccount?.paymentInstructions || ''
                },
                pdfCustomization: {
                    theme: config.pdfCustomization?.theme || 'blue',
                    logoUrl: config.pdfCustomization?.logoUrl || '',
                    headerText: config.pdfCustomization?.headerText || 'INVOICE',
                    footerText: config.pdfCustomization?.footerText || 'Terima kasih atas kepercayaan Anda.',
                    billingTitle: config.pdfCustomization?.billingTitle || 'TAGIHAN KEPADA:',
                    serviceTitle: config.pdfCustomization?.serviceTitle || 'DETAIL LAYANAN:',
                    showCustomerID: config.pdfCustomization?.showCustomerID !== false,
                    showCustomerPhone: config.pdfCustomization?.showCustomerPhone !== false,
                    showServiceSpeed: config.pdfCustomization?.showServiceSpeed !== false,
                    showServiceDescription: config.pdfCustomization?.showServiceDescription !== false,
                    showNPWP: config.pdfCustomization?.showNPWP !== false,
                    showDueDate: config.pdfCustomization?.showDueDate !== false,
                    paymentMethods: config.pdfCustomization?.paymentMethods || 'cash_transfer',
                    showNotes: config.pdfCustomization?.showNotes !== false,
                    additionalNotes: config.pdfCustomization?.additionalNotes || ''
                }
            };
            return res.json(invoiceSettings);
        } catch (error) {
            console.error('[INVOICE_SETTINGS_GET_ERROR]', error);
            return res.status(500).json({ message: 'Error loading settings' });
        }
    })
    .post(ensureAdmin, (req, res) => {
        try {
            const {
                companyName, companyAddress, companyPhone, companyEmail, 
                companyNpwp, companyWebsite, enableTax, taxRate, invoicePrefix, 
                dueDays, dueDateType, dueDateDay, autoSend, sendPDF, template: _template,
                bankName, bankAccountNumber, bankAccountName, bankBranch, paymentInstructions,
                pdfTheme, logoUrl, headerText, footerText, billingTitle, serviceTitle,
                showCustomerID, showCustomerPhone, showServiceSpeed, showServiceDescription, 
                showNPWP, showDueDate, paymentMethods, showNotes, additionalNotes
            } = req.body;

            const config = global.config;

            // Update config
            config.company = {
                name: companyName || config.company?.name || '',
                address: companyAddress || config.company?.address || '',
                phone: companyPhone || config.company?.phone || '',
                email: companyEmail || config.company?.email || '',
                npwp: companyNpwp || config.company?.npwp || '',
                website: companyWebsite || config.company?.website || '',
                logoPath: config.company?.logoPath || ''
            };

            config.invoice = {
                ...config.invoice,
                enableTax: enableTax === 'true',
                taxRate: parseInt(taxRate) || 11,
                prefix: invoicePrefix || 'INV',
                dueDays: parseInt(dueDays) || 30,
                dueDateType: dueDateType || 'fixed',
                dueDateDay: parseInt(dueDateDay) || 10,
                autoSend: autoSend === 'true',
                sendPDF: sendPDF !== 'false'
            };
            
            config.bankAccount = {
                bankName: bankName || '',
                accountNumber: bankAccountNumber || '',
                accountName: bankAccountName || '',
                branch: bankBranch || '',
                paymentInstructions: paymentInstructions || ''
            };
            
            config.pdfCustomization = {
                theme: pdfTheme || 'blue',
                logoUrl: logoUrl || '',
                headerText: headerText || 'INVOICE',
                footerText: footerText || 'Terima kasih atas kepercayaan Anda.',
                billingTitle: billingTitle || 'TAGIHAN KEPADA:',
                serviceTitle: serviceTitle || 'DETAIL LAYANAN:',
                showCustomerID: showCustomerID !== 'false',
                showCustomerPhone: showCustomerPhone === 'true',
                showServiceSpeed: showServiceSpeed !== 'false',
                showServiceDescription: showServiceDescription === 'true',
                showNPWP: showNPWP === 'true',
                showDueDate: showDueDate !== 'false',
                paymentMethods: paymentMethods || 'cash_transfer',
                showNotes: showNotes === 'true',
                additionalNotes: additionalNotes || ''
            };

            // Save to file
            fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
            
            // Reload global config
            global.config = config;
            
            return res.json({ message: 'Settings saved successfully' });
        } catch (error) {
            console.error('[INVOICE_SETTINGS_POST_ERROR]', error);
            return res.status(500).json({ message: 'Error saving settings' });
        }
    });

// POST /api/upload-logo
router.post('/upload-logo', ensureAdmin, uploadLogo.single('logo'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
    }
    
    const config = global.config;
    
    // Delete old logo if exists
    if (config.company?.logoPath) {
        const oldLogoPath = path.join(__dirname, '..', 'static', config.company.logoPath);
        if (fs.existsSync(oldLogoPath)) {
            fs.unlinkSync(oldLogoPath);
        }
    }
    
    // Save new logo path to config
    const logoPath = '/uploads/logos/' + req.file.filename;
    config.company = config.company || {};
    config.company.logoPath = logoPath;
    
    // Save config
    fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
    global.config = config;
    
    return res.json({ 
        message: 'Logo uploaded successfully',
        logoPath: logoPath 
    });
});

// POST /api/preview-pdf-invoice
router.post('/preview-pdf-invoice', ensureAdmin, async (req, res) => {
    try {
        const { generateInvoiceHTML } = require('../lib/pdf-invoice-generator');
        const { calculateInvoiceDueDate, getInvoiceSettings } = require('../lib/invoice-generator');
        const config = global.config;
        const sampleIssueDate = new Date();
        const sampleDueDate = calculateInvoiceDueDate(sampleIssueDate, getInvoiceSettings());
        
        // Create sample invoice data
        const sampleData = {
            invoiceNumber: 'INV-20240914-0001',
            issueDate: sampleIssueDate.toISOString(),
            dueDate: sampleDueDate.toISOString(),
            company: config.company || {
                name: 'RAF NET Internet Service',
                address: 'Jl. Contoh No. 123, Kota Contoh',
                phone: '+6285233047094',
                email: 'info@rafnet.my.id',
                npwp: '12.345.678.9-012.000'
            },
            customer: {
                id: 'CUST001',
                name: 'PT. Contoh Corporate',
                phone: '+6281234567890',
                address: 'Jl. Pelanggan No. 456, Kota Pelanggan'
            },
            service: {
                name: 'Paket Corporate 100 Mbps',
                description: 'Internet dedicated 100 Mbps up/down',
                period: 'Januari 2024'
            },
            billing: {
                subtotal: 1350000,
                taxRate: config.invoice?.taxRate || 11,
                tax: 148500,
                total: 1498500
            },
            payment: {
                paidDate: new Date().toISOString(),
                method: 'Transfer Bank',
                approvedBy: 'Admin'
            },
            notes: 'Invoice sample untuk preview'
        };
        
        // Use real-time customization from request body or fallback to config
        let customization = config.pdfCustomization || {};
        
        // If customization is sent from frontend, use that for real-time preview
        if (req.body && req.body.customization) {
            customization = {
                theme: req.body.customization.pdfTheme || customization.theme || 'blue',
                headerText: req.body.customization.headerText || customization.headerText || 'INVOICE',
                footerText: req.body.customization.footerText || customization.footerText || 'Terima kasih atas kepercayaan Anda.',
                billingTitle: req.body.customization.billingTitle || customization.billingTitle || 'TAGIHAN KEPADA:',
                serviceTitle: req.body.customization.serviceTitle || customization.serviceTitle || 'DETAIL LAYANAN:',
                showCustomerID: req.body.customization.showCustomerID !== 'false',
                showServiceDescription: req.body.customization.showServiceDescription !== 'false',
                showNPWP: req.body.customization.showNPWP !== 'false',
                showDueDate: req.body.customization.showDueDate !== 'false',
                additionalNotes: req.body.customization.additionalNotes || customization.additionalNotes || ''
            };
        }
        
        console.log('[PDF_PREVIEW] Using customization:', customization);
        
        const htmlContent = generateInvoiceHTML(sampleData, customization);
        return res.send(htmlContent);
        
    } catch (error) {
        console.error('[PDF_PREVIEW_ERROR]', error);
        return res.status(500).json({ message: 'Error generating PDF preview' });
    }
});

module.exports = router;



