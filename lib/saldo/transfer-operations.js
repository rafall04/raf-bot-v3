/**
 * Header Doc
 * Purpose: Operasi transfer saldo SQLite atomic — `transferSaldo(fromUserId, toUserId, amount, description)`. Mengeksekusi BEGIN TRANSACTION → cek+update sender → INSERT OR IGNORE recipient → cek+update recipient → COMMIT, plus record dual-transaction (debit sender + credit receiver) ke ledger via `transactions-store`. Dipisahkan dari `balance-operations` agar setiap critical money path (add/deduct vs transfer) bisa diuji dan di-maintain independently.
 * Caller: `lib/saldo-manager.js` (composer re-export `transferSaldo`).
 * Deps: `./shared` (initSaldoDatabase, getSaldoDb, normalizeUserJid), `./transactions-store` (pushTransactionRecord, saveTransactions).
 * MainFuncs: `transferSaldo`.
 * SideEffects: SQLite write atomic ke 2 row `user_saldo` (sender + recipient) dalam satu transaction; JSON write ke `saldo_transactions.json` (best-effort post-COMMIT). NOTE: ledger recording dilakukan setelah COMMIT — kegagalan recording tidak meng-rollback transfer (saldo sudah valid).
 */
"use strict";

const { initSaldoDatabase, getSaldoDb, normalizeUserJid } = require('./shared');
const { pushTransactionRecord, saveTransactions } = require('./transactions-store');

async function transferSaldo(fromUserId, toUserId, amount, description = 'Transfer saldo') {
    return new Promise(async (resolve, reject) => {
        try {
            // PENTING: Validasi amount - jangan izinkan amount 0 atau undefined
            if (!amount || amount === 0 || isNaN(amount) || parseInt(amount) <= 0) {
                console.error('[SALDO-MANAGER] Invalid amount for transferSaldo:', amount);
                return resolve(false);
            }

            // PENTING: Normalisasi JID dari @lid ke format standar sebelum operasi database
            // Karena ini async function, normalisasi harus dilakukan di caller (handler)
            const normalizedFromUserId = normalizeUserJid(fromUserId);
            const normalizedToUserId = normalizeUserJid(toUserId);

            // Jika masih @lid format, log warning dan return false
            // Caller seharusnya sudah normalize sebelum memanggil ini
            if ((normalizedFromUserId && normalizedFromUserId.endsWith('@lid')) ||
                (normalizedToUserId && normalizedToUserId.endsWith('@lid'))) {
                console.warn(`[SALDO-MANAGER] transferSaldo called with @lid format: from=${fromUserId}, to=${toUserId}. Normalize JID before calling this function.`);
                return resolve(false);
            }

            // Pastikan database sudah diinisialisasi
            await initSaldoDatabase();
            const saldoDb = getSaldoDb();

            if (!saldoDb) {
                console.error('[SALDO-MANAGER] Database not initialized');
                return resolve(false);
            }

            // Gunakan singleton saldoDb connection
            saldoDb.serialize(() => {
                saldoDb.run("BEGIN TRANSACTION", (beginErr) => {
                    if (beginErr) {
                        // Improved error logging dengan context
                        const errorMsg = beginErr.code === 'SQLITE_BUSY' || beginErr.code === 'SQLITE_LOCKED'
                            ? `Database sedang sibuk. Silakan coba lagi dalam beberapa saat. (${beginErr.code})`
                            : `Gagal memulai transaksi transfer: ${beginErr.message}`;
                        console.error('[SALDO-MANAGER] Error beginning transaction:', {
                            fromUserId: normalizedFromUserId,
                            toUserId: normalizedToUserId,
                            amount,
                            errorCode: beginErr.code,
                            errorMessage: beginErr.message,
                            userFriendlyMessage: errorMsg
                        });
                        return resolve(false);
                    }

                    // Cek saldo sender
                    saldoDb.get("SELECT saldo FROM user_saldo WHERE user_id = ?", [normalizedFromUserId], (err, senderRow) => {
                        if (err) {
                            saldoDb.run("ROLLBACK");
                            // Improved error logging dengan context
                            const errorMsg = err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_LOCKED'
                                ? `Database sedang sibuk. Silakan coba lagi dalam beberapa saat. (${err.code})`
                                : `Gagal memeriksa saldo pengirim: ${err.message}`;
                            console.error('[SALDO-MANAGER] Error checking sender saldo:', {
                                fromUserId: normalizedFromUserId,
                                toUserId: normalizedToUserId,
                                amount,
                                errorCode: err.code,
                                errorMessage: err.message,
                                userFriendlyMessage: errorMsg
                            });
                            return resolve(false);
                        }

                        if (!senderRow || senderRow.saldo < amount) {
                            saldoDb.run("ROLLBACK");
                            console.warn(`[SALDO-MANAGER] Insufficient saldo for transfer: sender=${normalizedFromUserId}, current=${senderRow?.saldo || 0}, requested=${amount}`);
                            return resolve(false);
                        }

                        const senderOldSaldo = senderRow.saldo;
                        const senderNewSaldo = senderOldSaldo - amount;

                        // PENTING: Validasi senderNewSaldo tidak boleh negative (double-check setelah calculation)
                        if (senderNewSaldo < 0) {
                            saldoDb.run("ROLLBACK");
                            console.error(`[SALDO-MANAGER] Validation failed: senderNewSaldo would be negative (${senderNewSaldo}) for user ${normalizedFromUserId}`);
                            return resolve(false);
                        }

                        // Update sender
                        saldoDb.run(
                            "UPDATE user_saldo SET saldo = ?, updated_at = ? WHERE user_id = ?",
                            [senderNewSaldo, new Date().toISOString(), normalizedFromUserId],
                            function (updateErr) {
                                if (updateErr) {
                                    saldoDb.run("ROLLBACK");
                                    // Improved error logging dengan context
                                    const errorMsg = updateErr.code === 'SQLITE_BUSY' || updateErr.code === 'SQLITE_LOCKED'
                                        ? `Database sedang sibuk. Silakan coba lagi dalam beberapa saat. (${updateErr.code})`
                                        : updateErr.code === 'SQLITE_CONSTRAINT'
                                            ? `Constraint violation: ${updateErr.message}`
                                            : `Gagal memperbarui saldo pengirim: ${updateErr.message}`;
                                    console.error('[SALDO-MANAGER] Error updating sender saldo:', {
                                        fromUserId: normalizedFromUserId,
                                        toUserId: normalizedToUserId,
                                        amount,
                                        senderNewSaldo,
                                        errorCode: updateErr.code,
                                        errorMessage: updateErr.message,
                                        userFriendlyMessage: errorMsg
                                    });
                                    return resolve(false);
                                }

                                // Pastikan recipient ada
                                saldoDb.run(
                                    "INSERT OR IGNORE INTO user_saldo (user_id, saldo, uang, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                                    [normalizedToUserId, 0, 0, new Date().toISOString(), new Date().toISOString()],
                                    () => {
                                        // Update recipient
                                        saldoDb.get("SELECT saldo FROM user_saldo WHERE user_id = ?", [normalizedToUserId], (err, recipientRow) => {
                                            if (err) {
                                                saldoDb.run("ROLLBACK");
                                                // Improved error logging dengan context
                                                const errorMsg = err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_LOCKED'
                                                    ? `Database sedang sibuk. Silakan coba lagi dalam beberapa saat. (${err.code})`
                                                    : `Gagal memeriksa saldo penerima: ${err.message}`;
                                                console.error('[SALDO-MANAGER] Error checking recipient saldo:', {
                                                    fromUserId: normalizedFromUserId,
                                                    toUserId: normalizedToUserId,
                                                    amount,
                                                    errorCode: err.code,
                                                    errorMessage: err.message,
                                                    userFriendlyMessage: errorMsg
                                                });
                                                return resolve(false);
                                            }

                                            const recipientOldSaldo = recipientRow ? recipientRow.saldo : 0;
                                            const recipientNewSaldo = recipientOldSaldo + amount;

                                            // PENTING: Validasi recipientNewSaldo untuk prevent integer overflow (optional, tapi good practice)
                                            if (recipientNewSaldo > Number.MAX_SAFE_INTEGER) {
                                                saldoDb.run("ROLLBACK");
                                                console.error(`[SALDO-MANAGER] Validation failed: recipientNewSaldo would exceed MAX_SAFE_INTEGER for user ${normalizedToUserId}`);
                                                return resolve(false);
                                            }

                                            saldoDb.run(
                                                "UPDATE user_saldo SET saldo = ?, updated_at = ? WHERE user_id = ?",
                                                [recipientNewSaldo, new Date().toISOString(), normalizedToUserId],
                                                function (updateErr2) {
                                                    if (updateErr2) {
                                                        saldoDb.run("ROLLBACK");
                                                        // Improved error logging dengan context
                                                        const errorMsg = updateErr2.code === 'SQLITE_BUSY' || updateErr2.code === 'SQLITE_LOCKED'
                                                            ? `Database sedang sibuk. Silakan coba lagi dalam beberapa saat. (${updateErr2.code})`
                                                            : updateErr2.code === 'SQLITE_CONSTRAINT'
                                                                ? `Constraint violation: ${updateErr2.message}`
                                                                : `Gagal memperbarui saldo penerima: ${updateErr2.message}`;
                                                        console.error('[SALDO-MANAGER] Error updating recipient saldo:', {
                                                            fromUserId: normalizedFromUserId,
                                                            toUserId: normalizedToUserId,
                                                            amount,
                                                            recipientNewSaldo,
                                                            errorCode: updateErr2.code,
                                                            errorMessage: updateErr2.message,
                                                            userFriendlyMessage: errorMsg
                                                        });
                                                        return resolve(false);
                                                    }

                                                    saldoDb.run("COMMIT", (commitErr) => {
                                                        if (commitErr) {
                                                            console.error('[SALDO-MANAGER] Error committing transaction:', commitErr);
                                                            return resolve(false);
                                                        }

                                                        // Record transactions (wrapped in try-catch untuk prevent failure dari breaking operation)
                                                        // NOTE: Transaction recording adalah operation terpisah dari database transaction
                                                        // Jika recording gagal, saldo tetap valid (sudah di-commit), tapi history tidak lengkap
                                                        try {
                                                            const timestamp = new Date().toISOString();
                                                            pushTransactionRecord({
                                                                id: `TX${Date.now()}_1`,
                                                                userId: normalizedFromUserId,
                                                                type: 'debit',
                                                                amount: amount,
                                                                description: `${description} ke ${normalizedToUserId.replace('@s.whatsapp.net', '')}`,
                                                                balance_before: senderOldSaldo,
                                                                balance_after: senderNewSaldo,
                                                                created_at: timestamp
                                                            });
                                                            pushTransactionRecord({
                                                                id: `TX${Date.now()}_2`,
                                                                userId: normalizedToUserId,
                                                                type: 'credit',
                                                                amount: amount,
                                                                description: `${description} dari ${normalizedFromUserId.replace('@s.whatsapp.net', '')}`,
                                                                balance_before: recipientOldSaldo,
                                                                balance_after: recipientNewSaldo,
                                                                created_at: timestamp
                                                            });
                                                            saveTransactions();
                                                        } catch (transactionErr) {
                                                            // Log error tapi jangan reject - saldo sudah valid
                                                            console.error('[SALDO-MANAGER] Error recording transactions (saldo already updated):', transactionErr);
                                                            console.warn(`[SALDO-MANAGER] WARNING: Transfer completed but transaction history not recorded: ${normalizedFromUserId} -> ${normalizedToUserId}, amount ${amount}`);
                                                        }

                                                        resolve(true);
                                                    });
                                                }
                                            );
                                        });
                                    }
                                );
                            }
                        );
                    });
                });
            });
        } catch (error) {
            console.error('[SALDO-MANAGER] Error transferring saldo:', error);
            resolve(false);
        }
    });
}

module.exports = {
    transferSaldo
};
