const fs = require('fs');
const os = require('os');
const path = require('path');

describe('isolir audit repository', () => {
    let tempDir;
    let dbPath;
    let repository;

    beforeEach(() => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolir-audit-'));
        dbPath = path.join(tempDir, 'isolir_audit.sqlite');
        process.env.ISOLIR_AUDIT_DB_PATH = dbPath;
        repository = require('../services/isolir-audit-repository');
    });

    afterEach(() => {
        delete process.env.ISOLIR_AUDIT_DB_PATH;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('saveAction persists summary and detail rows', async () => {
        await repository.saveAction({
            id: 'manual_1',
            actionType: 'manual_isolir',
            createdAt: '2026-04-15T10:00:00.000Z',
            actor: { id: '1', username: 'owner', role: 'owner' },
            reason: 'Test manual',
            targetProfile: 'ISOLIR',
            disconnectRequested: true,
            rebootRequested: true,
            summary: {
                totalSelected: 1,
                successCount: 1,
                failedCount: 0,
                disconnectAppliedCount: 1,
                disconnectSkippedCount: 0,
                rebootAppliedCount: 0,
                rebootSkippedCount: 1,
            },
            results: [{
                userId: 1,
                name: 'Customer One',
                pppoe_username: 'cust-1',
                targetProfile: 'ISOLIR',
                ok: true,
                message: 'ok',
                errorCode: null,
                disconnectRequested: true,
                disconnectApplied: true,
                disconnectNote: null,
                rebootRequested: true,
                rebootApplied: false,
                rebootSkippedReason: 'GenieACS disabled',
                timingMs: 123,
            }],
        });

        const history = await repository.getHistory({ page: 1, limit: 10, includeResults: true });
        expect(history.items).toHaveLength(1);
        expect(history.items[0]).toMatchObject({
            id: 'manual_1',
            actionType: 'manual_isolir',
            summary: {
                totalSelected: 1,
                rebootSkippedCount: 1,
            },
        });
        expect(history.items[0].results[0]).toMatchObject({
            userId: 1,
            rebootSkippedReason: 'GenieACS disabled',
        });
    });

    test('getHistoryById returns complete detail payload', async () => {
        await repository.saveAction({
            id: 'open_1',
            actionType: 'open_isolir',
            createdAt: '2026-04-15T11:00:00.000Z',
            actor: { id: '1', username: 'owner', role: 'owner' },
            reason: 'Test open',
            targetProfile: null,
            disconnectRequested: true,
            rebootRequested: false,
            summary: {
                totalSelected: 1,
                successCount: 1,
                failedCount: 0,
                disconnectAppliedCount: 1,
                disconnectSkippedCount: 0,
                rebootAppliedCount: 0,
                rebootSkippedCount: 0,
            },
            results: [{
                userId: 2,
                name: 'Customer Two',
                pppoe_username: 'cust-2',
                targetProfile: 'PAKET-B',
                ok: true,
                message: 'restored',
                errorCode: null,
                disconnectRequested: true,
                disconnectApplied: true,
                disconnectNote: null,
                rebootRequested: false,
                rebootApplied: false,
                rebootSkippedReason: null,
                timingMs: 90,
            }],
        });

        const detail = await repository.getHistoryById('open_1');
        expect(detail).toMatchObject({
            id: 'open_1',
            actionType: 'open_isolir',
            actor: { username: 'owner' },
        });
        expect(detail.results[0]).toMatchObject({
            name: 'Customer Two',
            targetProfile: 'PAKET-B',
        });
    });
});
