/**
 * Header Doc
 * Purpose: Menemukan & membersihkan SECRET PPPoE YATIM di MikroTik — kredensial yang tak lagi
 *          punya baris pelanggan. Ini akar "modem hantu": penghapusan pelanggan memutus sesi &
 *          menghapus secret secara best-effort, jadi ketika MikroTik sedang tak terjangkau baris
 *          pelanggan hilang TAPI secretnya selamat. Modemnya lalu terus konek atas nama orang yang
 *          sudah tidak ada — dan wizard PSB memvonisnya "milik pelanggan tak dikenal" selamanya,
 *          karena tak seorang pun bisa menutup pelanggan yang barisnya sudah lenyap.
 *          Daftarnya DITURUNKAN LANGSUNG dari keadaan sekarang (secret MikroTik ⨯ tabel users),
 *          bukan dari penanda tersimpan — jadi ia selalu benar walau kegagalannya terjadi
 *          sebelum alat ini ada, dan sembuh sendiri begitu secretnya dibersihkan.
 * Caller: `routes/api-users-routes.js` (endpoint admin), `message/handlers/state-domains/customer-removal.state.js`.
 * Deps (semua boleh di-inject utk test): `lib/mikrotik.getAllPPPoESecrets`/`removePPPoESecret`,
 *        `global.users` (snapshot pelanggan).
 * MainFuncs: `listOrphanSecrets(deps)`, `removeOrphanSecret(username, deps)`.
 * SideEffects: `listOrphanSecrets` READ-ONLY. `removeOrphanSecret` menghapus satu secret di MikroTik
 *              — dan HANYA setelah memverifikasi ulang bahwa ia masih yatim (anti hapus-salah).
 */
"use strict";

// Kredensial yang TIDAK BOLEH ikut dianggap yatim walau tak punya baris pelanggan.
// `tes@hw` adalah kredensial bawaan modem polos — jalur masuk seluruh alur PSB. Menghapusnya
// membuat setiap modem baru tak bisa online dan PSB berhenti total.
const SECRET_DILINDUNGI = new Set(["tes@hw", "tes-rumah"]);

function normalize(value) {
    return String(value === null || value === undefined ? "" : value).trim().toLowerCase();
}

// Bentuk balasan bridge PHP berlapis: {ok, data:{count, secrets:[...]}}. Bukan array langsung —
// membongkarnya dengan pola `r.data` saja menghasilkan daftar KOSONG, dan daftar kosong di sini
// berarti "tak ada yang yatim" alias kegagalan yang menyamar jadi kabar baik.
function unwrapSecrets(result) {
    if (Array.isArray(result)) return result;
    if (!result || typeof result !== "object") return null;
    if (result.ok === false) return null;
    const d = result.data;
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.secrets)) return d.secrets;
    if (d && Array.isArray(d.data)) return d.data;
    if (Array.isArray(result.secrets)) return result.secrets;
    return null;
}

function daftarPelanggan(deps) {
    const list = (deps.getUsers ? deps.getUsers() : global.users) || [];
    return Array.isArray(list) ? list : [];
}

/**
 * Secret PPPoE yang tak punya pemilik di tabel users.
 * Mengembalikan `{ok:false}` bila router tak terbaca — SENGAJA tidak mengembalikan daftar kosong,
 * karena "tak terbaca" dan "tak ada yang yatim" adalah dua hal yang sangat berbeda dan yang kedua
 * mengundang orang menutup halaman dengan tenang.
 */
async function listOrphanSecrets(deps = {}) {
    const getAllPPPoESecrets = deps.getAllPPPoESecrets || require("./mikrotik").getAllPPPoESecrets;
    let raw;
    try {
        raw = await getAllPPPoESecrets({ caller: "orphan-pppoe.list" });
    } catch (e) {
        return { ok: false, message: `Gagal membaca secret dari MikroTik: ${e.message}` };
    }

    // SESI AKTIF ikut dibaca. Diukur di produksi: dari 6 secret yang "tak punya baris pelanggan",
    // tiga di antaranya SEDANG memegang sesi hidup dan satu lagi adalah VPN operator sendiri
    // (`laptop-aldi`, profil "vpn monitor"). Tanpa penanda ini alat ini menyodorkan hal-hal itu
    // sebagai sampah siap hapus — persis kesalahan yang bisa memutus akses orang.
    let aktif = null;
    try {
        const getActivePPPoEUsers = deps.getActivePPPoEUsers || require("./mikrotik").getActivePPPoEUsers;
        const rawAktif = await getActivePPPoEUsers({ caller: "orphan-pppoe.list" });
        const listAktif = unwrapSecrets(rawAktif);
        if (listAktif) aktif = new Set(listAktif.map((s) => normalize(s && s.name)).filter(Boolean));
    } catch (_e) { aktif = null; }
    const secrets = unwrapSecrets(raw);
    if (!secrets) {
        return { ok: false, message: (raw && raw.message) || "MikroTik tak merespons saat membaca daftar secret." };
    }

    const dipakai = new Set(daftarPelanggan(deps).map((u) => normalize(u && u.pppoe_username)).filter(Boolean));
    const yatim = secrets
        .filter((s) => {
            const nama = normalize(s && s.name);
            if (!nama) return false;
            if (SECRET_DILINDUNGI.has(nama)) return false;
            return !dipakai.has(nama);
        })
        .map((s) => {
            const nama = normalize(s.name);
            // `null` = sesi tak terbaca. JANGAN dibaca sebagai "tidak aktif" — itu justru mengundang
            // penghapusan kredensial yang sedang dipakai.
            const sedangAktif = aktif ? aktif.has(nama) : null;
            return {
                username: s.name,
                profile: s.profile || null,
                comment: s.comment || null,
                disabled: !!s.disabled,
                // Jejak terakhir dipakai — membantu membedakan sisa lama dari yang baru saja gagal.
                terakhirLogout: s.last_logged_out || null,
                sedangAktif,
                // Saran, BUKAN vonis. Tak punya baris pelanggan tidak otomatis berarti sampah:
                // VPN operator, akun monitoring, dan layanan gratis memang sengaja tak berpelanggan.
                aman_dihapus: sedangAktif === false,
                catatan: sedangAktif === true
                    ? "SEDANG DIPAKAI — ada sesi hidup atas kredensial ini. Jangan dihapus sebelum tahu ini milik apa."
                    : (sedangAktif === null
                        ? "Sesi tak terbaca — status pemakaian tidak diketahui."
                        : "Tidak ada sesi hidup. Tetap periksa profilnya dulu: VPN/monitoring memang tak punya baris pelanggan.")
            };
        })
        // Yang paling aman dibersihkan ditaruh di atas; yang sedang dipakai di bawah.
        .sort((a, b) => Number(b.aman_dihapus) - Number(a.aman_dihapus));

    return {
        ok: true,
        data: yatim,
        totalSecret: secrets.length,
        totalPelangganBerPppoe: dipakai.size,
        sesiTerbaca: aktif !== null,
        jumlahAmanDihapus: yatim.filter((s) => s.aman_dihapus).length
    };
}

/**
 * Hapus SATU secret yatim. Sengaja per-baris, tak ada aksi massal: penghapusan kredensial itu
 * memutus internet kalau salah sasaran.
 * VERIFIKASI ULANG sebelum menghapus — daftar yang dilihat admin bisa saja sudah basi (pelanggan
 * baru bisa memakai username itu di antara "buka halaman" dan "klik hapus").
 */
async function removeOrphanSecret(username, deps = {}) {
    const target = normalize(username);
    if (!target) return { ok: false, message: "Username kosong." };
    if (SECRET_DILINDUNGI.has(target)) {
        return { ok: false, message: `\`${username}\` adalah kredensial bawaan modem polos — dipakai alur PSB, tidak boleh dihapus.` };
    }

    const dipakai = daftarPelanggan(deps).find((u) => normalize(u && u.pppoe_username) === target);
    if (dipakai) {
        return { ok: false, message: `Tidak jadi dihapus: \`${username}\` sekarang dipakai pelanggan ${dipakai.name}.` };
    }

    const daftar = await listOrphanSecrets(deps);
    if (!daftar.ok) return { ok: false, message: daftar.message };
    const baris = daftar.data.find((s) => normalize(s.username) === target);
    if (!baris) {
        return { ok: false, message: `\`${username}\` sudah tidak ada di daftar sisa (mungkin sudah dibersihkan).` };
    }
    // GAGAL-TERTUTUP. Sesi hidup = ada yang sedang memakainya, apa pun itu (terukur di produksi:
    // 3 dari 6 "sisa" justru sedang aktif, dan satu lagi VPN operator sendiri). Sesi yang TAK
    // TERBACA juga menahan — "tidak tahu" bukan izin memutus akses orang.
    if (baris.sedangAktif !== false) {
        return {
            ok: false,
            message: baris.sedangAktif === true
                ? `Tidak jadi dihapus: \`${username}\` SEDANG dipakai (ada sesi hidup). Pastikan dulu ini milik apa — VPN & akun monitoring memang tak punya baris pelanggan.`
                : `Tidak jadi dihapus: status sesi \`${username}\` tak terbaca dari router. Coba lagi setelah router bisa dibaca.`
        };
    }

    const removePPPoESecret = deps.removePPPoESecret || require("./mikrotik").removePPPoESecret;
    try {
        const hasil = await removePPPoESecret(username, { caller: "orphan-pppoe.remove" });
        if (hasil && hasil.ok === false) {
            return { ok: false, message: hasil.message || "MikroTik menolak penghapusan." };
        }
        return { ok: true, message: `Secret \`${username}\` dihapus dari MikroTik.` };
    } catch (e) {
        return { ok: false, message: `Gagal menghapus: ${e.message}` };
    }
}

module.exports = {
    SECRET_DILINDUNGI,
    listOrphanSecrets,
    removeOrphanSecret
};
