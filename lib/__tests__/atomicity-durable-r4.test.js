/**
 * Header Doc
 * Purpose: Mengunci sisi-LOAD durabilitas #b345 yang tak tercakup pemindai-tulis: (a)
 *   agent-transaction-manager memuat via loadJSON per-file (karantina), bukan JSON.parse telanjang
 *   dalam satu try/catch yang cuma log lalu save berikut menimpa dengan []; (b) reboot-followup-store
 *   loadJobs MENGKARANTINA berkas rusak (.rusak-<ts>) alih-alih memulangkan [] lalu ditimpa senyap,
 *   dan saveJobs menulis ATOMIK (JSON valid utuh setelah torn-write terdahulu).
 * Caller: Jest.
 * Deps: fs, os, path, lib/reboot-followup-store (fungsional), baca sumber lib/agent-transaction-manager.
 * SideEffects: Menulis berkas sementara di os.tmpdir().
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

describe("agent-transaction-manager: load ATOMIK + karantina (#b345)", () => {
    const src = read("agent-transaction-manager.js");
    test("memuat via loadJSON per-file (agent_transactions.json & agent_credentials.json)", () => {
        expect(src).toMatch(/loadJSON\(\s*['"]agent_transactions\.json['"]\s*\)/);
        expect(src).toMatch(/loadJSON\(\s*['"]agent_credentials\.json['"]\s*\)/);
    });
    test("menyimpan via saveJSON atomik (bukan fs.writeFileSync)", () => {
        expect(src).toMatch(/saveJSON\(\s*['"]agent_transactions\.json['"]/);
        expect(src).toMatch(/saveJSON\(\s*['"]agent_credentials\.json['"]/);
        expect(src).not.toMatch(/fs\.writeFileSync/);
    });
    test("TIDAK ada JSON.parse(fs.readFileSync(...)) telanjang di init (rantai kehilangan lama)", () => {
        expect(src).not.toMatch(/JSON\.parse\(\s*fs\.readFileSync/);
    });
});

describe("reboot-followup-store: karantina + tulis atomik (#b345)", () => {
    let store;
    let tmpFile;
    beforeEach(() => {
        jest.resetModules();
        store = require("../reboot-followup-store");
        tmpFile = path.join(os.tmpdir(), `rfu-test-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    });
    afterEach(() => {
        try {
            for (const f of fs.readdirSync(os.tmpdir())) {
                if (f.startsWith(path.basename(tmpFile))) fs.unlinkSync(path.join(os.tmpdir(), f));
            }
        } catch (_e) { /* abaikan */ }
    });

    test("berkas rusak → loadJobs kembalikan [] DAN mengkarantina ke .rusak-*", () => {
        fs.writeFileSync(tmpFile, "{ ini json terpotong tidak valid", "utf8");
        const jobs = store.loadJobs(tmpFile);
        expect(jobs).toEqual([]);
        // berkas asli sudah dipindah (dikarantina), sisakan sibling .rusak-*
        expect(fs.existsSync(tmpFile)).toBe(false);
        const dir = path.dirname(tmpFile);
        const karantina = fs.readdirSync(dir).filter((f) => f.startsWith(`${path.basename(tmpFile)}.rusak-`));
        expect(karantina.length).toBe(1);
    });

    test("saveJobs menulis JSON valid utuh (atomik) yang bisa dibaca kembali", () => {
        const jobs = [{ id: "RFU-1", jid: "628@s.whatsapp.net", deviceId: "d1", status: "scheduled", dueAt: new Date().toISOString() }];
        expect(store.saveJobs(jobs, tmpFile)).toBe(true);
        // tak ada berkas .tmp-* tersisa (rename atomik sudah selesai)
        const dir = path.dirname(tmpFile);
        const sisaTmp = fs.readdirSync(dir).filter((f) => f.startsWith(`${path.basename(tmpFile)}.tmp-`));
        expect(sisaTmp.length).toBe(0);
        expect(store.loadJobs(tmpFile)).toEqual(jobs);
    });
});
