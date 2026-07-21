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

const { isAffirmative, isCleanConsent, isCleanRebootConsent, isDecline, isResolvedAnswer, isUnresolvedAnswer, saysAlreadyRestarted } = require("../affirmative-parser");

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

// `CONSENT_BLOCKERS` disusun dari sudut pandang reboot, sehingga memuat kata domain lain
// ("sandi", "saldo", "transfer"). Di alur yang justru MEMBAHAS kata itu, kata tersebut on-topic:
// tanpa `onTopic`, konfirmasi sah seperti "ok transfer aja" akan tertolak.
describe("isCleanConsent — konsen ketat yang sadar konteks alur", () => {
    const TRANSFER = { onTopic: ["transfer", "tf", "saldo"] };

    test.each(["ya", "iya", "ok", "Ok mas", "ya ka", "siap", "boleh", "nggih", "monggo", "sip", "baik"])(
        "afirmasi nyata pelanggan diterima: %s",
        (text) => expect(isCleanConsent(text, TRANSFER)).toBe(true)
    );

    test.each(["ok transfer aja", "ya lanjut transfer"])(
        "kata on-topic tidak dianggap muatan lain: %s",
        (text) => expect(isCleanConsent(text, TRANSFER)).toBe(true)
    );

    // Justru inilah alasan alur uang tidak boleh memakai `isAffirmative` yang longgar.
    test.each(["ya tapi tagihanku berapa?", "bisa cek tagihan?", "siap kak makasih", "ya tapi kok mahal"])(
        "afirmasi yang menumpang kalimat lain ditolak: %s",
        (text) => expect(isCleanConsent(text, TRANSFER)).toBe(false)
    );

    test.each(["batal", "ga jadi", "nanti", "jangan"])(
        "penolakan tak pernah jadi konsen: %s",
        (text) => expect(isCleanConsent(text, TRANSFER)).toBe(false)
    );

    test("tanpa onTopic, perilakunya identik dengan konsen reboot", () => {
        ["ya", "ok mas", "siap", "bisa cek tagihan?", "mau lapor", "ya tapi kok mahal"].forEach((text) => {
            expect(isCleanConsent(text)).toBe(isCleanRebootConsent(text));
        });
    });

    test("kata on-topic satu alur tetap jadi blocker di alur lain", () => {
        // "sandi" on-topic saat konfirmasi ganti sandi, tapi tetap muatan lain saat konfirmasi transfer.
        expect(isCleanConsent("ya sandi barunya oke", { onTopic: ["sandi", "wifi"] })).toBe(true);
        expect(isCleanConsent("ya sandi barunya oke", TRANSFER)).toBe(false);
    });
});
