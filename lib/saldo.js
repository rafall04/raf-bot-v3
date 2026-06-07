/**
 * Saldo Management Module (Legacy)
 * Wrapper untuk saldo-manager.js yang menggunakan SQLite
 * Mempertahankan backward compatibility dengan global.atm
 */

const saldoManager = require('./saldo-manager');

// Untuk backward compatibility, tetap load global.atm dari JSON jika ada
// Tapi semua operasi akan menggunakan SQLite melalui saldo-manager
let atm = [];

// Load initial data dari JSON untuk backward compatibility
function loadAtmFromJson() {
    try {
        const fs = require('fs');
        const path = require('path');
        const atmJsonPath = path.join(__dirname, '../database/user/atm.json');

        if (fs.existsSync(atmJsonPath)) {
            const jsonContent = fs.readFileSync(atmJsonPath, 'utf8');
            atm = JSON.parse(jsonContent);
        } else {
            atm = [];
        }
    } catch (error) {
        console.error('[SALDO] Error loading atm.json:', error);
        atm = [];
    }
}

// Initialize
loadAtmFromJson();

// Sync global.atm dengan SQLite (untuk backward compatibility)
async function syncAtmFromSqlite() {
    try {
        const allSaldoData = await saldoManager.getAllSaldoData();
        atm = allSaldoData.map(item => ({
            id: item.id || item.user_id,
            uang: item.uang || 0,
            saldo: item.saldo || 0,
            pushname: item.pushname,
            created_at: item.created_at,
            updated_at: item.updated_at
        }));

        // Update global.atm jika ada
        if (typeof global !== 'undefined' && global.atm) {
            global.atm = atm;
        }
    } catch (_error) {
        // Silent fail - tabel mungkin belum dibuat, akan di-sync nanti
        // Error sudah di-handle di getAllSaldoData
    }
}

// Sync saat module di-load (delay untuk memastikan database sudah initialized)
setTimeout(() => {
    syncAtmFromSqlite().catch(() => {
        // Silent fail - akan di-sync nanti saat database ready
    });
}, 2000);

const addATM = (sender) => {
    // Gunakan saldo-manager untuk create user
    saldoManager.createUserSaldo(sender);

    // Update local atm array untuk backward compatibility
    const existing = atm.find(a => a.id === sender);
    if (!existing) {
        atm.push({
            id: sender,
            uang: 0,
            saldo: 0
        });
    }

    // Sync ke global.atm
    if (typeof global !== 'undefined' && global.atm) {
        global.atm = atm;
    }
};

const addKoinUser = async (userId, amount) => {
    // PENTING: Validasi amount - jangan izinkan amount 0 atau undefined
    if (!amount || amount === 0 || isNaN(amount) || parseInt(amount) <= 0) {
        console.warn(`[SALDO] addKoinUser called with invalid amount: ${amount} for userId: ${userId}. Skipping.`);
        return false;
    }

    // Normalisasi JID dari @lid ke format standar sebelum operasi saldo
    let normalizedUserId = userId;


    // PENTING: Pastikan normalizedUserId tidak mengandung :0 atau format aneh lainnya
    if (normalizedUserId && normalizedUserId.includes(':')) {
        normalizedUserId = normalizedUserId.split(':')[0];
        if (!normalizedUserId.endsWith('@s.whatsapp.net')) {
            normalizedUserId = normalizedUserId + '@s.whatsapp.net';
        }
    }

    // Gunakan saldo-manager untuk add saldo (sekarang async)
    const success = await saldoManager.addSaldo(normalizedUserId, amount, 'Topup via payment callback').catch(err => {
        console.error('[SALDO] Error adding saldo:', err);
        return false;
    });

    if (success) {
        // Update local atm array untuk backward compatibility (gunakan normalizedUserId)
        const index = atm.findIndex(a => a.id === normalizedUserId);
        if (index !== -1) {
            atm[index].saldo = (atm[index].saldo || 0) + parseInt(amount);
        } else {
            atm.push({
                id: normalizedUserId,
                uang: 0,
                saldo: parseInt(amount)
            });
        }

        // Sync ke global.atm
        if (typeof global !== 'undefined' && global.atm) {
            global.atm = atm;
        }
    }

    return success;
};

const checkATMuser = async (userId) => {
    // PENTING: Normalisasi JID dari @lid ke format standar sebelum get saldo
    // Karena getUserSaldo sekarang async (Promise), kita perlu await
    try {
        return await saldoManager.getUserSaldo(userId);
    } catch (error) {
        console.error(`[SALDO] Error:`, error.message);
        return 0;
    }
};

const confirmATM = async (userId, amount) => {
    // Gunakan saldo-manager untuk deduct saldo (async)
    const success = await saldoManager.deductSaldo(userId, amount, 'Konfirmasi pembayaran');

    if (success) {
        // Update local atm array untuk backward compatibility
        const index = atm.findIndex(a => a.id === userId);
        if (index !== -1) {
            atm[index].saldo = Math.max(0, (atm[index].saldo || 0) - parseInt(amount));
        }

        // Sync ke global.atm
        if (typeof global !== 'undefined' && global.atm) {
            global.atm = atm;
        }
    }

    return success;
};

const checkRegisteredATM = async (userId) => {
    // Cek apakah user benar-benar terdaftar di SQLite.
    // PENTING: getUserSaldo mengembalikan 0 untuk user tak ada, jadi tidak bisa dipakai untuk cek eksistensi.
    // Gunakan getUserSaldoData yang mengembalikan null bila record tidak ada.
    try {
        const data = await saldoManager.getUserSaldoData(userId);
        return Boolean(data);
    } catch (error) {
        console.error('[SALDO] Error checkRegisteredATM:', error.message);
        return false;
    }
};

const delSaldo = async (nomer) => {
    // Hapus saldo: set saldo user ke 0 dengan memotong seluruh saldo saat ini (record tetap ada).
    let success = false;
    try {
        const currentSaldo = await saldoManager.getUserSaldo(nomer);
        if (!currentSaldo || currentSaldo <= 0) {
            // Sudah 0 / tidak ada saldo — tidak ada yang perlu dipotong, anggap sukses.
            success = true;
        } else {
            success = await saldoManager.deductSaldo(nomer, currentSaldo, 'Hapus saldo');
        }
    } catch (error) {
        console.error('[SALDO] Error delSaldo:', error.message);
        return false;
    }

    if (success) {
        // Update local atm array
        const index = atm.findIndex(a => a.id === nomer);
        if (index !== -1) {
            atm.splice(index, 1);
        }

        // Sync ke global.atm
        if (typeof global !== 'undefined' && global.atm) {
            global.atm = atm;
        }
    }

    return success;
};

module.exports = {
    addATM,
    addKoinUser,
    checkATMuser,
    confirmATM,
    checkRegisteredATM,
    delSaldo,
    // Export untuk backward compatibility
    syncAtmFromSqlite
};
