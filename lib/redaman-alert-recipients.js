/**
 * Header Doc
 * Purpose: Menentukan SIAPA yang menerima alert redaman — dapat diatur per PERAN dari halaman
 *          Konfigurasi, plus nomor tambahan di luar daftar akun.
 * Caller: `lib/cron/jobs/redaman-check.js`.
 * Deps: `./phone-validator` (normalizePhone).
 * MainFuncs: `resolvePenerimaRedaman`, `bacaSetelanRedaman`.
 * SideEffects: Tidak ada (murni; membaca `global.config`/`global.accounts` hanya sebagai default
 *          argumen supaya tetap bisa diuji tanpa global).
 *
 * KENAPA ADA — penerima dulu DI-HARDCODE dan tak bisa diatur sama sekali:
 *
 *     for (const account of global.accounts) {
 *         if (account.phone_number && account.phone_number.length > 0
 *             && !account.phone_number.startsWith("0")) { ... }
 *
 * Tak ada filter peran, jadi SETIAP akun berponsel ikut dibanjiri — terukur di produksi
 * 2026-08-16: 3 akun per bot (1 admin + 2 teknisi), semuanya menerima tiap alert. Pemilik
 * tak punya cara membatasi ke teknisi saja.
 *
 * Dan `!startsWith("0")` bukan pilihan peran, melainkan MEMBUANG DIAM-DIAM siapa pun yang
 * nomornya tersimpan format lokal (08xx). Kini nomor dinormalkan lewat `normalizePhone`
 * (helper yang sama dengan rate-limit auth & OTP), jadi 08xx/62xx/+62xx sama-sama sampai.
 *
 * BAWAAN SENGAJA = PERILAKU LAMA (semua peran), supaya menambah fitur ini tak diam-diam
 * mematikan alert bagi siapa pun. Membatasi ke teknisi saja adalah keputusan sadar di UI.
 */
"use strict";

const { normalizePhone } = require("./phone-validator");

/** Peran yang boleh dipilih di UI. Urutannya = urutan tampil. */
const PERAN_TERSEDIA = ["admin", "owner", "superadmin", "teknisi"];

/**
 * Membaca setelan dari config, dengan bawaan yang setara perilaku lama.
 * @param {object} [config] default `global.config`.
 */
function bacaSetelanRedaman(config = (typeof global !== "undefined" ? global.config : null)) {
    const c = (config && config.redamanAlert) || {};
    const peranMentah = Array.isArray(c.roles) ? c.roles : null;

    return {
        // `enabled` absen = HIDUP. Fitur ini sudah berjalan sebelum ada gate-nya; membuatnya
        // default-OFF akan mematikan alert yang selama ini dipakai.
        enabled: c.enabled !== false,
        // roles absen = SEMUA peran (perilaku lama). Array kosong = tak seorang pun dari akun,
        // dan itu SAH — pemilik mungkin hanya ingin nomor tambahan.
        roles: peranMentah ? peranMentah.map((r) => String(r || "").trim().toLowerCase()).filter(Boolean) : null,
        extraNumbers: Array.isArray(c.extraNumbers)
            ? c.extraNumbers.map((n) => String(n || "").trim()).filter(Boolean)
            : [],
    };
}

/**
 * Daftar JID penerima alert redaman.
 *
 * @param {object} [opsi]
 * @param {Array}  [opsi.accounts] default `global.accounts`.
 * @param {object} [opsi.config]   default `global.config`.
 * @returns {{aktif:boolean, jids:string[], rincian:Array<{sumber:string,label:string,jid:string}>}}
 */
function resolvePenerimaRedaman({ accounts, config } = {}) {
    const setelan = bacaSetelanRedaman(config);
    const daftarAkun = Array.isArray(accounts)
        ? accounts
        : (typeof global !== "undefined" && Array.isArray(global.accounts) ? global.accounts : []);

    if (!setelan.enabled) return { aktif: false, jids: [], rincian: [] };

    const rincian = [];
    const terlihat = new Set();

    const tambah = (sumber, label, nomor) => {
        const normal = normalizePhone(nomor);
        if (!normal) return;                       // nomor tak bisa dinormalkan → lewati
        const jid = `${normal}@s.whatsapp.net`;
        if (terlihat.has(jid)) return;             // satu orang bisa ada di dua sumber
        terlihat.add(jid);
        rincian.push({ sumber, label, jid });
    };

    for (const akun of daftarAkun) {
        if (!akun || !akun.phone_number) continue;
        const peran = String(akun.role || "").trim().toLowerCase();
        // roles === null berarti "semua peran" (perilaku lama).
        if (setelan.roles !== null && !setelan.roles.includes(peran)) continue;
        tambah("akun", `${akun.username || akun.name || "-"} (${peran || "-"})`, akun.phone_number);
    }

    for (const nomor of setelan.extraNumbers) {
        tambah("tambahan", nomor, nomor);
    }

    return { aktif: true, jids: rincian.map((r) => r.jid), rincian };
}

module.exports = { PERAN_TERSEDIA, bacaSetelanRedaman, resolvePenerimaRedaman };
