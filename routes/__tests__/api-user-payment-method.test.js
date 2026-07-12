const express = require('express');
const http = require('http');

let mockedApplyPaymentStatusChange;

jest.mock('../../lib/password', () => ({
  hashPassword: jest.fn(async (value) => `hashed:${value}`),
  comparePassword: jest.fn(async () => true)
}));

jest.mock('../../lib/mikrotik', () => ({
  updatePPPoEProfile: jest.fn(async () => ({ ok: true })),
  deleteActivePPPoEUser: jest.fn(async () => ({ ok: true })),
  addPPPoEUser: jest.fn(async () => ({ ok: true })),
  checkPPPoEUserExists: jest.fn(async () => false),
  getAllPPPoESecrets: jest.fn(async () => []),
  getPPPProfiles: jest.fn(async () => []),
  assertMikrotikResult: jest.fn((result) => result),
  getMikrotikDiagnostics: jest.fn(async () => ({ ok: true })),
  isMikrotikSyncEnabled: jest.fn(() => true)
}));

jest.mock('../../lib/myfunc', () => ({
  getProfileBySubscription: jest.fn(() => 'profile-a')
}));

jest.mock('../../lib/approval-logic', () => ({
  handlePaidStatusChange: jest.fn(async () => true)
}));

jest.mock('../../lib/technician-collection-settlement', () => ({
  getPeriodParts: jest.fn(() => ({ periodMonth: 4, periodYear: 2026 })),
  evaluateCollectionSettlement: jest.fn(async () => ({ applied: true }))
}));

jest.mock('../../lib/payment-finance-service', () => {
  mockedApplyPaymentStatusChange = jest.fn(async () => ({ action: 'paid' }));
  return {
    applyPaymentStatusChange: mockedApplyPaymentStatusChange,
    getEffectivePrice: jest.fn(() => 150000),
    normalizeUserPaymentMethod: jest.fn((value) => {
      if (value === undefined || value === null) return null;
      const normalized = String(value).trim().toUpperCase();
      return ['CASH', 'TRANSFER_BANK'].includes(normalized) ? normalized : null;
    })
  };
});

jest.mock('../../lib/phone-validator-international', () => ({
  validatePhoneNumbers: jest.fn(async () => ({ valid: true })),
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
  generateRandomPassword: jest.fn(() => 'secret123'),
  validateCoordinates: jest.fn(() => true)
}));

jest.mock('../../lib/psb-notification', () => ({
  sendPSBPhase1Notification: jest.fn(),
  sendPSBPhase2Notification: jest.fn(),
  sendPSBTeknisiMeluncurNotification: jest.fn(),
  sendPSBInstallationCompleteNotification: jest.fn()
}));

jest.mock('../../lib/activity-logger', () => ({
  logActivity: jest.fn(async () => true)
}));

jest.mock('../../lib/psb-database', () => ({
  insertPSBRecord: jest.fn(),
  updatePSBRecord: jest.fn(),
  getPSBRecord: jest.fn(),
  getPSBRecordsByStatus: jest.fn(),
  movePSBToUsers: jest.fn(),
  getNextAvailablePSBId: jest.fn(),
  getNextAvailableUserId: jest.fn(async () => 999)
}));

jest.mock('../../lib/wifi-logger', () => ({
  logWifiChange: jest.fn()
}));

jest.mock('../../lib/genieacs', () => ({
  getGenieAcsConfig: jest.fn(() => ({})),
  getParameterPaths: jest.fn(() => []),
  getDefaultPaths: jest.fn(() => [])
}));

jest.mock('../../lib/security', () => ({
  rateLimit: jest.fn(() => (req, res, next) => next())
}));

jest.mock('../../lib/request-lock', () => ({
  withLock: jest.fn(async (_key, callback) => callback())
}));

jest.mock('../../lib/psb-genieacs-service', () => ({
  findPsbDevice: jest.fn(),
  listPsbDevices: jest.fn(),
  getDevicesForImport: jest.fn(),
  updatePsbDeviceConfig: jest.fn(),
  testPsbConnections: jest.fn()
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
  app.use((req, res, next) => {
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

describe('api user payment method routes', () => {
  let dbRun;

  beforeEach(() => {
    dbRun = jest.fn((_sql, _params, callback) => callback(null));
    global.db = { run: dbRun };
    global.users = [
      {
        id: 101,
        name: 'Customer A',
        phone_number: '08123',
        subscription: 'Paket 150K',
        paid: 0,
        pppoe_username: 'cust-a',
        pppoe_password: 'pass-a',
        bulk: ['1']
      }
    ];
    global.config = {};
    mockedApplyPaymentStatusChange.mockReset();
  });

  afterEach(() => {
    delete global.db;
    delete global.users;
    delete global.config;
  });

  test('legacy users/update rejects paid=true without payment method', async () => {
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/users/update`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 101, paid: true })
      });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.message).toMatch(/metode pembayaran wajib/i);
      expect(mockedApplyPaymentStatusChange).not.toHaveBeenCalled();
      expect(dbRun).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  test('users/:id: no-op finance idempoten (already_fully_paid) diterima sukses, BUKAN 409', async () => {
    // Regresi: dulu already_fully_paid / no_paid_position dianggap "rejected" → 409, memblokir SETIAP
    // edit user yang menyentuh status bayar (akar keluhan "Gagal memperbarui pengguna"). Kegagalan finance
    // NYATA di-throw (→500) sehingga tak pernah menulis DB; no-op idempoten kini = sukses (update lanjut).
    mockedApplyPaymentStatusChange.mockResolvedValueOnce({ action: 'no_change', reason: 'already_fully_paid' });
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/users/101`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Customer A',
          subscription: 'Paket 150K',
          paid: true,
          payment_method: 'CASH'
        })
      });

      expect(response.status).toBe(200);
      expect(mockedApplyPaymentStatusChange).toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });
});
