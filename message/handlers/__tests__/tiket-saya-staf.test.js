/**
 * Header Doc
 * Purpose: Guard RONDE 6 Fase C (#b356) — `tiket saya` mode STAF: teknisi melihat tiket yang
 *   DITUGASKAN ke dirinya (by account.id), bukan minta ID; pelanggan tetap lihat tiketnya sendiri.
 * Caller: Jest.
 * Deps: ../simple-location-handler (handleTiketSaya); global.reports.
 * SideEffects: -
 */
"use strict";

const { handleTiketSaya } = require("../simple-location-handler");

const reply = () => {};
beforeEach(() => {
    global.reports = [
        { ticketId: "T-1", status: "process", teknisiId: "t2", pelangganName: "Budi", oltName: "OLT-A", createdAt: "2026-09-08T01:00:00Z" },
        { ticketId: "T-2", status: "otw", processedByTeknisiId: "t2", pelangganName: "Sari", createdAt: "2026-09-08T02:00:00Z" },
        { ticketId: "T-3", status: "baru", teknisiId: "t9", pelangganName: "Joko", createdAt: "2026-09-08T03:00:00Z" },
        { ticketId: "T-4", status: "resolved", teknisiId: "t2", pelangganName: "Wati", createdAt: "2026-09-08T00:00:00Z" },
    ];
});
afterEach(() => { delete global.reports; });

describe("handleTiketSaya — mode STAF (#b356)", () => {
    test("teknisi → hanya tiket AKTIF yang ditugaskan ke dirinya (T-1 & T-2), bukan T-3/T-4", async () => {
        const r = await handleTiketSaya("62811@s.whatsapp.net", reply, { isTeknisi: { id: "t2" } });
        expect(r.success).toBe(true);
        expect(r.message).toMatch(/Tiket aktif kamu \(2\)/);
        expect(r.message).toMatch(/#T-1/);
        expect(r.message).toMatch(/#T-2/);
        expect(r.message).not.toMatch(/#T-3/); // ditugaskan ke teknisi lain
        expect(r.message).not.toMatch(/#T-4/); // sudah resolved (tak aktif)
    });

    test("teknisi tanpa tiket → pesan kosong (template staf)", async () => {
        const r = await handleTiketSaya("62811@s.whatsapp.net", reply, { isTeknisi: { id: "t-none" } });
        expect(r.success).toBe(true);
        expect(r.message).toMatch(/Tak ada tiket aktif yang ditugaskan/i);
    });

    test("pelanggan (tanpa opts staf) → jalur lama by pelangganId, tak melihat tiket teknisi lain", async () => {
        global.reports = [
            { ticketId: "C-1", status: "process", pelangganId: "62888@s.whatsapp.net", pelangganName: "Aku", createdAt: "2026-09-08T01:00:00Z" },
            { ticketId: "T-9", status: "process", teknisiId: "t2", pelangganName: "Lain", createdAt: "2026-09-08T01:00:00Z" },
        ];
        const r = await handleTiketSaya("62888@s.whatsapp.net", reply, {});
        expect(r.message).toMatch(/C-1/);
        expect(r.message).not.toMatch(/T-9/);
    });
});
