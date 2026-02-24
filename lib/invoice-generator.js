"use strict";

const fs = require('fs');
const path = require('path');

// Load config
let config;
try {
    config = global.config || JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
} catch (error) {
    console.error('[INVOICE_GENERATOR] Failed to load config:', error.message);
    config = {
        invoice: {
            prefix: 'INV',
            enableTax: false,
            taxRate: 11,
            dueDays: 30
        }
    };
}

// Cache untuk menyimpan counter invoice harian
let invoiceCounter = {
    date: null,
    count: 0
};

/**
 * Convert payment method code to Indonesian text
 */
function convertPaymentMethodToIndonesian(method) {
    if (!method) return 'Transfer Bank'; // Default
    
    const methodMap = {
        'CASH': 'Tunai',
        'TRANSFER_BANK': 'Transfer Bank',
        'TRANSFER': 'Transfer Bank',
        'Tunai': 'Tunai',
        'Transfer Bank': 'Transfer Bank'
    };
    
    return methodMap[method] || method;
}

/**
 * Invoice Generator Library
 * Handles automatic invoice generation for corporate customers
 */

/**
 * Generate unique invoice number with sequential counter
 * Format: PREFIX-YYYYMMDD-XXXX
 */
function generateInvoiceNumber() {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
    
    // Reset counter jika hari baru
    if (invoiceCounter.date !== dateStr) {
        invoiceCounter.date = dateStr;
        invoiceCounter.count = 0;
    }
    
    // Increment counter
    invoiceCounter.count++;
    
    // Format: INV-YYYYMMDD-XXXX
    const prefix = config?.invoice?.prefix || 'INV';
    return `${prefix}-${dateStr}-${String(invoiceCounter.count).padStart(4, '0')}`;
}

/**
 * Check if user should generate invoice
 * Only users with send_invoice flag enabled will receive invoice
 */
function shouldGenerateInvoice(user) {
    // Check if auto-send is enabled globally
    const autoSend = config?.invoice?.autoSend !== false;
    
    if (!autoSend) {
        return false;
    }
    
    if (!user) return false;
    
    // Only check send_invoice flag - simple and customizable per user
    return user.send_invoice === true || user.send_invoice === 1;
}

/**
 * Get package price from subscription name using packages database
 */
function getPackagePrice(subscription) {
    if (!subscription) return 0;
    
    // Try to get packages from global or load from file
    let packages = [];
    try {
        if (global.packages) {
            packages = global.packages;
        } else {
            const packagesPath = path.join(__dirname, '..', 'database', 'packages.json');
            if (fs.existsSync(packagesPath)) {
                packages = JSON.parse(fs.readFileSync(packagesPath, 'utf8'));
            }
        }
        
        // Find package by name and get price from database
        const userPackage = packages.find(pkg => pkg.name === subscription);
        if (userPackage && userPackage.price) {
            // Price might be string or number in database
            return parseInt(userPackage.price);
        }
    } catch (error) {
        console.warn('[INVOICE] Could not load package price from database:', error.message);
    }
    
    // Fallback: try to extract from name if not found in database
    console.warn(`[INVOICE] Package "${subscription}" not found in database, trying to extract from name`);
    
    // Pattern 1: Look for number followed by K (e.g., "100K", "150k")
    const kPattern = subscription.match(/(\d+)\s*[Kk]/i);
    if (kPattern) {
        return parseInt(kPattern[1]) * 1000;
    }
    
    // Pattern 2: Look for full number
    const cleanedSub = subscription.replace(/\./g, '');
    const fullPattern = cleanedSub.match(/(\d{5,6})/);
    if (fullPattern) {
        return parseInt(fullPattern[1]);
    }
    
    return 0;
}

/**
 * Generate invoice data structure
 */
function generateInvoiceData(user, paymentData = {}) {
    const invoiceNumber = generateInvoiceNumber();
    const issueDate = new Date();
    
    // Calculate due date - ini adalah PERIODE TAGIHAN yang dibayar
    // Jatuh tempo SELALU di bulan yang sama dengan tanggal pembayaran
    const dueDateType = config?.invoice?.dueDateType || 'fixed';
    let dueDate;
    
    if (dueDateType === 'fixed') {
        // Fixed day of month - tanggal tagihan dari config
        const dueDateDay = config?.invoice?.dueDateDay || global.config?.tanggal_batas_bayar || 10;
        const currentMonth = issueDate.getMonth();
        const currentYear = issueDate.getFullYear();
        
        // SELALU gunakan bulan yang sama dengan tanggal pembayaran
        // Tidak peduli bayar tanggal berapa, jatuh tempo tetap di bulan ini
        dueDate = new Date(currentYear, currentMonth, dueDateDay);
    } else {
        // Relative days from issue date (untuk backward compatibility)
        const dueDays = config?.invoice?.dueDays || 30;
        dueDate = new Date(issueDate);
        dueDate.setDate(dueDate.getDate() + dueDays);
    }
    
    // Get package details from database
    let packagePrice = 0;
    let speed = 'Sesuai Paket';
    
    // Try to get packages from global or load from file
    let packages = [];
    try {
        if (global.packages) {
            packages = global.packages;
        } else {
            const packagesPath = path.join(__dirname, '..', 'database', 'packages.json');
            if (fs.existsSync(packagesPath)) {
                packages = JSON.parse(fs.readFileSync(packagesPath, 'utf8'));
            }
        }
        
        const userPackage = packages.find(pkg => pkg.name === user.subscription);
        if (userPackage) {
            // Get price from database
            if (userPackage.price) {
                packagePrice = parseInt(userPackage.price);
                console.log(`[INVOICE] Using price from database for ${user.subscription}: ${packagePrice}`);
            }
            // Get speed profile
            if (userPackage.profile) {
                speed = userPackage.profile;
            }
        } else {
            console.warn(`[INVOICE] Package "${user.subscription}" not found in database`);
            // Fallback to extracting from name
            packagePrice = getPackagePrice(user.subscription);
        }
    } catch (error) {
        console.error('[INVOICE] Error loading package data:', error.message);
        // Fallback to extracting from name
        packagePrice = getPackagePrice(user.subscription);
    }
    
    // Get tax settings with backward compatibility
    const enableTax = config?.invoice?.enableTax !== false;
    const taxRate = enableTax ? (config?.invoice?.taxRate || 11) : 0;
    const tax = enableTax ? Math.round(packagePrice * (taxRate / 100)) : 0;
    const total = packagePrice + tax;
    
    return {
        invoiceNumber,
        issueDate: issueDate.toISOString(),
        dueDate: dueDate.toISOString(),
        customer: {
            id: user.id,
            name: user.name,
            phone: user.phone_number,
            address: user.address || 'Alamat tidak tersedia',
            deviceId: user.device_id
        },
        service: {
            name: user.subscription,
            period: paymentData.period || 'Bulanan',
            description: `Layanan Internet ${user.subscription}`,
            speed: speed
        },
        billing: {
            subtotal: packagePrice,
            tax: tax,
            taxRate: taxRate,
            enableTax: enableTax,
            total: total,
            currency: 'IDR'
        },
        payment: {
            status: 'PAID',
            paidDate: paymentData.paidDate || issueDate.toISOString(),
            method: convertPaymentMethodToIndonesian(paymentData.method),
            approvedBy: paymentData.approvedBy || 'System'
        },
        company: config?.company || {
            name: 'RAF NET Internet Service',
            address: 'Alamat Perusahaan',
            phone: 'Nomor Telepon Perusahaan',
            email: 'info@rafnet.com',
            npwp: 'NPWP Perusahaan'
        },
        bankAccount: config?.bankAccount || {
            bankName: 'Bank Default',
            accountNumber: '1234567890',
            accountName: 'RAF NET'
        },
        notes: paymentData.notes || 'Terima kasih atas pembayaran Anda.',
        createdAt: issueDate.toISOString()
    };
}

/**
 * Format currency to Indonesian Rupiah
 */
function formatCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(amount);
}

/**
 * Generate invoice text for WhatsApp
 */
function generateInvoiceText(invoiceData, customTemplate = null) {
    const issueDate = new Date(invoiceData.issueDate).toLocaleDateString('id-ID', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    const paidDate = new Date(invoiceData.payment.paidDate).toLocaleDateString('id-ID', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    // Use custom template if provided
    if (customTemplate) {
        const templateVars = {
            invoiceNumber: invoiceData.invoiceNumber,
            issueDate: issueDate,
            customerName: invoiceData.customer.name,
            customerId: invoiceData.customer.id,
            customerPhone: invoiceData.customer.phone,
            customerAddress: invoiceData.customer.address,
            serviceName: invoiceData.service.name,
            servicePeriod: invoiceData.service.period,
            serviceDescription: invoiceData.service.description,
            subtotal: formatCurrency(invoiceData.billing.subtotal),
            tax: formatCurrency(invoiceData.billing.tax),
            taxRate: invoiceData.billing.taxRate,
            total: formatCurrency(invoiceData.billing.total),
            paidDate: paidDate,
            paymentMethod: invoiceData.payment.method,
            approvedBy: invoiceData.payment.approvedBy,
            companyName: invoiceData.company.name,
            companyAddress: invoiceData.company.address,
            companyPhone: invoiceData.company.phone,
            companyEmail: invoiceData.company.email,
            companyNpwp: invoiceData.company.npwp,
            notes: invoiceData.notes
        };

        let result = customTemplate;
        for (const [key, value] of Object.entries(templateVars)) {
            const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
            result = result.replace(regex, value);
        }
        return result;
    }

    // Default template
    return `
🧾 *INVOICE PEMBAYARAN*
━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 *Detail Invoice:*
• No. Invoice: ${invoiceData.invoiceNumber}
• Tanggal: ${issueDate}
• Status: ✅ LUNAS

👤 *Pelanggan:*
• Nama: ${invoiceData.customer.name}
• ID: ${invoiceData.customer.id}
• Telepon: ${invoiceData.customer.phone}
• Alamat: ${invoiceData.customer.address}

🌐 *Layanan:*
• Paket: ${invoiceData.service.name}
• Periode: ${invoiceData.service.period}
• Deskripsi: ${invoiceData.service.description}

💰 *Rincian Biaya:*
• Subtotal: ${formatCurrency(invoiceData.billing.subtotal)}${invoiceData.billing.enableTax ? `
• PPN (${invoiceData.billing.taxRate}%): ${formatCurrency(invoiceData.billing.tax)}` : ''}
• *Total: ${formatCurrency(invoiceData.billing.total)}*

💳 *Pembayaran:*
• Tanggal Bayar: ${paidDate}
• Metode: ${invoiceData.payment.method}
• Disetujui oleh: ${invoiceData.payment.approvedBy}

🏢 *${invoiceData.company.name}*
${invoiceData.company.address}
📞 ${invoiceData.company.phone}
📧 ${invoiceData.company.email}
🆔 NPWP: ${invoiceData.company.npwp}

━━━━━━━━━━━━━━━━━━━━━━━━━━
${invoiceData.notes}

_Invoice ini dibuat secara otomatis oleh sistem._
`.trim();
}

/**
 * Save invoice to database
 */
function saveInvoice(invoiceData) {
    const invoicesPath = path.join(__dirname, '../database/invoices.json');
    
    let invoices = [];
    if (fs.existsSync(invoicesPath)) {
        try {
            const data = fs.readFileSync(invoicesPath, 'utf8');
            invoices = JSON.parse(data);
        } catch (error) {
            console.error('[INVOICE_SAVE_ERROR] Error reading invoices file:', error);
            invoices = [];
        }
    }
    
    invoices.push(invoiceData);
    
    try {
        fs.writeFileSync(invoicesPath, JSON.stringify(invoices, null, 2), 'utf8');
        console.log(`[INVOICE_SAVED] Invoice ${invoiceData.invoiceNumber} saved successfully`);
        return true;
    } catch (error) {
        console.error('[INVOICE_SAVE_ERROR] Error saving invoice:', error);
        return false;
    }
}

/**
 * Generate and save invoice for a user
 */
function createInvoice(user, paymentData = {}) {
    try {
        // Check if user should receive invoice
        if (!shouldGenerateInvoice(user)) {
            console.log(`[INVOICE_SKIP] User ${user.id} does not have send_invoice enabled`);
            return null;
        }
        
        // Generate invoice data
        const invoiceData = generateInvoiceData(user, paymentData);
        
        // Save invoice to database
        const saved = saveInvoice(invoiceData);
        
        if (saved) {
            console.log(`[INVOICE_CREATED] Invoice ${invoiceData.invoiceNumber} created for user ${user.id}`);
            return invoiceData;
        } else {
            console.error(`[INVOICE_ERROR] Failed to save invoice for user ${user.id}`);
            return null;
        }
    } catch (error) {
        console.error('[INVOICE_CREATE_ERROR] Error creating invoice:', error);
        return null;
    }
}

/**
 * Get all invoices for a user
 */
function getUserInvoices(userId) {
    const invoicesPath = path.join(__dirname, '../database/invoices.json');
    
    if (!fs.existsSync(invoicesPath)) {
        return [];
    }
    
    try {
        const data = fs.readFileSync(invoicesPath, 'utf8');
        const invoices = JSON.parse(data);
        return invoices.filter(invoice => invoice.customer.id === userId);
    } catch (error) {
        console.error('[INVOICE_GET_ERROR] Error reading invoices:', error);
        return [];
    }
}

module.exports = {
    generateInvoiceNumber,
    shouldGenerateInvoice,
    getPackagePrice,
    generateInvoiceData,
    generateInvoiceText,
    createInvoice,
    saveInvoice,
    getUserInvoices,
    formatCurrency,
    convertPaymentMethodToIndonesian
};
