"use strict";

jest.mock("../ticket-workflow", () => ({
    createBaseTicket: jest.fn(),
    processTicket: jest.fn(),
    cancelTicket: jest.fn(() => ({ ticket: { ticketId: "TKT-1", cancellationReason: "pulih" } })),
    findTicketIndex: jest.fn(),
}));
jest.mock("../report-notification-service", () => ({
    notifyNewReport: jest.fn(() => Promise.resolve({ sent: true })),
    notifyTicketCancelled: jest.fn(() => Promise.resolve({})),
}));
jest.mock("../account-classification", () => ({ isInfrastructure: jest.fn(() => false) }));
jest.mock("../olt-name-resolver", () => ({ resolveOltDisplay: jest.fn(() => ({ name: "OLT Server", ip: "192.168.11.2" })) }));
jest.mock("../database", () => ({ saveReports: jest.fn() }));

const tw = require("../ticket-workflow");
const rns = require("../report-notification-service");
const svc = require("../los-ticket-service");

const INCIDENT = {
    incidentId: "los_1", mac: "D49E0237C1C2", slot: 1, onu: 14, oltId: "192.168.11.2",
    customer: { id: 7, name: "Mbah Uti", phone: "0812", address: "Jl. A", account_type: "pelanggan" },
};

describe("los-ticket-service", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.config = { oltLosBroadcast: { autoTicket: { enabled: true, priority: "HIGH" } } };
        global.users = [{ id: 7, name: "Mbah Uti", phone_number: "0812", address: "Jl. A", subscription: "X", pppoe_username: "mbah-uti" }];
        global.accounts = [{ id: "t1", username: "budi", name: "Budi", role: "teknisi", phone_number: "0899" }];
        global.reports = [];
        tw.createBaseTicket.mockImplementation(() => { const t = { ticketId: "TKT-1", user_id: 7, status: "baru" }; global.reports.push(t); return t; });
    });

    test("enabled → create + auto-assign + notify, return ticketId", () => {
        const id = svc.maybeCreateLosTicket(INCIDENT);
        expect(id).toBe("TKT-1");
        expect(tw.createBaseTicket).toHaveBeenCalledTimes(1);
        const arg = tw.createBaseTicket.mock.calls[0][0];
        expect(arg.issueType).toBe("LOS_FIBER");
        expect(arg.priority).toBe("HIGH");
        expect(arg.user.id).toBe(7);
        expect(arg.laporanText).toMatch(/OLT Server/);
        expect(tw.processTicket).toHaveBeenCalledTimes(1);
        expect(rns.notifyNewReport).toHaveBeenCalledTimes(1);
        expect(global.reports[0].source).toBe("los");
        expect(global.reports[0].losMac).toBe("D49E0237C1C2");
    });

    test("disabled → null, tidak create", () => {
        global.config.oltLosBroadcast.autoTicket.enabled = false;
        expect(svc.maybeCreateLosTicket(INCIDENT)).toBeNull();
        expect(tw.createBaseTicket).not.toHaveBeenCalled();
    });

    test("dedup → sudah ada tiket LOS terbuka utk pelanggan → skip create", () => {
        global.reports = [{ ticketId: "TKT-OLD", source: "los", status: "process", user_id: 7, losMac: "D49E0237C1C2" }];
        expect(svc.maybeCreateLosTicket(INCIDENT)).toBe("TKT-OLD");
        expect(tw.createBaseTicket).not.toHaveBeenCalled();
    });

    test("akun infrastruktur → skip", () => {
        require("../account-classification").isInfrastructure.mockReturnValueOnce(true);
        expect(svc.maybeCreateLosTicket(INCIDENT)).toBeNull();
        expect(tw.createBaseTicket).not.toHaveBeenCalled();
    });

    test("tanpa teknisi → tetap create (pool), tanpa auto-assign", () => {
        global.accounts = [];
        expect(svc.maybeCreateLosTicket(INCIDENT)).toBe("TKT-1");
        expect(tw.processTicket).not.toHaveBeenCalled();
    });

    test("cancel saat pulih → cancelTicket bila status baru/process", () => {
        global.reports = [{ ticketId: "TKT-1", source: "los", status: "process" }];
        tw.findTicketIndex.mockReturnValue(0);
        expect(svc.maybeCancelLosTicket("TKT-1")).toBe(true);
        expect(tw.cancelTicket).toHaveBeenCalledTimes(1);
    });

    test("cancel dilewati bila teknisi sudah OTW", () => {
        global.reports = [{ ticketId: "TKT-1", source: "los", status: "otw" }];
        tw.findTicketIndex.mockReturnValue(0);
        expect(svc.maybeCancelLosTicket("TKT-1")).toBe(false);
        expect(tw.cancelTicket).not.toHaveBeenCalled();
    });
});
