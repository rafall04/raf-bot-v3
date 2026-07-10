"use strict";

const {
    buildPaidReceiptText,
    formatRupiah,
    formatPeriode,
    resolveStatusLayanan,
    TEMPLATE_KEY
} = require("../paid-receipt");

const USER = { name: "Widji Rochani", subscription: "PAKET-125K" };

describe("paid-receipt — format kanonik", () => {
    test("rupiah tanpa sen (bukan 'Rp. 125.000,00' ala rupiah-format)", () => {
        expect(formatRupiah(125000)).toBe("Rp 125.000");
        expect(formatRupiah(0)).toBe("Rp 0");
        expect(formatRupiah(undefined)).toBe("Rp 0");
    });

    test("periode ditulis panjang; tanpa periode → bulan berjalan", () => {
        expect(formatPeriode(7, 2026)).toBe("Juli 2026");
        expect(formatPeriode(undefined, undefined)).toMatch(/^[A-Z][a-z]+ \d{4}$/);
    });

    test("status layanan HANYA saat reaktivasi benar-benar berhasil", () => {
        expect(resolveStatusLayanan({ attempted: true, ok: true })).toContain("aktif kembali");
        expect(resolveStatusLayanan(true)).toContain("aktif kembali");
        // Tak pernah terisolir, atau reaktivasi gagal → jangan mengklaim apa pun.
        expect(resolveStatusLayanan({ attempted: false })).toBe("");
        expect(resolveStatusLayanan({ attempted: true, ok: false })).toBe("");
        expect(resolveStatusLayanan(false)).toBe("");
        expect(resolveStatusLayanan(undefined)).toBe("");
    });
});

describe("paid-receipt — isi struk", () => {
    const base = {
        user: USER,
        amount: 125000,
        periodMonth: 7,
        periodYear: 2026,
        method: "Transfer Bank",
        paidAt: "2026-07-10T07:31:00.000Z",
        refId: "BP-260710-Y6PZ"
    };

    test("memuat nama akun, paket, periode, nominal, metode, dan nomor rujukan", () => {
        const text = buildPaidReceiptText(base);

        expect(text).toContain("Widji Rochani");
        expect(text).toContain("PAKET-125K");
        expect(text).toContain("Juli 2026");
        expect(text).toContain("Rp 125.000");
        expect(text).toContain("Transfer Bank");
        expect(text).toContain("BP-260710-Y6PZ");
        expect(text).toContain("LUNAS");
    });

    test("tanpa reaktivasi → tak ada klaim 'aktif kembali'", () => {
        expect(buildPaidReceiptText(base)).not.toContain("aktif kembali");
        expect(buildPaidReceiptText({ ...base, reactivation: { attempted: true, ok: true } }))
            .toContain("aktif kembali");
    });

    test("tanpa nomor rujukan → '-' (jujur, bukan slot kosong menganga)", () => {
        expect(buildPaidReceiptText({ ...base, refId: undefined })).toContain("No. Ref : -");
    });

    test("user tanpa nama/paket tidak meledak", () => {
        const text = buildPaidReceiptText({ ...base, user: {} });
        expect(text).toContain("Pelanggan");
        expect(text).not.toContain("undefined");
    });

    test("tak menyisakan placeholder ${...} yang belum terisi", () => {
        expect(buildPaidReceiptText(base)).not.toMatch(/\$\{[a-z_]+\}/i);
    });
});

describe("paid-receipt — standardisasi lintas jalur", () => {
    // Inti dari perbaikan ini: pelanggan yang sama harus menerima struk yang SAMA BENTUKNYA,
    // apa pun jalur pelunasannya. Yang boleh beda hanya metode & nomor rujukan.
    test("empat jalur menghasilkan struk yang identik selain metode & no. ref", () => {
        const common = { user: USER, amount: 125000, periodMonth: 7, periodYear: 2026, paidAt: "2026-07-10T07:31:00.000Z" };

        const buktiFoto = buildPaidReceiptText({ ...common, method: "Transfer Bank", refId: "BP-260710-Y6PZ" });
        const dashboard = buildPaidReceiptText({ ...common, method: "Tunai", refId: "812" });
        const tripay = buildPaidReceiptText({ ...common, method: "QRIS", refId: "INV-99" });
        const ipaymu = buildPaidReceiptText({ ...common, method: "QRIS", refId: "INV-99" });

        expect(tripay).toBe(ipaymu);

        const normalize = (t) => t
            .replace(/• Metode  : .*/g, "• Metode  : X")
            .replace(/• No\. Ref : .*/g, "• No. Ref : X");

        expect(normalize(dashboard)).toBe(normalize(buktiFoto));
        expect(normalize(tripay)).toBe(normalize(buktiFoto));
    });

    test("template kanoniknya memang tagihan_struk_lunas", () => {
        expect(TEMPLATE_KEY).toBe("tagihan_struk_lunas");
    });
});
