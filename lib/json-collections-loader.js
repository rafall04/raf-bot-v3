/**
 * Header Doc
 * Purpose: Memisahkan bootstrap koleksi JSON runtime dan watcher announcements/news dari facade database legacy.
 * Caller: `lib/database.js`.
 * Deps: `fs`, `path`, `lib/json-store.js`, dan state global legacy.
 * MainFuncs: `loadReports`, `loadSpeedRequests`, `loadCompensations`, `setupAnnouncementsAndNewsWatchers`.
 * SideEffects: Membaca/menulis file JSON awal, memperbarui `global.*`, dan memasang file watcher.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { dbBasePath, loadJSON } = require("./json-store");

const reportsDbPath = path.join(dbBasePath, "reports.json");
const speedRequestsDbPath = path.join(dbBasePath, "speed_requests.json");
const compensationsDbPath = path.join(dbBasePath, "compensations.json");

function loadCollectionIntoGlobal(filePath, globalKey, fallbackValue = []) {
    try {
        if (fs.existsSync(filePath)) {
            const rawData = fs.readFileSync(filePath, "utf8");
            const parsedData = rawData ? JSON.parse(rawData) : fallbackValue;
            global[globalKey] = Array.isArray(fallbackValue) && !Array.isArray(parsedData) ? fallbackValue : parsedData;
            return global[globalKey];
        }

        fs.writeFileSync(filePath, JSON.stringify(fallbackValue, null, 2), "utf8");
        global[globalKey] = Array.isArray(fallbackValue) ? [...fallbackValue] : fallbackValue;
        console.log(`[DB_INIT] File ${path.relative(path.join(__dirname, ".."), filePath)} dibuat.`);
        return global[globalKey];
    } catch (error) {
        console.error(`[DB_LOAD_ERROR] Gagal memuat atau membuat ${path.relative(path.join(__dirname, ".."), filePath)}:`, error);
        global[globalKey] = Array.isArray(fallbackValue) ? [] : fallbackValue;
        return global[globalKey];
    }
}

function loadReports() {
    return loadCollectionIntoGlobal(reportsDbPath, "reports", []);
}

function loadSpeedRequests() {
    return loadCollectionIntoGlobal(speedRequestsDbPath, "speed_requests", []);
}

function loadCompensations() {
    return loadCollectionIntoGlobal(compensationsDbPath, "compensations", []);
}

function setupAnnouncementsAndNewsWatchers() {
    if (process.env.NODE_ENV === "test" || process.env.DISABLE_FILE_WATCHERS === "true") {
        return;
    }

    const watchedFiles = [
        { filePath: path.join(dbBasePath, "announcements.json"), globalKey: "announcements" },
        { filePath: path.join(dbBasePath, "news.json"), globalKey: "news" }
    ];

    function reloadFileWithRetry(fileName, globalKey, retries = 3, delay = 100) {
        setTimeout(() => {
            try {
                const data = loadJSON(fileName);
                global[globalKey] = data;
                console.log(`[Database] Reloaded ${Array.isArray(data) ? data.length : 0} ${globalKey}.`);
            } catch (error) {
                if (retries > 0) {
                    console.warn(`[Database] Error reloading ${globalKey}.json (retry ${4 - retries}/3):`, error.message);
                    reloadFileWithRetry(fileName, globalKey, retries - 1, delay * 2);
                } else {
                    console.error(`[Database] Error reloading ${globalKey}.json after 3 retries:`, error.message);
                }
            }
        }, delay);
    }

    let watcherCount = 0;
    watchedFiles.forEach(({ filePath, globalKey }) => {
        if (!fs.existsSync(filePath)) {
            return;
        }

        let lastMtime = fs.statSync(filePath).mtime.getTime();
        fs.watchFile(filePath, { interval: 1000 }, (curr, prev) => {
            const currMtime = curr.mtime ? curr.mtime.getTime() : 0;
            const prevMtime = prev.mtime ? prev.mtime.getTime() : 0;
            if (currMtime !== prevMtime && currMtime !== lastMtime) {
                lastMtime = currMtime;
                console.log(`[Database] ${path.basename(filePath)} changed`);
                reloadFileWithRetry(path.basename(filePath), globalKey, 3, 200);
            }
        });
        watcherCount += 1;
    });

    if (watcherCount > 0) {
        console.log(`[Database] ${watcherCount} file watcher(s) aktif`);
    }
}

module.exports = {
    loadReports,
    loadSpeedRequests,
    loadCompensations,
    setupAnnouncementsAndNewsWatchers
};
