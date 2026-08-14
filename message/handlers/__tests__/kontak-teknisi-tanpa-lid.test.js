/**
 * Header Doc
 * Purpose: Menjamin nomor kontak teknisi yang dikirim KE PELANGGAN tak pernah memuat `@lid`
 *          maupun identifier internal lain, dan bahwa peran `agen` tak diperlakukan sebagai
 *          teknisi oleh bot.
 * Caller: Jest test runner.
 * Deps: `../teknisi-workflow-handler`, `../raf-context`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA:
 *  1. `sender.replace('@s.whatsapp.net','')` tidak menyentuh akhiran `@lid`, lalu cabang else
 *     menempelkan `62` di depannya → pelanggan menerima `wa.me/62<lid>@lid`: tautan mati
 *     sekaligus pembocoran identifier internal.
 *  2. `resolveActorCapabilities` sama sekali tak melihat `account.role`, sehingga akun ber-peran
 *     `agen` dianggap teknisi dan bisa mengunci tiket gangguan atas namanya.
 */
"use strict";

const handler = require("../teknisi-workflow-handler");
const { resolveActorCapabilities } = require("../raf-context");

const resolve = handler.resolveNomorKontakTeknisi;

describe("nomor kontak teknisi untuk pelanggan", () => {
    const LID = "123456789012345@lid";

    test("diambil dari phone_number akun, bukan dari JID pengirim", () => {
        expect(resolve({ phone_number: "6281234567890" }, LID)).toBe("6281234567890");
    });

    test("nomor berawalan 0 dinormalkan ke 62", () => {
        expect(resolve({ phone_number: "081234567890" }, LID)).toBe("6281234567890");
    });

    test("format berhias (spasi/strip/plus) tetap terbaca", () => {
        expect(resolve({ phone_number: "+62 812-3456-7890" }, LID)).toBe("6281234567890");
    });

    test.each([
        ["akun tanpa phone_number", { phone_number: "" }],
        ["akun null", null],
        ["akun undefined", undefined],
    ])("%s + pengirim @lid → string kosong, BUKAN @lid", (_nama, akun) => {
        const hasil = resolve(akun, LID);

        expect(hasil).toBe("");
        expect(hasil).not.toContain("@lid");
        expect(hasil).not.toContain("123456789012345");
    });

    test("JID telepon sungguhan boleh dipakai sebagai cadangan", () => {
        expect(resolve(null, "6281234567890@s.whatsapp.net")).toBe("6281234567890");
    });

    test("tidak ada masukan apa pun yang bisa menghasilkan @lid di keluaran", () => {
        const masukan = [
            LID,
            "62999@lid",
            "abc@lid",
            "@lid",
            "6281234567890@s.whatsapp.net",
            "",
            null,
            undefined,
        ];

        for (const sender of masukan) {
            for (const akun of [null, { phone_number: "" }, { phone_number: "628111" }]) {
                const hasil = resolve(akun, sender);
                expect(String(hasil)).not.toMatch(/@|lid/i);
            }
        }
    });
});

describe("peran agen bukan teknisi di mata bot", () => {
    const dasar = {
        ownerNumber: ["628000@s.whatsapp.net"],
        primarySenderId: "628999@s.whatsapp.net",
        optionalJid: null,
        plainSenderNumber: "628999",
    };

    test("akun ber-peran agen TIDAK dianggap teknisi", () => {
        const hasil = resolveActorCapabilities({
            ...dasar,
            accounts: [{ id: 8, role: "agen", phone_number: "628999@s.whatsapp.net" }],
        });

        expect(hasil.isTeknisi).toBeFalsy();
    });

    test.each(["teknisi", "admin", "owner", "superadmin"])(
        "peran %s TETAP punya kapabilitas teknisi",
        (role) => {
            const hasil = resolveActorCapabilities({
                ...dasar,
                accounts: [{ id: 3, role, phone_number: "628999@s.whatsapp.net" }],
            });

            expect(hasil.isTeknisi).toBeTruthy();
        }
    );

    test("akun tanpa peran tidak diam-diam lolos", () => {
        const hasil = resolveActorCapabilities({
            ...dasar,
            accounts: [{ id: 9, phone_number: "628999@s.whatsapp.net" }],
        });

        expect(hasil.isTeknisi).toBeFalsy();
    });

    test("pencocokan lewat lid juga tunduk pada filter peran", () => {
        const hasil = resolveActorCapabilities({
            ownerNumber: [],
            primarySenderId: "123456789012345@lid",
            optionalJid: null,
            plainSenderNumber: "123456789012345",
            accounts: [{ id: 8, role: "agen", lid: "123456789012345@lid" }],
        });

        expect(hasil.isTeknisi).toBeFalsy();
    });
});
