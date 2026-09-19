/**
 * Header Doc
 * Purpose: Jembatan satu arah console.* → lib/logger agar semua pemanggilan `console.log/warn/error`
 *   lama ikut menulis ke file log terotasi (logs/app-*.log, logs/error-*.log) tanpa mengubah ribuan
 *   callsite. `util.format(...args)` menjaga semantik console asli (substitusi %s/%j, util.inspect
 *   untuk objek, stack untuk Error).
 * Caller: `index.js` saat boot (`installConsoleBridge()`).
 * Deps: `util`, `./logger`.
 * MainFuncs: `installConsoleBridge`, `printRaw`.
 * SideEffects: Mengganti metode console.* proses ini; menulis file log via logger.
 *
 * Catatan: guard `insideBridge` mencegah rekursi — logger sendiri mencetak lewat console.* saat
 * `logToConsole=true`, jadi panggilan ulang diteruskan ke console ASLI. Pencetakan yang harus
 * tampil mentah (mis. ASCII-art QR pairing WhatsApp) pakai `printRaw`.
 */
"use strict";

const util = require("util");
const logger = require("./logger");

const ORIGINAL = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
};

let insideBridge = false;

const LEVEL_MAP = {
    log: "info",
    info: "info",
    debug: "debug",
    warn: "warn",
    error: "error"
};

function installConsoleBridge() {
    if (console.__rafLoggerBridgeInstalled) {
        return;
    }
    console.__rafLoggerBridgeInstalled = true;

    Object.entries(LEVEL_MAP).forEach(([consoleMethod, loggerMethod]) => {
        console[consoleMethod] = (...args) => {
            if (insideBridge) {
                ORIGINAL[consoleMethod](...args);
                return;
            }
            insideBridge = true;
            try {
                logger[loggerMethod](util.format(...args));
            } catch (bridgeError) {
                ORIGINAL.error(
                    "[CONSOLE_BRIDGE] logger gagal:",
                    bridgeError && bridgeError.message ? bridgeError.message : bridgeError
                );
                ORIGINAL[consoleMethod](...args);
            } finally {
                insideBridge = false;
            }
        };
    });
}

// Bypass jembatan untuk output yang harus tampil mentah ke terminal (ASCII-art QR, banner).
function printRaw(...args) {
    ORIGINAL.log(...args);
}

module.exports = {
    installConsoleBridge,
    printRaw
};
