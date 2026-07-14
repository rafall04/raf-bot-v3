const express = require('express');
const http = require('http');

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
  assertMikrotikResult: jest.fn((result) => result),
  getMikrotikDiagnostics: jest.fn(),
  isMikrotikSyncEnabled: jest.fn(() => true)
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

jest.mock('../../lib/payment-finance-service', () => ({
  applyPaymentStatusChange: jest.fn(),
  getEffectivePrice: jest.fn(),
  normalizeUserPaymentMethod: jest.fn()
}));

jest.mock('../../lib/phone-validator-international', () => ({
  validatePhoneNumbers: jest.fn(),
  normalizePhone: jest.fn((value) => value),
  getSupportedCountries: jest.fn(() => [])
}));

jest.mock('../../lib/templating', () => ({
  renderTemplate: jest.fn(() => 'template'),
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
  validateCoordinates: jest.fn(() => true)
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
  rateLimit: jest.fn(() => (_req, _res, next) => next())
}));

jest.mock('../../lib/request-lock', () => ({
  withLock: jest.fn(async (_key, callback) => callback())
}));

jest.mock('../../lib/psb-genieacs-service', () => ({
  findPsbDevice: jest.fn(async () => ({ found: false })),
  listPsbDevices: jest.fn(async () => []),
  getDevicesForImport: jest.fn(async () => []),
  updatePsbDeviceConfig: jest.fn(async () => ({ ok: true })),
  testPsbConnections: jest.fn(async () => ({ ok: true }))
}));

jest.mock('../../lib/voucher-delivery', () => ({
  loadVoucherSentHistory: jest.fn(() => []),
  appendVoucherSentHistory: jest.fn(),
  resolveVoucherDeliveryStatus: jest.fn(),
  buildVoucherSentHistoryEntries: jest.fn(() => []),
  getVoucherSentStats: jest.fn(() => ({})),
  findVoucherHistoryByReference: jest.fn(() => null)
}));

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

describe('api psb routes mount', () => {
  beforeEach(() => {
    global.users = [];
    global.accounts = [];
    global.psbRecords = [];
    global.config = {};
    global.cronConfig = {};
  });

  afterEach(() => {
    delete global.users;
    delete global.accounts;
    delete global.psbRecords;
    delete global.config;
    delete global.cronConfig;
  });

  test('POST /psb/find-device stays mounted after router extraction', async () => {
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/psb/find-device`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload).toMatchObject({
        status: 400,
        message: 'Device ID harus diisi'
      });
    } finally {
      await stopServer(server);
    }
  });
});

describe('PSB 3-fase legacy dipensiunkan (S3)', () => {
  beforeEach(() => { global.users = []; global.accounts = []; global.config = {}; });
  afterEach(() => { delete global.users; delete global.accounts; delete global.config; });

  const RETIRED = ['submit-phase1', 'submit-phase2', 'submit-phase3', 'update-status', 'delete-all'];

  test.each(RETIRED)('POST /api/psb/%s → 410 Gone (tak ada record legacy baru)', async (path) => {
    const app = createApp();
    const { server, baseUrl } = await startServer(app);
    try {
      const r = await fetch(`${baseUrl}/api/psb/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'X' })
      });
      const payload = await r.json();
      expect(r.status).toBe(410);
      expect(payload.status).toBe(410);
      expect(payload.message).toMatch(/dipensiunkan|Papan PSB/i);
    } finally {
      await stopServer(server);
    }
  });

  test('SHARED /api/psb/upload-photo TIDAK di-410 (dipakai Papan PSB)', async () => {
    const app = createApp();
    const { server, baseUrl } = await startServer(app);
    try {
      // tanpa file → handler balas non-410 (400/500), yang penting BUKAN 410 (masih hidup)
      const r = await fetch(`${baseUrl}/api/psb/upload-photo`, { method: 'POST' });
      expect(r.status).not.toBe(410);
    } finally {
      await stopServer(server);
    }
  });
});
