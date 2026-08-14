/**
 * Header Doc
 * Purpose: Menjamin agen TIDAK diberi tahu "voucher sudah dikirim" ketika pengiriman ke
 *          pelanggan sebenarnya gagal, dan menerima kredensialnya untuk diteruskan manual.
 * Caller: Jest test runner.
 * Deps: `database/response_templates.json`, sumber `../agent-voucher-handler`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA: `lib/whatsapp-delivery-service` MENGEMBALIKAN `{sent:false}` alih-alih melempar,
 * jadi try/catch di sekeliling pengiriman tak menangkapnya — hasilnya cuma masuk logger.warn.
 * Pesan sukses ke agen lalu dikirim tanpa syarat, berbunyi "Voucher sudah dikirim ke
 * customer." Penjualan tercatat, profit dihitung, stok dipotong, state dihapus: pelanggan
 * sudah membayar tunai tapi TIDAK PERNAH menerima username/password voucher, dan tak ada
 * satu pun jalur kirim ulang.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..", "..");
const SUMBER = fs.readFileSync(
    path.join(AKAR, "message", "handlers", "agent-voucher-handler.js"),
    "utf8"
);
const TEMPLATES = JSON.parse(
    fs.readFileSync(path.join(AKAR, "database", "response_templates.json"), "utf8")
);

const KUNCI_GAGAL = "agent_voucher_sale_delivery_failed_agent";

describe("hasil pengiriman menentukan pesan ke agen", () => {
    test("hasil `delivery.sent` dibawa keluar dari blok try, bukan ditelan", () => {
        expect(SUMBER).toMatch(/voucherTerkirim\s*=\s*Boolean\(delivery && delivery\.sent\)/);
    });

    test("pesan ke agen bercabang berdasarkan bukti pengiriman", () => {
        const blok = SUMBER.slice(SUMBER.indexOf("const agentMessage ="));

        expect(blok.slice(0, 400)).toMatch(/!voucherTerkirim/);
        expect(blok.slice(0, 900)).toContain(KUNCI_GAGAL);
    });

    test("template sukses TIDAK dipakai saat gagal", () => {
        const blok = SUMBER.slice(SUMBER.indexOf("const agentMessage ="));
        const posisiGagal = blok.indexOf(KUNCI_GAGAL);
        const posisiSukses = blok.indexOf("agent_voucher_sale_success_agent");

        // Cabang gagal harus datang LEBIH DULU (ternary `!voucherTerkirim ? gagal : sukses`).
        expect(posisiGagal).toBeGreaterThan(-1);
        expect(posisiGagal).toBeLessThan(posisiSukses);
    });
});

describe("kunci template terdaftar — bukan hanya di fallback", () => {
    test(`${KUNCI_GAGAL} ada di response_templates.json`, () => {
        // Template TERSIMPAN menimpa fallback. Kunci baru yang hanya ada di kode berarti
        // admin tak bisa menyuntingnya, dan slot baru tak akan pernah muncul.
        expect(TEMPLATES).toHaveProperty(KUNCI_GAGAL);
    });

    test("templatenya benar-benar membawa kredensial voucher", () => {
        const t = TEMPLATES[KUNCI_GAGAL];

        // Inilah gunanya pesan ini: agen bisa meneruskan kodenya manual.
        expect(t.template).toContain("${voucherCredentials}");
        expect(t.placeholders).toEqual(expect.arrayContaining(["voucherCredentials"]));
    });

    test("templatenya TIDAK mengaku voucher sudah terkirim", () => {
        expect(TEMPLATES[KUNCI_GAGAL].template).not.toMatch(/sudah dikirim ke customer/i);
    });

    test("setiap slot yang dipakai template terdaftar di placeholders", () => {
        const t = TEMPLATES[KUNCI_GAGAL];
        const slot = [...t.template.matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]);

        expect([...new Set(slot)].sort()).toEqual([...t.placeholders].sort());
    });
});
