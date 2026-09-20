/**
 * Header Doc
 * Purpose: Helper & state bersama wizard PSB — konstanta step, pembangun teks (checklist/dusun/alamat/PPPoE/SN), draft-store plumbing, safeReply, media. Tetap SATU instance di sini. (dipindah utuh dari psb.state.js, split #b396 — murni pemindahan).
 * Caller: submodul `state-domains/psb/{intake,confirm,slot-filling}.state.js` (singleton bersama).
 * MainFuncs: lihat isi modul — nama & perilaku identik file asli.
 * SideEffects: identik psb.state.js asli — tulis draft/uploads, kirim reply lewat deps ter-inject.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { composeAddress, normalizeRtRw } = require("../../psb-caption-parser");

// Field data PSB yang dikumpulkan wizard (label utk checklist + urutan tampil).
const PSB_DATA_FIELDS = [
    { key: "nama", label: "Nama" },
    { key: "dusun", label: "Dusun" },
    { key: "rt_rw", label: "RT/RW" },
    { key: "paket", label: "Paket" },
    { key: "wifi_ssid", label: "WiFi" },
    { key: "wifi_password", label: "Sandi" },
    { key: "hp", label: "HP" }
];


const STEP_COLLECT = "PSB_COLLECT_DOCS";

const STEP_CONFIRM = "PSB_CONFIRM_MODEM";

const STEP_PICK = "PSB_PICK_MODEM";

// Layar tawaran LANJUT/BARU saat teknisi kembali dan draft sesi lamanya masih ada.
const STEP_RESUME = "PSB_RESUME_ASK";

// Penegasan ambil-alih modem: bukti cukup untuk MENAHAN, tapi tidak cukup untuk MENOLAK
// (mis. pola tukar modem — pelanggan sudah pindah ke modem baru, yang di tangan teknisi modem lama).
// Hanya teknisi yang bisa melihat kabelnya, jadi dialah yang menegaskan — dan namanya ikut tercatat.
const STEP_TAKEOVER = "PSB_CONFIRM_TAKEOVER";

// SENGAJA bukan "YA": kata itu dipakai di layar konfirmasi biasa dan dijawab refleks. Penegasan yang
// menanggung risiko mematikan pelanggan lain harus diketik sadar.
const KATA_AMBIL_ALIH = "verifikasi";

// Langkah yang KERJANYA layak diselamatkan saat sesi mati (STEP_RESUME tak ikut: isinya cuma
// pertanyaan, drafnya sendiri sudah tersimpan).
const RESUMABLE_STEPS = [STEP_COLLECT, STEP_CONFIRM, STEP_PICK, STEP_TAKEOVER];

const PSB_STEPS = new Set([...RESUMABLE_STEPS, STEP_RESUME]);


// Template caption PSB — dibalas bot saat teknisi belum/keliru mengisi. Tinggal salin & isi.
const PSB_TEMPLATE = [
    "📋 Format PSB — salin, isi, kirim bareng *foto KTP*:",
    "",
    "#PSB",
    "Nama: (nama pelanggan)",
    "Dusun: (lokasi PASANG, bukan alamat KTP)",
    "RT/RW: (mis. 14/2)",
    "Paket: ",
    "WiFi: (nama wifi)",
    "Sandi: (min. 8 karakter)",
    "HP: (nomor WA; bila >1 pisah pakai | )"
].join("\n");


// Ringkasan ke grup PSB lewat delivery boundary reply-runtime (BUKAN socket mentah) — patuh invariant.
function defaultSendGroupSummary(groupId, text) {
    try {
        const { sendReply } = require("../../reply-runtime");
        return sendReply({ recipient: groupId, text });
    } catch (_e) { return null; }
}


// Resolusi dep service (self-contained; yang di-inject menang → testable). Dep pesan (reply/downloadMedia/
// setUserState/msg/type) tetap dari caller (raf.js / state-router).
function withPsbDeps(context) {
    return {
        ...context,
        findRecentPsbCandidates: context.findRecentPsbCandidates || require("../../../../lib/psb-genieacs-service").findRecentPsbCandidates,
        modemProvenance: context.modemProvenance || require("../../../../lib/psb-modem-provenance"),
        findPsbCandidatesByHint: context.findPsbCandidatesByHint || require("../../../../lib/psb-genieacs-service").findPsbCandidatesByHint,
        fetchDeviceCapability: context.fetchDeviceCapability || require("../../../../lib/wifi-bulk-reconcile").fetchDeviceCapability,
        scheduleService: context.scheduleService || require("../../../../lib/psb-schedule-service"),
        draftStore: context.draftStore || require("../../../../lib/psb-draft-store"),
        usersService: context.usersService || global.__apiUsersService,
        getConfig: context.getConfig || (() => global.config || {}),
        packages: context.packages || global.packages || [],
        uploadsBaseDir: context.uploadsBaseDir || path.join(__dirname, "..", "..", "..", "uploads"),
        sendGroupSummary: context.sendGroupSummary || defaultSendGroupSummary,
        botAreaLabel: context.botAreaLabel || ((global.config && global.config.nama) || null)
    };
}


// SN modem ditampilkan LENGKAP — teknisi cocokkan dgn stiker (potongan bisa ambigu antar-modem).
// Bentuk SN yang TERCETAK DI STIKER modem Huawei: `HWTC` + 8 heksa. TR-069 melaporkan SN yang sama
// dalam bentuk 16-heksa penuh, di mana 8 heksa pertama adalah ASCII dari huruf vendor
// (`48575443` = "HWTC"). Mengembalikan null bila SN bukan bentuk itu (mis. ONU ZTE).
function stickerSn(sn) {
    const raw = String(sn || "").trim();
    if (!/^[0-9a-fA-F]{16}$/.test(raw)) return null;
    let vendor = "";
    for (let i = 0; i < 8; i += 2) {
        vendor += String.fromCharCode(parseInt(raw.slice(i, i + 2), 16));
    }
    if (!/^[A-Za-z]{4}$/.test(vendor)) return null;
    return `${vendor.toUpperCase()}${raw.slice(8).toUpperCase()}`;
}


// Teknisi mencocokkan SN dengan MATA ke stiker, jadi bentuk stiker ditaruh DI DEPAN. Bentuk ACS tetap
// ikut ditampilkan supaya (a) apa pun yang tercetak di stiker batch itu tetap ketemu, dan (b) admin
// masih bisa mengorelasikan ke GenieACS. Insiden Tanjungharjo 2026-08-02: teknisi menolak modem yang
// BENAR karena layar menulis `4857544349B734AD` sedangkan stiker berbunyi `HWTC49B734AD` — dia
// menjawab "bedo" lalu PSB batal. 157 dari 160 modem di ACS berbentuk begini.
function snText(sn) {
    const raw = String(sn || "").trim();
    const sticker = stickerSn(raw);
    return sticker ? `${sticker} (ACS ${raw})` : raw;
}


function minutesAgo(iso, nowMs) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "?";
    const m = Math.max(0, Math.round((nowMs - t) / 60000));
    if (m < 60) return `${m} mnt lalu`;
    if (m < 2880) return `${Math.round(m / 60)} jam lalu`; // < 2 hari
    return `${Math.round(m / 1440)} hari lalu`; // modem bekas: _registered bisa berumur bulan/tahun
}


// Label deteksi yang JUJUR per kandidat. Kandidat hasil deteksi otomatis membawa `detectedVia`
// (registered/reset/default-online) dari psb-genieacs-service; kandidat hasil `cari` tidak — untuk
// mereka tampilkan status online/offline dari `_lastInform`, karena "reg 2 tahun lalu" pada modem
// bekas itu benar tapi menyesatkan (yang teknisi butuh tahu: modem ini hidup atau tidak).
const ONLINE_INFORM_MAX_MS = 30 * 60 * 1000;

// Slug bagian NAMA untuk username: huruf kecil, spasi→_, buang selain [a-z0-9_].
function slugNamePart(s) {
    return String(s || "").toLowerCase().trim()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
}

// Slug bagian DUSUN: huruf kecil, jadikan 1 token (buang spasi & non-alfanumerik).
function slugDusunPart(s) {
    return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
}

// Rakit username PPPoE baku `<nama>-<dusun>@<realm>` (huruf kecil), dedup angka bila bentrok.
// Teknisi TIDAK mengetik ini — bot merakit dari Nama + Dusun mentah agar format selalu benar.
function buildPppoeUsername(nama, dusun, realm, existingUsers) {
    const namePart = slugNamePart(nama) || "user";
    const dusunPart = slugDusunPart(dusun);
    const realmRaw = String(realm || "rafcybernet").trim().replace(/^@+/, "");
    const suffix = realmRaw ? `@${realmRaw}` : "";
    const localBase = dusunPart ? `${namePart}-${dusunPart}` : namePart;
    const taken = new Set((existingUsers || []).map((u) => String(u.pppoe_username || "").toLowerCase()));
    let candidate = `${localBase}${suffix}`;
    let n = 1;
    while (taken.has(candidate.toLowerCase())) { n += 1; candidate = `${localBase}${n}${suffix}`; }
    return candidate;
}


// ── Bentrok nomor HP: dicek SAAT DIKUMPULKAN, bukan saat eksekusi ────────────────────────────
// Nomor duplikat ditolak oleh `lib/phone-validator-international` di ujung jalur create — jadi
// dulu teknisi baru tahu SETELAH memotret KTP + rumah, share lokasi, dan mencocokkan SN modem.
// Balasannya pun berbahasa Inggris ("Phone number ... is already registered to ..."), satu-satunya
// pesan asing di sepanjang wizard. Terbukti pada uji produksi 13-08-2026.
// Dicocokkan lewat 9 digit terakhir supaya `62812…`, `0812…`, dan `+62 812-…` dianggap sama.
function ekorNomor(nilai) {
    const digit = String(nilai === null || nilai === undefined ? "" : nilai).replace(/\D/g, "");
    return digit.length >= 9 ? digit.slice(-9) : "";
}


// Pelanggan yang sudah memakai salah satu nomor pada `hp` (boleh berisi >1 nomor dipisah `|`).
// null bila bebas. NEVER-THROW: gagal memeriksa tak boleh menjatuhkan wizard — jalur create
// tetap menjadi penjaga terakhir.
function cariBentrokNomor(context, hp) {
    try {
        const ekorBaru = String(hp || "").split("|").map(ekorNomor).filter(Boolean);
        if (!ekorBaru.length) return null;
        const daftar = context.getUsers ? context.getUsers() : (global.users || []);
        for (const u of (Array.isArray(daftar) ? daftar : [])) {
            const ekorLama = [u && u.phone_number, u && u.alternative_phone]
                .flatMap((v) => String(v || "").split("|"))
                .map(ekorNomor)
                .filter(Boolean);
            const kena = ekorBaru.find((e) => ekorLama.includes(e));
            if (kena) return { user: u, ekor: kena };
        }
        return null;
    } catch (e) {
        context.logger?.error?.("[PSB_DM] cek bentrok nomor gagal:", e.message);
        return null;
    }
}


function pesanBentrokNomor(bentrok, hp) {
    const nama = (bentrok.user && bentrok.user.name) || "pelanggan lain";
    return [
        `⚠️ Nomor *${hp}* sudah terdaftar atas nama *${nama}*.`,
        ``,
        `Satu nomor tak boleh dipakai dua pelanggan — kalau diteruskan, pendaftaran pasti ditolak di langkah terakhir.`,
        ``,
        `👉 Nomor pelanggan baru memang beda? kirim ulang: \`HP: <nomor yang benar>\``,
        `👉 Ini memang orang yang sama (pasang titik kedua)? minta *admin* yang mendaftarkan dari panel.`,
        `👉 Data lamanya sudah tak terpakai? minta admin merapikan dulu, lalu kirim ulang \`HP: ...\` di sini.`,
        ``,
        `❌ Batalkan: *BATAL* (datamu tetap tersimpan).`
    ].join("\n");
}


// Daftar dusun per area dari config (`psbIntake.dusunList`) — disajikan sebagai PILIHAN BERNOMOR.
// Alasan: dusun ikut jadi bagian username PPPoE yang PERMANEN, jadi salah ketik di sini menetap
// selamanya (`ngitik` vs `ngitk` = dua "dusun" berbeda saat dikelompokkan). Daftar kosong = teknisi
// mengetik bebas (perilaku lama, tetap didukung).
function dusunOptions(context) {
    const cfg = (((context.getConfig && context.getConfig()) || global.config || {}).psbIntake) || {};
    return Array.isArray(cfg.dusunList)
        ? cfg.dusunList.map((d) => String(d || "").trim()).filter(Boolean)
        : [];
}


function dusunPickerText(options) {
    if (!options.length) return "";
    return "   Pilih dusun (balas *angka*): " + options.map((d, i) => `${i + 1}.${d}`).join(" ");
}


// Alamat pelanggan: `alamat` bebas dari teknisi menang; selain itu DIRAKIT dari dusun + RT/RW +
// desa/kecamatan area (config). Teknisi tak pernah mengetik alamat lengkap — hanya RT/RW yang
// khas per rumah. RT/RW dinormalisasi ulang di sini agar alamat tetap benar walau `rt`/`rw`
// pecahannya belum sempat tersimpan di state (mis. alur pre-fill jadwal papan).
function buildCustomerAddress(context, data) {
    const override = String(data.alamat || "").trim();
    if (override) return override;

    const cfg = (((context.getConfig && context.getConfig()) || global.config || {}).psbIntake) || {};
    let rt = data.rt;
    let rw = data.rw;
    if ((!rt || !rw) && data.rt_rw) {
        const parsed = normalizeRtRw(data.rt_rw);
        if (parsed) { rt = parsed.rt; rw = parsed.rw; }
    }
    return composeAddress({ dusun: data.dusun, rt, rw, desa: cfg.desa, kecamatan: cfg.kecamatan });
}


function fieldMark(status) {
    if (status === "ok") return "✅";
    if (status === "short" || status === "unknown" || status === "invalid") return "⚠️";
    return "⬜"; // missing / optional
}


// Checklist slot-filling: status tiap field data (dari validatePsbData) + foto rumah + lokasi.
// Data boleh dikirim dicicil & urutan bebas; bot nagih yang masih ⬜/⚠️.
const FIELD_HINT = {
    dusun: "(lokasi pasang, bukan KTP)",
    rt_rw: "(mis. 14/2)",
    wifi_ssid: "(nama wifi)",
    wifi_password: "(min 8 huruf)",
    hp: "(nomor WA; >1 pisah |)"
};

function collectChecklistText(context, ctx, v) {
    const s = (v && v.status) || {};
    const options = dusunOptions(context);
    const dataLines = PSB_DATA_FIELDS.flatMap((f) => {
        const st = s[f.key];
        const val = ctx.data[f.key];
        let tail = "";
        if (val) {
            tail = `: ${val}`;
            if (st === "unknown") tail += " ⚠️ tak dikenal";
            else if (st === "short") tail += " ⚠️ min 8";
            else if (st === "invalid") tail += " ⚠️ tak valid";
        } else if (FIELD_HINT[f.key]) {
            tail = ` ${FIELD_HINT[f.key]}`;
        }
        const line = `${fieldMark(st)} ${f.label}${tail}`;
        // Daftar dusun hanya disodorkan saat dusun masih kosong — begitu terisi, jangan ramaikan layar.
        if (f.key === "dusun" && !val && options.length) return [line, dusunPickerText(options)];
        return [line];
    });

    // Pratinjau alamat rakitan — teknisi bisa lihat hasilnya tanpa mengetik alamat sama sekali.
    const alamat = buildCustomerAddress(context, ctx.data);

    return [
        `📋 *PSB* — lengkapi (urutan BEBAS):`,
        ...dataLines,
        `${ctx.ktpSaved ? "✅" : "⬜"} Foto KTP`,
        `${ctx.rumahSaved ? "✅" : "⬜"} Foto rumah`,
        `${ctx.lokasi ? "✅" : "⬜"} Share lokasi`,
        ...(alamat ? [``, `🏠 Alamat (otomatis): ${alamat}`] : []),
        ``,
        `➡️ Kirim yang masih ⬜/⚠️. Data boleh dicicil (mis. \`Dusun: Krajan\`). *BATAL* untuk batal.`
    ].join("\n");
}


async function safeReply(reply, text, logger) {
    try { if (reply) await reply(text); } catch (e) { logger?.error?.("[PSB_DM] gagal balas:", e.message); }
}


// ── Draft durabel ────────────────────────────────────────────────────────────────────────────
// Conversation state PSB hidup di memori dan mati sendiri setelah 15 menit. Justru langkah
// TERAKHIR-nya yang paling sering menunggu lama: modem yang masih tertaut pelanggan lama cuma bisa
// dibebaskan ADMIN. Jadi tanpa draft, rancangan ini MENJAMIN kerja teknisi hangus setiap kali dia
// kena ⛔ — foto KTP, 7 kolom data, foto rumah, share lokasi, semuanya diketik & difoto ulang.
// `saveStep` sengaja menggantikan pemanggilan `setUserState` langsung supaya state in-memory dan
// draft di disk TIDAK PERNAH terpisah; draft yang ketinggalan satu langkah sama menyesatkannya
// dengan tak ada draft sama sekali.
//
// Yang TIDAK ikut disimpan: `candidate`/`candidates` (snapshot ACS). Kandidat modem cepat basi —
// justru itu yang harus dibaca ULANG saat dilanjutkan, karena selama menunggu itulah modemnya
// dibebaskan. NEVER-THROW: gagal menyimpan draft tak boleh menjatuhkan wizard.
function draftFromCtx(step, ctx) {
    return {
        step,
        tempId: ctx.tempId,
        dir: ctx.dir,
        data: ctx.data,
        ktpSaved: ctx.ktpSaved,
        rumahSaved: ctx.rumahSaved,
        lokasi: ctx.lokasi,
        scheduleId: ctx.scheduleId,
        staff: ctx.staff
    };
}


function saveStep(context, step, ctx) {
    const { setUserState, stateSender, draftStore, logger = console } = context;
    setUserState(stateSender, { step, _scope: "teknisi", context: ctx });
    try {
        draftStore?.putDraft?.(stateSender, draftFromCtx(step, ctx));
    } catch (e) {
        logger?.error?.("[PSB_DM] gagal menyimpan draft:", e.message);
    }
}


function readDraft(context) {
    try {
        return context.draftStore?.getDraft?.(context.stateSender) || null;
    } catch (e) {
        context.logger?.error?.("[PSB_DM] gagal membaca draft:", e.message);
        return null;
    }
}


/**
 * Ada draft PSB tersimpan milik teknisi ini? Dipakai `message/raf.js` supaya kata sambung
 * `refresh`/`lanjut` hanya diterima bila memang ADA yang bisa dilanjutkan — di luar itu kata
 * sesumum itu tak boleh membajak alur lain. NEVER-THROW.
 */
function hasPsbDraft(stateSender, deps = {}) {
    try {
        const store = deps.draftStore || require("../../../../lib/psb-draft-store");
        return !!store.getDraft(stateSender);
    } catch (_e) {
        return false;
    }
}


function forgetDraft(context) {
    try {
        context.draftStore?.removeDraft?.(context.stateSender);
    } catch (e) {
        context.logger?.error?.("[PSB_DM] gagal menghapus draft:", e.message);
    }
}


// Ringkasan draft + tawaran LANJUT/BARU. Sengaja menampilkan checklist bukti supaya teknisi
// yakin fotonya memang masih ada (file fisiknya tak pernah ikut hilang — ia sudah di `uploads/psb`).
function resumeOfferText(draft, nowMs) {
    const d = (draft && draft.data) || {};
    const tanda = (ok) => (ok ? "✅" : "⬜");
    return [
        `📋 Ada *PSB yang belum selesai* (terakhir ${minutesAgo(draft.updatedAt, nowMs)}):`,
        ``,
        `👤 ${d.nama || "-"} · Dusun ${d.dusun || "-"}`,
        `📦 ${d.paket || "-"} · 📶 ${d.wifi_ssid || "-"}`,
        `📱 ${d.hp || "-"}`,
        `${tanda(draft.ktpSaved)} Foto KTP · ${tanda(draft.rumahSaved)} Foto rumah · ${tanda(!!draft.lokasi)} Lokasi`,
        ``,
        `▶️ Balas *LANJUT* — diteruskan dari sini, bot cek modem lagi. Tak usah foto/ketik ulang.`,
        `🆕 Balas *BARU* — buang draft ini, mulai pelanggan lain dari awal.`
    ].join("\n");
}


// Balasan tunggal untuk SEMUA jalur pembatalan PSB — baik yang lewat cabang wizard maupun yang
// dicegat kata batal universal di `message/raf.js`. Satu teks, satu kontrak: sesi ditutup, kerjanya
// TIDAK dibuang, dan dua jalan lanjutannya disebutkan supaya tak ada yang menebak.
function pesanBatalPsb() {
    return [
        "❌ Sesi PSB ditutup.",
        "",
        "✅ Pekerjaanmu *tidak dibuang* — foto KTP, foto rumah, lokasi, dan semua isian tetap tersimpan.",
        "",
        "▶️ Mau melanjutkan nanti? ketik *#PSB*, lalu balas *LANJUT*.",
        "🗑️ Mau membuangnya dan mulai pelanggan lain? ketik *#PSB*, lalu balas *BARU*."
    ].join("\n");
}


// Simpan buffer media ke folder sesi PSB (best-effort). Return path relatif atau null.
function saveMedia(dir, filename, buffer) {
    try {
        fs.mkdirSync(dir, { recursive: true });
        const full = path.join(dir, filename);
        fs.writeFileSync(full, buffer);
        return full;
    } catch (_e) { return null; }
}


// C/2: pakai ulang foto bukti dari jadwal (KTP/rumah) ke folder sesi #PSB. srcPath bisa absolut atau
// web-path (/uploads/...). Return true bila BUKTI dianggap ada: jadwal WAJIB 3 bukti saat dibuat, jadi
// path tercatat = bukti terkumpul (walau file tak ter-resolve lokal saat ini). Copy best-effort utk arsip.
function reuseScheduleMedia(srcPath, dir, filename) {
    if (!srcPath) return false;
    try {
        const rel = String(srcPath).replace(/^\/+/, "");
        const candidates = [srcPath, path.join(process.cwd(), rel), path.join(__dirname, "..", "..", "..", rel)];
        const src = candidates.find((p) => { try { return fs.existsSync(p); } catch (_e) { return false; } });
        if (src) { fs.mkdirSync(dir, { recursive: true }); fs.copyFileSync(src, path.join(dir, filename)); }
    } catch (_e) { /* best-effort — flag tetap true krn bukti terkumpul di jadwal */ }
    return true;
}

module.exports = {
    PSB_DATA_FIELDS,
    STEP_COLLECT,
    STEP_CONFIRM,
    STEP_PICK,
    STEP_RESUME,
    STEP_TAKEOVER,
    KATA_AMBIL_ALIH,
    RESUMABLE_STEPS,
    PSB_STEPS,
    PSB_TEMPLATE,
    defaultSendGroupSummary,
    withPsbDeps,
    stickerSn,
    snText,
    minutesAgo,
    ONLINE_INFORM_MAX_MS,
    slugNamePart,
    slugDusunPart,
    buildPppoeUsername,
    ekorNomor,
    cariBentrokNomor,
    pesanBentrokNomor,
    dusunOptions,
    dusunPickerText,
    buildCustomerAddress,
    fieldMark,
    FIELD_HINT,
    collectChecklistText,
    safeReply,
    draftFromCtx,
    saveStep,
    readDraft,
    hasPsbDraft,
    forgetDraft,
    resumeOfferText,
    pesanBatalPsb,
    saveMedia,
    reuseScheduleMedia,
};
