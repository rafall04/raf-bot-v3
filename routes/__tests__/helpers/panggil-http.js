/**
 * Header Doc
 * Purpose: Helper request HTTP untuk tes router — menjalankan satu request terhadap app
 *          Express di server ephemeral, lalu menutupnya.
 * Caller: Suite tes gerbang peran di `routes/__tests__/`.
 * Deps: `http` (Node core).
 * MainFuncs: `panggilHttp`.
 * SideEffects: Membuka & menutup server HTTP di 127.0.0.1 pada port acak.
 *
 * KENAPA BUKAN `fetch`: `fetch` Node (undici) memakai connection pool KEEP-ALIVE. Pola
 * "satu server baru per request lalu ditutup" membuat soket yang masih dipegang pool
 * menunjuk server yang sudah mati, dan request berikutnya sesekali gagal dengan
 * `TypeError: fetch failed`. Terukur: 1 kegagalan dari 3 putaran — cukup untuk membuat suite
 * merah secara acak di CI, dan tes yang flaky sama tak berguna dengan tes yang salah.
 * `http.request` dengan `agent: false` tidak menyatukan koneksi sama sekali.
 */
"use strict";

const http = require("http");

async function panggilHttp(app, metode, path, badan, headersTambahan = {}) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();

    try {
        const payload = badan === undefined || badan === null ? null : JSON.stringify(badan);

        const hasil = await new Promise((resolve, reject) => {
            const req = http.request(
                {
                    host: "127.0.0.1",
                    port,
                    path,
                    method: metode,
                    // Tanpa pooling: setiap request memakai koneksi barunya sendiri.
                    agent: false,
                    headers: Object.assign(
                        { Connection: "close" },
                        payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {},
                        headersTambahan
                    ),
                },
                (res) => {
                    let teks = "";
                    res.setEncoding("utf8");
                    res.on("data", (c) => (teks += c));
                    res.on("end", () => {
                        let json = null;
                        try {
                            json = JSON.parse(teks);
                        } catch (_e) {
                            json = null;
                        }
                        resolve({ status: res.statusCode, teks, json });
                    });
                }
            );

            req.on("error", reject);
            if (payload) req.write(payload);
            req.end();
        });

        return hasil;
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

module.exports = { panggilHttp };
