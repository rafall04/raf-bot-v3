<!DOCTYPE html>
<html lang="en">

<head>
    <?php
    $pageTitle = 'RAF BOT - Berita & Promo';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>
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
            <h1>Berita &amp; Promo</h1>
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

    <script src="<?= rafAssetUrl('/js/news.js') ?>"></script>

</body>
</html>
