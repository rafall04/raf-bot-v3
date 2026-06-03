const express = require('express');
const http = require('http');

const mockGetActivePPPoEUsers = jest.fn();
const mockGetActiveHotspotUsers = jest.fn();

jest.mock('../../lib/mikrotik', () => ({
  getActivePPPoEUsers: (...args) => mockGetActivePPPoEUsers(...args),
  getActiveHotspotUsers: (...args) => mockGetActiveHotspotUsers(...args)
}));

const router = require('../monitoring-api');

function createApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: '1', username: 'admin', role: 'admin' };
    next();
  });
  app.use('/api/monitoring', router);
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

describe('monitoring active users routes', () => {
  beforeEach(() => {
    mockGetActivePPPoEUsers.mockReset();
    mockGetActiveHotspotUsers.mockReset();
  });

  test('returns fresh PPPoE active users payload', async () => {
    mockGetActivePPPoEUsers.mockResolvedValue({
      ok: true,
      data: [{ name: 'cust-1', address: '10.10.10.2' }],
      message: 'ok',
      timingMs: 120
    });

    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/monitoring/pppoe-active-users`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
      expect(payload.data.sessions).toEqual([{ name: 'cust-1', address: '10.10.10.2' }]);
      expect(payload.fromCache).toBe(false);
      expect(payload.stale).toBe(false);
    } finally {
      await stopServer(server);
    }
  });

  test('returns stale hotspot cache when forced refresh fails', async () => {
    mockGetActiveHotspotUsers
      .mockResolvedValueOnce({
        ok: true,
        data: [{ user: 'hs-1', address: '192.168.1.10' }],
        message: 'ok',
        timingMs: 100
      })
      .mockResolvedValueOnce({
        ok: false,
        data: [],
        message: 'router timeout',
        errorCode: 'TIMEOUT_ERROR',
        timingMs: 3100
      });

    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const firstResponse = await fetch(`${baseUrl}/api/monitoring/hotspot-active-users`);
      const firstPayload = await firstResponse.json();
      expect(firstPayload.ok).toBe(true);
      expect(firstPayload.fromCache).toBe(false);

      const secondResponse = await fetch(`${baseUrl}/api/monitoring/hotspot-active-users?refresh=1`);
      const secondPayload = await secondResponse.json();

      expect(secondResponse.status).toBe(200);
      expect(secondPayload.ok).toBe(true);
      expect(secondPayload.fromCache).toBe(true);
      expect(secondPayload.stale).toBe(true);
      expect(secondPayload.data.sessions).toEqual([{ user: 'hs-1', address: '192.168.1.10' }]);
    } finally {
      await stopServer(server);
    }
  });
});
