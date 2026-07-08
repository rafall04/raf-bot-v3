/**
 * Header Doc
 * Purpose: Uji matcher intent longgar terhadap KALIMAT ASLI korpus chat prod (review 2026-07-02
 *          & 2026-07-07) — memastikan keluhan bahasa bebas terdeteksi dan kalimat netral TIDAK
 *          salah tangkap.
 * Caller: jest.
 * Deps: `../loose-intent-matcher`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 */
"use strict";

const {
    getLooseIntentFromKeywords,
    hasConnectivityComplaintSignal
} = require("../loose-intent-matcher");

describe("getLooseIntentFromKeywords — kalimat korpus prod", () => {
    const cekKoneksiCases = [
        "Jaringannya ko lemot ya kak",
        "ini wifinya kok tidak ada internet knp kak",
        "Wifine tidak ada koneksi kk",
        "Wifine eror",
        "Wifi lemot.. Jaringan putus",
        "Tolong dicek Wifi-nya kk",
        "internetnya putus dari tadi mas",
        "wifi ne error terus",
        "sinyale ilang mas",
        "kok gak bisa konek ke wifi ya",
        // Sebutan APP + gejala tanpa kata "wifi/internet" (korpus: "Digae tik tok kog muter terus")
        "Digae tik tok kog muter terus mas",
        "youtube lemot banget",
        "mobile legend ngelag terus",
        "netflix muter muter gabisa nonton",
        // Kalimat panjang (>8 token) tetap tertangkap — korpus verbatim
        "Tiktok kadang buat buka komentar muter muter 5 menit"
    ];

    test.each(cekKoneksiCases)("CEK_KONEKSI: %s", (kalimat) => {
        const result = getLooseIntentFromKeywords(kalimat);
        expect(result).not.toBeNull();
        expect(result.intent).toBe("CEK_KONEKSI");
        expect(result.loose).toBe(true);
    });

    const gantiSandiCases = [
        "MET malam pak mai ganti knta sandi",
        "Kata sandi ganti misnadin916",
        "ganti kata sandi kayla000",
        // "ganti" menang atas "lupa" — user ini mau MENGUBAH sandi (kasus liyaa di korpus)
        "mas saya mau ganti sandi caranya gimana lupa e",
        // prioritas niat sandi di atas keluhan koneksi (kasus Dani di korpus)
        "Lemot pak ganti sandi aja",
        "minta password baru dong kak"
    ];

    test.each(gantiSandiCases)("GANTI_SANDI_WIFI: %s", (kalimat) => {
        const result = getLooseIntentFromKeywords(kalimat);
        expect(result).not.toBeNull();
        expect(result.intent).toBe("GANTI_SANDI_WIFI");
    });

    const historyCases = [
        "lupa sandi wifi e mas",
        "password wifi saya lupa kak"
    ];

    test.each(historyCases)("HISTORY_WIFI (lupa sandi): %s", (kalimat) => {
        const result = getLooseIntentFromKeywords(kalimat);
        expect(result).not.toBeNull();
        expect(result.intent).toBe("HISTORY_WIFI");
    });

    const netralCases = [
        "Buat liat video FB sama YouTube kak",
        "Main mobile legends",
        "iya mas",
        "Ok mas",
        "raff net buka cabang disekitar Bojonegoro gak",
        "Besok pagi saja ya mas",
        "Sudah lumayan kk",
        "Udah stabil lagi kak",
        "Tim itaitubobal"
    ];

    test.each(netralCases)("TIDAK match (netral): %s", (kalimat) => {
        expect(getLooseIntentFromKeywords(kalimat)).toBeNull();
    });

    test("input kosong / non-string aman", () => {
        expect(getLooseIntentFromKeywords("")).toBeNull();
        expect(getLooseIntentFromKeywords(null)).toBeNull();
        expect(getLooseIntentFromKeywords(undefined)).toBeNull();
    });

    test("kalimat sangat panjang (forward/broadcast) tidak ditebak", () => {
        const panjang = Array(40).fill("internet lemot").join(" ");
        expect(getLooseIntentFromKeywords(panjang)).toBeNull();
    });
});

describe("hasConnectivityComplaintSignal — gejala tanpa kata konteks", () => {
    test.each([
        "Ga bisa ini",
        "Lemot banget",
        "putus putus terus dari siang",
        "eror kak"
    ])("true: %s", (kalimat) => {
        expect(hasConnectivityComplaintSignal(kalimat)).toBe(true);
    });

    test.each([
        "oke makasih kak",
        "besok pagi saja ya mas",
        "berapa tagihan bulan ini"
    ])("false: %s", (kalimat) => {
        expect(hasConnectivityComplaintSignal(kalimat)).toBe(false);
    });
});
