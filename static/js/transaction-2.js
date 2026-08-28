/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/transaction.php (blok 2 dari 2) —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/transaction.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

    $(document).ready(function() {
      // Inisialisasi DataTable
      const dataTable = $('#dataTable').DataTable({
        ajax: '/api/payment',
        columns: [{
            data: 'reffId'
          },
          {
            data: 'trxId'
          },
          {
            data: 'sender'
          },
          {
            data: 'status'
          },
          {
            data: 'amount'
          },
          {
            data: 'method'
          },
          {
            data: 'ket'
          },
          {
            data: null,
            render: function(data, type, row) {
              return `
                  <button onclick="deleteData('${row.reffId}')" class="btn btn-danger">Hapus</button>
                  `;
            }
          }
        ]
      });

      window.deleteData = function(id) {
        if (confirm('Hapus catatan transaksi pembayaran ini? Nilainya akan hilang dari rekap pemasukan.')) $.ajax({
          url: '/api/payment/' + id,
          type: 'DELETE',
          success: function() {
            dataTable.ajax.reload();
          }
        });
      };
    });
  
