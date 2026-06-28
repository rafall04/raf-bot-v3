/**
 * iPaymu Payment Gateway Client (v2)
 *
 * - pay(props): buat transaksi QRIS direct, return detail QR + trxId.
 * - checkTransaction(trxId): VERIFIKASI server-to-server status transaksi langsung
 *   ke iPaymu. WAJIB dipakai di callback sebelum kredit saldo/voucher — JANGAN
 *   percaya body callback mentah (bisa di-forge → free-money exploit).
 *
 * Signature iPaymu v2: HMAC-SHA256( "METHOD:VA:sha256(jsonBody):apikey", apikey ).
 */
const CryptoJs = require("crypto-js");

const SANDBOX_BASE = "https://sandbox.ipaymu.com/api/v2";
const PROD_BASE = "https://my.ipaymu.com/api/v2";

// Kredensial DEMO publik sandbox iPaymu (bukan rahasia) — dipakai hanya saat mode
// sandbox DAN owner belum mengisi config sendiri. Mode produksi WAJIB pakai config.
const SANDBOX_DEMO_VA = "1179000899";
const SANDBOX_DEMO_APIKEY = "QbGcoO0Qds9sQFDmY0MWg1Tq.xtuh1";

// Timeout per-attempt diperpendek + retry: sebagian koneksi BARU ke iPaymu kadang
// keluar lewat WAN yang salah dan SYN-nya di-blackhole (lihat catatan dual-WAN). Daripada
// menggantung 20s lalu gagal, lebih baik gagal cepat (12s) lalu coba lagi dengan koneksi
// fresh — percobaan kedua hampir selalu lewat path yang sehat (~300-500ms).
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_RETRIES = 1;

// Hanya error jaringan/timeout (belum ada respons) yang aman & berguna untuk di-retry.
// Respons HTTP non-2xx TIDAK throw di fetch (body tetap diparse), jadi tak masuk sini.
function isRetryableError(err) {
    if (!err) return false;
    if (err.name === "AbortError" || err.name === "TypeError") return true; // timeout / fetch failed
    const sig = `${err.code || ""} ${err.message || ""}`;
    return /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|socket|fetch failed/i.test(sig);
}

function getConfig() {
    return global.config || {};
}

/**
 * Resolusi kredensial + base URL sesuai mode. Sandbox boleh pakai config sendiri
 * (untuk uji dgn akun sandbox owner) atau fallback ke demo publik.
 */
function resolveCreds(forceSandbox = false) {
    const cfg = getConfig();
    // forceSandbox: paksa mode sandbox PER-PANGGILAN (mis. uji bayar tagihan) tanpa mengubah
    // `ipaymuProduction` global — pelanggan asli tetap produksi. Sandbox WAJIB pakai demo creds
    // (kredensial produksi merchant tidak valid di endpoint sandbox iPaymu).
    if (forceSandbox) {
        return { production: false, base: SANDBOX_BASE, va: SANDBOX_DEMO_VA, apikey: SANDBOX_DEMO_APIKEY };
    }
    const production = cfg.ipaymuProduction === true;
    const base = production ? PROD_BASE : SANDBOX_BASE;
    const va = production ? cfg.ipaymuVA : (cfg.ipaymuVA || SANDBOX_DEMO_VA);
    const apikey = production ? cfg.ipaymuSecret : (cfg.ipaymuSecret || SANDBOX_DEMO_APIKEY);
    return { production, base, va, apikey };
}

function buildSignature(method, body, va, apikey) {
    const bodyHash = CryptoJs.SHA256(JSON.stringify(body)).toString();
    const stringToSign = `${method.toUpperCase()}:${va}:${bodyHash}:${apikey}`;
    return CryptoJs.enc.Hex.stringify(CryptoJs.HmacSHA256(stringToSign, apikey));
}

/**
 * Request terotentikasi ke iPaymu dengan timeout. Return parsed JSON.
 * Throw Error (bukan string) untuk semua kegagalan.
 */
// Satu percobaan request: buka koneksi BARU (signal sendiri) supaya retry benar-benar
// memakai socket fresh, bukan reuse koneksi keep-alive basi yang mungkin sudah mati.
async function ipaymuAttempt(path, body, creds, timeoutMs, method = "POST") {
    const { va, apikey, base } = creds;
    const signature = buildSignature(method, body, va, apikey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const fetchOpts = {
            method,
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                va,
                signature,
                timestamp: Date.now().toString(),
            },
            signal: controller.signal,
        };
        // GET (mis. /payment-channels) tak boleh kirim body; signature tetap pakai body kosong {}.
        if (method !== "GET" && method !== "HEAD") {
            fetchOpts.body = JSON.stringify(body);
        }
        const response = await fetch(`${base}${path}`, fetchOpts);

        let json;
        try {
            json = await response.json();
        } catch (_parseErr) {
            throw new Error(`Respons iPaymu bukan JSON valid (HTTP ${response.status}).`);
        }
        return json;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Request terotentikasi ke iPaymu dengan timeout + retry pada kegagalan jaringan/timeout.
 * Return parsed JSON. Throw Error (bukan string) untuk semua kegagalan.
 *
 * Retry aman di sini: hanya error TANPA respons (timeout/koneksi gagal) yang di-retry —
 * untuk /payment/direct ini paling-paling membuat QR pending duplikat yang tak dibayar
 * dan kedaluwarsa sendiri (tidak ada uang berpindah). Respons HTTP/JSON apa pun langsung
 * dikembalikan tanpa retry.
 */
async function ipaymuRequest(path, body, options = {}) {
    const creds = resolveCreds(options.sandbox === true);
    if (!creds.va || !creds.apikey) {
        throw new Error("Kredensial iPaymu belum disetel (ipaymuVA / ipaymuSecret).");
    }
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    const retries = options.retries != null ? options.retries : DEFAULT_RETRIES;
    const method = options.method || "POST";

    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await ipaymuAttempt(path, body, creds, timeoutMs, method);
        } catch (err) {
            lastErr = (err && err.name === "AbortError")
                ? new Error(`Permintaan iPaymu timeout setelah ${timeoutMs}ms.`)
                : (err instanceof Error ? err : new Error(String(err)));
            if (attempt < retries && isRetryableError(err)) continue;
            break;
        }
    }
    throw lastErr;
}

/**
 * Buat transaksi pembayaran QRIS direct.
 * @returns {Promise<{id, reffId, subTotal, fee, feeTo, qrString, gateway, exp, total}>}
 */
async function pay(props) {
    const cfg = getConfig();
    let { amount, comment, reffId, name, phone, email } = props || {};
    amount = parseInt(amount, 10);

    // CATATAN: pay() sengaja throw STRING (bukan Error) — konvensi codebase ini
    // memakai `if (typeof err === "string") reply(err)` untuk menampilkan pesan ke
    // user (lihat message/raf.js + payment-flow). Throw Error = user tak dapat feedback.
    if (isNaN(amount) || !comment || !reffId || !name || !phone || !email) {
        throw "[ !! ] Required: amount, comment, reffId, name, phone, email";
    }
    if (!cfg.ipaymuCallback) {
        throw "Callback iPaymu belum di-set!";
    }
    if (cfg.ipaymuProduction === true && (!cfg.ipaymuSecret || !cfg.ipaymuVA)) {
        throw "[ !! ] Owner belum menyiapkan payment (ipaymuVA / ipaymuSecret).";
    }

    const body = {
        name,
        phone,
        email,
        amount,
        comments: comment,
        feeDirection: "BUYER",
        notifyUrl: cfg.ipaymuCallback,
        referenceId: reffId,
        paymentMethod: "qris",
        paymentChannel: "mpm",
    };

    let res;
    try {
        res = await ipaymuRequest("/payment/direct", body);
    } catch (err) {
        // Konversi Error HTTP/timeout → string supaya tetap tampil ke user.
        throw (err && err.message) ? err.message : "Gagal menghubungi iPaymu.";
    }
    if (!res || res.Success !== true) {
        throw res?.Message || "Transaksi iPaymu gagal dibuat.";
    }

    const data = res.Data || {};
    if (!data.QrString) {
        throw "iPaymu tidak mengembalikan QrString.";
    }

    return {
        id: data.TransactionId,
        reffId,
        subTotal: amount,
        fee: data.Fee,
        feeTo: data.FeeDirection,
        qrString: data.QrString,
        gateway: "ipaymu",
        exp: data.Expired,
        total: data.Total,
    };
}

/**
 * Daftar metode/channel pembayaran AKTIF untuk akun ini (GET /payment-channels).
 * Dipakai halaman bayar tagihan agar tombol metode dirender DINAMIS (jangan hardcode —
 * channel aktif beda per akun/waktu, mis. e-wallet bisa tak tersedia). TIDAK throw string;
 * throw Error supaya caller (API web) bisa balas JSON error.
 * @returns {Promise<Array<{method, name, channels: Array<{channel, name, fee, feeType, additionalFee}>}>>}
 */
async function getPaymentChannels(options = {}) {
    const res = await ipaymuRequest("/payment-channels", {}, { ...options, method: "GET", sandbox: options.sandbox === true });
    if (!res || res.Success !== true) {
        throw new Error(res?.Message || "Gagal mengambil daftar channel iPaymu.");
    }
    return (res.Data || [])
        .map((group) => ({
            method: group.Code,
            name: group.Name,
            channels: (group.Channels || [])
                .filter((c) => c.FeatureStatus === "active" && c.HealthStatus === "online")
                .map((c) => ({
                    channel: c.Code,
                    name: c.Name,
                    logo: c.Logo || null,
                    fee: c.TransactionFee?.ActualFee ?? null,
                    feeType: c.TransactionFee?.ActualFeeType ?? null,
                    additionalFee: c.TransactionFee?.AdditionalFee ?? 0,
                })),
        }))
        .filter((g) => g.channels.length > 0);
}

/**
 * Buat transaksi DIRECT untuk channel apa pun (qris/va/cstore/…). Generalisasi `pay()`
 * yang terkunci QRIS. Dipakai alur bayar tagihan (multi-channel). Throw Error (bukan string)
 * karena consumer-nya API web (balas JSON), bukan reply WA.
 *
 * Balikan ternormalisasi seragam lintas channel:
 *  - QRIS   → qrString berisi.
 *  - VA     → paymentNo = nomor VA, channelLabel = bank.
 *  - cstore → paymentNo = kode bayar, note = instruksi, storeFee terisi.
 *
 * @returns {Promise<{id, reffId, paymentMethod, paymentChannel, via, channelLabel, qrString, paymentNo, paymentName, note, subTotal, fee, storeFee, total, expired, gateway}>}
 */
async function payDirect(props) {
    const cfg = getConfig();
    let { amount, comment, reffId, name, phone, email, paymentMethod, paymentChannel, sandbox } = props || {};
    amount = parseInt(amount, 10);
    sandbox = sandbox === true;

    if (isNaN(amount) || !comment || !reffId || !name || !phone || !email || !paymentMethod || !paymentChannel) {
        throw new Error("payDirect: amount, comment, reffId, name, phone, email, paymentMethod, paymentChannel wajib diisi.");
    }
    if (!cfg.ipaymuCallback) {
        throw new Error("Callback iPaymu belum di-set.");
    }
    // Mode sandbox pakai demo creds — lewati cek kredensial produksi.
    if (!sandbox && cfg.ipaymuProduction === true && (!cfg.ipaymuSecret || !cfg.ipaymuVA)) {
        throw new Error("Kredensial iPaymu belum disetel (ipaymuVA / ipaymuSecret).");
    }

    const body = {
        name,
        phone,
        email,
        amount,
        comments: comment,
        feeDirection: "BUYER",
        notifyUrl: cfg.ipaymuCallback,
        referenceId: reffId,
        paymentMethod,
        paymentChannel,
    };

    const res = await ipaymuRequest("/payment/direct", body, { sandbox });
    if (!res || res.Success !== true) {
        throw new Error(res?.Message || "Transaksi iPaymu gagal dibuat.");
    }

    const d = res.Data || {};
    return {
        id: d.TransactionId,
        reffId,
        sandbox,
        paymentMethod,
        paymentChannel,
        via: d.Via || null,
        channelLabel: d.Channel || null,
        qrString: d.QrString || null,
        paymentNo: d.PaymentNo || null,
        paymentName: d.PaymentName || null,
        note: d.Note || null,
        subTotal: d.SubTotal != null ? d.SubTotal : amount,
        fee: d.Fee,
        storeFee: d.StoreFee || 0,
        total: d.Total,
        expired: d.Expired || null,
        gateway: "ipaymu",
    };
}

// Status iPaymu yang dianggap LUNAS. iPaymu /transaction Data.Status: 1 = berhasil.
// StatusDesc text bisa "Berhasil"/"Success"/"Settlement". Cek dua-duanya defensif.
const PAID_STATUS_CODES = new Set([1, "1"]);
const PAID_STATUS_DESC = /berhasil|success|settl|paid|completed/i;

/**
 * VERIFIKASI server-to-server: cek status transaksi langsung ke iPaymu.
 * Dipakai di callback sebelum kredit. TIDAK throw — return envelope supaya caller
 * bisa memutuskan. paid=true HANYA jika iPaymu sendiri yang konfirmasi lunas.
 *
 * @param {string|number} transactionId - TransactionId iPaymu (yang KITA simpan saat pay()).
 * @returns {Promise<{ok, paid, status, statusDesc, referenceId, amount, error?, raw?}>}
 */
async function checkTransaction(transactionId, options = {}) {
    if (transactionId === undefined || transactionId === null || transactionId === "") {
        return { ok: false, paid: false, error: "transactionId kosong" };
    }
    try {
        const json = await ipaymuRequest("/transaction", { transactionId: String(transactionId) }, options);
        if (!json || json.Success !== true) {
            return { ok: false, paid: false, error: json?.Message || "Gagal cek transaksi iPaymu", raw: json };
        }
        const d = json.Data || {};
        const desc = String(d.StatusDesc || "");
        const paid = PAID_STATUS_CODES.has(d.Status) || PAID_STATUS_DESC.test(desc);
        return {
            ok: true,
            paid,
            status: d.Status,
            statusDesc: d.StatusDesc,
            referenceId: d.ReferenceId != null ? String(d.ReferenceId) : null,
            amount: d.Amount != null ? parseInt(d.Amount, 10) : null,
            raw: d,
        };
    } catch (err) {
        return { ok: false, paid: false, error: err.message };
    }
}

// Default export tetap fungsi `pay` (backward-compat: caller lama `require('../lib/ipaymu')(...)`).
// checkTransaction dilampirkan sebagai properti supaya bisa diakses tanpa breaking.
module.exports = pay;
module.exports.pay = pay;
module.exports.payDirect = payDirect;
module.exports.getPaymentChannels = getPaymentChannels;
module.exports.checkTransaction = checkTransaction;
module.exports._buildSignature = buildSignature;
module.exports._resolveCreds = resolveCreds;
