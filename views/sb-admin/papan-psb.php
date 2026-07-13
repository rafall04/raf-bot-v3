<!DOCTYPE html>
<html lang="en">

<head>
    <?php
    $pageTitle = 'RAF BOT - Papan PSB';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include 'topbar.php'; ?>

                <div class="container-fluid">
                    <div class="d-sm-flex align-items-center justify-content-between mb-3">
                        <h1 class="h3 mb-0 text-gray-800"><i class="fas fa-clipboard-check"></i> Papan PSB</h1>
                        <button class="btn btn-primary btn-sm" onclick="muatPapan()"><i class="fas fa-sync-alt"></i> Refresh</button>
                    </div>

                    <!-- Ringkasan -->
                    <div class="row mb-4">
                        <div class="col-md-3 mb-3">
                            <div class="card border-left-warning shadow h-100 py-2">
                                <div class="card-body">
                                    <div class="text-xs font-weight-bold text-warning text-uppercase mb-1">Belum Kepasang</div>
                                    <div class="h4 mb-0 font-weight-bold text-gray-800"><span id="sumBelum">–</span></div>
                                    <small class="text-muted"><span id="sumMenunggu">0</span> menunggu · <span id="sumDitugaskan">0</span> ditugaskan</small>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-3 mb-3">
                            <div class="card border-left-success shadow h-100 py-2">
                                <div class="card-body">
                                    <div class="text-xs font-weight-bold text-success text-uppercase mb-1">Terpasang Bulan Ini</div>
                                    <div class="h4 mb-0 font-weight-bold text-gray-800"><span id="sumTerpasang">–</span></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="row">
                        <!-- Form daftar -->
                        <div class="col-lg-5 mb-4">
                            <div class="card shadow">
                                <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-primary">Daftar PSB Baru (belum kepasang)</h6></div>
                                <div class="card-body">
                                    <div id="formAlert"></div>
                                    <form id="formPsb" onsubmit="return false;">
                                        <div class="form-group"><label>Nama pelanggan</label><input type="text" class="form-control" id="fNama" required></div>
                                        <div class="form-group"><label>No HP (WA)</label><input type="text" class="form-control" id="fHp" placeholder="0812… (jika >1 pisah pakai |)" required></div>
                                        <div class="form-group"><label>Dusun (lokasi pasang)</label><input type="text" class="form-control" id="fDusun" required></div>
                                        <div class="form-group"><label>Paket</label><input type="text" class="form-control" id="fPaket" placeholder="mis. 110rb / PAKET-110K" required></div>
                                        <div class="form-group">
                                            <label>Lokasi rumah <small class="text-muted">(link Google Maps atau <code>lat,lng</code>)</small></label>
                                            <div class="input-group">
                                                <input type="text" class="form-control" id="fLokasi" placeholder="-7.123, 111.456" required>
                                                <div class="input-group-append"><button class="btn btn-outline-secondary" type="button" onclick="ambilLokasi()">📍 Lokasi saya</button></div>
                                            </div>
                                        </div>
                                        <div class="form-group"><label>Foto KTP <span class="text-danger">*</span></label><input type="file" accept="image/*" class="form-control-file" id="fKtp" required></div>
                                        <div class="form-group"><label>Foto rumah <span class="text-danger">*</span></label><input type="file" accept="image/*" class="form-control-file" id="fRumah" required></div>
                                        <div class="form-group"><label>Catatan <small class="text-muted">(opsional)</small></label><input type="text" class="form-control" id="fCatatan" placeholder="mis. rumah cat biru"></div>
                                        <button class="btn btn-primary btn-block" id="btnSubmit" onclick="submitPsb()"><i class="fas fa-paper-plane"></i> Daftarkan &amp; umumkan ke grup</button>
                                    </form>
                                </div>
                            </div>
                        </div>

                        <!-- Daftar papan -->
                        <div class="col-lg-7 mb-4">
                            <div class="card shadow">
                                <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-primary">Daftar PSB di Papan</h6></div>
                                <div class="card-body">
                                    <div class="table-responsive">
                                        <table class="table table-sm table-hover align-middle">
                                            <thead><tr><th>Ref</th><th>Nama</th><th>Dusun</th><th>Paket</th><th>Status</th><th>Teknisi</th><th>Aksi</th></tr></thead>
                                            <tbody id="papanBody"><tr><td colspan="7" class="text-center text-muted">Memuat…</td></tr></tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script src="/js/theme.js"></script>
    <script src="/js/papan-psb.js"></script>
</body>

</html>
