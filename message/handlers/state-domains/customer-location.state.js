/**
 * Header Doc
 * Purpose: Wizard WA penetapan TITIK RUMAH pelanggan untuk teknisi/admin — `lokasi <nama>` (cari) atau
 *          `lokasi` polos (mode borongan: daftar pelanggan yang belum punya titik). Alur: pilih pelanggan
 *          (daftar bernomor) → bot tampilkan TITIK LAMA-nya → teknisi kirim pin lokasi (atau TERUSKAN pin
 *          dari pelanggan, atau tempel link Maps) → layar konfirmasi berisi titik lama vs baru + jarak ke
 *          tetangga/ODP + peringatan → baru setelah *YA* disimpan.
 *          Pelanggan dipilih LEBIH DULU dengan sengaja: kalau pin yang dikirim duluan, bot harus mencegat
 *          SEMUA pesan lokasi untuk menebak maksudnya — dan itu bertabrakan dengan `otw [ID]` (share lokasi
 *          perjalanan teknisi). Dengan urutan ini, bot hanya "membuka telinga" setelah diminta.
 * Caller: `message/handlers/conversation-state-router.js` (owner "customer-location", prefix `CUSTLOC_`)
 *         + trigger `startCustomerLocationSession` dari `message/raf.js` (jalur DM staf).
 * Deps (via context/inject): `reply`, `setUserState`/`deleteUserState` (`conversation-handler`),
 *        `usersService` (`global.__apiUsersService`), `getUsers`, `getAssets`
 *        (`lib/network-assets-service`), `locationService` (`lib/customer-location-service`).
 * MainFuncs: `startCustomerLocationSession(context)`, `handleCustomerLocationState(context)`,
 *            `isCustomerLocationTrigger(text)`, `parseLocationCommand(text)`.
 * SideEffects: Update `users.latitude/longitude/maps_url/location_source/location_updated_at` lewat
 *              service (bukan SQL langsung) + kirim WA. NEVER-THROW.
 */
"use strict";

const STEP_PICK = "CUSTLOC_PICK";
const STEP_WAIT_PIN = "CUSTLOC_WAIT_PIN";
const STEP_CONFIRM = "CUSTLOC_CONFIRM";
// Jalur PELANGGAN: dia mengirim pin ke bot, bot menawarkan menyimpannya sebagai titik rumahnya.
// Ini sumber paling akurat (pelanggan mengirim dari rumahnya sendiri) dan nol kerja teknisi.
const STEP_SELF = "CUSTLOC_SELF_CONFIRM";
const CUSTLOC_STEPS = new Set([STEP_PICK, STEP_WAIT_PIN, STEP_CONFIRM, STEP_SELF]);

const MAX_LIST = 10;
const YES_WORDS = ["ya", "yes", "ok", "oke", "y", "simpan", "benar"];
const NO_WORDS = ["tidak", "no", "n", "salah", "ganti"];

// `lokasi` / `lokasi <cari>` / `titik <cari>` / `set lokasi <cari>`. null bila bukan perintah ini.
function parseLocationCommand(text) {
    const m = String(text || "").trim().match(/^(?:set\s+)?(?:lokasi|titik|sharelok)(?:\s+(.+))?$/i);
    if (!m) return null;
    return { query: (m[1] || "").trim() };
}

function isCustomerLocationTrigger(text) {
    return parseLocationCommand(text) !== null;
}

function withDeps(context) {
    return {
        ...context,
        locationService: context.locationService || require("../../../lib/customer-location-service"),
        usersService: context.usersService || global.__apiUsersService,
        getUsers: context.getUsers || (() => global.users || []),
        getAssets: context.getAssets || (() => {
            try { return require("../../../lib/network-assets-service").listAssets({ type: "ODP" }) || []; }
            catch (_e) { return []; }
        })
    };
}

async function safeReply(reply, text, logger) {
    try { if (reply) await reply(text); } catch (e) { logger?.error?.("[CUSTLOC] gagal balas:", e.message); }
}

function hasPoint(u) {
    const lat = parseFloat(u && u.latitude);
    const lng = parseFloat(u && u.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) && !(Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001);
}

function matchUser(u, q) {
    const hay = [u && u.name, u && u.phone_number, u && u.pppoe_username, u && u.dusun]
        .map((v) => String(v || "").toLowerCase()).join(" ");
    return hay.includes(q);
}

// Baris pelanggan di daftar bernomor — status titik ikut ditampilkan supaya teknisi tahu mana yang
// masih kosong dan mana yang akan DITIMPA.
function userLine(index, u) {
    const nums = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
    const dusun = u.dusun ? ` · ${u.dusun}` : "";
    const titik = hasPoint(u)
        ? `✅ sudah ada titik${u.location_updated_at ? ` (${String(u.location_updated_at).slice(0, 10)})` : ""}`
        : "❌ belum ada titik";
    return `${nums[index] || (index + 1) + "."} ${u.name}${dusun} · ${u.phone_number || "-"} · ${titik}`;
}

function pickListText(ctx, users) {
    const head = ctx.query
        ? `📍 Hasil cari "*${ctx.query}*" — pilih pelanggan (balas *angka*):`
        : `📍 Pelanggan yang *belum punya titik* — pilih (balas *angka*):`;
    return [
        head,
        ...users.map((u, i) => userLine(i, u)),
        ``,
        ctx.query ? `Tak ada yang cocok? ketik \`lokasi <nama lain>\`. *BATAL* untuk berhenti.` : `*BATAL* untuk berhenti.`
    ].join("\n");
}

// Titik LAMA selalu ditampilkan SEBELUM teknisi mengirim yang baru — supaya dia sadar sedang menimpa
// apa, dan bisa membandingkan. (Permintaan eksplisit; berlaku sama di web.)
function askPinText(target, locationService) {
    const lines = [`📍 Titik rumah untuk *${target.name}*`];
    if (hasPoint(target)) {
        lines.push(
            ``,
            `📌 *Titik LAMA yang tersimpan:*`,
            `${target.latitude}, ${target.longitude}`,
            locationService.buildMapsUrl(target.latitude, target.longitude),
            target.location_source ? `sumber: ${target.location_source}${target.location_updated_at ? ` · ${String(target.location_updated_at).slice(0, 10)}` : ""}` : null,
            `⚠️ Titik baru akan MENIMPA titik di atas.`
        );
    } else {
        lines.push(`(belum punya titik sama sekali)`);
    }
    lines.push(
        ``,
        `Kirim titiknya sekarang:`,
        `• Kamu SEDANG di rumahnya → 📎 Location → *Send your current location*`,
        `• Pelanggan pernah kirim pin → *teruskan (forward)* pin itu ke sini`,
        `• Punya link Maps → tempel saja linknya`,
        ``,
        `*BATAL* untuk berhenti.`
    );
    return lines.filter((l) => l !== null).join("\n");
}

function confirmText(target, verdict, locationService) {
    const lines = [
        `📍 *CEK DULU sebelum disimpan* — ${target.name}`,
        ``,
        `🆕 Titik BARU: ${verdict.point.lat}, ${verdict.point.lng}`,
        verdict.mapsUrl
    ];
    if (verdict.previous) {
        lines.push(
            ``,
            `📌 Titik LAMA: ${verdict.previous.lat}, ${verdict.previous.lng}`,
            verdict.previous.mapsUrl,
            `↔️ Bergeser ${locationService.formatDistance(verdict.previous.distanceM)} dari titik lama`
        );
    }
    const acuan = [];
    if (verdict.nearestCustomer) acuan.push(`${locationService.formatDistance(verdict.nearestCustomer.meters)} dari rumah ${verdict.nearestCustomer.name}`);
    if (verdict.nearestAsset) acuan.push(`${locationService.formatDistance(verdict.nearestAsset.meters)} dari ${verdict.nearestAsset.name}`);
    if (acuan.length) lines.push(``, `📏 ${acuan.join(" · ")}`);

    verdict.warnings.forEach((w) => lines.push(``, `⚠️ ${w.message}`));

    lines.push(``, `Sudah benar? *YA* (simpan) · *TIDAK* (kirim ulang titik) · *BATAL*`);
    return lines.join("\n");
}

// ── Trigger ──
async function startCustomerLocationSession(context) {
    context = withDeps(context);
    const { query = "", staff, stateSender, reply, setUserState, getUsers, logger = console } = context;

    const all = (getUsers() || []).filter((u) => u && String(u.account_type || "pelanggan").toLowerCase() !== "infrastruktur");
    const q = String(query || "").trim().toLowerCase();

    const matched = q
        ? all.filter((u) => matchUser(u, q))
        : all.filter((u) => !hasPoint(u));

    if (!matched.length) {
        await safeReply(reply, q
            ? `🔎 Tak ada pelanggan cocok "*${query}*". Coba potongan nama, nomor HP, atau dusunnya.`
            : `✅ Semua pelanggan sudah punya titik lokasi. Untuk memperbarui salah satunya: \`lokasi <nama>\`.`, logger);
        return { started: false };
    }

    const shown = matched.slice(0, MAX_LIST);
    const ctx = { query: q ? query.trim() : "", candidates: shown.map((u) => u.id), staff, borongan: !q, sisa: matched.length - shown.length };
    setUserState(stateSender, { step: STEP_PICK, _scope: "teknisi", context: ctx });

    const extra = matched.length > shown.length ? `\n\n_(+${matched.length - shown.length} lagi — persempit dengan \`lokasi <nama>\`)_` : "";
    await safeReply(reply, pickListText(ctx, shown) + extra, logger);
    return { started: true, count: shown.length };
}

// ── Jalur PELANGGAN: pin masuk dari pelanggan → tawarkan simpan sebagai titik rumahnya ──
// Dipanggil dari raf.js SESUDAH alur tiket, jadi share-lokasi untuk tiket tak pernah dibajak.
// Gate config `customerLocationSelfService.enabled` (default OFF — ini menyentuh pelanggan).
async function offerSelfLocation(context) {
    context = withDeps(context);
    const { customer, point, stateSender, reply, setUserState, locationService, getUsers, nowMs = Date.now(), logger = console } = context;
    if (!customer || !point) return { offered: false };

    const verdict = locationService.evaluateLocationCandidate({
        point, customer, users: getUsers() || [], assets: [], nowMs
    });
    if (verdict.blocked) return { offered: false };

    setUserState(stateSender, { step: STEP_SELF, context: { targetId: customer.id, point: verdict.point } });

    const lines = [`📍 Terima kasih, lokasinya sudah kami terima.`];
    if (verdict.previous) {
        lines.push(`Sebelumnya alamat Anda tercatat di titik lain (${locationService.formatDistance(verdict.previous.distanceM)} dari titik ini).`);
    }
    lines.push(
        ``,
        `Simpan titik ini sebagai *lokasi rumah* Anda? Ini membantu teknisi menemukan rumah Anda saat ada gangguan.`,
        `Balas *YA* untuk menyimpan, atau abaikan pesan ini.`
    );
    await safeReply(reply, lines.join("\n"), logger);
    return { offered: true };
}

// ── Router state ──
async function handleCustomerLocationState(context) {
    context = withDeps(context);
    const {
        stateStep, teknisiState, type, msg, chats, reply, setUserState, deleteUserState, stateSender,
        getUsers, getAssets, usersService, locationService, nowMs = Date.now(), logger = console
    } = context;

    if (!CUSTLOC_STEPS.has(stateStep)) return { handled: false };
    const ctx = (teknisiState && teknisiState.context) || null;
    if (!ctx) { deleteUserState(stateSender); return { handled: true }; }

    const text = String(chats || "").trim();
    const lower = text.toLowerCase();
    if (["batal", "cancel", "ga jadi", "gajadi"].includes(lower)) {
        deleteUserState(stateSender);
        await safeReply(reply, "❌ Dibatalkan. Tidak ada titik yang diubah.", logger);
        return { handled: true };
    }

    const users = getUsers() || [];
    const findById = (id) => users.find((u) => String(u.id) === String(id)) || null;

    // ── Konfirmasi PELANGGAN atas titik rumahnya sendiri ──
    // Pakai parser afirmatif, BUKAN daftar cocok-persis: pelanggan menjawab "ya ka", "siap", "ok mas".
    if (stateStep === STEP_SELF) {
        let setuju = false;
        try {
            const { isAffirmative } = require("../../../lib/affirmative-parser");
            setuju = isAffirmative(text) === true;
        } catch (_e) {
            setuju = YES_WORDS.includes(lower);
        }
        if (!setuju) { deleteUserState(stateSender); return { handled: false }; } // biarkan handler lain menanganinya

        const target = findById(ctx.targetId);
        const { lat, lng } = ctx.point || {};
        if (!target || !Number.isFinite(lat)) { deleteUserState(stateSender); return { handled: true }; }
        try {
            await usersService.updateUserById({
                id: target.id,
                userData: {
                    latitude: lat,
                    longitude: lng,
                    maps_url: locationService.buildMapsUrl(lat, lng),
                    location_source: locationService.LOCATION_SOURCES.PELANGGAN_WA,
                    location_updated_at: new Date(nowMs).toISOString()
                },
                actor: { id: null, username: "pelanggan", name: target.name, role: "pelanggan" },
                requestMeta: { ipAddress: "wa-pelanggan-lokasi", userAgent: "customer-location-self" }
            });
            await safeReply(reply, "✅ Terima kasih, lokasi rumah Anda sudah tersimpan.", logger);
        } catch (e) {
            logger?.error?.("[CUSTLOC] simpan lokasi pelanggan gagal:", e.message);
        }
        deleteUserState(stateSender);
        return { handled: true };
    }

    // ── Pilih pelanggan ──
    if (stateStep === STEP_PICK) {
        const n = parseInt(text, 10);
        const ids = ctx.candidates || [];
        if (Number.isInteger(n) && n >= 1 && n <= ids.length) {
            const target = findById(ids[n - 1]);
            if (!target) { await safeReply(reply, "Pelanggan itu tak ditemukan lagi. Ketik `lokasi <nama>` untuk mengulang.", logger); return { handled: true }; }
            setUserState(stateSender, { step: STEP_WAIT_PIN, _scope: "teknisi", context: { ...ctx, targetId: target.id } });
            await safeReply(reply, askPinText(target, locationService), logger);
            return { handled: true };
        }
        const shown = ids.map(findById).filter(Boolean);
        await safeReply(reply, `Balas *angka* pelanggan yang mau diisi titiknya.\n\n${pickListText(ctx, shown)}`, logger);
        return { handled: true };
    }

    // ── Tunggu pin / link ──
    if (stateStep === STEP_WAIT_PIN) {
        const target = findById(ctx.targetId);
        if (!target) { deleteUserState(stateSender); await safeReply(reply, "Pelanggan tak ditemukan. Ulangi dengan `lokasi <nama>`.", logger); return { handled: true }; }

        let point = null;
        if (type === "locationMessage" || type === "liveLocationMessage") {
            const loc = type === "locationMessage" ? msg?.message?.locationMessage : msg?.message?.liveLocationMessage;
            if (loc && loc.degreesLatitude && loc.degreesLongitude) {
                point = { lat: loc.degreesLatitude, lng: loc.degreesLongitude };
            }
        } else if (text) {
            const parsed = locationService.parseCoordinateInput(text);
            if (parsed && parsed.error) { await safeReply(reply, `⚠️ ${parsed.error}`, logger); return { handled: true }; }
            if (parsed) point = parsed;
        }

        if (!point) {
            await safeReply(reply, `Belum ada titik yang terbaca. Kirim *pin lokasi* (📎 → Location), teruskan pin dari pelanggan, atau tempel link Maps.\n\n*BATAL* untuk berhenti.`, logger);
            return { handled: true };
        }

        const verdict = locationService.evaluateLocationCandidate({
            point, customer: target, users, assets: getAssets() || [], nowMs
        });
        if (verdict.blocked) {
            await safeReply(reply, `⛔ ${verdict.blockReason}\n\nKirim titik lain, atau *BATAL*.`, logger);
            return { handled: true };
        }

        setUserState(stateSender, { step: STEP_CONFIRM, _scope: "teknisi", context: { ...ctx, point: verdict.point } });
        await safeReply(reply, confirmText(target, verdict, locationService), logger);
        return { handled: true };
    }

    // ── Konfirmasi & simpan ──
    if (stateStep === STEP_CONFIRM) {
        const target = findById(ctx.targetId);
        if (!target) { deleteUserState(stateSender); return { handled: true }; }

        if (NO_WORDS.includes(lower)) {
            setUserState(stateSender, { step: STEP_WAIT_PIN, _scope: "teknisi", context: { ...ctx, point: null } });
            await safeReply(reply, askPinText(target, locationService), logger);
            return { handled: true };
        }
        if (!YES_WORDS.includes(lower)) {
            await safeReply(reply, "Balas *YA* (simpan) · *TIDAK* (kirim ulang titik) · *BATAL*.", logger);
            return { handled: true };
        }

        const { lat, lng } = ctx.point || {};
        const iso = new Date(nowMs).toISOString();
        let result = null;
        try {
            result = await usersService.updateUserById({
                id: target.id,
                userData: {
                    latitude: lat,
                    longitude: lng,
                    maps_url: locationService.buildMapsUrl(lat, lng),
                    location_source: locationService.LOCATION_SOURCES.TEKNISI_WA,
                    location_updated_at: iso
                },
                actor: { id: ctx.staff.id, username: ctx.staff.username, name: ctx.staff.name || ctx.staff.username, role: ctx.staff.role },
                requestMeta: { ipAddress: "wa-dm-lokasi", userAgent: "customer-location-wizard" }
            });
        } catch (e) {
            logger?.error?.("[CUSTLOC] simpan gagal:", e.message);
            await safeReply(reply, `❌ Gagal menyimpan titik: ${e.message}`, logger);
            deleteUserState(stateSender);
            return { handled: true };
        }

        if (!result || result.status >= 400) {
            const m = (result && result.body && result.body.message) || "gagal menyimpan";
            await safeReply(reply, `❌ Titik *${target.name}* gagal disimpan: ${m}`, logger);
            deleteUserState(stateSender);
            return { handled: true };
        }

        await safeReply(reply, `✅ Titik *${target.name}* tersimpan.\n${locationService.buildMapsUrl(lat, lng)}`, logger);

        // Mode borongan: langsung sodorkan sisa pelanggan yang belum punya titik, supaya sekali
        // keliling kampung bisa selesai banyak tanpa mengetik perintah lagi.
        if (ctx.borongan) {
            deleteUserState(stateSender);
            await startCustomerLocationSession({ ...context, query: "" });
            return { handled: true };
        }

        deleteUserState(stateSender);
        return { handled: true };
    }

    return { handled: false };
}

module.exports = {
    startCustomerLocationSession,
    handleCustomerLocationState,
    offerSelfLocation,
    STEP_SELF,
    isCustomerLocationTrigger,
    parseLocationCommand,
    hasPoint,
    CUSTLOC_STEPS,
    STEP_PICK,
    STEP_WAIT_PIN,
    STEP_CONFIRM
};
