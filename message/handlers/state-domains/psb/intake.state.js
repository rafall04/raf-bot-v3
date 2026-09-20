/**
 * Header Doc
 * Purpose: Fase intake wizard PSB — trigger/panduan (#PSB, panduan, #psb<jadwal>), startPsbSession (baru/lanjut draft), handleResumeAnswer. (dipindah utuh dari psb.state.js, split #b396 — murni pemindahan).
 * Caller: `state-domains/psb.state.js` (facade) & submodul psb lain.
 * MainFuncs: lihat isi modul — nama & perilaku identik file asli.
 * SideEffects: identik psb.state.js asli — tulis draft/uploads, kirim reply lewat deps ter-inject.
 */
"use strict";

const path = require("path");
const { extractPsbFields, validatePsbData } = require("../../psb-caption-parser");
const { PSB_TEMPLATE, STEP_COLLECT, STEP_RESUME, cariBentrokNomor, collectChecklistText, forgetDraft, pesanBentrokNomor, readDraft, resumeOfferText, safeReply, saveMedia, saveStep, withPsbDeps } = require("./shared");
const { detectAndAskConfirm, startLinkedSession } = require("./confirm.state");

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

module.exports = {
    isPsbTutorialTrigger,
    isPsbBareCommand,
    parsePsbScheduleRef,
    psbTutorialText,
    startPsbSession,
    handleResumeAnswer,
};
