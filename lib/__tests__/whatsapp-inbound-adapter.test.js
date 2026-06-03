/**
 * Header Doc
 * Purpose: Behavioral test untuk adapter inbound WhatsApp.
 * Caller: Jest test runner.
 * Deps: `../whatsapp-inbound-adapter`.
 * MainFuncs: Memverifikasi parsing caption, group sender, dan invalid payload handling.
 * SideEffects: Tidak ada.
 */
"use strict";

const { normalizeIncomingMessage } = require("../whatsapp-inbound-adapter");

describe("whatsapp inbound adapter", () => {
    test("uses participant as sender for group messages", () => {
        const normalized = normalizeIncomingMessage({
            key: { remoteJid: "grup@g.us" },
            participant: "62813@s.whatsapp.net",
            pushName: "Teknisi",
            message: {
                imageMessage: {
                    caption: "lapor foto"
                }
            }
        });

        expect(normalized.sender).toBe("62813@s.whatsapp.net");
        expect(normalized.isGroup).toBe(true);
        expect(normalized.chats).toBe("lapor foto");
    });

    test("returns null for invalid payload", () => {
        expect(normalizeIncomingMessage(null)).toBeNull();
        expect(normalizeIncomingMessage({ key: {}, message: null })).toBeNull();
    });
});
