/**
 * Header Doc
 * Purpose : Menjaga pembacaan redaman lewat WEB OLT (#b274) — pengganti SNMP yang membuat
 *           OLT hang. Semua contoh di bawah adalah POTONGAN NYATA dari OLT produksi
 *           (Tanjungharjo 192.168.15.2 dan Icak 192.168.0.88), diambil 2026-08-27.
 * Caller  : jest
 * Deps    : lib/olt-web-optical
 * MainFuncs: -
 * SideEffects: tidak ada — semua HTTP di-inject
 */
const web = require("../olt-web-optical");

// ---- potongan NYATA dari OLT Tanjungharjo (PON 0/1/1) ----------------------
const HTML_PON_LIST = `
<script language =javascript>
var ponListTable=new Array(
//"0/1/1","N/A"
'0/1/1','ONU Total=40,Online=39,Offline=1',
'0/1/2','ONU Total=59,Online=59,Offline=0'
);
</script>`;

const HTML_ONU_TANJUNG = `
<script language =javascript>
var ponOnuTable=new Array(
'0/1/1:1','NA','e4:77:27:80:f9:17','Up','3230','6301','5','49.00','3.00','10.00','1.99','-24.44','338',
'0/1/1:2','NA','48:12:8f:8c:ea:cc','Up','3230','6301','5','39.00','3.00','9.00','2.19','-17.28','214',
'0/1/1:3','NA','3c:93:f4:e4:a7:c2','Up','3230','6301','5','34.00','3.00','8.00','2.09','-19.39','317'
);
</script>`;

// ---- potongan NYATA dari OLT Icak: SEMUA `Down`, tapi redaman lama MASIH TAMPIL ----
const HTML_ONU_ICAK_DOWN = `
<script language =javascript>
var ponOnuTable=new Array(
'0/1/2:2','NA','38:20:28:25:49:58','Down','3230','6301','5','38.00','3.00','4.00','2.02','-13.44','88',
'0/1/2:3','NA','b4:14:e6:88:a8:28','Down','3230','6301','5','41.00','3.00','9.00','2.07','-13.49','317',
'0/1/2:4','NA','e4:77:27:81:46:63','Down','3230','6301','5','38.00','3.00','7.00','2.30','-12.78','97'
);
</script>`;

describe("#b274 — redaman dibaca dari WEB OLT, bukan SNMP", () => {
    test("daftar PON terbaca beserta ringkasannya", () => {
        const pon = web.parsePonList(HTML_PON_LIST);
        expect(pon.map((p) => p.pon)).toEqual(["0/1/1", "0/1/2"]);
        expect(pon[1].ringkasan).toContain("Online=59");
    });

    test("halaman asing → null, bukan daftar kosong yang menipu", () => {
        expect(web.parsePonList("<html>login</html>")).toBeNull();
        expect(web.parseOnuList("<html>login</html>")).toBeNull();
    });

    test("ONU Up → redaman terbaca apa adanya", () => {
        const baris = web.parseOnuList(HTML_ONU_TANJUNG);
        expect(baris).toHaveLength(3);
        expect(baris[0]).toMatchObject({
            onuId: "0/1/1:1",
            mac: "e4:77:27:80:f9:17",
            up: true,
            rxPower: -24.44,
            slot: "1",
            onu: "1",
        });
        expect(baris[2].rxPower).toBeCloseTo(-19.39, 2);
    });

    test("!! ONU Down yang MASIH memamerkan redaman lama → rxPower DIBUANG", () => {
        // Terukur di OLT Icak: 5 ONU Down, semuanya tetap menampilkan dBm terakhir.
        // Memakainya berarti melaporkan sambungan sehat untuk pelanggan yang sedang mati.
        const baris = web.parseOnuList(HTML_ONU_ICAK_DOWN);
        expect(baris).toHaveLength(3);
        for (const b of baris) {
            expect(b.up).toBe(false);
            expect(b.rxPower).toBeNull();
            expect(b.rxMentah).not.toBe("");   // angkanya ADA di halaman...
        }
        // ...tapi tak satu pun ikut terbaca sebagai bacaan sah.
        expect(baris.filter((b) => b.rxPower != null)).toHaveLength(0);
    });

    test("sentinel -inf / -- bukan angka", () => {
        const html = HTML_ONU_TANJUNG
            .replace("'-24.44'", "'-inf'")
            .replace("'-17.28'", "'--'");
        const baris = web.parseOnuList(html);
        expect(baris[0].rxPower).toBeNull();
        expect(baris[1].rxPower).toBeNull();
        expect(baris[2].rxPower).toBeCloseTo(-19.39, 2);
    });

    test("OnuId dipetakan ke slot/onu seperti kosakata bot", () => {
        expect(web.uraiOnuId("0/1/2:56")).toEqual({ slot: "2", onu: "56" });
        expect(web.uraiOnuId("0/1/1:7")).toEqual({ slot: "1", onu: "7" });
    });

    test("bacaOlt merangkai daftar PON lalu tiap PON-nya", async () => {
        const diminta = [];
        const hasil = await web.bacaOlt(
            { host: "1.2.3.4", webUsername: "u", webPassword: "p" },
            {
                jedaMs: 0,
                wait: async () => {},
                fetchPage: async (_d, path) => {
                    diminta.push(path);
                    if (path.includes("PonList")) return { ok: true, body: HTML_PON_LIST };
                    return { ok: true, body: HTML_ONU_TANJUNG };
                },
            }
        );
        expect(hasil.ok).toBe(true);
        expect(diminta[0]).toContain("onuConfigPonList.asp");
        expect(diminta).toHaveLength(3);              // 1 daftar PON + 2 PON
        expect(hasil.onus).toHaveLength(6);           // 3 ONU x 2 PON
    });

    test("!! OLT tak terjangkau → failedOlts, BUKAN 'semua pelanggan offline'", async () => {
        const snap = await web.getWebOpticalSnapshot({
            getDevices: () => [{ id: "olt1", name: "OLT Server", host: "192.168.11.2", webUsername: "u", webPassword: "p" }],
            deps: { jedaMs: 0, wait: async () => {}, fetchPage: async () => ({ ok: false, code: 0, err: "timeout" }) },
        });
        expect(snap.status).toBe("success");
        expect(snap.onus).toHaveLength(0);
        expect(snap.failedOlts).toHaveLength(1);
        expect(snap.failedOlts[0]).toMatchObject({ oltName: "OLT Server", message: "timeout" });
    });

    test("satu OLT hidup + satu mati → yang hidup tetap terpakai, yang mati dicatat", async () => {
        const snap = await web.getWebOpticalSnapshot({
            getDevices: () => [
                { id: "hidup", name: "OLT Hidup", host: "1.1.1.1", webUsername: "u", webPassword: "p" },
                { id: "mati", name: "OLT Mati", host: "2.2.2.2", webUsername: "u", webPassword: "p" },
            ],
            deps: {
                jedaMs: 0,
                wait: async () => {},
                fetchPage: async (d, path) => {
                    if (d.host === "2.2.2.2") return { ok: false, code: 0, err: "timeout" };
                    if (path.includes("PonList")) return { ok: true, body: "var ponListTable=new Array('0/1/1','x');" };
                    return { ok: true, body: HTML_ONU_TANJUNG };
                },
            },
        });
        expect(snap.onus).toHaveLength(3);
        expect(snap.onus[0]).toMatchObject({ macAddress: "e4:77:27:80:f9:17", status: "Online", rxPower: -24.44, sumber: "web" });
        expect(snap.failedOlts.map((f) => f.oltId)).toEqual(["mati"]);
    });

    test("bentuknya lolos isRxPowerValid milik jalur lama", async () => {
        const { isRxPowerValid } = require("../olt-optical-resolver");
        const snap = await web.getWebOpticalSnapshot({
            getDevices: () => [{ id: "o", name: "O", host: "1.1.1.1", webUsername: "u", webPassword: "p" }],
            deps: {
                jedaMs: 0,
                wait: async () => {},
                fetchPage: async (_d, path) =>
                    path.includes("PonList")
                        ? { ok: true, body: "var ponListTable=new Array('0/1/1','x');" }
                        : { ok: true, body: HTML_ONU_TANJUNG + HTML_ONU_ICAK_DOWN },
            },
        });
        const online = snap.onus.filter((o) => isRxPowerValid(o, o.status));
        // Hanya yang Up yang lolos; yang Down (dengan angka basi) ditolak.
        expect(online).toHaveLength(3);
        expect(online.every((o) => o.rxPower < 0)).toBe(true);
    });

    test("modul ini TIDAK BOLEH menyentuh SNMP", () => {
        const src = require("fs").readFileSync(require("path").join(__dirname, "..", "olt-web-optical.js"), "utf8");
        expect(src).not.toMatch(/net-snmp/);
        expect(src.toLowerCase()).not.toMatch(/require\(["'][^"']*snmp/);
    });
});
