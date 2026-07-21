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

function createRouter(extraDeps = {}) {
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
    ...extraDeps,
  });

  return { router, networkAssetsRepo };
}

/** Service jalur palsu — endpoint diuji tanpa menyentuh SQLite. */
function fakeRouteService(overrides = {}) {
  return {
    getRoute: jest.fn(async () => ({ points: [[-7.25, 111.84], [-7.251, 111.841]], meters: 150 })),
    getAllRoutes: jest.fn(async () => [{ key: 'odc-odp|ODC-1|ODP-9', points: [[-7.25, 111.84], [-7.251, 111.841]], meters: 150 }]),
    saveRoute: jest.fn(async () => ({ count: 4, meters: 412 })),
    deleteRoute: jest.fn(async () => ({})),
    ...overrides,
  };
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

// Endpoint ini SEBELUMNYA TIDAK ADA sementara klien peta sudah memanggilnya sejak lama; 404-nya
// ditelan diam-diam (`if (response.ok)` tanpa cabang else) sehingga semua garis jatuh ke garis lurus
// tanpa seorang pun mengeluh. Test ini yang menjaga jembatan itu tetap terpasang.
describe('/api/map/waypoints', () => {
  test('GET mengembalikan jalur dengan kunci "waypoints" yang dipakai klien peta', async () => {
    const routeService = fakeRouteService();
    const { router } = createRouter({ routeService });

    const response = await invokeRoute(router, 'get', '/api/map/waypoints', {
      query: { connectionType: 'odc-odp', sourceId: 'ODC-1', targetId: 'ODP-9' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.waypoints).toHaveLength(2);
    expect(response.body.data.meters).toBe(150);
  });

  test('GET mengembalikan daftar KOSONG (bukan error) saat koneksi belum punya jalur', async () => {
    const routeService = fakeRouteService({ getRoute: jest.fn(async () => null) });
    const { router } = createRouter({ routeService });

    const response = await invokeRoute(router, 'get', '/api/map/waypoints', {
      query: { connectionType: 'odc-odp', sourceId: 'ODC-1', targetId: 'ODP-9' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.waypoints).toEqual([]);
  });

  test('GET /all memberi semua jalur sekali jalan (menggantikan 1 permintaan per koneksi)', async () => {
    const routeService = fakeRouteService();
    const { router } = createRouter({ routeService });

    const response = await invokeRoute(router, 'get', '/api/map/waypoints/all');

    expect(response.statusCode).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.routes[0].key).toBe('odc-odp|ODC-1|ODP-9');
  });

  test('POST menyimpan lewat service dan mencatat pelakunya', async () => {
    const routeService = fakeRouteService();
    const { router } = createRouter({ routeService });

    const response = await invokeRoute(router, 'post', '/api/map/waypoints', {
      body: {
        connectionType: 'odc-odp',
        sourceId: 'ODC-1',
        targetId: 'ODP-9',
        waypoints: [[-7.25, 111.84], [-7.2505, 111.8405], [-7.251, 111.841]],
      },
      user: { role: 'admin', username: 'aldi' },
    });

    expect(response.statusCode).toBe(200);
    expect(routeService.saveRoute).toHaveBeenCalledWith(expect.objectContaining({
      connectionType: 'odc-odp',
      sourceId: 'ODC-1',
      targetId: 'ODP-9',
      actor: 'aldi',
    }));
  });

  test('POST menolak titik cacat dengan 400 + pesan siap-tampil (bukan 500)', async () => {
    const routeService = fakeRouteService({
      saveRoute: jest.fn(async () => { throw new Error('Titik ke-2 tidak valid (koordinat kosong atau di luar jangkauan).'); }),
    });
    const { router } = createRouter({ routeService });

    const response = await invokeRoute(router, 'post', '/api/map/waypoints', {
      body: { connectionType: 'odc-odp', sourceId: 'ODC-1', targetId: 'ODP-9', waypoints: [[-7.25, 111.84], [0, 0]] },
      user: { role: 'admin' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body.message).toMatch(/Titik ke-2/);
  });

  test('DELETE menghapus jalur manual', async () => {
    const routeService = fakeRouteService();
    const { router } = createRouter({ routeService });

    const response = await invokeRoute(router, 'delete', '/api/map/waypoints', {
      query: { connectionType: 'odc-odp', sourceId: 'ODC-1', targetId: 'ODP-9' },
      user: { role: 'admin' },
    });

    expect(response.statusCode).toBe(200);
    expect(routeService.deleteRoute).toHaveBeenCalledWith('odc-odp', 'ODC-1', 'ODP-9');
  });
});
