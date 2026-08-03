const express = require('express');
const http = require('http');

const mockLoadJSON = jest.fn();
const mockLogActivity = jest.fn();
const mockUpdatePPPoEProfile = jest.fn();
const mockDeleteActivePPPoEUser = jest.fn();
const mockAssertMikrotikResult = jest.fn();
const mockIsMikrotikSyncEnabled = jest.fn();
const mockGetProfileBySubscription = jest.fn();
const mockRenderTemplate = jest.fn();
const mockWithLock = jest.fn(async (_key, handler) => handler());
const mockGetDatabasePath = jest.fn(() => 'users.sqlite');
const mockDbRun = jest.fn();
const mockDbClose = jest.fn();
const mockSendCritical = jest.fn();

jest.mock('../../lib/database', () => ({
  loadJSON: (...args) => mockLoadJSON(...args)
}));

jest.mock('../../lib/activity-logger', () => ({
  logActivity: (...args) => mockLogActivity(...args)
}));

jest.mock('../../lib/security', () => ({
  rateLimit: () => (_req, _res, next) => next()
}));

jest.mock('../../lib/env-config', () => ({
  getDatabasePath: (...args) => mockGetDatabasePath(...args)
}));

jest.mock('../../lib/mikrotik', () => ({
  updatePPPoEProfile: (...args) => mockUpdatePPPoEProfile(...args),
  deleteActivePPPoEUser: (...args) => mockDeleteActivePPPoEUser(...args),
  assertMikrotikResult: (...args) => mockAssertMikrotikResult(...args),
  isMikrotikSyncEnabled: (...args) => mockIsMikrotikSyncEnabled(...args)
}));

jest.mock('../../lib/myfunc', () => ({
  getProfileBySubscription: (...args) => mockGetProfileBySubscription(...args)
}));

jest.mock('../../lib/templating', () => ({
  renderTemplate: (...args) => mockRenderTemplate(...args)
}));

jest.mock('../../lib/request-lock', () => ({
  withLock: (...args) => mockWithLock(...args)
}));

jest.mock('sqlite3', () => ({
  verbose: () => ({
    Database: jest.fn(() => ({
      run: (...args) => mockDbRun(...args),
      close: (...args) => mockDbClose(...args)
    }))
  })
}));

jest.mock('../../lib/whatsapp-critical-delivery', () => ({
  sendCritical: (...args) => mockSendCritical(...args)
}));

const router = require('../change-package');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'admin-1', username: 'owner', role: 'owner' };
    next();
  });
  app.use('/api/change-package', router);
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

describe('change-package sync policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.config = { sync_to_mikrotik: true };
    global.users = [
      {
        id: 11,
        name: 'Customer A',
        subscription: 'Paket Lama',
        subscription_price: 100000,
        pppoe_username: 'cust-a',
        phone_number: '08123'
      }
    ];

    mockLoadJSON.mockReturnValue([
      { name: 'Paket Baru', price: 150000 }
    ]);
    mockGetProfileBySubscription.mockReturnValue('PROFILE-BARU');
    mockUpdatePPPoEProfile.mockResolvedValue({ ok: true });
    mockDeleteActivePPPoEUser.mockResolvedValue({ ok: true });
    mockAssertMikrotikResult.mockImplementation((result) => {
      if (!result || result.ok !== true) {
        throw new Error(result?.message || 'mikrotik error');
      }
      return result;
    });
    mockIsMikrotikSyncEnabled.mockImplementation(() => global.config.sync_to_mikrotik !== false);
    mockDbRun.mockImplementation((_sql, _params, callback) => callback.call({ changes: 1 }, null));
    mockDbClose.mockImplementation(() => {});
    // Route kini memakai koneksi app persisten (global.db) lewat withoutClose,
    // bukan koneksi sqlite baru per request. Lihat lib/sqlite-shared-reader.
    global.db = { run: mockDbRun, close: mockDbClose };
    mockLogActivity.mockResolvedValue(true);
    mockRenderTemplate.mockReturnValue('template');
    mockSendCritical.mockResolvedValue({ delivered: true, attempts: 1 });
  });

  afterEach(() => {
    delete global.db;
    delete global.config;
    delete global.users;
    delete global.raf;
    delete global.whatsappConnectionState;
  });

  test('does not commit local package change when MikroTik sync fails and sync is enabled', async () => {
    mockUpdatePPPoEProfile.mockResolvedValue({ ok: false, message: 'router down' });

    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/change-package/11`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_package: 'Paket Baru', sync_mikrotik: true })
      });
      const payload = await response.json();

      expect(response.status).toBe(502);
      expect(payload.sync_status).toBe('failed_sync');
      expect(global.users[0].subscription).toBe('Paket Lama');
      expect(mockDbRun).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  test('commits locally with explicit sync status when MikroTik sync is disabled', async () => {
    global.config.sync_to_mikrotik = false;

    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/change-package/11`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_package: 'Paket Baru' })
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.data.sync_status).toBe('applied_locally_sync_disabled');
      expect(global.users[0].subscription).toBe('Paket Baru');
      expect(mockUpdatePPPoEProfile).not.toHaveBeenCalled();
      expect(mockDbRun).toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });
});

describe('change-package customer notification (sendCritical)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.config = { sync_to_mikrotik: true };
    global.users = [
      { id: 11, name: 'Customer A', subscription: 'Paket Lama', subscription_price: 100000, pppoe_username: 'cust-a', phone_number: '08123' },
      { id: 12, name: 'Customer B', subscription: 'Paket Lama', subscription_price: 100000, pppoe_username: 'cust-b', phone_number: '08999' }
    ];
    mockLoadJSON.mockReturnValue([{ name: 'Paket Baru', price: 150000 }]);
    mockGetProfileBySubscription.mockReturnValue('PROFILE-BARU');
    mockUpdatePPPoEProfile.mockResolvedValue({ ok: true });
    mockDeleteActivePPPoEUser.mockResolvedValue({ ok: true });
    mockAssertMikrotikResult.mockImplementation((result) => {
      if (!result || result.ok !== true) throw new Error(result?.message || 'mikrotik error');
      return result;
    });
    mockIsMikrotikSyncEnabled.mockImplementation(() => global.config.sync_to_mikrotik !== false);
    mockDbRun.mockImplementation((_sql, _params, callback) => callback.call({ changes: 1 }, null));
    mockDbClose.mockImplementation(() => {});
    // Route kini memakai koneksi app persisten (global.db) lewat withoutClose,
    // bukan koneksi sqlite baru per request. Lihat lib/sqlite-shared-reader.
    global.db = { run: mockDbRun, close: mockDbClose };
    mockLogActivity.mockResolvedValue(true);
    mockRenderTemplate.mockReturnValue('Halo, paket Anda berubah.');
    mockSendCritical.mockResolvedValue({ delivered: true, attempts: 1 });
  });

  afterEach(() => {
    delete global.db;
    delete global.config;
    delete global.users;
  });

  test('single change notifies customer via sendCritical (label package_change)', async () => {
    const app = createApp();
    const { server, baseUrl } = await startServer(app);
    try {
      const response = await fetch(`${baseUrl}/api/change-package/11`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_package: 'Paket Baru', sync_mikrotik: false })
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(mockSendCritical).toHaveBeenCalledTimes(1);
      const [recipient, message, options] = mockSendCritical.mock.calls[0];
      expect(recipient).toBe('08123');
      expect(message).toEqual({ text: 'Halo, paket Anda berubah.' });
      expect(options.label).toBe('package_change');
      expect(payload.data.notify).toMatchObject({ notified: true, delivered: 1, total: 1, queued: 0 });
    } finally {
      await stopServer(server);
    }
  });

  test('notification failure does NOT fail the package change (best-effort + dead-letter)', async () => {
    mockSendCritical.mockResolvedValue({ delivered: false, attempts: 4, errorCode: 'WHATSAPP_NOT_CONNECTED' });

    const app = createApp();
    const { server, baseUrl } = await startServer(app);
    try {
      const response = await fetch(`${baseUrl}/api/change-package/11`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_package: 'Paket Baru', sync_mikrotik: false })
      });
      const payload = await response.json();

      // Perubahan paket tetap sukses meski notifikasi gagal.
      expect(response.status).toBe(200);
      expect(global.users[0].subscription).toBe('Paket Baru');
      expect(payload.data.notify).toMatchObject({ notified: false, delivered: 0, queued: 1 });
    } finally {
      await stopServer(server);
    }
  });

  test('customer without phone is skipped gracefully (no_phone)', async () => {
    global.users[0].phone_number = '';
    const app = createApp();
    const { server, baseUrl } = await startServer(app);
    try {
      const response = await fetch(`${baseUrl}/api/change-package/11`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_package: 'Paket Baru', sync_mikrotik: false })
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(mockSendCritical).not.toHaveBeenCalled();
      expect(payload.data.notify.skipped).toBe('no_phone');
    } finally {
      await stopServer(server);
    }
  });

  test('BULK change notifies every successful customer + summary count', async () => {
    const app = createApp();
    const { server, baseUrl } = await startServer(app);
    try {
      const response = await fetch(`${baseUrl}/api/change-package/bulk/change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_ids: [11, 12], new_package: 'Paket Baru', sync_mikrotik: false })
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      // Dulu jalur bulk TIDAK memberi tahu siapa pun — sekarang 1 per pelanggan sukses.
      expect(mockSendCritical).toHaveBeenCalledTimes(2);
      expect(payload.summary).toMatchObject({ total: 2, success: 2, notified: 2 });
      expect(payload.data.every((r) => r.notify && r.notify.notified)).toBe(true);
    } finally {
      await stopServer(server);
    }
  });

  test('multi-phone customer (a|b) notified on both numbers', async () => {
    global.users[0].phone_number = '08123|08456';
    const app = createApp();
    const { server, baseUrl } = await startServer(app);
    try {
      const response = await fetch(`${baseUrl}/api/change-package/11`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_package: 'Paket Baru', sync_mikrotik: false })
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(mockSendCritical).toHaveBeenCalledTimes(2);
      expect(payload.data.notify).toMatchObject({ notified: true, delivered: 2, total: 2, queued: 0 });
    } finally {
      await stopServer(server);
    }
  });
});
