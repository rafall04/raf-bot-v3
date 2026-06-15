/**
 * Header Doc
 * Purpose: Guardrail baseline untuk inventaris ownership concern aktif pada route API umum sebelum normalisasi domain API.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source `routes/api.js` + sub-router `api-*.js`.
 * MainFuncs: Memverifikasi concern helper-first yang masih aktif pada route API agar extraction service/repository berikutnya punya baseline eksplisit.
 * SideEffects: Membaca source file lokal tanpa memodifikasi runtime.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function readRouteSource(fileName) {
    return fs.readFileSync(path.join(__dirname, "..", fileName), "utf8");
}

describe("api domain ownership baseline", () => {
    test("api aggregator still injects helper-heavy dependencies into sub-router factories", () => {
        const source = readRouteSource("api.js");

        expect(source).toContain("createApiNetworkRouter");
        expect(source).toContain("createApiUsersRouter");
        expect(source).toContain("createApiPsbRouter");
        expect(source).toContain("createApiVoucherRouter");
        expect(source).toContain("updatePPPoEProfile");
        expect(source).toContain("handlePaidStatusChange");
        expect(source).toContain("applyPaymentStatusChange");
        expect(source).toContain("insertPSBRecord");
        expect(source).toContain("movePSBToUsers");
        expect(source).toContain("logWifiChange");
        expect(source).toContain("loadVoucherSentHistory");
    });

    test("api users route baseline captures early service extraction while deeper finance and network orchestration still remain", () => {
        const source = readRouteSource("api-users-routes.js");

        expect(source).toContain("createApiUsersRepository");
        expect(source).toContain("createApiUsersService");
        expect(source).toContain("apiUsersService.listUsersWithIntegrityCheck()");
        expect(source).toContain("apiUsersService.updateUserPaymentStatus");
        expect(source).toContain("apiUsersService.deleteUserById");
        expect(source).toContain("apiUsersService.deleteAllUsers");
        expect(source).toContain("apiUsersService.upsertUserFromAdminPanel");
        expect(source).toContain("apiUsersService.updateUserById");
        expect(source).toContain("applyPaymentStatusChange");
        expect(source).toContain("handlePaidStatusChange");
        expect(source).toContain("updatePPPoEProfile");
        expect(source).toContain("const { sendMessage } = require('../lib/whatsapp-delivery-service')");
        expect(source).toContain("updateOdpPortUsage");
        expect(source).not.toContain("const insertQuery = `");
        expect(source).not.toContain("const { generateRandomPassword } = require('../lib/psb-helper')");
    });

    test("api voucher route baseline captures local file fallback, php generation, history persistence, and wa delivery", () => {
        const source = readRouteSource("api-voucher-routes.js");

        expect(source).toContain("createApiVoucherRepository");
        expect(source).toContain("createApiVoucherService");
        expect(source).toContain("apiVoucherService.listVoucherProfiles");
        expect(source).toContain("apiVoucherService.listSentHistory");
        expect(source).toContain("apiVoucherService.getSentStats");
        expect(source).toContain("apiVoucherService.generateAndSendVouchers");
        expect(source).toContain("apiVoucherService.sendMemberCredentials");
        expect(source).toContain("getVoucherProfiles()");
        expect(source).toContain("fs.existsSync");
        expect(source).toContain("JSON.parse(fs.readFileSync");
        expect(source).toContain("loadVoucherSentHistory");
        expect(source).toContain("appendVoucherSentHistory");
        expect(source).toContain("findVoucherHistoryByReference");
        expect(source).toContain("buildVoucherSentHistoryEntries");
        expect(source).toContain("getVoucherSentStats");
        expect(source).toContain("sendMessageToMany");
        expect(source).toContain("router.get('/voucher/sent-history'");
        expect(source).toContain("router.get('/voucher/sent-stats'");
        expect(source).toContain("router.post('/member/send-credentials'");
    });

    test("api network route baseline captures service extraction while direct runtime adapters still remain wired in route", () => {
        const source = readRouteSource("api-network-routes.js");

        expect(source).toContain("createApiNetworkRepository");
        expect(source).toContain("createApiNetworkService");
        expect(source).toContain("apiNetworkService.sendManualMessage");
        expect(source).toContain("apiNetworkService.listUnregisteredPppoeSecrets()");
        expect(source).toContain("apiNetworkService.listDevicesForImport()");
        expect(source).toContain("const { sendMessage } = require('../lib/whatsapp-delivery-service')");
        expect(source).toContain("const { getSocket, isReady } = require('../lib/whatsapp-gateway')");
        expect(source).not.toContain("getSocket()");
        expect(source).not.toContain("sendMessage(req.params.id");
        expect(source).not.toContain("updatePPPoEProfile(username, newProfile");
        expect(source).toContain("getAllPPPoESecrets");
        expect(source).toContain("getDevicesForImport");
        expect(source).not.toContain("profileToPackage");
        expect(source).not.toContain("registeredUsernames");
        expect(source).not.toContain("getUsers()");
        expect(source).not.toContain("getPackages()");
    });

    test("api psb route baseline captures partial service extraction while upload, provisioning, and notification wiring still remain", () => {
        const source = readRouteSource("api-psb-routes.js");

        expect(source).toContain("createApiPsbRepository");
        expect(source).toContain("createApiPsbService");
        expect(source).toContain("apiPsbService.submitPhase1");
        expect(source).toContain("apiPsbService.listPsbRecordsByStatus");
        expect(source).toContain("apiPsbService.updatePsbStatus");
        expect(source).toContain("apiPsbService.submitPhase2");
        expect(source).toContain("router.post('/psb/upload-photo'");
        expect(source).toContain("router.post('/psb/submit-phase1'");
        expect(source).toContain("router.post('/psb/find-device'");
        expect(source).toContain("router.post('/psb/update-device-config'");
        expect(source).toContain("router.post('/psb/submit-phase3'");
        expect(source).toContain("router.post('/psb/delete-all'");
        expect(source).toContain("const multer = require('multer')");
        expect(source).toContain("multer.diskStorage");
        expect(source).toContain("fs.mkdirSync");
        expect(source).toContain("insertPSBRecord");
        expect(source).toContain("updatePSBRecord");
        expect(source).toContain("getPSBRecord");
        expect(source).toContain("getPSBRecordsByStatus");
        expect(source).toContain("movePSBToUsers");
        expect(source).toContain("getNextAvailablePSBId");
        expect(source).toContain("getNextAvailableUserId");
        expect(source).toContain("addPPPoEUser");
        expect(source).toContain("checkPPPoEUserExists");
        expect(source).toContain("sendPSBPhase2Notification");
        expect(source).toContain("sendPSBTeknisiMeluncurNotification");
        expect(source).toContain("sendPSBInstallationCompleteNotification");
        expect(source).toContain("sendPSBPhase1Notification");
        expect(source).toContain("logWifiChange");
        expect(source).toContain("withLock");
        expect(source).toContain("psbUpload.single('photo')");
        expect(source).toContain("apiPsbService.submitPhase3");
        expect(source).toContain("apiPsbService.deleteAllPsbRecords");
        expect(source).not.toContain("let customers = getPsbRecords()");
        expect(source).not.toContain("const phase2Records = getPsbRecords()");
        expect(source).not.toContain("const validationResult = await validatePhoneNumbers");
        expect(source).not.toContain("await getNextAvailablePSBId()");
        expect(source).not.toContain("fs.renameSync");
        expect(source).not.toContain("await sendPSBInstallationCompleteNotification(psbRecord)");
        expect(source).not.toContain("const transaction = {");
        expect(source).not.toContain("await movePSBToUsers(psbRecord)");
        expect(source).not.toContain("await comparePassword(password, currentUser.password)");
    });
});
