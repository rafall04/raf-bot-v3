"use strict";

/**
 * Header Doc
 * Purpose: Guardrail — pastikan callback voucher (buynow/buynowweb/buynowpanel) HARDENED untuk
 *   go-public: (1) kode voucher dikirim via sendCritical (retry+dead-letter), (2) saat voucher
 *   GAGAL dibuat → recordVoucherOrphan + alertAdmins (tidak silent) + tetap mark paid (stop retry;
 *   getvoucher non-idempotent → retry = risiko voucher ganda). Mencegah regresi ke "silent paid
 *   tanpa voucher". Cabang `buynowpanel` (panel pelanggan) juga dijaga memakai `pay.prof` tersimpan
 *   alih-alih menurunkan profil dari harga.
 * Caller: Jest (`npx jest routes/__tests__/payment-callback-voucher.test.js`).
 * Deps: fs, path, source routes/public.js + routes/public-anonymous.js (scan, tidak dieksekusi).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */

const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "public.js"), "utf8");
// Halaman/endpoint publik voucher (page /voucher + /app/* + QR) kini owner-nya
// routes/public-anonymous.js (dipisah agar bisa di-mount di listener publik port terpisah).
const anonSource = fs.readFileSync(path.join(__dirname, "..", "public-anonymous.js"), "utf8");

const buynowIdx = source.indexOf("pay.tag == 'buynow'");
const webIdx = source.indexOf("pay.tag == 'buynowweb'");
const panelIdx = source.indexOf("pay.tag == 'buynowpanel'");
const topupIdx = source.indexOf("pay.tag == 'topup'");

// Batas tiap blok = awal blok berikutnya. Urutan di source: buynow → buynowweb → buynowpanel →
// topup. Kalau urutan berubah, slice ini harus ikut — jangan biarkan satu blok menelan blok lain,
// karena assertion "blok X punya Y" jadi lolos palsu.
const buynowBlock = buynowIdx > -1 ? source.slice(buynowIdx, webIdx) : "";
const webBlock = webIdx > -1 ? source.slice(webIdx, panelIdx) : "";
const panelBlock = panelIdx > -1 ? source.slice(panelIdx, topupIdx) : "";

describe("callback voucher hardening (go-public)", () => {
    test("blok buynow, buynowweb & buynowpanel ada, berurutan sebelum topup", () => {
        expect(buynowIdx).toBeGreaterThan(-1);
        expect(webIdx).toBeGreaterThan(buynowIdx);
        expect(panelIdx).toBeGreaterThan(webIdx);
        expect(topupIdx).toBeGreaterThan(panelIdx);
    });

    test("buynow: kode voucher via sendCritical (bukan sendMessage best-effort)", () => {
        expect(buynowBlock).toMatch(/sendCritical\(pay\.sender/);
    });

    test("buynow: voucher gagal → recordVoucherOrphan + alertAdmins (terlihat, tidak silent)", () => {
        const catchBlock = buynowBlock.slice(buynowBlock.indexOf(".catch("));
        expect(catchBlock).toMatch(/recordVoucherOrphan/);
        expect(catchBlock).toMatch(/alertAdmins/);
    });

    test("buynow: voucher gagal → tetap mark paid (stop retry; getvoucher non-idempotent)", () => {
        const catchBlock = buynowBlock.slice(buynowBlock.indexOf(".catch("));
        const idxMarkPaid = catchBlock.indexOf("updateStatusPayment(reference_id, true)");
        const idxThrowOk = catchBlock.indexOf("throw !0");
        expect(idxMarkPaid).toBeGreaterThan(-1);
        expect(idxThrowOk).toBeGreaterThan(idxMarkPaid);
    });

    test("buynowweb: voucher gagal → recordVoucherOrphan + alertAdmins juga", () => {
        const catchBlock = webBlock.slice(webBlock.indexOf(".catch("));
        expect(catchBlock).toMatch(/recordVoucherOrphan/);
        expect(catchBlock).toMatch(/alertAdmins/);
    });

    test("buynowweb SUKSES: kirim kode voucher ke WA via sendCritical + template voucher_beli_web", () => {
        const successBlock = webBlock.slice(0, webBlock.indexOf(".catch("));
        // Normalisasi nomor form → JID sebelum kirim (bukan pakai @lid / nomor mentah).
        expect(successBlock).toMatch(/normalizePhoneNumber\(String\(pay\.sender/);
        expect(successBlock).toMatch(/@s\.whatsapp\.net/);
        expect(successBlock).toMatch(/sendCritical\(jid/);
        expect(successBlock).toMatch(/voucher_beli_web/);
        // Best-effort: dibungkus try/catch supaya gagal kirim TIDAK menggagalkan callback.
        expect(successBlock).toMatch(/try\s*{[\s\S]*sendCritical[\s\S]*catch/);
    });

    test("halaman & endpoint publik voucher terpasang di public-anonymous (page /voucher + QR PNG)", () => {
        expect(anonSource).toMatch(/router\.get\('\/voucher'/);
        expect(anonSource).toMatch(/voucher-buy\.html/);
        expect(anonSource).toMatch(/case 'qr':/);
        expect(anonSource).toMatch(/qr\.imageSync\(String\(rec\.qrStr\)/);
    });
});

describe("callback voucher — cabang panel pelanggan (buynowpanel)", () => {
    test("profil diambil dari pay.prof tersimpan, bukan diturunkan dari harga", () => {
        // checkprofvc(harga) tertukar bila dua paket berharga sama — panel menyimpan prof eksplisit
        // saat charge, jadi callback tidak boleh bergantung pada reverse-lookup harga.
        expect(panelBlock).toMatch(/pay\.prof\s*\|\|\s*checkprofvc/);
    });

    test("SUKSES: kode via sendCritical ke JID ternormalisasi + template voucher_beli_panel", () => {
        const successBlock = panelBlock.slice(0, panelBlock.indexOf(".catch("));
        expect(successBlock).toMatch(/normalizePhoneNumber\(String\(pay\.sender/);
        expect(successBlock).toMatch(/@s\.whatsapp\.net/);
        expect(successBlock).toMatch(/sendCritical\(jid/);
        expect(successBlock).toMatch(/voucher_beli_panel/);
        // Gagal kirim WA tidak boleh menggagalkan callback — kode tetap terbaca di panel.
        expect(successBlock).toMatch(/try\s*{[\s\S]*sendCritical[\s\S]*catch/);
    });

    test("SUKSES: tandai paid dan simpan kode ke ket sebelum selesai", () => {
        const successBlock = panelBlock.slice(0, panelBlock.indexOf(".catch("));
        expect(successBlock).toMatch(/updateKetPayment\(reference_id/);
        expect(successBlock).toMatch(/updateStatusPayment\(reference_id, true\)/);
    });

    test("GAGAL: recordVoucherOrphan + alertAdmins + tetap mark paid (stop retry)", () => {
        const catchBlock = panelBlock.slice(panelBlock.indexOf(".catch("));
        expect(catchBlock).toMatch(/recordVoucherOrphan/);
        expect(catchBlock).toMatch(/buynowpanel_callback/);
        expect(catchBlock).toMatch(/alertAdmins/);
        const idxMarkPaid = catchBlock.indexOf("updateStatusPayment(reference_id, true)");
        const idxThrowOk = catchBlock.indexOf("throw !0");
        expect(idxMarkPaid).toBeGreaterThan(-1);
        expect(idxThrowOk).toBeGreaterThan(idxMarkPaid);
    });

    test("GAGAL: ket diberi prefix GAGAL supaya panel bisa menampilkan state failed", () => {
        const catchBlock = panelBlock.slice(panelBlock.indexOf(".catch("));
        expect(catchBlock).toMatch(/updateKetPayment\(reference_id, `GAGAL voucher:/);
    });

    test("template voucher_beli_panel ada di message_templates.json (bukan hanya fallback)", () => {
        // Template tersimpan menimpa fallback runtime; key yang belum ada = pesan tak pernah terkirim.
        const templates = JSON.parse(
            fs.readFileSync(path.join(__dirname, "..", "..", "database", "message_templates.json"), "utf8")
        );
        expect(templates.voucher_beli_panel).toBeDefined();
        expect(typeof templates.voucher_beli_panel.template).toBe("string");
        ["${nama_paket}", "${harga}", "${kode_voucher}"].forEach((slot) => {
            expect(templates.voucher_beli_panel.template).toContain(slot);
        });
    });
});

describe("endpoint voucher panel pelanggan (/api/customer/vouchers/*)", () => {
    test("terdaftar di customerApiRouter (bukan router publik anonim)", () => {
        expect(source).toMatch(/customerApiRouter\.get\('\/vouchers\/packages'/);
        expect(source).toMatch(/customerApiRouter\.post\('\/vouchers\/purchase'/);
        expect(source).toMatch(/customerApiRouter\.get\('\/vouchers\/purchase\/:reff'/);
        expect(source).toMatch(/customerApiRouter\.get\('\/vouchers\/history'/);
    });

    test("pembelian dibatasi rate limiter per customer", () => {
        expect(source).toMatch(/customerApiRouter\.post\('\/vouchers\/purchase', voucherPurchaseRateLimiter/);
        expect(source).toMatch(/voucher_purchase_customer_/);
    });

    test("nomor HP TIDAK pernah diambil dari body pada jalur pembelian", () => {
        const purchaseIdx = source.indexOf("customerApiRouter.post('/vouchers/purchase'");
        const block = source.slice(purchaseIdx, purchaseIdx + 600);
        expect(block).toMatch(/customer:\s*req\.customer/);
        expect(block).not.toMatch(/req\.body\??\.(phone|phone_number|nomor)/);
    });
});
