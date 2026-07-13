"use strict";

const os = require("os");
const path = require("path");
const fs = require("fs");
const svc = require("../psb-schedule-service");

describe("psb-schedule-service", () => {
    const TMP = path.join(os.tmpdir(), `psb-sched-${process.pid}-${Math.random().toString(36).slice(2)}.sqlite`);
    beforeAll(() => svc.setDbPathForTest(TMP));
    afterAll(() => { try { fs.unlinkSync(TMP); } catch (_e) { /* noop */ } svc.setDbPathForTest(null); });

    test("createRequest → status menunggu + ref PSB-<id>", async () => {
        const r = await svc.createRequest({ nama: "Budi", hp: "08123456789", dusun: "Karang", paket: "PAKET-110K", requestedByName: "Davin", area: "RAF NET" });
        expect(r.id).toBeGreaterThan(0);
        expect(r.ref).toBe(`PSB-${r.id}`);
        expect(r.status).toBe("menunggu");
        const row = await svc.getScheduleById(r.id);
        expect(row.name).toBe("Budi");
        expect(row.status).toBe("menunggu");
        expect(row.requested_by_name).toBe("Davin");
        expect(row.dusun).toBe("Karang");
    });

    test("listSchedules + getScheduleSummary hitung belum kepasang", async () => {
        await svc.createRequest({ nama: "Ani", hp: "08120000000", dusun: "Sari", paket: "P" });
        const list = await svc.listSchedules({ status: "menunggu" });
        expect(list.length).toBeGreaterThanOrEqual(2);
        const sum = await svc.getScheduleSummary({ nowMs: Date.now() });
        expect(sum.menunggu).toBeGreaterThanOrEqual(2);
        expect(sum.belum_kepasang).toBe(sum.menunggu + sum.ditugaskan);
        expect(sum.terpasang_bulan_ini).toBe(0);
    });
});
