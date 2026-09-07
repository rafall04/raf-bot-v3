/**
 * Header Doc
 * Purpose: HUBUNGKAN WhatsApp ke akun teknisi (RONDE 6 Fase D, self-service). Menutup GAP: `account.lid`
 *   tak punya jalur tulis (identitas WA tak bisa ditautkan tanpa admin). Verifikasi DUA-SISI: kode
 *   sekali-pakai ber-TTL diterbitkan dari sesi web terautentikasi (req.user.id), lalu ditebus lewat WA
 *   (`hubungkan <kode>`) — membuktikan kepemilikan web (JWT) + kendali nomor WA (pengiriman kode).
 *   Menulis `lid` (+`phone_number` bila kosong) ke akun via jalur AMAN accounts.json: withLock +
 *   saveAccounts (atomik) + invalidasi authCache. Anti-eskalasi: satu kode → satu akun penerbitnya;
 *   `lid` unik lintas akun. Kode di-simpan IN-MEMORY (ephemeral; hilang saat restart → terbitkan ulang).
 * Caller: routes/teknisi-settings-api.js (issue/unlink), message/handlers/teknisi-prefs-handler.js (redeem+link).
 * Deps: `crypto`, `./request-lock` (withLock); lazy: `./database` (saveAccounts), `./auth-cache` (authCache),
 *   `./jid-utils` (normalizePhoneNumber).
 * MainFuncs: issueLinkCode, redeemLinkCode, linkWaToAccount, unlinkWa, updateProfile, findAccountByLid, _resetForTest.
 * SideEffects: Menulis `global.accounts` + `database/accounts.json` (atomik) saat linkWaToAccount/unlinkWa.
 */
"use strict";

const crypto = require("crypto");
const { withLock } = require("./request-lock");

const CODE_TTL_MS = 10 * 60 * 1000;     // kode berlaku 10 menit
const MAX_ATTEMPTS = 8;                  // percobaan tebus per-pengirim dalam jendela TTL (anti brute-force)
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa 0/O/1/I (anti-ambigu)
const CODE_LEN = 8;                      // 32^8 ≈ 1,1e12 ruang → tak bisa ditebak

// accountId(String) -> { code, expiresAt }
const _codesByAccount = new Map();
// senderId(String) -> { count, resetAt }
const _attemptsBySender = new Map();

function _now() { return Date.now(); }

function _genCode() {
    const bytes = crypto.randomBytes(CODE_LEN);
    let out = "";
    for (let i = 0; i < CODE_LEN; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return out;
}

/** Terbitkan (atau perbarui) kode hubung untuk satu akun. Satu kode aktif per akun. */
function issueLinkCode(accountId) {
    const id = String(accountId);
    const code = _genCode();
    const expiresAt = _now() + CODE_TTL_MS;
    _codesByAccount.set(id, { code, expiresAt });
    return { code, expiresAt: new Date(expiresAt).toISOString(), ttlMs: CODE_TTL_MS };
}

function _attemptOk(senderId) {
    const key = String(senderId || "");
    const rec = _attemptsBySender.get(key);
    const now = _now();
    if (!rec || now > rec.resetAt) {
        _attemptsBySender.set(key, { count: 1, resetAt: now + CODE_TTL_MS });
        return true;
    }
    if (rec.count >= MAX_ATTEMPTS) return false;
    rec.count += 1;
    return true;
}

/**
 * Tebus kode dari WA. @returns {{ok:true, accountId}|{ok:false, reason}}.
 * reason: 'rate' | 'invalid' (kode salah/kedaluwarsa). Kode sukses = SEKALI PAKAI (dihapus).
 */
function redeemLinkCode(code, senderId) {
    if (!_attemptOk(senderId)) return { ok: false, reason: "rate" };
    const clean = String(code || "").trim().toUpperCase();
    if (!clean) return { ok: false, reason: "invalid" };
    const now = _now();
    for (const [accountId, rec] of _codesByAccount.entries()) {
        if (rec.expiresAt < now) { _codesByAccount.delete(accountId); continue; }
        if (rec.code === clean) {
            _codesByAccount.delete(accountId);              // sekali pakai
            _attemptsBySender.delete(String(senderId || "")); // reset counter setelah sukses
            return { ok: true, accountId };
        }
    }
    return { ok: false, reason: "invalid" };
}

/** Akun (dari global.accounts) yang `lid`-nya == senderId, atau null. */
function findAccountByLid(senderId, accounts = (typeof global !== "undefined" ? global.accounts : null)) {
    const list = Array.isArray(accounts) ? accounts : [];
    return list.find((a) => a && a.lid && a.lid === senderId) || null;
}

/**
 * Tautkan identitas WA pengirim ke akun. Menulis `account.lid = senderId` (kunci match raf-context),
 * dan `phone_number` bila masih kosong (agar notif japri sampai). AMAN: withLock + saveAccounts + invalidasi cache.
 * @returns {Promise<{ok:true, account}|{ok:false, reason}>} reason: 'not_found' | 'lid_taken' | 'save_failed'
 */
async function linkWaToAccount({ accountId, senderId, phoneNumber }) {
    return withLock("link-wa-account", async () => {
        const accounts = (typeof global !== "undefined" && Array.isArray(global.accounts)) ? global.accounts : [];
        const account = accounts.find((a) => a && String(a.id) === String(accountId));
        if (!account) return { ok: false, reason: "not_found" };

        // Anti-serobot: senderId sudah tertaut ke akun LAIN → tolak (jangan pindahkan diam-diam).
        const other = accounts.find((a) => a && a.lid === senderId && String(a.id) !== String(accountId));
        if (other) return { ok: false, reason: "lid_taken" };

        account.lid = senderId;
        if ((!account.phone_number || String(account.phone_number).trim() === "") && phoneNumber) {
            account.phone_number = phoneNumber;
        }

        try {
            require("./database").saveAccounts();
        } catch (err) {
            return { ok: false, reason: "save_failed", error: err && err.message };
        }
        try {
            const { authCache } = require("./auth-cache");
            authCache.invalidateAccount(account.id, account.username);
            authCache.invalidateUser(account.id);
        } catch (_e) { /* invalidasi best-effort */ }

        return { ok: true, account };
    });
}

/** Putuskan tautan WA dari akun (kosongkan lid). AMAN sama seperti link. */
async function unlinkWa(accountId) {
    return withLock("link-wa-account", async () => {
        const accounts = (typeof global !== "undefined" && Array.isArray(global.accounts)) ? global.accounts : [];
        const account = accounts.find((a) => a && String(a.id) === String(accountId));
        if (!account) return { ok: false, reason: "not_found" };
        if (!account.lid) return { ok: true, account };
        delete account.lid;
        try { require("./database").saveAccounts(); } catch (err) { return { ok: false, reason: "save_failed", error: err && err.message }; }
        try {
            const { authCache } = require("./auth-cache");
            authCache.invalidateAccount(account.id, account.username);
            authCache.invalidateUser(account.id);
        } catch (_e) { /* best-effort */ }
        return { ok: true, account };
    });
}

/**
 * Update profil DIRI SENDIRI yang AMAN (cosmetic): hanya `name`. Identitas (lid/phone_number/role/
 * username/password) TIDAK lewat sini — itu ranah link terverifikasi / admin CRUD. AMAN sama spt link.
 * @returns {Promise<{ok:true, account}|{ok:false, reason}>}
 */
async function updateProfile(accountId, { name } = {}) {
    return withLock("link-wa-account", async () => {
        const accounts = (typeof global !== "undefined" && Array.isArray(global.accounts)) ? global.accounts : [];
        const account = accounts.find((a) => a && String(a.id) === String(accountId));
        if (!account) return { ok: false, reason: "not_found" };
        const clean = typeof name === "string" ? name.trim() : "";
        if (!clean) return { ok: false, reason: "invalid" };
        account.name = clean.slice(0, 80);
        try { require("./database").saveAccounts(); } catch (err) { return { ok: false, reason: "save_failed", error: err && err.message }; }
        try {
            const { authCache } = require("./auth-cache");
            authCache.invalidateAccount(account.id, account.username);
            authCache.invalidateUser(account.id);
        } catch (_e) { /* best-effort */ }
        return { ok: true, account };
    });
}

/** Reset state in-memory (khusus test). */
function _resetForTest() { _codesByAccount.clear(); _attemptsBySender.clear(); }

module.exports = { issueLinkCode, redeemLinkCode, linkWaToAccount, unlinkWa, updateProfile, findAccountByLid, _resetForTest, CODE_TTL_MS, MAX_ATTEMPTS };
