/**
 * Header Doc
 * Purpose: Uji perintah WA `oper <sasaran> ke <jalur>` — dua mode: SEGMEN (previewSegmentMove +
 *          applySegmentMove) & PELANGGAN (resolve + steerCustomer). Cakup: parse, deteksi
 *          segmen-vs-pelanggan, gate admin (silent non-admin), pratinjau + set state, konfirmasi
 *          affirmatif→eksekusi mode yang benar + state dibersihkan, non-affirmatif→minta ya/batal,
 *          pelanggan tak ditemukan / banyak cocok. Service & users disuntik (tanpa router nyata).
 * Caller: Jest.
 * Deps: -
 * MainFuncs: -
 * SideEffects: -
 */
"use strict";

const { startOperJalur, handleOperJalurConversationState, _internal } = require("../oper-jalur.state");

const USERS = [
    { id: 1, name: "Budi Santoso", pppoe_username: "budi@rafcyber" },
    { id: 2, name: "Ani Wijaya", pppoe_username: "ani@rafcyber" },
    { id: 3, name: "Budi Hartono", pppoe_username: "budihar@rafcyber" },
];

function makeSvc(over = {}) {
    return {
        getSegments: () => [{ id: "reguler" }, { id: "110k" }, { id: "125k" }, { id: "free" }],
        previewSegmentMove: jest.fn(async () => ({ ok: true, segment: "free", label: "FREE", from: "mni", noop: false, ops: [{ desc: "tambah 71 ke lokaldns" }, { desc: "nonaktifkan 71 di freedns" }] })),
        buildSegmentMap: jest.fn(async () => ({ ok: true, segments: [{ id: "free", activeCount: 6 }] })),
        applySegmentMove: jest.fn(async () => ({ ok: true, label: "FREE", from: "mni", to: "gmdp", verified: true })),
        steerCustomer: jest.fn(async () => ({ ok: true, message: "Budi Santoso diarahkan via SF (IP 192.168.61.9).", appliedNow: true })),
        ...over,
    };
}

function ctx(over = {}) {
    return {
        reply: jest.fn(async () => {}),
        setUserState: jest.fn(),
        deleteUserState: jest.fn(),
        getUserState: jest.fn(),
        stateSender: "628111@s.whatsapp.net",
        sender: "628111@s.whatsapp.net",
        plainSenderNumber: "628111",
        pushname: "Aldi",
        qAfterKeyword: "",
        global: { accounts: [{ phone_number: "628111", role: "owner" }], users: USERS },
        customerSteeringService: makeSvc(),
        ...over,
    };
}

describe("parse & resolve helpers", () => {
    test("parseOperTarget: jalur terakhir, sisanya target", () => {
        expect(_internal.parseOperTarget("free ke gmdp")).toEqual({ target: "free", jalur: "gmdp" });
        expect(_internal.parseOperTarget("budi santoso ke sf")).toEqual({ target: "budi santoso", jalur: "sf" });
        expect(_internal.parseOperTarget("110 mni")).toEqual({ target: "110", jalur: "mni" });
        expect(_internal.parseOperTarget("ngawur")).toEqual({ target: "ngawur", jalur: null });
    });
    test("matchSegment: id/alias segmen, else null", () => {
        const ids = ["reguler", "110k", "125k", "free"];
        expect(_internal.matchSegment("free", ids)).toBe("free");
        expect(_internal.matchSegment("110", ids)).toBe("110k");
        expect(_internal.matchSegment("budi", ids)).toBeNull();
    });
    test("resolveCustomers: id/pppoe eksak dulu, lalu contains", () => {
        expect(_internal.resolveCustomers("2", USERS).map((u) => u.id)).toEqual([2]);
        expect(_internal.resolveCustomers("budi@rafcyber", USERS).map((u) => u.id)).toEqual([1]);
        expect(_internal.resolveCustomers("budi", USERS).map((u) => u.id)).toEqual([1, 3]); // dua "Budi"
    });
});

describe("startOperJalur — mode SEGMEN", () => {
    test("non-admin → handled:false, tak balas", async () => {
        const c = ctx({ global: { accounts: [], users: USERS }, qAfterKeyword: "free ke gmdp" });
        const r = await startOperJalur(c);
        expect(r).toEqual({ handled: false });
        expect(c.reply).not.toHaveBeenCalled();
    });
    test("segmen valid → pratinjau + state mode:segment", async () => {
        const c = ctx({ qAfterKeyword: "free ke gmdp" });
        await startOperJalur(c);
        expect(c.setUserState).toHaveBeenCalledWith("628111@s.whatsapp.net", expect.objectContaining({ step: "OPERJALUR_CONFIRM", mode: "segment", segmen: "free", jalur: "gmdp" }));
    });
    test("format salah (tanpa jalur) → invalid, tak set state", async () => {
        const svc = makeSvc();
        const c = ctx({ qAfterKeyword: "free", customerSteeringService: svc });
        await startOperJalur(c);
        expect(svc.previewSegmentMove).not.toHaveBeenCalled();
        expect(c.setUserState).not.toHaveBeenCalled();
    });
});

describe("startOperJalur — mode PELANGGAN", () => {
    test("nama unik → pratinjau pelanggan + state mode:customer", async () => {
        const svc = makeSvc();
        const c = ctx({ qAfterKeyword: "ani ke sf", customerSteeringService: svc });
        await startOperJalur(c);
        expect(svc.previewSegmentMove).not.toHaveBeenCalled(); // bukan segmen
        expect(c.setUserState).toHaveBeenCalledWith("628111@s.whatsapp.net", expect.objectContaining({ step: "OPERJALUR_CONFIRM", mode: "customer", userId: 2, jalur: "sf" }));
    });
    test("tak ditemukan → balas notfound, tak set state", async () => {
        const c = ctx({ qAfterKeyword: "zzz ke sf" });
        await startOperJalur(c);
        expect(c.setUserState).not.toHaveBeenCalled();
        expect(c.reply).toHaveBeenCalled();
    });
    test("banyak cocok (dua Budi) → minta spesifik, tak set state", async () => {
        const c = ctx({ qAfterKeyword: "budi ke sf" });
        await startOperJalur(c);
        expect(c.setUserState).not.toHaveBeenCalled();
        expect(c.reply).toHaveBeenCalled();
    });
});

describe("handleConfirm", () => {
    test("mode segmen + 'ya' → applySegmentMove", async () => {
        const svc = makeSvc();
        const c = ctx({ chats: "ya", customerSteeringService: svc, userState: { step: "OPERJALUR_CONFIRM", mode: "segment", segmen: "free", jalur: "gmdp", from: "mni", label: "FREE" } });
        await handleOperJalurConversationState(c);
        expect(svc.applySegmentMove).toHaveBeenCalledWith(expect.objectContaining({ segment: "free", path: "gmdp", confirm: true }));
        expect(svc.steerCustomer).not.toHaveBeenCalled();
        expect(c.deleteUserState).toHaveBeenCalled();
    });
    test("mode pelanggan + 'ya' → steerCustomer", async () => {
        const svc = makeSvc();
        const c = ctx({ chats: "ya", customerSteeringService: svc, userState: { step: "OPERJALUR_CONFIRM", mode: "customer", userId: 1, nama: "Budi Santoso", jalur: "sf" } });
        await handleOperJalurConversationState(c);
        expect(svc.steerCustomer).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, path: "sf" }));
        expect(svc.applySegmentMove).not.toHaveBeenCalled();
    });
    test("non-affirmatif → tak eksekusi, tak clear state", async () => {
        const svc = makeSvc();
        const c = ctx({ chats: "hmm", customerSteeringService: svc, userState: { step: "OPERJALUR_CONFIRM", mode: "segment", segmen: "free", jalur: "gmdp" } });
        await handleOperJalurConversationState(c);
        expect(svc.applySegmentMove).not.toHaveBeenCalled();
        expect(c.deleteUserState).not.toHaveBeenCalled();
    });
    test("pelanggan gagal (mis. reconciler nonaktif) → balas gagal, tak lempar", async () => {
        const svc = makeSvc({ steerCustomer: jest.fn(async () => ({ ok: false, error: "Steering nonaktif (config.customerSteering.enabled=false)." })) });
        const c = ctx({ chats: "ya", customerSteeringService: svc, userState: { step: "OPERJALUR_CONFIRM", mode: "customer", userId: 1, jalur: "sf" } });
        const r = await handleOperJalurConversationState(c);
        expect(r.handled).toBe(true);
        expect(c.reply).toHaveBeenCalled();
    });
});
