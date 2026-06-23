"use strict";

const os = require("os");
const path = require("path");
const fs = require("fs");
const { createVoucherTrackingRepository, parseMikhmonLogName } = require("../voucher-tracking.repository");

function tmpRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vt-"));
    return createVoucherTrackingRepository({ dbPath: path.join(dir, "voucher.sqlite") });
}

const SAMPLE = [
    "apr/03/2025-|-01:28:42-|-JDGH4988-|-2500-|-10.10.2.112-|-CA:BF:E9:94:6E:1D-|-1d-|-Paket-1Hari-|-vc-263-04.01.25-KAYINN010425",
    "apr/03/2025-|-04:04:46-|-pveep-|-800-|-10.10.0.45-|-E6:09:94:72:6C:C8-|-2h-|-Paket-2Jam-|-vc-831-03.25.25-ANIITA250325",
    "apr/03/2025-|-10:48:55-|-76259279-|-55000-|-192.168.202.182-|-60:C7:BE:AF:6E:F9-|-30d-|-bulanan-55rb-|-vc-768"
];

describe("voucher-tracking parser", () => {
    test("parses Mikhmon log name", () => {
        const r = parseMikhmonLogName(SAMPLE[0]);
        expect(r.username).toBe("JDGH4988");
        expect(r.price).toBe(2500);
        expect(r.login_at).toBe("2025-04-03 01:28:42");
        expect(r.mac).toBe("CA:BF:E9:94:6E:1D");
        expect(r.validity).toBe("1d");
        expect(r.profile).toBe("Paket-1Hari");
        expect(r.voucher_comment).toContain("KAYINN");
    });
    test("profile with hyphen stays intact + null for junk", () => {
        expect(parseMikhmonLogName(SAMPLE[2]).profile).toBe("bulanan-55rb");
        expect(parseMikhmonLogName("datetime")).toBeNull();
        expect(parseMikhmonLogName("")).toBeNull();
    });
});

describe("voucher-tracking repository", () => {
    test("ingest idempotent + report aggregates", async () => {
        const repo = tmpRepo();
        const first = await repo.ingestLogNames(SAMPLE);
        expect(first.ingested).toBe(3);
        const second = await repo.ingestLogNames(SAMPLE);
        expect(second.ingested).toBe(0);
        expect(second.skipped).toBe(3);
        const report = await repo.getReport({});
        expect(report.aktivasi).toBe(3);
        expect(report.revenue).toBe(2500 + 800 + 55000);
        expect(report.byProfile.find((p) => p.profile === "bulanan-55rb").revenue).toBe(55000);
        expect((await repo.listActivations({ limit: 10 })).length).toBe(3);
        await repo.close();
    });
    test("report respects profile filter", async () => {
        const repo = tmpRepo();
        await repo.ingestLogNames(SAMPLE);
        const r = await repo.getReport({ profile: "Paket-2Jam" });
        expect(r.aktivasi).toBe(1);
        expect(r.revenue).toBe(800);
        await repo.close();
    });
    test("recordBatch inserts", async () => {
        const repo = tmpRepo();
        const res = await repo.recordBatch({ source: "bot", profile: "Paket-1Hari", qty: 40, unit_price: 3000, created_by: "admin" });
        expect(res.id).toBeGreaterThan(0);
        await repo.close();
    });
});
