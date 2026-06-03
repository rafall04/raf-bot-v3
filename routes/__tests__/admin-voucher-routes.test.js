/**
 * Purpose: Guardrail contract test untuk registrar voucher admin hasil ekstraksi.
 * Caller: Jest test runner.
 * Deps: express, ../admin-voucher-routes.
 * MainFuncs: createRouter, invokeRoute.
 * SideEffects: Tidak ada.
 */

const express = require('express');
const { registerAdminVoucherRoutes } = require('../admin-voucher-routes');

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
  const request = { body: {}, params: {}, query: {}, ...req };
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
  const sellVoucherToCustomer = jest.fn(async () => ({
    success: true,
    message: 'sale-ok',
    sale: { id: 'SALE_1' },
    sales: [{ id: 'SALE_1' }],
    quantity: 1,
    totalAmount: 7500,
    totalProfit: 2500,
    inventory: { totalStok: 1, totalTerjual: 1 },
    voucherCodes: [{ username: 'VC001', password: 'VC001' }]
  }));
  const getPurchaseHistory = jest.fn(() => [{ id: 'PURCHASE_1' }]);
  const getSalesHistory = jest.fn(() => [{ id: 'SALE_1' }]);
  registerAdminVoucherRoutes(router, {
    ensureAuthenticatedStaff: jest.fn((req, res, next) => next()),
    runtime: {
      state: { set: jest.fn() },
      repositories: {},
    },
    loadJSON: jest.fn(() => [{ id: 'v1', name: 'Voucher Basic' }]),
    agentVoucherManager: {
      getAgentInventory: jest.fn(() => ({ totalStok: 2, totalTerjual: 0 })),
      getAgentVoucherStats: jest.fn(() => ({
        inventory: { totalStok: 2 },
        purchases: { total: 1 },
        sales: { total: 1, totalAmount: 5000, totalProfit: 1000 },
      })),
      purchaseVoucherAsReseller: jest.fn(async () => ({ success: true, message: 'ok', purchase: {}, inventory: {} })),
      sellVoucherToCustomer,
      getPurchaseHistory,
      getSalesHistory
    },
    agentManager: {
      getAllAgents: jest.fn(() => [{ id: 'agent-1', name: 'Agent 1', phone: '0812', area: 'A' }]),
      getAgentById: jest.fn(() => ({ id: 'agent-1', name: 'Agent 1', phone: '0812', area: 'A' })),
    },
    renderTemplate: jest.fn(() => 'voucher'),
    appendVoucherSentHistory: jest.fn(),
    buildVoucherSentHistoryEntries: jest.fn(() => []),
    getVoucherProfileById: jest.fn(() => ({ id: 'profile-1', prof: 'profile-1', namavc: 'Profile Basic', durasivc: '1 Hari', hargavc: 7500, hargaReseller: 5000 })),
    buildVoucherProfileSnapshot: jest.fn((profile) => profile),
    sendVoucherTextToPhones: jest.fn(async () => ({ requestedPhones: ['0812'], sentTo: ['0812'], failedTo: [] })),
  });
  return router;
}

describe('registerAdminVoucherRoutes', () => {
  test('GET /api/voucher mengembalikan data voucher', async () => {
    const router = createRouter();

    const response = await invokeRoute(router, 'get', '/api/voucher');

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  test('GET /api/admin/agent-voucher/stats mengembalikan payload stats', async () => {
    const router = createRouter();

    const response = await invokeRoute(router, 'get', '/api/admin/agent-voucher/stats');

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe(200);
  });

  test('POST /api/admin/agent-voucher/sale mengembalikan payload penjualan', async () => {
    const router = createRouter();

    const response = await invokeRoute(router, 'post', '/api/admin/agent-voucher/sale', {
      body: {
        agentId: 'agent-1',
        customerId: '0812',
        customerName: 'Pelanggan',
        voucherProfileId: 'profile-1',
        quantity: 1,
        sendWhatsApp: true
      },
      user: { username: 'owner' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.message).toBe('sale-ok');
    expect(response.body.data.totalAmount).toBe(7500);
  });

  test('GET /api/admin/agent-voucher/top-agents mengembalikan payload top agents', async () => {
    const router = createRouter();

    const response = await invokeRoute(router, 'get', '/api/admin/agent-voucher/top-agents', {
      query: { sortBy: 'profit', limit: '1' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.agents).toHaveLength(1);
    expect(response.body.data.sortBy).toBe('profit');
  });

  test('GET /api/admin/agent-voucher/agent/:id/inventory mengembalikan detail inventory agent', async () => {
    const router = createRouter();

    const response = await invokeRoute(router, 'get', '/api/admin/agent-voucher/agent/:id/inventory', {
      params: { id: 'agent-1' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.agent.id).toBe('agent-1');
    expect(response.body.data.inventory.totalStok).toBe(2);
  });

  test('GET /api/admin/agent-voucher/agent/:id/purchases mengembalikan purchase history agent', async () => {
    const router = createRouter();

    const response = await invokeRoute(router, 'get', '/api/admin/agent-voucher/agent/:id/purchases', {
      params: { id: 'agent-1' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.purchases).toEqual([{ id: 'PURCHASE_1' }]);
  });

  test('GET /api/admin/agent-voucher/agent/:id/sales mengembalikan sales history agent', async () => {
    const router = createRouter();

    const response = await invokeRoute(router, 'get', '/api/admin/agent-voucher/agent/:id/sales', {
      params: { id: 'agent-1' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.sales).toEqual([{ id: 'SALE_1' }]);
  });
});
