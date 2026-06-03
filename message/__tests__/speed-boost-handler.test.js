/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan flow Speed Boost memakai delivery service WhatsApp tanpa mengubah pesan utama.
 * Caller: Jest test runner.
 * Deps: `../handlers/speed-boost-handler`, `../../lib/whatsapp-delivery-service`, dan helper matrix Speed Boost.
 * MainFuncs: `createMsg`, `setResponseTemplate`.
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

jest.mock('../../lib/database', () => ({
  ...jest.requireActual('../../lib/database'),
  saveSpeedRequests: jest.fn()
}));

jest.mock('../../lib/speed-boost-matrix-helper', () => ({
  getAvailableSpeedBoostsFromMatrix: jest.fn(),
  calculateBoostPriceFromMatrix: jest.fn(() => 5000),
  getAvailablePaymentMethods: jest.fn(() => [{ id: 'cash', label: 'Cash' }]),
  validateSpeedBoostRequest: jest.fn(() => ({ valid: true, errors: [] })),
  getMessageTemplate: jest.fn(),
  loadSpeedBoostConfig: jest.fn(() => ({
    enabled: true,
    globalSettings: { requirePaymentFirst: false }
  }))
}));

const {
  getAvailableSpeedBoostsFromMatrix,
  loadSpeedBoostConfig
} = require('../../lib/speed-boost-matrix-helper');

const {
  handleSpeedBoostRequest,
  handleSpeedBoostConversation
} = require('../handlers/speed-boost-handler');

function createMsg() {
  return {
    key: {
      remoteJid: '62812@s.whatsapp.net'
    }
  };
}

describe('speed-boost-handler', () => {
  beforeEach(() => {
    templateService.cache.responseTemplates = { ...originalResponseTemplates };
    mockSendText.mockReset();
    mockSendPayload.mockReset();
    global.tempStates = {};
    global.packages = [
      { name: 'Paket A', whitelist: false, profile: 'paket-a', price: 100000 },
      { name: 'Boost 20 Mbps', whitelist: false, profile: 'boost-20', price: 120000, matrixPrices: { '1_day': 5000 } }
    ];
    global.speed_requests = [];
    global.config = { ownerNumber: ['628111111111'] };
  });

  afterEach(() => {
    templateService.cache.responseTemplates = originalResponseTemplates;
  });

  test('mengirim pesan validasi gagal via adapter', async () => {
    loadSpeedBoostConfig.mockReturnValueOnce({
      enabled: false,
      globalSettings: { requirePaymentFirst: false }
    });

    await handleSpeedBoostRequest(createMsg(), { id: 1, subscription: 'Paket A', paid: false }, '62812@s.whatsapp.net');

    expect(mockSendText).toHaveBeenCalledWith(
      '62812@s.whatsapp.net',
      expect.stringContaining('Tidak Dapat Request Speed Boost'),
      {}
    );
  });

  test('mengirim prompt pilihan paket via adapter', async () => {
    setResponseTemplate('speed_boost_package_list', 'CUSTOM_PACKAGE_LIST ${currentPackage} ${packageOptions} ${maxOption}');
    setResponseTemplate('speed_boost_package_item', 'CUSTOM_PACKAGE_ITEM ${option} ${packageName} ${profile} ${durationOptions}');
    setResponseTemplate('speed_boost_package_duration_item', 'CUSTOM_PACKAGE_DURATION ${durationLabel} ${price}');

    getAvailableSpeedBoostsFromMatrix.mockReturnValueOnce([
      { name: 'Boost 20 Mbps', speed: '20 Mbps' }
    ]);

    await handleSpeedBoostRequest(createMsg(), { id: 1, subscription: 'Paket A', paid: true, pppoe_username: 'user-a' }, '62812@s.whatsapp.net');

    expect(mockSendText).toHaveBeenCalledWith(
      '62812@s.whatsapp.net',
      expect.stringContaining('CUSTOM_PACKAGE_LIST Paket A CUSTOM_PACKAGE_ITEM 1 Boost 20 Mbps 20 Mbps CUSTOM_PACKAGE_DURATION 1 Hari'),
      {}
    );
  });

  test('menu durasi, pembayaran, dan konfirmasi memakai template custom', async () => {
    setResponseTemplate('speed_boost_duration_list', 'CUSTOM_DURATION_LIST ${packageName} ${durationOptions} ${maxOption}');
    setResponseTemplate('speed_boost_duration_item', 'CUSTOM_DURATION_ITEM ${option} ${durationLabel} ${price}');
    setResponseTemplate('speed_boost_payment_method_list', 'CUSTOM_PAYMENT_LIST ${totalPrice} ${paymentOptions} ${maxOption}');
    setResponseTemplate('speed_boost_payment_method_item', 'CUSTOM_PAYMENT_ITEM ${option} ${icon} ${methodLabel} ${methodDescription}');
    setResponseTemplate('speed_boost_payment_method_cash_icon', 'CUSTOM_CASH_ICON');
    setResponseTemplate('speed_boost_payment_method_cash_description', 'CUSTOM_CASH_DESC');
    setResponseTemplate('speed_boost_confirmation', 'CUSTOM_CONFIRM ${customerName} ${targetPackage} ${paymentMethod} ${paymentNote}');
    setResponseTemplate('speed_boost_payment_label_cash', 'CUSTOM_CASH_LABEL');
    setResponseTemplate('speed_boost_confirmation_note_cash', 'CUSTOM_CASH_NOTE');

    global.tempStates['62812@s.whatsapp.net'] = {
      state: 'SPEED_BOOST_SELECT_PACKAGE',
      availablePackages: [{ name: 'Boost 20 Mbps', profile: 'boost-20', price: 120000, matrixPrices: { '1_day': 5000 } }],
      timestamp: Date.now()
    };

    await handleSpeedBoostConversation(
      createMsg(),
      { id: 1, name: 'Pelanggan A', subscription: 'Paket A' },
      '62812@s.whatsapp.net',
      '1'
    );

    expect(mockSendText).toHaveBeenLastCalledWith(
      '62812@s.whatsapp.net',
      expect.stringContaining('CUSTOM_DURATION_LIST Boost 20 Mbps CUSTOM_DURATION_ITEM 1 1 Hari'),
      {}
    );

    await handleSpeedBoostConversation(
      createMsg(),
      { id: 1, name: 'Pelanggan A', subscription: 'Paket A' },
      '62812@s.whatsapp.net',
      '1'
    );

    expect(mockSendText).toHaveBeenLastCalledWith(
      '62812@s.whatsapp.net',
      expect.stringContaining('CUSTOM_PAYMENT_LIST Rp. 5.000,00 CUSTOM_PAYMENT_ITEM 1 CUSTOM_CASH_ICON Cash CUSTOM_CASH_DESC'),
      {}
    );

    await handleSpeedBoostConversation(
      createMsg(),
      { id: 1, name: 'Pelanggan A', subscription: 'Paket A' },
      '62812@s.whatsapp.net',
      '1'
    );

    expect(mockSendText).toHaveBeenLastCalledWith(
      '62812@s.whatsapp.net',
      expect.stringContaining('CUSTOM_CONFIRM Pelanggan A Boost 20 Mbps CUSTOM_CASH_LABEL CUSTOM_CASH_NOTE'),
      {}
    );
  });

  test('konfirmasi sukses tetap mengirim notifikasi admin via adapter', async () => {
    setResponseTemplate('speed_boost_admin_new_request', 'CUSTOM_SPEED_ADMIN ${requestId} ${customerName} ${price}');
    setResponseTemplate('speed_boost_success_base', 'CUSTOM_SUCCESS_BASE ${requestId} ${packageName} ${price}');
    setResponseTemplate('speed_boost_success_cash_section', 'CUSTOM_SUCCESS_CASH');

    global.tempStates['62812@s.whatsapp.net'] = {
      state: 'SPEED_BOOST_CONFIRM',
      selectedPackage: { name: 'Boost 20 Mbps' },
      selectedDuration: { key: '1_day', label: '1 Hari', price: 5000 },
      paymentMethod: 'cash',
      timestamp: Date.now()
    };

    const handled = await handleSpeedBoostConversation(
      createMsg(),
      { id: 1, name: 'Pelanggan A', phone_number: '0812', subscription: 'Paket A', pppoe_username: 'user-a' },
      '62812@s.whatsapp.net',
      'ya'
    );

    expect(handled).toBe(true);
    expect(mockSendText).toHaveBeenCalledWith(
      '62812@s.whatsapp.net',
      expect.stringContaining('CUSTOM_SUCCESS_BASE'),
      {}
    );
    expect(mockSendText).toHaveBeenCalledWith(
      '62812@s.whatsapp.net',
      expect.stringContaining('CUSTOM_SUCCESS_CASH'),
      {}
    );
    expect(mockSendText).toHaveBeenCalledWith(
      '628111111111@s.whatsapp.net',
      expect.stringContaining('CUSTOM_SPEED_ADMIN'),
      {}
    );
  });

  test('state conversation memakai template custom untuk cancel dan invalid choice', async () => {
    setResponseTemplate('speed_boost_cancelled', 'CUSTOM_SPEED_CANCELLED');
    setResponseTemplate('speed_boost_invalid_choice', 'CUSTOM_SPEED_INVALID ${maxOption}');

    global.tempStates['62812@s.whatsapp.net'] = {
      state: 'SPEED_BOOST_SELECT_PACKAGE',
      availablePackages: [{ name: 'Boost 20 Mbps', profile: 'boost-20', price: 120000 }],
      timestamp: Date.now()
    };

    await handleSpeedBoostConversation(
      createMsg(),
      { id: 1, name: 'Pelanggan A', subscription: 'Paket A' },
      '62812@s.whatsapp.net',
      '9'
    );

    expect(mockSendText).toHaveBeenCalledWith(
      '62812@s.whatsapp.net',
      'CUSTOM_SPEED_INVALID 1',
      {}
    );

    await handleSpeedBoostConversation(
      createMsg(),
      { id: 1, name: 'Pelanggan A', subscription: 'Paket A' },
      '62812@s.whatsapp.net',
      'batal'
    );

    expect(mockSendText).toHaveBeenCalledWith(
      '62812@s.whatsapp.net',
      'CUSTOM_SPEED_CANCELLED',
      {}
    );
  });
});
