/**
 * Header Doc
 * Purpose: Resolusi path terpusat (lintas-platform) untuk direktori upload, plus penjaga
 *          traversal agar segmen path yang berasal dari input pengguna tak bisa keluar dari
 *          direktori upload.
 * Caller: `routes/tickets-shared.js`, `routes/tickets-photo-routes.js`, dan modul lain yang
 *         menyimpan lampiran tiket/laporan.
 * Deps: `path` (Node core).
 * MainFuncs: `getProjectRoot`, `getUploadsPath`, `getReportsUploadsPath`,
 *            `getTicketsUploadsPathByTicket`, `isSegmenPathAman`, `assertDiDalamDirektori`.
 * SideEffects: Tidak ada I/O — murni menghitung string path. Melempar bila segmen tak valid.
 * INVARIAN: Setiap segmen path yang datang dari request (ID tiket, dsb.) WAJIB lewat
 *           `isSegmenPathAman`. `path.join` MERESOLVE `..`, jadi nilai mentah dari query/header
 *           bisa menulis berkas ke mana saja di disk.
 */
const path = require('path');

/**
 * Segmen path yang aman dipakai sebagai NAMA FOLDER: huruf/angka/`-`/`_` saja.
 * Sengaja MENOLAK, bukan membersihkan diam-diam — nilai yang tak lolos berarti pemanggilnya
 * salah, dan membersihkannya cuma menyembunyikan kesalahan itu.
 *
 * ID tiket yang dihasilkan sistem (`lib/ticket-id.js`) adalah 7 karakter alfanumerik, jadi
 * pola ini longgar terhadap seluruh data nyata.
 */
const POLA_SEGMEN_PATH_AMAN = /^[A-Za-z0-9_-]{1,64}$/;

function isSegmenPathAman(nilai) {
    return POLA_SEGMEN_PATH_AMAN.test(String(nilai == null ? '' : nilai));
}

/**
 * Sabuk pengaman: pastikan `target` benar-benar berada DI DALAM `baseDir` setelah di-resolve.
 * Ini lapis kedua — lapis pertama adalah validasi segmen di atas. Dipakai supaya penambahan
 * pemanggil baru di kemudian hari tak bisa menembus direktori upload tanpa ketahuan.
 */
function assertDiDalamDirektori(baseDir, target) {
    const base = path.resolve(baseDir);
    const resolved = path.resolve(target);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
        throw new Error(`Path upload keluar dari direktori yang diizinkan: ${resolved}`);
    }
    return resolved;
}

/**
 * Bangun path upload ber-segmen tiket, dengan validasi + sabuk pengaman.
 * Melempar bila `ticketId` tak lolos pola — pemanggil WAJIB menangkapnya dan menolak request,
 * bukan melanjutkan ke lokasi tebakan.
 */
function buildTicketScopedUploadPath(namespace, year, month, ticketId, currentDir) {
    if (!isSegmenPathAman(ticketId)) {
        throw new Error(`ID tiket tidak valid untuk dipakai sebagai nama folder: ${String(ticketId)}`);
    }

    const projectRoot = getProjectRoot(currentDir);
    const baseDir = path.join(projectRoot, 'uploads', namespace);
    // `year`/`month` berasal dari objek Date di pemanggil, tapi tetap dinormalisasi:
    // `new Date('sampah')` menghasilkan NaN yang lolos begitu saja jadi nama folder "NaN".
    const tahun = String(year).replace(/[^0-9]/g, '') || 'tanpa-tahun';
    const bulan = String(month).replace(/[^0-9]/g, '') || 'tanpa-bulan';

    return assertDiDalamDirektori(baseDir, path.join(baseDir, tahun, bulan, String(ticketId)));
}

/**
 * Get project root directory
 * @param {string} currentDir - Current __dirname
 * @returns {string} Project root path
 */
function getProjectRoot(currentDir = __dirname) {
    // From lib/ folder: naik 1 level ke project root
    // From message/ folder: naik 1 level ke project root
    return path.resolve(currentDir, '..');
}

/**
 * Get uploads directory path
 * @param {string} subFolder - Subfolder name (teknisi, reports, etc)
 * @param {string} currentDir - Current __dirname
 * @returns {string} Full uploads path
 */
function getUploadsPath(subFolder, currentDir = __dirname) {
    const projectRoot = getProjectRoot(currentDir);
    return path.join(projectRoot, 'uploads', subFolder);
}

/**
 * Get teknisi uploads directory
 * @param {string} currentDir - Current __dirname
 * @returns {string} Teknisi uploads path
 */
function getTeknisiUploadsPath(currentDir = __dirname) {
    return getUploadsPath('teknisi', currentDir);
}

/**
 * Get reports uploads directory
 * @param {number} year - Year
 * @param {string} month - Month (padded)
 * @param {string} ticketId - Ticket ID
 * @param {string} currentDir - Current __dirname
 * @returns {string} Reports uploads path
 */
function getReportsUploadsPath(year, month, ticketId, currentDir = __dirname) {
    return buildTicketScopedUploadPath('reports', year, month, ticketId, currentDir);
}

/**
 * Get general uploads directory (for simple photo uploads)
 * @param {string} currentDir - Current __dirname
 * @returns {string} General uploads path
 */
function getGeneralUploadsPath(currentDir = __dirname) {
    const projectRoot = getProjectRoot(currentDir);
    return path.join(projectRoot, 'uploads');
}

/**
 * Get teknisi uploads directory with structured path (YEAR/MONTH/TICKET_ID)
 * Consistent with reports uploads structure
 * @param {number} year - Year
 * @param {string} month - Month (padded, e.g., "11")
 * @param {string} ticketId - Ticket ID
 * @param {string} currentDir - Current __dirname
 * @returns {string} Teknisi uploads path with structure: uploads/teknisi/YEAR/MONTH/TICKET_ID
 */
function getTeknisiUploadsPathByTicket(year, month, ticketId, currentDir = __dirname) {
    return buildTicketScopedUploadPath('teknisi', year, month, ticketId, currentDir);
}

/**
 * Get tickets uploads directory with structured path (YEAR/MONTH/TICKET_ID)
 * Consistent with reports uploads structure
 * @param {number} year - Year
 * @param {string} month - Month (padded, e.g., "11")
 * @param {string} ticketId - Ticket ID
 * @param {string} currentDir - Current __dirname
 * @returns {string} Tickets uploads path with structure: uploads/tickets/YEAR/MONTH/TICKET_ID
 */
function getTicketsUploadsPathByTicket(year, month, ticketId, currentDir = __dirname) {
    return buildTicketScopedUploadPath('tickets', year, month, ticketId, currentDir);
}

module.exports = {
    getProjectRoot,
    getUploadsPath,
    getTeknisiUploadsPath,
    getReportsUploadsPath,
    getGeneralUploadsPath,
    getTeknisiUploadsPathByTicket,
    getTicketsUploadsPathByTicket,
    isSegmenPathAman,
    assertDiDalamDirektori
};
