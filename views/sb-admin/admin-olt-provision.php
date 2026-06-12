<!DOCTYPE html>
<html lang="id">
<!--
Header Doc
Purpose: Halaman admin provisioning OLT ZTE — registrasi ONU pelanggan via SSH (scan uncfg,
         pilih tipe modem, preview script, eksekusi + verifikasi), kelola profil tipe modem,
         dan backup konfigurasi OLT (manual + jadwal otomatis).
Caller: `routes/pages.js` pada path `/admin-olt-provision`.
Deps: `_head.php`, `_navbar.php`, `topbar.php`, API `/api/olt/provision/*`, `/api/users`,
      JS `static/js/admin-olt-provision.js`, CSS `static/css/admin-olt-provision.css`.
MainFuncs: lihat static/js/admin-olt-provision.js (scanUncfg, previewScript, executeRegister, dst).
SideEffects: Eksekusi perintah konfigurasi ke OLT via backend; menulis file backup di server.
-->
<head>
    <?php
    $pageTitle = 'RAF BOT - Provisioning OLT';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>
    <link href="/css/admin-olt-provision.css" rel="stylesheet">
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include 'topbar.php'; ?>

                <div class="container-fluid">
                    <div class="dashboard-header">
                        <div class="d-flex align-items-center justify-content-between flex-wrap">
                            <div>
                                <h1>Provisioning OLT <span class="badge badge-info align-middle">ZTE C320</span></h1>
                                <p>Registrasi ONU pelanggan via SSH, kelola tipe modem, dan backup konfigurasi OLT.</p>
                            </div>
                            <div>
                                <a href="/admin-olt" class="btn btn-outline-primary btn-sm"><i class="fas fa-broadcast-tower"></i> Monitor OLT</a>
                            </div>
                        </div>
                    </div>

                    <div id="provAlert" class="alert" style="display:none;"><span id="provAlertMsg"></span></div>

                    <ul class="nav nav-tabs mb-3" id="provTabs" role="tablist">
                        <li class="nav-item"><a class="nav-link active" data-toggle="tab" href="#tab-register" role="tab"><i class="fas fa-plug"></i> Registrasi ONU</a></li>
                        <li class="nav-item"><a class="nav-link" data-toggle="tab" href="#tab-types" role="tab"><i class="fas fa-microchip"></i> Tipe Modem</a></li>
                        <li class="nav-item"><a class="nav-link" data-toggle="tab" href="#tab-backup" role="tab"><i class="fas fa-database"></i> Backup OLT</a></li>
                    </ul>

                    <div class="tab-content">

                        <!-- ════════ TAB 1: REGISTRASI ONU ════════ -->
                        <div class="tab-pane fade show active" id="tab-register" role="tabpanel">
                            <div class="row">
                                <div class="col-lg-5 mb-4">
                                    <div class="card shadow h-100">
                                        <div class="card-header py-3 d-flex justify-content-between align-items-center">
                                            <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-search"></i> 1 · Pilih OLT &amp; Scan ONU Baru</h6>
                                        </div>
                                        <div class="card-body">
                                            <div class="form-group">
                                                <label for="provOltSelect">OLT</label>
                                                <div class="input-group">
                                                    <select id="provOltSelect" class="form-control"><option value="">— Pilih OLT —</option></select>
                                                    <div class="input-group-append">
                                                        <button class="btn btn-outline-secondary" id="testSshBtn" title="Test koneksi SSH"><i class="fas fa-terminal"></i></button>
                                                    </div>
                                                </div>
                                                <small class="form-text text-muted" id="provOltSshInfo">Kredensial SSH diatur di <a href="/config">Konfigurasi → OLT</a> (edit perangkat).</small>
                                            </div>
                                            <div class="small text-muted mb-2" id="oltFactsInfo"></div>
                                            <button class="btn btn-primary btn-block" id="scanUncfgBtn"><i class="fas fa-sync-alt"></i> Scan ONU Belum Teregistrasi</button>
                                            <div class="table-responsive mt-3">
                                                <table class="table table-sm table-bordered" id="uncfgTable">
                                                    <thead class="thead-light"><tr><th>Serial Number</th><th>Port PON</th><th>Status</th><th></th></tr></thead>
                                                    <tbody><tr><td colspan="4" class="text-center text-muted">Belum di-scan</td></tr></tbody>
                                                </table>
                                            </div>

                                            <hr>
                                            <h6 class="font-weight-bold text-primary"><i class="fas fa-tools"></i> ONU Terdaftar — cek / konfig / hapus</h6>
                                            <div class="form-row">
                                                <div class="col-5"><input type="text" class="form-control form-control-sm" id="toolPonPort" list="ponPortList" placeholder="Port PON (1/2/1)"></div>
                                                <div class="col-3"><input type="number" class="form-control form-control-sm" id="toolOnuId" min="1" max="128" placeholder="ONU ID"></div>
                                                <div class="col-4 btn-group">
                                                    <button class="btn btn-outline-primary btn-sm" id="toolStatusBtn" title="Cek status & redaman"><i class="fas fa-heartbeat"></i></button>
                                                    <button class="btn btn-outline-secondary btn-sm" id="toolConfigBtn" title="Lihat konfigurasi ONU"><i class="fas fa-file-alt"></i></button>
                                                    <button class="btn btn-outline-danger btn-sm" id="toolDeleteBtn" title="Hapus ONU dari OLT"><i class="fas fa-trash"></i></button>
                                                </div>
                                            </div>
                                            <div class="small mt-2" id="toolsResult"></div>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-lg-7 mb-4">
                                    <div class="card shadow">
                                        <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-user-plus"></i> 2 · Data Registrasi</h6></div>
                                        <div class="card-body">
                                            <div class="form-row">
                                                <div class="form-group col-md-6">
                                                    <label for="regSn">Serial Number (SN)</label>
                                                    <input type="text" class="form-control text-uppercase" id="regSn" placeholder="ZTEGCCA16805" autocomplete="off">
                                                </div>
                                                <div class="form-group col-md-3">
                                                    <label for="regPonPort">Port PON</label>
                                                    <input type="text" class="form-control" id="regPonPort" list="ponPortList" placeholder="1/3/16" autocomplete="off">
                                                    <datalist id="ponPortList"></datalist>
                                                </div>
                                                <div class="form-group col-md-3">
                                                    <label for="regOnuId">ONU ID <a href="#" id="checkOccupancyBtn" class="small" title="Cek slot terpakai & saran ID">cek slot</a></label>
                                                    <input type="number" class="form-control" id="regOnuId" min="1" max="128" placeholder="auto">
                                                </div>
                                            </div>
                                            <div class="small text-muted mb-2" id="occupancyInfo" style="display:none;"></div>

                                            <div class="form-group">
                                                <label for="regOnuType">Tipe Modem / Profil Registrasi</label>
                                                <select id="regOnuType" class="form-control"></select>
                                                <small class="form-text text-muted" id="regOnuTypeNotes"></small>
                                            </div>

                                            <div class="form-group">
                                                <label for="regCustomer">Pelanggan (opsional — isi otomatis nama &amp; PPPoE)</label>
                                                <input type="text" class="form-control" id="regCustomer" list="customerList" placeholder="ketik nama pelanggan…" autocomplete="off">
                                                <datalist id="customerList"></datalist>
                                            </div>

                                            <div class="form-row">
                                                <div class="form-group col-md-6">
                                                    <label for="regName">Nama ONU <small class="text-muted">(tanpa spasi)</small></label>
                                                    <input type="text" class="form-control" id="regName" placeholder="NGJ-KAI-NGUJO-1/1" autocomplete="off">
                                                </div>
                                                <div class="form-group col-md-6">
                                                    <label for="regDescription">Deskripsi / ODP <small class="text-muted">(tanpa spasi)</small></label>
                                                    <input type="text" class="form-control" id="regDescription" placeholder="ODP-NGJ-1/1" autocomplete="off">
                                                </div>
                                            </div>
                                            <div class="form-row">
                                                <div class="form-group col-md-6">
                                                    <label for="regPppoeUser">Username PPPoE</label>
                                                    <div class="input-group">
                                                        <input type="text" class="form-control" id="regPppoeUser" autocomplete="off">
                                                        <div class="input-group-append">
                                                            <button class="btn btn-outline-secondary" id="copyNameToPppoeBtn" title="Samakan dengan Nama ONU" type="button"><i class="fas fa-equals"></i></button>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div class="form-group col-md-6">
                                                    <label for="regPppoePassword">Password PPPoE</label>
                                                    <input type="text" class="form-control" id="regPppoePassword" autocomplete="off">
                                                </div>
                                            </div>

                                            <a class="small" data-toggle="collapse" href="#advancedVars" role="button"><i class="fas fa-sliders-h"></i> Parameter lanjutan (VLAN, profil bandwidth, ACS, SSID)…</a>
                                            <div class="collapse mt-2" id="advancedVars">
                                                <div class="card card-body py-2" id="advancedVarsBody">
                                                    <div class="text-muted small">Pilih tipe modem dulu — parameter default profil akan muncul di sini dan bisa diubah per-registrasi.</div>
                                                </div>
                                            </div>

                                            <hr>
                                            <div class="d-flex justify-content-end">
                                                <button class="btn btn-secondary mr-2" id="resetFormBtn" type="button"><i class="fas fa-undo"></i> Reset</button>
                                                <button class="btn btn-primary" id="previewBtn" type="button"><i class="fas fa-file-code"></i> Preview Script</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- ════════ TAB 2: TIPE MODEM ════════ -->
                        <div class="tab-pane fade" id="tab-types" role="tabpanel">
                            <div class="card shadow mb-4">
                                <div class="card-header py-3 d-flex justify-content-between align-items-center flex-wrap">
                                    <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-microchip"></i> Profil Tipe Modem</h6>
                                    <div>
                                        <button class="btn btn-outline-secondary btn-sm mr-1" id="restoreBuiltinBtn"><i class="fas fa-history"></i> Pulihkan Bawaan</button>
                                        <button class="btn btn-primary btn-sm" id="addTypeBtn"><i class="fas fa-plus"></i> Tambah Profil</button>
                                    </div>
                                </div>
                                <div class="card-body">
                                    <p class="small text-muted mb-2">Tiap profil = template script CLI registrasi + parameter default. Placeholder <code>{{nama}}</code> diganti otomatis dari form registrasi.</p>
                                    <div class="table-responsive">
                                        <table class="table table-bordered" id="typesTable">
                                            <thead class="thead-light"><tr><th>Nama Profil</th><th>Catatan</th><th>Parameter Default</th><th style="width:130px">Aksi</th></tr></thead>
                                            <tbody></tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- ════════ TAB 3: BACKUP ════════ -->
                        <div class="tab-pane fade" id="tab-backup" role="tabpanel">
                            <div class="row">
                                <div class="col-lg-5 mb-4">
                                    <div class="card shadow h-100">
                                        <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-clock"></i> Auto-Backup Terjadwal</h6></div>
                                        <div class="card-body">
                                            <div class="form-group">
                                                <label for="bkEnabled">Status</label>
                                                <select id="bkEnabled" class="form-control">
                                                    <option value="false">Nonaktif</option>
                                                    <option value="true">Aktif</option>
                                                </select>
                                            </div>
                                            <div class="form-group">
                                                <label for="bkSchedulePreset">Jadwal</label>
                                                <select id="bkSchedulePreset" class="form-control mb-1">
                                                    <option value="30 2 * * *">Setiap hari 02:30</option>
                                                    <option value="0 3 * * 0">Setiap Minggu 03:00</option>
                                                    <option value="0 3 1 * *">Tanggal 1 tiap bulan 03:00</option>
                                                    <option value="custom">Custom (cron)…</option>
                                                </select>
                                                <input type="text" id="bkSchedule" class="form-control" placeholder="30 2 * * *" style="display:none;">
                                                <small class="form-text text-muted">Format cron 5 kolom, zona waktu WIB.</small>
                                            </div>
                                            <div class="form-group">
                                                <label for="bkMethod">Metode Backup</label>
                                                <select id="bkMethod" class="form-control">
                                                    <option value="ftp">FTP upload — cepat ±10 detik (startup-config, hasil write terakhir)</option>
                                                    <option value="capture">Capture running-config — 15-20 menit (kondisi berjalan)</option>
                                                </select>
                                                <small class="form-text text-muted">FTP: bot menyalakan FTP receiver sementara lalu menyuruh OLT <code>file upload cfg-startup … ftp …</code>. Pastikan fitur <b>write</b> dipakai saat registrasi agar startup-config selalu terkini.</small>
                                            </div>
                                            <div class="form-row" id="bkFtpFields">
                                                <div class="form-group col-md-8">
                                                    <label for="bkFtpSelfHost">IP bot dari sisi OLT</label>
                                                    <input type="text" id="bkFtpSelfHost" class="form-control" placeholder="172.17.231.2">
                                                    <small class="form-text text-muted">IP server bot yang bisa di-ping DARI OLT (cek <code>show ip route</code> di OLT). Di server bot, buka firewall port <b>21</b> + PASV <b>50000-50050</b>.</small>
                                                </div>
                                                <div class="form-group col-md-4">
                                                    <label for="bkFtpPort">Port FTP</label>
                                                    <input type="number" id="bkFtpPort" class="form-control" value="21" min="1" max="65535">
                                                    <small class="form-text text-muted">ZXAN hanya bisa port 21.</small>
                                                </div>
                                            </div>
                                            <div class="form-row">
                                                <div class="form-group col-md-6">
                                                    <label for="bkKeep">Simpan (file/OLT)</label>
                                                    <input type="number" id="bkKeep" class="form-control" min="1" max="365" value="30">
                                                </div>
                                                <div class="form-group col-md-6">
                                                    <label for="bkTelegram">Kirim ke Telegram</label>
                                                    <select id="bkTelegram" class="form-control">
                                                        <option value="false">Tidak</option>
                                                        <option value="true">Ya (bot backup DB)</option>
                                                    </select>
                                                </div>
                                            </div>
                                            <button class="btn btn-primary btn-block" id="saveBackupCfgBtn"><i class="fas fa-save"></i> Simpan Setting</button>
                                            <hr>
                                            <button class="btn btn-outline-primary btn-block" id="backupAllBtn"><i class="fas fa-download"></i> Backup Semua OLT Sekarang</button>
                                            <small class="text-muted d-block mt-1">Backup = capture <code>show running-config</code> via SSH. OLT tanpa kredensial SSH dilewati. <b>C320 dengan ratusan ONU bisa 15-20 menit per OLT</b> (build config lambat di sisi OLT) — biarkan berjalan; proses gagal hanya bila output berhenti mengalir 2 menit.</small>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-lg-7 mb-4">
                                    <div class="card shadow h-100">
                                        <div class="card-header py-3 d-flex justify-content-between align-items-center">
                                            <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-archive"></i> File Backup</h6>
                                            <button class="btn btn-outline-secondary btn-sm" id="refreshBackupsBtn"><i class="fas fa-sync-alt"></i></button>
                                        </div>
                                        <div class="card-body">
                                            <div class="table-responsive">
                                                <table class="table table-sm table-bordered" id="backupsTable">
                                                    <thead class="thead-light"><tr><th>OLT</th><th>File</th><th>Ukuran</th><th>Waktu</th><th></th></tr></thead>
                                                    <tbody><tr><td colspan="5" class="text-center text-muted">Belum ada backup</td></tr></tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div><!-- /.tab-content -->
                </div>
            </div>
            <footer class="sticky-footer bg-white">
                <div class="container my-auto">
                    <div class="copyright text-center my-auto"><span>Copyright &copy; RAF BOT 2025</span></div>
                </div>
            </footer>
        </div>
    </div>

    <a class="scroll-to-top rounded" href="#page-top"><i class="fas fa-angle-up"></i></a>

    <!-- Logout Modal -->
    <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog" aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Ready to Leave?</h5>
                    <button class="close" type="button" data-dismiss="modal"><span aria-hidden="true">&times;</span></button>
                </div>
                <div class="modal-body">Select "Logout" below if you are ready to end your current session.</div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button>
                    <a class="btn btn-primary" href="/logout">Logout</a>
                </div>
            </div>
        </div>
    </div>

    <!-- Modal: Preview & Eksekusi Script -->
    <div class="modal fade" id="previewModal" tabindex="-1" role="dialog" aria-hidden="true" data-backdrop="static">
        <div class="modal-dialog modal-lg" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title"><i class="fas fa-file-code"></i> Preview Script Registrasi</h5>
                    <button class="close" type="button" data-dismiss="modal"><span aria-hidden="true">&times;</span></button>
                </div>
                <div class="modal-body">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <span class="small text-muted" id="previewMeta"></span>
                        <button class="btn btn-outline-secondary btn-sm" id="copyScriptBtn"><i class="fas fa-copy"></i> Salin</button>
                    </div>
                    <pre class="cli-script" id="previewScript"></pre>
                    <div id="previewFactIssues" class="alert alert-danger small" style="display:none;"></div>
                    <div class="alert alert-warning small mb-0">
                        <i class="fas fa-exclamation-triangle"></i> Script dieksekusi <b>baris-per-baris</b> ke OLT dan berhenti di baris pertama yang error. Baris <code>!</code> dikirim sebagai <code>exit</code> (keluar konteks — wajib di ZXAN). Periksa VLAN/profil sebelum eksekusi.
                    </div>
                    <div class="custom-control custom-checkbox mt-2">
                        <input type="checkbox" class="custom-control-input" id="confirmExecuteCheck">
                        <label class="custom-control-label" for="confirmExecuteCheck">Saya sudah memeriksa script di atas</label>
                    </div>
                    <div class="custom-control custom-checkbox mt-1">
                        <input type="checkbox" class="custom-control-input" id="saveConfigCheck" checked>
                        <label class="custom-control-label" for="saveConfigCheck">Simpan permanen (<code>write</code>) setelah sukses — tanpa ini registrasi hilang saat OLT reboot</label>
                    </div>
                    <div class="custom-control custom-checkbox mt-1" id="forceWrap" style="display:none;">
                        <input type="checkbox" class="custom-control-input" id="forceExecuteCheck">
                        <label class="custom-control-label text-danger" for="forceExecuteCheck">Abaikan peringatan kondisi OLT di atas (saya yakin fakta OLT basi) — eksekusi tetap</label>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button class="btn btn-danger" id="executeBtn" disabled><i class="fas fa-bolt"></i> Eksekusi ke OLT</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Modal: Hasil Eksekusi + Verifikasi -->
    <div class="modal fade" id="resultModal" tabindex="-1" role="dialog" aria-hidden="true" data-backdrop="static">
        <div class="modal-dialog modal-lg" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="resultTitle"><i class="fas fa-tasks"></i> Hasil Eksekusi</h5>
                    <button class="close" type="button" data-dismiss="modal"><span aria-hidden="true">&times;</span></button>
                </div>
                <div class="modal-body">
                    <div id="resultSummary" class="mb-2"></div>
                    <div class="cli-result-log" id="resultLog"></div>
                    <hr>
                    <h6 class="font-weight-bold"><i class="fas fa-heartbeat"></i> Verifikasi ONU</h6>
                    <div id="verifyPanel" class="small text-muted">Menunggu eksekusi…</div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline-danger mr-auto" id="rollbackBtn" style="display:none;"><i class="fas fa-trash-restore"></i> Rollback (hapus ONU)</button>
                    <button class="btn btn-outline-primary" id="checkStatusBtn"><i class="fas fa-heartbeat"></i> Cek Status ONU</button>
                    <button class="btn btn-secondary" data-dismiss="modal">Tutup</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Modal: Viewer Konfigurasi ONU -->
    <div class="modal fade" id="onuConfigModal" tabindex="-1" role="dialog" aria-hidden="true">
        <div class="modal-dialog modal-lg" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title"><i class="fas fa-file-alt"></i> Konfigurasi ONU — <span id="onuConfigTarget"></span></h5>
                    <button class="close" type="button" data-dismiss="modal"><span aria-hidden="true">&times;</span></button>
                </div>
                <div class="modal-body">
                    <h6 class="small font-weight-bold text-muted">INTERFACE (tcont / gemport / service-port)</h6>
                    <pre class="cli-script mb-3" id="onuConfigInterface"></pre>
                    <h6 class="small font-weight-bold text-muted">PON-ONU-MNG (service / wan / vlan port / ssid)</h6>
                    <pre class="cli-script mb-0" id="onuConfigMng"></pre>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" data-dismiss="modal">Tutup</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Modal: Editor Profil Tipe Modem -->
    <div class="modal fade" id="typeModal" tabindex="-1" role="dialog" aria-hidden="true" data-backdrop="static">
        <div class="modal-dialog modal-xl" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="typeModalTitle">Tambah Profil Tipe Modem</h5>
                    <button class="close" type="button" data-dismiss="modal"><span aria-hidden="true">&times;</span></button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="typeId">
                    <div class="form-row">
                        <div class="form-group col-md-6">
                            <label for="typeName">Nama Profil</label>
                            <input type="text" class="form-control" id="typeName" placeholder="ZTE F660 Router — PPPoE">
                        </div>
                        <div class="form-group col-md-6">
                            <label for="typeNotes">Catatan</label>
                            <input type="text" class="form-control" id="typeNotes" placeholder="Kapan profil ini dipakai…">
                        </div>
                    </div>
                    <div class="row">
                        <div class="col-lg-7">
                            <label>Template Script CLI</label>
                            <textarea id="typeTemplate" class="form-control cli-editor" rows="18" spellcheck="false"></textarea>
                        </div>
                        <div class="col-lg-5">
                            <label>Parameter Default <small class="text-muted">(dipakai bila form tidak mengisi)</small></label>
                            <div id="typeVarsRows"></div>
                            <button class="btn btn-outline-secondary btn-sm mt-1" id="addVarRowBtn" type="button"><i class="fas fa-plus"></i> Tambah Parameter</button>
                            <hr>
                            <a class="small" data-toggle="collapse" href="#placeholderHelp"><i class="fas fa-question-circle"></i> Daftar placeholder…</a>
                            <div class="collapse mt-1" id="placeholderHelp">
                                <table class="table table-sm small mb-0" id="placeholderTable"><tbody></tbody></table>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button class="btn btn-primary" id="saveTypeBtn"><i class="fas fa-save"></i> Simpan Profil</button>
                </div>
            </div>
        </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>

    <script src="/js/admin-olt-provision.js"></script>
</body>
</html>
