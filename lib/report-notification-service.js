/**
 * Header Doc
 * Purpose: Menyusun dan mengirim notifikasi tiket/laporan ke teknisi, admin, dan pelanggan dengan dedup protection.
 * Caller: Workflow tiket, report orchestration, dan handler notifikasi customer update.
 * Deps: `./notification-tracker`, `./ticket-workflow`, `./templating`, `./template-service`, `./whatsapp-delivery-service`, dan `./whatsapp-gateway`.
 * MainFuncs: `notifyNewReport`, `notifyCustomerTicketUpdate`, `notifyCustomerTicketMediaUpdate`, serta helper notifikasi tiket lainnya.
 * SideEffects: Mengirim pesan/media WhatsApp dan menandai jejak dedup notifikasi.
 */
const fs = require('fs');
const { deduplicatePhones, normalizePhone, isNotificationDuplicate, markNotificationSent } = require('./notification-tracker');
const { ensureTicketShape } = require('./ticket-workflow');
const { renderTemplate } = require('./templating');
const { renderCategoryTemplate } = require('./template-service');
const { sendMessage } = require('./whatsapp-delivery-service');
const { isReady } = require('./whatsapp-gateway');

function toJid(phone) {
    if (!phone) return '';
    if (phone.includes('@')) return phone;
    const normalized = normalizePhone(phone);
    return normalized ? `${normalized}@s.whatsapp.net` : '';
}

function canSendWhatsApp() {
    return isReady();
}

function renderResponseTemplate(key, data = {}) {
    return renderCategoryTemplate("responseTemplates", key, data).text;
}

async function safeSendMessage(jid, message, meta = {}) {
    if (!jid) return false;
    if (!canSendWhatsApp()) {
        console.warn('[REPORT_NOTIFICATION_SKIP]', { jid, reason: 'connection_unavailable', ...meta });
        return false;
    }
    if (isNotificationDuplicate(jid, message)) {
        console.warn('[REPORT_NOTIFICATION_SKIP]', { jid, reason: 'duplicate', ...meta });
        return false;
    }
    try {
        const delivery = await sendMessage(jid, message);
        if (!delivery.sent) {
            console.error('[REPORT_NOTIFICATION_ERROR]', { jid, error: delivery.warning || delivery.errorCode || 'SEND_FAILED', ...meta });
            return false;
        }
        markNotificationSent(jid, message);
        return true;
    } catch (error) {
        console.error('[REPORT_NOTIFICATION_ERROR]', { jid, error: error.message, ...meta });
        return false;
    }
}

async function sendTextToJids(recipients, text, meta = {}) {
    const uniqueRecipients = [...new Set((recipients || []).filter(Boolean))];
    let successCount = 0;
    for (const recipient of uniqueRecipients) {
        const sent = await safeSendMessage(recipient, { text }, meta);
        if (sent) successCount += 1;
    }
    return {
        recipients: uniqueRecipients.length,
        successCount,
        sent: successCount > 0
    };
}

function getTicketPhoneList(ticket) {
    const phones = [];
    if (ticket.pelangganId) {
        phones.push(ticket.pelangganId);
    }
    if (ticket.pelangganPhone) {
        phones.push(...String(ticket.pelangganPhone).split('|').map((phone) => phone.trim()).filter(Boolean));
    }
    return deduplicatePhones(phones).map(toJid).filter(Boolean);
}

function buildNewReportMessage(ticket) {
    const normalized = ensureTicketShape(ticket);
    const customerPhone = normalized.pelangganPhone || 'N/A';
    const customerPhotos = normalized.customerPhotoCount || normalized.customerPhotos?.length || 0;
    const deviceStatus = normalized.deviceOnline === false ? 'OFFLINE' : 'ONLINE';
    const troubleshooting = normalized.troubleshootingDone ? 'Sudah dilakukan' : 'Belum';
    return renderResponseTemplate("report_notification_new_ticket", {
        ticketId: normalized.ticketId,
        customerName: normalized.pelangganName,
        customerPhone,
        address: normalized.pelangganAddress || 'Tidak ada',
        packageName: normalized.packageName || normalized.pelangganPackage || '-',
        issueType: normalized.issueType || normalized.laporanText || '-',
        description: normalized.laporanText || '-',
        deviceStatus,
        troubleshooting,
        customerPhotos: customerPhotos > 0 ? `${customerPhotos} foto` : 'Tidak ada'
    });
}

async function sendCustomerPhotos(ticket, photoBuffers = [], excludeJids = []) {
    const excludedJids = new Set((excludeJids || []).filter(Boolean));
    if (!photoBuffers.length) return;
    const teknisiAccounts = (global.accounts || []).filter((acc) => acc.role === 'teknisi' && acc.phone_number);
    for (const teknisi of teknisiAccounts) {
        const teknisiJid = toJid(teknisi.phone_number);
        if (!teknisiJid || excludedJids.has(teknisiJid)) continue;
        for (let index = 0; index < photoBuffers.length; index += 1) {
            await safeSendMessage(teknisiJid, {
                image: photoBuffers[index],
                caption: renderResponseTemplate("report_notification_customer_photo_caption", { photoIndex: index + 1, photoTotal: photoBuffers.length, ticketId: ticket.ticketId, customerName: ticket.pelangganName })
            }, {
                flow: 'report',
                step: 'broadcast_photo',
                ticketId: ticket.ticketId,
                recipientType: 'teknisi',
                photoIndex: index + 1
            });
        }
    }
}

async function notifyNewReport(ticket, options = {}) {
    const normalized = ensureTicketShape(ticket);
    // Notif GRUP PERBAIKAN (papan pengumuman) — fire-and-forget, guarded, never-throw. Additive:
    // tak mengubah notif teknisi/admin/pelanggan di bawah. Feature-flag config.repairNotif.enabled.
    try { require('./repair-group-notifier').notifyRepairGroupNewTicket(normalized).catch(() => {}); } catch (_e) { /* never-throw */ }
    const {
        notifyAdmins = true,
        photoBuffers = [],
        excludeJids = []
    } = options;
    const excludedJids = new Set((excludeJids || []).filter(Boolean));
    const message = { text: buildNewReportMessage(normalized) };
    const teknisiAccounts = (global.accounts || []).filter((acc) => acc.role === 'teknisi' && acc.phone_number);
    let teknisiSuccessCount = 0;
    for (const teknisi of teknisiAccounts) {
        const teknisiJid = toJid(teknisi.phone_number);
        if (!teknisiJid || excludedJids.has(teknisiJid)) continue;
        const sent = await safeSendMessage(teknisiJid, message, {
            flow: 'report',
            step: 'broadcast_new_ticket',
            ticketId: normalized.ticketId,
            recipientType: 'teknisi'
        });
        if (sent) teknisiSuccessCount += 1;
    }

    let adminSuccessCount = 0;
    if (notifyAdmins) {
        const adminAccounts = (global.accounts || []).filter((acc) => ['admin', 'owner', 'superadmin'].includes(acc.role) && acc.phone_number);
        for (const admin of adminAccounts) {
            const adminJid = toJid(admin.phone_number);
            if (!adminJid || excludedJids.has(adminJid)) continue;
            const sent = await safeSendMessage(adminJid, message, {
                flow: 'report',
                step: 'broadcast_new_ticket',
                ticketId: normalized.ticketId,
                recipientType: 'admin'
            });
            if (sent) adminSuccessCount += 1;
        }
    }

    if (photoBuffers.length > 0) {
        await sendCustomerPhotos(normalized, photoBuffers, excludeJids);
    }

    return {
        sent: teknisiSuccessCount > 0 || adminSuccessCount > 0,
        teknisiSuccessCount,
        adminSuccessCount
    };
}

async function notifyCustomerTicketUpdate(ticket, messageText, meta = {}) {
    const normalized = ensureTicketShape(ticket);
    const recipients = getTicketPhoneList(normalized);
    return sendTextToJids(recipients, messageText, {
        flow: meta.flow || 'ticket',
        step: meta.step || 'customer_update',
        ticketId: normalized.ticketId,
        recipientType: 'customer'
    });
}

async function notifyCustomerTicketMediaUpdate(ticket, messageText, attachments = [], meta = {}) {
    const normalized = ensureTicketShape(ticket);
    const recipients = getTicketPhoneList(normalized);
    let successCount = 0;
    for (const recipient of recipients) {
        if (messageText) {
            const sent = await safeSendMessage(recipient, { text: messageText }, {
                flow: meta.flow || 'ticket',
                step: meta.step || 'customer_media_update',
                ticketId: normalized.ticketId,
                recipientType: 'customer'
            });
            if (sent) successCount += 1;
        }
        for (const attachment of attachments) {
            if (attachment.buffer) {
                const sent = await safeSendMessage(recipient, {
                    image: attachment.buffer,
                    caption: attachment.caption || ''
                }, {
                    flow: meta.flow || 'ticket',
                    step: meta.step || 'customer_media_update',
                    ticketId: normalized.ticketId,
                    recipientType: 'customer',
                    media: true
                });
                if (sent) successCount += 1;
            } else if (attachment.path && fs.existsSync(attachment.path)) {
                const sent = await safeSendMessage(recipient, {
                    image: fs.readFileSync(attachment.path),
                    caption: attachment.caption || ''
                }, {
                    flow: meta.flow || 'ticket',
                    step: meta.step || 'customer_media_update',
                    ticketId: normalized.ticketId,
                    recipientType: 'customer',
                    media: true
                });
                if (sent) successCount += 1;
            }
        }
    }
    return {
        recipients: recipients.length,
        successCount,
        sent: successCount > 0
    };
}

function getTechnicianContacts(actor = {}) {
    if (!actor) return { teknisiName: 'Teknisi', teknisiPhoneSection: '' };
    const teknisiName = actor.name || actor.username || 'Teknisi';
    const teknisiJid = toJid(actor.phoneNumber || actor.phone || '');
    const teknisiPhone = teknisiJid ? teknisiJid.replace('@s.whatsapp.net', '') : '';
    return {
        teknisiName,
        teknisiPhoneSection: teknisiPhone ? `📱 Kontak: wa.me/${teknisiPhone}\n` : ''
    };
}

async function notifyTicketProcessed(ticket, actor = {}, options = {}) {
    const normalized = ensureTicketShape(ticket);
    const { teknisiName, teknisiPhoneSection } = getTechnicianContacts(actor);
    const message = renderTemplate('ticket_process_customer', {
        ticket_id: normalized.ticketId || normalized.id,
        teknisi_name: teknisiName,
        teknisi_phone_section: teknisiPhoneSection,
        otp: normalized.otp || options.otp || 'XXXXXX'
    });
    return notifyCustomerTicketUpdate(normalized, message, {
        flow: 'ticket',
        step: 'process'
    });
}

async function notifyTicketOtw(ticket, actor = {}, options = {}) {
    const normalized = ensureTicketShape(ticket);
    const { teknisiName, teknisiPhoneSection } = getTechnicianContacts(actor);
    const message = renderTemplate('ticket_otw_customer', {
        ticket_id: normalized.ticketId || normalized.id,
        teknisi_name: teknisiName,
        teknisi_phone_section: teknisiPhoneSection,
        estimasi_waktu: options.estimasiWaktu || '30-60 menit',
        lokasi_info: normalized.lastLocation ? `Update lokasi: ${normalized.lastLocation}` : 'Lokasi akan diupdate',
        otp: normalized.otp || 'XXXXXX'
    });
    return notifyCustomerTicketUpdate(normalized, message, {
        flow: 'ticket',
        step: 'otw'
    });
}

async function notifyTicketArrived(ticket, actor = {}) {
    const normalized = ensureTicketShape(ticket);
    const { teknisiName, teknisiPhoneSection } = getTechnicianContacts(actor);
    const message = renderTemplate('ticket_arrived_customer', {
        ticket_id: normalized.ticketId || normalized.id,
        teknisi_name: teknisiName,
        teknisi_phone_section: teknisiPhoneSection,
        otp: normalized.otp || 'XXXXXX'
    });
    return notifyCustomerTicketUpdate(normalized, message, {
        flow: 'ticket',
        step: 'arrived'
    });
}

async function notifyTicketWorking(ticket, actor = {}) {
    const normalized = ensureTicketShape(ticket);
    const message = renderTemplate('ticket_working_customer', {
        ticket_id: normalized.ticketId || normalized.id,
        teknisi_name: actor.name || actor.username || 'Teknisi'
    });
    return notifyCustomerTicketUpdate(normalized, message, {
        flow: 'ticket',
        step: 'working'
    });
}

async function notifyTicketCompleted(ticket, actor = {}, options = {}) {
    const normalized = ensureTicketShape(ticket);
    const message = renderTemplate('ticket_completed_customer', {
        ticket_id: normalized.ticketId || normalized.id,
        teknisi_name: actor.name || actor.username || 'Teknisi',
        durasi: options.durationMinutes || normalized.workDuration || 0,
        jumlah_foto: normalized.teknisiPhotoCount || normalized.teknisiPhotos?.length || 0,
        catatan_section: normalized.resolutionNotes ? `📝 Catatan: ${normalized.resolutionNotes}` : '',
        nama_wifi: global.config?.namaWifi || 'WiFi Service'
    });
    return notifyCustomerTicketUpdate(normalized, message, {
        flow: 'ticket',
        step: 'completed'
    });
}

async function notifyTicketCancelled(ticket, actor = {}, options = {}) {
    const normalized = ensureTicketShape(ticket);
    const cancellationDate = options.cancellationDate || new Date().toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    const reason = options.cancellationReason || normalized.cancellation_reason || normalized.cancellationReason || '';
    const customerMessage = renderTemplate('ticket_cancelled_customer', {
        nama_pelanggan: normalized.pelangganName || 'Pelanggan',
        ticket_id: normalized.ticketId || normalized.id,
        issue_type: normalized.issueType || normalized.laporanText || 'Tidak disebutkan',
        tanggal: cancellationDate,
        cancelled_by: actor.name || actor.username || 'Admin',
        alasan_section: reason ? `📝 *Alasan Pembatalan:*\n${reason}\n` : '',
        telfon: global.config?.telfon || 'N/A',
        nama_wifi: global.config?.nama || 'Layanan WiFi Kami'
    });
    const customerResult = await notifyCustomerTicketUpdate(normalized, customerMessage, {
        flow: 'ticket',
        step: 'cancelled'
    });

    let teknisiResult = { sent: false, successCount: 0 };
    if (normalized.teknisiId || normalized.teknisiPhone) {
        const teknisi = (global.accounts || []).find((acc) =>
            String(acc.id) === String(normalized.teknisiId) ||
            acc.username === normalized.teknisiId ||
            acc.phone_number === normalized.teknisiPhone
        );
        if (teknisi && teknisi.phone_number) {
            const teknisiMessage = renderTemplate('ticket_cancelled_teknisi', {
                ticket_id: normalized.ticketId || normalized.id,
                nama_pelanggan: normalized.pelangganName || 'Pelanggan',
                no_hp: normalized.pelangganPhone || 'N/A',
                alamat: normalized.pelangganAddress || normalized.alamat || 'Tidak disebutkan',
                issue_type: normalized.issueType || normalized.laporanText || 'Tidak disebutkan',
                prioritas: normalized.priority === 'HIGH' ? 'URGENT' : (normalized.priority || 'Normal'),
                cancelled_by: actor.name || actor.username || 'Admin',
                waktu_pembatalan: cancellationDate,
                alasan_section: reason ? `📝 *Alasan Pembatalan:*\n${reason}\n` : ''
            });
            teknisiResult = await sendTextToJids([toJid(teknisi.phone_number)], teknisiMessage, {
                flow: 'ticket',
                step: 'cancelled_teknisi',
                ticketId: normalized.ticketId,
                recipientType: 'teknisi'
            });
        }
    }
    return {
        customerNotified: customerResult.sent,
        teknisiNotified: teknisiResult.sent
    };
}

module.exports = {
    buildNewReportMessage,
    notifyNewReport,
    notifyCustomerTicketUpdate,
    notifyCustomerTicketMediaUpdate,
    notifyTicketProcessed,
    notifyTicketOtw,
    notifyTicketArrived,
    notifyTicketWorking,
    notifyTicketCompleted,
    notifyTicketCancelled,
    toJid
};
