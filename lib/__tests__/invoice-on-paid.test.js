/**
 * Header Doc
 * Purpose: Guard hook post-lunas sendPaidInvoiceOrReceipt (lib/invoice-on-paid) — 3 perbaikan vs versi
 *   lama: (1) DECOUPLE invoice dari gate notif-teks (send_invoice ON → PDF walau notifEnabled=false);
 *   (2) ANTI SILENT-DROP (createInvoice null → tetap kirim teks); (3) normalisasi flag (true/1/"1"/"true").
 *   Plus: OFF+notif-off → skip; PDF gagal → fallback teks; never-throw.
 * Caller: Jest.
 * Deps: ../invoice-on-paid dgn ../invoice-generator & ../pdf-invoice-generator di-mock; deps kirim di-inject.
 * SideEffects: -
 */
"use strict";

jest.mock("../invoice-generator", () => ({
    createInvoice: jest.fn(() => ({ invoiceNumber: "INV-1" })),
    buatCustomizationInvoice: jest.fn(() => ({})),
}));
jest.mock("../pdf-invoice-generator", () => ({
    createInvoicePDF: jest.fn(async () => ({ buffer: Buffer.from("pdf"), path: "" })),
}));

const invGen = require("../invoice-generator");
const pdfGen = require("../pdf-invoice-generator");
const { isSendInvoiceEnabled, sendPaidInvoiceOrReceipt } = require("../invoice-on-paid");

function makeDeps() {
    return {
        deliver: jest.fn(async () => {}),
        waitForWhatsAppDelay: jest.fn(async () => {}),
        normalizePhoneNumber: (n) => String(n).replace(/\D/g, ""),
        renderTemplate: jest.fn(() => "fallback-msg"),
    };
}
const USER = { id: 1, name: "Budi", subscription: "10Mbps", phone_number: "628123456789", send_invoice: true };

beforeEach(() => { jest.clearAllMocks(); invGen.createInvoice.mockReturnValue({ invoiceNumber: "INV-1" }); pdfGen.createInvoicePDF.mockResolvedValue({ buffer: Buffer.from("pdf"), path: "" }); });

test("isSendInvoiceEnabled normalisasi true/1/'1'/'true'; tolak false/0/'0'/undefined", () => {
    [true, 1, "1", "true"].forEach((v) => expect(isSendInvoiceEnabled(v)).toBe(true));
    [false, 0, "0", "", undefined, null].forEach((v) => expect(isSendInvoiceEnabled(v)).toBe(false));
});

test("send_invoice ON → kirim PDF (document+caption)", async () => {
    const deps = makeDeps();
    const r = await sendPaidInvoiceOrReceipt(USER, { messageText: "struk", notifEnabled: true, deps });
    expect(r.mode).toBe("pdf");
    expect(deps.deliver).toHaveBeenCalledTimes(1);
    expect(deps.deliver.mock.calls[0][1]).toHaveProperty("document");
    expect(deps.deliver.mock.calls[0][1].caption).toBe("struk");
});

test("DECOUPLE: send_invoice ON tetap kirim PDF walau notifEnabled=false", async () => {
    const deps = makeDeps();
    const r = await sendPaidInvoiceOrReceipt(USER, { messageText: "struk", notifEnabled: false, deps });
    expect(r.mode).toBe("pdf");
    expect(deps.deliver).toHaveBeenCalledTimes(1);
});

test("send_invoice OFF + notif ON → kirim TEKS", async () => {
    const deps = makeDeps();
    const r = await sendPaidInvoiceOrReceipt({ ...USER, send_invoice: false }, { messageText: "struk", notifEnabled: true, deps });
    expect(r.mode).toBe("text");
    expect(deps.deliver.mock.calls[0][1]).toEqual({ text: "struk" });
});

test("send_invoice OFF + notif OFF → SKIP (tak kirim apa pun)", async () => {
    const deps = makeDeps();
    const r = await sendPaidInvoiceOrReceipt({ ...USER, send_invoice: false }, { messageText: "struk", notifEnabled: false, deps });
    expect(r.mode).toBe("skip-notif-off");
    expect(deps.deliver).not.toHaveBeenCalled();
});

test("ANTI SILENT-DROP: createInvoice null → tetap kirim TEKS (bukan nol pesan)", async () => {
    invGen.createInvoice.mockReturnValueOnce(null);
    const deps = makeDeps();
    const r = await sendPaidInvoiceOrReceipt(USER, { messageText: "struk", notifEnabled: false, deps });
    expect(r.mode).toBe("text-null-invoice");
    expect(deps.deliver).toHaveBeenCalledTimes(1);
    expect(deps.deliver.mock.calls[0][1]).toEqual({ text: "struk" });
});

test("PDF gagal semua retry → fallback TEKS (struk + invoice_fallback), never-throw", async () => {
    pdfGen.createInvoicePDF.mockRejectedValue(new Error("chromium mati"));
    const deps = makeDeps();
    let r;
    await expect((async () => { r = await sendPaidInvoiceOrReceipt(USER, { messageText: "struk", notifEnabled: false, deps }); })()).resolves.toBeUndefined();
    expect(r.mode).toBe("text-fallback");
    expect(deps.deliver.mock.calls[0][1].text).toContain("struk");
    expect(deps.deliver.mock.calls[0][1].text).toContain("fallback-msg");
});

test("tanpa nomor / tanpa deliver → skip, tak melempar", async () => {
    expect((await sendPaidInvoiceOrReceipt({ ...USER, phone_number: "" }, { deps: makeDeps() })).mode).toBe("skip-no-target");
    expect((await sendPaidInvoiceOrReceipt(USER, { deps: {} })).mode).toBe("skip-no-target");
});
