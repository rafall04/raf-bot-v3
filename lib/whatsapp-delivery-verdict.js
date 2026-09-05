/**
 * Header Doc
 * Purpose: SATU sumber kebenaran "apakah hasil kirim WA benar-benar terkirim?". Wrapper notifikasi
 *   (lib/whatsapp-notification-wrapper) SENGAJA tak melempar pada error koneksi/USync maupun saat
 *   memblokir duplikat — ia memulangkan OBJEK penanda ({status:'error'} / {status:'blocked_duplicate'})
 *   supaya notifikasi biasa tak menjatuhkan alur pemanggil. Akibatnya jalur yang menganggap "resolve
 *   tanpa throw = sukses" melaporkan pesan TERKIRIM padahal tak pernah keluar (kode voucher/konfirmasi
 *   saldo hilang senyap). Helper ini memusatkan pengenalan penanda gagal itu agar SEMUA pemanggil
 *   (sendCritical, retry dead-letter, whatsapp-delivery-service) sepakat memakai satu pola.
 * Caller: lib/whatsapp-critical-delivery.js, lib/whatsapp-delivery-service.js.
 * Deps: - (murni, tanpa I/O).
 * MainFuncs: deliveryFailureReason, isDeliverySuccessful.
 * SideEffects: -
 */
'use strict';

// Bentuk penanda GAGAL dari wrapper. Hasil kirim asli Baileys TIDAK memakai string ini (field
// `status` Baileys berupa angka enum), jadi perbandingan STRICT string aman dari false-positive.
//   - 'error'             : error koneksi/USync ditelan wrapper → pesan TAK pernah keluar.
//   - 'blocked_duplicate' : wrapper memblokir karena pesan identik baru saja terkirim (dedup).
const FAILURE_STATUSES = ['error', 'blocked_duplicate'];

/**
 * @param {*} res hasil dari gateway.sendPayload / socket.sendMessage terbungkus.
 * @returns {string|null} 'error' | 'blocked_duplicate' bila penanda gagal; null bila terkirim.
 *   null/undefined diperlakukan terkirim agar sepadan dengan perilaku sendCritical yang sudah terbukti.
 */
function deliveryFailureReason(res) {
    if (res && typeof res === 'object' && FAILURE_STATUSES.includes(res.status)) {
        return String(res.status);
    }
    return null;
}

/**
 * Verdict KETAT: sukses HANYA bila bukan 'error' DAN bukan 'blocked_duplicate'. Dipakai jalur kritis
 * (sendCritical/retry) yang memakai skipDuplicateCheck — di sana blocked_duplicate anomali → gagal.
 * Jalur umum yang mengizinkan dedup memakai `deliveryFailureReason(res) === 'error'` sendiri, karena
 * blocked_duplicate di sana berarti pesan identik SUDAH terkirim (penerima tetap menerimanya).
 * @returns {boolean}
 */
function isDeliverySuccessful(res) {
    return deliveryFailureReason(res) === null;
}

module.exports = { deliveryFailureReason, isDeliverySuccessful, FAILURE_STATUSES };
