<!DOCTYPE html>
<html lang="id">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <meta name="description" content="Halaman Kompensasi Pelanggan">
    <meta name="author" content="Anda">
    <title>Kompensasi Pelanggan - Admin Panel</title>
    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
    <style>
        .customer-search-results div,
        .selected-customers-list div {
            padding: 8px;
            border: 1px solid #e3e6f0;
            margin-bottom: 5px;
            border-radius: .35rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .customer-search-results div:hover {
            background-color: #f8f9fc;
            cursor: pointer;
        }
        .btn-remove-customer {
            margin-left: 10px;
        }
        .modal-body-scrollable {
            max-height: calc(100vh - 200px); /* Sesuaikan tinggi maksimal */
            overflow-y: auto;
            white-space: pre-wrap; /* Agar line break dari \n tampil benar */
            word-wrap: break-word;
        }
        .modal-body-scrollable ul {
            padding-left: 20px; /* Indentasi untuk list */
            list-style-type: none; /* Hapus bullet point default jika kita pakai styling sendiri */
        }
         .modal-body-scrollable ul ul { /* Sub-list */
            padding-left: 20px;
            list-style-type: disc; /* Atau biarkan default */
        }
        .modal-body-scrollable li {
            margin-bottom: 10px;
        }
        .modal-body-scrollable .user-detail-item {
            margin-bottom: 3px;
            font-size: 0.9em;
        }
        .duration-input-group {
            display: flex;
            gap: 15px; /* Jarak antar input durasi */
        }
        .duration-input-group .form-group {
            flex: 1; /* Agar input hari dan jam berbagi ruang */
        }
        #activeCompensationsTable th, #activeCompensationsTable td {
            font-size: 0.85rem; /* Perkecil font tabel jika perlu */
            vertical-align: middle;
        }
    </style>
</head>

<body id="page-top">
    <div id="wrapper">
    <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include 'topbar.php'; ?>
                <div class="container-fluid">
                    <div class="dashboard-header">
                        <h1>Kompensasi Peningkatan Kecepatan</h1>
                        <p>Kelola kompensasi pelanggan dengan peningkatan kecepatan sementara</p>
                    </div>
                    
                    <h4 class="dashboard-section-title">Input Data Kompensasi</h4>
                    <div class="card table-card mb-4">
                        <div class="card-header">
                            <h6>Form Kompensasi</h6>
                        </div>
                        <div class="card-body">
                            <form id="compensationForm">
                                <div class="form-group">
                                    <label for="customerSearch">Cari Pelanggan (Nama, ID, atau Username PPPoE):</label>
                                    <div class="input-group">
                                        <input type="text" class="form-control" id="customerSearch" placeholder="Ketik untuk mencari...">
                                        <div class="input-group-append">
                                            <button class="btn btn-primary" type="button" onclick="searchCustomer()">
                                                <i class="fas fa-search fa-sm"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div id="customerSearchResults" class="mb-3 customer-search-results"></div>
                                <div class="form-group">
                                    <label>Pelanggan Dipilih:</label>
                                    <div id="selectedCustomers" class="selected-customers-list">
                                        <small class="text-muted">Belum ada pelanggan dipilih.</small>
                                    </div>
                                </div>
                                <hr>
                                <div class="form-group">
                                    <label for="speedProfile">Pilih Profil Kecepatan Baru (Kompensasi):</label>
                                    <select class="form-control" id="speedProfile" name="speedProfile" required>
                                        <option value="">Memuat profil...</option>
                                    </select>
                                </div>

                                <label>Durasi Peningkatan Kecepatan:</label>
                <div class="duration-input-group mb-3">
                    <div class="form-group mb-0">
                        <label for="durationDays">Hari:</label>
                        <select class="form-control" id="durationDays" name="durationDays">
                            <option value="0">0 Hari</option>
                            <option value="1">1 Hari</option>
                            <option value="2">2 Hari</option>
                            <option value="3">3 Hari</option>
                            <option value="5">5 Hari</option>
                            <option value="7" selected>7 Hari</option>
                            <option value="14">14 Hari</option>
                            <option value="30">30 Hari</option>
                        </select>
                    </div>
                    <div class="form-group mb-0">
                        <label for="durationHours">Jam:</label>
                        <select class="form-control" id="durationHours" name="durationHours">
                            <option value="0" selected>0 Jam</option>
                            <option value="1">1 Jam</option>
                            <option value="2">2 Jam</option>
                            <option value="3">3 Jam</option>
                            <option value="4">4 Jam</option>
                            <option value="5">5 Jam</option>
                            <option value="6">6 Jam</option>
                            <option value="8">8 Jam</option>
                            <option value="12">12 Jam</option>
                            <option value="18">18 Jam</option>
                            <option value="23">23 Jam</option>
                        </select>
                    </div>
                    <div class="form-group mb-0">
                        <label for="durationMinutes">Menit (untuk ujicoba):</label>
                        <select class="form-control" id="durationMinutes" name="durationMinutes">
                            <option value="0" selected>0 Menit</option>
                            <option value="1">1 Menit</option>
                            <option value="2">2 Menit</option>
                            <option value="3">3 Menit</option>
                            <option value="5">5 Menit</option>
                            <option value="10">10 Menit</option>
                            <option value="15">15 Menit</option>
                            <option value="20">20 Menit</option>
                            <option value="30">30 Menit</option>
                            <option value="45">45 Menit</option>
                            <option value="50">50 Menit</option>
                            <option value="55">55 Menit</option>
                        </select>
                    </div>
                </div>
                                <div class="form-group">
                                    <label for="notes">Catatan (Opsional):</label>
                                    <textarea class="form-control" id="notes" name="notes" rows="3" placeholder="Tambahkan catatan jika perlu, misal alasan kompensasi"></textarea>
                                </div>
                                <button type="submit" class="btn btn-success btn-icon-split">
                                    <span class="icon text-white-50">
                                        <i class="fas fa-check"></i>
                                    </span>
                                    <span class="text">Proses Kompensasi</span>
                                </button>
                            </form>
                        </div>
                    </div>

                    <div class="card shadow mb-4">
                        <div class="card-header py-3 d-flex flex-row align-items-center justify-content-between">
                            <h6 class="m-0 font-weight-bold text-primary">Pelanggan Aktif Mendapatkan Kompensasi</h6>
                            <button class="btn btn-sm btn-primary btn-icon-split" onclick="loadActiveCompensations()">
                                <span class="icon text-white-50">
                                    <i class="fas fa-sync-alt"></i>
                                </span>
                                <span class="text">Refresh Daftar</span>
                            </button>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered table-hover" id="activeCompensationsTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>Nama Pelanggan</th>
                                            <th>PPPoE</th>
                                            <th>Profil Asli</th>
                                            <th>Profil Kompensasi</th>
                                            <th>Durasi</th>
                                            <th>Berakhir Pada</th>
                                            <th>Catatan</th>
                                        </tr>
                                    </thead>
                                    <tbody id="activeCompensationsList">
                                        <tr><td colspan="7" class="text-center">Memuat data...</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
                </div>
            <footer class="sticky-footer bg-white">
                <div class="container my-auto">
                    <div class="copyright text-center my-auto">
                        <span>Copyright &copy; RAF BOT 2025</span>
                    </div>
                </div>
            </footer>
            </div>
        </div>
    <a class="scroll-to-top rounded" href="#page-top">
        <i class="fas fa-angle-up"></i>
    </a>

    <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel"
        aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="exampleModalLabel">Yakin ingin Logout?</h5>
                    <button class="close" type="button" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">×</span>
                    </button>
                </div>
                <div class="modal-body">Pilih "Logout" di bawah jika Anda siap untuk mengakhiri sesi Anda saat ini.</div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Batal</button>
                    <a class="btn btn-primary" href="/logout">Logout</a>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="resultModal" tabindex="-1" role="dialog" aria-labelledby="resultModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-lg" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="resultModalLabel">Hasil Proses</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <div class="modal-body modal-body-scrollable" id="resultModalBody">
                    </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Tutup</button>
                </div>
            </div>
        </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script>
        let allCustomers = [];
        let allSpeedProfiles = [];
        let selectedCustomerIds = new Set();
        let currentUser = null; // Untuk menyimpan data user yang login

        // Fungsi getCookie sudah dihapus karena kita mengandalkan HttpOnly cookie

        async function fetchUserData() {
            try {
                const response = await fetch('/api/me', { credentials: 'include' }); // Browser otomatis kirim HttpOnly cookie
                if (!response.ok) {
                    if (response.status === 401 || response.status === 403) {
                        console.warn('Sesi tidak valid atau token expired saat fetchUserData.');
                        showResultModal('Sesi Tidak Valid', '<p class="text-danger">Sesi Anda tidak valid atau telah berakhir. Anda akan diarahkan ke halaman login.</p>', 'modal-danger');
                        setTimeout(() => { window.location.href = '/login'; }, 3000);
                        throw new Error('Sesi tidak valid.'); 
                    }
                    const errorText = await response.text().catch(() => "Tidak dapat membaca detail error server."); // Tambahkan catch jika response.text() gagal
                    throw new Error(`Gagal mengambil data user: ${response.status} ${response.statusText} - ${errorText.substring(0, 200)}`);
                }
                const userData = await response.json();
                if (userData.data) {
                    currentUser = userData.data; 
                } else {
                     currentUser = null;
                     console.warn('Data user tidak ditemukan dalam respons /api/me meskipun status OK.');
                }
                return true; 
            } catch (error) {
                console.error('Error fetching user data:', error);
                currentUser = null;
                if (error.message !== 'Sesi tidak valid.') {
                     showResultModal('Kesalahan User', `<p class="text-danger">Gagal memuat informasi pengguna.</p><p><i>${error.message}</i></p>`, 'modal-danger');
                }
                return false;
            }
        }

        async function loadInitialData() {
            if (!currentUser) {
                console.log("Data user belum ada atau sesi tidak valid, loadInitialData dibatalkan.");
                // Jika fetchUserData sudah gagal dan redirect, ini tidak akan banyak berpengaruh.
                // Tapi jika fetchUserData gagal karena alasan lain selain 401/403, ini mencegah lanjut.
                return; 
            }
            try {
                const usersResponse = await fetch('/api/users', { credentials: 'include' }); // Browser otomatis kirim HttpOnly cookie
                if (!usersResponse.ok) {
                     if (usersResponse.status === 401 || usersResponse.status === 403) {
                        showResultModal('Sesi Tidak Valid', '<p class="text-danger">Gagal memuat data pelanggan karena sesi tidak valid. Anda akan diarahkan ke halaman login.</p>', 'modal-danger');
                        setTimeout(() => { window.location.href = '/login'; }, 3000);
                     }
                    throw new Error(`Gagal mengambil data pelanggan: ${usersResponse.status} ${usersResponse.statusText}`);
                }
                const usersData = await usersResponse.json();
                allCustomers = usersData.data || [];

                const packagesResponse = await fetch('/api/packages'); // Browser otomatis kirim HttpOnly cookie
                if (!packagesResponse.ok) {
                    if (packagesResponse.status === 401 || packagesResponse.status === 403) {
                        showResultModal('Sesi Tidak Valid', '<p class="text-danger">Gagal memuat data paket karena sesi tidak valid. Anda akan diarahkan ke halaman login.</p>', 'modal-danger');
                        setTimeout(() => { window.location.href = '/login'; }, 3000);
                    }
                    throw new Error(`Gagal mengambil data profil: ${packagesResponse.status} ${packagesResponse.statusText}`);
                }
                const packagesData = await packagesResponse.json();
                allSpeedProfiles = packagesData.data.filter(pkg => pkg.profile) || [];
                populateSpeedProfiles();
            } catch (error) {
                console.error("Error memuat data awal:", error);
                if (!error.message.includes("sesi tidak valid")) { // Hindari modal ganda jika sudah ditangani
                    showResultModal('Terjadi Kesalahan Data Awal', `<p class="text-danger">Gagal memuat data awal yang dibutuhkan.</p><p><i>${error.message}</i></p>`, 'modal-danger');
                }
            }
        }
        
        function populateSpeedProfiles() {
            const speedProfileSelect = document.getElementById('speedProfile');
            speedProfileSelect.innerHTML = '<option value="">Pilih Profil Kecepatan Baru</option>';
            allSpeedProfiles.forEach(profile => {
                const optionText = `${profile.name} (${profile.profile})`;
                speedProfileSelect.add(new Option(optionText, profile.profile));
            });
        }

        function searchCustomer() {
            const searchTerm = document.getElementById('customerSearch').value.toLowerCase().trim();
            const resultsContainer = document.getElementById('customerSearchResults');
            resultsContainer.innerHTML = '';
            if (!searchTerm) return;
            const filteredCustomers = allCustomers.filter(customer =>
                (customer.name && customer.name.toLowerCase().includes(searchTerm)) ||
                (customer.id && customer.id.toString().toLowerCase().includes(searchTerm)) ||
                (customer.pppoe_username && customer.pppoe_username.toLowerCase().includes(searchTerm))
            );
            if (filteredCustomers.length > 0) {
                filteredCustomers.slice(0, 5).forEach(customer => { // Batasi hasil pencarian misal 5
                    if (!selectedCustomerIds.has(customer.id.toString())) {
                        const div = document.createElement('div');
                        div.innerHTML = `<span>${customer.name} (ID: ${customer.id}, PPPoE: ${customer.pppoe_username || 'N/A'})</span><button type="button" class="btn btn-sm btn-outline-primary add-customer-btn">Tambah</button>`;
                        div.querySelector('.add-customer-btn').onclick = (e) => { e.stopPropagation(); selectCustomer(customer); };
                        resultsContainer.appendChild(div);
                    }
                });
            } else {
                resultsContainer.innerHTML = '<small class="text-muted">Pelanggan tidak ditemukan.</small>';
            }
        }

        function selectCustomer(customer) {
            if (!selectedCustomerIds.has(customer.id.toString())) {
                selectedCustomerIds.add(customer.id.toString());
                renderSelectedCustomers();
                document.getElementById('customerSearch').value = '';
                document.getElementById('customerSearchResults').innerHTML = '';
            } else {
                showResultModal('Informasi', '<p>Pelanggan ini sudah dipilih sebelumnya.</p>', 'modal-info');
            }
        }

        function renderSelectedCustomers() {
            const selectedContainer = document.getElementById('selectedCustomers');
            selectedContainer.innerHTML = '';
            if (selectedCustomerIds.size === 0) {
                selectedContainer.innerHTML = '<small class="text-muted">Belum ada pelanggan dipilih.</small>';
                return;
            }
            selectedCustomerIds.forEach(customerId => {
                const customer = allCustomers.find(c => c.id.toString() === customerId);
                if (customer) {
                    const div = document.createElement('div');
                    div.innerHTML = `<span>${customer.name} (ID: ${customer.id}, PPPoE: ${customer.pppoe_username || 'N/A'})</span><button type="button" class="btn btn-sm btn-danger btn-remove-customer"><i class="fas fa-trash"></i></button>`;
                    div.querySelector('.btn-remove-customer').onclick = () => removeCustomer(customerId);
                    selectedContainer.appendChild(div);
                }
            });
        }

        function removeCustomer(customerId) {
            selectedCustomerIds.delete(customerId);
            renderSelectedCustomers();
        }

        function showResultModal(title, bodyHtml, modalType = 'modal-default') {
            const modalTitle = document.getElementById('resultModalLabel');
            const modalBody = document.getElementById('resultModalBody');
            const modalHeader = modalTitle.parentElement;
            modalTitle.textContent = title;
            modalBody.innerHTML = bodyHtml; // Menggunakan innerHTML agar tag HTML di bodyHtml ter-render
            
            // Reset class header modal dan teks judul
            modalHeader.className = 'modal-header'; // Reset ke default
            modalTitle.className = 'modal-title'; // Reset ke default

            if (modalType === 'modal-success') { modalHeader.classList.add('bg-success', 'text-white'); }
            else if (modalType === 'modal-danger') { modalHeader.classList.add('bg-danger', 'text-white'); }
            else if (modalType === 'modal-warning') { modalHeader.classList.add('bg-warning', 'text-dark'); }
            else if (modalType === 'modal-info') { modalHeader.classList.add('bg-info', 'text-white'); }
            
            $('#resultModal').modal('show');
        }
        
        async function loadActiveCompensations() {
            const listBody = document.getElementById('activeCompensationsList');
            listBody.innerHTML = '<tr><td colspan="7" class="text-center"><div class="spinner-border spinner-border-sm text-primary" role="status"></div> Memuat data kompensasi aktif...</td></tr>';

            if (!currentUser) {
                listBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Sesi tidak valid untuk memuat daftar. Silakan login kembali.</td></tr>';
                return;
            }

            try {
                const response = await fetch('/api/compensations/active', { credentials: 'include' }); // Browser otomatis kirim HttpOnly cookie
                if (!response.ok) {
                    if (response.status === 401 || response.status === 403) {
                        showResultModal('Sesi Tidak Valid', '<p class="text-danger">Gagal memuat daftar kompensasi karena sesi tidak valid. Anda akan diarahkan ke halaman login.</p>', 'modal-danger');
                        setTimeout(() => { window.location.href = '/login'; }, 3000);
                         listBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Sesi tidak valid. Silakan login kembali.</td></tr>';
                         return; // Hentikan jika sesi tidak valid
                    }
                    const errorResult = await response.json().catch(() => ({ message: response.statusText })); // Tangkap error jika parse JSON gagal
                    throw new Error(`Gagal mengambil data kompensasi aktif: ${response.status} ${errorResult.message}`);
                }
                const result = await response.json();
                
                if (result.data && result.data.length > 0) {
                    listBody.innerHTML = ''; 
                    result.data.forEach(comp => {
                    const endDate = new Date(comp.endDate);
                    // Opsi format tanggal yang lebih umum dan lengkap
                    const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'shortOffset' };
                    const formattedEndDate = endDate.toLocaleDateString('id-ID', options);

                    let durasiStr = "";
                    if (comp.durationDays > 0) durasiStr += `${comp.durationDays} hari `;
                    if (comp.durationHours > 0) durasiStr += `${comp.durationHours} jam `;
                    if (comp.durationMinutes > 0) durasiStr += `${comp.durationMinutes} menit`;
                    if (durasiStr.trim() === "") durasiStr = "-";


                    const row = `<tr>
                        <td>${comp.userName || 'N/A'}</td>
                        <td>${comp.pppoeUsername || 'N/A'}</td>
                        <td>${comp.originalProfile || 'N/A'}</td>
                        <td>${comp.compensatedProfile || 'N/A'}</td>
                        <td>${durasiStr.trim()}</td>
                        <td>${formattedEndDate}</td>
                        <td>${comp.notes || '-'}</td>
                    </tr>`;
                    listBody.insertAdjacentHTML('beforeend', row); // Lebih efisien daripada innerHTML +=
                });
            } else {
                listBody.innerHTML = '<tr><td colspan="7" class="text-center">Tidak ada pelanggan yang sedang mendapatkan kompensasi aktif.</td></tr>';
            }
        } catch (error) {
            console.error("Error memuat daftar kompensasi aktif:", error);
            listBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Gagal memuat data: ${error.message}</td></tr>`;
        }
    }

    document.getElementById('compensationForm').addEventListener('submit', async function(event) {
        event.preventDefault();
        if (!currentUser) {
            showResultModal('Sesi Tidak Valid', '<p class="text-danger">Sesi Anda tidak valid atau telah berakhir. Silakan login kembali.</p><p>Halaman akan dialihkan...</p>', 'modal-danger');
            setTimeout(() => { window.location.href = '/login'; }, 3000);
            return;
        }

        if (selectedCustomerIds.size === 0) {
            showResultModal('Input Tidak Lengkap', '<p>Silakan pilih setidaknya satu pelanggan.</p>', 'modal-warning');
            return;
        }
        const speedProfile = document.getElementById('speedProfile').value;
        const durationDays = parseInt(document.getElementById('durationDays').value);
        const durationHours = parseInt(document.getElementById('durationHours').value);
        const durationMinutes = parseInt(document.getElementById('durationMinutes').value);

        if (!speedProfile) {
            showResultModal('Input Tidak Lengkap', '<p>Silakan pilih profil kecepatan baru.</p>', 'modal-warning');
            return;
        }
        if (isNaN(durationDays) || isNaN(durationHours) || isNaN(durationMinutes) || 
            (durationDays < 0) || (durationHours < 0) || (durationMinutes < 0) || 
            (durationDays === 0 && durationHours === 0 && durationMinutes === 0) ) {
            showResultModal('Input Tidak Lengkap', '<p>Durasi kompensasi (hari, jam, atau menit) harus lebih dari 0 dan tidak boleh negatif.</p>', 'modal-warning');
            return;
        }

        const formData = {
            customerIds: Array.from(selectedCustomerIds),
            speedProfile: speedProfile,
            durationDays: durationDays,
            durationHours: durationHours,
            durationMinutes: durationMinutes,
            notes: document.getElementById('notes').value
        };

        const submitButton = this.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.innerHTML;
        submitButton.disabled = true;
        submitButton.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Memproses...`;

        let response;
        try {
            response = await fetch('/api/compensation/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }, // Hapus header Authorization manual
                credentials: 'include', // ✅ Fixed by script
                body: JSON.stringify(formData)
            });

            let result;
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") !== -1) {
                result = await response.json();
            } else {
                const responseText = await response.text();
                console.error("Respons server bukan JSON:", responseText);
                // Buat objek result default jika respons bukan JSON, terutama untuk error server
                result = { 
                    message: `Server memberikan respons yang tidak terduga (Status: ${response.status}). Isi respons: ${responseText.substring(0,200)}...`, 
                    details: [] 
                };
                 // Khusus untuk 401/403, kita akan menimpanya nanti
                if (response.status === 401 || response.status === 403) {
                    result.message = "Sesi tidak valid atau akses ditolak."; // Pesan lebih standar untuk 401/403
                }
            }

            let modalTitle = "Informasi";
            let modalBodyHtml = "";
            let modalType = "modal-info";

            if (response.ok || response.status === 207) { // Sukses atau Multi-Status
                modalTitle = result.message || 'Proses Selesai';
                modalBodyHtml = `<p>${result.message || 'Operasi kompensasi telah diproses.'}</p>`;
                if (result.details && Array.isArray(result.details) && result.details.length > 0) {
                    modalBodyHtml += "<h5>Rincian Proses per Pelanggan:</h5><ul>";
                    result.details.forEach(userResult => {
                        let statusClass = 'warning'; // Default untuk warning_partial
                        if (userResult.status === 'success') statusClass = 'success';
                        else if (userResult.status === 'error_critical') statusClass = 'danger';

                        modalBodyHtml += `<li><strong>ID ${userResult.userId} (PPPoE: ${userResult.pppoeUsername || 'N/A'})</strong><br/>Status: <span class="font-weight-bold text-${statusClass}">${userResult.status}</span>`;
                        if (userResult.details && Array.isArray(userResult.details) && userResult.details.length > 0) {
                            modalBodyHtml += "<ul>";
                            userResult.details.forEach(msg => { modalBodyHtml += `<li class="user-detail-item">${msg}</li>`; });
                            modalBodyHtml += "</ul>";
                        }
                        modalBodyHtml += `</li>`;
                    });
                    modalBodyHtml += "</ul>";
                }
                
                const isFullySuccessful = result.details && result.details.every(detail => detail.status === 'success');
                const hasAnyCriticalError = result.details && result.details.some(detail => detail.status === 'error_critical');
                
                if (isFullySuccessful) modalType = 'modal-success';
                else if (hasAnyCriticalError) modalType = 'modal-danger';
                else modalType = 'modal-warning'; // Ada warning_partial tapi tidak ada error_critical
                
                if (response.ok && isFullySuccessful) {
                    selectedCustomerIds.clear();
                    renderSelectedCustomers();
                    document.getElementById('compensationForm').reset();
                    document.getElementById('durationDays').value = "7"; 
                    document.getElementById('durationHours').value = "0";
                    document.getElementById('durationMinutes').value = "0";
                }
                loadActiveCompensations(); // Selalu refresh daftar setelah submit
            } else { // Error (400, 401, 403, 500 dll.)
                if (response.status === 401 || response.status === 403) {
                    modalTitle = 'Sesi Tidak Valid';
                    modalBodyHtml = `<p class="text-danger">Sesi Anda tidak valid atau telah berakhir. Anda akan diarahkan ke halaman login.</p>`;
                    modalType = 'modal-danger';
                    setTimeout(() => { window.location.href = '/login'; }, 3000);
                } else {
                    modalTitle = `Error Aplikasi (Status: ${response.status})`;
                    modalBodyHtml = `<p class="text-danger"><strong>Gagal menerapkan kompensasi.</strong></p>`;
                    modalType = 'modal-danger';
                    if (result && result.message) modalBodyHtml += `<p><strong>Pesan Server:</strong> ${result.message}</p>`;
                    else if(response.statusText) modalBodyHtml += `<p><strong>Pesan Server:</strong> ${response.statusText}</p>`;
                    
                    if (result && result.details && Array.isArray(result.details) && result.details.length > 0) {
                        modalBodyHtml += "<h5>Rincian Kegagalan/Masalah:</h5><ul>";
                        result.details.forEach(userResult => {
                            modalBodyHtml += `<li><strong>ID ${userResult.userId} (PPPoE: ${userResult.pppoeUsername || 'N/A'})</strong><br/>Status: <span class="font-weight-bold text-danger">${userResult.status}</span>`;
                            if (userResult.details && Array.isArray(userResult.details) && userResult.details.length > 0) {
                                modalBodyHtml += "<ul>";
                                userResult.details.forEach(msg => { modalBodyHtml += `<li class="user-detail-item">${msg}</li>`; });
                                modalBodyHtml += "</ul>";
                            }
                            modalBodyHtml += `</li>`;
                        });
                        modalBodyHtml += "</ul>";
                    } else if (!result || (!result.details && result.message && (result.message.includes("Semua operasi kompensasi gagal") || result.message.includes("Tidak ada pelanggan yang diproses")) ) ) {
                         modalBodyHtml += "<p>Masalah pada validasi awal atau tidak ada pelanggan yang diproses.</p>";
                    } else if (result && !result.details && !result.message.includes("Respons server tidak valid")) { // Jika message sudah diisi dari responseText
                        // Biarkan message dari result.message
                    } else {
                        modalBodyHtml += "<p>Tidak ada rincian lebih lanjut dari server.</p>";
                    }
                }
            }
            showResultModal(modalTitle, modalBodyHtml, modalType);

        } catch (error) { // Error jaringan atau JS error sebelum fetch
            console.error('Error pada sisi klien saat submit:', error);
            let errorDetail = error.message;
            if (response && response.status && response.statusText && response.status !== 200 && response.status !== 207) {
                 errorDetail += ` (Status Server: ${response.status} ${response.statusText})`;
            }
            showResultModal('Kesalahan Klien/Jaringan', `<p class="text-danger">Terjadi kesalahan pada sisi klien atau jaringan.</p><p><i>${errorDetail}</i></p><p>Silakan periksa koneksi Anda dan coba lagi. Jika masalah berlanjut, periksa konsol (F12) atau hubungi administrator.</p>`, 'modal-danger');
        } finally {
            submitButton.disabled = false;
            submitButton.innerHTML = originalButtonText;
        }
    });

    document.addEventListener('DOMContentLoaded', async () => {
        const userIsValid = await fetchUserData();
        if (userIsValid) {
            // Tunggu data user dan paket selesai dimuat sebelum memuat daftar kompensasi
            await loadInitialData(); 
            loadActiveCompensations(); 
        }
    });
    </script>
</body>
</html>