/**
 * Purpose: Guardrail contract test untuk registrar operasi WiFi admin.
 * Caller: Jest test runner.
 * Deps: express, ../admin-wifi-ops-routes.
 * MainFuncs: createRouter, invokeRoute.
 * SideEffects: Tidak ada.
 */

const express = require('express');
const { registerAdminWifiOpsRoutes } = require('../admin-wifi-ops-routes');

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function invokeRoute(router, method, path, req = {}) {
  const layer = router.stack.find(
    (entry) => entry.route && entry.route.path === path && entry.route.methods[method]
  );
  const handlers = layer.route.stack.map((entry) => entry.handle);
  const res = createResponse();
    const request = {
      body: {},
      params: {},
      query: {},
      user: { role: 'admin' },
      ...req,
    };

  let index = 0;
  async function next(error) {
    if (error) throw error;
    const handler = handlers[index++];
    if (!handler) return;
    await handler(request, res, next);
  }

  await next();
  return res;
}

function createRouter(deps) {
  const router = express.Router();
  registerAdminWifiOpsRoutes(router, deps);
  return router;
}

describe('registerAdminWifiOpsRoutes', () => {
  test('GET /api/working-hours memakai runtime config aktif', async () => {
    const deps = {
      ensureAuthenticatedStaff: jest.fn((req, res, next) => next()),
      rateLimit: jest.fn(() => (req, res, next) => next()),
      runtime: {
        config: { teknisiWorkingHours: { enabled: true, start: '08:00', end: '17:00' } },
      },
      isWithinWorkingHours: jest.fn(() => ({ isWithinHours: true, dayType: 'weekday', message: 'jam kerja' })),
      getNextAvailableMessage: jest.fn(() => 'sekarang'),
      fs: { writeFileSync: jest.fn() },
      path: { join: jest.fn(() => 'config.json') },
      getWifiChangeLogs: jest.fn(),
      getWifiChangeStats: jest.fn(),
    };
    const router = createRouter(deps);

    const response = await invokeRoute(router, 'get', '/api/working-hours');

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.status).toEqual(expect.objectContaining({ isWithinHours: true }));
  });

  test('POST /api/working-hours menyimpan perubahan config', async () => {
    const deps = {
      ensureAuthenticatedStaff: jest.fn((req, res, next) => next()),
      rateLimit: jest.fn(() => (req, res, next) => next()),
      runtime: {
        config: { teknisiWorkingHours: { enabled: true, start: '08:00', end: '17:00' } },
        setConfig: jest.fn(),
      },
      isWithinWorkingHours: jest.fn(() => ({ isWithinHours: true, dayType: 'weekday', message: 'jam kerja' })),
      getNextAvailableMessage: jest.fn(() => 'sekarang'),
      fs: { writeFileSync: jest.fn() },
      path: { join: jest.fn(() => 'config.json') },
      getWifiChangeLogs: jest.fn(),
      getWifiChangeStats: jest.fn(),
    };
    const router = createRouter(deps);

    const response = await invokeRoute(router, 'post', '/api/working-hours', {
      body: {
        enabled: true,
        weekdays: { start: '09:00', end: '18:00' },
        saturday: { start: '09:00', end: '14:00' },
        sunday: { enabled: false, start: '00:00', end: '00:00' },
        responseTime: { medium_priority: '1x24 jam kerja' },
      },
      user: { role: 'admin' },
    });

    expect(response.statusCode).toBe(200);
    expect(deps.runtime.setConfig).toHaveBeenCalled();
    expect(deps.fs.writeFileSync).toHaveBeenCalled();
  });
});
