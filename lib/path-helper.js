const path = require('path');

/**
 * Path Helper Functions for RAF Bot v2
 * Provides centralized path resolution for cross-platform compatibility
 */

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
    const projectRoot = getProjectRoot(currentDir);
    return path.join(projectRoot, 'uploads', 'reports', String(year), month, ticketId);
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
    const projectRoot = getProjectRoot(currentDir);
    return path.join(projectRoot, 'uploads', 'teknisi', String(year), month, ticketId);
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
    const projectRoot = getProjectRoot(currentDir);
    return path.join(projectRoot, 'uploads', 'tickets', String(year), month, ticketId);
}

module.exports = {
    getProjectRoot,
    getUploadsPath,
    getTeknisiUploadsPath,
    getReportsUploadsPath,
    getGeneralUploadsPath,
    getTeknisiUploadsPathByTicket,
    getTicketsUploadsPathByTicket
};
