/**
 * Header Doc
 * Purpose: Mesin slot-filling wizard PSB — dispatcher handlePsbConversationState per-step + handler timeout/cancel (draft durabel). (dipindah utuh dari psb.state.js, split #b396 — murni pemindahan).
 * Caller: `state-domains/psb.state.js` (facade) & submodul psb lain.
 * MainFuncs: lihat isi modul — nama & perilaku identik file asli.
 * SideEffects: identik psb.state.js asli — tulis draft/uploads, kirim reply lewat deps ter-inject.
 */
"use strict";

const { extractPsbFields, validatePsbData } = require("../../psb-caption-parser");
const { KATA_AMBIL_ALIH, PSB_STEPS, RESUMABLE_STEPS, STEP_COLLECT, STEP_CONFIRM, STEP_PICK, STEP_RESUME, STEP_TAKEOVER, cariBentrokNomor, collectChecklistText, draftFromCtx, dusunOptions, pesanBatalPsb, pesanBentrokNomor, safeReply, saveMedia, saveStep, withPsbDeps } = require("./shared");
const { candidateListText, detectAndAskConfirm, looksLikeSnInput, mintaPenegasanAmbilAlih, parseSearchHint, provision, searchAndList } = require("./confirm.state");
const { handleResumeAnswer } = require("./intake.state");

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
        const store = deps.draftStore || require("../../../../lib/psb-draft-store");
        store.putDraft(userId, draftFromCtx(state.step, ctx));
    } catch (e) {
        console.error("[PSB_DM] simpan draft saat timeout gagal:", e.message);
    }

    try {
        const sendReply = deps.sendReply || require("../../reply-runtime").sendReply;
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
        const { sendReply } = require("../../reply-runtime");
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
    const { registerStateTimeoutHandler, registerStateCancelHandler } = require("../../conversation-handler");
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
    handlePsbStateCancel,
};
