/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/payment-method.php (blok 2 dari 2) —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/payment-method.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

    $(document).ready(function() {
      // Inisialisasi DataTable
      const dataTable = $('#dataTable').DataTable({
        ajax: '/api/payment-method',
        columns: [{
            data: 'id'
          },
          {
            data: 'name'
          },
          {
            data: 'category'
          },
          {
            data: null,
            render: function(data, type, row) {
              return `
                  <button class="btn btn-info btn-edit" data-id="${row.id}" data-name="${row.name}" data-category="${row.category}" data-toggle="modal" data-target="#editModal">Edit</button>
                  <button onclick="deleteData('${row.id}')" class="btn btn-danger">Hapus</button>
                  `;
            }
          }
        ]
      });

      window.deleteData = function(id) {
        if (confirm('Hapus metode pembayaran ini? Transaksi lama yang memakainya tetap tersimpan.')) $.ajax({
          url: '/api/payment-method/' + id,
          type: 'DELETE',
          success: function() {
            dataTable.ajax.reload();
          }
        });
      };
    });
  
