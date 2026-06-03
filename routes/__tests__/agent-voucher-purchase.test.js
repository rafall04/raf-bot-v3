/**
 * Purpose: Guardrail test untuk registrar admin voucher pada flow pembelian reseller.
 * Caller: Jest test runner.
 * Deps: express, http, dan ../admin-voucher-routes.
 * MainFuncs: createApp, startServer, stopServer.
 * SideEffects: Mock pengiriman WhatsApp dan pencatatan histori voucher.
 */

const express = require('express');
const http = require('http');
const { registerAdminVoucherRoutes } = require('../admin-voucher-routes');

const mockPurchaseVoucherAsReseller = jest.fn();
const mockGetAgentById = jest.fn();
const mockGetAllAgents = jest.fn(() => []);
const mockRenderTemplate = jest.fn();
const mockAppendVoucherSentHistory = jest.fn();
const mockBuildVoucherSentHistoryEntries = jest.fn();
const mockSendVoucherTextToPhones = jest.fn();

jest.mock('../../lib/password', () => ({
  comparePassword: jest.fn(),
  hashPassword: jest.fn()
}));

jest.mock('../../lib/database', () => ({
  saveReports: jest.fn(),
  saveSpeedRequests: jest.fn(),
  saveNetworkAssets: jest.fn(),
  saveCompensations: jest.fn(),
  savePackage: jest.fn(),
  saveAccounts: jest.fn(),
  saveStatik: jest.fn(),
  saveVoucher: jest.fn(),
  saveAtm: jest.fn(),
  savePayment: jest.fn(),
  savePaymentMethod: jest.fn(),
  saveRequests: jest.fn(),
  loadJSON: jest.fn(() => []),
  saveJSON: jest.fn(),
  updateOdpPortUsage: jest.fn(),
  updateOdcPortUsage: jest.fn(),
  savePackageChangeRequests: jest.fn(),
  initializeConnectionWaypointsTable: jest.fn(),
  getConnectionWaypoints: jest.fn(),
  saveConnectionWaypoints: jest.fn(),
  deleteConnectionWaypoints: jest.fn(),
  getAllConnectionWaypoints: jest.fn()
}));

jest.mock('../../lib/cron', () => ({
  initializeAllCronTasks: jest.fn(),
  isValidCron: jest.fn()
}));

jest.mock('../../lib/wifi', () => ({
  getCustomerRedaman: jest.fn(),
  getDeviceCoreInfo: jest.fn(),
  getMultipleDeviceMetrics: jest.fn(),
  rebootRouter: jest.fn(),
  updateWifiSettings: jest.fn()
}));

jest.mock('../../lib/genieacs', () => ({
  getGenieAcsDiagnostics: jest.fn(),
  getWifiInfo: jest.fn(),
  getParameterValue: jest.fn(),
  getParameterValueByPath: jest.fn()
}));

jest.mock('../../lib/wifi-logger', () => ({
  logWifiChange: jest.fn(),
  getWifiChangeLogs: jest.fn(),
  getWifiChangeStats: jest.fn(),
  buildWebWifiLogPayload: jest.fn()
}));

jest.mock('../../lib/mikrotik', () => ({
  getvoucher: jest.fn(),
  updatePPPoEProfile: jest.fn(),
  deleteActivePPPoEUser: jest.fn(),
  assertMikrotikResult: jest.fn(),
  getMikrotikDiagnostics: jest.fn(),
  getPPPProfiles: jest.fn(),
  getPppStats: jest.fn(),
  getHotspotStats: jest.fn()
}));

jest.mock('../../lib/saldo', () => ({
  addKoinUser: jest.fn(),
  addATM: jest.fn(),
  checkATMuser: jest.fn()
}));

jest.mock('../../lib/payment', () => ({
  updateStatusPayment: jest.fn(),
  checkStatusPayment: jest.fn(),
  delPayment: jest.fn(),
  addPayBuy: jest.fn(),
  addPayment: jest.fn(),
  updateKetPayment: jest.fn()
}));

jest.mock('../../lib/voucher', () => ({
  isprofvc: jest.fn(),
  checkprofvc: jest.fn(),
  checkdurasivc: jest.fn(),
  checkhargavc: jest.fn()
}));

jest.mock('../../lib/templating', () => ({
  renderTemplate: (...args) => mockRenderTemplate(...args),
  templatesCache: {}
}));

jest.mock('../../lib/myfunc', () => ({
  getProfileBySubscription: jest.fn()
}));

jest.mock('../../lib/approval-logic.js', () => ({
  handlePaidStatusChange: jest.fn(),
  sendTechnicianNotification: jest.fn()
}));

jest.mock('../../lib/technician-collection-settlement', () => ({
  getPeriodParts: jest.fn(),
  evaluateCollectionSettlement: jest.fn()
}));

jest.mock('../../lib/utils', () => ({
  normalizePhoneNumber: jest.fn((value) => String(value || '').replace(/\D/g, ''))
}));

jest.mock('../../lib/agent-voucher-manager', () => ({
  getAgentInventory: jest.fn(),
  getAgentVoucherStats: jest.fn(),
  getPurchaseHistory: jest.fn(),
  getSalesHistory: jest.fn(),
  purchaseVoucherAsReseller: (...args) => mockPurchaseVoucherAsReseller(...args),
  sellVoucherToCustomer: jest.fn()
}));

jest.mock('../../lib/agent-manager', () => ({
  getAgentById: (...args) => mockGetAgentById(...args),
  getAllAgents: (...args) => mockGetAllAgents(...args)
}));

jest.mock('../../lib/template-manager', () => ({}));
jest.mock('../../lib/template-service', () => ({}));
jest.mock('../../lib/request-lock', () => ({
  withLock: jest.fn((_key, handler) => handler)
}));
jest.mock('../../lib/security', () => ({
  rateLimit: jest.fn(() => (_req, _res, next) => next())
}));
jest.mock('../../lib/whatsapp-delivery-service', () => ({
  sendMessage: jest.fn(),
  sendMessageToMany: jest.fn()
}));
jest.mock('../../lib/activity-logger', () => ({
  getLoginLogs: jest.fn(),
  getActivityLogs: jest.fn(),
  logActivity: jest.fn()
}));

function createApp() {
  const app = express();
  const router = express.Router();
  registerAdminVoucherRoutes(router, {
    ensureAuthenticatedStaff: (_req, _res, next) => next(),
    runtime: {
      state: { set: jest.fn() },
      repositories: {}
    },
    loadJSON: jest.fn(() => global.voucher || []),
    agentVoucherManager: require('../../lib/agent-voucher-manager'),
    agentManager: require('../../lib/agent-manager'),
    renderTemplate: (...args) => mockRenderTemplate(...args),
    appendVoucherSentHistory: (...args) => mockAppendVoucherSentHistory(...args),
    buildVoucherSentHistoryEntries: (...args) => mockBuildVoucherSentHistoryEntries(...args),
    getVoucherProfileById: (profileId) => (global.voucher || []).find((item) => item.prof === profileId) || null,
    buildVoucherProfileSnapshot: jest.fn((profile) => ({ prof: profile.prof, namavc: profile.namavc })),
    sendVoucherTextToPhones: (...args) => mockSendVoucherTextToPhones(...args)
  });
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'admin-1', username: 'owner', role: 'owner' };
    next();
  });
  app.use(router);
  return app;
}

async function startServer(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function stopServer(server) {
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

describe('admin agent voucher purchase route', () => {
  beforeEach(() => {
    global.voucher = [
      {
        prof: 'P1',
        namavc: 'Paket 1',
        durasivc: '1 Hari',
        hargavc: 5000,
        hargaReseller: 3500,
        margin: 1500
      }
    ];
    global.conn = {
      sendMessage: jest.fn().mockResolvedValue(true)
    };

    mockPurchaseVoucherAsReseller.mockReset();
    mockGetAgentById.mockReset();
    mockGetAllAgents.mockReset();
    mockRenderTemplate.mockReset();
    mockAppendVoucherSentHistory.mockReset();
    mockBuildVoucherSentHistoryEntries.mockReset();
    mockSendVoucherTextToPhones.mockReset();

    mockGetAgentById.mockReturnValue({
      id: 'agent-1',
      name: 'Agent Satu',
      phone: '08123456789',
      area: 'Kota'
    });
    mockRenderTemplate.mockReturnValue('Voucher Paket 1');
    mockBuildVoucherSentHistoryEntries.mockImplementation((payload) => [payload.metadata]);
    mockSendVoucherTextToPhones.mockImplementation(async (_message, phones) => {
      for (const phone of phones) {
        await global.conn.sendMessage(phone, { text: 'Voucher Paket 1' });
      }
      return {
        requestedPhones: phones,
        sentTo: phones,
        failedTo: []
      };
    });
  });

  afterEach(() => {
    delete global.voucher;
    delete global.conn;
  });

  test('rejects purchase when reseller price is missing', async () => {
    global.voucher[0].hargaReseller = '';

    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/admin/agent-voucher/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'agent-1',
          voucherProfileId: 'P1',
          quantity: 2,
          paymentMethod: 'saldo',
          sendWhatsApp: false
        })
      });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.message).toMatch(/harga reseller/i);
      expect(mockPurchaseVoucherAsReseller).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  test('records delivery snapshot when agent purchase is sent via WhatsApp', async () => {
    mockPurchaseVoucherAsReseller.mockResolvedValue({
      success: true,
      message: 'ok',
      purchase: {
        id: 'AGV_PURCH_1',
        voucherCodes: [
          { username: 'VC001', password: 'VC001' },
          { username: 'VC002', password: 'VC002' }
        ]
      },
      inventory: { totalStok: 2 }
    });

    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/admin/agent-voucher/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'agent-1',
          voucherProfileId: 'P1',
          quantity: 2,
          paymentMethod: 'saldo',
          sendWhatsApp: true,
          notes: 'stok awal'
        })
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.status).toBe(200);
      expect(mockPurchaseVoucherAsReseller).toHaveBeenCalledWith('agent-1', 'P1', 2, 'saldo', 'Agent Satu');
      expect(global.conn.sendMessage).toHaveBeenCalled();
      expect(mockAppendVoucherSentHistory).toHaveBeenCalledTimes(1);
      expect(mockAppendVoucherSentHistory.mock.calls[0][0][0]).toMatchObject({
        transaction_context: 'agent_purchase',
        recipient_type: 'agent_reseller',
        voucher_source: 'agent_inventory',
        price_type: 'reseller',
        financial_effect: 'purchase_recorded',
        agent_id: 'agent-1',
        reference_id: 'AGV_PURCH_1'
      });
    } finally {
      await stopServer(server);
    }
  });
});
