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
        "Tiktok kadang buat buka komentar muter muter 5 menit",
        // Tanya-bermasalah + konteks jaringan (korpus: "Wifi-nya kenapa lagi ini mas" yg dulu diam)
        "Wifi-nya kenapa lagi ini mas",
        "internet kok gini ya",
        "jaringane piye iki",
        "wifi ku napa ini",
        // Gejala dialek Jawa/informal
        "wifine medhot terus",
        "internet e mandek",
        "jaringan alon banget",
        "wifi ku ora mlebu",
        "internet ping tinggi terus"
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
        "Tim itaitubobal",
        // Pertanyaan tagihan/info dgn kata konteks TAPI bukan keluhan — jangan salah tangkap
        // (korpus: "WiFi bulan Juli ya kak", "Ini sudah bayar ya")
        "WiFi bulan Juli ya kak",
        "wifi berapa bulan ini kak"
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

describe("laporan 'sudah restart sendiri' → CEK_KONEKSI (bot tak boleh diam)", () => {
    // Kasus nyata prod (Tanjungharjo, 2026-07-10, 6281244872662): pelanggan mencabut modemnya
    // sendiri, memberi tahu bot, dan intent-nya `undefined` → bot DIAM. Padahal justru dia yang
    // paling perlu dikabari hasilnya. Kalimat ini tak punya kata konteks jaringan sama sekali.
    test.each([
        "Ini baru dicoba cabut",
        "sudah tak cabut mas",
        "Sudah berkali kali mas masih tetap sama",
        "udah direstart tadi"
    ])("dikenali: %s", (kalimat) => {
        const hit = getLooseIntentFromKeywords(kalimat);
        expect(hit).not.toBeNull();
        expect(hit.intent).toBe("CEK_KONEKSI");
    });

    test.each([
        "mau berhenti berlangganan",
        "Sudah tak bayar ya kak sama punya ibu ku",
        "Ok mas"
    ])("tidak salah tangkap: %s", (kalimat) => {
        const hit = getLooseIntentFromKeywords(kalimat);
        expect(hit === null || hit.intent !== "CEK_KONEKSI").toBe(true);
    });
});

// Regresi #b16x: kosakata koneksi yang DULU luput jadi undefined (dari korpus prod 2026-07).
describe("kosakata baru: keluhan koneksi yang dulu luput", () => {
    test.each([
        "wifi ku muser",
        "wifi kog eroran mas",
        "internet belum ada",
        "internet nya belum ada",
        "wifi ku muser lampune merah",
        "wifine eror",
        "sinyale lemah",
        "gak bisa connect"
    ])("kini dikenali CEK_KONEKSI: %s", (kalimat) => {
        const hit = getLooseIntentFromKeywords(kalimat);
        expect(hit).not.toBeNull();
        expect(hit.intent).toBe("CEK_KONEKSI");
    });

    // Gejala tanpa kata konteks → ditangkap sinyal keluhan (dipakai fallback anti-diam).
    test.each(["loading terus", "lemot banget", "muser terus", "eroran mulu"])(
        "sinyal keluhan (fallback): %s",
        (kalimat) => expect(hasConnectivityComplaintSignal(kalimat)).toBe(true)
    );

    // Tetap AMAN: kalimat non-koneksi yang kebetulan mirip TIDAK ikut tertangkap.
    test.each(["uang belum ada", "badan lemah banget", "makasih abang"])(
        "tidak salah tangkap sinyal: %s",
        (kalimat) => expect(hasConnectivityComplaintSignal(kalimat)).toBe(false)
    );
});
