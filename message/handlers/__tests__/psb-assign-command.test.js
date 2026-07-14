/**
 * Header Doc
 * Purpose: Test perintah WA assignment papan PSB (Fase B/2) — ambil/tugaskan/papan.
 *          Kunci: gating peran (tugaskan admin-only), resolusi teknisi, panggil assignSchedule
 *          dgn mode benar, DM+grup terkirim, semua NEVER-THROW & lewat renderResponseTemplate.
 * Caller: Jest.
 * Deps: `../psb-assign-command` (deps di-inject via arg ke-2).
 * MainFuncs: handlePsbAssignCommand + _internal.
 * SideEffects: Tidak ada (semua dep mock).
 */
"use strict";

const mod = require("../psb-assign-command");

const TEKNISI = { id: 3, username: "davin", name: "DAVIN", role: "teknisi", phone_number: "628111" };
const ADMIN = { id: 1, username: "aldi", name: "Aldi", role: "admin", phone_number: "628999" };

function makeDeps(over = {}) {
    return {
        scheduleService: {
            assignSchedule: jest.fn(),
            listSchedules: jest.fn(),
            buildAssignmentDm: jest.fn(() => "DM_TEXT"),
            buildAssignmentGroupNotif: jest.fn(() => "GROUP_TEXT"),
            ...(over.scheduleService || {})
        },
        sendReply: jest.fn(async () => {}),
        normalizePhoneToJid: jest.fn((p) => (p ? `${p}@s.whatsapp.net` : null)),
        renderTpl: jest.fn((key) => key), // kembalikan KEY → mudah di-assert
        accounts: over.accounts || [
            { id: 3, username: "davin", name: "DAVIN", role: "teknisi", phone_number: "628111" },
            { id: 4, username: "ivan", name: "IVAN", role: "teknisi", phone_number: "628222" },
            { id: 1, username: "aldi", name: "Aldi", role: "admin", phone_number: "628999" }
        ],
        config: over.config || { psbIntake: { summaryGroupId: "grp@g.us" } }
    };
}

describe("psb-assign-command (Fase B/2 WA)", () => {
    test("ambil PSB-12 (teknisi) → assignSchedule mode=claim + reply detail + notif grup", async () => {
        const deps = makeDeps();
        deps.scheduleService.assignSchedule.mockResolvedValue({ ok: true, mode: "claim", record: { ref: "PSB-12", assigned_teknisi_name: "DAVIN" } });
        const reply = jest.fn();
        await mod.handlePsbAssignCommand({ text: "ambil PSB-12", staff: TEKNISI, reply }, deps);
        expect(deps.scheduleService.assignSchedule).toHaveBeenCalledWith(expect.objectContaining({ scheduleId: 12, teknisiId: 3, mode: "claim" }));
        expect(reply).toHaveBeenCalledWith("DM_TEXT", expect.anything()); // aktor teknisi dapat detail
        expect(deps.sendReply).toHaveBeenCalledTimes(1); // grup saja (DM ke diri = reply di atas)
    });

    test("ambil tanpa nomor ref → psb_cmd_format, assignSchedule tak dipanggil", async () => {
        const deps = makeDeps();
        const reply = jest.fn();
        await mod.handlePsbAssignCommand({ text: "ambil psb", staff: TEKNISI, reply }, deps);
        expect(reply).toHaveBeenCalledWith("psb_cmd_format", expect.anything());
        expect(deps.scheduleService.assignSchedule).not.toHaveBeenCalled();
    });

    test("ambil jadwal sudah dipegang lain → psb_assign_error", async () => {
        const deps = makeDeps();
        deps.scheduleService.assignSchedule.mockResolvedValue({ ok: false, reason: "already_assigned" });
        const reply = jest.fn();
        await mod.handlePsbAssignCommand({ text: "ambil PSB-5", staff: TEKNISI, reply }, deps);
        expect(reply).toHaveBeenCalledWith("psb_assign_error", expect.anything());
    });

    test("tugaskan PSB-7 ke ivan (admin) → assign mode + DM ivan + grup + reply ok", async () => {
        const deps = makeDeps();
        deps.scheduleService.assignSchedule.mockResolvedValue({ ok: true, mode: "assign", record: { ref: "PSB-7", assigned_teknisi_name: "IVAN" } });
        const reply = jest.fn();
        await mod.handlePsbAssignCommand({ text: "tugaskan PSB-7 ke ivan", staff: ADMIN, reply }, deps);
        expect(deps.scheduleService.assignSchedule).toHaveBeenCalledWith(expect.objectContaining({ scheduleId: 7, teknisiId: 4, teknisiName: "IVAN", mode: "assign" }));
        expect(deps.sendReply).toHaveBeenCalledTimes(2); // DM teknisi + grup
        expect(reply).toHaveBeenCalledWith("psb_tugaskan_ok", expect.anything());
    });

    test("tugaskan oleh TEKNISI (non-admin) → psb_tugaskan_denied, tak assign", async () => {
        const deps = makeDeps();
        const reply = jest.fn();
        await mod.handlePsbAssignCommand({ text: "tugaskan PSB-7 ke ivan", staff: TEKNISI, reply }, deps);
        expect(reply).toHaveBeenCalledWith("psb_tugaskan_denied", expect.anything());
        expect(deps.scheduleService.assignSchedule).not.toHaveBeenCalled();
    });

    test("tugaskan ke teknisi tak dikenal → psb_teknisi_notfound", async () => {
        const deps = makeDeps();
        const reply = jest.fn();
        await mod.handlePsbAssignCommand({ text: "tugaskan PSB-7 ke zzzz", staff: ADMIN, reply }, deps);
        expect(reply).toHaveBeenCalledWith("psb_teknisi_notfound", expect.anything());
        expect(deps.scheduleService.assignSchedule).not.toHaveBeenCalled();
    });

    test("tugaskan ke query ambigu (>1 teknisi) → psb_teknisi_multiple", async () => {
        const deps = makeDeps(); // davin & ivan sama-sama mengandung 'a'
        const reply = jest.fn();
        await mod.handlePsbAssignCommand({ text: "tugaskan PSB-7 ke a", staff: ADMIN, reply }, deps);
        expect(reply).toHaveBeenCalledWith("psb_teknisi_multiple", expect.anything());
        expect(deps.scheduleService.assignSchedule).not.toHaveBeenCalled();
    });

    test("papan psb → list menunggu+ditugaskan (terpasang dikecualikan), count benar", async () => {
        const deps = makeDeps();
        deps.scheduleService.listSchedules.mockResolvedValue([
            { ref: "PSB-1", name: "Budi", dusun: "Krajan", status: "menunggu" },
            { ref: "PSB-2", name: "Siti", dusun: "Mekar", status: "ditugaskan", assigned_teknisi_name: "DAVIN" },
            { ref: "PSB-3", name: "X", status: "terpasang" }
        ]);
        const reply = jest.fn();
        await mod.handlePsbAssignCommand({ text: "papan psb", staff: ADMIN, reply }, deps);
        expect(deps.renderTpl).toHaveBeenCalledWith("psb_papan_list", expect.any(String), expect.objectContaining({ count: 2 }));
    });

    test("papan psb saat kosong → psb_papan_empty", async () => {
        const deps = makeDeps();
        deps.scheduleService.listSchedules.mockResolvedValue([{ status: "terpasang" }]);
        const reply = jest.fn();
        await mod.handlePsbAssignCommand({ text: "papan psb", staff: TEKNISI, reply }, deps);
        expect(deps.renderTpl).toHaveBeenCalledWith("psb_papan_empty", expect.anything(), expect.anything());
    });

    test("NEVER-THROW: assignSchedule melempar → tak throw, tetap balas maaf", async () => {
        const deps = makeDeps();
        deps.scheduleService.assignSchedule.mockRejectedValue(new Error("boom"));
        const reply = jest.fn();
        await expect(mod.handlePsbAssignCommand({ text: "ambil PSB-1", staff: TEKNISI, reply }, deps)).resolves.toBeUndefined();
        expect(reply).toHaveBeenCalled();
    });

    test("_internal.parseRef + resolveTeknisi", () => {
        expect(mod._internal.parseRef("ambil PSB-12")).toBe(12);
        expect(mod._internal.parseRef("-9 ke davin")).toBe(9);
        expect(mod._internal.parseRef("kosong")).toBeNull();
        const accts = [{ id: 3, username: "davin", name: "DAVIN", role: "teknisi" }, { id: 5, username: "x", name: "Y", role: "admin" }];
        expect(mod._internal.resolveTeknisi("davin", accts)).toHaveLength(1);
        expect(mod._internal.resolveTeknisi("x", accts)).toHaveLength(0); // 'x' itu admin, bukan teknisi
        expect(mod._internal.resolveTeknisi("3", accts)).toHaveLength(1); // by id
    });
});
