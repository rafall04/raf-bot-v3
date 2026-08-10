"use strict";

/**
 * Header Doc
 * Purpose: Mengunci pembacaan PENGIRIM pesan grup di normalizer masuk, dan menjaga agar
 *   modul opsional per-instance tak di-require tanpa gerbang di `message/raf.js`.
 *
 *   Kejadian nyata 2026-08-10: di Tanjungharjo setiap "kas bantuan" di grup dibuang dengan
 *   "[WARNING] chats is undefined" — teksnya jelas ada, tapi normalizer versi lama membaca
 *   pengirim dari `msg.participant` (level atas) yang KOSONG untuk pesan teks biasa di grup.
 *   Null dari sini membuat raf.js berhenti SEBELUM cabang grup, jadi gerbang kas tak pernah
 *   dijalankan dan tak ada jejak apa pun selain baris warning yang mudah terlewat.
 *   Dander tak terkena karena sudah memakai versi yang diperbaiki — satu bot jalan, satu diam.
 * Caller: Jest (`npx jest lib/__tests__/inbound-group-sender.test.js`).
 * Deps: `lib/whatsapp-inbound-adapter`, fs/path (pindai raf.js).
 * SideEffects: Tidak ada.
 */

const fs = require("fs");
const path = require("path");
const { normalizeIncomingMessage } = require("../whatsapp-inbound-adapter");

const REPO = path.join(__dirname, "..", "..");

function pesanGrup(extra = {}) {
    // `key` dipisah lebih dulu: menyebar `extra` di akhir akan MENIMPA seluruh objek key
    // (termasuk remoteJid) dan membuat kasus ujinya bukan pesan grup lagi.
    const { key: keyExtra, ...sisa } = extra;
    return {
        message: { conversation: "kas bantuan" },
        pushName: "Pemilik",
        ...sisa,
        key: { remoteJid: "120363000000000000@g.us", fromMe: false, id: "ABC123", ...(keyExtra || {}) }
    };
}

describe("pengirim pesan grup dibaca dari key.participant", () => {
    test("teks biasa di grup: participant HANYA di key -> tetap terbaca", () => {
        // Bentuk inilah yang dulu dibuang senyap.
        const r = normalizeIncomingMessage(pesanGrup({ key: { participant: "111222333444555@lid" } }));
        expect(r).not.toBeNull();
        expect(r.chats).toBe("kas bantuan");
        expect(r.isGroup).toBe(true);
        expect(r.sender).toBe("111222333444555@lid");
    });

    test("bentuk LAMA (msg.participant level atas) tetap dihormati", () => {
        // Perbaikannya aditif — jalur PSB via gambar ber-caption memakai bentuk ini.
        const r = normalizeIncomingMessage(pesanGrup({ participant: "628111222333@s.whatsapp.net" }));
        expect(r).not.toBeNull();
        expect(r.sender).toBe("628111222333@s.whatsapp.net");
    });

    test("key.participant DIDAHULUKAN saat keduanya ada", () => {
        const r = normalizeIncomingMessage(
            pesanGrup({ key: { participant: "111222333444555@lid" }, participant: "628999@s.whatsapp.net" })
        );
        expect(r.sender).toBe("111222333444555@lid");
    });

    test("chat pribadi tak terpengaruh — pengirim = remoteJid", () => {
        const r = normalizeIncomingMessage({
            key: { remoteJid: "628111222333@s.whatsapp.net", fromMe: false, id: "X" },
            message: { conversation: "halo" }
        });
        expect(r.sender).toBe("628111222333@s.whatsapp.net");
        expect(r.isGroup).toBe(false);
    });
});

describe("modul opsional per-instance tak di-require tanpa gerbang di raf.js", () => {
    const src = fs.readFileSync(path.join(REPO, "message", "raf.js"), "utf8");

    test("dompet pribadi di-require hanya setelah config-nya menyala", () => {
        // Modulnya memang tak terpasang di sebagian instance; require tanpa syarat melempar
        // untuk SETIAP pesan, membanjiri log error dan menyamarkan kesalahan sungguhan.
        const baris = src.split(/\r?\n/);
        baris.forEach((b, i) => {
            if (!b.includes("require('./handlers/personal-finance-wa')")) return;
            const sekitar = baris.slice(Math.max(0, i - 16), i + 1).join("\n");
            expect(`baris ${i + 1}: ${sekitar.includes("enabled === true") ? "terjaga" : "TELANJANG"}`).toContain("terjaga");
        });
    });

    test("pemindainya benar-benar menemukan require itu (anti guard kosong)", () => {
        expect((src.match(/require\('\.\/handlers\/personal-finance-wa'\)/g) || []).length).toBeGreaterThan(0);
    });
});
