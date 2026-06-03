/**
 * Header Doc
 * Purpose: Memusatkan business logic CRUD konfigurasi parameter GenieACS agar route admin config tetap tipis.
 * Caller: `routes/admin-config-routes.js`.
 * Deps: `lib/database` load/save JSON dan utilitas validasi error.
 * MainFuncs: `createGenieAcsParameterConfigService`, `listParameters`, `createParameter`, `updateParameter`, `deleteParameter`.
 * SideEffects: Membaca dan menulis `genieacs_parameters.json`.
 */
"use strict";

const { createError, ErrorTypes } = require("../lib/error-handler");

const PARAMETERS_FILE = "genieacs_parameters.json";

function defaultDeps() {
    return {
        loadJSON: require("../lib/database").loadJSON,
        saveJSON: require("../lib/database").saveJSON
    };
}

function requireFields(input = {}) {
    if (!input.type || !input.name || !Array.isArray(input.paths) || input.paths.length === 0) {
        throw createError(
            ErrorTypes.VALIDATION_ERROR,
            "Type, name, and paths array are required",
            400
        );
    }
}

function normalizePaths(paths) {
    return paths.filter((entry) => entry && String(entry).trim()).map((entry) => String(entry).trim());
}

function createGenieAcsParameterConfigService(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    function loadParameters() {
        return deps.loadJSON(PARAMETERS_FILE) || [];
    }

    return {
        listParameters() {
            return loadParameters();
        },

        createParameter(input, actorCtx) {
            requireFields(input);
            const parameters = loadParameters();
            const parameter = {
                id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
                type: input.type,
                name: input.name,
                description: input.description || "",
                paths: normalizePaths(input.paths),
                createdAt: new Date().toISOString(),
                createdBy: actorCtx.username
            };
            deps.saveJSON(PARAMETERS_FILE, parameters.concat(parameter));
            return parameter;
        },

        updateParameter(id, input, actorCtx) {
            requireFields(input);
            const parameters = loadParameters();
            const index = parameters.findIndex((item) => item.id === id);
            if (index === -1) {
                throw createError(ErrorTypes.NOT_FOUND_ERROR, "Parameter not found", 404);
            }

            parameters[index] = {
                ...parameters[index],
                type: input.type,
                name: input.name,
                description: input.description || "",
                paths: normalizePaths(input.paths),
                updatedAt: new Date().toISOString(),
                updatedBy: actorCtx.username
            };
            deps.saveJSON(PARAMETERS_FILE, parameters);
            return parameters[index];
        },

        deleteParameter(id) {
            const parameters = loadParameters();
            const filtered = parameters.filter((item) => item.id !== id);
            if (filtered.length === parameters.length) {
                throw createError(ErrorTypes.NOT_FOUND_ERROR, "Parameter not found", 404);
            }
            deps.saveJSON(PARAMETERS_FILE, filtered);
        }
    };
}

module.exports = {
    createGenieAcsParameterConfigService
};
