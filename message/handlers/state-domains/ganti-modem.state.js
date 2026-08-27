/**
 * Header Doc
 * Purpose: Wizard WA GANTI MODEM untuk teknisi/admin — `ganti modem` (daftar) atau
 *          `ganti modem <nama>` (cari). Alur: pilih pelanggan → ketik SN modem baru →
 *          (kalau perlu) isi nama & sandi WiFi → layar konfirmasi → baru dieksekusi.
 *
 *          Aturannya TIDAK ditulis ulang di sini: seluruh keputusan milik
 *          `lib/modem-replacement-service` yang juga dipakai halaman `/ganti-modem`, supaya
 *          jalur WA dan WEB tak pernah berbeda pendapat. Berkas ini hanya percakapan.
 *
 *          !! Kenapa ada layar konfirmasi: langkah ini menulis SSID & sandi ke perangkat lalu
 *          memindahkan kepemilikan. Salah ketik SN berarti menyetel modem milik orang lain.
 *
 *          Teknisi memegang modem dan membaca STIKER-nya, jadi input SN diterima dalam tiga
 *          bentuk (stiker `HWTC…`, serial ACS 16-heksa, device-id penuh) lewat
 *          `cariDevice` — bukan memaksa mereka menyalin device-id dari layar admin.
 * Caller: `message/handlers/conversation-state-router.js` (owner "ganti-modem", prefix `GMODEM_`)
 *         + trigger dari `message/raf.js` (jalur DM staf).
 * Deps (via context/inject): `reply`, `setUserState`/`deleteUserState` (`conversation-handler`),
 *        `getUsers`, `lib/modem-replacement-service` (`gantiModem`, `cariDevice`),
 *        `lib/affirmative-parser` (`isCleanConsent`), template via `renderResponseTemplate`.
 * MainFuncs: `isGantiModemTrigger`, `parseGantiModemCommand`, `startGantiModemSession`,
 *            `handleGantiModemState`, `GMODEM_STEPS`.
 * SideEffects: lewat servis — menulis SSID/sandi ke modem BARU + memperbarui users.device_id.
 *              Balasan WA lewat `reply` yang disuntikkan. NEVER-THROW.
 */
"use strict";

const STEP_PICK = "GMODEM_PICK";
const STEP_DEVICE = "GMODEM_WAIT_DEVICE";
const STEP_SSID = "GMODEM_WAIT_SSID";
const STEP_PASSWORD = "GMODEM_WAIT_PASSWORD";
const STEP_CONFIRM = "GMODEM_CONFIRM";

const GMODEM_STEPS = new Set([STEP_PICK, STEP_DEVICE, STEP_SSID, STEP_PASSWORD, STEP_CONFIRM]);

const MAKS_DAFTAR = 8;

function tpl(key, fallback, data) {
    try {
        return require("../../../lib/response-template-helper").renderResponseTemplate(key, fallback, data || {});
    } catch (_e) {
        return fallback;
    }
}

function isGantiModemTrigger(teks) {
    return /^\s*ganti\s*modem\b/i.test(String(teks || ""));
}

function parseGantiModemCommand(teks) {
    const m = String(teks || "").match(/^\s*ganti\s*modem\s*(.*)$/i);
    return { query: m ? String(m[1] || "").trim() : "" };
}

function namaPelanggan(u) {
    return (u && (u.name || u.pppoe_username)) || "(tanpa nama)";
}

function cariPelanggan(users, q) {
    const k = String(q || "").trim().toLowerCase();
    const daftar = Array.isArray(users) ? users : [];
    if (!k) return daftar.slice(0, MAKS_DAFTAR);
    return daftar.filter((u) => u && [u.name, u.pppoe_username, u.phone_number, u.address]
        .some((v) => String(v || "").toLowerCase().includes(k))).slice(0, MAKS_DAFTAR);
}

function daftarTeks(kandidat) {
    return kandidat.map((u, i) => `${i + 1}. ${namaPelanggan(u)}${u.pppoe_username ? ` · ${u.pppoe_username}` : ""}`).join("\n");
}

/** Mulai sesi dari DM staf. */
async function startGantiModemSession(context = {}) {
    const { query, staff, stateSender, reply, setUserState } = context;
    const getUsers = context.getUsers || (() => global.users || []);
    try {
        const kandidat = cariPelanggan(getUsers(), query);
        if (!kandidat.length) {
            return reply(tpl("gmodem_tak_ada_pelanggan",
                `Tidak ada pelanggan yang cocok dengan "${query}". Coba kata lain, atau ketik *ganti modem* saja untuk melihat daftar.`,
                { query }));
        }
        await setUserState(stateSender, {
            step: STEP_PICK,
            staffId: staff && staff.id,
            staffNama: staff && (staff.name || staff.username),
            kandidatIds: kandidat.map((u) => u.id),
        });
        return reply(tpl("gmodem_pilih_pelanggan",
            `🔁 *GANTI MODEM*\n\nPelanggan mana?\n\n${daftarTeks(kandidat)}\n\nBalas *nomornya*. Ketik *batal* untuk berhenti.`,
            { daftar: daftarTeks(kandidat) }));
    } catch (_e) {
        try { return reply(tpl("gmodem_error", "Maaf, ada kendala membuka menu ganti modem. Coba lagi sebentar lagi.", {})); } catch (_e) { /* diam */ }
    }
}

/** Router state untuk owner "ganti-modem". */
async function handleGantiModemState(context = {}) {
    const { state, text, stateSender, reply, setUserState, deleteUserState } = context;
    const getUsers = context.getUsers || (() => global.users || []);
    const layanan = context.layanan || require("../../../lib/modem-replacement-service");
    const isCleanConsent = context.isCleanConsent
        || ((t) => require("../../../lib/affirmative-parser").isCleanConsent(t));

    const jawab = String(text || "").trim();
    const cariUser = (id) => (getUsers() || []).find((u) => u && String(u.id) === String(id));

    try {
        if (state.step === STEP_PICK) {
            const nomor = parseInt(jawab, 10);
            const ids = state.kandidatIds || [];
            if (!Number.isInteger(nomor) || nomor < 1 || nomor > ids.length) {
                return reply(tpl("gmodem_nomor_salah",
                    `Balas dengan *nomor* dari daftar (1-${ids.length}) ya. Ketik *batal* untuk berhenti.`,
                    { maks: ids.length }));
            }
            const u = cariUser(ids[nomor - 1]);
            if (!u) {
                await deleteUserState(stateSender);
                return reply(tpl("gmodem_pelanggan_hilang", "Pelanggan itu tidak ditemukan lagi. Coba mulai lagi dari *ganti modem*.", {}));
            }
            await setUserState(stateSender, { ...state, step: STEP_DEVICE, customerId: u.id, customerNama: namaPelanggan(u) });
            return reply(tpl("gmodem_minta_sn",
                `Pelanggan: *${namaPelanggan(u)}*\nModem sekarang: ${u.device_id || "(belum ada)"}\n\n`
                + `Sekarang ketik *SN modem BARU* (yang tertulis di stiker, mis. HWTC1234ABCD).\n`
                + `Pastikan modem barunya sudah menyala dan fibernya terpasang.`,
                { nama: namaPelanggan(u), deviceLama: u.device_id || "(belum ada)" }));
        }

        if (state.step === STEP_DEVICE) {
            const temuan = await layanan.cariDevice(jawab);
            if (!temuan.deviceId) {
                const sebab = temuan.alasan === "lebih dari satu"
                    ? "Ada lebih dari satu perangkat dengan SN itu."
                    : "SN itu belum terlihat di sistem.";
                return reply(tpl("gmodem_sn_tak_ketemu",
                    `${sebab}\n\nPastikan modem barunya *sudah menyala*, fibernya terpasang, dan sudah sempat lapor ke sistem (biasanya beberapa menit setelah dinyalakan). Lalu ketik SN-nya lagi — atau *batal* untuk berhenti.`,
                    { sebab }));
            }
            const berikut = { ...state, step: STEP_CONFIRM, deviceBaru: temuan.deviceId };
            await setUserState(stateSender, berikut);
            return reply(ringkasanKonfirmasi(berikut, cariUser(state.customerId)));
        }

        if (state.step === STEP_SSID) {
            if (jawab.length < 1) {
                return reply(tpl("gmodem_ssid_kosong", "Nama WiFi tidak boleh kosong. Ketik nama WiFi pelanggan, atau *batal*.", {}));
            }
            await setUserState(stateSender, { ...state, step: STEP_PASSWORD, ssid: jawab });
            return reply(tpl("gmodem_minta_sandi",
                `Nama WiFi: *${jawab}*\n\nSekarang ketik *sandi WiFi*-nya (minimal 8 karakter).`,
                { ssid: jawab }));
        }

        if (state.step === STEP_PASSWORD) {
            if (jawab.length < 8) {
                return reply(tpl("gmodem_sandi_pendek", "Sandi WiFi minimal 8 karakter ya. Ketik ulang, atau *batal*.", {}));
            }
            const berikut = { ...state, step: STEP_CONFIRM, password: jawab };
            await setUserState(stateSender, berikut);
            return reply(ringkasanKonfirmasi(berikut, cariUser(state.customerId)));
        }

        if (state.step === STEP_CONFIRM) {
            if (!isCleanConsent(jawab)) {
                return reply(tpl("gmodem_konfirmasi_ulang",
                    "Balas *YA* kalau sudah benar, atau *batal* untuk berhenti.", {}));
            }
            await reply(tpl("gmodem_sedang_jalan",
                "⏳ Memasang nama & sandi WiFi ke modem baru dulu, baru memindahkan datanya. Mohon tunggu…", {}));

            const hasil = await layanan.gantiModem({
                customerId: state.customerId,
                deviceIdBaru: state.deviceBaru,
                ssid: state.ssid,
                password: state.password,
                aktor: { id: state.staffId, username: state.staffNama },
            });

            if (hasil.butuhKredensial) {
                // BUKAN kegagalan — kredensialnya tak bisa dibaca otomatis (modem lama mati).
                await setUserState(stateSender, { ...state, step: STEP_SSID });
                return reply(tpl("gmodem_butuh_kredensial",
                    `${teksLangkah(hasil.langkah)}\n\n`
                    + `Nama WiFi & sandi pelanggan tidak bisa dibaca otomatis — modem lamanya kemungkinan sudah mati.\n\n`
                    + `Supaya WiFi pelanggan *tidak berubah*, ketik *nama WiFi*-nya sekarang.`,
                    { langkah: teksLangkah(hasil.langkah) }));
            }

            await deleteUserState(stateSender);
            if (hasil.ok) {
                return reply(tpl("gmodem_berhasil",
                    `✅ *GANTI MODEM SELESAI*\n\n${teksLangkah(hasil.langkah)}\n\n${hasil.pesan}`,
                    { langkah: teksLangkah(hasil.langkah), pesan: hasil.pesan }));
            }
            return reply(tpl("gmodem_gagal",
                `⚠️ *GANTI MODEM BELUM SELESAI*\n\n${teksLangkah(hasil.langkah)}\n\n${hasil.pesan}`,
                { langkah: teksLangkah(hasil.langkah), pesan: hasil.pesan }));
        }

        return reply(tpl("gmodem_langkah_asing", "Sesi ganti modem-nya sudah tidak dikenali. Mulai lagi dari *ganti modem* ya.", {}));
    } catch (_e) {
        try { await deleteUserState(stateSender); } catch (_e) { /* diam */ }
        try {
            return reply(tpl("gmodem_error",
                "Maaf, ada kendala saat memproses ganti modem. Mulai lagi dari *ganti modem*.", {}));
        } catch (_e2) { /* diam */ }
    }
}

function ringkasanKonfirmasi(state, pelanggan) {
    const barisSandi = state.password ? "\nSandi WiFi: (yang tadi diketik)" : "";
    const barisSsid = state.ssid ? `\nNama WiFi: *${state.ssid}*` : "";
    return tpl("gmodem_konfirmasi",
        `📋 *PERIKSA DULU*\n\n`
        + `Pelanggan: *${state.customerNama}*\n`
        + `Modem lama: ${(pelanggan && pelanggan.device_id) || "(belum ada)"}\n`
        + `Modem baru: ${state.deviceBaru}${barisSsid}${barisSandi}\n\n`
        + `Nama & sandi WiFi akan dipasang ke modem baru dulu, baru datanya dipindah.\n\n`
        + `Sudah benar? Balas *YA*. Ketik *batal* untuk berhenti.`,
        {
            nama: state.customerNama,
            deviceLama: (pelanggan && pelanggan.device_id) || "(belum ada)",
            deviceBaru: state.deviceBaru,
            // Dioper sebagai SLOT, bukan hanya ada di fallback — template tersimpan yang
            // menimpa fallback akan kehilangan bagian ini kalau tidak.
            barisSsid: barisSsid,
            barisSandi: barisSandi,
        });
}

function teksLangkah(langkah) {
    return (langkah || []).map((l) => `${l.ok ? "✅" : "❌"} ${l.langkah} — ${l.pesan}`).join("\n");
}

module.exports = {
    isGantiModemTrigger,
    parseGantiModemCommand,
    startGantiModemSession,
    handleGantiModemState,
    GMODEM_STEPS,
    STEP_PICK,
    STEP_DEVICE,
    STEP_SSID,
    STEP_PASSWORD,
    STEP_CONFIRM,
    _internal: { cariPelanggan, daftarTeks, teksLangkah, ringkasanKonfirmasi },
};
