/**
 * Header Doc
 * Purpose: Owner state domain reporting untuk transisi report/gangguan prioritas setelah authority state dipindah dari router utama.
 * Caller: `conversation-state-router`.
 * Deps: `fs`, `path`, `lib/template-service`, helper smart-report, adapter media WA, state manager callback, dan handler reporting existing.
 * MainFuncs: `handleReportingConversationState`.
 * SideEffects: Mengirim reply hasil reporting dan mendelegasikan side effect ke handler reporting existing.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { renderCategoryTemplate } = require("../../../lib/template-service");

function renderResponseTemplate(key, data = {}) {
    const result = renderCategoryTemplate("responseTemplates", key, data);
    return result.found ? result.text : key;
}

const handledReportingSteps = new Set([
    "REPORT_MENU",
    "REPORT_LEMOT_ANALYSIS",
    "TROUBLESHOOT_LEMOT",
    "CONFIRM_MATI_REPORT",
    "REPORT_LEMOT_CONFIRM",
    "REPORT_MATI_TROUBLESHOOT",
    "MATI_TROUBLESHOOT_OPTIONS",
    "REPORT_MATI_PHOTO",
    "MATI_AWAITING_PHOTO",
    "LEMOT_AWAITING_PHOTO",
    "CONFIRM_DIRECT_MATI",
    "DIRECT_LEMOT_TROUBLESHOOT",
    "GANGGUAN_MATI_AWAITING_PHOTO",
    "GANGGUAN_MATI_DEVICE_OFFLINE",
    "GANGGUAN_MATI_DEVICE_ONLINE",
    "GANGGUAN_LEMOT_ANALYSIS",
    "GANGGUAN_LEMOT_AWAITING_RESPONSE",
    "GANGGUAN_LEMOT_CONFIRM_TICKET",
    "TICKET_RESOLVE_UPLOAD_PHOTOS",
    "TICKET_VERIFIED_AWAITING_PHOTOS",
    "TICKET_RESOLVE_ASK_NOTES",
    "TICKET_RESOLVE_CONFIRM"
]);

async function handleReportingConversationState(context) {
    const {
        stateStep,
        stateSender,
        sender,
        chats,
        type,
        msg,
        raf,
        reply,
        deleteUserState,
        handleMenuSelection,
        handleTroubleshootResult,
        handleMatiConfirmation,
        handleMatiTroubleshootOptions,
        handleMatiPhotoUpload,
        handleLemotPhotoUpload,
        handleDirectConfirmation,
        handleDirectLemotResponse,
        downloadMedia,
        getReportsUploadsPath,
        addPhotoToQueue,
        handleCustomerPhotoUpload,
        handleGeneralSteps,
        smartReportState,
        isTeknisi,
        setUserState,
        pushname,
        format,
        handleGangguanMatiOfflineResponse,
        handleGangguanMatiOnlineResponse,
        handleGangguanLemotResponse
    } = context;

    if (!handledReportingSteps.has(stateStep)) {
        return { handled: false };
    }

    if (stateStep === "REPORT_MENU") {
        const result = await handleMenuSelection({
            sender,
            stateKey: stateSender,
            choice: chats,
            reply,
            msg,
            raf
        });
        if (result.message) {
            await reply(result.message);
        }
        if (result.success && (chats.trim() === "3" || chats.includes("lain"))) {
            deleteUserState(stateSender);
        }
        return { handled: true };
    }

    if (stateStep === "REPORT_LEMOT_ANALYSIS" || stateStep === "TROUBLESHOOT_LEMOT") {
        const result = await handleTroubleshootResult({
            sender: stateSender,
            response: chats,
            reply
        });
        if (result.message) {
            await reply(result.message);
        }
        return { handled: true };
    }

    if (stateStep === "CONFIRM_MATI_REPORT" || stateStep === "REPORT_LEMOT_CONFIRM") {
        const result = await handleMatiConfirmation({
            sender: stateSender,
            response: chats,
            reply
        });
        if (result.message) {
            await reply(result.message);
        }
        return { handled: true };
    }

    if (stateStep === "REPORT_MATI_TROUBLESHOOT" || stateStep === "MATI_TROUBLESHOOT_OPTIONS") {
        const result = await handleMatiTroubleshootOptions({
            sender: stateSender,
            response: chats,
            reply
        });
        if (result.message) {
            await reply(result.message);
        }
        return { handled: true };
    }

    if (stateStep === "REPORT_MATI_PHOTO" || stateStep === "MATI_AWAITING_PHOTO") {
        if (type === "imageMessage") {
            try {
                const buffer = await downloadMedia(msg, "buffer", {});
                const fileName = `photo_${Date.now()}.jpg`;
                const photoPath = path.join(__dirname, "../../../uploads", fileName);
                const uploadsDir = path.dirname(photoPath);

                if (!fs.existsSync(uploadsDir)) {
                    fs.mkdirSync(uploadsDir, { recursive: true });
                }

                fs.writeFileSync(photoPath, buffer);

                const result = await handleMatiPhotoUpload({
                    sender: stateSender,
                    response: null,
                    photoPath: fileName,
                    photoBuffer: buffer,
                    reply
                });
                if (result.message) {
                    await reply(result.message);
                }
            } catch (error) {
                console.error("[PHOTO_UPLOAD] Error handling image:", error);
                await reply(format("error_photo_process_failed"));
            }
            return { handled: true };
        }

        const result = await handleMatiPhotoUpload({
            sender: stateSender,
            response: type === "conversation" ? chats : null,
            photoPath: null,
            reply
        });
        if (result.message) {
            await reply(result.message);
        }
        return { handled: true };
    }

    if (stateStep === "LEMOT_AWAITING_PHOTO") {
        if (type === "imageMessage") {
            try {
                const buffer = await downloadMedia(msg, "buffer", {});
                const fileName = `photo_${Date.now()}.jpg`;
                const photoPath = path.join(__dirname, "../../../uploads", fileName);
                const uploadsDir = path.dirname(photoPath);

                if (!fs.existsSync(uploadsDir)) {
                    fs.mkdirSync(uploadsDir, { recursive: true });
                }

                fs.writeFileSync(photoPath, buffer);

                const result = await handleLemotPhotoUpload({
                    sender: stateSender,
                    response: null,
                    photoPath: fileName,
                    photoBuffer: buffer,
                    reply
                });
                if (result.message) {
                    await reply(result.message);
                }
            } catch (error) {
                console.error("[PHOTO_UPLOAD_ERROR]", error);
                await reply(format("error_photo_receive_failed"));
            }
            return { handled: true };
        }

        const result = await handleLemotPhotoUpload({
            sender: stateSender,
            response: chats,
            photoPath: null,
            reply
        });
        if (result.message) {
            await reply(result.message);
        }
        return { handled: true };
    }

    if (stateStep === "CONFIRM_DIRECT_MATI") {
        const result = await handleDirectConfirmation({
            sender: stateSender,
            response: chats,
            reply
        });
        if (result.message) {
            await reply(result.message);
        }
        return { handled: true };
    }

    if (stateStep === "DIRECT_LEMOT_TROUBLESHOOT") {
        const result = await handleDirectLemotResponse({
            sender: stateSender,
            response: chats,
            reply
        });
        if (result.message) {
            await reply(result.message);
        }
        return { handled: true };
    }

    if (stateStep === "GANGGUAN_MATI_AWAITING_PHOTO") {
        if (type === "imageMessage") {
            try {
                if (smartReportState.uploadedPhotos && smartReportState.uploadedPhotos.length >= 3) {
                    await reply(format("error_photo_max_limit"));
                    return { handled: true };
                }

                const buffer = await downloadMedia(msg, "buffer", {});
                const date = new Date();
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, "0");
                const ticketId = smartReportState.ticketData.ticketId;
                const timestamp = Date.now();
                const fileName = `customer_${ticketId}_${timestamp}.jpg`;
                const uploadDir = getReportsUploadsPath(year, month, ticketId, path.join(__dirname, "..", ".."));

                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                }

                const filePath = path.join(uploadDir, fileName);
                fs.writeFileSync(filePath, buffer);

                smartReportState.uploadedPhotos = smartReportState.uploadedPhotos || [];
                smartReportState.uploadedPhotos.push({
                    fileName,
                    path: filePath,
                    uploadedAt: date.toISOString(),
                    size: buffer.length,
                    uploadedBy: "customer"
                });

                smartReportState.photoBuffers = smartReportState.photoBuffers || [];
                smartReportState.photoBuffers.push(buffer);
                smartReportState.startTime = smartReportState.startTime || Date.now();

                const stateToSave = { ...smartReportState };
                delete stateToSave.photoBuffers;
                setUserState(stateSender, stateToSave);

                const photoCount = smartReportState.uploadedPhotos.length;
                const remaining = 3 - photoCount;
                await reply(renderResponseTemplate("reporting_photo_progress_received", {
                    photoCount,
                    remainingLine: remaining > 0 ? `- Bisa upload ${remaining} foto lagi` : "- Maksimal 3 foto tercapai"
                }));
            } catch (error) {
                console.error("[CUSTOMER_PHOTO_UPLOAD_ERROR]", error);
                await reply(format("error_photo_upload_failed"));
            }
            return { handled: true };
        }

        const result = await handleCustomerPhotoUpload({
            sender: stateSender,
            state: smartReportState,
            chats,
            reply
        });
        if (result.message) {
            await reply(result.message);
        }
        return { handled: true };
    }

    if (
        stateStep === "TICKET_RESOLVE_UPLOAD_PHOTOS" ||
        stateStep === "TICKET_VERIFIED_AWAITING_PHOTOS" ||
        stateStep === "TICKET_RESOLVE_ASK_NOTES" ||
        stateStep === "TICKET_RESOLVE_CONFIRM"
    ) {
        if (
            (stateStep === "TICKET_RESOLVE_UPLOAD_PHOTOS" || stateStep === "TICKET_VERIFIED_AWAITING_PHOTOS") &&
            type === "imageMessage"
        ) {
            if (stateStep === "TICKET_VERIFIED_AWAITING_PHOTOS" && !smartReportState.otpVerifiedAt) {
                await reply(format("error_not_verified"));
                return { handled: true };
            }

            try {
                const buffer = await downloadMedia(msg, "buffer", {});
                const ticketId = smartReportState.ticketIdToResolve || smartReportState.ticketId;
                const teknisiName = isTeknisi?.username || pushname || "teknisi";
                const result = await addPhotoToQueue({
                    sender: stateSender,
                    buffer,
                    state: smartReportState,
                    teknisiName,
                    ticketId,
                    reply
                });

                if (result.queued) {
                    console.log(`[PHOTO_QUEUE] Photo ${result.count} queued for ${sender}`);
                }
            } catch (error) {
                console.error("[UPLOAD_PHOTO_ERROR]", error);
            }
            return { handled: true };
        }

        const result = await handleGeneralSteps({
            userState: smartReportState,
            sender: stateSender,
            chats,
            pushname,
            reply,
            setUserState,
            deleteUserState
        });
        if (result.message) {
            await reply(result.message);
        }
        return { handled: true };
    }

    if (stateStep === "GANGGUAN_MATI_DEVICE_OFFLINE") {
        const result = await handleGangguanMatiOfflineResponse({
            sender: stateSender,
            body: chats,
            reply,
            findUserByPhone: null,
            msg,
            raf
        });
        if (result?.message) {
            await reply(result.message);
        }
        return { handled: true };
    }

    if (stateStep === "GANGGUAN_MATI_DEVICE_ONLINE") {
        const result = await handleGangguanMatiOnlineResponse({
            sender: stateSender,
            body: chats,
            reply,
            msg,
            raf
        });
        if (result?.message) {
            await reply(result.message);
        }
        return { handled: true };
    }

    const result = await handleGangguanLemotResponse({
        sender: stateSender,
        body: chats,
        reply,
        msg,
        raf
    });
    if (result?.message) {
        await reply(result.message);
    }
    return { handled: true };
}

module.exports = {
    handledReportingSteps,
    handleReportingConversationState
};
