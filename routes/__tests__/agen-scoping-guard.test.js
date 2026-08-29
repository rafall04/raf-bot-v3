/**
 * Header Doc
 * Purpose : GUARD keamanan role `agen` (penagih pembayaran). Menegakkan invariant: agen HANYA bisa
 *           menagih/mengkonfirmasi & melihat pelanggan yang DITUGASKAN kepadanya (users.assigned_agen_id),
 *           ditegakkan di SERVER (bukan cuma UI). Plus penjaga kemudahan admin: filter di /penugasan-agen.
 * Caller  : jest
 * Deps    : pemindaian sumber routes/requests.js, routes/agen.js, static/js/penugasan-agen.js.
 * MainFuncs: -
 * SideEffects: tidak ada.
 *
 * KENAPA ADA — kelas bug [[authz-gerbang-teknisi]] (#b253): API pernah gagal-TERBUKA untuk role
 * non-admin. Konfirmasi pembayaran adalah jalur UANG; bila cek `assigned_agen_id` dicabut, agen bisa
 * menagih pelanggan orang lain. Guard ini mengunci empat titik penegakan + wiring filter admin.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const AKAR = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(AKAR, rel), "utf8");

describe("role agen — scoping ke pelanggan yang ditugaskan (server-side)", () => {
    const requests = read("routes/requests.js");
    const agen = read("routes/agen.js");

    test("!! CREATE pembayaran: agen menagih pelanggan BUKAN miliknya → 403 (bukan hanya UI)", () => {
        // if (isAgenRequestor && String(user.assigned_agen_id||'') !== String(req.user.id)) return 403
        expect(requests).toMatch(/isAgenRequestor\s*&&\s*String\(\s*user\.assigned_agen_id[^)]*\)\s*!==\s*String\(\s*req\.user\.id\s*\)/);
        // penolakannya benar-benar 403
        const idx = requests.indexOf("assigned_agen_id");
        expect(requests.slice(idx, idx + 400)).toMatch(/status\(403\)/);
    });

    test("LIST request: agen hanya melihat pengajuannya sendiri (requested_by_agen_id)", () => {
        expect(requests).toMatch(/role\s*===\s*['"]agen['"][\s\S]{0,160}requested_by_agen_id[\s\S]{0,40}===\s*String\(\s*req\.user\.id\s*\)/);
    });

    test("CANCEL request: agen hanya bisa batalkan pengajuannya sendiri (owner-scoped)", () => {
        expect(requests).toMatch(/ownerField\s*=\s*isAgenRequestor\s*\?\s*['"]requested_by_agen_id['"]/);
        expect(requests).toMatch(/String\(\s*r\[ownerField\]\s*\)\s*===\s*String\(\s*technicianId\s*\)/);
    });

    test("agen GET /customers: hanya pelanggan ber-assigned_agen_id = dirinya", () => {
        expect(agen).toMatch(/assigned_agen_id[^)]*\)\s*===\s*String\(\s*req\.user\.id\s*\)/);
    });

    test("assign & assignments hanya untuk admin (ensureAdmin)", () => {
        expect(agen).toMatch(/router\.post\(\s*['"]\/assign['"]\s*,\s*ensureAdmin/);
        expect(agen).toMatch(/router\.get\(\s*['"]\/assignments['"]\s*,\s*ensureAdmin/);
    });
});

describe("admin /penugasan-agen — filter pelanggan mudah", () => {
    const js = read("static/js/penugasan-agen.js");
    const php = read("views/sb-admin/penugasan-agen.php");

    test("ada dropdown filter #filterAgen (Semua / Belum ditugaskan / per agen)", () => {
        expect(php).toMatch(/id="filterAgen"/);
        expect(php).toMatch(/Belum ditugaskan/);
        expect(js).toMatch(/Ditugaskan ke:/); // opsi per-agen ditambah di JS
    });

    test("filter memakai custom search DataTables + data-agen-id per baris", () => {
        expect(js).toMatch(/dataTable\.ext\.search\.push/);
        expect(js).toMatch(/data-agen-id=/);
        expect(js).toMatch(/#filterAgen/);
        // dijaga ke tabel ini saja (tak mempengaruhi tabel lain)
        expect(js).toMatch(/nTable\.id\s*!==\s*['"]assignTable['"]/);
    });

    test("'pilih semua' menghormati filter (rows search:'applied', lintas halaman)", () => {
        expect(js).toMatch(/rows\(\s*\{\s*search:\s*['"]applied['"]/);
    });
});
