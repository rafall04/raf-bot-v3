/**
 * Header Doc
 * Purpose: Halaman bayar tagihan bulanan publik (tanpa login, via token bertanda-tangan) +
 *   API-nya: info tagihan & channel aktif, buat charge iPaymu multi-channel, polling status.
 *   Halaman = static/bill-payment.html (JS ambil token dari URL).
 * Caller: routes-registry (mount di "/").
 * Deps: lib/bill-pay-token (verify), lib/ipaymu (getPaymentChannels, payDirect),
 *   lib/payment (addPayment, checkStatusPayment), qr-image, rupiah-format.
 * MainFuncs: GET /bayar/:token, GET /api/bayar/:token/info, POST /api/bayar/:token/charge,
 *   GET /api/bayar/:token/status.
 * SideEffects: Membuat transaksi iPaymu + menulis record payment.json (tag 'tagihan').
 */
"use strict";

const express = require("express");
const path = require("path");
const qr = require("qr-image");
const convertRupiah = require("rupiah-format");
const rateLimit = require("express-rate-limit");

const { verifyBillPayToken } = require("../lib/bill-pay-token");
const ipaymu = require("../lib/ipaymu");
const { addPayment, checkStatusPayment } = require("../lib/payment");

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

// Halaman bayar — HTML statis; JS-nya membaca token dari path /bayar/:token.
router.get("/bayar/:token", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "static", "bill-payment.html"));
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
    // Pilih nomor admin VALID untuk link verifikasi (lewati placeholder seperti 62xxxxxxxxxx).
    const cfg = global.config || {};
    const adminCandidates = [...(Array.isArray(cfg.ownerNumber) ? cfg.ownerNumber : [cfg.ownerNumber]), cfg.telfon, cfg.nomor_admin];
    let adminWa = "";
    for (const cand of adminCandidates) {
        const digits = String(cand || "").replace(/\D/g, "");
        if (digits.length >= 10) { adminWa = digits; break; }
    }
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
