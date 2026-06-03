/**
 * Purpose: Guardrail runtime agar workflow teknisi WhatsApp memakai `responseTemplates` custom, bukan fallback hardcoded.
 * Caller: Jest suite hardcoded WA/template regression.
 * Deps: `message/handlers/teknisi-workflow-handler`, `conversation-handler`, `lib/templating`, mock database/notification.
 * MainFuncs: Memverifikasi proses, OTW, sampai, OTP, foto, resolusi, dan completion render dari template cache admin.
 * SideEffects: Mutasi `global.reports`, `global.accounts`, cache template test, dan state percakapan in-memory.
 */
"use strict";

jest.mock("../../lib/database", () => ({
    ...jest.requireActual("../../lib/database"),
    saveReports: jest.fn()
}));

jest.mock("../../lib/otp-generator", () => ({
    generateOTP: jest.fn(() => "123456")
}));

jest.mock("../../lib/report-notification-service", () => ({
    notifyCustomerTicketUpdate: jest.fn(async () => true)
}));

const { templatesCache } = require("../../lib/templating");
const { notifyCustomerTicketUpdate } = require("../../lib/report-notification-service");
const {
    clearAllStates,
    getUserState,
    setUserState
} = require("../handlers/conversation-handler");
const {
    handleProsesTicket,
    handleOTW,
    handleSampaiLokasi,
    handleVerifikasiOTP,
    handleTeknisiPhotoUpload,
    handleTeknisiResolutionNotesState,
    handleTeknisiCompletionConfirmationState
} = require("../handlers/teknisi-workflow-handler");

const ORIGINAL_RESPONSE_TEMPLATES = templatesCache.responseTemplates;
const SENDER = "6281234567890@s.whatsapp.net";
const TICKET_ID = "TKT-RUNTIME-1";

function template(text) {
    return {
        name: "Runtime Test",
        category: "teknisi_workflow",
        template: text
    };
}

function installCustomTeknisiTemplates() {
    templatesCache.responseTemplates = {
        teknisi_workflow_process_customer_otp: template("CUSTOM_PROCESS_CUSTOMER ${ticketId} ${teknisiName} ${otp}"),
        teknisi_workflow_process_success: template("CUSTOM_PROCESS_SUCCESS ${ticketId} ${customerName}"),
        teknisi_workflow_otw_customer: template("CUSTOM_OTW_CUSTOMER ${ticketId} ${teknisiName} ${otp}"),
        teknisi_workflow_otw_success: template("CUSTOM_OTW_SUCCESS ${ticketId} ${customerName}"),
        teknisi_workflow_arrived_customer: template("CUSTOM_ARRIVED_CUSTOMER ${ticketId} ${teknisiName} ${otp}"),
        teknisi_workflow_arrived_success: template("CUSTOM_ARRIVED_SUCCESS ${ticketId}"),
        teknisi_workflow_repair_started_customer: template("CUSTOM_REPAIR_CUSTOMER ${ticketId} ${teknisiName}"),
        teknisi_workflow_otp_verified_success: template("CUSTOM_OTP_SUCCESS ${ticketId}"),
        teknisi_workflow_photo_speedtest_prompt: template("CUSTOM_PHOTO_SPEEDTEST"),
        teknisi_workflow_photo_result_prompt: template("CUSTOM_PHOTO_RESULT"),
        teknisi_workflow_photo_extra_prompt: template("CUSTOM_PHOTO_EXTRA"),
        teknisi_workflow_resolution_review: template("CUSTOM_RESOLUTION_REVIEW ${ticketId} ${photoCount} ${resolutionNotes}"),
        teknisi_workflow_complete_ticket_customer_notification: template("CUSTOM_COMPLETE_CUSTOMER ${ticketId} ${customerName} ${resolutionNotes}"),
        teknisi_workflow_complete_ticket_success: template("CUSTOM_COMPLETE_SUCCESS ${ticketId} ${photoCount}")
    };
}

function seedRuntime() {
    global.config = { nama: "RAF Runtime Test" };
    global.accounts = [{
        role: "teknisi",
        phone_number: "81234567890",
        username: "tek-runtime",
        name: "Tek Runtime"
    }];
    global.reports = [{
        ticketId: TICKET_ID,
        status: "baru",
        pelangganId: "628111111111@s.whatsapp.net",
        pelangganName: "Budi Runtime",
        pelangganPhone: "0811111111",
        pelangganAddress: "Jl. Runtime",
        laporanText: "Internet mati",
        createdAt: new Date("2026-04-25T01:00:00.000Z").toISOString()
    }];
}

describe("teknisi workflow runtime responseTemplates", () => {
    beforeEach(() => {
        clearAllStates();
        jest.clearAllMocks();
        installCustomTeknisiTemplates();
        seedRuntime();
    });

    afterEach(() => {
        clearAllStates();
        templatesCache.responseTemplates = ORIGINAL_RESPONSE_TEMPLATES;
        delete global.config;
        delete global.accounts;
        delete global.reports;
    });

    test("renders custom admin templates across active teknisi WA workflow", async () => {
        const proses = await handleProsesTicket(SENDER, TICKET_ID);
        expect(proses).toMatchObject({
            success: true,
            message: "CUSTOM_PROCESS_SUCCESS TKT-RUNTIME-1 Budi Runtime"
        });
        expect(notifyCustomerTicketUpdate).toHaveBeenLastCalledWith(
            expect.objectContaining({ ticketId: TICKET_ID }),
            "CUSTOM_PROCESS_CUSTOMER TKT-RUNTIME-1 Tek Runtime 123456",
            expect.objectContaining({ flow: "teknisi_workflow" })
        );

        const otw = await handleOTW(SENDER, TICKET_ID);
        expect(otw.message).toBe("CUSTOM_OTW_SUCCESS TKT-RUNTIME-1 Budi Runtime");
        expect(notifyCustomerTicketUpdate).toHaveBeenLastCalledWith(
            expect.objectContaining({ ticketId: TICKET_ID }),
            "CUSTOM_OTW_CUSTOMER TKT-RUNTIME-1 Tek Runtime 123456",
            expect.any(Object)
        );

        const sampai = await handleSampaiLokasi(SENDER, TICKET_ID);
        expect(sampai.message).toBe("CUSTOM_ARRIVED_SUCCESS TKT-RUNTIME-1");
        expect(notifyCustomerTicketUpdate).toHaveBeenLastCalledWith(
            expect.objectContaining({ ticketId: TICKET_ID }),
            "CUSTOM_ARRIVED_CUSTOMER TKT-RUNTIME-1 Tek Runtime 123456",
            expect.any(Object)
        );

        const otp = await handleVerifikasiOTP(SENDER, TICKET_ID, "123456");
        expect(otp.message).toBe("CUSTOM_OTP_SUCCESS TKT-RUNTIME-1");
        expect(notifyCustomerTicketUpdate).toHaveBeenLastCalledWith(
            expect.objectContaining({ ticketId: TICKET_ID }),
            "CUSTOM_REPAIR_CUSTOMER TKT-RUNTIME-1 Tek Runtime",
            expect.any(Object)
        );

        const problemPhoto = await handleTeknisiPhotoUpload(SENDER, "problem.jpg");
        expect(problemPhoto.message).toBe("CUSTOM_PHOTO_SPEEDTEST");
        const speedtestPhoto = await handleTeknisiPhotoUpload(SENDER, "speedtest.jpg");
        expect(speedtestPhoto.message).toBe("CUSTOM_PHOTO_RESULT");
        const resultPhoto = await handleTeknisiPhotoUpload(SENDER, "result.jpg");
        expect(resultPhoto.message).toBe("CUSTOM_PHOTO_EXTRA");

        setUserState(SENDER, {
            ...getUserState(SENDER),
            step: "AWAITING_RESOLUTION_NOTES"
        });

        const resolution = await handleTeknisiResolutionNotesState(SENDER, "Kabel drop diganti dan redaman normal");
        expect(resolution.message).toBe("CUSTOM_RESOLUTION_REVIEW TKT-RUNTIME-1 3 Kabel drop diganti dan redaman normal");

        const complete = await handleTeknisiCompletionConfirmationState(SENDER, "ya");
        expect(complete).toMatchObject({
            handled: true,
            success: true,
            message: "CUSTOM_COMPLETE_SUCCESS TKT-RUNTIME-1 3"
        });
        expect(notifyCustomerTicketUpdate).toHaveBeenLastCalledWith(
            expect.objectContaining({ ticketId: TICKET_ID }),
            "CUSTOM_COMPLETE_CUSTOMER TKT-RUNTIME-1 Budi Runtime Kabel drop diganti dan redaman normal",
            expect.any(Object)
        );
    });
});
