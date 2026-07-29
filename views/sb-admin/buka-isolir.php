<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'RAF BOT - Buka Isolir';
    $themeRole = 'admin';
    $pageDescription = 'RAF BOT - Buka Isolir';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/css/isolir-workspace.css" rel="stylesheet">
    <link href="<?= rafAssetUrl('/css/buka-isolir.css') ?>" rel="stylesheet">

</head>
<body id="page-top" class="isolir-page">
<div id="wrapper">
    <?php include __DIR__ . '/_navbar.php'; ?>
    <div id="content-wrapper" class="d-flex flex-column">
        <div id="content">
            <?php include __DIR__ . '/topbar.php'; ?>
            <div class="container-fluid">
                <div class="isolir-shell">
                    <div class="isolir-header">
                        <h1><i class="fas fa-unlock mr-2"></i>Buka Isolir</h1>
                        <p>Restore profile pelanggan terisolir dengan alur yang aman: selection global, disconnect otomatis, dan reboot opsional jika capability tersedia.</p>
                        <div class="isolir-header-actions">
                            <span class="isolir-header-chip"><i class="fas fa-unlock-alt"></i>Restore profile tanpa ubah status bayar</span>
                            <span class="isolir-header-chip"><i class="fas fa-plug"></i>Disconnect selalu diterapkan</span>
                            <span class="isolir-header-chip"><i class="fas fa-server"></i>Reboot hanya saat dipilih</span>
                        </div>
                    </div>
                    <div class="isolir-grid">
                        <div class="isolir-main">
                            <div class="isolir-card">
                                <div class="card-body">
                                    <div class="isolir-section-head">
                                        <div>
                                            <h6>Workspace Pelanggan Terisolir</h6>
                                            <p>Cari pelanggan terisolir, pilih batch yang relevan, lalu buka isolir dari selection global.</p>
                                        </div>
                                    </div>
                                    <div class="isolir-toolbar">
                                        <div class="isolir-toolbar-row is-two">
                                            <input class="form-control" id="searchInput" placeholder="Cari nama, PPPoE, paket, atau profile">
                                            <div class="isolir-toolbar-actions">
                                                <button class="btn btn-outline-warning" id="selectCurrentPageBtn" type="button">Pilih Halaman Ini</button>
                                                <button class="btn btn-outline-secondary" id="refreshBtn" type="button">Refresh</button>
                                                <button class="btn btn-outline-secondary" id="clearSelectionBtn" type="button">Clear</button>
                                            </div>
                                        </div>
                                        <small class="text-muted" id="filterSummary">Memuat data...</small>
                                    </div>
                                    <div class="isolir-list" id="userList"><div class="isolir-empty">Memuat data...</div></div>
                                    <div class="isolir-page-controls mt-3">
                                        <small class="text-muted" id="pageInfo">Halaman 1 / 1</small>
                                        <div class="btn-group btn-group-sm">
                                            <button class="btn btn-outline-secondary" id="prevPageBtn" type="button">Prev</button>
                                            <button class="btn btn-outline-secondary" id="nextPageBtn" type="button">Next</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="isolir-card">
                                <div class="card-body">
                                    <div class="isolir-section-head">
                                        <div>
                                            <h6>Hasil Eksekusi Terakhir</h6>
                                            <p>Tinjau restore yang berhasil, gagal, atau skip reboot tanpa bergantung pada halaman kandidat aktif.</p>
                                        </div>
                                        <div class="isolir-result-filters result-filter">
                                            <button class="btn btn-outline-secondary active" id="resultAllBtn" type="button">Semua</button>
                                            <button class="btn btn-outline-secondary" id="resultFailedBtn" type="button">Gagal</button>
                                            <button class="btn btn-outline-secondary" id="resultSkippedBtn" type="button">Reboot Skip</button>
                                        </div>
                                    </div>
                                    <div id="lastExecutionResult" class="text-muted">Belum ada eksekusi pada sesi ini.</div>
                                </div>
                            </div>
                        </div>
                        <div class="isolir-sidebar">
                            <div class="isolir-sticky">
                                <div class="isolir-panel-stack">
                                    <div class="isolir-card accent-card">
                                        <div class="card-body">
                                            <div class="isolir-section-head">
                                                <div>
                                                    <h6>Tindakan Buka Isolir</h6>
                                                    <p>Panel aksi ini tetap fokus pada restore profile utama, sementara reboot tetap opsional.</p>
                                                </div>
                                            </div>
                                            <div class="isolir-summary-box mb-3" id="genieacsNotice">Status capability reboot sedang dimuat...</div>
                                            <div class="isolir-switches mb-3">
                                                <div class="custom-control custom-switch">
                                                    <input type="checkbox" class="custom-control-input" id="rebootAfterOpen">
                                                    <label class="custom-control-label" for="rebootAfterOpen">Coba reboot router setelah buka isolir</label>
                                                </div>
                                            </div>
                                            <div class="isolir-summary-box mb-3" id="selectionSummary">Belum ada pelanggan dipilih.</div>
                                            <button class="btn btn-success btn-block" id="btnBukaIsolir" disabled type="button"><i class="fas fa-unlock mr-2"></i>Buka Isolir</button>
                                        </div>
                                    </div>
                                    <div class="isolir-card">
                                        <div class="card-body">
                                            <div class="isolir-note-box">
                                                <strong><i class="fas fa-exclamation-triangle mr-1"></i>Catatan Operasional</strong>
                                                <ul class="mb-0 mt-2 pl-3">
                                                    <li>Status pembayaran tidak berubah.</li>
                                                    <li>Disconnect sesi aktif selalu dilakukan untuk normalisasi profile.</li>
                                                    <li>Reboot hanya dicoba jika dicentang dan capability tersedia.</li>
                                                    <li>Skip reboot tidak menggagalkan restore profile.</li>
                                                </ul>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="isolir-card">
                                        <div class="card-body">
                                            <div class="isolir-section-head">
                                                <div>
                                                    <h6>Riwayat Buka Isolir</h6>
                                                    <p>Audit restore terbaru tetap mudah dibaca di layar sempit maupun lebar.</p>
                                                </div>
                                                <div class="isolir-inline-actions">
                                                    <button class="btn btn-sm btn-outline-secondary" id="refreshHistoryBtn" type="button">Refresh</button>
                                                </div>
                                            </div>
                                            <div class="isolir-table-wrap">
                                                <table class="table table-sm isolir-table history-table mb-0">
                                                    <thead><tr><th>Waktu</th><th>Actor</th><th>Ringkasan</th><th>Detail</th></tr></thead>
                                                    <tbody id="historyBody"><tr><td colspan="4" class="text-center text-muted py-3">Memuat riwayat...</td></tr></tbody>
                                                </table>
                                            </div>
                                            <div class="isolir-page-controls mt-3">
                                                <small class="text-muted" id="historyPageInfo">Halaman 1 / 1</small>
                                                <div class="btn-group btn-group-sm">
                                                    <button class="btn btn-outline-secondary" id="historyPrevPageBtn" type="button">Prev</button>
                                                    <button class="btn btn-outline-secondary" id="historyNextPageBtn" type="button">Next</button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <?php include __DIR__ . '/footer.php'; ?>
    </div>
</div>
<script src="/vendor/jquery/jquery.min.js"></script>
<script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
<script src="/js/sb-admin-2.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
<script src="<?= rafAssetUrl('/js/buka-isolir.js') ?>"></script>

</body>
</html>
