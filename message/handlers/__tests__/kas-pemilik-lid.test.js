"use strict";

/**
 * Header Doc
 * Purpose: Mengunci JEMBATAN @lid <-> nomor pada gerbang pemilik kas usaha.
 *   Kejadian nyata 2026-08-10: pemilik memilih dirinya dari daftar peserta grup, tersimpan
 *   sebagai `111222333444555@lid`. Saat mengetik "kas bantuan", Baileys menyerahkan
 *   JID nomor kanonik, sehingga resolver mencari di `ownerJids` yang KOSONG,
 *   menolaknya, dan bot DIAM TOTAL — terbukti di log produksi:
 *     [KAS_GRUP_MASUK] participant= <lid>@lid teks= "Kas bantuan"
 *     [KAS_GRUP_BUKAN_PEMILIK] participant= 62xxx@s.whatsapp.net
 *   Gerbangnya gagal-tertutup, jadi kegagalan seperti ini TIDAK pernah bersuara — itulah
 *   yang membuatnya mahal: pemiliknya menyangka fiturnya rusak, bukan setelannya separuh.
 * Caller: Jest.
 * Deps: `message/handlers/business-expense-wa` + mock `lib/jid-utils`.
 * SideEffects: Tidak ada.
 */

const path = require("path");

describe("gerbang pemilik kas: @lid dan nomor adalah orang yang sama", () => {
    const LID = "111222333444555@lid";
    const NOMOR = "628111222333";
    const JID = NOMOR + "@s.whatsapp.net";

    beforeEach(() => {
        jest.resetModules();
        jest.doMock(path.join(__dirname, "..", "..", "..", "lib", "jid-utils"), () => ({
            getStoredMappingByLid: (lid) => (lid === LID ? { phoneNumber: NOMOR, pnJid: JID } : null)
        }), { virtual: false });
    });

    afterEach(() => jest.dontMock(path.join(__dirname, "..", "..", "..", "lib", "jid-utils")));

    function resolver() {
        return require("../business-expense-wa").resolveBusinessExpenseOwner;
    }

    test("tersimpan sebagai @lid, pesan tiba sebagai NOMOR -> tetap dikenali", () => {
        const r = resolver()({
            participant: JID,
            plainPhone: NOMOR,
            config: { businessExpense: { ownerJids: [], ownerLids: [LID] } }
        });
        expect(r).not.toBeNull();
        expect(r.via).toBe("lid-nomor");
    });

    test("tersimpan sebagai @lid, pesan tiba sebagai @lid -> tetap dikenali", () => {
        const r = resolver()({
            participant: LID,
            plainPhone: "",
            config: { businessExpense: { ownerJids: [], ownerLids: [LID] } }
        });
        expect(r).not.toBeNull();
        expect(r.via).toBe("lid");
    });

    test("tersimpan sebagai NOMOR, pesan tiba sebagai NOMOR -> tetap dikenali", () => {
        const r = resolver()({
            participant: JID,
            plainPhone: NOMOR,
            config: { businessExpense: { ownerJids: [JID], ownerLids: [] } }
        });
        expect(r).not.toBeNull();
    });

    test("ORANG LAIN tetap DITOLAK — jembatan ini tak boleh melonggarkan gerbang", () => {
        const r = resolver()({
            participant: "628999999999@s.whatsapp.net",
            plainPhone: "628999999999",
            config: { businessExpense: { ownerJids: [], ownerLids: [LID] } }
        });
        expect(r).toBeNull();
    });

    test("pemetaan @lid tak terbaca -> DITOLAK, bukan diloloskan", () => {
        jest.resetModules();
        jest.doMock(path.join(__dirname, "..", "..", "..", "lib", "jid-utils"), () => ({
            getStoredMappingByLid: () => { throw new Error("mapping rusak"); }
        }));
        const r = require("../business-expense-wa").resolveBusinessExpenseOwner({
            participant: JID,
            plainPhone: NOMOR,
            config: { businessExpense: { ownerJids: [], ownerLids: [LID] } }
        });
        expect(r).toBeNull();
    });

    test("daftar pemilik kosong -> selalu DITOLAK", () => {
        const r = resolver()({
            participant: JID,
            plainPhone: NOMOR,
            config: { businessExpense: { ownerJids: [], ownerLids: [] } }
        });
        expect(r).toBeNull();
    });
});
