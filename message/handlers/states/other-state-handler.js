/**
 * Header Doc
 * Purpose: Menangani state konfirmasi miscellaneous seperti cancel tiket, reboot, power, dan pilihan paket.
 * Caller: `conversation-state-handler.js`.
 * Deps: `conversation-handler`, `ticket-workflow`, `lib/wifi`, dan `lib/template-service`.
 * MainFuncs: `handleConfirmCancelTicket`, `handleConfirmReboot`, `handleAskPowerLevel`, `handleConfirmGantiPower`, `handleSelectSodChoice`, `handleConfirmSodChoice`, `handleAskPackageChoice`, `handleConfirmPackageChoice`.
 * SideEffects: Mengirim reply berbasis responseTemplates, memanggil operasi tiket/WiFi, dan membersihkan state.
 */

const { deleteUserState } = require("../conversation-handler");
const { cancelTicket } = require("../../../lib/ticket-workflow");
const { rebootRouter, setTransmitPower } = require("../../../lib/wifi");
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
    if (["ya", "ok", "lanjut", "iya", "y"].includes(userReply)) {
        const { targetUser } = userState;
        reply(renderResponseTemplate("other_reboot_processing", { customerName: targetUser.name }));

        try {
            const result = await rebootRouter(targetUser.device_id, { operation: "wa.confirmReboot" });
            if (!result.ok) {
                throw new Error(result.message || "Task reboot gagal dikirim");
            }

            setTimeout(() => {
                console.log(`[REBOOT] Modem ${targetUser.name} rebooted successfully`);
            }, 5000);
        } catch (error) {
            console.error("[REBOOT_ERROR]", error);
            reply(renderResponseTemplate("other_reboot_failed"));
        }

        deleteUserState(sender);
    } else if (["batal", "cancel", "ga jadi", "gak jadi"].includes(userReply)) {
        deleteUserState(sender);
        reply(renderResponseTemplate("other_cancelled"));
    } else {
        reply(renderResponseTemplate("other_reboot_confirm_invalid"));
    }
}

async function handleAskPowerLevel(userState, chats, reply) {
    const newPowerLevel = chats.trim();

    if (!["100", "80", "60", "40", "20"].includes(newPowerLevel)) {
        return reply(renderResponseTemplate("other_power_level_invalid"));
    }

    userState.step = "CONFIRM_GANTI_POWER";
    userState.level_daya = newPowerLevel;
    return reply(renderResponseTemplate("other_power_confirm", { powerLevel: newPowerLevel }));
}

async function handleConfirmGantiPower(userState, userReply, reply, sender, _global) {
    if (["ya", "ok", "lanjut", "iya", "y"].includes(userReply)) {
        const { targetUser, level_daya } = userState;
        reply(renderResponseTemplate("other_power_processing", { customerName: targetUser.name }));

        try {
            const result = await setTransmitPower(targetUser.device_id, "1", level_daya, {
                operation: "wa.confirmGantiPower",
                verifyApplied: false
            });
            if (!result.ok) {
                throw new Error(result.message || "Task perubahan power gagal dikirim");
            }

            reply(renderResponseTemplate("other_power_success", { powerLevel: level_daya }));
        } catch (error) {
            console.error("[GANTIPOWER_ERROR]", error);
            reply(renderResponseTemplate("other_power_failed"));
        }

        deleteUserState(sender);
    } else {
        reply(renderResponseTemplate("other_power_confirm_invalid"));
    }
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
    handleAskPowerLevel,
    handleConfirmGantiPower,
    handleSelectSodChoice,
    handleConfirmSodChoice,
    handleAskPackageChoice,
    handleConfirmPackageChoice
};
