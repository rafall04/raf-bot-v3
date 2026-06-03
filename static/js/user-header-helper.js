/**
 * Helper JavaScript untuk menampilkan nama user di header
 * Mengikuti rules: SELALU gunakan field `name` untuk menampilkan nama user
 * 
 * Usage:
 * - Panggil updateUserHeader() setelah DOM ready
 * - Atau gunakan updateUserHeaderById('elementId') untuk element spesifik
 */

/**
 * Update user header dengan data dari JWT token
 * @param {string} elementId - ID element yang akan di-update (default: 'currentUserName' atau 'username-placeholder' atau 'adminUsername')
 */
function updateUserHeader(elementId = null) {
    try {
        // Ambil token dari cookie
        const token = document.cookie.split('; ').find(row => row.startsWith('token='));
        if (!token) {
            console.warn('[USER_HEADER] No token found in cookie');
            return;
        }

        const jwtToken = token.split('=')[1];
        const base64Url = jwtToken.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(base64));

        // SELALU prioritaskan 'name' dari payload
        const userName = payload.name || payload.username || 'User';
        const role = payload.role || 'user';

        // Cari element yang akan di-update
        let element = null;
        if (elementId) {
            element = document.getElementById(elementId);
        } else {
            // Coba beberapa ID yang umum digunakan
            element = document.getElementById('currentUserName') ||
                     document.getElementById('username-placeholder') ||
                     document.getElementById('adminUsername') ||
                     document.getElementById('loggedInTechnicianInfo');
        }

        if (element) {
            // Update text content dengan name (bukan username)
            element.textContent = userName;
            
            // Jika element memiliki parent dengan role display, update juga
            const roleElement = element.parentElement?.querySelector('.text-muted');
            if (roleElement) {
                roleElement.textContent = role.charAt(0).toUpperCase() + role.slice(1);
            }
        } else {
            console.warn('[USER_HEADER] Element not found for user header update');
        }

        // Update photo jika ada
        const photoElement = document.getElementById('currentUserPhoto') || 
                           document.getElementById('userPhoto');
        if (photoElement && payload.photo) {
            photoElement.src = payload.photo;
        }
    } catch (e) {
        console.error('[USER_HEADER] Error decoding JWT:', e);
    }
}

// Auto-update saat DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => updateUserHeader());
} else {
    updateUserHeader();
}

