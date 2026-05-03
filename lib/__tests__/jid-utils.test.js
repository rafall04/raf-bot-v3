/**
 * Header Doc
 * Purpose: Unit test utilitas JID untuk resolusi canonical WhatsApp JID, LID mapping, dan konteks router.
 * Caller: Jest baseline dan regression suite untuk `lib/jid-utils.js`.
 * Deps: `lib/jid-utils.js`, mock `fs`, dan struktur `database/lid-mappings.json`.
 * MainFuncs: Memverifikasi `toCanonicalJid` dan `buildCanonicalContext`.
 * SideEffects: Mock akses file system agar test tidak menulis mapping nyata.
 */

const jidUtils = require('../jid-utils');
const fs = require('fs');
const path = require('path');

// Mock fs to avoid actual file operations
jest.mock('fs');

describe('JID Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock for loadMappings (via fs.existsSync and fs.readFileSync)
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mappings: {} }));
  });

  describe('toCanonicalJid', () => {
    test('berhasil resolve PN dari standard JID', async () => {
      const jid = '6281234567890@s.whatsapp.net';
      const result = await jidUtils.toCanonicalJid(jid);
      expect(result).toBe('6281234567890@s.whatsapp.net');
    });

    test('berhasil resolve PN dari LID via stored mapping', async () => {
      const lidJid = '12345@lid';
      const pnJid = '6281234567890@s.whatsapp.net';
      
      // Mock mappings to return a match
      fs.readFileSync.mockReturnValue(JSON.stringify({
        mappings: {
          '12345': pnJid
        }
      }));

      const result = await jidUtils.toCanonicalJid(lidJid);
      expect(result).toBe(pnJid);
    });

    test('berhasil resolve PN dari LID via metadata pesan', async () => {
      const lidJid = '12345@lid';
      const pnJid = '6281234567890@s.whatsapp.net';
      const msg = {
        key: {
          remoteJid: lidJid,
          remoteJidAlt: pnJid
        }
      };

      const result = await jidUtils.toCanonicalJid(lidJid, msg);
      expect(result).toBe(pnJid);
    });

    test('berhasil resolve PN dari LID via signalRepository', async () => {
      const lidJid = '12345@lid';
      const pnJid = '6281234567890@s.whatsapp.net';
      const raf = {
        signalRepository: {
          lidMapping: {
            getPNForLID: jest.fn().mockResolvedValue(pnJid)
          }
        }
      };

      const result = await jidUtils.toCanonicalJid(lidJid, null, raf);
      expect(result).toBe(pnJid);
      expect(raf.signalRepository.lidMapping.getPNForLID).toHaveBeenCalledWith(lidJid);
    });

    test('fallback null jika resolver gagal', async () => {
      const lidJid = 'unknown@lid';
      // Mock empty mappings
      fs.readFileSync.mockReturnValue(JSON.stringify({ mappings: {} }));

      const result = await jidUtils.toCanonicalJid(lidJid);
      expect(result).toBeNull();
    });
  });

  describe('buildCanonicalContext', () => {
    test('mapping state dengan benar untuk JID yang ter-resolve', async () => {
      const lidJid = '12345@lid';
      const pnJid = '6281234567890@s.whatsapp.net';
      const msg = {
        key: {
          remoteJid: lidJid,
          remoteJidAlt: pnJid
        }
      };

      const context = await jidUtils.buildCanonicalContext(lidJid, msg);
      
      expect(context).toEqual(expect.objectContaining({
        canonicalId: pnJid,
        phoneNumber: '6281234567890',
        isResolved: true,
        isLid: true,
        rawSender: lidJid
      }));
      expect(context.resolutionSource).toBe('message_metadata');
      expect(context.transportJid).toBe(pnJid);
    });

    test('mapping state dengan benar untuk JID yang gagal resolve', async () => {
      const lidJid = 'unknown@lid';
      
      const context = await jidUtils.buildCanonicalContext(lidJid);
      
      expect(context).toEqual(expect.objectContaining({
        canonicalId: null,
        phoneNumber: null,
        isResolved: false,
        isLid: true,
        rawSender: lidJid
      }));
      expect(context.resolutionSource).toBeNull();
      expect(context.transportJid).toBe(lidJid);
    });
    
    test('mapping state untuk standard JID', async () => {
      const jid = '6281234567890@s.whatsapp.net';
      const context = await jidUtils.buildCanonicalContext(jid);
      
      expect(context).toEqual(expect.objectContaining({
        canonicalId: jid,
        phoneNumber: '6281234567890',
        isResolved: true,
        isLid: false,
        rawSender: jid
      }));
      expect(context.resolutionSource).toBe('standard_jid');
      expect(context.transportJid).toBe(jid);
    });
  });
});
