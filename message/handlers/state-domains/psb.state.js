/**
 * Header Doc
 * Purpose: State domain wizard PSB via DM teknisi (per-bot area) — bagian Fase 2 [[psb-simplification-plan]].
 *          Alur SLOT-FILLING: teknisi DM `#PSB` + foto KTP (data caption OPSIONAL) → bot kumpulkan
 *          data (Nama/Dusun/Paket/WiFi/Sandi/HP — boleh dicicil per pesan) + foto rumah + share lokasi
 *          URUTAN BEBAS, tampilkan checklist & nagih yg kurang → begitu lengkap bot BACA modem (recency
 *          `_registered`) → tampilkan RINGKASAN data + username PPPoE rakitan + SN utk diverifikasi teknisi
 *          (YA/TIDAK/pilih-nomor) → HANYA setelah YA: buat pelanggan + secret PPPoE + push PPPoE+WiFi ke
 *          modem + welcome → ringkasan ke grup PSB. Konfirmasi = gate verifikasi sebelum sentuh apa pun.
 *          Username PPPoE dirakit bot dari Nama + Dusun jadi `<nama>-<dusun>@<realm>` (teknisi tak ketik
 *          format-nya), password pakai `config.defaultPPPoEPassword` (bukan acak).
 * Caller: `message/handlers/conversation-state-router.js` (owner "psb") + trigger `startPsbSession` dari
 *         `message/raf.js` (jalur DM teknisi).
 * Deps (via context/inject, patuh invariant [[raf-invariants]]): `reply` (delivery boundary), `downloadMedia`
 *        (`lib/whatsapp.adapter`), `setUserState/deleteUserState` (`conversation-handler`), `findRecentPsbCandidates`
 *        (`lib/psb-genieacs-service`), `fetchDeviceCapability` (`lib/wifi-bulk-reconcile` — SSID sadar-band:
 *        2.4G index 1 selalu, 5G index 5 hanya bila modem dual-band), `usersService` (`global.__apiUsersService`),
 *        `getConfig`, `packages`, `sendGroupSummary`. Require langsung: `./psb-caption-parser`, `fs`, `path`.
 * MainFuncs: `startPsbSession(context)`, `handlePsbConversationState(context)`.
 * SideEffects: Tulis foto KTP/rumah + lokasi ke `uploads/psb/...`, buat pelanggan + push modem GenieACS +
 *              kirim WA (welcome pelanggan + ringkasan grup). Reply teknisi & ringkasan grup JUJUR ikut
 *              hasil push modem (`body.device_config{attempted,ok}`): klaim "online/di-push" hanya bila
 *              `ok`, selain itu minta set manual (anti sukses-semu). NEVER-THROW.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { extractPsbFields, validatePsbData } = require("../psb-caption-parser");

// Field data PSB yang dikumpulkan wizard (label utk checklist + urutan tampil).
const PSB_DATA_FIELDS = [
    { key: "nama", label: "Nama" },
    { key: "dusun", label: "Dusun" },
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
        "",
        "*5) Cek ringkasan → balas *YA**",
        "Bot buat pelanggan + set modem + kirim welcome. Tak ada yang ditulis sebelum kamu balas YA.",
        "",
        "🤖 *Otomatis (tak usah ketik):* username PPPoE (Nama+Dusun), password, WiFi 2.4GHz (+5GHz bila dual-band).",
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
function snText(sn) {
    return String(sn || "").trim();
}

function minutesAgo(iso, nowMs) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "?";
    const m = Math.max(0, Math.round((nowMs - t) / 60000));
    return m < 60 ? `${m} mnt lalu` : `${Math.round(m / 60)} jam lalu`;
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

function fieldMark(status) {
    if (status === "ok") return "✅";
    if (status === "short" || status === "unknown" || status === "invalid") return "⚠️";
    return "⬜"; // missing / optional
}

// Checklist slot-filling: status tiap field data (dari validatePsbData) + foto rumah + lokasi.
// Data boleh dikirim dicicil & urutan bebas; bot nagih yang masih ⬜/⚠️.
const FIELD_HINT = { dusun: "(lokasi pasang, bukan KTP)", wifi_ssid: "(nama wifi)", wifi_password: "(min 8 huruf)", hp: "(nomor WA; >1 pisah |)" };
function collectChecklistText(ctx, v) {
    const s = (v && v.status) || {};
    const dataLines = PSB_DATA_FIELDS.map((f) => {
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
        return `${fieldMark(st)} ${f.label}${tail}`;
    });
    return [
        `📋 *PSB* — lengkapi (urutan BEBAS):`,
        ...dataLines,
        `${ctx.ktpSaved ? "✅" : "⬜"} Foto KTP`,
        `${ctx.rumahSaved ? "✅" : "⬜"} Foto rumah`,
        `${ctx.lokasi ? "✅" : "⬜"} Share lokasi`,
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
    const seed = { nama: rec.name || "", dusun: rec.dusun || "", paket: rec.paket || "", wifi_ssid: "", wifi_password: "", hp: rec.phone_number || "" };
    const now = new Date(nowMs);
    const tempId = `PSBDM_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
    const dir = path.join(uploadsBaseDir, "psb", String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"), tempId);
    const ktpSaved = reuseScheduleMedia(rec.ktp_photo_path, dir, "ktp_photo.jpg");
    const rumahSaved = reuseScheduleMedia(rec.house_photo_path, dir, "rumah_photo.jpg");
    const lokasi = (rec.latitude != null && rec.longitude != null) ? { lat: rec.latitude, lng: rec.longitude } : null;

    const ctx = { data: seed, staff, tempId, dir, ktpSaved, rumahSaved, lokasi, scheduleId: rec.id };
    const v = validatePsbData(ctx.data, { packages: pkgs, requireDusun: true });
    if (v.ok) ctx.data = v.data;
    setUserState(stateSender, { step: STEP_COLLECT, _scope: "teknisi", context: ctx });

    const filled = `👤 ${seed.nama} · Dusun ${seed.dusun} · 📦 ${seed.paket} · 📱 ${seed.hp}`;
    if (v.ok && ktpSaved && rumahSaved && lokasi) {
        await safeReply(reply, `🔗 *${rec.ref}* — data & 3 bukti dari jadwal dipakai (nol ketik ulang).\n${filled}\n\nLanjut cari modem…`, logger);
        await detectAndAskConfirm(context, ctx);
    } else {
        await safeReply(reply, `🔗 *${rec.ref}* — data & foto jadwal dipakai. Lengkapi sisanya (biasanya *WiFi* & *Sandi*):\n${filled}\n\n${collectChecklistText(ctx, v)}`, logger);
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
    const seed = { nama: "", dusun: "", paket: "", wifi_ssid: "", wifi_password: "", hp: "", ...extractPsbFields(caption) };

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

    const v = validatePsbData(ctx.data, { packages: pkgs, requireDusun: true });
    await safeReply(reply, `✅ Foto KTP diterima.\n\n${collectChecklistText(ctx, v)}`, logger);
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

    // ODP terdekat (yang masih ada sisa port) dari titik rumah → tampil di layar konfirmasi, ikut
    // di-YA-kan teknisi bersama SN modem. Nol langkah tambahan, tapi tetap ADA mata manusia.
    ctx.odp = resolveNearestOdp(context, ctx);

    let candidates = [];
    try {
        const res = await findRecentPsbCandidates({ windowMinutes, limit: 10, nowMs });
        if (res && res.ok) candidates = res.data || [];
    } catch (e) { logger?.error?.("[PSB_DM] deteksi modem gagal:", e.message); }

    if (candidates.length === 0) {
        setUserState(stateSender, { step: STEP_CONFIRM, _scope: "teknisi", context: { ...ctx, candidate: null, candidates: [] } });
        await safeReply(reply, [
            ...customerRecapLines(ctx),
            ``,
            `⚠️ Data siap, tapi *belum ada modem baru terbaca* di ACS (window ${windowMinutes} mnt). Pastikan modem nyala & terhubung, lalu balas *REFRESH*. Atau *BATAL*.`
        ].join("\n"), logger);
        return;
    }

    const top = candidates[0];
    setUserState(stateSender, { step: STEP_CONFIRM, _scope: "teknisi", context: { ...ctx, candidate: top, candidates } });
    await safeReply(reply, [
        `📋 *CEK DULU sebelum dieksekusi:*`,
        ...customerRecapLines(ctx),
        `📡 Modem: SN \`${snText(top.serialNumber)}\` · ${top.model} · reg ${minutesAgo(top.registeredDate, nowMs)}`,
        ``,
        `Semua BENAR & modem cocok stiker? Balas *YA* (eksekusi) · *TIDAK* (ganti modem) · *BATAL*`
    ].join("\n"), logger);
}

function candidateListText(candidates, nowMs) {
    const nums = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
    const lines = candidates.slice(0, 10).map((c, i) => `${nums[i] || (i + 1) + "."} SN \`${snText(c.serialNumber)}\` · ${c.model} · reg ${minutesAgo(c.registeredDate, nowMs)}`);
    return `Pilih modem yang cocok dgn stiker (balas *angka*), atau *REFRESH* / *BATAL*:\n${lines.join("\n")}`;
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
    let ssidIndices = String(psbCfg.defaultSsidIndices || cfg.defaultBulkSSID || "1").split(",").map((s) => s.trim()).filter(Boolean);
    let bandLabel = "";
    let bandDetected = false;
    if (candidate && candidate.deviceId && typeof fetchDeviceCapability === "function") {
        try {
            const cap = await fetchDeviceCapability(candidate.deviceId, { operation: "psb.dm.ssidCapability" });
            if (cap && cap.found && Array.isArray(cap.expectedBulk) && cap.expectedBulk.length > 0) {
                ssidIndices = cap.expectedBulk;
                bandDetected = true;
                bandLabel = cap.has5G ? "2.4GHz + 5GHz" : "2.4GHz";
            } else {
                logger?.warn?.(`[PSB_DM] band modem ${candidate.deviceId} tak terbaca — pakai default SSID [${ssidIndices.join(",")}]`);
            }
        } catch (e) { logger?.error?.("[PSB_DM] deteksi band modem gagal:", e.message); }
    }

    let result;
    try {
        result = await usersService.upsertUserFromAdminPanel({
            userData: {
                name: ctx.data.nama,
                phone_number: ctx.data.hp,
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
    // Password PPPoE TAK ditampilkan ke teknisi (akses admin). WiFi tetap tampil (kredensial pelanggan).
    const credLines = [
        `PPPoE: \`${pppoeUser}\``,
        `WiFi: ${ctx.data.wifi_ssid} / ${ctx.data.wifi_password}`
    ];
    const snLine = candidate ? `Modem: SN \`${snText(candidate.serialNumber)}\` (${candidate.model})` : "Modem: (tak ada device terpilih)";

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
    if (!ctx || !ctx.data) { deleteUserState(stateSender); return { handled: true }; }

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
            // Teks → ambil field yang ada, MERGE ke data terkumpul (boleh dicicil / dikoreksi ulang).
            const fields = extractPsbFields(text);
            for (const [k, val] of Object.entries(fields)) { if (val) ctx.data[k] = val; }
        }

        // Cek kelengkapan tiap pesan. Bila lengkap → adopsi nilai ternormalisasi (paket resolved, hp joined).
        const v = validatePsbData(ctx.data, { packages: pkgs, requireDusun: true });
        if (v.ok) ctx.data = v.data;
        setUserState(stateSender, { step: STEP_COLLECT, _scope: "teknisi", context: ctx });

        if (v.ok && ctx.ktpSaved && ctx.rumahSaved && ctx.lokasi) {
            await detectAndAskConfirm(context, ctx);
        } else {
            await safeReply(reply, collectChecklistText(ctx, v), logger);
        }
        return { handled: true };
    }

    // ── Fase konfirmasi modem ──
    if (stateStep === STEP_CONFIRM) {
        if (["ya", "yes", "ok", "oke", "cocok", "y"].includes(lower)) {
            if (!ctx.candidate) { await safeReply(reply, "Belum ada modem terbaca. Balas *REFRESH* setelah modem online.", logger); return { handled: true }; }
            await provision(context, ctx, ctx.candidate);
            return { handled: true };
        }
        if (["tidak", "beda", "no", "n", "salah"].includes(lower)) {
            if (!ctx.candidates || ctx.candidates.length === 0) { await safeReply(reply, "Tak ada kandidat lain. Balas *REFRESH* atau *BATAL*.", logger); return { handled: true }; }
            setUserState(stateSender, { step: STEP_PICK, _scope: "teknisi", context: ctx });
            await safeReply(reply, candidateListText(ctx.candidates, nowMs), logger);
            return { handled: true };
        }
        if (lower === "refresh") { await detectAndAskConfirm(context, ctx); return { handled: true }; }
        await safeReply(reply, "Balas *YA* (cocok) · *TIDAK* (pilih dari daftar) · *REFRESH* · *BATAL*.", logger);
        return { handled: true };
    }

    // ── Fase pilih nomor modem ──
    if (stateStep === STEP_PICK) {
        if (lower === "refresh") { await detectAndAskConfirm(context, ctx); return { handled: true }; }
        const n = parseInt(text, 10);
        if (Number.isInteger(n) && n >= 1 && n <= (ctx.candidates || []).length) {
            await provision(context, ctx, ctx.candidates[n - 1]);
            return { handled: true };
        }
        await safeReply(reply, candidateListText(ctx.candidates || [], nowMs), logger);
        return { handled: true };
    }

    return { handled: false };
}

module.exports = {
    handlePsbConversationState,
    startPsbSession,
    parsePsbScheduleRef,
    buildPppoeUsername,
    isPsbTutorialTrigger,
    psbTutorialText,
    PSB_STEPS,
    STEP_COLLECT,
    STEP_CONFIRM,
    STEP_PICK
};
