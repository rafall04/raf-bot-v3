/**
 * Header Doc
 * Purpose: Guardrail source test untuk memastikan download media dan outbound aktif lewat owner facade WhatsApp.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source handler aktif WA.
 * MainFuncs: Memverifikasi handler media aktif memakai `whatsapp.adapter` atau delivery service, bukan Baileys mentah.
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("wa outbound owner", () => {
    test("active payment proof handlers use WhatsApp adapter or delivery owners", () => {
        const topupSource = fs.readFileSync(path.join(__dirname, "..", "handlers", "topup-handler.js"), "utf8");
        const speedPaymentSource = fs.readFileSync(path.join(__dirname, "..", "handlers", "speed-payment-handler.js"), "utf8");

        expect(topupSource).toContain("../../lib/whatsapp.adapter");
        expect(topupSource).toContain("downloadMedia");
        expect(topupSource).not.toContain("@whiskeysockets/baileys");

        expect(speedPaymentSource).toContain("require('../../lib/whatsapp.adapter')");
        expect(speedPaymentSource).toContain("const buffer = await downloadMedia(msg, 'buffer', {});");
        expect(speedPaymentSource).not.toContain("@whiskeysockets/baileys");
    });
});
