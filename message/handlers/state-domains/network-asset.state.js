/**
 * Header Doc
 * Purpose: State domain WA aset jaringan — teknisi MENATA jaringan sepenuhnya dari lapangan:
 *            `#ODC <nama>` / `#ODP <nama>`  → petakan aset (nama + share lokasi saja).
 *                                             Nama yang SUDAH ADA = **EDIT** (perbarui titik/kapasitas),
 *                                             bukan bikin duplikat → salah share-lokasi bisa dikoreksi
 *                                             dari lapangan, tanpa minta admin.
 *            `#ISI <nama ODP>`              → sambungkan pelanggan ke ODP (juga ditawarkan otomatis
 *                                             begitu sebuah ODP selesai dipetakan).
 *            `odp <nama>` / `cek odp <nama>`→ cek hunian: 3/8, siapa saja, link peta (tanpa buka laptop).
 *            `#LOKASI <nama/HP>`            → simpan titik GPS pelanggan (menutup pelanggan lama yang
 *                                             tak punya koordinat sama sekali).
 *            `#JALUR <nama ODP>`            → REKAM BENTUK JALUR kabel ODC→ODP: kirim share lokasi di
 *                                             tiap BELOKAN, lalu `SELESAI`. Peta berhenti menggambar
 *                                             garis lurus dan mulai mengikuti jalan.
 *
 *          KENAPA JALUR DIREKAM DARI LAPANGAN: bentuk jalur cuma diketahui orang yang menarik kabelnya,
 *          dan dia memegang HP di bawah tiang — bukan mouse di depan komputer. Titik yang dibutuhkan
 *          adalah SUDUT, bukan tiap tiang: 3–6 belokan sudah membuat garis mengikuti jalan, sedangkan
 *          menuntut tiap tiang membuat fiturnya ditinggalkan.
 *
 *          KENAPA ALURNYA PER-ODP, BUKAN PER-PELANGGAN: di lapangan teknisi berdiri di depan SATU boks
 *          dan bisa MENELUSURI kabel yang keluar dari situ. Jadi pertanyaan alaminya "ODP ini isinya
 *          siapa saja", bukan "pelanggan ini ODP-nya mana". Usulan jarak cuma alat bantu — yang
 *          memutuskan adalah orang yang bisa MELIHAT kabelnya.
 *          Dan menyambungkan LEWAT NAMA tak butuh GPS sama sekali → pelanggan lama yang tak punya
 *          koordinat pun tetap bisa ditata. Jarak hanya dibutuhkan untuk MENGUSULKAN.
 *
 *          Nomor usulan TIDAK PERNAH digeser setelah ada yang tersambung (yang sudah jadi ditandai ✅) —
 *          kalau daftar dinomori ulang, teknisi yang mengetik "2" bisa menyambungkan orang yang salah.
 * Caller: `conversation-state-router` (owner "network-asset", prefix step `ASSET_`) + trigger
 *         `startNetworkAssetSession` / `startFillSession` / `startLocationSession` / `startRouteSession`
 *         / `inspectOdp` dari `message/raf.js`.
 * Deps (inject): `reply`/`downloadMedia` (delivery boundary), `setUserState`/`deleteUserState`,
 *        `lib/network-assets-service` (SATU pemilik aturan aset — sama dgn route web),
 *        `lib/network-route-service` (SATU pemilik aturan jalur — sama dgn `/api/map/waypoints`),
 *        `usersService` (`global.__apiUsersService`) untuk menulis pelanggan → validasi kapasitas ODP +
 *        hitung-ulang port ikut jalan otomatis (TIDAK ADA jalur tulis kedua),
 *        `lib/affirmative-parser` (JANGAN pakai daftar cocok-persis).
 * MainFuncs: `startNetworkAssetSession`, `startFillSession`, `startLocationSession`, `startRouteSession`,
 *            `inspectOdp`, `handleNetworkAssetConversationState`.
 * SideEffects: Tulis `database/network_assets.json` (via service, di bawah lock), tabel
 *              `connection_waypoints` (via network-route-service), UPDATE pelanggan (via usersService),
 *              foto ke `uploads/network-assets/...`, kirim WA. NEVER-THROW.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { isAffirmative } = require("../../../lib/affirmative-parser");

const STEP_COLLECT = "ASSET_COLLECT";
const STEP_CONFIRM = "ASSET_CONFIRM";
const STEP_PICK_PARENT = "ASSET_PICK_PARENT";
const STEP_ATTACH = "ASSET_ATTACH";
const STEP_PICK_CUSTOMER = "ASSET_PICK_CUSTOMER";
const STEP_PICK_ODP = "ASSET_PICK_ODP";
const STEP_LOC_WAIT = "ASSET_LOC_WAIT";
const STEP_LOC_PICK = "ASSET_LOC_PICK";
const STEP_ROUTE_WAIT = "ASSET_ROUTE_WAIT";
const STEP_ROUTE_REPLACE = "ASSET_ROUTE_REPLACE";

const ASSET_STEPS = new Set([
    STEP_COLLECT, STEP_CONFIRM, STEP_PICK_PARENT,
    STEP_ATTACH, STEP_PICK_CUSTOMER, STEP_PICK_ODP,
    STEP_LOC_WAIT, STEP_LOC_PICK,
    STEP_ROUTE_WAIT, STEP_ROUTE_REPLACE
]);

// `#` wajib (sama spt #PSB/#jadwal) supaya kata "odp" di kalimat biasa tak membuka wizard.
const TRIGGER_RE = /^\s*#(odc|odp)\b\s*(.*)$/i;
const FILL_RE = /^\s*#isi\b\s*(.*)$/i;
const LOC_RE = /^\s*#lokasi\b\s*(.*)$/i;
const ROUTE_RE = /^\s*#jalur\b\s*(.*)$/i;
// Cek hunian: TANPA `#` → tak bentrok dgn wizard. Hanya staf yang bisa memicunya (gate di raf.js).
const INSPECT_RE = /^\s*(?:cek\s+)?odp\s+(.+)$/i;

const CANCEL_RE = /^\s*(batal|cancel|ga\s*jadi|gajadi)\s*$/i;
const DONE_RE = /^\s*(selesai|sudah|cukup|udah|kelar)\b/i;
// Rekam jalur: "salah pin" itu kejadian normal di lapangan (tangan kepencet, sinyal meleset).
//
// PERINTAHNYA HARUS SATU PESAN UTUH, bukan awalan kata. `DONE_RE` yang longgar membuat
// "sudah sampai mana ya" terbaca sebagai SELESAI → jalur setengah jadi tersimpan diam-diam.
// Sambil menyusuri jalur teknisi memang mengetik kalimat biasa, jadi di sinilah kelonggaran itu
// paling berbahaya. Bandingkan dgn pelajaran dialek: "sudah tak bayar" = *saya sudah bayar*.
const ROUTE_DONE_RE = /^\s*(selesai|sudah|udah|kelar|cukup|beres)\s*[.!]*$/i;
const UNDO_RE = /^\s*(hapus|undo)\s*[.!]*$/i;
const RESTART_RE = /^\s*(ulang|ulangi|reset)\s*[.!]*$/i;
const FILL_CMD_RE = /^\s*isi\b/i;
const ALL_RE = /^\s*(semua|semuanya|all)\s*$/i;
// Nomor urut daftar SELALU 1–2 digit (daftar dibatasi 10). Dibatasi ketat supaya "08211112222"
// TIDAK terbaca sebagai nomor urut — itu NOMOR HP pelanggan, dan teknisi memang sering mengetiknya.
const NUMBERS_RE = /^\s*\d{1,2}(\s*[,\s]\s*\d{1,2})*\s*$/;

function withDeps(context) {
    return {
        ...context,
        assetService: context.assetService || require("../../../lib/network-assets-service"),
        routeService: context.routeService || require("../../../lib/network-route-service"),
        usersService: context.usersService || global.__apiUsersService,
        getUsers: context.getUsers || (() => (Array.isArray(global.users) ? global.users : [])),
        uploadsBaseDir: context.uploadsBaseDir || path.join(__dirname, "..", "..", "..", "uploads")
    };
}

async function safeReply(reply, text, logger) {
    try { if (reply) await reply(text); } catch (e) { logger?.error?.("[ASET] gagal balas:", e.message); }
}

function saveMedia(dir, filename, buffer) {
    try {
        fs.mkdirSync(dir, { recursive: true });
        const full = path.join(dir, filename);
        fs.writeFileSync(full, buffer);
        return full;
    } catch (_e) { return null; }
}

function extractLocation(type, msg) {
    const loc = type === "locationMessage"
        ? msg?.message?.locationMessage
        : (type === "liveLocationMessage" ? msg?.message?.liveLocationMessage : null);
    if (loc && loc.degreesLatitude && loc.degreesLongitude) {
        return { lat: loc.degreesLatitude, lng: loc.degreesLongitude };
    }
    return null;
}

function defaultCapacity(assetService) {
    try { return assetService.getAssetConfig().defaultOdpCapacity; } catch (_e) { return 8; }
}

function jarak(m) {
    return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

function parseNumbers(text) {
    return String(text).trim().split(/[,\s]+/).map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n));
}

function digits(s) {
    return String(s || "").replace(/[^0-9]/g, "");
}

/** Cari pelanggan yang diketik teknisi: nama (sebagian) ATAU nomor HP. Tak butuh GPS. */
function searchCustomers(q, users) {
    const raw = String(q || "").trim().toLowerCase();
    if (!raw || raw.length < 2) return [];
    const d = digits(raw);

    return (users || []).filter((u) => {
        if (!u) return false;
        const nama = String(u.name || "").toLowerCase();
        if (nama.includes(raw)) return true;
        if (d.length >= 4) {
            const hp = digits(u.phone_number);
            // Cocokkan ekor nomor: teknisi sering mengetik tanpa 0/62 di depan.
            if (hp && (hp.endsWith(d) || d.endsWith(hp))) return true;
        }
        return false;
    });
}

// ── Tulis pelanggan lewat service yang SUDAH ADA (validasi kapasitas + hitung-ulang port ikut jalan) ──
async function updateCustomer(context, user, userData) {
    const { usersService, logger = console } = context;
    if (!usersService || typeof usersService.updateUserById !== "function") {
        return { ok: false, message: "Layanan pelanggan belum siap. Coba lagi sebentar." };
    }
    try {
        const res = await usersService.updateUserById({
            id: user.id,
            userData,
            actor: {
                id: context.staff?.id,
                username: context.staff?.username || "wa",
                role: context.staff?.role || "teknisi"
            },
            requestMeta: { ipAddress: "whatsapp", userAgent: "wa-bot" }
        });
        if (res && res.status === 200) return { ok: true };
        return { ok: false, message: (res && res.body && res.body.message) || "gagal menyimpan" };
    } catch (e) {
        logger?.error?.("[ASET] gagal update pelanggan:", e.message);
        return { ok: false, message: e.message };
    }
}

/** Status hunian ODP yang SELALU dibaca ulang (bukan angka basi dari state). */
function odpStatus(context, odpId) {
    try {
        return context.assetService.getOdpStatus(odpId, { users: context.getUsers() });
    } catch (_e) {
        return { found: false };
    }
}

function huniText(st) {
    if (!st || !st.found) return "";
    return st.capacity > 0 ? `${st.used}/${st.capacity}` : `${st.used} (tak dibatasi)`;
}

// ── Daftar usulan pelanggan utk sebuah ODP: dekat & BELUM punya ODP ──
function buildCandidates(context, odp) {
    const { assetService, getUsers } = context;
    try {
        let radius = 250;
        try { radius = assetService.getAssetConfig().odpSuggestMaxMeters; } catch (_e) { /* default */ }

        const lat = assetService.parseCoord(odp.latitude);
        const lng = assetService.parseCoord(odp.longitude);
        if (lat === null || lng === null) return [];

        return (getUsers() || [])
            .filter((u) => u && !String(u.connected_odp_id || "").trim())
            .map((u) => {
                const ulat = assetService.parseCoord(u.latitude);
                const ulng = assetService.parseCoord(u.longitude);
                if (ulat === null || ulng === null) return null;
                return { id: u.id, name: u.name || `#${u.id}`, meters: Math.round(assetService.haversineMeters(lat, lng, ulat, ulng)), done: false };
            })
            .filter((c) => c && c.meters <= radius)
            .sort((a, b) => a.meters - b.meters)
            .slice(0, 10);
    } catch (_e) {
        return [];
    }
}

function attachMenuText(ctx, st) {
    const lines = [`👥 *Isi ODP ${ctx.attachOdpName}* — sekarang ${huniText(st)} terpakai.`, ``];

    if ((ctx.candidates || []).length) {
        lines.push(`Pelanggan dekat sini yang BELUM punya ODP:`);
        ctx.candidates.forEach((c, i) => {
            lines.push(`${c.done ? "✅" : `*${i + 1}.*`} ${c.name} — ${jarak(c.meters)}${c.done ? " (tersambung)" : ""}`);
        });
        lines.push(``);
        lines.push(`Balas *nomor* (bisa \`1,3\`) atau *SEMUA*.`);
    } else {
        lines.push(`_Tak ada pelanggan ber-GPS di sekitar sini._`);
    }

    lines.push(`Atau ketik *nama/HP* pelanggan — ini jalan walau pelanggannya belum punya titik GPS.`);
    lines.push(`*SELESAI* kalau sudah.`);
    return lines.join("\n");
}

async function enterAttach(context, ctx, odp) {
    const { reply, setUserState, stateSender, logger = console } = context;

    ctx.attachOdpId = odp.id;
    ctx.attachOdpName = odp.name;
    ctx.candidates = buildCandidates(context, odp);
    ctx.attached = ctx.attached || [];

    setUserState(stateSender, { step: STEP_ATTACH, _scope: "teknisi", context: ctx });
    await safeReply(reply, attachMenuText(ctx, odpStatus(context, odp.id)), logger);
    return { handled: true };
}

/** Sambungkan SATU pelanggan. Kapasitas penuh / ODP tak valid → ditolak service, pesan diteruskan apa adanya. */
async function attachOne(context, ctx, user) {
    const sudah = String(user.connected_odp_id || "").trim();
    const res = await updateCustomer(context, user, { connected_odp_id: ctx.attachOdpId });
    if (!res.ok) return { ok: false, message: res.message };

    ctx.attached = ctx.attached || [];
    if (!ctx.attached.includes(user.id)) ctx.attached.push(user.id);

    const cand = (ctx.candidates || []).find((c) => String(c.id) === String(user.id));
    if (cand) cand.done = true;

    // Pindah dari ODP lain itu SAH (koreksi lapangan) — tapi harus DIKATAKAN, jangan diam-diam.
    return { ok: true, pindahDari: sudah && sudah !== ctx.attachOdpId ? sudah : null };
}

// ── Simpan/perbarui aset + BUKTIKAN hasilnya ──
async function finalizeAsset(context, ctx) {
    const { reply, deleteUserState, stateSender, assetService, logger = console } = context;

    let asset = null;
    try {
        if (ctx.editing) {
            asset = await assetService.updateAsset(ctx.editing, {
                latitude: ctx.lokasi.lat,
                longitude: ctx.lokasi.lng,
                capacity_ports: ctx.capacity || undefined,
                parent_odc_id: ctx.type === "ODP" ? (ctx.parent ? ctx.parent.id : null) : undefined,
                photo_path: ctx.photoPath || undefined,
                updated_by: ctx.staff?.name || ctx.staff?.username || ""
            });
        } else {
            asset = await assetService.createAsset({
                type: ctx.type,
                name: ctx.name,
                latitude: ctx.lokasi.lat,
                longitude: ctx.lokasi.lng,
                capacity_ports: ctx.capacity || defaultCapacity(assetService),
                parent_odc_id: ctx.parent ? ctx.parent.id : null,
                photo_path: ctx.photoPath || "",
                created_by: ctx.staff?.name || ctx.staff?.username || "",
                source: "wa"
            });
        }
    } catch (e) {
        logger?.error?.("[ASET] gagal simpan:", e.message);
        await safeReply(reply, `❌ Gagal menyimpan: ${e.message}`, logger);
        return { handled: true };
    }

    const st = odpStatus(context, asset.id);
    const bukti = [
        `✅ *${asset.name}* ${ctx.editing ? "diperbarui" : "tersimpan"}.`,
        ``,
        `🆔 ${asset.id}`,
        `🔌 Kapasitas ${asset.capacity_ports} port${asset.type === "ODP" && st.found ? ` (terpakai ${st.used})` : ""}`,
        ctx.parent ? `🔗 Induk: ${ctx.parent.name}${ctx.parent.meters != null ? ` (${jarak(ctx.parent.meters)})` : ""}` : null,
        `📍 ${assetService.mapsUrl(asset.latitude, asset.longitude)}`
    ].filter(Boolean).join("\n");
    await safeReply(reply, bukti, logger);

    // ODP baru → langsung tawarkan mengisinya. Teknisi SUDAH di depan boks-nya: satu kunjungan,
    // dua pekerjaan (petakan + sambungkan). Ini yang menutup pelanggan lama yang belum ber-ODP.
    if (asset.type === "ODP") {
        return enterAttach(context, ctx, asset);
    }

    deleteUserState(stateSender);
    await safeReply(reply, `Lanjut petakan ODP-nya: ketik *#ODP <nama>*`, logger);
    return { handled: true };
}

/** Cari induk ODC terdekat. Tak ada dalam radius → null (JANGAN menebak). NEVER-THROW. */
function resolveParent(context, ctx) {
    const { assetService, logger = console } = context;
    if (ctx.type !== "ODP" || !ctx.lokasi) return null;

    try {
        let maxMeters = 2000;
        try { maxMeters = assetService.getAssetConfig().odcSuggestMaxMeters; } catch (_e) { /* default */ }

        const near = assetService.findNearest(ctx.lokasi.lat, ctx.lokasi.lng, "ODC", { limit: 5, maxMeters }) || [];
        ctx.parentChoices = near.map((n) => ({ id: n.asset.id, name: n.asset.name, meters: n.meters }));
        return ctx.parentChoices[0] || null;
    } catch (e) {
        logger?.error?.("[ASET] gagal cari induk ODC:", e.message);
        ctx.parentChoices = [];
        return null;
    }
}

function checklistText(ctx, assetService) {
    const cap = ctx.capacity || defaultCapacity(assetService);
    return [
        `🗺️ *Petakan ${ctx.type}* — cuma butuh 2 hal:`,
        `${ctx.name ? "✅" : "⬜"} Nama${ctx.name ? `: ${ctx.name}` : " (balas namanya)"}`,
        `${ctx.lokasi ? "✅" : "⬜"} Share lokasi (berdiri di depan ${ctx.type}-nya)`,
        ``,
        `Opsional: kirim *foto box* · balas *angka* untuk ubah kapasitas (sekarang ${cap} port).`,
        `Ketik *BATAL* untuk batal.`
    ].join("\n");
}

function editMenuText(ctx, st, assetService) {
    const cap = ctx.capacity || defaultCapacity(assetService);
    const lines = [
        `ℹ️ *${ctx.type} ${ctx.name}* sudah terdaftar${ctx.type === "ODP" && st.found ? ` — ${huniText(st)} terpakai` : ""}.`,
        `Kapasitas sekarang: ${cap} port.`,
        ``,
        `Mau apa?`,
        `• Kirim *share lokasi* baru → perbaiki titiknya`,
        `• Balas *angka* → ubah kapasitas`
    ];
    if (ctx.type === "ODP") lines.push(`• *ISI* → sambungkan pelanggan ke ODP ini`);
    lines.push(`• *SELESAI* / *BATAL*`);
    return lines.join("\n");
}

function summaryText(ctx, assetService) {
    const cap = ctx.capacity || defaultCapacity(assetService);
    const lines = [
        `📍 *Cek dulu sebelum disimpan:*`,
        ``,
        `*${ctx.type}*: ${ctx.name}`,
        `Lokasi: ${ctx.lokasi.lat.toFixed(6)}, ${ctx.lokasi.lng.toFixed(6)}`,
        `Kapasitas: ${cap} port`,
        ctx.photoPath ? `Foto box: ✅ tersimpan` : `Foto box: — (opsional)`
    ];

    if (ctx.type === "ODP") {
        if (ctx.parent) {
            lines.push(`Induk ODC: *${ctx.parent.name}* (${jarak(ctx.parent.meters)}) — dipilih otomatis`);
        } else if ((ctx.parentChoices || []).length === 0) {
            lines.push(`Induk ODC: — belum ada ODC terdaftar di sekitar sini (boleh lanjut tanpa induk)`);
        } else {
            lines.push(`Induk ODC: — (tanpa induk)`);
        }
    }

    lines.push(``);
    const gantiHint = ctx.type === "ODP" && (ctx.parentChoices || []).length > 0 ? ` · *GANTI* untuk pilih induk lain` : "";
    lines.push(`Balas *YA* untuk simpan${gantiHint} · *BATAL* untuk batal.`);
    return lines.join("\n");
}

function parentPickerText(ctx) {
    const lines = [`🔗 Pilih induk ODC untuk *${ctx.name}*:`, ``];
    (ctx.parentChoices || []).forEach((p, i) => lines.push(`*${i + 1}.* ${p.name} — ${jarak(p.meters)}`));
    lines.push(``, `Balas *angka*-nya, atau *0* untuk tanpa induk.`);
    return lines.join("\n");
}

function listPickerText(judul, items, render) {
    const lines = [judul, ``];
    items.forEach((it, i) => lines.push(`*${i + 1}.* ${render(it)}`));
    lines.push(``, `Balas *angka*-nya · *BATAL* untuk batal.`);
    return lines.join("\n");
}

// ══ TRIGGER: `#ODC <nama>` / `#ODP <nama>` — petakan BARU, atau EDIT kalau namanya sudah ada ══
async function startNetworkAssetSession(context) {
    context = withDeps(context);
    const { chats, staff, stateSender, reply, setUserState, assetService, uploadsBaseDir, nowMs = Date.now(), logger = console } = context;

    const m = TRIGGER_RE.exec(String(chats || ""));
    if (!m) return { started: false };

    const type = m[1].toUpperCase();
    const nama = String(m[2] || "").trim();
    const now = new Date(nowMs);
    const tempId = `ASET_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;

    const ctx = {
        type,
        name: nama,
        lokasi: null,
        capacity: null,
        photoPath: null,
        parent: null,
        parentChoices: [],
        editing: null,
        staff,
        tempId,
        dir: path.join(uploadsBaseDir, "network-assets", String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"), tempId)
    };

    // Nama yang SUDAH ADA = koreksi, bukan alasan bikin duplikat. Duplikat ODP = peta yang berbohong.
    if (nama) {
        let cocok = [];
        try { cocok = assetService.findAssetsByName(nama, type) || []; } catch (_e) { cocok = []; }

        if (cocok.length === 1) {
            const a = cocok[0];
            ctx.editing = a.id;
            ctx.name = a.name;
            ctx.capacity = parseInt(a.capacity_ports, 10) || null;
            ctx.lokasi = { lat: Number(a.latitude), lng: Number(a.longitude) };
            setUserState(stateSender, { step: STEP_COLLECT, _scope: "teknisi", context: ctx });
            await safeReply(reply, editMenuText(ctx, odpStatus(context, a.id), assetService), logger);
            return { started: true };
        }
        if (cocok.length > 1) {
            ctx.assetChoices = cocok.map((a) => ({ id: a.id, name: a.name }));
            setUserState(stateSender, { step: STEP_PICK_ODP, _scope: "teknisi", context: { ...ctx, pickMode: "edit" } });
            await safeReply(reply, listPickerText(`Ada ${cocok.length} ${type} bernama mirip "${nama}". Yang mana?`, ctx.assetChoices, (a) => `${a.name} (${a.id})`), logger);
            return { started: true };
        }
    }

    setUserState(stateSender, { step: STEP_COLLECT, _scope: "teknisi", context: ctx });
    await safeReply(reply, checklistText(ctx, assetService), logger);
    return { started: true };
}

// ══ TRIGGER: `#ISI <nama ODP>` — sambungkan pelanggan ke ODP yang sudah ada ══
async function startFillSession(context) {
    context = withDeps(context);
    const { chats, staff, stateSender, reply, setUserState, assetService, logger = console } = context;

    const m = FILL_RE.exec(String(chats || ""));
    if (!m) return { started: false };

    const nama = String(m[1] || "").trim();
    if (!nama) {
        await safeReply(reply, `Ketik *#ISI <nama ODP>* — misal: *#ISI Balen 1*`, logger);
        return { started: true };
    }

    let cocok = [];
    try { cocok = assetService.findAssetsByName(nama, "ODP") || []; } catch (_e) { cocok = []; }

    if (cocok.length === 0) {
        await safeReply(reply, `❌ ODP "${nama}" tak ketemu.\nPetakan dulu: *#ODP ${nama}* (share lokasi di depan boks-nya).`, logger);
        return { started: true };
    }

    const ctx = { type: "ODP", staff, attached: [] };

    if (cocok.length > 1) {
        ctx.assetChoices = cocok.map((a) => ({ id: a.id, name: a.name }));
        ctx.pickMode = "fill";
        setUserState(stateSender, { step: STEP_PICK_ODP, _scope: "teknisi", context: ctx });
        await safeReply(reply, listPickerText(`Ada ${cocok.length} ODP bernama mirip "${nama}". Yang mana?`, ctx.assetChoices, (a) => `${a.name} (${a.id})`), logger);
        return { started: true };
    }

    return enterAttach(context, ctx, cocok[0]);
}

// ══ TRIGGER: `#LOKASI <nama/HP>` — simpan titik GPS pelanggan ══
async function startLocationSession(context) {
    context = withDeps(context);
    const { chats, staff, stateSender, reply, setUserState, getUsers, logger = console } = context;

    const m = LOC_RE.exec(String(chats || ""));
    if (!m) return { started: false };

    const q = String(m[1] || "").trim();
    if (!q) {
        await safeReply(reply, `Ketik *#LOKASI <nama atau HP pelanggan>* — misal: *#LOKASI budi*`, logger);
        return { started: true };
    }

    const cocok = searchCustomers(q, getUsers());
    if (cocok.length === 0) {
        await safeReply(reply, `❌ Pelanggan "${q}" tak ketemu. Coba nama lain atau nomor HP-nya.`, logger);
        return { started: true };
    }

    const ctx = { mode: "lokasi", staff };

    if (cocok.length > 1) {
        if (cocok.length > 8) {
            await safeReply(reply, `Ada ${cocok.length} pelanggan cocok "${q}" — terlalu banyak. Ketik lebih spesifik (atau nomor HP).`, logger);
            return { started: true };
        }
        ctx.custChoices = cocok.map((u) => ({ id: u.id, name: u.name || `#${u.id}` }));
        setUserState(stateSender, { step: STEP_LOC_PICK, _scope: "teknisi", context: ctx });
        await safeReply(reply, listPickerText(`Pelanggan mana?`, ctx.custChoices, (u) => u.name), logger);
        return { started: true };
    }

    ctx.custId = cocok[0].id;
    ctx.custName = cocok[0].name || `#${cocok[0].id}`;
    setUserState(stateSender, { step: STEP_LOC_WAIT, _scope: "teknisi", context: ctx });
    await safeReply(reply, `📍 Share lokasi rumah *${ctx.custName}* (berdiri di depan rumahnya).\n*BATAL* untuk batal.`, logger);
    return { started: true };
}

// ══════════════════ REKAM JALUR KABEL (`#JALUR <nama ODP>`) ══════════════════
// Peta menggambar ODC→ODP sebagai GARIS LURUS karena tak ada yang pernah memberi tahu bentuk
// jalurnya. Yang tahu bentuk itu cuma orang yang menarik kabelnya — dan dia ada di lapangan
// dengan HP, bukan di depan komputer. Maka: rekam dengan share lokasi di tiap BELOKAN.
//
// TAK PERLU TIAP TIANG. Yang membuat garis "ikut jalan" adalah sudut, bukan kerapatan titik;
// 3–6 belokan sudah cukup, dan menuntut tiap tiang justru membuat teknisi berhenti memakainya.

/** Titik aset yang benar-benar terisi — `0` = belum diset (lihat parseCoord di network-assets-service). */
function assetPoint(asset) {
    if (!asset) return null;
    const lat = Number(asset.latitude);
    const lng = Number(asset.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return null;
    return [lat, lng];
}

function routeIntroText(ctx, lurusMeter) {
    return [
        `🧵 *Rekam jalur kabel*`,
        `${ctx.odcName} → *${ctx.odpName}*${lurusMeter ? ` _(garis lurus ${jarak(lurusMeter)})_` : ""}`,
        ``,
        `Susuri kabelnya dari ODC. Tiap ketemu *BELOKAN*, kirim *share lokasi*.`,
        `_Tak perlu tiap tiang — cukup tiap belok._`,
        ``,
        `*SELESAI* kalau sudah · *HAPUS* buang titik terakhir · *ULANG* dari nol · *BATAL*`
    ].join("\n");
}

async function enterRouteRecording(context, ctx) {
    const { stateSender, setUserState, reply, assetService, logger = console } = context;
    ctx.points = [];
    setUserState(stateSender, { step: STEP_ROUTE_WAIT, _scope: "teknisi", context: ctx });

    let lurus = 0;
    try {
        lurus = Math.round(assetService.haversineMeters(ctx.odcPoint[0], ctx.odcPoint[1], ctx.odpPoint[0], ctx.odpPoint[1]));
    } catch (_e) { lurus = 0; }

    await safeReply(reply, routeIntroText(ctx, lurus), logger);
    return { started: true };
}

/** Siapkan konteks jalur dari sebuah ODP (induk ODC diambil otomatis — teknisi cukup sebut ODP-nya). */
async function prepareRouteForOdp(context, odp) {
    const { reply, assetService, routeService, staff, stateSender, setUserState, logger = console } = context;

    const odpPoint = assetPoint(odp);
    if (!odpPoint) {
        await safeReply(reply, `❌ *${odp.name}* belum punya titik GPS.\nPetakan dulu: *#ODP ${odp.name}* → kirim share lokasi.`, logger);
        return { started: true };
    }

    const parentId = String(odp.parent_odc_id || "").trim();
    const odc = parentId ? assetService.findAssetById(parentId) : null;
    const odcPoint = assetPoint(odc);
    if (!odc || !odcPoint) {
        await safeReply(reply, [
            `❌ *${odp.name}* belum punya induk ODC ber-titik, jadi jalurnya belum bisa direkam.`,
            `Atur dulu: *#ODP ${odp.name}* → kirim share lokasi (bot memilihkan induk terdekat).`
        ].join("\n"), logger);
        return { started: true };
    }

    const ctx = {
        mode: "jalur",
        staff,
        odpId: odp.id, odpName: odp.name, odpPoint,
        odcId: odc.id, odcName: odc.name, odcPoint,
        points: []
    };

    // Jalur yang sudah ada TIDAK ditimpa diam-diam: menimpa = menghapus pekerjaan orang lain.
    let lama = null;
    try { lama = await routeService.getRoute("odc-odp", odc.id, odp.id); } catch (_e) { lama = null; }
    if (lama) {
        setUserState(stateSender, { step: STEP_ROUTE_REPLACE, _scope: "teknisi", context: ctx });
        await safeReply(reply, [
            `ℹ️ *${odp.name}* sudah punya jalur: ${lama.points.length} titik · ±${jarak(lama.meters)}.`,
            ``,
            `Rekam ulang? balas *YA* (jalur lama diganti) · *BATAL*`
        ].join("\n"), logger);
        return { started: true };
    }

    return enterRouteRecording(context, ctx);
}

async function startRouteSession(context) {
    context = withDeps(context);
    const { chats, reply, assetService, stateSender, setUserState, staff, logger = console } = context;

    const m = ROUTE_RE.exec(String(chats || ""));
    if (!m) return { started: false };

    const nama = String(m[1] || "").trim();
    if (!nama) {
        await safeReply(reply, `Ketik *#JALUR <nama ODP>* — misal: *#JALUR Balen 1*\nBot merekam jalur kabel dari induk ODC ke ODP itu.`, logger);
        return { started: true };
    }

    let cocok = [];
    try { cocok = assetService.findAssetsByName(nama, "ODP") || []; } catch (_e) { cocok = []; }

    if (cocok.length === 0) {
        await safeReply(reply, `❌ ODP "${nama}" tak ketemu.\nPetakan dulu: *#ODP ${nama}*`, logger);
        return { started: true };
    }
    if (cocok.length > 1) {
        const ctx = { mode: "jalur", staff, pickMode: "route", assetChoices: cocok.map((a) => ({ id: a.id, name: a.name })) };
        setUserState(stateSender, { step: STEP_PICK_ODP, _scope: "teknisi", context: ctx });
        await safeReply(reply, listPickerText(`Ada ${cocok.length} ODP mirip "${nama}". Yang mana?`, ctx.assetChoices, (a) => `${a.name} (${a.id})`), logger);
        return { started: true };
    }

    return prepareRouteForOdp(context, cocok[0]);
}

// ══ ONE-SHOT: `odp <nama>` / `cek odp <nama>` — hunian + siapa saja + link peta ══
async function inspectOdp(context) {
    context = withDeps(context);
    const { chats, reply, assetService, getUsers, logger = console } = context;

    const m = INSPECT_RE.exec(String(chats || ""));
    if (!m) return { handled: false };

    const nama = String(m[1] || "").trim();
    let cocok = [];
    try { cocok = assetService.findAssetsByName(nama, "ODP") || []; } catch (_e) { cocok = []; }

    if (cocok.length === 0) {
        await safeReply(reply, `❌ ODP "${nama}" tak ketemu.\nPetakan: *#ODP ${nama}*`, logger);
        return { handled: true };
    }
    if (cocok.length > 1) {
        await safeReply(reply, [`Ada ${cocok.length} ODP cocok "${nama}":`, ...cocok.map((a) => `• ${a.name} (${a.id})`), ``, `Ketik lebih spesifik.`].join("\n"), logger);
        return { handled: true };
    }

    const odp = cocok[0];
    const st = assetService.getOdpStatus(odp.id, { users: getUsers() });
    const pelanggan = assetService.getOdpCustomers(odp.id, { users: getUsers() });

    let indukNama = null;
    if (odp.parent_odc_id) {
        const induk = assetService.findAssetById(odp.parent_odc_id);
        indukNama = induk ? induk.name : odp.parent_odc_id;
    }

    const lines = [
        `🔍 *${odp.name}* (${odp.id})`,
        `🔌 ${huniText(st)} terpakai${st.sisa != null ? ` · sisa *${st.sisa}* port` : ""}`,
        indukNama ? `🔗 Induk: ${indukNama}` : `🔗 Induk: — (belum diset)`,
        pelanggan.length
            ? `👥 ${pelanggan.map((u) => u.name || `#${u.id}`).join(", ")}`
            : `👥 _belum ada pelanggan_`,
        `📍 ${assetService.mapsUrl(odp.latitude, odp.longitude)}`,
        ``,
        `Sambungkan pelanggan: *#ISI ${odp.name}*`
    ];
    await safeReply(reply, lines.filter(Boolean).join("\n"), logger);
    return { handled: true };
}

// ══ ROUTER STATE (owner "network-asset") ══
async function handleNetworkAssetConversationState(context) {
    context = withDeps(context);
    const {
        stateStep, teknisiState, userState, type, msg, chats, reply, downloadMedia,
        setUserState, deleteUserState, stateSender, assetService, routeService, getUsers, logger = console
    } = context;

    if (!ASSET_STEPS.has(stateStep)) return { handled: false };

    const state = teknisiState || userState || null;
    const ctx = (state && state.context) || null;
    if (!ctx) { deleteUserState(stateSender); return { handled: true }; }

    const text = String(chats || "").trim();
    if (CANCEL_RE.test(text)) {
        deleteUserState(stateSender);
        await safeReply(reply, `❌ Dibatalkan.`, logger);
        return { handled: true };
    }

    // ── #LOKASI: pilih pelanggan ──
    if (stateStep === STEP_LOC_PICK) {
        const n = parseInt(text, 10);
        const pilihan = (ctx.custChoices || [])[n - 1];
        if (!pilihan) {
            await safeReply(reply, listPickerText(`Pelanggan mana?`, ctx.custChoices || [], (u) => u.name), logger);
            return { handled: true };
        }
        ctx.custId = pilihan.id;
        ctx.custName = pilihan.name;
        setUserState(stateSender, { step: STEP_LOC_WAIT, _scope: "teknisi", context: ctx });
        await safeReply(reply, `📍 Share lokasi rumah *${ctx.custName}*.\n*BATAL* untuk batal.`, logger);
        return { handled: true };
    }

    // ── #LOKASI: tunggu share lokasi ──
    if (stateStep === STEP_LOC_WAIT) {
        const loc = extractLocation(type, msg);
        if (!loc) {
            await safeReply(reply, `Kirim *share lokasi* (bukan teks) rumah *${ctx.custName}*.\n*BATAL* untuk batal.`, logger);
            return { handled: true };
        }

        const user = (getUsers() || []).find((u) => String(u.id) === String(ctx.custId));
        if (!user) {
            deleteUserState(stateSender);
            await safeReply(reply, `❌ Pelanggan tak ditemukan lagi. Ulangi *#LOKASI <nama>*.`, logger);
            return { handled: true };
        }

        const res = await updateCustomer(context, user, {
            latitude: loc.lat,
            longitude: loc.lng,
            maps_url: assetService.mapsUrl(loc.lat, loc.lng)
        });
        if (!res.ok) {
            await safeReply(reply, `❌ Gagal menyimpan lokasi: ${res.message}`, logger);
            return { handled: true };
        }

        await safeReply(reply, `✅ Titik rumah *${ctx.custName}* tersimpan.\n📍 ${assetService.mapsUrl(loc.lat, loc.lng)}`, logger);

        // Sudah punya titik → sekalian tawarkan ODP terdekat (kalau dia memang belum ber-ODP).
        if (!String(user.connected_odp_id || "").trim()) {
            let usul = [];
            try { usul = assetService.suggestOdpForPoint(loc.lat, loc.lng, { limit: 1 }) || []; } catch (_e) { usul = []; }
            if (usul.length) {
                const odp = usul[0].asset;
                const ctx2 = { type: "ODP", staff: ctx.staff, attached: [] };
                await safeReply(reply, `🔗 ODP terdekat: *${odp.name}* (${jarak(usul[0].meters)}).`, logger);
                return enterAttach(context, ctx2, odp);
            }
        }

        deleteUserState(stateSender);
        return { handled: true };
    }

    // ── #JALUR: jalur lama sudah ada — timpa hanya kalau diiyakan ──
    if (stateStep === STEP_ROUTE_REPLACE) {
        if (!isAffirmative(text)) {
            await safeReply(reply, `Balas *YA* untuk merekam ulang jalur *${ctx.odpName}*, atau *BATAL*.`, logger);
            return { handled: true };
        }
        return enterRouteRecording(context, ctx);
    }

    // ── #JALUR: rekam belokan (share lokasi berkali-kali) ──
    if (stateStep === STEP_ROUTE_WAIT) {
        const titik = ctx.points || [];

        if (RESTART_RE.test(text)) {
            ctx.points = [];
            setUserState(stateSender, { step: STEP_ROUTE_WAIT, _scope: "teknisi", context: ctx });
            await safeReply(reply, `🔄 Titik dikosongkan. Mulai lagi dari belokan pertama.`, logger);
            return { handled: true };
        }

        if (UNDO_RE.test(text)) {
            const dibuang = titik.pop();
            setUserState(stateSender, { step: STEP_ROUTE_WAIT, _scope: "teknisi", context: ctx });
            await safeReply(reply, dibuang
                ? `↩️ Titik terakhir dibuang. Sisa ${titik.length} titik.`
                : `Belum ada titik untuk dibuang.`, logger);
            return { handled: true };
        }

        if (ROUTE_DONE_RE.test(text)) {
            if (!titik.length) {
                await safeReply(reply, [
                    `Belum ada titik belokan yang direkam.`,
                    `Kalau jalurnya memang lurus dari ODC ke ODP, tak perlu direkam — ketik *BATAL*.`,
                    `Kalau ada belokan, kirim *share lokasi* sambil berdiri di belokannya.`
                ].join("\n"), logger);
                return { handled: true };
            }

            // Jalur utuh = titik ODC + semua belokan + titik ODP. Teknisi tak perlu memin ulang
            // kedua ujungnya — keduanya sudah tersimpan sebagai aset.
            const points = [ctx.odcPoint, ...titik, ctx.odpPoint];
            let hasil;
            try {
                hasil = await routeService.saveRoute({
                    connectionType: "odc-odp",
                    sourceId: ctx.odcId,
                    targetId: ctx.odpId,
                    points,
                    actor: (ctx.staff && (ctx.staff.username || ctx.staff.name)) || "wa"
                });
            } catch (e) {
                logger?.error?.("[ASET] gagal simpan jalur:", e.message);
                await safeReply(reply, `❌ Gagal menyimpan jalur: ${e.message}\nCoba ketik *SELESAI* lagi.`, logger);
                return { handled: true };
            }

            let lurus = 0;
            try {
                lurus = Math.round(assetService.haversineMeters(ctx.odcPoint[0], ctx.odcPoint[1], ctx.odpPoint[0], ctx.odpPoint[1]));
            } catch (_e) { lurus = 0; }

            deleteUserState(stateSender);
            await safeReply(reply, [
                `✅ *Jalur tersimpan.*`,
                `${ctx.odcName} → *${ctx.odpName}*`,
                `${hasil.count} titik · kabel ±${jarak(hasil.meters)}${lurus ? ` _(garis lurus ${jarak(lurus)})_` : ""}`,
                ``,
                `Peta sekarang mengikuti jalur ini, bukan garis lurus.`
            ].join("\n"), logger);
            return { handled: true };
        }

        const loc = extractLocation(type, msg);
        if (!loc) {
            await safeReply(reply, [
                `Kirim *share lokasi* (bukan teks) sambil berdiri di belokan jalur.`,
                `Sudah ${titik.length} titik direkam · *SELESAI* · *HAPUS* · *ULANG* · *BATAL*`
            ].join("\n"), logger);
            return { handled: true };
        }

        const sebelum = titik.length ? titik[titik.length - 1] : ctx.odcPoint;
        let selisih = 0;
        try { selisih = Math.round(assetService.haversineMeters(sebelum[0], sebelum[1], loc.lat, loc.lng)); } catch (_e) { selisih = 0; }

        titik.push([loc.lat, loc.lng]);
        ctx.points = titik;
        setUserState(stateSender, { step: STEP_ROUTE_WAIT, _scope: "teknisi", context: ctx });
        await safeReply(reply, `📍 Titik ${titik.length} tersimpan${selisih ? ` (+${jarak(selisih)})` : ""}. Lanjut ke belokan berikutnya, atau *SELESAI*.`, logger);
        return { handled: true };
    }

    // ── Pilih ODP (dari daftar bernomor) — untuk #ISI atau EDIT ──
    if (stateStep === STEP_PICK_ODP) {
        const n = parseInt(text, 10);
        const pilihan = (ctx.assetChoices || [])[n - 1];
        if (!pilihan) {
            await safeReply(reply, listPickerText(`Yang mana?`, ctx.assetChoices || [], (a) => `${a.name} (${a.id})`), logger);
            return { handled: true };
        }

        const asset = assetService.findAssetById(pilihan.id);
        if (!asset) {
            deleteUserState(stateSender);
            await safeReply(reply, `❌ Aset tak ditemukan lagi.`, logger);
            return { handled: true };
        }

        if (ctx.pickMode === "fill") return enterAttach(context, ctx, asset);
        if (ctx.pickMode === "route") return prepareRouteForOdp(context, asset);

        ctx.editing = asset.id;
        ctx.name = asset.name;
        ctx.type = asset.type;
        ctx.capacity = parseInt(asset.capacity_ports, 10) || null;
        ctx.lokasi = { lat: Number(asset.latitude), lng: Number(asset.longitude) };
        setUserState(stateSender, { step: STEP_COLLECT, _scope: "teknisi", context: ctx });
        await safeReply(reply, editMenuText(ctx, odpStatus(context, asset.id), assetService), logger);
        return { handled: true };
    }

    // ── Sambungkan pelanggan: pilih dari hasil pencarian nama ──
    if (stateStep === STEP_PICK_CUSTOMER) {
        const n = parseInt(text, 10);
        const pilihan = (ctx.custChoices || [])[n - 1];
        if (!pilihan) {
            await safeReply(reply, listPickerText(`Pelanggan mana?`, ctx.custChoices || [], (u) => u.name), logger);
            return { handled: true };
        }
        const user = (getUsers() || []).find((u) => String(u.id) === String(pilihan.id));
        const hasil = user ? await attachOne(context, ctx, user) : { ok: false, message: "pelanggan tak ditemukan" };

        setUserState(stateSender, { step: STEP_ATTACH, _scope: "teknisi", context: ctx });
        const st = odpStatus(context, ctx.attachOdpId);
        await safeReply(reply, hasil.ok
            ? `✅ ${pilihan.name} → *${ctx.attachOdpName}* (${huniText(st)})${hasil.pindahDari ? `\n_(dipindah dari ${hasil.pindahDari})_` : ""}\n\nLanjut? balas nomor/nama, atau *SELESAI*.`
            : `❌ ${pilihan.name}: ${hasil.message}`, logger);
        return { handled: true };
    }

    // ── Sambungkan pelanggan ke ODP ──
    if (stateStep === STEP_ATTACH) {
        if (DONE_RE.test(text)) {
            const st = odpStatus(context, ctx.attachOdpId);
            const pelanggan = assetService.getOdpCustomers(ctx.attachOdpId, { users: getUsers() });
            deleteUserState(stateSender);
            await safeReply(reply, [
                `✅ Selesai. *${ctx.attachOdpName}* sekarang ${huniText(st)} terpakai.`,
                pelanggan.length ? `👥 ${pelanggan.map((u) => u.name || `#${u.id}`).join(", ")}` : null
            ].filter(Boolean).join("\n"), logger);
            return { handled: true };
        }

        const users = getUsers() || [];
        let target = [];

        if (ALL_RE.test(text)) {
            target = (ctx.candidates || []).filter((c) => !c.done)
                .map((c) => users.find((u) => String(u.id) === String(c.id)))
                .filter(Boolean);
        } else if (NUMBERS_RE.test(text)) {
            const nums = parseNumbers(text);
            for (const n of nums) {
                const c = (ctx.candidates || [])[n - 1];
                if (!c || c.done) continue;
                const u = users.find((x) => String(x.id) === String(c.id));
                if (u) target.push(u);
            }
            if (!target.length) {
                await safeReply(reply, `Nomor tak dikenal. ${attachMenuText(ctx, odpStatus(context, ctx.attachOdpId))}`, logger);
                return { handled: true };
            }
        } else if (text) {
            // Cari by NAMA/HP — jalan walau pelanggan TAK punya GPS (inilah yang menutup pelanggan lama).
            const cocok = searchCustomers(text, users);
            if (cocok.length === 0) {
                await safeReply(reply, `❌ Pelanggan "${text}" tak ketemu. Coba nama lain / nomor HP, atau *SELESAI*.`, logger);
                return { handled: true };
            }
            if (cocok.length > 8) {
                await safeReply(reply, `Ada ${cocok.length} pelanggan cocok "${text}" — terlalu banyak. Ketik lebih spesifik.`, logger);
                return { handled: true };
            }
            if (cocok.length > 1) {
                ctx.custChoices = cocok.map((u) => ({ id: u.id, name: u.name || `#${u.id}` }));
                setUserState(stateSender, { step: STEP_PICK_CUSTOMER, _scope: "teknisi", context: ctx });
                await safeReply(reply, listPickerText(`Pelanggan mana?`, ctx.custChoices, (u) => u.name), logger);
                return { handled: true };
            }
            target = [cocok[0]];
        }

        if (!target.length) {
            await safeReply(reply, attachMenuText(ctx, odpStatus(context, ctx.attachOdpId)), logger);
            return { handled: true };
        }

        const ok = [];
        const gagal = [];
        for (const u of target) {
            const hasil = await attachOne(context, ctx, u);
            if (hasil.ok) ok.push((u.name || `#${u.id}`) + (hasil.pindahDari ? " (dipindah)" : ""));
            else gagal.push(`${u.name || `#${u.id}`}: ${hasil.message}`);
        }

        setUserState(stateSender, { step: STEP_ATTACH, _scope: "teknisi", context: ctx });
        const st = odpStatus(context, ctx.attachOdpId);
        await safeReply(reply, [
            ok.length ? `✅ ${ok.join(", ")} → *${ctx.attachOdpName}* (${huniText(st)})` : null,
            gagal.length ? `❌ ${gagal.join(" · ")}` : null,
            ``,
            `Lanjut? balas nomor/nama, atau *SELESAI*.`
        ].filter((x) => x !== null).join("\n"), logger);
        return { handled: true };
    }

    // ── Pilih induk ODC ──
    if (stateStep === STEP_PICK_PARENT) {
        const n = parseInt(text, 10);
        if (Number.isFinite(n) && n >= 0 && n <= (ctx.parentChoices || []).length) {
            ctx.parent = n === 0 ? null : ctx.parentChoices[n - 1];
            setUserState(stateSender, { step: STEP_CONFIRM, _scope: "teknisi", context: ctx });
            await safeReply(reply, summaryText(ctx, assetService), logger);
            return { handled: true };
        }
        await safeReply(reply, parentPickerText(ctx), logger);
        return { handled: true };
    }

    // ── Konfirmasi simpan (khusus aset BARU) ──
    if (stateStep === STEP_CONFIRM) {
        if (/^\s*(ganti|induk|pilih)\b/i.test(text) && (ctx.parentChoices || []).length > 0) {
            setUserState(stateSender, { step: STEP_PICK_PARENT, _scope: "teknisi", context: ctx });
            await safeReply(reply, parentPickerText(ctx), logger);
            return { handled: true };
        }
        if (isAffirmative(text)) return finalizeAsset(context, ctx);
        await safeReply(reply, summaryText(ctx, assetService), logger);
        return { handled: true };
    }

    // ── STEP_COLLECT: mode EDIT (aset sudah ada) — perubahan langsung diterapkan, tanpa konfirmasi ──
    if (ctx.editing) {
        if (DONE_RE.test(text)) {
            deleteUserState(stateSender);
            await safeReply(reply, `✅ Selesai.`, logger);
            return { handled: true };
        }

        if (FILL_CMD_RE.test(text) && ctx.type === "ODP") {
            const asset = assetService.findAssetById(ctx.editing);
            if (asset) return enterAttach(context, { type: "ODP", staff: ctx.staff, attached: [] }, asset);
        }

        const loc = extractLocation(type, msg);
        if (loc) {
            try {
                await assetService.updateAsset(ctx.editing, {
                    latitude: loc.lat,
                    longitude: loc.lng,
                    updated_by: ctx.staff?.name || ctx.staff?.username || ""
                });
                ctx.lokasi = loc;
                await safeReply(reply, `📍 Titik *${ctx.name}* diperbarui.\n${assetService.mapsUrl(loc.lat, loc.lng)}\n\nMasih bisa: *angka* (kapasitas)${ctx.type === "ODP" ? " · *ISI* (sambungkan pelanggan)" : ""} · *SELESAI*.`, logger);
            } catch (e) {
                await safeReply(reply, `❌ Gagal memperbarui titik: ${e.message}`, logger);
            }
            setUserState(stateSender, { step: STEP_COLLECT, _scope: "teknisi", context: ctx });
            return { handled: true };
        }

        if (/^\d{1,3}$/.test(text)) {
            try {
                const upd = await assetService.updateAsset(ctx.editing, {
                    capacity_ports: parseInt(text, 10),
                    updated_by: ctx.staff?.name || ctx.staff?.username || ""
                });
                ctx.capacity = upd.capacity_ports;
                await safeReply(reply, `🔌 Kapasitas *${ctx.name}* jadi ${upd.capacity_ports} port.\n\n*SELESAI* kalau sudah.`, logger);
            } catch (e) {
                await safeReply(reply, `❌ ${e.message}`, logger);
            }
            setUserState(stateSender, { step: STEP_COLLECT, _scope: "teknisi", context: ctx });
            return { handled: true };
        }

        setUserState(stateSender, { step: STEP_COLLECT, _scope: "teknisi", context: ctx });
        await safeReply(reply, editMenuText(ctx, odpStatus(context, ctx.editing), assetService), logger);
        return { handled: true };
    }

    // ── STEP_COLLECT: mode BARU (urutan bebas) ──
    if (type === "imageMessage") {
        let saved = null;
        try {
            const buffer = await downloadMedia(msg, "buffer", {});
            if (buffer && buffer.length > 0) saved = saveMedia(ctx.dir, "box.jpg", buffer);
        } catch (e) { logger?.error?.("[ASET] gagal simpan foto:", e.message); }
        if (saved) ctx.photoPath = saved;
        else await safeReply(reply, "⚠️ Foto gagal diunduh — kirim ulang (foto segar dari kamera).", logger);
    } else {
        const loc = extractLocation(type, msg);
        if (loc) {
            ctx.lokasi = loc;
        } else if (/^\d{1,3}$/.test(text)) {
            ctx.capacity = parseInt(text, 10);
        } else if (text) {
            ctx.name = text;
        }
    }

    if (ctx.name && ctx.lokasi) {
        ctx.parent = resolveParent(context, ctx);
        setUserState(stateSender, { step: STEP_CONFIRM, _scope: "teknisi", context: ctx });
        await safeReply(reply, summaryText(ctx, assetService), logger);
        return { handled: true };
    }

    setUserState(stateSender, { step: STEP_COLLECT, _scope: "teknisi", context: ctx });
    await safeReply(reply, checklistText(ctx, assetService), logger);
    return { handled: true };
}

module.exports = {
    startNetworkAssetSession,
    startFillSession,
    startLocationSession,
    startRouteSession,
    inspectOdp,
    handleNetworkAssetConversationState,
    searchCustomers,
    TRIGGER_RE,
    FILL_RE,
    LOC_RE,
    ROUTE_RE,
    INSPECT_RE,
    ASSET_STEPS,
    STEP_COLLECT,
    STEP_CONFIRM,
    STEP_PICK_PARENT,
    STEP_ATTACH,
    STEP_PICK_CUSTOMER,
    STEP_PICK_ODP,
    STEP_LOC_WAIT,
    STEP_LOC_PICK,
    STEP_ROUTE_WAIT,
    STEP_ROUTE_REPLACE
};
