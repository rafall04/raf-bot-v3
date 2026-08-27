<!DOCTYPE html>
<html lang="id">

<head>
    <?php
    $pageTitle = 'RAF BOT - Ganti Modem';
    $themeRole = 'admin';
    $pageDescription = 'Tukar modem pelanggan — nama & sandi WiFi ikut dipindahkan';
    include __DIR__ . '/_head.php';
    ?>
    <link href="<?= rafAssetUrl('/css/ganti-modem.css') ?>" rel="stylesheet">
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include __DIR__ . '/_role_aware_navbar.php'; ?>

        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include __DIR__ . '/topbar.php'; ?>

                <div class="container-fluid">
                    <div class="dashboard-header d-flex justify-content-between align-items-center flex-wrap mb-4">
                        <div>
                            <h1><i class="fas fa-exchange-alt mr-2"></i>Ganti Modem</h1>
                            <p class="mb-0">Tukar modem pelanggan. Nama &amp; sandi WiFi ikut dipindahkan supaya perangkat di rumah pelanggan tetap tersambung.</p>
                        </div>
                    </div>

                    <div class="card gm-card mb-4">
                        <div class="card-body">
                            <div class="form-row">
                                <div class="form-group col-md-6 mb-3">
                                    <label class="small mb-1">Pelanggan</label>
                                    <input type="text" id="gmCari" class="form-control form-control-sm"
                                           placeholder="Ketik nama / PPPoE / nomor HP…" autocomplete="off">
                                    <div id="gmSaran" class="gm-saran"></div>
                                    <div id="gmTerpilih" class="gm-terpilih d-none"></div>
                                </div>
                                <div class="form-group col-md-6 mb-3">
                                    <label class="small mb-1">ID modem BARU (dari GenieACS)</label>
                                    <input type="text" id="gmDeviceBaru" class="form-control form-control-sm"
                                           placeholder="mis. 00259E-HG8145V5-4857544349BD2AAD" autocomplete="off">
                                    <small class="text-muted">Modem baru harus sudah menyala, terpasang fiber, dan pernah lapor ke sistem.</small>
                                </div>
                            </div>

                            <div id="gmKredensial" class="gm-kredensial d-none">
                                <div class="small mb-2">
                                    <b>Nama WiFi &amp; sandi tidak bisa dibaca otomatis.</b>
                                    Modem lama biasanya sudah mati — itu memang alasan penggantiannya.
                                    Isi manual supaya WiFi pelanggan <b>tidak berubah</b>.
                                </div>
                                <div class="form-row">
                                    <div class="form-group col-md-6 mb-2">
                                        <label class="small mb-1">Nama WiFi (SSID)</label>
                                        <input type="text" id="gmSsid" class="form-control form-control-sm">
                                    </div>
                                    <div class="form-group col-md-6 mb-2">
                                        <label class="small mb-1">Sandi WiFi</label>
                                        <input type="text" id="gmPassword" class="form-control form-control-sm">
                                    </div>
                                </div>
                            </div>

                            <button id="gmJalankan" class="btn btn-primary btn-sm">
                                <i class="fas fa-exchange-alt"></i> Ganti Modem
                            </button>
                            <span id="gmStatus" class="ml-2 small"></span>
                        </div>
                    </div>

                    <div id="gmHasil" class="card gm-card d-none">
                        <div class="card-body">
                            <h6 class="mb-3">Hasil langkah demi langkah</h6>
                            <div id="gmLangkah"></div>
                        </div>
                    </div>

                    <div class="small text-muted">
                        <b>Urutannya disengaja:</b> nama &amp; sandi WiFi dipasang ke modem baru dan
                        dibuktikan diterima <i>lebih dulu</i>, baru kepemilikannya dipindah. Jadi kalau
                        pemasangan gagal, tidak ada yang berubah — tinggal diulang.
                    </div>
                </div>
            </div>
            <?php include __DIR__ . '/footer.php'; ?>
        </div>
    </div>

    <script src="<?= rafAssetUrl('/js/ganti-modem.js') ?>"></script>
</body>
</html>
