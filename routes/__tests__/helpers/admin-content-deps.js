/**
 * Header Doc
 * Purpose: Pabrik dependensi tiruan untuk `registerAdminContentRoutes`, dipakai bersama oleh
 *          suite kontrak dan suite gerbang peran.
 * Caller: `routes/__tests__/gerbang-admin-gelombang1.test.js` (dan suite lain yang butuh).
 * Deps: `jest` (global saat dijalankan test runner).
 * MainFuncs: `buatDepsKonten`.
 * SideEffects: Tidak ada — seluruh isinya jest.fn / data in-memory.
 *
 * CATATAN: berkas ini ada di `__tests__/helpers/` dan BUKAN berakhiran `.test.js`, jadi jest
 * tidak menjalankannya sebagai suite.
 */
"use strict";

function buatDepsKonten() {
    return {
        runtime: {
            repositories: {
                announcements: { getAll: jest.fn(() => []), setAll: jest.fn((v) => v) },
                news: { getAll: jest.fn(() => []), setAll: jest.fn((v) => v) },
                users: { getAll: jest.fn(() => []) },
            },
        },
        ensureAuthenticatedStaff: jest.fn((req, res, next) => next()),
        loadJSON: jest.fn(() => []),
        saveJSON: jest.fn(),
        loadWifiTemplates: jest.fn(),
        hasAuthenticatedSession: jest.fn(() => true),
        sendMessageToMany: jest.fn(() => Promise.resolve({ ok: true })),
        normalizePhoneNumber: jest.fn((v) => String(v || "").trim()),
        logActivity: jest.fn(async () => {}),
        templateService: {
            loadAllCategories: jest.fn(() => ({})),
            saveCategory: jest.fn(),
            getDiagnostics: jest.fn(() => ({ categories: {} })),
        },
        templateManager: { reloadTemplates: jest.fn() },
        templatesCache: {
            notificationTemplates: {},
            wifiMenuTemplates: {},
            responseTemplates: {},
            commandTemplates: {},
            errorTemplates: {},
            successTemplates: {},
            systemTemplates: {},
            menuTemplates: {},
            reportTemplates: {},
        },
    };
}

module.exports = { buatDepsKonten };
