/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan registrar admin aktif tidak memasang handler async langsung ke router.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`.
 * MainFuncs: Memindai source registrar admin dan menolak pola handler async tanpa `asyncHandler`.
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ADMIN_REGISTRAR_FILES = [
    "admin-config-routes.js",
    "admin-content-routes.js",
    "admin-database-routes.js",
    "admin-isolir-routes.js",
    "admin-logs-routes.js",
    "admin-network-assets-routes.js",
    "admin-ops-routes.js",
    "admin-voucher-routes.js",
    "admin-wifi-ops-routes.js",
    "admin.routes.js"
];

describe("admin registrar boundaries", () => {
    test("registrar admin tidak memasang handler async langsung ke router", () => {
        const offenders = [];

        for (const fileName of ADMIN_REGISTRAR_FILES) {
            const source = fs.readFileSync(path.join(__dirname, "..", fileName), "utf8");
            const nakedAsyncRouteMatches = source
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => /router\.(get|post|put|delete)\(/.test(line) && /async\s*\(/.test(line) && !line.includes("asyncHandler("));

            if (nakedAsyncRouteMatches.length > 0) {
                offenders.push({
                    fileName,
                    matches: nakedAsyncRouteMatches
                });
            }
        }

        expect(offenders).toEqual([]);
    });
});
