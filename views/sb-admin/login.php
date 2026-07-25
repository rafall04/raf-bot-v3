<!DOCTYPE html>
<html lang="id">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <meta name="description" content="LOGIN RAF NET">
    <meta name="author" content="">

    <title>Masuk · RAF BOT WIFI</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">

    <style>
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --ink: #0f172a;
            --ink-soft: #475569;
            --muted: #94a3b8;
            --line: #e9edf5;
            --danger: #ef4444;
        }

        * { box-sizing: border-box; }

        html {
            min-height: 100%;
            background:
                radial-gradient(900px circle at 0% 0%, rgba(99, 102, 241, 0.55), transparent 45%),
                radial-gradient(900px circle at 100% 100%, rgba(168, 85, 247, 0.45), transparent 45%),
                linear-gradient(160deg, #1e1b4b 0%, #312e81 55%, #4338ca 100%);
            background-repeat: no-repeat;
            background-size: cover;
        }
        body {
            margin: 0;
            min-height: 100vh;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            color: var(--ink);
            background: transparent;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1.25rem;
        }

        .login-shell {
            position: relative;
            width: 100%;
            max-width: 920px;
            background: #ffffff;
            border-radius: 24px;
            box-shadow: 0 40px 90px -30px rgba(2, 6, 23, 0.6), 0 14px 34px -14px rgba(2, 6, 23, 0.4);
            overflow: hidden;
            display: grid;
            grid-template-columns: 1.05fr 1fr;
        }

        /* ---------- Brand panel ---------- */
        .login-brand {
            position: relative;
            padding: 2.75rem 2.5rem;
            color: #fff;
            background:
                radial-gradient(rgba(255, 255, 255, 0.10) 1.3px, transparent 1.4px) 0 0 / 20px 20px,
                linear-gradient(160deg, #4f46e5 0%, #6d28d9 55%, #7c3aed 100%);
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        .login-brand::after {
            content: '';
            position: absolute;
            right: -60px; bottom: -60px;
            width: 220px; height: 220px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.10);
        }
        .login-brand::before {
            content: '';
            position: absolute;
            left: -40px; top: -40px;
            width: 150px; height: 150px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.08);
        }
        .brand-logo {
            display: inline-flex;
            align-items: center;
            gap: 0.7rem;
            font-weight: 800;
            font-size: 1.3rem;
            letter-spacing: 0.01em;
            position: relative;
        }
        .brand-logo .logo-mark {
            width: 2.8rem; height: 2.8rem;
            border-radius: 14px;
            background: rgba(255, 255, 255, 0.15);
            display: inline-flex; align-items: center; justify-content: center;
            font-size: 1.4rem;
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
        }
        .brand-logo sup { font-size: 0.6rem; opacity: 0.85; font-weight: 600; }
        .brand-copy { margin-top: auto; position: relative; }
        .brand-copy h2 {
            font-size: 1.7rem;
            font-weight: 800;
            line-height: 1.2;
            margin: 0 0 0.6rem;
            letter-spacing: -0.02em;
        }
        .brand-copy p {
            margin: 0;
            color: rgba(255, 255, 255, 0.82);
            font-size: 0.92rem;
            line-height: 1.6;
        }
        .brand-features {
            list-style: none;
            padding: 0;
            margin: 1.6rem 0 0;
            position: relative;
        }
        .brand-features li {
            display: flex;
            align-items: center;
            gap: 0.6rem;
            font-size: 0.86rem;
            color: rgba(255, 255, 255, 0.92);
            padding: 0.32rem 0;
        }
        .brand-features li i {
            width: 1.5rem; height: 1.5rem;
            border-radius: 7px;
            background: rgba(255, 255, 255, 0.16);
            display: inline-flex; align-items: center; justify-content: center;
            font-size: 0.72rem;
            flex: 0 0 auto;
        }

        /* ---------- Form panel ---------- */
        .login-form-wrap {
            padding: 2.9rem 2.6rem;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
        .form-head { margin-bottom: 1.6rem; }
        .form-head h1 {
            font-size: 1.55rem;
            font-weight: 800;
            margin: 0 0 0.35rem;
            letter-spacing: -0.02em;
        }
        .form-head p { margin: 0; color: var(--ink-soft); font-size: 0.9rem; }

        .field { margin-bottom: 1.1rem; }
        .field label {
            display: block;
            font-size: 0.78rem;
            font-weight: 600;
            color: var(--ink-soft);
            margin-bottom: 0.4rem;
        }
        .input-wrap { position: relative; }
        .input-wrap > .lead-icon {
            position: absolute;
            left: 0.95rem; top: 50%;
            transform: translateY(-50%);
            color: var(--muted);
            font-size: 0.9rem;
            pointer-events: none;
            transition: color 0.15s ease;
        }
        .input-wrap:focus-within > .lead-icon { color: var(--primary); }
        .input-wrap input {
            width: 100%;
            border: 1px solid var(--line);
            border-radius: 12px;
            padding: 0.8rem 2.6rem;
            font-size: 0.92rem;
            color: var(--ink);
            background: #fff;
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
            font-family: inherit;
        }
        .input-wrap input::placeholder { color: var(--muted); }
        .input-wrap input:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.16);
            background: #fbfcff;
        }
        .toggle-pass {
            position: absolute;
            right: 0.5rem; top: 50%;
            transform: translateY(-50%);
            border: 0; background: transparent;
            color: var(--muted);
            width: 2rem; height: 2rem;
            border-radius: 8px;
            cursor: pointer;
            display: inline-flex; align-items: center; justify-content: center;
        }
        .toggle-pass:hover { color: var(--primary-dark); background: #f1f5f9; }

        .btn-login {
            width: 100%;
            border: none;
            border-radius: 12px;
            padding: 0.85rem 1rem;
            font-size: 0.95rem;
            font-weight: 700;
            color: #fff;
            background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
            box-shadow: 0 10px 22px rgba(79, 70, 229, 0.32);
            cursor: pointer;
            transition: transform 0.12s ease, box-shadow 0.18s ease, opacity 0.15s ease;
            margin-top: 0.4rem;
            font-family: inherit;
        }
        .btn-login:hover { transform: translateY(-1px); box-shadow: 0 16px 32px -8px rgba(79, 70, 229, 0.5); }
        .btn-login:active { transform: translateY(1px); }
        .btn-login:focus-visible { outline: none; box-shadow: 0 10px 22px rgba(79, 70, 229, 0.32), 0 0 0 4px rgba(99, 102, 241, 0.35); }
        .btn-login:disabled { opacity: 0.7; cursor: default; box-shadow: none; }

        .form-foot {
            margin-top: 1.5rem;
            text-align: center;
            font-size: 0.8rem;
            color: var(--muted);
        }

        .spinner-border-sm {
            display: inline-block;
            width: 1em; height: 1em;
            border: 0.18em solid currentColor;
            border-right-color: transparent;
            border-radius: 50%;
            margin-right: 0.5rem;
            vertical-align: -0.125em;
            animation: tk-spin 0.7s linear infinite;
        }
        @keyframes tk-spin { to { transform: rotate(360deg); } }

        /* ---------- Error modal ---------- */
        #loginErrorModal .modal-content { border-radius: 16px; border: none; box-shadow: 0 0.5rem 2rem rgba(0,0,0,0.25); overflow: hidden; }
        #loginErrorModal .modal-header { background: linear-gradient(135deg, #f87171, var(--danger)); color: #fff; border: none; padding: 1rem 1.4rem; }
        #loginErrorModal .modal-header .modal-title { font-weight: 700; font-size: 1.02rem; }
        #loginErrorModal .modal-header .close { color: #fff; opacity: 0.85; text-shadow: none; }
        #loginErrorModal .modal-header .close:hover { opacity: 1; }
        #loginErrorModal .modal-body { padding: 1.4rem; font-size: 0.92rem; color: var(--ink-soft); line-height: 1.6; }
        #loginErrorModal .modal-footer { border-top: 1px solid var(--line); padding: 0.9rem 1.4rem; }
        #loginErrorModal .modal-footer .btn-primary {
            background: linear-gradient(135deg, var(--primary), var(--primary-dark));
            border: none; border-radius: 10px; font-weight: 600; padding: 0.5rem 1.1rem;
        }

        /* ---------- Responsive ---------- */
        @media (max-width: 767.98px) {
            .login-shell { grid-template-columns: 1fr; max-width: 440px; }
            .login-brand {
                padding: 1.6rem 1.6rem 1.4rem;
                flex-direction: row;
                align-items: center;
                gap: 0.85rem;
            }
            .login-brand::before, .login-brand::after { display: none; }
            .brand-copy, .brand-features { display: none; }
            .brand-logo { font-size: 1.15rem; }
            .login-form-wrap { padding: 1.9rem 1.6rem 2.1rem; }
            .form-head h1 { font-size: 1.4rem; }
        }
    </style>
</head>

<body>

    <div class="login-shell">
        <!-- Brand panel -->
        <div class="login-brand">
            <div class="brand-logo">
                <span class="logo-mark"><i class="fas fa-robot"></i></span>
                <span>RAF BOT<sup>WIFI</sup></span>
            </div>
            <div class="brand-copy">
                <h2>Panel Manajemen Jaringan WiFi</h2>
                <p>Kelola pelanggan, pembayaran, instalasi, dan jaringan dalam satu dasbor terpadu.</p>
                <ul class="brand-features">
                    <li><i class="fas fa-users"></i> Manajemen pelanggan &amp; PSB</li>
                    <li><i class="fas fa-money-check-alt"></i> Monitoring pembayaran</li>
                    <li><i class="fas fa-broadcast-tower"></i> Pantau OLT &amp; peta jaringan</li>
                </ul>
            </div>
        </div>

        <!-- Form panel -->
        <div class="login-form-wrap">
            <div class="form-head">
                <h1>Selamat datang 👋</h1>
                <p>Masuk untuk melanjutkan ke dasbor Anda.</p>
            </div>

            <form id="loginForm" class="user">
                <div class="field">
                    <label for="loginUsername">Username</label>
                    <div class="input-wrap">
                        <i class="fas fa-user lead-icon"></i>
                        <input type="text" id="loginUsername" name="username"
                               placeholder="Masukkan username Anda" autocomplete="username" required>
                    </div>
                </div>
                <div class="field">
                    <label for="loginPassword">Password</label>
                    <div class="input-wrap">
                        <i class="fas fa-lock lead-icon"></i>
                        <input type="password" id="loginPassword" name="password"
                               placeholder="Masukkan password" autocomplete="current-password" required>
                        <button type="button" class="toggle-pass" id="togglePassword" aria-label="Tampilkan password">
                            <i class="fas fa-eye"></i>
                        </button>
                    </div>
                </div>
                <button type="submit" class="btn-login">Masuk</button>
            </form>

            <div class="form-foot">&copy; <span id="yearNow"></span> RAF BOT WIFI</div>
        </div>
    </div>

    <div class="modal fade" id="loginErrorModal" tabindex="-1" aria-labelledby="loginErrorModalLabel" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="loginErrorModalLabel"><i class="fas fa-times-circle mr-2"></i>Login Gagal</h5>
            <button type="button" class="close" data-dismiss="modal" aria-label="Close">
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
          <div class="modal-body" id="loginErrorModalBody">
            {Pesan error akan ditampilkan di sini}
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" data-dismiss="modal">Coba Lagi</button>
          </div>
        </div>
      </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>

    <script>
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
    </script>

</body>
</html>
