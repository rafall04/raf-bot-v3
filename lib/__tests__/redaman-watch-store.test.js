/**
 * Header Doc
 * Purpose: Guard Fase 4 ronde 5 (#b353) — store watch redaman DURABEL: add/count/listActive/
 *   removeByRequester + atomik (tmp+rename, tak ada .tmp sisa) + karantina berkas rusak.
 * Caller: Jest.
 * Deps: fs, os, path, ../redaman-watch-store (pakai filePath eksplisit ke os.tmpdir).
 * SideEffects: berkas sementara di os.tmpdir().
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const store = require("../redaman-watch-store");

let fp;
beforeEach(() => { fp = path.join(os.tmpdir(), `rw-${process.pid}-${Math.random().toString(36).slice(2)}.json`); });
afterEach(() => {
    try {
        for (const f of fs.readdirSync(os.tmpdir())) if (f.startsWith(path.basename(fp))) fs.unlinkSync(path.join(os.tmpdir(), f));
    } catch (_e) { /* abaikan */ }
});

const mk = (over = {}) => ({ requesterJid: "628@s.whatsapp.net", userId: 5, name: "Budi", pppoe: "budi@isp", intervalMs: 60000, expiresAt: new Date(Date.now() + 600000).toISOString(), ...over });

describe("redaman-watch-store (#b353)", () => {
    test("addWatch → countActive/listActive; requester tanpa userId ditolak", () => {
        expect(store.addWatch({ requesterJid: "x" }, fp)).toBeNull(); // tanpa userId
        const rec = store.addWatch(mk(), fp);
        expect(rec.id).toMatch(/^RW-/);
        expect(store.countActive(Date.now(), fp)).toBe(1);
        expect(store.listActive(Date.now(), fp).length).toBe(1);
    });

    test("removeByRequester menghentikan semua watch aktif requester itu", () => {
        store.addWatch(mk({ userId: 5 }), fp);
        store.addWatch(mk({ userId: 6 }), fp);
        store.addWatch(mk({ requesterJid: "629@s.whatsapp.net", userId: 7 }), fp);
        expect(store.removeByRequester("628@s.whatsapp.net", fp)).toBe(2);
        expect(store.countActive(Date.now(), fp)).toBe(1);
    });

    test("watch kedaluwarsa TIDAK dihitung aktif / tak masuk listActive", () => {
        store.addWatch(mk({ expiresAt: new Date(Date.now() - 1000).toISOString() }), fp);
        expect(store.countActive(Date.now(), fp)).toBe(0);
        expect(store.listActive(Date.now(), fp).length).toBe(0);
    });

    test("tulis ATOMIK — tak ada berkas .tmp-* tersisa", () => {
        store.addWatch(mk(), fp);
        const sisa = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(`${path.basename(fp)}.tmp-`));
        expect(sisa.length).toBe(0);
    });

    test("berkas rusak → loadWatches [] + karantina .rusak-*", () => {
        fs.writeFileSync(fp, "{ rusak tak valid", "utf8");
        expect(store.loadWatches(fp)).toEqual([]);
        expect(fs.existsSync(fp)).toBe(false);
        const kar = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(`${path.basename(fp)}.rusak-`));
        expect(kar.length).toBe(1);
    });
});
