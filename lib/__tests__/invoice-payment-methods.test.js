/**
 * Header Doc
 * Purpose: Mengunci bahwa setelan "Metode Pembayaran yang Ditampilkan" BENAR-BENAR
 *          mengendalikan apa yang tercetak, dan bahwa nomor rekening yang sampai ke
 *          pelanggan berasal dari data nyata — bukan teks contekan atau karangan.
 * Caller: Jest test runner.
 * Deps: `lib/invoice-payment-methods.js`, `lib/pdf-invoice-generator.js` (render murni).
 * MainFuncs: —
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA: tes lama (invoice-customization.test.js) hanya menguji SATU sumbu —
 * `all` menambah "Pembayaran Online", `cash_transfer` tidak. Ia tak pernah memeriksa
 * apakah Tunai/Transfer merespons setelan, sehingga tetap HIJAU sementara kata "Tunai"
 * ditulis literal dan "Transfer Bank" muncul di KEDUA cabang ternary. Terukur di
 * produksi dengan merender invoice sungguhan INV-20260815-0001: memilih "tunai saja"
 * tetap mencetak Transfer Bank, memilih "transfer saja" tetap mencetak Tunai.
 *
 * Karena itu tes di sini menembak sumbu yang dulu dilewati, dan menembak HASIL RENDER,
 * bukan teks sumber.
 */
"use strict";

const {
    resolveMetodeDitampilkan,
    resolveDaftarRekening,
} = require("../invoice-payment-methods");
const { generateInvoiceHTML } = require("../pdf-invoice-generator");

function buatInvoice(timpaan = {}) {
    return {
        invoiceNumber: "INV-UJI-0001",
        issueDate: "2026-08-01T00:00:00.000Z",
        dueDate: "2026-08-10T00:00:00.000Z",
        customer: { id: 75, name: "Pelanggan Uji", phone: "628123", address: "Alamat" },
        service: { name: "PAKET-220K", period: "Bulanan", description: "Internet", speed: "20Mbps" },
        billing: { subtotal: 220000, tax: 0, total: 220000, enableTax: false, taxRate: 11 },
        payment: { status: "PAID", paidDate: "2026-08-02T00:00:00.000Z", method: "Tunai", approvedBy: "raf" },
        company: { name: "RAF NET", npwp: "" },
        bankAccount: { bankName: "BRI", accountNumber: "6185010", accountName: "RAF NET" },
        notes: "",
        ...timpaan,
    };
}

// Mengambil HANYA blok metode pembayaran, supaya assertion tak keliru menangkap
// kata "Tunai" dari baris "Metode: Tunai" di blok Informasi Pembayaran di atasnya.
function blokMetode(html) {
    const i = html.indexOf("Metode Pembayaran yang Diterima");
    if (i < 0) return "";
    const potong = html.slice(i, i + 900);
    const akhir = potong.indexOf("</div>");
    return akhir > 0 ? potong.slice(0, akhir) : potong;
}

describe("resolveMetodeDitampilkan menerjemahkan setelan jadi sakelar", () => {
    test.each([
        ["cash", { tunai: true, transfer: false, online: false }],
        ["transfer", { tunai: false, transfer: true, online: false }],
        ["cash_transfer", { tunai: true, transfer: true, online: false }],
        ["online", { tunai: false, transfer: false, online: true }],
        ["all", { tunai: true, transfer: true, online: true }],
    ])("%s", (nilai, harap) => {
        expect(resolveMetodeDitampilkan(nilai)).toEqual(harap);
    });

    test("ejaan lain dipetakan, bukan diam-diam jatuh ke bawaan", () => {
        expect(resolveMetodeDitampilkan("tunai")).toEqual(resolveMetodeDitampilkan("cash"));
        expect(resolveMetodeDitampilkan("TRANSFER_BANK")).toEqual(resolveMetodeDitampilkan("transfer"));
    });

    test("nilai kosong/tak dikenal jatuh ke cash_transfer, TIDAK pernah mematikan semuanya", () => {
        for (const nilai of [undefined, null, "", "entah_apa"]) {
            const h = resolveMetodeDitampilkan(nilai);
            expect(h).toEqual({ tunai: true, transfer: true, online: false });
            expect(h.tunai || h.transfer || h.online).toBe(true);
        }
    });
});

describe("setelan BENAR-BENAR mengubah yang tercetak (sumbu yang dulu terlewat)", () => {
    test("'cash' TIDAK mencantumkan Transfer Bank", () => {
        const blok = blokMetode(generateInvoiceHTML(buatInvoice(), { paymentMethods: "cash" }));
        expect(blok).toContain("Tunai");
        expect(blok).not.toContain("Transfer Bank");
    });

    test("'transfer' TIDAK mencantumkan Tunai", () => {
        const blok = blokMetode(generateInvoiceHTML(buatInvoice(), { paymentMethods: "transfer" }));
        expect(blok).toContain("Transfer Bank");
        expect(blok).not.toContain("Tunai");
    });

    test("'cash_transfer' mencantumkan keduanya, tanpa Pembayaran Online", () => {
        const blok = blokMetode(generateInvoiceHTML(buatInvoice(), { paymentMethods: "cash_transfer" }));
        expect(blok).toContain("Tunai");
        expect(blok).toContain("Transfer Bank");
        expect(blok).not.toContain("Pembayaran Online");
    });

    test("'all' mencantumkan ketiganya", () => {
        const blok = blokMetode(generateInvoiceHTML(buatInvoice(), { paymentMethods: "all" }));
        expect(blok).toContain("Tunai");
        expect(blok).toContain("Transfer Bank");
        expect(blok).toContain("Pembayaran Online");
    });
});

describe("nomor rekening yang sampai ke pelanggan", () => {
    test("dipakai dari bankAccount tunggal bila terisi", () => {
        const blok = blokMetode(generateInvoiceHTML(buatInvoice(), { paymentMethods: "transfer" }));
        expect(blok).toContain("BRI");
        expect(blok).toContain("6185010");
    });

    test("JATUH ke bankAccounts jamak bila tunggal kosong — beda nama field ikut ditangani", () => {
        // Inilah keadaan produksi: form invoice tak pernah diisi, sementara admin mengisi
        // rekening di halaman /config yang memakai {bank, number, name}.
        const inv = buatInvoice({
            bankAccount: { bankName: "", accountNumber: "", accountName: "" },
            bankAccounts: [{ bank: "BCA", number: "8640114", name: "RAF NET" }],
        });
        const blok = blokMetode(generateInvoiceHTML(inv, { paymentMethods: "transfer" }));
        expect(blok).toContain("BCA");
        expect(blok).toContain("8640114");
    });

    test("teks contekan ISI_BANKNAME TIDAK pernah tercetak", () => {
        const inv = buatInvoice({
            bankAccount: { bankName: "ISI_BANKNAME", accountNumber: "ISI_ACCOUNTNUMBER", accountName: "ISI_ACCOUNTNAME" },
            bankAccounts: [{ bank: "BRI", number: "6185038", name: "RAF NET" }],
        });
        const blok = blokMetode(generateInvoiceHTML(inv, { paymentMethods: "transfer" }));
        expect(blok).not.toMatch(/ISI_/);
        expect(blok).toContain("BRI");
    });

    test("Transfer Bank TIDAK diklaim diterima bila tak ada satu pun rekening", () => {
        // Menyuruh pelanggan transfer tanpa memberi nomor rekening adalah instruksi
        // yang mustahil dijalankan — dan itu keadaan produksi Tanjungharjo sebelum ini.
        const inv = buatInvoice({ bankAccount: {}, bankAccounts: [] });
        const blok = blokMetode(generateInvoiceHTML(inv, { paymentMethods: "cash_transfer" }));
        expect(blok).not.toContain("Transfer Bank");
        expect(blok).toContain("Tunai");
    });

    test("blok tak pernah kosong: 'transfer' tanpa rekening tetap memberi jalan bayar", () => {
        const inv = buatInvoice({ bankAccount: {}, bankAccounts: [] });
        const blok = blokMetode(generateInvoiceHTML(inv, { paymentMethods: "transfer" }));
        expect(blok).toContain("Tunai");
    });

    test("rekening setengah data (bank tanpa nomor) diperlakukan tidak ada", () => {
        expect(resolveDaftarRekening({ bankName: "BRI", accountNumber: "" }, [])).toEqual([]);
        expect(resolveDaftarRekening(null, [{ bank: "", number: "123" }])).toEqual([]);
    });

    test("bankAccounts berbentuk objek berkunci angka tetap terbaca", () => {
        // config.json yang pernah disunting tangan bisa berubah bentuk; diam-diam
        // menganggapnya kosong persis cacat yang sedang diperbaiki.
        const hasil = resolveDaftarRekening(null, { 0: { bank: "BCA", number: "8640114" } });
        expect(hasil).toHaveLength(1);
        expect(hasil[0].bankName).toBe("BCA");
    });
});

describe("teks contekan config.example.json tak pernah sampai ke pelanggan", () => {
    const { bersihkanPlaceholder, adalahPlaceholder } = require("../config-placeholder");
    const { buatCustomizationInvoice } = require("../invoice-generator");

    test("pola ISI_* dikenali, nilai asli tidak", () => {
        expect(adalahPlaceholder("ISI_PHONE")).toBe(true);
        expect(adalahPlaceholder("ISI_LOGOURL")).toBe(true);
        expect(adalahPlaceholder("6285648676526")).toBe(false);
        expect(adalahPlaceholder("Isilah formulir")).toBe(false); // bukan ISI_ / ISI-
        expect(bersihkanPlaceholder("ISI_NPWP", "")).toBe("");
    });

    test("logoUrl contekan TIDAK menimpa logo yang diunggah", () => {
        // REGRESI YANG DITANGKAP SAAT VERIFIKASI PRODUKSI: menyatukan perakit
        // customization membuat `logoUrl` akhirnya diteruskan ke generator (dulu
        // dibuang diam-diam). Di Dander nilainya masih "ISI_LOGOURL", sehingga invoice
        // merender <img src="ISI_LOGOURL"> dan MEMATIKAN logo yang baru diperbaiki —
        // logoUrl mendahului logo unggahan di generator.
        const c = buatCustomizationInvoice({ pdfCustomization: { logoUrl: "ISI_LOGOURL" } });
        expect(c.logoUrl).toBe("");

        const html = generateInvoiceHTML(buatInvoice(), c);
        expect(html).not.toContain("ISI_LOGOURL");
        expect(html).not.toMatch(/<img[^>]+src="ISI_/);
    });

    test("logoUrl sungguhan tetap diteruskan", () => {
        const c = buatCustomizationInvoice({ pdfCustomization: { logoUrl: "https://contoh.id/logo.png" } });
        expect(c.logoUrl).toBe("https://contoh.id/logo.png");
    });

    test("kop tagihan tak mencetak ISI_PHONE; barisnya dihilangkan, bukan setengah", () => {
        const inv = buatInvoice({
            company: { name: "RAF NET", address: "Ds. Dander", phone: "ISI_PHONE", email: "", npwp: "ISI_NPWP" },
        });
        const html = generateInvoiceHTML(inv, {});
        expect(html).not.toMatch(/ISI_/);
        expect(html).not.toContain("Telp:");   // teleponnya belum diisi
        expect(html).not.toContain("Email:");  // emailnya kosong
        expect(html).toContain("Ds. Dander");  // yang terisi tetap tampil
    });
});
