/**
 * Header Doc
 * Purpose: Perakit peta perintah bot Telegram teknisi (READ-ONLY). Menyuntikkan service
 *          existing (GenieACS via lib/wifi, MikroTik, resolver optik OLT) ke tiap handler,
 *          lalu mengembalikan peta '/cmd' → handler untuk dipakai dispatcher.
 * Caller: `lib/telegram/telegram-teknisi-bootstrap.js`.
 * Deps: customer-lookup, lib/wifi, lib/mikrotik, lib/olt-optical-resolver, dan handler-handler.
 * MainFuncs: `buildCommandMap(overrides)` → { '/help','/start','/pelanggan','/koneksi','/modem','/olt','/redaman' }.
 * SideEffects: tidak ada saat assembly; handler-lah yang memanggil service saat dipakai.
 */
"use strict";

const { findOneCustomer, findById } = require("../customer-lookup");
const wifi = require("../../../lib/wifi");
const mikrotik = require("../../../lib/mikrotik");
const optical = require("../../../lib/olt-optical-resolver");

const { createHelpCommand } = require("./help-command");
const { createPelangganCommand } = require("./pelanggan-command");
const { createKoneksiCommand } = require("./koneksi-command");
const { createModemCommand } = require("./modem-command");
const { createOltCommand } = require("./olt-command");
const { createRedamanCommand } = require("./redaman-command");
const { createCekCommand } = require("./cek-command");
const { createTerakhirCommand } = require("./terakhir-command");

/**
 * @param {object} [overrides] - menimpa dependency (untuk test)
 * @returns {Object<string,Function>} peta perintah
 */
function buildCommandMap(overrides = {}) {
    const deps = {
        getUsers: () => global.users || [],
        getConfig: () => global.config || {},
        findOneCustomer,
        findById,
        getCustomerRedaman: (deviceId) => wifi.getCustomerRedaman(deviceId),
        getDeviceCoreInfo: (deviceId) => wifi.getDeviceCoreInfo(deviceId),
        getSSIDInfo: (deviceId, skipRefresh) => wifi.getSSIDInfo(deviceId, skipRefresh),
        getActivePPPoEUsers: (opts) => mikrotik.getActivePPPoEUsers(opts),
        resolveByCustomer: (user, ctx) => optical.resolveByCustomer(user, ctx),
        getOltSnapshot: (opts) => optical.getOltSnapshot(opts),
        ...overrides,
    };

    const help = createHelpCommand(deps);
    const cek = createCekCommand(deps);
    return {
        "/help": help,
        "/start": help,
        "/menu": help,
        "/cek": cek,
        "/diagnosa": cek,
        "/pelanggan": createPelangganCommand(deps),
        "/koneksi": createKoneksiCommand(deps),
        "/modem": createModemCommand(deps),
        "/olt": createOltCommand(deps),
        "/redaman": createRedamanCommand(deps),
        "/terakhir": createTerakhirCommand(deps),
    };
}

module.exports = { buildCommandMap };
