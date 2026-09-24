/**
 * Header Doc
 * Purpose: Mengunci perbaikan insiden b403 (21 Sep 2026) — merge deploy yang menulis
 *   wifi_templates.json (array) sebagai object ber-key numerik lewat `{...array}` membuat
 *   wifiTemplates.map TypeError di setiap pesan masuk -> kedua bot bisu ~2 hari. Test ini
 *   memastikan merge-data-json menolak perubahan bentuk dan hanya menambah entri/key hilang.
 * Caller: Jest (`npx jest scripts/__tests__/merge-data-json.test.js`).
 * Deps: scripts/merge-data-json.js, fs, os, path (tmp file).
 * SideEffects: menulis file temporer di os.tmpdir(), dibersihkan di afterEach.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { mergeJsonData, verifyShapes, detectArrayKey } = require("../merge-data-json");

describe("mergeJsonData — dict", () => {
    test("menambah key hilang dari repo, nilai prod tidak berubah", () => {
        const prod = { a: "prod", b: { x: 1 } };
        const repo = { a: "repo-baru", c: "baru" };
        const { merged, addedCount, addedKeys } = mergeJsonData(prod, repo);
        expect(addedCount).toBe(1);
        expect(addedKeys).toEqual(["c"]);
        expect(merged).toEqual({ a: "prod", b: { x: 1 }, c: "baru" });
        expect(Object.keys(merged)).toEqual(["a", "b", "c"]); // urutan prod dulu
    });

    test("tidak menambah apa pun bila prod sudah lengkap", () => {
        const { addedCount, merged } = mergeJsonData({ a: 1 }, { a: 2 });
        expect(addedCount).toBe(0);
        expect(merged).toEqual({ a: 1 });
    });
});

describe("mergeJsonData — array", () => {
    test("menambah entri ber-intent baru ke ujung, entri prod utuh", () => {
        const prod = [{ intent: "A", keywords: ["a"] }, { intent: "B", keywords: ["b-prod"] }];
        const repo = [{ intent: "B", keywords: ["b-repo"] }, { intent: "C", keywords: ["c"] }];
        const { merged, addedCount, keyField } = mergeJsonData(prod, repo);
        expect(keyField).toBe("intent");
        expect(addedCount).toBe(1);
        expect(merged).toHaveLength(3);
        expect(merged[1].keywords).toEqual(["b-prod"]); // prod menang atas repo
        expect(merged[2]).toEqual({ intent: "C", keywords: ["c"] });
    });

    test("field kunci lain bisa dipaksa lewat argumen", () => {
        const prod = [{ id: 1 }];
        const repo = [{ id: 1 }, { id: 2 }];
        const { merged, addedCount } = mergeJsonData(prod, repo, "id");
        expect(addedCount).toBe(1);
        expect(merged).toHaveLength(2);
    });

    test("array tanpa field kunci bersama -> tolak, jangan tebak", () => {
        expect(() => mergeJsonData([{ foo: 1 }], [{ bar: 2 }])).toThrow(/field kunci/);
    });
});

describe("mergeJsonData — regresi b403", () => {
    test("prod object-korup (\"0\",\"1\",...) vs repo array -> THROW, bukan merge diam-diam", () => {
        const korup = { 0: { intent: "A" }, 1: { intent: "B" } }; // signature {...array}
        const repo = [{ intent: "A" }, { intent: "B" }];
        expect(() => mergeJsonData(korup, repo)).toThrow(/Bentuk tidak cocok/);
    });

    test("repo object vs prod array -> THROW juga (arah terbalik)", () => {
        expect(() => mergeJsonData([{ intent: "A" }], { 0: { intent: "A" } })).toThrow(/Bentuk tidak cocok/);
    });

    test("tipe primitif ditolak", () => {
        expect(() => mergeJsonData("teks", "teks")).toThrow(/tidak bisa di-merge/);
    });
});

describe("detectArrayKey", () => {
    test("memilih 'intent' untuk array wifi_templates", () => {
        const a = [{ intent: "X" }];
        const b = [{ intent: "Y", key: "k" }];
        expect(detectArrayKey(a, b)).toBe("intent");
    });
    test("null bila tak ada kandidat", () => {
        expect(detectArrayKey([{ a: 1 }], [{ a: 2 }])).toBeNull();
    });
});

describe("verifyShapes", () => {
    test("menangkap file yang bentuknya berubah di prod", () => {
        const prodDir = fs.mkdtempSync(path.join(os.tmpdir(), "prod-db-"));
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-db-"));
        fs.writeFileSync(path.join(prodDir, "ok.json"), "{}");
        fs.writeFileSync(path.join(repoDir, "ok.json"), "{}");
        fs.writeFileSync(path.join(prodDir, "wifi_templates.json"), '{"0":{"intent":"A"}}'); // korup
        fs.writeFileSync(path.join(repoDir, "wifi_templates.json"), '[{"intent":"A"}]');
        expect(verifyShapes(prodDir, repoDir)).toBe(1);
        fs.rmSync(prodDir, { recursive: true, force: true });
        fs.rmSync(repoDir, { recursive: true, force: true });
    });

    test("semua cocok -> 0", () => {
        const prodDir = fs.mkdtempSync(path.join(os.tmpdir(), "prod-db-"));
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-db-"));
        fs.writeFileSync(path.join(prodDir, "a.json"), "{}");
        fs.writeFileSync(path.join(repoDir, "a.json"), "{}");
        fs.writeFileSync(path.join(prodDir, "b.json"), "[]");
        fs.writeFileSync(path.join(repoDir, "b.json"), "[]");
        expect(verifyShapes(prodDir, repoDir)).toBe(0);
        fs.rmSync(prodDir, { recursive: true, force: true });
        fs.rmSync(repoDir, { recursive: true, force: true });
    });
});
