/**
 * Header Doc
 * Purpose: SATU-SATUNYA tempat keputusan "foto/dokumen masuk dari pelanggan ini — bukti bayar atau
 *   bukan?". Fungsi MURNI (tanpa I/O, tanpa jam) supaya bisa diuji ulang terhadap korpus prod nyata.
 *   Menggantikan sebaran `if` di `message/raf.js` yang dulu memutuskan dari KETIADAAN bukti-lawan
 *   ("tak ada state aktif", "tak ada jejak admin di RAM") — sinyal fana yang hilang tiap restart,
 *   sehingga gerbangnya diam-diam merosot jadi "tangkap semua foto".
 *
 *   Insiden 14-07 (Lapak RT 15): bot restart 22:02:02, foto koordinasi CCTV masuk 22:02:20 → Map
 *   jejak admin masih kosong → foto ditangkap sebagai "bukti bayar", padahal snapshot tagihan saat
 *   itu sudah berkata `outstanding: 0` dan angka itu tidak pernah dipakai sebagai gerbang.
 *
 *   Aturan sekarang, urut dari yang paling menentukan:
 *     1. Klaim "bukti bayar" hanya sah di atas BUKTI DURABEL — ada yang bisa dilunasi (tagihan/isolir).
 *     2. Sinyal-lawan (admin sedang menangani, caption/konteks keluhan) MENAHAN klaim itu.
 *     3. Kalau bot BUTA (sinyal belum siap / tagihan gagal dibaca) → JANGAN mengklaim apa pun.
 *        "Tidak bisa mengamati" ≠ "aman untuk mengklaim" (lihat CLAUDE.md).
 *
 *   Asimetri yang disengaja: SALAH-TANGKAP jauh lebih mahal daripada TIDAK-TANGKAP. Salah-tangkap
 *   mengirim bingkai "pembayaran" ke pelanggan yang tak pernah mengaku bayar DAN menaruh entri yang
 *   bisa di-"terima" ke antrian admin (tagihan lunas tanpa uang masuk). Tidak-tangkap hanya berarti
 *   fotonya tak masuk antrian — admin tetap melihat foto itu di chat WhatsApp seperti biasa.
 * Caller: `services/payment-proof.service.js` (evaluateIntake).
 * Deps: — (murni, tanpa I/O).
 * MainFuncs: `classifyIncomingPhoto`, `hasPaymentSignal`, `hasComplaintSignal`.
 * SideEffects: Tidak ada.
 */
"use strict";

/** Aksi yang mungkin dikembalikan classifier. */
const ACTION = {
    /** Admin sedang menangani chat ini → bot TIDAK bersuara sama sekali (jangan menyela). */
    SILENT: "silent",
    /** Foto keluhan → balas arahan lapor/tiket, JANGAN sebut pembayaran, JANGAN bikin record. */
    COMPLAINT: "complaint",
    /** Tak ada dasar mengklaim apa pun → ack netral tanpa bingkai bayar, tanpa record. */
    NEUTRAL: "neutral",
    /** Kandidat bukti bayar sah → simpan + notif admin. */
    CAPTURE: "capture"
};

// Kosakata dipilih SEMPIT & presisi. Ingat pelajaran korpus prod (CLAUDE.md): dialek lokal bukan
// bahasa Indonesia baku, dan daftar cocok-persis menolak mayoritas ucapan nyata. Di sini kita hanya
// butuh sinyal KASAR (ada/tidak), bukan parsing niat — jadi cocokkan per-kata dengan batas kata.
const PAYMENT_WORDS = [
    "bayar", "byr", "dibayar", "pembayaran", "transfer", "tf", "trf", "lunas", "pelunasan",
    "bukti", "struk", "resi", "setor", "sudah kirim", "udah kirim", "nransfer", "mtransfer",
    "brimo", "livin", "seabank", "dana", "gopay", "ovo", "shopeepay", "qris", "mbanking", "m-banking"
];

const COMPLAINT_WORDS = [
    "lemot", "lelet", "lambat", "lambet", "putus", "pedot", "gangguan", "ganggu", "error", "eror",
    "mati", "matek", "offline", "off", "merah", "los", "buffering", "nyendat", "ngelag", "lag",
    "cctv", "kabel", "modem", "odp", "colokan", "sinyal", "konek", "nyambung", "internet mati",
    "wifi mati", "gak bisa", "ga bisa", "gk bisa", "tidak bisa", "nggak bisa", "ndak bisa"
];

/** Normalisasi ringan: huruf kecil + tanda baca jadi spasi (biar batas kata rapi). */
function normalizeText(text) {
    if (typeof text !== "string" || !text) return "";
    return ` ${text.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

/**
 * Cocokkan salah satu frasa dalam daftar sebagai KATA UTUH (bukan substring) — supaya "tf" tidak
 * cocok di dalam "otf" dan "off" tidak cocok di dalam "office".
 */
function matchesAny(normalized, phrases) {
    if (!normalized) return false;
    return phrases.some((phrase) => normalized.includes(` ${phrase} `));
}

function hasPaymentSignal(text) {
    return matchesAny(normalizeText(text), PAYMENT_WORDS);
}

function hasComplaintSignal(text) {
    return matchesAny(normalizeText(text), COMPLAINT_WORDS);
}

/**
 * @param {object} input
 * @param {boolean} [input.adminActive]   - admin baru membalas manual di chat ini (jejak DURABEL).
 * @param {boolean} [input.signalReady]   - jejak chat sudah dipulihkan dari disk? false = bot BUTA.
 * @param {{outstanding: (number|null|undefined)}} [input.billing] - snapshot tagihan periode berjalan.
 *        `outstanding` null/undefined = GAGAL dibaca (bukan berarti nol).
 * @param {string} [input.userStatus]     - status pelanggan (`isolir` = pasti punya tunggakan).
 * @param {string} [input.caption]        - caption foto/dokumen (sering kosong — itu normal).
 * @param {boolean} [input.recentComplaint] - pelanggan baru mengeluh koneksi (jejak DURABEL).
 * @returns {{action: string, reason: string, advance: boolean}}
 */
function classifyIncomingPhoto({
    adminActive = false,
    signalReady = true,
    billing = {},
    userStatus = "",
    caption = "",
    recentComplaint = false
} = {}) {
    // 1. Admin sedang mengetik manual di chat ini → apa pun fotonya, itu bagian percakapan MEREKA.
    //    Inilah kelas insiden "SS sinyal WiFi" (13-07) & "posisi CCTV" (14-07).
    if (adminActive) {
        return { action: ACTION.SILENT, reason: "admin-aktif", advance: false };
    }

    // 2. Jejak chat belum pulih dari disk (jendela boot). Kita tidak tahu apakah admin sedang
    //    menangani chat ini — dan TIDAK TAHU bukan berarti TIDAK ADA. Fail-closed: jangan mengklaim.
    if (!signalReady) {
        return { action: ACTION.NEUTRAL, reason: "sinyal-belum-siap", advance: false };
    }

    const paymentHint = hasPaymentSignal(caption);
    const complaintHint = hasComplaintSignal(caption);
    const outstanding = billing ? billing.outstanding : null;
    const isolir = String(userStatus || "").trim().toLowerCase() === "isolir";

    // 3. Snapshot tagihan GAGAL dibaca → status ketiga. Nol dan "tak terbaca" bukan hal yang sama.
    if (outstanding === null || outstanding === undefined || !Number.isFinite(Number(outstanding))) {
        return { action: ACTION.NEUTRAL, reason: "tagihan-tak-diketahui", advance: false };
    }

    // Pelanggan isolir PASTI punya sesuatu untuk dibayar, walau ledger periode berjalan bisa saja
    // sudah 0 (mis. diputus karena tunggakan periode lain).
    const hasDue = Number(outstanding) > 0 || isolir;

    // 4. Caption mengeluh → foto ini bukti KENDALA. DUA pengecualian:
    //    (a) pelanggan juga menyebut bayar DAN punya tagihan ("sdh tf tapi masih lemot") → dia sedang
    //        mengklaim bayar, biarkan admin menilai; bingkai "pembayaran" tak menyesatkan (dia sendiri
    //        yang menyebutnya).
    //    (b) pelanggan ISOLIR: "internet mati" ITU akibat menunggak — alasannya sama persis dgn step 5,
    //        foto susulan sangat mungkin bukti transfer, JANGAN ditelan jadi keluhan (#b152).
    if (complaintHint && !isolir && !(paymentHint && hasDue)) {
        return { action: ACTION.COMPLAINT, reason: "caption-keluhan", advance: false };
    }

    // 5. Pelanggan baru mengeluh koneksi (jejak durabel) → foto susulan = bukti kendala.
    //    PENGECUALIAN ISOLIR: buat pelanggan terisolir, "internet mati" ITU akibat nunggak — foto
    //    susulan justru sangat mungkin bukti transfer. Jangan tahan.
    if (recentComplaint && !isolir && !paymentHint) {
        return { action: ACTION.COMPLAINT, reason: "keluhan-baru", advance: false };
    }

    // 6. GERBANG UANG. Tidak ada yang bisa dilunasi → tidak ada dasar menyebut "pembayaran".
    if (!hasDue) {
        if (paymentHint) {
            // Satu-satunya alasan sah: bayar di muka — dan itu harus DIKATAKAN, bukan diterka.
            return { action: ACTION.CAPTURE, reason: "lunas-tapi-caption-bayar", advance: true };
        }
        return { action: ACTION.NEUTRAL, reason: "tak-ada-tagihan", advance: false };
    }

    // 7. Ada tagihan terbuka + nihil sinyal-lawan → jalur bahagia, tetap satu langkah tanpa friksi.
    return {
        action: ACTION.CAPTURE,
        reason: paymentHint ? "ada-tagihan+caption-bayar" : "ada-tagihan",
        advance: false
    };
}

module.exports = {
    ACTION,
    PAYMENT_WORDS,
    COMPLAINT_WORDS,
    classifyIncomingPhoto,
    hasPaymentSignal,
    hasComplaintSignal
};
