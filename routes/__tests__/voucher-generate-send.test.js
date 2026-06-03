/**
 * Header Doc
 * Purpose: Guardrail route generate-send voucher agar status delivery parsial tetap benar setelah runtime WA memakai gateway.
 * Caller: Jest runner regresi route voucher/admin.
 * Deps: `../api` dan mock dependency voucher/network/template.
 * MainFuncs: Tidak ada.
 * SideEffects: Memodifikasi mock global config/koneksi WA selama test.
 */
const express = require('express');
const http = require('http');

const mockAxiosGet = jest.fn();
const mockRenderTemplate = jest.fn();
const mockRateLimit = jest.fn(() => (_req, _res, next) => next());
const mockWithLock = jest.fn((_key, handler) => handler);

jest.mock('axios', () => ({
  get: (...args) => mockAxiosGet(...args)
}));

jest.mock('../../lib/password', () => ({
  hashPassword: jest.fn(async () => 'hashed'),
  comparePassword: jest.fn(async () => true)
}));

jest.mock('../../lib/mikrotik', () => ({
  updatePPPoEProfile: jest.fn(),
  deleteActivePPPoEUser: jest.fn(),
  addPPPoEUser: jest.fn(),
  checkPPPoEUserExists: jest.fn(),
  getAllPPPoESecrets: jest.fn(),
  getPPPProfiles: jest.fn(),
  assertMikrotikResult: jest.fn(),
  getMikrotikDiagnostics: jest.fn()
}));

jest.mock('../../lib/myfunc', () => ({
  getProfileBySubscription: jest.fn()
}));

jest.mock('../../lib/approval-logic', () => ({
  handlePaidStatusChange: jest.fn(async () => true)
}));

jest.mock('../../lib/technician-collection-settlement', () => ({
  getPeriodParts: jest.fn(),
  evaluateCollectionSettlement: jest.fn()
}));

jest.mock('../../lib/phone-validator-international', () => ({
  validatePhoneNumbers: jest.fn(),
  normalizePhone: jest.fn(),
  getSupportedCountries: jest.fn(() => [])
}));

jest.mock('../../lib/templating', () => ({
  renderTemplate: (...args) => mockRenderTemplate(...args),
  templatesCache: {}
}));

jest.mock('../../lib/database', () => ({
  savePackage: jest.fn(),
  saveAccounts: jest.fn(),
  loadJSON: jest.fn(() => []),
  saveJSON: jest.fn(),
  updateOdpPortUsage: jest.fn(),
  updateOdcPortUsage: jest.fn(),
  saveNetworkAssets: jest.fn()
}));

jest.mock('../../lib/psb-helper', () => ({
  parseGoogleMapsLink: jest.fn(),
  generateRandomPassword: jest.fn(() => 'random'),
  validateCoordinates: jest.fn()
}));

jest.mock('../../lib/psb-notification', () => ({
  sendPSBPhase1Notification: jest.fn(),
  sendPSBPhase2Notification: jest.fn(),
  sendPSBTeknisiMeluncurNotification: jest.fn(),
  sendPSBInstallationCompleteNotification: jest.fn()
}));

jest.mock('../../lib/activity-logger', () => ({
  logActivity: jest.fn()
}));

jest.mock('../../lib/psb-database', () => ({
  insertPSBRecord: jest.fn(),
  updatePSBRecord: jest.fn(),
  getPSBRecord: jest.fn(),
  getPSBRecordsByStatus: jest.fn(() => []),
  movePSBToUsers: jest.fn(),
  getNextAvailablePSBId: jest.fn(),
  getNextAvailableUserId: jest.fn()
}));

jest.mock('../../lib/wifi-logger', () => ({
  logWifiChange: jest.fn()
}));

jest.mock('../../lib/genieacs', () => ({
  getGenieAcsConfig: jest.fn(() => ({ valid: true })),
  getParameterPaths: jest.fn(() => []),
  getDefaultPaths: jest.fn(() => [])
}));

jest.mock('../../lib/security', () => ({
  rateLimit: (...args) => mockRateLimit(...args)
}));

jest.mock('../../lib/request-lock', () => ({
  withLock: (...args) => mockWithLock(...args)
}));

jest.mock('../../lib/psb-genieacs-service', () => ({
  findPsbDevice: jest.fn(),
  listPsbDevices: jest.fn(),
  getDevicesForImport: jest.fn(),
  updatePsbDeviceConfig: jest.fn(),
  testPsbConnections: jest.fn()
}));

const mockExistsSync = jest.spyOn(require('fs'), 'existsSync');
const mockReadFileSync = jest.spyOn(require('fs'), 'readFileSync');
const mockWriteFileSync = jest.spyOn(require('fs'), 'writeFileSync');

const router = require('../api');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'admin-1', username: 'owner', role: 'owner' };
    next();
  });
  app.use('/api', router);
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

describe('voucher generate-send route', () => {
  beforeEach(() => {
    global.config = { nama_wifi: 'RAF NET', site_url_bot: 'http://localhost:3100' };
    global.whatsappConnectionState = 'open';
    global.conn = {
      sendMessage: jest.fn()
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('Send failed'))
    };

    mockAxiosGet.mockReset();
    mockRenderTemplate.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();

    mockRenderTemplate.mockImplementation((templateKey, data) => {
      if (templateKey === 'voucher_send') {
        return `Voucher ${data.nama_paket}`;
      }
      return 'Error: Template not found';
    });

    mockAxiosGet.mockResolvedValue({
      data: {
        status: 'success',
        data: {
          username: 'abc123',
          password: 'abc123',
          profile: 'P1'
        }
      }
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('[]');
    mockWriteFileSync.mockImplementation(() => {});
  });

  afterEach(() => {
    delete global.config;
    delete global.conn;
    delete global.whatsappConnectionState;
  });

  test('returns partial_sent when only some numbers succeed', async () => {
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/voucher/generate-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: 'P1',
          profileName: 'Paket 1',
          duration: '1 Hari',
          quantity: 1,
          phones: ['08123456789', '08234567890'],
          notes: 'catatan',
          sendWhatsApp: true,
          voucherType: 'random'
        })
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.status).toBe(200);
      expect(payload.delivery_status).toBe('partial_sent');
      expect(payload.total_requested).toBe(2);
      expect(payload.total_sent).toBe(1);
      expect(payload.sent_to).toEqual(['08123456789']);
      expect(payload.failed_to).toEqual(['08234567890']);
      expect(payload.vouchers).toHaveLength(1);

      const savedHistory = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
      expect(savedHistory[0]).toMatchObject({
        sent_status: 'partial_sent',
        total_requested: 2,
        total_sent: 1,
        sent_to: ['08123456789'],
        failed_to: ['08234567890'],
        transaction_context: 'direct_customer_sale',
        recipient_type: 'end_user',
        price_type: 'retail',
        financial_effect: 'none'
      });
    } finally {
      await stopServer(server);
    }
  });

  test('rejects reseller recipient on generic voucher route', async () => {
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/voucher/generate-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: 'P1',
          profileName: 'Paket 1',
          duration: '1 Hari',
          quantity: 1,
          phones: ['08123456789'],
          sendWhatsApp: true,
          voucherType: 'random',
          recipient_type: 'agent_reseller'
        })
      });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.message).toMatch(/reseller/i);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });
});
