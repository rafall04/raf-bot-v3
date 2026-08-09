/**
 * Header Doc
 * Purpose: Guard — teks GANGGUAN yang dibaca PELANGGAN tidak boleh memuat data internal, terutama
 *          JUMLAH PELANGGAN TERDAMPAK. Saat gangguan massal angka itu nyaris sama dengan total
 *          pelanggan, jadi menyebutkannya sama dengan mengumumkan skala usaha ke setiap orang yang
 *          mengetik "cek koneksi". Pemilik menyebut kebocoran ini "fatal" (lihat #b188, #b191).
 *          Guard ini menutup jalur-jalur yang TIDAK melewati `services/admin-broadcast.service.js`
 *          (satu-satunya pemakai runtime `customer-text-guard`): cek koneksi, auto-outage/GAMAS,
 *          dan notifikasi LOS ke pelanggan.
 * Caller: Jest (`npm test`, atau `npx jest lib/__tests__/customer-outage-text-no-leak.test.js`).
 * Deps: `../customer-text-guard`, `database/response_templates.json` (read-only).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */
'use strict';

const path = require('path');
const { findCustomerTextLeaks, describeLeaks } = require('../customer-text-guard');
const templates = require(path.join(__dirname, '..', '..', 'database', 'response_templates.json'));

// Prefix key yang PASTI dibaca pelanggan pada konteks gangguan. Sengaja berbasis prefix (bukan
// daftar key manual) supaya key baru di keluarga yang sama ikut terjaring otomatis.
const PREFIX_PELANGGAN = [
    'conncheck_',      // balasan "cek koneksi"
    'auto_outage_',    // triase gangguan otomatis
    'broadcast_gamas_' // broadcast gangguan massal
];

function ambilTeks(v) {
    return typeof v === 'string' ? v : (v && v.template) || '';
}

function keyPelanggan() {
    return Object.keys(templates).filter((k) => PREFIX_PELANGGAN.some((p) => k.startsWith(p)));
}

describe('teks gangguan ke pelanggan bebas data internal', () => {
    test('ada template yang benar-benar diperiksa (anti guard yang diam-diam kosong)', () => {
        expect(keyPelanggan().length).toBeGreaterThanOrEqual(8);
    });

    test.each(keyPelanggan())('%s tidak membocorkan data internal', (key) => {
        const leaks = findCustomerTextLeaks(ambilTeks(templates[key]));
        expect(leaks.length === 0 ? '' : describeLeaks(leaks)).toBe('');
    });

    test('tak satu pun menyebut jumlah PELANGGAN (angka soal perangkat pelanggan sendiri tetap boleh)', () => {
        // Pembedaannya penting: `${jumlah_perangkat} perangkat terhubung` di `conncheck_modem_line`
        // adalah info soal WiFi PELANGGAN ITU SENDIRI — berguna, dan bukan kebocoran. Yang dilarang
        // adalah angka yang menghitung PELANGGAN LAIN.
        const tersangka = [];
        for (const key of keyPelanggan()) {
            const teks = ambilTeks(templates[key]);
            if (/(?:\$\{|\{)\s*[a-z_]*(?:jumlah|count|total|jml)[a-z_]*\s*\}\s*(?:orang\s+)?pelanggan\b/i.test(teks)) {
                tersangka.push(key);
            }
            if (/\b\d+\s*(?:orang\s+)?pelanggan\b/i.test(teks)) tersangka.push(key);
        }
        expect(tersangka).toEqual([]);
    });
});

describe('penjaga mengenali KEDUA dialek slot yang dipakai repo ini', () => {
    // `${...}` = response_templates.json; `{...}` = template di config.json yang diedit ops
    // (cctvMonitor.message*, oltLosBroadcast.notifyCustomer.messageTemplate).
    test.each([
        ['${jumlah} pelanggan terdampak'],
        ['{jumlah} pelanggan terdampak'],
        ['{count} pelanggan sedang terdampak'],
        ['Saat ini 47 pelanggan terdampak']
    ])('menangkap: %s', (teks) => {
        expect(findCustomerTextLeaks(teks).length).toBeGreaterThan(0);
    });

    test('slot identitas port OLT yang ditawarkan ke pesan pelanggan ikut terjaring', () => {
        // `lib/olt-los-broadcaster.buildCustomerMessage` menyediakan {mac}/{slot}/{onu}.
        for (const teks of ['Perangkat {mac} bermasalah', 'Port {slot}/{onu} putus']) {
            expect(findCustomerTextLeaks(teks).length).toBeGreaterThan(0);
        }
    });

    test('TIDAK salah-tuduh kalimat wajar', () => {
        const aman = [
            'Halo Kak {customer_name}, jaringan di area Anda sedang terganggu',
            '{count} CCTV terdeteksi mati bersamaan',
            'Terdeteksi gangguan pada jaringan di area Anda. Tim teknisi sedang menanganinya.'
        ];
        for (const teks of aman) {
            expect(findCustomerTextLeaks(teks)).toEqual([]);
        }
    });
});
