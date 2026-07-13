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

    test("assignSchedule (admin) menunggu → ditugaskan + assignee + assigned_by tercatat", async () => {
        const r = await svc.createRequest({ nama: "Cici", hp: "0812", dusun: "Mekar", paket: "P" });
        const res = await svc.assignSchedule({ scheduleId: r.id, teknisiId: "tk1", teknisiName: "Ivan", assignedById: "adm1", assignedByName: "Aldi", mode: "assign" });
        expect(res.ok).toBe(true);
        expect(res.record.status).toBe("ditugaskan");
        expect(res.record.assigned_teknisi_id).toBe("tk1");
        expect(res.record.assigned_teknisi_name).toBe("Ivan");
        expect(res.record.assigned_by_name).toBe("Aldi");
        expect(res.record.assigned_at).toBeTruthy();
        const byTk = await svc.listSchedules({ assignedTeknisiId: "tk1" });
        expect(byTk.some((x) => x.id === r.id)).toBe(true);
    });

    test("claim menunggu → ditugaskan; klaim lagi oleh teknisi sama = idempoten", async () => {
        const r = await svc.createRequest({ nama: "Dedi", hp: "0813", dusun: "Jaya", paket: "P" });
        const c1 = await svc.assignSchedule({ scheduleId: r.id, teknisiId: "tk2", teknisiName: "Budi", mode: "claim" });
        expect(c1.ok).toBe(true);
        expect(c1.record.status).toBe("ditugaskan");
        const c2 = await svc.assignSchedule({ scheduleId: r.id, teknisiId: "tk2", teknisiName: "Budi", mode: "claim" });
        expect(c2.ok).toBe(true);
        expect(c2.idempotent).toBe(true);
    });

    test("claim jadwal yang sudah dipegang teknisi lain → ditolak (anti-serobot)", async () => {
        const r = await svc.createRequest({ nama: "Eka", hp: "0814", dusun: "Subur", paket: "P" });
        await svc.assignSchedule({ scheduleId: r.id, teknisiId: "tk3", teknisiName: "A", mode: "claim" });
        const stolen = await svc.assignSchedule({ scheduleId: r.id, teknisiId: "tk4", teknisiName: "B", mode: "claim" });
        expect(stolen.ok).toBe(false);
        expect(stolen.reason).toBe("already_assigned");
    });

    test("admin BOLEH reassign jadwal ditugaskan → teknisi lain (reassignedFrom terisi)", async () => {
        const r = await svc.createRequest({ nama: "Fani", hp: "0815", dusun: "Indah", paket: "P" });
        await svc.assignSchedule({ scheduleId: r.id, teknisiId: "tk5", teknisiName: "Lama", mode: "claim" });
        const re = await svc.assignSchedule({ scheduleId: r.id, teknisiId: "tk6", teknisiName: "Baru", assignedByName: "Aldi", mode: "assign" });
        expect(re.ok).toBe(true);
        expect(re.record.assigned_teknisi_id).toBe("tk6");
        expect(re.reassignedFrom).toEqual({ id: "tk5", name: "Lama" });
    });

    test("assignSchedule id tak ada → not_found; tanpa teknisi → no_teknisi", async () => {
        const nf = await svc.assignSchedule({ scheduleId: 999999, teknisiId: "tk7", mode: "assign" });
        expect(nf.ok).toBe(false);
        expect(nf.reason).toBe("not_found");
        const r = await svc.createRequest({ nama: "Gita", hp: "0816", dusun: "X", paket: "P" });
        const noTk = await svc.assignSchedule({ scheduleId: r.id, teknisiId: null, mode: "assign" });
        expect(noTk.ok).toBe(false);
        expect(noTk.reason).toBe("no_teknisi");
    });

    test("buildAssignmentDm berisi ref + link lokasi; group notif bedakan claim vs assign", async () => {
        const r = await svc.createRequest({ nama: "Hadi", hp: "0817", dusun: "Tani", paket: "P", latitude: -7.1, longitude: 111.4 });
        const res = await svc.assignSchedule({ scheduleId: r.id, teknisiId: "tk8", teknisiName: "Ivan", mode: "assign", assignedByName: "Aldi" });
        const dm = svc.buildAssignmentDm(res.record, { assignedByName: "Aldi", mode: "assign" });
        expect(dm).toContain(r.ref);
        expect(dm).toContain("maps.google.com/?q=-7.1,111.4");
        expect(dm).toContain("DITUGASKAN");
        expect(svc.buildAssignmentGroupNotif(res.record, { mode: "claim" })).toContain("mengambil");
        expect(svc.buildAssignmentGroupNotif(res.record, { mode: "assign", assignedByName: "Aldi" })).toContain("DITUGASKAN");
    });
});
