/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/index.php (blok 1 dari 2) —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/index.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

            // Fallback: Fetch dari API jika name masih 'User'
            (function() {
                if (document.getElementById('topbarUserName').textContent === 'User') {
                    fetch('/api/me', { credentials: 'include' })
                        .then(response => response.json())
                        .then(data => {
                            if (data.status === 200 && data.data && data.data.name) {
                                document.getElementById('topbarUserName').textContent = data.data.name;
                            }
                        })
                        .catch(err => console.warn('Failed to fetch user name from API:', err));
                }
            })();
            
