/**
 * Header Doc
 * Purpose: Menyediakan endpoint admin/API untuk read-model/source export MikroTik, devices-for-import GenieACS, dan utilitas notifikasi WhatsApp manual.
 * Caller: Registry route API internal/admin.
 * Deps: `express`, dependency injection router, `../lib/whatsapp-delivery-service`, dan `../lib/whatsapp-gateway`.
 * MainFuncs: `createApiNetworkRouter`.
 * SideEffects: Membaca read-model MikroTik/GenieACS dan mengirim pesan WhatsApp manual untuk kebutuhan operasional.
 */
const express = require('express');
const { sendMessage } = require('../lib/whatsapp-delivery-service');
const { getSocket, isReady } = require('../lib/whatsapp-gateway');
const { createApiNetworkRepository } = require('../repositories/api-network.repository');
const { createApiNetworkService } = require('../services/api-network.service');

function createApiNetworkRouter({
    ensureAuthenticatedStaff,
    ensureAdmin,
    assertMikrotikResult,
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
