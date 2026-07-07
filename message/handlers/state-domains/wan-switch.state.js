/**
 * Header Doc
 * Purpose: State domain "switch koneksi" via WhatsApp untuk OWNER/ADMIN — alihkan trafik antar-ISP
 *          instan dengan konfirmasi. Alur: `switch koneksi` → tampil status + daftar bernomor →
 *          pilih nomor → tampil rencana (apply/kembalikan sesuai kondisi) → balas *ya* → eksekusi
 *          via `lib/wan-switch-service`. Gate peran PRESISI (admin/owner/superadmin dari accounts.json,
 *          BUKAN isOwner placeholder / isTeknisi longgar). Aksi tulis ke router hanya setelah *ya*.
 * Caller: `message/handlers/conversation-state-router.js` (owner "wan-switch") + trigger
 *         `startWanSwitch` dari `message/handlers/raf-intent-dispatch/owner-admin-intents.js`.
 * Deps (via context/inject, patuh [[raf-invariants]]): `reply` (delivery boundary), `setUserState/
 *        deleteUserState` (conversation-handler, key stateSender kanonik), `renderResponseTemplate`.
 *        Require: `../../../lib/wan-switch-service`.
 * MainFuncs: `startWanSwitch(context)`, `handleWanSwitchConversationState(context)`, `resolveStaffRole`.
 * SideEffects: Mengubah route di router (HANYA di langkah konfirmasi via service); menulis state
 *              percakapan; kirim WA. NEVER-THROW.
 */
"use strict";

const STEP_SELECT = "WANSW_SELECT";
const STEP_CONFIRM = "WANSW_CONFIRM";
const ADMIN_ROLES = ["admin", "owner", "superadmin"];

function getService(context) {
    return context.wanSwitchService || require("../../../lib/wan-switch-service");
}

// Render template editable admin. Jalur STATE menyuntik `format(key,data)`; jalur DISPATCH
// menyuntik `renderResponseTemplate(key,fallback,data)`. Coba keduanya lalu fallback string.
function renderTpl(context, key, fallback, data) {
    try {
        if (typeof context.format === "function") {
            const r = context.format(key, data || {});
            if (r && String(r).trim()) return r;
        }
    } catch (_e) { /* lanjut */ }
    try {
        if (typeof context.renderResponseTemplate === "function") {
            const r = context.renderResponseTemplate(key, fallback, data || {});
            if (r && String(r).trim()) return r;
        }
    } catch (_e) { /* lanjut */ }
    return fallback;
}

/**
 * Resolusi peran staf pengirim dari accounts.json (presisi). Kembalikan role string atau null.
 * Cocokkan lid / phone_number / nomor polos — pola yang sama dengan psb-group-intake.
 */
function resolveStaffRole(context) {
    const accounts = (context.global && context.global.accounts) || global.accounts || [];
    const sender = String(context.sender || "");
    const plain = String(context.plainSenderNumber || "").replace(/\D/g, "");
    const acct = (Array.isArray(accounts) ? accounts : []).find((a) => {
        if (!a) return false;
        if (a.lid && a.lid === sender) return true;
        const ph = String(a.phone_number || "");
        const phNum = ph.replace(/\D/g, "");
        return (ph && (ph === sender || ph === plain)) || (phNum && plain && phNum === plain);
    });
    return acct ? String(acct.role || "").toLowerCase() : null;
}

function isAdminOwner(context) {
    return ADMIN_ROLES.includes(resolveStaffRole(context) || "");
}

function actorFromContext(context) {
    const role = resolveStaffRole(context) || "admin";
    const name = context.pushname || "-";
    return { label: `${role}:${name}`, role, name };
}

function buildListText(context, status) {
    if (!status.enabled) {
        return renderTpl(context, "wanswitch_disabled",
            "Fitur *switch koneksi* belum diaktifkan. Aktifkan `wanSwitch.enabled` di config dulu ya.");
    }
    if (!status.switches.length) {
        return renderTpl(context, "wanswitch_empty",
            "Belum ada switch koneksi terdaftar di config (`wanSwitch.switches`).");
    }
    let body = "🔀 *SWITCH KONEKSI*\n\nBalas *angka* untuk memilih (atau *batal*):\n";
    status.switches.forEach((s, i) => {
        const kondisi = s.applied === null ? "❔ tak terbaca" : (s.applied ? "🟠 SEDANG DIALIHKAN" : "🟢 normal");
        body += `\n*${i + 1}.* ${s.label}\n   Status: ${kondisi}`;
        if (s.affects) body += `\n   Terdampak: ${s.affects}`;
        body += "\n";
    });
    return body;
}

/**
 * Trigger `switch koneksi`. Tampilkan status + daftar, set state WANSW_SELECT.
 * Return { handled: true } bila menangani (termasuk tolak non-admin), else { handled:false }.
 */
async function startWanSwitch(context) {
    const { reply, stateSender, setUserState } = context;
    try {
        if (!isAdminOwner(context)) {
            // Diam-diam serahkan ke handler lain — non-admin tak perlu tahu fitur ini ada.
            return { handled: false };
        }
        const svc = getService(context);
        const status = await svc.getStatus();
        const text = buildListText(context, status);
        if (!status.enabled || !status.switches.length) {
            await reply(text);
            return { handled: true };
        }
        setUserState(stateSender, {
            step: STEP_SELECT,
            switches: status.switches.map((s) => ({ id: s.id, label: s.label, applied: s.applied, affects: s.affects }))
        });
        await reply(text);
        return { handled: true };
    } catch (err) {
        console.warn(`[WANSW] startWanSwitch gagal: ${err.message}`);
        try { await reply("Maaf, gagal membaca status jalur. Coba lagi ya."); } catch (_e) { /* abaikan */ }
        return { handled: true };
    }
}

async function handleSelect(context, userState) {
    const { reply, stateSender, setUserState, deleteUserState, chats } = context;
    const choice = parseInt(String(chats || "").trim(), 10);
    const list = userState.switches || [];
    if (Number.isNaN(choice) || choice < 1 || choice > list.length) {
        return reply(renderTpl(context, "wanswitch_invalid_choice",
            `Pilihan tidak valid. Balas angka 1–${list.length}, atau *batal*.`));
    }
    const picked = list[choice - 1];
    // Kondisi menentukan arah: kalau sedang dialihkan → tawarkan KEMBALIKAN, else TERAPKAN.
    const direction = picked.applied ? "restore" : "apply";
    const svc = getService(context);
    // Verifikasi ulang status terkini switch ini (hindari basi) — pakai getStatus ringan.
    let freshApplied = picked.applied;
    try {
        const st = await svc.getStatus();
        const found = (st.switches || []).find((s) => s.id === picked.id);
        if (found && found.applied !== null) freshApplied = found.applied;
    } catch (_e) { /* pakai nilai lama */ }
    const dir = freshApplied ? "restore" : "apply";

    setUserState(stateSender, { step: STEP_CONFIRM, switchId: picked.id, label: picked.label, direction: dir });

    const aksi = dir === "restore" ? "MENGEMBALIKAN ke jalur normal" : "MENGALIHKAN jalur";
    const body = renderTpl(context, "wanswitch_confirm",
        `⚠️ *Konfirmasi Switch Koneksi*\n\nAnda akan *${aksi}*:\n*${picked.label}*` +
        (picked.affects ? `\nTerdampak: ${picked.affects}` : "") +
        `\n\nKoneksi pada jalur ini akan terputus sesaat saat berpindah. Lanjutkan?\n\nBalas *ya* untuk eksekusi, atau *batal*.`,
        { label: picked.label, aksi, affects: picked.affects || "" });
    // Konsistensi: kalau service memang mengembalikan direction beda dari label awal, sebut.
    void direction;
    void deleteUserState;
    return reply(body);
}

async function handleConfirm(context, userState) {
    const { reply, stateSender, deleteUserState } = context;
    const answer = String(context.chats || "").toLowerCase().trim();
    if (!["ya", "y", "iya", "ok", "lanjut", "gas"].includes(answer)) {
        return reply(renderTpl(context, "wanswitch_need_yes",
            "Balas *ya* untuk eksekusi, atau *batal* untuk membatalkan."));
    }
    deleteUserState(stateSender);
    const svc = getService(context);
    await reply(renderTpl(context, "wanswitch_applying", "⏳ Sedang menerapkan perubahan jalur ke router..."));
    const result = await svc.applySwitch(userState.switchId, userState.direction, actorFromContext(context));
    if (!result.ok) {
        return reply(renderTpl(context, "wanswitch_failed",
            `❌ Gagal: ${result.message}`, { message: result.message }));
    }
    return reply(renderTpl(context, "wanswitch_success",
        `✅ ${result.message}\n\nKondisi sekarang: ${result.summary || "-"}`,
        { message: result.message, summary: result.summary || "-" }));
}

/**
 * Router state WANSW_*. NEVER-THROW.
 */
async function handleWanSwitchConversationState(context) {
    const userState = context.userState || (context.getUserState && context.getUserState(context.stateSender));
    const step = (userState && userState.step) || context.stateStep;
    try {
        // Gate ulang tiap langkah — kalau bukan admin/owner, jangan proses (dan jangan bocorkan).
        if (!isAdminOwner(context)) {
            return { handled: false };
        }
        if (step === STEP_SELECT) {
            await handleSelect(context, userState);
            return { handled: true };
        }
        if (step === STEP_CONFIRM) {
            await handleConfirm(context, userState);
            return { handled: true };
        }
        return { handled: false };
    } catch (err) {
        console.warn(`[WANSW] state gagal: ${err.message}`);
        try {
            if (context.deleteUserState) context.deleteUserState(context.stateSender);
            await context.reply("Maaf, terjadi kendala. Proses switch dibatalkan.");
        } catch (_e) { /* abaikan */ }
        return { handled: true };
    }
}

module.exports = {
    startWanSwitch,
    handleWanSwitchConversationState,
    resolveStaffRole,
    _internal: { isAdminOwner, STEP_SELECT, STEP_CONFIRM }
};
