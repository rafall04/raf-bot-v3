/**
 * Header Doc
 * Purpose: Menyediakan factory router admin sebagai komposer bounded-context dengan dependency factory per-domain di depan router legacy.
 * Caller: `lib/routes-registry.js`.
 * Deps: Registrar admin domain, middleware auth admin, router legacy, dan helper runtime/shared route.
 * MainFuncs: `createAdminRouter`, `createAdmin*Deps`.
 * SideEffects: Mendaftarkan registrar domain baru lalu memasang router admin legacy untuk endpoint yang belum dipindah.
 */
"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const sqlite3 = require("sqlite3").verbose();
const { buatGerbangTeknisi, cocokkanJalur } = require("../lib/authz");
const { IZIN_TEKNISI_API } = require("./teknisi-izin-api");
const { createAdminRoutes } = require("./admin.routes");
const adminLegacyRouter = require("./admin");
const { ensureAuthenticatedStaff } = require("./admin-auth");
const { registerAdminConfigRoutes } = require("./admin-config-routes");
const { registerAdminIsolirRoutes } = require("./admin-isolir-routes");
const { registerAdminContentRoutes } = require("./admin-content-routes");
const { registerAdminOpsRoutes } = require("./admin-ops-routes");
const { registerAdminNetworkAssetsRoutes } = require("./admin-network-assets-routes");
const { registerAdminWifiOpsRoutes } = require("./admin-wifi-ops-routes");
const { registerAdminDatabaseRoutes } = require("./admin-database-routes");
const { registerAdminVoucherRoutes } = require("./admin-voucher-routes");
const { registerAdminLogsRoutes } = require("./admin-logs-routes");
const { registerAdminAutoOutageRoutes } = require("./admin-auto-outage-routes");
const { registerAdminLosBroadcastRoutes } = require("./admin-los-broadcast-routes");
const { registerAdminBroadcastTagihanRoutes } = require("./admin-broadcast-tagihan-routes");
const { registerAdminKonfirmasiBayarRoutes } = require("./admin-konfirmasi-bayar-routes");
const { registerAdminTelegramTeknisiRoutes } = require("./admin-telegram-teknisi-routes");
const { registerAdminUpstreamQualityRoutes } = require("./admin-upstream-quality-routes");
const { registerAdminWanSwitchRoutes } = require("./admin-wan-switch-routes");
const { registerAdminCustomerSteeringRoutes } = require("./admin-customer-steering-routes");
const { registerAdminOwnerCockpitRoutes } = require("./admin-owner-cockpit-routes");
const { registerAdminCsatRoutes } = require("./admin-csat-routes");
// Dompet PRIBADI sengaja hanya dipasang di instance tertentu (menumpang satu nomor bot),
// jadi berkasnya boleh TIDAK ADA di instance lain. Karena itu require-nya MALAS: `require`
// tingkat-atas membuat instance tanpa berkas ini gagal boot, dan kegagalan boot dari fitur
// opsional adalah harga yang tak sepadan.
function registerAdminPersonalFinanceRoutes(router, deps) {
    if (!(global.config && global.config.personalFinance && global.config.personalFinance.enabled === true)) return;
    try {
        require("./admin-personal-finance-routes").registerAdminPersonalFinanceRoutes(router, deps);
    } catch (e) {
        // Aktif di config tapi berkasnya tak terpasang = salah pasang yang harus TERLIHAT,
        // bukan didiamkan. Bot tetap hidup; halaman dompetnya yang absen.
        console.error("[ADMIN_ROUTER] Dompet pribadi aktif di config tapi modulnya tak terpasang:", e && e.message);
    }
}
const { registerAdminKasUsahaRoutes } = require("./admin-kas-usaha-routes");
const { rateLimit } = require("../lib/security");
const { templatesCache } = require("../lib/templating");
const templateManager = require("../lib/template-manager");
const templateService = require("../lib/template-service");
const { saveJSON, loadJSON, saveNetworkAssets, updateNetworkAssetsWithLock } = require("../lib/database");
const { getWifiChangeLogs, getWifiChangeStats, logWifiChange, buildWebWifiLogPayload } = require("../lib/wifi-logger");
const { isWithinWorkingHours, getNextAvailableMessage } = require("../lib/working-hours-helper");
const { getLoginLogs, getActivityLogs, logActivity } = require("../lib/activity-logger");
const { updateWifiSettings } = require("../lib/wifi");
const { getMultipleDeviceMetrics } = require("../lib/wifi");
const { getGenieAcsDiagnostics, getWifiInfo } = require("../lib/genieacs");
const { getParameterValue, getParameterValueByPath } = require("../lib/genieacs");
const { getMikrotikDiagnostics, getPppStats, getHotspotStats } = require("../lib/mikrotik");
const { getActivePPPoEUsers, getPPPProfiles, assertMikrotikResult, getAllPPPoESecrets } = require("../lib/mikrotik");
const agentVoucherManager = require("../lib/agent-voucher-manager");
const agentManager = require("../lib/agent-manager");
const { renderTemplate } = require("../lib/templating");
const { appendVoucherSentHistory, buildVoucherSentHistoryEntries } = require("../lib/voucher-delivery");
const { generateAssetId, getVoucherProfileById, buildVoucherProfileSnapshot, sendVoucherTextToPhones } = require("./admin-shared");

function createAdminContentDeps(runtime) {
    return {
        ensureAuthenticatedStaff,
        runtime,
        templateManager,
        templateService,
        templatesCache,
        saveJSON
    };
}

function createAdminConfigDeps(runtime) {
    return {
        ensureAuthenticatedStaff,
        runtime,
        logActivity,
        loadJSON,
        saveJSON
    };
}

function createAdminIsolirDeps() {
    return {
        ensureAuthenticatedStaff,
        logActivity
    };
}

function createAdminNetworkAssetsDeps(runtime) {
    return {
        ensureAuthenticatedStaff,
        runtime,
        rateLimit,
        generateAssetId,
        updateNetworkAssetsWithLock,
        saveNetworkAssets
    };
}

function createAdminWifiOpsDeps(runtime) {
    return {
        ensureAuthenticatedStaff,
        runtime,
        rateLimit,
        fs,
        path,
        getWifiChangeLogs,
        getWifiChangeStats,
        logWifiChange,
        buildWebWifiLogPayload,
        isWithinWorkingHours,
        getNextAvailableMessage,
        updateWifiSettings,
        getMultipleDeviceMetrics,
        getGenieAcsDiagnostics,
        getWifiInfo,
        getParameterValue,
        getParameterValueByPath,
        getMikrotikDiagnostics,
        getPppStats,
        getHotspotStats,
        getActivePPPoEUsers,
        getPPPProfiles,
        assertMikrotikResult
    };
}

function createAdminDatabaseDeps() {
    return {
        ensureAuthenticatedStaff,
        fs,
        path,
        exec,
        sqlite3
    };
}

function createAdminVoucherDeps(runtime) {
    return {
        ensureAuthenticatedStaff,
        runtime,
        loadJSON,
        agentVoucherManager,
        agentManager,
        renderTemplate,
        appendVoucherSentHistory,
        buildVoucherSentHistoryEntries,
        getVoucherProfileById,
        buildVoucherProfileSnapshot,
        sendVoucherTextToPhones
    };
}

function createAdminLogsDeps() {
    return {
        ensureAuthenticatedStaff,
        getLoginLogs,
        getActivityLogs
    };
}

function createAdminOpsDeps(runtime) {
    return {
        ensureAuthenticatedStaff,
        runtime,
        logActivity
    };
}

function createAdminAutoOutageDeps(runtime) {
    return {
        ensureAuthenticatedStaff,
        runtime,
        getActivePPPoEUsers,
        getAllPPPoESecrets
    };
}

function createAdminLosBroadcastDeps(runtime) {
    return {
        ensureAuthenticatedStaff,
        runtime,
        logActivity
    };
}

function createAdminTelegramTeknisiDeps(runtime) {
    return {
        ensureAuthenticatedStaff,
        runtime,
        logActivity
    };
}

function createAdminRouter({ runtime } = {}) {
    const router = express.Router();

    // !! GERBANG GAGAL-TERTUTUP UNTUK TEKNISI (#b253) — HARUS di baris pertama, sebelum registrar
    // mana pun, supaya rute BARU otomatis tertutup tanpa penulisnya perlu ingat apa-apa.
    // Latar: `ensureAuthenticatedStaff` (gerbang bawaan seluruh registrar di bawah) MEMASUKKAN
    // peran `teknisi`, jadi selama ini endpoint admin lahir TERBUKA dan menutupnya bergantung
    // pada cek kedua manual di dalam handler — terukur 119 dari 185 rute hidup tak punya itu,
    // dan akibat terburuknya sudah terbukti live (#b252: kredensial router inti terbaca teknisi).
    // Gerbang ini HANYA bertindak untuk peran teknisi; peran lain lewat apa adanya.
    //
    // !! DAN HANYA untuk jalur yang MEMANG MILIK router ini. Router ini dipasang di ROOT
    // (`app.use("/", adminApiRouter)`), jadi middleware di dalamnya mencegat SETIAP permintaan
    // aplikasi — halaman PHP, router kasbon/tiket/users, semuanya. Tanpa penyaring kepemilikan,
    // gerbang menolak `/teknisi-pelanggan` dan `/api/users` yang bukan urusannya (terbukti saat
    // uji lokal). Daftar kepemilikan diisi SETELAH semua registrar jalan, dan dibaca saat
    // permintaan datang — jadi isinya sudah lengkap ketika gerbang benar-benar dipakai.
    const jalurMilikRouterIni = [];
    router.use(buatGerbangTeknisi(IZIN_TEKNISI_API, {
        milikRouter: (method, jalur) => jalurMilikRouterIni.some(
            (r) => (!r.method || r.method === String(method).toUpperCase()) && cocokkanJalur(r.jalur, jalur)
        )
    }));

    registerAdminContentRoutes(router, createAdminContentDeps(runtime));
    registerAdminConfigRoutes({ router, ...createAdminConfigDeps(runtime) });
    registerAdminIsolirRoutes({ router, ...createAdminIsolirDeps() });
    registerAdminNetworkAssetsRoutes(router, createAdminNetworkAssetsDeps(runtime));
    registerAdminWifiOpsRoutes(router, createAdminWifiOpsDeps(runtime));
    registerAdminDatabaseRoutes(router, createAdminDatabaseDeps());
    registerAdminVoucherRoutes(router, createAdminVoucherDeps(runtime));
    registerAdminLogsRoutes(router, createAdminLogsDeps());
    registerAdminOpsRoutes(router, createAdminOpsDeps(runtime));
    registerAdminAutoOutageRoutes(router, createAdminAutoOutageDeps(runtime));
    registerAdminLosBroadcastRoutes(router, createAdminLosBroadcastDeps(runtime));
    registerAdminBroadcastTagihanRoutes(router, { ensureAuthenticatedStaff });
    registerAdminKonfirmasiBayarRoutes(router);
    registerAdminTelegramTeknisiRoutes(router, createAdminTelegramTeknisiDeps(runtime));
    registerAdminUpstreamQualityRoutes(router, { ensureAuthenticatedStaff });
    registerAdminWanSwitchRoutes(router, { ensureAuthenticatedStaff });
    registerAdminCustomerSteeringRoutes(router, { ensureAuthenticatedStaff });
    registerAdminOwnerCockpitRoutes(router, { ensureAuthenticatedStaff });
    registerAdminCsatRoutes(router, { ensureAuthenticatedStaff });
    registerAdminPersonalFinanceRoutes(router, { ensureAuthenticatedStaff });
    registerAdminKasUsahaRoutes(router, { ensureAuthenticatedStaff });
    router.use(createAdminRoutes({ runtime }));
    router.use(adminLegacyRouter);

    // Isi daftar kepemilikan SETELAH semua registrar jalan. Hanya rute yang benar-benar
    // terdaftar DI SINI yang boleh disentuh gerbang teknisi di atas; sisanya (halaman PHP,
    // router kasbon/tiket/users yang dipasang terpisah) lewat apa adanya.
    // Sub-router yang dipasang lewat `router.use` (admin.routes & legacy) rutenya ada di
    // `layer.handle.stack`, jadi ikut ditelusuri satu tingkat.
    function kumpulkanJalur(stack, hasil) {
        for (const layer of stack || []) {
            if (layer.route && layer.route.path) {
                Object.keys(layer.route.methods || {}).forEach((m) => {
                    hasil.push({ method: m.toUpperCase(), jalur: layer.route.path });
                });
            } else if (layer.handle && layer.handle.stack) {
                kumpulkanJalur(layer.handle.stack, hasil);
            }
        }
    }
    kumpulkanJalur(router.stack, jalurMilikRouterIni);

    return router;
}

module.exports = {
    createAdminRouter
};
