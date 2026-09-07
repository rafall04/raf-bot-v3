/**
 * Header Doc
 * Purpose: Guard RONDE 6 (#b354) — resolver bersama penyaring penerima notif per-preferensi teknisi.
 *   Fokus INVARIAN KESELAMATAN: gate OFF = lolos apa adanya; tanpa accountId selalu lolos; default
 *   prefs (belum setel) lolos; area null tak men-drop; kelas-off/master-off/snooze/jam-diam men-drop;
 *   critical mengabaikan jam-diam & snooze tapi tetap hormati kelas & master.
 * Caller: Jest.
 * Deps: ../teknisi-recipient-resolver; prefsRepo di-inject (stub).
 * SideEffects: -
 */
"use strict";

// Jam-diam dievaluasi pada waktu LOKAL proses (prod dipaksa Asia/Jakarta di index.js). Jest tak
// menyetel TZ, jadi paksa di sini agar getHours() deterministik lintas mesin/CI.
process.env.TZ = "Asia/Jakarta";

const { filterTeknisiRecipients, isQuietNow } = require("../teknisi-recipient-resolver");

const ON = { teknisiPrefs: { enabled: true } };
function stubRepo(map) {
    return {
        getPrefs(id) {
            const base = { enabled: true, alerts: { los: true, redaman: true, ticket_new: true, post_repair: true }, areas: [], quietHours: { enabled: false }, snoozeUntil: null };
            return Object.assign(base, map[String(id)] || {});
        },
    };
}
const R = (accountId, jid) => ({ accountId, jid: jid || accountId + "@s.whatsapp.net" });

describe("filterTeknisiRecipients — gate & default", () => {
    test("gate OFF → penerima APA ADANYA (applied:false), store tak menentukan apa pun", () => {
        const recips = [R(1), R(2)];
        const out = filterTeknisiRecipients({ recipients: recips, alertClass: "los", config: { teknisiPrefs: { enabled: false } }, prefsRepo: stubRepo({}) });
        expect(out.applied).toBe(false);
        expect(out.recipients).toHaveLength(2);
    });

    test("gate ON + belum setel prefs → semua lolos (perilaku lama)", () => {
        const out = filterTeknisiRecipients({ recipients: [R(1), R(2)], alertClass: "redaman", config: ON, prefsRepo: stubRepo({}) });
        expect(out.applied).toBe(true);
        expect(out.recipients.map((r) => r.accountId)).toEqual([1, 2]);
    });

    test("penerima tanpa accountId (nomor tambahan/grup) SELALU dipertahankan", () => {
        const grp = { jid: "123@g.us" };
        const out = filterTeknisiRecipients({ recipients: [grp, R(1)], alertClass: "los", config: ON, prefsRepo: stubRepo({ 1: { enabled: false } }) });
        expect(out.recipients).toContain(grp);
        expect(out.recipients.find((r) => r.accountId === 1)).toBeUndefined(); // teknisi 1 master-off → drop
    });
});

describe("filterTeknisiRecipients — filter per-preferensi", () => {
    test("master-off & kelas-off men-drop teknisi yang bersangkutan", () => {
        const repo = stubRepo({ 1: { enabled: false }, 2: { alerts: { redaman: false, los: true, ticket_new: true, post_repair: true } } });
        const dropMaster = filterTeknisiRecipients({ recipients: [R(1)], alertClass: "los", config: ON, prefsRepo: repo });
        expect(dropMaster.recipients).toHaveLength(0);
        const dropKelas = filterTeknisiRecipients({ recipients: [R(2)], alertClass: "redaman", config: ON, prefsRepo: repo });
        expect(dropKelas.recipients).toHaveLength(0);
        const lolosKelasLain = filterTeknisiRecipients({ recipients: [R(2)], alertClass: "los", config: ON, prefsRepo: repo });
        expect(lolosKelasLain.recipients).toHaveLength(1);
    });

    test("area: teknisi berlangganan area tertentu hanya terima alert area itu; area null tak men-drop", () => {
        const repo = stubRepo({ 5: { areas: ["ODP-01"] } });
        const luar = filterTeknisiRecipients({ recipients: [R(5)], alertClass: "los", area: "ODP-09", config: ON, prefsRepo: repo });
        expect(luar.recipients).toHaveLength(0);
        const cocok = filterTeknisiRecipients({ recipients: [R(5)], alertClass: "los", area: "ODP-01", config: ON, prefsRepo: repo });
        expect(cocok.recipients).toHaveLength(1);
        const takTahu = filterTeknisiRecipients({ recipients: [R(5)], alertClass: "los", area: null, config: ON, prefsRepo: repo });
        expect(takTahu.recipients).toHaveLength(1); // "tak teramati" ≠ "tak relevan"
    });

    test("snooze & jam-diam men-drop saat non-critical, TAPI critical mengabaikannya", () => {
        const now = new Date("2026-09-07T23:30:00+07:00"); // 23:30 Jakarta → dalam 22:00–06:00
        const repo = stubRepo({ 7: { quietHours: { enabled: true, start: "22:00", end: "06:00" } } });
        const diam = filterTeknisiRecipients({ recipients: [R(7)], alertClass: "los", config: ON, now, prefsRepo: repo });
        expect(diam.recipients).toHaveLength(0);
        const mendesak = filterTeknisiRecipients({ recipients: [R(7)], alertClass: "los", critical: true, config: ON, now, prefsRepo: repo });
        expect(mendesak.recipients).toHaveLength(1); // LOS mendesak menembus jam-diam
    });
});

describe("isQuietNow — rentang lewat tengah malam", () => {
    const qh = { enabled: true, start: "22:00", end: "06:00" };
    test("23:30 → diam; 12:00 → tidak; 06:00 tepat → tidak (eksklusif akhir)", () => {
        expect(isQuietNow(qh, new Date("2026-09-07T23:30:00+07:00"))).toBe(true);
        expect(isQuietNow(qh, new Date("2026-09-07T12:00:00+07:00"))).toBe(false);
        expect(isQuietNow(qh, new Date("2026-09-07T06:00:00+07:00"))).toBe(false);
    });
});
