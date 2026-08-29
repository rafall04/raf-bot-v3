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

describe("!! agen TIDAK boleh melihat SEMUA pelanggan (hanya yang ditugaskan)", () => {
    test("ensureAuthenticatedStaff TIDAK memuat role 'agen' (lindungi /api/users + endpoint pelanggan massal)", () => {
        const auth = read("routes/admin-auth.js");
        const m = auth.match(/\[([^\]]*)\]\.includes\(\s*req\.user\.role\s*\)/);
        expect(m).toBeTruthy();
        expect(m[1]).toMatch(/admin/);
        expect(m[1]).not.toMatch(/['"]agen['"]/); // agen TAK boleh lolos gerbang staf
    });

    test("GET /api/users digate ensureAuthenticatedStaff (agen → 403), bukan ensureAuthenticated telanjang", () => {
        const r = read("routes/api-users-routes.js");
        // /users memakai stack yang berujung ensureAuthenticatedStaff (bukan hanya ensureAuthenticated)
        expect(r).toMatch(/ensureAuthenticatedStaff/);
        expect(r).toMatch(/router\.get\(\s*['"]\/users['"][\s\S]{0,80}ensureAuthenticatedStaff/);
    });

    test("endpoint pelanggan MASSAL memakai staf/admin, tak terjangkau agen", () => {
        const files = {
            "routes/mikrotik-routes.js": /ppp-active-users['"]\s*,\s*ensureAuthenticatedStaff/,
        };
        // ppp-active-users bisa tersebar; cari di seluruh routes bila file tak pas
        const all = require("fs").readdirSync(path.join(AKAR, "routes")).filter((f) => f.endsWith(".js"))
            .map((f) => read("routes/" + f)).join("\n");
        expect(all).toMatch(/ppp-active-users['"]\s*,\s*ensureAuthenticatedStaff/);
        expect(all).toMatch(/network-assets['"]\s*,\s*ensureAuthenticatedStaff/);
        expect(all).toMatch(/customer-metrics-batch['"]\s*,\s*ensureAuthenticatedStaff/);
        void files;
    });

    test("agen GET /customers difilter dari TOKEN (req.user.id), bukan query param (tak bisa minta punya agen lain)", () => {
        const agen = read("routes/agen.js");
        expect(agen).toMatch(/assigned_agen_id[^)]*\)\s*===\s*String\(\s*req\.user\.id\s*\)/);
        // tak ada pembacaan agen id dari query utk /customers
        const idx = agen.indexOf("/customers");
        expect(agen.slice(idx, idx + 300)).not.toMatch(/req\.query\.agen/);
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
