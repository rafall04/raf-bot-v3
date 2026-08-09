/**
 * Header Doc
 * Purpose: State domain wizard PSB via DM teknisi (per-bot area) — bagian Fase 2 [[psb-simplification-plan]].
 *          Alur SLOT-FILLING: teknisi DM `#PSB` + foto KTP (data caption OPSIONAL) → bot kumpulkan
 *          data (Nama/Dusun/RT-RW/Paket/WiFi/Sandi/HP — boleh dicicil per pesan) + foto rumah + share lokasi
 *          URUTAN BEBAS, tampilkan checklist & nagih yg kurang → begitu lengkap bot BACA modem (3 jalur:
 *          registrasi baru `_registered` + factory-reset `_lastBootstrap` + modem polos `tes@hw` online —
 *          modem BEKAS terlihat tanpa hapus record GenieACS; `cari` sadar bentuk stiker `HWTC…`↔heksa,
 *          SN polosan tanpa `cari` ikut dicari) → tampilkan RINGKASAN data + username PPPoE rakitan + SN utk diverifikasi teknisi
 *          (YA/TIDAK/pilih-nomor) → HANYA setelah YA: buat pelanggan + secret PPPoE + push PPPoE+WiFi ke
 *          modem + welcome → ringkasan ke grup PSB. Konfirmasi = gate verifikasi sebelum sentuh apa pun.
 *          Username PPPoE dirakit bot dari Nama + Dusun jadi `<nama>-<dusun>@<realm>` (teknisi tak ketik
 *          format-nya), password pakai `config.defaultPPPoEPassword` (bukan acak). ALAMAT juga dirakit bot
 *          (`Dsn. X RT 014 RW 002 Ds. Y Kec. Z`) — teknisi hanya mengetik RT/RW, karena cuma itu yang khas
 *          per rumah; dusun dipilih dari daftar bernomor (`psbIntake.dusunList`) supaya ejaannya konsisten
 *          (dusun ikut jadi bagian username PPPoE yang permanen). `dusun` disimpan sebagai KOLOM tersendiri.
 * Caller: `message/handlers/conversation-state-router.js` (owner "psb") + trigger `startPsbSession` dari
 *         `message/raf.js` (jalur DM teknisi).
 * Deps (via context/inject, patuh invariant [[raf-invariants]]): `reply` (delivery boundary), `downloadMedia`
 *        (`lib/whatsapp.adapter`), `setUserState/deleteUserState` (`conversation-handler`), `findRecentPsbCandidates`
 *        (`lib/psb-genieacs-service`), `modemProvenance` (`lib/psb-modem-provenance` — label 🆕BARU /
 *        ♻️BEKAS <pemilik lama> / ⛔TERPAKAI + GERBANG: modem yang masih melayani pelanggan lain TAK
 *        boleh ditimpa), `fetchDeviceCapability` (`lib/wifi-bulk-reconcile` — SSID sadar-band:
 *        2.4G index 1 selalu, 5G index 5 hanya bila modem dual-band), `usersService` (`global.__apiUsersService`),
 *        `getConfig`, `packages`, `sendGroupSummary`. Require langsung: `./psb-caption-parser`, `fs`, `path`.
 * MainFuncs: `startPsbSession(context)`, `handlePsbConversationState(context)`, `stickerSn(sn)`/`snText(sn)`
 *            (SN ditampilkan dalam bentuk STIKER `HWTC…` lebih dulu, bentuk ACS 16-heksa menyusul —
 *            teknisi mencocokkan dengan mata ke stiker).
 * SideEffects: Tulis foto KTP/rumah + lokasi ke `uploads/psb/...`, buat pelanggan + push modem GenieACS +
 *              kirim WA (welcome pelanggan + ringkasan grup). Reply teknisi & ringkasan grup JUJUR ikut
 *              hasil push modem (`body.device_config{attempted,ok}`): klaim "online/di-push" hanya bila
 *              `ok`, selain itu minta set manual (anti sukses-semu). NEVER-THROW.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { extractPsbFields, validatePsbData, composeAddress, titleCaseDusun, normalizeRtRw } = require("../psb-caption-parser");

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
const PSB_STEPS = new Set([STEP_COLLECT, STEP_CONFIRM, STEP_PICK]);

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

// Deteksi perintah panduan PSB (teks, dari teknisi): "#psb", "psb tutorial/panduan/format/cara",
// atau "tutorial/panduan/format psb". Bare "psb" (tanpa # / tanpa kata kunci) sengaja TIDAK memicu.
function isPsbTutorialTrigger(text) {
    return /^(#psb|(?:#?psb\s+(?:tutorial|panduan|format|cara|help|bantuan))|(?:tutorial|panduan|format|cara|bantuan)\s+psb)$/i
        .test(String(text || "").trim());
}

// C/2: ekstrak ref jadwal papan dari "#PSB PSB-<n>" (butuh HYPHEN — sesuai format ref yang teknisi
// lihat di DM/papan/grup — agar nama paket/data yang kebetulan berisi "psb12" TIDAK salah picu). null bila tak ada.
function parsePsbScheduleRef(text) {
    const s = String(text || "").trim();
    if (!/^#psb\b/i.test(s)) return null;
    const m = s.replace(/^#psb\b/i, "").match(/\bpsb-(\d+)\b/i);
    return m ? parseInt(m[1], 10) : null;
}

// Panduan PSB lengkap untuk teknisi awam (format + alur langkah demi langkah). Teks operasional
// teknisi (hardcoded, sesuai pola prompt wizard di file ini) — pesan welcome PELANGGAN tetap templated.
function psbTutorialText() {
    return [
        "📚 *PANDUAN PSB (Pasang Baru) — via Bot*",
        "",
        "Chat *japri* bot ini. Username, password & setting modem diurus bot — kamu tinggal kirim bahannya, bot yang nuntun lewat checklist.",
        "",
        "*1) Mulai:* kirim *foto KTP* + caption *#PSB* (data boleh menyusul, tak harus lengkap).",
        "",
        "*2) Lengkapi data* — URUTAN BEBAS, boleh dicicil. Ketik (sekaligus atau satu-satu):",
        PSB_TEMPLATE,
        "⚠️ *Dusun* = lokasi rumah DIPASANG, bukan alamat di KTP (bisa beda kota).",
        "💡 *Dusun* bisa dipilih dengan balas *angka* dari daftar yang bot tampilkan.",
        "💡 *RT/RW* cukup `14/2` — alamat lengkapnya bot yang merakit.",
        "💡 Rumah di luar pola (mis. beda desa)? tulis `Alamat: <alamat lengkap>` — dipakai apa adanya, RT/RW jadi tak wajib.",
        "💡 *HP boleh >1:* pisah pakai | (mis. 0812xxx|0813yyy). Nomor PERTAMA = utama.",
        "",
        "*3) Kirim foto rumah + share lokasi* (kapan saja, urutan bebas).",
        "",
        "➡️ Tiap kamu kirim, bot tampilkan *checklist* (✅/⬜) & ingatkan yang kurang. Begitu semua ✅, bot lanjut baca modem.",
        "",
        "*4) Cocokkan modem* (lihat stiker SN di modem):",
        "• SN cocok → balas *YA*",
        "• Beda → balas *TIDAK* (bot kasih daftar, balas *angka*)",
        "• Belum kebaca → nyalakan modem, balas *REFRESH*",
        "• *Modem bekas/copotan* (tak muncul di daftar) → ketik SN dari stiker, *lengkap atau potongan* — `cari HWTC49B734AD` / `cari 8EBEB1` — atau `cari wimpi` (nama/PPPoE pemilik lama). Kirim SN polosan tanpa `cari` juga bisa.",
        "• Modem bekas paling pasti ditemukan lewat *cari SN* di atas — itu jalur yang dijamin jalan. Kalau mau dia muncul sendiri di daftar, set PPPoE modem ke `tes@hw` lalu balas *REFRESH*. Tak perlu hapus apa pun di GenieACS.",
        "ℹ️ Bot menandai tiap modem: 🆕 BARU · ♻️ BEKAS <nama> (boleh dipakai) · ⛔ TERPAKAI = masih melayani pelanggan lain.",
        "   Kalau ⛔ muncul, bot MENOLAK — itu benar: kalau dipaksa, internet pelanggan itu mati. Cek ulang stiker modemmu.",
        "",
        "*5) Cek ringkasan → balas *YA**",
        "Bot buat pelanggan + set modem + kirim welcome. Tak ada yang ditulis sebelum kamu balas YA.",
        "",
        "🤖 *Otomatis (tak usah ketik):* username PPPoE (Nama+Dusun), password, alamat lengkap (Dusun+RT/RW+Desa+Kec), WiFi 2.4GHz (+5GHz bila dual-band).",
        "Batal kapan saja: ketik *BATAL*.",
        "",
        "▶️ *Mulai sekarang:* kirim *#psb* + foto KTP.",
    ].join("\n");
}

// Ringkasan ke grup PSB lewat delivery boundary reply-runtime (BUKAN socket mentah) — patuh invariant.
function defaultSendGroupSummary(groupId, text) {
    try {
        const { sendReply } = require("../reply-runtime");
        return sendReply({ recipient: groupId, text });
    } catch (_e) { return null; }
}

// Resolusi dep service (self-contained; yang di-inject menang → testable). Dep pesan (reply/downloadMedia/
// setUserState/msg/type) tetap dari caller (raf.js / state-router).
function withPsbDeps(context) {
    return {
        ...context,
        findRecentPsbCandidates: context.findRecentPsbCandidates || require("../../../lib/psb-genieacs-service").findRecentPsbCandidates,
        modemProvenance: context.modemProvenance || require("../../../lib/psb-modem-provenance"),
        findPsbCandidatesByHint: context.findPsbCandidatesByHint || require("../../../lib/psb-genieacs-service").findPsbCandidatesByHint,
        fetchDeviceCapability: context.fetchDeviceCapability || require("../../../lib/wifi-bulk-reconcile").fetchDeviceCapability,
        scheduleService: context.scheduleService || require("../../../lib/psb-schedule-service"),
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
function detectedLabel(c, nowMs) {
    if (!c) return "";
    if (c.detectedVia === "reset") return `di-reset ${minutesAgo(c.detectedAtIso, nowMs)}`;
    if (c.detectedVia === "default-online") return `online ${minutesAgo(c.detectedAtIso, nowMs)}`;
    if (c.detectedVia === "registered") return `reg ${minutesAgo(c.detectedAtIso, nowMs)}`;
    const informTs = Date.parse(c.lastInform || "");
    if (Number.isFinite(informTs)) {
        return (nowMs - informTs) <= ONLINE_INFORM_MAX_MS
            ? `online ${minutesAgo(c.lastInform, nowMs)}`
            : `⚠️ offline, terakhir ${minutesAgo(c.lastInform, nowMs)}`;
    }
    return c.registeredDate ? `reg ${minutesAgo(c.registeredDate, nowMs)}` : "";
}

// Peringatan bila modem terpilih tampak MATI (tak pernah/lama tak inform): push setting bakal gagal.
// Teknisi tetap boleh lanjut (pelanggan tercatat, push diberi tahu gagal secara jujur) — tapi dia
// diberi tahu SEBELUM eksekusi supaya bisa menyalakan/mereset modem dulu.
function offlineWarningLine(candidate, nowMs) {
    if (!candidate) return null;
    // Hanya bila TERBUKTI basi: record ACS selalu punya `_lastInform`; tanpa nilai (kandidat
    // sintetis/projection aneh) jangan menuduh offline — "tidak tahu" ≠ "terbukti mati".
    const informTs = Date.parse(candidate.lastInform || "");
    if (!Number.isFinite(informTs) || (nowMs - informTs) <= ONLINE_INFORM_MAX_MS) return null;
    // Catatan: TR-069 di jaringan ini lewat jalur manajemen SENDIRI (bukan sesi PPPoE pelanggan),
    // jadi lastInform basi ≈ modem benar-benar mati/tak tersambung — bukan soal kredensial.
    return `⚠️ Modem ini terakhir terbaca ACS ${minutesAgo(candidate.lastInform, nowMs)} — pastikan modem MENYALA & tersambung jaringan (cek adaptor/kabel optik). Kalau tetap mati, setting otomatis akan GAGAL.`;
}

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

// ── C/2: mulai sesi #PSB TERHUBUNG jadwal papan (#PSB PSB-<n>) — tarik data + REUSE foto (nol ketik ulang). ──
async function startLinkedSession(context, scheduleId) {
    const { staff, stateSender, reply, setUserState, packages, uploadsBaseDir, scheduleService, nowMs = Date.now(), logger = console } = context;
    let rec = null;
    try { rec = await scheduleService.getScheduleById(scheduleId); } catch (e) { logger?.error?.("[PSB_DM] baca jadwal gagal:", e.message); }
    if (!rec) { await safeReply(reply, `❌ Jadwal PSB-${scheduleId} tak ditemukan. Ketik *papan psb* untuk lihat daftar.`, logger); return { started: false }; }
    if (rec.status === "terpasang") { await safeReply(reply, `ℹ️ Jadwal ${rec.ref} sudah *terpasang* — tak perlu dipasang lagi.`, logger); return { started: false }; }
    if (rec.status === "batal") { await safeReply(reply, `ℹ️ Jadwal ${rec.ref} sudah *dibatalkan*.`, logger); return { started: false }; }

    const pkgs = packages || global.packages || [];
    const seed = { nama: rec.name || "", dusun: rec.dusun || "", rt_rw: "", paket: rec.paket || "", wifi_ssid: "", wifi_password: "", hp: rec.phone_number || "" };
    const now = new Date(nowMs);
    const tempId = `PSBDM_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
    const dir = path.join(uploadsBaseDir, "psb", String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"), tempId);
    const ktpSaved = reuseScheduleMedia(rec.ktp_photo_path, dir, "ktp_photo.jpg");
    const rumahSaved = reuseScheduleMedia(rec.house_photo_path, dir, "rumah_photo.jpg");
    const lokasi = (rec.latitude != null && rec.longitude != null) ? { lat: rec.latitude, lng: rec.longitude } : null;

    const ctx = { data: seed, staff, tempId, dir, ktpSaved, rumahSaved, lokasi, scheduleId: rec.id };
    const v = validatePsbData(ctx.data, { packages: pkgs, requireDusun: true, requireRtRw: true });
    if (v.ok) ctx.data = v.data;
    setUserState(stateSender, { step: STEP_COLLECT, _scope: "teknisi", context: ctx });

    const filled = `👤 ${seed.nama} · Dusun ${seed.dusun} · 📦 ${seed.paket} · 📱 ${seed.hp}`;
    if (v.ok && ktpSaved && rumahSaved && lokasi) {
        await safeReply(reply, `🔗 *${rec.ref}* — data & 3 bukti dari jadwal dipakai (nol ketik ulang).\n${filled}\n\nLanjut cari modem…`, logger);
        await detectAndAskConfirm(context, ctx);
    } else {
        await safeReply(reply, `🔗 *${rec.ref}* — data & foto jadwal dipakai. Lengkapi sisanya (biasanya *WiFi* & *Sandi*):\n${filled}\n\n${collectChecklistText(context, ctx, v)}`, logger);
    }
    return { started: true, linked: rec.ref };
}

// ── Trigger: teknisi DM `#PSB` + foto KTP → buka sesi. Dipanggil dari raf.js. ──
async function startPsbSession(context) {
    context = withPsbDeps(context);
    const { caption, type, msg, staff, stateSender, reply, downloadMedia, packages, uploadsBaseDir, setUserState, scheduleService, nowMs = Date.now(), logger = console } = context;

    // C/2: bila caption menyebut ref jadwal (#PSB PSB-<n>) → jalur TERHUBUNG (pre-fill dari papan).
    const linkedRefId = parsePsbScheduleRef(caption);
    if (linkedRefId && scheduleService) {
        return await startLinkedSession(context, linkedRefId);
    }

    if (type !== "imageMessage") {
        await safeReply(reply, `📷 Mulai PSB: kirim *foto KTP* + caption \`#PSB\` (data boleh menyusul).\n\n${PSB_TEMPLATE}`, logger);
        return { started: false };
    }

    // Slot-filling: sesi DIMULAI dari `#PSB` + foto KTP. Data (Nama/Dusun/dst) boleh KOSONG di caption
    // ini dan disusul kemudian — dikumpulkan urutan BEBAS di STEP_COLLECT. TIDAK ditolak walau minim.
    const pkgs = packages || global.packages || [];
    const seed = { nama: "", dusun: "", rt_rw: "", paket: "", wifi_ssid: "", wifi_password: "", hp: "", ...extractPsbFields(caption) };

    const now = new Date(nowMs);
    const tempId = `PSBDM_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
    const dir = path.join(uploadsBaseDir, "psb", String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"), tempId);

    let ktpSaved = false;
    try {
        const buffer = await downloadMedia(msg, "buffer", {});
        if (buffer && buffer.length > 0) ktpSaved = !!saveMedia(dir, "ktp_photo.jpg", buffer);
    } catch (e) { logger?.error?.("[PSB_DM] gagal simpan KTP:", e.message); }

    // Foto KTP WAJIB (bukti). Gagal unduh → jangan mulai sesi; minta kirim ulang yang segar.
    if (!ktpSaved) {
        await safeReply(reply, "❌ Foto KTP gagal diunduh. Kirim ulang *#PSB* + foto KTP (foto segar dari galeri/kamera, jangan forward foto lama).", logger);
        return { started: false };
    }

    const ctx = { data: seed, staff, tempId, dir, ktpSaved, rumahSaved: false, lokasi: null };
    setUserState(stateSender, { step: STEP_COLLECT, _scope: "teknisi", context: ctx });

    const v = validatePsbData(ctx.data, { packages: pkgs, requireDusun: true, requireRtRw: true });
    await safeReply(reply, `✅ Foto KTP diterima.\n\n${collectChecklistText(context, ctx, v)}`, logger);
    return { started: true };
}

// Ringkasan data pelanggan (untuk layar verifikasi sebelum eksekusi).
// Password PPPoE SENGAJA tak ditampilkan — akses terbatas admin (bot yang push ke modem otomatis).
/**
 * ODP terdekat dari titik rumah pelanggan yang MASIH punya sisa port. Tak ada → null.
 * JANGAN menebak ODP jauh: jarak garis lurus itu TEBAKAN, kabel drop bisa saja ditarik ke ODP lain.
 * Karena itu usulan ini ditampilkan di layar konfirmasi (teknisi tetap bilang YA), bukan dipasang diam-diam.
 * NEVER-THROW: usulan ODP itu bonus — gagal mencarinya tak boleh menjatuhkan PSB.
 */
function resolveNearestOdp(context, ctx) {
    try {
        if (!ctx.lokasi) return null;
        const svc = context.assetService || require("../../../lib/network-assets-service");
        const usul = svc.suggestOdpForPoint(ctx.lokasi.lat, ctx.lokasi.lng, { limit: 1 });
        const top = usul && usul[0];
        if (!top) return null;
        return { id: top.asset.id, name: top.asset.name, meters: top.meters, sisa: top.status ? top.status.sisa : null };
    } catch (e) {
        context.logger?.error?.("[PSB_DM] cari ODP terdekat gagal:", e.message);
        return null;
    }
}

function customerRecapLines(ctx) {
    const lines = [
        `👤 ${ctx.data.nama} · Dusun ${ctx.data.dusun}`,
        ...(ctx.address ? [`🏠 ${ctx.address}`] : []),
        `🔑 PPPoE: \`${ctx.pppoeUsername}\``,
        `📦 ${ctx.data.paket} · 📶 ${ctx.data.wifi_ssid} / ${ctx.data.wifi_password}`,
        `📱 ${ctx.data.hp}`
    ];

    // ODP diusulkan otomatis dari titik rumah — teknisi tak perlu hafal/ketik ID ODP.
    if (ctx.odp) {
        const sisa = ctx.odp.sisa != null ? ` · sisa ${ctx.odp.sisa} port` : "";
        lines.push(`🔗 ODP: ${ctx.odp.name} (${ctx.odp.meters} m)${sisa}`);
    } else if (ctx.lokasi) {
        lines.push(`🔗 ODP: — belum ada ODP terdaftar di dekat sini (petakan dulu: *#ODP <nama>*)`);
    }
    return lines;
}

// Tempelkan hasil klasifikasi asal-usul ke tiap kandidat (`candidate.provenance`).
// Sesi PPPoE aktif dibaca SEKALI untuk semua kandidat (satu panggilan router, bukan per modem).
// NEVER-THROW: gagal klasifikasi tak boleh menjatuhkan wizard — kandidat tanpa `provenance`
// diperlakukan sebagai "tak diketahui" oleh gerbang di bawah.
async function annotateCandidates(context, candidates) {
    const list = Array.isArray(candidates) ? candidates : [];
    if (!list.length) return list;
    const prov = context.modemProvenance;
    if (!prov) return list;

    try {
        const provDeps = { logger: context.logger, oltRepository: context.oltRepository };
        const activeUsernames = await prov.loadActivePppoeUsernames(provDeps);
        const users = context.getUsers ? context.getUsers() : (global.users || []);
        const out = [];
        for (const c of list) {
            let provenance = null;
            try {
                provenance = await prov.describeCandidate(c, { users, activeUsernames }, provDeps);
            } catch (e) { context.logger?.error?.("[PSB_DM] klasifikasi modem gagal:", e.message); }
            out.push({ ...c, provenance });
        }
        return out;
    } catch (e) {
        context.logger?.error?.("[PSB_DM] anotasi kandidat gagal:", e.message);
        return list;
    }
}

// Label asal-usul untuk ditempel di baris modem. Kosong bila klasifikasi tak tersedia.
function provBadge(context, candidate) {
    const prov = context.modemProvenance;
    if (!prov || !candidate || !candidate.provenance) return "";
    const badge = prov.candidateBadge(candidate.provenance);
    return badge ? ` · ${badge}` : "";
}

// GERBANG: boleh tidaknya modem ini dipakai. Mengembalikan pesan penolakan, atau null bila boleh.
// Sengaja gagal-tertutup untuk status `terpakai`; modem tanpa klasifikasi TETAP boleh (klasifikasi
// adalah lapisan pengaman tambahan, bukan syarat — jangan sampai router mati = PSB mati).
function assignmentBlockReason(candidate) {
    const p = candidate && candidate.provenance;
    if (!p || p.assignable !== false) return null;
    const siapa = p.ownerName ? `*${p.ownerName}*` : "pelanggan lain";
    return [
        `⛔ Modem SN \`${snText(candidate.serialNumber)}\` *masih dipakai* ${siapa}.`,
        p.reason ? `Alasan: ${p.reason}.` : null,
        `Kalau dipakai sekarang, PPPoE & WiFi ${siapa} akan tertimpa dan internetnya mati.`,
        ``,
        `👉 Cek ulang stiker modem, lalu balas *TIDAK* untuk pilih dari daftar — atau *BATAL*.`
    ].filter(Boolean).join("\n");
}

// ── Deteksi modem + minta konfirmasi (BELUM push apa pun) ──
async function detectAndAskConfirm(context, ctx) {
    const { reply, setUserState, stateSender, findRecentPsbCandidates, getConfig, nowMs = Date.now(), logger = console } = context;
    const fullCfg = (getConfig && getConfig()) || global.config || {};
    const cfg = fullCfg.psbIntake || {};
    const windowMinutes = parseInt(cfg.recencyWindowMinutes, 10) > 0 ? parseInt(cfg.recencyWindowMinutes, 10) : 120;

    // Rakit username PPPoE (nama+dusun) & resolve password default SEKALI — ditampilkan untuk
    // diverifikasi teknisi, lalu dipakai apa adanya saat provision (nilai yang dicek = yang dieksekusi).
    ctx.pppoeUsername = buildPppoeUsername(ctx.data.nama, ctx.data.dusun, cfg.pppoeRealm, global.users || []);
    ctx.pppoePassword = fullCfg.defaultPPPoEPassword || "rafnet123";

    // Alamat dirakit SEKALI di sini agar yang dilihat teknisi di layar konfirmasi = yang disimpan.
    ctx.address = buildCustomerAddress(context, ctx.data);

    // ODP terdekat (yang masih ada sisa port) dari titik rumah → tampil di layar konfirmasi, ikut
    // di-YA-kan teknisi bersama SN modem. Nol langkah tambahan, tapi tetap ADA mata manusia.
    ctx.odp = resolveNearestOdp(context, ctx);

    let candidates = [];
    let scanFailed = false;
    try {
        const res = await findRecentPsbCandidates({ windowMinutes, limit: 10, nowMs });
        if (res && res.ok) candidates = res.data || [];
        else { scanFailed = true; logger?.warn?.(`[PSB_DM] deteksi modem gagal: ${res && res.message}`); }
    } catch (e) { scanFailed = true; logger?.error?.("[PSB_DM] deteksi modem gagal:", e.message); }

    // ASAL-USUL tiap kandidat: modem polos, modem copotan (bekas siapa), atau MASIH dipakai orang.
    // Ini yang membuat teknisi tak perlu tahu modem itu bekas siapa — dan yang mencegah modem
    // pelanggan hidup ikut tertimpa kalau stikernya salah dibaca.
    candidates = await annotateCandidates(context, candidates);

    if (candidates.length === 0) {
        setUserState(stateSender, { step: STEP_CONFIRM, _scope: "teknisi", context: { ...ctx, candidate: null, candidates: [] } });
        // KEJUJURAN: gagal-baca ACS ≠ "modemnya tidak ada". Dua pesan berbeda supaya teknisi
        // tidak memvonis modem (atau membongkar GenieACS) padahal yang sakit koneksi/ACS-nya.
        if (scanFailed) {
            await safeReply(reply, [
                ...customerRecapLines(ctx),
                ``,
                `⚠️ *Gagal membaca daftar modem dari ACS* (bukan berarti modemnya tak ada).`,
                `• Tunggu sebentar lalu balas *REFRESH* untuk coba lagi`,
                `• Atau langsung ketik SN dari stiker: \`cari HWTC49B734AD\` (lengkap/potongan) / \`cari <nama pemilik lama>\``,
                `• Batalkan: *BATAL*`
            ].join("\n"), logger);
            return;
        }
        await safeReply(reply, [
            ...customerRecapLines(ctx),
            ``,
            `⚠️ Data siap, tapi *belum ada modem terbaca* di ACS (window ${windowMinutes} mnt).`,
            `• Modem baru dinyalakan? tunggu 1–2 mnt lalu balas *REFRESH*`,
            `• *Modem bekas/copotan?* ketik SN dari stiker, lengkap atau potongan (mis. \`cari HWTC49B734AD\`) — atau \`cari <nama pemilik lama>\` / \`cari <pppoe lama>\`. Modem bekas KETEMU lewat cari walau tak muncul di daftar ini.`,
            `• Mau muncul sendiri di daftar? set PPPoE modem ke \`tes@hw\` lalu balas *REFRESH* — tak perlu hapus-hapus di GenieACS`,
            `• Batalkan: *BATAL*`
        ].join("\n"), logger);
        return;
    }

    const top = candidates[0];
    setUserState(stateSender, { step: STEP_CONFIRM, _scope: "teknisi", context: { ...ctx, candidate: top, candidates } });
    await safeReply(reply, [
        `📋 *CEK DULU sebelum dieksekusi:*`,
        ...customerRecapLines(ctx),
        `📡 Modem: SN \`${snText(top.serialNumber)}\` · ${top.model} · ${detectedLabel(top, nowMs)}${provBadge(context, top)}`,
        ...(offlineWarningLine(top, nowMs) ? [offlineWarningLine(top, nowMs)] : []),
        ...(assignmentBlockReason(top) ? [``, assignmentBlockReason(top)] : []),
        ``,
        `Semua BENAR & modem cocok stiker? Balas *YA* (eksekusi) · *TIDAK* (ganti modem) · *BATAL*`
    ].join("\n"), logger);
}

// Perintah pencarian modem: "cari <kata>" (juga "search"/"modem"). null bila bukan perintah cari.
function parseSearchHint(text) {
    const m = String(text || "").trim().match(/^(?:cari|search|modem)\s+(.{2,})$/i);
    return m ? m[1].trim() : null;
}

// Teknisi sering mengetik SN POLOSAN tanpa kata `cari` — token yang berpola SN diperlakukan sebagai
// pencarian. Ketat: setelah pemisah dibuang wajib 6–24 alfanumerik DAN berpola SN (stiker
// `HWTC…` = 4 huruf + heksa, atau heksa ≥6 digit) supaya jawaban kata biasa ("sudah", nama dusun)
// tidak ikut tersedot jadi pencarian, dan angka pilihan 1–10 (≤2 digit) tetap jadi pemilih nomor.
function looksLikeSnInput(text) {
    const stripped = String(text || "").trim().replace(/[\s:._\-]/g, "");
    if (!/^[0-9a-zA-Z]{6,24}$/.test(stripped)) return false;
    return /^[a-zA-Z]{4}[0-9a-fA-F]{2,}$/.test(stripped) || /^[0-9a-fA-F]{6,}$/.test(stripped);
}

// Jalur CARI — dipakai saat daftar otomatis kosong atau modem yang benar tak muncul di situ.
// Ini penting khusus untuk modem COPOTAN: dia tak ikut "baru terdeteksi" (registrasinya ke ACS
// sudah lama), jadi satu-satunya cara menemukannya adalah dicari — lewat potongan SN di stiker,
// atau lewat nama/PPPoE pemilik lamanya yang masih tertulis di dalam modem.
async function searchAndList(context, ctx, hint) {
    const { reply, setUserState, stateSender, findPsbCandidatesByHint, nowMs = Date.now(), logger = console } = context;

    let found = [];
    let searchFailed = false;
    try {
        const res = await findPsbCandidatesByHint({ hint, limit: 10 });
        if (res && res.ok) found = res.data || [];
        else { searchFailed = true; logger?.warn?.(`[PSB_DM] cari modem gagal: ${res && res.message}`); }
    } catch (e) { searchFailed = true; logger?.error?.("[PSB_DM] cari modem gagal:", e.message); }

    // KEJUJURAN: query yang GAGAL tidak boleh menyamar jadi "tak ada yang cocok" — itu membuat
    // teknisi memvonis modemnya hilang padahal ACS-nya yang tak merespons (timeout/breaker).
    if (searchFailed) {
        await safeReply(reply, [
            `⚠️ *Pencarian gagal* — ACS tidak merespons (bukan berarti modem "*${hint}*" tak ada).`,
            `Tunggu sebentar lalu ulangi \`cari ${hint}\`, atau balas *REFRESH*. Batal: *BATAL*.`
        ].join("\n"), logger);
        return;
    }

    if (!found.length) {
        await safeReply(reply, [
            `🔎 Tak ada modem cocok "*${hint}*".`,
            `Coba SN dari stiker — *lengkap* (mis. \`HWTC49B734AD\`) atau potongan (4 digit terakhir cukup) — atau *nama/PPPoE pemilik lama* modem.`,
            `Modem belum pernah online di jaringan kita (belum ada di ACS)? Nyalakan & tunggu 1–2 mnt (modem bekas: reset pabrik / PPPoE \`tes@hw\` membantu ia masuk daftar otomatis), lalu balas *REFRESH*.`,
            `Batal: *BATAL*.`
        ].join("\n"), logger);
        return;
    }

    const annotated = await annotateCandidates(context, found);
    setUserState(stateSender, { step: STEP_PICK, _scope: "teknisi", context: { ...ctx, candidates: annotated } });
    await safeReply(reply, `🔎 Hasil cari "*${hint}*":\n${candidateListText(context, annotated, nowMs)}`, logger);
}

function candidateListText(context, candidates, nowMs) {
    const nums = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
    const lines = candidates.slice(0, 10).map((c, i) =>
        `${nums[i] || (i + 1) + "."} SN \`${snText(c.serialNumber)}\` · ${c.model} · ${detectedLabel(c, nowMs)}${provBadge(context, c)}`);
    return `Pilih modem yang cocok dgn stiker (balas *angka*), atau *REFRESH* / *BATAL*:\n${lines.join("\n")}`;
}

// Baca kapabilitas band modem dari GenieACS → indeks SSID yang wajar dikelola pelanggan.
// Mengembalikan `null` bila TAK TERBACA — sengaja tidak menebak, supaya pemanggil bisa
// membedakan "modem single-band" dari "belum kebaca" (dua hal yang beda jauh akibatnya).
async function readBandCapability(fetchDeviceCapability, deviceId, operation, logger) {
    if (!deviceId || typeof fetchDeviceCapability !== "function") return null;
    try {
        const cap = await fetchDeviceCapability(deviceId, { operation });
        if (cap && cap.found && Array.isArray(cap.expectedBulk) && cap.expectedBulk.length > 0) {
            return { indices: cap.expectedBulk.map((i) => String(i)), label: cap.has5G ? "2.4GHz + 5GHz" : "2.4GHz" };
        }
    } catch (e) {
        logger?.error?.("[PSB_DM] deteksi band modem gagal:", e.message);
    }
    return null;
}

// ── Provisioning FINAL (dipanggil hanya setelah YA / pilih nomor) ──
async function provision(context, ctx, candidate) {
    const { reply, deleteUserState, stateSender, usersService, getConfig, sendGroupSummary, botAreaLabel, fetchDeviceCapability, scheduleService, nowMs = Date.now(), logger = console } = context;
    const cfg = ((getConfig && getConfig()) || global.config || {});
    const psbCfg = cfg.psbIntake || {};

    // Pakai username & password yang SUDAH diverifikasi teknisi di layar konfirmasi (nilai yang
    // dicek = yang dieksekusi). Fallback rakit ulang kalau ctx belum terisi (mis. alur non-standar).
    const pppoeUser = ctx.pppoeUsername || buildPppoeUsername(ctx.data.nama, ctx.data.dusun, psbCfg.pppoeRealm, global.users || []);
    const pppoePass = ctx.pppoePassword || cfg.defaultPPPoEPassword || "rafnet123";

    // SSID SADAR-BAND: baca kapabilitas modem dari GenieACS — 2.4GHz selalu index 1, 5GHz index 5
    // HANYA bila modem punya (deviceHas5G). Jadi WiFi di-set ke band yang BENAR-BENAR ada: modem
    // dual-band → set 2.4G+5G (satu nama/sandi), single-band → cukup 2.4G (tak nembak index 5 yg gaib).
    // Best-effort: deteksi gagal → fallback default config. Reuse helper bulk-diff (1 sumber kebenaran).
    const fallbackIndices = String(psbCfg.defaultSsidIndices || cfg.defaultBulkSSID || "1").split(",").map((s) => s.trim()).filter(Boolean);
    const firstRead = await readBandCapability(
        fetchDeviceCapability, candidate && candidate.deviceId, "psb.dm.ssidCapability", logger
    );
    let ssidIndices = firstRead ? firstRead.indices : fallbackIndices;
    let bandLabel = firstRead ? firstRead.label : "";
    let bandDetected = !!firstRead;
    if (!firstRead && candidate && candidate.deviceId) {
        logger?.warn?.(`[PSB_DM] band modem ${candidate.deviceId} belum terbaca — pakai default SSID [${ssidIndices.join(",")}], dicoba lagi setelah push`);
    }

    let result;
    try {
        result = await usersService.upsertUserFromAdminPanel({
            userData: {
                name: ctx.data.nama,
                phone_number: ctx.data.hp,
                // ALAMAT — dirakit bot dari dusun + RT/RW + desa/kecamatan area (atau alamat bebas
                // yang diketik teknisi). Dulu kolom ini SELALU null untuk pelanggan hasil wizard,
                // padahal catatan insiden OLT ikut menyalin alamat → laporan gangguan beralamat kosong.
                address: ctx.address || buildCustomerAddress(context, ctx.data) || undefined,
                // DUSUN sebagai kolom tersendiri, bukan sekadar terselip di dalam username PPPoE.
                // Tanpa ini dusun tak bisa dipakai mengelompokkan (broadcast per dusun, gangguan
                // area, pemetaan ODP) karena pelanggan lama pun tak berpola `<nama>-<dusun>@`.
                dusun: ctx.data.dusun ? titleCaseDusun(ctx.data.dusun) : undefined,
                subscription: ctx.data.paket,
                pppoe_username: pppoeUser,
                pppoe_password: pppoePass,
                wifi_ssid: ctx.data.wifi_ssid,
                wifi_password: ctx.data.wifi_password,
                device_id: candidate ? candidate.deviceId : undefined,
                ssid_indices: candidate ? ssidIndices : undefined,
                registration_mode: "new",
                // LOKASI PEMASANGAN — share lokasi WAJIB di wizard (gate STEP_COLLECT) dan sudah ditulis
                // ke `lokasi.json`, TAPI dulu `ctx.lokasi` TIDAK PERNAH dikirim ke create API → koordinat
                // tak sampai ke tabel users (bug: "share lokasi pelanggan baru tidak terdeteksi").
                // `ctx.lokasi` terisi dari share WA (STEP_COLLECT) ATAU pre-fill jadwal papan
                // (startLinkedSession seed dari rec.latitude/longitude). userData di-SPREAD di
                // create-user-validate, jadi field ini terbawa sampai INSERT.
                latitude: ctx.lokasi ? ctx.lokasi.lat : undefined,
                longitude: ctx.lokasi ? ctx.lokasi.lng : undefined,
                maps_url: ctx.lokasi ? `https://maps.google.com/?q=${ctx.lokasi.lat},${ctx.lokasi.lng}` : undefined,
                // ODP yang diusulkan bot & sudah dilihat/di-YA-kan teknisi di layar konfirmasi.
                // Divalidasi lagi di create-user-validate (ada? penuh?) → typo/ODP penuh ditolak keras.
                connected_odp_id: ctx.odp ? ctx.odp.id : undefined,
                // Auto "gratis bulan pemasangan" bila diaktifkan: pelanggan PSB baru mulai bayar
                // bulan DEPAN (waiver periode berjalan, kebal isolir, tak masuk pemasukan). Reuse blok
                // free_first_month di create-user-persist. Gate: config.psbIntake.freeInstallMonth.
                free_first_month: psbCfg.freeInstallMonth === true
            },
            actor: { id: ctx.staff.id, username: ctx.staff.username, name: ctx.staff.name || ctx.staff.username, role: ctx.staff.role },
            requestMeta: { ipAddress: "wa-dm-psb", userAgent: "psb-dm-wizard" }
        });
    } catch (e) {
        logger?.error?.("[PSB_DM] provision throw:", e.message);
        await safeReply(reply, `❌ Gagal membuat pelanggan: ${e.message}`, logger);
        deleteUserState(stateSender);
        return;
    }

    if (!result || result.status >= 400) {
        const errMsg = (result && result.body && result.body.message) || "gagal membuat pelanggan";
        await safeReply(reply, `❌ Gagal daftar *${ctx.data.nama}*: ${errMsg}`, logger);
        deleteUserState(stateSender);
        return;
    }

    // Fase C — TUTUP lingkaran papan PSB: install ini menutup jadwal terkait (jadi `terpasang`) atau,
    // bila tak ada jadwal, dicatat sbg walk-in. Sumber angka rangkuman grup = getScheduleSummary
    // (SATU sumber; pensiun psb-install-stats). Best-effort, tak boleh menjatuhkan alur provisioning.
    const newUserId = (result && result.body && result.body.data && result.body.data.id) || null;
    let linkedRef = null;
    let summary = null;
    try {
        if (scheduleService) {
            let linked = null;
            if (ctx.scheduleId) { // link eksplisit (pre-fill Fase C/2)
                const m = await scheduleService.markScheduleInstalled(ctx.scheduleId, newUserId, { nowIso: new Date(nowMs).toISOString() });
                if (m && m.ok) linked = m.record;
            }
            if (!linked) { // auto-match jadwal terbuka by HP + teknisi
                const match = await scheduleService.findOpenScheduleForInstall({ teknisiId: ctx.staff && ctx.staff.id, phone: ctx.data.hp });
                if (match) { const m = await scheduleService.markScheduleInstalled(match.id, newUserId, { nowIso: new Date(nowMs).toISOString() }); if (m && m.ok) linked = m.record; }
            }
            if (!linked) { // walk-in: catat supaya SEMUA install terhitung
                await scheduleService.recordWalkInInstall({ nama: ctx.data.nama, hp: ctx.data.hp, dusun: ctx.data.dusun, paket: ctx.data.paket, installedUserId: newUserId, area: cfg.nama || null, nowIso: new Date(nowMs).toISOString() });
            }
            if (linked) linkedRef = linked.ref;
            summary = await scheduleService.getScheduleSummary({ nowMs });
        }
    } catch (e) { logger?.error?.("[PSB_DM] tutup jadwal/rangkuman gagal:", e.message); }

    // Rekam lokasi ke folder sesi (dokumentasi).
    try {
        if (ctx.lokasi) fs.writeFileSync(path.join(ctx.dir, "lokasi.json"), JSON.stringify(ctx.lokasi, null, 2));
    } catch (_e) { /* best-effort */ }

    // Baca hasil push modem yang SEBENARNYA (bukan asumsi "ada candidate") — hindari sukses semu.
    // persist sudah MENAHAN welcome pelanggan saat push gagal (warning device_config_failed);
    // di sini reply teknisi ikut jujur: klaim "online / sudah di-push" HANYA bila device_config.ok.
    const body = (result && result.body) || {};
    const dc = body.device_config || { attempted: false, ok: false, message: null };
    const pushFailed = body.warning === "device_config_failed" || Boolean(dc.attempted && !dc.ok);
    const pushOk = Boolean(dc.attempted && dc.ok);

    // ── Deteksi band yang GAGAL jangan mengendap jadi "fakta" ──
    // Modem yang baru semenit terdaftar di ACS sering belum selesai ditelusuri, sehingga WLAN 5GHz
    // tak terlihat dan `bulk` tersimpan ["1"]. Akibatnya nyata: saat pelanggan minta ganti nama/sandi
    // WiFi, band 5GHz TAK ikut berubah — dan pada modem BEKAS, WiFi pemilik lama bisa tetap hidup di
    // sana. Push barusan memicu refresh parameter, jadi baca ULANG sekali: bila ternyata dual-band,
    // betulkan `bulk` DAN dorong WiFi ke indeks yang belum tersentuh. Best-effort, never-throw.
    if (!bandDetected && pushOk && newUserId && candidate && candidate.deviceId) {
        const secondRead = await readBandCapability(
            fetchDeviceCapability, candidate.deviceId, "psb.dm.ssidCapability.retry", logger
        );
        if (secondRead) {
            const missing = secondRead.indices.filter((i) => !ssidIndices.includes(i));
            bandDetected = true;
            bandLabel = secondRead.label;
            ssidIndices = secondRead.indices;
            try {
                await usersService.updateUserById({
                    id: newUserId,
                    userData: { bulk: secondRead.indices },
                    actor: { id: ctx.staff.id, username: ctx.staff.username, name: ctx.staff.name || ctx.staff.username, role: ctx.staff.role },
                    requestMeta: { ipAddress: "wa-dm-psb", userAgent: "psb-dm-wizard" }
                });
                logger?.log?.(`[PSB_DM] bulk dikoreksi ke [${secondRead.indices.join(",")}] setelah band terbaca`);
            } catch (e) { logger?.error?.("[PSB_DM] koreksi bulk gagal:", e.message); }

            if (missing.length && ctx.data.wifi_ssid && ctx.data.wifi_password) {
                try {
                    const { updatePsbDeviceConfig: pushDeviceConfig } = require("../../../lib/genieacs-helper");
                    const extra = await pushDeviceConfig(candidate.deviceId, {
                        wifiSSID: ctx.data.wifi_ssid,
                        wifiPassword: ctx.data.wifi_password,
                        ssidIndices: missing
                    }, { context: { caller: "psb.dm.bandRetry", deviceId: candidate.deviceId } });
                    if (!extra || !extra.ok) {
                        logger?.warn?.(`[PSB_DM] push WiFi band tambahan gagal: ${extra && extra.message}`);
                    }
                } catch (e) { logger?.error?.("[PSB_DM] push WiFi band tambahan gagal:", e.message); }
            }
        }
    }
    // Password PPPoE TAK ditampilkan ke teknisi (akses admin). WiFi tetap tampil (kredensial pelanggan).
    const credLines = [
        `PPPoE: \`${pppoeUser}\``,
        `WiFi: ${ctx.data.wifi_ssid} / ${ctx.data.wifi_password}`
    ];
    // Asal-usul modem ikut dicatat di balasan — jejak "modem ini bekas siapa" berguna saat menelusuri
    // keluhan belakangan (mis. WiFi lama masih nyangkut di band yang tak ikut ter-push).
    const bekasNote = candidate && candidate.provenance && candidate.provenance.state === "bekas"
        ? ` — ♻️ bekas ${candidate.provenance.ownerName || candidate.provenance.previousPppoe || "pelanggan lama"}`
        : "";
    const snLine = candidate ? `Modem: SN \`${snText(candidate.serialNumber)}\` (${candidate.model})${bekasNote}` : "Modem: (tak ada device terpilih)";

    let replyLines;
    if (pushFailed) {
        // Pelanggan TERDAFTAR, tapi konfigurasi ke modem GAGAL → jangan bilang "online".
        replyLines = [
            `⚠️ *${ctx.data.nama}* terdaftar, TAPI konfigurasi ke modem *GAGAL*${dc.message ? ` (${dc.message})` : ""}.`,
            ...credLines,
            snLine,
            `👉 Cek modem fisik (nyala & konek). WiFi bisa di-set manual pakai data di atas; PPPoE minta *admin* (akses terbatas). Pesan WiFi ke pelanggan DITAHAN sampai modem beres.`
        ];
    } else if (candidate && pushOk) {
        replyLines = [
            `✅ *${ctx.data.nama}* online!`,
            ...credLines,
            snLine,
            `PPPoE + WiFi (${bandLabel || `SSID ${ssidIndices.join(",")}`}) sudah di-push ke modem. Welcome dikirim ke pelanggan.`,
            bandDetected ? null : "ℹ️ Band modem tak terbaca — bila modem dual-band, cek WiFi 5GHz manual."
        ].filter(Boolean);
    } else if (candidate) {
        // Modem terpilih tapi push tak terkonfirmasi (mis. tak ada payload) — jangan klaim beres.
        replyLines = [
            `✅ *${ctx.data.nama}* terdaftar.`,
            ...credLines,
            snLine,
            `⚠️ Konfigurasi ke modem belum terkonfirmasi — cek WiFi/PPPoE di modem.`
        ];
    } else {
        replyLines = [
            `✅ *${ctx.data.nama}* terdaftar.`,
            ...credLines,
            snLine,
            `Set WiFi manual pakai data di atas; PPPoE di modem minta *admin* (akses terbatas).`
        ];
    }
    if (linkedRef) replyLines.push(`📋 Jadwal *${linkedRef}* ditutup (terpasang).`);
    await safeReply(reply, replyLines.join("\n"), logger);

    // Ringkasan ke grup PSB bersama (best-effort, delivery boundary). Header jujur ikut hasil push.
    try {
        const summaryGroupId = psbCfg.summaryGroupId || psbCfg.groupId;
        if (sendGroupSummary && summaryGroupId) {
            await sendGroupSummary(summaryGroupId, [
                pushFailed
                    ? `⚠️ *PSB PERLU TINDAK LANJUT* — ${botAreaLabel || cfg.nama || "area"}`
                    : `✅ *PSB SELESAI* — ${botAreaLabel || cfg.nama || "area"}`,
                ``,
                `👤 ${ctx.data.nama} · Dusun ${ctx.data.dusun}`,
                `📦 ${ctx.data.paket} · 📶 ${ctx.data.wifi_ssid}`,
                `📱 ${ctx.data.hp}`,
                candidate ? `📡 Modem: SN ${snText(candidate.serialNumber)} (${candidate.model}${bandLabel ? ` · ${bandLabel}` : ""})` : "📡 Modem: set manual",
                `🧑‍🔧 Oleh: ${ctx.staff.name || ctx.staff.username}`,
                pushFailed ? "⚠️ Modem belum ter-set — WiFi set manual, PPPoE via admin." : null,
                summary ? `\n📊 *Bulan ini: ${summary.terpasang_bulan_ini} terpasang* · belum kepasang: ${summary.belum_kepasang}` : null
            ].filter(Boolean).join("\n"));
        }
    } catch (e) { logger?.error?.("[PSB_DM] ringkasan grup gagal:", e.message); }

    deleteUserState(stateSender);
}

// ── Router state (owner "psb") ──
async function handlePsbConversationState(context) {
    context = withPsbDeps(context);
    const { stateStep, teknisiState, type, msg, chats, reply, downloadMedia, setUserState, deleteUserState, stateSender, nowMs = Date.now(), logger = console } = context;

    if (!PSB_STEPS.has(stateStep)) return { handled: false };
    const ctx = (teknisiState && teknisiState.context) || null;
    if (!ctx || !ctx.data) {
        // Sesi PSB hilang di tengah jalan (state terhapus / konteks rusak). Dulu di sini hanya
        // `return { handled: true }` TANPA balasan apa pun — bot benar-benar bisu dan teknisi
        // menyimpulkan botnya rusak, padahal ia sudah mengirim foto KTP, data, dan share lokasi.
        // Kegagalan boleh terjadi, tapi TIDAK BOLEH senyap.
        deleteUserState(stateSender);
        await safeReply(
            reply,
            "⚠️ Sesi *PSB* sebelumnya terputus, jadi datanya tidak tersimpan.\n\nSilakan mulai lagi dengan mengetik *#PSB*.",
            logger
        );
        return { handled: true };
    }

    const text = String(chats || "").trim();
    const lower = text.toLowerCase();
    if (["batal", "cancel", "ga jadi", "gajadi"].includes(lower)) {
        deleteUserState(stateSender);
        await safeReply(reply, "❌ PSB dibatalkan. Tidak ada data/perubahan yang disimpan.", logger);
        return { handled: true };
    }

    // ── Fase kumpulkan (SLOT-FILLING): data (teks, boleh dicicil) + foto rumah + lokasi, URUTAN BEBAS ──
    if (stateStep === STEP_COLLECT) {
        const pkgs = context.packages || global.packages || [];
        if (type === "imageMessage") {
            let ok = false;
            try {
                const buffer = await downloadMedia(msg, "buffer", {});
                if (buffer && buffer.length > 0) ok = !!saveMedia(ctx.dir, "rumah_photo.jpg", buffer);
            } catch (e) { logger?.error?.("[PSB_DM] gagal simpan foto rumah:", e.message); }
            ctx.rumahSaved = ctx.rumahSaved || ok;
            if (!ok) { await safeReply(reply, "⚠️ Foto rumah gagal diunduh — kirim ulang foto segar dari galeri/kamera (jangan forward foto lama).", logger); return { handled: true }; }
        } else if (type === "locationMessage" || type === "liveLocationMessage") {
            const loc = type === "locationMessage" ? msg?.message?.locationMessage : msg?.message?.liveLocationMessage;
            if (loc && loc.degreesLatitude && loc.degreesLongitude) {
                ctx.lokasi = { lat: loc.degreesLatitude, lng: loc.degreesLongitude };
            }
        } else {
            // Balasan ANGKA POLOS = memilih dusun dari daftar bernomor — hanya berlaku selagi dusun
            // masih kosong. Di luar itu angka polos tetap bukan perintah apa pun (seperti sebelumnya),
            // jadi tak ada risiko menabrak slot lain.
            const options = dusunOptions(context);
            const pick = /^\d{1,2}$/.test(text) ? parseInt(text, 10) : NaN;
            if (!ctx.data.dusun && options.length && pick >= 1 && pick <= options.length) {
                ctx.data.dusun = options[pick - 1];
            } else {
                // Teks → ambil field yang ada, MERGE ke data terkumpul (boleh dicicil / dikoreksi ulang).
                const fields = extractPsbFields(text);
                for (const [k, val] of Object.entries(fields)) { if (val) ctx.data[k] = val; }
            }
        }

        // Cek kelengkapan tiap pesan. Bila lengkap → adopsi nilai ternormalisasi (paket resolved, hp joined).
        const v = validatePsbData(ctx.data, { packages: pkgs, requireDusun: true, requireRtRw: true });
        if (v.ok) ctx.data = v.data;
        setUserState(stateSender, { step: STEP_COLLECT, _scope: "teknisi", context: ctx });

        if (v.ok && ctx.ktpSaved && ctx.rumahSaved && ctx.lokasi) {
            await detectAndAskConfirm(context, ctx);
        } else {
            await safeReply(reply, collectChecklistText(context, ctx, v), logger);
        }
        return { handled: true };
    }

    // ── Fase konfirmasi modem ──
    if (stateStep === STEP_CONFIRM) {
        if (["ya", "yes", "ok", "oke", "cocok", "y"].includes(lower)) {
            if (!ctx.candidate) { await safeReply(reply, "Belum ada modem terbaca. Balas *REFRESH* setelah modem online.", logger); return { handled: true }; }
            // GERBANG: modem yang masih melayani pelanggan lain TIDAK boleh ditimpa. Tak ada opsi paksa dari WA.
            const blocked = assignmentBlockReason(ctx.candidate);
            if (blocked) { await safeReply(reply, blocked, logger); return { handled: true }; }
            await provision(context, ctx, ctx.candidate);
            return { handled: true };
        }
        if (["tidak", "beda", "no", "n", "salah"].includes(lower)) {
            if (!ctx.candidates || ctx.candidates.length === 0) { await safeReply(reply, "Tak ada kandidat lain. Balas *REFRESH* atau *BATAL*.", logger); return { handled: true }; }
            setUserState(stateSender, { step: STEP_PICK, _scope: "teknisi", context: ctx });
            await safeReply(reply, candidateListText(context, ctx.candidates, nowMs), logger);
            return { handled: true };
        }
        if (lower === "refresh") { await detectAndAskConfirm(context, ctx); return { handled: true }; }
        const hint = parseSearchHint(text);
        if (hint) { await searchAndList(context, ctx, hint); return { handled: true }; }
        // SN polosan (tanpa `cari`) → langsung dicari. Teknisi di lapangan mengetik apa yang dia
        // baca di stiker; jangan hukum dia dengan menu bantuan hanya karena kurang satu kata.
        if (looksLikeSnInput(text)) { await searchAndList(context, ctx, text); return { handled: true }; }
        await safeReply(reply, "Balas *YA* (cocok) · *TIDAK* (pilih dari daftar) · *REFRESH* · `cari <SN/nama>` (SN stiker lengkap juga bisa) · *BATAL*.", logger);
        return { handled: true };
    }

    // ── Fase pilih nomor modem ──
    if (stateStep === STEP_PICK) {
        if (lower === "refresh") { await detectAndAskConfirm(context, ctx); return { handled: true }; }
        const pickHint = parseSearchHint(text);
        if (pickHint) { await searchAndList(context, ctx, pickHint); return { handled: true }; }
        // SN polosan juga berlaku di daftar pilih — pemilih nomor tetap aman (angka 1–10 terlalu
        // pendek untuk lolos looksLikeSnInput).
        if (looksLikeSnInput(text)) { await searchAndList(context, ctx, text); return { handled: true }; }
        const n = parseInt(text, 10);
        if (Number.isInteger(n) && n >= 1 && n <= (ctx.candidates || []).length) {
            const picked = ctx.candidates[n - 1];
            // Gerbang yang sama berlaku di jalur pilih-nomor — jangan cuma dijaga di jalur YA.
            const blocked = assignmentBlockReason(picked);
            if (blocked) { await safeReply(reply, blocked, logger); return { handled: true }; }
            await provision(context, ctx, picked);
            return { handled: true };
        }
        await safeReply(reply, candidateListText(context, ctx.candidates || [], nowMs), logger);
        return { handled: true };
    }

    return { handled: false };
}

module.exports = {
    handlePsbConversationState,
    startPsbSession,
    parsePsbScheduleRef,
    buildPppoeUsername,
    stickerSn,
    snText,
    looksLikeSnInput,
    isPsbTutorialTrigger,
    psbTutorialText,
    PSB_STEPS,
    STEP_COLLECT,
    STEP_CONFIRM,
    STEP_PICK
};
