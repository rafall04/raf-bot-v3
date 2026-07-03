/**
 * Header Doc
 * Purpose: Route admin halaman "Broadcast Tagihan" — daftar pelanggan (default belum bayar, dengan
 *          nominal & status HP) untuk diseleksi, template default, dan preview pesan tagihan (render
 *          placeholder pembayaran ${link_bayar}/${harga}/${jatuh_tempo}/${periode}). PENGIRIMAN
 *          REUSE endpoint `/api/broadcast` (mesin broadcast + throttle + opt-in + riwayat) — bukan
 *          jalur kirim baru.
 * Caller: `routes/admin-router.js` (composer) via `registerAdminBroadcastTagihanRoutes`.
 * Deps: Express router, `ensureAuthenticatedStaff`, `lib/account-classification` (isInfrastructure),
 *       `services/admin-broadcast.service` (formatBroadcastMessage), `lib/response-template-helper`
 *       (renderResponseTemplate), `lib/error-handler` (asyncHandler), global.users/packages/config.
 * MainFuncs: `registerAdminBroadcastTagihanRoutes`.
 * SideEffects: Tidak ada (read-only + render string). Pengiriman WA terjadi di `/api/broadcast`.
 */
"use strict";

const { asyncHandler } = require("../lib/error-handler");
const { isInfrastructure } = require("../lib/account-classification");
const { formatBroadcastMessage } = require("../services/admin-broadcast.service");
const { renderResponseTemplate } = require("../lib/response-template-helper");

// Fallback runtime yang aman (invariant: teks user-facing wajib punya fallback). Teks yang sama
// dipasang sebagai default key `broadcast_tagihan` di database/response_templates.json (bisa diedit admin).
const BROADCAST_TAGIHAN_FALLBACK = [
    "Halo ${nama_pelanggan} 🙏",
    "",
    "Pengingat tagihan layanan internet Anda:",
    "• Paket: ${paket}",
    "• Tagihan: ${harga}",
    "• Periode: ${periode}",
    "• Jatuh tempo: ${jatuh_tempo}",
    "",
    "Silakan bayar (QRIS/transfer, tanpa perlu login) lewat tautan berikut:",
    "${link_bayar}",
    "",
    "Abaikan pesan ini bila Anda sudah membayar. Terima kasih 🙏"
].join("\n");

function priceForSubscription(subscription) {
    const pkg = (global.packages || []).find((p) => p.name === subscription);
    return pkg && pkg.price ? Number(pkg.price) : 0;
}

function hasPhone(user) {
    return String(user?.phone_number || "").trim() !== "";
}

function registerAdminBroadcastTagihanRoutes(router, deps = {}) {
    const ensureAuthenticatedStaff = deps.ensureAuthenticatedStaff || ((_req, _res, next) => next());

    // Daftar pelanggan untuk seleksi (default: belum bayar). Read-only.
    router.get("/api/broadcast-tagihan/customers", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const status = String(req.query?.status || "unpaid").toLowerCase();
        const all = Array.isArray(global.users) ? global.users : [];
        const items = all
            .filter((u) => !isInfrastructure(u))
            .filter((u) => (status === "all" ? true : !u.paid))
            .map((u) => ({
                id: u.id,
                name: u.name || "",
                has_phone: hasPhone(u),
                phone_number: u.phone_number || "",
                subscription: u.subscription || u.package || "",
                price: priceForSubscription(u.subscription || u.package),
                paid: Boolean(u.paid),
                has_device: Boolean(u.device_id)
            }))
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));

        res.status(200).json({
            status: 200,
            message: `${items.length} pelanggan (${status === "all" ? "semua" : "belum bayar"}).`,
            data: { items, total: items.length, unpaid_only: status !== "all" }
        });
    }));

    // Template default (dengan placeholder utuh) untuk pra-isi editor — hindari duplikasi teks di FE.
    router.get("/api/broadcast-tagihan/default-template", ensureAuthenticatedStaff, asyncHandler(async (_req, res) => {
        const text = renderResponseTemplate("broadcast_tagihan", BROADCAST_TAGIHAN_FALLBACK, {});
        res.status(200).json({ status: 200, message: "Template tagihan.", data: { template_key: "broadcast_tagihan", text } });
    }));

    // Preview — render pesan jadi untuk 1 pelanggan sampel (placeholder pembayaran terisi nyata).
    router.post("/api/broadcast-tagihan/preview", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const sampleId = req.body?.user_id ?? (Array.isArray(req.body?.users) ? req.body.users[0] : null);
        const all = Array.isArray(global.users) ? global.users : [];
        const user = all.find((u) => String(u.id) === String(sampleId)) || null;
        if (!user) {
            return res.status(400).json({ status: 400, message: "Pilih minimal 1 pelanggan untuk pratinjau." });
        }
        // Ikuti pola renderText mesin broadcast: text editan → key template + fallback.
        let raw = String(req.body?.text || "");
        if (!raw) {
            raw = renderResponseTemplate("broadcast_tagihan", BROADCAST_TAGIHAN_FALLBACK, {});
        }
        const message = formatBroadcastMessage(raw, user);
        res.status(200).json({
            status: 200,
            message: "Pratinjau pesan tagihan.",
            data: { user: { id: user.id, name: user.name, has_phone: hasPhone(user) }, message }
        });
    }));

    return { BROADCAST_TAGIHAN_FALLBACK };
}

module.exports = { registerAdminBroadcastTagihanRoutes, BROADCAST_TAGIHAN_FALLBACK };
