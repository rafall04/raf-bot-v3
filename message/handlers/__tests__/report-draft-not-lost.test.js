/**
 * Header Doc
 * Purpose: Mengunci perbaikan "laporan menguap di langkah foto". Alur laporan hidup (text-menu)
 *          berhenti di `REPORT_MATI_PHOTO` sambil meminta foto; pelanggan yang internetnya mati
 *          sering tak punya yang bisa difoto lalu diam. Dulu state kedaluwarsa 15 menit dan tiket
 *          TIDAK PERNAH LAHIR — teknisi tak pernah tahu ada yang melapor. Handler timeout memang
 *          ada, tapi hanya terdaftar untuk step LEGACY dan menuntut bentuk state lama
 *          (`state.ticketData`), sementara alur ini memakai `ticketDraft`.
 * Caller: Jest (`npx jest message/handlers/__tests__/report-draft-not-lost.test.js`).
 * Deps: fs/path (scan statis) — tidak menjalankan alur (butuh WA/DB).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..');
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), 'utf8');

const textMenu = baca('message', 'handlers', 'smart-report-text-menu.js');
const legacy = baca('message', 'handlers', 'smart-report-handler.js');

describe('draft laporan tidak boleh mati bersama state-nya', () => {
    test('alur text-menu MENDAFTARKAN handler timeout untuk step fotonya sendiri', () => {
        expect(textMenu).toMatch(/registerStateTimeoutHandler\(\s*'REPORT_MATI_PHOTO'/);
    });

    // CATATAN: test lama di sini menuntut step KEPUTUSAN (REPORT_LEMOT_ANALYSIS/…_CONFIRM/
    // CONFIRM_MATI_REPORT) ikut didaftarkan. Itu SALAH dan sempat jadi regresi nyata: di step
    // keputusan bot bertanya "Balas *SUDAH* … atau *BELUM*", sehingga diamnya pelanggan yang
    // masalahnya sudah beres akan dibaca sebagai "BELUM" → tiket palsu + blast ke seluruh staf.
    // Asersinya dibalik di `complaint-becomes-real-ticket.test.js`: step keputusan WAJIB TIDAK
    // didaftarkan. Hanya step LAMPIRAN (`REPORT_MATI_PHOTO`) yang boleh promote-on-timeout.
    test('hanya step LAMPIRAN yang didaftarkan — bukan step keputusan', () => {
        const cocok = textMenu.match(/registerStateTimeoutHandler\(\s*'([A-Z_]+)'/g) || [];
        expect(cocok.length).toBe(1);
        expect(cocok[0]).toContain('REPORT_MATI_PHOTO');
    });

    test('promosi memakai pembuat tiket MILIK alur ini, bukan handler legacy yang bentuk state-nya beda', () => {
        const idx = textMenu.indexOf('async function promoteReportDraftOnTimeout');
        expect(idx).toBeGreaterThan(-1);
        const blok = textMenu.slice(idx, idx + 2200);
        expect(blok).toMatch(/createReportTicket\(/);
        // Handler legacy menuntut `state.ticketData` — bentuk yang TIDAK dipakai alur ini.
        expect(blok).not.toMatch(/state\.ticketData/);
    });

    test('handler legacy memang menuntut bentuk state lama (premis temuan)', () => {
        expect(legacy).toMatch(/if\s*\(!state\?\.ticketData\)/);
        expect(legacy).toMatch(/registerStateTimeoutHandler\('GANGGUAN_MATI_AWAITING_PHOTO'/);
    });

    test('pelanggan DIBERI TAHU tiketnya jadi — kalau tidak, dari sisinya laporan tetap hilang', () => {
        const idx = textMenu.indexOf('async function promoteReportDraftOnTimeout');
        const blok = textMenu.slice(idx, idx + 2200);
        expect(blok).toMatch(/sendMessage\(/);
        expect(blok).toMatch(/report_draft_promoted_timeout/);
    });

    test('promosi NEVER-THROW — timer state tak boleh dijatuhkan olehnya', () => {
        const idx = textMenu.indexOf('async function promoteReportDraftOnTimeout');
        const blok = textMenu.slice(idx, idx + 2200);
        expect(blok).toMatch(/try\s*\{/);
        expect(blok).toMatch(/catch\s*\(/);
        // Kegagalan kirim notifikasi pun tak boleh membatalkan tiket yang sudah jadi.
        expect(blok).toMatch(/catch\s*\(kirimErr\)/);
    });

    test('template pemberitahuannya terdaftar & menyebut cara cek status', () => {
        const t = require(path.join(REPO, 'database', 'response_templates.json'));
        const teks = String(t.report_draft_promoted_timeout.template || t.report_draft_promoted_timeout);
        expect(teks).toMatch(/\$\{ticket_id\}/);
        expect(teks).toMatch(/cek tiket/i);
    });
});
