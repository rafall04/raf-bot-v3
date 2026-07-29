/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/topbar.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/topbar.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

// Update header user dari data yang sudah di-decode oleh PHP ATAU dari API /api/me
// Karena cookie httpOnly mungkin tidak bisa dibaca oleh PHP, kita juga fetch dari API sebagai fallback
(function() {
    'use strict';
    
    function updateUserHeaderFromPHP() {
        try {
            var userNameElement = document.getElementById('topbarUserName');
            if (userNameElement && window.topbarUserData) {
                var displayName = window.topbarUserData.name || 'User';
                
                // Hanya update jika name bukan 'User' (artinya PHP berhasil decode)
                if (displayName !== 'User') {
                    userNameElement.innerHTML = displayName;
                    return true; // Berhasil update dari PHP
                } else {
                    // Tampilkan loading spinner
                    userNameElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                }
            }
            return false; // PHP tidak berhasil, perlu fetch dari API
        } catch(e) {
            console.error('[TOPBAR] Error updating header from PHP:', e);
            return false;
        }
    }
    
    function updateUserHeaderFromAPI() {
        fetch('/api/me', { credentials: 'include' })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to fetch user data: ' + response.status);
                }
                return response.json();
            })
            .then(data => {
                if (data.status === 200 && data.data) {
                    var userNameElement = document.getElementById('topbarUserName');
                    if (userNameElement) {
                        // SELALU prioritaskan 'name' dari API
                        var displayName = data.data.name || data.data.username || 'User';
                        userNameElement.innerHTML = displayName;
                    }
                }
            })
            .catch(error => {
                console.error('[TOPBAR] Failed to fetch user name:', error.message);
                var userNameElement = document.getElementById('topbarUserName');
                if (userNameElement) {
                    userNameElement.innerHTML = 'User';
                }
            });
    }
    
    function updateUserHeader() {
        // Coba update dari PHP data dulu
        var updatedFromPHP = updateUserHeaderFromPHP();
        
        // Jika PHP tidak berhasil (name masih 'User'), fetch dari API
        if (!updatedFromPHP) {
            updateUserHeaderFromAPI();
        }
    }
    
    // Jalankan setelah DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateUserHeader);
    } else {
        updateUserHeader();
    }
    
    // Juga jalankan dengan delay kecil untuk memastikan element sudah ada
    setTimeout(updateUserHeader, 100);
})();
