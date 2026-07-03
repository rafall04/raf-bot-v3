/**
 * Header Doc
 * Purpose: Helper murni PORTAL PUBLIK TERPADU — resolusi area (WHITELIST anti-SSRF), deteksi
 *   kesiapan area (health-check + cache TTL), dan proxy HTTP ke listener publik bot area
 *   (`127.0.0.1:<port>`) dengan header BERSIH (TIDAK meneruskan XFF/cookie/authorization pembeli).
 * Caller: routes/portal.js.
 * Deps: axios; `global.config.portal.areas` (dari portal.config.json).
 * MainFuncs: getAreasConfig, resolveArea, isAreaEnabled, listEnabledAreas, checkAreaHealth,
 *   getReadyAreas, proxyJson, proxyBinary.
 * SideEffects: HTTP GET/POST ke baseUrl area (loopback); cache kesiapan area in-memory.
 */
"use strict";

const axios = require("axios");

// Ambil daftar area dari config portal. baseUrl SELALU dari sini, TIDAK PERNAH dari input user.
function getAreasConfig() {
    const portal = (global.config && global.config.portal) || {};
    return Array.isArray(portal.areas) ? portal.areas : [];
}

// Resolusi area by id dari WHITELIST config (guard SSRF). Return objek area atau null.
function resolveArea(id) {
    if (!id || typeof id !== "string") return null;
    return getAreasConfig().find((a) => a && a.id === id) || null;
}

function isAreaEnabled(area) {
    return !!(area && area.enabled !== false && area.baseUrl);
}

// Daftar area yang enabled (id+label) — TANPA cek health (untuk fallback/listing statis).
function listEnabledAreas() {
    return getAreasConfig()
        .filter((a) => a && a.id && a.enabled !== false)
        .map((a) => ({ id: a.id, label: a.label || a.id }));
}

// Cache kesiapan area (TTL) supaya tak flooding health-check tiap request dropdown.
const HEALTH_TTL_MS = 30000;
const healthCache = new Map(); // areaId -> { ready, ts }

// Health-check = GET baseUrl/app/packages (endpoint yang ADA di listener publik bot; balas {data:[]}).
async function checkAreaHealth(area) {
    if (!isAreaEnabled(area)) return false;
    const cached = healthCache.get(area.id);
    const now = Date.now();
    if (cached && now - cached.ts < HEALTH_TTL_MS) return cached.ready;
    let ready = false;
    try {
        const res = await axios.get(`${area.baseUrl}/app/packages`, { timeout: 5000, headers: { Accept: "application/json" } });
        ready = !!(res && res.status === 200 && res.data && Array.isArray(res.data.data));
    } catch (_e) {
        ready = false;
    }
    healthCache.set(area.id, { ready, ts: now });
    return ready;
}

// Daftar area SIAP (enabled + health OK) untuk dropdown UI — hanya tawarkan area yang benar-benar hidup.
async function getReadyAreas() {
    const areas = getAreasConfig().filter((a) => a && a.id && a.enabled !== false);
    const checked = await Promise.all(areas.map(async (a) => ({
        id: a.id,
        label: a.label || a.id,
        ready: await checkAreaHealth(a)
    })));
    return checked.filter((a) => a.ready).map((a) => ({ id: a.id, label: a.label }));
}

// Header BERSIH untuk proxy: JANGAN teruskan X-Forwarded-For/cookie/authorization pembeli ke bot
// (jangan bocorkan asal & jangan biarkan bot salah-baca IP; portal sudah throttle per-IP sendiri).
function cleanHeaders() {
    return { Accept: "application/json" };
}

// Proxy JSON (GET/POST) ke bot area. Return { status, data } (passthrough termasuk 4xx).
// Melempar HANYA untuk 5xx/timeout/jaringan → caller balas 502/503 graceful.
async function proxyJson(area, method, path, { query, body, timeout = 10000 } = {}) {
    const res = await axios({
        method,
        url: `${area.baseUrl}${path}`,
        params: query || undefined,
        data: body || undefined,
        timeout,
        headers: cleanHeaders(),
        validateStatus: (s) => s >= 200 && s < 500
    });
    return { status: res.status, data: res.data };
}

// Proxy BINARY (QR PNG) GET ke bot area. Return { status, contentType, buffer }.
async function proxyBinary(area, path, { query, timeout = 10000 } = {}) {
    const res = await axios.get(`${area.baseUrl}${path}`, {
        params: query || undefined,
        timeout,
        headers: cleanHeaders(),
        responseType: "arraybuffer",
        validateStatus: (s) => s >= 200 && s < 500
    });
    return {
        status: res.status,
        contentType: res.headers["content-type"] || "application/octet-stream",
        buffer: Buffer.from(res.data)
    };
}

// Test-only: bersihkan cache health agar test tak saling kontaminasi (TTL in-memory).
function _clearHealthCache() {
    healthCache.clear();
}

module.exports = {
    getAreasConfig,
    resolveArea,
    isAreaEnabled,
    listEnabledAreas,
    checkAreaHealth,
    getReadyAreas,
    proxyJson,
    proxyBinary,
    _clearHealthCache
};
