<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>View Invoice</title>
    <style>
        @media print {
            .no-print {
                display: none !important;
            }
            body {
                margin: 0;
                padding: 0;
            }
            .invoice-wrapper {
                max-width: 100% !important;
                box-shadow: none !important;
            }
        }
        
        body {
            font-family: Arial, sans-serif;
            background: #f5f5f5;
            margin: 0;
            padding: 20px;
        }
        
        .print-toolbar {
            background: white;
            padding: 15px;
            margin-bottom: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .print-toolbar button {
            background: #4e73df;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        
        .print-toolbar button:hover {
            background: #2e59d9;
        }
        
        .btn-secondary {
            background: #6c757d !important;
        }
        
        .btn-secondary:hover {
            background: #5a6268 !important;
        }
        
        .invoice-wrapper {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            box-shadow: 0 0 20px rgba(0,0,0,0.1);
        }
        
        .loading {
            text-align: center;
            padding: 50px;
            color: #666;
        }
        
        .error {
            text-align: center;
            padding: 50px;
            color: #dc3545;
        }
    </style>
</head>
<body>
    <div class="print-toolbar no-print">
        <div>
            <button onclick="window.print()">
                <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M2.5 8a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z"/>
                    <path d="M5 1a2 2 0 0 0-2 2v2H2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1v1a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1V3a2 2 0 0 0-2-2H5zM4 3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2H4V3zm1 5a2 2 0 0 0-2 2v1H2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v-1a2 2 0 0 0-2-2H5zm7 2v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1z"/>
                </svg>
                Cetak Invoice
            </button>
            <button onclick="downloadPDF()" style="background: #28a745;">
                <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                    <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
                </svg>
                Download PDF
            </button>
        </div>
        <button onclick="window.close()" class="btn-secondary">
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
            </svg>
            Tutup
        </button>
    </div>
    
    <div class="invoice-wrapper">
        <div id="invoiceContent" class="loading">
            <div>Loading invoice...</div>
        </div>
    </div>
    
    <script>
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
    </script>
</body>
</html>
