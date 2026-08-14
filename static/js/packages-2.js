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
            // Profil yang TIDAK ada di router ditandai di sini. Tanpa ini, paket yang menunjuk
            // profil salah-ketik terlihat normal — kegagalannya baru terasa saat sinkronisasi
            // profil pelanggan diam-diam tak pernah cocok. `profilRouter` disediakan packages-1.js
            // (dimuat lebih dulu); `null` = daftar belum/gagal terbaca, jadi JANGAN menuduh apa pun.
            data: 'profile',
            render: function (data) {
              var nilai = data || '';
              if (!nilai) return '<span class="text-muted">—</span>';
              var daftar = window.profilRouter || null;
              if (!daftar) return nilai;
              if (daftar.indexOf(nilai) !== -1) return nilai;
              return '<span class="text-danger" title="Profil ini tidak ditemukan di router">'
                + '<i class="fas fa-exclamation-triangle"></i> ' + nilai + '</span>';
            }
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

      // Daftar profil router tiba SESUDAH tabel tergambar (dua fetch terpisah). Tanpa gambar-ulang
      // ini, penanda "profil tak ada di router" baru muncul saat tabel kebetulan di-reload.
      // `invalidate()` WAJIB: DataTables menyimpan hasil render tiap sel, jadi `draw()` sendirian
      // menggambar ulang baris TANPA memanggil ulang fungsi render — terukur 0 penanda vs 1.
      $(document).on('profil-router-siap', function () {
        try { dataTable.rows().invalidate().draw(false); } catch (_e) { /* tabel belum siap */ }
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
  
