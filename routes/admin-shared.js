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

// Pemilik ID aset = `lib/network-assets-service` (dipakai juga wizard WA #ODC/#ODP). Di-re-export di
// sini supaya pemanggil lama tak berubah — TAPI implementasinya HANYA SATU. Jangan salin lagi ke sini.
const { generateAssetId } = require("../lib/network-assets-service");

function getVoucherProfiles() {
    let profiles = global.voucher || [];
    if (!profiles || profiles.length === 0) {
        try {
            profiles = loadJSON("voucher.json");
        } catch (__error) {
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

    // Normalisasi IDENTIK untuk kedua sisi (nomor diminta vs JID recipient) agar
    // pencocokan sentTo akurat. Sebelumnya sisi recipient hanya strip @s.whatsapp.net,
    // sementara sisi requested strip non-digit + 0→62, sehingga input seperti
    // "+62 852-..." bisa tercatat "gagal" padahal pesan benar-benar terkirim.
    const normalizeForCompare = (value) => String(value || "").replace(/\D/g, "").replace(/^0/, "62");
    const delivery = await sendMessageToMany(requestedPhones, { text: message });
    const sentRecipients = new Set((delivery.recipients || []).map(normalizeForCompare));
    const sentTo = requestedPhones.filter((phone) => sentRecipients.has(normalizeForCompare(phone)));
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
