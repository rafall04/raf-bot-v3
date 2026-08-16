/**
 * Header Doc
 * Purpose: Mengunci bahwa payload STRING dinormalkan jadi `{ text }` sebelum menyentuh Baileys,
 *          di hop TERAKHIR — sehingga pemanggil mana pun yang mengirim string tetap sampai.
 * Caller: Jest test runner.
 * Deps: `lib/whatsapp-gateway.js`.
 * MainFuncs: —
 * SideEffects: Menyetel/mengembalikan socket & connection state palsu di gateway.
 *
 * KENAPA ADA — Baileys menuntut objek `AnyMessageContent`; string mentah ditolak.
 * `sendCritical` sudah menormalkan dan `sendText` membungkus, TAPI
 * `sendMessage`/`sendMessageToMany`/`safeSendMessage` meneruskan apa adanya. Akibatnya
 * SELURUH kabar bot ke GRUP KAS gagal diam-diam lewat tiga jalur yang semuanya memanggil
 * `safeSendMessage(grup, teks)` dengan string:
 *   - lib/services/kas-group-notifier.js  (draft gaji, gaji dibayar, pengeluaran besar, bantuan)
 *   - lib/cron/jobs/money-digest.js       (ringkasan uang harian)
 *   - lib/cron/jobs/recurring-expense-reminder.js (pengingat biaya rutin)
 * Terukur 2026-08-16: `businessExpense.enabled=true` + groupId `@g.us` sah di KEDUA bot
 * produksi, jadi ini cacat HIDUP, bukan dorman.
 *
 * Perbaikannya sengaja di GATEWAY, bukan di tiga pemanggil — menambal instans membiarkan
 * pemanggil berikutnya lahir dengan cacat yang sama (pelajaran berulang di proyek ini).
 */
"use strict";

const gateway = require("../whatsapp-gateway");

let terkirim;

function pasangSocketPalsu() {
    terkirim = [];
    gateway.setActiveSocket(
        {
            user: { id: "628@s.whatsapp.net" },
            sendMessage: async (jid, payload, opts) => {
                // Tiru kontrak Baileys: payload WAJIB objek. String = kegagalan.
                if (typeof payload !== "object" || payload === null) {
                    throw new Error("Baileys menolak payload non-objek");
                }
                terkirim.push({ jid, payload, opts });
                return { key: { id: "x" } };
            },
        },
        { state: "open" }
    );
}

afterEach(() => {
    gateway.clearActiveSocket({ nextState: "close" });
});

describe("normalkanPayload", () => {
    test("string jadi { text }", () => {
        expect(gateway.normalkanPayload("halo")).toEqual({ text: "halo" });
    });

    test("objek diteruskan APA ADANYA — jalur media/tombol tak boleh berubah", () => {
        const media = { image: { url: "x.jpg" }, caption: "c" };
        expect(gateway.normalkanPayload(media)).toBe(media);
        const teks = { text: "sudah objek" };
        expect(gateway.normalkanPayload(teks)).toBe(teks);
    });

    test("null/undefined tidak dipaksa jadi objek kosong", () => {
        // Membungkus null jadi {text:null} akan menukar kegagalan berisik dengan
        // pesan kosong yang terkirim — lebih buruk.
        expect(gateway.normalkanPayload(null)).toBeNull();
        expect(gateway.normalkanPayload(undefined)).toBeUndefined();
    });
});

describe("sendPayload: string sampai ke Baileys sebagai objek", () => {
    beforeEach(pasangSocketPalsu);

    test("kirim string TIDAK lagi ditolak, dan tiba sebagai { text }", async () => {
        await gateway.sendPayload("120363@g.us", "Pengingat biaya rutin: listrik");
        expect(terkirim).toHaveLength(1);
        expect(terkirim[0].payload).toEqual({ text: "Pengingat biaya rutin: listrik" });
    });

    test("payload objek tetap utuh", async () => {
        const media = { image: { url: "x.jpg" }, caption: "bukti" };
        await gateway.sendPayload("628@s.whatsapp.net", media);
        expect(terkirim[0].payload).toBe(media);
    });

    test("opsi tetap diteruskan", async () => {
        await gateway.sendPayload("120363@g.us", "halo", { skipDuplicateCheck: true });
        expect(terkirim[0].opts).toEqual({ skipDuplicateCheck: true });
    });
});

describe("tiga jalur grup kas: string dari pemanggil nyata kini sampai", () => {
    beforeEach(pasangSocketPalsu);

    test("safeSendMessage(grup, teks) — pola persis kas-group-notifier & dua cron", async () => {
        const { safeSendMessage } = require("../cron/shared");
        const hasil = await safeSendMessage("120363428153774455@g.us", "Ringkasan uang hari ini", {
            skipDuplicateCheck: true,
        });
        expect(hasil.success).toBe(true);
        expect(terkirim).toHaveLength(1);
        expect(terkirim[0].payload).toEqual({ text: "Ringkasan uang hari ini" });
    });
});
