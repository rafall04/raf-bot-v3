<!DOCTYPE html>
<html lang="id">

<head>
<?php
    // Panduan ADMIN — rujukan lengkap dari nol sampai operasional harian. Mengikuti partial
    // <head> bersama (bukan <head> tulis tangan) supaya otomatis dapat lapisan komponen +
    // urutan cascade yang benar, termasuk mode gelap.
    $pageTitle = 'Panduan Admin - RAF NET';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
?>
    <link href="<?= rafAssetUrl('/css/tutorial.css') ?>" rel="stylesheet">
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include 'topbar.php'; ?>
                <div class="container-fluid">
                    <div class="tk-page-head">
                        <div class="tk-title">
                            <span class="tk-title-icon"><i class="fas fa-book-open"></i></span>
                            <div>
                                <h1>Panduan Admin</h1>
                                <p class="tk-subtitle">Dari nol sampai operasional harian &mdash; lengkap</p>
                            </div>
                        </div>
                    </div>

                    <div class="tut tut-wide">
                        <div class="jump">
                            <a class="j-admin" href="#hari-pertama">🚀 Hari Pertama</a>
                            <a class="j-admin" href="#mulai-dari-nol-akun-konfigurasi-dan-samb">Mulai dari nol: akun, konfigurasi, dan sambungan</a>
                            <a class="j-admin" href="#pelanggan-paket-langganan">Pelanggan &amp; paket langganan</a>
                            <a class="j-admin" href="#uang-masuk-pembayaran-tagihan-tunggakan-">Uang masuk: pembayaran, tagihan, tunggakan, diskon</a>
                            <a class="j-admin" href="#isolir-kompensasi-dan-pemulihan-layanan">Isolir, kompensasi, dan pemulihan layanan</a>
                            <a class="j-admin" href="#pasang-baru-psb-papan-jadwal-wizard-what">Pasang baru (PSB): papan jadwal, wizard WhatsApp, komisi</a>
                            <a class="j-admin" href="#aset-jaringan-peta-dan-olt">Aset jaringan, peta, dan OLT</a>
                            <a class="j-admin" href="#monitoring-gangguan-pemberitahuan-otomat">Monitoring gangguan &amp; pemberitahuan otomatis</a>
                            <a class="j-admin" href="#perangkat-pelanggan-modem-genieacs">Perangkat pelanggan (modem / GenieACS)</a>
                            <a class="j-admin" href="#tiket-gangguan-pekerjaan-teknisi-di-lapa">Tiket gangguan &amp; pekerjaan teknisi di lapangan</a>
                            <a class="j-admin" href="#sdm-gaji-teknisi-kasbon-komisi">SDM: gaji teknisi, kasbon, komisi</a>
                            <a class="j-admin" href="#agen-penagih-outlet-voucher-dua-hal-berb">Agen penagih &amp; outlet voucher (dua hal berbeda)</a>
                            <a class="j-admin" href="#kas-usaha-pengeluaran-dan-ringkasan-keua">Kas usaha, pengeluaran, dan ringkasan keuangan</a>
                            <a class="j-admin" href="#berbicara-ke-pelanggan-broadcast-pengumu">Berbicara ke pelanggan: broadcast, pengumuman, template, survei</a>
                            <a class="j-admin" href="#perintah-whatsapp-untuk-admin">Perintah WhatsApp untuk admin</a>
                            <a class="j-admin" href="#akun-audit-dan-jejak-siapa-mengubah-apa">Akun, audit, dan jejak siapa mengubah apa</a>
                            <a class="j-admin" href="#tanya-jawab">❓ Tanya Jawab</a>
                        </div>

                        <div class="rules">
                            <div class="rule"><span class="ic">🧭</span><span>Halaman ini dibaca <b>dua cara</b>: kalau sistemnya baru, ikuti <b>Hari Pertama</b> berurutan dari atas. Kalau sudah jalan, langsung lompat ke bagian yang Anda butuhkan lewat tombol di atas.</span></div>
                            <div class="rule"><span class="ic">⚠️</span><span>Kotak <b>Jebakan</b> di tiap fitur bukan hiasan &mdash; isinya kejadian yang sudah pernah terjadi di sistem ini. Baca sebelum memakai fitur yang bersangkutan, bukan sesudah.</span></div>
                            <div class="rule"><span class="ic">👆</span><span><b>Tap kotak perintah</b> berwarna untuk menyalinnya, lalu tempel di chat bot WhatsApp.</span></div>
                            <div class="rule"><span class="ic">👷</span><span>Teknisi dan agen punya panduannya sendiri: <a href="/teknisi-tutorial">Panduan Teknisi</a> dan <a href="/agen-tutorial">Panduan Agen</a>. Arahkan mereka ke sana, jangan ke halaman ini.</span></div>
                        </div>

                        <!-- ============ HARI PERTAMA ============ -->
                        <section class="flow f-admin" id="hari-pertama">
                            <span class="flow-tag">Mulai dari nol</span>
                            <h2>Hari Pertama &mdash; Urutan yang Benar</h2>
                            <p class="flow-sub">Urutan di bawah ini <b>saling bergantung</b>: melompati satu langkah membuat langkah sesudahnya terlihat rusak padahal datanya baik-baik saja. Kerjakan dari atas.</p>
                            <ol class="steps">
                                <li>
                                    <p class="step-t">Buat akun admin pertama lewat baris perintah (bukan lewat web)</p>
                                    <p class="step-d"><b>Di mana:</b> Terminal di server: <code class="kbd">node scripts/create-admin.js &lt;username&gt; &lt;password&gt; &quot;&lt;nama&gt;&quot; admin</code> (password minimal 8 karakter; role tersedia: admin / teknisi / agen)</p>
                                    <span class="why">Kenapa: Halaman /accounts butuh login admin, sedangkan berkas akun (database/accounts.json) kosong setelah pemasangan baru — telur-dan-ayam. Skrip CLI ini memang dibuat untuk memutus kebuntuan itu.</span>
                                    <div class="note warn"><span class="ic">⚠️</span><span>Kalau Anda salah ketik role, akun bisa jadi teknisi dan tidak bisa membuka halaman admin. API akun mensyaratkan peran PERSIS 'admin' — akun ber-role 'owner'/'superadmin' bisa membuka halamannya tapi datanya ditolak 403.</span></div>
                                </li>
                                <li>
                                    <p class="step-t">Login ke panel, lalu isi Konfigurasi Sistem dasar: MikroTik, identitas usaha, dan rekening bank</p>
                                    <p class="step-d"><b>Di mana:</b> /config — bagian MikroTik, Identitas Usaha, Rekening Bank</p>
                                    <span class="why">Kenapa: Hampir semua yang berikutnya bergantung pada koneksi router: sinkronisasi profil, isolir, import pelanggan, dan hitungan online/offline. Tanpa MikroTik terhubung, halaman pelanggan akan terasa 'kosong dan lambat' padahal datanya ada.</span>
                                    <div class="note warn"><span class="ic">⚠️</span><span>Kolom jadwal cron di halaman ini SENGAJA diabaikan saat menyimpan (tercatat di log 'Ignoring cron-owned config key') — jadwal diatur di /cron. Di server produksi config.json disunting per-kunci (merge); jangan pernah menimpanya dengan salinan dari mesin lain.</span></div>
                                </li>
                                <li>
                                    <p class="step-t">Hubungkan WhatsApp (scan QR) dan pastikan status bot 'tersambung'</p>
                                    <p class="step-d"><b>Di mana:</b> Terminal saat aplikasi start (QR dicetak di layar) atau kartu status WhatsApp di Dashboard (/)</p>
                                    <span class="why">Kenapa: Semua pemberitahuan ke pelanggan, struk, tagihan, dan seluruh perintah bot berhenti tanpa koneksi ini. Dropdown 'pilih grup WhatsApp' di halaman lain juga menjawab kosong (503) selama bot belum tersambung — jadi Anda tidak bisa menyelesaikan setelan grup PSB/kas sebelum langkah ini.</span>
                                    <div class="note warn"><span class="ic">⚠️</span><span>Sesi WhatsApp tersimpan di folder sessions/. Kalau folder itu hilang, Anda harus scan ulang. Satu aplikasi = satu koneksi WhatsApp; jangan menjalankan dua instance dari data yang sama.</span></div>
                                </li>
                                <li>
                                    <p class="step-t">Daftarkan katalog Paket Langganan (nama, harga, profil MikroTik)</p>
                                    <p class="step-d"><b>Di mana:</b> /packages</p>
                                    <span class="why">Kenapa: Paket adalah fondasi harga. Tagihan, tunggakan, buka-isolir, dan kompensasi semuanya mencari nama paket pelanggan di katalog ini. Kalau paket belum ada, pelanggan yang Anda buat berikutnya akan punya harga kosong dan gagal saat dibuka isolirnya.</span>
                                    <div class="note warn"><span class="ic">⚠️</span><span>Harga 0 TIDAK akan tersimpan (0 dianggap kosong, harga lama dipakai lagi); begitu juga nama/profil/deskripsi tidak bisa dikosongkan. Untuk paket gratis pakai centang 'Whitelist' — tapi kekebalannya dicocokkan lewat NAMA PAKET pelanggan; kalau nama paket pelanggan tidak persis ada di katalog, kekebalan batal dan dia tetap ditagih + diisolir.</span></div>
                                </li>
                                <li>
                                    <p class="step-t">Masukkan data pelanggan: import dari MikroTik dulu bila jaringannya sudah jalan, baru tambah manual</p>
                                    <p class="step-d"><b>Di mana:</b> /import-mikrotik untuk massal; /users untuk satu per satu</p>
                                    <span class="why">Kenapa: MikroTik adalah wasit identitas pelanggan (bukan Excel). Menarik dari router mencegah 'duplikat palsu' akibat salah ketik username PPPoE, dan sekalian mencocokkan modemnya di GenieACS.</span>
                                    <div class="note warn"><span class="ic">⚠️</span><span>MATIKAN centang 'kirim pesan selamat datang' saat import massal — kalau tidak, semua pelanggan lama menerima WA sekaligus (risiko diblokir WhatsApp + kebingungan pelanggan). Baris tanpa Device ID dan tanpa nama ditolak. Setelah import, periksa beberapa baris hasilnya sebelum menganggap selesai.</span></div>
                                </li>
                                <li>
                                    <p class="step-t">Buat akun untuk teknisi dan agen — WAJIB lengkap dengan nomor telepon</p>
                                    <p class="step-d"><b>Di mana:</b> /accounts (Tambah: username, nama, password, nomor telepon, role admin/teknisi/agen)</p>
                                    <span class="why">Kenapa: Nomor telepon di akun staf bukan hiasan: itulah alamat pengiriman struk gaji, keputusan kasbon, dan DM penugasan PSB. Juga menentukan gerbang peran di WhatsApp — nomor yang tidak terdaftar di sini akan ditolak saat memakai perintah tiket, cek WiFi, dan PSB.</span>
                                    <div class="note warn"><span class="ic">⚠️</span><span>Nomor kosong = teknisi tak pernah dikabari apa pun, sementara aksi Anda tetap tercatat 'sukses'. Boleh lebih dari satu nomor, dipisah tanda |.</span></div>
                                </li>
                                <li>
                                    <p class="step-t">Tetapkan jadwal otomatis di halaman Cron sebelum bulan berjalan</p>
                                    <p class="step-d"><b>Di mana:</b> /cron</p>
                                    <span class="why">Kenapa: Inilah jantung penagihan: penandaan belum bayar, pengingat, masa tenggang, isolir, notifikasi isolir, pengembalian kompensasi &amp; speed boost, dan backup. Kalau baru diatur setelah tanggal-tanggal itu lewat, satu siklus penagihan hilang.</span>
                                    <div class="note warn"><span class="ic">⚠️</span><span>Jadwal kosong ditolak; ekspresi cron salah ditolak dengan menyebut nama kolomnya. Untuk mematikan sementara tanpa menghapus nilainya, awali dengan tanda # . Menyimpan me-restart semua penjadwalan — tugas yang seharusnya berbunyi persis saat itu bisa terlewat, jadi jangan menyimpan tepat di menit jadwal isolir.</span></div>
                                </li>
                                <li>
                                    <p class="step-t">Nyalakan komisi (teknisi/agen) SEBELUM mulai mengotorisasi pembayaran</p>
                                    <p class="step-d"><b>Di mana:</b> /config — bagian Penagihan &amp; Isolir (nominal komisi teknisi/agen)</p>
                                    <span class="why">Kenapa: Fee dikreditkan pada saat pembayaran dinyatakan lunas, bukan dihitung ulang ke belakang. Menyalakannya setelah beberapa penarikan diotorisasi berarti uang komisi itu hilang tanpa jejak.</span>
                                    <div class="note warn"><span class="ic">⚠️</span><span>Nominal harus lebih dari 0 dan sakelarnya aktif; keduanya wajib. Beberapa setelan komisi tidak hot-reload sempurna — bila ragu, restart aplikasi setelah mengubahnya, sebelum otorisasi pertama.</span></div>
                                </li>
                                <li>
                                    <p class="step-t">Bagi wilayah tagihan: tugaskan pelanggan ke agen penagih</p>
                                    <p class="step-d"><b>Di mana:</b> /penugasan-agen (dropdown terisi dari akun ber-role 'agen' di /accounts)</p>
                                    <span class="why">Kenapa: Agen HANYA melihat pelanggan yang ditugaskan padanya. Pelanggan yang belum ditugaskan tidak akan pernah ditagih siapa pun — dan itu tidak terlihat sebagai error di layar mana pun.</span>
                                    <div class="note warn"><span class="ic">⚠️</span><span>Maksimal 1000 pelanggan per sekali kirim. Akun infrastruktur (modem CCTV/monitoring) dilewati diam-diam dan muncul di daftar 'skipped' — itu memang disengaja.</span></div>
                                </li>
                                <li>
                                    <p class="step-t">Uji jalur pembayaran ujung-ke-ujung pada SATU pelanggan sungguhan</p>
                                    <p class="step-d"><b>Di mana:</b> /payment-status (pilih Bulan+Tahun dulu, centang pelanggan, tandai Lunas, pilih CASH atau TRANSFER_BANK), lalu periksa /rekap-tunggakan dan /rekap-keuangan</p>
                                    <span class="why">Kenapa: Pembayaran adalah tempat kesalahan paling mahal. Menandai satu pelanggan lunas lalu membaca hasilnya di rekap membuktikan periode, metode, dan buku besar sudah nyambung — sebelum puluhan transaksi terlanjur masuk di bulan yang salah.</span>
                                    <div class="note warn"><span class="ic">⚠️</span><span>Periode WAJIB dipilih dan metode WAJIB diisi — baris tanpa metode gagal senyap dan masuk daftar 'failed'. Angka Lunas/Belum di Dashboard hanya salinan cepat; sumber kebenarannya halaman ini.</span></div>
                                </li>
                                <li>
                                    <p class="step-t">Siapkan Template Pesan dan periksa kalimat yang akan diterima pelanggan</p>
                                    <p class="step-d"><b>Di mana:</b> /templates</p>
                                    <span class="why">Kenapa: Semua teks yang dikirim bot berasal dari template tersimpan, dan template tersimpan SELALU mengalahkan teks bawaan di kode. Membaca sekali di awal mencegah pelanggan menerima nama brand orang lain atau kalimat yang salah.</span>
                                    <div class="note warn"><span class="ic">⚠️</span><span>Menyimpan mengirim SELURUH kategori — muat ulang halaman sebelum mengedit supaya tidak menimpa perubahan orang lain. Jangan mengubah nama slot ${...}; itu diisi otomatis sistem. Di produksi berkas template sering sudah diedit langsung, jadi isinya bisa berbeda dari yang Anda ingat.</span></div>
                                </li>
                                <li>
                                    <p class="step-t">Nyalakan fitur lapangan satu per satu, jangan sekaligus: Intake PSB, aset jaringan, monitoring</p>
                                    <p class="step-d"><b>Di mana:</b> /config tab Intake PSB (psbIntake.enabled + grup PSB + daftar dusun), lalu /auto-outage, /los-broadcast, /cctv-monitor sesuai kebutuhan</p>
                                    <span class="why">Kenapa: Hampir semua fitur baru dikirim dalam keadaan MATI (deploy gelap) supaya menyalakannya jadi keputusan operasional, bukan efek samping pembaruan. Menyalakan satu per satu membuat jelas fitur mana yang menyebabkan perubahan perilaku.</span>
                                    <div class="note warn"><span class="ic">⚠️</span><span>Bawaan psbIntake: enabled=false, groupId kosong, dusunList kosong. Selama groupId kosong, bot tetap membalas 'sudah diumumkan ke grup' padahal tidak ada satu pesan pun terkirim — isi grupnya sebelum tim mengandalkan pengumuman itu. Selama dusunList kosong, panduan bot menyuruh 'balas angka' padahal daftarnya tak pernah muncul.</span></div>
                                </li>
                                <li>
                                    <p class="step-t">Latih tim lewat halaman panduan masing-masing, lalu jalankan rutinitas harian</p>
                                    <p class="step-d"><b>Di mana:</b> Teknisi: /teknisi-tutorial dan perintah WhatsApp <code class="kbd">panduan teknisi</code>. Agen: /agen-tutorial. Rutinitas harian admin: /owner (ringkasan pagi) lalu /konfirmasi-bayar, /admin/daftar-tiket, /papan-psb</p>
                                    <span class="why">Kenapa: Teknisi dan agen punya halaman panduan sendiri; mengarahkan mereka ke sana menghemat penjelasan berulang dan mengurangi salah pakai perintah WhatsApp.</span>
                                    <div class="note warn"><span class="ic">⚠️</span><span>Menu 'Panduan Admin' di sidebar (/admin-tutorial) saat ini menunjuk berkas yang belum ada di sistem, sehingga mengkliknya menghasilkan error tampilan — pakai halaman panduan ini sebagai gantinya sampai berkasnya dipasang.</span></div>
                                </li>
                            </ol>
                        </section>

                        <!-- ============ MULAI DARI NOL: AKUN, KONFIGURASI, DAN SAMBUNGAN ============ -->
                        <section class="flow f-admin" id="mulai-dari-nol-akun-konfigurasi-dan-samb">
                            <h2>Mulai dari nol: akun, konfigurasi, dan sambungan</h2>
                            <p class="flow-sub">Empat hal yang harus beres sebelum apa pun bisa dipakai: akun login staf, setelan sistem, jadwal otomatis, dan urusan database. Salah urutan di sini membuat halaman-halaman berikutnya terlihat 'rusak' padahal hanya belum disiapkan.</p>
                            <div class="grid">
                                <div class="card">
                                    <h3>Akun Admin/Teknisi/Agen</h3>
                                    <span class="where">/accounts</span>
                                    <p>Membuat dan mengelola akun login staf beserta perannya: admin, teknisi, atau agen.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat merekrut teknisi/agen baru, mengganti password staf, atau menonaktifkan akun yang keluar.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /accounts → tabel akun (username, nama, nomor telepon, role).</li>
                                            <li>Klik Tambah: isi Username, Nama Lengkap, Password, Nomor Telepon, dan pilih Role (Admin / Teknisi / Agen).</li>
                                            <li>Simpan — password disimpan ter-hash.</li>
                                            <li>Untuk mengubah: buka Edit; kosongkan kolom password bila tidak ingin menggantinya.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) NOMOR TELEPON BUKAN OPSIONAL untuk teknisi: kolom itulah yang dipakai mengirim struk gaji, keputusan kasbon, dan DM penugasan PSB. Kosong = teknisi tak pernah dikabari apa pun, sementara aksinya tetap tercatat sukses. Boleh lebih dari satu nomor dipisah tanda |. 2) API akun mensyaratkan peran PERSIS 'admin' — akun ber-role 'owner'/'superadmin' bisa membuka halamannya tapi datanya 403. 3) Role yang tersedia hanya admin/teknisi/agen. 4) Akun pertama tak bisa dibuat dari web — gunakan <code class="kbd">node scripts/create-admin.js &lt;username&gt; &lt;password&gt; [nama] [role]</code> (password minimal 8 karakter).</span></div>
                                </div>
                                <div class="card">
                                    <h3>Konfigurasi Sistem (semua setelan bot &amp; jaringan)</h3>
                                    <span class="where">/config</span>
                                    <p>Satu halaman untuk seluruh setelan: MikroTik, WiFi &amp; bot, identitas usaha, pesan selamat datang, Intake PSB, penagihan &amp; isolir (termasuk nominal komisi teknisi/agen), rekening bank, payment gateway, backup Telegram, dan perangkat OLT.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat memasang instance baru, mengganti kredensial router/gateway, mengubah nominal komisi penarikan, atau menyalakan fitur yang masih 'gelap'.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /config dan gulir ke bagian yang dituju.</li>
                                            <li>Ubah nilai yang perlu saja.</li>
                                            <li>Simpan — setelan ditulis secara merge (kunci yang tidak dikirim tetap utuh) lalu diterapkan LANGSUNG tanpa restart, dan jadwal cron dimuat ulang.</li>
                                            <li>Untuk grup WhatsApp (Intake PSB / Notif Perbaikan), pilih dari dropdown grup — daftarnya diambil dari grup tempat bot menjadi anggota.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Kolom jadwal cron TIDAK bisa disimpan dari sini — kunci milik cron sengaja diabaikan; pakai /cron. 2) Dropdown grup WhatsApp kosong (503) bila bot sedang tidak terhubung. 3) 'Komisi Collection Teknisi/Agen' hanya berlaku ke depan — nyalakan SEBELUM mulai mengotorisasi. 4) Di produksi config disunting per-kunci; jangan menimpanya dengan salinan dari mesin lain. 5) Halaman /config tidak punya penjaga peran di route-nya; yang menjaga adalah API-nya yang admin-only.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Cron Jobs (jadwal otomatis bot)</h3>
                                    <span class="where">/cron</span>
                                    <p>Mengatur kapan bot menjalankan tugas terjadwal: penandaan belum bayar, pengingat pembayaran, masa tenggang, isolir, notifikasi isolir, revert kompensasi &amp; speed boost, cek redaman, backup Telegram, survei kepuasan, dan rekap survei.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat mengubah tanggal penagihan/isolir, mematikan sementara sebuah otomatisasi, atau menyetel jam backup.</p>
                                    <details class="qa">
                                        <summary>Langkah (5)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /cron.</li>
                                            <li>Isi kolom jadwal dengan ekspresi cron (contoh: '0 8 11 <b> </b>' = tanggal 11 pukul 08:00).</li>
                                            <li>Centang/lepas centang sakelar Enable/Disable untuk tiap jadwal dan tiap notifikasi.</li>
                                            <li>Simpan — jadwal langsung dimuat ulang tanpa restart.</li>
                                            <li>Untuk menonaktifkan sebuah jadwal tanpa menghapus nilainya, awali dengan tanda # (mis. '#0 8 11 <b> </b>').</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Jadwal kosong ditolak, dan ekspresi cron tidak valid ditolak dengan menyebut nama kolomnya — kecuali yang diawali '#'. 2) Hanya kolom yang ada di daftar resmi yang tersimpan; field lain diabaikan DIAM-DIAM tanpa pesan error. 3) Ini jantung penagihan: mengubah 'Jadwal Isolir' berarti mengubah tanggal pelanggan diputus — periksa dua kali. 4) Menyimpan me-restart semua penjadwalan; tugas yang seharusnya berbunyi tepat saat itu bisa terlewat.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Migrasi Database (upload, migrasi skema, restore)</h3>
                                    <span class="where">/migrate</span>
                                    <p>Mengganti database pelanggan dengan berkas SQLite lain, menambahkan kolom/tabel yang kurang, memuat ulang data ke memori, dan memulihkan dari backup.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat pindah server, memulihkan data setelah kecelakaan, atau setelah update yang menambah kolom baru.</p>
                                    <details class="qa">
                                        <summary>Langkah (5)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /migrate.</li>
                                            <li>Cek Skema dulu untuk melihat kolom/tabel yang kurang.</li>
                                            <li>Jalankan Migrasi Skema (idempoten, aman diulang) bila ada yang kurang.</li>
                                            <li>Untuk mengganti database: unggah berkas .sqlite/.db (maks 50MB, wajib punya tabel users) dengan opsi 'jalankan migrasi otomatis'. Database lama otomatis disalin ke folder backups sebelum ditimpa.</li>
                                            <li>Untuk memulihkan: pilih berkas backup dari daftar dan jalankan Restore.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Ini operasi paling merusak di seluruh panel: upload MENIMPA database pelanggan. 2) Endpoint upload/restore/reload hanya bergerbang 'staf' (termasuk akun teknisi) — jaga siapa yang punya akun. 3) Restore hanya menerima nama berkas berpola database.backup.&lt;angka&gt;.sqlite. 4) Berkas yang diunggah wajib mengandung tabel users.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Panduan Admin di menu sidebar — SAAT INI RUSAK</h3>
                                    <span class="where">/admin-tutorial</span>
                                    <p>Menu 'Panduan Admin' di sidebar yang seharusnya membuka rujukan lengkap penggunaan panel.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat admin baru mencari panduan bawaan dari dalam panel.</p>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> Route-nya sudah ada dan dipagari peran admin, tetapi berkas tampilannya belum ada di sistem (yang ada hanya panduan teknisi dan agen) — sehingga mengklik menu ini menghasilkan error render. Untuk sekarang pakai halaman panduan ini; teknisi tetap punya /teknisi-tutorial dan agen punya /agen-tutorial yang berkasnya ada.</span></div>
                                </div>
                            </div>
                        </section>

                        <!-- ============ PELANGGAN & PAKET LANGGANAN ============ -->
                        <section class="flow f-admin" id="pelanggan-paket-langganan">
                            <h2>Pelanggan &amp; paket langganan</h2>
                            <p class="flow-sub">Katalog paket harus ada lebih dulu, baru pelanggan. Dua hal yang paling sering menjebak admin baru: kolom status di database berisi 'active' (bukan 'aktif'), dan status ISOLIR tidak pernah muncul di kolom status — isolir itu profil di router.</p>
                            <div class="grid">
                                <div class="card">
                                    <h3>Paket Langganan (katalog paket &amp; harga)</h3>
                                    <span class="where">/packages</span>
                                    <p>Mendaftarkan paket yang dijual: nama, harga, dan profil MikroTik yang dipakai paket itu.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Menaikkan harga paket, menambah paket kecepatan baru, atau membuat paket gratis/khusus yang tidak boleh ditagih dan tidak boleh diisolir.</p>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Centang 'Whitelist' = paket gratis kebal tagihan &amp; isolir, TAPI kekebalannya dicocokkan lewat nama profil paket yang dicari dari NAMA PAKET pelanggan. Kalau nama paket pelanggan tidak persis ada di daftar ini, kekebalannya batal — tetap ditagih dan tetap diisolir. (2) Harga 0 tidak tersimpan (0 dianggap kosong, harga lama dipakai lagi); nama/profil/deskripsi juga tidak bisa dikosongkan. (3) Menghapus paket TIDAK mengubah pelanggan yang masih memakainya; harga mereka lalu jatuh ke kolom harga di data pelanggan. (4) Endpoint paket tidak punya pemeriksa peran admin sendiri — pengamanannya hanya dari login. Perlakukan halaman ini sebagai sangat sensitif.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Data Pelanggan (daftar, tambah, ubah, hapus)</h3>
                                    <span class="where">/users</span>
                                    <p>Satu tempat untuk melihat semua pelanggan dan menambah / mengubah / menghapus data mereka.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Pelanggan baru selesai dipasang dan perlu didaftarkan lewat web, nomor HP pelanggan ganti, pelanggan pindah/berhenti, atau perlu cari cepat siapa pemakai PPPoE tertentu.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /users, tunggu tabel terisi (tombol 'Refresh Data' baru aktif setelah data PPPoE MikroTik selesai ditarik).</li>
                                            <li>Untuk tambah: klik 'Tambah Pelanggan Baru' → isi nama, nomor HP, paket, PPPoE, dan (opsional) ODP + titik lokasi → Simpan.</li>
                                            <li>Untuk ubah/hapus: pakai tombol aksi di baris pelanggan.</li>
                                            <li>Tombol khusus di kanan atas: Import Excel (ada pratinjau validasi dulu), Rubah Profil Massal, Sinkronisasi Profil ke MikroTik.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Kolom status di database berisi 'active' — BUKAN 'aktif'. Jangan pernah membuat filter/laporan yang mencari kata 'aktif'. (2) ISOLIR TIDAK pernah muncul di kolom status — isolir itu profil PPPoE di MikroTik. (3) Tombol 'Rubah Profil Massal' bukan cuma mengubah pelanggan: kalau semua baris sukses, ia juga MENIMPA profil paket di katalog — jadi paketnya ikut berubah permanen. (4) Nomor HP ditolak kalau bentrok dengan pelanggan lain; ID ODP ditolak kalau tidak terdaftar atau portnya penuh. (5) 'Delete All Users' minta password admin — ini menghapus SEMUA pelanggan. (6) Menghapus pelanggan memutus sesi + menghapus secret PPPoE secara best-effort: bila MikroTik sedang tak terjangkau, secret-nya SELAMAT sementara baris pelanggannya hilang — modemnya lalu ditolak selamanya oleh wizard PSB dengan pemilik 'pelanggan lain'.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Rubah Paket (satu / beberapa pelanggan)</h3>
                                    <span class="where">/rubah-paket</span>
                                    <p>Memindahkan pelanggan tertentu ke paket lain, sekaligus mengganti profil kecepatannya di MikroTik.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Pelanggan minta upgrade/downgrade kecepatan dan admin memprosesnya langsung tanpa menunggu pengajuan.</p>
                                    <details class="qa">
                                        <summary>Langkah (3)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /rubah-paket, cari dan pilih pelanggan.</li>
                                            <li>Pilih paket tujuan, lalu jalankan.</li>
                                            <li>Sistem mengubah profil di MikroTik, lalu MEMUTUS sesi PPPoE supaya profil baru langsung berlaku.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Sesi pelanggan sengaja diputus setelah ganti profil — internet mereka mati beberapa detik; jangan dipakai pada jam sibuk tanpa memberi tahu. (2) Kalau paket tujuan tidak punya profil MikroTik, hasilnya 'failed_sync' dan profil tidak berubah. (3) Pelanggan tanpa username PPPoE dilewati sinkronisasinya — datanya berubah di aplikasi saja. (4) Kalau sinkronisasi MikroTik sedang dimatikan, perubahan hanya tersimpan lokal dan router tidak tersentuh.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Request Ubah Paket (pengajuan dari teknisi/pelanggan)</h3>
                                    <span class="where">/package-requests</span>
                                    <p>Kotak masuk pengajuan ganti paket yang menunggu keputusan setuju atau tolak.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Teknisi di lapangan mengajukan ganti paket untuk pelanggan, lalu admin memutuskan dari kantor.</p>
                                    <details class="qa">
                                        <summary>Langkah (3)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /package-requests dan lihat daftar berstatus 'pending'.</li>
                                            <li>Klik centang (Setujui) atau silang (Tolak) di baris pengajuan.</li>
                                            <li>Setuju = profil MikroTik ikut diubah dan pelanggan + teknisi dikabari otomatis.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Keputusan yang sama juga bisa dilakukan dari WhatsApp dengan membalas notifikasi: <code class="kbd">ok</code>, <code class="kbd">tolak &lt;alasan&gt;</code>, atau <code class="kbd">batalkan</code>. Jangan memproses dua kali. (2) Kata <code class="kbd">batal</code> polos TIDAK berfungsi di WhatsApp — sudah dicegat penjaga batal-universal; verb yang benar <code class="kbd">batalkan</code>. (3) <code class="kbd">batalkan</code> sengaja diam-diam: pelanggan TIDAK dikabari, hanya teknisi. Pakai <code class="kbd">tolak</code> kalau pelanggan memang harus tahu.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Import dari MikroTik — tarik pelanggan PPPoE yang sudah ada di router</h3>
                                    <span class="where">/import-mikrotik</span>
                                    <p>Scan PPPoE secret di MikroTik, tampilkan yang BELUM terdaftar di sistem, lalu import massal jadi data pelanggan — sekalian mencocokkan device GenieACS-nya.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat onboarding instance baru / mengambil alih jaringan yang sudah jalan, atau berkala untuk menjaring pelanggan yang dibuat langsung di router tanpa lewat bot.</p>
                                    <details class="qa">
                                        <summary>Langkah (5)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /import-mikrotik, tekan 'Scan MikroTik'.</li>
                                            <li>Saring per Profile / Status / cari username; hitungan 'siap import' vs 'belum lengkap' tampil di header.</li>
                                            <li>Tekan 'Auto-Sync Device' untuk mencocokkan PPPoE username dengan device GenieACS; sisanya pilih device manual per baris.</li>
                                            <li>Isi Pengaturan Default (bulk SSID, status bayar, kirim invoice, kirim pesan selamat datang).</li>
                                            <li>Jalankan import.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) MATIKAN pesan selamat datang saat import massal — mengirim WA ke SEMUA pelanggan sekaligus berisiko diblokir WhatsApp. (2) Baris tanpa Device ID dan tanpa nama DITOLAK; nomor HP kosong hanya diberi peringatan. PPPoE username yang sudah ada dilewati. (3) MikroTik adalah wasit identitas pelanggan, bukan Excel — typo pada username pernah menghasilkan 20 'duplikat palsu'. (4) Pesan selamat datang memuat user/pass PORTAL PELANGGAN, bukan kredensial PPPoE. (5) Ada riwayat bug INSERT yang membuang kolom secara senyap — verifikasi beberapa baris hasil import sebelum menganggap selesai.</span></div>
                                </div>
                                <div class="card">
                                    <h3>IP Statik (daftar profil IP statik)</h3>
                                    <span class="where">/statik</span>
                                    <p>Melihat daftar profil IP statik beserta batas kecepatannya (limit-at dan max-limit).</p>
                                    <p class="when"><b>Kapan dipakai:</b> Perlu mengecek profil statik apa saja yang terdaftar sebelum menaruh pelanggan korporat/khusus di sana.</p>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> Halaman ini praktis HANYA-BACA + HAPUS. Tombol 'Tambah' dan 'Edit' mengirim ke endpoint simpan yang TIDAK ADA di kode — menekan Simpan tidak menyimpan apa pun. Ubah profil statik langsung di MikroTik.</span></div>
                                </div>
                            </div>
                        </section>

                        <!-- ============ UANG MASUK: PEMBAYARAN, TAGIHAN, TUNGGAKAN, DISKON ============ -->
                        <section class="flow f-admin" id="uang-masuk-pembayaran-tagihan-tunggakan-">
                            <h2>Uang masuk: pembayaran, tagihan, tunggakan, diskon</h2>
                            <p class="flow-sub">Sumber kebenaran uang adalah buku besar di /payment-status dan /rekap-keuangan — bukan angka di Dashboard. Semua aksi di sini terikat pada periode (bulan+tahun) yang Anda pilih di atas layar.</p>
                            <div class="grid">
                                <div class="card">
                                    <h3>Status Pembayaran (tandai lunas / belum lunas per bulan)</h3>
                                    <span class="where">/payment-status</span>
                                    <p>Menandai siapa yang sudah bayar dan siapa yang belum untuk satu bulan tertentu, plus kirim/cetak invoice dan catat bayar di muka.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Setiap kali menerima setoran tunai atau transfer, saat rekap akhir bulan, atau saat pelanggan ingin bayar beberapa bulan sekaligus.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Pilih Bulan dan Tahun di filter paling atas — SEMUA aksi di halaman ini terikat ke periode itu.</li>
                                            <li>Centang satu atau beberapa pelanggan.</li>
                                            <li>Klik tandai Lunas, lalu pilih metode: CASH atau TRANSFER_BANK (wajib).</li>
                                            <li>Untuk prabayar: buka menu 'Bayar di Muka', isi jumlah bulan (1-12).</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Periode WAJIB dipilih; salah pilih periode = uang tercatat di bulan yang salah. (2) Metode wajib CASH atau TRANSFER_BANK; kalau kosong barisnya gagal senyap dan masuk daftar 'failed'. (3) 'Bayar di Muka' ditolak bila bulan berjalan belum lunas, dan menolak pelanggan paket voucher serta paket whitelist/gratis. (4) Angka Lunas/Belum di Dashboard hanya cache; sumber kebenarannya buku besar di halaman ini. (5) Halaman ini tidak dipagari peran di route-nya — akun non-admin bisa membukanya tapi datanya kosong karena API-nya menolak.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Konfirmasi Bayar (bukti transfer dari WhatsApp)</h3>
                                    <span class="where">/konfirmasi-bayar</span>
                                    <p>Memeriksa foto bukti transfer yang dikirim pelanggan lewat WhatsApp, lalu satu klik menjadikannya lunas.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Pelanggan mengirim foto struk/transfer ke nomor bot dan admin perlu memverifikasinya.</p>
                                    <details class="qa">
                                        <summary>Langkah (3)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /konfirmasi-bayar (daftar menyegarkan sendiri tiap 30 detik).</li>
                                            <li>Klik fotonya untuk memastikan itu memang bukti transfer dan nominalnya cocok.</li>
                                            <li>Pilih salah satu dari TIGA tombol: 'Konfirmasi' (catat lunas + buka isolir bila terisolir + kirim struk), 'Tolak' (pelanggan DIBERI TAHU), atau 'Hapus (bukan bukti bayar)' (buang dari antrian, pelanggan TIDAK diberi tahu).</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Jangan pakai 'Tolak' untuk foto keluhan/koordinasi — pelanggan akan menerima pesan 'pembayaran ditolak' padahal dia tidak pernah mengaku bayar; untuk itu gunakan 'Hapus'. (2) Kalau pelanggan sudah lunas, tombol Konfirmasi sengaja DITOLAK dengan pesan 'sudah lunas — kemungkinan bukan bukti pembayaran'; itu bukan error. (3) Foto bukti disajikan lewat jalur ber-otentikasi — jangan disalin/dibagikan sebagai tautan file langsung. (4) Pekerjaan yang sama bisa dilakukan dari WhatsApp (<code class="kbd">ok</code> / <code class="kbd">terima BP-...</code> / <code class="kbd">tolak &lt;alasan&gt;</code> / <code class="kbd">hapus</code>) — jangan diproses dua kali.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Rekap Tunggakan (siapa menunggak dan berapa)</h3>
                                    <span class="where">/rekap-tunggakan</span>
                                    <p>Melihat daftar penunggak per periode plus ringkasan berapa lama mereka menunggak (1, 2, 3+ periode).</p>
                                    <p class="when"><b>Kapan dipakai:</b> Awal bulan sebelum menyusun jadwal penagihan, atau saat menyiapkan Broadcast Terarah ke penunggak.</p>
                                    <details class="qa">
                                        <summary>Langkah (3)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Pilih Bulan dan Tahun, klik Terapkan.</li>
                                            <li>Baca tab operasional untuk daftar orangnya, tab ringkasan untuk angka besarnya.</li>
                                            <li>Klik satu pelanggan untuk melihat rincian tagihan-per-tagihannya.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Halaman ini pernah SELALU menampilkan nol di kedua bot — bukan karena tak ada penunggak, tapi karena kueri menyaring status 'aktif'/'isolir' yang tidak pernah ada di data. Sudah diperbaiki; kalau suatu saat kembali nol padahal jelas ada penunggak, curigai hal yang sama. (2) Akun infrastruktur (modem CCTV/monitoring) sengaja tidak dihitung. (3) Nominalnya harga EFEKTIF (sudah dikurangi diskon). (4) Halaman ini hanya membaca; melunaskan tetap di /payment-status.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Gratis Bulan Ini (bebaskan tagihan / waiver)</h3>
                                    <span class="where">/gratis-bulan-ini</span>
                                    <p>Menandai satu bulan sebagai GRATIS untuk pelanggan tertentu — dihitung lunas dan kebal isolir, tapi tidak masuk hitungan pemasukan.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Pelanggan baru dipasang di tengah bulan dan bulan pertamanya digratiskan, atau kompensasi yang tidak boleh mengotori laporan omset.</p>
                                    <details class="qa">
                                        <summary>Langkah (3)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Pilih bulan dan tahun.</li>
                                            <li>Centang 'hanya yang belum bayar' untuk mempersempit daftar.</li>
                                            <li>Klik tombol gratiskan per baris, atau centang beberapa lalu gratiskan sekaligus.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Ini BUKAN pencatatan pembayaran: periode jadi lunas tapi nol rupiah masuk laporan. Kalau uangnya benar-benar diterima, catat di /payment-status. (2) Pelanggan paket voucher ditolak; pelanggan bertagihan Rp0 disembunyikan dari daftar. (3) Aman diklik dua kali — yang kedua dijawab 'sudah ditandai gratis sebelumnya'. (4) Kalau 'gratis bulan pemasangan' sudah dinyalakan di setelan Intake PSB, pelanggan PSB baru SUDAH digratiskan sendiri.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Diskon Pelanggan</h3>
                                    <span class="where">/admin-diskon</span>
                                    <p>Memberi potongan harga (nominal rupiah atau persen) ke pelanggan tertentu untuk sejumlah bulan.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Pelanggan lama diberi potongan loyalitas, atau kompensasi harga karena keluhan layanan.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /admin-diskon, pilih pelanggan di form atas.</li>
                                            <li>Isi SALAH SATU: potongan nominal ATAU potongan persen.</li>
                                            <li>Isi berapa bulan diskon berlaku (1-12) dan alasannya.</li>
                                            <li>Simpan — pelanggan otomatis dikirimi pesan WhatsApp berisi harga barunya.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Mengisi nominal DAN persen bersamaan langsung ditolak. (2) Setiap kali menekan Simpan, jatah bulan terpakai di-RESET ke 0 — mengedit alasan saja pun memperpanjang diskon dari awal. (3) Jatah berkurang otomatis setiap pembayaran tercatat; begitu habis, harga kembali normal tanpa pemberitahuan. (4) Menyimpan LANGSUNG mengirim WhatsApp ke pelanggan — jangan dipakai coba-coba. (5) Menghapus diskon menolkan nominal &amp; persen tapi tidak mereset jatah bulan. (6) Kalau muncul 'Gagal mengambil data diskon', itu masalah skema database, bukan salah input.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Otorisasi Pembayaran (pengajuan setoran dari teknisi/agen)</h3>
                                    <span class="where">/pembayaran/otorisasi</span>
                                    <p>Menyetujui pengajuan 'sudah bayar' yang dikirim teknisi atau agen penagih, sekaligus melihat rekap total ditarik dan komisinya.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Teknisi selesai keliling menagih dan menyetorkan hasilnya; admin mengotorisasi supaya status pelanggan berubah lunas dan isolirnya terbuka.</p>
                                    <details class="qa">
                                        <summary>Langkah (3)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /pembayaran/otorisasi dan lihat kartu 'Rekap Teknisi — Total Ditarik &amp; Komisi'.</li>
                                            <li>Pilih pengajuan yang mau disetujui (bisa banyak sekaligus).</li>
                                            <li>Jalankan otorisasi, lalu pantau kartu 'Log Otorisasi' untuk hasil per pelanggan.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Bila mode pekerjaan-latar aktif, otorisasi massal TIDAK langsung selesai — ia menjawab 'diterima' lalu berjalan di belakang; kemajuannya hanya di kartu Log Otorisasi. Jangan diklik berulang; pengajuan kedua ditolak selama masih ada yang berjalan. (2) Kalau server sempat restart di tengah proses, baris yang tertinggal berstatus 'processing' TIDAK diulang otomatis dan ditandai perlu diperiksa manual — ini disengaja supaya uang tidak terhitung dua kali. (3) Halaman ini tidak punya penjaga peran sendiri di route-nya.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Transaksi (riwayat pembayaran gateway)</h3>
                                    <span class="where">/transaction</span>
                                    <p>Melihat riwayat transaksi pembayaran online (nomor referensi, pengirim, status, nominal, metode).</p>
                                    <p class="when"><b>Kapan dipakai:</b> Pelanggan mengaku sudah bayar lewat QRIS/VA dan admin perlu mencocokkan nomor referensinya.</p>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Hanya melihat dan menghapus — tidak ada tombol simpan/edit yang berfungsi. (2) Tombol 'Hapus' hanya membuang CATATAN transaksi gateway; ia tidak membatalkan pembayaran yang sudah masuk buku besar. Untuk membatalkan pelunasan, lakukan dari /payment-status.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Metode Pembayaran (daftar cara bayar)</h3>
                                    <span class="where">/payment-method</span>
                                    <p>Daftar referensi metode pembayaran beserta biaya adminnya.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Sekadar melihat metode apa saja yang pernah terdaftar di sistem.</p>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Praktis HANYA-BACA + HAPUS; endpoint simpannya tidak ada, menekan Simpan tidak menyimpan apa pun. (2) Jangan tertukar: metode yang benar-benar dipakai saat mencatat pembayaran adalah pilihan CASH / TRANSFER_BANK di /payment-status, dan gateway online diatur di /config.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Pengaturan Invoice (tampilan &amp; isi tagihan)</h3>
                                    <span class="where">/invoice-settings</span>
                                    <p>Mengatur identitas perusahaan, logo, pajak, nomor rekening, dan bagian mana saja yang tampil di invoice pelanggan.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Ganti nomor rekening, ganti logo/nama usaha, mengaktifkan atau mematikan pajak, atau merapikan catatan yang tercetak di invoice.</p>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Simpan di sini MENULIS konfigurasi sistem — perlakukan sebagai perubahan sistem, bukan sekadar tampilan. (2) Aturan jatuh tempo TIDAK bisa diubah dari halaman ini (nilai lama sengaja dipertahankan). (3) Judul, prefix nomor invoice, dan tema tidak bisa dikosongkan (kosong = kembali ke bawaan); sebaliknya catatan tambahan, logo, dan nomor rekening MEMANG bisa dikosongkan dan tersimpan kosong. (4) Sakelar 'kirim otomatis' dibaca HIDUP selama belum pernah dimatikan. (5) Halaman ini hanya mengatur tampilan; angka tagihan tetap dari paket + diskon.</span></div>
                                </div>
                            </div>
                        </section>

                        <!-- ============ ISOLIR, KOMPENSASI, DAN PEMULIHAN LAYANAN ============ -->
                        <section class="flow f-admin" id="isolir-kompensasi-dan-pemulihan-layanan">
                            <h2>Isolir, kompensasi, dan pemulihan layanan</h2>
                            <p class="flow-sub">Isolir bukan status di database — isolir adalah profil PPPoE di MikroTik. Konsekuensinya: mencari 'siapa yang terisolir' lewat kolom status akan selalu kosong, dan membuka isolir tanpa membereskan tagihan hanya menunda pemutusan berikutnya.</p>
                            <div class="grid">
                                <div class="card">
                                    <h3>Buka Isolir (aktifkan kembali pelanggan yang diputus)</h3>
                                    <span class="where">/buka-isolir</span>
                                    <p>Mengembalikan pelanggan yang sedang diisolir ke profil kecepatan paketnya sehingga internetnya hidup lagi.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Pelanggan sudah membayar tunggakan dan minta segera dinyalakan, atau ada yang salah terisolir.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /buka-isolir, cari pelanggan terisolir (pilihan tetap tersimpan walau pindah halaman tabel).</li>
                                            <li>Centang pelanggan yang mau dibuka; centang 'reboot' hanya bila modemnya perlu dipaksa menyambung ulang.</li>
                                            <li>Jalankan Buka Isolir. Sesi PPPoE SELALU diputus supaya profil baru langsung berlaku.</li>
                                            <li>Cek panel Riwayat/Hasil untuk melihat baris mana yang gagal.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Membuka isolir TIDAK mengubah status pembayaran. Kalau tagihannya masih tercatat belum lunas, cron isolir akan mengisolir dia LAGI pada jadwal berikutnya — tandai lunas di /payment-status atau beri waiver di /gratis-bulan-ini dulu. (2) Kalau nama paket pelanggan tidak ada di katalog, barisnya GAGAL dengan 'Profil tidak ditemukan untuk paket ...' — perbaiki paketnya di /packages. (3) Reboot modem hanya berjalan bila perangkatnya bisa di-reboot; kalau tidak, dihitung 'reboot dilewati', bukan gagal.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Custom Isolir (isolir manual, borongan)</h3>
                                    <span class="where">/custom-isolir</span>
                                    <p>Memutus layanan pelanggan secara manual dengan memindahkan mereka ke profil ISOLIR di MikroTik.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Menindak penunggak di luar jadwal cron, atau memutus pelanggan yang berhenti berlangganan.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /custom-isolir, saring kandidat (berdasarkan paket atau profil saat ini).</li>
                                            <li>Centang pelanggan; pilihan tetap tersimpan lintas halaman tabel.</li>
                                            <li>Tentukan profil tujuan (bawaan: ISOLIR), tentukan apakah perlu reboot, isi alasan.</li>
                                            <li>Jalankan — semuanya tercatat di jejak audit.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Isolir = mengganti PROFIL PPPoE di MikroTik; kolom status pelanggan TIDAK ikut berubah. (2) Kalau sinkronisasi MikroTik atau fitur isolir sedang dimatikan, halaman ini tidak melakukan apa-apa ke router. (3) Salah ketik nama profil tujuan = pelanggan pindah ke profil yang tidak ada dan bisa ikut terputus tanpa jejak yang jelas — pakai profil bawaan kecuali sangat yakin. (4) Semua aksi masuk audit; jangan mengetes di pelanggan asli.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Kompensasi (naikkan kecepatan sementara)</h3>
                                    <span class="where">/kompensasi</span>
                                    <p>Memberi pelanggan kecepatan lebih tinggi untuk jangka waktu tertentu, lalu sistem mengembalikannya sendiri.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Permintaan maaf setelah gangguan panjang, atau masa coba kecepatan yang lebih tinggi.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /kompensasi, cari pelanggan lewat nama / ID / username PPPoE.</li>
                                            <li>Pilih profil kecepatan kompensasi dan durasinya (hari + jam + menit, total harus lebih dari 0).</li>
                                            <li>Isi catatan, lalu jalankan. Modem pelanggan akan di-reboot dan sesinya diputus.</li>
                                            <li>Pantau tabel 'kompensasi aktif' sampai masa berlakunya habis.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) TERBESAR: profil yang dikembalikan nanti diambil dari KATALOG PAKET, bukan dari profil yang sedang dipakai pelanggan. Memberi kompensasi ke pelanggan yang sedang ISOLIR membuat dia aktif, dan saat kompensasi berakhir ia kembali ke profil paket — isolirnya hilang selamanya. Jangan pernah memberi kompensasi ke pelanggan terisolir. (2) Pengembalian bergantung pada cron 'revert kompensasi'; kalau cron itu mati, kecepatan tinggi TIDAK PERNAH kembali normal. (3) Satu pelanggan hanya boleh punya satu kompensasi aktif. (4) Paket pelanggan wajib terdaftar dan punya profil MikroTik. (5) Apply memicu reboot + putus sesi — internet pelanggan mati sesaat.</span></div>
                                </div>
                            </div>
                        </section>

                        <!-- ============ PASANG BARU (PSB): PAPAN JADWAL, WIZARD WHATSAPP, KOMISI ============ -->
                        <section class="flow f-admin" id="pasang-baru-psb-papan-jadwal-wizard-what">
                            <h2>Pasang baru (PSB): papan jadwal, wizard WhatsApp, komisi</h2>
                            <p class="flow-sub">Pemasangan baru punya dua pintu: papan jadwal (untuk yang belum bisa dipasang hari itu) dan wizard #PSB di WhatsApp (untuk teknisi yang sedang di rumah pelanggan). Bagian tersulit bagi admin baru adalah gerbang modem — bot menolak modem yang masih dipakai orang lain, dan jalan keluarnya sering salah dipahami.</p>
                            <div class="grid">
                                <div class="card">
                                    <h3>Papan PSB (daftar pemasangan baru yang belum kepasang)</h3>
                                    <span class="where">/papan-psb</span>
                                    <p>Satu papan berisi calon pelanggan yang sudah didaftarkan tapi belum dipasang, siapa teknisi yang memegangnya, dan berapa komisi marketingnya.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat ada calon pelanggan baru menghubungi dan Anda perlu mengantre-kan pemasangannya, lalu memantau mana yang belum dikerjakan.</p>
                                    <details class="qa">
                                        <summary>Langkah (7)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /papan-psb — kartu atas menunjukkan Belum Kepasang, Terpasang Bulan Ini, Komisi Marketing, Komisi Belum Dibayar.</li>
                                            <li>Isi form kiri: Nama, No HP (pisah pakai | bila lebih dari satu), Dusun, Paket, Lokasi rumah (link Maps atau lat,lng), unggah Foto KTP + Foto rumah, catatan opsional.</li>
                                            <li>Klik 'Daftarkan &amp; umumkan ke grup' → status jadi 'menunggu'.</li>
                                            <li>Di tabel kanan: admin klik Tugaskan (pilih teknisi) atau teknisi klik Ambil sendiri; teknisi yang ditugaskan menerima DM WhatsApp.</li>
                                            <li>Klik kolom Marketing/Komisi untuk mengisi pemberi lead dan nominal komisi.</li>
                                            <li>Untuk pemberi lead LUAR, tombol bayar komisi mencatatnya sebagai pengeluaran kas kategori marketing.</li>
                                            <li>Penutupan jadwal (jadi 'terpasang') dilakukan lewat wizard #PSB di WhatsApp, bukan dari halaman ini.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Empat syarat keras saat mendaftar: foto KTP, foto rumah, koordinat lokasi, dan nama paket yang DIKENAL sistem (paket tak terdaftar ditolak). 2) Kalimat 'sudah diumumkan ke grup' DITULIS TANPA MEMERIKSA HASIL KIRIM: bila grup PSB belum diisi di /config, atau WhatsApp sedang putus, layar tetap melaporkan 'Terjadwal PSB-n' padahal tak satu pun pesan grup terkirim. Selama grup belum diset, beri tahu tim secara manual. 3) Hanya admin yang boleh 'Tugaskan'; teknisi hanya boleh 'Ambil'. 4) Setelah komisi dibayar, datanya TERKUNCI — koreksi ditolak. 5) Bayar-via-kas hanya untuk pemberi lead LUAR; komisi teknisi lewat payroll di /gaji-teknisi.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Laporan Marketing PSB (komisi per pemberi lead)</h3>
                                    <span class="where">/laporan-marketing-psb</span>
                                    <p>Rekap siapa yang membawa berapa pemasangan dan berapa komisinya — sudah dibayar lewat kas, lewat gaji, atau masih terutang.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Akhir bulan saat mau membayar makelar/teknisi pembawa pelanggan, atau saat ada yang menagih komisinya.</p>
                                    <details class="qa">
                                        <summary>Langkah (5)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /laporan-marketing-psb.</li>
                                            <li>Pilih Bulan + Tahun, atau ubah Rentang jadi 'Semua (all-time)'.</li>
                                            <li>Klik Tampilkan.</li>
                                            <li>Baca 4 kartu: Total Komisi, Belum Dibayar, Dibayar Kas (luar), Via Gaji (teknisi).</li>
                                            <li>Tabel 'Ringkasan Per Pemberi Lead' untuk siapa dapat berapa; 'Rincian Per Pemasangan' untuk buktinya.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Halaman ini HANYA menampilkan baris yang nominal komisinya sudah diisi — pemberi lead yang sudah dicatat tapi nominalnya masih kosong TIDAK muncul sama sekali, jadi laporan bisa terlihat kosong padahal datanya ada. 2) Pengelompokan periode memakai tanggal terpasang; bila belum terpasang memakai tanggal terakhir diubah — mengedit komisi baris lama memindahkannya ke bulan saat Anda mengedit. 3) Read-only untuk admin; akun teknisi ditolak.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Daftarkan PSB terjadwal dari WhatsApp</h3>
                                    <span class="where">#jadwal</span>
                                    <p>Mendaftarkan calon pelanggan ke papan PSB dengan 3 bukti (foto KTP, foto rumah, share lokasi), lalu diumumkan ke grup untuk dijadwalkan pemasangan.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat ada calon pelanggan tapi pemasangan belum bisa dilakukan hari itu.</p>
                                    <details class="qa">
                                        <summary>Langkah (5)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Ketik <code class="kbd">#jadwal</code> (atau <code class="kbd">jadwal</code> / <code class="kbd">psb baru</code>) di japri bot.</li>
                                            <li>Isi data mengikuti checklist: Nama, HP, Dusun, Paket, catatan (opsional <code class="kbd">Marketing: &lt;nama pemberi lead&gt;</code>).</li>
                                            <li>Kirim foto KTP (foto pertama), lalu foto rumah (foto kedua).</li>
                                            <li>Share lokasi rumahnya.</li>
                                            <li>Selesai — bot memberi nomor referensi <code class="kbd">PSB-&lt;n&gt;</code>.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> Butuh fitur Intake PSB aktif (bawaan MATI) + nomor terdaftar sebagai akun staf dengan role yang diizinkan. Foto PERTAMA selalu dianggap KTP, kedua rumah. Ketik <code class="kbd">batal</code> untuk membatalkan. Sama seperti versi web: kalimat 'sudah diumumkan ke grup' tidak membuktikan pesan grup benar-benar terkirim.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Wizard pasang baru (bikin pelanggan + setel modem)</h3>
                                    <span class="where">#PSB  (dikirim bersama FOTO KTP)</span>
                                    <p>Alur lengkap pasang baru: bot membuat pelanggan, membuat akun PPPoE di MikroTik, menyetel modem lewat GenieACS, dan mengirim pesan selamat datang.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Teknisi sedang di rumah pelanggan dan siap memasang.</p>
                                    <details class="qa">
                                        <summary>Langkah (5)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Kirim FOTO KTP dengan caption <code class="kbd">#PSB</code> di japri bot (data boleh menyusul).</li>
                                            <li>Lengkapi data urutan bebas: Nama, Dusun (lokasi PASANG bukan alamat KTP), RT/RW, Paket, WiFi, Sandi, HP (&gt;1 nomor pisahkan dengan |).</li>
                                            <li>Kirim foto rumah + share lokasi.</li>
                                            <li>Bot menampilkan SN modem: balas <b>YA</b> bila cocok, <b>TIDAK</b> untuk pilih dari daftar, <b>REFRESH</b> bila belum terbaca, atau ketik <code class="kbd">cari &lt;SN/nama pemilik lama&gt;</code> untuk modem bekas.</li>
                                            <li>Cek ringkasan, balas <b>YA</b> — baru di titik ini pelanggan dibuat dan modem disetel.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Wizard hanya terpicu bila ada FOTO — kecuali bentuk <code class="kbd">#PSB PSB-12</code> yang boleh teks polos karena buktinya diambil dari papan jadwal. 2) HATI-HATI: mengetik <code class="kbd">#PSB PSB-12</code> saat teknisi masih punya PSB lain yang belum selesai akan MENIMPA pekerjaan lama itu tanpa peringatan, dan data lama tak bisa dipanggil lagi. Selesaikan atau batalkan yang lama dulu. 3) Satu teknisi hanya boleh memegang SATU PSB pada satu waktu. 4) Kalau sesi mati/timeout, kerja tidak hilang: ketik <code class="kbd">LANJUT</code> (kata <code class="kbd">lanjut</code>/<code class="kbd">refresh</code>/<code class="kbd">lanjutkan</code>/<code class="kbd">terusin</code> langsung diterima bila ada draft tersimpan). Mengetik <code class="kbd">#PSB</code> polos justru memunculkan panduan, bukan tawaran melanjutkan. 5) Modem berlabel ⛔ TERPAKAI sengaja DITOLAK — memaksanya akan mematikan internet pelanggan lain. 6) Ketik <code class="kbd">BATAL</code> menghentikan wizard, tetapi draftnya tetap tersimpan; kalau nanti Anda mulai pelanggan baru, bot akan menawarkan melanjutkan pelanggan yang tadi dibatalkan — pilih <b>BARU</b> untuk membuangnya.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Pasang baru langsung dari grup PSB</h3>
                                    <span class="where">foto KTP + caption '#PSB Nama: … Dusun: … Paket: …' dikirim ke grup PSB</span>
                                    <p>Jalur satu-pesan: bot mem-parse caption, membuat pelanggan + akun PPPoE, lalu membalas kredensial ke grup.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Bila tim terbiasa bekerja lewat grup, bukan japri.</p>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> Hanya di grup PSB yang dikonfigurasi, hanya pesan GAMBAR ber-caption <code class="kbd">#PSB</code>, dan hanya dari akun staf ber-role diizinkan. Pesan grup lain diabaikan total.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Papan PSB &amp; penugasan lewat WhatsApp</h3>
                                    <span class="where">papan psb  |  ambil PSB-12  |  tugaskan PSB-12 ke davin</span>
                                    <p>Melihat antrean pemasangan dan membagi pekerjaan tanpa membuka panel web.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Setiap pagi saat membagi kerja teknisi.</p>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> <code class="kbd">papan psb</code> (sinonim <code class="kbd">daftar psb</code>) menampilkan maksimal 30 baris. <code class="kbd">tugaskan</code> HANYA untuk admin/owner — teknisi ditolak dan diarahkan ke <code class="kbd">ambil PSB-&lt;n&gt;</code>. Nama teknisi dicocokkan username/id persis dulu, lalu 'contains'; kalau cocok lebih dari satu bot minta username spesifik. DM teknisi hanya terkirim bila akunnya punya nomor telepon di /accounts. Jadwal yang sudah dipegang teknisi lain tidak bisa diambil — minta admin <code class="kbd">tugaskan</code> untuk mengalihkan.</span></div>
                                </div>
                            </div>
                        </section>

                        <!-- ============ ASET JARINGAN, PETA, DAN OLT ============ -->
                        <section class="flow f-admin" id="aset-jaringan-peta-dan-olt">
                            <h2>Aset jaringan, peta, dan OLT</h2>
                            <p class="flow-sub">Peta jaringan diisi teknisi dari lapangan lewat WhatsApp (admin tidak memetakan dari web), sedangkan admin merapikan dan membacanya di web. OLT adalah perangkat inti fiber: gunakan untuk membedakan gangguan satu pelanggan dari gangguan area.</p>
                            <div class="grid">
                                <div class="card">
                                    <h3>Manajemen Aset — daftar kotak ODC &amp; ODP</h3>
                                    <span class="where">/network-assets</span>
                                    <p>Daftar semua boks jaringan (ODC induk dan ODP di tiang dekat rumah pelanggan) beserta lokasi, kapasitas port, dan hunian (mis. 5/8).</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat mau tahu 'ODP di dusun X masih muat berapa pelanggan lagi?' sebelum menjanjikan pemasangan baru, atau memperbaiki data aset yang salah ketik.</p>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Halaman ini ADMIN saja. Teknisi sengaja tidak diberi akses tulis di web — mereka memetakan dari WhatsApp dengan <code class="kbd">#ODC &lt;nama&gt;</code> / <code class="kbd">#ODP &lt;nama&gt;</code> (share lokasi) dan <code class="kbd">#JALUR &lt;ODP&gt;</code>. (2) Jangan mengisi angka port manual: jumlah port terpakai DITURUNKAN dari data (ODP = jumlah pelanggan tersambung, ODC = jumlah ODP anak) dan dihitung ulang tiap perubahan. (3) Kapasitas 0 berarti tidak dibatasi, bukan penuh.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Peta Jaringan — semua pelanggan, ODC/ODP, dan jalur kabel</h3>
                                    <span class="where">/map-viewer</span>
                                    <p>Peta visual: titik rumah pelanggan (hijau online / merah offline), boks ODC-ODP dengan lencana hunian, dan garis kabel yang mengikuti jalan bila jalurnya sudah direkam.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat menerima laporan gangguan dan mau melihat polanya secara geografis ('3 dari 4 pelanggan di ODP ini mati' = curiga boks/kabel), atau saat merencanakan penarikan kabel baru.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /map-viewer.</li>
                                            <li>Pakai Quick Filter (Semua / Online / Offline / Aset / Pelanggan) atau centang legenda per kategori.</li>
                                            <li>Klik ikon ODP: popup menampilkan vonis, daftar nama, panjang jalur kabel terekam, dan tombol 'Beri tahu N pelanggan ODP ini'.</li>
                                            <li>Tombol broadcast itu SENGAJA berhenti di layar tulis pesan — tidak langsung mengirim.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Garis kabel PUTUS-PUTUS artinya jalurnya belum pernah dipetakan (bot hanya menarik garis lurus sebagai tebakan) — jangan dipakai menghitung kebutuhan kabel. (2) Cincin merah berdenyut di ODP = mayoritas penghuni offline (≥50% dari yang terbaca, minimal 2 pelanggan); 1 dari 1 mati bukan pola. (3) 'Tidak terbaca' ≠ 'mati' DAN ≠ 'sehat': bila daftar sesi PPPoE gagal dibaca, statusnya tidak dihitung offline.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Rapikan ODP — sambungkan pelanggan lama ke ODP terdekat</h3>
                                    <span class="where">/rapikan-odp</span>
                                    <p>Bot mengusulkan ODP terdekat yang masih punya sisa port untuk tiap pelanggan yang belum tersambung; admin yang memutuskan, per baris atau borongan.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Kerja bakti data: sesudah ODP-ODP baru dipetakan teknisi, tautkan pelanggan lama yang datanya belum lengkap.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /rapikan-odp.</li>
                                            <li>Tab 1 'punya titik GPS': atur radius (150 m / 250 m / dst), lihat usulan ODP terdekat per pelanggan.</li>
                                            <li>Terima satu per satu, atau tekan 'Terapkan semua yang &lt; 50 m'.</li>
                                            <li>Tab 2 'Tanpa GPS': cari pelanggan by nama/HP lalu pilih ODP manual — ODP yang PENUH tidak bisa dipilih.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Jarak garis lurus itu TEBAKAN — kabel drop bisa ditarik ke ODP lain; karena itu tidak ada penetapan otomatis diam-diam, dan borongan dibatasi usulan &lt; 50 m. (2) Pelanggan TANPA titik GPS tidak akan pernah muncul di tab usulan — mereka ada di tab kedua. (3) Kalau angka 'tanpa GPS' mencurigakan-nol, curigai bug lama yang membaca pelanggan tanpa koordinat sebagai 'punya GPS di titik (0,0)'.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Petakan ODC / ODP / jalur kabel dari lapangan (WhatsApp)</h3>
                                    <span class="where">#ODC &lt;nama&gt;  |  #ODP &lt;nama&gt;  |  #ISI &lt;nama ODP&gt;  |  #JALUR &lt;nama ODP&gt;  |  #LOKASI &lt;nama/HP&gt;  |  odp &lt;nama&gt;  |  bantuan aset</span>
                                    <p>Semua perintah pemetaan yang dipakai teknisi dari lapangan: mendaftarkan boks, mengisi penghuni ODP, merekam belokan kabel, menyimpan titik rumah pelanggan, dan mengecek isi sebuah ODP.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat teknisi berdiri di depan boks atau menyusuri jalur kabel.</p>
                                    <details class="qa">
                                        <summary>Langkah (5)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li><code class="kbd">#ODP Balen 1</code> → ikuti checklist (share lokasi, kapasitas port, foto opsional) → balas <b>YA</b> untuk simpan.</li>
                                            <li><code class="kbd">#ISI Balen 1</code> → balas nama ATAU nomor HP pelanggan yang tersambung, satu per satu.</li>
                                            <li><code class="kbd">#JALUR Balen 1</code> → share lokasi di SETIAP belokan → ketik <code class="kbd">selesai</code>.</li>
                                            <li><code class="kbd">odp Balen 1</code> (tanpa #) → lihat hunian: terpakai berapa dari berapa port, siapa saja, plus link peta.</li>
                                            <li><code class="kbd">bantuan aset</code> → kartu berisi semua perintah + papan progres pemetaan.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> Nama ODP/ODC yang SUDAH ADA = mode EDIT, bukan duplikat (duplikat = peta yang berbohong). Tanda <code class="kbd">#</code> WAJIB supaya kata 'odp' dalam kalimat biasa tidak membuka wizard. <code class="kbd">#ISI</code> dan <code class="kbd">#JALUR</code> menolak bila ODP-nya belum ada / belum punya induk ODC bertitik. Jalur yang sudah ada tidak ditimpa diam-diam — bot bertanya dulu. Kata <code class="kbd">selesai</code> harus berdiri sendiri. Perintah <code class="kbd">odp &lt;nama&gt;</code> tanpa <code class="kbd">#</code> sengaja DIDIAMKAN untuk nomor non-staf supaya kalimat pelanggan 'odp saya mati' tidak dijawab pesan petugas.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Monitor OLT — lihat kondisi modem semua pelanggan</h3>
                                    <span class="where">/admin-olt (teknisi: /teknisi-olt)</span>
                                    <p>Satu layar berisi status ONT tiap pelanggan: hidup/mati, redaman (kekuatan sinyal cahaya), LOS (kabel putus), dan dying-gasp (mati listrik).</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat pelanggan mengeluh internet mati dan admin mau tahu ini masalah kabel/modem pelanggan atau bukan; juga saat mau cek apakah gangguan cuma 1 orang atau serentak banyak.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /admin-olt — daftar ONU + anotasi pelanggan tampil.</li>
                                            <li>Nyalakan sakelar Auto kalau mau layar menyegarkan sendiri, atau tekan Refresh.</li>
                                            <li>Klik baris pelanggan untuk detail; ada tombol refresh per-pelanggan.</li>
                                            <li>Untuk mendaftar ONU baru, lompat ke tombol Provisioning.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) OLT yang TIDAK MENJAWAB tidak sama dengan pelanggan mati — baris seperti itu diberi lencana '?' dan TIDAK dihitung offline; jangan menyimpulkan gangguan massal dari layar penuh tanda tanya. (2) Angka redaman ONU yang statusnya bukan Online tampil redup berlabel '(terakhir)' — itu foto lama, bukan kondisi sekarang. (3) Data di-cache dengan batas umur keras 5 menit; label waktu memakai umur data dari server.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Provisioning OLT — daftarkan modem baru ke OLT (ZTE C320)</h3>
                                    <span class="where">/admin-olt-provision</span>
                                    <p>Mendaftarkan ONU/modem pelanggan langsung ke OLT lewat SSH: scan modem yang belum terdaftar, pilih tipe modem, lihat dulu skripnya, baru eksekusi + verifikasi. Termasuk backup konfigurasi OLT.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Pemasangan baru atau ganti modem ketika modem sudah terpasang di lapangan tapi belum dikenali OLT.</p>
                                    <details class="qa">
                                        <summary>Langkah (5)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka tab 'Registrasi ONU', pilih jenis pekerjaan: Pasang Baru / Ganti Modem / Kelola ONU.</li>
                                            <li>Scan modem belum terdaftar.</li>
                                            <li>Pilih tipe modem.</li>
                                            <li>Tekan 'Daftar &amp; Push ke OLT' — modal Pratinjau muncul lebih dulu berisi skrip yang akan dikirim.</li>
                                            <li>Konfirmasi; hasil per-perintah + verifikasi ditampilkan di modal Hasil Eksekusi.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Halaman ini MENULIS konfigurasi ke OLT — pratinjau WAJIB sebelum eksekusi. (2) Mengubah service-port pelanggan yang AKTIF bisa memutus layanannya. (3) Halaman ini khusus OLT merek ZTE C320 — kalau OLT Anda merek lain, tab ini akan terasa kosong. (4) Identifier ditolak bila memuat karakter aneh (pengaman anti-injeksi perintah).</span></div>
                                </div>
                                <div class="card">
                                    <h3>Log Gangguan OLT — riwayat kejadian LOS / mati listrik / pulih</h3>
                                    <span class="where">/olt-log (teknisi: /teknisi-olt-log)</span>
                                    <p>Buku catatan permanen setiap kejadian di OLT: kabel putus (LOS), modem mati listrik (Dying-Gasp), dan modem pulih — lengkap dengan nama pelanggan dan berapa lama padamnya.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Sesudah insiden, untuk membuktikan 'jam berapa persisnya putus, siapa saja yang kena, berapa lama'. Juga untuk menelusuri pelanggan yang sering kedip-kedip.</p>
                                    <details class="qa">
                                        <summary>Langkah (3)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /olt-log.</li>
                                            <li>Isi penyaring: cari nama/PPPoE/HP/MAC, pilih Tipe (LOS fiber / Dying-Gasp / Pulih), rentang tanggal.</li>
                                            <li>Tekan Terapkan.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) LOS ≠ Dying-Gasp dan penanganannya berlawanan: LOS = dugaan fiber putus (panggil teknisi), Dying-Gasp = mati listrik (tunggu PLN). (2) Kalau nama OLT tampil kosong/aneh, periksa daftar perangkat OLT di konfigurasi — bukan datanya. (3) Log ini durabel dan dedup ber-STATE, jadi satu insiden panjang tidak muncul berulang — jangan menghitung jumlah baris sebagai jumlah kejadian mentah.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Monitor Infrastruktur — pantau modem CCTV/monitoring milik sendiri</h3>
                                    <span class="where">/infra-monitor</span>
                                    <p>Layar terpisah untuk modem yang BUKAN pelanggan (titik CCTV, titik monitoring) — status online/offline/LOS + redaman.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat mengecek apakah titik infrastruktur sendiri masih hidup, tanpa mengaduk daftar pelanggan.</p>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Hanya menampilkan akun yang DITANDAI sebagai infrastruktur; kosong berarti belum ada yang ditandai, bukan tidak ada perangkatnya. (2) Akun infrastruktur sengaja disembunyikan dari Data Pelanggan dan kebal tagihan/isolir — jangan mencari mereka di halaman billing. (3) Penyaringan dilakukan di sisi tampilan atas hasil OLT, jadi keterbatasan kejujuran data OLT berlaku sama di sini.</span></div>
                                </div>
                            </div>
                        </section>

                        <!-- ============ MONITORING GANGGUAN & PEMBERITAHUAN OTOMATIS ============ -->
                        <section class="flow f-admin" id="monitoring-gangguan-pemberitahuan-otomat">
                            <h2>Monitoring gangguan &amp; pemberitahuan otomatis</h2>
                            <p class="flow-sub">Semua fitur di kelompok ini bisa mengirim WhatsApp ke pelanggan asli. Aturan emasnya: pakai Dry Run / pratinjau dulu, dan jangan mematikan gerbang gangguan massal — gerbang itu ada karena satu kabel putus pernah memicu puluhan pesan pribadi.</p>
                            <div class="grid">
                                <div class="card">
                                    <h3>Auto Outage — bot menyapa pelanggan yang PPPoE-nya lama mati</h3>
                                    <span class="where">/auto-outage</span>
                                    <p>Mendeteksi pelanggan yang sesi PPPoE-nya offline melewati ambang (mis. 3 jam) lalu mengirim WA menanyakan apakah ada kendala, sekaligus menawarkan pembuatan tiket.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Dinyalakan sebagai penjaring rutin supaya gangguan diam (pelanggan tidak lapor) tetap ketahuan; halaman dibuka saat mau mengubah aturan, uji coba, atau melihat siapa saja yang sedang offline.</p>
                                    <details class="qa">
                                        <summary>Langkah (6)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /auto-outage, isi Rule Deteksi: Router ID, Offline Minimal (jam), Scan Interval, Cooldown Broadcast, Maks Broadcast/Insiden, Target + Filter Target.</li>
                                            <li>Tulis Pesan Awal Custom dan Opsi Jawaban (mis. 1 Aman / 2 Ada kendala).</li>
                                            <li>Simpan Rule.</li>
                                            <li>Tekan 'Scan PPPoE', lalu 'Dry Run' untuk melihat SIAPA saja yang akan dikirimi TANPA mengirim.</li>
                                            <li>Kalau daftarnya benar, baru tekan 'Broadcast Eligible'.</li>
                                            <li>Pantau tabel State Pelanggan dan Scan Logs.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) GERBANG GANGGUAN MASSAL: bila jumlah calon penerima melewati ambang (bawaan 5), daftarnya DIKOSONGKAN — ini juga berlaku untuk tombol Broadcast manual, justru karena saat kabel putus godaan menekan tombol itu paling besar. Bisa dipaksa, tapi harus sengaja. Gerbang ini bawaan AKTIF; mematikannya = mengembalikan perilaku rusak. (2) Gerbang mengukur UKURAN BATCH, bukan jumlah offline. (3) Scan hanya mencocokkan pelanggan yang punya username PPPoE di data; tanpa itu tak akan pernah terdeteksi. (4) Selalu Dry Run dulu — ini jalur yang MENGIRIM WA ke pelanggan asli.</span></div>
                                </div>
                                <div class="card">
                                    <h3>LOS Broadcast — alarm otomatis 'fiber putus' ke teknisi</h3>
                                    <span class="where">/los-broadcast</span>
                                    <p>Mengatur dan memantau alarm otomatis: begitu OLT melaporkan LOS, bot memberi tahu teknisi/grup, membuat tiket, lalu menutup alarmnya sendiri saat ONU pulih.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Sekali saat setup (pilih grup WA, jendela konfirmasi, ambang klaster, prioritas tiket), lalu dibuka lagi untuk melihat daftar insiden LOS.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /los-broadcast.</li>
                                            <li>Isi form Config; grup WA dipilih dari daftar grup tempat bot menjadi anggota.</li>
                                            <li>Simpan — nilainya masuk ke konfigurasi dan dimuat ulang.</li>
                                            <li>Pantau kartu runtime-state dan tabel Insiden LOS.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Dying-Gasp TIDAK memicu alarm ini — DG = mati listrik, bukan tugas teknisi. Ada gerbang mati-listrik-area: LOS yang dikelilingi klaster dying-gasp tetangga dibuang. (2) Ada jendela konfirmasi: LOS yang pulih sendiri dalam N menit dianggap kedip dan dibatalkan — jadi alarm memang sengaja terlambat beberapa menit. (3) Nilai dari form di-batasi ke rentang aman supaya tidak bisa menyetel window 0. (4) Timer pending ada di memori; restart di tengah jendela membuat pending hilang, tapi insidennya tetap tercatat. (5) Fitur ini bawaan MATI.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Monitor CCTV — kabari pelanggan otomatis saat CCTV publik mati</h3>
                                    <span class="where">/cctv-monitor</span>
                                    <p>Memantau CCTV publik lewat netwatch MikroTik; kalau mati lebih dari sekian menit, bot broadcast WA ke pelanggan/koordinator, dan mengabari lagi saat pulih.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Dipakai warga/RT yang menitipkan CCTV; dibuka admin saat menambah CCTV baru, mengadopsi host yang sudah terdaftar di netwatch, atau mengecek riwayat padam.</p>
                                    <details class="qa">
                                        <summary>Langkah (5)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Tab 'Daftar CCTV': tambah/ubah perangkat + KPI + status + tombol Tes.</li>
                                            <li>Tab 'Ditemukan di Netwatch': discovery read-only, bisa adopsi massal.</li>
                                            <li>Tab 'Koordinator': daftar penanggung jawab per area.</li>
                                            <li>Tab 'Pengaturan': sakelar aktif, jendela konfirmasi, cooldown, jam tenang, template WA &amp; Telegram, guard gangguan massal.</li>
                                            <li>Tab 'Riwayat': daftar insiden.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) GERBANG SADAR-MODEM: bila OLT mencatat kluster mati listrik (bawaan ≥3 modem) di sekitar waktu CCTV turun, broadcast ke pelanggan DITAHAN — itu mati listrik area, bukan CCTV rusak; admin dapat 1 ringkasan. Gerbang ini gagal-terbuka: bila OLT tak terbaca, kiriman tetap jalan. (2) Siklus pertama sesudah start hanya menyimpan kondisi awal, tidak broadcast. (3) Status 'unknown' diabaikan; hanya transisi hidup→mati yang masuk antrean. (4) Satu insiden = satu broadcast; mati lagi dalam 30 menit diabaikan. (5) Fitur ini bawaan MATI.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Kualitas Jalur Upstream — rapor tiap ISP</h3>
                                    <span class="where">/upstream-quality</span>
                                    <p>Kartu status + grafik packet loss, RTT, dan throughput per jalur ISP, ditambah cek reachability layanan populer per jalur, rapor 7 hari, dan daftar insiden.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat banyak pelanggan mengeluh 'internet berat' bersamaan dan admin perlu bukti jalur ISP mana yang sedang sakit sebelum menyalahkan jaringan sendiri.</p>
                                    <details class="qa">
                                        <summary>Langkah (3)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /upstream-quality, lihat kartu status per jalur; tombol 'Poll sekarang' untuk memaksa pengukuran.</li>
                                            <li>Kartu 'Switch Koneksi' untuk mengalihkan trafik antar-ISP (ini MENULIS ke router).</li>
                                            <li>Panel 'Pengaturan Arah &amp; Jalur' untuk mengubah target ping, layanan yang dipantau, label/kapasitas jalur, dan ambang vonis — semuanya berlaku langsung tanpa restart.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Fitur menyala TIDAK berarti upstream sehat: bila IP pelanggan tak terpetakan ke jalur mana pun, statusnya jadi 'tidak diketahui'. Ambil kesimpulan dari bukti, bukan dari sakelar. (2) Switch Koneksi hanya boleh menjalankan switch yang TERDAFTAR di konfigurasi, dan tiap penerapan diverifikasi dulu; kalau rutenya tak ditemukan, penerapan dibatalkan. (3) Peta 'jalur → pelanggan terdampak' versi statis pernah meleset 46% dari kondisi live — pakai angka live. (4) Fitur ini bawaan MATI.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Steering Pelanggan — arahkan pelanggan ke jalur ISP tertentu</h3>
                                    <span class="where">/steering-pelanggan</span>
                                    <p>Melihat tiap pelanggan online lewat ISP mana, lalu memindahkan satu pelanggan atau satu segmen ke jalur lain.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat satu ISP sakit dan admin mau memindahkan sebagian pelanggan ke jalur cadangan, atau saat mengecek keluhan 'cuma saya yang lemot'.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /steering-pelanggan.</li>
                                            <li>Kartu 'Oper Segmen': pilih pool + jalur tujuan, lihat PRATINJAU dulu, baru konfirmasi.</li>
                                            <li>Tabel 'Pelanggan Online × Jalur ISP': aksi arahkan per-pelanggan.</li>
                                            <li>Kartu 'Entri Pool' untuk mengelola daftar segmen.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Kalau muncul spanduk kuning bahwa aturan override di router belum lengkap, steering per-pelanggan BELUM berfungsi sama sekali — pasang dulu (idempoten, tidak mengubah trafik). (2) Dua gerbang berbeda: Oper Segmen jalan tanpa fitur steering per-pelanggan aktif, tetapi aksi per-pelanggan dan pengelolaan pool tetap membutuhkannya (bawaan MATI). (3) Jalur ISP dibaca LIVE dari router — kalau angka berbeda dengan dugaan, routernya yang benar. (4) Profil QoS yang sudah mapan jangan dibongkar sambil lalu.</span></div>
                                </div>
                            </div>
                        </section>

                        <!-- ============ PERANGKAT PELANGGAN (MODEM / GENIEACS) ============ -->
                        <section class="flow f-admin" id="perangkat-pelanggan-modem-genieacs">
                            <h2>Perangkat pelanggan (modem / GenieACS)</h2>
                            <p class="flow-sub">Empat halaman ini menjaga agar bot menunjuk modem yang benar dan membaca nilai yang benar. Sebagian besar keluhan 'ganti sandi WiFi tidak berubah' berakar di sini, bukan di modemnya.</p>
                            <div class="grid">
                                <div class="card">
                                    <h3>Sinkronisasi Device ID — cocokkan pelanggan dengan modemnya</h3>
                                    <span class="where">/sync-device-id</span>
                                    <p>Membandingkan modem yang tercatat di sistem dengan modem yang terlihat di GenieACS berdasarkan username PPPoE, lalu memperbaiki yang tidak cocok secara massal.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Sesudah ganti modem pelanggan, sesudah import massal, atau saat fitur 'cek WiFi'/'ganti sandi' gagal karena bot menunjuk modem yang salah.</p>
                                    <details class="qa">
                                        <summary>Langkah (3)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /sync-device-id — tekan scan.</li>
                                            <li>Periksa daftar selisih (sistem vs GenieACS).</li>
                                            <li>Centang pelanggan yang mau diperbaiki, jalankan sinkronisasi.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Sinkronisasi ini SEKALIAN memperbaiki daftar SSID yang boleh dikelola pelanggan bila modem barunya dual-band — perubahan itu memang disengaja, jangan kaget. (2) Kalau pembacaan kemampuan modem gagal, penyesuaian itu DILEWATI dengan peringatan; jalankan halaman Penyesuaian Bulk SSID sesudahnya. (3) Query dibatasi 1000 perangkat dengan batas waktu 30 detik.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Penyesuaian Bulk SSID — samakan daftar WiFi yang boleh diubah pelanggan</h3>
                                    <span class="where">/penyesuaian-bulk</span>
                                    <p>Mencari pelanggan yang daftar SSID-nya tidak cocok dengan kemampuan band modemnya (mis. modem dual-band tapi hanya SSID 1 yang dikelola), lalu memperbaikinya massal.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat pelanggan mengeluh 'sudah ganti sandi WiFi tapi yang 5GHz masih pakai sandi lama', atau kerja bakti sesudah banyak penggantian modem.</p>
                                    <details class="qa">
                                        <summary>Langkah (3)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /penyesuaian-bulk, tekan 'Scan Perbedaan'.</li>
                                            <li>Periksa daftar: modem dual-band seharusnya mengelola SSID 1 dan 5; single-band hanya 1.</li>
                                            <li>Pilih pelanggan yang mau dikoreksi lalu terapkan.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Deteksi dual-band memakai pola Huawei (indeks 1 = 2.4GHz, indeks 5 = 5GHz); modem merek lain dengan penomoran berbeda bisa salah dinilai. (2) Kalau GenieACS sedang tak terjangkau, hasil scan tidak bisa dipercaya. (3) Jangan mengoreksi daftar SSID manual di halaman pelanggan lalu berharap konsisten — halaman ini pemiliknya. (4) Perhatikan: URL-nya /penyesuaian-bulk meski nama berkasnya berbeda.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Parameter Management — ajari bot di mana letak data di modem</h3>
                                    <span class="where">/parameter-management</span>
                                    <p>Mengatur 'alamat' tempat bot mengambil nilai dari modem: redaman, suhu, tipe modem, serial number. Ada juga alat tes untuk mencoba satu alamat di satu perangkat.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat modem merek/model baru masuk dan bot menampilkan redaman/suhu kosong.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /parameter-management.</li>
                                            <li>Tambah Parameter: pilih Tipe (Redaman / Temperature / Modem Type / Serial Number), isi Nama, Deskripsi, dan satu atau beberapa alamat.</li>
                                            <li>Simpan.</li>
                                            <li>Uji dengan kotak tes: masukkan Device ID + alamat, lihat nilai yang keluar sebelum dipercaya.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) BEGITU sebuah tipe punya entri tersimpan, alamat bawaan TIDAK dipakai lagi sama sekali. Menyimpan satu alamat yang salah = mematikan seluruh pembacaan tipe itu. (2) Untuk alamat ber-INDEKS (SSID/sandi WiFi/daya pancar) WAJIB memakai penanda {index}, bukan angka 1 literal — alamat literal membuat perubahan hanya kena SSID 2.4GHz dan yang 5GHz diam-diam tidak ikut berubah. (3) Waktu registrasi modem dibaca dari field khusus, bukan dari daftar event — ini akar keluhan 'modem baru tak terdeteksi'.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Speed Boost Config — atur harga &amp; aturan paket kebut sementara</h3>
                                    <span class="where">/speed-boost-config</span>
                                    <p>Mengatur fitur Speed Boost: sakelar aktif/nonaktif, boleh-tidaknya boost bertumpuk, matriks harga, paket kustom, metode pembayaran, dan template pesannya.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat menaikkan/menurunkan harga boost, menambah durasi baru, atau mematikan fitur sementara.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /speed-boost-config.</li>
                                            <li>Tab 'Pengaturan Umum': Status Speed Boost, Multiple Boost, dst.</li>
                                            <li>Tab 'Pricing Matrix', 'Custom Packages', 'Metode Pembayaran', 'Template Pesan'.</li>
                                            <li>Tekan 'Simpan Konfigurasi'.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Isi tab 'Template Pesan' adalah teks yang benar-benar sampai ke pelanggan — template tersimpan MENGALAHKAN teks bawaan di kode. (2) Speed Boost punya cron pengembalian; mengubah durasi/harga tidak membatalkan boost yang sedang berjalan. (3) Halaman ini terpisah dari halaman permintaan pelanggan di /speed-requests — jangan tertukar.</span></div>
                                </div>
                            </div>
                        </section>

                        <!-- ============ TIKET GANGGUAN & PEKERJAAN TEKNISI DI LAPANGAN ============ -->
                        <section class="flow f-admin" id="tiket-gangguan-pekerjaan-teknisi-di-lapa">
                            <h2>Tiket gangguan &amp; pekerjaan teknisi di lapangan</h2>
                            <p class="flow-sub">Tiket adalah papan kerja harian. Perlu diingat: tiket tidak bisa dihapus (hanya dibatalkan), dan alur lapangan teknisi berjalan lewat WhatsApp dengan langkah berurutan yang dilindungi dari gangguan perintah lain.</p>
                            <div class="grid">
                                <div class="card">
                                    <h3>Ticket Management — kelola tiket keluhan pelanggan</h3>
                                    <span class="where">/admin/daftar-tiket</span>
                                    <p>Daftar semua tiket gangguan beserta status perjalanannya (Baru → Process → OTW → Sampai → Dikerjakan → Selesai), info teknisi, dan dokumentasi foto. Bisa membuat tiket manual dan membatalkan tiket.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Setiap hari sebagai papan kerja gangguan: melihat tiket menggantung, membuat tiket dari laporan telepon, membatalkan tiket yang salah/ganda.</p>
                                    <details class="qa">
                                        <summary>Langkah (5)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /admin/daftar-tiket.</li>
                                            <li>Saring: ID Tiket, Status, Nama PPPoE, Tgl Lapor Dari/Sampai — lalu tekan cari.</li>
                                            <li>Klik tiket untuk melihat Informasi Tiket / Informasi Teknisi / Dokumentasi Foto.</li>
                                            <li>'Buat Tiket' untuk laporan lewat telepon, atau batalkan tiket yang salah.</li>
                                            <li>'Cleanup Orphaned Photos' untuk membuang foto milik tiket yang sudah tidak ada.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) TIDAK ADA tombol HAPUS tiket — hanya batal. Membersihkan total butuh tindakan teknis di server, bukan lewat panel. (2) Status 'dibatalkan admin' berbeda dengan 'dibatalkan pelanggan' — jangan digabung saat merekap. (3) Tiket bisa lahir otomatis dari LOS terkonfirmasi; membatalkan manual tiket LOS yang gangguannya belum selesai akan membuatnya muncul lagi. (4) Path foto punya dua bentuk — jangan menyimpulkan foto hilang hanya karena satu pola tidak cocok.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Alur tiket teknisi di WhatsApp</h3>
                                    <span class="where">list tiket → proses &lt;ID&gt; → otw &lt;ID&gt; → sampai &lt;ID&gt; → verifikasi &lt;ID&gt; &lt;OTP&gt; → (min. 2 foto) → done → (catatan) → selesai &lt;ID&gt;</span>
                                    <p>Rangkaian langkah teknisi dari memilih pekerjaan sampai menutup tiket, termasuk OTP dari pelanggan dan dokumentasi foto.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Setiap perbaikan lapangan.</p>
                                    <details class="qa">
                                        <summary>Langkah (6)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li><code class="kbd">list tiket</code> — daftar tiket berstatus baru, prioritas tinggi dulu.</li>
                                            <li><code class="kbd">proses &lt;ID&gt;</code> — menandai tiket dikerjakan oleh Anda.</li>
                                            <li><code class="kbd">otw &lt;ID&gt;</code> lalu share lokasi — perjalanan tercatat.</li>
                                            <li><code class="kbd">sampai &lt;ID&gt;</code> — pelanggan menerima OTP.</li>
                                            <li><code class="kbd">verifikasi &lt;ID&gt; &lt;OTP&gt;</code> — masukkan kode dari pelanggan.</li>
                                            <li>Kirim minimal 2 foto dokumentasi, ketik <code class="kbd">done</code>, tulis catatan (min. 10 karakter), lalu <code class="kbd">selesai &lt;ID&gt;</code>.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> Semua langkah butuh akun teknisi/owner. <code class="kbd">list tiket</code> hanya menampilkan status 'baru'. Selama alur ini state TERLINDUNGI — mengetik <code class="kbd">menu</code> tidak akan menjatuhkan tiket di tengah jalan. CATATAN: pada versi kode saat ini kata <code class="kbd">verifikasi</code> belum terdaftar di katalog kata kunci, sehingga perintah itu bisa tidak berbalas; verifikasi lewat panel web tetap tersedia. Jalur alternatif menutup tiket: <code class="kbd">tiketdone &lt;ID&gt;</code> (batas unggah foto 10 menit).</span></div>
                                </div>
                                <div class="card">
                                    <h3>Jam Kerja Teknisi (janji waktu respons ke pelanggan)</h3>
                                    <span class="where">/teknisi-working-hours</span>
                                    <p>Mengatur jam operasional per hari, hari libur, dan kalimat estimasi waktu respons yang dijanjikan bot ke pelanggan saat mereka lapor gangguan.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat mau berhenti menjanjikan '2-4 jam' di tengah malam, menambah tanggal libur, atau mengubah estimasi waktu pemasangan PSB.</p>
                                    <details class="qa">
                                        <summary>Langkah (5)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /teknisi-working-hours — kartu atas menunjukkan status saat ini.</li>
                                            <li>Nyalakan sakelar 'Aktifkan Jam Kerja'.</li>
                                            <li>Atur per hari Senin–Minggu: centang hari aktif + jam mulai/selesai.</li>
                                            <li>Isi kalimat estimasi untuk tiap kondisi (prioritas tinggi dalam/luar jam kerja, prioritas sedang, hari libur, estimasi PSB).</li>
                                            <li>Simpan — langsung berlaku tanpa restart.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Fitur ini TIDAK memblokir apa pun — tiket tetap masuk 24 jam; yang berubah hanya KALIMAT estimasi di pesan ke pelanggan. 2) Bila sakelar dimatikan, sistem menjawab 'Layanan 24/7' dengan estimasi bawaan. 3) Menyimpan MENGGANTI seluruh blok pengaturan jam kerja (bukan menambal per-kolom), jadi isi semua kolom sebelum simpan. 4) Halaman bertema teknisi tapi aksesnya admin-only.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Bot Teknisi Telegram (whitelist &amp; status)</h3>
                                    <span class="where">/telegram-teknisi</span>
                                    <p>Menyalakan bot Telegram read-only untuk teknisi (cek redaman modem+OLT, koneksi PPPoE, status modem/OLT) dan mengatur siapa saja yang boleh memakainya.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat menambah teknisi baru yang perlu cek redaman dari lapangan, atau saat bot Telegram tiba-tiba diam.</p>
                                    <details class="qa">
                                        <summary>Langkah (6)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /telegram-teknisi dan periksa 4 kartu: Status Bot, Token, Teknisi Terdaftar, Poll Terakhir.</li>
                                            <li>Di 'Konfigurasi Bot': set Status = Aktif, tempel Bot Token (kosongkan bila tak ingin mengganti token lama), atur Poll Timeout.</li>
                                            <li>Klik Simpan &amp; Restart Bot.</li>
                                            <li>Minta teknisi mengirim pesan apa saja ke bot; bot membalas dengan chat_id miliknya.</li>
                                            <li>Masukkan chat_id itu di 'Whitelist Teknisi' + nama, klik Tambah.</li>
                                            <li>Nonaktifkan/hapus baris whitelist saat teknisi keluar.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Token bot Telegram teknisi WAJIB berbeda dari token bot backup database — token sama membuat keduanya saling merebut pesan dan salah satu mati. 2) Bot hanya melayani chat_id yang ada di whitelist; teknisi yang belum didaftarkan akan merasa 'botnya rusak'. 3) Menyimpan konfigurasi me-restart bot — lakukan saat sepi.</span></div>
                                </div>
                            </div>
                        </section>

                        <!-- ============ SDM: GAJI TEKNISI, KASBON, KOMISI ============ -->
                        <section class="flow f-admin" id="sdm-gaji-teknisi-kasbon-komisi">
                            <h2>SDM: gaji teknisi, kasbon, komisi</h2>
                            <p class="flow-sub">Payroll berjalan tiga tahap: draft → finalisasi → bayar. Angka baru terkunci setelah finalisasi, dan komisi hanya ikut terbayar bila ada baris payroll untuk periode yang sama.</p>
                            <div class="grid">
                                <div class="card">
                                    <h3>Gaji Teknisi (payroll: draft → finalisasi → bayar)</h3>
                                    <span class="where">/gaji-teknisi</span>
                                    <p>Menghitung dan membayar gaji teknisi per bulan lengkap dengan komisi penarikan, komisi marketing, dan potongan kasbon — plus mengirim struk gaji ke WhatsApp teknisi.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Setiap tanggal gajian, atau saat teknisi bertanya 'potongan kasbon saya berapa'.</p>
                                    <details class="qa">
                                        <summary>Langkah (7)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /gaji-teknisi, pilih Bulan &amp; Tahun.</li>
                                            <li>Klik 'Buat Draft Payroll', pilih teknisi — gaji pokok terisi otomatis dari payroll bulan sebelumnya; komisi penarikan &amp; marketing periode itu ikut ditarik; potongan kasbon muncul dari saldo kasbon aktif.</li>
                                            <li>Periksa/ubah angkanya selagi status masih 'draft'.</li>
                                            <li>Klik Finalisasi — angka terkunci. Salah? pakai 'Batal Finalisasi'.</li>
                                            <li>Klik Bayar — payroll tercatat lunas, struk dikirim ke WhatsApp teknisi, grup kas menerima kabar.</li>
                                            <li>Kartu 'Gaji Pokok Tetap': isi nominal sekali per teknisi dan nyalakan draft otomatis bila mau.</li>
                                            <li>Bila ada 'Komisi Tertunda' di periode lain: bayar lewat payroll periode tersebut, atau tutup lewat menu tutup komisi bila uangnya sudah diserahkan di luar sistem.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Finalisasi dua kali kini ditolak — dulu klik ganda MENGOSONGKAN komisi teknisi secara permanen; jangan 'coba klik lagi' kalau layar terasa lambat. 2) Struk hanya terkirim bila akun teknisi punya nomor telepon di /accounts; bila kosong, pembayaran TETAP tercatat tapi teknisi tak menerima rincian apa pun — pesan grup kas akan menyebut struk belum terkirim. Kirim ulang dengan tombol kirim-ulang-struk. 3) Komisi hanya ikut terbayar bila ADA baris payroll untuk periode yang sama; periode yang tak pernah dibuatkan payroll menyimpan uang teknisi tanpa terlihat — itulah daftar 'Komisi Tertunda' (di produksi pernah satu teknisi Rp1,35jt tersebar di 6 periode). 4) 'Tutup komisi historis' BUKAN pembayaran — tak ada rupiah berpindah dan tak ada struk dikirim. 5) Otomatisasi gaji pokok berhenti di DRAFT; finalisasi &amp; pembayaran selalu klik manusia.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Kasbon Teknisi (kelola pengajuan hutang teknisi)</h3>
                                    <span class="where">/admin-kasbon</span>
                                    <p>Menyetujui atau menolak pengajuan kasbon teknisi, dan menandai kasbon lunas bila dibayar di luar potongan gaji.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat teknisi mengajukan kasbon dan menunggu keputusan Anda.</p>
                                    <details class="qa">
                                        <summary>Langkah (5)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /admin-kasbon — daftar pengajuan dengan status pending/disetujui/ditolak.</li>
                                            <li>Buka pengajuan, isi catatan, lalu Setujui atau Tolak.</li>
                                            <li>Teknisi otomatis menerima pesan WhatsApp berisi keputusan + nominal + catatan Anda.</li>
                                            <li>Kasbon yang disetujui dipotong otomatis saat draft payroll dibuat.</li>
                                            <li>Bila teknisi melunasi tunai di luar gaji, buka kasbonnya dan klik Tandai Lunas.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Keputusan hanya bisa diambil sekali: kasbon yang statusnya sudah bukan 'pending' ditolak. 2) Kabar ke teknisi tidak pernah menggagalkan proses — bila akun teknisi tak punya nomor telepon, keputusan tetap tercatat tapi teknisi tak pernah diberi tahu, dan potongan di struk gaji datang sebagai kejutan. 3) Pengajuan boleh dibuat staf mana pun, tetapi persetujuan dan penandaan lunas khusus admin.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Cek gaji &amp; komisi sendiri (teknisi)</h3>
                                    <span class="where">gaji saya</span>
                                    <p>Ringkasan payroll bulan berjalan untuk teknisi: gaji pokok, komisi penarikan, komisi marketing PSB, potongan kasbon, dan sisa hutang kasbon.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Teknisi ingin memeriksa angka gajinya sebelum dibayar.</p>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> PENTING: pada versi kode saat ini perintah ini TIDAK DIBALAS — modul penanganannya tidak ikut terpasang di daftar perintah bot, meskipun kata kuncinya ada. Sampai diperbaiki, arahkan teknisi bertanya ke admin atau tunjukkan angkanya dari /gaji-teknisi.</span></div>
                                </div>
                            </div>
                        </section>

                        <!-- ============ AGEN PENAGIH & OUTLET VOUCHER (DUA HAL BERBEDA) ============ -->
                        <section class="flow f-admin" id="agen-penagih-outlet-voucher-dua-hal-berb">
                            <h2>Agen penagih &amp; outlet voucher (dua hal berbeda)</h2>
                            <p class="flow-sub">Ada dua 'agen' yang namanya mirip tapi sama sekali berbeda: agen PENAGIH (akun login untuk menagih tagihan bulanan) dan agent/outlet RESELLER voucher (data terpisah, punya PIN). Jangan tertukar.</p>
                            <div class="grid">
                                <div class="card">
                                    <h3>Penugasan Agen (siapa menagih pelanggan siapa)</h3>
                                    <span class="where">/penugasan-agen</span>
                                    <p>Menentukan pelanggan mana yang boleh ditagih oleh seorang agen penagih.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat merekrut agen baru, membagi wilayah tagihan, atau memindahkan pelanggan dari satu agen ke agen lain.</p>
                                    <details class="qa">
                                        <summary>Langkah (5)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /penugasan-agen.</li>
                                            <li>Pilih Agen dari dropdown (isinya akun ber-role 'agen' dari /accounts).</li>
                                            <li>Centang pelanggan yang mau ditugaskan (maksimal 1000 per sekali kirim).</li>
                                            <li>Klik simpan penugasan.</li>
                                            <li>Untuk melepas penugasan, pilih opsi lepas lalu simpan.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Dropdown agen hanya terisi bila sudah ada akun ber-role 'agen' — buat dulu di /accounts. 2) Hanya pelanggan yang benar-benar ditagih yang bisa ditugaskan; akun infrastruktur dilewati diam-diam dan muncul di daftar 'skipped'. 3) Agen HANYA melihat pelanggan miliknya; pelanggan yang belum ditugaskan tidak akan pernah ditagih siapa pun.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Halaman kerja Agen — Penagihan Pembayaran</h3>
                                    <span class="where">/agen-pembayaran</span>
                                    <p>Layar milik agen penagih untuk melihat pelanggan yang ditugaskan padanya, mengajukan pembayaran yang sudah ditagih, dan melihat fee yang terkumpul.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Dipakai agen setiap hari menagih; dibuka admin saat mau melihat apa yang dilihat agen.</p>
                                    <details class="qa">
                                        <summary>Langkah (5)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Agen login → otomatis diarahkan ke /agen-pembayaran.</li>
                                            <li>Lihat daftar pelanggan yang ditugaskan beserta status bayar &amp; nominal paket.</li>
                                            <li>Setelah menerima uang, ajukan pembayaran dari baris pelanggan tersebut.</li>
                                            <li>Pengajuan masuk antrean dan menunggu persetujuan admin di /pembayaran/otorisasi.</li>
                                            <li>Kartu ringkasan menampilkan fee agen periode berjalan.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Agen hanya MENGAJUKAN; pencatatan resmi (dan fee-nya) baru terjadi setelah admin menyetujui. 2) Fee dikreditkan pada saat pembayaran dinyatakan lunas — kalau sakelar komisi agen baru dinyalakan belakangan, penagihan yang sudah terlanjur diotorisasi TIDAK dihitung ulang. 3) Fee hanya jalan bila komisi agen aktif DAN nominalnya lebih dari 0 di /config. 4) Halaman ini memakai sidebar agen sendiri, bukan menu admin.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Laporan Komisi Agen</h3>
                                    <span class="where">/laporan-agen</span>
                                    <p>Melihat berapa fee yang sudah terkumpul untuk tiap agen penagih pada satu periode, lengkap dengan rincian per pelanggan.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat membayar fee agen di akhir periode atau saat agen mempertanyakan jumlah fee-nya.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /laporan-agen.</li>
                                            <li>Pilih Bulan/Tahun (dan agen tertentu bila perlu).</li>
                                            <li>Baca ringkasan per agen: total kredit, total debit (pembatalan), net, jumlah pelanggan unik yang lunas.</li>
                                            <li>Buka rincian entri untuk melihat pelanggan mana saja yang menghasilkan fee.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Pembayaran pelanggan yang DIBATALKAN menghasilkan entri debit, jadi 'net' bisa lebih kecil dari total kredit — bayar berdasarkan net. 2) Nilai 'komisi per pelanggan' yang ditampilkan diambil dari setelan SAAT INI, sementara entri lama memakai nominal saat transaksi terjadi; jangan mengalikan jumlah pelanggan dengan nominal sekarang. 3) Khusus admin.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Panduan Agen (materi pelatihan agen)</h3>
                                    <span class="where">/agen-tutorial</span>
                                    <p>Halaman panduan siap-baca untuk agen penagih: cara menagih, cara mengajukan pembayaran, dan bagaimana fee dihitung.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat menerima agen baru — kirimkan link ini alih-alih menjelaskan ulang tiap kali.</p>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> Isinya statis; bila aturan fee berubah, teks panduan tidak ikut berubah sendiri.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Agent &amp; Outlet (reseller voucher/topup) — BEDA dari agen penagih</h3>
                                    <span class="where">/agent-management</span>
                                    <p>Mendata outlet/agent reseller beserta PIN transaksinya, yang dipakai untuk topup saldo &amp; penjualan voucher.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat menambah warung/outlet mitra penjual voucher, atau saat outlet lupa PIN.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /agent-management → Tambah Agent (nama, telepon, area, lokasi).</li>
                                            <li>Buat PIN 4-6 digit untuk agent tersebut (nomor WhatsApp dipakai sebagai identitas transaksi).</li>
                                            <li>Gunakan Reset PIN bila outlet lupa PIN, atau Ganti PIN bila outlet ingin menggantinya sendiri.</li>
                                            <li>Nonaktifkan agent yang berhenti (hapus = nonaktifkan, bukan hapus permanen).</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) JANGAN tertukar dengan 'Agen' di /penugasan-agen (akun login penagih tagihan bulanan). Dua subsistem berbeda. 2) Seluruh endpoint agent hanya mengecek 'sudah login', bukan 'admin' — sehingga akun staf non-admin pun bisa menambah/menonaktifkan agent dan mereset PIN. Perlakukan halaman ini sebagai kewenangan sensitif.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Stok Voucher Agent (dashboard reseller)</h3>
                                    <span class="where">/agent-voucher-management</span>
                                    <p>Memantau stok voucher tiap agent reseller, pembelian, penjualan, omzet, dan profitnya.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat mengecek apakah stok outlet menipis atau menilai outlet mana yang paling produktif.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /agent-voucher-management.</li>
                                            <li>Baca kartu statistik keseluruhan.</li>
                                            <li>Lihat Top Agents untuk peringkat berdasarkan profit.</li>
                                            <li>Klik agent tertentu untuk melihat inventory, riwayat pembelian, dan riwayat penjualannya.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> Halaman ini murni pemantauan; transaksi pembelian/penjualan dilakukan lewat alur transaksi agent (termasuk alur WhatsApp), bukan dari kartu statistik ini. Agent yang belum pernah bertransaksi tidak muncul.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Paket Voucher (katalog &amp; harga voucher hotspot)</h3>
                                    <span class="where">/paket-voucher</span>
                                    <p>Mengelola daftar paket voucher hotspot: nama, durasi, harga jual, harga reseller, dan profil MikroTik-nya.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat menaikkan harga voucher, menambah paket baru, atau menyetel harga khusus reseller.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /paket-voucher.</li>
                                            <li>Klik tambah paket: isi Profil (MikroTik), Nama Voucher, Durasi, Harga Jual, dan Harga Reseller (opsional).</li>
                                            <li>Simpan — margin dihitung otomatis (harga jual − harga reseller).</li>
                                            <li>Gunakan tombol edit/hapus untuk mengubah paket.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Alamatnya SENGAJA /paket-voucher, bukan /voucher — /voucher dipakai halaman BELI voucher publik. 2) Kolom 'Profil (MikroTik)' harus persis sama dengan nama profil hotspot di router; salah ketik membuat voucher terbit tapi tidak bisa dipakai login. 3) Harga reseller &amp; margin adalah data internal — jangan disalin ke materi yang dilihat pelanggan. 4) Endpoint voucher hanya bergerbang 'staf', bukan 'admin'.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Saldo &amp; Voucher (dompet pelanggan dan agen)</h3>
                                    <span class="where">/saldo-management</span>
                                    <p>Mengelola saldo pelanggan dan agen: memverifikasi permintaan topup, menambah saldo manual, dan melihat riwayat transaksinya.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Pelanggan/agen setor uang untuk isi saldo, atau ada keluhan saldo tidak masuk setelah topup.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /saldo-management. Tab 'Permintaan Topup' menampilkan yang menunggu verifikasi.</li>
                                            <li>Buka bukti transfernya, lalu setujui atau tolak.</li>
                                            <li>Untuk menambah saldo langsung, gunakan tab Saldo User / Saldo Agen dan isi nominal + keterangan.</li>
                                            <li>Tab 'Transaksi' untuk menelusuri riwayat bila ada sengketa.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Menambah saldo LANGSUNG mengirim WhatsApp ke pemiliknya — jangan dipakai uji coba. (2) Nominal kosong atau nol ditolak. (3) Saldo di sini adalah dompet ASLI — jangan tertukar dengan halaman /atm yang membaca berkas lama. (4) Verifikasi topup memakai mesin yang sama dengan jalur WhatsApp — jangan menyetujui pengajuan yang sama di dua tempat.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Saldo (halaman lama / ATM)</h3>
                                    <span class="where">/atm</span>
                                    <p>Menampilkan daftar saldo dari berkas penyimpanan lama.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Praktis tidak dipakai lagi — hanya untuk menengok data warisan.</p>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Ini BUKAN saldo yang dipakai sistem sekarang; saldo sebenarnya ada di /saldo-management. (2) Sama seperti /statik dan /payment-method: tombol Tambah/Edit mengarah ke endpoint simpan yang tidak ada — hanya baca dan hapus yang berfungsi. Jangan memakainya untuk mengoreksi saldo pelanggan.</span></div>
                                </div>
                            </div>
                        </section>

                        <!-- ============ KAS USAHA, PENGELUARAN, DAN RINGKASAN KEUANGAN ============ -->
                        <section class="flow f-admin" id="kas-usaha-pengeluaran-dan-ringkasan-keua">
                            <h2>Kas usaha, pengeluaran, dan ringkasan keuangan</h2>
                            <p class="flow-sub">Kas usaha bisa dicatat dari halaman web maupun dari grup WhatsApp — keduanya menulis ke buku besar yang SAMA, bukan dua pembukuan. Dompet pribadi owner terpisah total dari semua ini.</p>
                            <div class="grid">
                                <div class="card">
                                    <h3>Kas Usaha (grup WhatsApp kas, biaya rutin, arus kas)</h3>
                                    <span class="where">/kas-usaha</span>
                                    <p>Satu tempat mengatur pencatatan kas lewat WhatsApp: grup mana yang dipakai, siapa yang berhak mencatat, biaya rutin apa yang perlu diingatkan bot, plus ringkasan arus kas bulan ini.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat pertama kali menyalakan fitur kas via WhatsApp, menambah biaya rutin (internet upstream, listrik, sewa), atau saat bot tiba-tiba diam di grup kas.</p>
                                    <details class="qa">
                                        <summary>Langkah (7)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /kas-usaha.</li>
                                            <li>Pilih Grup WhatsApp kas dari dropdown (daftar diambil dari grup tempat bot menjadi anggota).</li>
                                            <li>Tentukan Pemilik kas — pilih dari daftar anggota grup, bukan diketik manual.</li>
                                            <li>Nyalakan sakelar Kas Usaha (dan opsional ringkasan uang harian).</li>
                                            <li>Tambahkan Biaya Rutin: nama, nominal, tanggal jatuh tempo tiap bulan.</li>
                                            <li>Saat jatuh tempo, bot MENGINGATKAN di grup; ketik 'ok' (atau 'lewati') untuk mencatat — atau klik tombol Catat di halaman ini.</li>
                                            <li>Baca kartu arus kas &amp; grafik pengeluaran per kategori.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) 'Aktif' saja tidak cukup: tanpa grup DAN tanpa pemilik, bot diam total. 2) Jadwal membaca setelan SAAT DIJADWALKAN, bukan saat berbunyi; karena itu sakelar HARUS diubah lewat halaman ini (yang menjadwalkan ulang otomatis). Mengedit berkas konfigurasi langsung di server = sukses semu: layar bilang aktif, nol pesan terkirim sampai proses direstart. 3) Gerbang pemilik gagal-tertutup — daftar pemilik kosong berarti semua perintah 'kas …' di grup diabaikan. 4) Nomor pemilik bisa tersimpan dalam bentuk teknis (@lid) — jangan mengarang nomor dari angka itu. 5) Halaman ini TIDAK punya pembukuan sendiri: semua angka mendarat di tabel yang sama dengan /pengeluaran dan /rekap-keuangan.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Pengeluaran (catat biaya operasional usaha)</h3>
                                    <span class="where">/pengeluaran</span>
                                    <p>Mencatat, merevisi, dan membatalkan pengeluaran operasional usaha beserta kategori dan metode pembayarannya.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Setiap kali ada uang keluar dari kas usaha: beli kabel, bayar listrik, transport teknisi, biaya marketing.</p>
                                    <details class="qa">
                                        <summary>Langkah (5)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /pengeluaran → klik 'Input Pengeluaran'.</li>
                                            <li>Isi judul, kategori, nominal, tanggal, metode pembayaran, vendor, catatan, dan bukti bila ada.</li>
                                            <li>Simpan — angkanya langsung masuk buku besar dan ikut terhitung di /rekap-keuangan.</li>
                                            <li>Untuk memperbaiki: buka baris → revisi (hanya untuk pengeluaran berstatus aktif).</li>
                                            <li>Untuk membatalkan: gunakan tombol batalkan, bukan menghapus.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Kategori TERBATAS pada daftar tetap (operasional, gaji_payroll, kasbon_outflow, transport, maintenance, marketing, internet_utilities, office_supply, other) — kategori di luar daftar ditolak, termasuk saat mencatat lewat perintah 'kas' di WhatsApp. 2) 'Revisi' tidak mengubah baris lama: sistem membuat baris BARU dengan nomor baru dan membalik entri lama — jangan kaget nomornya berubah. 3) Bila ambang notifikasi diisi, pengeluaran besar dari halaman ini otomatis dikabarkan ke grup kas. 4) Ini pembukuan USAHA — bukan dompet pribadi owner.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Rekap Keuangan Holistik (buku besar semua domain)</h3>
                                    <span class="where">/rekap-keuangan</span>
                                    <p>Laporan uang masuk &amp; keluar dari semua sumber (pembayaran pelanggan, voucher, saldo, gaji, pengeluaran) dalam satu buku besar, plus diagnosa ketidakcocokan.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Tutup bulan, atau saat angka di dua halaman terasa tidak cocok dan Anda perlu tahu selisihnya di mana.</p>
                                    <details class="qa">
                                        <summary>Langkah (5)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /rekap-keuangan, pilih periode (bulan atau setahun penuh).</li>
                                            <li>Halaman menyinkronkan sumber-sumber lebih dulu, lalu menampilkan ringkasan per metode bayar dan per sumber.</li>
                                            <li>Gunakan filter domain/arah/metode/sumber untuk menelusuri.</li>
                                            <li>Buka Diagnostics untuk melihat konsistensi persetujuan.</li>
                                            <li>Manual Adjustment untuk koreksi yang memang harus dicatat; Export CSV untuk arsip.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Manual Adjustment adalah entri buku besar sungguhan — pakai hanya untuk koreksi yang bisa dipertanggungjawabkan, dan isi alasannya. 2) Setiap kali halaman dibuka, sinkronisasi dijalankan lebih dulu — untuk data besar butuh beberapa detik, jangan klik berulang. 3) Untuk pertanyaan 'uang saya bulan ini bagaimana' pakai kartu arus kas di /kas-usaha yang memakai hitungan sama dengan perintah <code class="kbd">omset</code> di WhatsApp.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Owner Cockpit (beranda ringkasan sekali-baca)</h3>
                                    <span class="where">/owner</span>
                                    <p>Satu layar berisi kondisi usaha hari ini: pemasukan &amp; tunggakan, status ISP, tiket aktif, pipeline PSB, gangguan OLT, jumlah pelanggan, dan daftar 'perlu tindakan'.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Pagi hari sebelum mulai kerja, atau saat ingin tahu cepat 'ada apa hari ini' tanpa membuka 8 halaman.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /owner.</li>
                                            <li>Baca kartu: Pemasukan (termasuk hari ini, tunggakan, tingkat pelunasan, MRR), Status ISP, PSB, Tiket, Outage OLT, Pelanggan, Perlu Tindakan.</li>
                                            <li>Klik kartu untuk membuka panel detailnya.</li>
                                            <li>Halaman menyegarkan sendiri tiap 60 detik.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Tiap kartu terisolasi: satu sumber data gagal → kartu itu menandai dirinya gagal, kartu lain tetap terisi — kartu kosong berarti 'tak bisa dibaca', BUKAN 'nol'. 2) Jumlah terisolir dibaca dari profil PPPoE LIVE di MikroTik, bukan dari kolom status pelanggan. Bila MikroTik tak terbaca, nilainya ditampilkan sebagai tidak-dapat-dipastikan, bukan 0. 3) Data MikroTik di-cache 90 detik — menekan refresh berkali-kali tidak membuat angkanya lebih baru. 4) MRR menghitung SEMUA pelanggan tagih termasuk yang sedang terisolir.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Kas usaha lewat WhatsApp (di grup kas)</h3>
                                    <span class="where">kas 150rb kabel dropcore  |  kas  |  kas bulan  |  kas batal 12  |  kas rutin tambah 850rb listrik tgl 20  |  omset  |  kas bantuan</span>
                                    <p>Mencatat pengeluaran, melihat laporan, mengelola biaya rutin, dan membaca ringkasan uang — langsung dari grup WhatsApp.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Setiap kali keluar uang di lapangan, dan saat tutup hari/bulan.</p>
                                    <details class="qa">
                                        <summary>Langkah (6)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li><code class="kbd">kas &lt;nominal&gt; &lt;untuk apa&gt;</code> — nominal bebas bentuk (150rb, 1,2jt, 150000, Rp150.000). Bot membalas nomor pengeluaran; simpan untuk pembatalan.</li>
                                            <li><code class="kbd">kas</code> tanpa apa pun = laporan HARI INI. Varian: <code class="kbd">kas kemarin</code>, <code class="kbd">kas minggu</code>, <code class="kbd">kas minggu lalu</code>, <code class="kbd">kas bulan</code>, <code class="kbd">kas bulan lalu</code>, <code class="kbd">kas bulan 2026-06</code>.</li>
                                            <li><code class="kbd">kas batal 12</code> (juga <code class="kbd">kas hapus 12</code>) untuk membatalkan satu catatan.</li>
                                            <li><code class="kbd">kas rutin tambah 850rb listrik tgl 20</code> — tanggal WAJIB, tanpa itu ditolak. <code class="kbd">kas rutin</code> untuk daftar, <code class="kbd">kas rutin hapus 3</code> untuk membuang definisinya.</li>
                                            <li>Saat bot mengingatkan tagihan rutin: <code class="kbd">ok</code> (sesuai perkiraan), <code class="kbd">ok 920rb</code> (nominal sebenarnya), atau <code class="kbd">lewati</code>. Bila ada lebih dari satu tagihan menunggu, sebutkan nomornya: <code class="kbd">ok 3</code> / <code class="kbd">ok 3 620rb</code>.</li>
                                            <li><code class="kbd">omset</code> (juga <code class="kbd">omzet</code>) — uang masuk bulan ini &amp; hari ini, perkiraan omset, lunas, tunggakan, pengeluaran, sisa bersih.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> HANYA jalan di grup kas yang dikonfigurasi DAN hanya dari nomor yang terdaftar sebagai pemilik kas — bukan di chat pribadi bot, bukan dari admin lain. Metode pembayaran selalu dicatat TUNAI. Daftar catatan dipotong 20 baris pertama. Bot TIDAK PERNAH mencatat sendiri — kata <code class="kbd">ok</code>/<code class="kbd">lewati</code> hanya bermakna saat ADA tagihan menunggu, supaya 'ok' biasa di grup tidak diam-diam mencatat pengeluaran. Bila sebuah angka di <code class="kbd">omset</code> tertulis 'tak terbaca', itu berarti sumbernya gagal dibaca — BUKAN nol.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Dompet PRIBADI owner (terpisah dari kas usaha)</h3>
                                    <span class="where">keluar 50rb bensin  |  masuk 2jt setoran  |  uang  |  uang bulan [YYYY-MM]  |  uang hapus 12  |  uang bantuan</span>
                                    <p>Mencatat keuangan PRIBADI pemilik di database sendiri — tidak menyentuh saldo pelanggan maupun pembukuan usaha.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Pencatatan harian pemilik yang menumpang nomor bot.</p>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> Kepemilikan dibaca dari daftar TERPISAH khusus dompet pribadi — bukan nomor owner bot dan bukan role admin. Bila grup dompet diisi, fitur HANYA dilayani di grup itu dan chat pribadi sengaja dimatikan. Bukan-pemilik sengaja TIDAK diberi tahu apa pun (supaya keberadaan fitur tidak bocor ke pelanggan). Kata pemicu sengaja sempit: keluar, kluar, masuk, msk, uang, duit, dompet. Fitur ini bawaan MATI.</span></div>
                                </div>
                            </div>
                        </section>

                        <!-- ============ BERBICARA KE PELANGGAN: BROADCAST, PENGUMUMAN, TEMPLATE, SURVEI ============ -->
                        <section class="flow f-admin" id="berbicara-ke-pelanggan-broadcast-pengumu">
                            <h2>Berbicara ke pelanggan: broadcast, pengumuman, template, survei</h2>
                            <p class="flow-sub">Pesan WhatsApp tidak bisa ditarik kembali. Karena itu semua jalur di sini punya pratinjau, penjaga kebocoran data internal, dan jeda anti-blokir. Jangan mencari cara menembus penjaga-penjaga itu.</p>
                            <div class="grid">
                                <div class="card">
                                    <h3>Broadcast WhatsApp (blast massal / gangguan massal)</h3>
                                    <span class="where">/broadcast</span>
                                    <p>Mengirim satu pesan ke banyak pelanggan sekaligus — semua pelanggan, per ODP/ODC, per paket, atau pilih manual.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat ada gangguan massal, maintenance terjadwal, atau pengumuman yang harus sampai ke pelanggan sekarang.</p>
                                    <details class="qa">
                                        <summary>Langkah (6)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /broadcast.</li>
                                            <li>Pilih template siap-pakai (kabel putus / maintenance / gangguan listrik / pesan umum) atau tulis manual.</li>
                                            <li>Pilih Mode Penerima: semua, per ODP, per ODC, per paket, hanya yang ditandai 'butuh info', atau pilih manual.</li>
                                            <li>Bila mode bersegmen, pilih segmennya; bila manual, cari &amp; centang pelanggannya.</li>
                                            <li>Klik Preview dulu untuk melihat pesan jadi + jumlah penerima.</li>
                                            <li>Klik Kirim. Riwayat broadcast (termasuk daftar penerima) tersimpan di tabel bawah.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Ada PENJAGA DATA INTERNAL: pesan yang memuat jumlah pelanggan terdampak, nama PPPoE, atau nama ODP/ODC akan DITOLAK sebelum satu pesan pun terkirim — pemeriksaan dilakukan pada teks mentah maupun teks yang sudah jadi. Perbaiki kalimatnya; jangan mencari cara menembusnya. 2) Pelanggan yang opt-out dilewati kecuali kotak 'sertakan yang opt-out' dicentang — dan itu keputusan sadar. 3) Endpoint broadcast hanya bergerbang 'staf' (termasuk teknisi), sementara halamannya tidak punya penjaga peran — perlakukan akses ke menu ini sebagai kewenangan setara admin. 4) Pengiriman diberi jeda + variasi waktu anti-blokir, jadi broadcast besar tidak selesai seketika; jangan klik kirim dua kali.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Broadcast Terarah (kirim tagihan/tenggang/isolir ke pelanggan terpilih)</h3>
                                    <span class="where">/broadcast-tagihan</span>
                                    <p>Mengirim pesan pembayaran (tagihan, masa tenggang, pemberitahuan isolir, atau selamat datang ulang) hanya ke pelanggan yang Anda pilih.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Awal bulan menagih yang belum bayar, menjelang tanggal isolir, atau mengejar penunggak tertentu.</p>
                                    <details class="qa">
                                        <summary>Langkah (6)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /broadcast-tagihan.</li>
                                            <li>Langkah 1 — pilih filter Tampilkan: Belum bayar / Sudah bayar / Semua / Sedang terisolir / Menunggak; cari &amp; centang pelanggannya.</li>
                                            <li>Langkah 2 — pilih Template (Tagihan, Masa Tenggang, Isolir, Selamat Datang) — editor terisi otomatis; boleh diedit.</li>
                                            <li>Klik Pratinjau untuk melihat hasil terisi pada satu pelanggan sampel.</li>
                                            <li>Klik Kirim — memakai mesin broadcast yang sama (jeda, opt-out, riwayat).</li>
                                            <li>Cek tabel Riwayat Broadcast untuk memastikan siapa saja yang menerima.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Filter 'Sedang terisolir' membaca kolom status pelanggan yang pada praktiknya tidak pernah bernilai 'isolir' (isolir sesungguhnya = profil PPPoE di MikroTik), sehingga filter itu bisa memulangkan daftar KOSONG walau banyak pelanggan terisolir — gunakan 'Menunggak' atau 'Belum bayar'. 2) Slot per-pelanggan (nama, harga, link bayar, tanggal isolir) baru terisi saat KIRIM; yang tampak mentah di editor itu normal — buktikan lewat Pratinjau. 3) Template yang tampil diambil dari template tersimpan; bila teks di produksi sudah diedit, isinya bisa berbeda dari yang Anda ingat. 4) Pelanggan tanpa nomor HP tidak akan menerima apa pun meski tercentang.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Template Pesan (semua teks yang dikirim bot)</h3>
                                    <span class="where">/templates</span>
                                    <p>Mengedit semua kalimat yang dikirim bot ke pelanggan/teknisi tanpa mengubah kode: notifikasi, menu WiFi, balasan, pesan error/sukses, laporan.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat ingin memperhalus kalimat, mengganti nama brand di pesan, atau memperbaiki pesan yang salah tulis.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /templates — template dikelompokkan per kategori.</li>
                                            <li>Cari key yang mau diubah, edit teksnya. Perhatikan slot ${...}: itu diisi otomatis oleh sistem, jangan diubah namanya.</li>
                                            <li>Simpan — seluruh kategori disimpan sekaligus dan cache server dimuat ulang otomatis.</li>
                                            <li>Perhatikan peringatan slot yang muncul setelah simpan (bersifat saran, bukan penolakan).</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Template TERSIMPAN selalu menang atas teks bawaan di kode. Bila pengembang menambah bagian baru tapi template tersimpan belum memuatnya, bagian itu dihitung sistem namun TIDAK PERNAH terkirim ke pelanggan — pernah terjadi berminggu-minggu tanpa disadari. 2) Menyimpan mengirim SELURUH kategori: tab yang lama terbuka bisa menimpa perubahan orang lain — muat ulang halaman sebelum mengedit. 3) Penghapusan massal ditolak sebagai pengaman. 4) Berkas template di produksi sering sudah diedit langsung di sana — isinya bisa berbeda dari repo. 5) Endpoint simpan hanya bergerbang 'staf', bukan 'admin'.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Pengumuman (banner pengumuman di portal/bot)</h3>
                                    <span class="where">/announcements</span>
                                    <p>Membuat, mengubah, dan menghapus pengumuman singkat yang dibaca pelanggan.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat ada informasi yang perlu tersedia terus-menerus (jadwal maintenance, perubahan rekening), bukan blast sekali kirim.</p>
                                    <details class="qa">
                                        <summary>Langkah (3)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /announcements.</li>
                                            <li>Tulis pesan pengumuman → simpan.</li>
                                            <li>Edit atau hapus lewat tombol di daftar.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> Daftar pengumuman bisa DIBACA publik tanpa login (dipakai portal pelanggan) — jangan menuliskan informasi internal di sini. Perubahan langsung berlaku.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Berita &amp; Promo</h3>
                                    <span class="where">/news</span>
                                    <p>Mengelola berita/promo berjudul yang ditampilkan ke pelanggan.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat mengumumkan promo paket, program referral, atau kabar layanan yang lebih panjang dari sekadar pengumuman.</p>
                                    <details class="qa">
                                        <summary>Langkah (3)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /news.</li>
                                            <li>Klik tambah: isi Judul dan Konten.</li>
                                            <li>Simpan; gunakan edit/hapus pada daftar untuk mengubahnya.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> Sama seperti pengumuman: daftar berita terbuka untuk publik tanpa login, jadi anggap seluruh isinya konsumsi pelanggan. Judul dan konten wajib diisi.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Survei Kepuasan Pelanggan (CSAT)</h3>
                                    <span class="where">/survei</span>
                                    <p>Melihat hasil survei kepuasan bulanan pelanggan (skor 1-5, komentar, pelanggan tidak puas) dan mengatur pengiriman serta pengaman anti-blokir.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Setiap bulan setelah survei dikirim, atau saat ingin menyalakan/menguji survei pertama kali.</p>
                                    <details class="qa">
                                        <summary>Langkah (5)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /survei dan pilih periode (YYYY-MM).</li>
                                            <li>Baca ringkasan: skor rata-rata, response rate, sebaran, pelanggan tidak puas beserta nomor HP &amp; komentarnya, non-responder, dan tren 12 bulan.</li>
                                            <li>Buka panel Setelan untuk menyalakan fitur, membatasi hanya ke pelanggan yang sudah bayar, mengaktifkan alert, dan menyetel pengaman anti-blokir.</li>
                                            <li>Klik 'Kirim Survei Sekarang' untuk mengirim manual di luar jadwal.</li>
                                            <li>Klik 'Pulihkan Terlewat' bila ada balasan pelanggan yang sempat tidak tertangkap.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Tombol 'Kirim Survei Sekarang' ditolak bila fitur survei belum aktif — nyalakan dulu di panel Setelan. 2) Pengiriman berjeda dan berjalan di latar: hasil tidak muncul seketika, dan menekan tombol dua kali tidak menyurvei ulang. 3) Jadwal rutin survei &amp; rekap diatur di /cron, bukan di sini. 4) Daftar pelanggan tidak puas tampil lengkap dengan nomor HP — layar ini jangan dipamerkan sembarangan.</span></div>
                                </div>
                            </div>
                        </section>

                        <!-- ============ PERINTAH WHATSAPP UNTUK ADMIN ============ -->
                        <section class="flow f-admin" id="perintah-whatsapp-untuk-admin">
                            <h2>Perintah WhatsApp untuk admin</h2>
                            <p class="flow-sub">Panel web dan bot WhatsApp mengerjakan pekerjaan yang sama; bot dipakai saat Anda tidak di depan komputer. Yang paling sering membingungkan admin baru adalah gerbang peran — nomor Anda bisa lolos satu gerbang tapi ditolak di gerbang lain.</p>
                            <div class="grid">
                                <div class="card">
                                    <h3>Tiga gerbang peran yang berbeda — jangan disamakan</h3>
                                    <span class="where">(bukan perintah — mekanisme)</span>
                                    <p>Menentukan perintah mana yang dilayani untuk nomor WhatsApp Anda.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat sebuah perintah admin 'didiamkan' bot dan Anda perlu tahu penyebabnya.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>GERBANG 1 — nomor Anda terdaftar sebagai nomor owner di konfigurasi. Dipakai perintah warisan: alluser, allsaldo, statusap, &lt;topup, &lt;delsaldo, addprofvoucher, addppp, addbinding.</li>
                                            <li>GERBANG 2 — nomor Anda cocok dengan SALAH SATU akun di daftar akun, APAPUN rolenya (jadi akun admin pun dihitung 'teknisi' di gerbang ini). Dipakai perintah tiket, cek wifi, statusppp, cari/daftar pelanggan.</li>
                                            <li>GERBANG 3 — role PRESISI (admin/owner/superadmin) dari daftar akun. Dipakai switch koneksi, oper jalur, data isp, konfirmasi bukti bayar, keputusan request paket.</li>
                                            <li>GERBANG 4 — role harus termasuk daftar yang diizinkan untuk PSB (bawaan: teknisi/admin/owner). Dipakai semua perintah PSB dan aset jaringan.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> Nomor Anda bisa lolos satu gerbang tapi gagal di gerbang lain. Owner yang nomornya TIDAK terdaftar di daftar akun akan ditolak <code class="kbd">switch koneksi</code>/<code class="kbd">data isp</code>/<code class="kbd">bukti</code> walaupun terdaftar sebagai nomor owner. Sebaliknya, admin di daftar akun yang tidak terdaftar sebagai nomor owner ditolak <code class="kbd">alluser</code>/<code class="kbd">&lt;topup</code>.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Kata kunci hanya dikenali di AWAL pesan</h3>
                                    <span class="where">(bukan perintah — mekanisme)</span>
                                    <p>Menjelaskan kenapa perintah yang diselipkan di tengah kalimat tidak jalan.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat Anda mengetik 'tolong cari budi' dan bot diam.</p>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> Pencocokan dilakukan dari awal kalimat — 'min tolong cari budi' TIDAK cocok, hanya 'cari budi'.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Kata batal universal &amp; perintah pemutus sesi</h3>
                                    <span class="where">batal | cancel | ga jadi | gak jadi</span>
                                    <p>Menghentikan wizard apa pun yang sedang berjalan.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat salah masuk wizard PSB/aset/bukti bayar dan ingin keluar.</p>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> Selain kata batal, hanya <code class="kbd">menu<b></code>, <code class="kbd">bantuan</code>, <code class="kbd">help</code>, <code class="kbd">lapor</code>, <code class="kbd">ceksaldo</code>, <code class="kbd">saldo</code> yang boleh memutus sesi. Di wizard pengumpul data keyword lain SENGAJA tidak memutus, supaya jawaban seperti <code class="kbd">cari &lt;SN&gt;</code> tidak menghapus progres. Sesi juga hangus sendiri setelah 15 menit. CATATAN: untuk wizard PSB, <code class="kbd">batal</code> menghentikan sesi tetapi DRAFT-nya tetap tersimpan — kalau nanti mulai pelanggan baru, bot akan menawarkan melanjutkan yang tadi; pilih </b>BARU* untuk membuangnya.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Menu &amp; panduan lewat bot</h3>
                                    <span class="where">menuowner  |  menuteknisi  |  panduan teknisi  |  #psb  |  bantuan aset  |  kas bantuan  |  admin</span>
                                    <p>Menampilkan daftar perintah dan panduan langkah untuk tiap peran.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat lupa bentuk perintah.</p>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> <code class="kbd">menuowner</code> DIGENERATE dari katalog perintah tertentu saja — perintah seperti #PSB, #jadwal, #ODP, kas/omset, bukti bayar, dan request paket TIDAK PERNAH MUNCUL di menu itu meski berfungsi normal. <code class="kbd">menuteknisi</code> ditolak bila bukan teknisi/owner. <code class="kbd">panduan teknisi</code> juga menerima <code class="kbd">tutorial teknisi</code>, <code class="kbd">cara psb</code>, <code class="kbd">cara perbaikan</code>, <code class="kbd">panduan psb</code>. <code class="kbd">#psb</code> sebagai TEKS POLOS mengirim panduan PSB — kalau ada foto terlampir, ia justru MEMULAI wizard. <code class="kbd">kas bantuan</code> hanya jalan di grup kas dan dari pemilik kas.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Pengelolaan pelanggan lewat bot</h3>
                                    <span class="where">cari &lt;nama/HP/ID&gt;  |  daftar pelanggan [lunas|belum] [halaman]  |  cek wifi &lt;ID/nama&gt;  |  lokasi [nama]  |  alluser</span>
                                    <p>Melihat dan mencari data pelanggan, mengecek modemnya, dan menyimpan titik rumah — tanpa membuka panel.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat pelanggan menelepon, saat menagih, atau saat teknisi berdiri di depan rumah pelanggan.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li><code class="kbd">cari budi</code> (nama), <code class="kbd">cari 08123456789</code> (nomor), <code class="kbd">cari 15</code> (ID).</li>
                                            <li><code class="kbd">daftar pelanggan belum</code> — hanya yang belum bayar; <code class="kbd">daftar pelanggan belum 2</code> untuk halaman ke-2.</li>
                                            <li><code class="kbd">cek wifi &lt;ID atau nama&gt;</code> — status modem &amp; SSID pelanggan lain.</li>
                                            <li><code class="kbd">lokasi</code> atau <code class="kbd">lokasi budi</code> → balas ANGKA pelanggan → share pin rumahnya → balas <b>YA</b> untuk menyimpan.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> Semua butuh owner ATAU akun terdaftar. Kata <code class="kbd">cari</code> juga dipakai DI DALAM wizard PSB untuk mencari SN modem — kalau sedang di tengah wizard, <code class="kbd">cari ...</code> berarti pencarian modem, bukan pencarian pelanggan. Pelanggan berpaket whitelist (gratis) sengaja DIKECUALIKAN dari daftar 'belum'. Untuk akun staf, kata <code class="kbd">lokasi</code> DIBAJAK oleh wizard simpan-titik sebelum sampai ke fitur cek posisi teknisi. <code class="kbd">alluser</code> KHUSUS nomor owner dan balasannya memuat password PPPoE semua pelanggan dalam satu pesan — jangan dijalankan di perangkat yang bisa dilihat orang lain.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Bukti bayar &amp; request paket lewat bot</h3>
                                    <span class="where">bukti  |  terima 1 / terima BP-…  |  tolak 2 &lt;alasan&gt;  |  hapus 3  |  request paket  |  (balas notif) ok / tolak &lt;alasan&gt; / batalkan</span>
                                    <p>Memproses antrian bukti transfer dan pengajuan ganti paket langsung dari WhatsApp.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Rutin, setiap kali notif bukti atau pengajuan masuk.</p>
                                    <details class="qa">
                                        <summary>Langkah (6)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li><code class="kbd">bukti</code> — daftar bernomor bukti transfer yang belum dikonfirmasi.</li>
                                            <li>Cara tercepat: BALAS (quote) pesan notif bukti, ketik <code class="kbd">ok</code>.</li>
                                            <li>Atau <code class="kbd">terima &lt;nomor antrian&gt;</code> / <code class="kbd">terima BP-…</code>.</li>
                                            <li><code class="kbd">tolak &lt;nomor&gt; &lt;alasan&gt;</code> — pelanggan DIBERI TAHU.</li>
                                            <li><code class="kbd">hapus &lt;nomor&gt;</code> — buang dari antrian TANPA memberi tahu pelanggan (untuk foto yang ternyata bukan bukti bayar).</li>
                                            <li><code class="kbd">request paket</code> — daftar pengajuan ganti paket; balas notifnya dengan <code class="kbd">ok</code>, <code class="kbd">tolak &lt;alasan&gt;</code>, atau <code class="kbd">batalkan</code>.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> Semua khusus role admin/owner/superadmin; non-admin DIDIAMKAN (fitur sengaja tidak dibocorkan). Balasan ter-quote hanya sah bila teks yang di-quote memuat kode BP-… (bukti) atau kode request paket. Kata yang diterima sebagai 'terima': terima/konfirmasi/setuju/approve/acc/ok/oke/lunas. Bila pelanggan sudah lunas periode itu, bot MENOLAK konfirmasi dan menyarankan <code class="kbd">hapus</code> — itu disengaja. <code class="kbd">tolak</code> POLOS tanpa sasaran hanya dikenali bila cocok PERSIS kata itu, supaya chat normal tidak dibajak. Untuk request paket, <code class="kbd">ok</code>/<code class="kbd">batal</code> POLOS sengaja tidak dikenali — Anda WAJIB me-reply notifnya atau menyebut kodenya. <code class="kbd">batalkan</code> bersifat diam-diam: pelanggan tidak disentuh.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Jaringan &amp; ISP lewat bot</h3>
                                    <span class="where">data isp / data &lt;nama jalur&gt;  |  switch koneksi  |  oper &lt;segmen atau nama&gt; ke &lt;jalur&gt;  |  statusppp  |  statushotspot  |  statusap</span>
                                    <p>Membaca kondisi jalur upstream, mengalihkan trafik antar-ISP, memindahkan segmen/pelanggan, dan melihat statistik PPPoE/hotspot/AP.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat banyak keluhan lemot bersamaan, atau saat perlu memindahkan trafik tanpa membuka Winbox.</p>
                                    <details class="qa">
                                        <summary>Langkah (4)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li><code class="kbd">data isp</code> → ikhtisar semua jalur; <code class="kbd">data &lt;nama jalur&gt;</code> → rincian satu jalur.</li>
                                            <li><code class="kbd">switch koneksi</code> → daftar bernomor → balas ANGKA → bot menampilkan rencananya → balas <b>ya</b> untuk mengeksekusi.</li>
                                            <li><code class="kbd">oper reguler ke mni</code> (segmen) atau <code class="kbd">oper budi ke gmdp</code> (satu pelanggan) → pratinjau → balas <b>ya</b>.</li>
                                            <li><code class="kbd">statusppp</code> / <code class="kbd">statushotspot</code> untuk statistik pemakaian.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> <code class="kbd">data isp</code>, <code class="kbd">switch koneksi</code>, dan <code class="kbd">oper</code> butuh role PRESISI admin/owner/superadmin; non-admin dibalas 'khusus admin' tanpa membocorkan fitur. Daftar nama jalur berbeda per instalasi — lihat <code class="kbd">menuowner</code>. Router baru benar-benar ditulis pada langkah konfirmasi terakhir. Pelanggan tanpa username PPPoE ditolak untuk <code class="kbd">oper</code>. <code class="kbd">statusap</code> KHUSUS nomor owner — akun ber-role admin tidak cukup. Perintah <code class="kbd">monitorwifi</code> belum ada isinya; ia hanya mengarahkan ke statusppp/statushotspot/statusap.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Perintah warisan khusus nomor owner (saldo, voucher, profil MikroTik)</h3>
                                    <span class="where">&lt;topup &lt;nomor&gt;|&lt;jumlah&gt;  |  &lt;delsaldo &lt;nomor&gt;  |  allsaldo  |  listprofvoucher / addprofvoucher / delprofvoucher  |  listprofstatik / addprofstatik / delprofstatik  |  addbinding  |  addppp</span>
                                    <p>Menambah/menghapus saldo, mengelola profil voucher &amp; statik, membuat IP binding, dan membuat akun PPPoE langsung di router.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Koreksi saldo, menyiapkan paket voucher/kecepatan baru, atau pemasangan manual di luar alur PSB.</p>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> SEMUA perintah di kelompok ini KHUSUS nomor owner — role admin di daftar akun TIDAK cukup. Tanda <code class="kbd">&lt;</code> di depan wajib untuk topup/delsaldo, dan pemisah antar-bagian memakai tanda | tanpa spasi ekstra. <code class="kbd">addprofvoucher</code> menolak bila nama profil sudah ada; <code class="kbd">addbinding</code> menolak bila profilnya belum terdaftar (buat dengan <code class="kbd">addprofstatik</code> dulu). Untuk pasang baru normal JANGAN pakai <code class="kbd">addppp</code> — pakai wizard <code class="kbd">#PSB</code> supaya username, password, dan setelan modem diurus otomatis.</span></div>
                                </div>
                            </div>
                        </section>

                        <!-- ============ AKUN, AUDIT, DAN JEJAK SIAPA MENGUBAH APA ============ -->
                        <section class="flow f-admin" id="akun-audit-dan-jejak-siapa-mengubah-apa">
                            <h2>Akun, audit, dan jejak siapa mengubah apa</h2>
                            <p class="flow-sub">Dua halaman log ini adalah alat pembuktian saat ada data berubah tanpa penjelasan. Keduanya memakai database terpisah dari data pelanggan.</p>
                            <div class="grid">
                                <div class="card">
                                    <h3>Log Aktivitas (jejak siapa mengubah apa)</h3>
                                    <span class="where">/activity-logs</span>
                                    <p>Menelusuri tindakan staf: siapa membuat/mengubah/menghapus apa, kapan, dari IP mana.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat ada data berubah tanpa penjelasan, uang tercatat aneh, atau perlu bukti untuk audit.</p>
                                    <details class="qa">
                                        <summary>Langkah (3)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /activity-logs.</li>
                                            <li>Saring berdasarkan pengguna, jenis aksi, jenis objek, dan rentang tanggal.</li>
                                            <li>Buka baris untuk melihat nilai sebelum/sesudah bila tersedia.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> 1) Log disimpan di database TERPISAH — mem-backup database pelanggan saja tidak menyelamatkan jejak audit. 2) Ada retensi otomatis 730 hari (2 tahun); data lebih tua dibersihkan sendiri tiap hari. 3) Endpoint pembacanya bergerbang 'staf' (termasuk teknisi), walau halamannya admin-only.</span></div>
                                </div>
                                <div class="card">
                                    <h3>Log Login (jejak masuk/keluar panel)</h3>
                                    <span class="where">/login-logs</span>
                                    <p>Melihat riwayat login &amp; logout akun staf beserta IP dan perangkatnya, termasuk percobaan yang gagal.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Saat curiga ada akun dipakai orang lain, atau memastikan siapa yang online saat sebuah perubahan terjadi.</p>
                                    <details class="qa">
                                        <summary>Langkah (3)</summary>
                                        <div class="qa-body"><ul class="plain">
                                            <li>Buka /login-logs.</li>
                                            <li>Saring berdasarkan username, jenis aksi, hanya-yang-berhasil, dan rentang tanggal.</li>
                                            <li>Cocokkan waktunya dengan temuan di /activity-logs.</li>
                                        </ul></div>
                                    </details>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> Berbagi retensi 2 tahun dan database log yang sama dengan Log Aktivitas; logout hanya tercatat bila staf benar-benar menekan Logout (menutup tab tidak tercatat).</span></div>
                                </div>
                                <div class="card">
                                    <h3>Dashboard (ringkasan harian)</h3>
                                    <span class="where">/ (halaman depan setelah masuk)</span>
                                    <p>Layar ringkasan: status bot WhatsApp, status MikroTik &amp; GenieACS, jumlah pelanggan, sudah/belum bayar, PPPoE online-offline, dan ringkasan uang.</p>
                                    <p class="when"><b>Kapan dipakai:</b> Cek cepat tiap pagi sebelum masuk ke halaman kerja yang lebih detail.</p>
                                    <div class="trap"><span class="ic">⚠️</span><span><b>Jebakan:</b> (1) Kartu 'Paid Users' / 'Unpaid Users' membaca penanda cepat di data pelanggan yang hanya salinan — angka resmi ada di /payment-status dan /rekap-tunggakan. Kalau berbeda, percayai halaman pembayaran. (2) Kalau tidak login sebagai admin/owner, alamat ini otomatis melempar ke halaman peran masing-masing. (3) Halaman depan adalah DASHBOARD, bukan daftar pelanggan — daftar pelanggan ada di /users.</span></div>
                                </div>
                            </div>
                        </section>

                        <!-- ============ TANYA JAWAB ============ -->
                        <section class="faq" id="tanya-jawab">
                            <h2>Tanya Jawab</h2>
                            <details class="qa">
                                <summary>Saya baru saja memasang sistem ini dan belum punya akun apa pun. Bagaimana masuk pertama kali?</summary>
                                <div class="qa-body">Akun pertama tidak bisa dibuat dari web karena halaman pembuatan akun sendiri butuh login admin. Jalankan dari terminal di server: <code class="kbd">node scripts/create-admin.js &lt;username&gt; &lt;password&gt; &quot;&lt;nama&gt;&quot; admin</code> (password minimal 8 karakter). Setelah itu login lewat browser, dan akun berikutnya dibuat dari /accounts.</div>
                            </details>
                            <details class="qa">
                                <summary>Kenapa halaman Rekap Tunggakan menampilkan nol padahal jelas banyak yang belum bayar?</summary>
                                <div class="qa-body">Dulu ini terjadi karena kueri mencari status 'aktif'/'isolir', sedangkan data sebenarnya berisi 'active' dan status isolir tidak pernah ditulis ke kolom itu — jadi 98 dari 98 pelanggan tersaring habis. Bug itu sudah diperbaiki. Kalau angkanya nol lagi, jangan simpulkan 'semua sudah bayar': periksa dulu di /payment-status untuk periode yang sama, dan laporkan sebagai kemungkinan bug filter status.</div>
                            </details>
                            <details class="qa">
                                <summary>Bagaimana cara tahu siapa saja yang sedang terisolir? Saya cari di kolom status pelanggan tapi kosong terus.</summary>
                                <div class="qa-body">Isolir bukan status di database — isolir adalah profil PPPoE di MikroTik. Kolom status pelanggan TIDAK PERNAH berisi 'isolir'. Untuk melihat siapa yang terisolir, gunakan /buka-isolir (yang membaca profil dari router) atau kartu terisolir di /owner yang juga membaca profil live. Hindari filter 'Sedang terisolir' di /broadcast-tagihan — filter itu membaca kolom status dan bisa memulangkan daftar kosong; pakai filter 'Menunggak' atau 'Belum bayar'.</div>
                            </details>
                            <details class="qa">
                                <summary>Teknisi saya bilang bot menolak modemnya dengan tanda ⛔ dan menyuruh saya 'menutup pelanggan lama'. Apa yang harus saya lakukan?</summary>
                                <div class="qa-body">Jangan langsung menutup pelanggan. Tanyakan dulu tiga hal ke teknisi: (1) modem ini copotan dari siapa, (2) apakah pelanggan itu masih berlangganan, (3) nama siapa yang tertulis di layar ⛔. Kalau layar menyebut nama pelanggan yang MASIH aktif, menutup pelanggan itu adalah tindakan yang SALAH — biasanya artinya pelanggan tersebut sudah pindah ke modem lain, sementara modem copotannya masih menyimpan username PPPoE-nya. Jalan keluar yang benar untuk kasus itu: set PPPoE modem copotan ke <code class="kbd">tes@hw</code> (login ke modem atau minta admin push), lalu teknisi balas <b>REFRESH</b> — setelah itu modem terbaca sebagai 🆕 BARU. Hanya kalau pelanggan itu memang benar-benar berhenti, barulah tutup datanya di /users.</div>
                            </details>
                            <details class="qa">
                                <summary>Saya sudah menutup pelanggan lama seperti disuruh bot, tapi teknisi balas *REFRESH* dan modemnya justru hilang dari layar. Kenapa?</summary>
                                <div class="qa-body">Ini keterbatasan yang sudah dikenali. <b>REFRESH</b> hanya mencari modem yang BARU MENDAFTAR ke sistem modem (atau yang masih memakai username bawaan <code class="kbd">tes@hw</code>). Modem bekas yang baru Anda bebaskan tidak memenuhi syarat itu: umur registrasinya sudah berbulan-bulan, dan menghapus baris pelanggan tidak mengubah apa pun di dalam modem. Suruh teknisi mengetik <code class="kbd">cari &lt;SN stiker modem&gt;</code> — itulah satu-satunya cara yang terbukti menemukan modem bekas. Jangan menyimpulkan modemnya rusak atau pekerjaan Anda belum masuk.</div>
                            </details>
                            <details class="qa">
                                <summary>Layar ⛔ berbunyi 'masih tercatat milik pelanggan lain' TANPA menyebut nama. Saya cari di /users tidak ketemu siapa pun. Apa artinya?</summary>
                                <div class="qa-body">Artinya modem itu masih melayani sesi PPPoE yang hidup di router, tetapi baris pelanggannya sudah tidak ada di data. Penyebab paling sering: saat pelanggan dihapus, MikroTik sedang tak terjangkau, sehingga secret PPPoE-nya selamat sementara datanya hilang. Modem tersebut akan ditolak selamanya sampai secret-nya dibereskan. Yang harus Anda lakukan: buka MikroTik, cari secret/sesi PPPoE aktif yang tidak punya pemilik di /users, lalu hapus secret dan putus sesinya. Sesudah itu teknisi bisa <code class="kbd">cari &lt;SN&gt;</code> lagi. Penyebab lain yang mungkin: modem itu milik pelanggan hidup di AREA LAIN yang memakai sistem modem yang sama — lihat pertanyaan berikutnya.</div>
                            </details>
                            <details class="qa">
                                <summary>Apakah mungkin teknisi saya tanpa sengaja memakai modem milik pelanggan area lain?</summary>
                                <div class="qa-body">Ya, dan ini risiko nyata yang perlu Anda ketahui. Pencarian modem membaca SELURUH isi sistem modem (yang dipakai bersama dua area), sedangkan pemeriksaan 'modem ini masih dipakai orang' hanya melihat daftar pelanggan dan router AREA SENDIRI. Akibatnya modem milik pelanggan hidup di area sebelah bisa dilabeli 🆕 BARU atau ♻️ BEKAS alias boleh dipakai — dan bila diteruskan, pelanggan area sebelah mati internet tanpa ada yang tahu sebabnya. Aturan praktisnya: kalau SN modem tidak berasal dari stok Anda sendiri dan Anda tidak tahu riwayatnya, jangan dipakai. Konfirmasi dulu ke admin area lain.</div>
                            </details>
                            <details class="qa">
                                <summary>Teknisi mengetik SN modem polosan seperti diajarkan panduan, tapi bot malah membalas menu bantuan. Modemnya rusak?</summary>
                                <div class="qa-body">Bukan modemnya. Bot hanya mengenali SN polosan yang berpola tertentu (pola stiker Huawei/ZTE atau angka heksa). SN merek lain, misalnya bentuk <code class="kbd">EQFLH7U22977</code>, tidak dikenali sebagai SN sehingga ketikannya dianggap tak berarti. Solusinya: ketik dengan awalan perintah — <code class="kbd">cari EQFLH7U22977</code>. Cara ini BERHASIL menemukan modemnya; yang gagal hanya bentuk polosannya.</div>
                            </details>
                            <details class="qa">
                                <summary>Teknisi bilang di layar daftar bernomor dia mengetik SN modemnya, tapi bot cuma mencetak ulang daftar yang sama. Bot ngadat?</summary>
                                <div class="qa-body">Tidak ngadat, tapi memang tidak menjelaskan. Di layar daftar bernomor, bot menerima: angka pilihan, <code class="kbd">refresh</code>, dan <code class="kbd">cari &lt;SN/nama&gt;</code>. Ketikan lain (termasuk SN berpola tidak dikenal) jatuh ke pencetakan ulang daftar tanpa pesan kesalahan, dan header daftarnya tidak menyebut opsi <code class="kbd">cari</code>. Ajarkan teknisi: kalau modemnya tidak ada di daftar, ketik <code class="kbd">cari &lt;SN stiker&gt;</code> — bukan SN polosan.</div>
                            </details>
                            <details class="qa">
                                <summary>Kenapa teknisi tidak bisa mengerjakan dua pemasangan sekaligus?</summary>
                                <div class="qa-body">Sistem menyimpan satu draft PSB per teknisi. Kalau dia menunggu Anda membebaskan modem untuk pelanggan A lalu memulai pelanggan B, bot akan menawarkan LANJUT/BARU untuk A — bukan memproses B. Menjawab <b>BARU</b> membuang seluruh kerja A secara permanen. Praktik yang aman: selesaikan atau tutup pelanggan A dulu; bila memang harus ditunda lama, catat datanya di luar (atau daftarkan lewat /papan-psb) sebelum memulai pelanggan berikutnya. Waspadai juga <code class="kbd">#PSB PSB-&lt;nomor&gt;</code> dari papan jadwal — perintah itu MENIMPA draft yang sedang tertahan tanpa peringatan.</div>
                            </details>
                            <details class="qa">
                                <summary>Bot bilang 'sudah diumumkan ke grup' tapi grup tidak menerima apa pun. Ini bug?</summary>
                                <div class="qa-body">Kalimat itu ditulis tanpa memeriksa hasil kirim, jadi ia muncul walaupun tidak ada pesan yang benar-benar terkirim. Dua penyebab: (1) grup PSB belum diisi di /config tab Intake PSB — ini keadaan bawaan sistem, jadi wajar terjadi di pemasangan baru; (2) grup sudah diisi tetapi WhatsApp sedang putus. Periksa /config dulu; selama grupnya belum diset, anggap pengumuman TIDAK terkirim dan beri tahu tim manual lewat /papan-psb.</div>
                            </details>
                            <details class="qa">
                                <summary>Panduan bot menyuruh teknisi 'balas angka' untuk memilih dusun, tapi daftarnya tidak pernah muncul dan angka yang diketik diabaikan. Kenapa?</summary>
                                <div class="qa-body">Daftar dusun kosong karena belum diisi (bawaan sistem memang kosong). Selama kosong, daftar bernomor tidak ditampilkan dan angka yang diketik tidak berarti apa-apa — bot hanya mengulang checklist tanpa penjelasan. Perbaikannya di tangan Anda: isi daftar dusun di /config tab Intake PSB. Sementara belum diisi, ajari teknisi mengetik langsung, misalnya <code class="kbd">Dusun: Ngitik</code>.</div>
                            </details>
                            <details class="qa">
                                <summary>Teknisi kena masalah di tengah wizard PSB lalu sesinya mati. Datanya hilang?</summary>
                                <div class="qa-body">Tidak, data disimpan sampai 48 jam. Suruh teknisi mengetik <code class="kbd">LANJUT</code> (kata <code class="kbd">lanjut</code>, <code class="kbd">lanjutkan</code>, <code class="kbd">terusin</code>, <code class="kbd">teruskan</code>, atau <code class="kbd">refresh</code> juga diterima). Jangan mengetik <code class="kbd">#PSB</code> polos — yang muncul adalah panduan 30 baris yang menyuruh memotret KTP lagi, bukan tawaran melanjutkan. Perlu diketahui juga: setelah aplikasi restart (di produksi sering, beberapa kali sehari), bot TIDAK mengirim kabar apa pun bahwa sesi berhenti, dan balasan seperti YA/angka/foto akan tidak dijawab — kata kunci <code class="kbd">LANJUT</code> adalah pintu masuk yang paling andal.</div>
                            </details>
                            <details class="qa">
                                <summary>Teknisi mengetik BATAL, lalu keesokan harinya bot menawarkan melanjutkan pelanggan yang katanya sudah dibatalkan. Kenapa?</summary>
                                <div class="qa-body">Kata <code class="kbd">batal</code> ditangani penjaga batal-universal yang menghentikan sesi tetapi tidak membuang draft PSB. Jadi sesi berhenti, draft tetap hidup 48 jam. Solusinya sederhana: saat bot menawarkan LANJUT/BARU, jawab <b>BARU</b> untuk membuang draft lama — bot lalu meminta kirim ulang <code class="kbd">#PSB</code> + foto KTP. Catat juga bahwa foto KTP pelanggan baru yang dikirim bersama <code class="kbd">#PSB</code> saat ada draft lama TIDAK diproses; harus dikirim ulang setelah memilih <b>BARU</b>.</div>
                            </details>
                            <details class="qa">
                                <summary>Bot melaporkan 'Welcome dikirim ke pelanggan' tapi pelanggan bilang tidak menerima apa-apa. Siapa yang salah?</summary>
                                <div class="qa-body">Kalimat itu adalah klaim, bukan bukti. Pengirimannya berjalan di latar setelah pemasangan selesai dan bisa gagal senyap — misalnya WhatsApp sedang tidak tersambung saat itu, atau nomor pelanggan tidak terdaftar di WhatsApp. Kebiasaan yang aman: setelah PSB selesai, cek langsung ke pelanggan apakah dia menerima nama &amp; sandi WiFi-nya. Kalau tidak, kirim ulang manual — dan perhatikan bahwa tombol 'kirim welcome' di halaman pelanggan memakai template yang TIDAK memuat nama &amp; sandi WiFi, jadi kredensialnya harus Anda sampaikan sendiri.</div>
                            </details>
                            <details class="qa">
                                <summary>Push modem gagal saat PSB dan bot bilang pesan ke pelanggan DITAHAN. Apa langkah saya?</summary>
                                <div class="qa-body">Ini perilaku yang benar — bot sengaja menahan agar pelanggan tidak menerima sandi WiFi yang belum berlaku. Yang harus dilakukan: set PPPoE dan WiFi di modem secara manual sampai benar-benar jalan, lalu sampaikan nama &amp; sandi WiFi ke pelanggan secara manual. Jangan mengandalkan tombol 'kirim welcome' di panel: tombol itu mengirim template tanpa kredensial WiFi, dan hanya bisa ditekan admin (teknisi yang memasang tidak bisa memicunya).</div>
                            </details>
                            <details class="qa">
                                <summary>Pelanggan PSB baru seharusnya gratis bulan pemasangan, tapi dia tetap muncul di daftar tagihan. Apa yang terjadi?</summary>
                                <div class="qa-body">Pencatatan gratis bulan pemasangan bersifat 'usaha terbaik' — kalau penulisannya gagal, prosesnya tetap dilanjutkan dan tidak ada peringatan ke teknisi maupun grup. Akibatnya pelanggan bisa kena pengingat, lalu masa tenggang, lalu ISOLIR untuk bulan yang dijanjikan gratis. Cara mengecek: setelah setiap PSB, buka /payment-status atau /gratis-bulan-ini untuk periode berjalan; kalau pelanggan itu masih terhitung belum bayar, tandai gratis manual di /gratis-bulan-ini.</div>
                            </details>
                            <details class="qa">
                                <summary>Saya mengedit teks pesan di panel Template tapi bagian baru yang katanya sudah ditambahkan tidak pernah muncul di pesan pelanggan. Kenapa?</summary>
                                <div class="qa-body">Karena template TERSIMPAN selalu mengalahkan teks bawaan di kode. Kalau pengembang menambahkan bagian baru di kode tetapi template tersimpan belum memuat slot itu, bagian tersebut dihitung sistem namun tidak pernah ikut terkirim. Perbaikannya: tambahkan slotnya di /templates pada key yang bersangkutan. Kasus seperti ini pernah tidak disadari selama berminggu-minggu.</div>
                            </details>
                            <details class="qa">
                                <summary>Saya menaikkan harga paket, tapi ada pelanggan yang harganya tidak berubah. Kenapa?</summary>
                                <div class="qa-body">Ada dua kemungkinan. (1) Pelanggan itu punya harga sendiri yang tersimpan di datanya, yang dipakai lebih dulu daripada harga katalog. (2) Nama paket pelanggan tidak persis sama dengan nama di /packages, sehingga harga katalog tidak pernah ketemu. Periksa nama paketnya di /users, dan pastikan tertulis persis seperti di /packages. Catat juga: harga 0 tidak bisa disimpan di /packages — nilai 0 dianggap kosong dan harga lama dipakai kembali.</div>
                            </details>
                            <details class="qa">
                                <summary>Pelanggan berpaket gratis (whitelist) kok tetap ditagih dan tetap diisolir?</summary>
                                <div class="qa-body">Kekebalan paket whitelist dicocokkan lewat NAMA PAKET pelanggan yang harus terdaftar di katalog /packages. Kalau nama paket di data pelanggan berbeda satu huruf pun dari katalog, kekebalannya batal dan pelanggan diperlakukan seperti pelanggan biasa. Samakan nama paketnya, lalu pastikan paket itu benar-benar dicentang Whitelist.</div>
                            </details>
                            <details class="qa">
                                <summary>Saya sudah membuka isolir pelanggan yang sudah bayar, tapi besoknya dia terisolir lagi. Kenapa?</summary>
                                <div class="qa-body">Membuka isolir hanya mengembalikan profil kecepatan; ia TIDAK mengubah status pembayaran. Selama tagihannya masih tercatat belum lunas, jadwal isolir otomatis akan memutusnya lagi. Urutan yang benar: tandai lunas di /payment-status (atau tandai gratis di /gratis-bulan-ini) DULU, baru buka isolir.</div>
                            </details>
                            <details class="qa">
                                <summary>Boleh tidak memberi kompensasi kecepatan ke pelanggan yang sedang terisolir?</summary>
                                <div class="qa-body">Jangan. Profil yang dikembalikan saat kompensasi berakhir diambil dari katalog paket, bukan dari profil yang sedang dipakai pelanggan. Jadi pelanggan terisolir yang diberi kompensasi akan langsung aktif, dan ketika kompensasi habis dia kembali ke profil paket (aktif) — isolirnya hilang selamanya tanpa jejak. Pastikan juga jadwal 'revert kompensasi' di /cron hidup; kalau mati, kecepatan tinggi tidak pernah kembali normal.</div>
                            </details>
                            <details class="qa">
                                <summary>Saya menekan Simpan di halaman IP Statik / Metode Pembayaran / ATM tapi tidak ada yang tersimpan. Rusak?</summary>
                                <div class="qa-body">Ketiga halaman itu praktis hanya-baca dan hapus: form Tambah/Edit mengirim ke endpoint simpan yang memang tidak ada di kode. Untuk profil statik, ubah langsung di MikroTik. Untuk metode pembayaran, yang benar-benar dipakai adalah pilihan CASH / TRANSFER_BANK di /payment-status dan gateway online di /config. Untuk saldo, gunakan /saldo-management — bukan /atm.</div>
                            </details>
                            <details class="qa">
                                <summary>Menu 'Panduan Admin' di sidebar error saat diklik. Ada apa?</summary>
                                <div class="qa-body">Route-nya sudah ada dan dipagari peran admin, tetapi berkas tampilannya belum dipasang di sistem — yang tersedia baru panduan teknisi (/teknisi-tutorial) dan panduan agen (/agen-tutorial). Sampai berkasnya dipasang, pakai halaman panduan ini sebagai rujukan.</div>
                            </details>
                            <details class="qa">
                                <summary>Teknisi mengetik `gaji saya` di WhatsApp tapi bot diam. Kenapa?</summary>
                                <div class="qa-body">Pada versi kode saat ini modul penanganan perintah itu tidak ikut terpasang di daftar perintah bot, walaupun kata kuncinya terdaftar — jadi perintahnya memang tidak dibalas. Sementara ini tunjukkan angkanya dari /gaji-teknisi, atau laporkan sebagai bug agar modulnya dipasang.</div>
                            </details>
                            <details class="qa">
                                <summary>Saya mengirim perintah ke bot tapi didiamkan total. Bagaimana mencari tahu sebabnya?</summary>
                                <div class="qa-body">Periksa tiga hal berurutan. (1) Kata kunci harus di AWAL pesan — 'min tolong cari budi' tidak dikenali, hanya 'cari budi'. (2) Nomor Anda harus lolos gerbang peran yang tepat: perintah warisan (alluser, allsaldo, statusap, &lt;topup) hanya untuk nomor owner di konfigurasi; perintah keputusan (bukti bayar, data isp, switch koneksi) butuh role admin/owner/superadmin di /accounts; perintah PSB butuh role yang diizinkan di setelan Intake PSB. (3) Beberapa fitur sengaja MENDIAMKAN nomor non-admin agar keberadaannya tidak bocor ke pelanggan. Pastikan nomor WhatsApp Anda benar-benar terdaftar di akun Anda di /accounts.</div>
                            </details>
                            <details class="qa">
                                <summary>Kenapa nomor telepon di akun teknisi begitu penting?</summary>
                                <div class="qa-body">Karena kolom itulah alamat pengiriman struk gaji, keputusan kasbon, dan DM penugasan PSB. Kalau kosong, semua aksi Anda tetap tercatat 'sukses' tetapi teknisi tidak pernah menerima apa pun — dan potongan kasbon di struk gaji datang sebagai kejutan. Isi nomornya di /accounts; boleh lebih dari satu, dipisah tanda |.</div>
                            </details>
                            <details class="qa">
                                <summary>Saya mengklik Finalisasi gaji dua kali karena layarnya lambat. Bahaya?</summary>
                                <div class="qa-body">Sekarang klik kedua ditolak. Tapi jangan dibiasakan: sebelum diperbaiki, klik ganda MENGOSONGKAN komisi teknisi secara permanen. Kalau layar terasa lambat, tunggu — jangan menekan lagi. Hal serupa berlaku untuk otorisasi pembayaran massal: prosesnya berjalan di latar, dan pengajuan kedua ditolak selama masih ada yang berjalan.</div>
                            </details>
                            <details class="qa">
                                <summary>Kenapa broadcast saya ditolak sebelum terkirim?</summary>
                                <div class="qa-body">Ada penjaga data internal: pesan yang memuat jumlah pelanggan terdampak, nama PPPoE, atau nama ODP/ODC ditolak sebelum satu pesan pun keluar — pemeriksaan dilakukan pada teks mentah maupun teks yang sudah jadi. Ini disengaja; pemilik sistem menilai bocornya data semacam itu ke pelanggan sebagai fatal. Tulis ulang kalimatnya dalam bahasa pelanggan ('ada gangguan di wilayah Anda'), jangan mencari cara menembusnya.</div>
                            </details>
                            <details class="qa">
                                <summary>Kenapa Auto Outage tiba-tiba tidak mengirim apa-apa padahal banyak pelanggan offline?</summary>
                                <div class="qa-body">Kemungkinan besar gerbang gangguan massal bekerja: bila jumlah calon penerima melewati ambang (bawaan 5), daftarnya dikosongkan dengan alasan gangguan massal. Ini justru perilaku yang benar — satu kabel putus tidak boleh menjadi puluhan pesan pribadi. Kalau memang perlu mengirim, gunakan /broadcast dengan pesan yang tepat untuk kondisi gangguan area, atau paksa secara sadar. Jangan mematikan gerbangnya.</div>
                            </details>
                            <details class="qa">
                                <summary>Kenapa layar OLT penuh tanda tanya? Apakah gangguan massal?</summary>
                                <div class="qa-body">Bukan. Tanda '?' berarti OLT tidak menjawab sehingga status modem TIDAK BISA DIBACA — dan baris seperti itu sengaja tidak dihitung sebagai offline. 'Tidak bisa dilihat' tidak sama dengan 'terbukti mati'. Periksa dulu apakah OLT-nya terjangkau sebelum menyimpulkan apa pun, dan jangan mengirim pesan gangguan ke pelanggan berdasarkan layar yang penuh tanda tanya.</div>
                            </details>
                            <details class="qa">
                                <summary>Bedanya LOS dan Dying-Gasp apa, dan kenapa saya perlu peduli?</summary>
                                <div class="qa-body">LOS = dugaan kabel fiber putus, tindakannya kirim teknisi. Dying-Gasp = modem melapor sebelum mati karena listrik padam, tindakannya tunggu PLN. Salah membaca keduanya mahal: banjir laporan Dying-Gasp saat mati listrik massal pernah salah dibaca sebagai LOS, dan tim berangkat untuk masalah yang tidak ada. Sistem sudah punya gerbang mati-listrik-area yang membuang alarm LOS yang dikelilingi kluster Dying-Gasp — tapi saat membaca /olt-log manual, Anda perlu membedakannya sendiri.</div>
                            </details>
                            <details class="qa">
                                <summary>Angka 'sudah bayar' di Dashboard berbeda dengan halaman Status Pembayaran. Mana yang benar?</summary>
                                <div class="qa-body">Percayai halaman pembayaran. Kartu di Dashboard membaca penanda cepat di data pelanggan yang sifatnya hanya salinan; sumber kebenarannya adalah buku besar di /payment-status (dan /rekap-keuangan untuk gambaran lengkap). Kalau selisihnya besar dan tidak masuk akal, telusuri di /rekap-keuangan bagian Diagnostics.</div>
                            </details>
                            <details class="qa">
                                <summary>Saya sudah menyalakan komisi teknisi tapi komisi penarikan minggu lalu tidak muncul. Bisa dihitung ulang?</summary>
                                <div class="qa-body">Tidak. Fee dikreditkan pada saat pembayaran dinyatakan lunas, bukan dihitung mundur. Penagihan yang sudah terlanjur diotorisasi sebelum sakelar dinyalakan tidak akan pernah dihitung. Karena itu nyalakan komisi SEBELUM mulai mengotorisasi. Untuk komisi yang sudah terlanjur hilang, bayarkan di luar sistem dan catat sebagai pengeluaran, atau gunakan mekanisme tutup komisi historis di /gaji-teknisi (yang bukan pembayaran, hanya penutupan catatan).</div>
                            </details>
                            <details class="qa">
                                <summary>Perintah `kas 150rb kabel` saya tidak dijawab bot. Kenapa?</summary>
                                <div class="qa-body">Fitur kas hanya jalan di GRUP kas yang sudah dikonfigurasi dan hanya dari nomor yang terdaftar sebagai PEMILIK kas — bukan di chat pribadi bot, dan bukan dari admin lain. Periksa di /kas-usaha bahwa grup sudah dipilih dan pemilik sudah ditentukan. Perlu diingat juga: sakelar kas HARUS diubah lewat halaman itu (yang menjadwalkan ulang otomatis); mengedit berkas konfigurasi langsung di server menghasilkan sukses semu — layar bilang aktif, nol pesan terkirim.</div>
                            </details>
                            <details class="qa">
                                <summary>Boleh saya menyalin config.json dari server lain supaya cepat?</summary>
                                <div class="qa-body">Jangan pernah. Di server produksi, konfigurasi dan template disunting per-kunci karena tiap lokasi punya kredensial, grup WhatsApp, dan kalimat sendiri. Menimpanya dengan salinan dari mesin lain menghapus penyesuaian itu tanpa jejak. Ubahlah lewat halaman /config dan /templates, kunci per kunci.</div>
                            </details>
                            <details class="qa">
                                <summary>Apa yang harus saya periksa setiap pagi?</summary>
                                <div class="qa-body">Buka /owner untuk gambaran sekali-baca (pemasukan, tunggakan, status ISP, tiket, pipeline PSB, gangguan OLT). Lalu: /konfirmasi-bayar untuk bukti transfer yang menunggu, /admin/daftar-tiket untuk tiket menggantung, /papan-psb untuk pemasangan yang belum dikerjakan, dan /pembayaran/otorisasi bila teknisi/agen menyetorkan hasil tagihan. Ingat: kartu kosong di /owner berarti 'tak bisa dibaca', bukan 'nol'.</div>
                            </details>
                            <details class="qa">
                                <summary>Halaman apa yang paling berbahaya dan sebaiknya saya hindari sampai paham betul?</summary>
                                <div class="qa-body">Tiga besar: (1) /migrate — mengunggah database MENIMPA seluruh data pelanggan, dan endpointnya hanya bergerbang 'staf' sehingga akun teknisi pun bisa memakainya; (2) 'Delete All Users' di /users — menghapus semua pelanggan; (3) /custom-isolir dan /kompensasi — keduanya menyentuh router dan bisa memutus atau salah-memulihkan layanan. Tambahan: /admin-olt-provision menulis konfigurasi ke perangkat inti fiber; selalu pakai pratinjau sebelum eksekusi.</div>
                            </details>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <?php // Panduan admin = dokumen RUJUKAN 29 layar / 16 bagian / 85 kartu, jadi ia butuh
          // perancah navigasi sendiri (cari, lompat bagian, penanda posisi, kembali ke atas)
          // yang tidak diperlukan panduan teknisi/agen yang 10x lebih pendek. ?>
    <script src="<?= rafAssetUrl('/js/admin-tutorial.js') ?>"></script>
</body>

</html>
