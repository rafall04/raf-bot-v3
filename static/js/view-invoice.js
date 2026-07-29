/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/view-invoice.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/view-invoice.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

        // Get invoice ID from URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const invoiceId = urlParams.get('id');
        const userId = urlParams.get('userId');
        
        if (!invoiceId || !userId) {
            document.getElementById('invoiceContent').innerHTML = '<div class="error">Invalid invoice parameters</div>';
        } else {
            // Load invoice HTML
            loadInvoice();
        }
        
        async function loadInvoice() {
            try {
                const response = await fetch('/api/view-invoice?id=${invoiceId}&userId=${userId}', { credentials: 'include' });
                if (!response.ok) {
                    throw new Error('Failed to load invoice');
                }
                
                const html = await response.text();
                document.getElementById('invoiceContent').innerHTML = html;
                
                // Update page title
                const invoiceNumber = document.querySelector('.invoice-number');
                if (invoiceNumber) {
                    document.title = `Invoice ${invoiceNumber.textContent}`;
                }
            } catch (error) {
                document.getElementById('invoiceContent').innerHTML = `<div class="error">Error loading invoice: ${error.message}</div>`;
            }
        }
        
        async function downloadPDF() {
            try {
                const response = await fetch('/api/download-invoice-pdf?id=${invoiceId}&userId=${userId}', { credentials: 'include' });
                if (!response.ok) {
                    throw new Error('Failed to generate PDF');
                }
                
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Invoice_${invoiceId}.pdf`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            } catch (error) {
                alert('Error downloading PDF: ' + error.message);
            }
        }
    
