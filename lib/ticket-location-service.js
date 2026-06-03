/**
 * Header Doc
 * Purpose: Owner persistensi & notifikasi lokasi teknisi untuk tiket aktif, dipakai lintas kanal (WhatsApp & web teknisi) agar satu sumber kebenaran.
 * Caller: `routes/tickets-workflow-routes.js` (endpoint web share-location) dan kandidat reuse oleh handler lokasi WhatsApp.
 * Deps: `fs`, `path`, `./report-notification-service`, `./template-service`.
 * MainFuncs: `persistTicketLocation`, `notifyCustomerLocation`, `buildGoogleMapsUrl`, `getLocationFilePath`.
 * SideEffects: Menulis file lokasi `database/locations/<ticketId>.json` dan mengirim notifikasi WhatsApp ke pelanggan.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { notifyCustomerTicketUpdate } = require("./report-notification-service");
const { renderCategoryTemplate } = require("./template-service");

const LOCATIONS_DIR = path.join(__dirname, "..", "database", "locations");

function buildGoogleMapsUrl(latitude, longitude) {
    return `https://maps.google.com/?q=${latitude},${longitude}`;
}

function getLocationFilePath(ticketId) {
    return path.join(LOCATIONS_DIR, `${ticketId}.json`);
}

function renderResponseTemplate(key, fallback, data = {}) {
    const result = renderCategoryTemplate("responseTemplates", key, data);
    return result.found && result.text && result.text.trim() ? result.text : fallback;
}

/**
 * Simpan lokasi teknisi ke file shared store (format identik dengan handler WhatsApp
 * agar perintah pelanggan `lokasi <ticketId>` membaca data yang sama).
 */
function persistTicketLocation({ ticketId, teknisiId, latitude, longitude, accuracy = null }) {
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
        const error = new Error("Koordinat lokasi tidak valid");
        error.code = "INVALID_LOCATION";
        throw error;
    }

    const locationData = {
        ticketId,
        teknisiId: teknisiId || null,
        latitude: lat,
        longitude: lng,
        accuracy: accuracy != null ? accuracy : null,
        timestamp: Date.now(),
        lastUpdate: new Date().toISOString(),
        googleMapsUrl: buildGoogleMapsUrl(lat, lng)
    };

    if (!fs.existsSync(LOCATIONS_DIR)) {
        fs.mkdirSync(LOCATIONS_DIR, { recursive: true });
    }
    fs.writeFileSync(getLocationFilePath(ticketId), JSON.stringify(locationData, null, 2));

    return locationData;
}

/**
 * Kirim notifikasi lokasi terbaru ke pelanggan, lengkap dengan link Google Maps + OTP.
 */
async function notifyCustomerLocation(ticket, locationData) {
    const teknisiName = ticket.processedByTeknisiName || ticket.teknisiName || "Teknisi";
    const otp = ticket.otp || null;
    const otpSection = otp
        ? `\n🔐 *KODE VERIFIKASI:* *${otp}*\n_Siapkan kode ini untuk teknisi._`
        : "";

    const message = renderResponseTemplate(
        "ticket_share_location_customer",
        `📍 *LOKASI TEKNISI TERBARU*\n\n📋 ID Tiket: *${ticket.ticketId || ticket.id}*\n🔧 Teknisi: *${teknisiName}*\n\nTeknisi sedang menuju lokasi Anda.\n\n📱 *Lihat di Google Maps:*\n${locationData.googleMapsUrl}\n\n⏱️ Update: ${new Date(locationData.timestamp).toLocaleTimeString("id-ID")}\n${otpSection}`,
        {
            ticketId: ticket.ticketId || ticket.id,
            teknisiName,
            googleMapsUrl: locationData.googleMapsUrl,
            updateTime: new Date(locationData.timestamp).toLocaleTimeString("id-ID"),
            otpSection
        }
    );

    return notifyCustomerTicketUpdate(ticket, message, {
        flow: "ticket",
        step: "share_location"
    });
}

module.exports = {
    LOCATIONS_DIR,
    buildGoogleMapsUrl,
    getLocationFilePath,
    persistTicketLocation,
    notifyCustomerLocation
};
