"use strict";

const { formatDurationToken, formatPrice, resolveColor } = require("../format");
const { getBuiltinLayouts } = require("../layouts");
const { renderCard, renderSheet, applyTemplate } = require("../render");
const { convertMikhmonTemplate, parseMikhmonColors } = require("../mikhmon-import");

const fakeQr = { qrcode: { toDataURL: async () => "data:image/png;base64,TEST" } };

const SETTINGS = {
    wifi_name: "VANS 45NET",
    portal_text: "buka: vans.net",
    cs_number: "0853-1111-2222",
    logo_url: "",
    qr_mode: "code",
    default_color: "#BA68C8",
    price_colors: { "3000": "#666666", "1000": "#FF1493" }
};

const VOUCHER = { username: "7ChD66", password: "7ChD66", price: 3000, validity: "1d", timelimit: "1d", profile: "Paket-1Hari" };

describe("voucher-print/format", () => {
    test("formatDurationToken", () => {
        expect(formatDurationToken("1d")).toBe("1 Hari");
        expect(formatDurationToken("8h")).toBe("8 Jam");
        expect(formatDurationToken("1w")).toBe("7 Hari");
        expect(formatDurationToken("")).toBe("");
    });
    test("formatPrice", () => {
        expect(formatPrice(3000)).toEqual({ num: 3000, text: "Rp 3.000", amount: "3.000" });
        expect(formatPrice("Rp 10.000")).toEqual({ num: 10000, text: "Rp 10.000", amount: "10.000" });
    });
    test("resolveColor", () => {
        expect(resolveColor(3000, SETTINGS.price_colors, "#BA68C8")).toBe("#666666");
        expect(resolveColor(9999, SETTINGS.price_colors, "#BA68C8")).toBe("#BA68C8");
    });
});

describe("voucher-print/render", () => {
    test("applyTemplate leaves no unresolved placeholders for known keys", () => {
        expect(applyTemplate("a {{kode}} b {{harga}}", { kode: "X", harga: "Rp 1" })).toBe("a X b Rp 1");
        expect(applyTemplate("{{unknown}}", {})).toBe("");
    });

    test("renderCard fills voucher data, color, and QR", async () => {
        const band = getBuiltinLayouts().find((l) => l.id === "band");
        const html = await renderCard(band, VOUCHER, SETTINGS, fakeQr);
        expect(html).toContain("7ChD66");
        expect(html).toContain("VANS 45NET");
        expect(html).toContain("Rp 3.000");
        expect(html).toContain("#666666");
        expect(html).toContain("data:image/png;base64,TEST");
        expect(html).not.toMatch(/\{\{\w+\}\}/);
    });

    test("all 14 builtin layouts render with no leftover placeholders", async () => {
        const layouts = getBuiltinLayouts();
        expect(layouts.length).toBe(14);
        for (const layout of layouts) {
            const html = await renderCard(layout, VOUCHER, SETTINGS, fakeQr);
            expect(html).toContain("7ChD66");
            expect(html).not.toMatch(/\{\{\w+\}\}/);
        }
    });

    test("renderSheet produces a printable document", async () => {
        const band = getBuiltinLayouts().find((l) => l.id === "band");
        const html = await renderSheet(band, [VOUCHER, { ...VOUCHER, username: "P22TSJ" }], SETTINGS, fakeQr, { title: "Test" });
        expect(html).toContain("<!DOCTYPE html>");
        expect(html).toContain("window.print()");
        expect(html).toContain("7ChD66");
        expect(html).toContain("P22TSJ");
    });

    test("autologin QR mode builds login URL", async () => {
        const band = getBuiltinLayouts().find((l) => l.id === "band");
        const captured = [];
        const deps = { qrcode: { toDataURL: async (c) => { captured.push(c); return "data:img"; } } };
        await renderCard(band, VOUCHER, { ...SETTINGS, qr_mode: "autologin", autologin_url_template: "http://vans.net/login?u={kode}&p={sandi}" }, deps);
        expect(captured[0]).toBe("http://vans.net/login?u=7ChD66&p=7ChD66");
    });
});

describe("voucher-print/mikhmon-import", () => {
    const MIKHMON = `<?php
if(substr($validity,-1) == "d"){ $validity = "MASA AKTIF : ".substr($validity,0,-1)." HARI"; }
if($getsprice == "3000"){ $color = "#666";}
elseif($getsprice == "1000"){ $color = "#FF1493";}
elseif($getsprice == "2000"){ $color = "#8B008B";}
elseif($getsprice == "70000"){ $color = "#FF0000";}
else{ $color = "#BA68C8";}
?>
<style>.qrcode{height:60px;}</style>
<table><tr><td>
<small><?= explode(" ",$price)[0]?></small><?= explode(" ",$price)[1]?>
</td></tr>
<tr><td>
<?php if($v_opsi=='up'){ ?>
<?php }else{ ?>
<div style="color:<?php echo $color ?>">VOUCHER</div>
<div style="font-weight:bold;"><?php echo $username;?></div>
<?php } ?>
<div><?= $qrcode ?></div>
<div style="background:<?php echo $color ?>">CS: 0822</div>
</td></tr></table>`;

    test("extracts price->color map and default", () => {
        const { map, default: def } = parseMikhmonColors(MIKHMON);
        expect(map["1000"]).toBe("#FF1493");
        expect(map["3000"]).toBe("#666");
        expect(map["70000"]).toBe("#FF0000");
        expect(def).toBe("#BA68C8");
    });

    test("converts to placeholder template with no PHP left", () => {
        const { template, colors } = convertMikhmonTemplate(MIKHMON);
        expect(template).toContain("{{kode}}");
        expect(template).toContain("{{qr}}");
        expect(template).toContain("{{warna}}");
        expect(template).toContain("{{harga_angka}}");
        expect(template).toContain("VOUCHER");
        expect(template).not.toContain("<?php");
        expect(template).not.toContain("<?=");
        expect(colors.map["1000"]).toBe("#FF1493");
    });
});
