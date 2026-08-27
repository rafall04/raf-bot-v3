/**
 * Header Doc
 * Purpose: Alur GANTI MODEM untuk admin & teknisi — memindahkan seorang pelanggan dari modem
 *          lama ke modem baru, lengkap dengan memindahkan nama & sandi WiFi-nya, lalu
 *          melaporkan hasilnya LANGKAH DEMI LANGKAH.
 *
 *          !! KENAPA KREDENSIAL WIFI JADI INTI: tabel `users` TIDAK menyimpan SSID maupun
 *          sandi WiFi — keduanya hanya hidup di modem. Ganti modem tanpa memindahkannya
 *          berarti pelanggan pulang ke rumah dengan WiFi bernama bawaan pabrik dan sandi
 *          yang tak mereka ketahui: semua perangkat di rumah terputus, dan teknisi sudah
 *          pergi. Karena itu modul ini MENOLAK melanjutkan diam-diam bila kredensialnya tak
 *          bisa dipastikan — ia meminta teknisi mengisinya.
 *
 *          Urutan sengaja: WiFi diterapkan & DIVERIFIKASI ke modem baru DULU, baru
 *          `device_id` disimpan. Kalau dibalik, kegagalan penerapan meninggalkan pelanggan
 *          "pindah di data" tapi modemnya belum siap — dan setiap pembacaan berikutnya
 *          menatap perangkat yang salah. Dengan urutan ini, gagal = tak ada yang berubah,
 *          dan teknisi tinggal mengulang.
 *
 *          Sumber kredensial, berurutan: (1) yang diketik teknisi, (2) dibaca dari modem
 *          LAMA lewat ACS, (3) entri terakhir `wifi_change_logs.json`. Modem lama sering
 *          sudah mati — justru itu alasan penggantiannya — jadi (2) memang kerap gagal dan
 *          bukan keadaan luar biasa.
 * Caller: `routes/admin-modem-replacement-routes.js` (API admin & teknisi).
 * Deps (semua bisa di-inject untuk tes): `./wifi` (getSSIDInfo, updateWifiSettings),
 *       `./wifi-apply-guard` (assertWifiChangeApplied), `./wifi-bulk-reconcile`
 *       (fetchDeviceCapability), `./genieacs` (queryDevices), `./wifi-logger`,
 *       `./activity-logger`, `global.users` + `global.db`.
 * MainFuncs: `gantiModem`, `LANGKAH`.
 * SideEffects: menulis SSID/sandi ke modem BARU, memperbarui `users.device_id` (+ `bulk`),
 *              menulis log aktivitas & log perubahan WiFi. NEVER-THROW di tingkat atas.
 */
"use strict";

const LANGKAH = Object.freeze({
    PELANGGAN: "pelanggan",
    DEVICE_BARU: "device-baru",
    BELUM_DIPAKAI: "belum-dipakai",
    KREDENSIAL: "kredensial-wifi",
    TERAP_WIFI: "terapkan-wifi",
    SIMPAN: "simpan-device-id",
    CATAT: "catat",
});

function hasil(kode, ok, pesan, extra = {}) {
    return { langkah: kode, ok, pesan, ...extra };
}

function bersihkanId(v) {
    return String(v == null ? "" : v).trim();
}

/**
 * @param {{customerId:any, deviceIdBaru:string, ssid?:string, password?:string, aktor?:object}} input
 * @param {object} deps
 * @returns {Promise<{ok:boolean, butuhKredensial:boolean, langkah:Array, pesan:string}>}
 */
async function gantiModem(input = {}, deps = {}) {
    const langkah = [];
    const catat = (h) => { langkah.push(h); return h; };

    const getUsers = deps.getUsers || (() => global.users || []);
    const queryDevices = deps.queryDevices || ((o) => require("./genieacs").queryDevices(o));
    const getSSIDInfo = deps.getSSIDInfo || ((id) => require("./wifi").getSSIDInfo(id, false));
    const updateWifiSettings = deps.updateWifiSettings || ((id, p, o) => require("./wifi").updateWifiSettings(id, p, o));
    const assertWifiChangeApplied = deps.assertWifiChangeApplied
        || ((r) => require("./wifi-apply-guard").assertWifiChangeApplied(r));
    const fetchDeviceCapability = deps.fetchDeviceCapability
        || ((id, o) => require("./wifi-bulk-reconcile").fetchDeviceCapability(id, o));
    const simpanDeviceId = deps.simpanDeviceId || simpanDeviceIdDefault;
    const bacaRiwayatWifi = deps.bacaRiwayatWifi || bacaRiwayatWifiDefault;
    const logAktivitas = deps.logActivity || ((...a) => { try { require("./activity-logger").logActivity(...a); } catch (_e) { /* diam */ } });
    const logWifi = deps.logWifiChange || null;

    try {
        const deviceBaru = bersihkanId(input.deviceIdBaru);
        const users = getUsers();

        // 1) Pelanggan
        const pelanggan = (users || []).find((u) => u && String(u.id) === String(input.customerId));
        if (!pelanggan) {
            catat(hasil(LANGKAH.PELANGGAN, false, "Pelanggan tidak ditemukan."));
            return { ok: false, butuhKredensial: false, langkah, pesan: "Pelanggan tidak ditemukan." };
        }
        const deviceLama = bersihkanId(pelanggan.device_id);
        catat(hasil(LANGKAH.PELANGGAN, true, `${pelanggan.name || pelanggan.pppoe_username || pelanggan.id}`, { deviceLama }));

        if (!deviceBaru) {
            catat(hasil(LANGKAH.DEVICE_BARU, false, "ID modem baru belum diisi."));
            return { ok: false, butuhKredensial: false, langkah, pesan: "ID modem baru belum diisi." };
        }
        if (deviceBaru === deviceLama) {
            catat(hasil(LANGKAH.DEVICE_BARU, false, "Modem baru sama dengan modem yang sekarang."));
            return { ok: false, butuhKredensial: false, langkah, pesan: "Modem baru sama dengan yang sekarang." };
        }

        // 2) Modem baru HARUS sudah terlihat di ACS — kalau tidak, tak ada yang bisa disetel.
        let adaDiAcs = false;
        try {
            const r = await queryDevices({ query: { _id: deviceBaru }, projection: "_id", limit: 1, operation: "gantiModem.cekDevice" });
            adaDiAcs = !!(r && r.data && r.data.length);
        } catch (_e) {
            adaDiAcs = false;
        }
        if (!adaDiAcs) {
            catat(hasil(LANGKAH.DEVICE_BARU, false,
                "Modem baru belum terlihat di ACS. Pastikan sudah menyala, terpasang fiber, dan sudah pernah lapor ke sistem."));
            return { ok: false, butuhKredensial: false, langkah, pesan: "Modem baru belum terlihat di ACS." };
        }
        catat(hasil(LANGKAH.DEVICE_BARU, true, "Modem baru terlihat di ACS."));

        // 3) Jangan merebut modem milik pelanggan lain.
        const pemilikLain = (users || []).find((u) => u && String(u.id) !== String(pelanggan.id)
            && String(u.device_id || "").split("|").map((s) => s.trim()).includes(deviceBaru));
        if (pemilikLain) {
            catat(hasil(LANGKAH.BELUM_DIPAKAI, false,
                `Modem itu masih tercatat milik pelanggan lain (${pemilikLain.name || pemilikLain.id}). Lepaskan dulu di sana.`));
            return { ok: false, butuhKredensial: false, langkah, pesan: "Modem sudah dipakai pelanggan lain." };
        }
        catat(hasil(LANGKAH.BELUM_DIPAKAI, true, "Modem belum dipakai pelanggan lain."));

        // 4) Kredensial WiFi — diketik teknisi > dibaca modem lama > riwayat perubahan.
        let ssid = bersihkanId(input.ssid);
        let password = input.password == null ? "" : String(input.password);
        let sumberKredensial = ssid && password ? "diisi teknisi" : null;

        if (!ssid || !password) {
            if (deviceLama) {
                try {
                    const info = await getSSIDInfo(deviceLama);
                    const dariModem = ambilSsidPertama(info);
                    if (!ssid && dariModem.ssid) { ssid = dariModem.ssid; sumberKredensial = "modem lama"; }
                    if (!password && dariModem.password) { password = dariModem.password; sumberKredensial = sumberKredensial || "modem lama"; }
                } catch (_e) {
                    // Modem lama memang sering sudah mati — itu justru alasan penggantiannya.
                }
            }
        }
        if (!ssid || !password) {
            try {
                const riwayat = await bacaRiwayatWifi(pelanggan.id, deviceLama);
                if (!ssid && riwayat.ssid) { ssid = riwayat.ssid; sumberKredensial = sumberKredensial || "riwayat perubahan"; }
                if (!password && riwayat.password) { password = riwayat.password; sumberKredensial = sumberKredensial || "riwayat perubahan"; }
            } catch (_e) { /* diam */ }
        }

        if (!ssid || !password) {
            // TIDAK melanjutkan diam-diam. Modem baru dengan setelan pabrik = seluruh
            // perangkat di rumah pelanggan gagal tersambung setelah teknisi pulang.
            catat(hasil(LANGKAH.KREDENSIAL, false,
                "Nama WiFi & sandi tidak bisa dipastikan (modem lama tak terbaca dan tak ada di riwayat). "
                + "Isi manual supaya WiFi pelanggan tidak berubah."));
            return {
                ok: false,
                butuhKredensial: true,
                langkah,
                pesan: "Butuh nama WiFi & sandi.",
                saran: { ssid: ssid || "", password: password || "" },
            };
        }
        catat(hasil(LANGKAH.KREDENSIAL, true, `Nama & sandi WiFi diambil dari ${sumberKredensial}.`, { ssid, sumber: sumberKredensial }));

        // 5) Terapkan ke modem BARU lalu buktikan diterima — sebelum data diubah.
        const indeks = await indeksSsidUntuk(deviceBaru, fetchDeviceCapability);
        const payload = {};
        for (const i of indeks) {
            payload[`ssid_${i}`] = ssid;
            payload[`ssid_password_${i}`] = password;
        }
        try {
            const resp = await updateWifiSettings(deviceBaru, payload, { verifyApplied: true });
            assertWifiChangeApplied(resp);
            catat(hasil(LANGKAH.TERAP_WIFI, true, `Nama & sandi WiFi terpasang di modem baru (SSID ${indeks.join(" & ")}).`));
        } catch (e) {
            catat(hasil(LANGKAH.TERAP_WIFI, false,
                "Gagal memasang nama/sandi WiFi ke modem baru — penggantian DIBATALKAN, data pelanggan belum diubah. "
                + "Pastikan modem baru menyala lalu ulangi."));
            return { ok: false, butuhKredensial: false, langkah, pesan: "Gagal memasang WiFi ke modem baru.", detail: e && e.message };
        }

        // 6) Baru simpan kepemilikannya.
        let bulkBaru = null;
        try {
            const cap = await fetchDeviceCapability(deviceBaru, { operation: "gantiModem.kapabilitas" });
            if (cap && cap.found && cap.expectedBulk) bulkBaru = cap.expectedBulk;
        } catch (_e) { /* biarkan bulk apa adanya */ }

        try {
            await simpanDeviceId(pelanggan, deviceBaru, bulkBaru);
            catat(hasil(LANGKAH.SIMPAN, true, "Modem baru tercatat untuk pelanggan ini."
                + (bulkBaru ? ` Kolom band disesuaikan (${bulkBaru}).` : "")));
        } catch (e) {
            catat(hasil(LANGKAH.SIMPAN, false,
                "WiFi sudah terpasang di modem baru, TAPI pencatatan gagal — ulangi penggantian agar datanya ikut berpindah."));
            return { ok: false, butuhKredensial: false, langkah, pesan: "Gagal menyimpan modem baru.", detail: e && e.message };
        }

        // 7) Jejak.
        try {
            logAktivitas({
                type: "ganti_modem",
                user: (input.aktor && (input.aktor.username || input.aktor.name)) || "?",
                detail: `Ganti modem ${pelanggan.name || pelanggan.id}: ${deviceLama || "(kosong)"} -> ${deviceBaru}`,
            });
        } catch (_e) { /* diam */ }
        if (typeof logWifi === "function") {
            try { await logWifi({ pelanggan, deviceBaru, ssid, password, aktor: input.aktor }); } catch (_e) { /* diam */ }
        }
        catat(hasil(LANGKAH.CATAT, true, "Tercatat di riwayat."));

        return {
            ok: true,
            butuhKredensial: false,
            langkah,
            pesan: `Modem ${pelanggan.name || pelanggan.id} berhasil diganti. Nama & sandi WiFi tetap sama.`,
            deviceLama,
            deviceBaru,
        };
    } catch (e) {
        catat(hasil("tak-terduga", false, (e && e.message) || "Kesalahan tak terduga."));
        return { ok: false, butuhKredensial: false, langkah, pesan: "Gagal: " + ((e && e.message) || "tak terduga") };
    }
}

/** Ambil SSID/sandi pertama yang terisi dari hasil `getSSIDInfo`. */
function ambilSsidPertama(info) {
    const keluar = { ssid: "", password: "" };
    if (!info) return keluar;
    const daftar = Array.isArray(info) ? info : (Array.isArray(info.ssids) ? info.ssids : []);
    for (const s of daftar) {
        if (!s) continue;
        if (!keluar.ssid && s.ssid) keluar.ssid = String(s.ssid);
        if (!keluar.password && (s.password || s.keyPassphrase)) keluar.password = String(s.password || s.keyPassphrase);
        if (keluar.ssid && keluar.password) break;
    }
    if (!keluar.ssid && info.ssid) keluar.ssid = String(info.ssid);
    if (!keluar.password && info.password) keluar.password = String(info.password);
    return keluar;
}

/** Indeks SSID yang harus disetel: ikut kapabilitas band modem BARU (2.4 saja / 2.4 + 5). */
async function indeksSsidUntuk(deviceId, fetchDeviceCapability) {
    try {
        const cap = await fetchDeviceCapability(deviceId, { operation: "gantiModem.indeksSsid" });
        if (cap && cap.found && cap.has5G) return ["1", "5"];
    } catch (_e) { /* jatuh ke 2.4 saja */ }
    return ["1"];
}

/** Entri TERAKHIR di wifi_change_logs.json untuk pelanggan/device ini. */
async function bacaRiwayatWifiDefault(userId, deviceLama) {
    const fs = require("fs");
    const path = require("path");
    const berkas = path.join(__dirname, "..", "database", "wifi_change_logs.json");
    const keluar = { ssid: "", password: "" };
    try {
        const mentah = JSON.parse(fs.readFileSync(berkas, "utf8"));
        const daftar = Array.isArray(mentah) ? mentah : (mentah.logs || []);
        for (let i = daftar.length - 1; i >= 0; i--) {
            const e = daftar[i];
            if (!e) continue;
            const cocok = String(e.userId) === String(userId)
                || (deviceLama && String(e.deviceId || "") === String(deviceLama));
            if (!cocok) continue;
            const c = e.changes || {};
            if (!keluar.password && c.newPassword) keluar.password = String(c.newPassword);
            if (!keluar.ssid && (c.newSSID || c.newSsid || c.newName)) keluar.ssid = String(c.newSSID || c.newSsid || c.newName);
            if (keluar.ssid && keluar.password) break;
        }
    } catch (_e) { /* berkas belum ada = bukan kesalahan */ }
    return keluar;
}

/** Simpan device_id (dan bulk) ke DB + memori. */
function simpanDeviceIdDefault(pelanggan, deviceBaru, bulkBaru) {
    return new Promise((resolve, reject) => {
        const sekarang = new Date().toISOString();
        const kolom = bulkBaru ? "device_id = ?, bulk = ?, updated_at = ?" : "device_id = ?, updated_at = ?";
        const nilai = bulkBaru ? [deviceBaru, bulkBaru, sekarang, pelanggan.id] : [deviceBaru, sekarang, pelanggan.id];
        if (!global.db || typeof global.db.run !== "function") return reject(new Error("Database tidak siap"));
        global.db.run(`UPDATE users SET ${kolom} WHERE id = ?`, nilai, function (err) {
            if (err) return reject(err);
            pelanggan.device_id = deviceBaru;
            if (bulkBaru) pelanggan.bulk = bulkBaru;
            pelanggan.updated_at = sekarang;
            resolve();
        });
    });
}


/**
 * Teknisi memegang modem dan membaca STIKER-nya, bukan device-id ACS. Terima ketiganya:
 *   · device-id ACS penuh   `00259E-HG8145V5-485754437C8EBEB1`
 *   · serial ACS (16 heksa) `485754437C8EBEB1`
 *   · SN stiker             `HWTC7C8EBEB1`  (4 huruf vendor + 8 heksa)
 *
 * SN stiker adalah 4 karakter ASCII vendor yang di ACS tersimpan sebagai heksa. Ini kebalikan
 * `stickerSn()` di psb.state — sengaja dibuat di sini supaya jalur WEB dan WA memakai satu
 * pemahaman yang sama, bukan dua salinan yang lama-lama berbeda.
 */
function stikerKeSerialAcs(teks) {
    const t = String(teks || "").trim().toUpperCase();
    const m = t.match(/^([A-Z]{4})([0-9A-F]{8})$/);
    if (!m) return null;
    let heks = "";
    for (const ch of m[1]) heks += ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
    return heks + m[2];
}

/**
 * Petakan apa pun yang diketik teknisi menjadi SATU device-id ACS.
 * @returns {Promise<{deviceId:string|null, kandidat:Array, alasan:string|null}>}
 */
async function cariDevice(teks, deps = {}) {
    const queryDevices = deps.queryDevices || ((o) => require("./genieacs").queryDevices(o));
    const masuk = String(teks || "").trim();
    if (!masuk) return { deviceId: null, kandidat: [], alasan: "kosong" };

    // 1) Sudah berupa device-id penuh? Pakai apa adanya bila ada di ACS.
    if (masuk.includes("-")) {
        try {
            const r = await queryDevices({ query: { _id: masuk }, projection: "_id", limit: 1, operation: "gantiModem.cariDevice.id" });
            if (r && r.data && r.data.length) return { deviceId: masuk, kandidat: [], alasan: null };
        } catch (_e) { /* lanjut ke pencarian serial */ }
    }

    // 2) Serial ACS langsung, atau SN stiker yang diterjemahkan dulu.
    const serial = /^[0-9a-fA-F]{16}$/.test(masuk) ? masuk.toUpperCase() : stikerKeSerialAcs(masuk);
    if (!serial) return { deviceId: null, kandidat: [], alasan: "tak dikenali" };
    try {
        const r = await queryDevices({
            query: { "_deviceId._SerialNumber": serial },
            projection: "_id,_deviceId",
            limit: 5,
            operation: "gantiModem.cariDevice.serial",
        });
        const daftar = (r && r.data) || [];
        if (daftar.length === 1) return { deviceId: daftar[0]._id, kandidat: daftar, alasan: null };
        if (daftar.length > 1) return { deviceId: null, kandidat: daftar, alasan: "lebih dari satu" };
    } catch (_e) { /* diam */ }
    return { deviceId: null, kandidat: [], alasan: "tak ditemukan" };
}

module.exports = { gantiModem, cariDevice, stikerKeSerialAcs, LANGKAH, _internal: { ambilSsidPertama, indeksSsidUntuk, bacaRiwayatWifiDefault } };
