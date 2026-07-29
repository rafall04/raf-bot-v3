/**
 * Header Doc
 * Purpose: Menahan regresi "grafik trafik tidak realtime". Akarnya BUKAN interval klien
 *          (sudah berkali-kali disetel dan tetap meleset), melainkan ketidakcocokan
 *          biaya: grafik memanggil `/api/monitoring/live` yang menjalankan 18 perintah
 *          RouterOS (terukur 11,0 / 11,0 / 11,3 detik di produksi 29-07-2026) sementara
 *          fetch-nya membatalkan diri di 8 detik — jadi TIDAK SATU pun titik data
 *          pernah sampai, dan yang tergambar cuma nol karangan dari pemulih "stuck".
 *          Test ini mengunci tiga hal yang bila salah satunya balik, bug-nya kembali:
 *          endpoint ringan tetap ringan, klien menunjuk ke sana, dan batas waktunya
 *          di atas biaya endpoint-nya.
 * Caller: Jest (`npm test`).
 * Deps: routes/monitoring-api.js, views/api-monitoring-traffic.php,
 *       static/js/monitoring-controller.js — dibaca sebagai teks (guard statis,
 *       tanpa Express, PHP, atau MikroTik).
 * MainFuncs: -
 * SideEffects: Hanya membaca berkas.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..', '..');
const baca = (p) => fs.readFileSync(path.join(AKAR, p), 'utf8');

const RUTE = baca('routes/monitoring-api.js');
const PHP = baca('views/api-monitoring-traffic.php');
const KLIEN = baca('static/js/monitoring-controller.js');

describe('endpoint trafik ringan', () => {
    test('/api/monitoring/traffic menunjuk berkas ringan, bukan pemilik lama yang yatim', () => {
        expect(RUTE).toContain("executePHP('api-monitoring-traffic.php', req, res)");
        // Yang dilarang adalah PENGIRIMAN ke berkas lama, bukan penyebutannya —
        // komentar di rute sengaja masih menamainya agar sejarahnya tak hilang.
        expect(RUTE).not.toContain("executePHP('api-traffic-stats.php'");
        expect(fs.existsSync(path.join(AKAR, 'views', 'api-traffic-stats.php'))).toBe(false);
    });

    test('endpoint trafik tetap RINGAN — maksimal 2 perintah RouterOS', () => {
        // Inti perbaikannya adalah biaya. Kalau nanti ada yang menambah /queue/print
        // atau /ip/arp/print ke sini "karena sekalian", grafiknya lambat lagi.
        const perintah = PHP.match(/\$API->comm\(/g) || [];
        expect(perintah.length).toBeLessThanOrEqual(2);
        expect(PHP).toContain("/interface/monitor-traffic");
    });

    test('endpoint memakai pembagi desimal 1e6, bukan 2^20', () => {
        // 1048576 membuat angka ~4,86% lebih rendah daripada yang ditampilkan Winbox.
        expect(PHP).toContain('/ 1000000');
        expect(PHP).not.toContain('1048576');
    });

    test('bentuk balasan sama dengan blok traffic milik /live (klien tak perlu diubah)', () => {
        expect(PHP).toMatch(/'traffic'\s*=>\s*\[/);
        expect(PHP).toMatch(/'download'\s*=>\s*\[/);
        expect(PHP).toMatch(/'upload'\s*=>\s*\[/);
        expect(PHP).toMatch(/'current'\s*=>/);
        expect(PHP).toMatch(/'total'\s*=>/);
    });

    test('gagal baca TIDAK dilaporkan sebagai angka 0', () => {
        // "Tidak bisa mengamati" bukan "diamati nol" (CLAUDE.md). Nol yang dikirim
        // sebagai data sah akan tergambar sebagai trafik benar-benar mati.
        expect(PHP).toMatch(/if \(!\$interfaceDitemukan && !\$monitorBerhasil\)/);
        expect(PHP).toContain('kirim_galat');
    });
});

describe('klien grafik trafik', () => {
    test('mengambil dari endpoint ringan, bukan /api/monitoring/live', () => {
        expect(KLIEN).toContain("'/api/monitoring/traffic'");
        expect(KLIEN).toContain('/api/monitoring/traffic?interface=');
    });

    test('batas abort di ATAS biaya endpoint (endpoint ~0,2 detik)', () => {
        // Bug aslinya persis di sini: batas 8 detik pada endpoint 11 detik.
        const m = KLIEN.match(/setTimeout\(\(\) => controller\.abort\(\), (\d+)\)/g) || [];
        expect(m.length).toBeGreaterThan(0);
        m.forEach((baris) => {
            const ms = parseInt(baris.match(/(\d+)\)$/)[1], 10);
            expect(ms).toBeGreaterThanOrEqual(2000);
        });
    });

    test('pemulih stuck menggambar JEDA (null), bukan titik 0 palsu', () => {
        const blok = KLIEN.slice(KLIEN.indexOf('recoverStuckTrafficChart() {'));
        const potongan = blok.slice(0, blok.indexOf('Metode 2') > 0 ? blok.indexOf('Metode 2') : 2000);
        expect(potongan).toContain('datasets[0].data.push(null)');
        expect(potongan).toContain('datasets[1].data.push(null)');
        expect(potongan).not.toContain('datasets[0].data.push(0)');
        expect(potongan).not.toContain('datasets[1].data.push(0)');
    });

    test('dataset Download dan Upload TIDAK berbagi satu array', () => {
        // Bug terukur di produksi 29-07-2026: `const emptyData = new Array(...).fill(0)`
        // dipasang ke datasets[0].data DAN datasets[1].data, jadi keduanya objek yang
        // sama. Setiap pembaruan mendorong dua angka ke satu array → panjang data 42
        // sementara label 11, Chart.js menggambar 11 entri TERTUA, dan garis Upload
        // sebenarnya berisi download+upload berselang-seling.
        const blok = KLIEN.slice(
            KLIEN.indexOf('async fetchTrafficHistory()'),
            KLIEN.indexOf('async fetchTrafficHistory()') + 1600
        );
        expect(blok).not.toMatch(/datasets\[0\]\.data = (\w+);[\s\S]{0,400}?datasets\[1\]\.data = \1;/);
        // Dan tidak menyemai angka 0 palsu saat MikroTik belum terhubung.
        expect(blok).not.toContain('.fill(0)');
        expect(blok).toContain('datasets[0].data = []');
        expect(blok).toContain('datasets[1].data = []');
    });

    test('label dan kedua dataset selalu digeser/didorong bersama', () => {
        // Kalau salah satu di-shift tanpa yang lain, desync label-vs-data kembali.
        const blok = KLIEN.slice(KLIEN.indexOf('const maxDataPoints = 30;'));
        const potongan = blok.slice(0, 700);
        ['labels.shift()', 'datasets[0].data.shift()', 'datasets[1].data.shift()',
            'labels.push(timeString)', 'datasets[0].data.push(downloadCurrent)',
            'datasets[1].data.push(uploadCurrent)'].forEach((baris) => {
            expect(potongan).toContain(baris);
        });
    });

    test('konfigurasi grafik memakai sintaks Chart.js v2 (pustaka terpasang v2.9.4)', () => {
        // `static/vendor/chart.js/Chart.min.js` = v2.9.4. v2 MENGABAIKAN kunci v3/v4
        // tanpa peringatan, jadi seluruh pengaturan sumbu diam-diam mati: terbukti di
        // runtime kunci skalanya `x-axis-0`/`y-axis-0`, `beginAtZero` tak berlaku
        // (sumbu terukur 60-220, bukan dari 0) dan `maxRotation:0` tak berlaku
        // (label waktu miring & berjejal). Itulah "alur trafiknya tidak jelas".
        const opsi = KLIEN.slice(KLIEN.indexOf('options: {'), KLIEN.indexOf('console.log(\'[Monitoring] Traffic chart initialized'));
        // Bentuk v2 yang WAJIB ada
        expect(opsi).toContain('yAxes: [{');
        expect(opsi).toContain('xAxes: [{');
        expect(opsi).toContain('gridLines:');
        expect(opsi).toContain('scaleLabel:');
        expect(opsi).toContain('beginAtZero: true');
        expect(opsi).toMatch(/^\s{16}legend: \{/m);
        expect(opsi).toMatch(/^\s{16}tooltips: \{/m);
        // Bentuk v3/v4 yang TIDAK boleh kembali
        expect(opsi).not.toMatch(/\n\s+y: \{\s*\n\s+beginAtZero/);
        expect(opsi).not.toContain('plugins: {');
        expect(opsi).not.toContain('interaction: {');
        expect(opsi).not.toContain('transitions: {');
    });

    test('dataset memakai lineTension (v2), bukan tension (v3)', () => {
        const data = KLIEN.slice(KLIEN.indexOf("label: 'Download'"), KLIEN.indexOf('options: {'));
        expect(data).toContain('lineTension:');
        expect(data).not.toMatch(/\n\s+tension:/);
    });

    test('update() memakai objek konfigurasi v2, bukan string mode v3', () => {
        // `update('none')` di v2 bukan "tanpa animasi" — stringnya tak dikenal, jadi
        // animasi 800ms tetap jalan. Grafik yang menyegar tiap 5 detik lalu terus
        // berubah bentuk dan tak pernah diam.
        expect(KLIEN).not.toContain(".update('none')");
        expect(KLIEN).not.toContain(".update('default')");
        expect(KLIEN).toContain('.update({ duration: 0 })');
    });

    test('hanya Download yang diisi; Upload garis polos agar keduanya terbaca', () => {
        const ul = KLIEN.slice(KLIEN.indexOf("label: 'Upload'"), KLIEN.indexOf('options: {'));
        expect(ul).toContain('fill: false');
    });

    test('warna sumbu grafik dibaca dari token tema, bukan warna tetap', () => {
        // Chart.js melukis ke <canvas> → tak ikut var(). Kalau warnanya dipatok,
        // legenda #374151 jadi gelap-di-atas-gelap begitu mode gelap dinyalakan.
        expect(KLIEN).toContain('warnaGrafik()');
        expect(KLIEN).toContain("ambil('--muted'");
        expect(KLIEN).toContain("ambil('--ink-soft'");
        expect(KLIEN).toContain('pantauTemaGrafik()');
    });

    test('dataset trafik memakai spanGaps:false agar jeda benar-benar terlihat', () => {
        // Kalau ini berubah jadi true, `null` disambung diam-diam dan jeda datanya
        // tersembunyi lagi — persis kelemahan yang baru saja dibereskan.
        expect(KLIEN).toContain('spanGaps: false');
    });
});
