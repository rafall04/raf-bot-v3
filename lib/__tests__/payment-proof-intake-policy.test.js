/**
 * Header Doc
 * Purpose: Mengunci gerbang intake bukti pembayaran terhadap KORPUS PROD NYATA (13 record
 *          `database/payment_proofs.json` di RAF-DANDER per 14-07-2026), bukan terhadap intuisi.
 *          11 record = bukti bayar ASLI yang sudah dikonfirmasi admin → WAJIB tetap tertangkap
 *          (false-negative di jalur uang lebih mahal daripada friksi). 2 record = SALAH-TANGKAP nyata
 *          (SS WiFi & foto koordinasi CCTV) → WAJIB ditolak.
 *
 *          Test paling penting di file ini: "insiden 14-07 direproduksi persis" — kondisi apa adanya
 *          saat itu (jejak admin HILANG karena bot baru restart 19 detik sebelumnya) tetap harus
 *          menolak foto itu, karena gerbang UANG berdiri sendiri tanpa bergantung pada jejak admin.
 * Caller: jest.
 * Deps: `../payment-proof-intake-policy`.
 * MainFuncs: —
 * SideEffects: Tidak ada (fungsi murni).
 */
"use strict";

const {
    ACTION,
    classifyIncomingPhoto,
    hasPaymentSignal,
    hasComplaintSignal
} = require("../payment-proof-intake-policy");

/** Pintasan: pelanggan normal, bot sadar penuh, tanpa sinyal-lawan. */
function classify(over = {}) {
    return classifyIncomingPhoto({
        adminActive: false,
        signalReady: true,
        billing: { outstanding: 125000 },
        userStatus: "aktif",
        caption: "",
        recentComplaint: false,
        ...over
    });
}

// ── Korpus prod: 11 bukti ASLI (semua sudah dikonfirmasi admin "Rapp") ──
// Diambil apa adanya dari payment_proofs.json prod: outstandingAtSubmit + caption.
const BUKTI_ASLI = [
    { id: "BP-260710-NDSE", nama: "Luluk Asfinatul Hikmah", outstanding: 165000, caption: "" },
    { id: "BP-260711-2J9P", nama: "TNI AD Pemandian", outstanding: 220000, caption: "" },
    { id: "BP-260711-AE3B", nama: "Elsa Ameyda Wifi", outstanding: 110000, caption: "" },
    { id: "BP-260711-NBCJ", nama: "Friska Anas Amelia", outstanding: 125000, caption: "" },
    { id: "BP-260711-3V2B", nama: "Lapak RT 15", outstanding: 125000, caption: "" },
    { id: "BP-260711-5BWW", nama: "Damari", outstanding: 125000, caption: "" },
    { id: "BP-260712-YV79", nama: "Johan", outstanding: 165000, caption: "Saya telah berhasil mengirimkan Rp165.000 ke rekening kamu melalui SeaBank." },
    { id: "BP-260713-DYE8", nama: "Wahyu Rizki Cahyono", outstanding: 220000, caption: "" },
    { id: "BP-260714-4Z2A", nama: "Putri", outstanding: 150000, caption: "" },
    { id: "BP-260714-7E4M", nama: "Mbak Sri", outstanding: 150000, caption: "" },
    { id: "BP-260714-7Z8D", nama: "Supriyono", outstanding: 125000, caption: "Paket125k" }
];

describe("payment-proof-intake-policy — korpus prod: 11 bukti ASLI tetap tertangkap", () => {
    test.each(BUKTI_ASLI)("$id ($nama) → capture", ({ outstanding, caption }) => {
        const res = classify({ billing: { outstanding }, caption });
        expect(res.action).toBe(ACTION.CAPTURE);
        expect(res.advance).toBe(false);
    });

    test("nol false-negative: SEMUA 11 bukti asli lolos gerbang", () => {
        const tertangkap = BUKTI_ASLI.filter(
            (b) => classify({ billing: { outstanding: b.outstanding }, caption: b.caption }).action === ACTION.CAPTURE
        );
        expect(tertangkap).toHaveLength(BUKTI_ASLI.length);
    });
});

describe("payment-proof-intake-policy — korpus prod: 2 SALAH-TANGKAP nyata ditolak", () => {
    // BP-260714-XCTW — Lapak RT 15, 14-07 22:02:21 WIB. Pelanggan sedang koordinasi posisi CCTV
    // dengan admin. Sudah bayar 11-07 → outstanding 0. Bot baru restart 22:02:02 (19 DETIK sebelumnya)
    // sehingga jejak admin di RAM HILANG → gerbang admin-aktif buta.
    test("insiden 14-07 (CCTV, Lapak RT 15) DIREPRODUKSI PERSIS — jejak admin hilang, tetap ditolak", () => {
        const res = classifyIncomingPhoto({
            adminActive: false, // ← justru inilah bug-nya: bot LUPA admin sedang menangani chat
            signalReady: true,
            billing: { outstanding: 0 },
            userStatus: "aktif",
            caption: "",
            recentComplaint: false
        });

        // Gerbang UANG berdiri SENDIRI: tanpa tagihan, tak ada dasar menyebut "pembayaran" —
        // bahkan saat sinyal admin sedang amnesia.
        expect(res.action).toBe(ACTION.NEUTRAL);
        expect(res.reason).toBe("tak-ada-tagihan");
    });

    test("insiden 14-07 dengan jejak admin DURABEL → bahkan tak bersuara sama sekali", () => {
        const res = classify({ adminActive: true, billing: { outstanding: 0 } });
        expect(res.action).toBe(ACTION.SILENT);
    });

    // BP-260713-KTXN — Moch Nur Wahyudi. Admin minta "SS sinyal WiFi", pelanggan kirim screenshot.
    // Pelanggan ini PUNYA tagihan (125rb) → gerbang uang TIDAK menolongnya. Hanya jejak admin durabel
    // yang bisa. Test ini sengaja mendokumentasikan BATAS masing-masing gerbang.
    test("kasus SS WiFi (punya tagihan) → hanya tertolong jejak admin DURABEL", () => {
        expect(classify({ adminActive: true, billing: { outstanding: 125000 } }).action).toBe(ACTION.SILENT);

        // Tanpa jejak admin (mis. bot baru restart), foto ini MEMANG masih tertangkap. Ini batas yang
        // diketahui — dan alasan kenapa jejak admin WAJIB durabel, bukan Map in-memory.
        expect(classify({ adminActive: false, billing: { outstanding: 125000 } }).action).toBe(ACTION.CAPTURE);
    });
});

describe("payment-proof-intake-policy — bot BUTA tidak boleh mengklaim (fail-closed)", () => {
    test("jejak chat belum pulih dari disk → JANGAN pernah capture", () => {
        const res = classify({ signalReady: false });
        expect(res.action).toBe(ACTION.NEUTRAL);
        expect(res.reason).toBe("sinyal-belum-siap");
    });

    test("snapshot tagihan GAGAL dibaca (null) ≠ tagihan nol → neutral, bukan capture", () => {
        expect(classify({ billing: { outstanding: null } }).reason).toBe("tagihan-tak-diketahui");
        expect(classify({ billing: {} }).action).toBe(ACTION.NEUTRAL);
        expect(classify({ billing: { outstanding: undefined } }).action).toBe(ACTION.NEUTRAL);
    });

    test("admin sedang menangani chat menang atas segalanya", () => {
        const res = classify({ adminActive: true, signalReady: false, billing: { outstanding: 999999 } });
        expect(res.action).toBe(ACTION.SILENT);
    });
});

describe("payment-proof-intake-policy — sinyal keluhan", () => {
    test('caption keluhan ("lemot") + punya tagihan → foto KENDALA, bukan bukti bayar', () => {
        const res = classify({ caption: "wifi lemot banget mas" });
        expect(res.action).toBe(ACTION.COMPLAINT);
        expect(res.reason).toBe("caption-keluhan");
    });

    test("caption keluhan + caption bayar + punya tagihan → capture (pelanggan sendiri yang menyebut bayar)", () => {
        const res = classify({ caption: "sudah tf ya tapi masih lemot" });
        expect(res.action).toBe(ACTION.CAPTURE);
    });

    test('"sudah bayar kok mati" TANPA tagihan → tetap keluhan (jangan bingkai bayar)', () => {
        const res = classify({ caption: "sudah bayar kok mati", billing: { outstanding: 0 } });
        expect(res.action).toBe(ACTION.COMPLAINT);
    });

    test("baru mengeluh koneksi → foto susulan = bukti kendala", () => {
        const res = classify({ recentComplaint: true });
        expect(res.action).toBe(ACTION.COMPLAINT);
        expect(res.reason).toBe("keluhan-baru");
    });

    test("PENGECUALIAN ISOLIR: pelanggan terisolir yang mengeluh 'mati' lalu kirim foto → JANGAN ditahan", () => {
        // Buat pelanggan terisolir, "internet mati" ITU akibat menunggak — foto susulan sangat mungkin
        // bukti transfer. Menahannya di sini = menelan bukti bayar asli (false-negative jalur uang).
        const res = classify({ recentComplaint: true, userStatus: "isolir", billing: { outstanding: 0 } });
        expect(res.action).toBe(ACTION.CAPTURE);
    });

    test("PENGECUALIAN ISOLIR (caption): isolir + caption 'internet mati' tanpa kata bayar → CAPTURE, jangan ditelan (#b152)", () => {
        // Sama seperti sinyal durabel di atas: buat pelanggan terisolir, "mati" di caption pun akibat
        // menunggak — foto susulan sangat mungkin bukti transfer. Dulu cabang caption menahannya jadi
        // COMPLAINT (menelan bukti bayar asli); kini pengecualian isolir berlaku di KEDUA cabang.
        const res = classify({ userStatus: "isolir", billing: { outstanding: 0 }, caption: "internet mati" });
        expect(res.action).toBe(ACTION.CAPTURE);
    });
});

describe("payment-proof-intake-policy — gerbang uang", () => {
    test("tak ada tagihan + caption polos → ack netral, TANPA bingkai bayar & tanpa record", () => {
        const res = classify({ billing: { outstanding: 0 } });
        expect(res.action).toBe(ACTION.NEUTRAL);
    });

    test("tak ada tagihan TAPI caption menyebut transfer → capture, ditandai bayar di muka", () => {
        const res = classify({ billing: { outstanding: 0 }, caption: "ini bukti transfer buat bulan depan" });
        expect(res.action).toBe(ACTION.CAPTURE);
        expect(res.advance).toBe(true);
    });

    test("isolir dianggap punya tagihan walau ledger periode berjalan 0", () => {
        const res = classify({ billing: { outstanding: 0 }, userStatus: "isolir" });
        expect(res.action).toBe(ACTION.CAPTURE);
    });
});

describe("payment-proof-intake-policy — pencocokan kata", () => {
    test("cocok sebagai KATA UTUH, bukan substring", () => {
        expect(hasPaymentSignal("sudah tf ya")).toBe(true);
        expect(hasPaymentSignal("otf sudah")).toBe(false);   // "tf" di dalam "otf" tidak boleh cocok
        expect(hasComplaintSignal("wifi off")).toBe(true);
        expect(hasComplaintSignal("di office")).toBe(false); // "off" di dalam "office" tidak boleh cocok
    });

    test("tanda baca & huruf besar tidak mengganggu", () => {
        expect(hasPaymentSignal("Sudah TRANSFER, ya!")).toBe(true);
        expect(hasComplaintSignal("CCTV-nya mati.")).toBe(true);
    });

    test("caption kosong bukan sinyal apa pun (mayoritas bukti asli captionnya kosong)", () => {
        expect(hasPaymentSignal("")).toBe(false);
        expect(hasComplaintSignal("")).toBe(false);
        expect(hasPaymentSignal(null)).toBe(false);
    });
});
