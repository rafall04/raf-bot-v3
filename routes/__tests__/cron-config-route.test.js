/**
 * Purpose: Guardrail test untuk registrar admin config setelah dipromosikan dari router legacy.
 * Caller: Jest test runner.
 * Deps: express, http, fs, dan ../admin-config-routes.
 * MainFuncs: createApp, startServer, stopServer.
 * SideEffects: Mock baca/tulis file konfigurasi sementara.
 */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const realFs = jest.requireActual('fs');
const { registerAdminConfigRoutes } = require('../admin-config-routes');

const mockInitializeAllCronTasks = jest.fn();
const mockLogActivity = jest.fn();

jest.mock('../../lib/database', () => ({}));
jest.mock('../../lib/cron', () => ({
  initializeAllCronTasks: (...args) => mockInitializeAllCronTasks(...args),
  isValidCron: (value) => /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(String(value || '').trim())
}));
jest.mock('../../lib/telegram-backup', () => ({
  testTelegramConnection: jest.fn(),
  performDatabaseBackup: jest.fn(),
  getTelegramConfig: jest.fn(() => ({ botToken: 'token', chatId: 'chat' }))
}));
jest.mock('../../lib/wifi', () => ({}));
jest.mock('../../lib/genieacs', () => ({}));
jest.mock('../../lib/wifi-logger', () => ({}));
jest.mock('../../lib/mikrotik', () => ({}));
jest.mock('../../lib/saldo', () => ({}));
jest.mock('../../lib/payment', () => ({}));
jest.mock('../../lib/voucher', () => ({}));
jest.mock('../../lib/templating', () => ({ renderTemplate: jest.fn(), templatesCache: {} }));
jest.mock('../../lib/myfunc', () => ({}));
jest.mock('../../lib/approval-logic.js', () => ({}));
jest.mock('../../lib/technician-collection-settlement', () => ({}));
jest.mock('../../lib/utils', () => ({}));
jest.mock('../../lib/agent-voucher-manager', () => ({}));
jest.mock('../../lib/agent-manager', () => ({}));
jest.mock('../../lib/template-manager', () => ({}));
jest.mock('../../lib/template-service', () => ({ getDiagnostics: jest.fn() }));
jest.mock('../../lib/payment-finance-service', () => ({}));
jest.mock('../../lib/request-lock', () => ({ withLock: (_key, fn) => fn() }));
jest.mock('../../lib/security', () => ({ rateLimit: () => (_req, _res, next) => next() }));
jest.mock('../../lib/whatsapp-delivery-service', () => ({}));
jest.mock('../../lib/voucher-delivery', () => ({}));
jest.mock('../../lib/activity-logger', () => ({
  getLoginLogs: jest.fn(),
  getActivityLogs: jest.fn(),
  logActivity: (...args) => mockLogActivity(...args)
}));

const configPath = path.resolve(__dirname, '..', '..', 'config.json');
const cronPath = path.resolve(__dirname, '..', '..', 'database', 'cron.json');
const speedBoostPath = path.resolve(__dirname, '..', '..', 'database', 'speed_boost_matrix.json');

function createApp() {
  const app = express();
  const router = express.Router();
  const runtime = {
    getConfig: jest.fn(() => ({})),
    setConfig: jest.fn()
  };
  registerAdminConfigRoutes({
    router,
    ensureAuthenticatedStaff: (_req, _res, next) => next(),
    logActivity: (...args) => mockLogActivity(...args),
    runtime
  });
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: '1', username: 'admin', role: 'admin' };
    next();
  });
  app.use(router);
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

describe('cron and config ownership routes', () => {
  let fileStore;
  let readSpy;
  let writeSpy;
  let existsSpy;

  beforeEach(() => {
    mockInitializeAllCronTasks.mockReset();
    mockLogActivity.mockReset();

    fileStore = {
      [configPath]: JSON.stringify({
        nama: 'RAF BOT',
        telegramBackup: {
          botToken: 'bot-token',
          chatId: '123',
          enabled: true
        }
      }),
      [cronPath]: JSON.stringify({
        unpaid_schedule: '0 0 1 * *',
        status_unpaid_schedule: true,
        schedule: '30 9 2 * *',
        status_schedule: true,
        status_message_paid_notification: true,
        schedule_unpaid_action: '0 0 15 * *',
        status_schedule_unpaid_action: true,
        schedule_isolir_notification: '0 8 11 * *',
        status_message_isolir_notification: true,
        schedule_compensation_revert: '* * * * *',
        status_compensation_revert: true,
        status_message_compensation_reverted: true,
        status_message_compensation_applied: true,
        status_speed_boost_revert: true,
        status_message_sod_applied: true,
        status_message_sod_reverted: true,
        check_schedule: '0 * * * *',
        status_check_schedule: true,
        schedule_telegram_backup: '0 4 * * *',
        status_telegram_backup: true
      }),
      [speedBoostPath]: JSON.stringify({ enabled: true })
    };

    readSpy = jest.spyOn(fs, 'readFileSync').mockImplementation((targetPath, encoding) => {
      const resolvedPath = path.resolve(String(targetPath));
      if (Object.prototype.hasOwnProperty.call(fileStore, resolvedPath)) {
        return fileStore[resolvedPath];
      }
      return realFs.readFileSync(targetPath, encoding);
    });

    writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation((targetPath, content) => {
      const resolvedPath = path.resolve(String(targetPath));
      fileStore[resolvedPath] = String(content);
    });

    existsSpy = jest.spyOn(fs, 'existsSync').mockImplementation((targetPath) => {
      const resolvedPath = path.resolve(String(targetPath));
      if (Object.prototype.hasOwnProperty.call(fileStore, resolvedPath)) {
        return true;
      }
      return realFs.existsSync(targetPath);
    });
  });

  afterEach(() => {
    readSpy.mockRestore();
    writeSpy.mockRestore();
    existsSpy.mockRestore();
  });

  test('POST /api/cron preserves telegram backup fields on partial save', async () => {
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/cron`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedule: '0 10 2 * *',
          status_schedule: false
        })
      });
      const payload = await response.json();
      const cronConfig = JSON.parse(fileStore[cronPath]);

      expect(response.status).toBe(200);
      expect(payload.message).toMatch(/berhasil/i);
      expect(cronConfig.schedule).toBe('0 10 2 * *');
      expect(cronConfig.status_schedule).toBe(false);
      expect(cronConfig.schedule_telegram_backup).toBe('0 4 * * *');
      expect(cronConfig.status_telegram_backup).toBe(true);
      expect(mockInitializeAllCronTasks).toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  test('POST /api/cron rejects invalid cron expression with field metadata', async () => {
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/cron`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedule: 'invalid-cron'
        })
      });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.field).toBe('schedule');
    } finally {
      await stopServer(server);
    }
  });

  test('GET /api/cron returns cron-only payload', async () => {
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/cron`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.data.schedule_telegram_backup).toBe('0 4 * * *');
      expect(payload.data.nama).toBeUndefined();
    } finally {
      await stopServer(server);
    }
  });

  test('POST /api/config ignores cron-owned keys', async () => {
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nama: 'RAF BOT NEW',
          status_telegram_backup: false
        })
      });
      const payload = await response.json();
      const mainConfig = JSON.parse(fileStore[configPath]);
      const cronConfig = JSON.parse(fileStore[cronPath]);

      expect(response.status).toBe(200);
      expect(payload.message).toMatch(/berhasil/i);
      expect(mainConfig.nama).toBe('RAF BOT NEW');
      expect(cronConfig.status_telegram_backup).toBe(true);
    } finally {
      await stopServer(server);
    }
  });
});
