/**
 * Header Doc
 * Purpose: Unit test conversation service auto outage untuk triage jawaban pelanggan, prompt lanjutan, dan konfirmasi tiket.
 * Caller: Jest targeted test Task 6 auto outage conversation service.
 * Deps: `services/auto-outage-conversation.service.js`.
 * MainFuncs: Memverifikasi `startConversation`, `handleCustomerReply`, dan `finalizeTicketDecision`.
 * SideEffects: Tidak ada; dependency WA/ticket direplace stub.
 */
"use strict";

const { createAutoOutageConversationService } = require("../auto-outage-conversation.service");

describe("auto-outage-conversation.service", () => {
    test("starts conversation and sends initial question", async () => {
        const repository = {
            createConversation: jest.fn().mockResolvedValue({ id: "conv-1", status: "waiting_initial" }),
            upsertStates: jest.fn().mockResolvedValue([])
        };
        const sendMessage = jest.fn().mockResolvedValue({ ok: true });
        const service = createAutoOutageConversationService({
            repository,
            sendMessage,
            renderResponseTemplate: (_key, fallback, data) => fallback.replace("${nama}", data.nama)
        });

        const result = await service.startConversation({
            user: { id: "1", name: "Budi", phone_number: "6281", pppoe_username: "cust-a" },
            state: { id: "state-1", offline_since: "2026-05-03T01:00:00.000Z" },
            rule: { template_initial: "Halo ${nama}" }
        });

        expect(result.conversation.id).toBe("conv-1");
        expect(repository.createConversation).toHaveBeenCalledWith(expect.objectContaining({
            user_id: "1",
            status: "waiting_initial"
        }));
        expect(sendMessage).toHaveBeenCalledWith("6281", { text: "Halo Budi" });
    });

    test("maps aman replies and closes conversation safely", async () => {
        const repository = {
            getOpenConversationByUserId: jest.fn().mockResolvedValue({ id: "conv-1", user_id: "1", status: "waiting_initial" }),
            updateConversation: jest.fn().mockResolvedValue({ id: "conv-1", status: "closed", closed_reason: "customer_safe" })
        };
        const service = createAutoOutageConversationService({
            repository,
            sendMessage: jest.fn(),
            renderResponseTemplate: (_key, fallback) => fallback,
            now: () => new Date("2026-05-03T05:00:00.000Z")
        });

        const result = await service.handleCustomerReply({ user: { id: "1", phone_number: "6281" }, text: "aman" });
        expect(result.category).toBe("aman");
        expect(result.closed).toBe(true);
        expect(repository.updateConversation).toHaveBeenCalledWith("conv-1", expect.objectContaining({
            status: "closed",
            closed_reason: "customer_safe",
            triage_category: "aman"
        }));
    });

    test("maps LOS/kabel complaint and asks ticket confirmation", async () => {
        const repository = {
            getOpenConversationByUserId: jest.fn().mockResolvedValue({ id: "conv-1", user_id: "1", status: "waiting_detail" }),
            updateConversation: jest.fn().mockResolvedValue({ id: "conv-1", status: "waiting_ticket_confirm" })
        };
        const sendMessage = jest.fn().mockResolvedValue({ ok: true });
        const service = createAutoOutageConversationService({
            repository,
            sendMessage,
            renderResponseTemplate: (_key, fallback) => fallback
        });

        const result = await service.handleCustomerReply({ user: { id: "1", phone_number: "6281" }, text: "lampu los merah" });
        expect(result.category).toBe("los_kabel");
        expect(result.nextStatus).toBe("waiting_ticket_confirm");
        expect(repository.updateConversation).toHaveBeenCalledWith("conv-1", expect.objectContaining({
            status: "waiting_ticket_confirm",
            triage_category: "los_kabel",
            description: "lampu los merah"
        }));
        expect(sendMessage).toHaveBeenCalledWith("6281", expect.objectContaining({ text: expect.stringContaining("Ajukan tiket") }));
    });

    test("creates ticket only on final YA", async () => {
        const repository = {
            getOpenConversationByUserId: jest.fn().mockResolvedValue({
                id: "conv-1",
                user_id: "1",
                pppoe_username: "cust-a",
                status: "waiting_ticket_confirm",
                triage_category: "los_kabel",
                description: "LOS merah"
            }),
            updateConversation: jest.fn().mockResolvedValue({ id: "conv-1", status: "closed", ticket_id: "TKT-1" })
        };
        const createCustomerReportTicket = jest.fn().mockResolvedValue({ ticketId: "TKT-1" });
        const service = createAutoOutageConversationService({
            repository,
            createCustomerReportTicket,
            sendMessage: jest.fn(),
            renderResponseTemplate: (_key, fallback) => fallback
        });

        const result = await service.handleCustomerReply({
            user: { id: "1", name: "Budi", phone_number: "6281" },
            text: "YA"
        });

        expect(result.ticketCreated).toBe(true);
        expect(createCustomerReportTicket).toHaveBeenCalledWith(expect.objectContaining({
            user: expect.objectContaining({ id: "1" }),
            category: "los_kabel",
            description: "LOS merah"
        }));
        expect(repository.updateConversation).toHaveBeenCalledWith("conv-1", expect.objectContaining({
            status: "closed",
            ticket_id: "TKT-1",
            ticket_requested: true
        }));
    });

    test("declines ticket on final TIDAK", async () => {
        const repository = {
            getOpenConversationByUserId: jest.fn().mockResolvedValue({ id: "conv-1", user_id: "1", status: "waiting_ticket_confirm" }),
            updateConversation: jest.fn().mockResolvedValue({ id: "conv-1", status: "closed" })
        };
        const createCustomerReportTicket = jest.fn();
        const service = createAutoOutageConversationService({
            repository,
            sendMessage: jest.fn(),
            renderResponseTemplate: jest.fn(),
            createCustomerReportTicket
        });

        const result = await service.handleCustomerReply({ user: { id: "1", phone_number: "6281" }, text: "tidak" });
        expect(result.ticketCreated).toBe(false);
        expect(createCustomerReportTicket).not.toHaveBeenCalled();
        expect(repository.updateConversation).toHaveBeenCalledWith("conv-1", expect.objectContaining({
            status: "closed",
            closed_reason: "customer_declined_ticket"
        }));
    });

    test("startConversation TIDAK membocorkan pppoe ke pelanggan (walau template memuat placeholder)", async () => {
        const repository = {
            createConversation: jest.fn().mockResolvedValue({ id: "conv-9", status: "waiting_initial" }),
            upsertStates: jest.fn().mockResolvedValue([])
        };
        const sendMessage = jest.fn().mockResolvedValue({ ok: true });
        let capturedData = null;
        const service = createAutoOutageConversationService({
            repository,
            sendMessage,
            // Simulasikan template STORED yang (nakal) masih memuat ${pppoe_username}:
            renderResponseTemplate: (_key, _fallback, data) => {
                capturedData = data;
                return `Halo ${data.nama}, koneksi PPPoE ${data.pppoe_username} tidak aktif sejak ${data.offline_since}.`;
            }
        });

        await service.startConversation({
            user: { id: "7", name: "Komari", phone_number: "6287811561418", pppoe_username: "komari-tandingoro@rafcybernet" },
            state: { id: "state-9", offline_since: "kemarin" }
        });

        // Service TIDAK mengoper pppoe_username ke data render pesan pelanggan.
        expect(capturedData).not.toHaveProperty("pppoe_username");
        // Maka teks terkirim TIDAK memuat nama pppoe, walau template pakai ${pppoe_username}.
        const sentText = sendMessage.mock.calls[0][1].text;
        expect(sentText).not.toMatch(/komari-tandingoro@rafcybernet/i);
        // Tapi pppoe_username TETAP disimpan internal (untuk tiket/diagnostik).
        expect(repository.createConversation).toHaveBeenCalledWith(expect.objectContaining({
            pppoe_username: "komari-tandingoro@rafcybernet"
        }));
    });
});
