<?php
/**
 * Helper function untuk mendapatkan nama user dari JWT token atau session
 * Mengikuti rules: SELALU gunakan field `name` untuk menampilkan nama user
 * 
 * @return array Array dengan keys: 'name' dan 'role'
 */
function getUserNameFromTokenOrSession() {
    $userName = 'User'; // Default fallback
    $role = 'user'; // Default fallback

    // Prioritas 1: Coba ambil dari JWT token (cookie)
    if (isset($_COOKIE['token'])) {
        try {
            $token = $_COOKIE['token'];
            // Decode JWT token (base64 decode payload)
            $parts = explode('.', $token);
            if (count($parts) === 3) {
                $payload = json_decode(base64_decode(str_replace(['-', '_'], ['+', '/'], $parts[1])), true);
                // SELALU prioritaskan 'name' dari payload
                if (isset($payload['name'])) {
                    $userName = $payload['name'];
                } elseif (isset($payload['username'])) {
                    // Fallback ke username hanya jika name tidak ada
                    $userName = $payload['username'];
                }
                if (isset($payload['role'])) {
                    $role = $payload['role'];
                }
            }
        } catch (Exception $e) {
            // Jika decode gagal, fallback ke session
        }
    }

    // Prioritas 2: Ambil dari session
    if ($userName === 'User' && isset($_SESSION['name'])) {
        $userName = $_SESSION['name'];
    } elseif ($userName === 'User' && isset($_SESSION['username'])) {
        // Fallback ke username hanya jika name tidak ada
        $userName = $_SESSION['username'];
    }

    if ($role === 'user' && isset($_SESSION['role'])) {
        $role = $_SESSION['role'];
    }

    return [
        'name' => $userName,
        'role' => $role
    ];
}
?>

