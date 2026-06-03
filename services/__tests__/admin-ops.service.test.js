/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan service admin-ops mempertahankan password gate dan cleanup file legacy/baru.
 * Caller: Jest test runner.
 * Deps: `fs`, `os`, `path`, dan `../admin-ops.service`.
 * MainFuncs: Memverifikasi `deleteAllUsers` memerlukan password valid dan `cleanupOrphanedPhotos` membersihkan struktur folder lama/baru.
 * SideEffects: Membuat direktori sementara selama test lalu menghapusnya kembali.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createAdminOpsService } = require("../admin-ops.service");

describe("admin-ops.service", () => {
    let tempRoot;

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "admin-ops-"));
        global.accounts = [{ id: 99, username: "raf", password: "hashed" }];
        global.users = [{ id: 1, pppoe_username: "raf-ppp" }];
        global.networkAssets = [{ type: "ODP", ports_used: 1, ports: [{ used: true, userId: 1 }] }];
        global.reports = [{ ticketId: "TKT-KEEP" }];
        global.db = {
            run(sql, params, callback) {
                const next = typeof params === "function" ? params : callback;
                next.call({ changes: sql === "DELETE FROM users" ? 1 : 0 }, null);
            },
            get(_sql, _params, callback) {
                callback(null, { count: 0 });
            }
        };
    });

    afterEach(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    test("deleteAllUsers tetap membutuhkan password valid", async () => {
        const service = createAdminOpsService({
            comparePassword: jest.fn(() => Promise.resolve(false))
        });

        await expect(service.deleteAllUsers({
            password: "salah"
        }, {
            id: 99,
            username: "raf",
            rawUser: { username: "raf", password: "hashed" }
        })).rejects.toMatchObject({ statusCode: 401 });
    });

    test("cleanupOrphanedPhotos membersihkan struktur folder reports, teknisi, dan tickets", async () => {
        const orphanReportDir = path.join(tempRoot, "uploads", "reports", "2026", "04", "TKT-ORPHAN");
        const keepReportDir = path.join(tempRoot, "uploads", "reports", "2026", "04", "TKT-KEEP");
        const orphanTeknisiDir = path.join(tempRoot, "uploads", "teknisi", "2026", "04", "TKT-ORPHAN");
        const orphanTicketsDir = path.join(tempRoot, "uploads", "tickets", "2026", "04", "TKT-ORPHAN");
        const orphanFlatTeknisi = path.join(tempRoot, "uploads", "teknisi", "OLD-1-file.jpg");

        [orphanReportDir, keepReportDir, orphanTeknisiDir, orphanTicketsDir].forEach((dir) => {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, "photo.jpg"), "x");
        });
        fs.writeFileSync(orphanFlatTeknisi, "x");

        const service = createAdminOpsService({
            comparePassword: jest.fn(() => Promise.resolve(true)),
            getProjectRoot: jest.fn(() => tempRoot)
        });

        const result = await service.cleanupOrphanedPhotos({
            password: "benar"
        }, {
            id: 99,
            username: "raf",
            rawUser: { username: "raf", password: "hashed" }
        });

        expect(result.status).toBe(200);
        expect(fs.existsSync(orphanReportDir)).toBe(false);
        expect(fs.existsSync(orphanTeknisiDir)).toBe(false);
        expect(fs.existsSync(orphanTicketsDir)).toBe(false);
        expect(fs.existsSync(orphanFlatTeknisi)).toBe(false);
        expect(fs.existsSync(keepReportDir)).toBe(true);
    });
});
