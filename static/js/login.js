/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/login.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/login.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

        document.getElementById('yearNow').textContent = new Date().getFullYear();

        // Show / hide password
        (function () {
            var btn = document.getElementById('togglePassword');
            var input = document.getElementById('loginPassword');
            btn.addEventListener('click', function () {
                var show = input.type === 'password';
                input.type = show ? 'text' : 'password';
                btn.querySelector('i').className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
                btn.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
            });
        })();

        function showLoginError(message) {
            document.getElementById('loginErrorModalBody').textContent = message;
            $('#loginErrorModal').modal('show');
        }

        document.getElementById('loginForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            const loginButton = e.target.querySelector('button[type="submit"]');
            const originalButtonHTML = loginButton.innerHTML;

            loginButton.innerHTML = '<span class="spinner-border-sm" role="status" aria-hidden="true"></span> Sedang proses...';
            loginButton.disabled = true;

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                if (response.ok) {
                    const finalUrl = new URL(response.url);
                    const loginPath = new URL(window.location.href).pathname;

                    if (finalUrl.pathname === loginPath && response.redirected) {
                        showLoginError("Username atau password salah. Silakan coba lagi.");
                    } else if (finalUrl.pathname !== loginPath ) {
                         window.location.href = response.url;
                    } else {
                         showLoginError("Login tidak berhasil, silakan periksa kredensial Anda.");
                    }
                } else {
                    let errorMsg = 'Login gagal. Periksa kembali username dan password Anda.';
                    try {
                        const errorData = await response.json();
                        if (errorData && errorData.message) {
                            errorMsg = errorData.message;
                        }
                    } catch (e) {
                    }
                    showLoginError(errorMsg);
                }
            } catch (error) {
                console.error('Login Fetch Error:', error);
                showLoginError('Terjadi masalah koneksi atau server. Silakan coba lagi.');
            } finally {
                loginButton.innerHTML = originalButtonHTML;
                loginButton.disabled = false;
            }
        });
    
