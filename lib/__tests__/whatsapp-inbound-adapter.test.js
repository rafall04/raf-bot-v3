/**
 * Header Doc
 * Purpose: Behavioral test untuk adapter inbound WhatsApp.
 * Caller: Jest test runner.
 * Deps: `../whatsapp-inbound-adapter`.
 * MainFuncs: Memverifikasi parsing caption, group sender, dan invalid payload handling.
 * SideEffects: Tidak ada.
 */
"use strict";

const { normalizeIncomingMessage, isControlEnvelope } = require("../whatsapp-inbound-adapter");

// Regresi "pesan dobel di wizard PSB" (Tanjungharjo 2026-08-12). `protocolMessage` menyusul ±2 detik
// sesudah hampir tiap pesan nyata; dulu ia lolos sebagai pesan berteks kosong, ikut masuk ke
// conversation state, tak cocok YA/TIDAK/angka, lalu wizard mengirim teks bantuannya untuk KEDUA
// kalinya. Terukur 137 protocolMessage + 60 senderKeyDistributionMessage dari 822 pesan masuk (24%).
describe("envelope kontrol (regresi pesan dobel)", () => {
    const envelope = (type, isi = {}) => ({
        key: { remoteJid: "628999@s.whatsapp.net" },
        pushName: "Teknisi",
        message: { [type]: isi }
    });

    test.each(["protocolMessage", "senderKeyDistributionMessage", "reactionMessage"])(
        "%s TIDAK pernah jadi pesan pemakai (null, bukan teks kosong)",
        (type) => {
            expect(normalizeIncomingMessage(envelope(type))).toBeNull();
            expect(isControlEnvelope(envelope(type))).toBe(true);
        }
    );

    test("pesan nyata TIDAK ikut terbuang", () => {
        const teks = envelope("conversation", {});
        teks.message = { conversation: "refresh" };
        expect(isControlEnvelope(teks)).toBe(false);
        expect(normalizeIncomingMessage(teks).chats).toBe("refresh");
    });

    test("lokasi & gambar tetap lolos walau teksnya memang kosong", () => {
        // Penting: gerbangnya harus berbasis TIPE, bukan 'teks kosong' — share lokasi dan foto
        // rumah di wizard PSB sama-sama berteks kosong tapi wajib diproses.
        const lokasi = envelope("locationMessage", { degreesLatitude: -7.1, degreesLongitude: 111.9 });
        const gambar = envelope("imageMessage", {});
        expect(isControlEnvelope(lokasi)).toBe(false);
        expect(isControlEnvelope(gambar)).toBe(false);
        expect(normalizeIncomingMessage(lokasi).type).toBe("locationMessage");
        expect(normalizeIncomingMessage(gambar).type).toBe("imageMessage");
    });

    test("payload rusak tak bikin isControlEnvelope meledak", () => {
        expect(isControlEnvelope(null)).toBe(false);
        expect(isControlEnvelope({})).toBe(false);
        expect(isControlEnvelope({ message: null })).toBe(false);
    });
});

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
    // `msg.participant` (level atas) hanya terisi pada SEBAGIAN bentuk pesan. Dulu hanya
    // yang level atas dibaca, jadi begitu kosong fungsi ini mengembalikan null dan raf.js
    // membuang pesannya sebagai "chats is undefined". Yang terkena: pesan TEKS BIASA di
    // grup (perintah dompet). Intake PSB via grup lolos karena memakai gambar ber-caption
    // yang membawa `msg.participant` — sebab itulah bug ini lama tak ketahuan, dan sebab
    // itu pula tes lama (yang memakai bentuk gambar) tetap hijau.
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
