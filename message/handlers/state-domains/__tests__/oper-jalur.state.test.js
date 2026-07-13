/**
 * Header Doc
 * Purpose: Uji perintah WA `oper <segmen> ke <jalur>`: parse, gate admin (silent non-admin),
 *          pratinjau + set state konfirmasi, noop, format salah, dan langkah konfirmasi (affirmatif
 *          → applySegmentMove confirm:true + state dibersihkan; non-affirmatif → minta ya/batal,
 *          tak eksekusi). Service disuntik (tanpa router nyata).
 * Caller: Jest.
 * Deps: -
 * MainFuncs: -
 * SideEffects: -
 */
"use strict";

const { startOperJalur, handleOperJalurConversationState, _internal } = require("../oper-jalur.state");

function makeSvc(over = {}) {
    return {
        getSegments: () => [{ id: "reguler" }, { id: "110k" }, { id: "125k" }, { id: "free" }],
        previewSegmentMove: jest.fn(async () => ({ ok: true, segment: "free", label: "FREE", from: "mni", noop: false, ops: [{ desc: "tambah 192.168.71.0/24 ke lokaldns" }, { desc: "nonaktifkan di freedns" }] })),
        buildSegmentMap: jest.fn(async () => ({ ok: true, segments: [{ id: "free", activeCount: 6 }] })),
        applySegmentMove: jest.fn(async () => ({ ok: true, label: "FREE", from: "mni", to: "gmdp", verified: true })),
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
        global: { accounts: [{ phone_number: "628111", role: "owner" }] }, // admin
        customerSteeringService: makeSvc(),
        ...over,
    };
}

describe("parseOper", () => {
    const ids = ["reguler", "110k", "125k", "free"];
    test("berbagai bentuk", () => {
        expect(_internal.parseOper("free ke gmdp", ids)).toEqual({ segmen: "free", jalur: "gmdp" });
        expect(_internal.parseOper("110 ke mni", ids)).toEqual({ segmen: "110k", jalur: "mni" });
        expect(_internal.parseOper("free gmdp", ids)).toEqual({ segmen: "free", jalur: "gmdp" });
        expect(_internal.parseOper("ngawur", ids)).toEqual({ segmen: null, jalur: null });
    });
});

describe("startOperJalur", () => {
    test("non-admin → handled:false, tak balas (jangan bocorkan)", async () => {
        const c = ctx({ global: { accounts: [] }, qAfterKeyword: "free ke gmdp" });
        const r = await startOperJalur(c);
        expect(r).toEqual({ handled: false });
        expect(c.reply).not.toHaveBeenCalled();
    });

    test("admin + valid → pratinjau + set state OPERJALUR_CONFIRM", async () => {
        const c = ctx({ qAfterKeyword: "free ke gmdp" });
        const r = await startOperJalur(c);
        expect(r.handled).toBe(true);
        expect(c.setUserState).toHaveBeenCalledWith("628111@s.whatsapp.net", expect.objectContaining({ step: "OPERJALUR_CONFIRM", segmen: "free", jalur: "gmdp", from: "mni" }));
        expect(c.reply).toHaveBeenCalled();
    });

    test("noop (sudah di jalur) → balas noop TANPA set state", async () => {
        const svc = makeSvc({ previewSegmentMove: jest.fn(async () => ({ ok: true, noop: true, label: "FREE" })) });
        const c = ctx({ qAfterKeyword: "free ke mni", customerSteeringService: svc });
        await startOperJalur(c);
        expect(c.setUserState).not.toHaveBeenCalled();
        expect(c.reply).toHaveBeenCalled();
    });

    test("format salah → balas invalid, previewSegmentMove tak dipanggil", async () => {
        const svc = makeSvc();
        const c = ctx({ qAfterKeyword: "ngawur", customerSteeringService: svc });
        await startOperJalur(c);
        expect(svc.previewSegmentMove).not.toHaveBeenCalled();
        expect(c.setUserState).not.toHaveBeenCalled();
    });

    test("jalur ih (ditolak service) → balas invalid tanpa set state", async () => {
        const svc = makeSvc({ previewSegmentMove: jest.fn(async () => ({ ok: false, error: "Jalur segmen v1 hanya mni/gmdp." })) });
        const c = ctx({ qAfterKeyword: "free ke ih", customerSteeringService: svc });
        await startOperJalur(c);
        expect(svc.previewSegmentMove).toHaveBeenCalledWith({ segment: "free", path: "ih" });
        expect(c.setUserState).not.toHaveBeenCalled();
    });
});

describe("handleOperJalurConversationState (konfirmasi)", () => {
    const pending = { step: "OPERJALUR_CONFIRM", segmen: "free", jalur: "gmdp", from: "mni", label: "FREE" };

    test("balas 'ya' → applySegmentMove confirm:true + state dibersihkan", async () => {
        const svc = makeSvc();
        const c = ctx({ chats: "ya", userState: pending, customerSteeringService: svc });
        const r = await handleOperJalurConversationState(c);
        expect(r.handled).toBe(true);
        expect(c.deleteUserState).toHaveBeenCalledWith("628111@s.whatsapp.net");
        expect(svc.applySegmentMove).toHaveBeenCalledWith(expect.objectContaining({ segment: "free", path: "gmdp", confirm: true }));
        expect(c.reply).toHaveBeenCalled();
    });

    test("balas non-affirmatif → minta ya/batal, TAK eksekusi", async () => {
        const svc = makeSvc();
        const c = ctx({ chats: "hmm apa", userState: pending, customerSteeringService: svc });
        await handleOperJalurConversationState(c);
        expect(svc.applySegmentMove).not.toHaveBeenCalled();
        expect(c.deleteUserState).not.toHaveBeenCalled();
        expect(c.reply).toHaveBeenCalled();
    });

    test("apply gagal → balas gagal (tak lempar)", async () => {
        const svc = makeSvc({ applySegmentMove: jest.fn(async () => ({ ok: false, error: "verify gagal" })) });
        const c = ctx({ chats: "ya", userState: pending, customerSteeringService: svc });
        const r = await handleOperJalurConversationState(c);
        expect(r.handled).toBe(true);
        expect(c.reply).toHaveBeenCalled();
    });

    test("non-admin di langkah state → handled:false (re-gate)", async () => {
        const c = ctx({ chats: "ya", userState: pending, global: { accounts: [] } });
        const r = await handleOperJalurConversationState(c);
        expect(r.handled).toBe(false);
    });
});
