/**
 * Header Doc
 * Purpose: Guard Fase 4 ronde 5 (#b353) — otak pantau redaman: primaryRx (OLT valid > modem >
 *   null), decideNotify SMART (target/status/change/heartbeat/diam), runWatchTick (due→notif,
 *   kedaluwarsa→finalisasi+log tiket+hapus, never-throw per watch).
 * Caller: Jest.
 * Deps: ../redaman-watch-service (formatDetailLines dari diagnosis service di-mock ringan).
 * SideEffects: -
 */
"use strict";
jest.mock("../../services/redaman-diagnosis.service", () => ({ formatDetailLines: () => ["RX: 🟢 -20 dBm — BAIK"] }));
const { primaryRx, decideNotify, runWatchTick } = require("../redaman-watch-service");

function diagOlt(rx, label, status = "Online") {
    return { nama: "Budi", pppoe: "budi@isp", olt: { matched: true, rxPowerValid: label !== null, status }, oltVerdict: label ? { value: rx, label } : null, modem: {} };
}
const HB = 300000;

describe("primaryRx (#b353)", () => {
    test("OLT valid dipakai lebih dulu", () => {
        expect(primaryRx(diagOlt(-25, "WASPADA"))).toMatchObject({ rx: -25, label: "WASPADA", source: "OLT" });
    });
    test("fallback ke modem bila OLT tak valid", () => {
        const d = { olt: { matched: true, rxPowerValid: false, status: "LOS" }, oltVerdict: null, modem: { reachable: true, verdict: { value: -30, label: "BURUK" } } };
        expect(primaryRx(d)).toMatchObject({ rx: -30, label: "BURUK", source: "Modem" });
    });
    test("tak ada RX valid → rx null", () => {
        expect(primaryRx({ olt: { matched: true, rxPowerValid: false, status: "LOS" }, modem: {} }).rx).toBeNull();
    });
});

describe("decideNotify (#b353)", () => {
    const base = { lastRx: -27, lastStatus: "Online", lastHeartbeatAt: new Date(Date.now()).toISOString(), targetAnnounced: false };
    test("TARGET BAIK belum diumumkan → kind target", () => {
        expect(decideNotify(base, diagOlt(-19, "BAIK"), Date.now())).toEqual({ notify: true, kind: "target" });
    });
    test("TARGET sudah diumumkan → tak re-target (jatuh ke cek lain)", () => {
        const w = { ...base, targetAnnounced: true, lastRx: -19 };
        expect(decideNotify(w, diagOlt(-19, "BAIK"), Date.now())).toEqual({ notify: false, kind: null });
    });
    test("status flip online→LOS → kind status", () => {
        const d = { olt: { matched: true, rxPowerValid: false, status: "LOS" }, modem: {} };
        expect(decideNotify(base, d, Date.now())).toEqual({ notify: true, kind: "status" });
    });
    test("perubahan RX ≥ ambang → kind change", () => {
        expect(decideNotify({ ...base, targetAnnounced: true }, diagOlt(-24, "WASPADA"), Date.now())).toEqual({ notify: true, kind: "change" });
    });
    test("perubahan RX < ambang + heartbeat lama → kind heartbeat", () => {
        const w = { ...base, lastRx: -25, lastHeartbeatAt: new Date(Date.now() - HB - 1000).toISOString() };
        expect(decideNotify(w, diagOlt(-25, "WASPADA"), Date.now())).toEqual({ notify: true, kind: "heartbeat" });
    });
    test("tak ada perubahan + heartbeat baru → DIAM", () => {
        const w = { ...base, lastRx: -25 };
        expect(decideNotify(w, diagOlt(-25, "WASPADA"), Date.now())).toEqual({ notify: false, kind: null });
    });
});

describe("runWatchTick (#b353)", () => {
    test("watch jatuh tempo + berubah → kirim + updateWatch", async () => {
        const w = { id: "RW-1", requesterJid: "628@s.whatsapp.net", userId: 5, name: "Budi", intervalMs: 60000, lastReportAt: new Date(Date.now() - 120000).toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), lastRx: -27, lastStatus: "Online", lastHeartbeatAt: new Date(Date.now() - 400000).toISOString(), targetAnnounced: false, status: "active" };
        const sent = []; const updated = [];
        const res = await runWatchTick({
            loadActiveAll: () => [w],
            diagnoseWatch: async () => diagOlt(-19, "BAIK"),
            sendMessage: async (jid, payload) => sent.push({ jid, text: payload.text }),
            logToTicket: async () => {}, updateWatch: (id, patch) => updated.push({ id, patch }),
            removeWatch: () => {}, now: () => Date.now(), cfg: {},
        });
        expect(res.notified).toBe(1);
        expect(sent[0].jid).toBe("628@s.whatsapp.net");
        expect(sent[0].text).toMatch(/TARGET REDAMAN TERCAPAI/);
        expect(updated[0].patch.targetAnnounced).toBe(true);
    });

    test("watch KEDALUWARSA → kirim ringkasan + log tiket + hapus", async () => {
        const w = { id: "RW-2", requesterJid: "628@s.whatsapp.net", userId: 5, name: "Budi", ticketId: "T-9", intervalMs: 60000, lastReportAt: new Date().toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString(), baseline: { rx: -30 }, status: "active" };
        const sent = []; const logged = []; const removed = [];
        const res = await runWatchTick({
            loadActiveAll: () => [w],
            diagnoseWatch: async () => diagOlt(-20, "BAIK"),
            sendMessage: async (jid, payload) => sent.push(payload.text),
            logToTicket: async (tid, info) => logged.push({ tid, info }),
            updateWatch: () => {}, removeWatch: (id) => removed.push(id), now: () => Date.now(), cfg: {},
        });
        expect(res.finalized).toBe(1);
        expect(sent[0]).toMatch(/selesai/i);
        expect(logged[0]).toMatchObject({ tid: "T-9", info: { before: -30, after: -20 } });
        expect(removed).toContain("RW-2");
    });

    test("diagnoseWatch MELEMPAR → never-throw, watch lain aman", async () => {
        const w = { id: "RW-3", requesterJid: "628@s.whatsapp.net", userId: 5, intervalMs: 60000, lastReportAt: new Date(Date.now() - 120000).toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), status: "active" };
        const res = await runWatchTick({
            loadActiveAll: () => [w], diagnoseWatch: async () => { throw new Error("boom"); },
            sendMessage: async () => {}, logToTicket: async () => {}, updateWatch: () => {}, removeWatch: () => {}, now: () => Date.now(), cfg: {},
        });
        expect(res).toBeDefined(); // tak melempar
    });
});
