const jidUtils = require('../jid-utils');
const fs = require('fs');

jest.mock('fs');

describe('JID Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.users = [];
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mappings: {} }));
    fs.writeFileSync.mockImplementation(() => {});
  });

  afterEach(() => {
    delete global.users;
  });

  describe('resolveCanonicalCustomerContext', () => {
    test('resolves standard jid directly', async () => {
      const result = await jidUtils.resolveCanonicalCustomerContext({
        sender: '6281234567890@s.whatsapp.net',
        users: []
      });

      expect(result).toEqual(expect.objectContaining({
        canonicalJid: '6281234567890@s.whatsapp.net',
        phoneNumber: '6281234567890',
        resolutionSource: 'standard_jid',
        resolved: true
      }));
    });

    test('resolves lid from message metadata', async () => {
      const result = await jidUtils.resolveCanonicalCustomerContext({
        sender: '12345@lid',
        msg: {
          key: {
            remoteJid: '12345@lid',
            remoteJidAlt: '6281234567890@s.whatsapp.net'
          }
        },
        users: []
      });

      expect(result).toEqual(expect.objectContaining({
        canonicalJid: '6281234567890@s.whatsapp.net',
        phoneNumber: '6281234567890',
        resolutionSource: 'message_metadata',
        resolved: true
      }));
    });

    test('resolves lid from signal repository', async () => {
      const raf = {
        signalRepository: {
          lidMapping: {
            getPNForLID: jest.fn().mockResolvedValue('6281234567890@s.whatsapp.net')
          }
        }
      };

      const result = await jidUtils.resolveCanonicalCustomerContext({
        sender: '12345@lid',
        raf,
        users: []
      });

      expect(result.canonicalJid).toBe('6281234567890@s.whatsapp.net');
      expect(result.resolutionSource).toBe('signal_repository');
    });

    test('resolves legacy numeric mapping through users table', async () => {
      fs.readFileSync.mockReturnValue(JSON.stringify({
        mappings: {
          '12345': 7
        }
      }));
      const users = [{
        id: 7,
        phone_number: '081234567890',
        name: 'Test User'
      }];

      const result = await jidUtils.resolveCanonicalCustomerContext({
        sender: '12345@lid',
        users
      });

      expect(result.canonicalJid).toBe('6281234567890@s.whatsapp.net');
      expect(result.resolutionSource).toBe('stored_mapping');
    });

    test('resolves lid via user.lid field', async () => {
      const users = [{
        id: 1,
        lid: '12345@lid',
        phone_number: '081234567890'
      }];

      const result = await jidUtils.resolveCanonicalCustomerContext({
        sender: '12345@lid',
        users
      });

      expect(result.canonicalJid).toBe('6281234567890@s.whatsapp.net');
      expect(result.resolutionSource).toBe('user_lid_field');
      expect(result.user).toBe(users[0]);
    });

    test('returns unresolved when lid cannot be mapped', async () => {
      const result = await jidUtils.resolveCanonicalCustomerContext({
        sender: 'unknown@lid',
        users: []
      });

      expect(result).toEqual(expect.objectContaining({
        canonicalJid: null,
        phoneNumber: null,
        resolved: false
      }));
    });

    test('does NOT treat the LID id as a phone number (no poisoning)', async () => {
      const users = [
        { id: 7, name: 'Real Customer', phone_number: '6289990001111' }
      ];

      const result = await jidUtils.resolveCanonicalCustomerContext({
        sender: '207477927845454@lid',
        // id LID bocor sebagai plainSenderNumber (kasus saat resolusi pusat gagal)
        plainSenderNumber: '207477927845454',
        users
      });

      // Tidak boleh mengarang nomor "62207477927845454"
      expect(result.resolved).toBe(false);
      expect(result.canonicalJid).toBeNull();
      expect(result.phoneNumber).toBeNull();
      expect(result.user).toBeNull();
      // Tidak boleh menulis mapping palsu ke lid-mappings.json
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('compatibility wrappers', () => {
    test('toCanonicalJid uses canonical resolver', async () => {
      const result = await jidUtils.toCanonicalJid('6281234567890@s.whatsapp.net');
      expect(result).toBe('6281234567890@s.whatsapp.net');
    });

    test('buildCanonicalContext exposes enriched fields', async () => {
      const context = await jidUtils.buildCanonicalContext('12345@lid', {
        key: {
          remoteJid: '12345@lid',
          remoteJidAlt: '6281234567890@s.whatsapp.net'
        }
      });

      expect(context).toEqual(expect.objectContaining({
        canonicalId: '6281234567890@s.whatsapp.net',
        phoneNumber: '6281234567890',
        isResolved: true,
        isLid: true,
        resolutionSource: 'message_metadata'
      }));
    });
  });
});
