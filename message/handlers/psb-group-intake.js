/**
 * Header Doc
 * Purpose: Handler intake PSB via grup WhatsApp — teknisi kirim 1 pesan (foto KTP + caption `#PSB ...`)
 *          → bot parse, simpan KTP, auto-generate PPPoE, buat pelanggan (reuse create-user service:
 *          secret PPPoE MikroTik + welcome `psb_welcome`), lalu balas kredensial PPPoE ke grup untuk
 *          teknisi setel modem. Bagian Fase 1 [[psb-simplification-plan]].
 * Caller: `message/raf.js` (branch grup PSB sebelum `if (isGroup) return`).
 * Deps (di-inject supaya testable + patuh invariant): `usersService` (global.__apiUsersService),
 *        `reply` (delivery boundary — balas ke grup, BUKAN Baileys mentah), `downloadMedia`
 *        (`lib/whatsapp.adapter`), `isProcessing/setProcessing/clearProcessing` (`lib/state-manager`),
 *        `generateRandomPassword`, `packages`, `accounts`, `ownerNumber`, `uploadsBaseDir`.
 *        Require langsung: `./psb-caption-parser`, `fs`, `path`.
 * MainFuncs: `handlePsbGroupIntake(deps)`, `resolveAuthorizedStaff(...)`, `generatePppoeUsername(...)`.
 * SideEffects: Tulis foto KTP ke `uploads/psb/...`, buat pelanggan + secret PPPoE + kirim WA (welcome
 *              pelanggan + balasan grup). NEVER-THROW — semua error ditangkap & dibalas ke grup.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { parsePsbCaption } = require("./psb-caption-parser");
const stateManager = require("../../lib/state-manager");
let defaultGenPass = null;
try { defaultGenPass = require("../../lib/psb-helper").generateRandomPassword; } catch (_e) { /* opsional */ }

// pppoe_username unik dari nama (pola create-user-validate), dedup vs users existing.
function generatePppoeUsername(nama, existingUsers) {
    const parts = String(nama || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
    let base = parts[0] || "user";
    if (parts.length > 1) base += parts[1].charAt(0);
    const taken = new Set((existingUsers || []).map((u) => String(u.pppoe_username || "").toLowerCase()));
    let candidate = base;
    let n = 1;
    while (taken.has(candidate.toLowerCase())) { n += 1; candidate = `${base}${n}`; }
    return candidate;
}

// Pengirim grup harus akun staf dgn role diizinkan (default teknisi/admin/owner). Return akun atau null.
function resolveAuthorizedStaff({ participant, plainPhone, accounts, allowedRoles }) {
    const roles = (allowedRoles && allowedRoles.length ? allowedRoles : ["teknisi", "admin", "owner"]).map((r) => String(r).toLowerCase());
    const pJid = String(participant || "");
    const pNum = String(plainPhone || "").replace(/[^0-9]/g, "");
    const acct = (accounts || []).find((a) => {
        if (!a) return false;
        if (a.lid && a.lid === pJid) return true;
        const ph = String(a.phone_number || "");
        const phNum = ph.replace(/[^0-9]/g, "");
        return (ph && ph === pJid) || (phNum && pNum && phNum === pNum);
    });
    if (!acct) return null;
    if (!roles.includes(String(acct.role || "").toLowerCase())) return null;
    return acct;
}

async function safeReply(reply, text, logger) {
    try {
        if (reply) await reply(text);
    } catch (e) {
        logger?.error?.("[PSB_GROUP] gagal balas grup:", e.message);
    }
}

async function handlePsbGroupIntake(deps) {
    const {
        msg, caption, type, participant, plainPhone,
        accounts, allowedRoles,
        usersService, reply, downloadMedia,
        packages, uploadsBaseDir, generateRandomPassword,
        isProcessing, setProcessing, clearProcessing,
        logger = console
    } = deps;

    // 1. Hanya pesan GAMBAR dengan caption #PSB (chat grup biasa diabaikan → tak berisik).
    if (type !== "imageMessage") return { handled: false };
    if (!/^\s*#psb\b/i.test(String(caption || ""))) return { handled: false };

    // 2. Auth: pengirim wajib staf berrole. Bukan → diam (jangan bocorkan keberadaan fitur).
    const staff = resolveAuthorizedStaff({ participant, plainPhone, accounts, allowedRoles });
    if (!staff) {
        logger?.warn?.(`[PSB_GROUP] pengirim tak berwenang, diabaikan: ${participant}`);
        return { handled: false };
    }

    // 3. Concurrency guard per pengirim (default ke lib/state-manager bila tak di-inject).
    const _isProcessing = isProcessing || stateManager.isProcessing;
    const _setProcessing = setProcessing || stateManager.setProcessing;
    const _clearProcessing = clearProcessing || stateManager.clearProcessing;
    const lockKey = participant || plainPhone || "psb-group";
    if (_isProcessing && _isProcessing(lockKey)) return { handled: true };
    if (_setProcessing) _setProcessing(lockKey);

    try {
        // 4. Parse caption.
        const parsed = parsePsbCaption(caption, { packages: packages || global.packages || [] });
        if (!parsed.ok) {
            await safeReply(reply, `❌ Data PSB belum lengkap/valid:\n- ${parsed.errors.join("\n- ")}\n\nFormat:\n#PSB\nNama: ...\nPaket: ...\nWiFi: ...\nSandi: ...\nHP: ...`, logger);
            return { handled: true };
        }
        const d = parsed.data;

        // 5. Simpan foto KTP (best-effort — jangan gagalkan pembuatan pelanggan bila gagal).
        let ktpSaved = false;
        try {
            const buffer = await downloadMedia(msg, "buffer", {});
            if (buffer && buffer.length > 0) {
                const now = new Date();
                const year = String(now.getFullYear());
                const month = String(now.getMonth() + 1).padStart(2, "0");
                const tempId = `PSBWA_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
                const dir = path.join(uploadsBaseDir, "psb", year, month, tempId);
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(path.join(dir, "ktp_photo.jpg"), buffer);
                ktpSaved = true;
            }
        } catch (ktpErr) {
            logger?.error?.("[PSB_GROUP] gagal simpan KTP:", ktpErr.message);
        }

        // 6. Auto-generate kredensial PPPoE.
        const pppoeUser = generatePppoeUsername(d.nama, global.users || []);
        const genPassFn = generateRandomPassword || defaultGenPass || (() => Math.random().toString(36).slice(2, 12));
        const pppoePass = genPassFn();

        // 7. Buat pelanggan (reuse create-user: mode "new" → secret PPPoE + welcome psb_welcome ke HP).
        const result = await usersService.upsertUserFromAdminPanel({
            userData: {
                name: d.nama,
                phone_number: d.hp,
                subscription: d.paket,
                pppoe_username: pppoeUser,
                pppoe_password: pppoePass,
                wifi_ssid: d.wifi_ssid,
                wifi_password: d.wifi_password,
                registration_mode: "new"
            },
            actor: { id: staff.id, username: staff.username, name: staff.name || staff.username, role: staff.role },
            requestMeta: { ipAddress: "wa-group-psb", userAgent: "psb-group-intake" }
        });

        if (!result || result.status >= 400) {
            const errMsg = (result && result.body && result.body.message) || "gagal membuat pelanggan";
            await safeReply(reply, `❌ Gagal daftar *${d.nama}*: ${errMsg}`, logger);
            return { handled: true };
        }

        // 8. Balas grup: kredensial PPPoE (teknisi setel modem) + status.
        const syncMsg = (result.body && result.body.sync_message) || "";
        const lines = [
            `✅ PSB berhasil: *${d.nama}* (${d.hp})`,
            `Paket: ${d.paket}`,
            `PPPoE: \`${pppoeUser}\` / \`${pppoePass}\``,
            `WiFi: ${d.wifi_ssid} / ${d.wifi_password}`,
            ktpSaved ? "KTP tersimpan ✔" : "⚠ KTP gagal disimpan",
            "Welcome dikirim ke pelanggan. Setel modem pakai PPPoE di atas."
        ];
        if (syncMsg) lines.push(`(${syncMsg})`);
        await safeReply(reply, lines.join("\n"), logger);
        return { handled: true, userId: result.body?.data?.id };
    } catch (err) {
        logger?.error?.("[PSB_GROUP] error:", err.message);
        await safeReply(reply, `❌ Terjadi kesalahan memproses PSB: ${err.message}`, logger);
        return { handled: true };
    } finally {
        if (_clearProcessing) _clearProcessing(lockKey);
    }
}

module.exports = { handlePsbGroupIntake, resolveAuthorizedStaff, generatePppoeUsername };
