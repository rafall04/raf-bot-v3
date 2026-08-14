/**
 * Header Doc
 * Purpose: Tentukan ASAL-USUL & KELAYAKAN sebuah modem untuk dipakai PSB — modem BARU (polos),
 *          BEKAS pelanggan yang sudah putus, atau MASIH TERPAKAI pelanggan hidup. Dua gunanya:
 *          (1) teknisi tak perlu tahu modem itu bekas siapa — bot yang menyimpulkan lalu memberi label;
 *          (2) GERBANG: modem yang masih melayani orang TIDAK boleh ditimpa, karena push PSB akan
 *          mengganti PPPoE + WiFi-nya → pelanggan itu mati internet tanpa ada yang tahu sebabnya.
 * Caller: `message/handlers/state-domains/psb.state.js` (wizard PSB DM).
 * Deps (semua boleh di-inject utk test): `lib/mikrotik.getActivePPPoEUsers` (sumber kebenaran "sedang
 *        dipakai"), `repositories/olt-incident.repository.getModemStateByPppoe` (riwayat OLT = satu-satunya
 *        jejak pemilik lama yang SELAMAT dari penghapusan pelanggan), `global.users` (snapshot pelanggan).
 * MainFuncs: `loadActivePppoeUsernames(deps)`, `classifyModemCandidate(candidate, ctx)`,
 *            `enrichPreviousOwner(classification, deps)`, `describeCandidate(candidate, ctx, deps)`,
 *            `candidateBadge(classification)`.
 * SideEffects: HANYA baca (MikroTik read-only + SQLite olt_state read-only). NEVER-THROW: kegagalan
 *              baca dilaporkan lewat `sessionsKnown:false`, bukan exception.
 * LINTAS-AREA: aturan #1 (sesi router) & #2 (baris pelanggan) hanya melihat AREA SENDIRI, padahal
 *              GenieACS dipakai bersama dua bot. Aturan #3½ menutupnya dengan bukti dari ACS yang
 *              sama-sama dilihat kedua bot: `candidate.pppUptimeSeconds > 0` = sesi PPPoE modem ini
 *              hidup di SUATU router ⇒ `terpakai` (`ownerSource:"sesi_modem_aktif"`, ownerName null
 *              karena pemiliknya di luar jangkauan bot ini). Dipasang SESUDAH aturan #3 supaya modem
 *              polos `tes@hw` tak ikut terblokir; `null` (tak terbaca) sengaja TIDAK memblokir.
 */
"use strict";

// PPPoE bawaan modem polos. Diverifikasi di lapangan: secret `tes@hw` memang ada & aktif di kedua
// router (profil bandwidth kecil) — itulah "pintu masuk" modem yang belum punya kredensial pelanggan.
const DEFAULT_PPPOE_USERNAMES = new Set(["tes@hw"]);

function normalizePppoe(value) {
    return String(value === null || value === undefined ? "" : value).trim().toLowerCase();
}

function unwrapMikrotikList(result) {
    if (Array.isArray(result)) return result;
    if (!result || typeof result !== "object") return [];
    if (Array.isArray(result.data)) return result.data;
    if (result.data && Array.isArray(result.data.data)) return result.data.data;
    if (Array.isArray(result.items)) return result.items;
    return [];
}

/**
 * Daftar username PPPoE yang SEDANG punya sesi aktif di MikroTik.
 * Mengembalikan `null` bila router tak terbaca — `null` berarti "TIDAK TAHU", bukan "tidak ada
 * yang aktif". Pembedaan ini penting: gerbang di bawah tetap jalan lewat tautan baris pelanggan,
 * dan teknisi diberi tahu bahwa status sesi tak terbaca (jangan mengaku tahu padahal buta).
 */
async function loadActivePppoeUsernames(deps = {}) {
    try {
        const getActivePPPoEUsers = deps.getActivePPPoEUsers || require("./mikrotik").getActivePPPoEUsers;
        if (typeof getActivePPPoEUsers !== "function") return null;
        const raw = await getActivePPPoEUsers({ caller: "psb.modemProvenance" });
        if (raw && raw.ok === false) return null;
        const list = unwrapMikrotikList(raw);
        if (!list.length) return new Set();
        return new Set(list.map((s) => normalizePppoe(s && s.name)).filter(Boolean));
    } catch (e) {
        deps.logger?.error?.("[PSB_PROVENANCE] gagal baca sesi PPPoE aktif:", e.message);
        return null;
    }
}

/**
 * Klasifikasi MURNI (tanpa I/O) sebuah kandidat modem.
 * Urutan aturan sengaja GAGAL-TERTUTUP: bukti "masih dipakai" diperiksa lebih dulu, dan bila
 * ragu modem dianggap tak boleh dipakai.
 *
 * @param {object} candidate  kandidat dari psb-genieacs-service ({deviceId, serialNumber, currentPPPUsername, ...})
 * @param {object} ctx        { users: [], activeUsernames: Set|null }
 * @returns {{state:string, assignable:boolean, ownerName:string|null, ownerSource:string|null,
 *            previousPppoe:string|null, sessionsKnown:boolean, reason:string|null}}
 */
// Batas "modem ini masih terlihat hidup". Nilai ACS (termasuk Uptime) hanya sesegar inform
// terakhir — terukur 160/160 device: stempel parameter SELALU sama dengan `_lastInform`. Jadi
// modem yang DICABUT tetap menyimpan uptime besar selamanya, dan uptime saja bukan bukti
// "sedang dipakai". Ambang 30 menit dipilih dari sebaran nyata: 156/160 device inform ≤30 mnt
// (ACS ini inform ~setiap 12 menit), sama dengan ambang yang sudah dipakai layar konfirmasi.
const INFORM_SEGAR_MS = 30 * 60 * 1000;

function informMasihSegar(candidate, nowMs) {
    const t = Date.parse((candidate && candidate.lastInform) || "");
    if (!Number.isFinite(t)) return false;           // tak terbaca ⇒ jangan mengaku tahu
    return (nowMs - t) <= INFORM_SEGAR_MS;
}

function classifyModemCandidate(candidate, { users = [], activeUsernames = null, nowMs = Date.now() } = {}) {
    const pppoe = normalizePppoe(candidate && candidate.currentPPPUsername);
    // Modem dgn WAN TR-069 terpisah bisa membawa >1 username PPPoE (index berbeda). Semua ikut
    // diperiksa — pelanggan hidup yang device_id-nya kosong hanya tertangkap lewat tautan PPPoE,
    // dan PPPoE-nya bisa saja duduk di WANConnectionDevice non-1 (insiden Dander 2026-08-07).
    const allUsernames = [...new Set([
        pppoe,
        ...((candidate && Array.isArray(candidate.allPPPUsernames)) ? candidate.allPPPUsernames.map(normalizePppoe) : []),
    ].filter(Boolean))];
    const nonDefaultUsernames = allUsernames.filter((u) => !DEFAULT_PPPOE_USERNAMES.has(u));
    const deviceId = String((candidate && candidate.deviceId) || "");
    const list = Array.isArray(users) ? users : [];
    const sessionsKnown = activeUsernames instanceof Set;
    // `butuhKonfirmasi` = bukti cukup untuk MENAHAN, tapi tidak cukup untuk MENOLAK. Pemanggil
    // wajib meminta penegasan teknisi, bukan membatalkan pekerjaannya.
    const base = { previousPppoe: null, sessionsKnown, butuhKonfirmasi: false, deviceTercatatPemilik: null };

    // Kredensial BAWAAN PABRIK dipakai BERSAMA oleh semua modem polos, jadi ia tak pernah menunjuk
    // ke satu pelanggan tertentu. Diperiksa lebih dulu supaya tak dipakai sebagai bukti kepemilikan
    // di aturan #1 & #2 di bawah. "Polos" = TIDAK ADA satu pun username non-bawaan yang tertulis.
    const isDefaultPppoe = nonDefaultUsernames.length === 0;

    // 1) SEDANG melayani sesi PPPoE aktif → jangan sentuh.
    //    Sumber kebenaran "modem ini sedang dipakai" adalah daftar SESI AKTIF, bukan field
    //    `last-logged-out` di secret: secret milik pelanggan yang justru sedang online berbunyi
    //    "jan/01/1970" dengan caller-id kosong (dia belum pernah logout) — nyaris menipu.
    //
    //    KECUALI kredensial bawaan (`tes@hw`). Modem polos yang baru dicolok PASTI punya sesi
    //    `tes@hw` yang aktif — itulah cara dia online. Jadi sesi aktif atas nama kredensial bawaan
    //    adalah bukti "modem ini polos DAN sedang menyala", bukan bukti dia melayani seseorang.
    //    Tanpa pengecualian ini aturan #3 tak pernah tercapai dan SETIAP modem baru divonis
    //    "TERPAKAI pelanggan lain" → PSB mustahil diselesaikan (insiden Tanjungharjo 2026-08-02).
    const segar = informMasihSegar(candidate, nowMs);

    // Apakah baris pelanggan menunjuk MODEM LAIN? Itu tanda TUKAR MODEM: pelanggan sudah pindah ke
    // modem baru, dan yang di tangan teknisi adalah modem lamanya yang memang sudah bebas. Terbukti
    // ada di ACS produksi (satu username di dua device, yang lama berhenti inform 38 hari lalu).
    // Kalau `device_id` pelanggan kosong, kita tak bisa menyimpulkan apa pun → jangan mengaku tahu.
    const petunjukTukar = (owner) => {
        const tercatat = String((owner && owner.device_id) || "");
        return !!tercatat && !!deviceId && tercatat !== deviceId;
    };

    const activeUsername = sessionsKnown
        ? nonDefaultUsernames.find((u) => activeUsernames.has(u))
        : null;
    if (activeUsername) {
        const owner = list.find((u) => normalizePppoe(u && u.pppoe_username) === activeUsername);
        const tukar = petunjukTukar(owner);
        return {
            ...base,
            state: "terpakai",
            // Sesi atas nama kredensial ini memang hidup — tapi belum tentu DARI modem INI.
            // Kalau baris pelanggan menunjuk modem lain, yang hidup itu modem penggantinya dan
            // yang di tangan teknisi adalah modem lama. Jangan menolak pekerjaan yang sah;
            // minta teknisi menegaskan, karena hanya dia yang bisa melihat kabelnya.
            assignable: false,
            butuhKonfirmasi: true,
            ownerName: (owner && owner.name) || null,
            ownerSource: "sesi_aktif",
            deviceTercatatPemilik: (owner && owner.device_id) || null,
            reason: tukar
                ? "kredensialnya sedang dipakai, tapi baris pelanggan menunjuk modem LAIN (kemungkinan modem ini sudah diganti)"
                : "modem sedang melayani sesi PPPoE yang aktif"
        };
    }

    // 2) Masih TERTAUT baris pelanggan (lewat device_id, atau lewat username PPPoE bila device_id
    //    belum tersinkron — kasus nyata: ada modem pelanggan hidup yang device_id-nya kosong).
    //    Di operasi ini pelanggan yang berhenti DIHAPUS barisnya, jadi baris yang masih ada
    //    berarti masih pelanggan. Gagal-tertutup: lepas tautannya dulu, baru modem boleh dipakai.
    //    Tautan lewat PPPoE sengaja MENGABAIKAN kredensial bawaan: satu baris pelanggan yang
    //    (keliru) tersimpan ber-PPPoE `tes@hw` akan mengklaim SELURUH modem polos sekaligus.
    //    Tautan lewat `device_id` tetap berlaku penuh — itu menunjuk satu modem, bukan sekelas.
    const linkedByDevice = deviceId ? list.find((u) => String((u && u.device_id) || "") === deviceId) : null;
    const linkedByPppoe = nonDefaultUsernames.length
        ? list.find((u) => nonDefaultUsernames.includes(normalizePppoe(u && u.pppoe_username)))
        : null;
    const linked = linkedByDevice || linkedByPppoe;
    if (linked) {
        // SATU-SATUNYA vonis yang benar-benar TOLAK: modem INI tertaut `device_id` pelanggan DAN
        // masih terlihat hidup. Di situ modem yang dipegang teknisi memang modem yang sedang
        // melayani — menimpanya pasti mematikan pelanggan itu.
        // Selain itu evidensinya tak cukup untuk menolak pekerjaan yang mungkin sah:
        //  • tertaut lewat PPPoE saja (device_id pelanggan menunjuk modem lain / kosong) = pola
        //    tukar modem, dan modem lama memang harus bisa dipakai PSB berikutnya;
        //  • tertaut device_id tapi sudah lama tak inform = kemungkinan besar sudah dicopot.
        // Diturunkan jadi konfirmasi HANYA bila ada bukti POSITIF modem itu sudah lama tak terlihat.
        // Data yang tak terbaca tetap ditolak keras — baris pelanggan sudah cukup jadi alasan.
        // TIDAK ada penolakan keras lagi. Bot tak pernah bisa tahu di mana modem itu berada
        // SECARA FISIK — dan itulah satu-satunya fakta yang menentukan. Kasus paling sering:
        // pelanggan sudah berhenti tapi barisnya belum ditutup admin; menolaknya membuat teknisi
        // buntu untuk pekerjaan yang sah. Yang mengikat keputusan ke modem fisik adalah STIKER di
        // belakang modem, dan hanya teknisi yang bisa membacanya — jadi dia yang menegaskan.
        // (MAC sempat dipertimbangkan sebagai pembeda otomatis lalu DIBATALKAN: terukur hanya
        // 34/160 device mengekspos MAC di ACS, dan yang terbaca pun MAC LAN yang beda satu bit
        // dari `caller_id` PPPoE — 1 cocok vs 16 beda.)
        const tolakKeras = false;
        return {
            ...base,
            state: "terpakai",
            assignable: false,
            butuhKonfirmasi: !tolakKeras,
            ownerName: linked.name || null,
            ownerSource: linkedByDevice ? "device_id" : "pppoe",
            deviceTercatatPemilik: linked.device_id || null,
            reason: tolakKeras
                ? "modem ini tercatat sebagai modem yang SEDANG dipakai pelanggan itu"
                : (linkedByDevice
                    ? "modem tertaut pelanggan itu, tapi sudah lama tak terlihat di jaringan"
                    : "kredensialnya milik pelanggan itu, tapi modem yang tercatat untuknya BERBEDA")
        };
    }

    // 3) PPPoE bawaan / kosong → modem polos, aman dipakai.
    if (isDefaultPppoe) {
        return { ...base, state: "baru", assignable: true, ownerName: null, ownerSource: null, reason: null };
    }

    // 3½) MODEM INI SEDANG MEMEGANG SESI PPPoE HIDUP — di router mana pun, termasuk AREA LAIN.
    //    Aturan #1 hanya melihat sesi router SENDIRI dan aturan #2 hanya melihat pelanggan SENDIRI,
    //    padahal GenieACS dipakai BERSAMA dua bot. Terukur di ACS Dander 2026-08-14: dari 160
    //    device, 97 adalah modem pelanggan HIDUP di Tanjungharjo — dan gerbang lama meloloskan
    //    SEMUANYA sebagai "♻️ BEKAS, boleh dipakai". Menimpanya = 97 pelanggan area sebelah mati
    //    internet tanpa ada yang tahu sebabnya, persis yang Header Doc modul ini janji cegah.
    //    Pembeda yang dipakai bukan realm (kedua area memakai @rafcybernet — tak bisa dibedakan)
    //    dan bukan `ConnectionStatus` (hanya terbaca ~68%), melainkan `Uptime` PPPoE yang terbaca
    //    di 160/160 device. Uptime > 0 = sesi berhasil terbentuk di suatu router ⇒ ada yang memakai.
    //    Modem POLOS tidak terkena: kredensial bawaan sudah lolos di aturan #3 di atas.
    //    Modem yang benar-benar bebas tak punya secret yang diterima router mana pun → sesinya tak
    //    pernah terbentuk → uptime 0/absen → tetap boleh dipakai.
    //    `null` (tak terbaca) SENGAJA tidak memblokir: "tidak tahu" bukan "terbukti terpakai".
    //    WAJIB DIBARENGI INFORM SEGAR. Nilai ACS hanya sesegar inform terakhir (terukur: stempel
    //    parameter = `_lastInform` di 160/160 device), jadi modem yang DICABUT tetap menyimpan
    //    uptime besar selamanya. Memakai uptime sendirian akan memblokir modem bebas SELAMANYA —
    //    terbukti ada contohnya di ACS: satu modem ber-uptime 425.221 detik yang sudah berhenti
    //    inform 38 HARI. Bukti basi bukan bukti.
    //    Hasilnya KONFIRMASI, bukan tolak: pemiliknya di luar jangkauan bot ini, jadi hanya teknisi
    //    di lapangan yang bisa memastikan kabel modem ini sudah lepas dari pelanggan lamanya.
    const uptime = candidate && candidate.pppUptimeSeconds;
    if (segar && Number.isFinite(uptime) && uptime > 0) {
        return {
            ...base,
            state: "terpakai",
            assignable: false,
            butuhKonfirmasi: true,
            ownerName: null,
            ownerSource: "sesi_modem_aktif",
            previousPppoe: nonDefaultUsernames[0] || null,
            reason: "modem ini masih terlihat memegang sesi internet (kemungkinan pelanggan area lain)"
        };
    }

    // 4) Sisanya: modem masih membawa PPPoE milik seseorang yang SUDAH TIDAK ADA di daftar
    //    pelanggan → modem copotan. Nama pemilik lama dilengkapi terpisah dari riwayat OLT.
    //    `previousPppoe` = username non-bawaan pertama yang terbaca (bentuk asli bila tersedia).
    const previousRaw = (candidate && candidate.currentPPPUsername
        && !DEFAULT_PPPOE_USERNAMES.has(normalizePppoe(candidate.currentPPPUsername)))
        ? candidate.currentPPPUsername
        : nonDefaultUsernames[0];
    return {
        ...base,
        state: "bekas",
        assignable: true,
        ownerName: null,
        ownerSource: null,
        previousPppoe: previousRaw || null,
        reason: null
    };
}

/**
 * Lengkapi NAMA pemilik lama untuk modem berstatus `bekas`.
 * Riwayat OLT (`olt_modem_state`) adalah satu-satunya sumber yang SELAMAT dari penghapusan
 * pelanggan — baris users, secret MikroTik, dan (kadang) catatan ACS ikut hilang saat pelanggan
 * dihapus, tapi snapshot OLT tetap menyimpan nama + PPPoE + alamat pemilik terakhir.
 */
async function enrichPreviousOwner(classification, deps = {}) {
    if (!classification || classification.state !== "bekas" || !classification.previousPppoe) {
        return classification;
    }
    try {
        const repo = deps.oltRepository
            || require("../repositories/olt-incident.repository").getOltIncidentRepository();
        if (!repo || typeof repo.getModemStateByPppoe !== "function") return classification;
        const row = await repo.getModemStateByPppoe(classification.previousPppoe);
        if (row && row.customer_name) {
            return { ...classification, ownerName: row.customer_name, ownerSource: "riwayat_olt" };
        }
    } catch (e) {
        deps.logger?.error?.("[PSB_PROVENANCE] gagal baca riwayat OLT:", e.message);
    }
    return classification;
}

async function describeCandidate(candidate, ctx = {}, deps = {}) {
    return enrichPreviousOwner(classifyModemCandidate(candidate, ctx), deps);
}

// Label pendek untuk daftar modem di WhatsApp. Teknisi tak perlu tahu istilahnya —
// dia cuma mencocokkan SN; label ini yang menjelaskan kenapa sebuah modem boleh/tak boleh dipakai.
function candidateBadge(classification) {
    if (!classification) return "";
    if (classification.state === "terpakai") {
        // Dua rasa berbeda: yang TERBUKTI sedang melayani (⛔, tak boleh diteruskan) versus yang
        // masih meragukan (⚠️, teknisi yang memutuskan setelah melihat kabelnya sendiri).
        if (classification.butuhKonfirmasi) {
            return `⚠️ PERLU DIPASTIKAN${classification.ownerName ? ` (bekas ${classification.ownerName}?)` : ""}`;
        }
        return `⛔ TERPAKAI${classification.ownerName ? ` (${classification.ownerName})` : ""}`;
    }
    // Saat sesi MikroTik TAK TERBACA, vonis "boleh dipakai" hanya berdiri di atas SATU lapis bukti
    // (tautan baris pelanggan). Lapis itu terbukti menangkap semua pelanggan terdaftar, tapi modem
    // yang masih menyala atas nama pelanggan yang barisnya sudah dihapus tak akan tertangkap.
    // Header Doc modul ini sudah berjanji teknisi diberi tahu — dulu janji itu tak pernah sampai
    // ke layar karena `sessionsKnown` dihitung lalu dibuang. Jangan mengaku pasti saat separuh buta.
    const ragu = classification.sessionsKnown === false ? " ⚠️sesi tak terbaca" : "";
    if (classification.state === "bekas") {
        return `♻️ BEKAS${classification.ownerName ? ` ${classification.ownerName}` : ""}${ragu}`;
    }
    return `🆕 BARU${ragu}`;
}

module.exports = {
    DEFAULT_PPPOE_USERNAMES,
    normalizePppoe,
    loadActivePppoeUsernames,
    classifyModemCandidate,
    enrichPreviousOwner,
    describeCandidate,
    candidateBadge
};
