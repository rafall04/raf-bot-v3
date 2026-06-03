const BaseService = require('./base-service');
const { createError, ErrorTypes } = require('../error-handler');
const IsolirAuditRepository = require('./isolir-audit-repository');
const {
    getAllPPPoESecrets,
    getPPPProfiles,
    updatePPPoEProfile,
    deleteActivePPPoEUser,
    assertMikrotikResult,
    isMikrotikSyncEnabled,
} = require('../mikrotik');
const { rebootRouter } = require('../wifi');
const { getProfileBySubscription } = require('../myfunc');
const { getGenieAcsFeatureStatus } = require('../genieacs');

const DEFAULT_POLICY = Object.freeze({
    isolirFeatureEnabled: true,
    isolirManualEnabled: true,
    isolirManualDefaultProfile: 'ISOLIR',
    isolirManualAllowCustomProfile: true,
    isolirManualDefaultDisconnect: true,
    isolirManualDefaultReboot: false,
    isolirOpenDefaultReboot: true,
});

function toBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    return value === true || value === 'true';
}

function summarizeResults(results) {
    const safeResults = Array.isArray(results) ? results : [];
    return safeResults.reduce((summary, item) => {
        summary.totalSelected += 1;
        if (item.ok) {
            summary.successCount += 1;
        } else {
            summary.failedCount += 1;
        }
        if (item.rebootApplied === true) {
            summary.rebootAppliedCount += 1;
        }
        if (item.rebootRequested === true && item.rebootApplied !== true) {
            summary.rebootSkippedCount += 1;
        }
        if (item.disconnectApplied === true) {
            summary.disconnectAppliedCount += 1;
        }
        if (item.disconnectRequested === true && item.disconnectApplied !== true) {
            summary.disconnectSkippedCount += 1;
        }
        return summary;
    }, {
        totalSelected: 0,
        successCount: 0,
        failedCount: 0,
        rebootAppliedCount: 0,
        rebootSkippedCount: 0,
        disconnectAppliedCount: 0,
        disconnectSkippedCount: 0,
    });
}

class IsolirService extends BaseService {
    static getPolicy() {
        const config = global.config || {};
        return {
            isolirFeatureEnabled: config.isolirFeatureEnabled !== false,
            isolirManualEnabled: config.isolirManualEnabled !== false,
            isolirManualDefaultProfile: config.isolirManualDefaultProfile || config.isolir_profile || DEFAULT_POLICY.isolirManualDefaultProfile,
            isolirManualAllowCustomProfile: config.isolirManualAllowCustomProfile !== false,
            isolirManualDefaultDisconnect: toBoolean(config.isolirManualDefaultDisconnect, DEFAULT_POLICY.isolirManualDefaultDisconnect),
            isolirManualDefaultReboot: toBoolean(config.isolirManualDefaultReboot, DEFAULT_POLICY.isolirManualDefaultReboot),
            isolirOpenDefaultReboot: toBoolean(config.isolirOpenDefaultReboot, DEFAULT_POLICY.isolirOpenDefaultReboot),
        };
    }

    static ensureFeatureEnabled() {
        const policy = this.getPolicy();
        if (!policy.isolirFeatureEnabled) {
            throw createError(
                ErrorTypes.AUTHORIZATION_ERROR,
                'Fitur isolir dinonaktifkan di pengaturan.',
                403
            );
        }
        if (!isMikrotikSyncEnabled(global.config)) {
            throw createError(
                ErrorTypes.MIKROTIK_ERROR,
                'Sinkronisasi MikroTik dinonaktifkan. Tindakan isolir tidak dapat dijalankan.',
                409
            );
        }
        return policy;
    }

    static getActor(req = null) {
        return {
            id: req?.user?.id || null,
            username: req?.user?.username || 'system',
            role: req?.user?.role || 'system',
        };
    }

    static async buildProfileMap() {
        const result = await getAllPPPoESecrets({ caller: 'isolir-service.profile-map' });
        assertMikrotikResult(result);
        const secrets = result.data?.secrets || [];
        const profileMap = new Map();
        for (const secret of secrets) {
            if (secret?.name) {
                profileMap.set(String(secret.name).toLowerCase(), secret.profile || null);
            }
        }
        return profileMap;
    }

    static async getAvailableProfiles() {
        try {
            const result = await getPPPProfiles({ caller: 'isolir-service.available-profiles' });
            assertMikrotikResult(result);
            const profiles = result.data?.profiles || result.data || [];
            return Array.isArray(profiles)
                ? profiles.map((entry) => (typeof entry === 'string' ? entry : entry.name)).filter(Boolean)
                : [];
        } catch (error) {
            console.warn('[IsolirService] Failed to load PPP profiles:', error.message);
            return [];
        }
    }

    static async listCandidates(options = {}) {
        const policy = this.ensureFeatureEnabled();
        const search = String(options.search || '').trim().toLowerCase();
        const onlyIsolated = options.onlyIsolated === true;
        const isCurrentlyIsolatedFilter = options.isCurrentlyIsolated === true
            ? true
            : options.isCurrentlyIsolated === false
                ? false
                : null;
        const subscriptionFilter = String(options.subscription || '').trim().toLowerCase();
        const profileFilter = String(options.profile || '').trim().toLowerCase();
        const page = Math.max(1, parseInt(options.page || 1, 10) || 1);
        const limit = Math.max(1, Math.min(parseInt(options.limit || 20, 10) || 20, 100));
        const profileMap = await this.buildProfileMap();
        const isolirProfile = (global.config?.isolir_profile || policy.isolirManualDefaultProfile || 'ISOLIR').toLowerCase();

        const users = Array.isArray(global.users) ? global.users : [];
        const candidates = [];
        for (const user of users) {
            if (!user?.pppoe_username) continue;
            const currentProfile = profileMap.get(String(user.pppoe_username).toLowerCase()) || null;
            const isCurrentlyIsolated = Boolean(currentProfile) && String(currentProfile).toLowerCase() === isolirProfile;

            if (onlyIsolated && !isCurrentlyIsolated) {
                continue;
            }
            if (isCurrentlyIsolatedFilter !== null && isCurrentlyIsolated !== isCurrentlyIsolatedFilter) {
                continue;
            }

            if (subscriptionFilter && String(user.subscription || '').toLowerCase() !== subscriptionFilter) {
                continue;
            }

            if (profileFilter && String(currentProfile || '').toLowerCase() !== profileFilter) {
                continue;
            }

            if (search) {
                const haystack = [
                    user.name,
                    user.pppoe_username,
                    user.subscription,
                    user.phone_number,
                    currentProfile,
                ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();
                if (!haystack.includes(search)) {
                    continue;
                }
            }

            const genieacsStatus = await getGenieAcsFeatureStatus({
                feature: 'adminReboot',
                deviceId: user.device_id || null,
            });

            candidates.push({
                id: user.id,
                name: user.name,
                pppoe_username: user.pppoe_username,
                subscription: user.subscription,
                phone_number: user.phone_number,
                paid: user.paid,
                device_id: user.device_id || null,
                currentProfile,
                isCurrentlyIsolated,
                genieacsCapable: genieacsStatus.available,
                genieacsReason: genieacsStatus.reason,
            });
        }

        const sortedCandidates = candidates.sort((left, right) => {
            return String(left.name || left.pppoe_username || '')
                .localeCompare(String(right.name || right.pppoe_username || ''), 'id', { sensitivity: 'base' });
        });
        const totalItems = sortedCandidates.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / limit));
        const currentPage = Math.min(page, totalPages);
        const offset = (currentPage - 1) * limit;
        const pageItems = sortedCandidates.slice(offset, offset + limit);
        const subscriptionOptions = Array.from(new Set(sortedCandidates.map((candidate) => candidate.subscription).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'id'));

        return {
            ok: true,
            message: 'Daftar kandidat isolir berhasil diambil.',
            errorCode: null,
            timingMs: 0,
            data: {
                items: pageItems,
                pagination: {
                    page: currentPage,
                    limit,
                    totalItems,
                    totalPages,
                },
                policy,
                availableProfiles: policy.isolirManualAllowCustomProfile ? await this.getAvailableProfiles() : [],
                availableSubscriptions: subscriptionOptions,
                summary: {
                    filteredCount: totalItems,
                    isolatedCount: sortedCandidates.filter((candidate) => candidate.isCurrentlyIsolated).length,
                    rebootCapableCount: sortedCandidates.filter((candidate) => candidate.genieacsCapable).length,
                    rebootUnavailableCount: sortedCandidates.filter((candidate) => !candidate.genieacsCapable).length,
                },
            },
        };
    }

    static async getHistory(options = {}) {
        const data = await IsolirAuditRepository.getHistory(options);
        return {
            ok: true,
            message: 'Riwayat isolir berhasil diambil.',
            errorCode: null,
            timingMs: 0,
            data,
        };
    }

    static async getHistoryById(historyId) {
        const item = await IsolirAuditRepository.getHistoryById(historyId);
        if (!item) {
            throw createError(ErrorTypes.NOT_FOUND_ERROR, 'Riwayat isolir tidak ditemukan.', 404);
        }
        return {
            ok: true,
            message: 'Detail riwayat isolir berhasil diambil.',
            errorCode: null,
            timingMs: 0,
            data: item,
        };
    }

    static async executeProfileAction(user, options = {}) {
        if (!user) {
            throw createError(ErrorTypes.NOT_FOUND_ERROR, 'Pelanggan tidak ditemukan', 404);
        }
        if (!user.pppoe_username) {
            throw createError(ErrorTypes.VALIDATION_ERROR, `PPPoE username tidak tersedia untuk ${user.name || user.id}`, 400);
        }
        if (!options.targetProfile) {
            throw createError(ErrorTypes.VALIDATION_ERROR, 'Target profile wajib diisi', 400);
        }

        const startedAt = Date.now();
        const result = {
            userId: user.id,
            name: user.name,
            pppoe_username: user.pppoe_username,
            targetProfile: options.targetProfile,
            disconnectRequested: options.disconnect === true,
            rebootRequested: options.reboot === true,
            disconnectApplied: false,
            rebootApplied: false,
            rebootSkippedReason: null,
            ok: false,
            message: '',
            errorCode: null,
            timingMs: 0,
        };

        try {
            assertMikrotikResult(
                await updatePPPoEProfile(user.pppoe_username, options.targetProfile, {
                    caller: options.caller || 'isolir-service.profile-action',
                })
            );

            if (options.disconnect === true) {
                try {
                    const disconnectResult = await deleteActivePPPoEUser(user.pppoe_username, {
                        caller: options.caller || 'isolir-service.profile-action',
                    });
                    result.disconnectApplied = disconnectResult.ok === true;
                } catch (disconnectError) {
                    result.disconnectApplied = false;
                    result.disconnectNote = disconnectError.message;
                }
            }

            if (options.reboot === true) {
                const rebootFeature = await getGenieAcsFeatureStatus({
                    feature: 'adminReboot',
                    deviceId: user.device_id || null,
                });

                if (!rebootFeature.available) {
                    result.rebootSkippedReason = rebootFeature.reason;
                } else if (user.device_id) {
                    try {
                        const rebootResult = await rebootRouter(user.device_id, {
                            featureScope: 'adminReboot',
                            context: { caller: options.caller || 'isolir-service.profile-action', deviceId: user.device_id },
                        });
                        result.rebootApplied = rebootResult.success === true;
                        if (!result.rebootApplied && !result.rebootSkippedReason) {
                            result.rebootSkippedReason = rebootResult.message;
                        }
                    } catch (rebootError) {
                        result.rebootApplied = false;
                        result.rebootSkippedReason = rebootError.message;
                    }
                }
            }

            result.ok = true;
            result.message = `Profil ${user.pppoe_username} berhasil diubah ke ${options.targetProfile}.`;
            result.timingMs = Date.now() - startedAt;
            return result;
        } catch (error) {
            result.ok = false;
            result.message = error.message;
            result.errorCode = error.errorCode || ErrorTypes.MIKROTIK_ERROR;
            result.timingMs = Date.now() - startedAt;
            return result;
        }
    }

    static async manualIsolir(input = {}, req = null) {
        const policy = this.ensureFeatureEnabled();
        if (!policy.isolirManualEnabled) {
            throw createError(ErrorTypes.AUTHORIZATION_ERROR, 'Isolir manual dinonaktifkan di pengaturan.', 403);
        }

        const userIds = Array.isArray(input.userIds) ? input.userIds : [];
        if (userIds.length === 0) {
            throw createError(ErrorTypes.VALIDATION_ERROR, 'Minimal satu pelanggan harus dipilih.', 400);
        }

        const reason = String(input.reason || '').trim();
        if (!reason) {
            throw createError(ErrorTypes.VALIDATION_ERROR, 'Alasan isolir wajib diisi.', 400);
        }

        const defaultProfile = policy.isolirManualDefaultProfile || global.config?.isolir_profile || 'ISOLIR';
        const targetProfile = String(input.targetProfile || defaultProfile).trim();
        if (!targetProfile) {
            throw createError(ErrorTypes.VALIDATION_ERROR, 'Target profile tidak valid.', 400);
        }
        if (!policy.isolirManualAllowCustomProfile && targetProfile !== defaultProfile) {
            throw createError(ErrorTypes.AUTHORIZATION_ERROR, 'Custom profile untuk isolir manual dinonaktifkan.', 403);
        }

        const disconnect = toBoolean(input.disconnect, policy.isolirManualDefaultDisconnect);
        const reboot = toBoolean(input.reboot, policy.isolirManualDefaultReboot);
        const users = (global.users || []).filter((user) => userIds.includes(user.id));

        const results = [];
        for (const user of users) {
            results.push(await this.executeProfileAction(user, {
                targetProfile,
                disconnect,
                reboot,
                caller: 'isolir-service.manual',
            }));
        }

        const entry = {
            id: `isolir_${Date.now()}`,
            actionType: 'manual_isolir',
            createdAt: new Date().toISOString(),
            actor: this.getActor(req),
            reason,
            targetProfile,
            disconnectRequested: disconnect,
            rebootRequested: reboot,
            userIds,
            summary: summarizeResults(results),
            results,
        };
        const summary = entry.summary;
        await IsolirAuditRepository.saveAction(entry);

        return {
            ok: results.some((item) => item.ok),
            message: 'Proses isolir manual selesai.',
            errorCode: null,
            timingMs: 0,
            data: {
                historyId: entry.id,
                results,
                summary,
            },
        };
    }

    static async openUsers(input = {}, req = null) {
        this.ensureFeatureEnabled();
        const userIds = Array.isArray(input.userIds) ? input.userIds : [];
        if (userIds.length === 0) {
            throw createError(ErrorTypes.VALIDATION_ERROR, 'Tidak ada pelanggan yang dipilih.', 400);
        }

        const reason = String(input.reason || 'Buka isolir manual').trim();
        const reboot = toBoolean(input.reboot, this.getPolicy().isolirOpenDefaultReboot);
        const users = (global.users || []).filter((user) => userIds.includes(user.id));
        const results = [];

        for (const user of users) {
            const targetProfile = getProfileBySubscription(user.subscription);
            if (!targetProfile) {
                results.push({
                    userId: user.id,
                    name: user.name,
                    pppoe_username: user.pppoe_username,
                    ok: false,
                    message: `Profil tidak ditemukan untuk paket ${user.subscription}`,
                    errorCode: ErrorTypes.NOT_FOUND_ERROR,
                    rebootRequested: reboot,
                    disconnectRequested: true,
                    rebootApplied: false,
                    disconnectApplied: false,
                });
                continue;
            }

            results.push(await this.executeProfileAction(user, {
                targetProfile,
                disconnect: true,
                reboot,
                caller: 'isolir-service.open',
            }));
        }

        const entry = {
            id: `open_isolir_${Date.now()}`,
            actionType: 'open_isolir',
            createdAt: new Date().toISOString(),
            actor: this.getActor(req),
            reason,
            targetProfile: null,
            disconnectRequested: true,
            rebootRequested: reboot,
            userIds,
            summary: summarizeResults(results),
            results,
        };
        const summary = entry.summary;
        await IsolirAuditRepository.saveAction(entry);

        return {
            ok: results.some((item) => item.ok),
            message: 'Proses buka isolir selesai.',
            errorCode: null,
            timingMs: 0,
            data: {
                historyId: entry.id,
                results,
                summary,
            },
        };
    }
}

module.exports = IsolirService;
