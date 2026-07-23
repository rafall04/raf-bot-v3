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

    // REGRESI PRODUKSI 2026-07-23. Baileys menaruh pengirim grup di `key.participant`;
    // `msg.participant` (level atas) hanya terisi pada sebagian bentuk pesan. Dulu hanya
    // yang level atas dibaca, jadi begitu kosong fungsi ini mengembalikan null dan raf.js
    // membuang pesannya sebagai "chats is undefined" — SELURUH pesan grup mati diam-diam
    // (intake PSB via grup & perintah dompet tak pernah terpanggil). Tes lama luput karena
    // memakai `participant` level atas, bentuk yang justru TIDAK dikirim WhatsApp.
    describe("pengirim grup dari key.participant (bentuk nyata Baileys)", () => {
        function pesanGrup(key) {
            return {
                key: Object.assign({ remoteJid: "12036@g.us", fromMe: false }, key),
                pushName: "Pemilik",
                message: { conversation: "uang bantuan" }
            };
        }

        test("key.participant dipakai saat msg.participant kosong", () => {
            const n = normalizeIncomingMessage(pesanGrup({ participant: "62851@s.whatsapp.net" }));
            expect(n).not.toBeNull();
            expect(n.isGroup).toBe(true);
            expect(n.sender).toBe("62851@s.whatsapp.net");
            expect(n.chats).toBe("uang bantuan");
        });

        test("pengirim @lid tetap diterima, bukan dibuang", () => {
            const n = normalizeIncomingMessage(
                pesanGrup({ participant: "225743565000823@lid", participantAlt: "62851@s.whatsapp.net" })
            );
            expect(n).not.toBeNull();
            expect(n.sender).toBe("225743565000823@lid");
        });

        test("msg.participant level atas tetap dihormati (kompatibilitas mundur)", () => {
            const msg = pesanGrup({});
            msg.participant = "62813@s.whatsapp.net";
            expect(normalizeIncomingMessage(msg).sender).toBe("62813@s.whatsapp.net");
        });

        test("key.participant menang atas msg.participant bila keduanya ada", () => {
            const msg = pesanGrup({ participant: "62851@s.whatsapp.net" });
            msg.participant = "62813@s.whatsapp.net";
            expect(normalizeIncomingMessage(msg).sender).toBe("62851@s.whatsapp.net");
        });

        test("grup tanpa pengirim sama sekali tetap null (tak bisa diproses)", () => {
            expect(normalizeIncomingMessage(pesanGrup({}))).toBeNull();
        });
    });
});
