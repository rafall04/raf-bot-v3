/**
 * Purpose: Guardrail contract test untuk registrar konten admin hasil ekstraksi.
 * Caller: Jest test runner.
 * Deps: express, ../admin-content-routes.
 * MainFuncs: createRouter, invokeRoute.
 * SideEffects: Tidak ada.
 */

const express = require('express');
const { registerAdminContentRoutes } = require('../admin-content-routes');

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
    if (error) {
      throw error;
    }
    const handler = handlers[index++];
    if (!handler) {
      return;
    }
    await handler(request, res, next);
  }

  await next();
  await new Promise((resolve) => setImmediate(resolve));
  return res;
}

function createDeps() {
  const announcementsRepo = {
    getAll: jest.fn(() => [{ id: 'a1', message: 'A1' }]),
    setAll: jest.fn((nextValue) => nextValue),
  };
  const newsRepo = {
    getAll: jest.fn(() => [{ id: 'n1', title: 'N1', content: 'isi' }]),
    setAll: jest.fn((nextValue) => nextValue),
  };
  const usersRepo = {
    getAll: jest.fn(() => [
      { id: 1, name: 'Raf', subscription: '10Mbps', phone_number: '08123', pppoe_username: 'raf-1' }
    ]),
  };

  return {
    runtime: {
      repositories: {
        announcements: announcementsRepo,
        news: newsRepo,
        users: usersRepo,
      },
    },
    ensureAuthenticatedStaff: jest.fn((req, res, next) => next()),
    loadJSON: jest.fn((fileName) => (fileName === 'wifi_templates.json' ? [{ intent: 'wifi', keywords: ['wifi'] }] : [])),
    saveJSON: jest.fn(),
    loadWifiTemplates: jest.fn(),
    hasAuthenticatedSession: jest.fn(() => true),
    sendMessageToMany: jest.fn(() => Promise.resolve({ ok: true })),
    normalizePhoneNumber: jest.fn((value) => String(value || '').trim()),
    templateService: {
      loadAllCategories: jest.fn(),
      saveCategory: jest.fn(),
      getDiagnostics: jest.fn(() => ({ categories: { responseTemplates: 2 } })),
    },
    templateManager: {
      reloadTemplates: jest.fn(),
    },
    templatesCache: {
      notificationTemplates: { info: 'ok' },
      wifiMenuTemplates: { ssid: 'ubah ssid' },
      responseTemplates: {
        teknisi_workflow_process_success: {
          name: 'Teknisi Workflow: Proses Berhasil',
          category: 'report',
          template: 'Tiket ${ticketId} untuk ${customerName}'
        },
        broken_response: {
          category: 'report',
          template: ''
        }
      },
      commandTemplates: {},
      errorTemplates: {},
      successTemplates: {},
      systemTemplates: {},
      menuTemplates: {},
      reportTemplates: {},
    },
  };
}

function createRouter(deps) {
  const router = express.Router();
  registerAdminContentRoutes(router, deps);
  return router;
}

describe('registerAdminContentRoutes', () => {
  test('GET /api/templates mengembalikan semua kategori template editor', async () => {
    const deps = createDeps();
    const router = createRouter(deps);

    const response = await invokeRoute(router, 'get', '/api/templates');

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toEqual(expect.objectContaining({
      notificationTemplates: { info: 'ok' },
      wifiMenuTemplates: { ssid: { name: 'Ssid', template: 'ubah ssid' } },
      responseTemplates: expect.objectContaining({
        teknisi_workflow_process_success: expect.objectContaining({
          template: 'Tiket ${ticketId} untuk ${customerName}'
        })
      }),
      commandTemplates: {},
      errorTemplates: {},
      successTemplates: {},
      systemTemplates: {},
      menuTemplates: {},
      reportTemplates: {},
    }));
    expect(deps.ensureAuthenticatedStaff).toHaveBeenCalled();
  });

  test('POST /api/templates menyimpan kategori full editor dan reload cache', async () => {
    const deps = createDeps();
    const router = createRouter(deps);
    const payload = {
      notificationTemplates: {
        paid: { name: 'Paid', template: 'Lunas', description: 'metadata tetap' },
      },
      wifiMenuTemplates: {
        main: 'Menu WiFi',
      },
      responseTemplates: {
        hello: { name: 'Hello', template: 'Halo' },
      },
      commandTemplates: {
        menu: { name: 'Menu', template: 'Pilih menu' },
      },
      errorTemplates: {
        invalid: { name: 'Invalid', template: 'Tidak valid' },
      },
      successTemplates: {
        saved: { name: 'Saved', template: 'Tersimpan' },
      },
      systemTemplates: {
        maintenance: { name: 'Maintenance', template: 'Maintenance' },
      },
      menuTemplates: {
        main_menu: { name: 'Main Menu', template: 'Menu utama', enabled: true },
      },
      reportTemplates: {
        daily: { name: 'Daily', template: 'Laporan harian', placeholders: ['tanggal'] },
      },
    };

    const response = await invokeRoute(router, 'post', '/api/templates', { body: payload });

    expect(response.statusCode).toBe(200);
    expect(deps.templateService.saveCategory).toHaveBeenCalledWith('notificationTemplates', payload.notificationTemplates);
    expect(deps.templateService.saveCategory).toHaveBeenCalledWith('wifiMenuTemplates', payload.wifiMenuTemplates);
    expect(deps.templateService.saveCategory).toHaveBeenCalledWith('responseTemplates', payload.responseTemplates);
    expect(deps.templateService.saveCategory).toHaveBeenCalledWith('menuTemplates', payload.menuTemplates);
    expect(deps.templateService.saveCategory).toHaveBeenCalledWith('reportTemplates', payload.reportTemplates);
    expect(deps.templateService.loadAllCategories).toHaveBeenCalled();
    expect(deps.templateManager.reloadTemplates).toHaveBeenCalled();
  });

  test('GET /api/templates/diagnostics memuat audit placeholder dan metadata response templates', async () => {
    const deps = createDeps();
    const router = createRouter(deps);

    const response = await invokeRoute(router, 'get', '/api/templates/diagnostics');

    expect(response.statusCode).toBe(200);
    expect(response.body.data.adminEditorAudit.responseTemplates).toEqual(expect.objectContaining({
      total: 2,
      missingName: ['broken_response'],
      emptyTemplate: ['broken_response'],
      placeholderIndex: expect.objectContaining({
        teknisi_workflow_process_success: ['ticketId', 'customerName']
      }),
      workflowGroups: expect.objectContaining({
        teknisi_workflow: expect.objectContaining({
          total: 1,
          placeholders: expect.objectContaining({
            ticketId: ['teknisi_workflow_process_success'],
            customerName: ['teknisi_workflow_process_success']
          })
        })
      })
    }));
  });

  test('POST /api/announcements menulis via runtime repository', async () => {
    const deps = createDeps();
    const router = createRouter(deps);

    const response = await invokeRoute(router, 'post', '/api/announcements', {
      body: { message: 'Pengumuman Baru' },
    });

    expect(response.statusCode).toBe(201);
    expect(deps.runtime.repositories.announcements.setAll).toHaveBeenCalled();
    expect(deps.saveJSON).toHaveBeenCalledWith(
      'announcements.json',
      expect.arrayContaining([expect.objectContaining({ message: 'Pengumuman Baru' })])
    );
  });

  test('POST /api/news menulis via runtime repository', async () => {
    const deps = createDeps();
    const router = createRouter(deps);

    const response = await invokeRoute(router, 'post', '/api/news', {
      body: { title: 'Berita Baru', news_content: 'Isi berita' },
    });

    expect(response.statusCode).toBe(201);
    expect(deps.runtime.repositories.news.setAll).toHaveBeenCalled();
    expect(deps.saveJSON).toHaveBeenCalledWith(
      'news.json',
      expect.arrayContaining([
        expect.objectContaining({ title: 'Berita Baru', content: 'Isi berita' }),
      ])
    );
  });

  test('registrar mengekspos owner route wifi templates dan broadcast', () => {
    const deps = createDeps();
    const router = createRouter(deps);
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]}:${layer.route.path}`);

    expect(paths).toContain('get:/api/wifi-templates');
    expect(paths).toContain('post:/api/wifi-templates');
    expect(paths).toContain('put:/api/wifi-templates/:intent');
    expect(paths).toContain('delete:/api/wifi-templates/:intent');
    expect(paths).toContain('post:/api/broadcast');
  });

  test('POST /api/broadcast mengembalikan accepted saat target valid', async () => {
    const deps = createDeps();
    const router = createRouter(deps);

    const response = await invokeRoute(router, 'post', '/api/broadcast', {
      body: { text: 'Halo ${nama}', users: [1] }
    });

    expect(response.statusCode).toBe(202);
    expect(response.body.message).toContain('Broadcast has been initiated');
  });
});
