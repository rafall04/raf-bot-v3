/**
 * Header Doc
 * Purpose: Static guardrail untuk memastikan router utama memakai conversation state router sebagai jalur utama.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, source `../raf.js`.
 * MainFuncs: Memverifikasi dispatch state utama lewat owner map + state router.
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("conversation state boundary", () => {
    test("raf router delegates state handling through conversation-state-router", () => {
        const source = fs.readFileSync(path.join(__dirname, "..", "raf.js"), "utf8");

        expect(source).toContain("routeConversationState");
        expect(source).toContain("const conversationStateResult = await routeConversationState({");
        expect(source).toContain("if (conversationStateResult.handled) {");
        expect(source).toContain("const activeTicketLocationResult = await handleActiveTicketLocationUpdate({");
        expect(source).not.toContain("createScopedStateProxy('legacy-temp')");
        expect(source).not.toContain("global.teknisiStates = createScopedStateProxy('teknisi')");
        expect(source).not.toContain("false && userState?.step");
        expect(source).not.toContain("false && isTeknisiPhotoState");
        expect(source).not.toContain("if ((type === 'locationMessage' || type === 'liveLocationMessage') && smartReportState)");
        expect(source).not.toContain("smartReportState.step === 'AWAITING_LOCATION_FOR_JOURNEY'");
        expect(source).not.toContain("const reports = global.reports || [];");
        expect(source).not.toContain("const activeTicket = reports.find(");
        expect(source).not.toContain("userState && userState.step && userState.step.startsWith('AGENT_VOUCHER_PURCHASE_')");
        expect(source).not.toContain("userState && userState.step && userState.step.startsWith('AGENT_VOUCHER_SALE_')");
        expect(source).not.toContain("if (userState?.step === 'ASK_VOUCHER_CHOICE' && !isGlobalCommand)");
        expect(source).not.toContain("if (userState.step === 'AWAITING_QUESTION')");
        expect(source).not.toContain("if (isTeknisiPhotoState && type === 'imageMessage')");
        expect(source).not.toContain("if (legacyTeknisiStateResult.handled)");
        expect(source).not.toContain("if (managedConversationSteps.includes(stateStep))");
        expect(source).not.toContain("if (legacyWifiStateResult.handled)");
        expect(source).not.toContain("if (stateStep === 'REPORT_MENU')");
        expect(source).not.toContain("if (stateStep === 'REPORT_MATI_TROUBLESHOOT' || stateStep === 'MATI_TROUBLESHOOT_OPTIONS')");
        expect(source).not.toContain("if (stateStep === 'GANGGUAN_MATI_DEVICE_OFFLINE')");
        expect(source).not.toContain("if (stateStep === 'GANGGUAN_LEMOT_ANALYSIS' ||");
        expect(source).not.toContain("const managedConversationSteps = [");
    });
});
