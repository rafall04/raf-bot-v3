/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/statik.php (blok 1 dari 2) —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/statik.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

    $(document).on('click', '.btn-edit', function() {
      const id = $(this).data('id');
      $('#editModal form').attr('action', '/api/statik/' + id);
      $('#editModal input#prof').val($(this).data('prof'));
      $('#editModal input#limitat').val($(this).data('limitat'));
      $('#editModal input#maxlimit').val($(this).data('maxlimit'));
    });
  
