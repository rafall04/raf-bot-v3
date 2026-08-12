/**
 * Header Doc
 * Purpose: Test store draft PSB durabel — simpan/baca/hapus per teknisi, TTL, dan pemilihan path
 *          file test. Ini pengaman kerja teknisi: draft yang hilang = foto KTP/rumah + 7 kolom data
 *          harus diulang dari nol (insiden Tanjungharjo 2026-08-12).
 * Caller: Jest.
 * Deps: `../psb-draft-store`, `fs`, `os`, `path`.
 * SideEffects: Menulis file JSON ke folder tmp (dibersihkan afterEach).
 */
"use strict";

const os = require("os");
const fs = require("fs");
const path = require("path");
const store = require("../psb-draft-store");

const OWNER = "628999@s.whatsapp.net";
const LAIN = "628111@s.whatsapp.net";
const T0 = Date.parse("2026-08-12T07:00:00.000Z");

let FILE;
beforeEach(() => {
    FILE = path.join(os.tmpdir(), `psb-drafts-test-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
});
afterEach(() => {
    try { fs.rmSync(FILE, { force: true }); } catch (_e) { /* noop */ }
});

const draft = (over = {}) => ({
    step: "PSB_CONFIRM_MODEM",
    tempId: "PSBDM_1",
    dir: "/uploads/psb/2026/08/PSBDM_1",
    data: { nama: "Sinta Lestari", dusun: "karang", paket: "PAKET-125K", hp: "08123456789" },
    ktpSaved: true,
    rumahSaved: true,
    lokasi: { lat: -7.1, lng: 111.9 },
    staff: { id: 3, username: "davin", role: "teknisi" },
    ...over
});

describe("psb-draft-store", () => {
    test("simpan → baca kembali utuh (data + jejak bukti + lokasi)", () => {
        store.putDraft(OWNER, draft(), FILE, T0);
        const hasil = store.getDraft(OWNER, FILE, T0);
        expect(hasil.data.nama).toBe("Sinta Lestari");
        expect(hasil.ktpSaved).toBe(true);
        expect(hasil.rumahSaved).toBe(true);
        expect(hasil.lokasi).toEqual({ lat: -7.1, lng: 111.9 });
        expect(hasil.step).toBe("PSB_CONFIRM_MODEM");
    });

    test("satu draft per teknisi — simpan ulang MENIMPA, tidak menumpuk", () => {
        store.putDraft(OWNER, draft(), FILE, T0);
        store.putDraft(OWNER, draft({ data: { nama: "Budi" } }), FILE, T0 + 1000);
        const semua = store.loadDrafts(FILE).filter((d) => d.ownerKey === OWNER);
        expect(semua).toHaveLength(1);
        expect(semua[0].data.nama).toBe("Budi");
    });

    test("createdAt dipertahankan saat ditimpa, updatedAt maju (umur asli sesi tetap terbaca)", () => {
        store.putDraft(OWNER, draft(), FILE, T0);
        const kedua = store.putDraft(OWNER, draft(), FILE, T0 + 60000);
        expect(kedua.createdAt).toBe(new Date(T0).toISOString());
        expect(kedua.updatedAt).toBe(new Date(T0 + 60000).toISOString());
    });

    test("draft teknisi lain TIDAK ikut terhapus/terbaca", () => {
        store.putDraft(OWNER, draft(), FILE, T0);
        store.putDraft(LAIN, draft({ data: { nama: "Orang Lain" } }), FILE, T0);
        expect(store.getDraft(LAIN, FILE, T0).data.nama).toBe("Orang Lain");
        store.removeDraft(OWNER, FILE, T0);
        expect(store.getDraft(OWNER, FILE, T0)).toBeNull();
        expect(store.getDraft(LAIN, FILE, T0)).not.toBeNull();
    });

    test("TTL 48 jam: draft yang lewat umur tak lagi ditawarkan", () => {
        store.putDraft(OWNER, draft(), FILE, T0);
        // Masih di dalam TTL (PSB dilaporkan sore, dibereskan admin besok pagi).
        expect(store.getDraft(OWNER, FILE, T0 + 20 * 60 * 60 * 1000)).not.toBeNull();
        expect(store.getDraft(OWNER, FILE, T0 + store.DRAFT_TTL_MS + 1000)).toBeNull();
    });

    test("putDraft menolak tanpa ownerKey / tanpa data (jangan simpan sampah)", () => {
        expect(store.putDraft("", draft(), FILE, T0)).toBeNull();
        expect(store.putDraft(OWNER, { step: "X" }, FILE, T0)).toBeNull();
        expect(store.loadDrafts(FILE)).toEqual([]);
    });

    test("file belum ada / rusak → [] , bukan throw (never-throw)", () => {
        expect(store.loadDrafts(FILE)).toEqual([]);
        fs.writeFileSync(FILE, "{bukan json");
        expect(store.loadDrafts(FILE)).toEqual([]);
        expect(store.getDraft(OWNER, FILE, T0)).toBeNull();
    });

    test("removeDraft pada owner tanpa draft → false, file tak berubah", () => {
        expect(store.removeDraft(OWNER, FILE, T0)).toBe(false);
    });

    test("path file terpisah saat NODE_ENV=test (jangan sentuh data prod)", () => {
        expect(store.resolveFilePath()).toMatch(/psb-drafts_test\.json$/);
    });
});
