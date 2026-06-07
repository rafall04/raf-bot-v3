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

const DEFAULT_TIMEOUT_MS = 20000;

function getConfig() {
    return global.config || {};
}

/**
 * Resolusi kredensial + base URL sesuai mode. Sandbox boleh pakai config sendiri
 * (untuk uji dgn akun sandbox owner) atau fallback ke demo publik.
 */
function resolveCreds() {
    const cfg = getConfig();
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
async function ipaymuRequest(path, body, options = {}) {
    const { va, apikey, base } = resolveCreds();
    if (!va || !apikey) {
        throw new Error("Kredensial iPaymu belum disetel (ipaymuVA / ipaymuSecret).");
    }

    const signature = buildSignature("POST", body, va, apikey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);

    try {
        const response = await fetch(`${base}${path}`, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                va,
                signature,
                timestamp: Date.now().toString(),
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        let json;
        try {
            json = await response.json();
        } catch (_parseErr) {
            throw new Error(`Respons iPaymu bukan JSON valid (HTTP ${response.status}).`);
        }
        return json;
    } catch (err) {
        if (err.name === "AbortError") {
            throw new Error(`Permintaan iPaymu timeout setelah ${options.timeoutMs || DEFAULT_TIMEOUT_MS}ms.`);
        }
        throw err instanceof Error ? err : new Error(String(err));
    } finally {
        clearTimeout(timer);
    }
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
module.exports.checkTransaction = checkTransaction;
module.exports._buildSignature = buildSignature;
module.exports._resolveCreds = resolveCreds;
