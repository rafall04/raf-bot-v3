/**
 * Header Doc
 * Purpose: Route payroll & kasbon teknisi — draft → finalisasi → BAYAR, plus ringkasan kasbon.
 *   Saat payroll dibayar, teknisi menerima STRUK GAJI via WhatsApp (rincian pendapatan +
 *   potongan + gaji bersih) lewat jalur berjaminan; sebelum ini uang masuk tanpa keterangan apa pun.
 * Caller: `lib/routes-registry.js` (mount admin).
 * Deps: `express`, `lib/activity-logger`, `lib/security` (rateLimit), `lib/technician-finance-service`,
 *   `lib/services/payroll-receipt` (teks struk), `lib/whatsapp-critical-delivery` (sendCritical).
 * MainFuncs: router GET/POST/PUT/DELETE payroll + kasbon (`PUT /:id/pay` = titik pembayaran).
 * SideEffects: Menulis tabel `technician_gaji`/kasbon, activity log, dan mengirim WhatsApp
 *   ke teknisi saat payroll dibayar (never-throw — kegagalan kirim tak membatalkan pembayaran).
 */

const express = require('express');
const router = express.Router();
const { logActivity } = require('../lib/activity-logger');
const { rateLimit } = require('../lib/security');
const {
    ensureFinanceTables,
    getKasbonSummary,
    getCollectionPayableSummary,
    getMarketingPayableSummary,
    createPayrollDraft,
    getPayrollList,
    getUnsettledCollectionByPeriod,
    getPayrollRecord,
    getPayrollSummary,
    updatePayrollDraft,
    finalizePayroll,
    payPayroll,
    setPayrollReceiptStatus,
    unfinalizePayroll
} = require('../lib/technician-finance-service');
const { writeOffCollectionPeriods, getCloseoutHistory } = require('../lib/technician-collection-settlement');
const salaryPlan = require('../lib/technician-salary-plan');
const { initTechnicianSalaryDraftTask } = require('../lib/cron/jobs/technician-salary-draft');

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        global.db.run(sql, params, function onRun(err) {
            if (err) {
                reject(err);
                return;
            }
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function ensureAdmin(req, res, next) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: 'Akses ditolak. Hanya admin yang diizinkan.' });
    }
    next();
}

function normalizeMoney(value) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getActor(req) {
    return {
        id: req.user?.id || null,
        username: req.user?.username || null,
        name: req.user?.name || req.user?.username || null
    };
}

/**
 * Mengirim struk gaji ke teknisi DAN mencatat hasilnya apa adanya.
 *
 * `sendCritical` TIDAK PERNAH melempar — ia memulangkan `{ delivered: false, errorCode }`.
 * Kode lama mengabaikan nilai balik itu dan menandai "terkirim" begitu perulangannya selesai,
 * jadi struk yang tak pernah sampai tetap dilaporkan berhasil ke grup kas. Akibatnya tak
 * seorang pun menutup celahnya: teknisi diam karena mengira memang tak ada rincian, pemilik
 * tenang karena layar bilang sudah terkirim.
 *
 * Statusnya disimpan di baris payroll supaya bisa dilihat dan dikirim ulang belakangan —
 * gagal kirim yang hanya muncul di log PM2 sama saja dengan tidak tercatat.
 */
async function kirimStrukGaji(payroll) {
    let terkirim = false;
    let alasan = '';
    try {
        const { buildPayrollReceiptText, resolveTechnicianPhones } = require('../lib/services/payroll-receipt');
        const { sendCritical } = require('../lib/whatsapp-critical-delivery');
        const nomor = resolveTechnicianPhones(payroll.teknisi_id, global.accounts);
        if (nomor.length === 0) {
            alasan = 'nomor WA teknisi belum diisi';
            console.warn(`[GAJI_NOTIF] Teknisi #${payroll.teknisi_id} tak punya nomor WA — struk gaji tidak terkirim.`);
        } else {
            const teks = buildPayrollReceiptText(payroll);
            const gagal = [];
            for (const ph of nomor) {
                const r = await sendCritical(ph, { text: teks }, { label: 'struk_gaji_teknisi' });
                if (!r || r.delivered !== true) {
                    gagal.push(`${ph}: ${(r && (r.errorCode || r.warning)) || 'tak diketahui'}`);
                }
            }
            // Cukup SATU nomor berhasil = teknisinya menerima struk.
            terkirim = gagal.length < nomor.length;
            if (gagal.length) alasan = gagal.join('; ');
        }
    } catch (strukErr) {
        alasan = (strukErr && strukErr.message) || 'gagal kirim';
        console.error('[GAJI_NOTIF] Gagal kirim struk gaji:', strukErr && strukErr.message);
    }

    try {
        await setPayrollReceiptStatus(payroll.id, {
            status: terkirim ? 'terkirim' : 'gagal',
            error: terkirim ? '' : alasan
        });
    } catch (simpanErr) {
        console.error('[GAJI_NOTIF] Gagal menyimpan status struk:', simpanErr && simpanErr.message);
    }
    return { terkirim, alasan };
}

function mapRowForResponse(row) {
    return {
        ...row,
        bonus: row.bonus_manual,
        total_gaji: row.net_amount
    };
}

ensureFinanceTables().catch(console.error);

router.get('/teknisi', ensureAdmin, async (req, res) => {
    try {
        const teknisiList = (global.accounts || [])
            .filter((account) => account.role === 'teknisi')
            .map((account) => ({
                id: account.id,
                name: account.name || account.username,
                username: account.username,
                phone_number: account.phone_number
            }));

        res.json({ status: 200, data: teknisiList });
    } catch (error) {
        console.error('[GAJI_GET_TEKNISI_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengambil data teknisi' });
    }
});

router.get('/', ensureAdmin, async (req, res) => {
    try {
        const rows = await getPayrollList({
            id: req.query.id,
            month: req.query.month,
            year: req.query.year,
            teknisiId: req.query.teknisi_id,
            status: req.query.status
        });
        res.json({ status: 200, data: rows.map(mapRowForResponse) });
    } catch (error) {
        console.error('[GAJI_GET_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengambil data gaji' });
    }
});

router.get('/summary', ensureAdmin, async (req, res) => {
    try {
        const month = parseInt(req.query.month, 10) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year, 10) || new Date().getFullYear();
        const summary = await getPayrollSummary({ month, year });
        res.json({ status: 200, data: summary });
    } catch (error) {
        console.error('[GAJI_SUMMARY_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengambil summary gaji' });
    }
});

router.get('/kasbon-summary/:teknisiId', ensureAdmin, async (req, res) => {
    try {
        const teknisiId = parseInt(req.params.teknisiId, 10);
        const month = parseInt(req.query.month, 10) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year, 10) || new Date().getFullYear();
        const [kasbon, collection, marketing, riwayat, komisiTertunda] = await Promise.all([
            getKasbonSummary({ teknisiId }),
            getCollectionPayableSummary({ teknisiId, periodMonth: month, periodYear: year }),
            getMarketingPayableSummary({ teknisiId, periodMonth: month, periodYear: year }),
            // Payroll TERAKHIR teknisi ini — dipakai memprefill gaji pokok. Gaji pokok nyaris
            // selalu sama tiap bulan, jadi mengetiknya ulang 12x setahun hanya membuka peluang
            // salah ketik pada angka yang seharusnya tak berubah.
            getPayrollList({ teknisiId }).catch(() => []),
            // Komisi yang menggantung di periode LAIN. Komisi hanya ikut terbayar kalau ada
            // payroll untuk periode yang sama, jadi bulan yang tak pernah dibuatkan payroll
            // menyimpan uang teknisi tanpa terlihat di layar mana pun.
            getUnsettledCollectionByPeriod({ teknisiId }).catch(() => [])
        ]);

        // Ambil periode terbaru SELAIN periode yang sedang dibuat (kalau drafnya sudah ada,
        // nilainya bukan "bulan lalu" lagi).
        const sebelumnya = (Array.isArray(riwayat) ? riwayat : [])
            .filter((r) => !(Number(r.period_month) === month && Number(r.period_year) === year))
            .sort((a, b) => (b.period_year - a.period_year) || (b.period_month - a.period_month))[0] || null;

        res.json({
            status: 200,
            data: {
                total_kasbon: kasbon.total_outstanding,
                kasbon_count: kasbon.active_count,
                total_terbayar: kasbon.total_paid,
                max_potongan: kasbon.total_outstanding,
                komisi_collection: collection.net_total,
                collection_credit: collection.total_credit,
                collection_debit: collection.total_debit,
                komisi_marketing: marketing.net_total,
                gaji_pokok_terakhir: sebelumnya ? Number(sebelumnya.gaji_pokok) || 0 : 0,
                periode_terakhir: sebelumnya ? `${sebelumnya.period_month}/${sebelumnya.period_year}` : null,
                // Komisi menggantung di periode yang TAK punya baris payroll sama sekali —
                // itulah yang tak muncul di layar mana pun dan karenanya tak akan terbayar.
                // Terukur di produksi: satu teknisi punya Rp1,35jt tersebar di 6 periode
                // seperti itu. Periode yang payroll-nya sudah ada (walau masih draft) TIDAK
                // ikut ditandai — uangnya sudah terlihat di tabel, tinggal difinalisasi.
                komisi_tertunda: (Array.isArray(komisiTertunda) ? komisiTertunda : [])
                    .filter((r) => !Number(r.has_payroll))
                    .filter((r) => !(Number(r.period_month) === month && Number(r.period_year) === year))
                    .map((r) => ({
                        periode: `${r.period_month}/${r.period_year}`,
                        entries: Number(r.entries) || 0,
                        total: Number(r.net_total) || 0
                    }))
                    .filter((r) => r.total !== 0)
            }
        });
    } catch (error) {
        console.error('[GAJI_KASBON_SUMMARY_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengambil summary kasbon teknisi' });
    }
});

router.post('/', ensureAdmin, rateLimit('create-gaji', 20, 60000), async (req, res) => {
    try {
        const payload = {
            teknisiId: req.body.teknisi_id,
            periodMonth: req.body.period_month,
            periodYear: req.body.period_year,
            gajiPokok: normalizeMoney(req.body.gaji_pokok),
            bonusManual: normalizeMoney(req.body.bonus ?? req.body.bonus_manual),
            potonganKasbon: normalizeMoney(req.body.potongan_kasbon),
            potonganLain: normalizeMoney(req.body.potongan_lain),
            potonganLainKeterangan: req.body.potongan_lain_keterangan || '',
            notes: req.body.notes || ''
        };

        if (!payload.teknisiId || !payload.periodMonth || !payload.periodYear) {
            return res.status(400).json({ status: 400, message: 'teknisi_id, period_month, dan period_year wajib diisi' });
        }

        const result = await createPayrollDraft(payload, getActor(req));
        if (!result.created && result.conflict) {
            return res.status(409).json({ status: 409, message: 'Payroll teknisi untuk periode ini sudah ada' });
        }

        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'CREATE',
            resourceType: 'payroll_teknisi',
            resourceId: String(result.id),
            resourceName: `Payroll ${result.draft.teknisi_name} ${result.draft.period_month}/${result.draft.period_year}`,
            description: `Membuat draft payroll teknisi ${result.draft.teknisi_name}`,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch(console.error);

        res.status(201).json({
            status: 201,
            message: 'Draft payroll berhasil dibuat',
            data: mapRowForResponse({
                id: result.id,
                status: 'draft',
                ...result.draft
            })
        });
    } catch (error) {
        console.error('[GAJI_CREATE_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal membuat payroll teknisi' });
    }
});

// CATATAN URUTAN: route ber-path HARFIAH wajib didaftarkan SEBELUM route
// berparameter di kedalaman yang sama. Express mencocokkan berurutan, jadi
// PUT /:id menelan PUT /gaji-tetap dan menjawab 404 "payroll tidak ditemukan".

/**
 * Menutup komisi periode lama yang uangnya SUDAH diserahkan ke teknisi di luar sistem.
 * Ini BUKAN pembayaran — tak ada rupiah berpindah dan tak ada struk WhatsApp dikirim.
 * Sengaja endpoint TERPISAH dari pembuatan payroll: dua arah uang yang berlawanan tak boleh
 * dibedakan oleh sebuah boolean di body.
 */
router.post('/komisi-tertunda/tutup', ensureAdmin, rateLimit('tutup-komisi', 10, 60000), async (req, res) => {
    try {
        const teknisiId = req.body.teknisi_id;
        const periods = Array.isArray(req.body.periods) ? req.body.periods : [];
        const keterangan = String(req.body.keterangan || '').trim();
        const expectedTotal = req.body.expected_total == null ? null : Number(req.body.expected_total);

        if (!teknisiId || periods.length === 0) {
            return res.status(400).json({ status: 400, message: 'teknisi_id dan minimal satu periode wajib diisi' });
        }
        if (periods.length > 36) {
            return res.status(400).json({ status: 400, message: 'Maksimal 36 periode sekali tutup' });
        }
        if (keterangan.length < 10) {
            return res.status(400).json({ status: 400, message: 'Keterangan wajib diisi minimal 10 karakter — ini satu-satunya penjelasan yang tersisa nanti' });
        }

        const hasil = await writeOffCollectionPeriods({ teknisiId, periods, keterangan, actor: req.user.username || req.user.name || 'admin', expectedTotal });

        if (!hasil.ok && hasil.reason === 'nominal_berubah') {
            return res.status(409).json({
                status: 409,
                message: `Nominal berubah sejak layar dimuat (sekarang Rp${Number(hasil.totalSekarang).toLocaleString('id-ID')}). Muat ulang halaman lalu periksa lagi.`
            });
        }
        if (!hasil.ok) {
            return res.status(400).json({ status: 400, message: 'Permintaan tidak valid: ' + hasil.reason });
        }

        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'UPDATE',
            resourceType: 'komisi_collection_teknisi',
            resourceId: String(teknisiId),
            resourceName: `Penutupan komisi teknisi #${teknisiId}`,
            description: `Menutup komisi ${hasil.ditutup.map((d) => d.periode).join(', ')} senilai Rp${hasil.total.toLocaleString('id-ID')} — ${keterangan}`,
            // entry_ids disimpan supaya pembatalan manual kelak tahu PERSIS baris mana yang
            // harus dikredit balik, bukan menebak dari periode.
            newValue: { periods: hasil.ditutup, total: hasil.total, keterangan, entry_ids: hasil.entryIds },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch(console.error);

        res.json({ status: 200, data: hasil, message: `Komisi Rp${hasil.total.toLocaleString('id-ID')} ditutup tanpa pembayaran` });
    } catch (error) {
        console.error('[GAJI_TUTUP_KOMISI_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal menutup komisi' });
    }
});

// ── Gaji pokok tetap ───────────────────────────────────────────────────────────────────────
// Nominalnya sama tiap bulan, jadi diisi SEKALI lalu draft bulan berjalan muncul sendiri.
// Semua jalur di sini berhenti di DRAFT — finalisasi & pembayaran tetap klik manusia.

router.get('/gaji-tetap', ensureAdmin, async (req, res) => {
    try {
        const [plans, belumDibayar] = await Promise.all([salaryPlan.listPlans(), salaryPlan.getUnpaidPayrolls()]);
        const teknisi = (global.accounts || [])
            .filter((a) => String(a.role || '').toLowerCase() === 'teknisi')
            .map((a) => {
                const plan = plans.find((p) => Number(p.teknisi_id) === Number(a.id));
                return {
                    teknisi_id: a.id,
                    name: a.name || a.username,
                    gaji_pokok: plan ? Number(plan.gaji_pokok) : 0,
                    aktif: plan ? Number(plan.aktif) === 1 : true,
                    last_drafted_period: plan ? plan.last_drafted_period : null
                };
            });
        res.json({ status: 200, data: { teknisi, setelan: salaryPlan.setelan(), belum_dibayar: belumDibayar } });
    } catch (error) {
        console.error('[GAJI_TETAP_GET_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal memuat gaji tetap' });
    }
});

router.put('/gaji-tetap', ensureAdmin, async (req, res) => {
    try {
        const hasil = await salaryPlan.savePlans(req.body.items || []);
        if (!hasil.ok) {
            return res.status(400).json({ status: 400, message: `Tidak tersimpan: ${hasil.reason}` });
        }
        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'UPDATE',
            resourceType: 'gaji_tetap_teknisi',
            resourceId: 'all',
            resourceName: 'Gaji pokok tetap teknisi',
            description: hasil.items.map((i) => `${i.nama}: Rp${i.gajiPokok.toLocaleString('id-ID')}`).join(', '),
            newValue: hasil.items,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch(console.error);
        // Penyelarasan draft WAJIB disebutkan: nominal yang benar-benar akan dibayarkan baru
        // saja berubah, dan perubahan diam pada uang persis yang mau dihindari.
        const selaras = (hasil.draftDiselaraskan || [])
            .map((d) => `${d.nama} ${d.periode}: Rp ${d.sebelum.toLocaleString('id-ID')} → Rp ${d.sesudah.toLocaleString('id-ID')}`)
            .join('; ');
        const pesan = hasil.items.map((i) => `${i.nama}: Rp ${i.gajiPokok.toLocaleString('id-ID')}`).join(' · ') + ' tersimpan'
            + (selaras ? `. Draft bulan ini ikut diperbarui — ${selaras}` : '');

        res.json({ status: 200, data: hasil, message: pesan });
    } catch (error) {
        console.error('[GAJI_TETAP_PUT_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal menyimpan gaji tetap' });
    }
});

router.put('/gaji-tetap/otomatis', ensureAdmin, async (req, res) => {
    try {
        const sesudah = await salaryPlan.setAutoDraft({ enabled: req.body.enabled === true, draftDay: req.body.draft_day });
        // Jadwalkan ULANG. Tanpa ini hasilnya SUKSES SEMU: layar bilang aktif, nol draft
        // sampai `pm2 restart`, karena cron membaca config saat dijadwalkan.
        try {
            initTechnicianSalaryDraftTask();
        } catch (cronError) {
            console.error('[GAJI_TETAP_CRON_RESCHEDULE_ERROR]', cronError.message);
        }
        res.json({ status: 200, data: sesudah, message: sesudah.autoDraft ? `Draft otomatis AKTIF — dibuat tiap tanggal ${sesudah.draftDay || 28}` : 'Draft otomatis dimatikan' });
    } catch (error) {
        console.error('[GAJI_TETAP_OTOMATIS_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengubah sakelar' });
    }
});

router.post('/gaji-tetap/buat-draft', ensureAdmin, rateLimit('gaji-tetap-draft', 10, 60000), async (req, res) => {
    try {
        const hasil = await salaryPlan.createDraftsForPeriod({ ignoreDayGate: true, actor: getActor(req) });
        res.json({
            status: 200,
            data: hasil,
            message: `${hasil.dibuat} draft dibuat, ${hasil.sudahAda} sudah ada, ${hasil.dilewati} dilewati`
        });
    } catch (error) {
        console.error('[GAJI_TETAP_BUAT_DRAFT_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal membuat draft' });
    }
});

/**
 * Membatalkan finalisasi payroll — kembali ke draft supaya bisa diperbaiki.
 *
 * Belum ada uang yang berpindah pada status `finalized`, jadi pembatalannya aman. Yang WAJIB
 * ikut dibatalkan adalah kunci komisinya; itu ditangani service.
 */
router.put('/:id/batal-finalisasi', ensureAdmin, async (req, res) => {
    try {
        const hasil = await unfinalizePayroll(req.params.id, getActor(req));
        if (!hasil.ok) {
            const pesan = {
                not_found: 'Payroll tidak ditemukan',
                sudah_dibayar: 'Payroll sudah DIBAYAR — uangnya sudah berpindah, tidak bisa dibatalkan dari sini',
                bukan_finalized: 'Hanya payroll berstatus finalized yang bisa dibatalkan'
            }[hasil.reason] || 'Tidak bisa dibatalkan';
            return res.status(hasil.reason === 'not_found' ? 404 : 409).json({ status: 409, message: pesan });
        }

        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'UPDATE',
            resourceType: 'payroll_teknisi',
            resourceId: String(req.params.id),
            resourceName: `Batal finalisasi payroll #${req.params.id}`,
            description: `Finalisasi dibatalkan; ${hasil.komisiDilepas} baris komisi & ${hasil.marketingDilepas} komisi marketing dilepas`,
            newValue: hasil,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch(console.error);

        res.json({
            status: 200,
            data: hasil,
            message: `Finalisasi dibatalkan — kembali ke draft. ${hasil.komisiDilepas} baris komisi dilepas dan akan dihitung ulang saat difinalisasi lagi.`
        });
    } catch (error) {
        console.error('[GAJI_BATAL_FINALISASI_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal membatalkan finalisasi' });
    }
});

/**
 * Mengirim ULANG struk gaji ke teknisi.
 *
 * Kegagalan kirim dulu hanya jadi baris di log PM2: tak terlihat, tak bisa diulang. Uangnya
 * sudah berpindah, jadi teknisi berhak atas rinciannya walau percobaan pertama gagal.
 */
router.post('/:id/kirim-ulang-struk', ensureAdmin, rateLimit('kirim-struk', 20, 60000), async (req, res) => {
    try {
        const payroll = await getPayrollRecord(req.params.id);
        if (!payroll) {
            return res.status(404).json({ status: 404, message: 'Payroll tidak ditemukan' });
        }
        if (payroll.status !== 'paid') {
            return res.status(400).json({ status: 400, message: 'Struk hanya untuk payroll yang sudah dibayar' });
        }

        const hasil = await kirimStrukGaji(payroll);
        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'UPDATE',
            resourceType: 'payroll_teknisi',
            resourceId: String(payroll.id),
            resourceName: `Kirim ulang struk #${payroll.id}`,
            description: hasil.terkirim ? 'Struk gaji berhasil dikirim ulang' : `Kirim ulang struk GAGAL: ${hasil.alasan}`,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch(console.error);

        if (!hasil.terkirim) {
            return res.status(502).json({ status: 502, message: `Struk masih gagal terkirim: ${hasil.alasan}` });
        }
        res.json({ status: 200, message: `Struk gaji ${payroll.teknisi_name} berhasil dikirim ulang` });
    } catch (error) {
        console.error('[GAJI_KIRIM_ULANG_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengirim ulang struk' });
    }
});

/** Riwayat penutupan — setelah ditutup, angkanya nol di layar utama; ini yang masih bicara. */
router.get('/komisi-tertunda/riwayat', ensureAdmin, async (req, res) => {
    try {
        const rows = await getCloseoutHistory({ teknisiId: req.query.teknisi_id || null, limit: 50 });
        res.json({ status: 200, data: rows });
    } catch (error) {
        console.error('[GAJI_RIWAYAT_TUTUP_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal memuat riwayat penutupan' });
    }
});

router.put('/:id', ensureAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const result = await updatePayrollDraft(id, {
            gaji_pokok: normalizeMoney(req.body.gaji_pokok),
            bonus_manual: normalizeMoney(req.body.bonus ?? req.body.bonus_manual),
            potongan_kasbon: normalizeMoney(req.body.potongan_kasbon),
            potongan_lain: normalizeMoney(req.body.potongan_lain),
            potongan_lain_keterangan: req.body.potongan_lain_keterangan || '',
            notes: req.body.notes || ''
        });

        if (!result.updated && result.reason === 'not_found') {
            return res.status(404).json({ status: 404, message: 'Data payroll tidak ditemukan' });
        }
        if (!result.updated && result.reason === 'locked') {
            return res.status(400).json({ status: 400, message: 'Payroll yang sudah finalized/paid tidak dapat diubah' });
        }

        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'UPDATE',
            resourceType: 'payroll_teknisi',
            resourceId: String(id),
            resourceName: `Payroll teknisi #${id}`,
            description: `Mengubah draft payroll teknisi #${id}`,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch(console.error);

        res.json({
            status: 200,
            message: 'Draft payroll berhasil diupdate',
            data: mapRowForResponse(result.draft)
        });
    } catch (error) {
        console.error('[GAJI_UPDATE_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengupdate payroll teknisi' });
    }
});

router.put('/:id/finalize', ensureAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const result = await finalizePayroll(id, getActor(req));
        if (!result.finalized && result.reason === 'not_found') {
            return res.status(404).json({ status: 404, message: 'Data payroll tidak ditemukan' });
        }
        if (!result.finalized && result.reason === 'paid') {
            return res.status(400).json({ status: 400, message: 'Payroll yang sudah dibayar tidak dapat difinalisasi ulang' });
        }
        // Ditolak DIAM-DIAM sebagai sukses tidak boleh: klik ganda pernah mengosongkan komisi.
        if (!result.finalized && result.reason === 'already_finalized') {
            return res.status(409).json({ status: 409, message: 'Payroll ini sudah difinalisasi — tidak perlu (dan tidak boleh) difinalisasi ulang.' });
        }

        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'UPDATE',
            resourceType: 'payroll_teknisi',
            resourceId: String(id),
            resourceName: `Payroll teknisi #${id}`,
            description: `Memfinalisasi payroll teknisi #${id}`,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch(console.error);

        const payroll = await getPayrollRecord(id);
        res.json({
            status: 200,
            message: 'Payroll berhasil difinalisasi',
            data: mapRowForResponse(payroll)
        });
    } catch (error) {
        console.error('[GAJI_FINALIZE_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal memfinalisasi payroll teknisi' });
    }
});

router.put('/:id/pay', ensureAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const result = await payPayroll(id, getActor(req), req.body.notes || '');
        if (!result.paid && result.reason === 'not_found') {
            return res.status(404).json({ status: 404, message: 'Data payroll tidak ditemukan' });
        }
        if (!result.paid && result.reason === 'already_paid') {
            return res.status(400).json({ status: 400, message: 'Payroll sudah dibayar' });
        }

        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'UPDATE',
            resourceType: 'payroll_teknisi',
            resourceId: String(id),
            resourceName: `Payroll teknisi #${id}`,
            description: `Membayar payroll teknisi #${id}`,
            newValue: { status: 'paid', kasbon_allocations: result.allocations },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch(console.error);

        const payroll = await getPayrollRecord(id);

        // Struk gaji ke TEKNISI. Payroll punya seluruh angkanya, tapi selama ini teknisi tak
        // pernah diberi tahu apa pun — uang masuk rekening tanpa rincian, dan potongan kasbon
        // (bagian yang paling sering dipertanyakan) tak terlihat sama sekali.
        // Uang sudah berpindah tangan, jadi lewat `sendCritical` (retry + dead-letter), bukan
        // notifikasi biasa. NEVER-THROW: gagal kirim struk tak boleh menggagalkan pembayaran
        // payroll yang SUDAH tercatat.
        // Apakah struk BENAR-BENAR berangkat. Dipakai kabar ke grup di bawah — mengklaim
        // "rincian sudah dikirim" padahal tidak membuat pemilik berhenti mencari celahnya,
        // sementara teknisi tak pernah menerima rincian potongan kasbonnya.
        const hasilStruk = await kirimStrukGaji(payroll);
        const strukTerkirim = hasilStruk.terkirim;
        const strukAlasanGagal = hasilStruk.alasan;

        // Kabar ke GRUP KAS: gaji adalah pengeluaran terbesar tiap bulan, dan tanpa ini
        // satu-satunya yang tahu uang keluar adalah orang yang menekan tombolnya.
        // Sengaja TANPA rincian potongan — itu urusan teknisi yang bersangkutan, bukan grup.
        try {
            const { kabarkanKeGrupKas } = require('../lib/services/kas-group-notifier');
            await kabarkanKeGrupKas('kas_notif_gaji', {
                fallback: '💸 *GAJI DIBAYAR*\n\n👤 ${nama}\n📅 Periode ${periode}\n💰 ${nominal}\n\n${status_struk}',
                data: {
                    nama: payroll.teknisi_name || `Teknisi #${payroll.teknisi_id}`,
                    periode: `${payroll.period_month}/${payroll.period_year}`,
                    nominal: payroll.net_amount,
                    // Katakan apa adanya. Klaim "sudah dikirim" yang tak benar membuat tak
                    // seorang pun menutup celahnya — teknisi diam saja karena mengira memang
                    // tak ada rincian, pemilik tenang karena mengira sudah terkirim.
                    status_struk: strukTerkirim
                        ? '_Rincian lengkap sudah dikirim ke teknisinya._'
                        : `⚠️ _Struk BELUM terkirim ke teknisi (${strukAlasanGagal}). Rinciannya perlu disampaikan manual._`
                }
            });
        } catch (grupErr) {
            console.error('[GAJI_NOTIF] Gagal kabari grup kas:', grupErr && grupErr.message);
        }

        res.json({
            status: 200,
            message: 'Payroll berhasil dibayar',
            data: mapRowForResponse(payroll)
        });
    } catch (error) {
        console.error('[GAJI_PAY_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal membayar payroll teknisi' });
    }
});

router.delete('/:id', ensureAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const payroll = await getPayrollRecord(id);
        if (!payroll) {
            return res.status(404).json({ status: 404, message: 'Data payroll tidak ditemukan' });
        }
        if (payroll.status !== 'draft') {
            return res.status(400).json({ status: 400, message: 'Hanya draft payroll yang dapat dihapus' });
        }

        await dbRun('DELETE FROM technician_gaji WHERE id = ?', [id]);

        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'DELETE',
            resourceType: 'payroll_teknisi',
            resourceId: String(id),
            resourceName: `Payroll teknisi #${id}`,
            description: `Menghapus draft payroll teknisi #${id}`,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch(console.error);

        res.json({ status: 200, message: 'Draft payroll berhasil dihapus' });
    } catch (error) {
        console.error('[GAJI_DELETE_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal menghapus draft payroll' });
    }
});

module.exports = router;
