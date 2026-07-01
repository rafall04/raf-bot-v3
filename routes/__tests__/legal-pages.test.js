"use strict";

const express = require("express");

describe("routes/legal-pages (halaman compliance publik)", () => {
    let server;
    let base;

    beforeAll((done) => {
        global.config = {
            nama: "RAF NET",
            telfon: "628123456789",
            tanggal_isolir: "16",
            company: {
                name: "RAF NET",
                address: "Ds. Dander Kab. Bojonegoro",
                phone: "ISI_PHONE", // placeholder → harus fallback ke telfon
                email: "rafnet.bjn@gmail.com",
                website: "https://rafnet.my.id",
            },
        };
        global.packages = [
            { name: "PAKET-125K", price: 125000, whitelist: false },
            { name: "PAKET-VOUCHER", price: 0 }, // harus dikecualikan
            { name: "PAKET-GRATIS", price: 0, whitelist: true }, // harus dikecualikan
        ];
        const app = express();
        app.use("/", require("../legal-pages"));
        server = app.listen(0, () => {
            base = `http://127.0.0.1:${server.address().port}`;
            done();
        });
    });

    afterAll((done) => {
        delete global.config;
        delete global.packages;
        server.close(done);
    });

    async function get(path) {
        const res = await fetch(base + path);
        return { status: res.status, body: await res.text() };
    }

    test("keempat halaman balas 200 + nav lengkap", async () => {
        for (const p of ["/faq", "/refund-policy", "/syarat-ketentuan", "/kontak"]) {
            const r = await get(p);
            expect(r.status).toBe(200);
            expect(r.body).toContain("RAF NET");
            // nav 4 halaman ada di setiap halaman
            expect(r.body).toContain('href="/kontak"');
            expect(r.body).toContain('href="/syarat-ketentuan"');
        }
    });

    test("FAQ: berkategori, accordion, dan tabel harga dari data paket nyata", async () => {
        const r = await get("/faq");
        expect(r.body).toContain("Layanan &amp; Pemasangan");
        expect(r.body).toContain("Tagihan &amp; Pembayaran");
        expect(r.body).toContain("<details class=\"qa\">");
        // paket asli tampil, voucher & whitelist dikecualikan
        expect(r.body).toContain("PAKET-125K");
        expect(r.body).toContain("Rp125.000");
        expect(r.body).not.toContain("PAKET-VOUCHER");
        expect(r.body).not.toContain("PAKET-GRATIS");
        // CTA WhatsApp (fallback telfon)
        expect(r.body).toMatch(/wa\.me\/628123456789/);
    });

    test("Terms: ada daftar isi + tanggal isolir nyata + banyak pasal", async () => {
        const r = await get("/syarat-ketentuan");
        expect(r.body).toContain("Daftar Isi");
        expect(r.body).toContain("Penonaktifan Sementara");
        expect(r.body).toContain("tanggal <b>16</b>"); // dari config.tanggal_isolir
        expect(r.body).toContain('id="larangan"');
        expect(r.body).toContain("Hukum yang Berlaku");
    });

    test("Refund: ketentuan bernomor & substantif", async () => {
        const r = await get("/refund-policy");
        expect(r.body).toContain("Pembayaran Ganda");
        expect(r.body).toContain("Sebelum Aktivasi");
        expect(r.body).toMatch(/3.14 hari kerja/);
    });

    test("/kontak menampilkan email, telepon, alamat + catatan keamanan (wajib gateway)", async () => {
        const r = await get("/kontak");
        expect(r.body).toContain("rafnet.bjn@gmail.com");
        expect(r.body).toContain("Ds. Dander Kab. Bojonegoro");
        expect(r.body).toContain("628123456789"); // fallback dari telfon
        expect(r.body).not.toContain("ISI_PHONE");
        expect(r.body).toContain("Catatan Keamanan");
    });
});
