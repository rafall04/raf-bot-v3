/**
 * Header Doc
 * Purpose: Service registrasi pelanggan SELF-SERVICE dari site publik. Menyimpan calon pelanggan
 *   sebagai LEAD PSB berstatus 'lead_online' yang TERKARANTINA dari pipeline instalasi staf — TIDAK
 *   menyentuh MikroTik/GenieACS/movePSBToUsers — lalu memberi tahu admin (andal, retry+dead-letter)
 *   dan calon pelanggan (best-effort). Anti-bot Turnstile diverifikasi fail-closed sebelum menyimpan.
 * Caller: routes/public-site.js (POST /api/public/register, hanya di listener publik).
 * Deps: lib/turnstile, lib/psb-database (getNextAvailablePSBId/insertPSBRecord),
 *   repositories/api-psb.repository (updatePsbRecordsSnapshot), lib/admin-recipients (getAdminJids),
 *   lib/whatsapp-critical-delivery (sendCritical), lib/whatsapp-delivery-service (sendMessage),
 *   lib/whatsapp-gateway (hasAuthenticatedSession), lib/utils (normalizePhoneNumber), lib/templating.
 * MainFuncs: submitPublicRegistration.
 * SideEffects: Menulis 1 record PSB (lead) + memutakhirkan snapshot psbRecords + kirim notifikasi WA.
 */
"use strict";

const { verifyTurnstile } = require("../turnstile");
const { getNextAvailablePSBId, insertPSBRecord } = require("../psb-database");
const { createApiPsbRepository } = require("../../repositories/api-psb.repository");
const { getAdminJids } = require("../admin-recipients");
const { sendCritical } = require("../whatsapp-critical-delivery");
const { sendMessage } = require("../whatsapp-delivery-service");
const { hasAuthenticatedSession } = require("../whatsapp-gateway");
const { normalizePhoneNumber } = require("../utils");
const { renderTemplate } = require("../templating");

const LEAD_STATUS = "lead_online";

// Kirim alert ke tiap JID admin via sendCritical (retry + dead-letter). TIDAK pernah throw —
// kegagalan notifikasi tidak boleh menggagalkan pendaftaran yang sudah tersimpan.
async function notifyAdmins(text) {
    const jids = getAdminJids();
    if (!jids.length) {
        console.error("[PUBLIC_REG] Tidak ada JID admin valid untuk notifikasi lead.");
        return;
    }
    for (const jid of jids) {
        try {
            await sendCritical(jid, { text }, { label: "registrasi-lead" });
        } catch (e) {
            console.error(`[PUBLIC_REG] Gagal kirim notif lead ke ${jid}:`, e.message);
        }
    }
}

/**
 * Simpan pendaftaran publik sebagai lead PSB terkarantina + notifikasi.
 * @returns {Promise<{ ok: boolean, customerId?: number, code?: string, message?: string }>}
 */
async function submitPublicRegistration({
    name,
    phone,
    address,
    latitude = null,
    longitude = null,
    locationUrl = null,
    packageInterest = null,
    turnstileToken = null,
    requestMeta = {}
} = {}) {
    if (!name || !phone || !address) {
        return { ok: false, code: "INVALID_INPUT", message: "Nama, nomor HP, dan alamat wajib diisi." };
    }

    // Anti-bot: Turnstile fail-closed (di-skip otomatis bila fitur nonaktif).
    const turnstile = await verifyTurnstile(turnstileToken, requestMeta.ipAddress);
    if (!turnstile.ok) {
        return { ok: false, code: "TURNSTILE_FAILED", message: "Verifikasi anti-bot gagal. Muat ulang halaman lalu coba lagi." };
    }

    // ID berbagi ruang dengan users/PSB (lead mengonsumsi ID; gap ditoleransi oleh algoritma gap-fill).
    let customerId;
    try {
        customerId = await getNextAvailablePSBId();
    } catch (err) {
        console.error("[PUBLIC_REG] Gagal ambil ID PSB:", err.message);
        return { ok: false, code: "ID_ERROR", message: "Gagal memproses pendaftaran. Coba lagi nanti." };
    }

    const createdAt = new Date().toISOString();
    const record = {
        id: customerId,
        name: String(name).trim(),
        phone_number: String(phone).trim(),
        address: String(address).trim(),
        latitude: latitude != null && latitude !== "" ? parseFloat(latitude) : null,
        longitude: longitude != null && longitude !== "" ? parseFloat(longitude) : null,
        location_url: locationUrl || null,
        psb_status: LEAD_STATUS,
        created_at: createdAt,
        created_by: "public_self_service",
        // Lead BELUM menyelesaikan phase1 (belum ada foto/survei). submitPhase2 hanya menerima
        // status phase1_completed/teknisi_meluncur → lead ini otomatis terkarantina dari pemasangan.
        phase1_completed_at: null,
        odc_id: null,
        odp_id: null,
        psb_data: {
            source: "landing",
            package_interest: packageInterest || null,
            submitted_at: createdAt,
            ip_address: requestMeta.ipAddress || null,
            user_agent: requestMeta.userAgent || null
        }
    };

    try {
        await insertPSBRecord(record);
    } catch (err) {
        console.error("[PUBLIC_REG] Gagal simpan lead PSB:", err.message);
        return { ok: false, code: "PERSIST_ERROR", message: "Gagal menyimpan pendaftaran. Coba lagi nanti." };
    }

    // Sinkron snapshot in-memory agar lead tampil di read-model staf (rekap PSB) tanpa restart.
    try {
        const repo = createApiPsbRepository({ runtime: global.__appRuntime });
        repo.updatePsbRecordsSnapshot((current) => [...(Array.isArray(current) ? current : []), record]);
    } catch (err) {
        console.error("[PUBLIC_REG] Gagal update snapshot psbRecords (lead tetap tersimpan di DB):", err.message);
    }

    // Notifikasi admin (andal). Kegagalan TIDAK menggagalkan pendaftaran.
    try {
        const adminText = renderTemplate("registrasi_lead_admin", {
            nama_pelanggan: record.name,
            telfon: record.phone_number,
            alamat: record.address,
            paket: record.psb_data.package_interest || "-",
            lokasi: record.location_url || (record.latitude ? `${record.latitude},${record.longitude}` : "-"),
            id_lead: String(customerId)
        });
        await notifyAdmins(adminText);
    } catch (err) {
        console.error("[PUBLIC_REG] Gagal render/kirim notif admin:", err.message);
    }

    // Notifikasi calon pelanggan (best-effort; JID dinormalisasi, guard koneksi, tak pernah throw).
    try {
        if (hasAuthenticatedSession()) {
            const digits = normalizePhoneNumber(String(record.phone_number || ""));
            const jid = digits && String(digits).length > 8 ? `${digits}@s.whatsapp.net` : null;
            if (jid) {
                const custText = renderTemplate("registrasi_lead_pelanggan", {
                    nama_pelanggan: record.name,
                    paket: record.psb_data.package_interest || "-"
                });
                await sendMessage(jid, { text: custText }, { skipDuplicateCheck: true });
            }
        }
    } catch (err) {
        console.error("[PUBLIC_REG] Gagal kirim notif calon pelanggan (diabaikan):", err.message);
    }

    return { ok: true, customerId };
}

module.exports = { submitPublicRegistration, LEAD_STATUS };
