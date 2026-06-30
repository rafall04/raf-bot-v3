/**
 * Header Doc
 * Purpose: Halaman bayar tagihan bulanan publik (tanpa login, via token bertanda-tangan) +
 *   API-nya: info tagihan & channel aktif, buat charge iPaymu multi-channel, polling status.
 *   MULTI-GATEWAY (config `paymentGateway`: 'ipaymu' | 'tripay') + mode halaman:
 *   - Tripay aktif → alur REDIRECT ke halaman Tripay (auto-settle) + callback POST /callback/tripay.
 *   - iPaymu + `billPaymentHosted` → REDIRECT ke halaman iPaymu (callback POST /callback/payment).
 *   - iPaymu default → PORTAL sendiri (static/bill-payment.html, multi-channel direct).
 *   Pemilihan gateway via lib/payment-gateways (selector chargeRedirect/verify).
 * Caller: routes-registry (mount di "/").
 * Deps: lib/bill-pay-token, lib/ipaymu, lib/tripay, lib/payment-gateways, lib/payment,
 *   lib/services/bill-payment-settlement, lib/templating, lib/whatsapp-delivery-service, qr-image, rupiah-format.
 * MainFuncs: GET /bayar/:token (portal/redirect), GET /bayar-status, POST /callback/tripay,
 *   GET /api/bayar/:token/info, POST /api/bayar/:token/charge, GET /api/bayar/:token/status.
 * SideEffects: Membuat transaksi/sesi gateway + menulis record payment.json (tag 'tagihan') + settle + struk WA.
 */
"use strict";

const express = require("express");
const path = require("path");
const qr = require("qr-image");
const convertRupiah = require("rupiah-format");
const rateLimit = require("express-rate-limit");

const { verifyBillPayToken, resolveBaseUrl } = require("../lib/bill-pay-token");
const ipaymu = require("../lib/ipaymu");
const tripay = require("../lib/tripay");
const gateways = require("../lib/payment-gateways");
const { addPayment, checkStatusPayment, updateStatusPayment, updateKetPayment } = require("../lib/payment");
const { createBillPaymentSettlement } = require("../lib/services/bill-payment-settlement");
const { renderTemplate } = require("../lib/templating");
const { sendMessage } = require("../lib/whatsapp-delivery-service");

const billSettlement = createBillPaymentSettlement();

const router = express.Router();

const chargeLimiter = rateLimit({ windowMs: 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false });

// Verifikasi token + resolve konteks tagihan (pelanggan pascabayar + nominal paket).
function resolveBillContext(token) {
    const v = verifyBillPayToken(token);
    if (!v.ok) return { ok: false, status: "invalid", reason: v.reason };
    const user = (global.users || []).find((u) => String(u.id) === String(v.uid));
    if (!user) return { ok: false, status: "user_not_found" };
    if (user.subscription === "PAKET-VOUCHER") return { ok: false, status: "not_postpaid", user };
    const pkg = (global.packages || []).find((p) => p.name === user.subscription) || {};
    return {
        ok: true,
        user,
        pkg,
        whitelist: pkg.whitelist === true,
        amount: parseInt(pkg.price, 10) || 0,
        // Flag uji di PAKET (packages.json): user pada paket ber-`sandbox:true` memakai sandbox
        // iPaymu (demo, nol rupiah); paket pelanggan asli tak ber-flag → tetap produksi. Isolasi
        // per-paket, bukan toggle global → pelanggan lain tak terpengaruh.
        sandbox: pkg.sandbox === true,
    };
}

function currentPeriod() {
    const now = new Date();
    return { periodMonth: now.getMonth() + 1, periodYear: now.getFullYear() };
}

function customerPhoneDigits(user) {
    return String(user.phone_number || "").split("|")[0].trim().replace(/\D/g, "");
}

function customerJid(user) {
    const d = customerPhoneDigits(user);
    return d.length > 5 ? `${d}@s.whatsapp.net` : null;
}

// Mode hosted: alih-alih portal HTML sendiri, buat sesi iPaymu lalu redirect ke halaman iPaymu.
function billPaymentHostedEnabled() {
    return (global.config || {}).billPaymentHosted === true;
}

function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

// Halaman status minimal (untuk mode hosted: kondisi non-charge & landing returnUrl).
function statusPage(title, message) {
    return `<!doctype html><html lang="id"><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>${escHtml(title)}</title><style>` +
        `body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;` +
        `display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}` +
        `.card{max-width:380px;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:28px;text-align:center}` +
        `h1{font-size:18px;margin:0 0 10px}p{font-size:14px;line-height:1.6;color:#cbd5e1;margin:0}</style></head>` +
        `<body><div class="card"><h1>${escHtml(title)}</h1><p>${escHtml(message)}</p></div></body></html>`;
}

// Pakai alur REDIRECT (halaman gateway auto-settle) atau portal HTML sendiri?
//  - Tripay aktif → SELALU redirect (closed payment di halaman Tripay).
//  - iPaymu + billPaymentHosted → redirect ke halaman iPaymu.
//  - iPaymu default → portal HTML direct (multi-channel sendiri).
function useRedirectFlow() {
    return gateways.getActiveName() === "tripay" || billPaymentHostedEnabled();
}

// Halaman bayar — branch by gateway/mode.
router.get("/bayar/:token", chargeLimiter, async (req, res) => {
    if (!useRedirectFlow()) {
        return res.sendFile(path.join(__dirname, "..", "static", "bill-payment.html"));
    }

    const ctx = resolveBillContext(req.params.token);
    if (!ctx.ok) return res.status(400).send(statusPage("Link tidak valid", "Tautan pembayaran tidak valid atau sudah kedaluwarsa. Silakan hubungi admin."));
    if (ctx.whitelist) return res.send(statusPage("Tidak Ada Tagihan", `Halo ${ctx.user.name}, paket Anda tidak ditagih. Terima kasih.`));
    if (ctx.user.paid === true) return res.send(statusPage("Sudah Lunas", `Tagihan Anda sudah lunas. Terima kasih, ${ctx.user.name}. 🙏`));
    if (!ctx.amount || ctx.amount < 1000) return res.status(400).send(statusPage("Tagihan Belum Tersedia", "Nominal tagihan belum diatur. Silakan hubungi admin."));

    const { periodMonth, periodYear } = currentPeriod();
    const reff = Math.floor(Math.random() * 1677721631342).toString(16);
    const base = resolveBaseUrl(global.config || {});
    const gw = gateways.getActive();

    let charge;
    try {
        charge = await gw.chargeRedirect({
            amount: ctx.amount,
            reffId: reff,
            name: ctx.user.name || "Pelanggan",
            phone: customerPhoneDigits(ctx.user) || "628000000000",
            email: `${reff}@bill.rafnet.local`,
            comment: `Tagihan ${ctx.user.subscription} - ${ctx.user.name}`,
            returnUrl: `${base}/bayar-status`,
            cancelUrl: `${base}/bayar/${encodeURIComponent(req.params.token)}`,
            sandbox: ctx.sandbox,
        });
    } catch (_e) {
        return res.status(502).send(statusPage("Gangguan Pembayaran", "Maaf, gateway pembayaran sedang sibuk. Coba beberapa saat lagi atau hubungi admin."));
    }

    // Persist record (tag 'tagihan') + gateway. trxId = reference gateway (Tripay punya saat
    // creation → callback Tripay verify pakai ini; iPaymu hosted null → callback iPaymu pakai
    // payload trx_id). userId/periode dipakai callback untuk catat lunas + reaktivasi.
    addPayment(reff, charge.reference, customerJid(ctx.user), "tagihan", ctx.amount,
        gw.name === "tripay" ? "Tripay" : "iPaymu (hosted)", `Tagihan ${ctx.user.name}`,
        { userId: ctx.user.id, periodMonth, periodYear, sandbox: ctx.sandbox, gateway: gw.name, hosted: gw.name === "ipaymu", sessionId: charge.sessionId || null });

    return res.redirect(302, charge.url);
});

// Callback Tripay (POST). Format & signature beda dari iPaymu → endpoint terpisah.
// Keamanan = sama modelnya dgn callback iPaymu: VERIFIKASI server-to-server (checkTransaction)
// + cross-check merchant_ref & amount. Tak bergantung signature (gate utama = S2S verify),
// jadi tak perlu raw-body (yang butuh edit body-parser global). Balas {success:true} utk ACK.
router.post("/callback/tripay", async (req, res) => {
    try {
        const body = req.body || {};
        const merchantRef = body.merchant_ref;
        const reference = body.reference;
        const status = String(body.status || "").toUpperCase();
        if (!merchantRef) return res.json({ success: true });

        const pay = (global.payment || []).find((v) => v.reffId == merchantRef && v.gateway === "tripay");
        if (!pay) return res.json({ success: true }); // bukan record kita / sudah dihapus → ACK
        if (status !== "PAID") return res.json({ success: true }); // expired/failed → ACK, tak kredit
        if (checkStatusPayment(merchantRef) === true) return res.json({ success: true }); // idempotent

        // KEAMANAN: jangan percaya body mentah — verifikasi langsung ke Tripay.
        const verify = await tripay.checkTransaction(pay.trxId || reference, { sandbox: pay.sandbox === true });
        if (!verify || !verify.ok || !verify.paid) {
            console.warn("[TRIPAY_CALLBACK_REJECT] Tripay belum konfirmasi PAID — kredit ditolak.", { merchantRef, reference, status: verify?.status, error: verify?.error });
            return res.status(400).json({ success: false });
        }
        if (verify.referenceId != null && String(verify.referenceId) !== String(merchantRef)) {
            console.warn("[TRIPAY_CALLBACK_REJECT] merchant_ref Tripay tidak cocok.", { merchantRef, tripay_ref: verify.referenceId });
            return res.status(400).json({ success: false });
        }
        if (verify.amount != null && pay.amount != null && parseInt(verify.amount, 10) < parseInt(pay.amount, 10)) {
            console.warn("[TRIPAY_CALLBACK_REJECT] amount Tripay kurang dari tagihan.", { merchantRef, tripay_amount: verify.amount, expected: pay.amount });
            return res.status(400).json({ success: false });
        }

        const user = (global.users || []).find((u) => String(u.id) === String(pay.userId));
        if (!user) {
            console.error("[TRIPAY_CALLBACK] User tidak ditemukan — TIDAK ditandai paid", { merchantRef, userId: pay.userId });
            return res.status(400).json({ success: false });
        }

        let settleResult;
        try {
            settleResult = await billSettlement.settleTagihanPayment({
                user, amountPaid: pay.amount, periodMonth: pay.periodMonth, periodYear: pay.periodYear,
                paymentMethod: body.payment_method_code || "Tripay", reffId: merchantRef,
            });
        } catch (settleErr) {
            console.error("[TRIPAY_CALLBACK] Catat lunas GAGAL — TIDAK ditandai paid", { merchantRef, error: settleErr.message });
            return res.status(400).json({ success: false });
        }

        updateStatusPayment(merchantRef, true);
        const react = settleResult.reactivation || {};
        updateKetPayment(merchantRef, `Tagihan lunas (Tripay)${react.attempted ? (react.ok ? " + reaktivasi OK" : " + reaktivasi GAGAL") : ""}`);

        // Struk best-effort (kegagalan kirim TIDAK menggagalkan callback).
        try {
            const periode = (pay.periodMonth && pay.periodYear)
                ? new Date(pay.periodYear, pay.periodMonth - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" })
                : new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" });
            const struk = renderTemplate("tagihan_struk_lunas", {
                nama_pelanggan: user.name, nama_paket: user.subscription, harga: convertRupiah.convert(pay.amount),
                metode: body.payment_name || "Tripay", periode,
                waktu: new Date().toLocaleString("id-ID", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " WIB",
                no_ref: merchantRef, status_layanan: react.ok ? "⚡ Layanan Anda sudah aktif kembali." : "",
            });
            if (pay.sender) await sendMessage(pay.sender, { text: struk });
        } catch (notifyErr) {
            console.error("[TRIPAY_CALLBACK] Gagal kirim struk:", notifyErr.message);
        }

        return res.json({ success: true });
    } catch (err) {
        console.error("[TRIPAY_CALLBACK_ERROR]", err.message);
        return res.status(500).json({ success: false });
    }
});

// Landing returnUrl mode hosted — buyer kembali dari halaman iPaymu. Settlement & struk
// ditangani server-to-server di callback; halaman ini hanya info ringan.
router.get("/bayar-status", (req, res) => {
    res.send(statusPage("Pembayaran Diproses", "Terima kasih! Pembayaran Anda sedang kami proses. Struk & status aktivasi layanan akan dikirim via WhatsApp. Anda boleh menutup halaman ini."));
});

// Info tagihan + daftar channel aktif (dinamis dari iPaymu).
router.get("/api/bayar/:token/info", async (req, res) => {
    const ctx = resolveBillContext(req.params.token);
    if (!ctx.ok) return res.json({ ok: false, status: ctx.status, reason: ctx.reason });
    if (ctx.whitelist) return res.json({ ok: true, status: "free", nama: ctx.user.name });

    const paid = ctx.user.paid === true;
    let channels = null;
    let channelError = null;
    if (!paid) {
        try {
            channels = await ipaymu.getPaymentChannels({ sandbox: ctx.sandbox });
        } catch (e) {
            channelError = e.message;
        }
    }
    // Link "verifikasi ke admin" yang dilihat PELANGGAN = nomor bot/bisnis (config.adminPhone).
    const cfg = global.config || {};
    const adminWa = String(cfg.adminPhone || cfg.telfon || "").replace(/\D/g, "");
    res.json({
        ok: true,
        status: paid ? "paid" : "unpaid",
        provider: cfg.nama || "Pembayaran",
        adminWa,
        nama: ctx.user.name,
        paket: ctx.user.subscription,
        amount: ctx.amount,
        formattedAmount: convertRupiah.convert(ctx.amount),
        sandbox: ctx.sandbox,
        channels,
        channelError,
    });
});

// Buat charge untuk channel terpilih → balikkan data render (QR / VA / kode retail).
router.post("/api/bayar/:token/charge", chargeLimiter, async (req, res) => {
    const ctx = resolveBillContext(req.params.token);
    if (!ctx.ok) return res.status(400).json({ ok: false, status: ctx.status });
    if (ctx.whitelist) return res.status(400).json({ ok: false, status: "free" });
    if (ctx.user.paid === true) return res.status(409).json({ ok: false, status: "already_paid" });
    if (!ctx.amount || ctx.amount < 1000) return res.status(400).json({ ok: false, status: "invalid_amount" });

    const { method, channel } = req.body || {};
    if (!method || !channel) return res.status(400).json({ ok: false, status: "missing_channel" });

    const { periodMonth, periodYear } = currentPeriod();
    const reff = Math.floor(Math.random() * 1677721631342).toString(16);

    let result;
    try {
        result = await ipaymu.payDirect({
            amount: ctx.amount,
            comment: `Tagihan ${ctx.user.subscription} - ${ctx.user.name}`,
            reffId: reff,
            name: ctx.user.name || "Pelanggan",
            phone: customerPhoneDigits(ctx.user) || "628000000000",
            email: `${reff}@bill.rafnet.local`,
            paymentMethod: method,
            paymentChannel: channel,
            sandbox: ctx.sandbox,
        });
    } catch (e) {
        return res.status(502).json({ ok: false, status: "gateway_error", message: e.message });
    }

    // Label metode yang RAMAH untuk struk WA (hindari kode mentah seperti "MPM").
    const titleCase = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    const methodLabel = method === "qris" ? "QRIS"
        : method === "va" ? `Transfer VA ${result.channelLabel || channel}`.trim()
        : method === "cstore" ? titleCase(result.channelLabel || channel)
        : (result.channelLabel || channel);

    // Persist record (tag 'tagihan'). userId/periode dipakai callback untuk catat lunas + reaktivasi;
    // sandbox=true → callback verifikasi ke endpoint sandbox (uji, bukan produksi).
    addPayment(reff, result.id, customerJid(ctx.user), "tagihan", ctx.amount, methodLabel,
        `Tagihan ${ctx.user.name}`, { userId: ctx.user.id, periodMonth, periodYear, sandbox: ctx.sandbox });

    let qrImage = null;
    if (result.qrString) {
        try {
            qrImage = "data:image/png;base64," + qr.imageSync(result.qrString, { type: "png", ec_level: "H" }).toString("base64");
        } catch (_e) {
            qrImage = null;
        }
    }

    res.json({
        ok: true,
        reffId: reff,
        method,
        channel,
        via: result.via,
        channelLabel: result.channelLabel,
        qrImage,
        paymentNo: result.paymentNo,
        paymentName: result.paymentName,
        note: result.note,
        total: result.total,
        formattedTotal: convertRupiah.convert(result.total || ctx.amount),
        expired: result.expired,
    });
});

// Polling status pembayaran (reff dari hasil charge).
router.get("/api/bayar/:token/status", (req, res) => {
    const v = verifyBillPayToken(req.params.token);
    if (!v.ok) return res.status(400).json({ ok: false });
    const reff = req.query.reff;
    if (!reff) return res.json({ ok: true, paid: false });
    res.json({ ok: true, paid: checkStatusPayment(String(reff)) === true });
});

module.exports = router;
