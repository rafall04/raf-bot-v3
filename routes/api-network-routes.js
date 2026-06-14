/**
 * Header Doc
 * Purpose: Menyediakan endpoint admin/API untuk aksi jaringan, read-model source export MikroTik, dan utilitas notifikasi manual.
 * Caller: Registry route API internal/admin.
 * Deps: `express`, dependency injection router, `../lib/whatsapp-delivery-service`, dan `../lib/whatsapp-gateway`.
 * MainFuncs: `createApiNetworkRouter`.
 * SideEffects: Memanggil aksi MikroTik/network dan mengirim pesan WhatsApp manual untuk kebutuhan operasional.
 */
const express = require('express');
const { sendMessage } = require('../lib/whatsapp-delivery-service');
const { getSocket, isReady } = require('../lib/whatsapp-gateway');
const { createApiNetworkRepository } = require('../repositories/api-network.repository');
const { createApiNetworkService } = require('../services/api-network.service');

function createApiNetworkRouter({
    ensureAuthenticatedStaff,
    ensureAdmin,
    updatePPPoEProfile,
    assertMikrotikResult,
    isMikrotikSyncEnabled,
    buildMikrotikSyncResult,
    getAllPPPoESecrets,
    getPPPProfiles,
    getHotspotProfiles,
    getDevicesForImport
}) {
    const router = express.Router();

    function getRuntime() {
        return global.__appRuntime || null;
    }

    const apiNetworkRepository = createApiNetworkRepository({
        runtime: getRuntime()
    });
    const apiNetworkService = createApiNetworkService({
        repository: apiNetworkRepository,
        updatePPPoEProfile,
        isMikrotikSyncEnabled,
        buildMikrotikSyncResult,
        getAllPPPoESecrets,
        getPPPProfiles,
        getHotspotProfiles,
        getDevicesForImport,
        assertMikrotikResult,
        sendMessage,
        getSocket,
        isReady,
        logger: console
    });

    router.post('/action', ensureAdmin, async (req, res) => {
        try {
            const result = await apiNetworkService.handleNetworkAction(req.body);
            return res.status(result.status).json(result.body);
        } catch (error) {
            console.error('[NETWORK_ACTION_ERROR]', error);
            return res.status(500).json({
                message: 'Failed to process network action',
                error: error.message
            });
        }
    });

    router.get('/send/:id/:text', ensureAuthenticatedStaff, async (req, res) => {
        try {
            const result = await apiNetworkService.sendManualMessage({
                id: req.params.id,
                text: req.params.text
            });
            return res.status(result.status).send(result.body);
        } catch (error) {
            return res.send({ status: 500, message: error });
        }
    });

    router.get('/mikrotik/unregistered-pppoe', ensureAdmin, async (req, res) => {
        try {
            const result = await apiNetworkService.listUnregisteredPppoeSecrets();
            return res.status(result.status).json(result.body);
        } catch (error) {
            console.error('[MIKROTIK_UNREGISTERED_ERROR]', error);
            return res.status(500).json({
                status: 500,
                message: 'Gagal mengambil data dari MikroTik',
                error: error.message
            });
        }
    });

    router.get('/mikrotik/export-sources', ensureAdmin, async (req, res) => {
        try {
            const result = await apiNetworkService.listMikrotikExportSources({
                include: req.query.include,
                includePasswords: req.query.include_passwords === 'true',
                actor: req.user || null
            });
            return res.status(result.status).json(result.body);
        } catch (error) {
            console.error('[MIKROTIK_EXPORT_SOURCES_ERROR]', error);
            return res.status(500).json({
                status: 500,
                message: 'Gagal menyiapkan skeleton source export MikroTik',
                error: error.message
            });
        }
    });

    router.get('/genieacs/devices-for-import', ensureAdmin, async (req, res) => {
        try {
            const result = await apiNetworkService.listDevicesForImport();
            return res.status(result.status).json(result.body);
        } catch (error) {
            console.error('[GENIEACS_DEVICES_FOR_IMPORT_ERROR]', error);
            return res.status(500).json({
                status: 500,
                message: 'Gagal mengambil data dari GenieACS',
                error: error.message
            });
        }
    });

    return router;
}

module.exports = createApiNetworkRouter;
