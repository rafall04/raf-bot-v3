/**
 * Test telegram-teknisi-bootstrap — guard start/stop (tidak ada loop ganda; disabled &
 * token placeholder tidak start) dan satu siklus poll (_pollOnce): majukan offset + dispatch
 * tiap update, dan error handler tidak menghentikan update lain. Loop tak-hingga TIDAK
 * dijalankan (autoLoop:false) agar test deterministik.
 */
"use strict";

const bootstrap = require("../telegram-teknisi-bootstrap");

function fakeClient(updates = []) {
    return { getUpdates: jest.fn().mockResolvedValue(updates) };
}
const fakeDispatcher = () => ({ handleUpdate: jest.fn().mockResolvedValue(undefined) });

beforeEach(() => {
    bootstrap._resetState();
    global.config = { telegramTeknisi: { enabled: true, botToken: "12345:ABCDEF", pollTimeoutSec: 1 } };
});
afterEach(() => {
    bootstrap.stopTelegramTeknisiBot();
    bootstrap._resetState();
});

describe("guard start/stop", () => {
    test("disabled → tidak start, client tidak dipoll", () => {
        global.config.telegramTeknisi.enabled = false;
        const client = fakeClient();
        const r = bootstrap.startTelegramTeknisiBot({ client, dispatcher: fakeDispatcher(), autoLoop: false });
        expect(r).toBeUndefined();
        expect(bootstrap._getState().running).toBe(false);
        expect(client.getUpdates).not.toHaveBeenCalled();
    });

    test("token placeholder (ISI_) → tidak start", () => {
        global.config.telegramTeknisi.botToken = "ISI_TELEGRAM_TEKNISI_BOT_TOKEN";
        const r = bootstrap.startTelegramTeknisiBot({ client: fakeClient(), dispatcher: fakeDispatcher(), autoLoop: false });
        expect(r).toBeUndefined();
        expect(bootstrap._getState().running).toBe(false);
    });

    test("start sekali → running; start kedua diabaikan; stop menghentikan", () => {
        const spy = jest.spyOn(console, "log").mockImplementation(() => {});
        const h1 = bootstrap.startTelegramTeknisiBot({ client: fakeClient(), dispatcher: fakeDispatcher(), autoLoop: false });
        expect(h1).toBeTruthy();
        expect(bootstrap._getState().running).toBe(true);

        const h2 = bootstrap.startTelegramTeknisiBot({ client: fakeClient(), dispatcher: fakeDispatcher(), autoLoop: false });
        expect(h2).toBeUndefined(); // guard: tidak ada loop kedua

        bootstrap.stopTelegramTeknisiBot();
        expect(bootstrap._getState().running).toBe(false);
        spy.mockRestore();
    });

    test("start mendaftarkan menu perintah (setMyCommands) bila client mendukung", () => {
        const spy = jest.spyOn(console, "log").mockImplementation(() => {});
        const client = { getUpdates: jest.fn().mockResolvedValue([]), setMyCommands: jest.fn().mockResolvedValue({ success: true }) };
        bootstrap.startTelegramTeknisiBot({ client, dispatcher: fakeDispatcher(), autoLoop: false });
        expect(client.setMyCommands).toHaveBeenCalledTimes(1);
        const arg = client.setMyCommands.mock.calls[0][0];
        expect(Array.isArray(arg)).toBe(true);
        expect(arg.some((c) => c.command === "cek")).toBe(true);
        spy.mockRestore();
    });
});

describe("_pollOnce", () => {
    beforeEach(() => {
        const spy = jest.spyOn(console, "log").mockImplementation(() => {});
        bootstrap.startTelegramTeknisiBot({ client: fakeClient(), dispatcher: fakeDispatcher(), autoLoop: false });
        spy.mockRestore();
    });

    test("majukan offset ke (max update_id + 1) & dispatch tiap update", async () => {
        const client = fakeClient([{ update_id: 5, message: {} }, { update_id: 6, message: {} }]);
        const dispatcher = fakeDispatcher();
        const updates = await bootstrap._pollOnce(client, dispatcher);

        expect(updates).toHaveLength(2);
        expect(dispatcher.handleUpdate).toHaveBeenCalledTimes(2);
        expect(bootstrap._getState().offset).toBe(7);
        expect(client.getUpdates).toHaveBeenCalledWith({ offset: undefined, timeoutSec: 1 });
    });

    test("handler error pada satu update tidak menghentikan update lain / offset tetap maju", async () => {
        const client = fakeClient([{ update_id: 1 }, { update_id: 2 }]);
        const dispatcher = { handleUpdate: jest.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined) };
        const spy = jest.spyOn(console, "error").mockImplementation(() => {});

        await bootstrap._pollOnce(client, dispatcher);

        expect(dispatcher.handleUpdate).toHaveBeenCalledTimes(2);
        expect(bootstrap._getState().offset).toBe(3);
        spy.mockRestore();
    });
});

describe("anti-replay cold-start (pollOnce)", () => {
    beforeEach(() => {
        const spy = jest.spyOn(console, "log").mockImplementation(() => {});
        bootstrap.startTelegramTeknisiBot({ client: fakeClient(), dispatcher: fakeDispatcher(), autoLoop: false });
        spy.mockRestore();
    });

    test("pesan teks basi (dibuat sebelum start) dibuang; pesan baru diproses; offset tetap maju", async () => {
        const nowSec = Math.floor(Date.now() / 1000);
        const updates = [
            { update_id: 10, message: { date: nowSec - 3600, text: "/cek lama" } }, // basi: 1 jam lalu
            { update_id: 11, message: { date: nowSec, text: "/cek baru" } }, // baru
        ];
        const dispatcher = fakeDispatcher();
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

        await bootstrap._pollOnce(fakeClient(updates), dispatcher);

        expect(dispatcher.handleUpdate).toHaveBeenCalledTimes(1); // hanya yang baru
        expect(dispatcher.handleUpdate.mock.calls[0][0]).toBe(updates[1]);
        expect(bootstrap._getState().offset).toBe(12); // yang basi pun di-consume (offset maju)
        warn.mockRestore();
    });

    test("callback_query lama TIDAK difilter (selalu diproses; aman karena read-only/konfirmasi)", async () => {
        const oldSec = Math.floor(Date.now() / 1000) - 3600;
        const cb = {
            update_id: 20,
            callback_query: { id: "x", data: "do:cek:1", message: { date: oldSec, chat: { id: 1 } }, from: { id: 1 } },
        };
        const dispatcher = fakeDispatcher();

        await bootstrap._pollOnce(fakeClient([cb]), dispatcher);

        expect(dispatcher.handleUpdate).toHaveBeenCalledTimes(1);
        expect(bootstrap._getState().offset).toBe(21);
    });
});

describe("pollLoop berhenti saat error terminal (token salah)", () => {
    test("401 Unauthorized → loop berhenti, terminal=true, tidak retry/spin", async () => {
        const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
        bootstrap._resetState();
        const session = bootstrap._getState();
        session.running = true;
        session.startedAtMs = Date.now();

        const err = new Error("Unauthorized");
        err.response = { status: 401, data: { error_code: 401, description: "Unauthorized" } };
        const client = { getUpdates: jest.fn().mockRejectedValue(err) };

        await bootstrap._pollLoop(client, fakeDispatcher(), session);

        expect(client.getUpdates).toHaveBeenCalledTimes(1); // berhenti, BUKAN retry tiap 5s
        expect(session.running).toBe(false);
        expect(session.terminal).toBe(true);
        expect(bootstrap.getStatus().terminal).toBe(true);
        errSpy.mockRestore();
        logSpy.mockRestore();
    });
});

describe("isStaleMessage", () => {
    const started = 1_700_000_000_000; // ms tetap (deterministik)

    test("pesan dibuat jauh sebelum start → basi", () => {
        const oldSec = Math.floor((started - 3_600_000) / 1000);
        expect(bootstrap._isStaleMessage({ message: { date: oldSec } }, started)).toBe(true);
    });

    test("pesan baru / dalam toleransi skew → tidak basi", () => {
        const freshSec = Math.floor(started / 1000);
        expect(bootstrap._isStaleMessage({ message: { date: freshSec } }, started)).toBe(false);
    });

    test("tanpa date, callback_query, null, atau startedAtMs null → tidak basi", () => {
        expect(bootstrap._isStaleMessage({ message: {} }, started)).toBe(false);
        expect(bootstrap._isStaleMessage({ callback_query: { message: { date: 1 } } }, started)).toBe(false);
        expect(bootstrap._isStaleMessage(null, started)).toBe(false);
        expect(bootstrap._isStaleMessage({ message: { date: 1 } }, null)).toBe(false);
    });
});

describe("isTerminalAuthError", () => {
    test("401/404 (status atau error_code) & 'Unauthorized' → terminal", () => {
        expect(bootstrap._isTerminalAuthError({ response: { status: 401 } })).toBe(true);
        expect(bootstrap._isTerminalAuthError({ response: { status: 404 } })).toBe(true);
        expect(bootstrap._isTerminalAuthError({ response: { data: { error_code: 401 } } })).toBe(true);
        expect(bootstrap._isTerminalAuthError(new Error("Unauthorized"))).toBe(true);
    });

    test("409 (consumer ganda) / jaringan / null → BUKAN terminal (harus tetap retry)", () => {
        expect(bootstrap._isTerminalAuthError({ response: { status: 409 }, message: "conflict 409" })).toBe(false);
        expect(bootstrap._isTerminalAuthError(new Error("socket hang up"))).toBe(false);
        expect(bootstrap._isTerminalAuthError(new Error("getUpdates gagal"))).toBe(false);
        expect(bootstrap._isTerminalAuthError(null)).toBe(false);
    });
});
