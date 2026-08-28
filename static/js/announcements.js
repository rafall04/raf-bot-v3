/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/announcements.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/announcements.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

    document.addEventListener('DOMContentLoaded', function() {
        const form = document.getElementById('announcementForm');
        const table = $('#announcementsTable');
        const announcementIdField = document.getElementById('announcementId');
        const messageField = document.getElementById('message');
        const cancelEditBtn = document.getElementById('cancelEdit');
        let dataTableInstance;

        function showAlert(message, type, container = 'form') {
            const alertContainer = document.getElementById(`alert-container-${container}`);
            const alert = `
                <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                    ${message}
                    <button type="button" class="close" data-dismiss="alert" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
            `;
            alertContainer.innerHTML = alert;
            setTimeout(() => {
                const alertElement = alertContainer.querySelector('.alert');
                if (alertElement) {
                    $(alertElement).alert('close');
                }
            }, 5000);
        }

        function resetForm() {
            form.reset();
            announcementIdField.value = '';
            cancelEditBtn.style.display = 'none';
        }

        function fetchAnnouncements() {
            if (dataTableInstance) {
                dataTableInstance.ajax.reload();
                return;
            }

            dataTableInstance = table.DataTable({
                processing: true,
                ajax: {
                    url: '/api/announcements',
                    dataSrc: function(json) {
                        // Handle response format: {status, success, message, data: [...]}
                        if (json && json.data && Array.isArray(json.data)) {
                            return json.data;
                        }
                        // Fallback: jika response langsung array (backward compatibility)
                        if (Array.isArray(json)) {
                            return json;
                        }
                        return [];
                    }
                },
                columns: [
                    { data: 'message' },
                    {
                        data: 'createdAt',
                        render: function(data, type, row) {
                            if (!data) return '';
                            return new Date(data).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
                        }
                    },
                    {
                        data: 'id',
                        orderable: false,
                        searchable: false,
                        render: function(data, type, row) {
                            return `
                                <button class="btn btn-sm btn-warning btn-edit" data-id="${data}" title="Edit">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-sm btn-danger btn-delete" data-id="${data}" title="Delete">
                                    <i class="fas fa-trash"></i>
                                </button>
                            `;
                        }
                    }
                ],
                order: [[1, 'desc']]
            });
        }

        form.addEventListener('submit', function(e) {
            e.preventDefault();
            const id = announcementIdField.value;
            const message = messageField.value;
            const url = id ? `/api/announcements/${id}` : '/api/announcements';
            const method = 'POST';

            const submitButton = this.querySelector('button[type="submit"]');
            const originalButtonText = submitButton.innerHTML;
            submitButton.disabled = true;
            submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

            fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: message })
            })
            .then(response => response.json().then(data => ({ ok: response.ok, data })))
            .then(result => {
                if (result.ok) {
                    showAlert(result.data.message, 'success');
                    resetForm();
                    fetchAnnouncements();
                } else {
                    throw new Error(result.data.message || 'An unknown error occurred');
                }
            })
            .catch(error => {
                showAlert('Error: ' + error.message, 'danger');
                console.error('Error:', error);
            })
            .finally(() => {
                submitButton.disabled = false;
                submitButton.innerHTML = originalButtonText;
            });
        });

        table.on('click', '.btn-delete', function() {
            const id = $(this).data('id');
            if (confirm('Hapus pengumuman ini?')) {
                fetch(`/api/announcements/${id}`, { method: 'DELETE' })
                .then(response => response.json().then(data => ({ ok: response.ok, data })))
                .then(result => {
                    if (result.ok) {
                        showAlert(result.data.message, 'success', 'table');
                        fetchAnnouncements();
                    } else {
                        throw new Error(result.data.message || 'An unknown error occurred');
                    }
                })
                .catch(error => {
                    showAlert('Error: ' + error.message, 'danger', 'table');
                    console.error('Error:', error);
                });
            }
        });

        table.on('click', '.btn-edit', function() {
            const id = $(this).data('id');
            const data = dataTableInstance.row($(this).parents('tr')).data();

            announcementIdField.value = id;
            messageField.value = data.message;
            cancelEditBtn.style.display = 'inline-block';

            $('html, body').animate({
                scrollTop: $("#announcementForm").offset().top - 70
            }, 500);
        });

        cancelEditBtn.addEventListener('click', resetForm);

        fetchAnnouncements();
        resetForm();

        fetch('/api/me', { credentials: 'include' })
        .then(response => response.json())
        .then(data => {
            if (data.status === 200 && data.data && data.data.username) {
                $('#username-placeholder').text(data.data.username);
            }
        })
        .catch(err => console.warn("Could not fetch user data: ", err));
    });
    
