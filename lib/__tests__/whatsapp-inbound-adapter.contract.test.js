/**
 * Header Doc
 * Purpose: Guardrail contract test untuk adapter inbound WhatsApp.
 * Caller: Jest test runner.
 * Deps: `../whatsapp-inbound-adapter`.
 * MainFuncs: Memverifikasi shape normalized message minimum tetap stabil.
 * SideEffects: Tidak ada.
 */
"use strict";

const { normalizeIncomingMessage } = require("../whatsapp-inbound-adapter");

describe("whatsapp inbound adapter contract", () => {
    test("normalizes the minimum internal bot message contract", () => {
        const normalized = normalizeIncomingMessage({
            key: { remoteJid: "62812@s.whatsapp.net" },
            pushName: "Raf",
            message: {
                extendedTextMessage: {
                    text: "cek saldo sekarang"
                }
            }
        });

        expect(normalized).toEqual(expect.objectContaining({
            from: "62812@s.whatsapp.net",
            sender: "62812@s.whatsapp.net",
            pushname: "Raf",
            command: "cek",
            args: ["cek", "saldo", "sekarang"],
            chats: "cek saldo sekarang",
            isGroup: false,
            messageType: "extendedTextMessage"
        }));
    });
});
