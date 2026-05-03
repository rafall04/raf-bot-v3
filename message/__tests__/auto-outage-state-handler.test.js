/**
 * Header Doc
 * Purpose: Unit test handler state WhatsApp auto outage untuk memastikan context pelanggan, text, dan media didelegasikan ke conversation service.
 * Caller: Jest targeted test Task 7 auto outage state handler.
 * Deps: `message/handlers/state-domains/auto-outage-state-handler.js`.
 * MainFuncs: Memverifikasi `handleAutoOutageState` mendelegasikan context penuh ke conversation service.
 * SideEffects: Tidak ada; conversation service direplace stub.
 */
"use strict";

const { handleAutoOutageState } = require("../handlers/state-domains/auto-outage-state-handler");

describe("auto-outage-state-handler", () => {
    test("delegates customer reply to injected conversation service", async () => {
        const autoOutageConversationService = {
            handleCustomerReply: jest.fn().mockResolvedValue({ handled: true, category: "aman" })
        };
        const context = {
            autoOutageConversationService,
            user: { id: "1", phone_number: "6281" },
            text: "aman",
            sender: "6281@s.whatsapp.net"
        };
        const result = await handleAutoOutageState(context);
        expect(result).toEqual({ handled: true, category: "aman" });
        expect(autoOutageConversationService.handleCustomerReply).toHaveBeenCalledWith(expect.objectContaining({
            text: "aman",
            sender: "6281@s.whatsapp.net",
            user: expect.objectContaining({ id: "1" })
        }));
    });

    test("passes media metadata through for evidence capture", async () => {
        const media = [{ type: "image", path: "uploads/modem.jpg" }];
        const autoOutageConversationService = {
            handleCustomerReply: jest.fn().mockResolvedValue({ handled: true, category: "los_kabel" })
        };
        await handleAutoOutageState({
            autoOutageConversationService,
            user: { id: "1" },
            text: "lampu los merah",
            media
        });
        expect(autoOutageConversationService.handleCustomerReply).toHaveBeenCalledWith(expect.objectContaining({ media }));
    });
});
