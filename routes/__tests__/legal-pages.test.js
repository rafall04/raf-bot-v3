"use strict";

const express = require("express");

describe("routes/legal-pages (halaman compliance publik)", () => {
    let server;
    let base;

    beforeAll((done) => {
        global.config = {
            nama: "RAF NET",
            telfon: "628123456789",
            company: {
                name: "RAF NET",
                address: "Ds. Dander Kab. Bojonegoro",
                phone: "ISI_PHONE", // placeholder → harus fallback ke telfon
                email: "rafnet.bjn@gmail.com",
                website: "https://rafnet.my.id",
            },
        };
        const app = express();
        app.use("/", require("../legal-pages"));
        server = app.listen(0, () => {
            base = `http://127.0.0.1:${server.address().port}`;
            done();
        });
    });

    afterAll((done) => {
        delete global.config;
        server.close(done);
    });

    async function get(path) {
        const res = await fetch(base + path);
        return { status: res.status, body: await res.text() };
    }

    test("keempat halaman balas 200 + judul benar", async () => {
        for (const p of ["/faq", "/refund-policy", "/syarat-ketentuan", "/kontak"]) {
            const r = await get(p);
            expect(r.status).toBe(200);
            expect(r.body).toContain("RAF NET");
        }
    });

    test("/kontak menampilkan email, telepon, dan alamat usaha (wajib gateway)", async () => {
        const r = await get("/kontak");
        expect(r.body).toContain("rafnet.bjn@gmail.com");
        expect(r.body).toContain("Ds. Dander Kab. Bojonegoro");
        // phone placeholder 'ISI_PHONE' harus di-skip → pakai config.telfon.
        expect(r.body).toContain("628123456789");
        expect(r.body).not.toContain("ISI_PHONE");
    });

    test("refund & syarat berisi konten kebijakan", async () => {
        expect((await get("/refund-policy")).body).toMatch(/Pengembalian Dana|Refund/i);
        expect((await get("/syarat-ketentuan")).body).toMatch(/Syarat|Ketentuan/i);
    });
});
