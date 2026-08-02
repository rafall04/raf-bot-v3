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
function classifyModemCandidate(candidate, { users = [], activeUsernames = null } = {}) {
    const pppoe = normalizePppoe(candidate && candidate.currentPPPUsername);
    const deviceId = String((candidate && candidate.deviceId) || "");
    const list = Array.isArray(users) ? users : [];
    const sessionsKnown = activeUsernames instanceof Set;
    const base = { previousPppoe: null, sessionsKnown };

    // Kredensial BAWAAN PABRIK dipakai BERSAMA oleh semua modem polos, jadi ia tak pernah menunjuk
    // ke satu pelanggan tertentu. Diperiksa lebih dulu supaya tak dipakai sebagai bukti kepemilikan
    // di aturan #1 & #2 di bawah.
    const isDefaultPppoe = !pppoe || DEFAULT_PPPOE_USERNAMES.has(pppoe);

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
    if (pppoe && !isDefaultPppoe && sessionsKnown && activeUsernames.has(pppoe)) {
        const owner = list.find((u) => normalizePppoe(u && u.pppoe_username) === pppoe);
        return {
            ...base,
            state: "terpakai",
            assignable: false,
            ownerName: (owner && owner.name) || null,
            ownerSource: "sesi_aktif",
            reason: "modem sedang melayani sesi PPPoE yang aktif"
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
    const linkedByPppoe = pppoe && !isDefaultPppoe
        ? list.find((u) => normalizePppoe(u && u.pppoe_username) === pppoe)
        : null;
    const linked = linkedByDevice || linkedByPppoe;
    if (linked) {
        return {
            ...base,
            state: "terpakai",
            assignable: false,
            ownerName: linked.name || null,
            ownerSource: linkedByDevice ? "device_id" : "pppoe",
            reason: "modem masih tertaut pelanggan yang terdaftar"
        };
    }

    // 3) PPPoE bawaan / kosong → modem polos, aman dipakai.
    if (isDefaultPppoe) {
        return { ...base, state: "baru", assignable: true, ownerName: null, ownerSource: null, reason: null };
    }

    // 4) Sisanya: modem masih membawa PPPoE milik seseorang yang SUDAH TIDAK ADA di daftar
    //    pelanggan → modem copotan. Nama pemilik lama dilengkapi terpisah dari riwayat OLT.
    return {
        ...base,
        state: "bekas",
        assignable: true,
        ownerName: null,
        ownerSource: null,
        previousPppoe: candidate.currentPPPUsername || null,
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
        return `⛔ TERPAKAI${classification.ownerName ? ` (${classification.ownerName})` : ""}`;
    }
    if (classification.state === "bekas") {
        return `♻️ BEKAS${classification.ownerName ? ` ${classification.ownerName}` : ""}`;
    }
    return "🆕 BARU";
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
