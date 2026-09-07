/**
 * Header Doc
 * Purpose: Store transaksi pembayaran gateway (`database/payment.json`, array global `payment`) —
 *          tambah/ubah status/cari, plus pencarian transaksi PENDING yang masih bisa dipakai ulang.
 * Caller: `routes/bill-payment.js`, `routes/public.js`, `routes/public-anonymous.js`.
 * Deps: `fs`, array global `payment` (di-bootstrap `lib/database.js`).
 * MainFuncs: addPayment, updateStatusPayment, updateKetPayment, checkStatusPayment,
 *          delPayment, checkIsPayOut, findPendingPayment.
 * SideEffects: Menulis `database/payment.json` (ATOMIK via lib/json-store.saveJSON).
 */
// #b345: SEMUA tulis payment.json lewat saveJSON (atomik tmp+rename + karantina, path via
// database/). payment.json = store idempotensi gateway: checkStatusPayment(status:true) adalah
// satu-satunya rem yang mencegah callback iPaymu/Tripay/Mayar/topup di-retry mengkredit saldo/
// voucher DUA KALI. writeFileSync polos ke berkas tujuan berisiko torn-write saat SIGKILL (prod
// restart 7-13x/hari) → berkas terpotong → loadJSON karantina → global.payment=[] → SEMUA
// penanda paid hilang → retry re-kredit (uang nyata) + pemasukan hantu. Path './database/...'
// lama juga cwd-relatif (di NODE_ENV=test menyentuh payment.json PROD); saveJSON resolve via __dirname.
const { saveJSON } = require('./json-store')


const addPayment = (reffId, trxId, sender, tag, amount, method, ket, opts = {}) => {
	const obj = {reffId, trxId, status: false, tag, sender, amount, method, ket, createdAt: Date.now(), ...opts}
    payment.push(obj)
    saveJSON('payment.json', payment)
}

/**
 * Mencari transaksi PENDING yang masih layak dipakai ulang untuk user+periode yang sama.
 *
 * KENAPA ADA — tiap permintaan halaman bayar dulu membuat `reffId` acak BARU tanpa melihat
 * apakah pelanggan itu sudah punya QRIS/VA hidup untuk periode yang sama. N kali tap = N
 * transaksi gateway yang SEMUANYA bisa dibayar. Kalau dua di antaranya terbayar, uang kedua
 * masuk ke rekening gateway tetapi `applyPaymentStatusChange` memulangkan
 * `already_fully_paid` tanpa menulis satu baris pun ke ledger — uang diterima, nol jejak.
 *
 * Dengan memakai ULANG transaksi yang masih hidup, pelanggan selalu melihat SATU tagihan
 * hidup per periode, sehingga kelas cacat itu tak punya bahan bakar.
 *
 * `maxAgeMs` wajib lebih pendek dari masa berlaku transaksi di sisi gateway — memulangkan
 * QRIS yang sudah kedaluwarsa di gateway lebih buruk daripada menerbitkan yang baru.
 */
const findPendingPayment = ({ tag, userId, periodMonth, periodYear, maxAgeMs }) => {
    const daftar = Array.isArray(payment) ? payment : []
    const batas = Number.isFinite(maxAgeMs) ? Date.now() - maxAgeMs : null
    const cocok = daftar.filter((p) => {
        if (!p || p.tag !== tag) return false
        if (p.status === true || p.status === 1 || p.status === 'true') return false
        if (String(p.userId) !== String(userId)) return false
        if (Number(p.periodMonth) !== Number(periodMonth)) return false
        if (Number(p.periodYear) !== Number(periodYear)) return false
        if (batas !== null && Number(p.createdAt || 0) < batas) return false
        return true
    })
    if (!cocok.length) return null
    // Yang TERBARU — bila entah bagaimana ada beberapa, itulah yang paling mungkin
    // masih hidup di sisi gateway.
    return cocok.reduce((a, b) => (Number(b.createdAt || 0) > Number(a.createdAt || 0) ? b : a))
}

const updateStatusPayment = (reffId, status) => {
    let position = false
    Object.keys(payment).forEach((i) => {
        if (payment[i].reffId === reffId) {
            position = i
        }
    })
    if (position !== false) {
        payment[position].status = status
        saveJSON('payment.json', payment)
    }
}

const updateKetPayment = (reffId, ket) => {
    let position = false
    Object.keys(payment).forEach((i) => {
        if (payment[i].reffId === reffId) {
            position = i
        }
    })
    if (position !== false) {
        payment[position].ket = ket
        saveJSON('payment.json', payment)
    }
}

const checkStatusPayment = (reffId) => {
    let position = false
    Object.keys(payment).forEach((i) => {
        if (payment[i].reffId === reffId) {
            position = i
        }
    })
    if (position !== false) {
        return payment[position].status
    }
}

const delPayment = (reffId) => {
    let position = null
    Object.keys(payment).forEach((i) => {
        if (payment[i].reffId === reffId) {
            position = i
        }
    })
    if (position !== null) {
        payment.splice(position, 1)
        saveJSON('payment.json', payment)
    }
    return true
}

const checkIsPayOut = (reffId) => {
    let status = false
    Object.keys(payment).forEach((i) => {
        if (payment[i].id === reffId) {
            status = true
        }
    })
    return status
}


module.exports = {
	addPayment,
    updateStatusPayment,
    updateKetPayment,
    checkIsPayOut,
    checkStatusPayment,
    delPayment,
    findPendingPayment
}