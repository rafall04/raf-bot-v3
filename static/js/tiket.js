        let currentUser = null;
        let ticketsCache = {}; // Store tickets for safe access
        
        fetch('/api/me', { credentials: 'include' }).then(response => response.json()).then(data => {
            if (data.status === 200 && data.data) {
                document.getElementById('username-placeholder').textContent = data.data.username;
                currentUser = data.data;
            }
        });

        function displayGlobalAdminMessage(message, type = 'info') {
             const globalMessageDiv = document.getElementById('globalAdminMessage');
            globalMessageDiv.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show" role="alert">
                ${message}
                <button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>
            </div>`;
            setTimeout(() => { if (globalMessageDiv.querySelector('.alert')) $(globalMessageDiv.querySelector('.alert')).alert('close'); }, 7000);
        }
        function escapeHtml(value) { return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
        function formatTicketDetailsAdmin(d) { return d ? `Nama: ${escapeHtml(d.name||'N/A')}\nAlamat: ${escapeHtml(d.address||'N/A')}\nPaket: ${escapeHtml(d.subscription||'N/A')}\nPPPoE: ${escapeHtml(d.pppoe_username||'N/A')}` : 'N/A';}
        // Kosakata kanonik server (lib/ticket-workflow.js FINAL_STATUSES):
        //   baru · process · otw · arrived · working · completed · cancelled
        //
        // !! DULU normalizer ini MELEWATKAN status yang tak dikenalnya apa adanya, sehingga
        // ejaan lama seperti `dibatalkan`/`batal`/`closed` lolos dan `canCancel` tetap true —
        // tombol Batalkan muncul di tiket yang sudah dibatalkan (#b265). Sekarang tiap ejaan
        // yang pernah ditulis dipetakan; yang benar-benar asing dipulangkan apa adanya DAN
        // dicatat di console supaya ketahuan, bukan menghilang.
        function normalizeTicketStatusAdmin(status) {
            const s = (status || '').toLowerCase().trim();
            if (!s) return 'baru';

            const PETA = {
                'selesai': 'completed', 'resolved': 'completed', 'done': 'completed',
                'closed': 'completed',
                'diproses teknisi': 'process', 'diproses': 'process',
                'dibatalkan': 'cancelled', 'batal': 'cancelled', 'canceled': 'cancelled',
                'cancel': 'cancelled', 'dibatalkan admin': 'cancelled',
                'dibatalkan pelanggan': 'cancelled',
                'open': 'baru', 'new': 'baru', 'pending': 'baru'
            };
            if (PETA[s]) return PETA[s];
            if (s.includes('dibatalkan')) return 'cancelled';

            const KANONIK = ['baru', 'process', 'otw', 'arrived', 'working', 'completed', 'cancelled'];
            if (KANONIK.indexOf(s) !== -1) return s;

            console.warn('[TIKET] status asing dari server: "' + s + '" — tombol aksi mungkin salah. Tambahkan pemetaannya.');
            return s;
        }

        function getTicketTechnicianPhotoCount(ticket) {
            if (typeof ticket.teknisiPhotoCount === 'number') return ticket.teknisiPhotoCount;
            if (Array.isArray(ticket.teknisiPhotos) && ticket.teknisiPhotos.length > 0) return ticket.teknisiPhotos.length;
            if (Array.isArray(ticket.completionPhotos) && ticket.completionPhotos.length > 0) return ticket.completionPhotos.length;
            if (Array.isArray(ticket.photos) && ticket.photos.length > 0) return ticket.photos.length;
            return 0;
        }

        function getCompletedByDisplay(ticket) {
            let completedByText = ticket.teknisiName || ticket.completedByName || ticket.completedBy || ticket.resolvedByTeknisiName || '-';
            const completedAt = ticket.completedAt || ticket.resolvedAt;

            if (completedAt && completedByText !== '-') {
                completedByText += ` <small class="text-muted">(${new Date(completedAt).toLocaleDateString('id-ID', {day:'2-digit',month:'short'})})</small>`;
            }

            return completedByText;
        }

        function getStatusBadgeAdmin(s) { 
            const status = normalizeTicketStatusAdmin(s);
            
            // Per TICKET_STATUS_STANDARD.md
            if (status === 'baru') return '<span class="badge badge-status-baru">Baru</span>';
            
            if (status === 'process' || status === 'diproses teknisi') {
                return '<span class="badge badge-status-process">Process</span>';
            }
            
            if (status === 'otw') return '<span class="badge badge-status-otw">OTW</span>';
            
            if (status === 'arrived') return '<span class="badge badge-status-arrived">Arrived</span>';
            
            if (status === 'working') return '<span class="badge badge-status-working">Working</span>';
            
            if (status === 'completed') {
                return '<span class="badge badge-status-resolved">Selesai</span>';
            }
            
            if (status === 'cancelled') {
                return '<span class="badge badge-status-cancelled">Dibatalkan</span>';
            }
            
            // Default for unknown status
            return `<span class="badge badge-secondary">${s || 'N/A'}</span>`;
        }
        
        function showTicketDetailById(ticketId) {
            const ticket = ticketsCache[ticketId];
            if (!ticket) {
                console.error('Ticket not found in cache:', ticketId);
                return;
            }
            showTicketDetail(ticket);
        }
        
        function showTicketDetail(ticket) {
            // Open detail modal with full ticket information
            const detailModal = $('#ticketDetailModal');
            if (!detailModal.length) {
                console.error('Detail modal not found');
                return;
            }
            
            // Populate modal with ticket data
            $('#detail-ticketId').text(ticket.ticketId || '-');
            const authoritativeStatus = ticket.normalizedStatus || ticket.status;
            $('#detail-status').html(getStatusBadgeAdmin(authoritativeStatus));
            
            // Smart customer name resolution - check ALL possible fields
            const customerName = ticket.pelangganName || 
                               ticket.pelangganPushName || 
                               (ticket.pelangganDataSystem ? ticket.pelangganDataSystem.name : null) ||
                               'Customer';
            $('#detail-customer').text(customerName);
            $('#detail-report').text(ticket.laporanText || '-');
            $('#detail-otp').text(ticket.otp || '-');
            $('#detail-teknisi').text(ticket.teknisiName || '-');
            $('#detail-created').text(ticket.createdAt ? new Date(ticket.createdAt).toLocaleString('id-ID') : '-');
            
            // Show photos if available
            const photoContainer = $('#detail-photos');
            photoContainer.empty();
            
            // Collect ALL photos from various sources
            let allPhotos = [];
            
            // 1. Collect photos from customerPhotos field (Customer uploads during report)
            if (ticket.customerPhotos && ticket.customerPhotos.length > 0) {
                ticket.customerPhotos.forEach(photo => {
                    // Handle both object format with path field or just filename
                    if (typeof photo === 'object') {
                        // photo.path contains FULL system path, need to extract web path
                        let webPath = photo.path;
                        
                        // If path contains full system path, extract uploads/... part
                        if (webPath && webPath.includes('uploads')) {
                            const uploadsIndex = webPath.indexOf('uploads');
                            webPath = '/' + webPath.substring(uploadsIndex).replace(/\\/g, '/');
                        } else {
                            // Fallback: construct path from filename
                            webPath = `/uploads/reports/${photo.fileName}`;
                        }
                        
                        const customerPhoto = {
                            type: 'customer',
                            path: webPath,
                            filename: photo.fileName || photo.filename,
                            label: 'Foto Pelanggan'
                        };
                        allPhotos.push(customerPhoto);
                    } else {
                        // If it's a string, check if it's full path or web path
                        let webPath = photo;
                        if (webPath.includes('uploads')) {
                            const uploadsIndex = webPath.indexOf('uploads');
                            webPath = '/' + webPath.substring(uploadsIndex).replace(/\\/g, '/');
                        }
                        
                        const customerPhoto = {
                            type: 'customer',
                            path: webPath,
                            filename: webPath.split('/').pop(),
                            label: 'Foto Pelanggan'
                        };
                        allPhotos.push(customerPhoto);
                    }
                });
            }
            
            // 2. Collect photos from teknisiPhotos field (WhatsApp uploads + Web create ticket uploads)
            // IMPORTANT: Skip photos that are already in photos field to avoid duplicates
            if (ticket.teknisiPhotos && ticket.teknisiPhotos.length > 0) {
                // Get list of filenames already in photos field (to avoid duplicates)
                const photosFilenames = new Set();
                if (ticket.photos && Array.isArray(ticket.photos)) {
                    ticket.photos.forEach(p => {
                        if (typeof p === 'object' && p.fileName) {
                            photosFilenames.add(p.fileName);
                        } else if (typeof p === 'object' && p.filename) {
                            photosFilenames.add(p.filename);
                        } else if (typeof p === 'string') {
                            photosFilenames.add(p);
                        }
                    });
                }
                
                // Get year and month from ticket creation date for structured path
                const ticketDate = ticket.createdAt ? new Date(ticket.createdAt) : new Date();
                const year = ticketDate.getFullYear();
                const month = String(ticketDate.getMonth() + 1).padStart(2, '0');
                
                ticket.teknisiPhotos.forEach(photo => {
                    // Handle both object format (from create ticket) and string format (from WhatsApp)
                    let photoFileName = null;
                    let photoPath = null;
                    let photoCategory = null;
                    let photoCategoryLabel = null;
                    
                    if (typeof photo === 'object' && photo.fileName) {
                        // Object format from create ticket upload
                        photoFileName = photo.fileName;
                        photoPath = photo.path;
                        photoCategory = photo.category;
                        photoCategoryLabel = photo.categoryLabel;
                        
                        // Skip if this photo is already in photos field (to avoid duplicates)
                        if (photosFilenames.has(photoFileName)) {
                            return; // Skip duplicate
                        }
                    } else if (typeof photo === 'string') {
                        // String format from WhatsApp upload
                        photoFileName = photo;
                        
                        // Skip if this photo is already in photos field (to avoid duplicates)
                        if (photosFilenames.has(photoFileName)) {
                            return; // Skip duplicate
                        }
                        
                        // Construct path for string format
                        photoPath = `/uploads/reports/${year}/${month}/${ticket.ticketId}/${photoFileName}`;
                    } else {
                        // Unknown format, skip
                        return;
                    }
                    
                    // If path not provided, construct it
                    if (!photoPath) {
                        photoPath = `/uploads/reports/${year}/${month}/${ticket.ticketId}/${photoFileName}`;
                    }
                    
                    allPhotos.push({
                        type: 'teknisi',
                        path: photoPath,
                        filename: photoFileName,
                        label: photoCategoryLabel || 'Foto Teknisi',
                        category: photoCategory
                    });
                });
            }
            
            // 3. Collect photos from photos field (Web Dashboard uploads) - WITH CATEGORY SUPPORT
            if (ticket.photos && ticket.photos.length > 0) {
                // Get year and month from ticket creation date for structured path (if path not already structured)
                const ticketDate = ticket.createdAt ? new Date(ticket.createdAt) : new Date();
                const year = ticketDate.getFullYear();
                const month = String(ticketDate.getMonth() + 1).padStart(2, '0');
                
                ticket.photos.forEach((photo, index) => {
                    // Handle both object format and string format
                    if (typeof photo === 'object') {
                        let photoPath = photo.path;
                        
                        // If path doesn't have structure (old format), construct new path
                        if (!photoPath || (!photoPath.includes(`/${year}/${month}/${ticket.ticketId}/`) && !photoPath.includes('/tickets/'))) {
                            // Construct new structured path
                            photoPath = `/uploads/tickets/${year}/${month}/${ticket.ticketId}/${photo.filename}`;
                        }
                        
                        // Check if photo has category (NEW guided upload)
                        if (photo.category && photo.categoryLabel) {
                            allPhotos.push({
                                type: 'web',
                                path: photoPath,
                                filename: photo.filename,
                                label: photo.categoryLabel, // Use category label
                                category: photo.category,
                                order: index + 1
                            });
                        } else {
                            // Legacy web upload without category
                            allPhotos.push({
                                type: 'web',
                                path: photoPath,
                                filename: photo.filename,
                                label: 'Foto Teknisi (Web)'
                            });
                        }
                    } else {
                        // If it's a string, treat as filename (legacy) - construct new structured path
                        const photoPath = `/uploads/tickets/${year}/${month}/${ticket.ticketId}/${photo}`;
                        allPhotos.push({
                            type: 'web',
                            path: photoPath,
                            filename: photo,
                            label: 'Foto Teknisi (Web)'
                        });
                    }
                });
            }
            
            // 4. Also check completionPhotos field (with category support)
            if (ticket.completionPhotos && ticket.completionPhotos.length > 0) {
                // Get year and month from ticket creation date for structured path
                const ticketDate = ticket.createdAt ? new Date(ticket.createdAt) : new Date();
                const year = ticketDate.getFullYear();
                const month = String(ticketDate.getMonth() + 1).padStart(2, '0');
                
                ticket.completionPhotos.forEach(photo => {
                    // Get filename
                    const photoFilename = typeof photo === 'object' ? (photo.filename || photo) : photo;
                    
                    // Construct structured path: uploads/teknisi/YEAR/MONTH/TICKET_ID/
                    const structuredPath = `/uploads/teknisi/${year}/${month}/${ticket.ticketId}/${photoFilename}`;
                    const oldPath = `/uploads/teknisi/${photoFilename}`;
                    
                    // Check if photo has category metadata (new format)
                    if (typeof photo === 'object' && photo.category) {
                        // NEW CATEGORIZED FORMAT
                        allPhotos.push({
                            type: 'completion',
                            path: structuredPath,
                            oldPath: oldPath, // For backward compatibility
                            filename: photoFilename,
                            label: photo.categoryLabel || 'Foto Selesai',
                            category: photo.category,
                            order: photo.order || 999
                        });
                    } else if (typeof photo === 'object') {
                        // Object without category (legacy object format)
                        allPhotos.push({
                            type: 'completion',
                            path: structuredPath,
                            oldPath: oldPath, // For backward compatibility
                            filename: photoFilename,
                            label: 'Foto Selesai'
                        });
                    } else {
                        // String format (legacy)
                        allPhotos.push({
                            type: 'completion',
                            path: structuredPath,
                            oldPath: oldPath, // For backward compatibility
                            filename: photoFilename,
                            label: 'Foto Selesai'
                        });
                    }
                });
            }
            
            // Sort and organize photos by category if available
            const categorizedPhotos = allPhotos.filter(p => p.category);
            const uncategorizedPhotos = allPhotos.filter(p => !p.category);
            
            // Define category order for sorting
            const categoryOrder = { 'problem': 1, 'speedtest': 2, 'result': 3, 'extra': 4 };
            
            if (categorizedPhotos.length > 0) {
                // Sort by category order
                categorizedPhotos.sort((a, b) => {
                    const orderA = categoryOrder[a.category] || 999;
                    const orderB = categoryOrder[b.category] || 999;
                    if (orderA !== orderB) return orderA - orderB;
                    return (a.order || 0) - (b.order || 0);
                });
            }
            
            // Combine: categorized first, then uncategorized
            const sortedPhotos = [...categorizedPhotos, ...uncategorizedPhotos];
            
            if (sortedPhotos.length > 0) {
                // Group photos by type and category for better display
                const customerPhotos = sortedPhotos.filter(p => p.type === 'customer');
                const teknisiPhotos = sortedPhotos.filter(p => p.type !== 'customer');
                
                // For teknisi photos, group by category
                const photosByCategory = {};
                teknisiPhotos.forEach(photo => {
                    const cat = photo.category || 'other';
                    if (!photosByCategory[cat]) photosByCategory[cat] = [];
                    photosByCategory[cat].push(photo);
                });
                
                // Display photos with clear grouping
                let globalIndex = 0;
                
                // 1. FIRST: Display Customer Photos (if any)
                if (customerPhotos.length > 0) {
                    photoContainer.append(`
                        <div class="photo-category-header">
                            <i class="fas fa-user-circle"></i> Foto Pelanggan (Saat Lapor)
                        </div>
                    `);
                    
                    customerPhotos.forEach(photo => {
                        globalIndex++;
                        const thumbnailHtml = `
                            <div class="photo-thumbnail" onclick="openPhotoModal('${photo.path}', '${photo.label}', ${globalIndex}, ${sortedPhotos.length})" title="${photo.label} ${globalIndex}">
                                <img src="${photo.path}" alt="${photo.label} ${globalIndex}" onerror="this.onerror=null; this.src='/img/no-image.png'; console.error('[IMG_ERROR] Failed to load:', '${photo.path}');">
                                <span class="photo-count-badge">${globalIndex}</span>
                                <div class="photo-label-badge">${photo.label}</div>
                            </div>
                        `;
                        photoContainer.append(thumbnailHtml);
                    });
                }
                
                // 2. SECOND: Display Teknisi Photos by Category
                const categorizedTekPhotos = teknisiPhotos.filter(p => p.category);
                const uncategorizedTekPhotos = teknisiPhotos.filter(p => !p.category);
                
                if (categorizedTekPhotos.length > 0) {
                    const categories = ['problem', 'speedtest', 'result', 'extra'];
                    categories.forEach(cat => {
                        if (photosByCategory[cat] && photosByCategory[cat].length > 0) {
                            // Add category header
                            const categoryLabel = photosByCategory[cat][0].label;
                            photoContainer.append(`
                                <div class="photo-category-header">
                                    <i class="fas fa-wrench"></i> ${categoryLabel}
                                </div>
                            `);
                            
                            // Add photos in this category
                            photosByCategory[cat].forEach(photo => {
                                globalIndex++;
                                const thumbnailHtml = `
                                    <div class="photo-thumbnail" onclick="openPhotoModal('${photo.path}', '${photo.label}', ${globalIndex}, ${sortedPhotos.length})" title="${photo.label} ${globalIndex}">
                                        <img src="${photo.path}" alt="${photo.label} ${globalIndex}" onerror="this.onerror=null; this.src='/img/no-image.png'; console.error('[IMG_ERROR] Failed to load:', '${photo.path}');">
                                        <span class="photo-count-badge">${globalIndex}</span>
                                        <div class="photo-label-badge">${photo.label}</div>
                                    </div>
                                `;
                                photoContainer.append(thumbnailHtml);
                            });
                        }
                    });
                }
                
                // 3. LAST: Display Uncategorized Teknisi Photos (if any)
                if (uncategorizedTekPhotos.length > 0) {
                    photoContainer.append(`
                        <div class="photo-category-header">
                            <i class="fas fa-images"></i> Foto Teknisi Lainnya
                        </div>
                    `);
                    
                    uncategorizedTekPhotos.forEach(photo => {
                        globalIndex++;
                        const thumbnailHtml = `
                            <div class="photo-thumbnail" onclick="openPhotoModal('${photo.path}', '${photo.label}', ${globalIndex}, ${sortedPhotos.length})" title="${photo.label} ${globalIndex}">
                                <img src="${photo.path}" alt="${photo.label} ${globalIndex}" onerror="this.onerror=null; this.src='/img/no-image.png'; console.error('[IMG_ERROR] Failed to load:', '${photo.path}');">
                                <span class="photo-count-badge">${globalIndex}</span>
                                <div class="photo-label-badge">${photo.label}</div>
                            </div>
                        `;
                        photoContainer.append(thumbnailHtml);
                    });
                }
            } else {
                photoContainer.append('<p class="text-muted">Belum ada foto dokumentasi</p>');
            }
            
            // Show workflow progress
            updateWorkflowProgress(ticket.normalizedStatus || ticket.status);
            
            detailModal.modal('show');
        }
        
        function updateWorkflowProgress(status) {
            // Normalize status to handle variations
            let normalizedStatus = normalizeTicketStatusAdmin(status);

            if (normalizedStatus === 'cancelled') {
                // For cancelled tickets, mark all as inactive
                $('.workflow-step').removeClass('completed active');
                return;
            }
            
            const steps = ['baru', 'process', 'otw', 'arrived', 'working', 'completed'];
            const currentIndex = steps.indexOf(normalizedStatus);
            
            // Clear all first
            $('.workflow-step').removeClass('completed active');
            
            if (normalizedStatus === 'completed') {
                steps.forEach((step, index) => {
                    const stepEl = $(`#step-${step}`);
                    if (stepEl.length === 0) {
                        console.error('[WORKFLOW_STEP] Element not found for step:', step);
                    } else {
                        stepEl.addClass('completed');
                    }
                });
                return; // Exit early after marking all as completed
            }
            
            if (currentIndex >= 0) {
                steps.forEach((step, index) => {
                    const stepEl = $(`#step-${step}`);
                    
                    if (stepEl.length === 0) {
                        console.error('[WORKFLOW_STEP] Element not found for step:', step);
                        return;
                    }
                    
                    if (index < currentIndex) {
                        stepEl.addClass('completed');
                    } else if (index === currentIndex) {
                        stepEl.addClass('active');
                    }
                });
            } else {
                // Status not in workflow, default to first step
                const baruStep = $('#step-baru');
                if (baruStep.length > 0) {
                    baruStep.addClass('active');
                } else {
                    console.error('[WORKFLOW_STEP] Element #step-baru not found!');
                }
            }
        }
        
        function openPhotoModal(photoPath, label, photoNum, totalPhotos) {
            // Set modal content
            $('#photoModalImage').attr('src', photoPath);
            $('#photoModalTitle').text(`${label} - Foto ${photoNum} dari ${totalPhotos}`);
            
            // Open modal with backdrop fix
            $('#photoModal').modal({
                show: true,
                backdrop: true,
                keyboard: true
            });
            
            // Ensure photo modal appears above detail modal
            $('#photoModal').on('shown.bs.modal', function() {
                // Force higher z-index on the backdrop
                $('.modal-backdrop').last().css('z-index', 1055);
                $('#photoModal').css('z-index', 1060);
            });
        }
        
        function downloadPhoto() {
            // Get current photo source
            const photoSrc = $('#photoModalImage').attr('src');
            if (!photoSrc) return;
            
            // Create temporary link and trigger download
            const link = document.createElement('a');
            link.href = photoSrc;
            link.download = photoSrc.split('/').pop();
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        
        let dataTableInstance;

        function setupCancelModal(ticketId) { 
            document.getElementById('cancelTicketIdDisplay').textContent = ticketId;
            document.getElementById('cancellationReasonInput').value = '';
            document.getElementById('confirmCancelTicketBtn').setAttribute('data-ticket-id', ticketId);
            $('#cancelTicketModal').modal('show');
        }
        async function executeAdminCancelTicket(ticketId, reason) { 
            if (!ticketId || !reason || reason.trim() === '') {
                displayGlobalAdminMessage('Alasan pembatalan wajib diisi!', 'warning');
                return;
            }
            console.log('[CANCEL_TICKET] Attempting to cancel ticket:', ticketId, 'with reason:', reason);
            try {
                const response = await fetch('/api/admin/ticket/cancel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify({ ticketId, cancellationReason: reason })
                });
                const result = await response.json();
                // Blur focus before hiding modal to prevent aria-hidden warning
                $('#cancelTicketModal').find(':focus').blur();
                $('#cancelTicketModal').modal('hide');
                if (response.ok && result.status === 200) {
                    displayGlobalAdminMessage(result.message, 'success');
                    loadTickets(); 
                } else {
                    displayGlobalAdminMessage(`Gagal membatalkan tiket: ${result.message || 'Error tidak diketahui.'}`, 'danger');
                }
            } catch (error) {
                $('#cancelTicketModal').find(':focus').blur();
                $('#cancelTicketModal').modal('hide');
                console.error('Error cancelling ticket by admin:', error);
                displayGlobalAdminMessage('Terjadi kesalahan koneksi saat membatalkan tiket.', 'danger');
            }
        }
        async function loadTickets(resetFilters = false) { 
            if (resetFilters) {
                document.getElementById('filterForm').reset();
                 // Jika Select2 digunakan untuk filter status atau lainnya, reset juga mereka
                // $('#filterStatusSelect2').val(null).trigger('change'); 
            }
            
            const status = document.getElementById('filterStatus').value;
            const startDate = document.getElementById('filterStartDate').value;
            const endDate = document.getElementById('filterEndDate').value;
            const pppoeName = document.getElementById('filterPppoe').value;
            const ticketIdVal = document.getElementById('filterTicketId').value;

            let queryParams = new URLSearchParams();
            if (status && status !== 'all') queryParams.append('status', status);
            if (startDate) queryParams.append('startDate', startDate);
            if (endDate) queryParams.append('endDate', endDate);
            if (pppoeName.trim() !== '') queryParams.append('pppoeName', pppoeName.trim());
            if (ticketIdVal.trim() !== '') queryParams.append('ticketId', ticketIdVal.trim());

            const apiUrl = `/api/admin/tickets?${queryParams.toString()}&_=${new Date().getTime()}`;

            try {
                const response = await fetch(apiUrl);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const result = await response.json();
                const tickets = result.data;
                
                // Properly destroy existing DataTable instance if it exists
                if (dataTableInstance && $.fn.DataTable.isDataTable('#allTicketsTable')) {
                    try {
                        dataTableInstance.clear().destroy();
                    } catch (e) {
                        // If error, try alternative destruction method
                        $('#allTicketsTable').DataTable().destroy();
                    }
                    dataTableInstance = null;
                    // Remove any lingering DataTable attributes
                    $('#allTicketsTable').removeAttr('aria-describedby');
                }
                
                const ticketsTableBody = document.getElementById('allTicketsTable').getElementsByTagName('tbody')[0];
                ticketsTableBody.innerHTML = ''; 

                // Clear tickets cache
                ticketsCache = {};
                
                if (tickets && tickets.length > 0) {
                    tickets.forEach(ticket => {
                        // Store ticket in cache for safe access
                        const safeTicketId = ticket.ticketId || ticket.id || 'unknown_' + Date.now();
                        ticketsCache[safeTicketId] = ticket;
                        let row = ticketsTableBody.insertRow();
                        row.insertCell().textContent = ticket.ticketId || '-';
                        // Smart customer name resolution - check ALL possible fields
                        const customerName = ticket.pelangganName || 
                                           ticket.pelangganPushName || 
                                           (ticket.pelangganDataSystem ? ticket.pelangganDataSystem.name : null) ||
                                           'Customer';
                        row.insertCell().textContent = `${customerName} (${ticket.pelangganId ? ticket.pelangganId.split('@')[0] : 'N/A'})`;
                        row.insertCell().innerHTML = `<div class="ticket-details-admin">${formatTicketDetailsAdmin(ticket.pelangganDataSystem)}</div>`;
                        row.insertCell().innerHTML = `<div class="report-text-admin">${escapeHtml(ticket.laporanText || '-')}</div>`;
                        
                        // Photo column - Count ALL photos (customer + teknisi)
                        let photoCell = row.insertCell();
                        const ticketIdForPhoto = ticket.ticketId || ticket.id || 'unknown';
                        
                        // Count all photos from all sources
                        let totalPhotos = 0;
                        let photoLabels = [];
                        
                        const customerPhotoCount = typeof ticket.customerPhotoCount === 'number'
                            ? ticket.customerPhotoCount
                            : (ticket.customerPhotos && ticket.customerPhotos.length > 0 ? ticket.customerPhotos.length : 0);
                        const teknisiPhotoCount = getTicketTechnicianPhotoCount(ticket);

                        if (customerPhotoCount > 0) {
                            totalPhotos += customerPhotoCount;
                            photoLabels.push(`${customerPhotoCount} foto pelanggan`);
                        }

                        if (teknisiPhotoCount > 0) {
                            totalPhotos += teknisiPhotoCount;
                            photoLabels.push(`${teknisiPhotoCount} foto teknisi`);
                        }
                        
                        if (totalPhotos > 0) {
                            const title = photoLabels.join(', ');
                            photoCell.innerHTML = `
                                <button class="btn btn-sm btn-info" onclick="showTicketDetailById('${ticketIdForPhoto}')" title="${title}">
                                    <i class="fas fa-camera"></i> ${totalPhotos}
                                </button>
                            `;
                        } else {
                            photoCell.innerHTML = '<span class="text-muted">-</span>';
                        }
                        
                        const authoritativeStatus = ticket.normalizedStatus || ticket.status;
                        row.insertCell().innerHTML = getStatusBadgeAdmin(authoritativeStatus);
                        row.insertCell().textContent = ticket.createdAt ? new Date(ticket.createdAt).toLocaleString('id-ID', {dateStyle:'short', timeStyle:'short'}) : '-';
                        
                        let processedByText = ticket.processedByTeknisiName || '-';
                        if(ticket.processingStartedAt && ticket.processedByTeknisiName) processedByText += ` <small class="text-muted">(${new Date(ticket.processingStartedAt).toLocaleDateString('id-ID', {day:'2-digit',month:'short'})})</small>`;
                        row.insertCell().innerHTML = processedByText;

                        row.insertCell().innerHTML = getCompletedByDisplay(ticket);

                        // Handle both old format (object) and new format (string)
                        let cancelledByText = '-';
                        if (ticket.cancelled_by) {
                            // New format from our recent update
                            cancelledByText = ticket.cancelled_by;
                        } else if (ticket.cancelledBy) {
                            // Old format - might be object or string
                            if (typeof ticket.cancelledBy === 'object') {
                                cancelledByText = `${ticket.cancelledBy.name || 'N/A'} (${ticket.cancelledBy.type || 'N/A'})`;
                            } else {
                                cancelledByText = ticket.cancelledBy;
                            }
                        }
                        
                        // Add timestamp if available
                        const cancelTime = ticket.cancelled_at || ticket.cancellationTimestamp;
                        if (cancelTime && cancelledByText !== '-') {
                            cancelledByText += ` <small class="text-muted">(${new Date(cancelTime).toLocaleDateString('id-ID', {day:'2-digit',month:'short'})})</small>`;
                        }
                        row.insertCell().innerHTML = cancelledByText;

                        let adminActionCell = row.insertCell();
                        adminActionCell.classList.add('action-buttons-admin', 'text-center');
                        
                        // Check if ticket can be cancelled - handle various status formats
                        const normalizedStatus = normalizeTicketStatusAdmin(ticket.normalizedStatus || ticket.status);
                        const canCancel = normalizedStatus !== 'completed' && normalizedStatus !== 'cancelled';
                        
                        if (canCancel) {
                            let cancelButton = document.createElement('button');
                            cancelButton.classList.add('btn', 'btn-danger', 'btn-sm');
                            cancelButton.innerHTML = '<i class="fas fa-times-circle"></i> Batalkan';
                            cancelButton.title = 'Batalkan Tiket Ini';
                            const ticketIdForCancel = ticket.ticketId || ticket.id;
                            cancelButton.onclick = function() { setupCancelModal(ticketIdForCancel); };
                            adminActionCell.appendChild(cancelButton);
                        } else {
                            adminActionCell.textContent = '-';
                        }
                    });
                } else {
                    // Don't add colspan row yet - DataTable will handle empty state
                    // ticketsTableBody.innerHTML remains empty
                }

                // Only initialize DataTable if there are tickets
                // Otherwise DataTable will show its own empty message
                if (tickets && tickets.length > 0) {
                    try {
                        dataTableInstance = $('#allTicketsTable').DataTable({
                        "order": [[6, "desc"]], // Sort by "Tgl Dibuat" column (index 6)
                        "pageLength": 10,
                        "processing": true,
                        "destroy": true,
                        "responsive": true,
                        "autoWidth": false,
                        "language": {
                            "lengthMenu": "Tampilkan _MENU_ entri",
                            "zeroRecords": "Tidak ada data yang ditemukan",
                            "info": "Menampilkan _START_ hingga _END_ dari _TOTAL_ entri",
                            "infoEmpty": "Menampilkan 0 hingga 0 dari 0 entri",
                            "infoFiltered": "(difilter dari _MAX_ total entri)",
                            "search": "Cari:",
                            "paginate": {
                                "first": "Pertama",
                                "last": "Terakhir",
                                "next": "Selanjutnya",
                                "previous": "Sebelumnya"
                            }
                        },
                        "columnDefs": [
                            { "orderable": false, "targets": [4, 10] } // Photo and Action columns not sortable
                        ]
                        });
                    } catch(dtError) {
                        console.error('DataTable initialization error:', dtError);
                        // Table will still be visible even if DataTable fails
                    }
                } else {
                    // No tickets - show custom message without DataTable
                    dataTableInstance = null; // Clear reference since we're not initializing
                    const colCount = $('#allTicketsTable thead th').length;
                    ticketsTableBody.innerHTML = `<tr><td colspan="${colCount}" class="text-center text-muted py-4">Tidak ada tiket yang cocok dengan filter Anda.</td></tr>`;
                }

            } catch (error) {
                console.error('Error loading tickets for admin:', error);
                const colCount = $('#allTicketsTable thead th').length;
                document.getElementById('allTicketsTable').getElementsByTagName('tbody')[0].innerHTML = `<tr><td colspan="${colCount}" class="text-center">Gagal memuat data tiket. Coba refresh.</td></tr>`;
            }
        }

        document.getElementById('filterForm').addEventListener('submit', function(event) { event.preventDefault(); loadTickets();});
        
        document.addEventListener('DOMContentLoaded', function() {
            loadTickets(); 
            
            const confirmCancelBtn = document.getElementById('confirmCancelTicketBtn');
            if(confirmCancelBtn) {
                 confirmCancelBtn.addEventListener('click', function() {
                    const ticketId = this.getAttribute('data-ticket-id');
                    const reason = document.getElementById('cancellationReasonInput').value;
                    if (!reason || reason.trim() === "") {
                        // Menggunakan displayGlobalAdminMessage untuk pesan error di modal pembatalan juga bisa, atau alert
                        alert("Alasan pembatalan wajib diisi!"); 
                        // displayGlobalAdminMessage('Alasan pembatalan wajib diisi!', 'warning'); // Alternatif
                        return;
                    }
                    executeAdminCancelTicket(ticketId, reason);
                });
            }
            
            // Cleanup Orphaned Photos Handler
            const confirmCleanupBtn = document.getElementById('confirmCleanupOrphanedPhotos');
            if (confirmCleanupBtn) {
                confirmCleanupBtn.addEventListener('click', async function() {
                    const password = document.getElementById('cleanupAdminPassword').value;
                    if (!password) {
                        displayGlobalAdminMessage('Silakan masukkan password admin', 'warning');
                        return;
                    }
                    
                    // Disable button during request
                    confirmCleanupBtn.disabled = true;
                    confirmCleanupBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memproses...';
                    
                    try {
                        const response = await fetch('/api/admin/cleanup-orphaned-photos', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            credentials: 'include',
                            body: JSON.stringify({ password: password })
                        });
                        
                        const result = await response.json();
                        
                        if (response.ok && result.status === 200) {
                            displayGlobalAdminMessage(
                                `✅ ${result.message}${result.errors && result.errors.length > 0 ? '<br>⚠️ Beberapa file gagal dihapus: ' + result.errors.join(', ') : ''}`,
                                'success'
                            );
                            $('#cleanupOrphanedPhotosModal').modal('hide');
                            document.getElementById('cleanupAdminPassword').value = '';
                        } else {
                            displayGlobalAdminMessage(
                                `❌ ${result.message || 'Gagal menghapus foto tidak terpakai'}`,
                                'danger'
                            );
                        }
                    } catch (error) {
                        console.error('Error cleaning up orphaned photos:', error);
                        displayGlobalAdminMessage('Terjadi kesalahan koneksi saat menghapus foto.', 'danger');
                    } finally {
                        // Re-enable button
                        confirmCleanupBtn.disabled = false;
                        confirmCleanupBtn.innerHTML = '<i class="fas fa-trash-alt"></i> Hapus Foto Tidak Terpakai';
                    }
                });
            }

            // Fix for createTicketModal aria-hidden issue
            $('#createTicketModal').on('show.bs.modal', function () {
                // Remove focus from any active element before showing modal
                document.activeElement.blur();
            });
            
            $('#createTicketModal').on('shown.bs.modal', function () {
                $(this).removeAttr('aria-hidden');
                $(this).attr('aria-modal', 'true');
                // Focus on first input instead of close button
                $('#customerSelect').select2('focus');
            });
            
            $('#createTicketModal').on('hide.bs.modal', function () {
                // Blur any focused element in the modal before hiding
                $(this).find(':focus').blur();
            });
            
            $('#createTicketModal').on('hidden.bs.modal', function () {
                // Reset form values after modal is completely hidden
                $('#customerSelectModal').val('');
                $('#laporanTextModal').val('');
                $('#prioritySelectModal').val('MEDIUM');
                $('#issueTypeSelectModal').val('WIFI_MATI');
                // Return focus to the trigger button
                $('[data-target="#createTicketModal"]').focus();
            });

            // Fix for cancel ticket modal aria-hidden issue
            $('#cancelTicketModal').on('show.bs.modal', function () {
                // Remove focus from any active element first
                document.activeElement.blur();
            });
            
            $('#cancelTicketModal').on('shown.bs.modal', function () {
                $(this).removeAttr('aria-hidden');
                $('#cancellationReasonInput').focus(); // Fokus ke textarea untuk alasan pembatalan
            });
            
            $('#cancelTicketModal').on('hide.bs.modal', function () {
                $(this).find(':focus').blur(); // Remove focus from any focused element
            });
            
            $('#cancelTicketModal').on('hidden.bs.modal', function () {
                // Return focus to the cancel button that opened it
                const ticketId = $('#confirmCancelTicketBtn').attr('data-ticket-id');
                if (ticketId && ticketsCache[ticketId]) {
                    // Try to find and focus the original button if still exists
                    $(`button[onclick*="setupCancelModal"]`).first().focus();
                }
            });

            // Fix for ticket detail modal aria-hidden issue
            $('#ticketDetailModal').on('show.bs.modal', function () {
                document.activeElement.blur();
            });
            
            $('#ticketDetailModal').on('shown.bs.modal', function () {
                $(this).removeAttr('aria-hidden');
                $(this).attr('aria-modal', 'true');
            });
            
            $('#ticketDetailModal').on('hide.bs.modal', function () {
                $(this).find(':focus').blur();
            });
            
            $('#ticketDetailModal').on('hidden.bs.modal', function () {
                // Return focus to the photo button that opened it
                $('button[onclick*="showTicketDetailById"]').first().focus();
            });
            
            // Fix for photo modal to ensure it's above detail modal
            $('#photoModal').on('show.bs.modal', function() {
                // Remove previous event handler to prevent memory leak
                $(this).off('shown.bs.modal.zindex');
            });
            
            $('#photoModal').on('shown.bs.modal.zindex', function() {
                // Ensure photo modal has higher z-index than detail modal
                const $photoModal = $(this);
                const $lastBackdrop = $('.modal-backdrop').last();
                
                $lastBackdrop.css('z-index', 1055);
                $photoModal.css('z-index', 1060);
                
                console.log('[PHOTO_MODAL] Z-index set - Modal:', $photoModal.css('z-index'), 'Backdrop:', $lastBackdrop.css('z-index'));
            });
            
            $('#photoModal').on('hidden.bs.modal', function() {
                // Clear image src to save memory
                $('#photoModalImage').attr('src', '');
            });

            $('#customerSelect').select2({
                theme: "bootstrap", // Menggunakan tema bootstrap umum yang lebih cocok untuk BS4
                dropdownParent: $('#createTicketModal'), 
                placeholder: 'Cari dan pilih pelanggan...',
                allowClear: true,
                dropdownAutoWidth: true,
                ajax: {
                    url: '/api/users', 
                    dataType: 'json',
                    delay: 250, 
                    data: function (params) {
                        return {
                            search: params.term, 
                            page: params.page || 1,
                            role: 'pelanggan' // Opsional: filter hanya user dengan role pelanggan jika API mendukung
                        };
                    },
                    processResults: function (data, params) {
                        params.page = params.page || 1;
                        const users = data.data || data; 
                        return {
                            results: users.map(user => ({
                                id: user.id,
                                text: `${user.name || `ID: ${user.id}`} (${user.pppoe_username || 'No PPPoE'}) - ${user.phone_number ? user.phone_number.split('|')[0] : 'No HP'}`
                            })),
                            pagination: {
                                more: (params.page * 10) < (data.total || users.length) 
                            }
                        };
                    },
                    cache: true
                }
            });

            document.getElementById('createTicketForm').addEventListener('submit', async function(event) {
                event.preventDefault();
                const customerUserId = document.getElementById('customerSelect').value;
                const laporanText = document.getElementById('laporanTextInput').value;
                const priority = document.getElementById('prioritySelect').value;
                const issueType = document.getElementById('issueTypeSelect').value;
                const submitBtn = document.getElementById('submitNewTicketBtn');
                
                // Prevent form submission if button is disabled
                if (submitBtn.disabled) {
                    return;
                }

                if (!customerUserId) { // Hanya cek customerUserId karena laporanText sudah 'required'
                    displayGlobalAdminMessage('Silakan pilih pelanggan', 'warning');
                    return;
                }
                
                // Disable submit button to prevent double submit
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Membuat tiket...';
                
                try {
                    const response = await fetch('/api/admin/ticket/create', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ 
                            customerUserId, 
                            laporanText,
                            priority,
                            issueType
                        })
                    });
                    const result = await response.json();

                    if (response.ok && (result.status === 201 || result.status === 200) ) {
                        // Display message with working hours info if outside hours
                        let messageToShow = result.message;
                        if (result.workingHours && !result.workingHours.isWithinHours && result.workingHours.warning) {
                            // Show warning style for outside working hours
                            displayGlobalAdminMessage(messageToShow, 'warning');
                        } else {
                            displayGlobalAdminMessage(messageToShow, 'success');
                        }
                        
                        // Blur focus before hiding modal to prevent aria-hidden warning
                        $('#createTicketModal').find(':focus').blur();
                        $('#createTicketModal').modal('hide');
                        document.getElementById('createTicketForm').reset();
                        $('#customerSelect').val(null).trigger('change'); 
                        loadTickets(); 
                    } else {
                        displayGlobalAdminMessage(result.message || 'Gagal membuat tiket', 'danger');
                    }
                } catch(error) {
                    console.error('Error creating ticket:', error);
                    displayGlobalAdminMessage('Terjadi kesalahan koneksi saat membuat tiket', 'danger');
                } finally {
                    // Re-enable submit button
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Buat Tiket';
                }
            });
        });
