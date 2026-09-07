<!DOCTYPE html>
<html lang="id">

<head>
<?php
    // <head> bersama (tema + components-modern.css + rafAssetUrl). Jangan tulis <head> tangan.
    $pageTitle = 'Pengaturan Saya - Teknisi';
    $themeRole = 'teknisi';
    include __DIR__ . '/_head.php';
?>
    <link href="<?= rafAssetUrl('/css/teknisi-pengaturan.css') ?>" rel="stylesheet">
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
                            <span class="tk-title-icon"><i class="fas fa-sliders-h"></i></span>
                            <div>
                                <h1>Pengaturan Saya</h1>
                                <p class="tk-subtitle">Atur alert & pemantauan sesuai gaya kerjamu</p>
                            </div>
                        </div>
                        <div class="tk-actions">
                            <button class="btn btn-primary" id="btnSimpan" disabled>
                                <i class="fas fa-save"></i> Simpan
                            </button>
                        </div>
                    </div>

                    <div id="globalMessage" class="mb-3"></div>
                    <div id="gateBanner" class="alert alert-warning d-none" role="alert">
                        <i class="fas fa-exclamation-triangle"></i>
                        Fitur ini belum diaktifkan admin. Pengaturan tetap bisa disimpan dan akan
                        berlaku otomatis begitu diaktifkan.
                    </div>

                    <!-- Profil & Hubungkan WhatsApp (Fase D) -->
                    <div class="card shadow mb-4" id="profileCard" hidden>
                        <div class="card-header py-3">
                            <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-id-badge"></i> Profil &amp; WhatsApp</h6>
                        </div>
                        <div class="card-body">
                            <div class="form-group row">
                                <label class="col-sm-3 col-form-label" for="pf_name">Nama</label>
                                <div class="col-sm-6"><input type="text" class="form-control" id="pf_name" maxlength="80"></div>
                                <div class="col-sm-3"><button class="btn btn-outline-primary btn-block" id="btnSimpanNama" type="button">Simpan nama</button></div>
                            </div>
                            <div class="form-group row mb-2">
                                <label class="col-sm-3 col-form-label">Peran</label>
                                <div class="col-sm-3"><input type="text" class="form-control-plaintext" id="pf_role" readonly></div>
                                <label class="col-sm-3 col-form-label">Nomor</label>
                                <div class="col-sm-3"><input type="text" class="form-control-plaintext" id="pf_phone" readonly></div>
                            </div>
                            <hr>
                            <div class="d-flex align-items-center flex-wrap" style="gap:.75rem;">
                                <span id="waStatus" class="badge badge-secondary">WhatsApp: —</span>
                                <button class="btn btn-success btn-sm" id="btnLinkWa" type="button"><i class="fab fa-whatsapp"></i> Hubungkan WhatsApp</button>
                                <button class="btn btn-outline-danger btn-sm" id="btnUnlinkWa" type="button" hidden>Putuskan</button>
                            </div>
                            <div id="linkCodeBox" class="alert alert-info mt-3" hidden>
                                Kirim pesan ini dari WhatsApp kamu:<br>
                                <code style="font-size:1.2rem;">hubungkan <span id="linkCodeVal">------</span></code>
                                <div class="small text-muted mt-1">Kode berlaku 10 menit. Setelah terkirim, tekan tombol di atas lagi untuk cek status.</div>
                            </div>
                        </div>
                    </div>

                    <div id="loadingState" class="text-center text-muted py-5">
                        <i class="fas fa-spinner fa-spin fa-2x"></i>
                        <p class="mt-2">Memuat pengaturan…</p>
                    </div>

                    <form id="prefsForm" class="d-none">
                        <!-- Alert -->
                        <div class="card shadow mb-4">
                            <div class="card-header py-3 d-flex align-items-center justify-content-between">
                                <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-bell"></i> Alert</h6>
                                <div class="custom-control custom-switch">
                                    <input type="checkbox" class="custom-control-input" id="enabled">
                                    <label class="custom-control-label" for="enabled">Terima alert</label>
                                </div>
                            </div>
                            <div class="card-body">
                                <p class="text-muted mb-3">Pilih jenis notifikasi yang mau kamu terima.</p>
                                <div class="row" id="alertClasses">
                                    <div class="col-md-6 col-lg-3 mb-2">
                                        <div class="custom-control custom-checkbox">
                                            <input type="checkbox" class="custom-control-input alert-class" id="alert_los" data-key="los">
                                            <label class="custom-control-label" for="alert_los"><i class="fas fa-bolt text-danger"></i> LOS / Fiber putus</label>
                                        </div>
                                    </div>
                                    <div class="col-md-6 col-lg-3 mb-2">
                                        <div class="custom-control custom-checkbox">
                                            <input type="checkbox" class="custom-control-input alert-class" id="alert_redaman" data-key="redaman">
                                            <label class="custom-control-label" for="alert_redaman"><i class="fas fa-signal text-warning"></i> Redaman</label>
                                        </div>
                                    </div>
                                    <div class="col-md-6 col-lg-3 mb-2">
                                        <div class="custom-control custom-checkbox">
                                            <input type="checkbox" class="custom-control-input alert-class" id="alert_ticket_new" data-key="ticket_new">
                                            <label class="custom-control-label" for="alert_ticket_new"><i class="fas fa-ticket-alt text-info"></i> Tiket baru</label>
                                        </div>
                                    </div>
                                    <div class="col-md-6 col-lg-3 mb-2">
                                        <div class="custom-control custom-checkbox">
                                            <input type="checkbox" class="custom-control-input alert-class" id="alert_post_repair" data-key="post_repair">
                                            <label class="custom-control-label" for="alert_post_repair"><i class="fas fa-tools text-success"></i> Pasca-perbaikan</label>
                                        </div>
                                    </div>
                                </div>
                                <hr>
                                <div class="form-group row mb-0">
                                    <label class="col-sm-3 col-form-label" for="channel">Kanal pengiriman</label>
                                    <div class="col-sm-4">
                                        <select class="form-control" id="channel">
                                            <option value="both">DM &amp; Grup</option>
                                            <option value="dm">DM saja</option>
                                            <option value="group">Grup saja</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Area (Fase B) -->
                        <div class="card shadow mb-4">
                            <div class="card-header py-3">
                                <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-map-marker-alt"></i> Area Tanggung Jawab</h6>
                            </div>
                            <div class="card-body">
                                <p class="text-muted">Kosongkan = terima alert dari <strong>semua area</strong>. Isi dengan kode ODP/area (pisahkan koma) untuk hanya menerima alert area tersebut.</p>
                                <input type="text" class="form-control" id="areas" placeholder="mis: ODP-01, ODP-02">
                                <small class="text-muted">Penyaringan per-area aktif penuh pada tahap berikutnya.</small>
                            </div>
                        </div>

                        <!-- Jam Diam & Snooze (Fase C) -->
                        <div class="card shadow mb-4">
                            <div class="card-header py-3 d-flex align-items-center justify-content-between">
                                <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-moon"></i> Jam Diam &amp; Jeda</h6>
                                <div class="custom-control custom-switch">
                                    <input type="checkbox" class="custom-control-input" id="qh_enabled">
                                    <label class="custom-control-label" for="qh_enabled">Aktifkan jam diam</label>
                                </div>
                            </div>
                            <div class="card-body">
                                <div class="form-group row">
                                    <label class="col-sm-3 col-form-label" for="qh_start">Mulai</label>
                                    <div class="col-sm-3"><input type="time" class="form-control" id="qh_start" value="22:00"></div>
                                    <label class="col-sm-2 col-form-label" for="qh_end">Sampai</label>
                                    <div class="col-sm-3"><input type="time" class="form-control" id="qh_end" value="06:00"></div>
                                </div>
                                <hr>
                                <div class="form-group row mb-0 align-items-center">
                                    <label class="col-sm-3 col-form-label">Jeda sementara</label>
                                    <div class="col-sm-9">
                                        <div class="btn-group btn-group-sm" role="group" id="snoozeGroup">
                                            <button type="button" class="btn btn-outline-secondary" data-mins="60">1 jam</button>
                                            <button type="button" class="btn btn-outline-secondary" data-mins="180">3 jam</button>
                                            <button type="button" class="btn btn-outline-secondary" data-mins="480">8 jam</button>
                                            <button type="button" class="btn btn-outline-danger" data-mins="0">Batalkan jeda</button>
                                        </div>
                                        <span id="snoozeStatus" class="ml-2 text-muted small"></span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Pantau Pribadi (Fase C) -->
                        <div class="card shadow mb-4">
                            <div class="card-header py-3">
                                <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-satellite-dish"></i> Pantau Redaman Pribadi</h6>
                            </div>
                            <div class="card-body">
                                <p class="text-muted">Setelan default saat kamu jalankan <code>pantau redaman</code> di WhatsApp. Kosongkan untuk pakai default sistem.</p>
                                <div class="form-group row">
                                    <label class="col-sm-3 col-form-label" for="pantau_interval">Interval (menit)</label>
                                    <div class="col-sm-3"><input type="number" min="1" step="1" class="form-control" id="pantau_interval" placeholder="default"></div>
                                    <label class="col-sm-3 col-form-label" for="pantau_target">Target (dBm)</label>
                                    <div class="col-sm-3"><input type="number" step="0.1" class="form-control" id="pantau_target" placeholder="mis: -22"></div>
                                </div>
                            </div>
                        </div>

                        <div class="text-right mb-5">
                            <button class="btn btn-primary btn-lg" id="btnSimpanBottom" type="submit">
                                <i class="fas fa-save"></i> Simpan Pengaturan
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script src="<?= rafAssetUrl('/js/teknisi-pengaturan.js') ?>"></script>
</body>
</html>
