<!DOCTYPE html>
<html lang="id">

<head>
    <?php
    $pageTitle = 'RAF BOT - Cetak Voucher';
    $themeRole = 'admin';
    $pageDescription = 'RAF BOT - Generate & cetak voucher hotspot dengan layout sendiri';
    include __DIR__ . '/_head.php';
    ?>
    <link href="<?= rafAssetUrl('/css/voucher-print.css') ?>" rel="stylesheet">
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include __DIR__ . '/_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include __DIR__ . '/topbar.php'; ?>
                <div class="container-fluid">
                    <div class="page-header mb-3">
                        <h1 class="h3 mb-0 text-gray-800"><i class="fas fa-print mr-2"></i>Cetak Voucher</h1>
                        <p class="text-muted mb-0">Generate batch, pilih layout, cetak/PDF — mandiri tanpa Mikhmon.</p>
                    </div>

                    <div class="row">
                        <div class="col-lg-5 mb-4">
                            <div class="card shadow h-100">
                                <div class="card-header py-2 font-weight-bold">1. Siapkan Voucher</div>
                                <div class="card-body">
                                    <div class="form-group">
                                        <label class="small font-weight-bold">Paket Voucher</label>
                                        <select class="form-control form-control-sm" id="vpProfile"><option value="">Memuat...</option></select>
                                    </div>
                                    <ul class="nav nav-pills nav-fill mb-2" role="tablist">
                                        <li class="nav-item"><a class="nav-link active py-1" data-toggle="pill" href="#vpTabGen">Generate baru</a></li>
                                        <li class="nav-item"><a class="nav-link py-1" data-toggle="pill" href="#vpTabManual">Tempel manual</a></li>
                                    </ul>
                                    <div class="tab-content">
                                        <div class="tab-pane fade show active" id="vpTabGen">
                                            <div class="form-row">
                                                <div class="form-group col-6">
                                                    <label class="small font-weight-bold">Jumlah</label>
                                                    <input type="number" class="form-control form-control-sm" id="vpQty" value="40" min="1" max="1000">
                                                </div>
                                                <div class="form-group col-6">
                                                    <label class="small font-weight-bold">Panjang kode</label>
                                                    <input type="number" class="form-control form-control-sm" id="vpLen" value="6" min="3" max="16">
                                                </div>
                                            </div>
                                            <div class="form-row">
                                                <div class="form-group col-6">
                                                    <label class="small font-weight-bold">Jenis karakter</label>
                                                    <select class="form-control form-control-sm" id="vpChartype">
                                                        <option value="safe">Aman (tanpa 0/O/1/l)</option>
                                                        <option value="num">Angka saja</option>
                                                        <option value="lower">Huruf kecil</option>
                                                        <option value="upper">Huruf besar</option>
                                                        <option value="lower_num">Kecil + angka</option>
                                                        <option value="upper_num">Besar + angka</option>
                                                        <option value="mix">Campur semua</option>
                                                    </select>
                                                </div>
                                                <div class="form-group col-6">
                                                    <label class="small font-weight-bold">Prefix (opsional)</label>
                                                    <input type="text" class="form-control form-control-sm" id="vpPrefix" placeholder="mis. vcr-">
                                                </div>
                                            </div>
                                            <small class="text-muted d-block mb-2">Dibuat di MikroTik dalam 1 koneksi (efisien utk ratusan), tanpa kirim WA.</small>
                                            <button class="btn btn-success btn-sm btn-block" id="vpBtnGenerate"><i class="fas fa-ticket-alt mr-1"></i>Generate</button>
                                        </div>
                                        <div class="tab-pane fade" id="vpTabManual">
                                            <div class="form-group">
                                                <label class="small font-weight-bold">Kode (1 baris 1 kode, opsi <code>kode,sandi</code>)</label>
                                                <textarea class="form-control form-control-sm" id="vpManual" rows="4" placeholder="abc123&#10;def456,pass456"></textarea>
                                            </div>
                                            <div class="form-check mb-2">
                                                <input class="form-check-input" type="checkbox" id="vpManualCreate">
                                                <label class="form-check-label small" for="vpManualCreate">Buat juga di MikroTik (kode custom)</label>
                                            </div>
                                            <button class="btn btn-secondary btn-sm btn-block" id="vpBtnManual">Pakai daftar ini</button>
                                        </div>
                                    </div>
                                    <div class="alert alert-info py-2 mt-3 mb-0 small" id="vpReady">Belum ada voucher disiapkan.</div>
                                </div>
                            </div>
                        </div>

                        <div class="col-lg-7 mb-4">
                            <div class="card shadow h-100">
                                <div class="card-header py-2 font-weight-bold">2. Pilih Layout &amp; Cetak</div>
                                <div class="card-body">
                                    <div class="vp-gallery" id="vpGallery"><span class="text-muted small">Memuat layout...</span></div>
                                    <div class="form-row mt-3">
                                        <div class="form-group col-sm-4 mb-2">
                                            <label class="small font-weight-bold">Tata letak</label>
                                            <select class="form-control form-control-sm" id="vpGrid">
                                                <option value="flow">Bebas (mengalir)</option>
                                                <option value="36">36/lembar (4×9)</option>
                                            </select>
                                        </div>
                                        <div class="form-group col-sm-4 mb-2">
                                            <label class="small font-weight-bold">Ukuran kertas</label>
                                            <select class="form-control form-control-sm" id="vpPageSize">
                                                <option value="a4">A4</option>
                                                <option value="letter">US Letter</option>
                                            </select>
                                        </div>
                                        <div class="form-group col-sm-4 mb-2">
                                            <label class="small font-weight-bold">&nbsp;</label>
                                            <div class="form-check pt-1">
                                                <input class="form-check-input" type="checkbox" id="vpThermal">
                                                <label class="form-check-label small" for="vpThermal">Thermal 58mm</label>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="mt-1 mb-2">
                                        <button class="btn btn-outline-secondary btn-sm" id="vpBtnPreview"><i class="fas fa-eye mr-1"></i>Pratinjau</button>
                                        <button class="btn btn-primary btn-sm" id="vpBtnPrint" disabled><i class="fas fa-print mr-1"></i>Cetak (browser)</button>
                                        <button class="btn btn-outline-primary btn-sm" id="vpBtnPdf" disabled><i class="fas fa-file-pdf mr-1"></i>Unduh PDF</button>
                                    </div>
                                    <hr class="my-2">
                                    <div class="form-group mb-2">
                                        <label class="small font-weight-bold">Kirim PDF ke WhatsApp</label>
                                        <div class="input-group input-group-sm">
                                            <input class="form-control form-control-sm" id="vpWaPhone" placeholder="No. WA tujuan (kosongkan = owner/admin)">
                                            <div class="input-group-append">
                                                <button class="btn btn-success btn-sm" id="vpBtnSendWa" disabled><i class="fab fa-whatsapp mr-1"></i>Kirim</button>
                                            </div>
                                        </div>
                                        <small class="text-muted">Kosongkan nomor untuk mengirim ke owner/admin (accounts.json). Perlu gate <code>config.voucherPrint.sendWhatsApp.enabled</code>.</small>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="row">
                        <div class="col-12 mb-4">
                            <div class="card shadow">
                                <div class="card-header py-2 font-weight-bold">Pratinjau</div>
                                <div class="card-body p-2">
                                    <iframe id="vpPreview" title="Pratinjau voucher" style="width:100%;height:440px;border:1px solid #e3e6f0;border-radius:6px;background:#fff;"></iframe>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="row">
                        <div class="col-12 mb-4">
                            <div class="card shadow">
                                <div class="card-header py-2 font-weight-bold d-flex justify-content-between align-items-center">
                                    <span><i class="fas fa-history mr-1"></i>Riwayat Batch (cetak ulang tanpa buat user baru)</span>
                                    <button class="btn btn-outline-secondary btn-sm" id="vpBtnBatches"><i class="fas fa-sync mr-1"></i>Muat Riwayat</button>
                                </div>
                                <div class="card-body">
                                    <div class="table-responsive">
                                        <table class="table table-sm mb-1">
                                            <thead><tr><th>Waktu</th><th>Paket</th><th class="text-right">Jumlah</th><th class="text-right">Aksi</th></tr></thead>
                                            <tbody id="vpBatchBody"><tr><td colspan="4" class="text-muted text-center">Klik "Muat Riwayat" untuk menampilkan batch tersimpan.</td></tr></tbody>
                                        </table>
                                    </div>
                                    <small class="text-muted">Batch tersimpan otomatis saat Generate. Klik <b>Muat</b> untuk memuat kode yang sama, lalu cetak/kirim ulang — <b>tanpa</b> membuat voucher baru di MikroTik.</small>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="row">
                        <div class="col-lg-6 mb-4">
                            <div class="card shadow h-100">
                                <div class="card-header py-2 font-weight-bold">Pengaturan Voucher</div>
                                <div class="card-body">
                                    <div class="form-row">
                                        <div class="form-group col-md-6"><label class="small font-weight-bold">Nama WiFi</label><input class="form-control form-control-sm" id="setWifi"></div>
                                        <div class="form-group col-md-6"><label class="small font-weight-bold">No. CS</label><input class="form-control form-control-sm" id="setCs"></div>
                                    </div>
                                    <div class="form-group"><label class="small font-weight-bold">Teks portal/login</label><input class="form-control form-control-sm" id="setPortal"></div>
                                    <div class="form-group"><label class="small font-weight-bold">URL Logo</label><input class="form-control form-control-sm" id="setLogo"></div>
                                    <div class="form-row">
                                        <div class="form-group col-md-6"><label class="small font-weight-bold">Mode QR</label>
                                            <select class="form-control form-control-sm" id="setQrMode"><option value="code">Kode saja</option><option value="autologin">Auto-login URL</option></select>
                                        </div>
                                        <div class="form-group col-md-6"><label class="small font-weight-bold">Warna default</label><input class="form-control form-control-sm" id="setDefaultColor" placeholder="#BA68C8"></div>
                                    </div>
                                    <div class="form-group"><label class="small font-weight-bold">Template URL auto-login</label><input class="form-control form-control-sm" id="setAutologin" placeholder="http://10.10.0.1/login?username={kode}&password={sandi}"></div>
                                    <div class="form-group"><label class="small font-weight-bold">URL Login (baris cetak)</label><input class="form-control form-control-sm" id="setLoginUrl" placeholder="http://10.10.0.1"><small class="text-muted">Ditampilkan sbg "Login: ..." di kartu. Kosong = ambil origin dari URL auto-login.</small></div>
                                    <div class="form-group"><label class="small font-weight-bold">Catatan / Footer voucher (<code>{{note}}</code>)</label><input class="form-control form-control-sm" id="setNote" placeholder="mis. CS 0812xxxx · S&K berlaku"></div>
                                    <div class="form-group"><label class="small font-weight-bold">Peta harga &rarr; warna (JSON)</label><textarea class="form-control form-control-sm" id="setColors" rows="3"></textarea></div>
                                    <button class="btn btn-primary btn-sm" id="vpBtnSaveSettings"><i class="fas fa-save mr-1"></i>Simpan Pengaturan</button>
                                </div>
                            </div>
                        </div>

                        <div class="col-lg-6 mb-4">
                            <div class="card shadow h-100">
                                <div class="card-header py-2 font-weight-bold">Editor Layout &amp; Impor Mikhmon</div>
                                <div class="card-body">
                                    <div class="vp-help small text-muted mb-2">
                                        Placeholder: <code>{{wifi}}</code> <code>{{kode}}</code> <code>{{sandi}}</code> <code>{{harga}}</code> <code>{{masa_aktif}}</code> <code>{{durasi}}</code> <code>{{durasi_raw}}</code> <code>{{kuota}}</code> <code>{{qr}}</code> <code>{{logo}}</code> <code>{{cs}}</code> <code>{{portal}}</code> <code>{{login_url}}</code> <code>{{index}}</code> <code>{{note}}</code> <code>{{warna}}</code><br>
                                        Alias Mikhmon: <code>{{user}}</code> <code>{{password}}</code> <code>{{hotspotname}}</code> <code>{{validity}}</code> <code>{{datalimit}}</code> <code>{{type}}</code> <code>{{price_num}}</code><br>
                                        Logika (aman, tanpa PHP): <code>{{#if kuota}}…{{/if}}</code> · <code>{{#ifeq type up}}…{{else}}…{{/ifeq}}</code> · <code>{{#unless note}}…{{/unless}}</code>
                                    </div>
                                    <div class="form-row">
                                        <div class="form-group col-md-5"><label class="small font-weight-bold">ID layout</label><input class="form-control form-control-sm" id="edLayoutId" placeholder="layout-saya"></div>
                                        <div class="form-group col-md-7"><label class="small font-weight-bold">Nama</label><input class="form-control form-control-sm" id="edLayoutName" placeholder="Layout Saya"></div>
                                    </div>
                                    <div class="form-group"><label class="small font-weight-bold">Template HTML</label><textarea class="form-control form-control-sm text-monospace" id="edLayoutTpl" rows="6" style="font-size:11px;"></textarea></div>
                                    <button class="btn btn-primary btn-sm" id="vpBtnSaveLayout"><i class="fas fa-save mr-1"></i>Simpan Layout</button>
                                    <button class="btn btn-outline-danger btn-sm" id="vpBtnDeleteLayout"><i class="fas fa-trash mr-1"></i>Hapus</button>
                                    <hr>
                                    <div class="form-group"><label class="small font-weight-bold">Impor template Mikhmon (PHP)</label><textarea class="form-control form-control-sm text-monospace" id="edMikhmonPhp" rows="4" style="font-size:11px;" placeholder="Tempel isi Template Editor Mikhmon..."></textarea></div>
                                    <div class="form-group"><input class="form-control form-control-sm" id="edMikhmonName" placeholder="Nama layout hasil impor"></div>
                                    <button class="btn btn-info btn-sm" id="vpBtnImportMikhmon"><i class="fas fa-file-import mr-1"></i>Konversi &amp; Simpan</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="row">
                        <div class="col-12 mb-4">
                            <div class="card shadow">
                                <div class="card-header py-2 font-weight-bold d-flex justify-content-between align-items-center">
                                    <span>Laporan Voucher (aktivasi terpakai)</span>
                                    <button class="btn btn-outline-secondary btn-sm" id="vpBtnReport"><i class="fas fa-sync mr-1"></i>Muat</button>
                                </div>
                                <div class="card-body">
                                    <div class="row mb-3">
                                        <div class="col-md-3 col-6"><div class="small text-muted">Total aktivasi</div><div class="h4 mb-0" id="repAktivasi">-</div></div>
                                        <div class="col-md-3 col-6"><div class="small text-muted">Revenue</div><div class="h4 mb-0" id="repRevenue">-</div></div>
                                    </div>
                                    <div class="table-responsive">
                                        <table class="table table-sm">
                                            <thead><tr><th>Profil</th><th class="text-right">Aktivasi</th><th class="text-right">Revenue</th></tr></thead>
                                            <tbody id="repBody"><tr><td colspan="3" class="text-muted text-center">Klik Muat untuk menampilkan laporan.</td></tr></tbody>
                                        </table>
                                    </div>
                                    <small class="text-muted">Data dari riwayat login voucher (ingest dari Mikhmon). Revenue = jumlah harga voucher yang aktif/terpakai.</small>
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
    <script src="<?= rafAssetUrl('/js/voucher-print.js') ?>"></script>
</body>

</html>
