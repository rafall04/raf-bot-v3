/**
 * Header Doc
 * Purpose: Merender invoice pelanggan — HTML (dipakai layar & cetak) dan PDF
 *          (dilampirkan ke WhatsApp). SATU sumber tampilan untuk keduanya:
 *          generatePDFInvoice() mencetak HTML dari generateInvoiceHTML(), jadi
 *          apa pun yang tak ditangani di sini tidak akan muncul di mana pun.
 * Caller: routes/invoice.js (/api/view-invoice, /api/download-invoice-pdf,
 *          /api/preview-pdf-invoice) dan lib/approval-logic.js (kirim otomatis
 *          saat pembayaran disetujui).
 * Deps: puppeteer (render PDF), fs/path (logo), tema warna lokal.
 *          Setelan tampilan datang dari config.pdfCustomization lewat parameter
 *          `customization` — lihat daftar lengkapnya di generateInvoiceHTML().
 * MainFuncs: generateInvoiceHTML(), generatePDFInvoice(), getThemeColors(),
 *          formatInvoiceDate()
 * SideEffects: menjalankan Chromium headless; menulis berkas PDF bila outputPath
 *          diberikan. Tidak menyentuh DB.
 */
"use strict";

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
function formatInvoiceDate(value, fallbackLabel = '-') {
    if (!value) {
        return fallbackLabel;
    }

    const date = value instanceof Date ? new Date(value) : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return fallbackLabel;
    }

    return new Intl.DateTimeFormat('id-ID', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Jakarta'
    }).format(date);
}


/**
 * PDF Invoice Generator
 * Generates professional PDF invoices for corporate customers
 */

/**
 * Get theme colors based on selected theme
 */
function getThemeColors(theme) {
    const themes = {
        blue: { primary: '#2c5aa0', secondary: '#1e3d72', accent: '#4e73df' },
        green: { primary: '#28a745', secondary: '#1e7e34', accent: '#20c997' },
        red: { primary: '#dc3545', secondary: '#bd2130', accent: '#fd7e14' },
        purple: { primary: '#6f42c1', secondary: '#59359a', accent: '#e83e8c' },
        dark: { primary: '#343a40', secondary: '#23272b', accent: '#6c757d' }
    };
    return themes[theme] || themes.blue;
}

/**
 * Generate HTML template for PDF invoice
 */
function generateInvoiceHTML(invoiceData, customization = {}) {
    const issueDate = formatInvoiceDate(invoiceData.issueDate);
    const dueDate = formatInvoiceDate(invoiceData.dueDate);
    const paidDate = formatInvoiceDate(invoiceData.payment?.paidDate);

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0
        }).format(amount);
    };
    
    // Get theme colors and customization settings
    const theme = getThemeColors(customization.theme || 'blue');
    const headerText = customization.headerText || 'INVOICE';
    const footerText = customization.footerText || 'Terima kasih atas kepercayaan Anda.';
    const billingTitle = customization.billingTitle || 'TAGIHAN KEPADA';
    const showCustomerID = customization.showCustomerID !== false;
    const showCustomerPhone = customization.showCustomerPhone !== false;
    const showNPWP = customization.showNPWP !== false;
    const showDueDate = customization.showDueDate !== false; // New

    // Enam setelan di bawah SUDAH LAMA dirakit ke `customization` oleh
    // routes/invoice.js dan lib/approval-logic.js, tapi TIDAK PERNAH dibaca di
    // sini — jadi kontrolnya ada di halaman Pengaturan Invoice, tersimpan ke
    // config.json, lalu tak berpengaruh apa pun pada invoice (HTML maupun PDF).
    // Terbukti di produksi: showServiceSpeed=true dengan data speed "70Mbps",
    // tapi kecepatan tak pernah muncul di invoice.
    const serviceTitle = customization.serviceTitle || 'DETAIL LAYANAN:';
    const showServiceSpeed = customization.showServiceSpeed !== false;
    const showServiceDescription = customization.showServiceDescription !== false;
    const showNotes = customization.showNotes !== false;
    const additionalNotes = customization.additionalNotes || '';
    // 'cash_transfer' = tunai & transfer bank · 'all' = + pembayaran online.
    const paymentMethods = customization.paymentMethods || 'cash_transfer';
    
    // --- LOGO HANDLING ---
    let logoUrl = '';
    
    // First check if there's a logoUrl in customization (external URL)
    if (customization.logoUrl && customization.logoUrl.trim() !== '') {
        logoUrl = customization.logoUrl.trim();
        console.log(`[PDF_LOGO] Using external logo URL: ${logoUrl}`);
    } 
    // Otherwise check for uploaded logo file
    else if (invoiceData.company?.logoPath) {
        const relativeLogoPath = invoiceData.company.logoPath;
        // Construct the absolute path to the logo file.
        // __dirname is c:\project\raf-bot-v2\lib, so we go up one level to the project root.
        const absoluteLogoPath = path.join(__dirname, '..', 'static', relativeLogoPath);
        
        if (fs.existsSync(absoluteLogoPath)) {
            try {
                const logoBuffer = fs.readFileSync(absoluteLogoPath);
                // Determine mime type from file extension
                const ext = path.extname(absoluteLogoPath).slice(1).toLowerCase();
                let mimeType = 'image/png'; // default
                if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
                else if (ext === 'png') mimeType = 'image/png';
                else if (ext === 'gif') mimeType = 'image/gif';
                else if (ext === 'svg') mimeType = 'image/svg+xml';
                
                logoUrl = `data:${mimeType};base64,${logoBuffer.toString('base64')}`;
                console.log(`[PDF_LOGO] Using uploaded logo from: ${relativeLogoPath}`);
            } catch (e) {
                console.error(`[PDF_LOGO_ERROR] Failed to read logo file at ${absoluteLogoPath}:`, e);
            }
        } else {
            // This case can happen if the file is deleted but the path remains in config.json
            console.warn(`[PDF_LOGO_WARN] Logo file not found at physical path: ${absoluteLogoPath}`);
        }
    }
    // --- END LOGO HANDLING ---

    return `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Invoice ${invoiceData.invoiceNumber}</title>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Poppins', sans-serif;
            font-size: 12px;
            line-height: 1.6;
            color: #444;
            background: #fff;
        }
        
        .invoice-container {
            width: 210mm;
            min-height: 297mm;
            margin: 0 auto;
            padding: 25mm;
            background: white;
            display: flex;
            flex-direction: column;
        }
        
        .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 10mm;
        }
        
        .company-logo {
            max-width: 150px;
            max-height: 70px;
            margin-bottom: 10px;
        }

        .company-info {
            flex: 1;
        }
        
        .company-name {
            font-size: 22px;
            font-weight: 700;
            color: ${theme.primary};
            margin-bottom: 2px;
        }
        
        .company-details {
            font-size: 11px;
            color: #555;
            line-height: 1.8;
        }
        
        .company-details div {
            margin: 2px 0;
        }
        
        .invoice-details {
            text-align: right;
            flex: 1;
        }
        
        .invoice-title {
            font-size: 36px;
            font-weight: 700;
            color: ${theme.primary};
            margin-bottom: 2px;
        }
        
        .invoice-meta {
            font-size: 12px;
            color: #555;
        }
        .invoice-meta table {
            width: 100%;
            text-align: right;
        }
        .invoice-meta td {
            padding: 2px 0;
        }
        .invoice-meta .label {
            font-weight: 600;
            color: #333;
            padding-right: 10px;
        }
        
        .status-paid {
            background: #28a745;
            color: white;
            padding: 8px 18px;
            border-radius: 5px;
            font-size: 14px;
            font-weight: 600;
            margin-top: 10px;
            display: inline-block;
            letter-spacing: 1px;
        }
        
        .billing-section {
            margin-bottom: 10mm;
        }
        
        .section-title {
            font-size: 11px;
            font-weight: 600;
            color: #777;
            margin-bottom: 5px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .customer-info {
            font-size: 12px;
            line-height: 1.6;
        }
        .customer-name {
            font-size: 16px;
            font-weight: 600;
            color: #333;
        }
        
        .invoice-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 8mm;
            position: relative;
        }
        
        .invoice-table th {
            background: ${theme.primary};
            color: white;
            padding: 12px;
            text-align: left;
            font-size: 12px;
            font-weight: 600;
        }
        
        .invoice-table td {
            padding: 12px;
            border-bottom: 1px solid #eee;
            font-size: 12px;
        }
        
        .invoice-table tr:last-child td {
            border-bottom: 2px solid ${theme.primary};
        }

        .invoice-table .item-description {
            color: #666;
            font-size: 11px;
        }
        
        .watermark {
            position: absolute;
            top: 55%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-45deg);
            font-size: 120px;
            font-weight: 700;
            color: rgba(0, 0, 0, 0.06);
            z-index: -1;
            pointer-events: none;
            letter-spacing: 15px;
        }
        
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        
        .summary-section {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 8mm;
        }

        .totals-table {
            width: 50%;
            border-collapse: collapse;
        }
        
        .totals-table td {
            padding: 8px 12px;
            font-size: 12px;
        }
        .totals-table .label {
            font-weight: 600;
            color: #555;
        }
        
        .totals-table .total-row td {
            background: ${theme.primary};
            color: white;
            font-weight: 700;
            font-size: 16px;
            padding: 12px;
        }
        
        .payment-info {
            clear: both;
            background: #f9f9f9;
            padding: 15px;
            border-left: 4px solid ${theme.accent};
            margin-bottom: 8mm;
            font-size: 11px;
        }
        
        .main-content {
            flex-grow: 1;
        }

        .footer {
            text-align: center;
            font-size: 10px;
            color: #888;
            border-top: 1px solid #eee;
            padding-top: 15px;
            margin-top: 10mm;
        }
    </style>
</head>
<body>
    <div class="invoice-container">
        <div class="main-content">
            <!-- Header -->
            <div class="header">
                <div class="company-info">
                ${logoUrl ? 
                    `<img src="${logoUrl}" class="company-logo" alt="Company Logo">` : 
                    `<div class="company-name">${invoiceData.company.name}</div>`
                }
                <div class="company-details">
                    <div>${invoiceData.company.address}</div>
                    <div>Telp: ${invoiceData.company.phone}</div>
                    <div>Email: ${invoiceData.company.email}</div>
                    ${showNPWP && invoiceData.company.npwp ? `<div>NPWP: ${invoiceData.company.npwp}</div>` : ''}
                </div>
            </div>
                <div class="invoice-details">
                    <div class="invoice-title">${headerText}</div>
                    <div class="invoice-meta">
                        <table>
                            <tr><td class="label">No. Invoice:</td><td>${invoiceData.invoiceNumber}</td></tr>
                            <tr><td class="label">Tanggal:</td><td>${issueDate}</td></tr>
                            ${showDueDate ? `<tr><td class="label">Jatuh Tempo:</td><td>${dueDate}</td></tr>` : ''}
                        </table>
                    </div>
                    ${invoiceData.payment.status === 'PAID' ? '<div class="status-paid">LUNAS</div>' : ''}
                </div>
            </div>
            
            <!-- Billing Info -->
            <div class="billing-section">
                <div class="section-title">${billingTitle}</div>
                <div class="customer-info">
                    <div class="customer-name">${invoiceData.customer.name}</div>
                    ${showCustomerID ? `ID Pelanggan: ${invoiceData.customer.id}<br>` : ''}
                    ${showCustomerPhone ? `Telepon: ${invoiceData.customer.phone}<br>` : ''}
                    ${invoiceData.customer.address}
                </div>
            </div>
            
            <!-- Invoice Items -->
            <div style="position: relative;">
                ${invoiceData.payment.status === 'PAID' ? '<div class="watermark">LUNAS</div>' : ''}
                <div class="section-title">${serviceTitle}</div>
                <table class="invoice-table">
                    <thead>
                        <tr>
                            <th style="width: 55%">Deskripsi Layanan</th>
                            <th style="width: 20%" class="text-center">Periode</th>
                            <th style="width: 25%" class="text-right">Jumlah</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>
                                <strong>${invoiceData.service.name}</strong>
                                ${showServiceSpeed && invoiceData.service.speed ? `<div class="item-description">Kecepatan: ${invoiceData.service.speed}</div>` : ''}
                                ${showServiceDescription && invoiceData.service.description ? `<div class="item-description">${invoiceData.service.description}</div>` : ''}
                            </td>
                            <td class="text-center">${invoiceData.service.period}</td>
                            <td class="text-right">${formatCurrency(invoiceData.billing.subtotal)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            
            <!-- Summary -->
            <div class="summary-section">
                <table class="totals-table">
                    <tr>
                        <td class="label">Subtotal</td>
                        <td class="text-right">${formatCurrency(invoiceData.billing.subtotal)}</td>
                    </tr>
                    ${invoiceData.billing.enableTax ? `<tr>
                        <td class="label">PPN (${invoiceData.billing.taxRate}%)</td>
                        <td class="text-right">${formatCurrency(invoiceData.billing.tax)}</td>
                    </tr>` : ''}
                    <tr class="total-row">
                        <td class="label">TOTAL</td>
                        <td class="text-right">${formatCurrency(invoiceData.billing.total)}</td>
                    </tr>
                </table>
            </div>
            
            <!-- Payment Info -->
            <div class="payment-info">
                <strong>Informasi Pembayaran:</strong><br>
                <strong>Status:</strong> LUNAS &nbsp;&nbsp;|&nbsp;&nbsp;
                <strong>Tanggal Bayar:</strong> ${paidDate} &nbsp;&nbsp;|&nbsp;&nbsp;
                <strong>Metode:</strong> ${invoiceData.payment.method} &nbsp;&nbsp;|&nbsp;&nbsp;
                <strong>Disetujui oleh:</strong> ${invoiceData.payment.approvedBy}
            </div>

            <!-- Metode pembayaran yang diterima.
                 invoiceData.bankAccount SUDAH lama disimpan di tiap record invoice
                 (lib/invoice-generator.js) tapi tak pernah ditampilkan — rekening
                 yang diisi admin di Pengaturan Invoice jadi tak pernah sampai ke
                 pelanggan. Blok ini yang membuat setelan paymentMethods berarti.
                 (Catatan: JANGAN pakai backtick di komentar ini — komentar berada di
                 DALAM template literal, backtick akan menutup string-nya.) -->
            <div class="payment-info">
                <strong>Metode Pembayaran yang Diterima:</strong><br>
                Tunai${invoiceData.bankAccount && invoiceData.bankAccount.bankName ? ` &nbsp;&nbsp;|&nbsp;&nbsp; Transfer Bank: <strong>${invoiceData.bankAccount.bankName}</strong> ${invoiceData.bankAccount.accountNumber || ''}${invoiceData.bankAccount.accountName ? ` a.n. ${invoiceData.bankAccount.accountName}` : ''}` : ' &nbsp;&nbsp;|&nbsp;&nbsp; Transfer Bank'}${paymentMethods === 'all' ? ' &nbsp;&nbsp;|&nbsp;&nbsp; Pembayaran Online' : ''}
                ${invoiceData.bankAccount && invoiceData.bankAccount.paymentInstructions ? `<br><span class="item-description">${invoiceData.bankAccount.paymentInstructions}</span>` : ''}
            </div>

            ${showNotes && additionalNotes ? `<div class="payment-info">
                <strong>Catatan:</strong><br>
                ${additionalNotes}
            </div>` : ''}
        </div>
        
        <!-- Footer -->
        <div class="footer">
            <p>${footerText.replace('{companyName}', invoiceData.company.name)}</p>
            <p>Invoice ini sah dan diproses oleh komputer. Silakan hubungi kami jika ada pertanyaan.</p>
        </div>
    </div>
</body>
</html>`;
}


/**
 * Generate PDF invoice
 */
async function generatePDFInvoice(invoiceData, outputPath = null, customization = {}) {
    let browser = null;
    
    try {
        // Puppeteer configuration optimized for Linux
        const puppeteerConfig = {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-accelerated-2d-canvas'
            ]
        };
        
        // Additional config for Linux environments
        if (process.platform === 'linux') {
            puppeteerConfig.executablePath = '/usr/bin/chromium-browser'; // Common path for Chromium on Ubuntu
            // Fallback paths if the above doesn't exist
            const chromiumPaths = [
                '/usr/bin/chromium-browser',
                '/usr/bin/chromium',
                '/usr/bin/google-chrome',
                '/usr/bin/google-chrome-stable',
                'chromium-browser',
                'chromium',
                'google-chrome'
            ];
            
            for (const chromePath of chromiumPaths) {
                try {
                    if (fs.existsSync(chromePath) || require('child_process').execSync(`which ${chromePath} 2>/dev/null`).toString().trim()) {
                        puppeteerConfig.executablePath = chromePath;
                        console.log(`[PDF_INVOICE] Using Chromium at: ${chromePath}`);
                        break;
                    }
                } catch (_e) {
                    // Continue to next path
                }
            }
        }
        
        browser = await puppeteer.launch(puppeteerConfig);
        
        const page = await browser.newPage();
        
        // Generate HTML content
        const htmlContent = generateInvoiceHTML(invoiceData, customization);
        
        // Set content
        await page.setContent(htmlContent, { 
            waitUntil: 'networkidle0'
        });
        
        // Generate PDF
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '20px',
                right: '20px',
                bottom: '20px',
                left: '20px'
            }
        });
        
        if (outputPath) {
            fs.writeFileSync(outputPath, pdfBuffer);
        }
        
        console.log(`[PDF_INVOICE] Generated PDF for invoice ${invoiceData.invoiceNumber}`);
        
        await browser.close();
        return pdfBuffer;
        
    } catch (error) {
        console.error('[PDF_INVOICE_ERROR]', error.message);
        
        if (browser) {
            try {
                await browser.close();
            } catch (_e) {}
        }
        
        // Fallback to alternative method
        console.log('[PDF_INVOICE] Using fallback PDF generation');
        return await generatePDFAlternative(invoiceData, outputPath, customization);
    }
}

/**
 * Generate PDF invoice and save to temp directory
 */
async function createInvoicePDF(invoiceData, customization = {}) {
    try {
        // Create temp directory if not exists - with better error handling for Linux
        const tempDir = path.resolve(path.join(__dirname, '..', 'temp'));
        
        // Log the temp directory path for debugging
        console.log(`[PDF_INVOICE] Using temp directory: ${tempDir}`);
        
        // Ensure temp directory exists with proper permissions
        try {
            if (!fs.existsSync(tempDir)) {
                console.log(`[PDF_INVOICE] Creating temp directory: ${tempDir}`);
                fs.mkdirSync(tempDir, { recursive: true, mode: 0o755 });
            }
            
            // Test write permissions
            const testFile = path.join(tempDir, '.test_write');
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
            console.log(`[PDF_INVOICE] Temp directory is writable`);
        } catch (dirError) {
            console.error(`[PDF_INVOICE_ERROR] Cannot create/write to temp directory: ${tempDir}`, dirError);
            
            // Fallback to system temp directory
            const osTempDir = require('os').tmpdir();
            const fallbackTempDir = path.join(osTempDir, 'raf-bot-invoices');
            console.log(`[PDF_INVOICE] Falling back to system temp: ${fallbackTempDir}`);
            
            if (!fs.existsSync(fallbackTempDir)) {
                fs.mkdirSync(fallbackTempDir, { recursive: true, mode: 0o755 });
            }
            
            // Use fallback directory
            const filename = `invoice_${invoiceData.invoiceNumber}_${Date.now()}.pdf`;
            const outputPath = path.join(fallbackTempDir, filename);
            
            // Generate PDF
            await generatePDFInvoice(invoiceData, outputPath, customization);
            
            return {
                path: outputPath,
                filename: filename,
                buffer: fs.readFileSync(outputPath)
            };
        }
        
        // Generate filename
        const filename = `invoice_${invoiceData.invoiceNumber}_${Date.now()}.pdf`;
        const outputPath = path.join(tempDir, filename);
        
        console.log(`[PDF_INVOICE] Generating PDF at: ${outputPath}`);
        
        // Generate PDF
        await generatePDFInvoice(invoiceData, outputPath, customization);
        
        // Verify file was created
        if (!fs.existsSync(outputPath)) {
            throw new Error(`PDF file was not created at ${outputPath}`);
        }
        
        const fileStats = fs.statSync(outputPath);
        console.log(`[PDF_INVOICE] PDF created successfully: ${filename} (${fileStats.size} bytes)`);
        
        return {
            path: outputPath,
            filename: filename,
            buffer: fs.readFileSync(outputPath)
        };
        
    } catch (error) {
        console.error('[CREATE_INVOICE_PDF_ERROR]', error);
        throw error;
    }
}

/**
 * Clean up old PDF files (older than 24 hours)
 */
function cleanupOldPDFs() {
    try {
        // Check both possible temp directories
        const tempDirs = [
            path.resolve(path.join(__dirname, '..', 'temp')),
            path.join(require('os').tmpdir(), 'raf-bot-invoices')
        ];
        
        tempDirs.forEach(tempDir => {
            if (!fs.existsSync(tempDir)) return;
            
            try {
                const files = fs.readdirSync(tempDir);
                const now = Date.now();
                const maxAge = 24 * 60 * 60 * 1000; // 24 hours
                
                files.forEach(file => {
                    if (file.startsWith('invoice_') && file.endsWith('.pdf')) {
                        const filePath = path.join(tempDir, file);
                        try {
                            const stats = fs.statSync(filePath);
                            
                            if (now - stats.mtime.getTime() > maxAge) {
                                fs.unlinkSync(filePath);
                                console.log(`[PDF_CLEANUP] Deleted old PDF: ${file} from ${tempDir}`);
                            }
                        } catch (fileError) {
                            console.error(`[PDF_CLEANUP_ERROR] Cannot access file ${file}:`, fileError.message);
                        }
                    }
                });
            } catch (dirError) {
                console.error(`[PDF_CLEANUP_ERROR] Cannot read directory ${tempDir}:`, dirError.message);
            }
        });
        
    } catch (error) {
        console.error('[PDF_CLEANUP_ERROR]', error);
    }
}

// Alternative PDF generation using html-pdf
async function generatePDFAlternative(invoiceData, outputPath = null, customization = {}) {
    try {
        const pdf = require('html-pdf');
        const htmlContent = generateInvoiceHTML(invoiceData, customization);
        
        const options = {
            format: 'A4',
            border: {
                top: '20px',
                right: '20px',
                bottom: '20px',
                left: '20px'
            },
            timeout: 30000,
            renderDelay: 2000
        };
        
        return new Promise((resolve, _reject) => {
            pdf.create(htmlContent, options).toBuffer((err, buffer) => {
                if (err) {
                    console.error('[PDF_ALTERNATIVE_ERROR]', err);
                    // If html-pdf also fails, generate simple fallback
                    resolve(generateSimplePDFFallback(invoiceData, customization));
                } else {
                    console.log(`[PDF_ALTERNATIVE] Generated PDF using html-pdf for invoice ${invoiceData.invoiceNumber}`);
                    if (outputPath) {
                        fs.writeFileSync(outputPath, buffer);
                    }
                    resolve(buffer);
                }
            });
        });
    } catch (error) {
        console.error('[PDF_ALTERNATIVE_ERROR] html-pdf not available:', error.message);
        // Final fallback - generate simple PDF
        return generateSimplePDFFallback(invoiceData, customization);
    }
}

// Simple fallback PDF generation - return HTML as buffer for now
function generateSimplePDFFallback(invoiceData, customization = {}) {
    try {
        console.log('[PDF_FALLBACK] Generating HTML buffer as fallback for invoice', invoiceData.invoiceNumber);
        
        // Generate HTML content
        const htmlContent = generateInvoiceHTML(invoiceData, customization);
        
        // Convert HTML to buffer
        const buffer = Buffer.from(htmlContent, 'utf8');
        
        // Try to save HTML file as fallback
        try {
            // Try project temp first, then system temp
            let tempPath = path.resolve(path.join(__dirname, '..', 'temp'));
            if (!fs.existsSync(tempPath) || !fs.statSync(tempPath).isDirectory()) {
                tempPath = path.join(require('os').tmpdir(), 'raf-bot-invoices');
                if (!fs.existsSync(tempPath)) {
                    fs.mkdirSync(tempPath, { recursive: true, mode: 0o755 });
                }
            }
            
            const htmlPath = path.join(tempPath, `invoice_${invoiceData.invoiceNumber}_${Date.now()}.html`);
            fs.writeFileSync(htmlPath, htmlContent);
            
            console.log(`[PDF_FALLBACK] Saved HTML invoice to ${htmlPath}`);
        } catch (saveError) {
            console.error('[PDF_FALLBACK] Could not save HTML file:', saveError.message);
        }
        
        // Return the HTML content as buffer
        // This will at least allow the invoice to be sent, even if not as PDF
        return buffer;
    } catch (error) {
        console.error('[PDF_FALLBACK_ERROR]', error);
        // Return a simple text representation as last resort
        const textContent = `
INVOICE ${invoiceData.invoiceNumber}
=====================================
${invoiceData.company.name}
${invoiceData.company.address}
Tel: ${invoiceData.company.phone}
Email: ${invoiceData.company.email}

TAGIHAN KEPADA:
${invoiceData.customer.name}
${invoiceData.customer.address}

DETAIL LAYANAN:
Paket: ${invoiceData.service.name}
Periode: ${invoiceData.service.period}

RINCIAN BIAYA:
Subtotal: Rp ${invoiceData.billing.subtotal}
PPN: Rp ${invoiceData.billing.tax}
TOTAL: Rp ${invoiceData.billing.total}

STATUS: LUNAS
Tanggal Bayar: ${formatInvoiceDate(invoiceData.payment?.paidDate)}
Metode: ${invoiceData.payment.method}

Terima kasih atas kepercayaan Anda.
        `;
        return Buffer.from(textContent, 'utf8');
    }
}

module.exports = {
    generateInvoiceHTML,
    generatePDFInvoice,
    createInvoicePDF,
    cleanupOldPDFs
};


