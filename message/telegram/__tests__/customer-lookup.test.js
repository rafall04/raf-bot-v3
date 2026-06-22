/**
 * Test customer-lookup — pencarian pelanggan generik untuk bot Telegram teknisi:
 * tier pppoe→serial→phone→nama, normalisasi nomor HP (0/62/8), field |-joined,
 * serta perilaku 0/1/banyak hasil pada findOneCustomer.
 */
"use strict";

const { findCustomers, findOneCustomer, findById, normalizePhone } = require("../customer-lookup");

const users = [
    { id: 1, name: "Budi Santoso", pppoe_username: "budi@isp", phone_number: "081234567890", olt_serial: "ZTEGC0000001" },
    { id: 2, name: "Budiman", pppoe_username: "budiman@isp", phone_number: "6285700000002" },
    { id: 3, name: "Siti Aminah", pppoe_username: "siti@isp", phone_number: "081333000003", olt_serial: "HWTC12345678" },
    { id: 4, name: "Eko | Eko Cabang 2", pppoe_username: "eko@isp|eko2@isp", phone_number: "0899-000-0004" },
    { id: 5, name: "Tanpa PPPoE", pppoe_username: "" }, // diabaikan (tak ada pppoe)
];

describe("normalizePhone", () => {
    test("0xxxx, 62xxxx, dan 8xxxx dari nomor sama → bentuk 62 yang sama", () => {
        expect(normalizePhone("081234567890")).toBe("6281234567890");
        expect(normalizePhone("6281234567890")).toBe("6281234567890");
        expect(normalizePhone("81234567890")).toBe("6281234567890");
        expect(normalizePhone("0812-3456-7890")).toBe("6281234567890");
    });
    test("kosong → string kosong", () => {
        expect(normalizePhone("")).toBe("");
        expect(normalizePhone(null)).toBe("");
    });
});

describe("findCustomers — tier", () => {
    test("tier pppoe persis", () => {
        const r = findCustomers("budi@isp", users);
        expect(r.tier).toBe("pppoe");
        expect(r.matches.map((u) => u.id)).toEqual([1]);
    });

    test("tier serial persis (case-insensitive)", () => {
        const r = findCustomers("hwtc12345678", users);
        expect(r.tier).toBe("serial");
        expect(r.matches.map((u) => u.id)).toEqual([3]);
    });

    test("tier phone — query 0xxxx cocok dgn 62xxxx tersimpan", () => {
        const r = findCustomers("085700000002", users);
        expect(r.tier).toBe("phone");
        expect(r.matches.map((u) => u.id)).toEqual([2]);
    });

    test("tier phone — nomor |-joined / berformat tanda hubung", () => {
        const r = findCustomers("08990000004", users);
        expect(r.tier).toBe("phone");
        expect(r.matches.map((u) => u.id)).toEqual([4]);
    });

    test("tier nama (substring) — 'santoso' cocok ke nama", () => {
        const r = findCustomers("santoso", users);
        expect(r.tier).toBe("name");
        expect(r.matches.map((u) => u.id)).toEqual([1]);
    });

    test("substring 'budi' cocok ke beberapa (nama+pppoe) → tier name banyak hasil", () => {
        const r = findCustomers("budi", users);
        expect(r.tier).toBe("name");
        expect(r.matches.map((u) => u.id).sort()).toEqual([1, 2]);
    });

    test("pppoe |-joined: 'eko2@isp' tetap cocok persis", () => {
        const r = findCustomers("eko2@isp", users);
        expect(r.tier).toBe("pppoe");
        expect(r.matches.map((u) => u.id)).toEqual([4]);
    });

    test("user tanpa pppoe_username diabaikan", () => {
        const r = findCustomers("Tanpa PPPoE", users);
        expect(r.matches).toHaveLength(0);
    });

    test("query kosong → tak ada hasil", () => {
        expect(findCustomers("", users).matches).toHaveLength(0);
        expect(findCustomers("   ", users).matches).toHaveLength(0);
    });
});

describe("findOneCustomer", () => {
    test("tepat satu → user terisi, candidates kosong", () => {
        const r = findOneCustomer("siti@isp", users);
        expect(r.user.id).toBe(3);
        expect(r.candidates).toHaveLength(0);
    });

    test("ambigu → user null, candidates terisi", () => {
        const r = findOneCustomer("budi", users);
        expect(r.user).toBeNull();
        expect(r.candidates.map((u) => u.id).sort()).toEqual([1, 2]);
    });

    test("tak ada → user null, candidates kosong", () => {
        const r = findOneCustomer("xyz-tidak-ada", users);
        expect(r.user).toBeNull();
        expect(r.candidates).toHaveLength(0);
        expect(r.tier).toBeNull();
    });

    test("kandidat dipotong di MAX_CANDIDATES + flag truncated", () => {
        const many = [];
        for (let i = 0; i < 12; i++) {
            many.push({ id: 100 + i, name: `Agus ${i}`, pppoe_username: `agus${i}@isp` });
        }
        const r = findOneCustomer("agus", many);
        expect(r.user).toBeNull();
        expect(r.candidates).toHaveLength(8);
        expect(r.truncated).toBe(true);
    });
});

describe("findById", () => {
    test("cocok by id (number maupun string)", () => {
        expect(findById(1, users).name).toBe("Budi Santoso");
        expect(findById("1", users).name).toBe("Budi Santoso");
    });
    test("tak ada / id kosong → null", () => {
        expect(findById(999, users)).toBeNull();
        expect(findById(null, users)).toBeNull();
        expect(findById("", users)).toBeNull();
    });
});
