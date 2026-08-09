/**
 * Header Doc
 * Purpose: Orkestrasi pembuatan tiket laporan pelanggan — normalisasi foto, bentuk tiket dasar,
 *          notifikasi laporan baru, dan (khusus laporan lemot/lambat) meneruskan sinyal komplain
 *          ke agregator korelasi jalur upstream.
 * Caller: `message/handlers/smart-report-*.js`, `message/handlers/ticket-creation-handler.js`,
 *         `message/handlers/customer-photo-handler.js`, `services/auto-outage-conversation.service`.
 * Deps: `lib/ticket-workflow` (createBaseTicket/appendCustomerPhoto/ensureTicketShape),
 *       `lib/report-notification-service.notifyNewReport`, lazy `lib/complaint-signal-service`.
 * MainFuncs: `createCustomerReportTicket`, `appendCustomerReportPhoto`, `toCustomerPhoto`.
 * SideEffects: Menulis tiket via workflow, kirim notifikasi laporan baru, rekam sinyal komplain
 *              (best-effort, never-throw).
 */
const { createBaseTicket, appendCustomerPhoto, ensureTicketShape } = require('./ticket-workflow');
const { notifyNewReport } = require('./report-notification-service');

function toCustomerPhoto(photo, index = 0, uploadedBy = 'customer') {
    if (!photo) return null;
    if (typeof photo === 'string') {
        return {
            fileName: photo,
            path: photo,
            uploadedAt: new Date().toISOString(),
            uploadedBy,
            source: 'customer',
            order: index + 1
        };
    }
    return {
        fileName: photo.fileName || photo.filename || photo.name || '',
        path: photo.path || photo.fileName || photo.filename || photo.name || '',
        uploadedAt: photo.uploadedAt || new Date().toISOString(),
        size: photo.size,
        uploadedBy: photo.uploadedBy || uploadedBy,
        source: 'customer',
        order: index + 1
    };
}

async function createCustomerReportTicket({
    user,
    sender,
    laporanText,
    issueType,
    priority,
    createdBy,
    createdByRole,
    customerPhotos = [],
    photoBuffers = [],
    notifyAdmins = true,
    additionalFields = {}
}) {
    const normalizedPhotos = customerPhotos.map((photo, index) => toCustomerPhoto(photo, index, sender)).filter(Boolean);
    const ticket = createBaseTicket({
        user,
        pelangganId: sender,
        laporanText,
        issueType,
        priority,
        createdBy: createdBy || sender,
        createdByRole: createdByRole || 'customer_wa',
        customerPhotos: normalizedPhotos
    });

    Object.assign(ticket, additionalFields || {});
    ensureTicketShape(ticket);
    await notifyNewReport(ticket, { photoBuffers, notifyAdmins });

    // Sinyal komplain "lemot/lambat" → agregator korelasi jalur upstream (fire-and-forget,
    // gate config.complaintSignals.enabled — tidak boleh mengganggu pembuatan tiket).
    try {
        if (user && /lemot|lambat/i.test(String(laporanText || ''))) {
            require('./complaint-signal-service')
                .recordComplaint({ user, source: 'tiket_lemot' })
                .catch(() => {});
        }
    } catch (_e) {
        // Sinyal opsional.
    }

    return ticket;
}

/**
 * Keluhan/saran teks bebas dari pelanggan → TIKET NYATA.
 *
 * Dulu tiga salinan kode (`states/other-state-handler`, `customer-handler`, `steps/general-steps`)
 * sama-sama hanya `console.log("[NEW_COMPLAINT]", …)` lalu membalas dengan ID hasil `Date.now()`.
 * Pelanggan menerima "ID: #1754712345678 — Tim kami akan segera menindaklanjuti. Anda akan menerima
 * notifikasi untuk update selanjutnya", padahal tak ada satu byte pun yang tersimpan: tak masuk
 * papan teknisi, tak ada yang diberi tahu, tak bisa dicek dengan `cek tiket`. Janji yang mustahil
 * ditepati adalah kerusakan kepercayaan yang paling mahal.
 *
 * Satu pemilik di sini supaya ketiga pintu masuk itu mustahil berbeda perilaku lagi.
 * @returns {Promise<{ok:boolean, ticketId:string|null, error:string|null}>} NEVER-THROW.
 */
async function createCustomerComplaintTicket({ user, sender, complaint, pushname, createdByRole = 'customer_wa_complaint' }) {
    try {
        // PEMBATAS: satu keluhan TERBUKA per pelanggan.
        //
        // Tanpa ini, pelanggan yang kesal mengetik `keluhan lemot terus` delapan kali menghasilkan
        // 8 tiket DAN 8 × (seluruh teknisi + seluruh admin) pesan WhatsApp — dedup notifikasi tak
        // menolong karena teksnya memuat ticketId yang selalu beda dan TTL-nya cuma 10 detik.
        // Papan teknisi ikut tenggelam sehingga gangguan nyata jadi sulit terlihat.
        // Keluhan susulan ditempelkan ke tiket yang sudah ada, bukan melahirkan tiket baru.
        const userId = user && user.id;
        const terbuka = Array.isArray(global.reports)
            ? global.reports.find((r) => r
                && (r.source === 'keluhan' || r.issueType === 'KELUHAN')
                && (r.pelangganUserId === userId || (r.pelangganDataSystem && r.pelangganDataSystem.id === userId))
                && !['selesai', 'completed', 'cancelled', 'dibatalkan', 'resolved'].includes(r.status))
            : null;
        if (terbuka) {
            return { ok: true, ticketId: terbuka.ticketId, error: null, existing: true };
        }

        const ticket = await createCustomerReportTicket({
            user,
            sender,
            laporanText: String(complaint || '').trim(),
            issueType: 'KELUHAN',
            priority: 'MEDIUM',
            createdBy: sender,
            createdByRole,
            notifyAdmins: true,
            additionalFields: {
                // Penanda jenis — dipakai `lib/report-helper.hasActiveReport` agar tiket keluhan
                // TIDAK menutup pintu lapor gangguan, dan dipakai pembatas di atas.
                source: 'keluhan',
                ...(pushname ? { pelangganPushName: pushname } : {})
            }
        });
        return { ok: true, ticketId: (ticket && ticket.ticketId) || null, error: null, existing: false };
    } catch (err) {
        // Gagal simpan TIDAK BOLEH menjatuhkan balasan ke pelanggan — tapi pemanggil WAJIB
        // membaca `ok` dan berhenti menjanjikan tindak lanjut bila false.
        console.error('[COMPLAINT_TICKET_ERROR] gagal membuat tiket keluhan:', err && err.message);
        return { ok: false, ticketId: null, error: (err && err.message) || 'UNKNOWN' };
    }
}

async function appendCustomerReportPhoto({ ticketId, actor, photo, maxPhotos = 3, allowedStatuses }) {
    return appendCustomerPhoto({
        ticketId,
        actor,
        photo: toCustomerPhoto(photo, 0, actor.username || actor.name || actor.id || 'customer'),
        maxPhotos,
        allowedStatuses
    });
}

module.exports = {
    createCustomerReportTicket,
    createCustomerComplaintTicket,
    appendCustomerReportPhoto,
    toCustomerPhoto
};
