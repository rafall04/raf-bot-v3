/**
 * Header Doc
 * Purpose: Owner state domain teknisi untuk upload foto completion, share location perjalanan, dan transisi legacy completion teknisi.
 * Caller: `conversation-state-router`.
 * Deps: Media adapter, path helper, `lib/template-service`, `legacy-teknisi-state-handler`, `simple-location-handler`, dan workflow teknisi existing.
 * MainFuncs: `handleTeknisiConversationState`.
 * SideEffects: Menyimpan foto dokumentasi teknisi, memperbarui state teknisi/perjalanan, dan mengirim reply.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { renderCategoryTemplate } = require("../../../lib/template-service");

function renderResponseTemplate(key, data = {}) {
    const result = renderCategoryTemplate("responseTemplates", key, data);
    return result.found ? result.text : key;
}

const photoStateSteps = new Set([
    "AWAITING_COMPLETION_PHOTOS",
    "AWAITING_PHOTO_CATEGORY_1",
    "AWAITING_PHOTO_CATEGORY_2",
    "AWAITING_PHOTO_CATEGORY_3",
    "AWAITING_PHOTO_EXTRA"
]);

async function handleTeknisiConversationState(context) {
    const {
        stateStep,
        teknisiState,
        type,
        msg,
        sender,
        chats,
        stateSender,
        reply,
        downloadMedia,
        getTeknisiUploadsPathByTicket,
        handleTeknisiPhotoUpload,
        setUserState,
        deleteUserState,
        format,
        handleCompleteTicket,
        handleTeknisiResolutionNotesState,
        handleTeknisiCompletionConfirmationState,
        handleTeknisiShareLocation,
        handleLegacyTeknisiStateTransitions
    } = context;

    if (!stateStep) {
        return { handled: false };
    }

    if (stateStep === "AWAITING_LOCATION_FOR_JOURNEY" && (type === "locationMessage" || type === "liveLocationMessage")) {
        const locationData = type === "locationMessage"
            ? msg?.message?.locationMessage
            : msg?.message?.liveLocationMessage;

        if (!locationData || !locationData.degreesLatitude || !locationData.degreesLongitude) {
            console.error("[LOCATION_ERROR] Invalid location data:", locationData);
            await reply(format("error_location_invalid"));
            return { handled: true };
        }

        const locationResult = await handleTeknisiShareLocation(
            sender,
            {
                degreesLatitude: locationData.degreesLatitude,
                degreesLongitude: locationData.degreesLongitude,
                accuracyInMeters: locationData.accuracyInMeters
            },
            reply
        );
        if (locationResult?.message) {
            await reply(locationResult.message);
        }
        return { handled: true };
    }

    if (photoStateSteps.has(stateStep) && type === "imageMessage") {
        try {
            const buffer = await downloadMedia(msg, "buffer", {});
            if (!buffer || buffer.length === 0) {
                throw new Error("Downloaded buffer is empty or null");
            }

            const ticketId = teknisiState.ticketId;
            if (!ticketId) {
                throw new Error("Ticket ID not found in teknisi state");
            }

            const date = new Date();
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, "0");
            const timestamp = Date.now();
            const random = Math.random().toString(36).substring(7);
            const fileName = `photo_${timestamp}_${random}.jpg`;
            const uploadsDir = getTeknisiUploadsPathByTicket(year, month, ticketId, __dirname);
            const photoPath = path.join(uploadsDir, fileName);

            if (!fs.existsSync(uploadsDir)) {
                fs.mkdirSync(uploadsDir, { recursive: true });
            }

            fs.writeFileSync(photoPath, buffer);

            const result = await handleTeknisiPhotoUpload(sender, fileName);
            if (result.message) {
                await reply(result.message);
            }
        } catch (error) {
            console.error("[TEKNISI_PHOTO_ERROR]", error);
            await reply(renderResponseTemplate("teknisi_photo_receive_failed"));
        }
        return { handled: true };
    }

    return handleLegacyTeknisiStateTransitions({
        teknisiState,
        chats,
        stateSender,
        setUserState,
        deleteUserState,
        reply,
        format,
        handleCompleteTicket,
        handleTeknisiResolutionNotesState,
        handleTeknisiCompletionConfirmationState
    });
}

module.exports = {
    photoStateSteps,
    handleTeknisiConversationState
};
