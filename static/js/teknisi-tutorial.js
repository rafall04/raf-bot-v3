/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/teknisi-tutorial.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/teknisi-tutorial.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

        document.querySelectorAll('.tut .cmd').forEach(function (el) {
            el.addEventListener('click', function () {
                var text = el.getAttribute('data-copy') || el.textContent;
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(text).then(function () {
                        el.classList.add('copied');
                        setTimeout(function () { el.classList.remove('copied'); }, 1400);
                    }).catch(function () {});
                }
            });
        });
        document.querySelectorAll('.tut .jump a').forEach(function (a) {
            a.addEventListener('click', function (e) {
                var t = document.querySelector(a.getAttribute('href'));
                if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
            });
        });
    
