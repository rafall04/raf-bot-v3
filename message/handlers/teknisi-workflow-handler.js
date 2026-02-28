/**
 * Teknisi Workflow Handler
 * Handles complete teknisi workflow as requested:
 * 1. Proses ticket (generate OTP)
 * 2. OTW (on the way) with location sharing
 * 3. Sampai (arrived) - request OTP
 * 4. Complete with photos (min 2)
 */

const fs = require('fs');
const path = require('path');
const { normalizePhone, deduplicatePhones, isSameRecipient } = require('../../lib/notification-tracker');
const { getUserState, setUserState, deleteUserState } = require('./conversation-handler');
const { generateOTP } = require('../../lib/otp-generator');
const { notifyTechnicians } = require('./customer-photo-handler');
const { clearUploadQueue } = require('./teknisi-photo-handler-v3');

/**
 * Send notification to customer without duplicates
 * Handles both @lid and regular phone formats
 */
async function sendCustomerNotification(ticket, message) {
    const sentNumbers = new Set(); // Track sent numbers to avoid duplicates
    const customerJid = ticket.pelangganId;
    
    // First: Send to main customer (yang lapor)
    // PENTING: Cek connection state dan gunakan error handling sesuai rules
    if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
        try {
            await global.raf.sendMessage(customerJid, { text: message });
            console.log(`[CUSTOMER_NOTIF] Sent to main customer: ${customerJid}`);
            
            // Track the actual phone number that received the message
            if (customerJid.endsWith('@lid')) {
                // For @lid, track the first phone number as main
                if (ticket.pelangganPhone) {
                    const phones = ticket.pelangganPhone.split('|').map(p => p.trim()).filter(p => p);
                    if (phones.length > 0) {
                        const mainPhone = phones[0].replace(/\D/g, '');
                        sentNumbers.add(mainPhone);
                        console.log(`[CUSTOMER_NOTIF] Tracking main phone: ${mainPhone} (via @lid)`);
                    }
                }
            } else {
                // For regular format, extract the number
                const mainPhone = customerJid.replace(/\D/g, '');
                sentNumbers.add(mainPhone);
            }
        } catch (err) {
            console.error('[SEND_MESSAGE_ERROR]', {
                customerJid,
                error: err.message
            });
            console.error('[CUSTOMER_NOTIF] Failed to notify main customer:', err);
        }
    } else {
        console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to', customerJid);
    }
    
    // Second: Send to additional phone numbers (skip if already sent)
    if (ticket.pelangganPhone) {
        const phones = ticket.pelangganPhone.split('|').map(p => p.trim()).filter(p => p);
        console.log(`[CUSTOMER_NOTIF] Processing ${phones.length} phone numbers: ${phones.join(', ')}`);
        
        for (const phone of phones) {
            const phoneNumber = phone.replace(/\D/g, '');
            
            // Skip if already sent
            if (sentNumbers.has(phoneNumber)) {
                console.log(`[CUSTOMER_NOTIF] Skipping ${phone} (already sent)`);
                continue;
            }
            
            // Convert to JID format
            let phoneJid = phone;
            if (!phoneJid.endsWith('@s.whatsapp.net')) {
                if (phoneJid.startsWith('0')) {
                    phoneJid = `62${phoneJid.substring(1)}@s.whatsapp.net`;
                } else if (phoneJid.startsWith('62')) {
                    phoneJid = `${phoneJid}@s.whatsapp.net`;
                } else {
                    phoneJid = `62${phoneJid}@s.whatsapp.net`;
                }
            }
            
            // PENTING: Cek connection state dan gunakan error handling sesuai rules untuk multiple recipients
            if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
                try {
                    await global.raf.sendMessage(phoneJid, { text: message });
                    console.log(`[CUSTOMER_NOTIF] Sent to additional number: ${phoneJid}`);
                    sentNumbers.add(phoneNumber);
                } catch (err) {
                    console.error('[SEND_MESSAGE_ERROR]', {
                        phoneJid,
                        error: err.message
                    });
                    console.error(`[CUSTOMER_NOTIF] Failed to notify ${phoneJid}:`, err);
                    // Continue to next recipient
                }
            } else {
                console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to', phoneJid);
            }
        }
    }
}

// generateOTP is imported from ../../lib/otp-generator

/**
 * Handle "proses" command - teknisi takes ticket
 */
async function handleProsesTicket(sender, ticketId, reply, canonicalId) {
    try {
        // Find ticket
        const ticket = global.reports.find(r => r.ticketId === ticketId.toUpperCase());
        
        if (!ticket) {
            return {
                success: false,
                message: `❌ Tiket *${ticketId}* tidak ditemukan.`
            };
        }
        
        if (ticket.status === 'process') {
            return {
                success: false,
                message: `⚠️ Tiket *${ticketId}* sudah diproses oleh teknisi lain.`
            };
        }
        
        if (ticket.status === 'completed' || ticket.status === 'selesai') {
            return {
                success: false,
                message: `✅ Tiket *${ticketId}* sudah selesai.`
            };
        }
        
        // Get teknisi info - handle phone number format
        const senderNumber = sender.replace('@s.whatsapp.net', '');
        
        // Remove 62 prefix if exists to match database format
        let phoneToMatch = senderNumber;
        if (senderNumber.startsWith('62')) {
            phoneToMatch = senderNumber.substring(2);
        }
        
        // Find teknisi by matching phone number (with or without 62)
        const teknisi = global.accounts.find(acc => {
            if (acc.role !== 'teknisi') return false;
            
            // Match either with or without 62 prefix
            return acc.phone_number === phoneToMatch || 
                   acc.phone_number === senderNumber ||
                   `62${acc.phone_number}` === senderNumber;
        });
        
        if (!teknisi) {
            console.error(`[TEKNISI_NOT_FOUND] Sender: ${senderNumber}, phoneToMatch: ${phoneToMatch}`);
            console.error(`[TEKNISI_NOT_FOUND] Available teknisi:`, global.accounts.filter(a => a.role === 'teknisi').map(a => a.phone_number));
            return {
                success: false,
                message: '❌ Anda tidak terdaftar sebagai teknisi.'
            };
        }
        
        console.log(`[TEKNISI_FOUND] Name: ${teknisi.name || teknisi.username}, Phone: ${teknisi.phone_number}`);
        
        // Generate OTP
        const otp = generateOTP();
        
        // Update ticket - set all possible field names for compatibility
        ticket.status = 'process';
        ticket.teknisiId = sender;
        ticket.processedByTeknisiId = sender;  // For old workflow compatibility
        ticket.processedByTeknisi = sender;     // For general-steps compatibility
        ticket.teknisiName = teknisi.name || teknisi.username;  // Use name field first
        ticket.processedByTeknisiName = teknisi.name || teknisi.username;  // For old workflow
        ticket.otp = otp;
        ticket.processedAt = new Date().toISOString();
        
        // Save to file
        const reportsPath = path.join(__dirname, '../../database/reports.json');
        fs.writeFileSync(reportsPath, JSON.stringify(global.reports, null, 2));
        
        // Get teknisi phone number for customer contact
        const teknisiPhone = (() => {
            const senderNum = sender.replace('@s.whatsapp.net', '');
            if (senderNum.startsWith('62')) {
                return senderNum;
            } else if (senderNum.startsWith('0')) {
                return '62' + senderNum.substring(1);
            } else {
                return '62' + senderNum;
            }
        })();
        
        // Notify customer with OTP - Send to ALL registered numbers
        const customerJid = ticket.pelangganId;
        const customerMessage = `✅ *TIKET DIPROSES*

━━━━━━━━━━━━━━━━
📋 ID Tiket: *${ticketId}*
🔧 Teknisi: *${teknisi.name || teknisi.username}*
📱 Kontak: wa.me/${teknisiPhone}
━━━━━━━━━━━━━━━━

🔐 *KODE OTP: ${otp}*

⚠️ *PENTING:*
• Simpan kode OTP ini
• Berikan ke teknisi saat tiba
• Jangan berikan ke orang lain
• Kode hanya untuk tiket ini

Teknisi akan segera menuju lokasi Anda.

_Estimasi kedatangan akan diinformasikan._`;

        // Send OTP notification without duplicates
        await sendCustomerNotification(ticket, customerMessage);
        
        return {
            success: true,
            message: `✅ *TIKET BERHASIL DIPROSES*

━━━━━━━━━━━━━━━━
📋 ID: *${ticketId}*
👤 Pelanggan: ${ticket.pelangganName}
📱 No: ${ticket.pelangganPhone}
📍 Alamat: ${ticket.pelangganAddress || 'Tidak ada'}
━━━━━━━━━━━━━━━━

✅ OTP telah dikirim ke pelanggan
🔐 *Minta OTP saat tiba di lokasi*

📌 *STEP SELANJUTNYA:*
➡️ Ketik: *otw ${ticketId}*
   Untuk update status mulai perjalanan

💡 *Opsional:* Share live location setelah ketik otw`
        };
        
    } catch (error) {
        console.error('[PROSES_TICKET_ERROR]', error);
        return {
            success: false,
            message: '❌ Gagal memproses tiket. Silakan coba lagi.'
        };
    }
}

/**
 * Handle "otw" command - teknisi on the way
 */
async function handleOTW(sender, ticketId, locationUrl, reply, canonicalId) {
    try {
        // Find ticket
        const ticket = global.reports.find(r => r.ticketId === ticketId.toUpperCase());
        
        if (!ticket) {
            return {
                success: false,
                message: `❌ Tiket *${ticketId}* tidak ditemukan.`
            };
        }
        
        // Verify teknisi - check all possible field names (support old and new workflows)
        const assignedTeknisi = ticket.teknisiId || ticket.processedByTeknisiId || ticket.processedByTeknisi;
        if (assignedTeknisi && assignedTeknisi !== sender) {
            return {
                success: false,
                message: `❌ Anda bukan teknisi yang menangani tiket ini.`
            };
        }
        
        // Check status - support both new and old status values
        const validStatuses = ['process', 'diproses teknisi'];
        if (!validStatuses.includes(ticket.status)) {
            return {
                success: false,
                message: `⚠️ Status tiket tidak sesuai. Proses tiket dulu.`
            };
        }
        
        // Get existing state to preserve OTP data
        const existingState = getUserState(sender);
        
        // Set state untuk menunggu lokasi while preserving OTP data (SAMA DENGAN mulai perjalanan)
        setUserState(sender, {
            step: 'AWAITING_LOCATION_FOR_JOURNEY',
            ticketId: ticketId.toUpperCase(),
            reportData: ticket,
            // Preserve OTP data if exists
            otp: existingState?.otp || ticket.otp,
            otpCreatedAt: existingState?.otpCreatedAt,
            isProcessing: true // Mark that this ticket is being processed
        });
        
        // Update ticket
        ticket.status = 'otw';
        ticket.otwAt = new Date().toISOString();
        
        // Make sure teknisi fields are set if not already (for old workflows)
        if (!ticket.teknisiId) ticket.teknisiId = sender;
        if (!ticket.processedByTeknisiId) ticket.processedByTeknisiId = sender;
        if (!ticket.processedByTeknisi) ticket.processedByTeknisi = sender;
        
        // Save to file
        const reportsPath = path.join(__dirname, '../../database/reports.json');
        fs.writeFileSync(reportsPath, JSON.stringify(global.reports, null, 2));
        
        // Get teknisi phone for customer contact
        const teknisiPhone = (() => {
            const senderNum = sender.replace('@s.whatsapp.net', '');
            if (senderNum.startsWith('62')) {
                return senderNum;
            } else if (senderNum.startsWith('0')) {
                return '62' + senderNum.substring(1);
            } else {
                return '62' + senderNum;
            }
        })();
        
        // Notify customer with SAME MESSAGE as mulai perjalanan
        const customerMessage = `🚗 *TEKNISI BERANGKAT*

━━━━━━━━━━━━━━━━
📋 ID Tiket: *${ticketId.toUpperCase()}*
🔧 Teknisi: *${ticket.teknisiName || ticket.processedByTeknisiName || 'Teknisi'}*
📱 Kontak: wa.me/${teknisiPhone}
━━━━━━━━━━━━━━━━

Teknisi sedang menuju lokasi Anda.

⏱️ *Estimasi Tiba:* 30-60 menit
_Waktu dapat berubah tergantung kondisi_

📍 Cek posisi teknisi:
Ketik: *lokasi ${ticketId.toUpperCase()}*

🔐 *KODE VERIFIKASI:*
╔════════════════╗
║  *${ticket.otp}*  ║
╚════════════════╝

Berikan kode ini saat teknisi tiba.`;
        
        // Send OTW notification without duplicates using consistent helper
        await sendCustomerNotification(ticket, customerMessage);
        
        return {
            success: true,
            message: `🚗 *MULAI PERJALANAN*
            
Tiket: *${ticketId.toUpperCase()}*
Pelanggan: ${ticket.pelangganName}

✅ Pelanggan telah diberitahu Anda berangkat.

📑 *WAJIB SHARE LOKASI:*

1️⃣ Klik icon 📎 (Attachment)
2️⃣ Pilih 📑 *Location*
3️⃣ Pilih *Share Live Location*
4️⃣ Pilih durasi *1 jam*
5️⃣ Kirim

💡 *PENTING:*
• Pelanggan dapat tracking posisi Anda
• Update otomatis setiap beberapa menit
• Saat tiba, ketik: *sampai ${ticketId.toUpperCase()}*`
        };
        
    } catch (error) {
        console.error('[OTW_ERROR]', error);
        return {
            success: false,
            message: '❌ Gagal update status OTW. Silakan coba lagi.'
        };
    }
}

/**
 * Handle "sampai" command - teknisi arrived
 */
async function handleSampaiLokasi(sender, ticketId, reply, canonicalId) {
    try {
        // Find ticket
        const ticket = global.reports.find(r => r.ticketId === ticketId.toUpperCase());
        
        if (!ticket) {
            return {
                success: false,
                message: `❌ Tiket *${ticketId}* tidak ditemukan.`
            };
        }
        
        // Verify teknisi - check all possible field names
        const assignedTeknisi = ticket.teknisiId || ticket.processedByTeknisiId || ticket.processedByTeknisi;
        if (assignedTeknisi && assignedTeknisi !== sender) {
            return {
                success: false,
                message: `❌ Anda bukan teknisi yang menangani tiket ini.`
            };
        }
        
        if (ticket.status !== 'otw' && ticket.status !== 'process' && ticket.status !== 'diproses teknisi') {
            return {
                success: false,
                message: `⚠️ Status tiket tidak sesuai.`
            };
        }
        
        // Debug: Check if OTP exists
        console.log(`[SAMPAI_DEBUG] Ticket OTP: ${ticket.otp}`);
        console.log(`[SAMPAI_DEBUG] Ticket pelangganPhone: ${ticket.pelangganPhone}`);
        
        // Ensure OTP exists
        if (!ticket.otp) {
            console.error('[SAMPAI_ERROR] OTP not found in ticket!');
            // Try to generate OTP if missing (fallback)
            ticket.otp = generateOTP();
            console.log(`[SAMPAI_RECOVERY] Generated new OTP: ${ticket.otp}`);
        }
        
        // Update ticket
        ticket.status = 'arrived';
        ticket.arrivedAt = new Date().toISOString();
        
        // Save to file
        const reportsPath = path.join(__dirname, '../../database/reports.json');
        fs.writeFileSync(reportsPath, JSON.stringify(global.reports, null, 2));
        
        // Notify customer (same pattern as OTW notification)
        const customerJid = ticket.pelangganId;
        const teknisiName = ticket.teknisiName || ticket.processedByTeknisiName || 'Teknisi';
        
        // Get teknisi phone number for customer contact
        const teknisiPhone = (() => {
            const teknisiSender = sender.replace('@s.whatsapp.net', '');
            if (teknisiSender.startsWith('62')) {
                return teknisiSender; // Already in correct format
            } else if (teknisiSender.startsWith('0')) {
                return '62' + teknisiSender.substring(1);
            } else {
                return '62' + teknisiSender;
            }
        })();
        
        // Prepare OTP display with fallback
        const otpDisplay = ticket.otp || 'XXXXXX';
        
        const customerMessage = `🎉 *TEKNISI SUDAH TIBA*

━━━━━━━━━━━━━━━━
📋 ID Tiket: *${ticketId.toUpperCase()}*
🔧 Teknisi: *${teknisiName}*
📱 Kontak: wa.me/${teknisiPhone}
━━━━━━━━━━━━━━━━

✅ Teknisi sudah di lokasi Anda

🔐 *KODE VERIFIKASI:*
╔════════════════╗
║  *${otpDisplay}*  ║
╚════════════════╝

⚠️ *PENTING:*
• Berikan kode ini ke teknisi
• Untuk memverifikasi identitas
• Jangan berikan ke orang lain

_Perbaikan akan segera dimulai._`;

        // Send arrival notification without duplicates
        await sendCustomerNotification(ticket, customerMessage);
        
        return {
            success: true,
            message: `📍 *STATUS: SAMPAI DI LOKASI*

━━━━━━━━━━━━━━━━
📋 Tiket: *${ticketId}*
🕒 Tiba: ${new Date().toLocaleTimeString('id-ID')}
✅ Status: ARRIVED AT LOCATION
━━━━━━━━━━━━━━━━

✅ Customer telah dinotifikasi kedatangan Anda

📌 *STEP SELANJUTNYA:*
1️⃣ Temui pelanggan
2️⃣ Minta kode OTP (6 digit) 
3️⃣ Verifikasi OTP dengan ketik:

➡️ *verifikasi ${ticketId} [KODE_OTP]*

📝 Contoh: verifikasi ${ticketId} 567890`
        };
        
    } catch (error) {
        console.error('[SAMPAI_ERROR]', error);
        return {
            success: false,
            message: '❌ Gagal update status kedatangan. Silakan coba lagi.'
        };
    }
}

/**
 * Get category label for photo
 */
function getCategoryLabel(category) {
    const labels = {
        'problem': 'Titik Putus / Penyebab Masalah',
        'speedtest': 'Screenshot Speedtest',
        'result': 'Foto Hasil Redaman',
        'extra': 'Foto Tambahan'
    };
    return labels[category] || 'Foto Dokumentasi';
}

/**
 * Get next photo step based on current state
 */
function getNextPhotoStep(state) {
    const { problem, speedtest, result } = state.photoCategories;
    
    // Step 1: Problem photo (WAJIB)
    if (!problem) {
        return {
            step: 'AWAITING_PHOTO_CATEGORY_1',
            category: 'problem',
            message: `━━━━━━━━━━━━━━━━
🔴 *FOTO 1/3 - WAJIB*
━━━━━━━━━━━━━━━━

📌 *Apa yang difoto:*
• Titik putus kabel
• Penyebab masalah (konektor rusak, dll)
• Kondisi awal sebelum perbaikan

💡 *Tips:*
• Foto harus jelas dan fokus
• Tunjukkan dengan jelas masalahnya
• Ambil dari jarak yang cukup dekat

➡️ *Kirim foto pertama sekarang...*`
        };
    }
    
    // Step 2: Speedtest photo (WAJIB)
    if (!speedtest) {
        return {
            step: 'AWAITING_PHOTO_CATEGORY_2',
            category: 'speedtest',
            message: `✅ *Foto masalah diterima!*

━━━━━━━━━━━━━━━━
📊 *FOTO 2/3 - WAJIB*
━━━━━━━━━━━━━━━━

📌 *Apa yang difoto:*
• Screenshot hasil speedtest SETELAH perbaikan
• Atau foto layar speedtest dengan kamera
• Gunakan speedtest.net atau fast.com

💡 *Tips:*
• Pastikan angka kecepatan terlihat jelas
• Download dan Upload harus terlihat
• Tunjukkan tanggal/waktu jika memungkinkan

➡️ *Kirim foto speedtest sekarang...*`
        };
    }
    
    // Step 3: Result photo (OPSIONAL)
    if (!result) {
        return {
            step: 'AWAITING_PHOTO_CATEGORY_3',
            category: 'result',
            message: `✅ *Foto speedtest diterima!*

━━━━━━━━━━━━━━━━
✅ *FOTO 3/3 - OPSIONAL*
━━━━━━━━━━━━━━━━

📌 *Apa yang difoto (opsional):*
• Foto hasil redaman (jika punya alat ukur)
• Foto instalasi yang sudah rapi
• Foto perangkat yang sudah normal
• Foto kabel yang sudah diperbaiki

💡 *Bisa di-skip jika tidak ada:*

➡️ Kirim foto ATAU ketik *SKIP* untuk lewati`
        };
    }
    
    // All required photos done, ask for extra
    return {
        step: 'AWAITING_PHOTO_EXTRA_CONFIRM',
        category: 'extra',
        message: `✅ *FOTO WAJIB LENGKAP!*

━━━━━━━━━━━━━━━━
📎 *FOTO TAMBAHAN?*
━━━━━━━━━━━━━━━━

📸 Ingin tambah foto pendukung lainnya?
• Foto dari sudut berbeda
• Foto detail tertentu
• Foto dokumentasi lain

Ketik:
• *YA* - untuk upload foto tambahan
• *TIDAK* - untuk selesaikan tiket

➡️ *Pilihan Anda...*`
    };
}

/**
 * Handle OTP verification
 */
async function handleVerifikasiOTP(sender, ticketId, otp, reply, canonicalId) {
    try {
        // Find ticket
        const ticket = global.reports.find(r => r.ticketId === ticketId.toUpperCase());
        
        if (!ticket) {
            return {
                success: false,
                message: `❌ Tiket *${ticketId}* tidak ditemukan.`
            };
        }
        
        // Verify teknisi - check all possible field names
        const assignedTeknisi = ticket.teknisiId || ticket.processedByTeknisiId || ticket.processedByTeknisi;
        if (assignedTeknisi && assignedTeknisi !== sender) {
            return {
                success: false,
                message: `❌ Anda bukan teknisi yang menangani tiket ini.`
            };
        }
        
        // Check OTP
        if (ticket.otp !== otp) {
            return {
                success: false,
                message: `❌ Kode OTP salah! Minta kode yang benar ke pelanggan.`
            };
        }
        
        // Update ticket
        ticket.status = 'working';
        ticket.otpVerifiedAt = new Date().toISOString();
        ticket.workStartedAt = new Date().toISOString();
        
        // Save to file
        const reportsPath = path.join(__dirname, '../../database/reports.json');
        fs.writeFileSync(reportsPath, JSON.stringify(global.reports, null, 2));
        
        // Notify customer - Send to ALL registered numbers
        const customerJid = ticket.pelangganId;
        const customerMessage = `🔧 *PENGERJAAN DIMULAI*

━━━━━━━━━━━━━━━━
📋 ID Tiket: *${ticketId}*
🔧 Teknisi: *${ticket.teknisiName}*
━━━━━━━━━━━━━━━━

✅ Verifikasi OTP berhasil
🔧 Teknisi mulai melakukan perbaikan

_Anda akan diinformasikan saat selesai._`;

        // Send verification notification without duplicates
        await sendCustomerNotification(ticket, customerMessage);
        
        // Set state for guided photo upload with categorization
        if (!global.teknisiStates) {
            global.teknisiStates = {};
        }
        
        global.teknisiStates[canonicalId || sender] = {
            step: 'AWAITING_PHOTO_CATEGORY_1',  // Start with category 1
            ticketId: ticketId,
            currentPhotoCategory: 'problem',     // Current category being uploaded
            uploadedPhotos: [],                  // Array of photo objects with categories
            photoCategories: {                   // Track which categories are filled
                problem: null,      // Foto penyebab masalah (wajib)
                speedtest: null,    // Screenshot speedtest (wajib)
                result: null,       // Foto hasil redaman (opsional)
                extra: []           // Foto tambahan (opsional)
            },
            minPhotos: 2,                        // Minimum required photos
            guidedMode: true                     // Use guided step-by-step mode
        };
        
        return {
            success: true,
            message: `✅ *OTP TERVERIFIKASI - MULAI PERBAIKAN!*

━━━━━━━━━━━━━━━━
📋 Tiket: *${ticketId}*
✅ Lokasi Terverifikasi
🔧 Status: PERBAIKAN DIMULAI
━━━━━━━━━━━━━━━━

📸 *DOKUMENTASI STEP-BY-STEP:*

━━━━━━━━━━━━━━━━
🔴 *FOTO 1/3 - WAJIB*
━━━━━━━━━━━━━━━━

📌 *Apa yang difoto:*
• Titik putus kabel
• Penyebab masalah (konektor rusak, dll)
• Kondisi awal sebelum perbaikan

💡 *Tips:*
• Foto harus jelas dan fokus
• Tunjukkan dengan jelas masalahnya
• Ambil dari jarak yang cukup dekat

➡️ *Kirim foto pertama sekarang...*

⚠️ Semua foto akan dikirim ke pelanggan sebagai bukti`
        };
        
    } catch (error) {
        console.error('[VERIFIKASI_ERROR]', error);
        return {
            success: false,
            message: '❌ Gagal verifikasi OTP. Silakan coba lagi.'
        };
    }
}

/**
 * Handle completion with photos
 */
async function handleSelesaiTicket(sender, ticketId, reply, canonicalId) {
    try {
        // Check teknisi state
        const state = global.teknisiStates && global.teknisiStates[canonicalId || sender];
        
        if (!state || state.ticketId !== ticketId) {
            return {
                success: false,
                message: `❌ Verifikasi OTP dulu sebelum menyelesaikan tiket.`
            };
        }
        
        // Also check photo queue for accurate count
        const { getUploadQueue } = require('./teknisi-photo-handler-v3');
        const queue = getUploadQueue(canonicalId || sender);
        
        // Sync uploaded photos from queue if exists
        if (queue && queue.uploadedPhotos.length > 0) {
            state.uploadedPhotos = [...queue.uploadedPhotos];
        }
        
        // Check minimum photos
        if (!state.uploadedPhotos || state.uploadedPhotos.length < 2) {
            return {
                success: false,
                message: `❌ *FOTO KURANG!*

Anda harus upload minimal 2 foto:
• Foto hasil perbaikan
• Foto perangkat

Foto saat ini: ${state.uploadedPhotos ? state.uploadedPhotos.length : 0}/2

Silakan kirim foto dulu.`
            };
        }
        
        // Find ticket
        const ticket = global.reports.find(r => r.ticketId === ticketId.toUpperCase());
        
        if (!ticket) {
            return {
                success: false,
                message: `❌ Tiket *${ticketId}* tidak ditemukan.`
            };
        }
        
        // Update ticket - Standardisasi status ke 'completed'
        ticket.status = 'completed';
        ticket.completedAt = new Date().toISOString();
        ticket.teknisiPhotos = state.uploadedPhotos;
        ticket.teknisiPhotoCount = state.uploadedPhotos.length;
        
        // Calculate duration
        const start = new Date(ticket.workStartedAt);
        const end = new Date();
        const durationMinutes = Math.floor((end - start) / 1000 / 60);
        ticket.workDuration = durationMinutes;
        
        // Save to file
        const reportsPath = path.join(__dirname, '../../database/reports.json');
        fs.writeFileSync(reportsPath, JSON.stringify(global.reports, null, 2));
        
        // Clear teknisi state and photo queue
        delete global.teknisiStates[canonicalId || sender];
        
        // Clear photo upload queue
        const { clearUploadQueue } = require('./teknisi-photo-handler-v3');
        clearUploadQueue(canonicalId || sender);
        
        // Notify customer - Send to ALL registered numbers
        const customerJid = ticket.pelangganId;
        const customerMessage = `✅ *PERBAIKAN SELESAI*

━━━━━━━━━━━━━━━━
📋 ID Tiket: *${ticketId}*
🔧 Teknisi: *${ticket.teknisiName}*
⏱️ Durasi: ${durationMinutes} menit
━━━━━━━━━━━━━━━━

✅ Masalah telah diselesaikan
📸 Dokumentasi: ${ticket.teknisiPhotoCount} foto

*Terima kasih telah menunggu!*

Jika ada masalah lagi, silakan lapor kembali.

_Tiket telah ditutup._`;

        // Send completion notification without duplicates
        await sendCustomerNotification(ticket, customerMessage);
        
        return {
            success: true,
            message: `✅ *TIKET SELESAI*

━━━━━━━━━━━━━━━━
📋 Tiket: *${ticketId}*
⏱️ Durasi: ${durationMinutes} menit
📸 Foto: ${ticket.teknisiPhotoCount} dokumentasi
━━━━━━━━━━━━━━━━

✅ Pelanggan telah diinformasikan
✅ Tiket telah ditutup

Terima kasih atas kerja kerasnya! 💪`
        };
        
    } catch (error) {
        console.error('[SELESAI_ERROR]', error);
        return {
            success: false,
            message: '❌ Gagal menyelesaikan tiket. Silakan coba lagi.'
        };
    }
}

/**
 * Handle teknisi photo upload with categorization
 */
async function handleTeknisiPhotoUpload(sender, photoPath, canonicalId) {
    try {
        // Get teknisi state
        const state = global.teknisiStates && global.teknisiStates[canonicalId || sender];
        
        if (!state) {
            return {
                success: false,
                message: null // Not in photo upload state
            };
        }
        
        // Check if in guided mode with categories
        if (state.guidedMode && state.currentPhotoCategory) {
            // GUIDED MODE: Step-by-step with categories
            const currentCategory = state.currentPhotoCategory;
            
            // Check maximum photos
            if (state.uploadedPhotos.length >= 5) {
                return {
                    success: false,
                    message: '❌ Maksimal 5 foto sudah tercapai. Ketik *done* untuk lanjut.'
                };
            }
            
            // Create photo object with category metadata
            const photoObj = {
                filename: photoPath,
                category: currentCategory,
                categoryLabel: getCategoryLabel(currentCategory),
                uploadedAt: new Date().toISOString(),
                order: state.uploadedPhotos.length + 1
            };
            
            // Save to state
            if (!state.uploadedPhotos) {
                state.uploadedPhotos = [];
            }
            state.uploadedPhotos.push(photoObj);
            
            // Update category tracking
            if (currentCategory === 'extra') {
                state.photoCategories.extra.push(photoPath);
            } else {
                state.photoCategories[currentCategory] = photoPath;
            }
            
            console.log(`[PHOTO_UPLOAD] Category: ${currentCategory}, Total: ${state.uploadedPhotos.length}`);
            
            // Get next step
            const nextStep = getNextPhotoStep(state);
            
            if (nextStep) {
                // Update state for next photo
                state.step = nextStep.step;
                state.currentPhotoCategory = nextStep.category;
                
                return {
                    success: true,
                    message: nextStep.message
                };
            } else {
                // All photos done, ready to complete
                state.step = 'AWAITING_COMPLETION_CONFIRMATION';
                return {
                    success: true,
                    message: `✅ *SEMUA FOTO DOKUMENTASI LENGKAP!*

━━━━━━━━━━━━━━━━
📊 *RINGKASAN DOKUMENTASI:*
━━━━━━━━━━━━━━━━

✅ ${state.photoCategories.problem ? '1. Foto penyebab masalah' : ''}
✅ ${state.photoCategories.speedtest ? '2. Screenshot speedtest' : ''}
${state.photoCategories.result ? '✅ 3. Foto hasil perbaikan' : '⚪ 3. Foto hasil (di-skip)'}
${state.photoCategories.extra.length > 0 ? `✅ ${state.photoCategories.extra.length} foto tambahan` : ''}

━━━━━━━━━━━━━━━━
📌 *STEP TERAKHIR:*
━━━━━━━━━━━━━━━━

➡️ Ketik salah satu:
   • *done*
   • *lanjut*
   • *next*

Untuk melanjutkan input catatan perbaikan`
                };
            }
            
        } else {
            // LEGACY MODE: Backward compatibility for old flow
            if (state.step !== 'AWAITING_COMPLETION_PHOTOS') {
                return {
                    success: false,
                    message: null
                };
            }
            
            // Old flow without categories
            if (!state.uploadedPhotos) {
                state.uploadedPhotos = [];
            }
            
            // Save as simple string (legacy format)
            state.uploadedPhotos.push(photoPath);
            const photoCount = state.uploadedPhotos.length;
            
            if (photoCount < state.minPhotos) {
                return {
                    success: true,
                    message: `✅ Foto ${photoCount} berhasil diterima!

📌 *STATUS UPLOAD:*
• Foto terupload: ${photoCount}/2 (minimum)
• Status: Perlu ${2 - photoCount} foto lagi

➡️ Kirim foto ke-${photoCount + 1}`
                };
            } else {
                return {
                    success: true,
                    message: `✅ *${photoCount} FOTO DOKUMENTASI DITERIMA!*

📌 *STATUS:*
• Foto terupload: ${photoCount} ✅
• Minimum terpenuhi (2 foto)

➡️ Ketik *done* atau *lanjut* untuk melanjutkan`
                };
            }
        }
        
    } catch (error) {
        console.error('[TEKNISI_PHOTO_ERROR]', error);
        return {
            success: false,
            message: '❌ Gagal menyimpan foto. Coba lagi.'
        };
    }
}

/**
 * Complete ticket with resolution notes
 */
async function handleCompleteTicket(sender, state, reply, canonicalId) {
    try {
        const ticketId = state.ticketId;
        const reportIndex = global.reports.findIndex(r => r.ticketId === ticketId);
        
        if (reportIndex === -1) {
            return {
                success: false,
                message: '❌ Tiket tidak ditemukan!'
            };
        }
        
        const ticket = global.reports[reportIndex];
        
        // Update ticket with categorized photos
        ticket.status = 'completed';
        ticket.completedAt = new Date().toISOString();
        ticket.completedBy = sender;
        ticket.resolutionNotes = state.resolutionNotes;
        
        // Save photos with category metadata for better organization
        if (state.guidedMode && state.uploadedPhotos.length > 0) {
            // Save categorized photos with metadata
            ticket.completionPhotos = state.uploadedPhotos.map(photo => ({
                filename: photo.filename,
                category: photo.category,
                categoryLabel: photo.categoryLabel,
                uploadedAt: photo.uploadedAt,
                order: photo.order
            }));
        } else {
            // Legacy mode: Save as simple array
            ticket.completionPhotos = state.uploadedPhotos;
        }
        
        // Save to database
        const reportsPath = path.join(__dirname, '../../database/reports.json');
        fs.writeFileSync(reportsPath, JSON.stringify(global.reports, null, 2));
        
        // Notify customer
        const customerJid = ticket.pelangganId;
        const customerMessage = `✅ *PERBAIKAN SELESAI!*
━━━━━━━━━━━━━━━━

Halo ${ticket.pelangganName},

Tiket *${ticketId}* telah selesai diperbaiki.

📝 *Catatan Teknisi:*
${state.resolutionNotes}

━━━━━━━━━━━━━━━━
Terima kasih atas kesabaran Anda.

Jika ada masalah, silakan laporkan kembali.

_${global.config.nama || 'Layanan Internet'}_`;
        
        // Send completion notification without duplicates
        await sendCustomerNotification(ticket, customerMessage);
        
        // Note: Photos are NOT sent to customer (only stored for admin/teknisi reference)
        
        return {
            success: true,
            message: `🎉 *PERBAIKAN SELESAI - TIKET CLOSED!*
━━━━━━━━━━━━━━━━

📋 ID Tiket: *${ticketId}*
✅ Status: *COMPLETED*
📝 Catatan: Tersimpan
📸 Dokumentasi: ${state.uploadedPhotos.length} foto
👤 Pelanggan: Sudah dinotifikasi

━━━━━━━━━━━━━━━━
✅ *SEMUA TAHAP SELESAI:*
• Proses ✅
• OTW ✅ 
• Sampai ✅
• Verifikasi OTP ✅
• Upload Foto ✅
• Catatan Resolusi ✅
• Kirim ke Pelanggan ✅

━━━━━━━━━━━━━━━━
📌 *TIKET INI SUDAH SELESAI*

Anda bisa ambil tiket baru dengan:
➡️ Cek tiket tersedia: *list tiket*
➡️ Ambil tiket: *proses [ID_TIKET]*

Terima kasih atas kerja keras Anda! 💪`
        };
        
    } catch (error) {
        console.error('[COMPLETE_TICKET_ERROR]', error);
        return {
            success: false,
            message: '❌ Gagal menyelesaikan tiket. Coba lagi.'
        };
    }
}

module.exports = {
    handleProsesTicket,
    handleOTW,
    handleSampaiLokasi,
    handleVerifikasiOTP,
    handleSelesaiTicket,
    handleTeknisiPhotoUpload,
    handleCompleteTicket,
    sendCustomerNotification
};
