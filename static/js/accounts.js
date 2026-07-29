/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/accounts.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/accounts.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

    $(document).ready(function() {
      // Check if SweetAlert2 is loaded
      if (typeof Swal === 'undefined') {
        console.error('[ACCOUNTS_PAGE] SweetAlert2 not loaded!');
        // Fallback: try to load again with explicit HTTPS
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/sweetalert2@11';
        script.onload = function() {
          console.log('[ACCOUNTS_PAGE] SweetAlert2 loaded successfully');
          initializeHandlers();
        };
        script.onerror = function() {
          console.error('[ACCOUNTS_PAGE] Failed to load SweetAlert2');
          alert('Warning: Popup library tidak dapat dimuat. Beberapa fitur mungkin tidak berfungsi dengan baik.');
        };
        document.head.appendChild(script);
      } else {
        console.log('[ACCOUNTS_PAGE] SweetAlert2 already loaded');
        initializeHandlers();
      }
    });

    // Helper function to ensure Swal is available
    function safeSwalFire(options) {
      if (typeof Swal === 'undefined') {
        console.error('[SAFE_SWAL] SweetAlert2 not available, using fallback');
        // Fallback to native alert/confirm
        if (options.showCancelButton) {
          // For confirm dialogs
          const confirmed = confirm((options.title || 'Konfirmasi') + '\n\n' + (options.text || ''));
          return Promise.resolve({ isConfirmed: confirmed, isDenied: false, isDismissed: !confirmed });
        } else {
          // For alert dialogs
          if (options.title && options.text) {
            alert(options.title + ': ' + options.text);
          } else if (options.text) {
            alert(options.text);
          } else if (options.title) {
            alert(options.title);
          }
          return Promise.resolve({ isConfirmed: true });
        }
      }
      return Swal.fire(options);
    }

    function initializeHandlers() {
      console.log('[ACCOUNTS_PAGE] Initializing handlers');
      
      // Setup edit button click handler (use event delegation for dynamic content)
      $(document).off('click', '.btn-edit').on('click', '.btn-edit', function() {
        const id = $(this).data('id');
        console.log('[BTN_EDIT] Button clicked, ID:', id);
        
        if (!id) {
          console.error('[BTN_EDIT] No ID found in button data');
          safeSwalFire({
            title: 'Error!',
            text: 'ID akun tidak ditemukan. Silakan refresh halaman.',
            icon: 'error'
          });
          return;
        }
        
        // Clear the password field every time the modal is opened
        $('#editModal input#edit-password').val('');

        // Set form action with account ID
        const actionUrl = '/api/accounts/' + id;
        const form = $('#editAccountForm');
        form.attr('action', actionUrl);
        console.log('[BTN_EDIT] Form action set to:', actionUrl);
        console.log('[BTN_EDIT] Form element:', form.length > 0 ? 'Found' : 'NOT FOUND');
        
        // Note: There is no input with id="id" in the modal, so this line is ineffective but harmless.
        // $('#editModal input#id').val($(this).data('id'));
        $('#editModal input#edit-username').val($(this).data('username') || '');
        $('#editModal input#edit-name').val($(this).data('name') || '');
        $('#editModal input#edit-phone_number').val($(this).data('phone_number') || '');
        $('#editModal select#edit-role').val($(this).data('role') || '');
        
        console.log('[BTN_EDIT] Form fields populated');
      });
      // Handle Create Account Form Submission
      $('#createAccountForm').on('submit', function(e) {
        e.preventDefault(); // Prevent default form submission

        const form = $(this);
        const url = form.attr('action');
        const method = form.attr('method');
        const data = form.serialize();
        const submitBtn = form.find('button[type="submit"]');
        const originalBtnText = submitBtn.html();

        // Disable submit button
        submitBtn.prop('disabled', true);
        submitBtn.html('<i class="fas fa-spinner fa-spin"></i> Menyimpan...');

        $.ajax({
          url: url,
          type: method,
          data: data,
          success: function(response) {
            // Check if response has success field or status field
            const isSuccess = (response.success === true) || (response.status === 200 || response.status === 201);
            const message = response.message || 'Akun baru telah berhasil ditambahkan.';

            if (isSuccess) {
              $('#createModal').modal('hide');
              // Clear the form fields
              form.trigger('reset');
              safeSwalFire({
                title: 'Berhasil!',
                text: message,
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
              });
              dataTable.ajax.reload();
            } else {
              // Response tidak sukses meskipun status 200
              safeSwalFire({
                title: 'Gagal!',
                text: message || 'Terjadi kesalahan saat menambahkan akun.',
                icon: 'error'
              });
            }
          },
          error: function(jqXHR, textStatus, errorThrown) {
            console.error('Error creating account:', jqXHR, textStatus, errorThrown);
            // Extract error message from server response if available
            const errorMessage = (jqXHR.responseJSON && jqXHR.responseJSON.message) 
              ? jqXHR.responseJSON.message 
              : 'Terjadi kesalahan saat menambahkan akun.';
            safeSwalFire({
              title: 'Gagal!',
              text: errorMessage,
              icon: 'error'
            });
          },
          complete: function() {
            // Re-enable submit button
            submitBtn.prop('disabled', false);
            submitBtn.html(originalBtnText);
          }
        });
      });

      // Inisialisasi DataTable
      const dataTable = $('#dataTable').DataTable({
        ajax: '/api/accounts',
        columns: [{
            data: 'id'
          },
          {
            data: 'username'
          },
          {
            data: 'name',
            defaultContent: '-'
          },
          {
            data: 'phone_number'
          },
          {
            data: 'role'
          },
          {
            data: null,
            render: function(data, type, row) {
              // Remove data-password attribute from the button
              return `
                  <button class="btn btn-info btn-edit" data-id="${row.id}" data-username="${row.username}" data-name="${row.name || ''}" data-phone_number="${row.phone_number}" data-role="${row.role}" data-toggle="modal" data-target="#editModal">Edit</button>
                  <button onclick="deleteData('${row.id}')" class="btn btn-danger">Hapus</button>
                  `;
            }
          }
        ]
      });

      // Handle Edit Account Form Submission
      // Remove any existing handler first to prevent duplicates
      $(document).off('submit', '#editAccountForm');
      // Use event delegation to ensure handler is always attached
      $(document).on('submit', '#editAccountForm', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[EDIT_ACCOUNT_FORM] Form submitted - Handler triggered');

        const form = $(this);
        const url = form.attr('action');
        const data = form.serialize();
        const submitBtn = form.find('button[type="submit"]');
        const originalBtnText = submitBtn.html();

        // Validate URL
        if (!url || url === '' || url === '/api/accounts/') {
          console.error('[EDIT_ACCOUNT_FORM] Invalid URL:', url);
          safeSwalFire({
            title: 'Gagal!',
            text: 'URL tidak valid. Silakan tutup modal dan coba lagi.',
            icon: 'error'
          });
          return;
        }

        console.log('[EDIT_ACCOUNT_FORM] Submitting to:', url);
        console.log('[EDIT_ACCOUNT_FORM] Data:', data);

        // Disable submit button
        submitBtn.prop('disabled', true);
        submitBtn.html('<i class="fas fa-spinner fa-spin"></i> Menyimpan...');

        $.ajax({
          url: url,
          type: 'POST',
          data: data,
          success: function(response) {
            console.log('[EDIT_ACCOUNT_FORM] Success response:', response);
            // Check if response has success field or status field
            const isSuccess = (response.success === true) || (response.status === 200 || response.status === 201);
            const message = response.message || 'Akun telah berhasil diperbarui.';

            if (isSuccess) {
              $('#editModal').modal('hide');
              form.trigger('reset');
              // Clear form action to prevent accidental resubmit
              form.attr('action', '');
              safeSwalFire({
                title: 'Berhasil!',
                text: message,
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
              }).then(() => {
                dataTable.ajax.reload();
              });
            } else {
              // Response tidak sukses meskipun status 200
              console.warn('[EDIT_ACCOUNT_FORM] Response not successful:', response);
              safeSwalFire({
                title: 'Gagal!',
                text: message || 'Terjadi kesalahan saat memperbarui akun.',
                icon: 'error'
              });
            }
          },
          error: function(jqXHR, textStatus, errorThrown) {
            console.error('[EDIT_ACCOUNT_FORM] Error updating account:', {
              status: jqXHR.status,
              statusText: jqXHR.statusText,
              responseText: jqXHR.responseText,
              responseJSON: jqXHR.responseJSON,
              textStatus: textStatus,
              errorThrown: errorThrown
            });
            const errorMessage = (jqXHR.responseJSON && jqXHR.responseJSON.message) 
              ? jqXHR.responseJSON.message 
              : 'Terjadi kesalahan saat memperbarui akun.';
            safeSwalFire({
              title: 'Gagal!',
              text: errorMessage,
              icon: 'error'
            });
          },
          complete: function() {
            console.log('[EDIT_ACCOUNT_FORM] Request completed');
            // Re-enable submit button
            submitBtn.prop('disabled', false);
            submitBtn.html(originalBtnText);
          }
        });
      });

      window.deleteData = function(id) {
        safeSwalFire({
          title: 'Anda yakin?',
          text: "Anda tidak akan dapat mengembalikan ini!",
          icon: 'warning',
          showCancelButton: true,
          confirmButtonColor: '#3085d6',
          cancelButtonColor: '#d33',
          confirmButtonText: 'Ya, hapus!',
          cancelButtonText: 'Batal'
        }).then((result) => {
          if (result.isConfirmed) {
            $.ajax({
              url: '/api/accounts/' + id,
              type: 'DELETE',
              success: function(result) {
                safeSwalFire({
                  title: 'Dihapus!',
                  text: 'Akun telah berhasil dihapus.',
                  icon: 'success'
                }).then(() => {
                  dataTable.ajax.reload();
                });
              },
              error: function (jqXHR, textStatus, errorThrown) {
                safeSwalFire({
                  title: 'Gagal!',
                  text: 'Terjadi kesalahan saat menghapus akun.',
                  icon: 'error'
                });
              }
            });
          }
        })
      };
    } // End of initializeHandlers function
  
