/**
 * Header Doc
 * Purpose: State domain "Speed on Demand" (SOD) untuk PELANGGAN — naikkan kecepatan sementara dengan
 *          harga dari matriks. Alur: `speed boost` → daftar paket bernomor → pilih durasi → pilih
 *          metode bayar → konfirmasi → request `pending` dibuat + notifikasi admin.
 *          Menggantikan dua jalur lama yang bermasalah:
 *            1) jalur legacy `other-state-handler` (SELECT_SOD_CHOICE/CONFIRM_SOD_CHOICE) yang
 *               mengirim instruksi transfer berisi REKENING DUMMY hardcode; dan
 *            2) `message/handlers/speed-boost-handler.js` yang fiturnya lengkap tapi memakai store
 *               state sendiri (`global.tempStates`) ber-key `sender` MENTAH dan mengirim ke
 *               `msg.key.remoteJid` — dua hal yang melanggar invariant (@lid jadi tuli & target @lid).
 *          Di sini state dikunci ke `stateSender` KANONIK dan semua balasan lewat `reply()`.
 * Caller: `message/handlers/conversation-state-router.js` (owner "speed-boost") + trigger
 *         `startSpeedBoost` dari `message/handlers/raf-intent-dispatch/customer-service-intents.js`.
 * Deps (via context/inject, patuh [[raf-invariants]]): `reply`, `setUserState`/`deleteUserState`
 *        (conversation-handler, key stateSender kanonik), `renderResponseTemplate`/`format`.
 *        Require: `lib/speed-boost-matrix-helper`, `lib/database` (saveSpeedRequests),
 *        `lib/admin-recipients`, `lib/whatsapp-critical-delivery`, `lib/templating` (formatBankAccounts).
 * MainFuncs: `startSpeedBoost(context)`, `handleSpeedBoostConversationState(context)`.
 * SideEffects: Menambah entri ke `global.speed_requests` + simpan ke disk, menulis state percakapan,
 *              dan mengirim WA ke pelanggan + admin. NEVER-THROW.
 */
"use strict";

const convertRupiah = require("rupiah-format");

const STEP_SELECT_PACKAGE = "SODB_SELECT_PACKAGE";
const STEP_SELECT_DURATION = "SODB_SELECT_DURATION";
const STEP_SELECT_PAYMENT = "SODB_SELECT_PAYMENT";
const STEP_CONFIRM = "SODB_CONFIRM";

// Kata yang wajar muncul saat pelanggan menyetujui pesanan, jadi tak boleh dianggap "muatan lain"
// oleh blocklist konsen yang disusun dari sudut pandang reboot.
const SOD_CONSENT_ON_TOPIC = ["paket", "upgrade", "boost", "speed"];

function getMatrixHelper(context) {
    return context.speedBoostMatrixHelper || require("../../../lib/speed-boost-matrix-helper");
}

/**
 * Render template editable admin. Jalur STATE menyuntik `format(key,data)`; jalur DISPATCH
 * menyuntik `renderResponseTemplate(key,fallback,data)`. Coba keduanya lalu fallback string.
 * (Pola sama dengan `wan-switch.state.js`.)
 */
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

function rupiah(value) {
    const numeric = Number(value) || 0;
    return convertRupiah.convert(numeric);
}

function parseChoice(chats, max) {
    const choice = parseInt(String(chats || "").trim(), 10);
    if (Number.isNaN(choice) || choice < 1 || choice > max) return null;
    return choice;
}

/**
 * Penerima notifikasi staf: admin accounts.json (yang berhak memproses) ∪ config.ownerNumber.
 * Alasan menggabung dua sumber & dedup by digit dijelaskan di `services/admin.service.js`.
 */
function buildStaffRecipients(context) {
    let adminJids = [];
    try {
        const { getAdminJids } = require("../../../lib/admin-recipients");
        adminJids = getAdminJids() || [];
    } catch (_e) { /* lanjut dengan ownerNumber saja */ }
    const cfg = (context.global && context.global.config) || global.config || {};
    const owners = Array.isArray(cfg.ownerNumber) ? cfg.ownerNumber : [];

    const seen = new Set();
    const out = [];
    for (const raw of [...adminJids, ...owners]) {
        let digits = String(raw || "").replace(/@.*$/, "").replace(/\D/g, "");
        if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
        if (digits.length < 10 || seen.has(digits)) continue;
        seen.add(digits);
        out.push(`${digits}@s.whatsapp.net`);
    }
    return out;
}

/**
 * Notifikasi admin best-effort: TIDAK pernah throw supaya gagal-kirim tak membatalkan request
 * yang sudah tercatat. (Invariant: notifikasi tak boleh menjatuhkan flow pemanggil.)
 */
async function notifyStaff(context, text) {
    const recipients = buildStaffRecipients(context);
    if (!recipients.length) return;
    let sendCritical = context.sendCritical;
    if (!sendCritical) {
        try {
            ({ sendCritical } = require("../../../lib/whatsapp-critical-delivery"));
        } catch (_e) { return; }
    }
    for (const jid of recipients) {
        try {
            await sendCritical(jid, text, { label: "sod_new_request", waitForReadyMs: 8000 });
        } catch (err) {
            console.error("[SODB_ADMIN_NOTIF_ERROR]", err && err.message ? err.message : err);
        }
    }
}

/**
 * Opsi durasi + harga untuk pasangan paket (sekarang → target), dari matriks harga.
 */
function buildDurationOptions(context, currentPkg, targetPkg) {
    const helper = getMatrixHelper(context);
    const prices = targetPkg.matrixPrices || targetPkg.speedBoostPrices || {};
    const base = [
        { key: "1_day", label: "1 Hari", hours: 24 },
        { key: "3_days", label: "3 Hari", hours: 72 },
        { key: "7_days", label: "7 Hari", hours: 168 }
    ];
    // Durasi khusus yang hanya ada di matriks (mis. "14_days") ikut ditawarkan.
    for (const key of Object.keys(prices)) {
        if (base.find((d) => d.key === key)) continue;
        const match = key.match(/(\d+)_day/);
        if (match) {
            const days = parseInt(match[1], 10);
            base.push({ key, label: `${days} Hari`, hours: days * 24 });
        }
    }
    return base
        .map((d) => {
            let price = prices[d.key];
            if (price == null && typeof helper.calculateBoostPriceFromMatrix === "function") {
                try {
                    price = helper.calculateBoostPriceFromMatrix(currentPkg, targetPkg, d.key);
                } catch (_e) { price = null; }
            }
            return price ? { ...d, price: Number(price) } : null;
        })
        .filter(Boolean);
}

// STARVASI DATA — slot `profil` SENGAJA tidak dioper lagi.
//
// `pkg.profile` adalah nama profil MikroTik, dan angkanya BUKAN yang dibeli pelanggan:
// terukur di `packages.json`, PAKET-110K dijual "Up To 10Mbps" tetapi profilnya `12Mbps`
// (juga 15→17, 30→32). Beberapa paket bahkan bernama internal (`PPP-Monitor`, `FREE-10Mbps`).
//
// Ini ranjau yang siap meledak SAAT Speed on Demand dinyalakan: template tersimpan
// `sodb_package_item` SUDAH memakai `${profil}`, jadi tak perlu satu pun edit admin — begitu
// sakelarnya hidup, daftar paket di WhatsApp langsung menyebut nama profil router ke seluruh
// pelanggan. Karena itu template-nya diubah pada perubahan yang SAMA (template tersimpan
// mengalahkan fallback; memperbaiki fallback saja = kode mati).
function buildPackageListText(context, packages, currentPackageName) {
    const lines = packages
        .map((pkg, i) => renderTpl(
            context,
            "sodb_package_item",
            `*${i + 1}.* ${pkg.name}`,
            { nomor: i + 1, paket: pkg.name }
        ))
        .join("\n");

    return renderTpl(
        context,
        "sodb_package_list",
        `⚡ *Speed on Demand*\n\nPaket Anda sekarang: *${currentPackageName}*\n\nPilih paket yang ingin dipakai sementara:\n\n${lines}\n\nBalas *nomor* pilihan, atau *batal* untuk membatalkan.`,
        { paket_sekarang: currentPackageName, daftar_paket: lines, maks_pilihan: packages.length }
    );
}

function buildDurationListText(context, packageName, durations) {
    const lines = durations
        .map((d, i) => renderTpl(
            context,
            "sodb_duration_item",
            `*${i + 1}.* ${d.label} — ${rupiah(d.price)}`,
            { nomor: i + 1, durasi: d.label, harga: rupiah(d.price) }
        ))
        .join("\n");

    return renderTpl(
        context,
        "sodb_duration_list",
        `⏱️ *Berapa lama?*\n\nPaket pilihan: *${packageName}*\n\n${lines}\n\nBalas *nomor* pilihan, atau *batal*.`,
        { paket: packageName, daftar_durasi: lines, maks_pilihan: durations.length }
    );
}

function buildPaymentListText(context, methods, totalPrice) {
    const lines = methods
        .map((m, i) => renderTpl(
            context,
            "sodb_payment_item",
            `*${i + 1}.* ${m.label}`,
            { nomor: i + 1, metode: m.label }
        ))
        .join("\n");

    return renderTpl(
        context,
        "sodb_payment_list",
        `💳 *Metode pembayaran*\n\nTotal: *${rupiah(totalPrice)}*\n\n${lines}\n\nBalas *nomor* pilihan, atau *batal*.`,
        { total: rupiah(totalPrice), daftar_metode: lines, maks_pilihan: methods.length }
    );
}

/**
 * Bagian instruksi bayar. Rekening diambil dari `config.bankAccounts` lewat `formatBankAccounts()` —
 * BUKAN hardcode. Template lama `other_sod_payment_success` memuat rekening dummy (BCA 1234567890)
 * sehingga pelanggan diarahkan transfer ke rekening yang tidak ada.
 */
function buildPaymentInstruction(context, methodId, price) {
    if (methodId === "transfer") {
        let rekening = "";
        try {
            rekening = require("../../../lib/templating").formatBankAccounts() || "";
        } catch (_e) { rekening = ""; }
        if (!rekening) {
            return renderTpl(
                context,
                "sodb_pay_transfer_no_account",
                "\n\nRekening pembayaran belum diatur. Silakan hubungi Admin untuk cara pembayarannya ya 🙏"
            );
        }
        return renderTpl(
            context,
            "sodb_pay_transfer",
            `\n\n🏦 *Transfer ke:*\n${rekening}\n\nNominal: *${rupiah(price)}*\nSetelah transfer, kirim foto buktinya ke chat ini ya 🙏`,
            { rekening, nominal: rupiah(price) }
        );
    }
    if (methodId === "cash") {
        return renderTpl(
            context,
            "sodb_pay_cash",
            "\n\n💵 Pembayaran tunai — silakan bayar ke petugas kami saat penagihan berikutnya."
        );
    }
    return renderTpl(
        context,
        "sodb_pay_double_billing",
        "\n\n🧾 Biaya akan ditambahkan ke tagihan bulan depan."
    );
}

/**
 * Catat request. Bentuk record SENGAJA sama dengan yang dibaca `speed-status-handler.js` (LIVE):
 * `requestedPackageName`, `durationLabel`, `status`, `paymentStatus`. Jangan diubah tanpa
 * menyesuaikan pembacanya, atau menu "status speed boost" pelanggan jadi kosong.
 */
function createSpeedRequest(context, { user, currentPkg, targetPkg, duration, paymentMethod }) {
    const request = {
        id: `speedreq_${Date.now()}_${user.id}`,
        userId: user.id,
        userName: user.name,
        userPhone: user.phone_number,
        currentPackageName: user.subscription,
        currentPackagePrice: currentPkg?.price || 0,
        currentPackageProfile: currentPkg?.profile || "",
        requestedPackageName: targetPkg.name,
        requestedPackagePrice: targetPkg.price,
        requestedPackageProfile: targetPkg.profile,
        durationKey: duration.key,
        durationLabel: duration.label,
        durationHours: duration.hours,
        price: duration.price,
        paymentMethod,
        paymentStatus: paymentMethod === "double_billing" ? "pending" : "unpaid",
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    const store = (context.global && context.global.speed_requests) || global.speed_requests;
    if (Array.isArray(store)) {
        store.push(request);
    } else {
        global.speed_requests = [request];
    }

    try {
        const { saveSpeedRequests } = require("../../../lib/database");
        saveSpeedRequests();
    } catch (err) {
        console.error("[SODB_SAVE_ERROR]", err && err.message ? err.message : err);
        return null;
    }
    return request;
}

/**
 * Trigger `speed boost` dari intent pelanggan.
 */
async function startSpeedBoost(context) {
    const { reply, stateSender, setUserState, user } = context;
    try {
        const helper = getMatrixHelper(context);
        const config = helper.loadSpeedBoostConfig();

        // Gate fitur: default OFF (`speed_boost_matrix.json.enabled`), jadi porting ini
        // ter-deploy gelap sampai owner menyalakannya.
        if (!config || !config.enabled) {
            await reply(renderTpl(context, "sodb_disabled",
                "Maaf Kak, layanan *Speed on Demand* belum tersedia saat ini 🙏"));
            return { handled: true };
        }

        if (!user) {
            await reply(renderTpl(context, "sodb_not_customer",
                "Maaf, nomor Anda belum terdaftar sebagai pelanggan. Silakan hubungi Admin ya 🙏"));
            return { handled: true };
        }

        const packages = (context.global && context.global.packages) || global.packages || [];
        const available = helper.getAvailableSpeedBoostsFromMatrix(user, packages) || [];
        if (!available.length) {
            await reply(renderTpl(context, "sodb_no_packages",
                `Belum ada pilihan Speed on Demand untuk paket *${user.subscription}* saat ini Kak 🙏`,
                { paket_sekarang: user.subscription || "-" }));
            return { handled: true };
        }

        setUserState(stateSender, {
            step: STEP_SELECT_PACKAGE,
            packages: available.map((p) => ({
                name: p.name,
                profile: p.profile || p.speed || "-",
                price: p.price,
                matrixPrices: p.matrixPrices || p.speedBoostPrices || null
            }))
        });

        await reply(buildPackageListText(context, available, user.subscription || "-"));
        return { handled: true };
    } catch (err) {
        console.warn("[SODB] startSpeedBoost gagal:", err && err.message ? err.message : err);
        try {
            await reply(renderTpl(context, "sodb_start_error",
                "Maaf Kak, ada kendala saat menyiapkan Speed on Demand. Coba lagi sebentar lagi ya 🙏"));
        } catch (_e) { /* abaikan */ }
        return { handled: true };
    }
}

async function handleSelectPackage(context, userState) {
    const { reply, stateSender, setUserState, chats, user } = context;
    const list = userState.packages || [];
    const choice = parseChoice(chats, list.length);
    if (!choice) {
        return reply(renderTpl(context, "sodb_invalid_choice",
            `Pilihan tidak dikenali. Balas angka *1–${list.length}*, atau *batal*.`,
            { maks_pilihan: list.length }));
    }

    const picked = list[choice - 1];
    const packages = (context.global && context.global.packages) || global.packages || [];
    const currentPkg = packages.find((p) => p.name === (user && user.subscription)) || null;
    const durations = buildDurationOptions(context, currentPkg, picked);

    if (!durations.length) {
        return reply(renderTpl(context, "sodb_no_duration",
            `Maaf Kak, harga untuk paket *${picked.name}* belum diatur. Silakan hubungi Admin ya 🙏`,
            { paket: picked.name }));
    }

    setUserState(stateSender, { ...userState, step: STEP_SELECT_DURATION, selectedPackage: picked, durations });
    return reply(buildDurationListText(context, picked.name, durations));
}

async function handleSelectDuration(context, userState) {
    const { reply, stateSender, setUserState, chats } = context;
    const durations = userState.durations || [];
    const choice = parseChoice(chats, durations.length);
    if (!choice) {
        return reply(renderTpl(context, "sodb_invalid_choice",
            `Pilihan tidak dikenali. Balas angka *1–${durations.length}*, atau *batal*.`,
            { maks_pilihan: durations.length }));
    }

    const picked = durations[choice - 1];
    const helper = getMatrixHelper(context);
    const methods = helper.getAvailablePaymentMethods() || [];

    if (!methods.length) {
        return reply(renderTpl(context, "sodb_no_payment_method",
            "Maaf Kak, metode pembayaran belum diatur. Silakan hubungi Admin ya 🙏"));
    }

    setUserState(stateSender, {
        ...userState,
        step: STEP_SELECT_PAYMENT,
        selectedDuration: picked,
        paymentMethods: methods.map((m) => ({ id: m.id, label: m.label }))
    });
    return reply(buildPaymentListText(context, methods, picked.price));
}

async function handleSelectPayment(context, userState) {
    const { reply, stateSender, setUserState, chats, user } = context;
    const methods = userState.paymentMethods || [];
    const choice = parseChoice(chats, methods.length);
    if (!choice) {
        return reply(renderTpl(context, "sodb_invalid_choice",
            `Pilihan tidak dikenali. Balas angka *1–${methods.length}*, atau *batal*.`,
            { maks_pilihan: methods.length }));
    }

    const picked = methods[choice - 1];
    setUserState(stateSender, { ...userState, step: STEP_CONFIRM, selectedPayment: picked });

    const pkg = userState.selectedPackage || {};
    const dur = userState.selectedDuration || {};
    return reply(renderTpl(
        context,
        "sodb_confirm",
        `📋 *Cek pesanan Anda*\n\nPaket sekarang: ${(user && user.subscription) || "-"}\nJadi: *${pkg.name}*\nDurasi: *${dur.label}*\nBiaya: *${rupiah(dur.price)}*\nBayar: *${picked.label}*\n\nSudah benar? Balas *ya* untuk memesan, atau *batal*.`,
        {
            paket_sekarang: (user && user.subscription) || "-",
            paket: pkg.name || "-",
            durasi: dur.label || "-",
            harga: rupiah(dur.price),
            metode: picked.label
        }
    ));
}

async function handleConfirm(context, userState) {
    const { reply, stateSender, deleteUserState, chats, user } = context;
    const { isCleanConsent, isDecline } = require("../../../lib/affirmative-parser");

    if (isDecline(chats)) {
        deleteUserState(stateSender);
        return reply(renderTpl(context, "sodb_cancelled", "Baik Kak, pesanan dibatalkan 🙏"));
    }

    // Pesanan berbayar → konsen KETAT, tapi tetap menerima bahasa pelanggan sungguhan.
    if (!isCleanConsent(chats, { onTopic: SOD_CONSENT_ON_TOPIC })) {
        return reply(renderTpl(context, "sodb_confirm_invalid",
            "Balas *ya* untuk memesan, atau *batal* untuk membatalkan ya Kak 🙏"));
    }

    const packages = (context.global && context.global.packages) || global.packages || [];
    const targetPkg = packages.find((p) => p.name === userState.selectedPackage?.name);
    const currentPkg = packages.find((p) => p.name === (user && user.subscription)) || null;

    if (!targetPkg) {
        deleteUserState(stateSender);
        return reply(renderTpl(context, "sodb_create_failed",
            "Maaf Kak, pesanan gagal dicatat. Silakan coba lagi atau hubungi Admin ya 🙏"));
    }

    const request = createSpeedRequest(context, {
        user,
        currentPkg,
        targetPkg,
        duration: userState.selectedDuration,
        paymentMethod: userState.selectedPayment.id
    });

    deleteUserState(stateSender);

    if (!request) {
        return reply(renderTpl(context, "sodb_create_failed",
            "Maaf Kak, pesanan gagal dicatat. Silakan coba lagi atau hubungi Admin ya 🙏"));
    }

    const successText = renderTpl(
        context,
        "sodb_success",
        `✅ *Pesanan diterima!*\n\nPaket: *${request.requestedPackageName}*\nDurasi: *${request.durationLabel}*\nBiaya: *${rupiah(request.price)}*\n\nPesanan Anda menunggu konfirmasi Admin.`,
        {
            kode: request.id,
            paket: request.requestedPackageName,
            durasi: request.durationLabel,
            harga: rupiah(request.price)
        }
    ) + buildPaymentInstruction(context, userState.selectedPayment.id, request.price);

    await reply(successText);

    await notifyStaff(context, renderTpl(
        context,
        "sodb_admin_new_request",
        `⚡ *Pesanan Speed on Demand baru*\n\n${request.userName} (${request.userPhone})\n${request.currentPackageName} → *${request.requestedPackageName}*\nDurasi: ${request.durationLabel}\nBiaya: ${rupiah(request.price)}\nBayar: ${userState.selectedPayment.label}\n\nKode: ${request.id}`,
        {
            nama: request.userName,
            nomor: request.userPhone,
            paket_sekarang: request.currentPackageName,
            paket: request.requestedPackageName,
            durasi: request.durationLabel,
            harga: rupiah(request.price),
            metode: userState.selectedPayment.label,
            kode: request.id
        }
    ));

    return { handled: true };
}

async function handleSpeedBoostConversationState(context) {
    const userState = context.userState
        || (context.getUserState && context.getUserState(context.stateSender));
    const step = (userState && userState.step) || context.stateStep;

    try {
        if (!userState) return { handled: false };
        if (step === STEP_SELECT_PACKAGE) {
            await handleSelectPackage(context, userState);
            return { handled: true };
        }
        if (step === STEP_SELECT_DURATION) {
            await handleSelectDuration(context, userState);
            return { handled: true };
        }
        if (step === STEP_SELECT_PAYMENT) {
            await handleSelectPayment(context, userState);
            return { handled: true };
        }
        if (step === STEP_CONFIRM) {
            await handleConfirm(context, userState);
            return { handled: true };
        }
        return { handled: false };
    } catch (err) {
        console.warn("[SODB] state gagal:", err && err.message ? err.message : err);
        try {
            if (context.deleteUserState) context.deleteUserState(context.stateSender);
            await context.reply(renderTpl(context, "sodb_state_error",
                "Maaf Kak, ada kendala. Pesanan dibatalkan — silakan coba lagi ya 🙏"));
        } catch (_e) { /* abaikan */ }
        return { handled: true };
    }
}

module.exports = {
    startSpeedBoost,
    handleSpeedBoostConversationState,
    _internal: {
        STEP_SELECT_PACKAGE,
        STEP_SELECT_DURATION,
        STEP_SELECT_PAYMENT,
        STEP_CONFIRM,
        buildDurationOptions,
        buildStaffRecipients,
        createSpeedRequest
    }
};
