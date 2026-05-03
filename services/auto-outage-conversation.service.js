/**
 * Header Doc
 * Purpose: Mengelola percakapan WhatsApp auto outage, triage jawaban pelanggan, media, dan konfirmasi tiket.
 * Caller: `message/handlers/state-domains/auto-outage-state-handler.js`, `routes/admin-auto-outage-routes.js`.
 * Deps: `repositories/auto-outage.repository.js`, response template helper, WhatsApp delivery service, ticket/report orchestration service.
 * MainFuncs: `createAutoOutageConversationService`, `startConversation`, `handleCustomerReply`, `sendTicketConfirmation`, `finalizeTicketDecision`.
 * SideEffects: Mengirim WhatsApp, menyimpan conversation state, dan membuat tiket setelah konfirmasi pelanggan.
 */
"use strict";

function optionalRequire(path, exportName, fallback) {
    try {
        const loaded = require(path);
        return loaded?.[exportName] || fallback;
    } catch (_error) {
        return fallback;
    }
}

function defaultDeps() {
    return {
        repository: require("../repositories/auto-outage.repository").createAutoOutageRepository(),
        sendMessage: optionalRequire("../lib/whatsapp-delivery-service", "sendMessage", null),
        renderResponseTemplate: optionalRequire("../lib/response-template-helper", "renderResponseTemplate", (_key, fallback) => fallback),
        createCustomerReportTicket: optionalRequire("../lib/report-orchestration-service", "createCustomerReportTicket", null),
        now: () => new Date()
    };
}

function normalizeReply(text) {
    return String(text || "").trim().toLowerCase();
}

function getPhoneTarget(user = {}) {
    return String(user.phone_number || user.phone || "").split("|").map((value) => value.trim()).filter(Boolean)[0] || null;
}

function classifyTriage(text) {
    const value = normalizeReply(text);
    if (!value) return "unknown";
    if (["1", "aman", "tidak ada kendala", "sengaja dimatikan", "normal"].includes(value)) return "aman";
    if (["2", "ada kendala", "kendala", "gangguan"].includes(value)) return "ada_kendala";
    if (value.includes("alat mati") || value.includes("modem mati") || value.includes("power mati") || value.includes("tidak nyala")) return "alat_mati";
    if (value.includes("los") || value.includes("lampu merah") || value.includes("kabel") || value.includes("putus") || value.includes("fiber")) return "los_kabel";
    if (value.includes("tidak internet") || value.includes("no internet") || value.includes("tidak bisa browsing") || value.includes("wifi nyala")) return "no_internet";
    if (value.includes("lambat") || value.includes("lemot") || value.includes("putus-putus") || value.includes("sering dc")) return "lambat";
    return "lainnya";
}

function wantsTicket(text) {
    return ["ya", "y", "iya", "ajukan", "buat tiket", "mau"].includes(normalizeReply(text));
}

function declinesTicket(text) {
    return ["tidak", "tdk", "no", "n", "jangan", "belum"].includes(normalizeReply(text));
}

function render(deps, key, fallback, data) {
    return deps.renderResponseTemplate ? deps.renderResponseTemplate(key, fallback, data) : fallback;
}

function createAutoOutageConversationService(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };

    async function sendText(user, text) {
        const target = getPhoneTarget(user);
        if (!target || !deps.sendMessage) return { skipped: true };
        return deps.sendMessage(target, { text });
    }

    async function startConversation({ user = {}, state = {}, rule = {} } = {}) {
        const fallback = rule.template_initial || "Halo ${nama}, sistem kami mendeteksi koneksi WiFi/PPPoE tidak aktif. Apakah ada kendala pada WiFi-nya? Balas AMAN atau ADA KENDALA.";
        const text = render(deps, "auto_outage_initial_question", fallback, {
            nama: user.name || "",
            pppoe_username: user.pppoe_username || state.pppoe_username || "",
            offline_since: state.offline_since || ""
        });
        const conversation = await deps.repository.createConversation({
            state_id: state.id || null,
            user_id: String(user.id),
            pppoe_username: user.pppoe_username || state.pppoe_username || null,
            status: "waiting_initial",
            media_json: []
        });
        if (deps.repository.upsertStates && state.id) {
            await deps.repository.upsertStates([{
                ...state,
                user_id: String(user.id),
                pppoe_username: user.pppoe_username || state.pppoe_username,
                status: "pending_confirmation",
                conversation_id: conversation.id,
                last_broadcast_at: deps.now().toISOString(),
                broadcast_count: Number(state.broadcast_count || 0) + 1
            }]);
        }
        await sendText(user, text);
        return { conversation, text };
    }

    async function sendTicketConfirmation({ user = {}, conversation = {}, category, description } = {}) {
        const fallback = "Terima kasih Kak. Ajukan tiket gangguan sekarang? Balas YA untuk ajukan tiket, atau TIDAK jika belum perlu.";
        const text = render(deps, "auto_outage_ticket_confirmation", fallback, {
            category: category || conversation.triage_category || "",
            description: description || conversation.description || ""
        });
        await sendText(user, text);
        return { text };
    }

    async function finalizeTicketDecision({ user = {}, conversation = {}, text = "" } = {}) {
        if (wantsTicket(text)) {
            const ticket = deps.createCustomerReportTicket
                ? await deps.createCustomerReportTicket({
                    user,
                    category: conversation.triage_category || "lainnya",
                    description: conversation.description || "",
                    source: "auto_outage",
                    pppoe_username: conversation.pppoe_username || user.pppoe_username || null,
                    media: conversation.media_json || []
                })
                : { ticketId: null };
            const ticketId = ticket.ticketId || ticket.id || null;
            await deps.repository.updateConversation(conversation.id, {
                status: "closed",
                ticket_requested: true,
                ticket_id: ticketId,
                closed_reason: "ticket_created"
            });
            const message = render(deps, "auto_outage_ticket_created", "Tiket gangguan berhasil dibuat.", { ticket_id: ticketId || "" });
            await sendText(user, message);
            return { ticketCreated: true, ticketId };
        }

        if (declinesTicket(text)) {
            await deps.repository.updateConversation(conversation.id, {
                status: "closed",
                ticket_requested: false,
                closed_reason: "customer_declined_ticket"
            });
            return { ticketCreated: false, closed: true };
        }

        return sendTicketConfirmation({ user, conversation });
    }

    async function handleCustomerReply(context = {}) {
        const user = context.user || {};
        const text = String(context.text || "");
        const conversation = await deps.repository.getOpenConversationByUserId(String(user.id));
        if (!conversation) {
            return { handled: false, reason: "no_open_conversation" };
        }

        if (conversation.status === "waiting_ticket_confirm") {
            return finalizeTicketDecision({ user, conversation, text });
        }

        const category = classifyTriage(text);
        if (category === "aman") {
            await deps.repository.updateConversation(conversation.id, {
                status: "closed",
                initial_answer_raw: text,
                triage_category: "aman",
                closed_reason: "customer_safe"
            });
            const message = render(deps, "auto_outage_safe_closed", "Baik Kak, terima kasih konfirmasinya. Tidak kami buatkan tiket.", {});
            await sendText(user, message);
            return { handled: true, category: "aman", closed: true };
        }

        if (category === "ada_kendala") {
            await deps.repository.updateConversation(conversation.id, {
                status: "waiting_detail",
                initial_answer_raw: text,
                triage_category: "ada_kendala"
            });
            const prompt = render(deps, "auto_outage_detail_prompt", "Boleh jelaskan kendalanya? Contoh: alat mati, lampu LOS merah/kabel bermasalah, WiFi nyala tapi tidak internet, lambat, atau lainnya.", {});
            await sendText(user, prompt);
            return { handled: true, category: "ada_kendala", nextStatus: "waiting_detail" };
        }

        const media = Array.isArray(context.media) ? context.media : [];
        await deps.repository.updateConversation(conversation.id, {
            status: "waiting_ticket_confirm",
            triage_category: category,
            description: text,
            media_json: media
        });
        await sendTicketConfirmation({ user, conversation, category, description: text });
        return { handled: true, category, nextStatus: "waiting_ticket_confirm" };
    }

    return {
        deps,
        startConversation,
        handleCustomerReply,
        sendTicketConfirmation,
        finalizeTicketDecision
    };
}

module.exports = { createAutoOutageConversationService };
