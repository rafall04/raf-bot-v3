/**
 * Test telegram-teknisi-client — verifikasi payload sendMessage (HTML + disable preview),
 * getUpdates (kembalikan result array, throw saat ok:false), dan safeSendMessage yang
 * TIDAK PERNAH throw walau axios menolak. Axios diinjeksi sebagai fake.
 */
"use strict";

const { createTelegramClient } = require("../telegram-teknisi-client");

function fakeAxios(handler) {
    return { post: jest.fn(handler) };
}

describe("sendMessage", () => {
    test("bangun payload HTML + disable_web_page_preview, panggil endpoint yg benar", async () => {
        const axios = fakeAxios(async () => ({ data: { ok: true, result: { message_id: 9 } } }));
        const client = createTelegramClient("TOKEN123", { axios });

        const result = await client.sendMessage("555", "<b>hai</b>");
        expect(result).toEqual({ message_id: 9 });

        const [url, payload] = axios.post.mock.calls[0];
        expect(url).toBe("https://api.telegram.org/botTOKEN123/sendMessage");
        expect(payload).toMatchObject({
            chat_id: "555",
            text: "<b>hai</b>",
            parse_mode: "HTML",
            disable_web_page_preview: true,
        });
    });

    test("sertakan reply_markup bila diberikan", async () => {
        const axios = fakeAxios(async () => ({ data: { ok: true, result: {} } }));
        const client = createTelegramClient("T", { axios });
        const markup = { inline_keyboard: [[{ text: "x", callback_data: "y" }]] };
        await client.sendMessage("1", "t", { replyMarkup: markup });
        expect(axios.post.mock.calls[0][1].reply_markup).toEqual(markup);
    });

    test("throw saat Telegram balas ok:false", async () => {
        const axios = fakeAxios(async () => ({ data: { ok: false, description: "chat not found" } }));
        const client = createTelegramClient("T", { axios });
        await expect(client.sendMessage("1", "t")).rejects.toThrow("chat not found");
    });
});

describe("getUpdates", () => {
    test("kembalikan result array", async () => {
        const updates = [{ update_id: 1 }, { update_id: 2 }];
        const axios = fakeAxios(async () => ({ data: { ok: true, result: updates } }));
        const client = createTelegramClient("T", { axios });
        const res = await client.getUpdates({ offset: 5, timeoutSec: 1 });
        expect(res).toEqual(updates);
        const [url, payload] = axios.post.mock.calls[0];
        expect(url).toContain("/getUpdates");
        expect(payload.offset).toBe(5);
        expect(payload.timeout).toBe(1);
    });

    test("throw saat ok:false", async () => {
        const axios = fakeAxios(async () => ({ data: { ok: false, description: "conflict 409" } }));
        const client = createTelegramClient("T", { axios });
        await expect(client.getUpdates({})).rejects.toThrow("conflict 409");
    });

    test("signal abort ada di config (arg ke-3), bukan di payload", async () => {
        const axios = fakeAxios(async () => ({ data: { ok: true, result: [{ update_id: 1 }] } }));
        const client = createTelegramClient("T", { axios });
        const res = await client.getUpdates({ offset: 7, timeoutSec: 2 });
        expect(res).toEqual([{ update_id: 1 }]);
        const [, payload, config] = axios.post.mock.calls[0];
        expect(payload).toMatchObject({ offset: 7, timeout: 2 });
        expect(payload.signal).toBeUndefined();
        expect("signal" in config).toBe(true);
    });
});

describe("abortInflight", () => {
    test("aman dipanggil tanpa request berjalan (idempoten, tidak throw)", () => {
        const axios = fakeAxios(async () => ({ data: { ok: true, result: [] } }));
        const client = createTelegramClient("T", { axios });
        expect(() => client.abortInflight()).not.toThrow();
        expect(() => client.abortInflight()).not.toThrow();
    });
});

describe("setMyCommands", () => {
    test("kirim daftar perintah ke endpoint setMyCommands", async () => {
        const axios = fakeAxios(async () => ({ data: { ok: true, result: true } }));
        const client = createTelegramClient("T", { axios });
        const res = await client.setMyCommands([{ command: "cek", description: "diagnosa" }]);
        expect(res.success).toBe(true);
        const [url, payload] = axios.post.mock.calls[0];
        expect(url).toContain("/setMyCommands");
        expect(payload.commands).toEqual([{ command: "cek", description: "diagnosa" }]);
    });

    test("gagal → {success:false} tanpa throw", async () => {
        const axios = fakeAxios(async () => {
            throw new Error("network down");
        });
        const client = createTelegramClient("T", { axios });
        const spy = jest.spyOn(console, "error").mockImplementation(() => {});
        const res = await client.setMyCommands([]);
        expect(res.success).toBe(false);
        spy.mockRestore();
    });
});

describe("safeSendMessage", () => {
    test("axios menolak → kembalikan {success:false} tanpa throw", async () => {
        const axios = fakeAxios(async () => {
            const err = new Error("network down");
            throw err;
        });
        const client = createTelegramClient("T", { axios });
        const spy = jest.spyOn(console, "error").mockImplementation(() => {});

        const res = await client.safeSendMessage("1", "t");
        expect(res.success).toBe(false);
        expect(res.error).toBe("network down");

        spy.mockRestore();
    });

    test("sukses → {success:true, result}", async () => {
        const axios = fakeAxios(async () => ({ data: { ok: true, result: { message_id: 3 } } }));
        const client = createTelegramClient("T", { axios });
        const res = await client.safeSendMessage("1", "t");
        expect(res.success).toBe(true);
        expect(res.result).toEqual({ message_id: 3 });
    });

    test("Telegram ok:false → {success:false} (tetap tidak throw)", async () => {
        const axios = fakeAxios(async () => ({ data: { ok: false, description: "bot blocked" } }));
        const client = createTelegramClient("T", { axios });
        const spy = jest.spyOn(console, "error").mockImplementation(() => {});
        const res = await client.safeSendMessage("1", "t");
        expect(res.success).toBe(false);
        expect(res.error).toBe("bot blocked");
        spy.mockRestore();
    });
});
