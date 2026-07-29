/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/kompensasi.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/kompensasi.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

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

        // Escape HTML untuk cegah XSS saat merender data pelanggan (mis. nama) via innerHTML.
        function escapeHtml(value) {
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
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
                        div.innerHTML = `<span>${escapeHtml(customer.name)} (ID: ${escapeHtml(customer.id)}, PPPoE: ${escapeHtml(customer.pppoe_username || 'N/A')})</span><button type="button" class="btn btn-sm btn-outline-primary add-customer-btn">Tambah</button>`;
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
                    div.innerHTML = `<span>${escapeHtml(customer.name)} (ID: ${escapeHtml(customer.id)}, PPPoE: ${escapeHtml(customer.pppoe_username || 'N/A')})</span><button type="button" class="btn btn-sm btn-danger btn-remove-customer"><i class="fas fa-trash"></i></button>`;
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
    
