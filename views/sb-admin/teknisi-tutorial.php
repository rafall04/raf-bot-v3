<!DOCTYPE html>
<html lang="id">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>Panduan Teknisi - RAF NET</title>
    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css?family=Nunito:200,300,400,600,700,800,900" rel="stylesheet">
<?php require_once __DIR__ . '/_asset.php'; ?>
    <link href="<?= rafAssetUrl('/css/sb-admin-2.min.css') ?>" rel="stylesheet">
    <link href="<?= rafAssetUrl('/css/dashboard-modern.css') ?>" rel="stylesheet">
    <link href="<?= rafAssetUrl('/css/teknisi-theme.css') ?>" rel="stylesheet">
    <style>
      .tut {
        --psb: #0E8A63; --psb-soft: #E6F4EE; --psb-ink: #0A5C43;
        --repair: #C96A18; --repair-soft: #FBEEDF; --repair-ink: #8F4A0E;
        --tline: #E0E9E4; --tink: #17251F; --tsoft: #52635C; --tfaint: #8A9791;
        --chat: #DEF1E4; --tmono: "SFMono-Regular", "Roboto Mono", ui-monospace, Menlo, Consolas, monospace;
        max-width: 760px;
      }
      body.tk-dark .tut { --psb-soft: rgba(14,138,99,.16); --repair-soft: rgba(201,106,24,.16); --tline: var(--d-line, #2b3a34); --tink: var(--d-ink, #e6efe9); --tsoft: var(--d-ink-soft, #9fb0a8); --tfaint: #7d8c85; --chat: rgba(14,138,99,.14); }
      .tut .jump { display: flex; gap: .5rem; margin-bottom: 1.2rem; flex-wrap: wrap; }
      .tut .jump a { flex: 1; min-width: 140px; text-align: center; text-decoration: none; font-weight: 700; font-size: .9rem; padding: .55rem .5rem; border-radius: 10px; border: 1px solid var(--tline); }
      .tut .jump a.j-psb { color: var(--psb-ink); border-color: #BFE3D3; background: var(--psb-soft); }
      .tut .jump a.j-repair { color: var(--repair-ink); border-color: #F0D3AE; background: var(--repair-soft); }
      .tut .rules { display: grid; gap: .5rem; margin-bottom: 1.6rem; }
      .tut .rule { display: flex; gap: .6rem; align-items: flex-start; border: 1px solid var(--tline); border-radius: 11px; padding: .7rem .85rem; font-size: .9rem; color: var(--tink); }
      .tut .rule .ic { flex: none; width: 24px; text-align: center; }
      .tut .flow { margin-top: 2rem; scroll-margin-top: 12px; }
      .tut .flow-tag { font-size: .68rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; padding: .28rem .6rem; border-radius: 999px; color: #fff; display: inline-block; }
      .tut .flow.f-psb .flow-tag { background: var(--psb); }
      .tut .flow.f-repair .flow-tag { background: var(--repair); }
      .tut .flow h2 { font-size: 1.3rem; font-weight: 800; margin: .5rem 0 .2rem; color: var(--tink); }
      .tut .flow-sub { color: var(--tsoft); font-size: .92rem; margin: 0 0 1.2rem; }
      .tut .flow-sub code, .tut .rule code { font-family: var(--tmono); font-size: .85em; background: var(--psb-soft); padding: .1em .4em; border-radius: 5px; }
      .tut ol.steps { list-style: none; counter-reset: s; margin: 0; padding: 0; position: relative; }
      .tut ol.steps::before { content: ""; position: absolute; left: 16px; top: 6px; bottom: 24px; width: 2px; background: var(--tline); }
      .tut ol.steps > li { position: relative; padding: 0 0 1.1rem 2.9rem; counter-increment: s; }
      .tut ol.steps > li::before { content: counter(s); position: absolute; left: 0; top: 0; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: .92rem; color: #fff; }
      .tut .flow.f-psb ol.steps > li::before { background: var(--psb); }
      .tut .flow.f-repair ol.steps > li::before { background: var(--repair); }
      .tut .step-t { font-weight: 700; font-size: 1rem; margin: .3rem 0 .25rem; color: var(--tink); }
      .tut .step-d { color: var(--tsoft); font-size: .9rem; margin: 0; }
      .tut .step-d strong { color: var(--tink); }
      .tut .cmd { font-family: var(--tmono); font-size: .88rem; font-weight: 600; display: inline-flex; align-items: center; gap: .5rem; margin: .45rem 0 .1rem; background: var(--chat); color: var(--psb-ink); border: 1px solid #C4E4D3; padding: .4rem .65rem; border-radius: 8px; cursor: pointer; }
      .tut .flow.f-repair .cmd { background: var(--repair-soft); color: var(--repair-ink); border-color: #EFD1AB; }
      .tut .cmd::after { content: "salin"; font-family: "Nunito", sans-serif; font-size: .64rem; font-weight: 700; text-transform: uppercase; opacity: .55; border-left: 1px solid currentColor; padding-left: .5rem; }
      .tut .cmd.copied::after { content: "tersalin ✓"; opacity: 1; }
      .tut .bubble { border: 1px solid var(--tline); border-radius: 11px; padding: .85rem .95rem; margin: .75rem 0 0; }
      .tut .bubble .bt { font-size: .7rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--tfaint); margin-bottom: .45rem; }
      .tut .bubble pre { font-family: var(--tmono); font-size: .86rem; line-height: 1.7; margin: 0; white-space: pre-wrap; color: var(--tink); }
      .tut .bubble pre b { color: var(--psb-ink); }
      .tut .note { display: flex; gap: .6rem; align-items: flex-start; border-radius: 11px; padding: .7rem .85rem; margin: .9rem 0 0; font-size: .88rem; }
      .tut .note.tip { background: var(--psb-soft); color: var(--psb-ink); }
      .tut .flow.f-repair .note.tip { background: var(--repair-soft); color: var(--repair-ink); }
      .tut .note.warn { background: #FBEAE3; color: #B4431F; }
      .tut .cheat { margin-top: 2.4rem; }
      .tut .cheat h2 { font-size: 1.15rem; font-weight: 800; margin: 0 0 .8rem; color: var(--tink); }
      .tut .table-scroll { overflow-x: auto; border: 1px solid var(--tline); border-radius: 11px; }
      .tut table { border-collapse: collapse; width: 100%; font-size: .88rem; }
      .tut th, .tut td { text-align: left; padding: .65rem .8rem; border-bottom: 1px solid var(--tline); vertical-align: top; color: var(--tink); }
      .tut th { font-size: .68rem; text-transform: uppercase; letter-spacing: .05em; color: var(--tfaint); font-weight: 700; }
      .tut tr:last-child td { border-bottom: none; }
      .tut td.k { font-family: var(--tmono); font-weight: 600; color: var(--psb-ink); white-space: nowrap; }
      .tut td.k.r { color: var(--repair-ink); }
    </style>
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
                            <span class="tk-title-icon"><i class="fas fa-book-open"></i></span>
                            <div>
                                <h1>Panduan Teknisi</h1>
                                <p class="tk-subtitle">Cara PSB &amp; Perbaikan lewat WhatsApp — ikuti langkahnya berurutan</p>
                            </div>
                        </div>
                    </div>

                    <div class="tut">
                        <div class="jump">
                            <a class="j-psb" href="#tut-psb">🆕 PSB (Pasang Baru)</a>
                            <a class="j-repair" href="#tut-repair">🔧 Perbaikan</a>
                        </div>

                        <div class="rules">
                            <div class="rule"><span class="ic">💬</span><span>Semua lewat <b>chat pribadi (japri) ke bot</b> — bot area masing-masing (Dander / Tanjung). Bukan di grup.</span></div>
                            <div class="rule"><span class="ic">👆</span><span><b>Tap perintah</b> (kotak berwarna) untuk menyalin ke clipboard.</span></div>
                            <div class="rule"><span class="ic">🔁</span><span>Ketik <code>batal</code> kapan saja untuk membatalkan proses yang berjalan.</span></div>
                        </div>

                        <section class="flow f-psb" id="tut-psb">
                            <span class="flow-tag">Pasang Baru</span>
                            <h2>PSB — Daftarkan Pelanggan Baru</h2>
                            <p class="flow-sub">Bot yang buat pelanggan + setel modem otomatis. Tugasmu: kirim dokumen &amp; cocokkan modem.</p>
                            <ol class="steps">
                                <li>
                                    <p class="step-t">Kirim foto KTP + caption <code>#PSB</code></p>
                                    <p class="step-d">Foto KTP pelanggan, isi caption sesuai contoh. Ini memulai proses.</p>
                                    <div class="bubble">
                                        <div class="bt">📷 Foto KTP — caption:</div>
                                        <pre><b>#PSB</b>
Nama: Budi Santoso
Paket: PAKET-110K
WiFi: BudiNet
Sandi: budi12345
HP: 08123456789</pre>
                                    </div>
                                    <div class="note tip"><span>💡</span><span><b>Sandi WiFi minimal 8 karakter.</b> Paket sesuai daftar (nama atau kecepatan, mis. <code>16Mbps</code>).</span></div>
                                </li>
                                <li>
                                    <p class="step-t">Kirim foto rumah</p>
                                    <p class="step-d">Foto tampak depan rumah pelanggan.</p>
                                </li>
                                <li>
                                    <p class="step-t">Share lokasi rumah</p>
                                    <p class="step-d">WhatsApp → <strong>Location → Send your current location</strong>, dari titik rumah pelanggan.</p>
                                </li>
                                <li>
                                    <p class="step-t">Cocokkan modem</p>
                                    <p class="step-d">Bot menampilkan <strong>nomor seri (SN) modem</strong>. Lihat stiker modem — cocok?</p>
                                    <span class="cmd" data-copy="YA">YA</span>
                                    <div class="note tip"><span>🔀</span><span>Kalau <b>tidak cocok</b>: balas <code>TIDAK</code> → bot kirim daftar bernomor → balas <b>angka</b> modem yang benar. Belum muncul? <code>REFRESH</code>.</span></div>
                                </li>
                                <li>
                                    <p class="step-t">Selesai — pelanggan online</p>
                                    <p class="step-d">Setelah <strong>YA</strong>, bot buat pelanggan, dorong PPPoE + WiFi ke modem, kirim welcome ke pelanggan, dan balas kredensial PPPoE ke kamu.</p>
                                    <div class="note warn"><span>⚠️</span><span><b>Modem wajib menyala &amp; terhubung</b> agar SN terbaca. Kalau belum, tunggu ±semenit lalu <code>REFRESH</code>.</span></div>
                                </li>
                            </ol>
                        </section>

                        <section class="flow f-repair" id="tut-repair">
                            <span class="flow-tag">Perbaikan</span>
                            <h2>Perbaikan — Tangani Tiket Gangguan</h2>
                            <p class="flow-sub">Pelanggan lapor → tiket masuk. Ambil, kerjakan, dokumentasikan, tutup. Ganti <code>[ID]</code> dengan nomor tiket.</p>
                            <ol class="steps">
                                <li>
                                    <p class="step-t">Lihat tiket masuk</p>
                                    <p class="step-d">Daftar tiket menunggu + prioritas, nama, alamat, jenis gangguan.</p>
                                    <span class="cmd" data-copy="list tiket">list tiket</span>
                                </li>
                                <li>
                                    <p class="step-t">Ambil tiket</p>
                                    <p class="step-d">Kunci tiket atas namamu (hindari dobel teknisi).</p>
                                    <span class="cmd" data-copy="proses [ID]">proses [ID]</span>
                                </li>
                                <li>
                                    <p class="step-t">Berangkat + share lokasi</p>
                                    <p class="step-d">Tandai <strong>OTW</strong>, lalu <strong>share lokasi</strong> perjalanan.</p>
                                    <span class="cmd" data-copy="otw [ID]">otw [ID]</span>
                                </li>
                                <li>
                                    <p class="step-t">Sampai lokasi</p>
                                    <p class="step-d">Bot kirim <strong>OTP ke HP pelanggan</strong> — minta kode itu ke pelanggan.</p>
                                    <span class="cmd" data-copy="sampai [ID]">sampai [ID]</span>
                                </li>
                                <li>
                                    <p class="step-t">Verifikasi OTP</p>
                                    <p class="step-d">Masukkan kode dari pelanggan.</p>
                                    <span class="cmd" data-copy="verifikasi [ID] [OTP]">verifikasi [ID] [OTP]</span>
                                </li>
                                <li>
                                    <p class="step-t">Kirim foto dokumentasi</p>
                                    <p class="step-d">Minimal <strong>2 foto</strong>: penyebab masalah + screenshot speedtest. Kirim satu per satu, lalu:</p>
                                    <span class="cmd" data-copy="done">done</span>
                                </li>
                                <li>
                                    <p class="step-t">Tulis catatan perbaikan</p>
                                    <p class="step-d">Ringkas apa yang diperbaiki (min. 10 karakter). Mis. <em>"Ganti kabel drop, sinyal normal"</em>.</p>
                                </li>
                                <li>
                                    <p class="step-t">Tutup tiket</p>
                                    <p class="step-d">Tiket selesai, pelanggan dinotifikasi, ringkasan masuk grup perbaikan.</p>
                                    <span class="cmd" data-copy="selesai [ID]">selesai [ID]</span>
                                </li>
                            </ol>
                        </section>

                        <section class="cheat">
                            <h2>Ringkasan Perintah</h2>
                            <div class="table-scroll">
                                <table>
                                    <thead><tr><th>Perintah</th><th>Fungsi</th></tr></thead>
                                    <tbody>
                                        <tr><td class="k">#PSB + foto KTP</td><td>Mulai daftar pelanggan baru (caption: Nama/Paket/WiFi/Sandi/HP)</td></tr>
                                        <tr><td class="k">YA / TIDAK / angka</td><td>Konfirmasi modem PSB</td></tr>
                                        <tr><td class="k">REFRESH</td><td>Baca ulang modem bila belum terdeteksi</td></tr>
                                        <tr><td class="k r">list tiket</td><td>Lihat tiket gangguan menunggu</td></tr>
                                        <tr><td class="k r">proses [ID]</td><td>Ambil / mulai kerjakan tiket</td></tr>
                                        <tr><td class="k r">otw [ID]</td><td>Tandai berangkat (lalu share lokasi)</td></tr>
                                        <tr><td class="k r">sampai [ID]</td><td>Tandai tiba (pelanggan dapat OTP)</td></tr>
                                        <tr><td class="k r">verifikasi [ID] [OTP]</td><td>Verifikasi kode OTP pelanggan</td></tr>
                                        <tr><td class="k r">done</td><td>Selesai kirim foto dokumentasi</td></tr>
                                        <tr><td class="k r">selesai [ID]</td><td>Tutup tiket</td></tr>
                                        <tr><td class="k">batal</td><td>Batalkan proses berjalan</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        document.querySelectorAll('.tut .cmd').forEach(function (el) {
            el.addEventListener('click', function () {
                var text = el.getAttribute('data-copy') || el.textContent;
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(text).then(function () {
                        el.classList.add('copied');
                        setTimeout(function () { el.classList.remove('copied'); }, 1400);
                    }).catch(function () {});
                }
            });
        });
        document.querySelectorAll('.tut .jump a').forEach(function (a) {
            a.addEventListener('click', function (e) {
                var t = document.querySelector(a.getAttribute('href'));
                if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
            });
        });
    </script>
</body>

</html>
