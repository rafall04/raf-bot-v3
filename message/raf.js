/**
 * Header Doc
 * Purpose: Router pesan WhatsApp utama yang menormalkan konteks, menjalankan interseptor global, routing state, dan delegasi intent.
 * Caller: `index.js` pada event `messages.upsert`.
 * Deps: Handler domain di `message/handlers/*`, helper context/pipeline bot, dan service `lib/*`.
 * MainFuncs: Build context pesan, jalankan guard/cancel/state, lalu dispatch intent ke handler domain.
 * SideEffects: Membaca/menulis state percakapan, mengirim pesan WhatsApp, mencatat pesan masuk ke message_logs (read-only/fire-and-forget), dan memanggil service domain existing.
 */
"use strict";

const { isProcessing, setProcessing, clearProcessing } = require('../lib/state-manager');

const convertRupiah = require('rupiah-format');
const path = require('path');
const { exec: _exec } = require('child_process');

const { color: _color, bgcolor: _bgcolor } = require("../lib/color");
const { downloadMedia } = require("../lib/whatsapp.adapter");
const { getBuffer: _getBuffer, fetchJson: _fetchJson, fetchText: _fetchText, getRandom: _getRandom, getGroupAdmins: _getGroupAdmins, runtime: _runtime, sleep, convert: _convert, convertGif: _convertGif, html2Txt: _html2Txt } = require("../lib/myfunc");
const { wifimenu: _wifimenu, menupaket: _menupaket, menubelivoucher: _menubelivoucher, menupasang: _menupasang, menuowner: _menuowner, customermenu: _customermenu, techinisionmenu: _techinisionmenu, menuvoucher: _menuvoucher } = require("./wifi");
const { getSSIDInfo } = require("../lib/wifi");
const { getPppStats: _getPppStats, getHotspotStats: _getHotspotStats, statusap: _statusap, getvoucher, addPPPoEUser, addbinding, addqueue } = require("../lib/mikrotik");
const { addPayment } = require("../lib/payment");
const { getIntentFromKeywords } = require('../lib/wifi_template_handler');
const { getLooseIntentFromKeywords } = require('../lib/loose-intent-matcher');
const { noteAdminOutbound, isAdminHandlingChat, isChatSignalReady, hasRecentComplaint } = require('../lib/chat-activity-tracker');
const { evaluateCustomerFallback } = require('./handlers/customer-fallback-handler');
const { templatesCache, renderTemplate } = require("../lib/templating");
const { savePackageChangeRequests: _savePackageChangeRequests, saveSpeedRequests: _saveSpeedRequests } = require("../lib/database");
const { INTENT_OWNER_MAP } = require("./handlers/intent-owner-map");
const domainHandlers = require('./handlers/domain-handlers');
const domainServices = require('./handlers/domain-services');
const {
    handleGangguanMatiOfflineResponse,
    handleGangguanMatiOnlineResponse,
    handleLemotPhotoUpload,
    handleGangguanLemotResponse
} = require('./handlers/smart-report-handler');
const {
    handleCompletionConfirmation,
    handleRemoteRequest: _handleRemoteRequest,
    handleRemoteResponse
} = require('./handlers/ticket-process-handler');
const { getUserState, setUserState, deleteUserState } = require('./handlers/conversation-handler');
const { handleConversationState } = require('./handlers/conversation-state-handler');
const { buildBotContext } = require('./handlers/bot-context');
const { routeManagedState, runGlobalInterceptors } = require('./handlers/bot-pipeline');
const { routeConversationState } = require('./handlers/conversation-state-router');
const { handleLegacyTeknisiStateTransitions } = require('./handlers/legacy-teknisi-state-handler');
const { sendReply, sendContactCard } = require('./handlers/reply-runtime');
const {
    handleTeknisiShareLocation,
    handleActiveTicketLocationUpdate,
    handleCekLokasiTeknisi,
    handleTiketSaya
} = require('./handlers/simple-location-handler');
const {
    handleListAgents,
    handleAgentByArea,
    handleAgentServices,
    handleSearchAgent,
    handleViewAgentDetail,
    handleAgentConfirmation,
    handleAgentTodayTransactions,
    handleCheckTopupStatus,
    handleAgentPinChange,
    handleAgentProfileUpdate,
    handleAgentStatusToggle,
    handleAgentSelfProfile
} = require('./handlers/agent');
const agentVoucherConversationHandlers = require('./handlers/agent-voucher-handler');
const pay = require("../lib/ipaymu")

const format = (key, data = {}) => {
    let template = templatesCache.responseTemplates[key]?.template || '';
    for (const placeholder in data) {
        const regex = new RegExp(`\\$\\{${placeholder}\\}`, 'g');
        template = template.replace(regex, data[placeholder]);
    }
    return template;
};

const mess = {
    get owner() { return format('mess_owner'); },
    get userNotRegister() { return format('mess_userNotRegister'); },
    get notRegister() { return format('mess_notRegister'); },
    get notProfile() { return format('mess_notProfile'); },
    get onlyMonthly() { return format('mess_onlyMonthly'); },
    get wrongFormat() { return format('mess_wrongFormat'); },
    get mustNumber() { return format('mess_mustNumber'); },
    get teknisiOrOwnerOnly() { return format('mess_teknisiOrOwnerOnly'); },
    get teknisiOnly() { return format('mess_teknisiOnly'); },
    get reportNotFound() { return format('mess_reportNotFound'); },
    get reportAlreadyDone() { return format('mess_reportAlreadyDone'); },
    get reportNotFound_detail() { return format('mess_reportNotFound_detail'); },
    get reportAlreadyDone_detail() { return format('mess_reportAlreadyDone_detail'); },
}

path.join(__dirname, '../database/reports.json');

// Handler imports - Smart Report
const { buatLaporanGangguan } = require('./handlers/ticket-creation-handler');
const { processVoucherPurchase: _processVoucherPurchase, handleVoucherChoiceState } = require('./handlers/payment-processor-handler');
const { handleMenuSelection, handleTroubleshootResult, handleMatiConfirmation, handleMatiTroubleshootOptions, handleMatiPhotoUpload } = require('./handlers/smart-report-text-menu');
const { handleDirectConfirmation, handleDirectLemotResponse } = require('./handlers/smart-report-hybrid');
const { handleCustomerPhotoUpload } = require('./handlers/customer-photo-handler');
const { handleGeneralSteps } = require('./handlers/steps/general-steps');
const { addPhotoToQueue } = require('./handlers/photo-upload-queue');

// Handler imports - Utility
const { handleCekTiket, handleBantuan, handleSapaanUmum, handleAdminContact } = require('./handlers/utility-handler');
const { handleMenuPelanggan, handleMenuUtama, handleMenuTeknisi, handleMenuOwner, handleTanyaCaraPasang, handleTanyaPaketBulanan, handleTutorialTopup } = require('./handlers/menu-handler');
const { handleStatusPpp, handleStatusHotspot, handleStatusAp, handleAllSaldo, handleAllUser, handleListProfStatik, handleListProfVoucher, handleMonitorWifi } = require('./handlers/monitoring-handler');
const { handleCekSaldo, handleTanyaHargaVoucher, handleVc123 } = require('./handlers/saldo-voucher-handler');
const { handleTransferSaldo, handleCancelTopup } = require('./handlers/saldo-handler');
const { handleAccessManagement } = require('./handlers/access-management-handler');
const { handleCekTagihan } = require('./handlers/billing-management-handler');
const { handleCheckPackage, handleComplaint, handleServiceInfo } = require('./handlers/customer-handler');
const { handleUbahPaket } = require('./handlers/package-management-handler');
const { handleGantiPowerWifi } = require('./handlers/wifi-power-handler');
const { handleRebootModem } = require('./handlers/reboot-modem-handler');
const { handleCekWifi } = require('./handlers/wifi-check-handler');
const { handleHistoryWifi } = require('./handlers/wifi-history-handler');
const { handleAddProfVoucher, handleDelProfVoucher, handleAddProfStatik, handleDelProfStatik } = require('./handlers/voucher-management-handler');
const { handleAddBinding, handleAddPPP } = require('./handlers/network-management-handler');
const { handleTopup, handleDelSaldo, handleTransfer } = require('./handlers/balance-management-handler');
const { handleProsesTicket, handleOTW, handleSampaiLokasi, handleVerifikasiOTP, handleSelesaiTicket, handleCompleteTicket, handleTeknisiPhotoUpload, handleTeknisiResolutionNotesState, handleTeknisiCompletionConfirmationState } = require('./handlers/teknisi-workflow-handler');
const {
    extractMessageContext,
    getOptionalJid,
    resolveActorCapabilities
} = require('./handlers/raf-context');
const {
    isCancellationKeyword,
    buildStateRoutingContext,
    resolveGlobalCommandStatus
} = require('./handlers/raf-interceptors');
const {
    handleManagedConversationState,
    handleWifiInputGuard,
    resolveKeywordIntent
} = require('./handlers/raf-state-routing');
const { resolveAgentContext, dispatchIntent } = require('./handlers/raf-intent-dispatch');

// Library imports
const { normalizeJid: _normalizeJid, normalizeJidForSaldo: _normalizeJidForSaldo, findUserWithLidSupport, normalizePhoneNumber: _normalizePhoneNumber, normalizePhoneToJid: _normalizePhoneToJid, extractSenderInfo, processLidVerification, buildCanonicalContext } = require('../lib/jid-utils');
const agentTransactionManager = require('../lib/agent-transaction-manager');
const agentManager = require('../lib/agent-manager');
const { getReportsUploadsPath, getTeknisiUploadsPathByTicket } = require('../lib/path-helper');
const { logInboundMessageSafe } = require('../repositories/message-log.repository');
const { resolveRuntimeBindings, getRuntimeCollection } = require('../lib/runtime-repositories');
let ownerNumber, nama, namabot, parentbinding, telfon;

function resolveRuntimeContext(runtimeOverride) {
    const runtimeBindings = resolveRuntimeBindings(runtimeOverride);

    return {
        runtime: runtimeBindings.runtime,
        runtimeGlobalScope: runtimeBindings.globalScope,
        runtimeConfig: runtimeBindings.config
    };
}
const temp = null;

module.exports = async (raf, msg, m, options = {}) => {
    const { runtime: requestRuntime, runtimeGlobalScope, runtimeConfig } = resolveRuntimeContext(options.runtime);

    if (runtimeConfig && Object.keys(runtimeConfig).length > 0) {
        ({
            ownerNumber,
            nama,
            namabot,
            parentbinding,
            telfon
        } = runtimeConfig);
    } else {
        ownerNumber = [];
        nama = 'Service Name';
        namabot = 'Bot Name';
        parentbinding = '';
        telfon = '';
    }

    const domainRepositories = domainServices.resolveDomainRepositories(requestRuntime);
    const saldoRepository = domainRepositories.saldo;
    const voucherRepository = domainRepositories.voucher;
    const users = getRuntimeCollection(requestRuntime, 'users', runtimeGlobalScope);
    const accounts = getRuntimeCollection(requestRuntime, 'accounts', runtimeGlobalScope);
    const statikCatalog = getRuntimeCollection(requestRuntime, 'statik', runtimeGlobalScope);
    const voucherCatalog = voucherRepository.getVoucherCatalog();

    // Skip echo status/broadcast fromMe berformat ID pendek. Optional-chaining +
    // fallback string supaya pesan tanpa msg.key.id tidak crash sebelum guard utama.
    const msgKeyId = msg.key?.id || '';
    if (((msgKeyId.startsWith("BAE5") && msgKeyId.length < 32) || (msgKeyId.startsWith("3EB0") && msgKeyId.length < 32)) && msg.key?.fromMe) return;

    // Pesan `fromMe` (keluaran bot ATAU admin yang chat MANUAL dari nomor bot ke pelanggan)
    // TIDAK boleh diproses. Tanpa ini, ketika admin balas pelanggan dari nomor bot (mis. ketik
    // "siang kak"), bot ikut auto-balas sapaan → mengganggu percakapan admin↔pelanggan.
    // Jalur outbound bot sendiri (sendMessage) tak lewat sini; event fromMe = ketikan device lain
    // yang ter-link ke akun bot (HP admin). Skip semuanya supaya chat manual admin aman.
    // Sebelum skip, catat jejaknya per chat — dipakai fallback anti-diam agar bot tidak
    // menyela chat yang sedang ditangani admin (lihat customer-fallback-handler).
    if (msg.key?.fromMe) {
        noteAdminOutbound(msg.key?.remoteJid);
        return;
    }

    // ── Abaikan envelope NON-CHAT: status/story, broadcast list, dan channel/newsletter ──
    // remoteJid di sini generik (`status@broadcast`, `…@broadcast`, `…@newsletter`) sementara
    // pengirim ASLI ada di `key.participant`. Karena `isGroup` hanya true untuk `@g.us`, envelope
    // status lolos sebagai "chat pribadi": `sender` jadi `status@broadcast`, TAPI buildCanonicalContext
    // tetap me-resolve pelanggan lewat participant (jalur message_metadata). Akibatnya FOTO STATUS
    // pelanggan terdaftar ditangkap hook bukti pembayaran lalu diteruskan ke admin/owner sebagai
    // "bukti bayar" palsu. Bot tidak pernah melayani status/channel — buang SEBELUM context dibangun,
    // di-log, atau di-resolve. (Skip `fromMe` di atas hanya menangkap echo status milik bot sendiri.)
    const inboundRemoteJid = msg.key?.remoteJid || '';
    if (inboundRemoteJid === 'status@broadcast'
        || inboundRemoteJid.endsWith('@broadcast')
        || inboundRemoteJid.endsWith('@newsletter')) {
        return;
    }

    const messageContext = extractMessageContext(msg);
    if (!messageContext) {
        console.log('[WARNING] chats is undefined, skipping message processing');
        return;
    }

    const {
        from,
        type,
        chats,
        args,
        command,
        isGroup,
        sender,
        pushname,
        q
    } = messageContext;
    const lowerMessage = typeof chats === 'string' ? chats.toLowerCase().trim() : '';

    if (isGroup) {
        // Intake PSB via grup (Fase 1) — SCOPED KETAT (hanya grup PSB terkonfigurasi + feature ON) &
        // NON-THROWING (bug di sini TAK BOLEH menjatuhkan loop pesan). Ditaruh SEBELUM cek chats-undefined
        // agar pesan GAMBAR (caption di imageMessage) tetap terjangkau. Grup lain tetap diabaikan.
        try {
            const psbCfg = (global.config && global.config.psbIntake) || {};
            if (psbCfg.enabled === true && from && from === psbCfg.groupId) {
                const psbParticipant = getOptionalJid(msg, sender);
                const psbPlainPhone = psbParticipant
                    ? String(psbParticipant).split('@')[0]
                    : (typeof sender === 'string' ? sender.split('@')[0] : '');
                const { handlePsbGroupIntake } = require('./handlers/psb-group-intake');
                await handlePsbGroupIntake({
                    msg,
                    caption: chats || msg.message?.imageMessage?.caption || '',
                    type,
                    participant: psbParticipant,
                    plainPhone: psbPlainPhone,
                    accounts,
                    ownerNumber,
                    allowedRoles: psbCfg.allowedRoles,
                    usersService: global.__apiUsersService,
                    reply: (teks) => sendReply({ recipient: from, text: teks, quoted: msg }),
                    downloadMedia,
                    packages: global.packages,
                    uploadsBaseDir: require('path').join(__dirname, '..', 'uploads')
                });
            }
        } catch (psbGroupErr) {
            console.error('[PSB_GROUP_INTAKE_ERROR]', psbGroupErr.message);
        }
        return;
    }

    if (chats === undefined || chats === null) {
        console.log('[WARNING] chats is undefined, skipping message processing');
        return;
    }

    const primarySenderId = sender;
    const optionalJid = getOptionalJid(msg, sender);
    const canonicalContext = await buildCanonicalContext(sender, msg, raf);
    const canonicalSenderId = canonicalContext.canonicalId || optionalJid || sender;
    const stateSender = canonicalSenderId || sender;
    const normalizedSenderForSaldo = canonicalSenderId || sender;

    // Set fallback optional phone number (hanya untuk log / backward compatibility minor yang tak critical)
    let plainSenderNumber = canonicalContext.phoneNumber || (optionalJid ? optionalJid.split('@')[0] : sender.split('@')[0]);

    // Cek user terdaftar (untuk saldo dll) menggunakan Primary ID apa adanya (@lid)
    const isSaldo = await saldoRepository.getSaldoUser(normalizedSenderForSaldo);

    const {
        isOwner,
        isTeknisi
    } = resolveActorCapabilities({
        ownerNumber,
        primarySenderId,
        optionalJid,
        plainSenderNumber,
        accounts
    });

    // [LOGGER PESAN MASUK] read-only, fire-and-forget — TIDAK boleh throw/blokir jalur pesan.
    // Tujuan: kumpulkan korpus bahasa pelanggan untuk evaluasi fitur AI. Pakai konteks sender
    // yang SUDAH di-resolve (canonicalContext) — jangan re-resolve agar tak meracuni lid-mappings.
    // Grup sudah di-skip di atas; pesan fromMe (keluaran bot) dilewati.
    if (!msg.key?.fromMe) {
        logInboundMessageSafe({
            received_at: new Date().toISOString(),
            raw_sender: sender,
            is_lid: typeof sender === 'string' && sender.endsWith('@lid'),
            canonical_jid: canonicalContext.canonicalId || null,
            phone_number: canonicalContext.phoneNumber || (typeof plainSenderNumber === 'string' ? plainSenderNumber : null),
            pushname: pushname || null,
            role: isOwner ? 'owner' : (isTeknisi ? 'teknisi' : (canonicalContext.user ? 'customer' : 'unknown')),
            is_customer: Boolean(canonicalContext.user),
            message_type: type || null,
            body: typeof chats === 'string' ? chats : null,
            resolution_source: canonicalContext.resolutionSource || null
        });
    }

    if (sender.endsWith('@lid')) {
        console.log(`[AUTH_DEBUG] PrimaryID: ${primarySenderId}, OpsionalJID: ${optionalJid}, isSaldo: ${isSaldo !== false && isSaldo !== null}, isOwner: ${isOwner}, isTeknisi: ${!!isTeknisi}`);
    }

    (uri) => {
        return uri.match(new RegExp(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%.+#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%+.#?&/=]*)/, 'gi'))
    }

    const originalReply = (teks) => sendReply({
        recipient: from,
        text: teks,
        quoted: msg
    });

    const reply = async (teks, options = {}) => {
        if (options.skipDuplicateCheck) {
            return sendReply({
                recipient: from,
                text: teks,
                quoted: msg,
                skipDuplicateCheck: true
            });
        }
        return originalReply(teks);
    }

    let sendContact = (jid, numbers, name, quoted) => {
        return sendContactCard({
            recipient: from,
            number: numbers,
            name,
            quoted
        });
    }

    // ── [SURVEI CSAT] Tangkap balasan survei kepuasan pelanggan (DURABLE, tahan restart). ──
    // Hanya pelanggan terdaftar & saat fitur aktif (config.csatSurvey.enabled). Non-throwing.
    // Cek murah: service balik `false` cepat bila pelanggan tak punya survei aktif → pesan
    // lanjut ke pipeline normal (tak pernah membajak pesan sungguhan). Balasan lewat originalReply
    // (jalur sendReply tersanksi, BUKAN sendMessage mentah). Lihat lib/csat/csat-survey-service.js.
    const csatCfg = global.config?.csatSurvey || {};
    if (csatCfg.enabled === true && canonicalContext.user) {
        // Normal: HANYA pelanggan non-staf (staf tak disurvei). MODE TES (csatSurvey.testPhone diset):
        // nomor tes itu diizinkan menembus gerbang staf agar alur bisa diuji end-to-end pada nomor mana pun.
        const testDigits = csatCfg.testPhone ? String(csatCfg.testPhone).replace(/\D/g, '') : '';
        const senderDigits = String(canonicalContext.phoneNumber || plainSenderNumber || '').replace(/\D/g, '');
        const isCsatTestNumber = testDigits.length > 7 && senderDigits.endsWith(testDigits.slice(-9));
        if (isCsatTestNumber || (!isOwner && !isTeknisi)) {
            try {
                const csatSurvey = require('../lib/csat/csat-survey-service');
                const handledCsat = await csatSurvey.handleInboundReply({
                    user: canonicalContext.user,
                    text: chats,
                    reply: originalReply,
                    logger: console
                });
                if (handledCsat) return;
            } catch (csatErr) {
                console.error('[CSAT_REPLY_HOOK_ERROR]', csatErr && csatErr.message);
            }
        }
    }

    const botContext = buildBotContext({
        raf,
        msg,
        runtime: requestRuntime,
        data: {
            from,
            chats,
            args,
            command,
            sender,
            stateSender,
            pushname,
            plainSenderNumber,
            isOwner,
            isTeknisi,
            normalizedSenderForSaldo,
            lowerMessage
        }
    });
    const interceptorResult = runGlobalInterceptors(botContext);
    if (interceptorResult && interceptorResult.handled) {
        return;
    }

    if (!isSaldo) {
        try {
            // Kita sudah menggunakan primarySenderId (@lid atau nomor asli) secara murni
            if (primarySenderId) {
                await saldoRepository.createSaldoUser(primarySenderId, pushname);
            }
        } catch (err) {
            console.error('[SALDO_INIT] Error creating user saldo:', err);
        }
    }

    const rupiah = await saldoRepository.getSaldoUser(primarySenderId);
    convertRupiah.convert(rupiah)

    try {
        if (isProcessing(stateSender)) {
            console.log(`[CONCURRENT_PREVENTED] ${stateSender} already being processed, skipping`);
            return;
        }

        setProcessing(stateSender);

        const smartReportState = getUserState(stateSender);

        const conversationState = getUserState(stateSender);
        const {
            isInProtectedState
        } = buildStateRoutingContext({
            smartReportState,
            conversationState
        });

        const userState = getUserState(stateSender);

        let isGlobalCommand = resolveGlobalCommandStatus({
            chats,
            isInProtectedState,
            getIntentFromKeywords
        });

        if (isCancellationKeyword(chats)) {
            isGlobalCommand = true;
            deleteUserState(stateSender);
            await reply(format('success_process_cancelled') || 'Baik, proses sebelumnya sudah dibatalkan.');
            clearProcessing(stateSender);
            return;
        }

        if (smartReportState && isGlobalCommand && !isInProtectedState) {
            console.log(`[GLOBAL_COMMAND] User ${stateSender} broke out of state with command: "${chats}"`);
            deleteUserState(stateSender);
        }
        const conversationTeknisiState = getUserState(stateSender);
        const conversationStateResult = await routeConversationState({
            stateStep: userState?.step || smartReportState?.step || conversationTeknisiState?.step,
            userState,
            smartReportState,
            teknisiState: conversationTeknisiState,
            msg,
            raf,
            sender,
            stateSender,
            chats,
            type,
            reply,
            global: runtimeGlobalScope,
            format,
            isGlobalCommand,
            isOwner,
            isTeknisi,
            users,
            args,
            plainSenderNumber,
            pushname,
            mess,
            sleep,
            getSSIDInfo,
            namabot,
            buatLaporanGangguan,
            setUserState,
            deleteUserState,
            getUserState,
            temp,
            routeManagedState,
            handleManagedConversationState,
            handleConversationState,
            handleMenuSelection,
            handleTroubleshootResult,
            handleMatiConfirmation,
            handleMatiTroubleshootOptions,
            handleMatiPhotoUpload,
            handleLemotPhotoUpload,
            handleDirectConfirmation,
            handleDirectLemotResponse,
            downloadMedia,
            getReportsUploadsPath,
            addPhotoToQueue,
            handleCustomerPhotoUpload,
            handleGeneralSteps,
            handleGangguanMatiOfflineResponse,
            handleGangguanMatiOnlineResponse,
            handleGangguanLemotResponse,
            handleLegacyTeknisiStateTransitions,
            getTeknisiUploadsPathByTicket,
            handleTeknisiPhotoUpload,
            handleTeknisiShareLocation,
            handleCompleteTicket,
            handleTeknisiResolutionNotesState,
            handleTeknisiCompletionConfirmationState,
            domainServices,
            getvoucher,
            handleVoucherChoiceState,
            agentVoucherConversationHandlers
        });
        if (conversationStateResult.handled) {
            if (conversationStateResult.message) {
                await reply(conversationStateResult.message);
            }
            return;
        }

        // ── Perintah panduan PSB (teknisi) — teks "#psb"/"psb tutorial"/"panduan psb" (TANPA foto) ──
        // Balas panduan lengkap format + alur, sebelum wizard. Gated sama (feature ON + akun staf) + NON-THROWING.
        try {
            const psbDmCfg = (global.config && global.config.psbIntake) || {};
            const { isPsbTutorialTrigger } = require('./handlers/state-domains/psb.state');
            if (psbDmCfg.enabled === true && type !== 'imageMessage' && isPsbTutorialTrigger(chats)) {
                const { resolveAuthorizedStaff } = require('./handlers/psb-group-intake');
                const psbStaff = resolveAuthorizedStaff({ participant: optionalJid || sender, plainPhone: plainSenderNumber, accounts, allowedRoles: psbDmCfg.allowedRoles });
                if (psbStaff) {
                    const { psbTutorialText } = require('./handlers/state-domains/psb.state');
                    await reply(psbTutorialText());
                    return;
                }
            }
        } catch (psbTutErr) {
            console.error('[PSB_TUTORIAL_TRIGGER_ERROR]', psbTutErr.message);
        }

        // ── Trigger DAFTAR/JADWAL PSB (teknisi/admin) — teks "#jadwal" / "jadwal psb" / "psb baru" ──
        // Buka sesi slot-filling jadwal (step PSBJADWAL_COLLECT); lanjutannya dirutekan otomatis oleh
        // routeConversationState (owner "psb-schedule"). Gated sama (feature ON + akun staf) + NON-THROWING.
        try {
            const psbDmCfg = (global.config && global.config.psbIntake) || {};
            if (psbDmCfg.enabled === true && type !== 'imageMessage' && /^\s*(#?jadwal|psb\s+baru)\b/i.test(String(chats || ''))) {
                const { resolveAuthorizedStaff } = require('./handlers/psb-group-intake');
                const jadwalStaff = resolveAuthorizedStaff({ participant: optionalJid || sender, plainPhone: plainSenderNumber, accounts, allowedRoles: psbDmCfg.allowedRoles });
                if (jadwalStaff) {
                    const { startPsbScheduleSession } = require('./handlers/state-domains/psb-schedule.state');
                    await startPsbScheduleSession({ chats, staff: jadwalStaff, stateSender, reply, setUserState, area: (global.config && global.config.nama) || null });
                    return;
                }
            }
        } catch (jadwalErr) {
            console.error('[PSB_JADWAL_TRIGGER_ERROR]', jadwalErr.message);
        }

        // ── Trigger PETAKAN ASET (teknisi/admin) — teks "#ODC <nama>" / "#ODP <nama>" ──
        // Peta jaringan selama ini KOSONG karena satu-satunya jalur input adalah halaman admin, dan di
        // sana teknisi di-403 — orang yang paling tahu posisi ODP justru terkunci. Ini membuka jalur
        // lapangan: cukup nama + share lokasi (induk ODC dipilihkan bot). Lanjutannya dirutekan otomatis
        // oleh routeConversationState (owner "network-asset", prefix step ASSET_).
        // Gate: akun staf (sama seperti #jadwal) + config `networkAssets.waIntake.enabled` (default ON).
        // NON-THROWING: gagal di sini tak boleh menjatuhkan pesan lain.
        // 6 perintah menata jaringan, semuanya khusus STAF:
        //   #ODC/#ODP <nama>   → petakan (nama SUDAH ADA = edit, bukan duplikat)
        //   #ISI <nama ODP>    → sambungkan pelanggan ke ODP (terima nomor ATAU nama → tak butuh GPS)
        //   #LOKASI <pelanggan>→ simpan titik GPS pelanggan
        //   #JALUR <nama ODP>  → rekam BENTUK jalur kabel ODC→ODP (share lokasi tiap belokan)
        //   bantuan aset       → KARTU perintah + papan progres (satu-satunya tempat semuanya terlihat)
        //   odp <nama>         → cek hunian (3/8, siapa saja, link peta) — TANPA '#', jadi tak bentrok
        // Non-staf yang kebetulan mengetik "odp ..." → resolveAuthorizedStaff null → jatuh ke alur normal.
        try {
            const asetCfg = (global.config && global.config.networkAssets) || {};
            const asetAktif = !(asetCfg.waIntake && asetCfg.waIntake.enabled === false);
            const aset = require('./handlers/state-domains/network-asset.state');
            const teksAset = String(chats || '');
            const cocokAset = aset.TRIGGER_RE.test(teksAset) || aset.FILL_RE.test(teksAset)
                || aset.LOC_RE.test(teksAset) || aset.ROUTE_RE.test(teksAset)
                || aset.HELP_RE.test(teksAset) || aset.INSPECT_RE.test(teksAset);

            if (asetAktif && type !== 'imageMessage' && cocokAset) {
                const { resolveAuthorizedStaff } = require('./handlers/psb-group-intake');
                const asetStaff = resolveAuthorizedStaff({
                    participant: optionalJid || sender,
                    plainPhone: plainSenderNumber,
                    accounts,
                    allowedRoles: (global.config && global.config.psbIntake && global.config.psbIntake.allowedRoles) || null
                });
                if (asetStaff) {
                    const ctxAset = { chats, staff: asetStaff, stateSender, reply, setUserState, deleteUserState };
                    if (aset.TRIGGER_RE.test(teksAset)) await aset.startNetworkAssetSession(ctxAset);
                    else if (aset.FILL_RE.test(teksAset)) await aset.startFillSession(ctxAset);
                    else if (aset.LOC_RE.test(teksAset)) await aset.startLocationSession(ctxAset);
                    else if (aset.ROUTE_RE.test(teksAset)) await aset.startRouteSession(ctxAset);
                    else if (aset.HELP_RE.test(teksAset)) await aset.showAssetHelp(ctxAset);
                    else await aset.inspectOdp(ctxAset);
                    return;
                }

                // GAGAL-SENYAP DITUTUP. Sebelumnya nomor yang belum terdaftar sebagai staf hanya
                // "didiamkan" — teknisi menyimpulkan botnya rusak lalu berhenti mencoba, dan tak ada
                // satu pun jejak kenapa. Hanya untuk perintah ber-`#` + kartu bantuan (niat petugas
                // sudah jelas); `odp <nama>` tanpa `#` TETAP senyap supaya kalimat pelanggan biasa
                // ("odp saya mati") tak dijawab dengan pesan petugas.
                const perintahJelas = aset.TRIGGER_RE.test(teksAset) || aset.FILL_RE.test(teksAset)
                    || aset.LOC_RE.test(teksAset) || aset.ROUTE_RE.test(teksAset) || aset.HELP_RE.test(teksAset);
                if (perintahJelas) {
                    console.warn('[ASET_TRIGGER_DITOLAK] nomor belum terdaftar sebagai petugas:', plainSenderNumber);
                    const { renderResponseTemplate } = require('./handlers/template-helpers');
                    await reply(renderResponseTemplate(
                        'aset_bukan_petugas',
                        '🔒 Perintah peta jaringan khusus *petugas*.\n\nNomor ini belum terdaftar — minta admin mendaftarkan nomor kamu dulu, baru perintahnya bisa dipakai.',
                        {}
                    ));
                    return;
                }
            }
        } catch (asetErr) {
            console.error('[ASET_TRIGGER_ERROR]', asetErr.message);
        }

        // ── Perintah KEUANGAN PRIBADI owner — "keluar/masuk <nominal> ..." atau "uang ..." ──
        // Dompet PRIBADI pemilik yang menumpang nomor bot bisnis. Terisolasi penuh dari saldo
        // pelanggan: DB sendiri (personal_finance.sqlite), tak menyentuh lib/saldo, tak menulis
        // activity_logs. Gate: config `personalFinance.enabled` (default OFF) + daftar pemilik
        // TERPISAH (`personalFinance.ownerJids`, bukan `ownerNumber`) — supaya menambah admin
        // bisnis tak pernah ikut membuka dompet pribadi.
        //
        // TANPA prefix (dulu `#U`, dibuang karena ribet untuk pemakaian harian). Boleh telanjang
        // KARENA urutannya: cocok-kata → lalu cek IDENTITAS, dan hanya pemilik yang diproses.
        // Pesan pelanggan yang kebetulan berbunyi "masuk" tetap jatuh ke alur normal.
        //
        // Letaknya SESUDAH routing conversation-state (di atas), jadi kalau pemilik sedang di
        // tengah wizard PSB/aset, kata "keluar" tetap milik wizard itu — bukan dibajak dompet.
        //
        // BEDA SENGAJA dari gerbang aset di atas: bukan-pemilik TIDAK diberi tahu apa pun, dia
        // jatuh ke alur normal. Membalas "khusus pemilik" akan membocorkan ke pelanggan bahwa
        // ada dompet pribadi di nomor ini — persis yang harus dihindari.
        // NON-THROWING: gagal di sini tak boleh menjatuhkan pesan lain.
        try {
            const pfCfg = (global.config && global.config.personalFinance) || {};
            const pf = require('./handlers/personal-finance-wa');
            if (pfCfg.enabled === true && type !== 'imageMessage' && pf.TRIGGER_RE.test(String(chats || ''))) {
                const pemilik = pf.resolvePersonalFinanceOwner({
                    participant: optionalJid || sender,
                    plainPhone: plainSenderNumber,
                    config: global.config
                });
                if (pemilik) {
                    await pf.handlePersonalFinanceCommand({ chats, reply, config: global.config });
                    return;
                }
            }
        } catch (pfErr) {
            console.error('[PF_TRIGGER_ERROR]', pfErr.message);
        }

        // ── Perintah assignment papan PSB (Fase B/2 [[psb-papan-terjadwal]]) — "ambil/tugaskan/papan psb" ──
        // One-shot (TANPA state): teknisi AMBIL, admin TUGASKAN, semua staf lihat PAPAN. Pakai core
        // assignSchedule + builder DM/notif yang SAMA dgn web. Gated (feature ON + akun staf) + NON-THROWING.
        // Non-staf yang kebetulan ketik "ambil/tugaskan/papan psb" → diabaikan (lanjut ke alur normal).
        try {
            const psbDmCfg = (global.config && global.config.psbIntake) || {};
            if (psbDmCfg.enabled === true && type !== 'imageMessage' && /^\s*(ambil|tugaskan|papan|daftar)\s+psb\b/i.test(String(chats || ''))) {
                const { resolveAuthorizedStaff } = require('./handlers/psb-group-intake');
                const psbAssignStaff = resolveAuthorizedStaff({ participant: optionalJid || sender, plainPhone: plainSenderNumber, accounts, allowedRoles: psbDmCfg.allowedRoles });
                if (psbAssignStaff) {
                    const { handlePsbAssignCommand } = require('./handlers/psb-assign-command');
                    await handlePsbAssignCommand({ text: chats, staff: psbAssignStaff, reply });
                    return;
                }
            }
        } catch (psbAssignErr) {
            console.error('[PSB_ASSIGN_TRIGGER_ERROR]', psbAssignErr.message);
        }

        // ── Trigger wizard PSB via DM teknisi (Fase 2 [[psb-simplification-plan]]) ──
        // #PSB + foto KTP dari teknisi (DM, BUKAN grup) → buka sesi PSB (step PSB_COLLECT_DOCS);
        // lanjutan (foto rumah/lokasi/konfirmasi) dirutekan otomatis oleh routeConversationState
        // (owner "psb"). SCOPED KETAT (feature ON + akun staf ber-role) + NON-THROWING.
        try {
            const psbDmCfg = (global.config && global.config.psbIntake) || {};
            const psbCaption = chats || msg.message?.imageMessage?.caption || '';
            const isPsbCmd = /^\s*#psb\b/i.test(String(psbCaption));
            // C/2: "#PSB PSB-<n>" boleh mulai via TEKS (tanpa foto) — bukti diambil dari jadwal papan.
            let psbLinkedRef = null;
            if (isPsbCmd) { try { psbLinkedRef = require('./handlers/state-domains/psb.state').parsePsbScheduleRef(psbCaption); } catch (_e) { psbLinkedRef = null; } }
            if (psbDmCfg.enabled === true && isPsbCmd && (type === 'imageMessage' || psbLinkedRef)) {
                const { resolveAuthorizedStaff } = require('./handlers/psb-group-intake');
                const psbStaff = resolveAuthorizedStaff({ participant: optionalJid || sender, plainPhone: plainSenderNumber, accounts, allowedRoles: psbDmCfg.allowedRoles });
                if (psbStaff) {
                    const { startPsbSession } = require('./handlers/state-domains/psb.state');
                    await startPsbSession({ caption: psbCaption, type, msg, staff: psbStaff, stateSender, reply, downloadMedia, setUserState });
                    return;
                }
            }
        } catch (psbDmErr) {
            console.error('[PSB_DM_TRIGGER_ERROR]', psbDmErr.message);
        }

        // ── Trigger wizard TITIK LOKASI pelanggan via DM staf ──
        // `lokasi` (borongan: daftar yang belum punya titik) atau `lokasi <nama>` (cari) → buka sesi
        // (step CUSTLOC_PICK); lanjutannya dirutekan routeConversationState (owner "customer-location").
        // Ditaruh SEBELUM handleActiveTicketLocationUpdate, tapi HANYA memicu pada perintah TEKS —
        // pesan lokasi mentah tetap milik alur tiket `otw [ID]`, tak ada yang dibajak.
        try {
            const { isCustomerLocationTrigger, parseLocationCommand } = require('./handlers/state-domains/customer-location.state');
            if (type !== 'imageMessage' && isCustomerLocationTrigger(chats)) {
                const { resolveAuthorizedStaff } = require('./handlers/psb-group-intake');
                const locStaff = resolveAuthorizedStaff({ participant: optionalJid || sender, plainPhone: plainSenderNumber, accounts, allowedRoles: ['teknisi', 'admin', 'owner'] });
                if (locStaff) {
                    const { startCustomerLocationSession } = require('./handlers/state-domains/customer-location.state');
                    await startCustomerLocationSession({
                        query: parseLocationCommand(chats).query,
                        staff: locStaff, stateSender, reply, setUserState
                    });
                    return;
                }
            }
        } catch (custLocErr) {
            console.error('[CUSTLOC_TRIGGER_ERROR]', custLocErr.message);
        }

        const activeTicketLocationResult = await handleActiveTicketLocationUpdate({
            sender,
            type,
            msg,
            reply
        });
        if (activeTicketLocationResult.handled) {
            if (activeTicketLocationResult.message) {
                await reply(activeTicketLocationResult.message);
            }
            return;
        }

        // ── Pin lokasi dari PELANGGAN → tawarkan simpan sebagai titik rumahnya ──
        // Sumber koordinat paling akurat (dikirim pelanggan dari rumahnya sendiri) & nol kerja teknisi.
        // Ditaruh SESUDAH alur tiket supaya share-lokasi untuk `otw [ID]` tetap milik tiket, dan hanya
        // untuk pengirim NON-staf yang sedang tak punya percakapan aktif. Gate config, default OFF.
        try {
            const selfLocCfg = (global.config && global.config.customerLocationSelfService) || {};
            const isLoc = type === 'locationMessage' || type === 'liveLocationMessage';
            if (selfLocCfg.enabled === true && isLoc && !isTeknisi && !isOwner && !userState?.step) {
                const loc = type === 'locationMessage' ? msg.message?.locationMessage : msg.message?.liveLocationMessage;
                const { findUserByPhone } = require('./handlers/utils');
                const pelanggan = findUserByPhone(plainSenderNumber);
                if (pelanggan && loc && loc.degreesLatitude && loc.degreesLongitude) {
                    const { offerSelfLocation } = require('./handlers/state-domains/customer-location.state');
                    const offered = await offerSelfLocation({
                        customer: pelanggan,
                        point: { lat: loc.degreesLatitude, lng: loc.degreesLongitude },
                        stateSender, reply, setUserState
                    });
                    if (offered && offered.offered) return;
                }
            }
        } catch (selfLocErr) {
            console.error('[CUSTLOC_SELF_ERROR]', selfLocErr.message);
        }

        const isInManagedWifiInputState = userState?.step && userState.step.startsWith('ASK_NEW_');

        if (userState?.step && isGlobalCommand && !isInManagedWifiInputState) {
            console.log(`[GLOBAL_COMMAND] Clearing managed state for ${stateSender}`);
            deleteUserState(stateSender);
        }

        const managedConversationResult = await routeManagedState({
            handleManagedConversationState,
            getUserState,
            stateSender,
            isGlobalCommand,
            handleConversationState,
            chats,
            temp,
            reply,
            global: runtimeGlobalScope,
            isOwner,
            isTeknisi,
            users,
            args,
            plainSenderNumber,
            pushname,
            mess,
            sleep,
            getSSIDInfo,
            namabot,
            buatLaporanGangguan
        });
        if (managedConversationResult.handled) {
            return;
        }

        // ── FOTO/DOKUMEN "yatim" dari pelanggan (tanpa percakapan aktif) ──
        // Pelanggan sering mengirim bukti transfer sebagai FOTO TANPA teks. Tanpa hook ini, foto
        // polos dibuang di guard `!chats` di bawah → pelanggan tak dapat respons apa pun. Semua flow
        // foto ber-state (PSB/keluhan/teknisi) sudah ditangani di atas (routeConversationState &
        // managed state); di sini hanya foto dari pelanggan TERDAFTAR yang tidak sedang berada dalam
        // alur apa pun. SCOPED (customer only, bukan staf, tanpa userState.step aktif) + NON-THROWING
        // + feature-gated (config.paymentProof.enabled, default ON).
        //
        // KEPUTUSAN "bukti bayar atau bukan" TIDAK diambil di sini — lihat lib/payment-proof-intake-policy
        // (fungsi murni, diuji ulang terhadap korpus prod). Di sini kita hanya MENGUMPULKAN SINYAL:
        //   - adminActive    : admin sedang membalas manual di chat ini (jejak DURABEL, lintas restart)
        //   - recentComplaint: pelanggan baru mengeluh koneksi (jejak DURABEL)
        //   - signalReady    : jejak sudah pulih dari disk? Kalau belum, bot BUTA → policy fail-closed.
        //                      Dulu sinyal ini cuma Map in-memory: restart = amnesia, dan gerbangnya
        //                      diam-diam merosot jadi "tangkap semua foto" (insiden 14-07).
        if ((type === 'imageMessage' || type === 'documentMessage')
            && canonicalContext.user
            && !isOwner && !isTeknisi
            && !userState?.step
            && (runtimeGlobalScope?.config?.paymentProof?.enabled !== false)) {
            try {
                const ppCfg = runtimeGlobalScope?.config?.paymentProof || {};
                const ppAdminQuietMs = (Number.isFinite(ppCfg.adminQuietMinutes) ? ppCfg.adminQuietMinutes : 15) * 60 * 1000;
                const ppComplaintQuietMs = (Number.isFinite(ppCfg.complaintQuietMinutes) ? ppCfg.complaintQuietMinutes : 15) * 60 * 1000;
                const chatKeys = [sender, stateSender];

                const { handleIncomingPaymentProof } = require('./handlers/payment-proof-handler');
                const proofResult = await handleIncomingPaymentProof({
                    msg,
                    user: canonicalContext.user,
                    canonicalSender: normalizedSenderForSaldo,
                    pushname,
                    messageType: type,
                    reply,
                    downloadMedia,
                    adminActive: isAdminHandlingChat(chatKeys, ppAdminQuietMs),
                    recentComplaint: hasRecentComplaint(chatKeys, ppComplaintQuietMs),
                    signalReady: isChatSignalReady()
                });
                if (proofResult && proofResult.handled) return;
            } catch (proofErr) {
                console.error('[PAYMENT_PROOF_TRIGGER_ERROR]', proofErr.message);
            }
        }

        // ── Keputusan ADMIN atas REQUEST GANTI PAKET, langsung dari WhatsApp ──
        // Teknisi/admin mengajukan ganti paket lewat web → admin dapat notif ber–Request ID → admin
        // membalas notif itu (*ok* / *tolak <alasan>* / *batalkan*), mengetik *ok req_pkg_…*, atau
        // *request paket* untuk melihat antrian. Tanpa hook ini approval HANYA bisa lewat portal.
        // DITARUH SEBELUM hook bukti-bayar: handler paket hanya meng-klaim balasan-quote yang teks
        // ter-quote-nya memuat id `req_pkg_…` (+ kode eksplisit + `request paket`) — sisanya dilepas
        // apa adanya ke bukti-bayar, jadi tak ada yang saling membajak. Gate peran presisi
        // (accounts.json); non-admin & perintah tanpa sasaran → handled:false senyap. Lanjutan
        // (`ya`/angka) dirutekan `routeConversationState` lewat state `PKGREQ_*` (owner "package-request").
        if (typeof chats === 'string' && chats.trim() !== ''
            && !userState?.step
            && (runtimeGlobalScope?.config?.packageRequestWa?.enabled !== false)) {
            try {
                const { handlePackageRequestAdminDecision } = require('./handlers/package-request-admin-handler');
                const decision = await handlePackageRequestAdminDecision({
                    chats,
                    msg,
                    sender,
                    plainSenderNumber,
                    stateSender,
                    pushname,
                    accounts,
                    reply,
                    setUserState
                });
                if (decision && decision.handled) return;
            } catch (pkgAdminErr) {
                console.error('[PACKAGE_REQUEST_ADMIN_TRIGGER_ERROR]', pkgAdminErr.message);
            }
        }

        // ── Keputusan ADMIN atas bukti pembayaran, langsung dari WhatsApp ──
        // Pasangan dari hook di atas: pelanggan kirim foto → admin dapat notif bergambar → admin
        // membalas notif itu (*ok* / *tolak <alasan>*), mengetik *terima 1* / *bukti*, atau sekadar
        // *ok* polos (bot menawarkan antrian & minta *ya*). Tanpa hook ini konfirmasi HANYA bisa lewat
        // portal web. Handler memvalidasi peran presisi (accounts.json) dan mengembalikan handled:false
        // secara SENYAP untuk non-admin DAN saat antrian kosong — jadi aman ditaruh sebelum resolusi
        // intent: pelanggan yang menulis "ok" tak akan pernah menyentuhnya. Lanjutan (`ya`/angka)
        // dirutekan `routeConversationState` lewat state `PAYPROOF_*` (owner "payment-proof").
        if (typeof chats === 'string' && chats.trim() !== ''
            && !userState?.step
            && (runtimeGlobalScope?.config?.paymentProof?.enabled !== false)) {
            try {
                const { handlePaymentProofAdminDecision } = require('./handlers/payment-proof-admin-handler');
                const decision = await handlePaymentProofAdminDecision({
                    chats,
                    msg,
                    sender,
                    plainSenderNumber,
                    stateSender,
                    pushname,
                    accounts,
                    reply,
                    setUserState
                });
                if (decision && decision.handled) return;
            } catch (proofAdminErr) {
                console.error('[PAYMENT_PROOF_ADMIN_TRIGGER_ERROR]', proofAdminErr.message);
            }
        }

        let intent;
        let entities = {}; // Default entitas kosong
        let matchedKeywordLength = 0; // Menyimpan jumlah kata dari keyword yang cocok

        if (!chats || chats.trim() === '') return;

        const wifiInputGuardResult = handleWifiInputGuard({
            userState,
            chats,
            stateSender,
            deleteUserState,
            reply,
            format,
            clearProcessing
        });
        if (wifiInputGuardResult.handled) {
            return;
        }
        const { isAgent } = await resolveAgentContext({
            sender,
            msg,
            isGroup,
            raf,
            extractSenderInfo,
            agentTransactionManager,
            agentManager
        });

        // Matcher longgar hanya untuk non-staf (owner/teknisi/agen tetap ketat — chat
        // koordinasi mereka jangan ditebak-tebak), kill-switch: customerAssist.looseMatcher.enabled=false.
        const looseMatcherConfig = runtimeGlobalScope?.config?.customerAssist?.looseMatcher;
        const looseIntentEnabled = (!looseMatcherConfig || looseMatcherConfig.enabled !== false)
            && !isOwner && !isTeknisi && !isAgent;

        const keywordIntentResult = resolveKeywordIntent({
            chats,
            isAgent,
            getIntentFromKeywords,
            args,
            q,
            command,
            getLooseIntentFromKeywords,
            looseIntentEnabled
        });
        if (keywordIntentResult.intent) {
            intent = keywordIntentResult.intent;
            matchedKeywordLength = keywordIntentResult.matchedKeywordLength;
            console.log(`[INTENT_DEBUG] Keyword match found: ${intent} for message: "${chats}"${keywordIntentResult.isLooseMatch ? ' (loose)' : ''}`);
        }
        let qAfterKeyword = keywordIntentResult.qAfterKeyword;

        // Fallback anti-diam (gate customerAssist.fallback.enabled, default MATI): pelanggan
        // terdaftar chat bebas tanpa intent → keluhan bergejala dialihkan ke CEK_KONEKSI,
        // selain itu menu bantuan ber-cooldown. Modul tidak pernah throw.
        if (!intent) {
            const fallbackResult = await evaluateCustomerFallback({
                chats,
                sender,
                stateSender,
                pushname,
                customer: canonicalContext.user,
                isOwner,
                isTeknisi,
                isAgent,
                reply,
                globalConfig: runtimeGlobalScope?.config
            });
            if (fallbackResult && fallbackResult.action === 'intent' && fallbackResult.intent) {
                intent = fallbackResult.intent;
                matchedKeywordLength = Array.isArray(args) ? args.length : 0;
                qAfterKeyword = '';
                console.log(`[INTENT_DEBUG] Fallback intent: ${intent} for message: "${chats}"`);
            }
        }

        console.log(`[INTENT_DEBUG] Final intent: ${intent} for message: "${chats}", matchedKeywordLength: ${matchedKeywordLength}, qAfterKeyword: "${qAfterKeyword}"`);

        await dispatchIntent({
            ...botContext,
            intent,
            q,
            qAfterKeyword,
            chats,
            args,
            command,
            lowerMessage,
            entities,
            matchedKeywordLength,
            intentOwner: INTENT_OWNER_MAP[intent] || "legacy",
            sender,
            stateSender,
            pushname,
            msg,
            raf,
            from,
            pay,
            isOwner,
            isTeknisi,
            plainSenderNumber,
            normalizedSenderForSaldo,
            reply,
            global: runtimeGlobalScope,
            mess,
            temp,
            format,
            ownerNumber,
            sendContact,
            users,
            sleep,
            getSSIDInfo,
            namabot,
            buatLaporanGangguan,
            setUserState,
            deleteUserState,
            getUserState,
            handleStatusPpp,
            handleStatusHotspot,
            handleCekTiket,
            handleAgentConfirmation,
            handleRemoteResponse,
            handleCompletionConfirmation,
            addPayment,
            getvoucher,
            handleBantuan,
            handleSapaanUmum,
            handleMenuPelanggan,
            handleMenuUtama,
            handleMenuTeknisi,
            handleMenuOwner,
            handleTanyaCaraPasang,
            handleTanyaPaketBulanan,
            handleTutorialTopup,
            handleListProfStatik,
            handleListProfVoucher,
            statik: statikCatalog,
            voucher: voucherCatalog,
            handleCekSaldo,
            handleTanyaHargaVoucher,
            handleTransferSaldo,
            handleCancelTopup,
            extractSenderInfo,
            agentTransactionManager,
            handleAccessManagement,
            handleListAgents,
            handleAgentByArea,
            handleAgentServices,
            handleSearchAgent,
            handleViewAgentDetail,
            handleAgentTodayTransactions,
            handleCheckTopupStatus,
            handleAgentSelfProfile,
            handleAgentPinChange,
            handleAgentProfileUpdate,
            handleAgentStatusToggle,
            handleStatusAp,
            handleAllSaldo,
            handleVc123,
            handleAllUser,
            handleAdminContact,
            handleGantiPowerWifi,
            handleRebootModem,
            handleCekWifi,
            handleHistoryWifi,
            handleMonitorWifi,
            handleAddProfVoucher,
            handleDelProfVoucher,
            handleAddProfStatik,
            handleDelProfStatik,
            handleAddBinding,
            addbinding,
            addqueue,
            handleAddPPP,
            addpppoe: addPPPoEUser, // M6: aliased ke addPPPoEUser (direct spawn) — addpppoe HTTP path
            // skip dependency raf-bot self-call (axios → Express → php-express → spawn).
            handleTopup,
            handleDelSaldo,
            handleTransfer,
            handleCekTagihan,
            renderTemplate,
            findUserWithLidSupport,
            handleCheckPackage,
            handleComplaint,
            handleServiceInfo,
            handleUbahPaket,
            processLidVerification,
            repositories: domainRepositories,
            ...domainHandlers,
            ...domainServices,
            handleCekLokasiTeknisi,
            handleTiketSaya,
            handleProsesTicket,
            handleOTW,
            handleSampaiLokasi,
            handleVerifikasiOTP,
            handleCompleteTicket,
            handleSelesaiTicket,
            handleTeknisiResolutionNotesState,
            handleTeknisiCompletionConfirmationState,
        });

    } catch (err) {
        if (typeof err === "string") return reply(String(err));
        console.log(err)
    } finally {
        clearProcessing(stateSender);
    }
}
