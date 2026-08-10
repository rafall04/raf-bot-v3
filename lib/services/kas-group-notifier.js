/**
 * Header Doc
 * Purpose: Satu pintu untuk mengabari GRUP KAS USAHA tentang peristiwa uang (gaji dibayar,
 *          pengeluaran besar tercatat, dsb).
 *          Dipisah jadi modul sendiri supaya pemanggilnya — route gaji, expense-manager —
 *          tidak masing-masing menyalin gerbang "grup mana, aktif tidak, WA siap tidak".
 *          Aturan gerbang yang disalin-salin adalah aturan yang akhirnya berbeda-beda.
 * Caller: `routes/gaji.js` (gaji dibayar), `lib/expense-manager.js` (pengeluaran besar).
 * Deps: `../cron/shared.safeSendMessage` (kirim aman, tak melempar), `../personal-finance-service`
 *       (formatRupiah), `../../message/handlers/template-helpers` (renderResponseTemplate).
 * MainFuncs: `kabarkanKeGrupKas`, `grupKasAktif`.
 * SideEffects: Mengirim satu pesan WA ke grup kas. NEVER-THROW.
 */
"use strict";

const { formatRupiah } = require("../personal-finance-service");

/**
 * Grup kas siap dikabari? Gerbangnya sama dengan cron pengingat: fitur menyala DAN grup dipilih.
 * @returns {string|null} JID grup, atau null kalau belum siap.
 */
function grupKasAktif() {
    const cfg = (global.config && global.config.businessExpense) || {};
    if (cfg.enabled !== true) return null;
    const grup = String(cfg.groupId || "").trim();
    // Wajib JID GRUP. Mengirim kabar keuangan usaha ke DM perorangan karena salah setel
    // adalah kebocoran, bukan sekadar salah alamat.
    return /@g\.us$/.test(grup) ? grup : null;
}

/**
 * Kirim satu kabar ke grup kas.
 *
 * NEVER-THROW: pemanggilnya adalah operasi uang yang SUDAH tercatat (gaji dibayar,
 * pengeluaran dibuat). Gagal mengabari tak boleh menggagalkan operasi itu — hanya dicatat.
 *
 * Nominal di `data` boleh berupa angka; diformat rupiah di sini supaya tiap pemanggil tak
 * memformat dengan caranya sendiri.
 *
 * @param {string} templateKey key di response_templates.json
 * @param {{fallback:string, data:Object}} opsi
 * @returns {Promise<{terkirim:boolean, alasan?:string}>}
 */
async function kabarkanKeGrupKas(templateKey, opsi = {}) {
    const grup = grupKasAktif();
    if (!grup) return { terkirim: false, alasan: "grup kas tidak aktif" };

    try {
        const { renderResponseTemplate } = require("../../message/handlers/template-helpers");
        const data = { ...(opsi.data || {}) };
        if (typeof data.nominal === "number") data.nominal = formatRupiah(data.nominal);

        const teks = renderResponseTemplate(templateKey, opsi.fallback || "", data);
        if (!teks || /^Error: Template/.test(String(teks))) {
            console.error("[KAS_GRUP_NOTIF] Teks kosong/gagal render untuk", templateKey);
            return { terkirim: false, alasan: "template gagal" };
        }

        // Jalur yang SAMA dengan cron kas (`lib/cron/shared.safeSendMessage`): sudah memeriksa
        // state koneksi + kesiapan socket dan tak pernah melempar. Bukan `sendCritical` —
        // ini kabar, bukan uang yang berpindah ke tangan orang; kegagalan kirim tak boleh
        // menghasilkan dead-letter yang menuntut tindakan.
        const { safeSendMessage } = require("../cron/shared");
        const hasil = await safeSendMessage(grup, teks, { skipDuplicateCheck: true });
        return { terkirim: !(hasil && hasil.success === false), alasan: hasil && hasil.error };
    } catch (e) {
        console.error("[KAS_GRUP_NOTIF]", e && e.message);
        return { terkirim: false, alasan: e && e.message };
    }
}

module.exports = { kabarkanKeGrupKas, grupKasAktif };
