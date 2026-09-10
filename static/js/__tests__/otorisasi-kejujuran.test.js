/**
 * Header Doc
 * Purpose: Guard kejujuran UI halaman Otorisasi — copy overlay "maksimal 20 request" (sisa jalur
 *   sinkron lama) TAK BOLEH muncul lagi di jalur pra-AJAX; jalur nyata mengantre SELURUH pending
 *   lalu balas 202 (worker latar tanpa batas). Juga memastikan polling log punya self-start saat
 *   halaman dibuka di tengah job (tak lagi beku) dan 409 diarahkan ke kartu Log. Pemindai sumber
 *   (idiom guard-test repo), bukan uji DOM (env test = node).
 * Caller: Jest.
 * Deps: fs (baca static/js/otorisasi.js).
 * SideEffects: -
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "otorisasi.js"), "utf8");

test("copy menyesatkan 'maksimal 20 request' sudah dicabut dari overlay", () => {
    expect(SRC).not.toMatch(/maksimal 20 request/i);
});

test("polling log self-start saat job masih jalan (anti-beku saat refresh)", () => {
    // Cabang yang memulai timer saat masihJalan && !timer harus ada di render().
    expect(SRC).toMatch(/masihJalan\s*&&\s*!timer/);
});

test("respons 409 diarahkan ke kartu Log (bukan dialog 'Gagal!')", () => {
    expect(SRC).toMatch(/xhr\.status\s*===\s*409/);
    expect(SRC).toMatch(/pantauLogOtorisasi/);
});
