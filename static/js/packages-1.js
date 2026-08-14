/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/packages.php (blok 1 dari 2) —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/packages.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

    // ── Profil MikroTik: dipilih, bukan diketik ──────────────────────────────────────────────
    // Dulu field ini `<input type="text">` bebas. Salah ketik satu huruf membuat paket menunjuk
    // profil yang tak ada di router — dan kegagalannya SENYAP: paket tersimpan rapi, tapi
    // sinkronisasi profil pelanggan tak pernah cocok. Daftarnya diambil dari endpoint yang SUDAH
    // ada (`/api/mikrotik/ppp-profiles`, owner `routes/admin-wifi-ops-routes.js`).
    var PROFIL_MANUAL = '__manual__';
    // Sengaja ditaruh di `window`: `packages-2.js` (dimuat sesudah file ini) memakainya untuk
    // menandai paket yang menunjuk profil tak dikenal. null = belum/gagal dimuat — BUKAN array
    // kosong, karena "tak terbaca" tak boleh terlihat sama dengan "tak ada profil".
    window.profilRouter = null;

    function isiSelectProfil(sel, nilaiTersimpan) {
      var $sel = $(sel);
      var $manual = $sel.siblings('[data-profil-manual]');
      $sel.empty();

      if (!window.profilRouter) {
        // Router tak terbaca: JANGAN sodorkan dropdown kosong (itu tampak seperti "tak ada profil").
        // Turunkan ke isian manual + katakan apa adanya.
        $sel.append($('<option>').val('').text('— daftar profil tak terbaca —'));
        $sel.addClass('d-none');
        $manual.removeClass('d-none').val(nilaiTersimpan || '');
        return;
      }

      $sel.removeClass('d-none');
      $manual.addClass('d-none').val('');
      $sel.append($('<option>').val('').text('— pilih profil —'));
      window.profilRouter.forEach(function (nama) {
        $sel.append($('<option>').val(nama).text(nama));
      });

      // Nilai tersimpan yang TIDAK ada di router tetap ditampilkan & terpilih — jangan diam-diam
      // mengubah data paket yang sudah jalan hanya karena sedang membuka form. Ditandai supaya
      // ketidakcocokannya terlihat.
      if (nilaiTersimpan && window.profilRouter.indexOf(nilaiTersimpan) === -1) {
        $sel.append($('<option>').val(nilaiTersimpan).text('⚠ ' + nilaiTersimpan + ' — tidak ada di router'));
      }
      $sel.append($('<option>').val(PROFIL_MANUAL).text('… ketik manual'));
      $sel.val(nilaiTersimpan || '');
    }

    // Satu sumber nilai: manual bila dipilih, selain itu isi dropdown.
    function ambilProfil(sel) {
      var $sel = $(sel);
      var $manual = $sel.siblings('[data-profil-manual]');
      if ($sel.hasClass('d-none') || $sel.val() === PROFIL_MANUAL) return ($manual.val() || '').trim();
      return $sel.val() || '';
    }

    $(document).on('change', '[data-profil-select]', function () {
      var $manual = $(this).siblings('[data-profil-manual]');
      if ($(this).val() === PROFIL_MANUAL) $manual.removeClass('d-none').focus();
      else $manual.addClass('d-none').val('');
    });

    function muatProfilRouter() {
      return $.ajax({ url: '/api/mikrotik/ppp-profiles', method: 'GET' })
        .then(function (res) {
          var arr = (res && res.data) || [];
          window.profilRouter = arr.map(function (p) { return typeof p === 'string' ? p : (p && p.name); })
            .filter(Boolean);
          $('#create-profile-note, #profile-note').text(
            'Diambil langsung dari router (' + window.profilRouter.length + ' profil). Pilih, jangan diketik.');
          // Tabel sudah tergambar sebelum fetch ini selesai — minta gambar ulang supaya penanda
          // "profil tak ada di router" ikut muncul di kolom Profil.
          $(document).trigger('profil-router-siap');
        })
        .catch(function () {
          window.profilRouter = null;
          $('#create-profile-note, #profile-note')
            .text('Daftar profil tak terbaca dari router — isi manual, dan pastikan namanya persis.');
        });
    }

    $(function () {
      muatProfilRouter().always(function () { isiSelectProfil('#create-profile', ''); });
    });

    // Handle create form submission
    $('#createForm').on('submit', function(e) {
      e.preventDefault();
      const submitBtn = $(this).find('.btn-primary');
      const originalText = submitBtn.html();
      
      // Add loading state
      submitBtn.addClass('btn-loading').prop('disabled', true);
      
      const formData = {
        name: $('#create-name').val(),
        price: $('#create-price').val(),
        profile: ambilProfil('#create-profile'),
        displayProfile: $('#create-displayProfile').val(),
        description: $('#create-description').val(),
        showInMonthly: $('#create-showInMonthly').is(':checked'),
        whitelist: $('#create-whitelist').is(':checked')
      };
      
      $.ajax({
        url: '/api/packages',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(formData),
        success: function(response) {
          $('#createModal').addClass('success');
          setTimeout(() => {
            $('#createModal').modal('hide').removeClass('success');
            $('#dataTable').DataTable().ajax.reload();
            // Reset form
            $('#createForm')[0].reset();
            $('#create-showInMonthly').prop('checked', true); // Default checked
          }, 500);
          
          // Modern toast notification
          Swal.fire({
            icon: 'success',
            title: 'Berhasil!',
            text: 'Paket berhasil ditambahkan',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true
          });
        },
        error: function(xhr) {
          $('#createModal').addClass('error');
          setTimeout(() => $('#createModal').removeClass('error'), 500);
          
          Swal.fire({
            icon: 'error',
            title: 'Gagal!',
            text: xhr.responseJSON?.message || 'Gagal menambahkan paket',
            confirmButtonColor: '#667eea'
          });
        },
        complete: function() {
          submitBtn.removeClass('btn-loading').prop('disabled', false).html(originalText);
        }
      });
    });
    
    $(document).on('click', '.btn-edit', function() {
      const id = $(this).data('id');

      $('#editForm').data('package-id', id);
      $('#editModal input[name="name"]').val($(this).data('name'));
      $('#editModal input[name="price"]').val($(this).data('price'));
      // Dropdown diisi ULANG tiap kali modal dibuka: nilai tersimpan harus jadi yang terpilih,
      // termasuk bila profil itu sudah tak ada di router (ditandai, bukan dibuang diam-diam).
      isiSelectProfil('#profile', String($(this).data('profile') || ''));
      $('#editModal input[name="displayProfile"]').val($(this).data('display-profile'));
      $('#editModal textarea[name="description"]').val($(this).data('description'));
      $('#editModal input[name="showInMonthly"]').prop('checked', $(this).data('show-in-monthly') !== false);
      $('#editModal input[name="whitelist"]').prop('checked', $(this).data('whitelist') == true);
    });
    
    // Handle edit form submission
    $('#editForm').on('submit', function(e) {
      e.preventDefault();
      const packageId = $(this).data('package-id');
      const submitBtn = $(this).find('.btn-primary');
      const originalText = submitBtn.html();
      
      // Add loading state
      submitBtn.addClass('btn-loading').prop('disabled', true);
      
      const formData = {
        name: $('#editModal input[name="name"]').val(),
        price: $('#editModal input[name="price"]').val(),
        profile: ambilProfil('#profile'),
        displayProfile: $('#editModal input[name="displayProfile"]').val(),
        description: $('#editModal textarea[name="description"]').val(),
        showInMonthly: $('#editModal input[name="showInMonthly"]').is(':checked'),
        whitelist: $('#editModal input[name="whitelist"]').is(':checked')
      };
      
      $.ajax({
        url: '/api/packages/' + packageId,
        type: 'PUT',
        contentType: 'application/json',
        data: JSON.stringify(formData),
        success: function(response) {
          $('#editModal').addClass('success');
          setTimeout(() => {
            $('#editModal').modal('hide').removeClass('success');
            $('#dataTable').DataTable().ajax.reload();
          }, 500);
          
          // Modern toast notification
          Swal.fire({
            icon: 'success',
            title: 'Berhasil!',
            text: 'Paket berhasil diperbarui',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true
          });
        },
        error: function(xhr) {
          $('#editModal').addClass('error');
          setTimeout(() => $('#editModal').removeClass('error'), 500);
          
          Swal.fire({
            icon: 'error',
            title: 'Gagal!',
            text: xhr.responseJSON?.message || 'Gagal memperbarui paket',
            confirmButtonColor: '#667eea'
          });
        },
        complete: function() {
          submitBtn.removeClass('btn-loading').prop('disabled', false).html(originalText);
        }
      });
    });
  
