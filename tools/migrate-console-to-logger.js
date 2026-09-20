#!/usr/bin/env node
/**
 * Header Doc
 * Purpose: Codemod SATU-KALI migrasi `console.(log|info|warn|error|debug)(...)` → logger
 *   terstruktur per-file (`log.<level>(...)` dengan `const log = require('<rel>lib/logger')
 *   .logger.child('<BASENAME>')`). Argumen callsite TIDAK diubah — Logger kini variadic
 *   (util.format internal) jadi semantik console asli terjaga 1:1.
 * Caller: manual — `node tools/migrate-console-to-logger.js [--dry] [dir ...]`.
 * Deps: @babel/parser, @babel/traverse (sudah ada sebagai dep jest). Splice teks by posisi
 *   (bukan regen AST) supaya formatting file tetap identik di luar callsite.
 * MainFuncs: collectTargets, transformFile, main.
 * SideEffects: Menulis file .js di tempat; output laporan migrasi ke stdout.
 *
 * Catatan keamanan transform:
 *  - Hanya CallExpression langsung `console.X(...)`: `console['log']`, `console.log.call`,
 *    `console.log` sebagai nilai (`.then(console.log)`) DI-SKIP (tetap tertangkap bridge).
 *  - Import `log` disisipkan SETELAH directive "use strict" (sebelum require lain) supaya
 *    tidak ada callsite top-level yang mengenai TDZ.
 *  - Nama binding dipilih dari ['log','logger','appLog','rafLog'] yang tidak punya binding
 *    di mana pun di file (param `log` dalam fungsi pun dihitung via scope.getBinding per
 *    callsite). File yang tidak aman dinamai di-skip dan dilaporkan.
 *  - File yang sudah punya binding ke modul logger (module object / {logger} / .logger)
 *    memakai nama itu apa adanya — tanpa import baru — asalkan posisinya mendahului semua
 *    callsite; kalau tidak, binding baru disuntikkan di atas.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverseModule = require("@babel/traverse");
const traverse = traverseModule.default || traverseModule;

const REPO_ROOT = path.resolve(__dirname, "..");
const LOGGER_ABS = path.join(REPO_ROOT, "lib", "logger");

const METHOD_MAP = {
    log: "info",
    info: "info",
    debug: "debug",
    warn: "warn",
    error: "error",
};

const SKIP_BASENAMES = new Set(["logger.js", "console-to-logger.js"]);
const NAME_CANDIDATES = ["log", "logger", "appLog", "rafLog"];

function isLoggerModuleRequire(initNode, fileDir) {
    // initNode: CallExpression require('<str>')
    if (!initNode || initNode.type !== "CallExpression") return false;
    const callee = initNode.callee;
    if (!(callee.type === "Identifier" && callee.name === "require")) return false;
    const arg = initNode.arguments && initNode.arguments[0];
    if (!(arg && arg.type === "StringLiteral")) return false;
    const resolved = path.resolve(fileDir, arg.value);
    return resolved === LOGGER_ABS || resolved === LOGGER_ABS + ".js";
}

function bindingCoversCallSites(scope, name, callSites) {
    // true bila `name` teresolve ke binding yang sama (atau tak terikat) di tiap callsite.
    // Binding yang lebih dalam (param `log` di fungsi) yang membayangi → return false.
    const wanted = scope.getBinding(name);
    for (const cs of callSites) {
        const b = cs.scope.getBinding(name);
        if (b !== wanted) return false;
    }
    return true;
}

function collectAllBindingNames(programPath) {
    const names = new Set();
    programPath.traverse({
        BindingIdentifier(p) {
            names.add(p.node.name);
        },
    });
    return names;
}

function collectCallSites(programPath) {
    const callSites = [];
    const skipped = [];
    programPath.traverse({
        CallExpression(p) {
            const callee = p.node.callee;
            if (
                callee &&
                callee.type === "MemberExpression" &&
                !callee.computed &&
                callee.object.type === "Identifier" &&
                callee.object.name === "console" &&
                callee.property.type === "Identifier" &&
                METHOD_MAP[callee.property.name]
            ) {
                callSites.push({ node: p.node, callee, scope: p.scope });
            }
        },
        MemberExpression(p) {
            // Deteksi pemakaian non-call: console['X'], console.log.call/apply, dll.
            const n = p.node;
            const isDirectCallCallee =
                p.parentPath &&
                p.parentPath.node &&
                (p.parentPath.node.type === "CallExpression") &&
                p.parentPath.node.callee === n;
            if (
                n.object.type === "Identifier" &&
                n.object.name === "console" &&
                !(n.computed === false && n.property.type === "Identifier" && METHOD_MAP[n.property.name] && isDirectCallCallee)
            ) {
                skipped.push(n.start);
            }
        },
    });
    return { callSites, skipped };
}

function transformFile(absPath) {
    const src = fs.readFileSync(absPath, "utf8");
    const ast = parser.parse(src, {
        sourceType: "unambiguous",
        errorRecovery: true,
        plugins: ["optionalChaining"],
    });
    const program = ast.program;
    const errors = [];

    let result = { changed: 0, skippedRefs: 0, skippedFile: null };
    if (program.body.length === 0) return result;

    let programPath;
    traverse(ast, {
        Program(p) {
            programPath = p;
            p.stop();
        },
    });

    const { callSites, skipped } = collectCallSites(programPath);
    result.skippedRefs = skipped.length;
    if (callSites.length === 0) return result;

    // Cari binding logger yang sudah ada — dipakai ulang bila posisinya sebelum
    // semua callsite (menghindari TDZ pada callsite di require-block).
    const fileDir = path.dirname(absPath);
    let existingName = null;
    let existingPos = -1;
    programPath.traverse({
        VariableDeclarator(p) {
            const init = p.node.init;
            if (!init) return;
            if (isLoggerModuleRequire(init, fileDir)) {
                // `const logger = require('.../logger')` → module object (punya .info dll.)
                if (p.node.id.type === "Identifier") {
                    existingName = p.node.id.name;
                    existingPos = p.node.id.start;
                }
                return;
            }
            // `const X = require('.../logger').logger` → instance Logger.
            if (
                init.type === "MemberExpression" &&
                init.property.type === "Identifier" &&
                init.property.name === "logger" &&
                isLoggerModuleRequire(init.object, fileDir) &&
                p.node.id.type === "Identifier"
            ) {
                existingName = p.node.id.name;
                existingPos = p.node.id.start;
                return;
            }
            // `const { logger } = require('.../logger')` → destructure member .logger.
            if (p.node.id.type === "ObjectPattern" && isLoggerModuleRequire(init, fileDir)) {
                for (const prop of p.node.id.properties) {
                    if (
                        prop.type === "ObjectProperty" &&
                        prop.key.type === "Identifier" &&
                        prop.key.name === "logger" &&
                        prop.value.type === "Identifier"
                    ) {
                        existingName = prop.value.name;
                        existingPos = prop.value.start;
                    }
                }
            }
        },
    });

    let bindName = null;
    let needsImport = true;
    const firstCallSitePos = Math.min(...callSites.map((c) => c.node.start));
    const allNames = collectAllBindingNames(programPath);

    if (
        existingName &&
        existingPos < firstCallSitePos &&
        bindingCoversCallSites(programPath.scope, existingName, callSites)
    ) {
        bindName = existingName;
        needsImport = false;
    }

    if (!bindName) {
        for (const cand of NAME_CANDIDATES) {
            if (allNames.has(cand)) continue;
            // Tak boleh ada binding cand di mana pun pada scope-chain tiap callsite.
            if (callSites.every((cs) => cs.scope.getBinding(cand) === undefined)) {
                bindName = cand;
                break;
            }
        }
    }
    if (!bindName) {
        result.skippedFile = "nama binding aman tidak ditemukan";
        return result;
    }

    const edits = [];
    for (const { callee } of callSites) {
        edits.push({ start: callee.start, end: callee.end, text: `${bindName}.${METHOD_MAP[callee.property.name]}` });
    }

    if (needsImport) {
        // Posisi sisip: setelah directive prolog ("use strict" dkk.), sebelum stmt pertama.
        const directives = program.directives || [];
        const insertAt = directives.length ? directives[directives.length - 1].end : program.body[0].start;
        const relRequire = relLoggerSpecifier(fileDir);
        const tag = tagFor(absPath);
        const stmt = `const ${bindName} = require('${relRequire}').logger.child('${tag}');`;
        // Pertahankan pemisah baris file.
        const nl = src.includes("\r\n") ? "\r\n" : "\n";
        const text = directives.length ? `${nl}${stmt}${nl}` : `${stmt}${nl}`;
        edits.push({ start: insertAt, end: insertAt, text });
    }

    // Terapkan edit dari belakang ke depan supaya offset tetap valid.
    edits.sort((a, b) => b.start - a.start);
    let out = src;
    for (const e of edits) {
        out = out.slice(0, e.start) + e.text + out.slice(e.end);
    }
    if (out !== src) {
        result.changed = callSites.length;
        if (!DRY_RUN) fs.writeFileSync(absPath, out);
    }
    return result;
}

function tagFor(absPath) {
    const base = path.basename(absPath, ".js");
    return base.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase() || "APP";
}

function relLoggerSpecifier(fileDir) {
    let rel = path.posix.relative(fileDir.split(path.sep).join(path.posix.sep), "lib/logger");
    if (!rel.startsWith(".")) rel = "./" + rel;
    return rel;
}

function* walkJs(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (["node_modules", "__tests__", ".git", ".worktrees", "tmp", "dist", "sessions", "logs", "static", "tools", "scripts", "views"].includes(entry.name)) continue;
            yield* walkJs(full);
        } else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js") && !SKIP_BASENAMES.has(entry.name)) {
            yield full;
        }
    }
}

const DRY_RUN = process.argv.includes("--dry");
const roots = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((a) => path.resolve(REPO_ROOT, a));
const dirs = roots.length ? roots : ["lib", "services", "routes", "message", "repositories"].map((d) => path.join(REPO_ROOT, d));

let totalCalls = 0;
let totalFiles = 0;
let totalSkippedRefs = 0;
const skippedFiles = [];
for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of walkJs(dir)) {
        try {
            const r = transformFile(file);
            if (r.skippedFile) {
                skippedFiles.push(`${path.relative(REPO_ROOT, file)}: ${r.skippedFile}`);
            } else if (r.changed) {
                totalFiles += 1;
                totalCalls += r.changed;
                totalSkippedRefs += r.skippedRefs;
                console.log(`${DRY_RUN ? "[dry] " : ""}${path.relative(REPO_ROOT, file)}: ${r.changed} callsite${r.skippedRefs ? ` (+${r.skippedRefs} ref di-skip)` : ""}`);
            }
        } catch (err) {
            skippedFiles.push(`${path.relative(REPO_ROOT, file)}: PARSE/FAIL ${err.message}`);
        }
    }
}
console.log(`\n== ${DRY_RUN ? "DRY RUN — " : ""}${totalCalls} callsite di ${totalFiles} file; ${totalSkippedRefs} console-ref non-call di-skip ==`);
if (skippedFiles.length) {
    console.log("File di-skip:");
    skippedFiles.forEach((f) => console.log("  -", f));
}
