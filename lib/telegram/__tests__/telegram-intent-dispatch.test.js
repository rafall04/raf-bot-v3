/**
 * Test telegram-intent-dispatch — parsing perintah + AUTH GATE whitelist.
 * Inti yang dijaga: chat tak terdaftar TIDAK pernah memanggil handler (hanya dibalas
 * info chat_id), private-chat only, fallback ke /help, dan handler yang throw tidak
 * menjatuhkan dispatcher. Semua dependency (repo, commands, client) diinjeksi fake.
 */
"use strict";

const { createTelegramDispatcher, parseCommand } = require("../telegram-intent-dispatch");

function makeClient() {
    return {
        safeSendMessage: jest.fn().mockResolvedValue({ success: true }),
        answerCallbackQuery: jest.fn().mockResolvedValue({ success: true }),
    };
}

function makeCallback(data, { chatId = 100 } = {}) {
    return { update_id: 9, callback_query: { id: "cb1", data, from: { id: chatId }, message: { chat: { id: chatId, type: "private" } } } };
}

function makeUpdate(text, { chatId = 100, chatType = "private" } = {}) {
    return { update_id: 1, message: { text, chat: { id: chatId, type: chatType }, from: { id: chatId } } };
}

function makeRepo(entriesById = {}) {
    return { find: (id) => entriesById[String(id)] || null };
}

describe("parseCommand", () => {
    test.each([
        ["/redaman budi@isp", "/redaman", "budi@isp"],
        ["/redaman@MyBot budi", "/redaman", "budi"],
        ["redaman budi", "/redaman", "budi"], // tanpa slash tetap dikenali
        ["/HELP", "/help", ""],
        ["  /olt   eko@isp  ", "/olt", "eko@isp"],
    ])("'%s' → %s args='%s'", (input, command, args) => {
        expect(parseCommand(input)).toEqual({ command, args });
    });

    test("teks kosong → null", () => {
        expect(parseCommand("   ")).toBeNull();
        expect(parseCommand("")).toBeNull();
    });
});

describe("handleUpdate — auth gate", () => {
    test("chat TAK terdaftar → balas info chat_id, handler TIDAK dipanggil", async () => {
        const redaman = jest.fn();
        const client = makeClient();
        const d = createTelegramDispatcher({ repository: makeRepo({}), commands: { "/redaman": redaman } });

        await d.handleUpdate(makeUpdate("/redaman budi", { chatId: 999 }), { client });

        expect(redaman).not.toHaveBeenCalled();
        expect(client.safeSendMessage).toHaveBeenCalledTimes(1);
        const [chatId, text] = client.safeSendMessage.mock.calls[0];
        expect(chatId).toBe(999);
        expect(text).toContain("belum terdaftar");
        expect(text).toContain("999"); // chat_id di-echo
    });

    test("chat terdaftar tapi disabled → balas dinonaktifkan, handler TIDAK dipanggil", async () => {
        const redaman = jest.fn();
        const client = makeClient();
        const d = createTelegramDispatcher({
            repository: makeRepo({ 100: { chatId: "100", enabled: false } }),
            commands: { "/redaman": redaman },
        });

        await d.handleUpdate(makeUpdate("/redaman budi"), { client });

        expect(redaman).not.toHaveBeenCalled();
        expect(client.safeSendMessage.mock.calls[0][1]).toContain("dinonaktifkan");
    });
});

describe("handleUpdate — dispatch", () => {
    const repo = makeRepo({ 100: { chatId: "100", enabled: true } });

    test("perintah dikenal → handler dipanggil dgn args", async () => {
        const redaman = jest.fn();
        const client = makeClient();
        const d = createTelegramDispatcher({ repository: repo, commands: { "/redaman": redaman } });

        await d.handleUpdate(makeUpdate("/redaman budi@isp"), { client });

        expect(redaman).toHaveBeenCalledTimes(1);
        const ctx = redaman.mock.calls[0][0];
        expect(ctx.args).toBe("budi@isp");
        expect(ctx.chatId).toBe(100);
        expect(typeof ctx.reply).toBe("function");
    });

    test("perintah tak dikenal → fallback ke /help", async () => {
        const help = jest.fn();
        const client = makeClient();
        const d = createTelegramDispatcher({ repository: repo, commands: { "/help": help } });

        await d.handleUpdate(makeUpdate("/tidakada x"), { client });
        expect(help).toHaveBeenCalledTimes(1);
    });

    test("teks biasa tanpa slash → reroute ke /pelanggan dgn query penuh", async () => {
        const pelanggan = jest.fn();
        const client = makeClient();
        const d = createTelegramDispatcher({ repository: repo, commands: { "/pelanggan": pelanggan } });
        await d.handleUpdate(makeUpdate("budi santoso"), { client });
        expect(pelanggan).toHaveBeenCalledTimes(1);
        expect(pelanggan.mock.calls[0][0].args).toBe("budi santoso");
    });

    test("group chat → diabaikan (tak ada balasan/handler)", async () => {
        const redaman = jest.fn();
        const client = makeClient();
        const d = createTelegramDispatcher({ repository: repo, commands: { "/redaman": redaman } });

        await d.handleUpdate(makeUpdate("/redaman budi", { chatType: "group" }), { client });
        expect(redaman).not.toHaveBeenCalled();
        expect(client.safeSendMessage).not.toHaveBeenCalled();
    });

    test("update non-teks → diabaikan", async () => {
        const client = makeClient();
        const d = createTelegramDispatcher({ repository: repo, commands: {} });
        await d.handleUpdate({ update_id: 2, message: { chat: { id: 100, type: "private" } } }, { client });
        expect(client.safeSendMessage).not.toHaveBeenCalled();
    });

    test("handler throw → dispatcher tidak ikut throw, kirim pesan error", async () => {
        const boom = jest.fn(() => {
            throw new Error("ledakan");
        });
        const client = makeClient();
        const spy = jest.spyOn(console, "error").mockImplementation(() => {});
        const d = createTelegramDispatcher({ repository: repo, commands: { "/redaman": boom } });

        await expect(d.handleUpdate(makeUpdate("/redaman x"), { client })).resolves.toBeUndefined();
        expect(client.safeSendMessage).toHaveBeenCalledTimes(1);
        expect(client.safeSendMessage.mock.calls[0][1]).toContain("kesalahan");
        spy.mockRestore();
    });
});

describe("handleUpdate — callback_query (tombol)", () => {
    const repo = makeRepo({ 100: { chatId: "100", enabled: true } });

    test("'do:redaman:5' → commands['/redaman'] dipanggil dgn resolvedUserId; spinner di-answer", async () => {
        const redaman = jest.fn();
        const client = makeClient();
        const d = createTelegramDispatcher({ repository: repo, commands: { "/redaman": redaman } });
        await d.handleUpdate(makeCallback("do:redaman:5"), { client });
        expect(client.answerCallbackQuery).toHaveBeenCalledWith("cb1");
        expect(redaman).toHaveBeenCalledTimes(1);
        expect(redaman.mock.calls[0][0].resolvedUserId).toBe("5");
    });

    test("chat tak terdaftar → tombol ditolak, handler tak dipanggil", async () => {
        const redaman = jest.fn();
        const client = makeClient();
        const d = createTelegramDispatcher({ repository: makeRepo({}), commands: { "/redaman": redaman } });
        await d.handleUpdate(makeCallback("do:redaman:5", { chatId: 777 }), { client });
        expect(redaman).not.toHaveBeenCalled();
        expect(client.safeSendMessage.mock.calls[0][1]).toContain("belum terdaftar");
    });

    test("skema callback_data tak dikenal → diabaikan (spinner tetap di-answer)", async () => {
        const redaman = jest.fn();
        const client = makeClient();
        const d = createTelegramDispatcher({ repository: repo, commands: { "/redaman": redaman } });
        await d.handleUpdate(makeCallback("foobar"), { client });
        expect(client.answerCallbackQuery).toHaveBeenCalled();
        expect(redaman).not.toHaveBeenCalled();
    });

    test("'go:terakhir' (tanpa id) → commands['/terakhir'] dipanggil tanpa resolvedUserId", async () => {
        const terakhir = jest.fn();
        const client = makeClient();
        const d = createTelegramDispatcher({ repository: repo, commands: { "/terakhir": terakhir } });
        await d.handleUpdate(makeCallback("go:terakhir"), { client });
        expect(terakhir).toHaveBeenCalledTimes(1);
        expect(terakhir.mock.calls[0][0].resolvedUserId).toBeUndefined();
    });
});
