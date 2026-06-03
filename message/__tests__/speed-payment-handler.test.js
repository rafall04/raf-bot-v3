/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan bukti bayar Speed Boost memakai delivery service dan status memakai owner handler.
 * Caller: Jest test runner.
 * Deps: `../handlers/speed-payment-handler`, `../handlers/speed-status-handler`, `../../lib/whatsapp-delivery-service`, dan mock Baileys.
 * MainFuncs: `createMsg`, `setResponseTemplate`.
 * SideEffects: Tidak ada.
 */

const mockSendText = jest.fn();
const mockSendPayload = jest.fn();
const mockSendMedia = jest.fn();
const mockSaveSpeedRequests = jest.fn();
const mockCheckSpeedBoostStatus = jest.fn();
const templateService = require('../../lib/template-service');
const originalResponseTemplates = templateService.cache.responseTemplates;

function setResponseTemplate(key, template) {
  templateService.cache.responseTemplates[key] = {
    name: key,
    category: 'payment',
    template
  };
}

jest.mock('../../lib/whatsapp.adapter', () => ({
  downloadMedia: jest.fn(async () => Buffer.from('proof'))
}));

jest.mock('../../lib/whatsapp-delivery-service', () => ({
  sendMessage: (recipient, payload, options) => {
    mockSendPayload(recipient, payload, options);
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'text')) {
      mockSendText(recipient, payload.text, options);
    }
    if (payload && (payload.image || payload.document)) {
      mockSendMedia(recipient, payload, options);
    }
    return Promise.resolve({ sent: true });
  }
}));

jest.mock('../../lib/database', () => ({
  ...jest.requireActual('../../lib/database'),
  saveSpeedRequests: (...args) => mockSaveSpeedRequests(...args)
}));

jest.mock('../handlers/speed-status-handler', () => ({
  checkSpeedBoostStatus: (...args) => mockCheckSpeedBoostStatus(...args)
}));

const {
  handleSpeedPaymentProof,
  handleSpeedRequestStatus
} = require('../handlers/speed-payment-handler');

function createMsg(message = { conversation: 'halo' }) {
  return {
    key: { remoteJid: '62812@s.whatsapp.net' },
    message
  };
}

describe('speed-payment-handler', () => {
  beforeEach(() => {
    templateService.cache.responseTemplates = { ...originalResponseTemplates };
    mockSendText.mockReset();
    mockSendPayload.mockReset();
    mockSendMedia.mockReset();
    mockSaveSpeedRequests.mockReset();
    mockCheckSpeedBoostStatus.mockReset();
    global.config = { ownerNumber: ['628111111111'] };
    global.speed_requests = [];
  });

  afterEach(() => {
    templateService.cache.responseTemplates = originalResponseTemplates;
  });

  test('mengirim pesan penolakan via adapter saat tidak ada pending request', async () => {
    setResponseTemplate('speed_payment_no_pending', 'CUSTOM_SPEED_NO_PENDING');

    await handleSpeedPaymentProof(createMsg(), { id: 1 });

    expect(mockSendPayload).toHaveBeenCalledWith(
      '62812@s.whatsapp.net',
      expect.objectContaining({
        text: 'CUSTOM_SPEED_NO_PENDING'
      }),
      {}
    );
  });

  test('mengirim prompt upload saat pesan bukan image/document', async () => {
    setResponseTemplate('speed_payment_upload_prompt', 'CUSTOM_SPEED_UPLOAD ${requestId} ${packageName} ${price}');

    global.speed_requests = [{
      id: 'REQ-1',
      userId: 1,
      status: 'pending',
      paymentMethod: 'cash',
      paymentStatus: 'unpaid',
      requestedPackageName: 'Boost 20 Mbps',
      durationKey: '1_hari',
      price: 5000
    }];

    await handleSpeedPaymentProof(createMsg({ conversation: 'teks biasa' }), { id: 1 });

    expect(mockSendPayload).toHaveBeenCalledWith(
      '62812@s.whatsapp.net',
      expect.objectContaining({
        text: 'CUSTOM_SPEED_UPLOAD REQ-1 Boost 20 Mbps Rp 5.000'
      }),
      {}
    );
  });

  test('mengirim konfirmasi bukti bayar dan notifikasi admin dari response template custom', async () => {
    setResponseTemplate('speed_payment_proof_received', 'CUSTOM_SPEED_RECEIVED ${requestId} ${packageName}');
    setResponseTemplate('speed_payment_admin_notification', 'CUSTOM_SPEED_ADMIN ${requestId} ${customerName} ${price}');
    setResponseTemplate('speed_payment_admin_media_caption', 'CUSTOM_SPEED_CAPTION ${customerName}');

    global.speed_requests = [{
      id: 'REQ-2',
      userId: 1,
      status: 'pending',
      paymentMethod: 'transfer',
      paymentStatus: 'unpaid',
      requestedPackageName: 'Boost 30 Mbps',
      durationKey: '1_hari',
      price: 7000
    }];

    await handleSpeedPaymentProof(createMsg({ imageMessage: {} }), {
      id: 1,
      name: 'Tester Speed',
      phone_number: '0812'
    });

    expect(mockSendPayload).toHaveBeenCalledWith(
      '62812@s.whatsapp.net',
      expect.objectContaining({ text: 'CUSTOM_SPEED_RECEIVED REQ-2 Boost 30 Mbps' }),
      {}
    );
    expect(mockSendText).toHaveBeenCalledWith(
      '628111111111@s.whatsapp.net',
      'CUSTOM_SPEED_ADMIN REQ-2 Tester Speed Rp 7.000',
      {}
    );
    expect(mockSendMedia).toHaveBeenCalledWith(
      '628111111111@s.whatsapp.net',
      expect.objectContaining({ caption: 'CUSTOM_SPEED_CAPTION Tester Speed' }),
      {}
    );
  });

  test('mendelegasikan status request ke speed-status-handler owner', async () => {
    global.speed_requests = [{
      id: 'REQ-1',
      userId: 1,
      status: 'active',
      requestedPackageName: 'Boost 20 Mbps',
      durationKey: '1_hari',
      price: 5000,
      createdAt: new Date().toISOString(),
      durationLabel: '1 Hari',
      paymentStatus: 'paid'
    }];

    const msg = createMsg();
    const user = { id: 1 };
    await handleSpeedRequestStatus(msg, user);

    expect(mockCheckSpeedBoostStatus).toHaveBeenCalledWith(msg, user, '62812@s.whatsapp.net', false);
    expect(mockSendText).not.toHaveBeenCalled();
  });
});
