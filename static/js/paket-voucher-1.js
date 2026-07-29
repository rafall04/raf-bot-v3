/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/paket-voucher.php (blok 1 dari 2) —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/paket-voucher.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

        $(document).on('click', '.btn-edit', function() {
            const id = $(this).data('id');
            $('#editModal form').attr('action', '/api/voucher/' + encodeURIComponent(id));
            $('#editModal input#edit_prof').val($(this).data('prof'));
            $('#editModal input#edit_namavc').val($(this).data('namavc'));
            $('#editModal input#edit_durasivc').val($(this).data('durasivc'));
            $('#editModal input#edit_hargavc').val($(this).data('hargavc'));
            $('#editModal input#edit_hargaReseller').val($(this).data('hargareseller') || '');
        });
    
