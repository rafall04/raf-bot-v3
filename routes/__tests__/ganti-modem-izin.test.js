/**
 * Header Doc
 * Purpose : Menjaga agar endpoint GANTI MODEM benar-benar bisa dipakai TEKNISI (#b281).
 *           Gerbang admin gagal-tertutup (#b253): endpoint baru lahir TERTUTUP untuk teknisi,
 *           jadi tanpa pendaftaran eksplisit fitur lapangan ini akan 403 tanpa penjelasan.
 * Caller  : jest
 * Deps    : routes/teknisi-izin-api, lib/authz (murni)
 * MainFuncs: -
 * SideEffects: tidak ada
 */
const { IZIN_TEKNISI_API } = require("../teknisi-izin-api");
const { buatGerbangTeknisi, cocokkanJalur } = require("../../lib/authz");

const JALUR = "/api/users/:id/ganti-modem";

function jalankanGerbang(user, method, jalur) {
    const gerbang = buatGerbangTeknisi(IZIN_TEKNISI_API, { milikRouter: () => true });
    let status = null;
    let lanjut = false;
    const req = { user, method, path: jalur, originalUrl: jalur, url: jalur };
    const res = {
        status(k) { status = k; return this; },
        json() { return this; },
        send() { return this; },
    };
    gerbang(req, res, () => { lanjut = true; });
    return { status, lanjut };
}

describe("#b281 — izin teknisi untuk ganti modem", () => {
    test("jalurnya terdaftar", () => {
        const ada = IZIN_TEKNISI_API.some((i) => i.method === "POST" && i.jalur === JALUR);
        expect(ada).toBe(true);
    });

    test("pola jalur cocok dengan URL nyata (bukan sekadar tertulis)", () => {
        expect(cocokkanJalur(JALUR, "/api/users/79/ganti-modem")).toBe(true);
        expect(cocokkanJalur(JALUR, "/api/users/79/ganti-paket")).toBe(false);
    });

    test("!! TEKNISI diizinkan lewat gerbang", () => {
        const { lanjut, status } = jalankanGerbang({ role: "teknisi", username: "t1" }, "POST", "/api/users/79/ganti-modem");
        expect(lanjut).toBe(true);
        expect(status).toBeNull();
    });

    test("admin tentu saja diizinkan", () => {
        const { lanjut } = jalankanGerbang({ role: "admin", username: "a1" }, "POST", "/api/users/79/ganti-modem");
        expect(lanjut).toBe(true);
    });

    test("!! izinnya TIDAK melebar ke jalur users lain", () => {
        // Daftar izin yang terlalu longgar pernah membocorkan kredensial router inti (#b252).
        const r = jalankanGerbang({ role: "teknisi" }, "POST", "/api/users/79/hapus");
        expect(r.lanjut).toBe(false);
        expect(r.status).toBe(403);
    });

    test("metode selain POST tidak ikut terbuka", () => {
        const r = jalankanGerbang({ role: "teknisi" }, "DELETE", "/api/users/79/ganti-modem");
        expect(r.lanjut).toBe(false);
    });
});
