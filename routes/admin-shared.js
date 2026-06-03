/**
 * Header Doc
 * Purpose: Menyediakan helper bersama untuk registrar admin hasil pemecahan bounded context.
 * Caller: `routes/admin-router.js` dan registrar admin domain.
 * Deps: `lib/database` dan `lib/whatsapp-delivery-service`.
 * MainFuncs: `generateAssetId`, `getVoucherProfiles`, `getVoucherProfileById`, `buildVoucherProfileSnapshot`, `sendVoucherTextToPhones`.
 * SideEffects: Membaca file JSON voucher dan mengirim pesan WhatsApp melalui delivery service bila dipanggil.
 */
"use strict";

const { loadJSON } = require("../lib/database");
const { sendMessageToMany } = require("../lib/whatsapp-delivery-service");

function generateAssetId(type, parentOdcId = null, existingAssets = [], assetName = "") {
    let prefix = "";
    let baseCode = "XXX";
    let sequenceNumber = 1;
    if (type === "ODC") prefix = "ODC";
    else if (type === "ODP") prefix = "ODP";
    else return `ASSET-UNKNOWN-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    if (type === "ODP" && parentOdcId) {
        const parentMatch = parentOdcId.match(/^ODC-([A-Z0-9]+(?:-[0-9]+)?)/i);
        if (parentMatch && parentMatch[1]) baseCode = parentMatch[1].replace(/-/g, "");
        else if (parentOdcId.length >= 3) {
            baseCode = parentOdcId.substring(0, Math.min(parentOdcId.length, 7)).toUpperCase().replace(/[^A-Z0-9]/gi, "");
            if (baseCode.length === 0) baseCode = "PARENT";
        }
    } else if (assetName) {
        const nameParts = assetName.trim().toUpperCase().split(/\s+|_|-/);
        let generatedBase = "";
        if (nameParts.length > 1 && nameParts[0].length > 0 && nameParts[1].length > 0) {
            generatedBase = `${nameParts[0].substring(0, Math.min(nameParts[0].length, 3))}${nameParts[1].substring(0, Math.min(nameParts[1].length, 2))}`;
        } else if (nameParts[0].length >= 3) generatedBase = nameParts[0].substring(0, 3);
        else if (nameParts[0].length > 0) {
            generatedBase = nameParts[0];
            while (generatedBase.length < 3 && generatedBase.length > 0) generatedBase += "X";
        }
        baseCode = generatedBase.substring(0, 7).replace(/[^A-Z0-9]/gi, "");
    }

    if (baseCode.length === 0) baseCode = "GEN";
    const relevantAssets = (type === "ODP" && parentOdcId)
        ? existingAssets.filter((asset) => asset.type === "ODP" && asset.parent_odc_id === parentOdcId)
        : existingAssets.filter((asset) => asset.type === type && asset.id.startsWith(`${prefix}-${baseCode}-`));

    sequenceNumber = relevantAssets.length + 1;
    const formattedSequence = String(sequenceNumber).padStart(3, "0");
    const newPotentialId = `${prefix}-${baseCode}-${formattedSequence}`;
    let uniquenessCounter = 0;
    let finalId = newPotentialId;
    while (existingAssets.some((asset) => asset.id === finalId)) {
        uniquenessCounter++;
        finalId = `${newPotentialId}_${uniquenessCounter}`;
        if (uniquenessCounter > 20) {
            finalId = `${newPotentialId}_${Math.random().toString(36).substring(2, 7)}`;
            if (existingAssets.some((asset) => asset.id === finalId)) finalId = `${newPotentialId}_${Date.now().toString().slice(-5)}`;
            break;
        }
    }
    return finalId;
}

function getVoucherProfiles() {
    let profiles = global.voucher || [];
    if (!profiles || profiles.length === 0) {
        try {
            profiles = loadJSON("voucher.json");
        } catch (_error) {
            profiles = [];
        }
    }
    return Array.isArray(profiles) ? profiles : [];
}

function getVoucherProfileById(profileId) {
    return getVoucherProfiles().find((item) => item.prof === profileId) || null;
}

function buildVoucherProfileSnapshot(profile) {
    if (!profile) return null;
    return {
        prof: profile.prof,
        namavc: profile.namavc,
        durasivc: profile.durasivc,
        hargavc: profile.hargavc,
        hargaReseller: profile.hargaReseller,
        margin: profile.margin
    };
}

async function sendVoucherTextToPhones(message, phones) {
    const requestedPhones = Array.isArray(phones) ? phones.map((phone) => String(phone || "").trim()).filter(Boolean) : [];
    if (requestedPhones.length === 0) return { requestedPhones, sentTo: [], failedTo: [] };

    const delivery = await sendMessageToMany(requestedPhones, { text: message });
    const sentRecipients = new Set((delivery.recipients || []).map((recipient) => String(recipient || "").replace(/@s\.whatsapp\.net$/, "")));
    const sentTo = requestedPhones.filter((phone) => {
        const normalized = String(phone || "").replace(/\D/g, "").replace(/^0/, "62");
        return sentRecipients.has(normalized);
    });
    const failedTo = requestedPhones.filter((phone) => !sentTo.includes(phone));

    return { requestedPhones, sentTo, failedTo };
}

module.exports = {
    generateAssetId,
    getVoucherProfiles,
    getVoucherProfileById,
    buildVoucherProfileSnapshot,
    sendVoucherTextToPhones
};
