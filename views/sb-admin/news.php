<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>RAF BOT - News & Promos</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <nav class="navbar navbar-expand navbar-light bg-white topbar mb-4 static-top shadow">
                    <form class="form-inline"><button type="button" id="sidebarToggleTop" class="btn btn-link d-md-none rounded-circle mr-3"><i class="fa fa-bars"></i></button></form>
                    <ul class="navbar-nav ml-auto">
                        <li class="nav-item dropdown no-arrow">
                            <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button" data-toggle="dropdown"><span id="username-placeholder" class="mr-2 d-none d-lg-inline text-gray-600 small">Admin</span><img class="img-profile rounded-circle" src="/img/undraw_profile.svg"></a>
                            <div class="dropdown-menu dropdown-menu-right shadow animated--grow-in" aria-labelledby="userDropdown"><a class="dropdown-item" href="#" data-toggle="modal" data-target="#logoutModal"><i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i>Logout</a></div>
                        </li>
                    </ul>
                </nav>

                <div class="container-fluid">
                    <!-- Page Header -->
          <div class="dashboard-header">
            <h1>Manage News & Promos</h1>
            <p>Kelola dan monitor manage news & promos</p>
          </div>

                    <!-- Table Section -->
          <h4 class="dashboard-section-title">Add/Edit News Item</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Add/Edit News Item</h6>
                        </div>
                        <div class="card-body">
                            <form id="newsForm">
                                <input type="hidden" id="newsId" name="newsId">
                                <div class="form-group">
                                    <label for="title">Title</label>
                                    <input type="text" class="form-control" id="title" name="title" required>
                                </div>
                                <div class="form-group">
                                    <label for="news_content">Content</label>
                                    <textarea class="form-control" id="news_content" name="news_content" rows="4" required></textarea>
                                </div>
                                <button type="submit" class="btn btn-primary">Save News Item</button>
                                <button type="button" class="btn btn-secondary" id="cancelEdit">Cancel</button>
                            </form>
                            <div id="alert-container-form" class="mt-3"></div>
                        </div>
                    </div>

                    <!-- Table Section -->
          <h4 class="dashboard-section-title">Current News & Promos</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Current News & Promos</h6>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered" id="newsTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>Title</th>
                                            <th>Content</th>
                                            <th>Created At</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                    </tbody>
                                </table>
                            </div>
                            <div id="alert-container-table" class="mt-3"></div>
                        </div>
                    </div>
                </div>

            </div>
            <footer class="sticky-footer bg-white"><div class="container my-auto"><div class="copyright text-center my-auto"><span>Copyright &copy; RAF BOT 2025</span></div></div></footer>
        </div>
    </div>

    <a class="scroll-to-top rounded" href="#page-top"><i class="fas fa-angle-up"></i></a>
    <div class="modal fade" id="logoutModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">Ready to Leave?</h5><button class="close" type="button" data-dismiss="modal">&times;</button></div><div class="modal-body">Select "Logout" to end session.</div><div class="modal-footer"><button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button><a class="btn btn-primary" href="/logout">Logout</a></div></div></div></div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.min.js"></script>
    <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
    <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>

    <script>
    document.addEventListener('DOMContentLoaded', function() {
        const form = document.getElementById('newsForm');
        const table = $('#newsTable');
        const newsIdField = document.getElementById('newsId');
        const titleField = document.getElementById('title');
        const contentField = document.getElementById('news_content');
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
            newsIdField.value = '';
            cancelEditBtn.style.display = 'none';
        }

        function fetchNews() {
            if (dataTableInstance) {
                dataTableInstance.ajax.reload();
                return;
            }

            dataTableInstance = table.DataTable({
                processing: true,
                ajax: {
                    url: '/api/news',
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
                    { data: 'title' },
                    { data: 'content' },
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
                order: [[2, 'desc']]
            });
        }

        form.addEventListener('submit', function(e) {
            e.preventDefault();
            const id = newsIdField.value;
            const title = titleField.value;
            const content = contentField.value;
            const url = id ? `/api/news/${id}` : '/api/news';
            const method = 'POST';

            const submitButton = this.querySelector('button[type="submit"]');
            const originalButtonText = submitButton.innerHTML;
            submitButton.disabled = true;
            submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

            fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, news_content: content })
            })
            .then(response => response.json().then(data => ({ ok: response.ok, data })))
            .then(result => {
                if (result.ok) {
                    showAlert(result.data.message, 'success');
                    resetForm();
                    fetchNews();
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
            if (confirm('Are you sure you want to delete this news item?')) {
                fetch(`/api/news/${id}`, { method: 'DELETE' })
                .then(response => response.json().then(data => ({ ok: response.ok, data })))
                .then(result => {
                    if (result.ok) {
                        showAlert(result.data.message, 'success', 'table');
                        fetchNews();
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

            newsIdField.value = id;
            titleField.value = data.title;
            contentField.value = data.content;
            cancelEditBtn.style.display = 'inline-block';

            $('html, body').animate({
                scrollTop: $("#newsForm").offset().top - 70
            }, 500);
        });

        cancelEditBtn.addEventListener('click', resetForm);

        fetchNews();
        resetForm();

        fetch('/api/me', { credentials: 'include' })
        .then(response => response.json())
        .then(data => {
            if (data.status === 200 && data.data && data.data.username) {
                $('#username-placeholder').text(data.data.username);
            }
        }).catch(err => console.warn("Could not fetch user data: ", err));
    });
    </script>
</body>
</html>
