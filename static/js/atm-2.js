/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/atm.php (blok 2 dari 2) —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/atm.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

    $(document).ready(function() {
      // Inisialisasi DataTable
      const dataTable = $('#dataTable').DataTable({
        ajax: '/api/atm',
        columns: [{
            data: 'id'
          },
          {
            data: 'saldo'
          },
          {
            data: null,
            render: function(data, type, row) {
              return `
                  <button class="btn btn-info btn-edit" data-id="${row.id}" data-saldo="${row.saldo}" data-toggle="modal" data-target="#editModal">Edit</button>
                  <button onclick="deleteData('${row.id}')" class="btn btn-danger">Hapus</button>
                  `;
            }
          }
        ]
      });

      window.deleteData = function(id) {
        if (confirm('Are you sure you want to delete this')) $.ajax({
          url: '/api/atm/' + id,
          type: 'DELETE',
          success: function() {
            dataTable.ajax.reload();
          }
        });
      };
    });
  
