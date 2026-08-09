/**
 * Header Doc
 * Purpose: Mengunci perbaikan "keluhan pelanggan menguap". Tiga pintu masuk keluhan bebas
 *          (`states/other-state-handler`, `customer-handler`, `steps/general-steps`) dulu sama-sama
 *          hanya `console.log("[NEW_COMPLAINT]", …)` lalu membalas ID hasil `Date.now()` disertai
 *          janji "Anda akan menerima notifikasi untuk update selanjutnya" — padahal tak ada yang
 *          tersimpan, tak masuk papan teknisi, dan tak bisa dicek. Sekarang ketiganya melewati SATU
 *          pemilik (`lib/report-orchestration-service.createCustomerComplaintTicket`) yang membuat
 *          TIKET NYATA, dan janji tindak lanjut hanya diberikan bila tiketnya benar-benar jadi.
 * Caller: Jest (`npx jest message/handlers/__tests__/complaint-becomes-real-ticket.test.js`).
 * Deps: fs/path (scan statis 3 pintu masuk) + `lib/report-orchestration-service` (kontrak ekspor).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..');
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), 'utf8');

const PINTU = [
    ['state AWAITING_COMPLAINT', ['message', 'handlers', 'states', 'other-state-handler.js']],
    ['intent KELUHAN_SARAN', ['message', 'handlers', 'customer-handler.js']],
    ['step legacy general', ['message', 'handlers', 'steps', 'general-steps.js']]
];

describe('keluhan pelanggan menjadi TIKET NYATA, bukan console.log', () => {
    test('pemilik tunggal tersedia & diekspor', () => {
        const svc = require(path.join(REPO, 'lib', 'report-orchestration-service'));
        expect(typeof svc.createCustomerComplaintTicket).toBe('function');
    });

    test.each(PINTU)('%s memanggil pemilik tunggal', (_label, segments) => {
        expect(baca(...segments)).toMatch(/createCustomerComplaintTicket\(/);
    });

    test.each(PINTU)('%s tidak lagi membuang keluhan ke console.log', (_label, segments) => {
        expect(baca(...segments)).not.toMatch(/console\.log\(\s*['"]\[NEW_COMPLAINT\]/);
    });

    test.each(PINTU)('%s tidak lagi memakai ID palsu Date.now() sebagai nomor keluhan', (_label, segments) => {
        const src = baca(...segments);
        expect(src).not.toMatch(/id:\s*Date\.now\(\)\.toString\(\)/);
    });

    test.each(PINTU)('%s BERHENTI menjanjikan tindak lanjut saat penyimpanan gagal', (_label, segments) => {
        const src = baca(...segments);
        // Harus ada cabang eksplisit untuk hasil.ok === false.
        expect(src).toMatch(/(!hasil\w*\.ok|hasil\w*\.ok\s*===\s*false)/);
    });

    test('pemilik tunggal NEVER-THROW: kegagalan dilaporkan lewat ok:false, bukan exception', () => {
        const src = baca('lib', 'report-orchestration-service.js');
        const idx = src.indexOf('async function createCustomerComplaintTicket');
        expect(idx).toBeGreaterThan(-1);
        const blok = src.slice(idx, idx + 3200);
        expect(blok).toMatch(/try\s*\{/);
        expect(blok).toMatch(/catch\s*\(/);
        expect(blok).toMatch(/return\s*\{\s*ok:\s*false/);
        // Tiket dibuat lewat jalur resmi supaya dapat ticketId asli + notifikasi admin.
        expect(blok).toMatch(/createCustomerReportTicket\(/);
        expect(blok).toMatch(/notifyAdmins:\s*true/);
    });

    test('template tanda terima memberi nomor tiket ASLI + cara mengeceknya', () => {
        const t = require(path.join(REPO, 'database', 'response_templates.json'));
        const teks = String(t.general_complaint_received.template || t.general_complaint_received);
        expect(teks).toMatch(/\$\{complaintId\}/);
        expect(teks).toMatch(/cek tiket/i);
        // Janji lama yang tak bisa ditepati sudah tidak ada.
        expect(teks).not.toMatch(/akan menerima notifikasi untuk update selanjutnya/i);
    });

    test('template kegagalan ada, dan tidak menjanjikan tindak lanjut', () => {
        const t = require(path.join(REPO, 'database', 'response_templates.json'));
        const teks = String(t.general_complaint_failed.template || t.general_complaint_failed);
        expect(teks.length).toBeGreaterThan(20);
        expect(teks).toMatch(/admin/i);
        expect(teks).not.toMatch(/menindaklanjuti/i);
    });
});

describe('koreksi regresi: tiket keluhan tak boleh merusak alur lain', () => {
    const REPO2 = path.join(__dirname, '..', '..', '..');
    const bacaR = (...p) => fs.readFileSync(path.join(REPO2, ...p), 'utf8');

    test('tiket keluhan ditandai source:"keluhan" agar bisa dibedakan', () => {
        const src = bacaR('lib', 'report-orchestration-service.js');
        const idx = src.indexOf('async function createCustomerComplaintTicket');
        expect(src.slice(idx, idx + 2600)).toMatch(/source:\s*'keluhan'/);
    });

    test('hasActiveReport MENGABAIKAN tiket keluhan — pintu lapor gangguan tetap terbuka', () => {
        const { hasActiveReport } = require(path.join(REPO2, 'lib', 'report-helper'));
        const keluhan = { pelangganUserId: 7, status: 'baru', source: 'keluhan', ticketId: 'KEL0001' };
        const gangguan = { pelangganUserId: 7, status: 'baru', issueType: 'MATI', ticketId: 'GGN0001' };

        // Hanya ada tiket keluhan → pelanggan TETAP boleh melapor gangguan.
        expect(hasActiveReport(7, [keluhan])).toBeFalsy();
        // Tiket gangguan aktif → gerbang tetap bekerja seperti semula.
        expect(hasActiveReport(7, [gangguan])).toBeTruthy();
        // Campuran → yang ditemukan harus tiket gangguannya.
        expect(hasActiveReport(7, [keluhan, gangguan]).ticketId).toBe('GGN0001');
    });

    test('issueType KELUHAN juga dikenali walau penanda source hilang', () => {
        const { hasActiveReport } = require(path.join(REPO2, 'lib', 'report-helper'));
        expect(hasActiveReport(7, [{ pelangganUserId: 7, status: 'baru', issueType: 'KELUHAN' }])).toBeFalsy();
    });

    test('ada pembatas satu keluhan TERBUKA per pelanggan (anti banjir tiket & notifikasi)', () => {
        const src = bacaR('lib', 'report-orchestration-service.js');
        const idx = src.indexOf('async function createCustomerComplaintTicket');
        const blok = src.slice(idx, idx + 2600);
        expect(blok).toMatch(/global\.reports/);
        expect(blok).toMatch(/existing:\s*true/);
    });
});

describe('koreksi regresi: promosi timeout HANYA di step lampiran', () => {
    const textMenu = fs.readFileSync(
        path.join(__dirname, '..', 'smart-report-text-menu.js'), 'utf8'
    );

    test('hanya REPORT_MATI_PHOTO yang didaftarkan', () => {
        const cocok = textMenu.match(/registerStateTimeoutHandler\(\s*'([A-Z_]+)'/g) || [];
        expect(cocok.length).toBe(1);
        expect(cocok[0]).toContain('REPORT_MATI_PHOTO');
    });

    test('step KEPUTUSAN tidak didaftarkan — diam bukan persetujuan', () => {
        for (const step of ['REPORT_LEMOT_ANALYSIS', 'REPORT_LEMOT_CONFIRM', 'CONFIRM_MATI_REPORT']) {
            expect(textMenu).not.toMatch(new RegExp(`registerStateTimeoutHandler\\(\\s*'${step}'`));
        }
    });
});
