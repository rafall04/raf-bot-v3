/**
 * Purpose: Guardrail contract test untuk registrar aset jaringan admin.
 * Caller: Jest test runner.
 * Deps: express, ../admin-network-assets-routes.
 * MainFuncs: createRouter, invokeRoute.
 * SideEffects: Tidak ada.
 */

const express = require('express');
const { registerAdminNetworkAssetsRoutes } = require('../admin-network-assets-routes');

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

function createRouter() {
  const networkAssetsRepo = {
    getAll: jest.fn(() => [{ id: 'asset-1', name: 'ODP-1' }]),
    setAll: jest.fn(),
  };
  const state = {
    get: jest.fn(() => [{ id: 'asset-1', name: 'ODP-1' }]),
  };

  const router = express.Router();
  registerAdminNetworkAssetsRoutes(router, {
    ensureAuthenticatedStaff: jest.fn((req, res, next) => next()),
    rateLimit: jest.fn(() => (req, res, next) => next()),
    runtime: {
      repositories: { networkAssets: networkAssetsRepo },
      state,
    },
    updateNetworkAssetsWithLock: jest.fn(async (updater) => updater(state.get())),
    saveNetworkAssets: jest.fn(),
    generateAssetId: jest.fn(() => 'asset-2'),
  });

  return { router, networkAssetsRepo };
}

describe('registerAdminNetworkAssetsRoutes', () => {
  test('GET /api/map/network-assets mengembalikan aset jaringan', async () => {
    const { router } = createRouter();

    const response = await invokeRoute(router, 'get', '/api/map/network-assets');

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toEqual([{ id: 'asset-1', name: 'ODP-1' }]);
  });

  test('POST /api/map/network-assets menulis via runtime repository', async () => {
    const { router, networkAssetsRepo } = createRouter();

    const response = await invokeRoute(router, 'post', '/api/map/network-assets', {
      body: { type: 'odp', name: 'ODP-2', latitude: -6.1, longitude: 106.8 },
      user: { role: 'admin' },
    });

    expect(response.statusCode).toBe(201);
    expect(networkAssetsRepo.setAll).toHaveBeenCalled();
  });
});
