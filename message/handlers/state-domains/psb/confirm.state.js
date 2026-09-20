/**
 * Header Doc
 * Purpose: Fase konfirmasi modem wizard PSB — deteksi kandidat (provenance/online), search/pick/takeover, penegasan ambil-alih, lalu provisioning (anti kerja-dobel SEDANG_PROVISION). (dipindah utuh dari psb.state.js, split #b396 — murni pemindahan).
 * Caller: `state-domains/psb.state.js` (facade) & submodul psb lain.
 * MainFuncs: lihat isi modul — nama & perilaku identik file asli.
 * SideEffects: identik psb.state.js asli — tulis draft/uploads, kirim reply lewat deps ter-inject.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { validatePsbData, titleCaseDusun } = require("../../psb-caption-parser");
const { renderResponseTemplate } = require("../../template-helpers");
const { KATA_AMBIL_ALIH, ONLINE_INFORM_MAX_MS, STEP_COLLECT, STEP_CONFIRM, STEP_PICK, STEP_TAKEOVER, buildCustomerAddress, buildPppoeUsername, collectChecklistText, forgetDraft, minutesAgo, readDraft, reuseScheduleMedia, safeReply, saveStep, snText, stickerSn } = require("./shared");

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
        const svc = context.assetService || require("../../../../lib/network-assets-service");
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
    // !! URUTAN PENTING — yang SPESIFIK harus didahulukan.
    // `lib/phone-validator-international.js` memulangkan "Duplicate phone numbers found in input";
    // tanpa cabang HP di ATAS cabang `duplicate` generik, teknisi diberi tahu "nama akun PPPoE-nya
    // sudah dipakai" untuk masalah NOMOR HP — salah sasaran, dan menyuruh dia membetulkan hal yang
    // tidak rusak. Sebab yang salah lebih berbahaya daripada sebab yang kabur.
    if (s.includes("phone") || s.includes("nomor") || s.includes("hp ")) {
        if (s.includes("duplicate") || s.includes("sudah dipakai") || s.includes("sudah digunakan")) {
            return "nomor HP-nya sudah terdaftar atas pelanggan lain";
        }
        return "nomor HP-nya tidak sesuai format";
    }
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

    // ── Deteksi band yang GAGAL/BASI jangan mengendap jadi "fakta" ──
    // Modem yang baru semenit terdaftar di ACS sering belum selesai ditelusuri, sehingga WLAN 5GHz
    // tak terlihat dan `bulk` tersimpan ["1"]. Akibatnya nyata: saat pelanggan minta ganti nama/sandi
    // WiFi, band 5GHz TAK ikut berubah — dan pada modem BEKAS, WiFi pemilik lama bisa tetap hidup di
    // sana. Push barusan memicu refresh container WLAN utuh, jadi baca ULANG sekali: bila ternyata
    // dual-band, betulkan `bulk` DAN dorong WiFi ke indeks yang belum tersentuh. Best-effort, never-throw.
    // Pemicu DIPERLUAS: bukan hanya saat device tak terbaca sama sekali (`!bandDetected`), tapi juga
    // saat bacaan pertama memberi vonis single-band — vonis itu bisa BASI untuk alasan yang sama
    // (instance 5 belum keenumerasi), dan dulu ia mematikan retry sehingga modem dual-band selamanya
    // hanya di-push 2.4GHz.
    const { SSID_5G_INDEX } = require("../../../../lib/wifi-bulk-reconcile");
    if (pushOk && newUserId && candidate && candidate.deviceId && (!bandDetected || !ssidIndices.includes(SSID_5G_INDEX))) {
        const secondRead = await readBandCapability(
            fetchDeviceCapability, candidate.deviceId, "psb.dm.ssidCapability.retry", logger
        );
        if (secondRead) {
            const missing = secondRead.indices.filter((i) => !ssidIndices.includes(i));
            bandDetected = true;
            bandLabel = secondRead.label;
            ssidIndices = secondRead.indices;
            // Koreksi `bulk` HANYA bila ada index yang benar-benar berubah — modem yang memang
            // single-band memicu baca-ulang ini juga, dan menulis ulang nilai yang sama hanya
            // menambah riwayat audit tanpa guna.
            if (missing.length) {
                try {
                    await usersService.updateUserById({
                        id: newUserId,
                        userData: { bulk: secondRead.indices },
                        actor: { id: ctx.staff.id, username: ctx.staff.username, name: ctx.staff.name || ctx.staff.username, role: ctx.staff.role },
                        requestMeta: { ipAddress: "wa-dm-psb", userAgent: "psb-dm-wizard" }
                    });
                    logger?.log?.(`[PSB_DM] bulk dikoreksi ke [${secondRead.indices.join(",")}] setelah band terbaca`);
                } catch (e) { logger?.error?.("[PSB_DM] koreksi bulk gagal:", e.message); }

                if (ctx.data.wifi_ssid && ctx.data.wifi_password) {
                    try {
                        const { updatePsbDeviceConfig: pushDeviceConfig } = require("../../../../lib/genieacs-helper");
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

module.exports = {
    resolveNearestOdp,
    customerRecapLines,
    annotateCandidates,
    provBadge,
    takeoverConfirmText,
    mintaPenegasanAmbilAlih,
    detectAndAskConfirm,
    parseSearchHint,
    looksLikeSnInput,
    searchAndList,
    candidateListText,
    readBandCapability,
    SEDANG_PROVISION,
    pelangganSudahAda,
    sebabTerbaca,
    teksGagalProvision,
    provision,
    provisionInner,
    startLinkedSession,
    detectedLabel,
    offlineWarningLine,
};
