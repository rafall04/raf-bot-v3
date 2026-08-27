/**
 * Header Doc
 * Purpose: Membaca REDAMAN (rxPower) ONU dari ANTARMUKA WEB OLT — tanpa SNMP sama sekali.
 *
 *          !! SNMP membuat OLT HANG (pengalaman lapangan pemilik). Modul ini ada supaya
 *          semua pembacaan optik bisa pindah ke jalur web yang sudah terbukti aman: scraper
 *          log web sudah lama memakai jalur yang sama (`sys_log_page.asp`) tanpa insiden.
 *          JANGAN menambahkan pemanggilan SNMP apa pun ke berkas ini.
 *
 *          Alur di OLT (GoAhead, Basic auth):
 *            /onuConfigPonList.asp                    -> daftar port PON (`0/1/1`, `0/1/2`, ...)
 *            /onuConfigOnuList.asp?oltponno=<pon>     -> daftar ONU + redaman per PON
 *          Datanya disuntik sebagai array JavaScript `ponOnuTable` dengan stride 13:
 *            +0 OnuId (`0/1/2:56`) · +1 Name · +2 MacAddress · +3 Status (`Up`/`Down`)
 *            +4 Version · +5 ChipId · +6 PortNumber · +7 Distance · +11 RxPower · +12 jarak mentah
 *          Pemetaan itu dibaca dari `createTable()` halaman itu sendiri, bukan ditebak.
 *
 *          ANTI DATA-BASI (TERUKUR di OLT Icak 2026-08-27): 5 ONU berstatus `Down` tetap
 *          menampilkan redaman lama (-13.44, -12.78, ...). Nilai itu WAJIB dibuang — halaman
 *          OLT sendiri pun hanya memakai rxPower saat `Status == "Up"`. ONU yang tidak `Up`
 *          dipulangkan dengan `rxPower: null`, bukan angka terakhirnya.
 *
 *          OLT yang tak terjangkau dipulangkan lewat `failedOlts`, TIDAK dibaca sebagai
 *          "semua pelanggannya offline" ("cannot observe" != "observed bad").
 * Caller: `lib/post-repair-verification.js` (via `getOltSnapshot` pengganti), pemakai lain
 *         yang butuh redaman tanpa menyentuh SNMP.
 * Deps: `http` (Node inti). Tidak ada dependensi OLT lain — sengaja, supaya tak ada jalan
 *       tak sengaja ke SNMP.
 * MainFuncs: `parsePonList`, `parseOnuList`, `bacaOlt`, `getWebOpticalSnapshot`.
 * SideEffects: HTTP GET read-only ke web OLT. NEVER-THROW pada level snapshot.
 */
"use strict";

const http = require("http");

// Stride array `ponOnuTable` dan indeks kolomnya — dibaca dari createTable() halaman OLT.
const STRIDE = 13;
const IDX = { onuId: 0, name: 1, mac: 2, status: 3, rxPower: 11, jarak: 12 };

// Nilai yang berarti "tidak ada bacaan", bukan angka.
const RX_KOSONG = new Set(["-inf", "--", "", "n/a", "na"]);

const DEFAULTS = {
    port: 80,
    timeoutMs: 10000,
    // Jeda antar-permintaan ke SATU OLT. Web GoAhead di perangkat ini ringkih bila diserbu;
    // kita hanya perlu 1 + jumlah-PON permintaan, jadi jeda kecil sudah cukup.
    jedaAntarPermintaanMs: 250,
};

/**
 * GET satu halaman web OLT. Tidak pernah melempar — memulangkan {ok,body,code,err}.
 */
function fetchPage(device, path, deps = {}) {
    const httpMod = deps.http || http;
    const timeoutMs = Number(device.webTimeoutMs) || DEFAULTS.timeoutMs;
    return new Promise((resolve) => {
        let selesai = false;
        const beres = (hasil) => { if (!selesai) { selesai = true; resolve(hasil); } };
        try {
            const auth = Buffer.from(`${device.webUsername || ""}:${device.webPassword || ""}`).toString("base64");
            const req = httpMod.request({
                hostname: device.host,
                port: Number(device.webPort) || DEFAULTS.port,
                path,
                method: "GET",
                timeout: timeoutMs,
                headers: {
                    Authorization: `Basic ${auth}`,
                    Accept: "text/html,application/xhtml+xml",
                    "User-Agent": "Mozilla/5.0",
                    Connection: "close",
                },
            }, (res) => {
                let data = "";
                res.on("data", (c) => { data += c; });
                res.on("end", () => beres({ ok: res.statusCode === 200, code: res.statusCode, body: data }));
            });
            req.on("error", (e) => beres({ ok: false, code: 0, err: (e && e.message) || "error" }));
            req.on("timeout", () => { req.destroy(); beres({ ok: false, code: 0, err: "timeout" }); });
            req.end();
        } catch (e) {
            beres({ ok: false, code: 0, err: (e && e.message) || "error" });
        }
    });
}

/** Ambil semua literal string dari sebuah `new Array( ... )` bernama `nama`. */
function ambilArrayJs(html, nama) {
    const teks = String(html || "");
    const pola = new RegExp("var\\s+" + nama + "\\s*=\\s*new\\s+Array\\(([\\s\\S]*?)\\);");
    const m = teks.match(pola);
    if (!m) return null;
    const keluar = [];
    for (const q of m[1].matchAll(/'([^']*)'/g)) keluar.push(q[1]);
    return keluar;
}

/**
 * Daftar port PON dari /onuConfigPonList.asp
 * @returns {Array<{pon:string, ringkasan:string}>|null} null = halaman tak dikenali
 */
function parsePonList(html) {
    const medan = ambilArrayJs(html, "ponListTable");
    if (!medan) return null;
    const keluar = [];
    for (let i = 0; i + 2 <= medan.length; i += 2) {
        const pon = String(medan[i] || "").trim();
        if (pon) keluar.push({ pon, ringkasan: String(medan[i + 1] || "") });
    }
    return keluar;
}

/**
 * Daftar ONU + redaman dari /onuConfigOnuList.asp?oltponno=<pon>
 * @returns {Array<Object>|null} null = halaman tak dikenali
 */
function parseOnuList(html) {
    const medan = ambilArrayJs(html, "ponOnuTable");
    if (!medan) return null;
    const keluar = [];
    for (let i = 0; i + STRIDE <= medan.length; i += STRIDE) {
        const f = medan.slice(i, i + STRIDE);
        const onuId = String(f[IDX.onuId] || "").trim();
        if (!onuId) continue;
        const statusMentah = String(f[IDX.status] || "").trim();
        const naik = statusMentah.toLowerCase() === "up";
        const rxMentah = String(f[IDX.rxPower] == null ? "" : f[IDX.rxPower]).trim();
        const rxAngka = parseFloat(rxMentah);

        // !! Redaman HANYA dipercaya saat ONU benar-benar Up. ONU `Down` di OLT ini tetap
        // memamerkan angka terakhirnya (terbukti di OLT Icak: 5 ONU Down, semua masih
        // menampilkan dBm lama). Memakainya berarti melaporkan sambungan sehat untuk
        // pelanggan yang sedang mati.
        const rxValid = naik && !RX_KOSONG.has(rxMentah.toLowerCase()) && Number.isFinite(rxAngka);

        const { slot, onu } = uraiOnuId(onuId);
        keluar.push({
            onuId,
            name: String(f[IDX.name] || "").trim(),
            mac: String(f[IDX.mac] || "").trim(),
            statusMentah,
            up: naik,
            rxPower: rxValid ? rxAngka : null,
            rxMentah,
            slot,
            onu,
        });
    }
    return keluar;
}

/** `0/1/2:56` -> { slot: "2", onu: "56" } */
function uraiOnuId(onuId) {
    const m = String(onuId || "").match(/(\d+)\s*$/);
    const onu = m ? m[1] : null;
    const bagian = String(onuId || "").split(":")[0].split("/");
    const slot = bagian.length ? bagian[bagian.length - 1] : null;
    return { slot: slot || null, onu };
}

/**
 * Baca SATU OLT lewat web: daftar PON lalu tiap PON-nya.
 * @returns {Promise<{ok:boolean, onus:Array, err?:string}>}
 */
async function bacaOlt(device, deps = {}) {
    const ambil = deps.fetchPage || fetchPage;
    const tunggu = deps.wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const jeda = Number.isFinite(deps.jedaMs) ? deps.jedaMs : DEFAULTS.jedaAntarPermintaanMs;

    const halPon = await ambil(device, "/onuConfigPonList.asp", deps);
    if (!halPon.ok) return { ok: false, onus: [], err: halPon.err || `HTTP ${halPon.code}` };
    const ponList = parsePonList(halPon.body);
    if (!ponList) return { ok: false, onus: [], err: "halaman PON tak dikenali" };

    const onus = [];
    for (const { pon } of ponList) {
        if (jeda) await tunggu(jeda);
        const hal = await ambil(device, `/onuConfigOnuList.asp?oltponno=${encodeURIComponent(pon)}`, deps);
        if (!hal.ok) return { ok: false, onus: [], err: `PON ${pon}: ${hal.err || "HTTP " + hal.code}` };
        const baris = parseOnuList(hal.body);
        if (!baris) return { ok: false, onus: [], err: `PON ${pon}: halaman ONU tak dikenali` };
        for (const b of baris) onus.push({ ...b, pon });
    }
    return { ok: true, onus };
}

/**
 * Snapshot berbentuk SAMA seperti `olt-optical-resolver.getOltSnapshot`, supaya bisa
 * dipakai sebagai pengganti langsung — tapi sumbernya web, bukan SNMP.
 */
async function getWebOpticalSnapshot(opts = {}) {
    const getDevices = opts.getDevices || (() => require("./olt-manager").getOltDevices());
    const deps = opts.deps || {};
    let devices = [];
    try {
        devices = (getDevices() || []).filter((d) => d && d.host && d.enabled !== false);
    } catch (e) {
        return { status: "error", message: (e && e.message) || "device tak terbaca", onus: [], failedOlts: [] };
    }

    const onus = [];
    const failedOlts = [];
    for (const d of devices) {
        const hasil = await bacaOlt(d, deps);
        if (!hasil.ok) {
            // TIDAK dianggap "semua pelanggannya offline" — hanya dicatat sebagai tak terbaca.
            failedOlts.push({ oltId: d.id, oltName: d.name, oltHost: d.host, message: hasil.err });
            continue;
        }
        for (const o of hasil.onus) {
            onus.push({
                macAddress: o.mac,
                // Kosakata yang sama dengan jalur lama supaya `isRxPowerValid` tetap berlaku.
                status: o.up ? "Online" : "Offline",
                statusKnown: true,
                rxPower: o.rxPower,
                slotId: o.slot,
                id: o.onu,
                onuId: o.onuId,
                // LOS vs Dying-Gasp BUKAN milik jalur ini — pemiliknya `olt-log-scraper`
                // (log web) yang memang bisa membedakannya. SNMP Hioso pun tak bisa: kodenya
                // sendiri mencatat "tidak bisa membedakan LOS vs Dying Gasp" dan selalu
                // memulangkan isDyingGasp=false. Jadi di sini keduanya false secara EKSPLISIT,
                // bukan ditebak dari status offline — supaya tak ada yang membaca "offline"
                // sebagai "fiber putus" padahal bisa saja mati listrik.
                isDyingGasp: false,
                isLos: false,
                lastDownCause: null,
                // Medan identitas GPON (ZTE). OLT Hioso memakai MAC sebagai identitas utama,
                // jadi null di sini tidak menghilangkan pencocokan pelanggan mana pun.
                serial: null,
                description: null,
                olt_id: d.id,
                olt_name: d.name,
                olt_host: d.host,
                olt_brand: d.brand || "auto",
                sumber: "web",
            });
        }
    }

    return {
        // Tetap `success` walau sebagian gagal — data OLT yang hidup tetap berguna; cakupannya
        // jujur lewat `failedOlts` (aturan yang sama dengan #b273).
        status: "success",
        timestamp: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
        fetchedAt: new Date().toISOString(),
        onus,
        failedOlts,
        // Medan yang dibaca pemakai lama (routes/olt.js dll). Dikosongkan secara EKSPLISIT
        // supaya tak ada `undefined` yang menyelinap ke tampilan admin.
        systemInfo: {},
        incompleteWalks: [],
        failedWalks: [],
        oltResults: [],
    };
}

module.exports = {
    parsePonList,
    parseOnuList,
    uraiOnuId,
    bacaOlt,
    getWebOpticalSnapshot,
    fetchPage,
    DEFAULTS,
    STRIDE,
    IDX,
};
