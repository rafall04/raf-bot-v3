/**
 * Header Doc
 * Purpose: Guardrail tekstual untuk memastikan hotspot route HTTP hasil stabilisasi tetap repo-first dan tidak kembali ke literal `global.*`.
 * Caller: Jest.
 * Deps: `fs`, `path`, dan file route HTTP target stabilisasi runtime.
 * MainFuncs: Memastikan `api-users`, `api-psb`, `api-network`, dan `api-voucher` tidak lagi mengandung akses literal `global.users/packages/db/config`.
 * SideEffects: Membaca source file route secara read-only.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function readSource(relativePath) {
    return fs.readFileSync(path.join(__dirname, "..", "..", relativePath), "utf8");
}

// Buang komentar sebelum mencocokkan literal: penjelasan di dalam `//`/`/* */` (mis.
// "hot-reload global.config") BUKAN akses global runtime — dulu tes ini merah permanen
// hanya karena satu komentar. Idiom yang sama dipakai kunci-dan-fallback-template.test.js.
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((baris) => baris.replace(/(^|[^:])\/\/.*$/, "$1"))
        .join("\n");
}

describe("runtime migration guardrails", () => {
    const routeTargets = [
        "routes/api-users-routes.js",
        "routes/api-psb-routes.js",
        "routes/api-network-routes.js",
        "routes/api-voucher-routes.js",
        "routes/admin-config-routes.js",
        "routes/admin-content-routes.js",
        "routes/admin-voucher-routes.js",
    ];

    test.each(routeTargets)("%s no longer uses direct global runtime literals", (relativePath) => {
        const source = stripComments(readSource(relativePath));
        expect(source).not.toContain("global.users");
        expect(source).not.toContain("global.packages");
        expect(source).not.toContain("global.db");
        expect(source).not.toContain("global.config");
    });
});
