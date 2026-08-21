/**
 * Purpose: Guardrail contract test untuk registrar operasi database admin dan utility debug/migrate users.
 * Caller: Jest test runner.
 * Deps: express, ../admin-database-routes.
 * MainFuncs: createRouter, invokeRoute.
 * SideEffects: Tidak ada.
 */

const express = require('express');
const { registerAdminDatabaseRoutes } = require('../admin-database-routes');

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

  registerAdminDatabaseRoutes(router, {
    ensureAuthenticatedStaff: jest.fn((req, res, next) => next()),
    fs: {
      existsSync: jest.fn(() => true),
      statSync: jest.fn(() => ({ size: 1024, mtime: new Date('2026-01-01T00:00:00Z') })),
      readdirSync: jest.fn(() => ['backup-1.db']),
    },
    path: {
      resolve: jest.fn((...parts) => parts.join('/')),
      join: jest.fn((...parts) => parts.join('/')),
      basename: jest.fn((value) => value.split('/').pop()),
    },
    exec: jest.fn((command, callback) => callback(null, 'ok', '')),
    sqlite3: {
      Database: jest.fn(function Database(file, callback) {
        if (callback) callback(null);
        this.get = jest.fn((query, params, cb) => cb(null, { count: 3 }));
        this.all = jest.fn((query, params, cb) => cb(null, []));
        this.close = jest.fn((cb) => cb && cb());
      }),
    },
    runtime: {
      getConfig: jest.fn(() => ({ databasePath: 'data/users.sqlite' })),
    },
  });

  return router;
}

// Sejak penutupan kebocoran 2026-08-21: metadata database & daftar backup BUKAN konsumsi teknisi.
// `ensureAuthenticatedStaff` memasukkan peran teknisi, jadi gerbang keduanya yang menentukan.
const ADMIN = { user: { username: 'raf', role: 'admin' } };
const TEKNISI = { user: { username: 'davin', role: 'teknisi' } };

describe('registerAdminDatabaseRoutes', () => {
  // `invokeRoute` di atas MELEMPAR ULANG galat dari `next`, sehingga rute ber-`asyncHandler`
  // menghasilkan unhandled rejection yang menjatuhkan proses jest. Pemanggil ini MENANGKAP
  // galat lewat `next` — bentuk yang sama dipakai Express saat meneruskan ke middleware galat.
  async function panggilDanTangkap(router, method, path, req = {}) {
    const layer = router.stack.find(
      (entry) => entry.route && entry.route.path === path && entry.route.methods[method]
    );
    const handlers = layer.route.stack.map((entry) => entry.handle);
    const res = createResponse();
    const request = { body: {}, params: {}, query: {}, ...req };
    let galat = null;
    for (const handler of handlers) {
      if (galat) break;
      let teruskan = false;
      const next = (e) => { if (e) galat = e; else teruskan = true; };
      try {
        await handler(request, res, next);
      } catch (e) {
        galat = e;
      }
      if (!teruskan && !galat) break; // handler menjawab sendiri
    }
    return { res, galat };
  }

  test.each([
    ['get', '/api/database/info'],
    ['get', '/api/database/backups'],
    ['post', '/api/database/check-schema'],
  ])('%s %s DITOLAK untuk peran teknisi', async (method, path) => {
    const router = createRouter();
    const { galat } = await panggilDanTangkap(router, method, path, TEKNISI);
    expect(galat).toMatchObject({ statusCode: 403 });
  });

  test('GET /api/database/info mengembalikan metadata database', async () => {
    const router = createRouter();

    const response = await invokeRoute(router, 'get', '/api/database/info', ADMIN);

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe(200);
    expect(response.body.data).toEqual(expect.objectContaining({ totalUsers: 3 }));
  });

  test('GET /api/database/backups mengembalikan daftar backup', async () => {
    const router = createRouter();

    const response = await invokeRoute(router, 'get', '/api/database/backups', ADMIN);

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toEqual(expect.any(Array));
  });

  test('registrar mengekspos owner route debug database dan migrate users', () => {
    const router = createRouter();
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]}:${layer.route.path}`);

    expect(paths).toContain('get:/api/debug/database');
    expect(paths).toContain('post:/api/migrate-users');
  });
});
