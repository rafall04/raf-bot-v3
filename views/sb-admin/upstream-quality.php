<?php
/**
 * Header Doc
 * Purpose: Halaman ADMIN "Kualitas Jalur Upstream" — kartu status per jalur (GMDP/IH/MNI/SF)
 *          + grafik loss & RTT dari probe policy-routed router gateway, auto-refresh. Panel
 *          kustomisasi (arah/thresholds + TAMPILAN report "data <isp>": jumlah pelanggan
 *          terdampak & on/off tiap seksi) — live tanpa restart.
 * Caller: `routes/pages.js` path `/upstream-quality`.
 * Deps: `_head.php`, `_navbar.php`, `topbar.php`, API `/api/upstream-quality/*`,
 *       `vendor/chart.js/Chart.min.js`, `static/js/upstream-quality.js`, bundle sb-admin footer.
 */
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'RAF BOT - Kualitas Jalur Upstream';
    $themeRole = 'admin';
    $pageDescription = 'Monitor loss/RTT per jalur upstream (GMDP/IH/MNI/SF) + deteksi failover';
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
            <div>
              <h1 class="h3 mb-1 text-gray-800">Kualitas Jalur Upstream</h1>
              <p class="mb-0 text-muted small">Probe policy-routed dari router gateway per jalur — jawaban "lemot dari sisi mana". Auto-refresh tiap 60 detik.</p>
            </div>
            <div>
              <button id="btn-poll-now" class="btn btn-sm btn-primary shadow-sm mr-1">
                <i class="fas fa-bolt fa-sm mr-1"></i>Probe Sekarang
              </button>
              <button id="btn-refresh" class="btn btn-sm btn-outline-secondary shadow-sm">
                <i class="fas fa-sync fa-sm"></i>
              </button>
            </div>
          </div>

          <div id="upq-alert-failover" class="alert alert-warning d-none"></div>
          <div id="upq-cards" class="row"></div>

          <div id="upq-switch-section" class="card shadow mb-4 d-none">
            <div class="card-header py-2 d-flex justify-content-between align-items-center">
              <h6 class="m-0 font-weight-bold text-primary">🔀 Switch Koneksi (alihkan jalur antar-ISP)</h6>
              <span class="small text-muted">khusus admin/owner · perubahan langsung ke router</span>
            </div>
            <div class="card-body p-2" id="upq-switch-list">
              <div class="small text-muted">Memuat…</div>
            </div>
          </div>

          <div class="row">
            <div class="col-lg-6 mb-4">
              <div class="card shadow">
                <div class="card-header py-2"><h6 class="m-0 font-weight-bold text-primary">Packet Loss (%) — 6 jam terakhir</h6></div>
                <div class="card-body" style="height:320px"><canvas id="chart-loss"></canvas></div>
              </div>
            </div>
            <div class="col-lg-6 mb-4">
              <div class="card shadow">
                <div class="card-header py-2"><h6 class="m-0 font-weight-bold text-primary">RTT rata-rata (ms) — 6 jam terakhir</h6></div>
                <div class="card-body" style="height:320px"><canvas id="chart-rtt"></canvas></div>
              </div>
            </div>
          </div>

          <div class="row">
            <div class="col-12 mb-4">
              <div class="card shadow">
                <div class="card-header py-2"><h6 class="m-0 font-weight-bold text-primary">Throughput per WAN (Mbps, rata-rata per menit) — 6 jam terakhir</h6></div>
                <div class="card-body" style="height:280px"><canvas id="chart-wan"></canvas></div>
              </div>
            </div>
          </div>

          <div id="upq-service-section" class="card shadow mb-4 d-none">
            <div class="card-header py-2 d-flex justify-content-between align-items-center">
              <h6 class="m-0 font-weight-bold text-primary">📱 Reachability Layanan × Jalur (TCP+TLS nyata dari server)</h6>
              <span class="small text-muted">Instagram/FB/WA = jaringan Meta yang sama · angka = TLS handshake ms</span>
            </div>
            <div class="card-body p-0">
              <div class="table-responsive">
                <table class="table table-sm table-bordered mb-0 text-center" style="font-size:.85rem">
                  <thead id="upq-service-head"></thead>
                  <tbody id="upq-service-body"><tr><td class="text-muted">Memuat…</td></tr></tbody>
                </table>
              </div>
            </div>
          </div>

          <div id="upq-config-section" class="card shadow mb-4">
            <div class="card-header py-2 d-flex justify-content-between align-items-center">
              <h6 class="m-0 font-weight-bold text-primary">⚙️ Pengaturan Arah &amp; Jalur (kustomisasi monitor)</h6>
              <button id="btn-config-toggle" class="btn btn-sm btn-outline-secondary">Buka</button>
            </div>
            <div class="card-body d-none" id="upq-config-body">
              <div class="alert alert-info py-2 small mb-3">
                Perubahan berlaku <b>otomatis pada siklus berikutnya (≤1 menit), tanpa restart bot</b>.
                Field <i>wiring</i> (routing-table / interface / srcIp / jalur baru) sengaja read-only —
                ubah lewat <code>config.json</code> agar probe tidak rusak. 1.1.1.1 &amp; 8.8.8.8 ditolak
                sebagai target (dipakai router untuk gateway-check).
              </div>
              <div class="row">
                <div class="col-lg-6 mb-3">
                  <h6 class="font-weight-bold small text-uppercase text-gray-600">🎯 Target ping (arah ICMP per jalur)</h6>
                  <div class="small text-muted mb-1">
                    <b>Alamat</b> boleh lebih dari satu — pisahkan dengan koma. Satu IP bukan sampel
                    yang sah untuk sebuah layanan: satu alamat bermasalah pernah membuat seluruh jalur
                    divonis terganggu. <b>Nama awam</b> = nama yang boleh disebut ke pelanggan
                    (mis. “Facebook &amp; Instagram”); kosongkan untuk nama teknis seperti “Akamai CDN”,
                    yang bagi pelanggan bukan nama apa pun.
                  </div>
                  <div class="table-responsive">
                    <table class="table table-sm mb-1" style="font-size:.85rem">
                      <thead><tr><th style="width:16%">Key</th><th style="width:22%">Label</th><th style="width:22%">Nama awam</th><th>Alamat (pisahkan koma)</th><th style="width:34px"></th></tr></thead>
                      <tbody id="upq-cfg-targets"></tbody>
                    </table>
                  </div>
                  <button class="btn btn-sm btn-outline-primary" id="btn-cfg-target-add">+ Tambah target</button>
                  <button class="btn btn-sm btn-primary" id="btn-cfg-target-save">Simpan target</button>
                </div>
                <div class="col-lg-6 mb-3">
                  <h6 class="font-weight-bold small text-uppercase text-gray-600">🌐 Layanan populer (arah TCP+TLS)</h6>
                  <div class="table-responsive">
                    <table class="table table-sm mb-1" style="font-size:.85rem">
                      <thead><tr><th style="width:22%">Key</th><th style="width:28%">Label</th><th>Host (wajib hostname)</th><th style="width:34px"></th></tr></thead>
                      <tbody id="upq-cfg-services"></tbody>
                    </table>
                  </div>
                  <button class="btn btn-sm btn-outline-primary" id="btn-cfg-service-add">+ Tambah layanan</button>
                  <button class="btn btn-sm btn-primary" id="btn-cfg-service-save">Simpan layanan</button>
                  <div class="small text-muted mt-1" id="upq-cfg-servicepaths"></div>
                </div>
              </div>
              <h6 class="font-weight-bold small text-uppercase text-gray-600 mt-2">🛣️ Jalur / ISP (label, cakupan, gateway, kapasitas)</h6>
              <div class="table-responsive">
                <table class="table table-sm mb-1" style="font-size:.85rem">
                  <thead><tr><th>Key</th><th>Wiring <span class="text-muted">(read-only)</span></th><th>Label</th><th>Terdampak (affects)</th><th>Gateway target</th><th style="width:90px">Kap. ↓Mbps</th><th style="width:90px">Kap. ↑Mbps</th></tr></thead>
                  <tbody id="upq-cfg-paths"></tbody>
                </table>
              </div>
              <button class="btn btn-sm btn-primary mb-3" id="btn-cfg-path-save">Simpan jalur</button>
              <h6 class="font-weight-bold small text-uppercase text-gray-600 mt-3">📶 Kestabilan &amp; Alarm (untuk keluhan lemot/game)</h6>
              <div class="small text-muted mb-2">
                Menjawab pertanyaan yang berbeda dari “ambang vonis” di atas: bukan
                <i>“jalurnya rusak?”</i> tapi <i>“cukup stabil untuk game?”</i>. Angka bawaannya
                hasil pengukuran 30 hari — <b>peringatan</b> menangkap kemacetan rutin jam sibuk,
                <b>buruk</b> hanya keadaan luar biasa. Menurunkannya membuat pelanggan dikabari
                setiap malam sampai kabarnya berhenti berarti.
              </div>
              <form class="form-inline" id="upq-cfg-stabilitas">
                <div class="custom-control custom-switch mr-3 mb-2">
                  <input type="checkbox" class="custom-control-input" id="cfg-stab-kabari" data-f="kabariPelanggan">
                  <label class="custom-control-label small" for="cfg-stab-kabari">Kabari pelanggan saat jaringan ramai</label>
                </div>
                <div class="custom-control custom-switch mr-3 mb-2">
                  <input type="checkbox" class="custom-control-input" id="cfg-stab-alarm" data-f="alarmAdmin">
                  <label class="custom-control-label small" for="cfg-stab-alarm">Alarm ke admin</label>
                </div>
                <label class="small mr-1 mb-2">Loss peringatan (%)</label>
                <input class="form-control form-control-sm mr-3 mb-2" style="width:5rem" type="number" step="0.5" data-f="lossPeringatanPct">
                <label class="small mr-1 mb-2">Loss buruk (%)</label>
                <input class="form-control form-control-sm mr-3 mb-2" style="width:5rem" type="number" step="0.5" data-f="lossBurukPct">
                <label class="small mr-1 mb-2">Jitter peringatan (ms)</label>
                <input class="form-control form-control-sm mr-3 mb-2" style="width:5rem" type="number" step="1" data-f="jitterPeringatanMs">
                <label class="small mr-1 mb-2">Jitter buruk (ms)</label>
                <input class="form-control form-control-sm mr-3 mb-2" style="width:5rem" type="number" step="1" data-f="jitterBurukMs">
                <label class="small mr-1 mb-2">Jendela (menit)</label>
                <input class="form-control form-control-sm mr-3 mb-2" style="width:5rem" type="number" step="1" data-f="windowMinutes">
                <label class="small mr-1 mb-2">Min sampel</label>
                <input class="form-control form-control-sm mr-3 mb-2" style="width:5rem" type="number" step="1" data-f="minSampel">
                <label class="small mr-1 mb-2">Siklus beruntun</label>
                <input class="form-control form-control-sm mr-3 mb-2" style="width:5rem" type="number" step="1" data-f="siklusBeruntun">
                <label class="small mr-1 mb-2">Cooldown (menit)</label>
                <input class="form-control form-control-sm mr-3 mb-2" style="width:5rem" type="number" step="5" data-f="cooldownMinutes">
                <label class="small mr-1 mb-2" title="Berapa target harus SEPAKAT sebelum jalur divonis bermasalah. 1 = satu target buruk sudah cukup (dulu begitu, dan satu layanan bermasalah memvonis seluruh jaringan).">Min target sepakat</label>
                <input class="form-control form-control-sm mr-3 mb-2" style="width:5rem" type="number" step="1" data-f="minTargetSepakat">
                <label class="small mr-1 mb-2" title="Jumlah probe per hop saat traceroute bukti. Di bawah ~5, loss per hop hanya bisa 0% atau 100%.">Probe traceroute</label>
                <input class="form-control form-control-sm mr-3 mb-2" style="width:5rem" type="number" step="1" data-f="traceCount">
                <button type="button" class="btn btn-sm btn-primary mb-2" id="btn-cfg-stab-save">Simpan kestabilan</button>
              </form>

              <h6 class="font-weight-bold small text-uppercase text-gray-600 mt-3">🔔 Jalur yang boleh membangunkan admin</h6>
              <div class="small text-muted mb-2">
                Kosongkan = semua jalur. Jangan sertakan jalur <b>cadangan</b> yang tak dipakai
                pelanggan: terukur, satu jalur cadangan sendirian menghasilkan 7 alert/hari, dan
                alarm harian melatih pembacanya mengabaikan alarm.
              </div>
              <form class="form-inline mb-2" id="upq-cfg-alertpaths">
                <label class="small mr-1 mb-2">Alert jalur bermasalah</label>
                <div id="upq-cfg-alertpaths-list" class="mr-3 mb-2"></div>
                <label class="small mr-1 mb-2">Alarm kestabilan</label>
                <div id="upq-cfg-alarmpaths-list" class="mr-3 mb-2"></div>
                <button type="button" class="btn btn-sm btn-primary mb-2" id="btn-cfg-alertpaths-save">Simpan jalur alarm</button>
              </form>

              <h6 class="font-weight-bold small text-uppercase text-gray-600">📐 Ambang vonis (thresholds)</h6>
              <form class="form-inline" id="upq-cfg-thresholds">
                <label class="small mr-1">Loss warn %</label><input class="form-control form-control-sm mr-3" style="width:70px" type="number" step="0.5" id="cfg-th-lossWarnPct">
                <label class="small mr-1">Loss crit %</label><input class="form-control form-control-sm mr-3" style="width:70px" type="number" step="0.5" id="cfg-th-lossCritPct">
                <label class="small mr-1">RTT warn ×</label><input class="form-control form-control-sm mr-3" style="width:70px" type="number" step="0.1" id="cfg-th-rttWarnFactor">
                <label class="small mr-1">RTT crit ×</label><input class="form-control form-control-sm mr-3" style="width:70px" type="number" step="0.1" id="cfg-th-rttCritFactor">
                <label class="small mr-1">Jenuh %</label><input class="form-control form-control-sm mr-3" style="width:70px" type="number" step="1" id="cfg-th-saturationPct">
                <button class="btn btn-sm btn-primary" type="button" id="btn-cfg-th-save">Simpan ambang</button>
              </form>
              <hr class="my-3">
              <h6 class="font-weight-bold small text-uppercase text-gray-600">🧾 Tampilan report &quot;data &lt;isp&gt;&quot;</h6>
              <div class="small text-muted mb-2">Atur seberapa ringkas/lengkap report koneksi yang dikirim ke WhatsApp — berlaku untuk report yang ditarik admin (<i>data gmdp</i>) &amp; notif alert gangguan. Live tanpa restart.</div>
              <form class="form-inline mb-2" id="upq-cfg-report">
                <label class="small mr-1">Daftar pelanggan terdampak (report)</label>
                <input class="form-control form-control-sm mr-1" style="width:80px" type="number" min="0" max="1000" step="1" id="cfg-rep-affectedListMax">
                <span class="small text-muted mr-3">0 = tampilkan semua</span>
                <label class="small mr-1">…di notif alert</label>
                <input class="form-control form-control-sm mr-3" style="width:80px" type="number" min="0" max="200" step="1" id="cfg-rep-alertAffectedListMax">
              </form>
              <div class="mb-2">
                <div class="small text-gray-600 mb-1">Seksi yang ditampilkan di report:</div>
                <div id="upq-cfg-report-sections">
                  <div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" id="cfg-rep-sec-rincianArah"><label class="form-check-label small" for="cfg-rep-sec-rincianArah">Rincian arah + terdampak</label></div>
                  <div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" id="cfg-rep-sec-layananPopuler"><label class="form-check-label small" for="cfg-rep-sec-layananPopuler">Layanan populer</label></div>
                  <div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" id="cfg-rep-sec-polaLossPerJam"><label class="form-check-label small" for="cfg-rep-sec-polaLossPerJam">Pola loss/jam (grafik)</label></div>
                  <div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" id="cfg-rep-sec-perArah24jam"><label class="form-check-label small" for="cfg-rep-sec-perArah24jam">Per-arah 24 jam</label></div>
                  <div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" id="cfg-rep-sec-gangguanTercatat"><label class="form-check-label small" for="cfg-rep-sec-gangguanTercatat">Gangguan tercatat</label></div>
                  <div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" id="cfg-rep-sec-tujuhHari"><label class="form-check-label small" for="cfg-rep-sec-tujuhHari">Rapor 7 hari</label></div>
                  <div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" id="cfg-rep-sec-insidenTerakhir"><label class="form-check-label small" for="cfg-rep-sec-insidenTerakhir">Insiden terakhir</label></div>
                </div>
              </div>
              <button class="btn btn-sm btn-primary mb-1" type="button" id="btn-cfg-report-save">Simpan tampilan report</button>
              <div class="small text-muted mt-2" id="upq-cfg-status"></div>
            </div>
          </div>

          <div class="row">
            <div class="col-lg-6 mb-4">
              <div class="card shadow">
                <div class="card-header py-2 d-flex justify-content-between align-items-center">
                  <h6 class="m-0 font-weight-bold text-primary">Rapor ISP — 7 hari</h6>
                  <span class="small text-muted">availability = % probe non-putus</span>
                </div>
                <div class="card-body p-2">
                  <div class="table-responsive">
                    <table class="table table-sm mb-0">
                      <thead><tr><th>ISP/Jalur</th><th>Avail</th><th>Loss</th><th>RTT</th><th>Sakit</th><th>Flap</th></tr></thead>
                      <tbody id="upq-report"><tr><td colspan="6" class="text-muted">Memuat…</td></tr></tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
            <div class="col-lg-6 mb-4">
              <div class="card shadow">
                <div class="card-header py-2"><h6 class="m-0 font-weight-bold text-primary">Insiden Terakhir (alert / flap / traceroute bukti)</h6></div>
                <div class="card-body p-2" id="upq-incidents" style="max-height:300px;overflow-y:auto">
                  <div class="small text-muted">Memuat…</div>
                </div>
              </div>
            </div>
          </div>

          <p class="text-muted small mb-4" id="upq-meta"></p>

        </div>
      </div>
    </div>
  </div>

  <!-- Bundle chrome sb-admin (WAJIB): toggle sidebar/dropdown/modal ada di sb-admin-2.js. -->
  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
  <script src="/js/sb-admin-2.js"></script>
  <script src="/vendor/chart.js/Chart.min.js"></script>
  <script src="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/js/upstream-quality.js') : '/js/upstream-quality.js'; ?>"></script>
</body>
</html>
