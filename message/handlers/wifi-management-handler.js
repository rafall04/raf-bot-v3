/**
 * WiFi Management Handler
 * Menangani operasi ganti nama dan password WiFi
 */

const axios = require('axios');
const { getSSIDInfo, setSSIDName, setPassword } = require('../../lib/wifi');

const { getUserState, setUserState, deleteUserState } = require('./conversation-handler');

/**
 * Handle WiFi name change
 */
async function handleGantiNamaWifi({ sender, args, matchedKeywordLength, isOwner, isTeknisi, pushname, users, reply, global, mess, msg, raf }) {
    try {
        let user;
        let newName;
        let providedId = null;

        const keywordLength = matchedKeywordLength || 1;

        if ((isOwner || isTeknisi) && args.length > keywordLength + 1 && !isNaN(parseInt(args[keywordLength], 10))) {
            providedId = args[keywordLength];
            newName = args.slice(keywordLength + 1).join(' ').trim();
        } else {
            newName = args.length > keywordLength ? args.slice(keywordLength).join(' ').trim() : '';
        }

        if (providedId) {
            user = users.find(v => v.id == providedId);
        } else {
            let plainSenderNumber = sender.split('@')[0].split(':')[0];

            // Ekstraksi JID (nomor asli opsional) jika tersembunyi
            let optionalJid = null;
            if (msg.key && msg.key.remoteJidAlt && msg.key.remoteJidAlt.includes('@s.whatsapp.net')) {
                optionalJid = msg.key.remoteJidAlt.split('@')[0].split(':')[0];
                plainSenderNumber = optionalJid;
            } else if (msg.participant && msg.participant.includes('@s.whatsapp.net')) {
                optionalJid = msg.participant.split('@')[0].split(':')[0];
                plainSenderNumber = optionalJid;
            }

            user = users.find(u => {
                if (u.lid && u.lid === sender) return true;
                if (!u.phone_number) return false;
                const phones = u.phone_number.split('|').map(p => p.trim());
                return phones.some(phone => {
                    if (phone === plainSenderNumber || phone === sender) return true;
                    // Try formatting match (08x vs 628x)
                    let pClean = phone.replace(/[^0-9]/g, '');
                    let sClean = plainSenderNumber.replace(/[^0-9]/g, '');
                    if (pClean.startsWith('62')) pClean = pClean.substring(2);
                    if (pClean.startsWith('0')) pClean = pClean.substring(1);
                    if (sClean.startsWith('62')) sClean = sClean.substring(2);
                    if (sClean.startsWith('0')) sClean = sClean.substring(1);
                    return pClean === sClean;
                });
            });

            // If still not found for @lid, show error (no manual verification needed)
            if (sender.endsWith('@lid') && !user) {
                console.log('[GANTI_NAMA_WIFI] @lid format detected, user not found');
                console.log('[GANTI_NAMA_WIFI] Sender:', sender);
                return reply(`❌ Maaf, nomor Anda tidak terdaftar dalam database.\n\nSilakan hubungi admin untuk bantuan.`);
            }
        }

        if (!user) {
            if (isOwner || isTeknisi) {
                if (providedId) {
                    return reply(`Maaf Kak ${pushname}, pelanggan dengan ID "${providedId}" tidak ditemukan.`);
                } else {
                    let helpMessage = "📝 **GANTI NAMA WIFI - Panduan Admin/Teknisi**\n\n";
                    helpMessage += "Format yang benar:\n";
                    helpMessage += "• `ganti nama wifi [ID] [nama baru]`\n\n";
                    helpMessage += "Contoh:\n";
                    helpMessage += "• `ganti nama wifi 1 WiFiKeren`\n";
                    helpMessage += "• `ganti nama wifi 5 RAF-Net-2024`\n\n";
                    helpMessage += "💡 Tips: Gunakan ID pelanggan dari database.";
                    return reply(helpMessage);
                }
            } else {
                return reply(mess.userNotRegister);
            }
        }

        if (user.subscription === 'PAKET-VOUCHER' && !(isOwner || isTeknisi)) {
            return reply(`Maaf Kak ${pushname}, fitur ganti nama WiFi saat ini hanya tersedia untuk pelanggan bulanan.`);
        }

        if (!user.device_id) {
            return reply(`Maaf Kak ${pushname}, data device ID ${(isOwner || isTeknisi) ? `untuk pelanggan "${user.name}"` : 'Anda'} tidak ditemukan. ${!(isOwner || isTeknisi) ? 'Silakan hubungi Admin.' : 'Tidak bisa melanjutkan.'}`);
        }

        await reply("⏳ Sedang memeriksa informasi WiFi...");

        const useBulk = global.config.custom_wifi_modification && user.bulk && user.bulk.length > 0;
        const hasMultipleSSIDs = user.bulk && user.bulk.length > 0;

        if (useBulk) {
            try {
                const { ssid } = await getSSIDInfo(user.device_id);
                const currentSSIDs = user.bulk.map((bulkId, index) => {
                    const matchedSSID = ssid.find(s => String(s.id) === String(bulkId));
                    return `${index + 1}. SSID ${bulkId}: "${matchedSSID?.name || 'Tidak diketahui'}"`;
                }).join('\n');

                if (newName && newName.trim().length > 0) {
                    if (newName.length > 32) {
                        return reply(`⚠️ Nama WiFi terlalu panjang, maksimal 32 karakter.`);
                    }

                    setUserState(sender, {
                        step: 'SELECT_CHANGE_MODE',
                        targetUser: user,
                        nama_wifi_baru: newName,
                        bulk_ssids: user.bulk,
                        ssid_info: currentSSIDs
                    });

                    reply(`SSID WiFi yang tersedia:\n${currentSSIDs}\n\nAnda ingin mengubah nama WiFi menjadi: "${newName}"\n\nPilih mode perubahan:\n1️⃣ Ubah satu SSID saja\n2️⃣ Ubah semua SSID sekaligus\n\nBalas dengan angka pilihan Anda.`);
                    return;
                } else {
                    setUserState(sender, {
                        step: 'SELECT_CHANGE_MODE_FIRST',
                        targetUser: user,
                        bulk_ssids: user.bulk,
                        ssid_info: currentSSIDs
                    });

                    reply(`SSID WiFi yang tersedia:\n${currentSSIDs}\n\nPilih mode perubahan nama:\n1️⃣ Ubah satu SSID saja\n2️⃣ Ubah semua SSID sekaligus\n\nBalas dengan angka pilihan Anda.`);
                    return;
                }
            } catch (error) {
                console.error(`[GANTI_NAMA_WIFI] Error getting current SSID:`, error);
                handleFallbackNameChange(sender, user, newName, reply);
            }
        } else if (hasMultipleSSIDs && !global.config.custom_wifi_modification) {
            handleBulkAutoNameChange(sender, user, newName, reply, global);
        } else {
            handleSingleSSIDNameChange(sender, user, newName, reply, global);
        }
    } catch (e) {
        console.error(`[GANTI_NAMA_WIFI_ERROR] Error:`, e);
        reply(`Maaf, terjadi kesalahan saat memeriksa informasi WiFi. Silakan coba lagi nanti atau hubungi admin.`);
    }
}

/**
 * Handle WiFi password change
 */
async function handleGantiSandiWifi({ sender, args, matchedKeywordLength, isOwner, isTeknisi, pushname, users, reply, global, mess, msg, raf }) {
    try {
        let user;
        let newPassword;
        let providedId = null;

        const keywordLength = matchedKeywordLength || 1;

        if ((isOwner || isTeknisi) && args.length > keywordLength + 1 && !isNaN(parseInt(args[keywordLength], 10))) {
            providedId = args[keywordLength];
            newPassword = args.slice(keywordLength + 1).join(' ').trim();
        } else {
            newPassword = args.length > keywordLength ? args.slice(keywordLength).join(' ').trim() : '';
        }

        if (providedId) {
            user = users.find(v => v.id == providedId);
        } else {
            let plainSenderNumber = sender.split('@')[0].split(':')[0];

            let optionalJid = null;
            if (msg.key && msg.key.remoteJidAlt && msg.key.remoteJidAlt.includes('@s.whatsapp.net')) {
                optionalJid = msg.key.remoteJidAlt.split('@')[0].split(':')[0];
                plainSenderNumber = optionalJid;
            } else if (msg.participant && msg.participant.includes('@s.whatsapp.net')) {
                optionalJid = msg.participant.split('@')[0].split(':')[0];
                plainSenderNumber = optionalJid;
            }

            user = users.find(u => {
                if (u.lid && u.lid === sender) return true;
                if (!u.phone_number) return false;
                const phones = u.phone_number.split('|').map(p => p.trim());
                return phones.some(phone => {
                    if (phone === plainSenderNumber || phone === sender) return true;
                    // Try formatting match (08x vs 628x)
                    let pClean = phone.replace(/[^0-9]/g, '');
                    let sClean = plainSenderNumber.replace(/[^0-9]/g, '');
                    if (pClean.startsWith('62')) pClean = pClean.substring(2);
                    if (pClean.startsWith('0')) pClean = pClean.substring(1);
                    if (sClean.startsWith('62')) sClean = sClean.substring(2);
                    if (sClean.startsWith('0')) sClean = sClean.substring(1);
                    return pClean === sClean;
                });
            });

            // If still not found for @lid, show error (no manual verification needed)
            if (sender.endsWith('@lid') && !user) {
                console.log('[GANTI_SANDI_WIFI] @lid format detected, user not found');
                console.log('[GANTI_SANDI_WIFI] Sender:', sender);
                return reply(`❌ Maaf, nomor Anda tidak terdaftar dalam database.\n\nSilakan hubungi admin untuk bantuan.`);
            }
        }

        if (!user) {
            if (isOwner || isTeknisi) {
                if (providedId) {
                    return reply(`Maaf Kak ${pushname}, pelanggan dengan ID "${providedId}" tidak ditemukan.`);
                } else {
                    let helpMessage = "🔐 **GANTI PASSWORD WIFI - Panduan Admin/Teknisi**\n\n";
                    helpMessage += "Format yang benar:\n";
                    helpMessage += "• `ganti password wifi [ID] [password baru]`\n";
                    helpMessage += "• `ganti sandi wifi [ID] [password baru]`\n\n";
                    helpMessage += "Contoh:\n";
                    helpMessage += "• `ganti password wifi 1 Pass123456`\n";
                    helpMessage += "• `ganti sandi wifi 5 RafNet2024!`\n\n";
                    helpMessage += "⚠️ Password minimal 8 karakter\n";
                    helpMessage += "💡 Tips: Gunakan ID pelanggan dari database.";
                    return reply(helpMessage);
                }
            } else {
                return reply(mess.userNotRegister);
            }
        }

        if (user.subscription === 'PAKET-VOUCHER' && !(isOwner || isTeknisi)) {
            return reply(`Maaf Kak ${pushname}, fitur ganti kata sandi WiFi saat ini hanya tersedia untuk pelanggan bulanan.`);
        }

        if (!user.device_id) {
            return reply(`Maaf Kak ${pushname}, data device ID ${(isOwner || isTeknisi) ? `untuk pelanggan "${user.name}"` : 'Anda'} tidak ditemukan. ${!(isOwner || isTeknisi) ? 'Silakan hubungi Admin.' : 'Tidak bisa melanjutkan.'}`);
        }

        await reply("⏳ Sedang memeriksa informasi WiFi...");

        const useBulk = global.config.custom_wifi_modification && user.bulk && user.bulk.length > 0;
        const hasMultipleSSIDs = user.bulk && user.bulk.length > 0;

        if (useBulk) {
            handleBulkPasswordChange(sender, user, newPassword, reply, global);
        } else if (hasMultipleSSIDs && !global.config.custom_wifi_modification) {
            handleBulkAutoPasswordChange(sender, user, newPassword, reply, global);
        } else {
            handleSingleSSIDPasswordChange(sender, user, newPassword, reply, global);
        }
    } catch (e) {
        console.error(`[GANTI_SANDI_WIFI_ERROR] Error:`, e);
        reply(`Maaf, terjadi kesalahan saat memeriksa informasi WiFi. Silakan coba lagi nanti atau hubungi admin.`);
    }
}

// Helper functions
function handleFallbackNameChange(sender, user, newName, reply) {
    if (newName && newName.trim().length > 0) {
        if (newName.length > 32) {
            return reply(`⚠️ Nama WiFi terlalu panjang, maksimal 32 karakter.`);
        }

        setUserState(sender, {
            step: 'SELECT_CHANGE_MODE',
            targetUser: user,
            nama_wifi_baru: newName,
            bulk_ssids: user.bulk
        });

        reply(`Anda ingin mengubah nama WiFi menjadi: "${newName}"\n\nPilih mode perubahan:\n1️⃣ Ubah satu SSID saja\n2️⃣ Ubah semua SSID sekaligus\n\nBalas dengan angka pilihan Anda.`);
    } else {
        setUserState(sender, {
            step: 'SELECT_CHANGE_MODE_FIRST',
            targetUser: user,
            bulk_ssids: user.bulk
        });

        reply(`Pilih mode perubahan nama WiFi:\n1️⃣ Ubah satu SSID saja\n2️⃣ Ubah semua SSID sekaligus\n\nBalas dengan angka pilihan Anda.`);
    }
}

async function handleSingleSSIDNameChange(sender, user, newName, reply, global) {
    if (!newName || newName.trim().length === 0) {
        setUserState(sender, {
            step: 'ASK_NEW_NAME_FOR_SINGLE',
            targetUser: user,
            ssid_id: user.ssid_id || '1'
        });

        reply("Tentu, mau diganti jadi apa nama WiFi nya? Silakan ketik nama yang baru.\n\n📝 *Ketentuan nama WiFi:*\n• Maksimal 32 karakter\n• Boleh menggunakan huruf, angka, spasi, titik, dan tanda hubung\n• Contoh: WiFiRumah, Keluarga-Bahagia\n\n💡 Ketik *batal* jika ingin membatalkan proses ini.");
    } else {
        if (newName.length > 32) {
            return reply(`⚠️ Nama WiFi terlalu panjang, maksimal 32 karakter.`);
        }

        // Check config for execution mode
        if (global && global.config && global.config.custom_wifi_modification) {
            // MODE 1: Ask confirmation
            setUserState(sender, {
                step: 'CONFIRM_GANTI_NAMA',
                targetUser: user,
                nama_wifi_baru: newName,
                ssid_id: user.ssid_id || '1'
            });

            reply(`Baik, saya konfirmasi ya. Nama WiFi akan diubah menjadi: "${newName}". Sudah benar?\n\nBalas *'ya'* untuk melanjutkan.`);
        } else {
            // MODE 2: Direct execution without confirmation
            const { setSSIDName } = require('../../lib/wifi');
            try {
                await setSSIDName(user.device_id, user.ssid_id || '1', newName);
                await logWifiNameChange(user, newName, sender, 'single');

                reply(`✅ *Berhasil!*\n\nNama WiFi telah diubah menjadi: *"${newName}"*\n\n📝 *Info Penting:*\n• Perubahan akan aktif dalam 1-2 menit\n• Modem akan restart otomatis\n• Anda mungkin perlu menyambung ulang perangkat Anda\n\n💡 Jika ada masalah, hubungi admin untuk bantuan.`);
            } catch (error) {
                console.error(`[SINGLE_NAME_CHANGE] Error:`, error);
                reply(`❌ Maaf, gagal mengubah nama WiFi. Silakan coba lagi atau hubungi admin.\n\nError: ${error.message}`);
            }
        }
    }
}

async function handleBulkAutoNameChange(sender, user, newName, reply, global) {
    if (!newName || newName.trim().length === 0) {
        setUserState(sender, {
            step: 'ASK_NEW_NAME_FOR_BULK_AUTO',
            targetUser: user,
            bulk_ssids: user.bulk
        });
        return reply(`Silakan ketik nama WiFi baru yang Anda inginkan.\n\n📝 *Ketentuan nama WiFi:*\n• Maksimal 32 karakter\n• Boleh menggunakan huruf, angka, spasi, titik, dan tanda hubung\n• Contoh: WiFiRumah, Keluarga-Bahagia\n\n⚠️ Nama ini akan diterapkan ke *semua SSID* WiFi Anda.\n\n💡 Ketik *batal* jika ingin membatalkan proses ini.`);
    }

    if (newName.length > 32) {
        return reply(`⚠️ *Nama WiFi terlalu panjang!*\n\nNama WiFi maksimal *32 karakter*.\n\nSilakan coba lagi dengan nama yang lebih pendek.`);
    }

    try {
        const { ssid } = await getSSIDInfo(user.device_id);
        const currentSSIDs = user.bulk.map((bulkId, index) => {
            const matchedSSID = ssid.find(s => String(s.id) === String(bulkId));
            return `${index + 1}. SSID ${bulkId}: "${matchedSSID?.name || 'Tidak diketahui'}"`;
        }).join('\n');

        reply(`📋 *Daftar SSID yang akan diubah:*\n${currentSSIDs}\n\n⏳ Sedang mengubah nama untuk *semua SSID*...`);

        const parameterValues = user.bulk.map(ssidId => {
            return [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${ssidId}.SSID`, newName, "xsd:string"];
        });

        const response = await axios.post(`${global.config.genieacsBaseUrl}/devices/${encodeURIComponent(user.device_id)}/tasks?connection_request`, {
            name: 'setParameterValues',
            parameterValues: parameterValues
        });

        await logWifiNameChange(user, newName, sender, 'bulk_auto');

        reply(`✅ *Berhasil!*\n\nNama WiFi untuk *semua SSID* telah diubah menjadi: *"${newName}"*\n\n📝 *Catatan:*\n• Perubahan akan aktif dalam 1-2 menit\n• Modem akan restart otomatis\n• Anda mungkin perlu menyambung ulang perangkat Anda`);
    } catch (error) {
        console.error(`[BULK_AUTO_NAME_CHANGE] Error:`, error);
        reply(`❌ Maaf, gagal mengubah nama WiFi. Silakan coba lagi atau hubungi admin.\n\nError: ${error.message}`);
    }
}

function handleBulkPasswordChange(sender, user, newPassword, reply, global) {
    try {
        const getSSIDInfo = require('../../lib/wifi').getSSIDInfo;
        getSSIDInfo(user.device_id).then(({ ssid }) => {
            const currentSSIDs = user.bulk.map((bulkId, index) => {
                const matchedSSID = ssid.find(s => String(s.id) === String(bulkId));
                return `${index + 1}. SSID ${bulkId}: "${matchedSSID?.name || 'Tidak diketahui'}"`;
            }).join('\n');

            if (newPassword && newPassword.trim().length > 0) {
                if (newPassword.length < 8) {
                    return reply(`⚠️ Kata sandi terlalu pendek, minimal harus 8 karakter.`);
                }

                setUserState(sender, {
                    step: 'SELECT_CHANGE_PASSWORD_MODE',
                    targetUser: user,
                    sandi_wifi_baru: newPassword,
                    bulk_ssids: user.bulk,
                    ssid_info: currentSSIDs
                });

                reply(`SSID WiFi yang tersedia:\n${currentSSIDs}\n\nAnda ingin mengubah kata sandi WiFi menjadi: \`${newPassword}\`\n\nPilih mode perubahan:\n1️⃣ Ubah satu SSID saja\n2️⃣ Ubah semua SSID sekaligus\n\nBalas dengan angka pilihan Anda.`);
            } else {
                setUserState(sender, {
                    step: 'SELECT_CHANGE_PASSWORD_MODE_FIRST',
                    targetUser: user,
                    bulk_ssids: user.bulk,
                    ssid_info: currentSSIDs
                });

                reply(`SSID WiFi yang tersedia:\n${currentSSIDs}\n\nPilih mode perubahan kata sandi:\n1️⃣ Ubah satu SSID saja\n2️⃣ Ubah semua SSID sekaligus\n\nBalas dengan angka pilihan Anda.`);
            }
        }).catch(error => {
            console.error(`[GANTI_SANDI_WIFI] Error getting current SSID:`, error);
            handleFallbackPasswordChange(sender, user, newPassword, reply);
        });
    } catch (error) {
        console.error(`[BULK_PASSWORD_CHANGE] Error:`, error);
        handleFallbackPasswordChange(sender, user, newPassword, reply);
    }
}

function handleFallbackPasswordChange(sender, user, newPassword, reply) {
    if (newPassword && newPassword.trim().length > 0) {
        if (newPassword.length < 8) {
            return reply(`⚠️ Kata sandi terlalu pendek, minimal harus 8 karakter.`);
        }

        setUserState(sender, {
            step: 'SELECT_CHANGE_PASSWORD_MODE',
            targetUser: user,
            sandi_wifi_baru: newPassword,
            bulk_ssids: user.bulk
        });

        reply(`Anda ingin mengubah kata sandi WiFi menjadi: \`${newPassword}\`\n\nPilih mode perubahan:\n1️⃣ Ubah satu SSID saja\n2️⃣ Ubah semua SSID sekaligus\n\nBalas dengan angka pilihan Anda.`);
    } else {
        setUserState(sender, {
            step: 'SELECT_CHANGE_PASSWORD_MODE_FIRST',
            targetUser: user,
            bulk_ssids: user.bulk
        });

        reply(`Pilih mode perubahan kata sandi WiFi:\n1️⃣ Ubah satu SSID saja\n2️⃣ Ubah semua SSID sekaligus\n\nBalas dengan angka pilihan Anda.`);
    }
}

async function handleBulkAutoPasswordChange(sender, user, newPassword, reply, global) {
    if (!newPassword || newPassword.trim().length === 0) {
        setUserState(sender, {
            step: 'ASK_NEW_PASSWORD_BULK_AUTO',
            targetUser: user,
            bulk_ssids: user.bulk
        });
        return reply(`Silakan ketik kata sandi WiFi baru yang Anda inginkan.\n\n🔐 *Ketentuan kata sandi WiFi:*\n• Minimal 8 karakter\n• Boleh menggunakan huruf, angka, dan simbol\n• Contoh: Password123, MyWiFi2024!\n\n⚠️ Kata sandi ini akan diterapkan ke *semua SSID* WiFi Anda.\n\n💡 Ketik *batal* jika ingin membatalkan proses ini.`);
    }

    if (newPassword.length < 8) {
        return reply(`⚠️ *Kata sandi terlalu pendek!*\n\nKata sandi WiFi minimal harus *8 karakter*.\n\nSilakan coba lagi dengan kata sandi yang lebih panjang.`);
    }

    try {
        const { ssid } = await getSSIDInfo(user.device_id);
        const currentSSIDs = user.bulk.map((bulkId, index) => {
            const matchedSSID = ssid.find(s => String(s.id) === String(bulkId));
            return `${index + 1}. SSID ${bulkId}: "${matchedSSID?.name || 'Tidak diketahui'}"`;
        }).join('\n');

        reply(`📋 *Daftar SSID yang akan diubah:*\n${currentSSIDs}\n\n⏳ Sedang mengubah kata sandi untuk *semua SSID*...`);

        const parameterValues = user.bulk.map(ssidId => {
            return [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${ssidId}.PreSharedKey.1.PreSharedKey`, newPassword, "xsd:string"];
        });

        const response = await axios.post(`${global.config.genieacsBaseUrl}/devices/${encodeURIComponent(user.device_id)}/tasks?connection_request`, {
            name: 'setParameterValues',
            parameterValues: parameterValues
        });

        await logWifiPasswordChange(user, newPassword, sender, 'bulk_auto');

        reply(`✅ *Berhasil!*\n\nKata sandi WiFi untuk *semua SSID* telah diubah menjadi: \`${newPassword}\`\n\n🔐 *PENTING:*\n• Simpan kata sandi ini dengan aman\n• Perubahan akan aktif dalam 1-2 menit\n• Modem akan restart otomatis\n• Anda perlu memasukkan kata sandi baru di semua perangkat`);
    } catch (error) {
        console.error(`[BULK_AUTO_PASSWORD_CHANGE] Error:`, error);
        reply(`❌ Maaf, gagal mengubah kata sandi WiFi. Silakan coba lagi atau hubungi admin.\n\nError: ${error.message}`);
    }
}

async function handleSingleSSIDPasswordChange(sender, user, newPassword, reply, global) {
    if (!newPassword || newPassword.trim().length === 0) {
        setUserState(sender, {
            step: 'ASK_NEW_PASSWORD',
            targetUser: user,
            ssid_id: user.ssid_id || '1'
        });

        reply("Silakan ketik kata sandi WiFi baru yang Anda inginkan.\n\n🔐 *Ketentuan kata sandi WiFi:*\n• Minimal 8 karakter\n• Boleh menggunakan huruf, angka, dan simbol\n• Contoh: Password123, MyWiFi2024!\n\n💡 Ketik *batal* jika ingin membatalkan proses ini.");
    } else {
        if (newPassword.length < 8) {
            return reply(`⚠️ Kata sandi terlalu pendek, minimal harus 8 karakter.`);
        }

        // Check config for execution mode
        if (global && global.config && global.config.custom_wifi_modification) {
            // MODE 1: Ask confirmation
            setUserState(sender, {
                step: 'CONFIRM_GANTI_SANDI',
                targetUser: user,
                sandi_wifi_baru: newPassword,
                ssid_id: user.ssid_id || '1'
            });

            reply(`Anda yakin ingin mengubah kata sandi WiFi menjadi: \`${newPassword}\` ?\n\nBalas *'ya'* untuk melanjutkan, atau *'batal'* untuk membatalkan.`);
        } else {
            // MODE 2: Direct execution without confirmation
            const { setPassword } = require('../../lib/wifi');
            try {
                await setPassword(user.device_id, user.ssid_id || '1', newPassword);
                await logWifiPasswordChange(user, newPassword, sender, 'single');

                reply(`✅ *Berhasil!*\n\nKata sandi WiFi telah diubah menjadi: \`${newPassword}\`\n\n📝 *Info Penting:*\n• Perubahan akan aktif dalam 1-2 menit\n• Modem akan restart otomatis\n• Semua perangkat perlu login ulang dengan password baru\n\n⚠️ *Simpan password Anda dengan baik!*\n💡 Jika ada masalah, hubungi admin untuk bantuan.`);
            } catch (error) {
                console.error(`[SINGLE_PASSWORD_CHANGE] Error:`, error);
                reply(`❌ Maaf, gagal mengubah kata sandi WiFi. Silakan coba lagi atau hubungi admin.\n\nError: ${error.message}`);
            }
        }
    }
}

async function logWifiNameChange(user, newName, sender, type) {
    try {
        const { logWifiChange } = require('../../lib/wifi-logger');

        await logWifiChange({
            userId: user.id,
            deviceId: user.device_id,
            changeType: 'name',
            changes: {
                oldName: 'ada',
                newName: newName
            },
            changedBy: 'customer',
            changeSource: 'wa_bot',
            customerName: user.name,
            customerPhone: sender.replace('@s.whatsapp.net', ''),
            reason: `Perubahan nama WiFi melalui WhatsApp Bot (${type})`,
            notes: type === 'bulk_auto' ? `Mengubah nama untuk ${user.bulk.length} SSID` : null
        });
    } catch (error) {
        console.error(`[LOG_WIFI_NAME_CHANGE] Error:`, error);
    }
}

async function logWifiPasswordChange(user, newPassword, sender, type) {
    try {
        const { logWifiChange } = require('../../lib/wifi-logger');

        await logWifiChange({
            userId: user.id,
            deviceId: user.device_id,
            changeType: 'password',
            changes: {
                newPassword: newPassword  // Show actual password as requested by user
            },
            changedBy: 'customer',
            changeSource: 'wa_bot',
            customerName: user.name,
            customerPhone: sender.replace('@s.whatsapp.net', ''),
            reason: `Perubahan password WiFi melalui WhatsApp Bot (${type})`,
            notes: type === 'bulk_auto' ? `Mengubah password untuk ${user.bulk.length} SSID` : null
        });
    } catch (error) {
        console.error(`[LOG_WIFI_PASSWORD_CHANGE] Error:`, error);
    }
}

module.exports = {
    handleGantiNamaWifi,
    handleGantiSandiWifi
};
