/**
 * Header Doc
 * Purpose: Mengunci #b330 — saveInvoice TIDAK boleh kembali ke pola lama yang menghancurkan
 *   riwayat: baca mentah → `invoices = []` saat parse gagal → writeFileSync menimpa seluruh
 *   file dengan HANYA record baru. Riwayat invoice (dokumen akuntansi) hilang permanen &
 *   senyap saat prod restart 7-13x/hari memotong invoices.json. Guard sumber: pastikan baca
 *   lewat json-store (karantina) + tulis ATOMIK (tmp+rename).
 * Caller: Jest.
 * Deps: baca sumber lib/invoice-generator.js.
 * SideEffects: -
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'invoice-generator.js'), 'utf8');

function badanFungsi(nama) {
    const i = src.indexOf(`function ${nama}(`);
    if (i === -1) return '';
    // Ambil sampai deklarasi fungsi berikutnya (cukup untuk pemindaian dalam-fungsi).
    const j = src.indexOf('\nfunction ', i + 1);
    return src.slice(i, j === -1 ? undefined : j);
}

describe('saveInvoice tahan korupsi & atomik (#b330)', () => {
    const blk = badanFungsi('saveInvoice');

    test('membaca invoices lewat json-store loadJSON (karantina, bukan [] senyap)', () => {
        expect(blk).toMatch(/loadJSON\(\s*['"]invoices\.json['"]\s*\)/);
    });

    test('menulis ATOMIK: tmp lalu renameSync ke tujuan', () => {
        expect(blk).toMatch(/\.tmp-/);
        expect(blk).toMatch(/renameSync\(/);
    });

    test('TIDAK memakai lagi pola menimpa non-atomik langsung ke INVOICES_PATH', () => {
        // writeFileSync HANYA boleh menyasar berkas tmp, tak pernah INVOICES_PATH langsung.
        expect(blk).not.toMatch(/writeFileSync\(\s*INVOICES_PATH/);
    });

    test('TIDAK menyetel invoices=[] pada kegagalan baca (rantai hilang-data lama)', () => {
        expect(blk).not.toMatch(/invoices\s*=\s*\[\]\s*;[^]*JSON\.parse/);
        // Guard eksplisit: kegagalan baca membatalkan penyimpanan (return false), tak menimpa.
        expect(blk).toMatch(/return false/);
    });
});

describe('generateInvoiceNumber unik lintas-restart (#b330)', () => {
    const blk = badanFungsi('generateInvoiceNumber');

    test('men-seed counter dari record tersimpan, bukan selalu 0', () => {
        expect(blk).toMatch(/nextSequence\(/);
        expect(blk).toMatch(/loadJSON\(/);
        // Tak boleh lagi mereset buta ke 0 saat ganti tanggal.
        expect(blk).not.toMatch(/invoiceCounter\.count\s*=\s*0/);
    });

    test('tanggal nomor diambil dari invoiceDateStr (WIB), bukan toISOString (UTC)', () => {
        expect(blk).toMatch(/invoiceDateStr\(/);
        expect(blk).not.toMatch(/toISOString\(/);
    });
});
