const express = require('express');
const http = require('http');

const mockGetAllTransactions = jest.fn();
const mockGetTopupRequest = jest.fn();
const mockReloadTransactions = jest.fn();
const mockReloadTopupRequests = jest.fn();

jest.mock('../../lib/saldo-manager', () => ({
  getAllTopupRequests: jest.fn(() => []),
  getAllTransactions: (...args) => mockGetAllTransactions(...args),
  getTopupRequest: (...args) => mockGetTopupRequest(...args),
  reloadTransactions: (...args) => mockReloadTransactions(...args),
  reloadTopupRequests: (...args) => mockReloadTopupRequests(...args),
  getSaldoStatistics: jest.fn(async () => ({ totalSaldo: 0, activeUsers: 0 })),
  getTransactionStatistics: jest.fn(() => ({})),
  getAllSaldoData: jest.fn(async () => []),
  createUserSaldo: jest.fn(async () => true),
  addSaldo: jest.fn(async () => true),
  formatCurrency: jest.fn((value) => `Rp ${value}`),
  createTopupRequest: jest.fn(),
  saveTopupRequests: jest.fn(),
  getUserSaldo: jest.fn(async () => 0)
}));

jest.mock('../../lib/voucher-manager', () => ({
  getVoucherProfiles: jest.fn(() => []),
  getVoucherStatistics: jest.fn(() => ({})),
  getUserPurchaseHistory: jest.fn(() => []),
  addVoucherProfile: jest.fn(),
  updateVoucherProfile: jest.fn(),
  deleteVoucherProfile: jest.fn(),
  purchaseVoucherWithSaldo: jest.fn()
}));

jest.mock('../../lib/agent-manager', () => ({
  getAllAgents: jest.fn(() => []),
  getAgentById: jest.fn()
}));

jest.mock('../../lib/templating', () => ({
  renderTemplate: jest.fn(() => 'template')
}));

jest.mock('../../lib/whatsapp-delivery-service', () => ({
  sendMessage: jest.fn(async () => ({ sent: true })),
  sendMessageToMany: jest.fn(async () => ({ sent: true, successCount: 0 }))
}));

const fs = require('fs');
const mockExistsSync = jest.spyOn(fs, 'existsSync');

const router = require('../saldo');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: '1', username: 'admin', role: 'admin' };
    res.sendFile = jest.fn((filePath) => res.status(200).json({ filePath }));
    next();
  });
  app.use('/api/saldo', router);
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

describe('saldo proof route', () => {
  beforeEach(() => {
    mockGetAllTransactions.mockReset();
    mockGetTopupRequest.mockReset();
    mockReloadTransactions.mockReset();
    mockReloadTopupRequests.mockReset();
    mockExistsSync.mockReset();
  });

  test('serves proof file from stored static upload path', async () => {
    mockGetAllTransactions.mockReturnValue([
      { id: 'TRX1', topupRequestId: 'REQ1' }
    ]);
    mockGetTopupRequest.mockReturnValue({
      id: 'REQ1',
      paymentProof: '/static/uploads/topup-requests/2026-04/topup-req1.jpg'
    });
    mockExistsSync.mockReturnValue(true);

    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/saldo/transaction/TRX1/proof`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.filePath.replace(/\\/g, '/')).toContain('/static/uploads/topup-requests/2026-04/topup-req1.jpg');
    } finally {
      await stopServer(server);
    }
  });
});
