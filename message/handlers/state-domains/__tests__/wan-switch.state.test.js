/**
 * Header Doc
 * Purpose: Uji state domain switch koneksi WA — gate peran presisi (admin/owner via accounts.json),
 *          trigger daftar, pilih nomor → konfirmasi, dan eksekusi HANYA setelah *ya*.
 * Caller: jest.
 * Deps: `../wan-switch.state`.
 * MainFuncs: —
 * SideEffects: global.accounts di-set per test.
 */
"use strict";

const state = require("../wan-switch.state");

const ADMIN = "6285233047094@s.whatsapp.net";
const CUSTOMER = "628999999999@s.whatsapp.net";

function fakeService(over = {}) {
    return {
        getStatus: async () => ({
            enabled: true,
            switches: [
                { id: "mni-to-sf", label: "MNI → SF", affects: "110k/125k", applied: false },
                { id: "main-to-ih", label: "GMDP → IH", affects: "reguler", applied: true }
            ]
        }),
        applySwitch: async (id, dir) => ({ ok: true, message: `switch ${id} ${dir}`, summary: "MNI → SF" }),
        ...over
    };
}

function makeCtx(over = {}) {
    const stateStore = {};
    return {
        sender: ADMIN,
        stateSender: ADMIN,
        plainSenderNumber: "6285233047094",
        pushname: "Raf",
        chats: "",
        reply: jest.fn(async () => {}),
        setUserState: jest.fn((k, v) => { stateStore[k] = v; }),
        deleteUserState: jest.fn((k) => { delete stateStore[k]; }),
        getUserState: jest.fn((k) => stateStore[k]),
        wanSwitchService: fakeService(),
        global: { accounts: [{ id: 2, username: "raf", role: "admin", phone_number: "6285233047094" }] },
        _stateStore: stateStore,
        ...over
    };
}

beforeEach(() => {
    global.accounts = [{ id: 2, username: "raf", role: "admin", phone_number: "6285233047094" }];
});

describe("gate peran", () => {
    test("admin account → boleh", () => {
        expect(state._internal.isAdminOwner(makeCtx())).toBe(true);
    });
    test("pelanggan (bukan akun staf) → tidak", () => {
        const ctx = makeCtx({ sender: CUSTOMER, plainSenderNumber: "628999999999" });
        expect(state._internal.isAdminOwner(ctx)).toBe(false);
    });
    test("teknisi role → tidak (switch khusus admin/owner)", () => {
        global.accounts = [{ id: 3, username: "davin", role: "teknisi", phone_number: "628777" }];
        const ctx = makeCtx({ sender: "628777@s.whatsapp.net", plainSenderNumber: "628777", global: { accounts: global.accounts } });
        expect(state._internal.isAdminOwner(ctx)).toBe(false);
    });
});

describe("startWanSwitch", () => {
    test("non-admin → handled:false (tidak membocorkan fitur, tidak set state)", async () => {
        const ctx = makeCtx({ sender: CUSTOMER, plainSenderNumber: "628999999999", global: { accounts: global.accounts } });
        const r = await state.startWanSwitch(ctx);
        expect(r.handled).toBe(false);
        expect(ctx.setUserState).not.toHaveBeenCalled();
    });

    test("admin → tampil daftar + set state WANSW_SELECT", async () => {
        const ctx = makeCtx();
        const r = await state.startWanSwitch(ctx);
        expect(r.handled).toBe(true);
        expect(ctx.setUserState).toHaveBeenCalled();
        expect(ctx._stateStore[ADMIN].step).toBe("WANSW_SELECT");
        expect(ctx._stateStore[ADMIN].switches).toHaveLength(2);
        expect(ctx.reply.mock.calls[0][0]).toContain("MNI → SF");
    });
});

describe("pilih → konfirmasi → eksekusi", () => {
    test("pilihan tidak valid → reprompt, state tetap", async () => {
        const ctx = makeCtx({ chats: "9" });
        ctx._stateStore[ADMIN] = { step: "WANSW_SELECT", switches: [{ id: "mni-to-sf", label: "MNI → SF", applied: false }] };
        await state.handleWanSwitchConversationState({ ...ctx, userState: ctx._stateStore[ADMIN] });
        expect(ctx.reply.mock.calls[0][0].toLowerCase()).toContain("tidak valid");
    });

    test("pilih 1 (belum applied) → state CONFIRM arah apply", async () => {
        const ctx = makeCtx({ chats: "1" });
        ctx._stateStore[ADMIN] = { step: "WANSW_SELECT", switches: [{ id: "mni-to-sf", label: "MNI → SF", applied: false, affects: "110k" }] };
        await state.handleWanSwitchConversationState({ ...ctx, userState: ctx._stateStore[ADMIN] });
        expect(ctx._stateStore[ADMIN].step).toBe("WANSW_CONFIRM");
        expect(ctx._stateStore[ADMIN].switchId).toBe("mni-to-sf");
        expect(ctx._stateStore[ADMIN].direction).toBe("apply");
    });

    test("konfirmasi bukan 'ya' → reprompt, TIDAK eksekusi, state tetap", async () => {
        const applySwitch = jest.fn();
        const ctx = makeCtx({ chats: "nanti dulu", wanSwitchService: fakeService({ applySwitch }) });
        ctx._stateStore[ADMIN] = { step: "WANSW_CONFIRM", switchId: "mni-to-sf", direction: "apply", label: "MNI → SF" };
        await state.handleWanSwitchConversationState({ ...ctx, userState: ctx._stateStore[ADMIN] });
        expect(applySwitch).not.toHaveBeenCalled();
        expect(ctx.deleteUserState).not.toHaveBeenCalled();
    });

    test("konfirmasi 'ya' → applySwitch dipanggil + state dihapus + laporan sukses", async () => {
        const applySwitch = jest.fn(async () => ({ ok: true, message: "diterapkan", summary: "MNI → SF" }));
        const ctx = makeCtx({ chats: "ya", wanSwitchService: fakeService({ applySwitch }) });
        ctx._stateStore[ADMIN] = { step: "WANSW_CONFIRM", switchId: "mni-to-sf", direction: "apply", label: "MNI → SF" };
        await state.handleWanSwitchConversationState({ ...ctx, userState: ctx._stateStore[ADMIN] });
        expect(applySwitch).toHaveBeenCalledWith("mni-to-sf", "apply", expect.objectContaining({ role: "admin" }));
        expect(ctx.deleteUserState).toHaveBeenCalledWith(ADMIN);
        const lastReply = ctx.reply.mock.calls[ctx.reply.mock.calls.length - 1][0];
        expect(lastReply).toContain("diterapkan");
    });

    test("non-admin di tengah state → handled:false (gate ulang tiap langkah)", async () => {
        global.accounts = [];
        const ctx = makeCtx({ chats: "ya", sender: CUSTOMER, plainSenderNumber: "628999999999", global: { accounts: [] } });
        ctx._stateStore[ADMIN] = { step: "WANSW_CONFIRM", switchId: "mni-to-sf", direction: "apply" };
        const r = await state.handleWanSwitchConversationState({ ...ctx, userState: ctx._stateStore[ADMIN] });
        expect(r.handled).toBe(false);
    });
});
