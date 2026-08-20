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
 *          KERJA TEKNISI DURABEL: tiap langkah ikut ditulis ke `lib/psb-draft-store` (data + jejak bukti
 *          + lokasi), sesi yang mati karena timeout 15 menit MEMBERI KABAR + menyimpan draft, dan `#PSB`
 *          berikutnya menawarkan LANJUT atau BARU. Alasannya: langkah modem sering menunggu ADMIN
 *          membebaskan modem bekas — praktis selalu >15 menit — sehingga rancangan lama menjamin foto
 *          KTP/rumah/lokasi + 7 kolom data hangus tiap kali teknisi kena ⛔ (insiden Tanjungharjo 12-08-2026).
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
 * MainFuncs: `startPsbSession(context)`, `handlePsbConversationState(context)`,
 *            `handlePsbStateTimeout(userId, state)` (terdaftar ke `registerStateTimeoutHandler`),
 *            `handlePsbStateCancel(userId, state, deps)` (terdaftar ke `registerStateCancelHandler` —
 *            kata batal universal dicegat `raf.js` sebelum router state, jadi tanpa hook ini cabang
 *            BATAL wizard tak pernah jalan dan jawabannya jatuh ke kalimat generik),
 *            `isPsbBareCommand(text)` (`#psb` polos = minta LANJUT bila ada draft; permintaan
 *            panduan eksplisit seperti `panduan psb` sengaja TIDAK termasuk),
 *            `stickerSn(sn)`/`snText(sn)`
 *            (SN ditampilkan dalam bentuk STIKER `HWTC…` lebih dulu, bentuk ACS 16-heksa menyusul —
 *            teknisi mencocokkan dengan mata ke stiker).
 * SideEffects: Tulis foto KTP/rumah + lokasi ke `uploads/psb/...`, buat pelanggan + push modem GenieACS +
 *              kirim WA (welcome pelanggan + ringkasan grup). Reply teknisi & ringkasan grup JUJUR ikut
 *              hasil push modem (`body.device_config{attempted,ok}`): klaim "online/di-push" hanya bila
 *              `ok`, selain itu minta set manual (anti sukses-semu). Kabar welcome ikut `body.welcome`
 *              (bukan disimpulkan dari push modem — dua hal yang tak berhubungan). NEVER-THROW.
 *              Provisioning DIJAGA anti-kerja-dobel (`SEDANG_PROVISION`, sinkron, per `stateSender`)
 *              dan mengirim ack SEBELUM kerja panjang; pemicu kembar ditolak, bukan dijalankan lagi.
 *              Pesan gagal TIDAK pernah mengoper `e.message` mentah, memeriksa dulu apakah
 *              pelanggannya ternyata sudah jadi, dan hanya menjanjikan `#PSB`+`LANJUT` bila draft
 *              memang masih ada (#b251).
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

// Deteksi perintah panduan PSB (teks, dari teknisi): "#psb", "psb tutorial/panduan/format/cara",
// atau "tutorial/panduan/format psb". Bare "psb" (tanpa # / tanpa kata kunci) sengaja TIDAK memicu.
function isPsbTutorialTrigger(text) {
    return /^(#psb|(?:#?psb\s+(?:tutorial|panduan|format|cara|help|bantuan))|(?:tutorial|panduan|format|cara|bantuan)\s+psb)$/i
        .test(String(text || "").trim());
}

// `#psb` POLOS — persis itu, tanpa embel-embel. Dibedakan dari `isPsbTutorialTrigger` yang juga
// cocok untuk `panduan psb` / `psb cara` / `psb format`: permintaan panduan yang EKSPLISIT harus
// tetap dijawab panduan meski teknisinya punya draft. Yang ambigu hanya `#psb` polos — dan bot
// sendiri yang mengajarkan kalimat itu sebagai cara MELANJUTKAN ("ketik *#PSB* lalu balas *LANJUT*",
// bahkan "ketik *#PSB* kapan saja untuk melanjutkan").
function isPsbBareCommand(text) {
    return /^#psb$/i.test(String(text || "").trim());
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
        draftStore: context.draftStore || require("../../../lib/psb-draft-store"),
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
        const store = deps.draftStore || require("../../../lib/psb-draft-store");
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

// ── C/2: mulai sesi #PSB TERHUBUNG jadwal papan (#PSB PSB-<n>) — tarik data + REUSE foto (nol ketik ulang). ──
async function startLinkedSession(context, scheduleId) {
    const { staff, reply, packages, uploadsBaseDir, scheduleService, nowMs = Date.now(), logger = console } = context;
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
    saveStep(context, STEP_COLLECT, ctx);

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

    // Draft sesi sebelumnya masih ada → TAWARKAN dulu, jangan minta semuanya diulang. Diperiksa
    // SEBELUM syarat foto KTP, karena teknisi yang mau melanjutkan tak punya alasan memotret KTP
    // lagi — dan justru itu beban yang membuat kegagalan di langkah modem terasa tak berujung.
    const draftLama = readDraft(context);
    if (draftLama) {
        setUserState(stateSender, { step: STEP_RESUME, _scope: "teknisi", context: { draft: draftLama, staff } });
        await safeReply(reply, resumeOfferText(draftLama, nowMs), logger);
        return { started: true, resumeOffered: true };
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
    saveStep(context, STEP_COLLECT, ctx);

    const v = validatePsbData(ctx.data, { packages: pkgs, requireDusun: true, requireRtRw: true });
    // Caption pembuka sering sudah memuat HP — kalau nomornya bentrok, katakan SEKARANG. Menunggu
    // sampai pesan berikutnya berarti teknisi terlanjur memotret rumah dulu untuk data yang mati.
    const bentrokAwal = ctx.data.hp ? cariBentrokNomor(context, ctx.data.hp) : null;
    await safeReply(
        reply,
        `✅ Foto KTP diterima.\n\n${collectChecklistText(context, ctx, v)}`
        + (bentrokAwal ? `\n\n${pesanBentrokNomor(bentrokAwal, ctx.data.hp)}` : ""),
        logger
    );
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

// Layar PENEGASAN AMBIL-ALIH. Bukan penolakan: bot menyebut apa yang IA lihat, lalu menanyakan satu
// hal yang cuma bisa dijawab orang yang memegang modemnya. Fakta konkret (nama, SN, kapan terakhir
// terlihat, modem mana yang tercatat untuk pelanggan itu) sengaja ditulis lengkap supaya jawaban
// yang keliru terlihat keliru — pertanyaan tanpa fakta hanya memancing "ya" refleks.
function takeoverConfirmText(candidate, nowMs) {
    const p = (candidate && candidate.provenance) || {};
    const siapa = p.ownerName ? `*${p.ownerName}*` : "pelanggan lain (kemungkinan area sebelah)";
    const kredensial = p.previousPppoe ? ` (\`${p.previousPppoe}\`)` : "";
    const stiker = stickerSn(candidate.serialNumber);
    return [
        `⚠️ *TAHAN DULU* — modem ini masih tertaut ${siapa}.`,
        ``,
        `📡 *SN modem yang kamu pilih:*`,
        stiker ? `   *${stiker}*` : `   *${candidate.serialNumber}*`,
        stiker ? `   (di sistem tertulis ${candidate.serialNumber})` : null,
        ``,
        `👤 Masih tertaut: ${siapa}${kredensial}`,
        `🕐 Terakhir terlihat di jaringan: ${minutesAgo(candidate.lastInform, nowMs)}`,
        p.reason ? `ℹ️ ${p.reason}.` : null,
        p.deviceTercatatPemilik && p.deviceTercatatPemilik !== candidate.deviceId
            ? `🔄 Catatan kami: pelanggan itu sekarang tercatat memakai modem LAIN — modem di tanganmu kemungkinan besar modem lamanya.`
            : null,
        ``,
        // Ini inti pengamannya. Bot tak pernah tahu di mana modem berada secara fisik; yang mengikat
        // keputusan ke modem yang benar hanyalah stiker yang dibaca teknisi saat itu juga.
        `👉 *CEK STIKER DI BELAKANG MODEM* yang ada di tanganmu sekarang.`,
        `   Sama persis dengan SN di atas?`,
        ``,
        `✅ *SAMA* → ketik *${KATA_AMBIL_ALIH.toUpperCase()}* untuk melanjutkan.`,
        `   PPPoE & WiFi modem ini akan ditimpa, dan penegasan itu tercatat atas namamu.`,
        `❌ *BEDA* atau ragu → *BATAL*, lalu ketik \`cari <SN stiker>\`. Datamu tetap tersimpan.`,
        ``,
        `⛔ Kalau SN-nya ternyata beda, kamu sedang menimpa modem yang masih terpasang di rumah orang.`
    ].filter(Boolean).join("\n");
}

/**
 * Kandidat yang cuma `butuhKonfirmasi` ditahan SATU langkah: bot menyebut buktinya, teknisi yang
 * menegaskan. Mengembalikan true bila penegasan diminta (pemanggil harus berhenti di situ).
 * Kandidat terpilih disimpan di `ctx.candidate` supaya langkah penegasan mengeksekusi modem yang
 * SAMA dengan yang ditanyakan — bukan hasil pembacaan ulang yang bisa berbeda.
 */
async function mintaPenegasanAmbilAlih(context, ctx, candidate, nowMs) {
    const p = candidate && candidate.provenance;
    if (!p || !p.butuhKonfirmasi) return false;
    saveStep(context, STEP_TAKEOVER, { ...ctx, candidate });
    await safeReply(context.reply, takeoverConfirmText(candidate, nowMs), context.logger || console);
    return true;
}

// ── Deteksi modem + minta konfirmasi (BELUM push apa pun) ──
async function detectAndAskConfirm(context, ctx) {
    const { reply, findRecentPsbCandidates, getConfig, nowMs = Date.now(), logger = console } = context;
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
        saveStep(context, STEP_CONFIRM, { ...ctx, candidate: null, candidates: [] });
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
    saveStep(context, STEP_CONFIRM, { ...ctx, candidate: top, candidates });
    await safeReply(reply, [
        `📋 *CEK DULU sebelum dieksekusi:*`,
        ...customerRecapLines(ctx),
        `📡 Modem: SN \`${snText(top.serialNumber)}\` · ${top.model} · ${detectedLabel(top, nowMs)}${provBadge(context, top)}`,
        ...(offlineWarningLine(top, nowMs) ? [offlineWarningLine(top, nowMs)] : []),
        // Modem yang masih tertaut orang lain TIDAK lagi diributkan di layar ini. Peringatannya
        // dipindah ke layar penegasan sesudah teknisi menjawab YA — di sana SN-nya ditampilkan
        // besar dan dia diminta mencocokkan stiker, satu-satunya bukti yang mengikat modem fisik.
        // Menumpuk peringatan di dua layar hanya membuat yang kedua ikut dilewati.
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
    const { reply, findPsbCandidatesByHint, nowMs = Date.now(), logger = console } = context;

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
    saveStep(context, STEP_PICK, { ...ctx, candidates: annotated });
    await safeReply(reply, `🔎 Hasil cari "*${hint}*":\n${candidateListText(context, annotated, nowMs)}`, logger);
}

function candidateListText(context, candidates, nowMs) {
    const nums = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
    const daftar = candidates.slice(0, 10);
    const lines = daftar.map((c, i) =>
        `${nums[i] || (i + 1) + "."} SN \`${snText(c.serialNumber)}\` · ${c.model} · ${detectedLabel(c, nowMs)}${provBadge(context, c)}`);

    // Semua kandidat ⛔ → menyuruh "pilih angka" adalah jalan buntu: apa pun yang dipilih ditolak,
    // dan penolakannya menyuruh kembali ke daftar ini. Sebutkan jalan keluarnya DI SINI, di layar
    // tempat teknisi benar-benar berputar (insiden Tanjungharjo 2026-08-12).
    const semuaDiblokir = daftar.length > 0
        && daftar.every((c) => c && c.provenance && c.provenance.assignable === false);

    return [
        `Pilih modem yang cocok dgn stiker (balas *angka*), atau *REFRESH* / *BATAL*:`,
        lines.join("\n"),
        semuaDiblokir
            ? [
                ``,
                `⚠️ *Semua modem di daftar ini ⛔ TERPAKAI* — tak ada yang bisa dipilih.`,
                // BUKAN *REFRESH*: perintah itu membaca daftar "modem baru terdeteksi", dan modem
                // bekas yang barusan dibebaskan tak pernah masuk ke sana. `cari <SN>` yang bekerja.
                `👉 Pemilik lamanya sudah berhenti? minta admin menutup pelanggan itu dulu, lalu ketik \`cari <SN stiker>\` lagi.`,
                `👉 Salah ambil modem? ketik \`cari <SN stiker>\`.`
            ].join("\n")
            : null
    ].filter(Boolean).join("\n");
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

// !! PENJAGA KERJA-DOBEL PROVISIONING (#b251).
// Kunci per-pengirim di router (`lib/state-manager`) adalah jaring DARURAT, bukan andalan —
// dan dulu ia melepas diri di detik ke-10 sementara satu putaran provisioning butuh ±21 detik,
// sehingga pemicu kedua dari teknisi lolos dan dua provisioning berjalan paralel: yang kedua
// menabrak hasil yang pertama (PPPoE DUPLICATE + UNIQUE users.id) lalu melapor "GAGAL" padahal
// pelanggannya SUDAH JADI. Set ini SINKRON — dua pesan di tick yang sama pun tak bisa dua-duanya
// lolos, beda dengan `setUserState` yang async. Di-key `stateSender` kanonik (bukan @lid).
const SEDANG_PROVISION = new Set();

// Teks yang dibaca teknisi WAJIB lewat template supaya bisa diedit admin di `/api/templates`.
// `renderResponseTemplate` sudah never-throw dan memulangkan fallback apa adanya bila key absen /
// slot-nya basi — jadi dipanggil LANGSUNG (bukan lewat pembungkus lokal) karena guard
// `message/__tests__/response-template-key-integrity.test.js` memindai pola pemanggilan ini;
// pembungkus akan menyembunyikan key baru dari guard.
//
// !! Fallback WAJIB template literal (backtick), bukan string kutip tunggal. Fallback dipulangkan
// APA ADANYA, jadi `'...${nama}...'` akan mengirim `${nama}` MENTAH ke teknisi.
const { renderResponseTemplate } = require("../template-helpers");

// !! JANGAN PERNAH memvonis "gagal" tanpa memeriksa kenyataannya (#b251).
// Kejadian nyata 2026-08-20: perintah kembar menabrak hasil kerja kembarannya sendiri, lalu
// teknisi dibalas `❌ Gagal membuat pelanggan: SQLITE_CONSTRAINT: UNIQUE constraint failed:
// users.id` — padahal pelanggannya SUDAH JADI. Tiga cacat sekaligus: vonis terbalik, jargon
// database mentah dibocorkan ke WhatsApp, dan jalan pemulihan yang disarankan (`#PSB` + `LANJUT`)
// sudah mati karena kembaran yang sukses menghapus draft-nya. Fungsi ini menutup ketiganya:
// bukti dulu (apakah PPPoE-nya benar-benar sudah terdaftar), baru bicara.
function pelangganSudahAda(pppoeUsername) {
    if (!pppoeUsername) return null;
    const daftar = Array.isArray(global.users) ? global.users : [];
    return daftar.find((u) => u && String(u.pppoe_username || "").toLowerCase() === String(pppoeUsername).toLowerCase()) || null;
}

// Terjemahkan galat teknis ke sebab yang bisa ditindak teknisi. TIDAK PERNAH mengoper `e.message`.
function sebabTerbaca(pesan) {
    const s = String(pesan || "").toLowerCase();
    if (s.includes("unique constraint") || s.includes("sqlite_constraint")) return "data pendaftaran ini bentrok dengan data yang sudah ada";
    if (s.includes("sudah ada") || s.includes("duplicate")) return "nama akun PPPoE-nya sudah dipakai";
    if (s.includes("mikrotik")) return "router tidak bisa dihubungi saat mendaftarkan akun";
    if (s.includes("genieacs") || s.includes("acs")) return "server pengatur modem sedang tidak bisa dihubungi";
    if (s.includes("timeout") || s.includes("etimedout")) return "sambungan ke perangkat jaringan timeout";
    if (s.includes("odp")) return "ODP yang dipilih bermasalah (penuh atau tidak ditemukan)";
    return "ada kendala teknis di sisi sistem";
}

async function teksGagalProvision(context, ctx, err) {
    const { logger = console } = context;
    const nama = (ctx && ctx.data && ctx.data.nama) || "pelanggan";
    const pppoe = ctx && ctx.pppoeUsername;

    // BUKTI dulu: kalau PPPoE-nya sudah terdaftar, ini kembaran yang menabrak — BUKAN kegagalan.
    const sudah = pelangganSudahAda(pppoe);
    if (sudah) {
        logger?.warn?.(`[PSB_DM] vonis gagal DIBATALKAN: ${pppoe} ternyata sudah terdaftar (id ${sudah.id}) — ini tabrakan perintah kembar`);
        const lanjutanSudah = "Cek di panel kalau mau memastikan. Kalau setelan modem belum masuk, dorong ulang dari menu WiFi.";
        return renderResponseTemplate(
            "psb_provision_sudah_jadi",
            `✅ Tenang, pendaftaran *${nama}* sebenarnya *SUDAH BERHASIL*.\n\nYang barusan cuma perintah kembar yang menabrak hasilnya sendiri — tidak ada yang rusak, tidak perlu diulang.\n\n${lanjutanSudah}`,
            { nama, lanjutan: lanjutanSudah }
        );
    }

    // Jalan pemulihan hanya boleh dijanjikan kalau draft-nya MEMANG masih ada.
    let masihAdaDraft = false;
    try { masihAdaDraft = Boolean(readDraft(context)); } catch (_e) { masihAdaDraft = false; }
    const lanjutan = masihAdaDraft
        ? "Datamu SAYA SIMPAN — ketik *#PSB* lalu balas *LANJUT* untuk mencoba lagi."
        : "Data wizard-nya sudah tidak tersimpan, jadi pendaftaran perlu diulang dari *#PSB*. Maaf.";

    const sebab = sebabTerbaca(err && err.message);
    return renderResponseTemplate(
        "psb_provision_gagal",
        `❌ Pendaftaran *${nama}* belum jadi.\n\nSebabnya: ${sebab}\n\n${lanjutan}`,
        { nama, sebab, lanjutan }
    );
}

// ── Provisioning FINAL (dipanggil hanya setelah YA / pilih nomor) ──
// Pembungkus: satu penjaga untuk KETIGA pintu masuk (STEP_CONFIRM, STEP_PICK, STEP_TAKEOVER),
// plus ack SEBELUM kerja panjang — diamnya bot ±21 detik itulah yang dulu mengundang teknisi
// mengetik ulang kata pemicu.
async function provision(context, ctx, candidate) {
    const { reply, stateSender, logger = console } = context;

    if (SEDANG_PROVISION.has(stateSender)) {
        logger?.warn?.(`[PSB_DM] pemicu provisioning DOBEL ditolak untuk ${stateSender} — yang pertama masih jalan`);
        await safeReply(reply, renderResponseTemplate(
            "psb_provision_masih_jalan",
            "⏳ Sabar, yang tadi *masih saya kerjakan*.\n\nJangan diulang — mengulang justru membuat pendaftaran bentrok dengan dirinya sendiri. Tunggu balasan hasilnya.",
            {}
        ), logger);
        return;
    }

    SEDANG_PROVISION.add(stateSender);
    try {
        await safeReply(reply, renderResponseTemplate(
            "psb_provision_ack",
            "⏳ Sedang saya kerjakan, *jangan kirim perintah itu lagi*.\n\nPemasangan butuh sekitar 20–30 detik (daftar ke router + kirim setelan ke modem). Saya kabari begitu selesai.",
            {}
        ), logger);
        return await provisionInner(context, ctx, candidate);
    } finally {
        SEDANG_PROVISION.delete(stateSender);
    }
}

async function provisionInner(context, ctx, candidate) {
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
        // Draft SENGAJA tidak dibuang saat gagal: kegagalannya bisa transien (router/ACS sedang
        // ngadat), dan memaksa teknisi memotret KTP + rumah lagi adalah hukuman untuk kesalahan
        // yang bukan miliknya.
        await safeReply(reply, await teksGagalProvision(context, ctx, e), logger);
        deleteUserState(stateSender);
        return;
    }

    if (!result || result.status >= 400) {
        const errMsg = (result && result.body && result.body.message) || "gagal membuat pelanggan";
        await safeReply(reply, await teksGagalProvision(context, ctx, new Error(errMsg)), logger);
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

    // ── Kabar welcome IKUT BUKTI, bukan disimpulkan ──
    // Baris "Welcome dikirim ke pelanggan" dulu dicetak semata-mata karena push modem berhasil.
    // Dua hal itu tak berhubungan sama sekali: modem bisa ter-set sempurna sementara pesannya tak
    // pernah berangkat karena bot sedang putus dari WhatsApp — dan teknisi, merasa sudah beres,
    // tak pernah menyusulkan kredensial ke pelanggan. Terbukti pada uji produksi 13-08-2026.
    // `create-user-persist` kini melaporkan `body.welcome`; pakai itu.
    const ALASAN_WELCOME = {
        welcome_dimatikan: "fitur pesan selamat datang sedang dimatikan",
        nomor_pelanggan_kosong: "nomor HP pelanggan kosong",
        ditahan_push_modem_gagal: "ditahan karena setelan modem gagal",
        kredensial_portal_belum_ada: "kredensial portal pelanggan belum terbentuk",
        whatsapp_tidak_tersambung: "bot sedang tidak tersambung ke WhatsApp"
    };
    function welcomeLine() {
        const wc = body.welcome;
        // Respons tanpa jejak welcome (versi service lama) → JANGAN mengklaim apa pun.
        if (!wc) return null;
        if (wc.dispatched) return "Pesan selamat datang sudah dikirim ke pelanggan.";
        const alasan = ALASAN_WELCOME[wc.reason]
            || (String(wc.reason || "").startsWith("template_tak_ada") ? "template pesannya belum ada" : "sebab tak diketahui");
        return `⚠️ Pesan selamat datang *BELUM* sampai ke pelanggan (${alasan}) — sampaikan langsung ke pelanggan, atau kirim ulang dari panel admin.`;
    }

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
            `PPPoE + WiFi (${bandLabel || `SSID ${ssidIndices.join(",")}`}) sudah di-push ke modem.`,
            welcomeLine(),
            bandDetected ? null : "ℹ️ Band modem tak terbaca — bila modem dual-band, cek WiFi 5GHz manual."
        ].filter(Boolean);
    } else if (candidate) {
        // Modem terpilih tapi push tak terkonfirmasi (mis. tak ada payload) — jangan klaim beres.
        replyLines = [
            `✅ *${ctx.data.nama}* terdaftar.`,
            ...credLines,
            snLine,
            `⚠️ Konfigurasi ke modem belum terkonfirmasi — cek WiFi/PPPoE di modem.`,
            welcomeLine()
        ].filter(Boolean);
    } else {
        replyLines = [
            `✅ *${ctx.data.nama}* terdaftar.`,
            ...credLines,
            snLine,
            `Set WiFi manual pakai data di atas; PPPoE di modem minta *admin* (akses terbatas).`,
            welcomeLine()
        ].filter(Boolean);
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

    // Pelanggan BERHASIL dibuat → draft tak berguna lagi. Dihapus hanya di sini, supaya semua
    // jalur gagal/timeout tetap bisa dilanjutkan.
    forgetDraft(context);
    deleteUserState(stateSender);
}

/**
 * Jawaban atas tawaran LANJUT/BARU. Inti perbaikan "kerja teknisi hangus": draft memulihkan DATA
 * dan BUKTI, tapi TIDAK pernah memulihkan kandidat modem — status modem justru hal yang berubah
 * selama teknisi menunggu (itulah sebabnya dia menunggu), jadi selalu dibaca ulang dari ACS.
 */
async function handleResumeAnswer(context, lower) {
    const { teknisiState, reply, deleteUserState, stateSender, packages, logger = console } = context;
    const draft = (teknisiState && teknisiState.context && teknisiState.context.draft) || null;

    if (["batal", "cancel", "ga jadi", "gajadi"].includes(lower)) {
        // Batal di layar TAWARAN hanya menutup pertanyaannya — draftnya sengaja DIPERTAHANKAN,
        // karena teknisi di sini belum tentu membatalkan PSB-nya (bisa jadi cuma salah ketik).
        deleteUserState(stateSender);
        await safeReply(reply, "❌ Oke. Draft PSB tetap saya simpan — ketik *#PSB* kapan saja untuk melanjutkan.", logger);
        return { handled: true };
    }

    if (["baru", "mulai baru", "ulang", "mulai dari awal"].includes(lower)) {
        forgetDraft(context);
        deleteUserState(stateSender);
        await safeReply(reply, "🗑️ Draft lama dibuang. Kirim *#PSB* + *foto KTP* untuk mulai dari awal.", logger);
        return { handled: true };
    }

    if (!["lanjut", "lanjutkan", "teruskan", "terusin", "resume", "ya", "y", "ok", "oke"].includes(lower)) {
        await safeReply(reply, "Balas *LANJUT* (teruskan yang tadi) atau *BARU* (mulai pelanggan lain dari awal).", logger);
        return { handled: true };
    }

    if (!draft || !draft.data) {
        forgetDraft(context);
        deleteUserState(stateSender);
        await safeReply(reply, "⚠️ Draftnya sudah tidak ada. Mulai lagi: *#PSB* + foto KTP.", logger);
        return { handled: true };
    }

    const ctx = {
        data: draft.data,
        staff: draft.staff || (teknisiState.context && teknisiState.context.staff),
        tempId: draft.tempId,
        dir: draft.dir,
        ktpSaved: !!draft.ktpSaved,
        rumahSaved: !!draft.rumahSaved,
        lokasi: draft.lokasi || null,
        scheduleId: draft.scheduleId || null
    };

    const v = validatePsbData(ctx.data, { packages: packages || global.packages || [], requireDusun: true, requireRtRw: true });
    if (v.ok) ctx.data = v.data;

    if (v.ok && ctx.ktpSaved && ctx.rumahSaved && ctx.lokasi) {
        await safeReply(reply, "🔄 Dilanjutkan — data & bukti yang tadi dipakai lagi. Saya cek modemnya sekarang…", logger);
        await detectAndAskConfirm(context, ctx);
    } else {
        saveStep(context, STEP_COLLECT, ctx);
        await safeReply(reply, `🔄 Dilanjutkan. Tinggal lengkapi yang kurang:\n\n${collectChecklistText(context, ctx, v)}`, logger);
    }
    return { handled: true };
}

// ── Router state (owner "psb") ──
async function handlePsbConversationState(context) {
    context = withPsbDeps(context);
    const { stateStep, teknisiState, type, msg, chats, reply, downloadMedia, deleteUserState, stateSender, nowMs = Date.now(), logger = console } = context;

    if (!PSB_STEPS.has(stateStep)) return { handled: false };

    const text = String(chats || "").trim();
    const lower = text.toLowerCase();

    // Tawaran LANJUT/BARU ditangani PALING DULU: konteks step ini berisi `draft`, bukan `data`,
    // sehingga gerbang "konteks rusak" di bawah akan salah memvonisnya sesi yang terputus.
    if (stateStep === STEP_RESUME) {
        return await handleResumeAnswer(context, lower);
    }

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

    if (["batal", "cancel", "ga jadi", "gak jadi", "gajadi"].includes(lower)) {
        // BATAL menutup SESI-nya, bukan membuang pekerjaannya. Dulu cabang ini membuang draft dan
        // berkata "Tidak ada data/perubahan yang disimpan" — bertabrakan dengan layar ⛔ dan layar
        // bentrok nomor yang justru menjanjikan "*BATAL* (datamu tetap tersimpan)". Padahal di situlah
        // BATAL paling sering dipakai: teknisi mundur sambil menunggu admin membebaskan modem.
        // Membuang draft di sana persis menghidupkan lagi masalah yang #b220 tutup (kerja hangus).
        // Jalan membuang tetap ada dan ditawarkan tepat saat relevan: balas *BARU* di layar tawaran.
        deleteUserState(stateSender);
        await safeReply(reply, pesanBatalPsb(), logger);
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
        saveStep(context, STEP_COLLECT, ctx);

        // Bentrok nomor dihadang DI SINI — sebelum teknisi disuruh memotret rumah, share lokasi,
        // dan mencocokkan SN modem untuk pendaftaran yang sudah pasti ditolak di ujung.
        const bentrok = ctx.data.hp ? cariBentrokNomor(context, ctx.data.hp) : null;
        if (bentrok) {
            await safeReply(reply, pesanBentrokNomor(bentrok, ctx.data.hp), logger);
            return { handled: true };
        }

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
            if (await mintaPenegasanAmbilAlih(context, ctx, ctx.candidate, nowMs)) return { handled: true };
            await provision(context, ctx, ctx.candidate);
            return { handled: true };
        }
        if (["tidak", "beda", "no", "n", "salah"].includes(lower)) {
            if (!ctx.candidates || ctx.candidates.length === 0) { await safeReply(reply, "Tak ada kandidat lain. Balas *REFRESH* atau *BATAL*.", logger); return { handled: true }; }
            saveStep(context, STEP_PICK, ctx);
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
            if (await mintaPenegasanAmbilAlih(context, ctx, picked, nowMs)) return { handled: true };
            await provision(context, ctx, picked);
            return { handled: true };
        }
        await safeReply(reply, candidateListText(context, ctx.candidates || [], nowMs), logger);
        return { handled: true };
    }

    // ── Fase penegasan ambil-alih modem ──
    if (stateStep === STEP_TAKEOVER) {
        // Hanya kata penegasan yang PERSIS diterima. Sengaja tidak menerima "ya"/"ok"/"oke":
        // penegasan yang menanggung risiko mematikan pelanggan lain tak boleh bisa dijawab refleks
        // dengan kata yang dipakai di layar-layar lain.
        if (lower.replace(/\s+/g, " ") === KATA_AMBIL_ALIH) {
            if (!ctx.candidate) { await safeReply(reply, "Modem yang tadi ditanyakan sudah tak ada di sesi ini. Balas *REFRESH* atau ketik `cari <SN stiker>`.", logger); return { handled: true }; }
            const p = ctx.candidate.provenance || {};
            // Jejak siapa yang menegaskan — ini keputusan berisiko, jadi harus ada namanya.
            logger?.log?.(`[PSB_DM] AMBIL ALIH MODEM ditegaskan oleh ${ctx.staff && (ctx.staff.name || ctx.staff.username)} (id ${ctx.staff && ctx.staff.id}): SN ${ctx.candidate.serialNumber} (${ctx.candidate.deviceId}) — kredensial lama ${p.previousPppoe || "?"}, pemilik tercatat ${p.ownerName || "tak dikenal"}`);
            await provision(context, ctx, ctx.candidate);
            return { handled: true };
        }
        if (["tidak", "belum", "no", "n"].includes(lower)) {
            await safeReply(reply, [
                `👍 Bagus — jangan diteruskan kalau belum pasti.`,
                ``,
                `Cek dulu ke lapangan, lalu kembali ke sini dan ketik \`cari <SN stiker>\`.`,
                `Datamu tetap tersimpan.`
            ].join("\n"), logger);
            return { handled: true };
        }
        if (lower === "refresh") { await detectAndAskConfirm(context, ctx); return { handled: true }; }
        const hintTakeover = parseSearchHint(text);
        if (hintTakeover) { await searchAndList(context, ctx, hintTakeover); return { handled: true }; }
        if (looksLikeSnInput(text)) { await searchAndList(context, ctx, text); return { handled: true }; }
        await safeReply(reply, `Ketik *${KATA_AMBIL_ALIH.toUpperCase()}* kalau modem itu sudah benar-benar dilepas dari pemilik lamanya, *TIDAK* kalau belum yakin, atau *BATAL*.`, logger);
        return { handled: true };
    }

    return { handled: false };
}

// ── Sesi kedaluwarsa TIDAK BOLEH senyap ──────────────────────────────────────────────────────
// `conversation-handler` menghapus state setelah 15 menit dan SUDAH menyediakan registry handler
// timeout (`registerStateTimeoutHandler`) — tapi PSB tak pernah mendaftar apa pun ke situ. Akibatnya
// sesi lenyap tanpa sepatah kata: teknisi mengetik `ya`/`refresh` dan bot DIAM TOTAL (terekam di prod
// 2026-08-12 14:23–14:26: `Final intent: undefined` lalu tak ada balasan sama sekali), lalu wajar
// menyimpulkan botnya rusak. Dua hal yang dikerjakan di sini: SIMPAN draftnya, lalu BERI TAHU cara
// melanjutkan. NEVER-THROW — ini jalan di timer, tak ada pemanggil yang bisa menangkap errornya.
async function handlePsbStateTimeout(userId, state, deps = {}) {
    const ctx = (state && state.context) || null;
    if (!ctx || !ctx.data) return;

    try {
        const store = deps.draftStore || require("../../../lib/psb-draft-store");
        store.putDraft(userId, draftFromCtx(state.step, ctx));
    } catch (e) {
        console.error("[PSB_DM] simpan draft saat timeout gagal:", e.message);
    }

    try {
        const sendReply = deps.sendReply || require("../reply-runtime").sendReply;
        await sendReply({
            recipient: userId,
            text: [
                `⏳ Sesi *PSB${ctx.data.nama ? ` ${ctx.data.nama}` : ""}* berhenti karena 15 menit tak ada balasan.`,
                ``,
                `✅ Tenang — *datanya tersimpan*: foto KTP, foto rumah, lokasi, dan semua isian TIDAK hilang.`,
                ``,
                `▶️ Mau lanjut (mis. modemnya sudah dibebaskan admin)? ketik *#PSB* lalu balas *LANJUT*.`
            ].join("\n")
        });
    } catch (e) {
        console.error("[PSB_DM] kabar sesi kedaluwarsa gagal:", e.message);
    }
}

/**
 * Pembatalan lewat kata batal UNIVERSAL (`batal`/`cancel`/`ga jadi`/`gak jadi`) — dicegat
 * `message/raf.js` sebelum router state, jadi cabang BATAL wizard tak pernah kebagian. Handler ini
 * yang memastikan jawabannya sama persis lewat jalur mana pun: sesi ditutup, draft DIPERTAHANKAN,
 * dan teknisi diberi tahu dua jalan lanjutannya. NEVER-THROW.
 */
async function handlePsbStateCancel(userId, state, deps = {}) {
    const kirim = deps.reply || (async (teks) => {
        const { sendReply } = require("../reply-runtime");
        return sendReply({ recipient: userId, text: teks });
    });
    try {
        await kirim(pesanBatalPsb());
        return { handled: true };
    } catch (e) {
        console.error("[PSB_DM] balasan pembatalan gagal:", e.message);
        return { handled: false };
    }
}

// Daftarkan ke registry timeout & pembatalan milik conversation-handler. Hanya langkah yang
// MENYIMPAN KERJA teknisi (STEP_RESUME tak ikut — isinya cuma pertanyaan, draftnya sudah aman
// di disk, dan pembatalan di sana sudah punya balasannya sendiri).
try {
    const { registerStateTimeoutHandler, registerStateCancelHandler } = require("../conversation-handler");
    if (typeof registerStateTimeoutHandler === "function") {
        RESUMABLE_STEPS.forEach((step) => registerStateTimeoutHandler(step, handlePsbStateTimeout));
    }
    if (typeof registerStateCancelHandler === "function") {
        RESUMABLE_STEPS.forEach((step) => registerStateCancelHandler(step, handlePsbStateCancel));
    }
} catch (e) {
    console.error("[PSB_DM] gagal mendaftarkan handler timeout/batal PSB:", e.message);
}

module.exports = {
    handlePsbConversationState,
    handlePsbStateTimeout,
    hasPsbDraft,
    startPsbSession,
    parsePsbScheduleRef,
    buildPppoeUsername,
    stickerSn,
    snText,
    looksLikeSnInput,
    isPsbTutorialTrigger,
    isPsbBareCommand,
    handlePsbStateCancel,
    psbTutorialText,
    PSB_STEPS,
    RESUMABLE_STEPS,
    STEP_COLLECT,
    STEP_CONFIRM,
    STEP_PICK,
    STEP_RESUME
};
