/**
 * Header Doc
 * Purpose: Membuktikan perintah teknisi `verifikasi [ID] [OTP]` — yang diajarkan template
 *          panduan TERSIMPAN — benar-benar melahirkan intent, punya handler, dan argumennya
 *          terurai benar.
 * Caller: Jest test runner.
 * Deps: `lib/wifi_template_handler`, `../index`, `../ticket-teknisi-intents`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA: `VERIFIKASI_OTP` punya handler tapi NOL kata kunci, sedangkan intent hanya lahir
 * dari kata kunci. Teknisi mengikuti langkah 5 di `dispatch_tutorial_teknisi` ("verifikasi
 * [ID] [OTP]") dan bot DIAM TOTAL — tiket tersangkut di status `arrived` selamanya lewat
 * WhatsApp, satu-satunya jalan keluar adalah panel web.
 */
"use strict";

const { getIntentFromKeywords } = require("../../../../lib/wifi_template_handler");
const { getIntentDispatchMap } = require("../index");
const { handleVerifikasiOtpIntent } = require("../ticket-teknisi-intents");

describe("perintah verifikasi teknisi bisa dijangkau", () => {
    test.each([
        "verifikasi 6A8ZJTL 998877",
        "Verifikasi 6A8ZJTL 998877",
        "verif 6A8ZJTL 998877",
    ])("%p melahirkan intent VERIFIKASI_OTP", (pesan) => {
        const hasil = getIntentFromKeywords(pesan);

        expect(hasil).toBeTruthy();
        expect(hasil.intent).toBe("VERIFIKASI_OTP");
    });

    test("intent-nya punya handler di peta dispatch", () => {
        expect(typeof getIntentDispatchMap().VERIFIKASI_OTP).toBe("function");
    });
});

describe("argumen terurai benar dari matchedKeywordLength", () => {
    // Handler mengambil args[matchedKeywordLength] dan args[+1]. Kata kunci WAJIB satu kata,
    // kalau tidak ID tiket dan OTP bergeser.
    test("kata kunci verifikasi/verif hanya satu kata", () => {
        for (const pesan of ["verifikasi 6A8ZJTL 998877", "verif 6A8ZJTL 998877"]) {
            expect(getIntentFromKeywords(pesan).matchedKeywordLength).toBe(1);
        }
    });

    test("ID tiket dan OTP sampai utuh ke handleVerifikasiOTP", async () => {
        const chats = "verifikasi 6A8ZJTL 998877";
        const terkirim = [];

        await handleVerifikasiOtpIntent({
            isTeknisi: true,
            isOwner: false,
            reply: () => {},
            mess: { teknisiOrOwnerOnly: "khusus teknisi" },
            chats,
            matchedKeywordLength: getIntentFromKeywords(chats).matchedKeywordLength,
            format: (k) => k,
            sender: "628123@s.whatsapp.net",
            stateSender: "628123@s.whatsapp.net",
            handleVerifikasiOTP: async (sender, ticketId, otp) => {
                terkirim.push({ sender, ticketId, otp });
                return { message: "ok" };
            },
        });

        expect(terkirim).toHaveLength(1);
        expect(terkirim[0].ticketId).toBe("6A8ZJTL");
        expect(terkirim[0].otp).toBe("998877");
    });

    test("format salah dibalas panduan format, bukan diam", async () => {
        const dibalas = [];

        await handleVerifikasiOtpIntent({
            isTeknisi: true,
            isOwner: false,
            reply: (t) => dibalas.push(t),
            mess: { teknisiOrOwnerOnly: "khusus teknisi" },
            chats: "verifikasi",
            matchedKeywordLength: 1,
            format: (k) => k,
            sender: "628123@s.whatsapp.net",
            stateSender: "628123@s.whatsapp.net",
            handleVerifikasiOTP: async () => ({ message: "tak boleh sampai sini" }),
        });

        expect(dibalas).toEqual(["error_format_verifikasi"]);
    });

    test("bukan teknisi/owner ditolak", async () => {
        const dibalas = [];

        await handleVerifikasiOtpIntent({
            isTeknisi: false,
            isOwner: false,
            reply: (t) => dibalas.push(t),
            mess: { teknisiOrOwnerOnly: "khusus teknisi" },
            chats: "verifikasi 6A8ZJTL 998877",
            matchedKeywordLength: 1,
            format: (k) => k,
            handleVerifikasiOTP: async () => {
                throw new Error("handler tak boleh dipanggil untuk non-teknisi");
            },
        });

        expect(dibalas).toEqual(["khusus teknisi"]);
    });
});
