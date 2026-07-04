/**
 * Header Doc
 * Purpose: Kirim pesan "selamat datang" ke pelanggan di luar jalur CREATE — dipakai saat No HP baru
 *          diisi (empty→filled) DAN untuk tombol "Kirim Welcome" manual. Solusi pain "lupa broadcast
 *          selamat datang" untuk pelanggan yang dibuat tanpa No HP (welcome CREATE cuma jalan bila HP
 *          terisi saat dibuat). Pakai template `import_welcome` (password-less — resend tak punya
 *          plaintext password, beda dari `customer_welcome` di create).
 * Caller: `services/api-users/update-user-by-id.js` (auto saat HP diisi), `services/api-users.service.js`
 *         (method `sendWelcomeToUser` → route `POST /api/users/:id/send-welcome`).
 * Deps (dari service deps): `getConfig`, `getPackages`, `renderTemplate`, `sendMessage` (delivery
 *        boundary), `getStatusSnapshot`, `repository`, `logger`; lazy `../../lib/utils` (normalizePhoneNumber).
 * MainFuncs: `sendCustomerWelcome(deps, { user })`, `sendWelcomeToUser(deps, { id })`.
 * SideEffects: Kirim WhatsApp (guarded, non-throwing — invariant: notifikasi tak boleh menjatuhkan flow).
 */
"use strict";

// Kirim welcome ke satu user object. Guarded + never-throw. JID kanonik. Return ringkas status.
async function sendCustomerWelcome(deps, { user }) {
    const appConfig = (deps.getConfig && deps.getConfig()) || {};
    if (appConfig.welcomeMessage?.enabled === false) {
        return { sent: false, reason: "welcome_disabled" };
    }
    if (!user || !String(user.phone_number || "").trim()) {
        return { sent: false, reason: "no_phone" };
    }

    let displayProfile = "-";
    try {
        const pkgs = (deps.getPackages && deps.getPackages()) || [];
        const pkg = pkgs.find((p) => p.name === user.subscription);
        if (pkg) displayProfile = pkg.display_profile || pkg.profile || "-";
    } catch (_e) { /* noop */ }

    const templateData = {
        nama_pelanggan: user.name || "",
        nama_paket: user.subscription || "-",
        display_profile: displayProfile,
        nama_wifi: appConfig.nama || appConfig.nama_wifi || "Layanan Kami",
        nama_bot: appConfig.namabot || appConfig.botName || "RAF NET BOT"
    };

    const messageText = deps.renderTemplate("import_welcome", templateData);
    if (!messageText || String(messageText).startsWith("Error:")) {
        return { sent: false, reason: "no_template" };
    }

    const { normalizePhoneNumber } = require("../../lib/utils");
    const phones = String(user.phone_number).split("|").map((s) => s.trim()).filter(Boolean);
    const results = [];
    let anySent = false;
    for (const number of phones) {
        const normalized = normalizePhoneNumber(number);
        if (!normalized) {
            results.push({ number, sent: false, reason: "invalid_phone" });
            continue;
        }
        if (!deps.getStatusSnapshot || deps.getStatusSnapshot().connectionState !== "open") {
            results.push({ number, sent: false, reason: "wa_offline" });
            continue;
        }
        const jid = `${normalized}@s.whatsapp.net`;
        try {
            const delivery = await deps.sendMessage(jid, { text: messageText });
            const ok = delivery && delivery.sent !== false;
            if (ok) anySent = true;
            results.push({ number, sent: ok, warning: delivery?.warning || null });
        } catch (e) {
            deps.logger?.error?.("[WELCOME_MSG_ERROR] gagal kirim welcome:", e.message);
            results.push({ number, sent: false, reason: e.message });
        }
    }
    return { sent: anySent, template: "import_welcome", results, reason: anySent ? null : (results[0]?.reason || "send_failed") };
}

// Resend manual by user id (endpoint). Return {status, body} untuk route.
async function sendWelcomeToUser(deps, { id }) {
    const users = deps.repository?.getUsersSnapshot?.() || [];
    const user = users.find((u) => String(u.id) === String(id));
    if (!user) {
        return { status: 404, body: { status: 404, message: "Pelanggan tidak ditemukan." } };
    }
    if (!String(user.phone_number || "").trim()) {
        return { status: 400, body: { status: 400, message: "Pelanggan belum punya No HP — isi No HP dulu." } };
    }
    const result = await sendCustomerWelcome(deps, { user });
    if (result.sent) {
        return {
            status: 200,
            body: { status: 200, message: `Pesan selamat datang terkirim ke ${user.name}.`, data: result }
        };
    }
    const reasonMsg = {
        welcome_disabled: "Welcome message dinonaktifkan di konfigurasi.",
        wa_offline: "WhatsApp sedang tidak terkoneksi.",
        no_template: "Template 'import_welcome' tidak ditemukan.",
        invalid_phone: "Format No HP tidak valid.",
        no_phone: "Pelanggan belum punya No HP."
    }[result.reason] || "Gagal mengirim pesan (cek koneksi WA / nomor).";
    return { status: 502, body: { status: 502, message: reasonMsg, data: result } };
}

module.exports = { sendCustomerWelcome, sendWelcomeToUser };
