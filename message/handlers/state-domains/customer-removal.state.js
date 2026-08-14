/**
 * Header Doc
 * Purpose: State domain wizard COPOT PELANGGAN via WhatsApp (admin). Alur: `copot <nama/HP/ID>` →
 *          bot mencari → bila banyak, pilih nomor → layar rincian + KODE ACAK 4 digit → admin
 *          mengetik kodenya → eksekusi. Penegasan sengaja memakai kode acak, BUKAN kata seperti
 *          "YA": ini tindakan yang memutus internet seseorang dan menghapus datanya, jadi
 *          jawabannya harus membuktikan layarnya benar-benar dibaca — bukan refleks.
 *          Hasilnya dilaporkan PER LANGKAH (sesi, kredensial PPPoE, data, port ODP) dan bila
 *          kredensial PPPoE gagal dihapus, admin diberi tahu bahwa modemnya MASIH bisa konek
 *          (akar "modem hantu" — lihat `lib/orphan-pppoe-service.js`).
 * Caller: `message/handlers/conversation-state-router.js` (owner "customer-removal") + trigger
 *         `startCustomerRemoval` dari `message/raf.js`.
 * Deps (via context/inject): `reply` (delivery boundary), `setUserState`/`deleteUserState`
 *        (`conversation-handler`), `usersService` (`global.__apiUsersService` → `deleteUserById`),
 *        `getUsers` (`global.users`).
 * MainFuncs: `startCustomerRemoval(context)`, `handleCustomerRemovalState(context)`,
 *            `isCustomerRemovalTrigger(text)`, `parseCustomerRemovalQuery(text)`.
 * SideEffects: Menghapus pelanggan + kredensial PPPoE + sesi aktif lewat `usersService`. NEVER-THROW.
 */
"use strict";

const STEP_PILIH = "COPOT_PILIH";
const STEP_KODE = "COPOT_KODE";
const COPOT_STEPS = new Set([STEP_PILIH, STEP_KODE]);

// `copot <kata kunci>` — pagar sengaja ketat: butuh kata `copot` DI AWAL plus kata kunci minimal
// 2 karakter, supaya kalimat biasa yang memuat "copot" tak pernah membuka wizard destruktif ini.
function isCustomerRemovalTrigger(text) {
    return /^\s*copot\s+.{2,}\s*$/i.test(String(text || ""));
}

function parseCustomerRemovalQuery(text) {
    const m = String(text || "").trim().match(/^copot\s+(.{2,})$/i);
    return m ? m[1].trim() : null;
}

async function safeReply(reply, text, logger) {
    try { if (reply) await reply(text); } catch (e) { logger?.error?.("[COPOT] gagal balas:", e.message); }
}

function digits(v) {
    return String(v === null || v === undefined ? "" : v).replace(/\D/g, "");
}

// Cocokkan nama (mengandung), nomor HP (9 digit terakhir, supaya 0812… = 62812…), atau ID persis.
function cariPelanggan(daftar, query) {
    const q = String(query || "").trim().toLowerCase();
    const qd = digits(q);
    const ekor = qd.length >= 9 ? qd.slice(-9) : null;
    return (Array.isArray(daftar) ? daftar : []).filter((u) => {
        if (!u) return false;
        if (String(u.id) === q) return true;
        if (String(u.name || "").toLowerCase().includes(q)) return true;
        if (ekor) {
            const nomor = [u.phone_number, u.alternative_phone]
                .flatMap((v) => String(v || "").split("|"))
                .map(digits)
                .filter((d) => d.length >= 9)
                .map((d) => d.slice(-9));
            if (nomor.includes(ekor)) return true;
        }
        return false;
    });
}

function ringkasBaris(u, i) {
    return `${i + 1}. *${u.name}* · ${u.subscription || "-"} · ${u.phone_number || "tanpa HP"}${u.pppoe_username ? ` · \`${u.pppoe_username}\`` : ""}`;
}

// Kode acak 4 digit. Tujuannya bukan rahasia — tujuannya memaksa MEMBACA layar sebelum menjawab.
function buatKode(rng) {
    const r = typeof rng === "function" ? rng() : Math.random();
    return String(1000 + Math.floor(r * 9000));
}

function layarKonfirmasi(u, kode) {
    return [
        `⚠️ *COPOT PELANGGAN — tidak bisa dibatalkan.*`,
        ``,
        `👤 *${u.name}*`,
        `📦 ${u.subscription || "-"}`,
        `📱 ${u.phone_number || "(tanpa HP)"}`,
        `🔑 PPPoE: ${u.pppoe_username ? `\`${u.pppoe_username}\`` : "(tidak ada)"}`,
        `📡 Modem: ${u.device_id || "(belum tertaut)"}`,
        ``,
        `Yang akan dikerjakan:`,
        `1. Putuskan sesi internetnya sekarang`,
        `2. Hapus kredensial PPPoE di MikroTik`,
        `3. Hapus data pelanggan`,
        `4. Hitung ulang pemakaian port ODP`,
        ``,
        `ℹ️ Riwayat tagihan & invoice TIDAK ikut terhapus.`,
        ``,
        `👉 Untuk memastikan kamu membaca ini, ketik kodenya: *${kode}*`,
        `❌ Batal: *BATAL*`
    ].join("\n");
}

function layarHasil(nama, body) {
    const L = (body && body.langkah) || {};
    const tanda = (s) => (!s || !s.dijalankan ? "➖" : (s.ok ? "✅" : "❌"));
    const sebab = (s) => (s && s.dijalankan && !s.ok && s.pesan ? ` (${s.pesan})` : "");
    const baris = [
        `${tanda(L.sesi_diputus)} Sesi diputus${sebab(L.sesi_diputus)}`,
        `${tanda(L.secret_dihapus)} Kredensial PPPoE dihapus${sebab(L.secret_dihapus)}`,
        `${tanda(L.baris_dihapus)} Data pelanggan dihapus`,
        `${tanda(L.port_odp)} Port ODP dihitung ulang${sebab(L.port_odp)}`
    ];

    if (body && body.perlu_dibersihkan) {
        return [
            `⚠️ *${nama} dicopot, TAPI belum tuntas.*`,
            ``,
            ...baris,
            ``,
            `Kredensial \`${body.pppoe_tertinggal}\` masih ada di MikroTik — modemnya *masih bisa konek*.`,
            `Bersihkan lewat menu *Sisa PPPoE* di panel, atau hapus manual di router.`,
            `Kalau dibiarkan, modem itu akan terus dianggap milik pelanggan tak dikenal saat dipakai PSB.`
        ].join("\n");
    }
    return [`✅ *${nama} dicopot.*`, ``, ...baris].join("\n");
}

async function eksekusi(context, u) {
    const { reply, usersService, staff, deleteUserState, stateSender, logger = console } = context;
    if (!usersService || typeof usersService.deleteUserById !== "function") {
        await safeReply(reply, "❌ Layanan pelanggan tak tersedia saat ini. Coba lagi sebentar lagi.", logger);
        deleteUserState(stateSender);
        return;
    }
    let hasil;
    try {
        hasil = await usersService.deleteUserById({
            userId: u.id,
            actor: { id: staff?.id, username: staff?.username, name: staff?.name || staff?.username, role: staff?.role },
            requestMeta: { ipAddress: "wa-dm-copot", userAgent: "copot-wizard" }
        });
    } catch (e) {
        logger?.error?.("[COPOT] gagal:", e.message);
        await safeReply(reply, `❌ Gagal mencopot *${u.name}*: ${e.message}`, logger);
        deleteUserState(stateSender);
        return;
    }

    if (!hasil || hasil.status >= 400) {
        await safeReply(reply, `❌ Gagal mencopot *${u.name}*: ${(hasil && hasil.body && hasil.body.message) || "tak diketahui"}`, logger);
        deleteUserState(stateSender);
        return;
    }

    logger?.log?.(`[COPOT] ${u.name} (id ${u.id}, pppoe ${u.pppoe_username || "-"}) dicopot oleh ${staff?.name || staff?.username} (id ${staff?.id})`);
    await safeReply(reply, layarHasil(u.name, hasil.body), logger);
    deleteUserState(stateSender);
}

/** Trigger `copot <kata kunci>` dari admin. Dipanggil `message/raf.js`. NEVER-THROW. */
async function startCustomerRemoval(context) {
    const { chats, reply, setUserState, stateSender, staff, getUsers, rng, logger = console } = context;
    const query = parseCustomerRemovalQuery(chats);
    if (!query) return { started: false };

    const daftar = (getUsers ? getUsers() : global.users) || [];
    const cocok = cariPelanggan(daftar, query);

    if (!cocok.length) {
        await safeReply(reply, `🔎 Tak ada pelanggan cocok "*${query}*".\n\nCoba nama, nomor HP, atau ID pelanggan.`, logger);
        return { started: true };
    }

    if (cocok.length > 1) {
        const daftarTeks = cocok.slice(0, 10).map(ringkasBaris).join("\n");
        setUserState(stateSender, { step: STEP_PILIH, _scope: "admin", context: { kandidat: cocok.slice(0, 10), staff } });
        await safeReply(reply, [
            `🔎 Ada ${cocok.length} pelanggan cocok "*${query}*". Pilih yang mana (balas *angka*):`,
            ``,
            daftarTeks,
            ``,
            `❌ Batal: *BATAL*`
        ].join("\n"), logger);
        return { started: true };
    }

    const u = cocok[0];
    const kode = buatKode(rng);
    setUserState(stateSender, { step: STEP_KODE, _scope: "admin", context: { target: u, kode, staff } });
    await safeReply(reply, layarKonfirmasi(u, kode), logger);
    return { started: true };
}

/** Router state (owner "customer-removal"). NEVER-THROW. */
async function handleCustomerRemovalState(context) {
    const { stateStep, teknisiState, chats, reply, setUserState, deleteUserState, stateSender, rng, logger = console } = context;
    if (!COPOT_STEPS.has(stateStep)) return { handled: false };

    const teks = String(chats || "").trim();
    const lower = teks.toLowerCase();
    const ctx = (teknisiState && teknisiState.context) || null;

    if (["batal", "cancel", "ga jadi", "gak jadi", "gajadi"].includes(lower)) {
        deleteUserState(stateSender);
        await safeReply(reply, "❌ Dibatalkan. Tidak ada pelanggan yang dicopot.", logger);
        return { handled: true };
    }

    if (!ctx) {
        deleteUserState(stateSender);
        await safeReply(reply, "⚠️ Sesi copot pelanggan terputus. Ulangi dengan `copot <nama/HP/ID>`.", logger);
        return { handled: true };
    }

    if (stateStep === STEP_PILIH) {
        const n = parseInt(teks, 10);
        const kandidat = ctx.kandidat || [];
        if (!Number.isInteger(n) || n < 1 || n > kandidat.length) {
            await safeReply(reply, `Balas *angka* 1-${kandidat.length}, atau *BATAL*.`, logger);
            return { handled: true };
        }
        const u = kandidat[n - 1];
        const kode = buatKode(rng);
        setUserState(stateSender, { step: STEP_KODE, _scope: "admin", context: { target: u, kode, staff: ctx.staff } });
        await safeReply(reply, layarKonfirmasi(u, kode), logger);
        return { handled: true };
    }

    // STEP_KODE — hanya kode yang PERSIS diterima. Sengaja tak menerima "ya"/"ok": penegasan yang
    // memutus internet seseorang tak boleh bisa dijawab dengan kata yang dipakai di layar lain.
    if (teks === String(ctx.kode)) {
        await eksekusi({ ...context, staff: ctx.staff }, ctx.target);
        return { handled: true };
    }

    await safeReply(reply, `Kode tidak cocok. Ketik *${ctx.kode}* untuk melanjutkan, atau *BATAL* untuk membatalkan.`, logger);
    return { handled: true };
}

module.exports = {
    STEP_PILIH,
    STEP_KODE,
    COPOT_STEPS,
    isCustomerRemovalTrigger,
    parseCustomerRemovalQuery,
    cariPelanggan,
    startCustomerRemoval,
    handleCustomerRemovalState
};
