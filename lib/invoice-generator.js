/**
 * Header Doc
 * Purpose: Membuat RECORD invoice (penomoran, jatuh tempo, snapshot pelanggan/paket/rekening)
 *          dan menyimpannya ke `database/invoices.json`. Bukan pemilik TAMPILAN — render
 *          HTML/PDF ada di `lib/pdf-invoice-generator.js`.
 * Caller: `lib/approval-logic.js` (saat pembayaran disetujui) dan `routes/invoice.js`.
 * Deps: `fs`/`path`, `lib/json-store` (baca aman + karantina), `config.json`,
 *          `database/invoices.json`, `database/packages.json`.
 * MainFuncs: `createInvoice`, `saveInvoice`, `getInvoiceSettings`, `calculateInvoiceDueDate`,
 *          `generateInvoiceNumber`, `invoiceDateStr`, `nextSequence`,
 *          `convertPaymentMethodToIndonesian`, `generateInvoiceText`.
 * SideEffects: Menulis `database/invoices.json` secara ATOMIK (tmp+rename); membaca config &
 *          packages dari disk. Nomor invoice di-seed dari record tersimpan (unik lintas-restart).
 */
"use strict";

const fs = require('fs');
const path = require('path');
const { bersihkanPlaceholder } = require('./config-placeholder');
// Loader/penulis JSON terpusat: `loadJSON` MENGKARANTINA berkas rusak (bukan mendiamkan
// jadi []), jadi riwayat invoice tak terhapus senyap oleh penulisan berikutnya.
const { loadJSON } = require('./json-store');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const INVOICES_PATH = path.join(__dirname, '..', 'database', 'invoices.json');
const PACKAGES_PATH = path.join(__dirname, '..', 'database', 'packages.json');

let invoiceCounter = {
    date: null,
    count: 0
};

function getRuntimeConfig() {
    if (global.config && typeof global.config === 'object') {
        return global.config;
    }

    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (error) {
        console.error('[INVOICE_GENERATOR] Failed to load config:', error.message);
        return {
            invoice: {
                prefix: 'INV',
                enableTax: false,
                taxRate: 11,
                dueDays: 30,
                dueDateType: 'fixed',
                dueDateDay: 10,
                autoSend: true,
                sendPDF: true
            }
        };
    }
}

function getInvoiceSettings() {
    const config = getRuntimeConfig();
    const dueDateDayRaw = parseInt(config?.invoice?.dueDateDay ?? global.config?.tanggal_batas_bayar ?? 10, 10);
    const dueDateDay = Number.isFinite(dueDateDayRaw) ? dueDateDayRaw : 10;

    return {
        config,
        prefix: config?.invoice?.prefix || 'INV',
        enableTax: config?.invoice?.enableTax !== false,
        taxRate: config?.invoice?.taxRate || 11,
        dueDays: config?.invoice?.dueDays || 30,
        dueDateType: config?.invoice?.dueDateType || 'fixed',
        dueDateDay,
        autoSend: config?.invoice?.autoSend !== false,
        sendPDF: config?.invoice?.sendPDF !== false
    };
}

function clampToMonthDay(year, month, day) {
    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    return Math.min(Math.max(parseInt(day, 10) || 1, 1), lastDayOfMonth);
}

function calculateInvoiceDueDate(issueDateInput, invoiceSettings = getInvoiceSettings()) {
    const issueDate = issueDateInput instanceof Date ? new Date(issueDateInput) : new Date(issueDateInput || Date.now());
    const dueDateType = invoiceSettings?.dueDateType || 'fixed';

    if (dueDateType === 'fixed') {
        const year = issueDate.getFullYear();
        const month = issueDate.getMonth();
        const safeDay = clampToMonthDay(year, month, invoiceSettings?.dueDateDay || 10);
        return new Date(year, month, safeDay, issueDate.getHours(), issueDate.getMinutes(), issueDate.getSeconds(), issueDate.getMilliseconds());
    }

    const dueDays = invoiceSettings?.dueDays || 30;
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + dueDays);
    return dueDate;
}

function convertPaymentMethodToIndonesian(method) {
    if (!method) return 'Transfer Bank';

    const methodMap = {
        CASH: 'Tunai',
        TRANSFER_BANK: 'Transfer Bank',
        TRANSFER: 'Transfer Bank',
        'Tunai': 'Tunai',
        'Transfer Bank': 'Transfer Bank'
    };

    return methodMap[method] || method;
}

// Bagian tanggal pada nomor invoice HARUS WIB, sama dengan tanggal yang TERCETAK di
// tagihan (pdf-invoice-generator formatInvoiceDate memakai timeZone Asia/Jakarta).
// `toISOString()` SELALU UTC menurut spesifikasi, apa pun zona waktu proses — invoice yang
// dibuat 00:00-07:00 WIB akan memakai tanggal KEMARIN di nomornya. `en-CA` memberi
// bentuk YYYY-MM-DD; timeZone dipaksa eksplisit supaya benar walau TZ proses tak diset.
function invoiceDateStr(date) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date).replace(/-/g, '');
}

// Sequence berikutnya untuk prefix+tanggal ini, dihitung dari nomor yang SUDAH tersimpan.
// Fungsi murni supaya bisa diuji tanpa menyentuh disk.
function nextSequence(invoices, prefix, dateStr) {
    let maxSeq = 0;
    const head = `${prefix}-${dateStr}-`;
    for (const inv of (Array.isArray(invoices) ? invoices : [])) {
        const num = inv && typeof inv.invoiceNumber === 'string' ? inv.invoiceNumber : '';
        if (!num.startsWith(head)) continue;
        const seq = parseInt(num.slice(head.length), 10);
        if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
    }
    return maxSeq + 1;
}

function generateInvoiceNumber() {
    const config = getRuntimeConfig();
    const prefix = config?.invoice?.prefix || 'INV';
    const dateStr = invoiceDateStr(new Date());

    // Ganti hari ATAU proses baru (date === null) → SEED count dari nomor tersimpan, bukan 0.
    // `invoiceCounter` cuma hidup di memori dan prod restart 7-13x/hari; tanpa seed, invoice
    // pertama pasca-restart selalu `-0001` → nomor dobel (terbukti di data live). Dalam proses
    // yang sama, counter lanjut menaik supaya tak membaca disk tiap kali.
    if (invoiceCounter.date !== dateStr) {
        invoiceCounter.date = dateStr;
        let tersimpan = [];
        try {
            tersimpan = loadJSON('invoices.json');
        } catch (error) {
            console.error('[INVOICE_GENERATOR] Gagal menyeed nomor dari invoices.json:', error && error.message);
        }
        invoiceCounter.count = nextSequence(tersimpan, prefix, dateStr) - 1;
    }

    invoiceCounter.count++;
    return `${prefix}-${dateStr}-${String(invoiceCounter.count).padStart(4, '0')}`;
}

function shouldGenerateInvoice(user) {
    const invoiceSettings = getInvoiceSettings();
    if (!invoiceSettings.autoSend) {
        return false;
    }

    if (!user) return false;
    return user.send_invoice === true || user.send_invoice === 1;
}

function loadPackages() {
    if (Array.isArray(global.packages)) {
        return global.packages;
    }

    try {
        if (fs.existsSync(PACKAGES_PATH)) {
            return JSON.parse(fs.readFileSync(PACKAGES_PATH, 'utf8'));
        }
    } catch (error) {
        console.warn('[INVOICE] Could not load packages database:', error.message);
    }

    return [];
}

function getPackagePrice(subscription) {
    if (!subscription) return 0;

    const packages = loadPackages();
    const userPackage = packages.find((pkg) => pkg.name === subscription);
    if (userPackage && userPackage.price) {
        return parseInt(userPackage.price, 10);
    }

    console.warn(`[INVOICE] Package "${subscription}" not found in database, trying to extract from name`);

    const kPattern = String(subscription).match(/(\d+)\s*[Kk]/i);
    if (kPattern) {
        return parseInt(kPattern[1], 10) * 1000;
    }

    const cleanedSub = String(subscription).replace(/\./g, '');
    const fullPattern = cleanedSub.match(/(\d{5,6})/);
    if (fullPattern) {
        return parseInt(fullPattern[1], 10);
    }

    return 0;
}

function generateInvoiceData(user, paymentData = {}) {
    const invoiceSettings = getInvoiceSettings();
    const config = invoiceSettings.config;
    const invoiceNumber = generateInvoiceNumber();
    const issueDate = paymentData.issueDate ? new Date(paymentData.issueDate) : new Date();
    const dueDate = calculateInvoiceDueDate(issueDate, invoiceSettings);

    const packages = loadPackages();
    const userPackage = packages.find((pkg) => pkg.name === user.subscription);
    const packagePrice = userPackage?.price ? parseInt(userPackage.price, 10) : getPackagePrice(user.subscription);
    const speed = userPackage?.profile || 'Sesuai Paket';

    const enableTax = invoiceSettings.enableTax;
    const taxRate = enableTax ? invoiceSettings.taxRate : 0;
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
            speed
        },
        billing: {
            subtotal: packagePrice,
            tax,
            taxRate,
            enableTax,
            total,
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
        // DUA gudang rekening di-snapshot sekaligus. `bankAccount` (tunggal) punya form
        // sendiri di /invoice-settings dan hampir tak pernah diisi; `bankAccounts` (jamak)
        // adalah yang benar-benar diisi admin lewat /config dan dipakai bot WhatsApp.
        // Renderer memilih yang terisi lewat lib/invoice-payment-methods.js.
        //
        // Bawaan karangan lama ('Bank Default' / '1234567890') SENGAJA DIHAPUS: ia tak
        // pernah aktif karena config.bankAccount selalu ADA (berisi string kosong), dan
        // seandainya aktif ia akan mencetak nomor rekening palsu ke tagihan pelanggan.
        bankAccount: config?.bankAccount || {},
        bankAccounts: config?.bankAccounts || [],
        notes: paymentData.notes || 'Terima kasih atas pembayaran Anda.',
        createdAt: issueDate.toISOString()
    };
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(amount);
}

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

    if (customTemplate) {
        const templateVars = {
            invoiceNumber: invoiceData.invoiceNumber,
            issueDate,
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
            paidDate,
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

    return `
?? *INVOICE PEMBAYARAN*
??????????????????????????

?? *Detail Invoice:*
� No. Invoice: ${invoiceData.invoiceNumber}
� Tanggal: ${issueDate}
� Status: ? LUNAS

?? *Pelanggan:*
� Nama: ${invoiceData.customer.name}
� ID: ${invoiceData.customer.id}
� Telepon: ${invoiceData.customer.phone}
� Alamat: ${invoiceData.customer.address}

?? *Layanan:*
� Paket: ${invoiceData.service.name}
� Periode: ${invoiceData.service.period}
� Deskripsi: ${invoiceData.service.description}

?? *Rincian Biaya:*
� Subtotal: ${formatCurrency(invoiceData.billing.subtotal)}${invoiceData.billing.enableTax ? `
� PPN (${invoiceData.billing.taxRate}%): ${formatCurrency(invoiceData.billing.tax)}` : ''}
� *Total: ${formatCurrency(invoiceData.billing.total)}*

?? *Pembayaran:*
� Tanggal Bayar: ${paidDate}
� Metode: ${invoiceData.payment.method}
� Disetujui oleh: ${invoiceData.payment.approvedBy}

?? *${invoiceData.company.name}*
${invoiceData.company.address}
?? ${invoiceData.company.phone}
?? ${invoiceData.company.email}
?? NPWP: ${invoiceData.company.npwp}

??????????????????????????
${invoiceData.notes}

_Invoice ini dibuat secara otomatis oleh sistem._
`.trim();
}

function saveInvoice(invoiceData) {
    // BACA lewat json-store: bila invoices.json rusak/terpotong, ia DIKARANTINA (.rusak-<ts>)
    // alih-alih didiamkan jadi []. Bentuk lama menyetel `invoices = []` pada parse gagal lalu
    // menimpa seluruh riwayat dengan HANYA record baru — kehilangan permanen & senyap dokumen
    // akuntansi. Prod restart 7-13x/hari bisa memotong file di tengah tulis: persis rantai
    // 'rusak → [] → tertimpa' yang json-store lindungi khusus untuk ledger seperti ini.
    let invoices;
    try {
        invoices = loadJSON('invoices.json');
        if (!Array.isArray(invoices)) invoices = [];
    } catch (error) {
        // loadJSON tak melempar; ini jaring pengaman. JANGAN lanjut menimpa bila baca gagal.
        console.error('[INVOICE_SAVE_ERROR] Gagal memuat invoices.json — penyimpanan dibatalkan agar tak menimpa:', error && error.message);
        return false;
    }

    invoices.push(invoiceData);

    // TULIS ATOMIK: tmp di direktori yang SAMA lalu rename (rename intra-fs bersifat atomik),
    // jadi proses yang mati di tengah tulis tak pernah meninggalkan invoices.json terpotong.
    const tmpPath = `${INVOICES_PATH}.tmp-${process.pid}`;
    try {
        fs.writeFileSync(tmpPath, JSON.stringify(invoices, null, 2), 'utf8');
        fs.renameSync(tmpPath, INVOICES_PATH);
        console.log(`[INVOICE_SAVED] Invoice ${invoiceData.invoiceNumber} saved successfully`);
        return true;
    } catch (error) {
        console.error('[INVOICE_SAVE_ERROR] Error saving invoice:', error);
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_e) { /* abaikan sisa tmp */ }
        return false;
    }
}

function createInvoice(user, paymentData = {}) {
    try {
        if (!shouldGenerateInvoice(user)) {
            console.log(`[INVOICE_SKIP] User ${user.id} does not have send_invoice enabled`);
            return null;
        }

        const invoiceData = generateInvoiceData(user, paymentData);
        const saved = saveInvoice(invoiceData);

        if (saved) {
            console.log(`[INVOICE_CREATED] Invoice ${invoiceData.invoiceNumber} created for user ${user.id}`);
            return invoiceData;
        }

        console.error(`[INVOICE_ERROR] Failed to save invoice for user ${user.id}`);
        return null;
    } catch (error) {
        console.error('[INVOICE_CREATE_ERROR] Error creating invoice:', error);
        return null;
    }
}

function getUserInvoices(userId) {
    if (!fs.existsSync(INVOICES_PATH)) {
        return [];
    }

    try {
        const invoices = JSON.parse(fs.readFileSync(INVOICES_PATH, 'utf8'));
        return invoices.filter((invoice) => invoice.customer.id === userId);
    } catch (error) {
        console.error('[INVOICE_GET_ERROR] Error reading invoices:', error);
        return [];
    }
}

/**
 * SATU perakit `customization` untuk SEMUA jalur render invoice.
 *
 * KENAPA: objek ini dulu dirakit terpisah di empat tempat (/api/view-invoice,
 * /api/download-invoice-pdf, /api/preview-pdf-invoice, dan kirim otomatis di
 * lib/approval-logic.js). Setiap salinan memilih sendiri kunci mana yang disalin, jadi
 * menambah satu setelan berarti mengingat empat berkas — dan yang terjadi persis itu:
 * /api/preview-pdf-invoice tak pernah menyalin `paymentMethods`, `showNotes`,
 * `showCustomerPhone`, maupun `showServiceSpeed`, sehingga PRATINJAU tak pernah bisa
 * menampilkan pilihan admin dan membuat setelan yang sehat terlihat rusak.
 *
 * `timpaan` dipakai halaman pengaturan untuk melihat setelan yang BELUM disimpan.
 */
function buatCustomizationInvoice(config, timpaan) {
    const p = (config && config.pdfCustomization) || {};
    const t = timpaan || {};
    const ambil = (kunci, bawaan) => (t[kunci] !== undefined ? t[kunci] : (p[kunci] !== undefined ? p[kunci] : bawaan));
    // Setelan boolean bisa datang sebagai string 'true'/'false' dari form HTML.
    const ambilBool = (kunci, bawaan) => {
        const v = ambil(kunci, undefined);
        if (v === undefined) return bawaan;
        if (typeof v === 'boolean') return v;
        return String(v) !== 'false';
    };

    return {
        theme: ambil('theme', 'blue') || 'blue',
        // logoUrl MENDAHULUI logo yang diunggah di generator. Bila nilainya masih teks
        // contekan (`ISI_LOGOURL`, terukur di config Dander), meneruskannya berarti
        // merender <img src="ISI_LOGOURL"> dan MEMATIKAN logo perusahaan yang sudah benar.
        // Salinan lama tak pernah menyalin logoUrl sama sekali, jadi cacat ini baru
        // terlihat begitu perakitan disatukan — dibersihkan di sini, di satu tempat.
        logoUrl: bersihkanPlaceholder(ambil('logoUrl', ''), ''),
        headerText: ambil('headerText', 'INVOICE'),
        footerText: ambil('footerText', 'Terima kasih atas kepercayaan Anda.'),
        billingTitle: ambil('billingTitle', 'TAGIHAN KEPADA:'),
        serviceTitle: ambil('serviceTitle', 'DETAIL LAYANAN:'),
        showCustomerID: ambilBool('showCustomerID', true),
        showCustomerPhone: ambilBool('showCustomerPhone', true),
        showServiceSpeed: ambilBool('showServiceSpeed', true),
        showServiceDescription: ambilBool('showServiceDescription', true),
        showNPWP: ambilBool('showNPWP', true),
        showDueDate: ambilBool('showDueDate', true),
        // Blok "Metode Pembayaran yang Diterima" (+ nomor rekening). BAWAANNYA MATI:
        // invoice di sistem ini SELALU dokumen LUNAS — `createInvoice` menetapkan
        // `payment.status = 'PAID'` tanpa syarat dan kedua pemanggilnya baru jalan
        // SESUDAH uang diterima (lib/approval-logic.js saat pembayaran disetujui,
        // routes/invoice.js /send-invoice-manual). Terukur: 35 dari 35 record produksi
        // berstatus PAID. Mendaftarkan cara membayar beserta nomor rekening di dokumen
        // yang barusan menyatakan "Status: LUNAS ... Metode: X" hanya membingungkan —
        // itu milik halaman TAGIHAN, bukan bukti bayar. Tetap bisa dinyalakan dari
        // halaman Pengaturan Invoice bagi yang memakai invoice sebagai tagihan.
        showPaymentMethods: ambilBool('showPaymentMethods', false),
        paymentMethods: ambil('paymentMethods', 'cash_transfer') || 'cash_transfer',
        showNotes: ambilBool('showNotes', true),
        additionalNotes: ambil('additionalNotes', '')
    };
}

/**
 * Melengkapi record invoice LAMA dengan `bankAccounts` dari config.
 *
 * Record yang dibuat sebelum perbaikan ini hanya menyimpan `bankAccount` (tunggal) —
 * yang di produksi kosong (Tanjungharjo) atau berisi teks contekan `ISI_BANKNAME`
 * (Dander). Tanpa pelengkapan ini, mencetak ulang tagihan lama tetap menghasilkan
 * "Transfer Bank" tanpa nomor rekening. Record tidak ditulis ulang ke disk —
 * pelengkapan hanya berlaku untuk render kali ini.
 */
function lengkapiRekeningRecord(invoice, config) {
    if (!invoice || typeof invoice !== 'object') return invoice;
    if (invoice.bankAccounts !== undefined) return invoice;
    return { ...invoice, bankAccounts: (config && config.bankAccounts) || [] };
}

module.exports = {
    buatCustomizationInvoice,
    lengkapiRekeningRecord,
    generateInvoiceNumber,
    invoiceDateStr,
    nextSequence,
    shouldGenerateInvoice,
    getPackagePrice,
    getInvoiceSettings,
    clampToMonthDay,
    calculateInvoiceDueDate,
    generateInvoiceData,
    generateInvoiceText,
    createInvoice,
    saveInvoice,
    getUserInvoices,
    formatCurrency,
    convertPaymentMethodToIndonesian
};
