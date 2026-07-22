#!/usr/bin/env node
/**
 * Header Doc
 * Purpose: Aktifkan guard git repo ini TANPA setup manual — set `core.hooksPath=.githooks`
 *          (lokal repo) sehingga .githooks/pre-push jalan di setiap push. Idempoten, tidak
 *          menimpa hooksPath lain yang sudah diset sengaja, dan no-op total di salinan
 *          non-git (produksi = file copy tanpa .git).
 * Caller: `npm install` (package.json postinstall) atau manual `node scripts/setup-githooks.js`.
 * Deps: Node core (fs, path, child_process) + git di PATH.
 * MainFuncs: main().
 * SideEffects: menulis config git LOKAL repo (core.hooksPath). Tidak pernah exit != 0 —
 *              kegagalan di sini tak boleh menggagalkan npm install.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function git(args) {
    return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 10000, windowsHide: true });
}

function main() {
    try {
        // .git bisa berupa direktori (clone biasa) atau file (worktree) — dua-duanya sah.
        if (!fs.existsSync(path.join(ROOT, '.git'))) return; // prod copy / bukan repo → no-op senyap
        const cur = git(['config', '--local', 'core.hooksPath']);
        const val = (cur.stdout || '').trim();
        if (val === '.githooks') return; // sudah aktif
        if (val) {
            console.log(
                `[githooks] core.hooksPath sudah diset ke "${val}" — tidak diubah (set manual ke .githooks bila mau guard pre-push).`
            );
            return;
        }
        const res = git(['config', '--local', 'core.hooksPath', '.githooks']);
        if (res.status === 0) {
            console.log(
                '[githooks] core.hooksPath → .githooks (guard pre-push aktif; bypass darurat: git push --no-verify).'
            );
        }
    } catch (_err) {
        /* jangan pernah menggagalkan npm install */
    }
}

main();
