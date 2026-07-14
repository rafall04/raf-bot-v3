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

    test("markScheduleInstalled → terpasang + installed_user_id + installed_at; idempoten", async () => {
        const r = await svc.createRequest({ nama: "Iwan", hp: "081999", dusun: "Maju", paket: "P" });
        const m = await svc.markScheduleInstalled(r.id, 77);
        expect(m.ok).toBe(true);
        expect(m.record.status).toBe("terpasang");
        expect(m.record.installed_user_id).toBe("77");
        expect(m.record.installed_at).toBeTruthy();
        const again = await svc.markScheduleInstalled(r.id, 77);
        expect(again.ok).toBe(true);
        expect(again.idempotent).toBe(true);
        const nf = await svc.markScheduleInstalled(999999, 1);
        expect(nf.ok).toBe(false);
        expect(nf.reason).toBe("not_found");
    });

    test("findOpenScheduleForInstall cocok by HP; abaikan yg sudah terpasang; ambigu→null", async () => {
        const a = await svc.createRequest({ nama: "Joni", hp: "081234500", dusun: "A", paket: "P" });
        await svc.assignSchedule({ scheduleId: a.id, teknisiId: "tkX", teknisiName: "X", mode: "assign" });
        // cocok persis nomor → ketemu
        const hit = await svc.findOpenScheduleForInstall({ teknisiId: "tkX", phone: "081234500" });
        expect(hit && hit.id).toBe(a.id);
        // beda PREFIX (jadwal 0812… vs install 62812…) → tetap cocok (normalisasi inti)
        const hit62 = await svc.findOpenScheduleForInstall({ phone: "6281234500" });
        expect(hit62 && hit62.id).toBe(a.id);
        // nomor beda → null
        const miss = await svc.findOpenScheduleForInstall({ phone: "080000000" });
        expect(miss).toBeNull();
        // sudah terpasang → tak muncul lagi
        await svc.markScheduleInstalled(a.id, 5);
        expect(await svc.findOpenScheduleForInstall({ phone: "081234500" })).toBeNull();
    });

    test("recordWalkInInstall → record terpasang baru (dihitung getScheduleSummary)", async () => {
        const before = await svc.getScheduleSummary({ nowMs: Date.now() });
        const w = await svc.recordWalkInInstall({ nama: "Walkin", hp: "0812", dusun: "Z", paket: "P", installedUserId: 88 });
        expect(w.ref).toBe(`PSB-${w.id}`);
        const row = await svc.getScheduleById(w.id);
        expect(row.status).toBe("terpasang");
        expect(row.installed_user_id).toBe("88");
        const after = await svc.getScheduleSummary({ nowMs: Date.now() });
        expect(after.terpasang_bulan_ini).toBe(before.terpasang_bulan_ini + 1);
    });

    // ── Marketing / komisi PSB (Fase 1) ──
    test("createRequest dgn marketing (nama bebas dari #jadwal) → tersimpan type NULL, tanpa fee", async () => {
        const r = await svc.createRequest({ nama: "Lead1", hp: "0899", dusun: "K", paket: "P", marketing: { refName: "Pak Broker" } });
        const row = await svc.getScheduleById(r.id);
        expect(row.marketing_ref_name).toBe("Pak Broker");
        expect(row.marketing_type).toBeNull();       // belum diklasifikasi
        expect(row.marketing_fee).toBeNull();          // belum ada nominal
        expect(row.marketing_status).toBeNull();       // tak ada tagihan
    });

    test("setMarketing type=luar + fee → status pending; refId dibersihkan (bukan teknisi)", async () => {
        const r = await svc.createRequest({ nama: "Lead2", hp: "0898", dusun: "K", paket: "P" });
        const res = await svc.setMarketing(r.id, { type: "luar", refId: "harusnya-diabaikan", refName: "Makelar A", refPhone: "0811", fee: "50000" });
        expect(res.ok).toBe(true);
        expect(res.record.marketing_type).toBe("luar");
        expect(res.record.marketing_ref_id).toBeNull();
        expect(res.record.marketing_ref_name).toBe("Makelar A");
        expect(res.record.marketing_fee).toBe(50000);
        expect(res.record.marketing_status).toBe("pending");
    });

    test("setMarketing type=none → bersihkan semua field + fee 0 + status NULL", async () => {
        const r = await svc.createRequest({ nama: "Lead3", hp: "0897", dusun: "K", paket: "P", marketing: { refName: "X" } });
        await svc.setMarketing(r.id, { type: "luar", refName: "Y", fee: 30000 });
        const res = await svc.setMarketing(r.id, { type: "none", refName: "diabaikan", fee: 99999 });
        expect(res.ok).toBe(true);
        expect(res.record.marketing_type).toBe("none");
        expect(res.record.marketing_ref_name).toBeNull();
        expect(res.record.marketing_fee).toBeNull();
        expect(res.record.marketing_status).toBeNull();
    });

    test("setMarketing id tak ada → not_found; koreksi berulang menimpa nilai lama", async () => {
        const nf = await svc.setMarketing(999999, { type: "luar", refName: "Z", fee: 1000 });
        expect(nf.ok).toBe(false);
        expect(nf.reason).toBe("not_found");
        const r = await svc.createRequest({ nama: "Lead4", hp: "0896", dusun: "K", paket: "P" });
        await svc.setMarketing(r.id, { type: "luar", refName: "Awal", fee: 1000 });
        const res = await svc.setMarketing(r.id, { type: "luar", refName: "Koreksi", fee: 25000 });
        expect(res.record.marketing_ref_name).toBe("Koreksi");
        expect(res.record.marketing_fee).toBe(25000);
        expect(res.record.marketing_status).toBe("pending");
    });

    test("getScheduleSummary agregasi komisi bulan ini (teknisi vs luar) + pending total", async () => {
        const svc2 = require("../psb-schedule-service");
        const a = await svc2.createRequest({ nama: "KomTk", hp: "0895", dusun: "K", paket: "P" });
        await svc2.markScheduleInstalled(a.id, 501);
        await svc2.setMarketing(a.id, { type: "teknisi", refId: "tk-501", refName: "Ivan", fee: 40000 });
        const b = await svc2.createRequest({ nama: "KomLuar", hp: "0894", dusun: "K", paket: "P" });
        await svc2.markScheduleInstalled(b.id, 502);
        await svc2.setMarketing(b.id, { type: "luar", refName: "Makelar B", fee: 60000 });
        const sum = await svc2.getScheduleSummary({ nowMs: Date.now() });
        expect(sum.komisi_bulan_ini).toBeGreaterThanOrEqual(100000);
        expect(sum.komisi_teknisi_bulan_ini).toBeGreaterThanOrEqual(40000);
        expect(sum.komisi_luar_bulan_ini).toBeGreaterThanOrEqual(60000);
        expect(sum.komisi_pending_total).toBeGreaterThanOrEqual(100000);
    });
});
