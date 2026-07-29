/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/packages.php (blok 1 dari 2) —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/packages.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

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
        profile: $('#create-profile').val(),
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
      $('#editModal input[name="profile"]').val($(this).data('profile'));
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
        profile: $('#editModal input[name="profile"]').val(),
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
  
