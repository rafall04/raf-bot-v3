<!DOCTYPE html>
<html lang="id">

<head>
<?php
    // <head> tulis tangan sebelumnya melewatkan components-modern.css (lapisan
    // komponen bersama) — halaman ini jadi penyumbang kegagalan kontras terbesar
    // di mode gelap (44 teks di bawah 3:1). Ikut partial bersama supaya otomatis
    // dapat lapisan komponen + urutan cascade yang benar.
    $pageTitle = 'Panduan Teknisi - RAF NET';
    $themeRole = 'teknisi';
    include __DIR__ . '/_head.php';
?>
    <link href="<?= rafAssetUrl('/css/tutorial.css') ?>" rel="stylesheet">
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
                                <p class="tk-subtitle">Semua langkah PSB &amp; Perbaikan lewat WhatsApp — lengkap</p>
                            </div>
                        </div>
                    </div>

                    <div class="tut">
                        <div class="jump">
                            <a class="j-psb" href="#tut-psb">🆕 PSB (Pasang Baru)</a>
                            <a class="j-repair" href="#tut-repair">🔧 Perbaikan</a>
                        </div>

                        <div class="rules">
                            <div class="rule"><span class="ic">💬</span><span>Semua lewat <b>chat pribadi (japri) ke bot</b> — bot area masing-masing (Dander / Tanjung). <b>Bukan</b> di grup.</span></div>
                            <div class="rule"><span class="ic">📱</span><span>Nomor WhatsApp kamu <b>harus terdaftar sebagai akun teknisi</b>. Kalau bot tak merespon perintah, hubungi admin untuk cek pendaftaran nomormu.</span></div>
                            <div class="rule"><span class="ic">👆</span><span><b>Tap perintah</b> (kotak berwarna) untuk menyalin ke clipboard, lalu tempel di chat bot.</span></div>
                            <div class="rule"><span class="ic">🔁</span><span>Ketik <code class="kbd">batal</code> kapan saja untuk membatalkan proses yang sedang berjalan (PSB maupun tiket).</span></div>
                            <div class="rule"><span class="ic">⏱️</span><span>Setiap proses <b>kedaluwarsa ±15 menit</b> kalau tak ada balasan. Kalau kelamaan, ulangi dari awal.</span></div>
                        </div>

                        <!-- ============ PSB ============ -->
                        <section class="flow f-psb" id="tut-psb">
                            <span class="flow-tag">Pasang Baru</span>
                            <h2>PSB — Daftarkan Pelanggan Baru</h2>
                            <p class="flow-sub">Bot yang membuat data pelanggan, membuat akun PPPoE di MikroTik, merakit alamat, dan menyetel modem — otomatis. Tugasmu: kirim dokumen &amp; <b>cocokkan modem</b>. Kamu tidak perlu mengetik username/password teknis, maupun alamat lengkap.</p>

                            <ol class="steps">
                                <li>
                                    <p class="step-t">Kirim foto KTP + caption <code class="kbd">#PSB</code></p>
                                    <p class="step-d">Foto KTP pelanggan, lalu isi kolom <b>caption</b> foto dengan data pelanggan (lihat format di bawah). Baris pertama <b>wajib</b> diawali <code class="kbd">#PSB</code>.</p>
                                    <div class="bubble">
                                        <div class="bt">📷 Foto KTP — isi caption:</div>
                                        <pre><b>#PSB</b>
Nama: Budi Santoso
Dusun: Ngitik
RT/RW: 14/2
Paket: PAKET-110K
WiFi: BudiNet
Sandi: budi12345
HP: 08123456789</pre>
                                    </div>
                                    <ul class="plain">
                                        <li><b>Nama</b> — nama pelanggan (bukan hasil scan KTP; kamu ketik sendiri).</li>
                                        <li><b>Dusun</b> — dusun <b>tempat modem dipasang</b>, bukan alamat di KTP (bisa beda). Bot menampilkan <b>daftar bernomor</b> dusun — cukup <b>balas angkanya</b>, tak usah mengetik.</li>
                                        <li><b>RT/RW</b> — cukup <code class="kbd">14/2</code>. Boleh juga <code class="kbd">RT 14 RW 2</code> atau <code class="kbd">014/002</code> — bot yang merapikan.</li>
                                        <li><b>Paket</b> — sesuai daftar paket. Boleh nama paket (<code class="kbd">PAKET-110K</code>) atau kecepatannya (<code class="kbd">16Mbps</code>). Kalau paket tak dikenal, bot akan memberi tahu.</li>
                                        <li><b>WiFi</b> — nama WiFi (SSID) yang diminta pelanggan.</li>
                                        <li><b>Sandi</b> — sandi WiFi, <b>minimal 8 karakter</b>.</li>
                                        <li><b>HP</b> — nomor WhatsApp pelanggan (9–15 digit). Ke sinilah pesan selamat datang dikirim. Kalau lebih dari satu nomor, pisah pakai <code class="kbd">|</code> — nomor pertama jadi nomor utama.</li>
                                    </ul>
                                    <div class="note tip"><span class="ic">🏠</span><span><b>Alamat lengkap tidak perlu diketik.</b> Dari Dusun + RT/RW, bot merakit sendiri: <code class="kbd">Dsn. Ngitik RT 014 RW 002 Ds. Tanjungharjo Kec. Kapas</code>. Kalau rumahnya di luar pola itu (mis. beda desa), tulis <code class="kbd">Alamat: &lt;alamat lengkap&gt;</code> — alamat itu dipakai apa adanya dan RT/RW jadi tak wajib.</span></div>
                                    <div class="note tip"><span class="ic">💡</span><span>Data <b>boleh dicicil</b> dan <b>urutannya bebas</b>. Caption boleh cuma <code class="kbd">#PSB</code> dulu, sisanya menyusul per pesan (mis. kirim <code class="kbd">Dusun: Ngitik</code> saja). Tiap kali kamu kirim, bot menampilkan checklist ✅/⬜ dan menagih yang masih kurang.</span></div>
                                </li>

                                <li>
                                    <p class="step-t">Kirim foto rumah</p>
                                    <p class="step-d">Foto tampak depan rumah pelanggan. Bot mencentang checklist dokumen. (Wajib.)</p>
                                </li>

                                <li>
                                    <p class="step-t">Share lokasi rumah</p>
                                    <p class="step-d">Di WhatsApp: <b>ikon lampiran (📎) → Location → Send your current location</b>, dilakukan <b>dari titik rumah pelanggan</b> supaya akurat. Setelah ini dokumen dianggap lengkap dan bot mulai membaca modem.</p>
                                    <div class="note tip"><span class="ic">📍</span><span>Kirim lokasi saat kamu <b>berada di rumah pelanggan</b> — lokasi ini dipakai untuk data pemasangan.</span></div>
                                </li>

                                <li>
                                    <p class="step-t">Cocokkan modem yang terbaca</p>
                                    <p class="step-d">Bot membaca <b>modem yang baru terpasang</b> dari sistem dan menampilkan <b>nomor seri (SN)</b> + tipe modem. <b>Lihat stiker di badan modem</b> di depanmu — apakah SN-nya sama?</p>
                                    <span class="cmd" data-copy="YA">YA</span>
                                    <p class="step-d">Kalau <b>cocok</b> → ketik <code class="kbd">YA</code>. Bot langsung menyetel modem itu.</p>
                                    <div class="note tip"><span class="ic">🔀</span><span>Kalau <b>tidak cocok</b>: balas <code class="kbd">TIDAK</code> → bot mengirim <b>daftar bernomor</b> modem → balas <b>angka</b> modem yang serinya sama dengan stiker. Kamu tidak perlu mengetik SN-nya.</span></div>

                                    <p class="step-d">Tiap modem di daftar sudah <b>diberi label sendiri oleh bot</b> — kamu tak perlu tahu modem itu bekas siapa:</p>
                                    <ul class="plain">
                                        <li><b>🆕 BARU</b> — modem polos, belum pernah dipakai pelanggan.</li>
                                        <li><b>♻️ BEKAS &lt;nama&gt;</b> — modem copotan dari pelanggan yang sudah berhenti. <b>Boleh dipakai.</b></li>
                                        <li><b>⛔ TERPAKAI</b> — modem itu <b>masih melayani pelanggan lain</b>. Bot <b>menolak</b> memakainya, dan itu memang benar: kalau dipaksa, internet pelanggan tersebut mati. Cek ulang stiker modemmu.</li>
                                    </ul>

                                    <div class="note tip"><span class="ic">🔎</span><span><b>Pasang modem bekas/copotan?</b> Modem bekas <b>tidak muncul</b> di daftar "modem baru" — dia harus dicari. Ketik <code class="kbd">cari 8EBEB1</code> (4–6 digit terakhir SN di stiker) atau <code class="kbd">cari wimpi</code> (nama pemilik lama modem itu). Salah ketik aman — paling-paling hasilnya "tak ketemu", tidak ada yang berubah.</span></div>
                                    <div class="note warn"><span class="ic">⚠️</span><span>Kalau modem belum muncul (baru dinyalakan): tunggu ±1 menit lalu balas <code class="kbd">REFRESH</code>. Modem <b>harus menyala &amp; terhubung ke jaringan</b> agar serinya terbaca sistem.</span></div>
                                </li>

                                <li>
                                    <p class="step-t">Selesai — pelanggan online</p>
                                    <p class="step-d"><b>Hanya setelah kamu ketik YA</b>, bot mengerjakan semuanya sekaligus:</p>
                                    <ul class="plain">
                                        <li>Membuat data pelanggan + akun PPPoE di MikroTik.</li>
                                        <li>Mendorong username/password PPPoE <b>dan</b> nama+sandi WiFi ke modem (modem langsung online).</li>
                                        <li>Mengirim <b>pesan selamat datang</b> ke HP pelanggan.</li>
                                        <li>Membalas <b>kredensial PPPoE</b> ke kamu (untuk arsip / bila perlu setel manual).</li>
                                    </ul>
                                    <div class="note tip"><span class="ic">✅</span><span>Sebelum kamu ketik <b>YA</b>, <b>tidak ada</b> data yang dibuat. Jadi kalau ragu/salah, aman ketik <code class="kbd">batal</code> — tidak ada yang tersimpan.</span></div>
                                </li>
                            </ol>
                        </section>

                        <!-- ============ PERBAIKAN ============ -->
                        <section class="flow f-repair" id="tut-repair">
                            <span class="flow-tag">Perbaikan</span>
                            <h2>Perbaikan — Tangani Tiket Gangguan</h2>
                            <p class="flow-sub">Pelanggan melapor gangguan → tiket masuk. Alur: ambil tiket → berangkat → sampai → verifikasi ke pelanggan → dokumentasi → tutup. Ganti <code class="kbd">[ID]</code> dengan nomor tiket yang sebenarnya (mis. <code class="kbd">TK1042</code>).</p>

                            <ol class="steps">
                                <li>
                                    <p class="step-t">Lihat tiket yang masuk</p>
                                    <p class="step-d">Menampilkan daftar tiket yang <b>menunggu</b>, diurut prioritas: 🔴 HIGH lebih dulu. Tiap tiket berisi ID, nama pelanggan, alamat, jenis gangguan (mati/lemot), dan lama menunggu.</p>
                                    <span class="cmd" data-copy="list tiket">list tiket</span>
                                    <div class="note tip"><span class="ic">🔔</span><span>Kamu juga otomatis dapat notifikasi WhatsApp saat ada tiket baru — tak harus cek manual terus.</span></div>
                                </li>

                                <li>
                                    <p class="step-t">Ambil tiket</p>
                                    <p class="step-d">Mengunci tiket atas namamu supaya tidak dikerjakan dobel oleh teknisi lain. Utamakan tiket 🔴 HIGH.</p>
                                    <span class="cmd" data-copy="proses [ID]">proses [ID]</span>
                                </li>

                                <li>
                                    <p class="step-t">Berangkat (OTW) + share lokasi</p>
                                    <p class="step-d">Menandai kamu sedang menuju lokasi. Bot lalu memintamu <b>share lokasi perjalanan</b> (📎 → Location). Pelanggan mendapat notifikasi bahwa teknisi sedang menuju ke sana.</p>
                                    <span class="cmd" data-copy="otw [ID]">otw [ID]</span>
                                </li>

                                <li>
                                    <p class="step-t">Sampai di lokasi</p>
                                    <p class="step-d">Menandai kamu tiba. Bot mengirim <b>kode OTP ke HP pelanggan</b>. <b>Minta kode itu langsung ke pelanggan</b> — ini bukti kamu benar-benar di lokasi.</p>
                                    <span class="cmd" data-copy="sampai [ID]">sampai [ID]</span>
                                </li>

                                <li>
                                    <p class="step-t">Verifikasi OTP</p>
                                    <p class="step-d">Masukkan kode OTP yang diberikan pelanggan. Format: perintah, spasi, ID tiket, spasi, kode.</p>
                                    <span class="cmd" data-copy="verifikasi [ID] [OTP]">verifikasi [ID] [OTP]</span>
                                    <div class="note tip"><span class="ic">🔢</span><span>Contoh: <code class="kbd">verifikasi TK1042 4829</code>. Setelah cocok, kamu masuk tahap kirim foto.</span></div>
                                </li>

                                <li>
                                    <p class="step-t">Kirim foto dokumentasi</p>
                                    <p class="step-d">Kirim <b>minimal 2 foto</b>, satu per satu:</p>
                                    <ul class="plain">
                                        <li>📷 Foto <b>penyebab masalah</b> (kabel putus, redaman, modem, dll).</li>
                                        <li>📊 <b>Screenshot speedtest</b> setelah diperbaiki.</li>
                                        <li>(opsional) Foto hasil perbaikan.</li>
                                    </ul>
                                    <p class="step-d">Setelah semua foto terkirim, ketik:</p>
                                    <span class="cmd" data-copy="done">done</span>
                                    <div class="note warn"><span class="ic">⚠️</span><span>Kalau foto kurang dari 2, bot menolak <code class="kbd">done</code> dan memberi tahu kurang berapa. Kirim dulu fotonya.</span></div>
                                </li>

                                <li>
                                    <p class="step-t">Tulis catatan perbaikan</p>
                                    <p class="step-d">Ketik ringkasan apa yang diperbaiki (<b>minimal 10 karakter</b>). Contoh: <em>"Ganti kabel drop, sinyal normal"</em> atau <em>"Restart ONT, redaman kembali normal"</em>.</p>
                                </li>

                                <li>
                                    <p class="step-t">Tutup tiket</p>
                                    <p class="step-d">Tiket ditandai <b>selesai</b>. Pelanggan otomatis dapat notifikasi tiket beres, dan ringkasan penyelesaian (kamu, durasi, catatan) masuk ke grup perbaikan.</p>
                                    <span class="cmd" data-copy="selesai [ID]">selesai [ID]</span>
                                </li>
                            </ol>
                        </section>

                        <!-- ============ FAQ ============ -->
                        <section class="faq">
                            <h2>Masalah Umum</h2>
                            <details class="qa">
                                <summary>Bot tidak membalas perintahku sama sekali</summary>
                                <div class="qa-body">Kemungkinan nomor WhatsApp-mu belum terdaftar sebagai teknisi, atau kamu mengirim ke grup (harus japri ke bot). Pastikan chat pribadi ke bot area kamu, dan minta admin cek pendaftaran nomormu.</div>
                            </details>
                            <details class="qa">
                                <summary>PSB: SN modem tidak muncul / bot bilang belum terbaca</summary>
                                <div class="qa-body">Modem harus sudah menyala dan terhubung ke jaringan agar serinya terbaca sistem. Tunggu ±1 menit setelah modem dinyalakan, lalu balas <code class="kbd">REFRESH</code>. Kalau tetap tidak muncul, cek koneksi fiber/kabel modem. <b>Kalau yang kamu pasang modem bekas/copotan</b>, dia memang tidak akan muncul di daftar "modem baru" — cari saja: <code class="kbd">cari &lt;4 digit SN&gt;</code> atau <code class="kbd">cari &lt;nama pemilik lama&gt;</code>.</div>
                            </details>
                            <details class="qa">
                                <summary>PSB: modem yang terbaca beda dengan yang di lokasi</summary>
                                <div class="qa-body">Balas <code class="kbd">TIDAK</code>. Bot akan mengirim daftar bernomor modem — cocokkan serinya dengan stiker modem, lalu balas angkanya. Kamu tidak perlu mengetik nomor seri.</div>
                            </details>
                            <details class="qa">
                                <summary>PSB: bot menolak modemku — "masih dipakai pelanggan lain"</summary>
                                <div class="qa-body">Artinya modem dengan SN itu <b>masih melayani pelanggan yang aktif</b>. Ini penjagaan yang disengaja: kalau diteruskan, PPPoE &amp; WiFi pelanggan tersebut akan tertimpa dan internetnya mati. <b>Cek ulang stiker modem</b> (angka mirip itu gampang tertukar) lalu balas <code class="kbd">TIDAK</code> untuk pilih dari daftar. Kalau kamu yakin modem itu memang sudah dicopot dari pelanggan lama, minta <b>admin</b> melepas tautannya dulu di panel — tidak bisa dipaksa dari WhatsApp.</div>
                            </details>
                            <details class="qa">
                                <summary>PSB: dusunnya tidak ada di daftar / alamat perlu ditulis lengkap</summary>
                                <div class="qa-body">Kalau dusun yang kamu butuhkan belum ada di daftar bernomor, ketik saja manual (<code class="kbd">Dusun: Sumberrejo</code>) dan beri tahu admin supaya ditambahkan ke daftar. Untuk rumah di luar pola desa/kecamatan area (mis. beda desa), tulis <code class="kbd">Alamat: &lt;alamat lengkap&gt;</code> — alamat itu dipakai apa adanya dan RT/RW tak lagi wajib.</div>
                            </details>
                            <details class="qa">
                                <summary>Perbaikan: pelanggan tidak menerima kode OTP</summary>
                                <div class="qa-body">Pastikan nomor HP pelanggan di sistem benar dan aktif WhatsApp. Kalau tetap tidak masuk, hubungi admin untuk verifikasi manual tiket.</div>
                            </details>
                            <details class="qa">
                                <summary>Salah ketik / ingin mengulang</summary>
                                <div class="qa-body">Ketik <code class="kbd">batal</code> untuk membatalkan proses yang sedang berjalan, lalu mulai lagi dari awal. Untuk PSB, selama belum ketik <code class="kbd">YA</code>, tidak ada data yang tersimpan.</div>
                            </details>
                        </section>

                        <!-- ============ CHEAT SHEET ============ -->
                        <section class="cheat">
                            <h2>Ringkasan Perintah</h2>
                            <div class="table-scroll">
                                <table>
                                    <thead><tr><th>Perintah</th><th>Fungsi</th></tr></thead>
                                    <tbody>
                                        <tr><td class="k">#PSB + foto KTP</td><td>Mulai daftar pelanggan baru (caption: Nama/Dusun/RT-RW/Paket/WiFi/Sandi/HP)</td></tr>
                                        <tr><td class="k">YA / TIDAK / angka</td><td>Konfirmasi modem PSB — cocok / pilih dari daftar</td></tr>
                                        <tr><td class="k">REFRESH</td><td>Baca ulang modem bila belum terdeteksi</td></tr>
                                        <tr><td class="k">cari [SN/nama]</td><td>Cari modem <b>bekas/copotan</b> — 4–6 digit SN, atau nama pemilik lamanya</td></tr>
                                        <tr><td class="k r">list tiket</td><td>Lihat tiket gangguan yang menunggu</td></tr>
                                        <tr><td class="k r">proses [ID]</td><td>Ambil / mulai kerjakan tiket</td></tr>
                                        <tr><td class="k r">otw [ID]</td><td>Tandai berangkat (lalu share lokasi)</td></tr>
                                        <tr><td class="k r">sampai [ID]</td><td>Tandai tiba (pelanggan dapat OTP)</td></tr>
                                        <tr><td class="k r">verifikasi [ID] [OTP]</td><td>Verifikasi kode OTP dari pelanggan</td></tr>
                                        <tr><td class="k r">done</td><td>Selesai kirim foto dokumentasi (min. 2 foto)</td></tr>
                                        <tr><td class="k r">selesai [ID]</td><td>Tutup tiket</td></tr>
                                        <tr><td class="k">batal</td><td>Batalkan proses yang sedang berjalan</td></tr>
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
