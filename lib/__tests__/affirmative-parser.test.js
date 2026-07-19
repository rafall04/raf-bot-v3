/**
 * Header Doc
 * Purpose: Mengunci penafsiran balasan pendek pelanggan. Kasus uji diambil VERBATIM dari korpus
 *          chat produksi (Dander & Tanjungharjo) supaya perbaikan matcher tak pernah mundur lagi.
 * Caller: jest.
 * Deps: `lib/affirmative-parser`.
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */
"use strict";

const { isAffirmative, isCleanRebootConsent, isDecline, isResolvedAnswer, isUnresolvedAnswer, saysAlreadyRestarted } = require("../affirmative-parser");

describe("isAffirmative — balasan setuju nyata (dulu ditolak exact-match)", () => {
    test.each(["Ok mas", "ya ka", "Iya kk", "Siap", "Bisa mas", "Oke mas", "boleh kak", "monggo", "Ya", "Ok", "gas"])(
        "%s = setuju",
        (text) => expect(isAffirmative(text)).toBe(true)
    );

    test.each(["ga usah", "nanti saja mas", "gausah kak", "jangan dulu"])("%s bukan setuju", (text) =>
        expect(isAffirmative(text)).toBe(false)
    );
});

describe("isDecline", () => {
    test.each(["nanti saja mas", "gausah kak", "besok aja"])("%s = menolak", (text) => expect(isDecline(text)).toBe(true));
    test.each(["ya boleh", "siap mas"])("%s bukan menolak", (text) => expect(isDecline(text)).toBe(false));
});

describe("jawaban atas 'sudah lancar?'", () => {
    test.each(["Sudah stabil kk", "Udah stabil lagi kak", "Sudah bisa", "Sudah lumayan kk", "alhamdulillah lancar"])(
        "%s = beres",
        (text) => {
            expect(isUnresolvedAnswer(text)).toBe(false);
            expect(isResolvedAnswer(text)).toBe(true);
        }
    );

    test.each([
        "Sudah tp masih lemot apa di ganti kata sandi saja",
        "Sudah berkali kali mas masih tetap sama",
        "masih lemot kk",
        "belum bisa mas",
        "tetep muter mas",
        "podo wae mas",
        "sama saja kak",
        "ora iso mas"
    ])("%s = masih bermasalah", (text) => {
        expect(isUnresolvedAnswer(text)).toBe(true);
        expect(isResolvedAnswer(text)).toBe(false);
    });
});

describe("dialek: 'tak' berarti SAYA, bukan negasi", () => {
    // Regresi dari korpus: memperlakukan "tak" sebagai "tidak" membalik arti kalimat.
    test("'Sudah tak bayar ya kak sama punya ibu ku' bukan keluhan", () => {
        expect(isUnresolvedAnswer("Sudah tak bayar ya kak sama punya ibu ku")).toBe(false);
        expect(isResolvedAnswer("Sudah tak bayar ya kak sama punya ibu ku")).toBe(true);
    });

    test("'Sudah tak coba semua hp' bukan keluhan", () => {
        expect(isUnresolvedAnswer("Sudah tak coba semua hp")).toBe(false);
    });
});

describe("saysAlreadyRestarted", () => {
    test.each(["Ini baru dicoba cabut", "sudah tak cabut mas", "Sudah berkali kali mas masih tetap sama", "udah direstart tadi"])(
        "%s = sudah restart sendiri",
        (text) => expect(saysAlreadyRestarted(text)).toBe(true)
    );

    test.each(["wifi lemot kak", "Ok mas"])("%s bukan pernyataan sudah restart", (text) =>
        expect(saysAlreadyRestarted(text)).toBe(false)
    );
});

describe("isCleanRebootConsent — HANYA konsen bersih yang boleh mereboot", () => {
    // Persetujuan sungguhan tetap lolos (jangan bikin reboot yang diminta jadi gagal).
    test.each(["ya", "iya", "ok", "oke", "boleh", "iya boleh", "ya mas", "ok lanjut", "siap", "monggo", "ya reboot aja", "tolong nyalakan ulang"])(
        "konsen bersih: %s = true",
        (text) => expect(isCleanRebootConsent(text)).toBe(true)
    );

    // AKAR insiden "ketik siap malah reboot": pesan yang kebetulan mengandung token afirmatif tapi
    // sebenarnya permintaan/ucapan lain TIDAK boleh memicu reboot. (isAffirmative lama meloloskannya.)
    test.each([
        "bisa cek tagihan?",   // pertanyaan lain
        "siap kak makasih",    // ucapan penutup ke admin
        "boleh minta info paket",
        "mau lapor",
        "ya tapi kok mahal",
        "bisa reboot ga?"      // pertanyaan, bukan konsen
    ])("BUKAN konsen bersih: %s = false", (text) => expect(isCleanRebootConsent(text)).toBe(false));

    test("penolakan tak pernah jadi konsen", () => {
        ["ga usah", "nanti aja", "jangan", "batal"].forEach((t) => expect(isCleanRebootConsent(t)).toBe(false));
    });
});
