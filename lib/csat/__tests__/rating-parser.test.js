/**
 * Header Doc
 * Purpose: Uji parser balasan survei rating (lib/csat/rating-parser) terhadap gaya bahasa
 *   pelanggan NYATA ([[customer-chat-corpus]]): angka kotor ("4 mas"), sentimen, emoji, kata-angka,
 *   dialek Jawa, dan yang PALING penting — `unclear` untuk pesan yang jelas bukan jawaban survei
 *   (biar bot tak membajak keluhan/perintah sungguhan).
 * Caller: Jest.
 * Deps: ../rating-parser.
 * MainFuncs: -
 * SideEffects: -
 */
"use strict";

const { parseRatingReply, isSkipWord, isCancelWord, isBareAck } = require("../rating-parser");

describe("parseRatingReply — angka", () => {
    test.each([
        ["4", 4],
        ["5", 5],
        ["1", 1],
        ["4 mas", 4],
        ["kasih 5 bintang", 5],
        ["nilai 3", 3],
        ["5/5", 5],
        ["   2   ", 2],
    ])("'%s' -> skor %i", (input, score) => {
        const r = parseRatingReply(input);
        expect(r.kind).toBe("rating");
        expect(r.score).toBe(score);
    });

    test("angka di luar 1-5 tidak dianggap skor mentah (10 -> unclear)", () => {
        expect(parseRatingReply("10").kind).toBe("unclear");
    });

    test("angka satuan waktu/uang tidak salah jadi skor", () => {
        expect(parseRatingReply("jam 5 mati terus").score).not.toBe(5);
        expect(parseRatingReply("5 menit muter").score).toBe(2); // 'muter' = buffering (neg), bukan skor 5
        expect(parseRatingReply("abis 5rb").kind).toBe("unclear");
    });
});

describe("parseRatingReply — kata & dialek", () => {
    test.each([
        ["sangat puas", 5],
        ["mantap jiwa", 5],
        ["mantap", 4],
        ["bagus kok", 4],
        ["lancar", 4],
        ["aman", 4],
        ["gak ada masalah", 4], // penting: JANGAN dianggap negatif
        ["biasa aja", 3],
        ["lumayan", 3],
        ["lemot terus", 2],
        ["medhot terus mas", 2],
        ["kurang puas", 2],
        ["tidak puas", 2], // negasi positif
        ["parah banget", 1],
        ["lima", 5],
        ["papat", 4],
    ])("'%s' -> skor %i", (input, score) => {
        const r = parseRatingReply(input);
        expect(r.kind).toBe("rating");
        expect(r.score).toBe(score);
    });

    test("sentimen mengisi field sentiment", () => {
        expect(parseRatingReply("bagus").sentiment).toBe("pos");
        expect(parseRatingReply("lemot").sentiment).toBe("neg");
        expect(parseRatingReply("biasa").sentiment).toBe("neutral");
    });
});

describe("parseRatingReply — emoji", () => {
    test("emoji positif -> skor tinggi", () => {
        expect(parseRatingReply("👍").score).toBeGreaterThanOrEqual(4);
        expect(parseRatingReply("😍😍").score).toBe(5);
    });
    test("emoji negatif -> skor rendah", () => {
        expect(parseRatingReply("😡").score).toBeLessThanOrEqual(2);
        expect(parseRatingReply("😞😞").score).toBe(1);
    });
});

describe("parseRatingReply — optout", () => {
    test.each(["stop", "STOP", "jangan survei lagi", "gausah survei", "unsubscribe"])(
        "'%s' -> optout", (input) => { expect(parseRatingReply(input).kind).toBe("optout"); }
    );
    test("'berhenti berlangganan' BUKAN optout survei (itu churn) -> unclear", () => {
        expect(parseRatingReply("berhenti berlangganan").kind).toBe("unclear");
    });
});

describe("parseRatingReply — unclear (jangan membajak)", () => {
    test.each(["cek koneksi", "menu", "makasih", "assalamualaikum", "ganti sandi wifi", "bayar dimana", "halo"])(
        "'%s' -> unclear", (input) => { expect(parseRatingReply(input).kind).toBe("unclear"); }
    );
    test("teks kosong -> unclear", () => {
        expect(parseRatingReply("").kind).toBe("unclear");
        expect(parseRatingReply(null).kind).toBe("unclear");
    });
});

describe("isSkipWord / isCancelWord", () => {
    test("skip words (tahap komentar)", () => {
        ["-", "skip", "lewati", "gausah", "udahan"].forEach((w) => expect(isSkipWord(w)).toBe(true));
    });
    test("'gak ada masalah' BUKAN skip (itu feedback berharga)", () => {
        expect(isSkipWord("gak ada masalah")).toBe(false);
    });
    test("cancel words", () => {
        ["batal", "cancel", "menu"].forEach((w) => expect(isCancelWord(w)).toBe(true));
        expect(isCancelWord("bagus banget")).toBe(false);
    });
});

describe("isBareAck (afirmasi non-rating saat survei aktif)", () => {
    test("ack singkat -> true", () => {
        ["siap", "iya", "ya", "yoi", "makasih", "nggih", "matur nuwun", "siap mas", "ok siap", "lanjut", "noted"]
            .forEach((w) => expect(isBareAck(w)).toBe(true));
    });
    test("perintah/pertanyaan/rating sungguhan -> false (biar tetap mengalir ke pipeline)", () => {
        ["Info mas", "cek koneksi", "bayar dimana", "menu", "tolong dicek", "4", "5", "lemot", "ganti sandi", "kok mahal"]
            .forEach((w) => expect(isBareAck(w)).toBe(false));
    });
});
