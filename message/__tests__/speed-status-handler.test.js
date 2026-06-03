/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan status Speed Boost memakai delivery service WhatsApp dan responseTemplates.
 * Caller: Jest test runner.
 * Deps: `../handlers/speed-status-handler`, `../../lib/template-service`, dan `../../lib/whatsapp-delivery-service`.
 * MainFuncs: `setResponseTemplate`.
 * SideEffects: Tidak ada.
 */

const mockSendText = jest.fn();
const mockSendPayload = jest.fn();
const templateService = require('../../lib/template-service');
const originalResponseTemplates = templateService.cache.responseTemplates;

function setResponseTemplate(key, template) {
  templateService.cache.responseTemplates[key] = {
    name: key,
    category: 'speed',
    template
  };
}

jest.mock('../../lib/whatsapp-delivery-service', () => ({
  sendMessage: (recipient, payload, options) => {
    mockSendPayload(recipient, payload, options);
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'text')) {
      mockSendText(recipient, payload.text, options);
    }
    return Promise.resolve({ sent: true });
  }
}));

const { checkSpeedBoostStatus } = require('../handlers/speed-status-handler');

describe('speed-status-handler', () => {
  beforeEach(() => {
    templateService.cache.responseTemplates = { ...originalResponseTemplates };
    mockSendText.mockReset();
    mockSendPayload.mockReset();
    global.users = [];
    global.speed_requests = [];
  });

  afterEach(() => {
    templateService.cache.responseTemplates = originalResponseTemplates;
  });

  test('mengirim pesan user tidak ditemukan via adapter', async () => {
    await checkSpeedBoostStatus(
      { key: { remoteJid: '62812@s.whatsapp.net' } },
      { id: 1 },
      '62812@s.whatsapp.net',
      true,
      999
    );

    expect(mockSendPayload).toHaveBeenCalledWith(
      '62812@s.whatsapp.net',
      expect.objectContaining({ text: expect.stringContaining('User tidak ditemukan') }),
      {}
    );
  });

  test('mengirim pesan tanpa riwayat via adapter', async () => {
    global.users = [{ id: 1, name: 'Pelanggan A', phone_number: '0812' }];

    await checkSpeedBoostStatus(
      { key: { remoteJid: '62812@s.whatsapp.net' } },
      { id: 1, name: 'Pelanggan A', phone_number: '0812' },
      '62812@s.whatsapp.net'
    );

    expect(mockSendPayload).toHaveBeenCalledWith(
      '62812@s.whatsapp.net',
      expect.objectContaining({
        text: expect.stringContaining('tidak memiliki riwayat Speed Boost')
      }),
      {}
    );
  });

  test('mengirim ringkasan active dan pending via adapter', async () => {
    setResponseTemplate('speed_status_summary', 'CUSTOM_STATUS ${adminUserInfo} ${activeSection} ${pendingSection} ${emptyActivePendingSection} ${historySection} ${adminCommands}');
    setResponseTemplate('speed_status_active_section', 'CUSTOM_ACTIVE ${requestId} ${packageName} ${profile} ${duration} ${price} ${startedAt} ${expirationSection}');
    setResponseTemplate('speed_status_active_expiration_section', 'CUSTOM_ACTIVE_EXP ${endsAt} ${hoursLeft} ${expiredWarning}');
    setResponseTemplate('speed_status_active_expired_warning', 'CUSTOM_EXPIRED_WARNING');
    setResponseTemplate('speed_status_pending_section', 'CUSTOM_PENDING ${requestId} ${packageName} ${duration} ${price} ${paymentMethod} ${paymentStatus} ${createdAt} ${waitingSection}');
    setResponseTemplate('speed_status_pending_waiting_section', 'CUSTOM_WAITING ${waitingText}');
    setResponseTemplate('speed_status_history_section', 'CUSTOM_HISTORY ${historyItems}');
    setResponseTemplate('speed_status_history_item', 'CUSTOM_HISTORY_ITEM ${index} ${statusLabel} ${packageName}');
    setResponseTemplate('speed_status_payment_method_transfer', 'CUSTOM_TRANSFER');
    setResponseTemplate('speed_status_payment_unpaid', 'CUSTOM_UNPAID');
    setResponseTemplate('speed_status_waiting_transfer', 'CUSTOM_WAIT_TRANSFER');

    global.speed_requests = [
      {
        id: 'REQ-A',
        userId: 1,
        status: 'active',
        requestedPackageName: 'Boost 20 Mbps',
        requestedPackageProfile: '20M',
        durationLabel: '1 Hari',
        price: 5000,
        createdAt: new Date().toISOString(),
        activatedAt: new Date().toISOString(),
        expirationDate: new Date(Date.now() + 3600_000).toISOString()
      },
      {
        id: 'REQ-P',
        userId: 1,
        status: 'pending',
        requestedPackageName: 'Boost 30 Mbps',
        durationLabel: '3 Hari',
        price: 10000,
        paymentMethod: 'transfer',
        paymentStatus: 'unpaid',
        createdAt: new Date().toISOString()
      }
    ];

    await checkSpeedBoostStatus(
      { key: { remoteJid: '62812@s.whatsapp.net' } },
      { id: 1, name: 'Pelanggan A', phone_number: '0812' },
      '62812@s.whatsapp.net'
    );

    expect(mockSendText).toHaveBeenCalledWith(
      '62812@s.whatsapp.net',
      expect.stringContaining('CUSTOM_STATUS'),
      {}
    );
    expect(mockSendText.mock.calls[0][1]).toContain('CUSTOM_ACTIVE REQ-A');
    expect(mockSendText.mock.calls[0][1]).toContain('CUSTOM_PENDING REQ-P');
    expect(mockSendText.mock.calls[0][1]).toContain('CUSTOM_TRANSFER');
    expect(mockSendText.mock.calls[0][1]).toContain('CUSTOM_HISTORY_ITEM 1');
  });
});
