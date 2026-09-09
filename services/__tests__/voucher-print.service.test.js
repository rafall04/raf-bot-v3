"use strict";

const os = require("os");
const path = require("path");
const fs = require("fs");
const { createVoucherPrintRepository } = require("../../repositories/voucher-print.repository");
const { createVoucherPrintService } = require("../voucher-print.service");

function tmpRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vp-"));
    return createVoucherPrintRepository({
        settingsPath: path.join(dir, "settings.json"),
        layoutsPath: path.join(dir, "layouts.json")
    });
}

const fakeQr = { toDataURL: async () => "data:image/png;base64,TEST" };

describe("voucher-print.repository", () => {
    test("defaults + save/read settings", () => {
        const repo = tmpRepo();
        expect(repo.getSettings().price_colors["3000"]).toBe("#666666");
        repo.saveSettings({ wifi_name: "VANS", price_colors: { "999": "#000" } });
        const s = repo.getSettings();
        expect(s.wifi_name).toBe("VANS");
        expect(s.price_colors["999"]).toBe("#000");
        expect(s.price_colors["3000"]).toBe("#666666");
    });

    test("builtin + custom layouts merge and delete", () => {
        const repo = tmpRepo();
        expect(repo.getLayouts().some((l) => l.id === "band" && l.builtin)).toBe(true);
        repo.saveLayout({ id: "myx", name: "Punyaku", template: "<div>{{kode}}</div>" });
        expect(repo.getLayout("myx").builtin).toBe(false);
        repo.deleteLayout("myx");
        expect(repo.getLayout("myx")).toBeNull();
    });
});

describe("voucher-print.service", () => {
    const config = { nama: "VANS 45NET", telfon: "0853-1111", company: { logoPath: "/uploads/logo.png" } };

    test("merges config defaults into settings", () => {
        const service = createVoucherPrintService({ repository: tmpRepo(), getConfig: () => config, qrcode: fakeQr });
        const s = service.getSettings();
        expect(s.wifi_name).toBe("VANS 45NET");
        expect(s.cs_number).toBe("0853-1111");
        expect(s.logo_url).toBe("/uploads/logo.png");
    });

    test("renderPrint returns printable HTML with QR", async () => {
        const service = createVoucherPrintService({ repository: tmpRepo(), getConfig: () => config, qrcode: fakeQr });
        const out = await service.renderPrint({
            layoutId: "band",
            vouchers: [{ username: "7ChD66", price: 3000, validity: "1d" }]
        });
        expect(out.count).toBe(1);
        expect(out.html).toContain("7ChD66");
        expect(out.html).toContain("VANS 45NET");
        expect(out.html).toContain("data:image/png;base64,TEST");
    });

    test("importMikhmonLayout saves layout and merges colors", () => {
        const repo = tmpRepo();
        const service = createVoucherPrintService({ repository: repo, getConfig: () => config, qrcode: fakeQr });
        const php = `<?php if($getsprice == "1000"){ $color = "#FF1493";} else{ $color = "#BA68C8";} ?>\n<div style="color:<?php echo $color ?>">VOUCHER <?php echo $username;?></div><?= $qrcode ?>`;
        const { layout } = service.importMikhmonLayout({ name: "Punya Mikhmon", php });
        expect(layout.template).toContain("{{kode}}");
        expect(layout.template).toContain("{{warna}}");
        expect(repo.getLayout(layout.id)).not.toBeNull();
        expect(repo.getSettings().price_colors["1000"]).toBe("#FF1493");
    });
});

describe("voucher-print.service renderPdf + renderPdfAndSend", () => {
    const baseVouchers = Array.from({ length: 40 }, (_v, i) => ({ username: "V" + (i + 1), price: 1000, timelimit: "3h", profileName: "Paket 3 Jam" }));

    function svc(extra = {}) {
        return createVoucherPrintService({
            repository: tmpRepo(),
            getConfig: () => ({ nama: "RAF NET", ...(extra.config || {}) }),
            qrcode: fakeQr,
            ...extra.deps
        });
    }

    test("renderPdf: PDF_ENGINE_MISSING bila htmlToPdf tak diinjeksi", async () => {
        const out = await svc().renderPdf({ layoutId: "mikhmon36", vouchers: baseVouchers });
        expect(out.ok).toBe(false);
        expect(out.code).toBe("PDF_ENGINE_MISSING");
    });

    test("renderPdf: sukses -> buffer + count + perPage; Letter diteruskan ke htmlToPdf", async () => {
        let capturedOpts = null;
        const htmlToPdf = async (_html, opts) => { capturedOpts = opts; return Buffer.from("%PDF-fake"); };
        const out = await svc({ deps: { htmlToPdf } }).renderPdf({ layoutId: "mikhmon36", vouchers: baseVouchers, pageSize: "letter" });
        expect(out.ok).toBe(true);
        expect(Buffer.isBuffer(out.buffer)).toBe(true);
        expect(out.count).toBe(40);
        expect(out.perPage).toBe(36);
        expect(capturedOpts.format).toBe("Letter");
        expect(capturedOpts.waitUntil).toBe("load");
        expect(capturedOpts.timeoutMs).toBe(90000); // timeout eksplisit (anti-hang batch besar)
    });

    test("renderPdf: kunci render — panggilan kedua saat in-flight = BUSY", async () => {
        let release;
        const gate = new Promise((r) => { release = r; });
        const htmlToPdf = async () => { await gate; return Buffer.from("%PDF"); };
        const service = svc({ deps: { htmlToPdf } });
        const p1 = service.renderPdf({ layoutId: "mikhmon36", vouchers: baseVouchers });
        const r2 = await service.renderPdf({ layoutId: "mikhmon36", vouchers: baseVouchers });
        expect(r2.ok).toBe(false);
        expect(r2.code).toBe("BUSY");
        release();
        expect((await p1).ok).toBe(true);
    });

    test("renderPdf: GAGAL-KERAS -> {ok:false, PDF_FAILED} saat Chromium melempar (tak melempar, tak buffer HTML)", async () => {
        const htmlToPdf = async () => { throw new Error("Chromium tidak ditemukan"); };
        const out = await svc({ deps: { htmlToPdf } }).renderPdf({ layoutId: "mikhmon36", vouchers: baseVouchers });
        expect(out.ok).toBe(false);
        expect(out.code).toBe("PDF_FAILED");
        expect(out.buffer).toBeUndefined();
    });

    test("renderPdfAndSend: DISABLED bila config.voucherPrint.enabled != true", async () => {
        const out = await svc({ deps: { htmlToPdf: async () => Buffer.from("x") } })
            .renderPdfAndSend({ layoutId: "mikhmon36", vouchers: baseVouchers });
        expect(out.ok).toBe(false);
        expect(out.code).toBe("DISABLED");
    });

    test("renderPdfAndSend: WA_DISABLED bila sendWhatsApp.enabled != true", async () => {
        const out = await svc({
            config: { voucherPrint: { enabled: true } },
            deps: { htmlToPdf: async () => Buffer.from("x") }
        }).renderPdfAndSend({ layoutId: "mikhmon36", vouchers: baseVouchers });
        expect(out.ok).toBe(false);
        expect(out.code).toBe("WA_DISABLED");
    });

    test("renderPdfAndSend: kirim ke getAdminJids sebagai dokumen PDF + caption + skipDuplicateCheck", async () => {
        let sendArgs = null;
        const service = svc({
            config: { voucherPrint: { enabled: true, sendWhatsApp: { enabled: true } } },
            deps: {
                htmlToPdf: async () => Buffer.from("%PDF-fake"),
                getAdminJids: () => ["628123456789@s.whatsapp.net"],
                ensureJid: (p) => (p.includes("@") ? p : p.replace(/\D/g, "") + "@s.whatsapp.net"),
                renderResponseTemplate: (_key, fallback) => fallback,
                sendMessageToMany: async (recipients, payload, options) => {
                    sendArgs = { recipients, payload, options };
                    return { sent: true, successCount: recipients.length, recipients };
                }
            }
        });
        const out = await service.renderPdfAndSend({ layoutId: "mikhmon36", vouchers: baseVouchers });
        expect(out.ok).toBe(true);
        expect(out.recipients).toEqual(["628123456789@s.whatsapp.net"]);
        expect(sendArgs.payload.mimetype).toBe("application/pdf");
        expect(Buffer.isBuffer(sendArgs.payload.document)).toBe(true);
        expect(sendArgs.payload.fileName).toMatch(/\.pdf$/);
        expect(sendArgs.payload.caption).toContain("40 voucher");
        expect(sendArgs.options.skipDuplicateCheck).toBe(true);
    });

    test("renderPdfAndSend: tolak @lid sebagai target -> NO_RECIPIENTS", async () => {
        const out = await svc({
            config: { voucherPrint: { enabled: true, sendWhatsApp: { enabled: true } } },
            deps: {
                htmlToPdf: async () => Buffer.from("x"),
                ensureJid: (p) => p,
                sendMessageToMany: async () => ({ sent: true })
            }
        }).renderPdfAndSend({ layoutId: "mikhmon36", vouchers: baseVouchers, phone: "12345@lid" });
        expect(out.ok).toBe(false);
        expect(out.code).toBe("NO_RECIPIENTS");
    });

    test("login_url diturunkan dari origin autologin_url_template bila kosong", () => {
        const repo = tmpRepo();
        repo.saveSettings({ autologin_url_template: "http://10.10.0.1/login?username={kode}&password={sandi}" });
        const service = createVoucherPrintService({ repository: repo, getConfig: () => ({}), qrcode: fakeQr });
        expect(service.getSettings().login_url).toBe("http://10.10.0.1");
    });
});

describe("voucher-print.service generateBatch", () => {
    const config = { nama: "VANS 45NET" };

    test("forwards format params and returns vouchers", async () => {
        let captured = null;
        const batchFn = async (params) => {
            captured = params;
            return { ok: true, data: { vouchers: [{ username: "vcrAB12", password: "vcrAB12", profile: "Paket-1Hari" }], created: 1, failed: 0, requested: 1 } };
        };
        const service = createVoucherPrintService({ repository: tmpRepo(), getConfig: () => config, addHotspotUsersBatch: batchFn });
        const out = await service.generateBatch({ profile: "Paket-1Hari", count: 1, length: 6, chartype: "lower_num", prefix: "vcr-" });
        expect(out.ok).toBe(true);
        expect(out.created).toBe(1);
        expect(out.vouchers[0].username).toBe("vcrAB12");
        expect(captured.profile).toBe("Paket-1Hari");
        expect(captured.chartype).toBe("lower_num");
        expect(captured.prefix).toBe("vcr-");
    });

    test("uses settings defaults when format omitted", async () => {
        let captured = null;
        const repo = tmpRepo();
        repo.saveSettings({ code_length: 8, code_chartype: "num", code_prefix: "WIFI-" });
        const batchFn = async (params) => { captured = params; return { ok: true, data: { vouchers: [], created: 0, failed: 0 } }; };
        const service = createVoucherPrintService({ repository: repo, getConfig: () => config, addHotspotUsersBatch: batchFn });
        await service.generateBatch({ profile: "P", count: 5 });
        expect(captured.length).toBe(8);
        expect(captured.chartype).toBe("num");
        expect(captured.prefix).toBe("WIFI-");
    });

    test("kunci konkurensi: generate kedua saat batch in-flight = BUSY (cegah provision ganda)", async () => {
        let release;
        const gate = new Promise((r) => { release = r; });
        const batchFn = async () => { await gate; return { ok: true, data: { vouchers: [{ username: "a", password: "a", profile: "P" }], created: 1, failed: 0, requested: 1 } }; };
        const service = createVoucherPrintService({ repository: tmpRepo(), getConfig: () => config, addHotspotUsersBatch: batchFn });
        const p1 = service.generateBatch({ profile: "P", count: 1 });
        const r2 = await service.generateBatch({ profile: "P", count: 1 });
        expect(r2.ok).toBe(false);
        expect(r2.code).toBe("BUSY");
        release();
        const r1 = await p1;
        expect(r1.ok).toBe(true);
        // Kunci lepas setelah selesai -> generate berikutnya boleh jalan lagi (gate sudah resolved).
        const r3 = await service.generateBatch({ profile: "P", count: 1 });
        expect(r3.ok).toBe(true);
    });

    test("rejects without profile and surfaces bridge failure", async () => {
        const service = createVoucherPrintService({ repository: tmpRepo(), getConfig: () => config, addHotspotUsersBatch: async () => ({ ok: false, message: "router down" }) });
        expect((await service.generateBatch({ count: 5 })).ok).toBe(false);
        const r = await service.generateBatch({ profile: "P", count: 5 });
        expect(r.ok).toBe(false);
        expect(r.message).toBe("router down");
    });
});
