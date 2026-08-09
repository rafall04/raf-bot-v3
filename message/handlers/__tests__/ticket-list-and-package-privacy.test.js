/**
 * Header Doc
 * Purpose: Mengunci tiga perbaikan kecil tapi berdampak:
 *          (1) `list tiket` teknisi memakai `normalizeStatus` (satu pemilik status tiket) — dulu
 *              menyaring `'pending'`/`'open'` yang TIDAK PERNAH ada di data, sehingga selalu
 *              menjawab "tidak ada tiket" walau antrean gangguan menumpuk;
 *          (2) balasan `cek paket` ke PELANGGAN tidak memuat device-id GenieACS dan memakai
 *              `displayProfile` ("Up To 10Mbps"), bukan nama profil MikroTik internal ("12Mbps");
 *          (3) nominal di jalur penagihan memakai `getEffectivePrice` (satu sumber dengan ledger),
 *              bukan `packages.json.price` mentah yang salah untuk pelanggan berharga khusus/diskon.
 * Caller: Jest (`npx jest message/handlers/__tests__/ticket-list-and-package-privacy.test.js`).
 * Deps: fs/path (scan statis), `lib/ticket-workflow` (normalizeStatus), `../customer-handler`.
 * MainFuncs: -
 * SideEffects: Set global.packages/global.users sementara.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..');
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), 'utf8');

const { normalizeStatus, ensureTicketShape } = require(path.join(REPO, 'lib', 'ticket-workflow'));

describe('list tiket: status disaring lewat satu pemilik kebenaran', () => {
    const src = baca('message', 'handlers', 'raf-intent-dispatch', 'ticket-teknisi-intents.js');

    test('tidak ada lagi daftar string mentah pending/open', () => {
        expect(src).not.toMatch(/r\.status\s*===\s*'pending'/);
        expect(src).not.toMatch(/r\.status\s*===\s*'open'/);
    });

    test('memakai normalizeStatus dari lib/ticket-workflow', () => {
        expect(src).toMatch(/normalizeStatus\(r\.status\)\s*===\s*'baru'/);
        expect(src).toMatch(/require\(["']\.\.\/\.\.\/\.\.\/lib\/ticket-workflow["']\)/);
    });

    test('premis temuan: tiket baru berstatus "baru", dan "pending"/"open" tak pernah bertahan', () => {
        // Sengaja TIDAK memanggil createBaseTicket — fungsi itu menulis ke database/reports.json.
        // Yang membuktikan premisnya adalah sumber + normalisasi status yang bebas efek samping.
        const workflowSrc = baca('lib', 'ticket-workflow.js');
        expect(workflowSrc).toMatch(/status:\s*'baru'/);

        // Status di luar daftar final dipaksa kembali ke 'baru' → 'pending'/'open' mustahil ada.
        expect(normalizeStatus(undefined)).toBe('baru');
        expect(ensureTicketShape({ ticketId: 'T1', status: 'pending' }).status).toBe('baru');
        expect(ensureTicketShape({ ticketId: 'T2', status: 'open' }).status).toBe('baru');
        expect(ensureTicketShape({ ticketId: 'T3', status: 'baru' }).status).toBe('baru');
    });
});

describe('cek paket: balasan pelanggan bebas identitas internal', () => {
    const { handleCheckPackage } = require('../customer-handler');

    beforeEach(() => {
        global.packages = [
            { name: 'PAKET-110K', price: 110000, profile: '12Mbps', displayProfile: 'Up To 10Mbps' }
        ];
    });

    test('device-id GenieACS TIDAK muncul di pesan pelanggan', () => {
        const out = handleCheckPackage({
            user: { name: 'Budi', subscription: 'PAKET-110K', device_id: '202BC1-Device2-ABC123' },
            pushname: 'Budi'
        });
        expect(out.success).toBe(true);
        expect(out.message).not.toContain('202BC1');
        expect(out.message).not.toMatch(/Device ID/i);
    });

    test('kecepatan memakai displayProfile, bukan nama profil MikroTik', () => {
        const out = handleCheckPackage({
            user: { name: 'Budi', subscription: 'PAKET-110K', device_id: 'DEV-1' },
            pushname: 'Budi'
        });
        expect(out.message).toContain('Up To 10Mbps');
        expect(out.message).not.toMatch(/\*Kecepatan:\*\s*12Mbps/);
    });

    test('paket tanpa displayProfile tetap menampilkan sesuatu (tidak jadi kosong)', () => {
        global.packages = [{ name: 'PAKET-LAMA', price: 90000, profile: '8Mbps' }];
        const out = handleCheckPackage({
            user: { name: 'Sri', subscription: 'PAKET-LAMA' },
            pushname: 'Sri'
        });
        expect(out.message).toContain('8Mbps');
    });
});

describe('nominal penagihan memakai harga efektif di SEMUA jalur', () => {
    const JALUR = [
        ['cron reminder', ['lib', 'cron', 'jobs', 'reminder.js']],
        ['cron masa tenggang', ['lib', 'cron', 'jobs', 'grace-reminder.js']],
        ['balasan cek tagihan (WA)', ['message', 'handlers', 'billing-management-handler.js']],
        ['halaman bayar (nominal di-charge)', ['routes', 'bill-payment.js']]
    ];

    test.each(JALUR)('%s memakai harga efektif (langsung atau lewat resolveBillingAmount)', (_label, segments) => {
        const src = baca(...segments);
        expect(src).toMatch(/getEffectivePrice|resolveBillingAmount/);
        // Harga paket mentah tak boleh lagi jadi sumber nominal.
        expect(src).not.toMatch(/harga:\s*packageInfo\.price/);
    });

    test('halaman bayar: nominal di-charge = SISA tagihan, bertumpu harga efektif', () => {
        const src = baca('routes', 'bill-payment.js');
        // Harga efektif tetap jadi dasar (paket hilang → 0, tak menagih angka tebakan)…
        expect(src).toMatch(/const\s+hargaEfektif\s*=\s*paketHilang\s*\?\s*0\s*:\s*getEffectivePrice\(user\)/);
        // …lalu dikurangi cicilan yang sudah masuk ledger.
        expect(src).toMatch(/getPaymentPositionForPeriod\(/);
        expect(src).toMatch(/amount\s*=\s*Math\.max\(0,\s*Number\(posisi\.outstanding\)\)/);
    });

    test('halaman bayar GAGAL-TERTUTUP: ledger tak terbaca → pakai harga efektif, bukan menebak', () => {
        const src = baca('routes', 'bill-payment.js');
        const idx = src.indexOf('getPaymentPositionForPeriod(');
        const blok = src.slice(Math.max(0, idx - 700), idx + 700);
        expect(blok).toMatch(/let\s+amount\s*=\s*hargaEfektif/);
        expect(blok).toMatch(/catch\s*\(posErr\)/);
    });

    test('cron penagihan membedakan nol yang SAH dari nol karena katalog tak terbaca', () => {
        // Kalau tidak dibedakan, satu katalog yang gagal dibaca akan menghentikan SELURUH
        // penagihan diam-diam — kegagalan yang jauh lebih mahal daripada salah nominal.
        for (const segments of [['lib', 'cron', 'jobs', 'reminder.js'], ['lib', 'cron', 'jobs', 'grace-reminder.js']]) {
            const src = baca(...segments);
            expect(src).toMatch(/tagihan\.zeroIsReal/);
            expect(src).toMatch(/katalog-tak-terbaca/);
        }
    });

    test('resolveBillingAmount: nol SAH vs nol BUTA dibedakan', () => {
        const { resolveBillingAmount } = require(path.join(REPO, 'lib', 'payment-finance-service'));
        global.packages = [{ name: 'PAKET-110K', price: 110000 }];

        // Diskon penuh → nol yang SAH (jangan ditagih).
        const diskonPenuh = resolveBillingAmount({ subscription: 'PAKET-110K', discount_percentage: 100 }, 110000);
        expect(diskonPenuh).toMatchObject({ amount: 0, zeroIsReal: true });

        // Paket tak dikenal price-owner, tapi pemanggil punya harganya → JANGAN berhenti menagih.
        const buta = resolveBillingAmount({ subscription: 'PAKET-ENTAH' }, 150000);
        expect(buta).toMatchObject({ amount: 150000, zeroIsReal: false, reason: 'katalog-tak-terbaca' });

        // Paket yang memang berharga nol.
        const paketNol = resolveBillingAmount({ subscription: 'PAKET-GRATIS' }, 0);
        expect(paketNol).toMatchObject({ amount: 0, zeroIsReal: true });
    });

    test('getEffectivePrice memang mendahulukan subscription_price per-pelanggan', () => {
        const { getEffectivePrice } = require(path.join(REPO, 'lib', 'payment-finance-service'));
        global.packages = [{ name: 'PAKET-110K', price: 110000 }];
        expect(getEffectivePrice({ subscription: 'PAKET-110K', subscription_price: 90000 })).toBe(90000);
        expect(getEffectivePrice({ subscription: 'PAKET-110K' })).toBe(110000);
    });

    test('harga efektif NOL adalah jawaban SAH — diskon 100% menghasilkan 0, bukan harga penuh', () => {
        const { getEffectivePrice } = require(path.join(REPO, 'lib', 'payment-finance-service'));
        global.packages = [{ name: 'PAKET-110K', price: 110000 }];
        const gratis = { subscription: 'PAKET-110K', discount_percentage: 100 };
        expect(getEffectivePrice(gratis)).toBe(0);
    });

    test.each(JALUR)('%s TIDAK memakai fallback `|| harga paket` yang membangkitkan tagihan penuh', (_label, segments) => {
        // Jebakan: `getEffectivePrice(user) || packageInfo.price` terlihat defensif, tapi 0 adalah
        // nilai SAH (gratis/diskon 100%) — `||` akan menagih orang yang tak berutang.
        const src = baca(...segments);
        expect(src).not.toMatch(/getEffectivePrice\([^)]*\)\s*\|\|/);
    });
});
