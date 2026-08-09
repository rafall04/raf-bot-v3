/**
 * Header Doc
 * Purpose: Helper baca-saja seputar tiket/laporan pelanggan. `hasActiveReport` dipakai sebagai
 *   GERBANG anti tiket-gangguan-ganda di alur `lapor`; ia sengaja MENGABAIKAN tiket keluhan/saran
 *   (`source: 'keluhan'` / `issueType: 'KELUHAN'`) karena keluhan bukan laporan gangguan dan tak
 *   boleh menutup pintu lapor pelanggan.
 * Caller: `message/handlers/smart-report-text-menu.js` (startReportFlow) dan pemakai lain.
 * Deps: tidak ada — murni fungsi atas array `global.reports` yang dioper pemanggil.
 * MainFuncs: `hasActiveReport`, `getActiveReport`, `isActiveStatus`.
 * SideEffects: Tidak ada (read-only).
 */

/**
 * Report Helper Functions
 * Utility functions untuk operasi report/ticket
 */

/**
 * Check if user has active report
 * @param {string} userId - User ID
 * @param {Array} reports - Array of reports
 * @returns {Object|null} - Active report or null
 */
function hasActiveReport(userId, reports) {
    if (!reports || !Array.isArray(reports)) {
        return null;
    }
    
    return reports.find(r => {
        // Check if report belongs to user
        const isUserReport = r.pelangganUserId === userId || 
                            r.pelangganId === userId ||
                            (r.pelangganDataSystem && r.pelangganDataSystem.id === userId);
        
        if (!isUserReport) {
            return false;
        }

        // Tiket KELUHAN/SARAN bukan laporan GANGGUAN — ia tak boleh menutup pintu lapor.
        //
        // Gerbang ini dipakai `startReportFlow` untuk mencegah tiket gangguan GANDA. Sejak keluhan
        // bebas ikut menjadi tiket nyata, sebuah keluhan soal tagihan bisa membuat pelanggan yang
        // besoknya internetnya benar-benar mati dijawab "Laporan aktif ditemukan, harap tunggu
        // penyelesaian tiket ini" — gangguan nyatanya tak pernah sampai ke teknisi. Lebih buruk:
        // pesannya menyuruh MENUNGGU, bukan membatalkan, dan begitu teknisi menekan `proses`
        // pembatalan mandiri pelanggan ikut tertutup.
        if (r.source === 'keluhan' || r.issueType === 'KELUHAN') {
            return false;
        }

        // Check if report is still active (not completed/cancelled)
        const inactiveStatuses = [
            'selesai',
            'completed',
            'cancelled',
            'dibatalkan',
            'resolved'
        ];
        
        return !inactiveStatuses.includes(r.status);
    });
}

/**
 * Get active report for user
 * @param {string} userId - User ID
 * @param {Array} reports - Array of reports
 * @returns {Object|null} - Active report or null
 */
function getActiveReport(userId, reports) {
    return hasActiveReport(userId, reports);
}

/**
 * Check if report status is active
 * @param {string} status - Report status
 * @returns {boolean} - True if status is active
 */
function isActiveStatus(status) {
    const inactiveStatuses = [
        'selesai',
        'completed',
        'cancelled',
        'dibatalkan',
        'resolved'
    ];
    
    return !inactiveStatuses.includes(status);
}

module.exports = {
    hasActiveReport,
    getActiveReport,
    isActiveStatus
};

