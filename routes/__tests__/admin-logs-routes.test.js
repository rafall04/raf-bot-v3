/**
 * Purpose: Guardrail contract test untuk registrar log admin.
 * Caller: Jest test runner.
 * Deps: express, ../admin-logs-routes.
 * MainFuncs: createRouter, invokeRoute.
 * SideEffects: Tidak ada.
 */

const express = require('express');
const { registerAdminLogsRoutes } = require('../admin-logs-routes');

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
  const request = { query: {}, ...req };
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

function createRouter() {
  const router = express.Router();
  registerAdminLogsRoutes(router, {
    ensureAuthenticatedStaff: jest.fn((req, res, next) => next()),
    getLoginLogs: jest.fn(async () => [{ username: 'admin' }]),
    getActivityLogs: jest.fn(async () => [{ action: 'login' }]),
  });
  return router;
}

describe('registerAdminLogsRoutes', () => {
  test('GET /api/logs/login mengembalikan login logs', async () => {
    const router = createRouter();

    const response = await invokeRoute(router, 'get', '/api/logs/login');

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toEqual([{ username: 'admin' }]);
  });

  test('GET /api/logs/activity mengembalikan activity logs', async () => {
    const router = createRouter();

    const response = await invokeRoute(router, 'get', '/api/logs/activity');

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toEqual([{ action: 'login' }]);
  });
});
