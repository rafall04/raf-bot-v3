/**
 * Header Doc
 * Purpose: Mengunci perilaku digest anti-spam: leading-edge (request pertama instan + detail),
 *          held (berikutnya ditahan, tak dikirim), flush ringkasan saat jendela tutup, jendela
 *          sunyi tak mengirim apa-apa, dan durabilitas lintas 'restart' (baca dari disk).
 * Caller: jest.
 * Deps: `lib/notification-digest` dengan `whatsapp-delivery-service` di-mock.
 * SideEffects: Menulis `database/notification-digest_test.json` lalu menghapusnya.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const STORE = path.join(__dirname, "..", "..", "database", "notification-digest_test.json");

jest.mock("../whatsapp-delivery-service", () => ({ sendMessage: jest.fn().mockResolvedValue({ ok: true }) }));
// Ringkasan pakai fallback string (template service tak dimuat di unit test).
jest.mock("../response-template-helper", () => ({ renderResponseTemplate: (_k, fallback) => fallback }));

const { sendMessage } = require("../whatsapp-delivery-service");
const digest = require("../notification-digest");

const R = "628123@s.whatsapp.net";
const item = (name, price) => ({ customerName: name, price, teknisiName: "DAVIN", adminUrl: "https://x.id/p" });

function clean() {
    if (fs.existsSync(STORE)) fs.unlinkSync(STORE);
}

beforeEach(() => {
    jest.clearAllMocks();
    clean();
});
afterAll(() => clean());

const enq = (name, price, opts = {}) =>
    digest.enqueueOrSendFirst({
        recipient: R,
        kind: "payment_request_new",
        detailText: `DETAIL ${name}`,
        summaryItem: item(name, price),
        windowMs: 30 * 60000,
        ...opts
    });

test("request PERTAMA → kirim detail segera (leading-edge)", async () => {
    const r = await enq("Muhyin", 125000, { now: 1000 });
    expect(r.sent).toBe("detail");
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toBe(R);
    expect(sendMessage.mock.calls[0][1]).toEqual({ text: "DETAIL Muhyin" });
});

test("request BERIKUTNYA dalam jendela → ditahan, TIDAK dikirim", async () => {
    await enq("Muhyin", 125000, { now: 1000 });
    const r2 = await enq("Dul", 110000, { now: 2000 });
    const r3 = await enq("Sholikhah", 110000, { now: 3000 });
    expect(r2.sent).toBe("held");
    expect(r3.sent).toBe("held");
    expect(sendMessage).toHaveBeenCalledTimes(1); // hanya leading-edge
});

test("flush → SATU ringkasan berisi yang tertahan + total benar", async () => {
    await enq("Muhyin", 125000, { now: 1000 });
    await enq("Dul", 110000, { now: 2000 });
    await enq("Sholikhah", 110000, { now: 3000 });

    const res = await digest.tickDigests(1000 + 30 * 60000 + 1);
    expect(res.flushed).toBe(1);
    expect(sendMessage).toHaveBeenCalledTimes(2); // leading-edge + ringkasan
    const summary = sendMessage.mock.calls[1][1].text;
    expect(summary).toMatch(/2 Pengajuan/); // 2 yang tertahan (Muhyin sudah dikirim detail)
    expect(summary).toMatch(/Dul/);
    expect(summary).toMatch(/Sholikhah/);
    expect(summary).toMatch(/Rp 220\.000/); // 110k + 110k
    expect(summary).not.toMatch(/Muhyin/); // yang pertama sudah dapat detail, tak diulang
});

test("request TUNGGAL → jendela sunyi, flush tak mengirim ringkasan", async () => {
    await enq("Solo", 100000, { now: 1000 });
    const res = await digest.tickDigests(1000 + 30 * 60000 + 1);
    expect(res.flushed).toBe(0);
    expect(sendMessage).toHaveBeenCalledTimes(1); // cuma detail leading-edge
});

test("jendela belum tutup → tick tidak flush", async () => {
    await enq("A", 1, { now: 1000 });
    await enq("B", 1, { now: 2000 });
    const res = await digest.tickDigests(1000 + 10 * 60000); // baru 10 mnt
    expect(res.flushed).toBe(0);
    expect(sendMessage).toHaveBeenCalledTimes(1);
});

test("burst BARU sesudah jendela lama tutup → leading-edge lagi", async () => {
    await enq("A", 1, { now: 1000 });
    await digest.tickDigests(1000 + 30 * 60000 + 1); // tutup jendela pertama
    const r = await enq("B", 1, { now: 1000 + 40 * 60000 });
    expect(r.sent).toBe("detail");
    expect(sendMessage).toHaveBeenCalledTimes(2); // detail A + detail B (dua burst terpisah)
});

test("durabel: bucket dibaca ulang dari disk (simulasi restart)", async () => {
    await enq("Muhyin", 125000, { now: 1000 });
    await enq("Dul", 110000, { now: 2000 });

    jest.resetModules();
    jest.doMock("../whatsapp-delivery-service", () => ({ sendMessage: jest.fn().mockResolvedValue({ ok: true }) }));
    jest.doMock("../response-template-helper", () => ({ renderResponseTemplate: (_k, fb) => fb }));
    const fresh = require("../notification-digest");
    const freshSend = require("../whatsapp-delivery-service").sendMessage;

    const res = await fresh.tickDigests(1000 + 30 * 60000 + 1);
    expect(res.flushed).toBe(1);
    expect(freshSend).toHaveBeenCalledTimes(1); // ringkasan 'Dul' terkirim setelah restart
    expect(freshSend.mock.calls[0][1].text).toMatch(/Dul/);
});

test("penerima @lid ditolak (invarian: jangan kirim ke @lid)", async () => {
    const r = await digest.enqueueOrSendFirst({
        recipient: "273426@lid",
        kind: "payment_request_new",
        detailText: "x",
        summaryItem: item("X", 1)
    });
    expect(r.sent).toBe("none");
    expect(sendMessage).not.toHaveBeenCalled();
});
