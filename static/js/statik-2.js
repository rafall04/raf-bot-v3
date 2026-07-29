/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/statik.php (blok 2 dari 2) —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/statik.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

    $(document).ready(function() {
      // Inisialisasi DataTable
      const dataTable = $('#dataTable').DataTable({
        ajax: '/api/statik',
        columns: [{
            data: 'prof'
          },
          {
            data: 'limitat'
          },
          {
            data: 'maxlimit'
          },
          {
            data: null,
            render: function(data, type, row) {
              return `
                  <button class="btn btn-info btn-edit" data-id="${row.prof}" data-prof="${row.prof}" data-limitat="${row.limitat}" data-maxlimit="${row.maxlimit}" data-toggle="modal" data-target="#editModal">Edit</button>
                  <button onclick="deleteData('${row.prof}')" class="btn btn-danger">Hapus</button>
                  `;
            }
          }
        ]
      });

      window.deleteData = function(id) {
        if (confirm('Are you sure you want to delete this')) $.ajax({
          url: '/api/statik/' + id,
          type: 'DELETE',
          success: function() {
            dataTable.ajax.reload();
          }
        });
      };
    });
  
