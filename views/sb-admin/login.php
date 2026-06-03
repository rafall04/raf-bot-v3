<!DOCTYPE html>
<html lang="id">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <meta name="description" content="LOGIN RAF NET">
    <meta name="author" content="">

    <title>RAF NET</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link
        href="https://fonts.googleapis.com/css?family=Nunito:200,200i,300,300i,400,400i,600,600i,700,700i,800,800i,900,900i"
        rel="stylesheet">

    <link href="/css/sb-admin-2.min.css" rel="stylesheet">

    <style>
        :root {
            --primary-color: #4e73df;
            --primary-hover-color: #2e59d9;
            --light-gray-hover: #f8f9fc; /* Untuk hover halus */
            --border-color-input: #d1d3e2; /* Border input standar SB Admin 2 */
            --text-dark: #5a5c69;
            --text-heading: #3a3b45;
            --error-color: #e74a3b;
            --card-shadow-light: 0 0.15rem 1.75rem 0 rgba(58, 59, 69, 0.15); /* Bayangan standar SB Admin */
        }

        body.bg-gradient-primary {
            /* Menggunakan gradient default SB Admin 2 untuk konsistensi */
            background-color: #4e73df;
            background-image: linear-gradient(180deg, #4e73df 10%, #224abe 100%);
            background-size: cover;
            font-family: 'Nunito', sans-serif;
        }

        .container-login {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 90vh; /* Sedikit kurang dari 100vh agar tidak terlalu mentok */
            padding: 1rem;
        }

        .card-login {
            border-radius: 0.5rem; /* Sudut lebih halus, tidak terlalu bulat */
            border: none; /* Hilangkan border, andalkan bayangan */
            box-shadow: var(--card-shadow-light) !important;
        }
        
        .card-login .card-body {
            padding: 2.5rem; /* Sesuaikan padding */
        }

        .login-heading {
            font-weight: 400; /* Standar SB Admin 2 untuk h4 di login */
            color: var(--text-heading);
            margin-bottom: 1.5rem !important; /* Default SB Admin 2 */
            font-size: 1.8rem; /* Sedikit diperbesar */
        }

        .form-control-user {
            border-radius: 10rem; /* Default SB Admin 2 */
            padding: 1.5rem 1rem; /* Default SB Admin 2 */
            font-size: 0.8rem; /* Default SB Admin 2 */
            border: 1px solid var(--border-color-input);
            transition: border-color .15s ease-in-out,box-shadow .15s ease-in-out;
        }

        .form-control-user:focus {
            border-color: #80bdff; /* Warna fokus Bootstrap standar */
            box-shadow: 0 0 0 0.2rem rgba(78, 115, 223, 0.25);
        }
        .form-group {
            margin-bottom: 1.25rem; /* Jarak antar form group */
        }

        .btn-user {
            font-size: .8rem; /* Default SB Admin 2 */
            border-radius: 10rem; /* Default SB Admin 2 */
            padding: .75rem 1rem; /* Default SB Admin 2 */
            font-weight: 600; /* Tombol lebih tegas */
        }
        .btn-primary.btn-user {
            background-color: var(--primary-color);
            border-color: var(--primary-color);
        }
        .btn-primary.btn-user:hover {
            background-color: var(--primary-hover-color);
            border-color: var(--primary-hover-color);
        }
        .btn-primary.btn-user:disabled {
            background-color: #a5b6f0;
            border-color: #a5b6f0;
        }


        /* Modal Error Styling */
        #loginErrorModal .modal-content {
            border-radius: 0.5rem; /* Sesuaikan dengan card */
            border: none;
            box-shadow: 0 0.5rem 1rem rgba(0,0,0,0.15);
        }
        #loginErrorModal .modal-header {
            background-color: var(--error-color);
            color: white;
            border-top-left-radius: 0.5rem;
            border-top-right-radius: 0.5rem;
            padding: 1rem 1.5rem;
            border-bottom: none; /* Hapus border bawah header modal */
        }
        #loginErrorModal .modal-header .modal-title {
            font-weight: 600;
            font-size: 1.1rem;
        }
        #loginErrorModal .modal-header .close {
            color: white;
            opacity: 0.8;
            text-shadow: none;
            transition: opacity 0.15s ease;
        }
        #loginErrorModal .modal-header .close:hover {
            opacity: 1;
        }
        #loginErrorModal .modal-body {
            padding: 1.5rem;
            font-size: 0.95rem;
            color: var(--text-dark);
            line-height: 1.6;
        }
        #loginErrorModal .modal-footer {
            border-top: 1px solid #e9ecef; /* Border footer modal */
            padding: 1rem 1.5rem;
            background-color: #f8f9fc; /* Latar belakang footer sedikit beda */
            border-bottom-left-radius: 0.5rem;
            border-bottom-right-radius: 0.5rem;
        }
        #loginErrorModal .modal-footer .btn-primary {
             background-color: var(--primary-color);
             border-color: var(--primary-color);
        }
        #loginErrorModal .modal-footer .btn-primary:hover {
             background-color: var(--primary-hover-color);
             border-color: var(--primary-hover-color);
        }

        .spinner-border-sm {
            width: 1em; /* Sesuaikan ukuran spinner dengan teks tombol */
            height: 1em;
            border-width: .2em;
            margin-right: 0.5rem;
            vertical-align: -0.125em; /* Sejajarkan dengan teks */
        }

    </style>
</head>

<body class="bg-gradient-primary">

    <div class="container container-login">
        <div class="row justify-content-center w-100">
            <div class="col-xl-6 col-lg-7 col-md-9"> 
                <div class="card card-login o-hidden border-0 shadow-lg my-5">
                    <div class="card-body p-0">
                        <div class="row">
                            <div class="col-lg-12">
                                <div class="p-5">
                                    <div class="text-center">
                                        <h1 class="h4 text-gray-900 mb-4 login-heading">LOGIN</h1>
                                    </div>
                                    <form id="loginForm" class="user">
                                        <div class="form-group">
                                            <input type="text" name="username" class="form-control form-control-user"
                                                placeholder="Masukkan Username Anda..." required>
                                        </div>
                                        <div class="form-group">
                                            <input type="password" name="password" class="form-control form-control-user"
                                                placeholder="Password" required>
                                        </div>
                                        <button type="submit" class="btn btn-primary btn-user btn-block">
                                            Login
                                        </button>
                                    </form>
                                    
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
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

    <script src="/js/sb-admin-2.js"></script>

    <script>
        function showLoginError(message) {
            document.getElementById('loginErrorModalBody').textContent = message;
            $('#loginErrorModal').modal('show');
        }

        document.getElementById('loginForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            const loginButton = e.target.querySelector('button[type="submit"]');
            const originalButtonText = loginButton.textContent; // Ambil teks saja, bukan innerHTML
            
            loginButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Sedang proses...';
            loginButton.disabled = true;

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                if (response.ok) {
                    // Jika server mengembalikan status OK, periksa URL tujuan.
                    // Jika server sudah melakukan redirect (misalnya ke /index atau /pembayaran/teknisi),
                    // browser akan otomatis mengikutinya.
                    // Jika URL akhir masih halaman login, berarti ada masalah atau redirect gagal.
                    const finalUrl = new URL(response.url); // URL setelah semua redirect (jika ada)
                    const loginPath = new URL(window.location.href).pathname;

                    if (finalUrl.pathname === loginPath && response.redirected) {
                        // Di-redirect kembali ke halaman login, kemungkinan gagal.
                        showLoginError("Username atau password salah. Silakan coba lagi.");
                    } else if (finalUrl.pathname !== loginPath ) {
                         // Sukses dan sudah di-redirect oleh server ke halaman lain
                         window.location.href = response.url; // Pastikan browser mengikuti
                    } else {
                         // Response OK tapi tidak ada redirect yang jelas dari server atau masih di halaman login
                         // Ini bisa berarti sukses dan halaman me-refresh, atau kasus lain.
                         // Untuk SB Admin 2, biasanya sukses akan ada redirect. Jika tidak, kita bisa coba redirect manual.
                         // Untuk sekarang, kita asumsikan server yang handle redirect sukses.
                         // Jika ingin memaksa, bisa: window.location.href = '/index'; (atau halaman tujuan lain)
                         // Tapi idealnya serahkan pada server.
                         // Jika tetap di halaman login, tampilkan error sbg fallback.
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
                loginButton.textContent = originalButtonText;
                loginButton.disabled = false;
            }
        });
    </script>

</body>
</html>