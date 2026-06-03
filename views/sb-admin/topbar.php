<?php
// Get current user info dari JWT token (tidak perlu session)
$userName = 'User'; // Default fallback
$role = 'user'; // Default fallback

// DEBUG: Log untuk melihat cookie
$debugInfo = [];
$debugInfo['has_token_cookie'] = isset($_COOKIE['token']);
$debugInfo['token_length'] = isset($_COOKIE['token']) ? strlen($_COOKIE['token']) : 0;

// Prioritas 1: Coba ambil dari JWT token (cookie)
if (isset($_COOKIE['token']) && !empty($_COOKIE['token'])) {
    try {
        $token = $_COOKIE['token'];
        $debugInfo['token_preview'] = substr($token, 0, 20) . '...';
        
        // Decode JWT token (base64 decode payload)
        $parts = explode('.', $token);
        $debugInfo['token_parts_count'] = count($parts);
        
        if (count($parts) === 3 && !empty($parts[1])) {
            // Fix base64 padding untuk URL-safe base64
            $payloadBase64 = str_replace(['-', '_'], ['+', '/'], $parts[1]);
            // Add padding if needed (base64 requires padding to be multiple of 4)
            $padding = strlen($payloadBase64) % 4;
            if ($padding > 0) {
                $payloadBase64 .= str_repeat('=', 4 - $padding);
            }
            
            $decoded = base64_decode($payloadBase64, true);
            if ($decoded === false) {
                throw new Exception('Failed to decode base64');
            }
            
            $payload = json_decode($decoded, true);
            $debugInfo['payload_is_array'] = is_array($payload);
            $debugInfo['payload_keys'] = is_array($payload) ? array_keys($payload) : [];
            $debugInfo['payload_name'] = is_array($payload) && isset($payload['name']) ? $payload['name'] : 'NOT_SET';
            $debugInfo['payload_username'] = is_array($payload) && isset($payload['username']) ? $payload['username'] : 'NOT_SET';
            $debugInfo['payload_role'] = is_array($payload) && isset($payload['role']) ? $payload['role'] : 'NOT_SET';
            $debugInfo['payload_full'] = $payload; // Full payload untuk debugging
            
            if ($payload && is_array($payload)) {
                // SELALU prioritaskan 'name' dari payload
                if (isset($payload['name']) && !empty(trim($payload['name']))) {
                    $userName = trim($payload['name']);
                    $debugInfo['selected_source'] = 'JWT_name';
                    $debugInfo['selected_name'] = $userName;
                } elseif (isset($payload['username']) && !empty(trim($payload['username']))) {
                    // Jika JWT tidak memiliki 'name', gunakan username sebagai fallback
                    // Tapi kita akan coba fetch dari API untuk mendapatkan name yang benar
                    $userName = trim($payload['username']);
                    $debugInfo['selected_source'] = 'JWT_username_fallback';
                    $debugInfo['selected_name'] = $userName;
                    $debugInfo['note'] = 'JWT token tidak memiliki field name. Silakan logout dan login ulang untuk mendapatkan token baru.';
                }
                if (isset($payload['role']) && !empty(trim($payload['role']))) {
                    $role = trim($payload['role']);
                    $debugInfo['selected_role'] = $role;
                }
            }
        } else {
            $debugInfo['error'] = 'Invalid token format';
        }
    } catch (Exception $e) {
        $debugInfo['exception'] = $e->getMessage();
    }
}

// Prioritas 2: Tidak ada lagi - hanya pakai JWT
// Session tidak digunakan karena menyebabkan error "headers already sent"

$debugInfo['final_userName'] = $userName;
$debugInfo['final_role'] = $role;

// Pass data user ke JavaScript via inline variable (karena cookie httpOnly tidak bisa diakses dari JS)
?>
<script>
// Pass user data dari PHP ke JavaScript (karena cookie httpOnly tidak bisa diakses dari JS)
window.topbarUserData = {
    name: <?php echo json_encode($userName); ?>,
    role: <?php echo json_encode($role); ?>,
    debugInfo: <?php echo json_encode($debugInfo); ?>
};

// Log hanya jika ada masalah (name masih 'User' setelah fetch)
</script>
<script>
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
</script>
<?php
?>
<!-- Topbar -->
<nav class="navbar navbar-expand navbar-light bg-white topbar mb-4 static-top shadow">

    <!-- Sidebar Toggle (Topbar) -->
    <button id="sidebarToggleTop" class="btn btn-link d-md-none rounded-circle mr-3">
        <i class="fa fa-bars"></i>
    </button>

    <!-- Topbar Navbar -->
    <ul class="navbar-nav ml-auto">

        <!-- Nav Item - User Information -->
        <li class="nav-item dropdown no-arrow">
            <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button"
                data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                <span class="mr-2 d-none d-lg-inline text-gray-600 small" id="topbarUserName" data-user-name="<?php echo htmlspecialchars($userName); ?>" data-user-role="<?php echo htmlspecialchars($role); ?>">
                    <?php if ($userName === 'User'): ?>
                        <i class="fas fa-spinner fa-spin"></i>
                    <?php else: ?>
                        <?php echo htmlspecialchars($userName); ?>
                    <?php endif; ?>
                </span>
                <img class="img-profile rounded-circle"
                    src="/static/img/undraw_profile.svg">
            </a>
            <!-- Dropdown - User Information -->
            <div class="dropdown-menu dropdown-menu-right shadow animated--grow-in"
                aria-labelledby="userDropdown">
                <a class="dropdown-item" href="/config">
                    <i class="fas fa-cogs fa-sm fa-fw mr-2 text-gray-400"></i>
                    Settings
                </a>
                <div class="dropdown-divider"></div>
                <a class="dropdown-item" href="#" data-toggle="modal" data-target="#logoutModal">
                    <i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i>
                    Logout
                </a>
            </div>
        </li>

    </ul>

</nav>
<!-- End of Topbar -->

<!-- Logout Modal-->
<div class="modal fade" id="logoutModal" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel"
    aria-hidden="true">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title" id="exampleModalLabel">Ready to Leave?</h5>
                <button class="close" type="button" data-dismiss="modal" aria-label="Close">
                    <span aria-hidden="true">×</span>
                </button>
            </div>
            <div class="modal-body">Select "Logout" below if you are ready to end your current session.</div>
            <div class="modal-footer">
                <button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button>
                <a class="btn btn-primary" href="/logout">Logout</a>
            </div>
        </div>
    </div>
</div>
