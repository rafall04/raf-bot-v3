/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/packages.php (blok 2 dari 2) —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/packages.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

    $(document).ready(function() {
      // Inisialisasi DataTable
      const dataTable = $('#dataTable').DataTable({
        ajax: '/api/packages',
        columns: [{
            data: 'name'
          },
          {
            data: 'price',
            render: function(data) {
              return 'Rp ' + new Intl.NumberFormat('id-ID').format(data);
            }
          },
          {
            data: 'profile'
          },
          {
            data: 'description',
            render: function(data) {
              return data || '<span class="text-muted">Tidak ada deskripsi</span>';
            }
          },
          {
            data: null,
            render: function(data, type, row){
              const showInMonthly = row.showInMonthly !== false;
              return showInMonthly ? '<span class="badge badge-success">Ya</span>' : '<span class="badge badge-secondary">Tidak</span>';
            }
          },
          {
            data: null,
            render: function(data, type, row){
              return row.whitelist ? '<span class="badge badge-success">Ya</span>' : '<span class="badge badge-secondary">Tidak</span>';
            }
          },
          {
            data: null,
            render: function(data, type, row) {
              return `
                  <button class="btn btn-info btn-edit"
                          data-id="${row.id}"
                          data-name="${row.name}"
                          data-price="${row.price}"
                          data-profile="${row.profile}"
                          data-display-profile="${row.displayProfile}"
                          data-description="${row.description}"
                          data-show-in-monthly="${row.showInMonthly}"
                          data-whitelist="${row.whitelist}"
                          data-toggle="modal"
                          data-target="#editModal">Edit</button>
                  <button onclick="deleteData('${row.id}')" class="btn btn-danger">Hapus</button>
                  `;
            }
          }
        ]
      });

      window.deleteData = function(id) {
        if (confirm('Are you sure you want to delete this')) $.ajax({
          url: '/api/packages/' + id,
          type: 'DELETE',
          success: function() {
            dataTable.ajax.reload();
          }
        });
      };
    });
  
