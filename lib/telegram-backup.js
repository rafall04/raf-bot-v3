/**
 * Telegram Database Backup Service
 * Mengirim backup database pelanggan ke Telegram setiap hari
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const configPath = path.join(__dirname, '..', 'config.json');
const dbBasePath = path.join(__dirname, '..', 'database');

/**
 * Load konfigurasi Telegram dari config.json
 */
function getTelegramConfig() {
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return {
            botToken: config.telegramBackup?.botToken || '',
            chatId: config.telegramBackup?.chatId || '',
            enabled: config.telegramBackup?.enabled === true
        };
    } catch (error) {
        console.error('[TELEGRAM_BACKUP] Error loading config:', error.message);
        return { botToken: '', chatId: '', enabled: false };
    }
}

/**
 * Kirim pesan teks ke Telegram
 */
async function sendTelegramMessage(message) {
    const config = getTelegramConfig();
    
    if (!config.botToken || !config.chatId) {
        throw new Error('Telegram bot token atau chat ID belum dikonfigurasi');
    }

    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    
    try {
        const response = await axios.post(url, {
            chat_id: config.chatId,
            text: message,
            parse_mode: 'HTML'
        });
        return response.data;
    } catch (error) {
        const errorMsg = error.response?.data?.description || error.message;
        throw new Error(`Gagal mengirim pesan Telegram: ${errorMsg}`);
    }
}

/**
 * Kirim file ke Telegram
 */
async function sendTelegramDocument(filePath, caption = '') {
    const config = getTelegramConfig();
    
    if (!config.botToken || !config.chatId) {
        throw new Error('Telegram bot token atau chat ID belum dikonfigurasi');
    }

    const url = `https://api.telegram.org/bot${config.botToken}/sendDocument`;
    
    try {
        const form = new FormData();
        form.append('chat_id', config.chatId);
        form.append('document', fs.createReadStream(filePath));
        if (caption) {
            form.append('caption', caption);
            form.append('parse_mode', 'HTML');
        }

        const response = await axios.post(url, form, {
            headers: form.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
        
        return response.data;
    } catch (error) {
        const errorMsg = error.response?.data?.description || error.message;
        throw new Error(`Gagal mengirim file ke Telegram: ${errorMsg}`);
    }
}

/**
 * Buat backup database dan kirim ke Telegram
 */
async function performDatabaseBackup() {
    const config = getTelegramConfig();
    
    if (!config.enabled) {
        console.log('[TELEGRAM_BACKUP] Backup dinonaktifkan');
        return { success: false, message: 'Backup Telegram dinonaktifkan' };
    }

    if (!config.botToken || !config.chatId) {
        console.error('[TELEGRAM_BACKUP] Bot token atau chat ID belum dikonfigurasi');
        return { success: false, message: 'Konfigurasi Telegram belum lengkap' };
    }

    const timestamp = new Date().toLocaleString('id-ID', { 
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).replace(/[/:]/g, '-').replace(/, /g, '_');

    const backupDir = path.join(__dirname, '..', 'backups');
    
    // Pastikan folder backup ada
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    const results = [];
    const databasesToBackup = [
        { name: 'users', file: 'users.sqlite', description: 'Database Pelanggan' },
        { name: 'saldo', file: 'saldo.sqlite', description: 'Database Saldo' },
        { name: 'activity_logs', file: 'activity_logs.sqlite', description: 'Database Log Aktivitas' }
    ];

    console.log(`[TELEGRAM_BACKUP] Memulai backup database pada ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);

    // Kirim notifikasi awal
    try {
        const startMessage = `🔄 <b>Backup Database Dimulai</b>\n\n` +
            `📅 Waktu: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n` +
            `📊 Database: ${databasesToBackup.map(d => d.description).join(', ')}`;
        await sendTelegramMessage(startMessage);
    } catch (error) {
        console.error('[TELEGRAM_BACKUP] Gagal mengirim notifikasi awal:', error.message);
    }

    for (const db of databasesToBackup) {
        const sourcePath = path.join(dbBasePath, db.file);
        
        if (!fs.existsSync(sourcePath)) {
            console.warn(`[TELEGRAM_BACKUP] File ${db.file} tidak ditemukan, skip...`);
            results.push({ name: db.name, success: false, message: 'File tidak ditemukan' });
            continue;
        }

        const backupFileName = `${db.name}_backup_${timestamp}.sqlite`;
        const backupPath = path.join(backupDir, backupFileName);

        try {
            // Copy file database
            fs.copyFileSync(sourcePath, backupPath);
            
            // Dapatkan ukuran file
            const stats = fs.statSync(backupPath);
            const fileSizeKB = (stats.size / 1024).toFixed(2);
            const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            const sizeDisplay = stats.size > 1024 * 1024 ? `${fileSizeMB} MB` : `${fileSizeKB} KB`;

            // Kirim ke Telegram
            const caption = `📦 <b>${db.description}</b>\n` +
                `📅 ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n` +
                `📁 Ukuran: ${sizeDisplay}`;
            
            await sendTelegramDocument(backupPath, caption);
            
            console.log(`[TELEGRAM_BACKUP] ✅ ${db.description} berhasil dikirim (${sizeDisplay})`);
            results.push({ name: db.name, success: true, size: sizeDisplay });

            // Hapus file backup lokal setelah dikirim (opsional, bisa diubah)
            // fs.unlinkSync(backupPath);
            
        } catch (error) {
            console.error(`[TELEGRAM_BACKUP] ❌ Gagal backup ${db.description}:`, error.message);
            results.push({ name: db.name, success: false, message: error.message });
        }
    }

    // Kirim ringkasan
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    try {
        let summaryMessage = `✅ <b>Backup Database Selesai</b>\n\n`;
        summaryMessage += `📊 Berhasil: ${successCount}/${databasesToBackup.length}\n`;
        
        if (failCount > 0) {
            summaryMessage += `❌ Gagal: ${failCount}\n\n`;
            summaryMessage += `<b>Detail Gagal:</b>\n`;
            results.filter(r => !r.success).forEach(r => {
                summaryMessage += `• ${r.name}: ${r.message}\n`;
            });
        }
        
        await sendTelegramMessage(summaryMessage);
    } catch (error) {
        console.error('[TELEGRAM_BACKUP] Gagal mengirim ringkasan:', error.message);
    }

    console.log(`[TELEGRAM_BACKUP] Backup selesai. Berhasil: ${successCount}, Gagal: ${failCount}`);
    
    return {
        success: failCount === 0,
        results,
        timestamp: new Date().toISOString()
    };
}

/**
 * Test koneksi Telegram
 */
async function testTelegramConnection(botToken, chatId) {
    if (!botToken || !chatId) {
        throw new Error('Bot token dan chat ID harus diisi');
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    try {
        const response = await axios.post(url, {
            chat_id: chatId,
            text: `✅ <b>Test Koneksi Berhasil!</b>\n\nBot backup database telah terhubung.\n📅 ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`,
            parse_mode: 'HTML'
        });
        
        return {
            success: true,
            message: 'Koneksi berhasil! Pesan test telah dikirim ke Telegram.'
        };
    } catch (error) {
        const errorMsg = error.response?.data?.description || error.message;
        throw new Error(`Koneksi gagal: ${errorMsg}`);
    }
}

module.exports = {
    getTelegramConfig,
    sendTelegramMessage,
    sendTelegramDocument,
    performDatabaseBackup,
    testTelegramConnection
};
