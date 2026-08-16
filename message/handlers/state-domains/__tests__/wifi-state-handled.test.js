/**
 * Header Doc
 * Purpose: Mengunci bahwa domain state WiFi melapor "sudah saya tangani", supaya satu pesan
 *          pelanggan tidak diproses dua kali.
 * Caller: Jest test runner.
 * Deps: `message/handlers/state-domains/wifi.state.js`.
 * MainFuncs: —
 * SideEffects: Tidak ada (handler percakapan disuntik palsu).
 *
 * KENAPA ADA — langkah-langkah di `conversation-state-handler` memulangkan hasil `reply()`
 * (Promise Baileys), BUKAN penanda. Dulu nilai itu dipulangkan apa adanya lalu di-spread
 * `conversation-state-router` (`{ owner, ...hasil }`), menghasilkan objek TANPA kunci
 * `handled` → router menyimpulkan pesan belum ditangani → `message/raf.js` memprosesnya
 * SEKALI LAGI. Gejala nyata: pelanggan yang salah ketik nama/sandi WiFi menerima teguran yang
 * sama DUA KALI. Semua domain state lain sudah benar; hanya domain ini yang tertinggal.
 */
"use strict";

const { handleWifiConversationState, managedConversationSteps } = require("../wifi.state");

function buatKonteks(stateStep, handleConversationState) {
    return {
        stateStep,
        stateSender: "628123@s.whatsapp.net",
        chats: "NamaWifiBaru",
        temp: {},
        reply: async () => ({ key: { id: "PALSU" } }),
        global: {},
        isOwner: false,
        isTeknisi: false,
        users: [],
        args: [],
        entities: {},
        plainSenderNumber: "628123",
        pushname: "Budi",
        mess: {},
        sleep: async () => {},
        getSSIDInfo: async () => ({}),
        namabot: "RAF",
        buatLaporanGangguan: async () => {},
        handleConversationState,
    };
}

describe("domain WiFi melapor sudah ditangani", () => {
    const langkah = [...managedConversationSteps][0];

    test("ada langkah yang dikelola domain ini", () => {
        expect(langkah).toBeTruthy();
    });

    test("memulangkan handled:true walau langkahnya memulangkan hasil reply()", async () => {
        // Persis bentuk lama yang bikin bug: nilai balik Baileys, bukan penanda.
        const hasil = await handleWifiConversationState(
            buatKonteks(langkah, async () => ({ key: { id: "ABC" }, status: 1 }))
        );
        expect(hasil).toEqual({ handled: true });
    });

    test("memulangkan handled:true walau langkahnya memulangkan undefined", async () => {
        const hasil = await handleWifiConversationState(buatKonteks(langkah, async () => undefined));
        expect(hasil).toEqual({ handled: true });
    });

    test("langkah dijalankan tepat SEKALI", async () => {
        let n = 0;
        await handleWifiConversationState(buatKonteks(langkah, async () => { n += 1; }));
        expect(n).toBe(1);
    });

    test("langkah di luar domain ini tetap handled:false", async () => {
        const hasil = await handleWifiConversationState(
            buatKonteks("LANGKAH_MILIK_DOMAIN_LAIN", async () => { throw new Error("tak boleh dipanggil"); })
        );
        expect(hasil).toEqual({ handled: false });
    });

    test("tanpa stateStep → handled:false", async () => {
        const hasil = await handleWifiConversationState(buatKonteks(null, async () => {}));
        expect(hasil).toEqual({ handled: false });
    });
});

describe("semua domain state memakai penanda yang sama", () => {
    test("wifi.state.js memulangkan { handled: true }, bukan hasil mentah", () => {
        const fs = require("fs");
        const path = require("path");
        const src = fs.readFileSync(path.join(__dirname, "..", "wifi.state.js"), "utf8");
        expect(src).toMatch(/await handleConversationState\(/);
        expect(src).toMatch(/return \{ handled: true \};/);
        // Bentuk lama yang jadi akar bug tak boleh kembali.
        expect(src).not.toMatch(/return handleConversationState\(/);
    });
});
