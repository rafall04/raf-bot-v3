/**
 * Header Doc
 * Purpose: Skeleton owner contract untuk source export MikroTik yang dapat dipilih per section sebelum dipadukan ke import database pelanggan.
 * Caller: `services/api-network.service.js`.
 * Deps: `deps.getAllPPPoESecrets`, `deps.getPPPProfiles`, `deps.getHotspotProfiles`, dan `repositories/api-network.repository.js` untuk hint mapping paket/registrasi.
 * MainFuncs: `listMikrotikExportSources(deps, { include, includePasswords, actor })`.
 * SideEffects: Tidak ada; skeleton hanya mengembalikan kontrak payload read-only tanpa fetch live.
 */
"use strict";

function normalizeIncludeList(include) {
    if (Array.isArray(include)) {
        return include.map((item) => String(item || "").trim()).filter(Boolean);
    }

    return String(include || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function isSectionEnabled(includeSet, sectionName) {
    return includeSet.size === 0 || includeSet.has(sectionName);
}

async function listMikrotikExportSources(deps, { include, includePasswords = false, actor = null } = {}) {
    const includeList = normalizeIncludeList(include);
    const includeSet = new Set(includeList);
    const packages = typeof deps.repository?.getPackagesSnapshot === "function"
        ? deps.repository.getPackagesSnapshot()
        : [];

    return {
        status: 501,
        body: {
            status: 501,
            implemented: false,
            message: "Skeleton source export MikroTik siap. Approval logic penuh diperlukan sebelum fetch live diaktifkan.",
            actor: actor ? {
                id: actor.id || null,
                username: actor.username || null
            } : null,
            options: {
                include: includeList,
                includePasswords: Boolean(includePasswords)
            },
            sections: {
                pppoe_secrets: isSectionEnabled(includeSet, "pppoe_secrets") ? {
                    enabled: true,
                    fields: ["name", "password", "profile", "comment", "disabled", "service", "last_logged_out", "caller_id"],
                    customizableFields: ["name", "password", "profile", "comment", "disabled", "service"],
                    data: []
                } : null,
                ppp_profiles: isSectionEnabled(includeSet, "ppp_profiles") ? {
                    enabled: true,
                    fields: ["name"],
                    customizableFields: ["name"],
                    data: []
                } : null,
                hotspot_profiles: isSectionEnabled(includeSet, "hotspot_profiles") ? {
                    enabled: true,
                    fields: ["name", "rate_limit", "session_timeout", "idle_timeout", "keepalive_timeout", "shared_users"],
                    customizableFields: ["name", "rate_limit", "session_timeout", "idle_timeout", "keepalive_timeout", "shared_users"],
                    data: []
                } : null
            },
            mappingHints: {
                packages: packages.map((pkg) => ({
                    name: pkg.name || pkg.nama || null,
                    profile: pkg.profile || null,
                    price: pkg.price ?? pkg.harga ?? null
                }))
            }
        }
    };
}

module.exports = {
    listMikrotikExportSources
};
