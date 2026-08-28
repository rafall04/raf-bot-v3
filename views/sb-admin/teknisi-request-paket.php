<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'Request Ubah Paket - Panel Teknisi';
    $themeRole = 'teknisi';
    include __DIR__ . '/_head.php';
    ?>

    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="<?= rafAssetUrl('/css/teknisi-request-paket.css') ?>" rel="stylesheet">

</head>
<body id="page-top">
    <div id="wrapper">
        <?php include '_role_aware_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include '_role_aware_teknisi_topbar.php'; ?>

                <div class="container-fluid">
                    <div class="tk-page-head">
                        <div class="tk-title">
                            <span class="tk-title-icon"><i class="fas fa-exchange-alt"></i></span>
                            <div>
                                <h1>Request Perubahan Paket</h1>
                                <p class="tk-subtitle">Ajukan permintaan perubahan paket permanen untuk pelanggan</p>
                            </div>
                        </div>
                    </div>

                    <div class="card shadow mb-4">
                        <div class="card-header py-3">
                            <h6 class="m-0 font-weight-bold text-primary">Form Permintaan</h6>
                        </div>
                        <div class="card-body">
                            <form id="requestPackageChangeForm">
                                <div class="form-group">
                                    <label for="userSelect">Pilih Pelanggan</label>
                                    <select class="form-control" id="userSelect" name="userId" required>
                                        <option value="">Memuat pelanggan...</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="currentPackage">Paket Saat Ini</label>
                                    <input type="text" class="form-control" id="currentPackage" readonly>
                                </div>
                                <hr>
                                <div class="form-group">
                                    <label for="packageSelect">Pilih Paket Baru</label>
                                    <select class="form-control" id="packageSelect" name="newPackageName" required>
                                        <option value="">Memuat paket...</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="requestNotes">Catatan (Opsional)</label>
                                    <textarea class="form-control" id="requestNotes" name="notes" rows="3" placeholder="Tambahkan catatan atau alasan perubahan paket..."></textarea>
                                </div>
                                <button type="submit" class="btn btn-primary" id="submitBtn">
                                    <i class="fas fa-paper-plane"></i> Kirim Permintaan
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>

            <footer class="sticky-footer bg-white">
                <div class="container my-auto">
                    <div class="copyright text-center my-auto">
                        <span>Copyright &copy; RAF BOT 2025</span>
                    </div>
                </div>
            </footer>
        </div>
    </div>

    <a class="scroll-to-top rounded" href="#page-top">
        <i class="fas fa-angle-up"></i>
    </a>

    <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel"
        aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="exampleModalLabel">Ready to Leave?</h5>
                    <button class="close" type="button" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">×</span>
                    </button>
                </div>
                <div class="modal-body">Select "Logout" below if you are ready to end your current session.</div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button>
                    <a class="btn btn-primary" href="/logout">Logout</a>
                </div>
            </div>
        </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

    <script src="<?= rafAssetUrl('/js/teknisi-request-paket.js') ?>"></script>

</body>
</html>
