/**
 * Header Doc
 * Purpose: Otentikasi TERPISAH untuk halaman keuangan pribadi. Sengaja berdiri sendiri, bukan
 *          menumpang sesi admin: kredensial sendiri (`database/personal_finance_auth.json`,
 *          bcrypt) dan RAHASIA SESI sendiri yang di-generate acak. Konsekuensinya token admin
 *          tidak akan pernah bisa membuka dompet, dan token dompet tidak bisa membuka apa pun
 *          di panel admin — bahkan bila salah satu cookie bocor.
 * Caller: `routes/admin-personal-finance-routes.js`, `routes/pages.js`,
 *         `scripts/set-keuangan-pribadi-password.js`.
 * Deps: `bcrypt`, `jsonwebtoken`, `crypto`, `fs`, `../lib/env-config.getDatabasePath`.
 * MainFuncs: `setCredential`, `verifyCredential`, `issueSessionToken`, `verifySessionToken`,
 *            `hasCredential`, `readSessionCookie`, `COOKIE_NAME`.
 * SideEffects: Membaca/menulis `database/personal_finance_auth.json` (berisi hash + rahasia sesi).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const { getDatabasePath } = require("./env-config");

/** Cookie sendiri — TIDAK memakai nama `token` supaya tak pernah tertukar dengan sesi admin. */
const COOKIE_NAME = "pf_session";
const BCRYPT_ROUNDS = 10; // standar repo (routes/accounts.js, lib/agent-transaction-manager.js)
const SESSION_TTL = "8h";

/**
 * Path store kredensial. Ditulis eksplisit, TIDAK lewat `getDatabasePath()`: helper itu
 * dirancang untuk nama `*.sqlite` dan akan menghasilkan `personal_finance_auth.json_test.sqlite`
 * untuk file JSON. Isolasi test tetap dijaga dengan sufiks `_test` sendiri, supaya menjalankan
 * test tak pernah menimpa kredensial dompet yang asli.
 */
function authFilePath() {
    const dir = path.dirname(getDatabasePath("users.sqlite"));
    const uji = process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development";
    return path.join(dir, uji ? "personal_finance_auth_test.json" : "personal_finance_auth.json");
}

function readStore() {
    const p = authFilePath();
    if (!fs.existsSync(p)) return null;
    try {
        const raw = JSON.parse(fs.readFileSync(p, "utf8"));
        return raw && typeof raw === "object" ? raw : null;
    } catch (e) {
        console.error("[PF_AUTH] gagal baca store:", e.message);
        return null;
    }
}

function writeStore(store) {
    const p = authFilePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(store, null, 2));
    // Berisi hash + rahasia sesi → jangan world-readable. chmod no-op di Windows, itu wajar.
    try {
        fs.chmodSync(p, 0o600);
    } catch (_e) {
        /* abaikan: filesystem tanpa dukungan mode */
    }
}

/** Sudah ada kredensial? Dipakai halaman login untuk membedakan "belum disiapkan" vs "salah sandi". */
function hasCredential() {
    const s = readStore();
    return Boolean(s && s.username && s.passwordHash);
}

/**
 * Set/ganti kredensial dompet. Rahasia sesi dibuat sekali dan DIPERTAHANKAN saat ganti sandi
 * (ganti sandi tak perlu mematikan sesi lain secara diam-diam); pakai `rotateSecret` bila
 * memang ingin memutus semua sesi aktif.
 */
async function setCredential(username, password, options = {}) {
    const u = String(username || "").trim().toLowerCase();
    const p = String(password || "");
    if (!u) throw new Error("username wajib diisi");
    if (p.length < 8) throw new Error("sandi minimal 8 karakter");

    const lama = readStore() || {};
    const store = {
        username: u,
        passwordHash: await bcrypt.hash(p, BCRYPT_ROUNDS),
        sessionSecret:
            options.rotateSecret || !lama.sessionSecret ? crypto.randomBytes(48).toString("hex") : lama.sessionSecret,
        createdAt: lama.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    writeStore(store);
    return { username: u, secretRotated: Boolean(options.rotateSecret || !lama.sessionSecret) };
}

/**
 * Cocokkan username+sandi. Selalu menjalankan bcrypt.compare walau username salah supaya
 * lama waktu balasan tak membocorkan username mana yang benar.
 */
async function verifyCredential(username, password) {
    const store = readStore();
    const u = String(username || "").trim().toLowerCase();
    const p = String(password || "");

    const hashPembanding =
        store && store.passwordHash ? store.passwordHash : "$2b$10$0000000000000000000000000000000000000000000000000000";
    const cocokSandi = await bcrypt.compare(p, hashPembanding).catch(() => false);

    if (!store || !store.username) return false;
    return store.username === u && cocokSandi;
}

function sessionSecret() {
    const s = readStore();
    return s && s.sessionSecret ? s.sessionSecret : null;
}

/** Terbitkan token sesi dompet. Ditandatangani rahasia SENDIRI, bukan config.jwt. */
function issueSessionToken(username) {
    const secret = sessionSecret();
    if (!secret) throw new Error("kredensial dompet belum disiapkan");
    return jwt.sign({ sub: String(username || "").toLowerCase(), scope: "personal-finance" }, secret, {
        expiresIn: SESSION_TTL
    });
}

/**
 * Verifikasi token sesi dompet. GAGAL-TERTUTUP: token admin, token kedaluwarsa, tanda tangan
 * salah, atau `scope` bukan personal-finance ⇒ null.
 */
function verifySessionToken(token) {
    const secret = sessionSecret();
    if (!secret || !token) return null;
    try {
        const payload = jwt.verify(String(token), secret);
        if (!payload || payload.scope !== "personal-finance" || !payload.sub) return null;
        return { username: payload.sub };
    } catch (_e) {
        return null;
    }
}

/** Ambil token dari cookie request (tanpa mengasumsikan cookie-parser sudah jalan). */
function readSessionCookie(req) {
    if (req && req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
    const raw = (req && req.headers && req.headers.cookie) || "";
    const found = String(raw)
        .split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${COOKIE_NAME}=`));
    return found ? decodeURIComponent(found.slice(COOKIE_NAME.length + 1)) : null;
}

/** Sesi dompet yang sah untuk request ini, atau null. */
function resolveSession(req) {
    return verifySessionToken(readSessionCookie(req));
}

module.exports = {
    COOKIE_NAME,
    SESSION_TTL,
    authFilePath,
    hasCredential,
    setCredential,
    verifyCredential,
    issueSessionToken,
    verifySessionToken,
    readSessionCookie,
    resolveSession
};
