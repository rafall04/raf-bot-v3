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

    test("rejects without profile and surfaces bridge failure", async () => {
        const service = createVoucherPrintService({ repository: tmpRepo(), getConfig: () => config, addHotspotUsersBatch: async () => ({ ok: false, message: "router down" }) });
        expect((await service.generateBatch({ count: 5 })).ok).toBe(false);
        const r = await service.generateBatch({ profile: "P", count: 5 });
        expect(r.ok).toBe(false);
        expect(r.message).toBe("router down");
    });
});
