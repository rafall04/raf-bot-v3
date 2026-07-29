/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/payment-method.php (blok 1 dari 2) —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/payment-method.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

    $(document).on('click', '.btn-edit', function() {
      const id = $(this).data('id');
      $('#editModal form').attr('action', '/api/payment-method/' + id);
      $('#editModal input#id').val($(this).data('id'));
      $('#editModal input#name').val($(this).data('name'));
      $('#editModal input#category').val($(this).data('category'));
      $('#editModal input#fee').val($(this).data('fee'));
    });
  
