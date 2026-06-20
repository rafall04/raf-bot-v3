#!/usr/bin/env node
/**
 * Header Doc
 * Purpose: Hook PostToolUse RAF Bot V2 — beri peringatan dini (non-blocking) ketika file .js
 *          yang baru diedit menyentuh footgun invariant proyek (import Baileys langsung,
 *          socket WA mentah di message layer, saldo amount 0, teks user-facing hardcoded,
 *          akses process.env langsung). Opsional menjalankan ESLint pada file teredit.
 * Caller: Claude Code hook runner (didaftarkan di .claude/settings.json -> hooks.PostToolUse).
 * Deps: Node core (fs, path, child_process). Read-only terhadap source — tidak mengubah file.
 * MainFuncs: main(), collectWarnings(), runEslint().
 * SideEffects: Membaca file teredit; (opsional) spawn ESLint read-only; tulis additionalContext ke stdout.
 *
 * Catatan:
 * - Sengaja NON-BLOCKING: hanya menyuntik konteks lewat hookSpecificOutput.additionalContext,
 *   tidak pernah exit !=0 / "block". Heuristik dibuat ber-false-positive rendah; kalau toh
 *   salah, Claude tinggal mengabaikannya — jauh lebih baik daripada menghambat editing.
 * - File test (__tests__/ atau *.test.js) dikecualikan dari cek footgun karena memang
 *   memuat string terlarang sebagai assertion (lihat message/__tests__/wa-forbidden-imports.test.js).
 * - ESLint default AKTIF; matikan dengan env RAF_HOOK_ESLINT=0 bila terasa lambat.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const SKIP_DIRS = ['node_modules/', '.claude/', 'tmp/', 'dist/', 'build/', 'backups/', 'coverage/', '.worktrees/'];

function readStdin() {
    try {
        return fs.readFileSync(0, 'utf8');
    } catch (_err) {
        return '';
    }
}

function toRel(absPath) {
    return path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
}

function isLintableJs(rel) {
    if (!rel || rel.startsWith('..')) return false;
    if (!/\.(js|cjs|mjs)$/.test(rel)) return false;
    return !SKIP_DIRS.some((d) => rel.startsWith(d) || rel.includes('/' + d));
}

function isTestFile(rel) {
    return rel.includes('__tests__/') || /\.test\.(js|cjs|mjs)$/.test(rel);
}

/**
 * Kumpulkan peringatan invariant untuk satu file source (non-test).
 * @param {string} rel - path relatif dari root, separator '/'
 * @param {string} content - isi file
 * @returns {string[]}
 */
function collectWarnings(rel, content) {
    const warnings = [];
    const inMessageLayer = rel.startsWith('message/');
    const isReplyRuntime = rel === 'message/handlers/reply-runtime.js';
    const allowedBaileys = rel === 'index.js' || rel === 'lib/whatsapp.adapter.js' || rel === 'lib/baileys-import.js';

    // 1) Import Baileys langsung di luar file yang diizinkan.
    if (!allowedBaileys && content.includes('@whiskeysockets/baileys')) {
        warnings.push(
            'Import Baileys langsung. Hanya boleh di index.js / lib/whatsapp.adapter.js / lib/baileys-import.js. ' +
                'Layer lain pakai lib/whatsapp-gateway.js atau lib/whatsapp.adapter.js. (skill raf-invariants > Kirim WhatsApp)'
        );
    }

    // 2) Socket WA mentah di message layer (handler/router aktif).
    if (inMessageLayer && !isReplyRuntime && /\bglobal\.raf\b/.test(content)) {
        warnings.push(
            '`global.raf` di message layer. Handler tidak boleh menyentuh socket langsung — ' +
                'balas lewat helper reply()/reply-runtime.js. (ditegakkan wa-forbidden-imports.test.js)'
        );
    }
    if (inMessageLayer && !isReplyRuntime && /\.sendMessage\s*\(/.test(content)) {
        warnings.push(
            '`.sendMessage(` mentah di message layer. Kirim lewat reply-runtime.js / delivery service, ' +
                'bukan socket langsung. (ditegakkan wa-forbidden-imports.test.js)'
        );
    }

    // 3) Mutasi saldo dengan amount literal 0.
    if (/\b(addSaldo|addKoinUser)\s*\([^)]*,\s*0\s*\)/.test(content)) {
        warnings.push(
            'addSaldo/addKoinUser dipanggil dengan amount 0. Jangan menulis saldo dengan amount 0/undefined; ' +
                'untuk init record pakai saldoManager.createUserSaldo(userId) (idempotent). (skill raf-invariants > Saldo & Pembayaran)'
        );
    }

    // 4) Teks user-facing yang kemungkinan di-hardcode (hanya layer pesan/web/service).
    if (/^(message|routes|services)\//.test(rel)) {
        const replyLiteral = /\breply\(\s*[`'"][^`'"]{20,}/.test(content);
        const sendTextLiteral = /text:\s*[`'"][^`'"]{20,}/.test(content);
        if (replyLiteral || sendTextLiteral) {
            warnings.push(
                'Kemungkinan teks user-facing di-hardcode. Render lewat renderResponseTemplate(key, fallback, data) ' +
                    '(lib/response-template-helper.js) dan tambah key di database/*_templates.json. (skill raf-invariants > Template Pesan)'
            );
        }
    }

    // 5) Akses process.env langsung (kecuali NODE_ENV & resolver env-config sendiri).
    if (rel !== 'lib/env-config.js' && /process\.env\.(?!NODE_ENV\b)[A-Za-z_]+/.test(content)) {
        warnings.push(
            'Akses `process.env.*` langsung. Pakai global.config / helper lib/env-config.js ' +
                '(loadConfig/getDatabasePath), jangan baca env langsung di kode app.'
        );
    }

    return warnings;
}

/**
 * Jalankan ESLint pada file teredit (read-only). Kembalikan ringkasan masalah, atau '' bila bersih.
 */
function runEslint(absPath) {
    if (process.env.RAF_HOOK_ESLINT === '0') return '';
    const eslintBin = path.join(REPO_ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
    if (!fs.existsSync(eslintBin)) return '';
    try {
        // Formatter 'json' dipakai (bukan 'compact' yang sudah dihapus dari ESLint v9 core)
        // lalu kita rakit ringkasan sendiri agar stabil lintas-versi.
        const res = spawnSync(process.execPath, [eslintBin, '--format', 'json', absPath], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            timeout: 20000,
            windowsHide: true
        });
        const raw = (res.stdout || '').trim();
        if (!raw) return ''; // exit 2 / config error / file di-ignore -> jangan suntik apa pun
        let report;
        try {
            report = JSON.parse(raw);
        } catch (_e) {
            return '';
        }
        const fileReport = Array.isArray(report) ? report[0] : null;
        if (!fileReport || !Array.isArray(fileReport.messages) || !fileReport.messages.length) {
            return '';
        }
        return fileReport.messages
            .map((m) => {
                const sev = m.severity === 2 ? 'error' : 'warn';
                const rule = m.ruleId ? ` [${m.ruleId}]` : '';
                return `  ${m.line}:${m.column} ${sev}${rule} ${m.message}`;
            })
            .join('\n');
    } catch (_err) {
        return '';
    }
}

function main() {
    let payload;
    try {
        payload = JSON.parse(readStdin() || '{}');
    } catch (_err) {
        return; // input tak valid -> jangan ganggu flow
    }

    const absPath = payload && payload.tool_input && payload.tool_input.file_path;
    if (!absPath) return;

    const rel = toRel(absPath);
    if (!isLintableJs(rel)) return;

    let content = '';
    try {
        content = fs.readFileSync(absPath, 'utf8');
    } catch (_err) {
        return;
    }

    const warnings = isTestFile(rel) ? [] : collectWarnings(rel, content);
    const eslintOut = runEslint(absPath);

    const parts = [];
    if (warnings.length) {
        parts.push(`Invariant RAF Bot — periksa ${rel}:\n` + warnings.map((w) => `  • ${w}`).join('\n'));
    }
    if (eslintOut) {
        parts.push(`ESLint ${rel}:\n${eslintOut}`);
    }
    if (!parts.length) return;

    const output = {
        hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: parts.join('\n\n')
        }
    };
    process.stdout.write(JSON.stringify(output));
}

main();
