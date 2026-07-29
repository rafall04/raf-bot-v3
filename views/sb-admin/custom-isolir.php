<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'RAF BOT - Custom Isolir';
    $themeRole = 'admin';
    $pageDescription = 'RAF BOT - Custom Isolir';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/css/isolir-workspace.css" rel="stylesheet">
    <link href="<?= rafAssetUrl('/css/custom-isolir.css') ?>" rel="stylesheet">

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
                        <h1><i class="fas fa-user-lock mr-2"></i>Custom Isolir</h1>
                        <p>Workspace batch isolir manual untuk operator: pilih kandidat, cek capability reboot, lalu eksekusi tanpa kehilangan konteks selection lintas halaman.</p>
                        <div class="isolir-header-actions">
                            <span class="isolir-header-chip"><i class="fas fa-layer-group"></i>Selection global lintas halaman</span>
                            <span class="isolir-header-chip"><i class="fas fa-history"></i>Audit trail siap telusur</span>
                            <span class="isolir-header-chip"><i class="fas fa-wifi"></i>Reboot tetap opsional</span>
                        </div>
                    </div>
                    <div class="isolir-grid">
                        <div class="isolir-main">
                            <div class="isolir-card">
                                <div class="card-body">
                                    <div class="isolir-section-head">
                                        <div>
                                            <h6>Workspace Kandidat</h6>
                                            <p>Filter, pilih, dan tinjau pelanggan yang akan diisolir sebelum aksi dijalankan.</p>
                                        </div>
                                    </div>
                                    <div class="isolir-toolbar">
                                        <div class="isolir-toolbar-row is-three">
                                            <input class="form-control" id="candidateSearch" placeholder="Cari nama, PPPoE, paket, atau profile">
                                            <select class="form-control" id="subscriptionFilter"><option value="">Semua paket</option></select>
                                            <select class="form-control" id="stateFilter"><option value="">Semua status</option><option value="isolated">Sudah terisolir</option><option value="active">Masih aktif</option></select>
                                        </div>
                                        <div class="isolir-toolbar-row is-two">
                                            <small class="text-muted" id="filterSummary">Belum ada data kandidat.</small>
                                            <div class="isolir-toolbar-actions">
                                                <button class="btn btn-outline-danger" id="refreshCandidatesBtn" type="button"><i class="fas fa-sync-alt mr-1"></i>Refresh</button>
                                                <button class="btn btn-outline-secondary" id="selectCurrentPageBtn" type="button">Pilih Halaman Ini</button>
                                                <button class="btn btn-outline-secondary" id="clearSelectionBtn" type="button">Clear</button>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="isolir-list" id="candidateGrid"><div class="isolir-empty">Memuat kandidat isolir...</div></div>
                                    <div class="isolir-page-controls mt-3">
                                        <small class="text-muted" id="candidatePageInfo">Halaman 1 / 1</small>
                                        <div class="btn-group btn-group-sm">
                                            <button class="btn btn-outline-secondary" id="candidatePrevPageBtn" type="button">Prev</button>
                                            <button class="btn btn-outline-secondary" id="candidateNextPageBtn" type="button">Next</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="isolir-card">
                                <div class="card-body">
                                    <div class="isolir-section-head">
                                        <div>
                                            <h6>Hasil Eksekusi Terakhir</h6>
                                            <p>Gunakan filter ini untuk audit cepat dan retry pelanggan yang gagal.</p>
                                        </div>
                                        <div class="isolir-inline-actions">
                                            <button class="btn btn-sm btn-outline-danger" id="selectFailedOnlyBtn" type="button">Pilih Failed Only</button>
                                        </div>
                                    </div>
                                    <div class="isolir-result-filters mb-3 result-filter">
                                        <button class="btn btn-outline-secondary active" id="executionFilterAllBtn" type="button">Semua</button>
                                        <button class="btn btn-outline-secondary" id="executionFilterSuccessBtn" type="button">Sukses</button>
                                        <button class="btn btn-outline-secondary" id="executionFilterFailedBtn" type="button">Gagal</button>
                                        <button class="btn btn-outline-secondary" id="executionFilterRebootSkippedBtn" type="button">Reboot Skip</button>
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
                                                    <h6>Tindakan Manual</h6>
                                                    <p>Setel profile target, catatan operasional, dan opsi disconnect atau reboot.</p>
                                                </div>
                                            </div>
                                            <div class="form-group"><label for="targetProfile">Target Profile</label><select class="form-control" id="targetProfile"></select></div>
                                            <div class="form-group"><label for="isolirReason">Alasan / Catatan</label><textarea class="form-control" id="isolirReason" rows="4" placeholder="Contoh: isolir manual karena override operasional"></textarea></div>
                                            <div class="isolir-switches mb-3">
                                                <div class="custom-control custom-switch"><input type="checkbox" class="custom-control-input" id="disconnectFlag"><label class="custom-control-label" for="disconnectFlag">Disconnect active session</label></div>
                                                <div class="custom-control custom-switch"><input type="checkbox" class="custom-control-input" id="rebootFlag"><label class="custom-control-label" for="rebootFlag">Reboot router jika capability tersedia</label></div>
                                            </div>
                                            <div class="isolir-summary-box mb-3" id="genieacsNotice">Status capability GenieACS sedang dimuat...</div>
                                            <div class="isolir-summary-box mb-3" id="selectionSummary">Belum ada pelanggan dipilih.</div>
                                            <button class="btn btn-danger btn-block" id="runIsolirBtn" disabled type="button"><i class="fas fa-user-lock mr-2"></i>Jalankan Custom Isolir</button>
                                        </div>
                                    </div>
                                    <div class="isolir-card">
                                        <div class="card-body">
                                            <div class="isolir-section-head">
                                                <div>
                                                    <h6>Riwayat Isolir</h6>
                                                    <p>Lacak manual isolir dan buka isolir dari audit store yang sama.</p>
                                                </div>
                                                <div class="isolir-inline-actions">
                                                    <select class="form-control form-control-sm" id="historyFilter">
                                                        <option value="all">Semua aksi</option>
                                                        <option value="manual_isolir">Manual isolir</option>
                                                        <option value="open_isolir">Buka isolir</option>
                                                    </select>
                                                    <button class="btn btn-sm btn-outline-secondary" id="refreshHistoryBtn" type="button">Refresh</button>
                                                </div>
                                            </div>
                                            <div class="isolir-table-wrap"><table class="table table-sm isolir-table history-table mb-0"><thead><tr><th>Waktu</th><th>Aksi</th><th>Actor</th><th>Ringkasan</th><th>Detail</th></tr></thead><tbody id="historyBody"><tr><td colspan="5" class="text-center text-muted py-3">Memuat riwayat...</td></tr></tbody></table></div>
                                            <div class="isolir-page-controls mt-3"><small class="text-muted" id="historyPageInfo">Halaman 1 / 1</small><div class="btn-group btn-group-sm"><button class="btn btn-outline-secondary" id="historyPrevPageBtn" type="button">Prev</button><button class="btn btn-outline-secondary" id="historyNextPageBtn" type="button">Next</button></div></div>
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
<script src="<?= rafAssetUrl('/js/custom-isolir.js') ?>"></script>

</body>
</html>
