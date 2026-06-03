jest.mock('../mikrotik', () => ({
    getAllPPPoESecrets: jest.fn(),
    getPPPProfiles: jest.fn(),
    updatePPPoEProfile: jest.fn(),
    deleteActivePPPoEUser: jest.fn(),
    assertMikrotikResult: jest.fn((result) => {
        if (!result.ok) {
            const error = new Error(result.message || 'mikrotik failed');
            error.errorCode = result.errorCode || 'MIKROTIK_ERROR';
            throw error;
        }
        return result;
    }),
    isMikrotikSyncEnabled: jest.fn(() => true),
}));

jest.mock('../wifi', () => ({
    rebootRouter: jest.fn(),
}));

jest.mock('../genieacs', () => ({
    getGenieAcsFeatureStatus: jest.fn(),
}));

jest.mock('../myfunc', () => ({
    getProfileBySubscription: jest.fn(),
}));

jest.mock('../services/isolir-audit-repository', () => ({
    saveAction: jest.fn(),
    getHistory: jest.fn(),
    getHistoryById: jest.fn(),
}));

describe('isolir service', () => {
    let IsolirService;
    let mikrotik;
    let wifi;
    let genieacs;
    let myfunc;
    let auditRepository;

    beforeEach(() => {
        jest.resetModules();
        global.config = {
            sync_to_mikrotik: true,
            isolirFeatureEnabled: true,
            isolirManualEnabled: true,
            isolir_profile: 'ISOLIR',
            isolirManualDefaultProfile: 'ISOLIR',
            isolirManualAllowCustomProfile: true,
            isolirManualDefaultDisconnect: true,
            isolirManualDefaultReboot: false,
            isolirOpenDefaultReboot: false,
        };
        global.users = [
            {
                id: 1,
                name: 'Customer One',
                pppoe_username: 'cust-1',
                subscription: 'Paket A',
                device_id: 'device-1',
            },
            {
                id: 2,
                name: 'Customer Two',
                pppoe_username: 'cust-2',
                subscription: 'Paket B',
                device_id: null,
            },
        ];

        mikrotik = require('../mikrotik');
        wifi = require('../wifi');
        genieacs = require('../genieacs');
        myfunc = require('../myfunc');
        auditRepository = require('../services/isolir-audit-repository');
        IsolirService = require('../services/isolir-service');
    });

    afterEach(() => {
        delete global.config;
        delete global.users;
        jest.clearAllMocks();
    });

    test('manualIsolir saves audit and returns standardized summary', async () => {
        mikrotik.updatePPPoEProfile.mockResolvedValue({ ok: true });
        mikrotik.deleteActivePPPoEUser.mockResolvedValue({ ok: true });
        genieacs.getGenieAcsFeatureStatus.mockResolvedValue({
            available: false,
            reason: 'GenieACS dinonaktifkan oleh admin.',
            errorCode: 'GENIEACS_DISABLED',
        });

        const result = await IsolirService.manualIsolir({
            userIds: [1],
            targetProfile: 'ISOLIR',
            disconnect: true,
            reboot: true,
            reason: 'Tunggakan manual',
        }, {
            user: { id: 'admin-1', username: 'owner', role: 'owner' },
        });

        expect(result.ok).toBe(true);
        expect(result.data.summary).toMatchObject({
            totalSelected: 1,
            successCount: 1,
            failedCount: 0,
            disconnectAppliedCount: 1,
            rebootSkippedCount: 1,
        });
        expect(result.data.results[0]).toMatchObject({
            userId: 1,
            ok: true,
            disconnectApplied: true,
            rebootApplied: false,
            rebootSkippedReason: 'GenieACS dinonaktifkan oleh admin.',
        });
        expect(auditRepository.saveAction).toHaveBeenCalledWith(expect.objectContaining({
            actionType: 'manual_isolir',
            reason: 'Tunggakan manual',
            targetProfile: 'ISOLIR',
            summary: expect.objectContaining({
                successCount: 1,
                rebootSkippedCount: 1,
            }),
        }));
        expect(wifi.rebootRouter).not.toHaveBeenCalled();
    });

    test('listCandidates supports paginated shape and metadata', async () => {
        mikrotik.getAllPPPoESecrets.mockResolvedValue({
            ok: true,
            data: {
                secrets: [
                    { name: 'cust-1', profile: 'ISOLIR' },
                    { name: 'cust-2', profile: 'PAKET-B' },
                ],
            },
        });
        mikrotik.getPPPProfiles.mockResolvedValue({
            ok: true,
            data: {
                profiles: [{ name: 'ISOLIR' }, { name: 'PAKET-B' }],
            },
        });
        genieacs.getGenieAcsFeatureStatus
            .mockResolvedValueOnce({ available: true, reason: null })
            .mockResolvedValueOnce({ available: false, reason: 'missing device_id' });

        const result = await IsolirService.listCandidates({
            search: 'cust',
            page: 1,
            limit: 1,
        });

        expect(result.data.items).toHaveLength(1);
        expect(result.data.pagination).toMatchObject({
            page: 1,
            limit: 1,
            totalItems: 2,
            totalPages: 2,
        });
        expect(result.data.summary).toMatchObject({
            filteredCount: 2,
            isolatedCount: 1,
            rebootCapableCount: 1,
            rebootUnavailableCount: 1,
        });
        expect(result.data.availableSubscriptions).toEqual(['Paket A', 'Paket B']);
    });

    test('openUsers stores shared audit semantics and skips reboot when unavailable', async () => {
        myfunc.getProfileBySubscription.mockReturnValue('PAKET-A');
        mikrotik.updatePPPoEProfile.mockResolvedValue({ ok: true });
        mikrotik.deleteActivePPPoEUser.mockResolvedValue({ ok: true });
        genieacs.getGenieAcsFeatureStatus.mockResolvedValue({
            available: false,
            reason: 'missing device_id',
            errorCode: 'GENIEACS_DEVICE_REQUIRED',
        });

        const result = await IsolirService.openUsers({
            userIds: [2],
            reboot: true,
            reason: 'Pelunasan khusus',
        }, {
            user: { id: 'admin-1', username: 'owner', role: 'owner' },
        });

        expect(result.data.summary).toMatchObject({
            totalSelected: 1,
            successCount: 1,
            rebootSkippedCount: 1,
            disconnectAppliedCount: 1,
        });
        expect(auditRepository.saveAction).toHaveBeenCalledWith(expect.objectContaining({
            actionType: 'open_isolir',
            reason: 'Pelunasan khusus',
            disconnectRequested: true,
            rebootRequested: true,
        }));
    });
});
