/**
 * Header Doc
 * Purpose: Menangani state konfirmasi miscellaneous seperti cancel tiket, reboot, power, dan pilihan paket.
 * Caller: `conversation-state-handler.js`.
 * Deps: `conversation-handler`, `ticket-workflow`, `lib/wifi`, dan `lib/template-service`.
 * MainFuncs: `handleConfirmCancelTicket`, `handleConfirmReboot`, `handleSelectSodChoice`, `handleConfirmSodChoice`, `handleAskPackageChoice`, `handleConfirmPackageChoice`.
 * SideEffects: Mengirim reply berbasis responseTemplates, memanggil operasi tiket/WiFi, dan membersihkan state.
 */

const { deleteUserState } = require("../conversation-handler");
const { cancelTicket } = require("../../../lib/ticket-workflow");
const { rebootRouter } = require("../../../lib/wifi");
const { renderCategoryTemplate } = require("../../../lib/template-service");

function renderResponseTemplate(key, data = {}) {
    const result = renderCategoryTemplate("responseTemplates", key, data);
    return result.found ? result.text : key;
}

async function handleConfirmCancelTicket(userState, userReply, reply, sender, global, pushname) {
    if (["ya", "ok", "lanjut", "iya", "y"].includes(userReply)) {
        const { ticketIdToCancel } = userState;
        try {
            const { ticket } = cancelTicket({
                ticketId: ticketIdToCancel,
                actor: {
                    sender,
                    id: sender,
                    name: pushname || "Pelanggan",
                    channel: "wa"
                },
                reason: "Dibatalkan oleh pelanggan via WhatsApp",
                cancelledByType: "pelanggan"
            });

            console.warn("[legacyCancelAdapterUsed]", {
                ticketId: ticket.ticketId || ticket.id,
                sender
            });

            await reply(renderResponseTemplate("other_cancel_ticket_success", { ticketId: ticketIdToCancel }));
            deleteUserState(sender);
            return;
        } catch (error) {
            if (error.code === "NOT_FOUND") {
                deleteUserState(sender);
                return reply(renderResponseTemplate("other_cancel_ticket_not_found"));
            }

            if (error.code === "ALREADY_COMPLETED") {
                deleteUserState(sender);
                return reply(renderResponseTemplate("other_cancel_ticket_completed"));
            }

            if (error.code === "ALREADY_CANCELLED") {
                deleteUserState(sender);
                return reply(renderResponseTemplate("other_cancel_ticket_already_cancelled"));
            }

            console.error("[legacyCancelAdapterError]", {
                ticketId: ticketIdToCancel,
                sender,
                error: error.message
            });
            return reply(renderResponseTemplate("other_cancel_ticket_not_found"));
        }
    }

    reply(renderResponseTemplate("other_cancel_ticket_confirm_invalid"));
}

async function handleConfirmReboot(userState, userReply, reply, sender, _global) {
    // Reboot memutus koneksi seisi rumah → HANYA jalan pada persetujuan BERSIH. Dulu pakai
    // isAffirmative yang terlalu longgar (token "bisa/tolong/siap/mau") sehingga pesan lain
    // ("bisa cek tagihan?", "siap kak makasih") ikut memicu reboot. isCleanRebootConsent menuntut
    // SELURUH kata = afirmasi/sapaan/aksi-reboot & tanpa tanda tanya.
    const { isAffirmative, isCleanRebootConsent, isDecline } = require("../../../lib/affirmative-parser");
    if (isCleanRebootConsent(userReply)) {
        const { targetUser } = userState;
        reply(renderResponseTemplate("other_reboot_processing", { customerName: targetUser.name }));

        try {
            // featureScope diset saat memulai konfirmasi (adminReboot untuk owner/teknisi,
            // customerReboot untuk pelanggan) agar gate fitur GenieACS tidak salah dipakai.
            const result = await rebootRouter(targetUser.device_id, {
                operation: "wa.confirmReboot",
                featureScope: userState.featureScope || "adminReboot"
            });
            if (!result.ok) {
                throw new Error(result.message || "Task reboot gagal dikirim");
            }

            // `result.ok` hanya berarti GenieACS MENERIMA task (applied selalu null) — bukan bukti
            // modem restart. Dulu di sini ada `setTimeout(console.log("rebooted successfully"))`:
            // klaim sukses tanpa verifikasi, dan pelanggan ditinggal diam setelah dijanjikan
            // "tunggu 5-10 menit". Sekarang jadwalkan pekerjaan follow-up DURABEL yang
            // memverifikasi modem benar-benar kembali lalu mengabari pelanggan.
            if ((userState.featureScope || "adminReboot") === "customerReboot") {
                try {
                    const { scheduleFollowupForReboot } = require("../../../lib/reboot-followup-service");
                    scheduleFollowupForReboot({ user: targetUser, jid: sender, reason: "reboot_modem_intent" });
                } catch (scheduleError) {
                    console.error("[REBOOT] Gagal menjadwalkan follow-up:", scheduleError.message);
                }
            }
        } catch (error) {
            console.error("[REBOOT_ERROR]", error);
            reply(renderResponseTemplate("other_reboot_failed"));
        }

        deleteUserState(sender);
    } else if (isDecline(userReply) || ["batal", "cancel", "ga jadi", "gak jadi"].includes(String(userReply || "").toLowerCase().trim())) {
        deleteUserState(sender);
        reply(renderResponseTemplate("other_cancelled"));
    } else if (isAffirmative(userReply)) {
        // Afirmasi AMBIGU (ada kata afirmatif + muatan lain, mis. "siap kak makasih",
        // "bisa cek tagihan?") → JANGAN reboot. Lepaskan konfirmasi & arahkan pelanggan.
        deleteUserState(sender);
        reply(renderResponseTemplate(
            "other_reboot_unclear",
            "Baik Kak 🙏 Kalau memang mau modemnya dinyalakan ulang, cukup balas *ya*. Untuk kebutuhan lain silakan ketik ulang atau *menu* ya."
        ));
    } else {
        reply(renderResponseTemplate("other_reboot_confirm_invalid"));
    }
}

async function handleAwaitingComplaint(userState, chats, reply, sender, pushname) {
    const complaint = (chats || "").trim();
    if (!complaint) {
        return reply(renderResponseTemplate("general_complaint_empty"));
    }

    const complaintData = {
        id: Date.now().toString(),
        userId: userState.user?.id,
        userName: userState.user?.name,
        userPhone: userState.user?.phone_number,
        complaint,
        createdAt: new Date().toISOString(),
        status: "new"
    };
    console.log("[NEW_COMPLAINT]", complaintData);

    deleteUserState(sender);
    return reply(renderResponseTemplate("general_complaint_received", {
        pushname,
        complaintId: complaintData.id,
        complaint,
        receivedAt: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
    }));
}

async function handleSelectSodChoice(userState, userReply, reply, convertRupiah) {
    const chosenIndex = parseInt(userReply, 10);
    const selectedOption = userState.options.find((opt) => opt.index === chosenIndex);

    if (!selectedOption) {
        return reply(renderResponseTemplate("other_choice_invalid", { maxChoice: userState.options.length }));
    }

    userState.selectedOption = selectedOption;
    userState.step = "CONFIRM_SOD_CHOICE";

    const durationText = selectedOption.duration === 1 ? "1 Hari" : `${selectedOption.duration} Hari`;

    return reply(renderResponseTemplate("other_sod_confirm", {
        packageName: selectedOption.package.name,
        durationText,
        priceText: convertRupiah.convert(selectedOption.price)
    }));
}

async function handleConfirmSodChoice(userState, userReply, reply, sender, _global) {
    if (["ya", "ok", "lanjut", "iya", "y"].includes(userReply)) {
        const { selectedOption } = userState;
        const paymentCode = `SOD${Date.now().toString().slice(-6)}`;

        reply(renderResponseTemplate("other_sod_payment_success", {
            packageName: selectedOption.package.name,
            durationDays: selectedOption.duration,
            priceText: selectedOption.price,
            paymentCode
        }));
        deleteUserState(sender);
        return;
    }

    reply(renderResponseTemplate("other_sod_cancelled"));
    deleteUserState(sender);
}

async function handleAskPackageChoice(userState, userReply, reply, convertRupiah) {
    const chosenIndex = parseInt(userReply, 10);
    const selectedPackage = userState.options[chosenIndex - 1];

    if (!selectedPackage) {
        return reply(renderResponseTemplate("other_choice_invalid", { maxChoice: userState.options.length }));
    }

    userState.selectedPackage = selectedPackage;
    userState.step = "CONFIRM_PACKAGE_CHOICE";

    const newPrice = selectedPackage.price * 0.9;
    const newPriceFormatted = convertRupiah.convert(Math.floor(newPrice));

    return reply(renderResponseTemplate("other_package_confirm", {
        packageName: selectedPackage.name,
        priceText: newPriceFormatted
    }));
}

async function handleConfirmPackageChoice(userState, userReply, reply, sender, _global) {
    if (["ya", "ok", "lanjut", "iya", "y"].includes(userReply)) {
        const { user, selectedPackage } = userState;

        reply(renderResponseTemplate("other_package_success", {
            oldPackage: user.subscription || "Belum ada",
            newPackage: selectedPackage.name,
            newPrice: selectedPackage.priceFormatted
        }));
        deleteUserState(sender);
        return;
    }

    reply(renderResponseTemplate("other_package_cancelled"));
    deleteUserState(sender);
}

module.exports = {
    handleConfirmCancelTicket,
    handleConfirmReboot,
    handleAwaitingComplaint,
    handleSelectSodChoice,
    handleConfirmSodChoice,
    handleAskPackageChoice,
    handleConfirmPackageChoice
};
