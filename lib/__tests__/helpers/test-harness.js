/**
 * Test Harness Utility untuk Bot WA Master
 * Digunakan untuk mempermudah pembuatan mock data dan state dalam pengujian.
 */

"use strict";

/**
 * Membuat mock message payload untuk Baileys messages.upsert
 * @param {Object} options Konfigurasi mock message
 * @param {string} options.sender JID pengirim (bisa LID atau PN)
 * @param {string} options.text Isi pesan teks
 * @param {string} [options.pushname='Test User'] Nama pengirim
 * @param {boolean} [options.isGroup=false] Apakah pesan grup
 * @returns {Object} Mock Baileys message upsert payload
 */
function createMockMessage({ sender, text, pushname = 'Test User', isGroup = false }) {
  const remoteJid = isGroup ? '123456@g.us' : sender;
  const participant = isGroup ? sender : undefined;

  return {
    messages: [
      {
        key: {
          remoteJid,
          fromMe: false,
          id: 'ABC123456789',
          participant
        },
        message: {
          conversation: text
        },
        pushName: pushname,
        messageTimestamp: Math.floor(Date.now() / 1000)
      }
    ],
    type: 'notify'
  };
}

/**
 * Membuat mock Baileys socket (raf)
 * @param {Object} options Konfigurasi mock raf
 * @param {Object} [options.lidMapping={}] Mapping LID ke PN
 * @returns {Object} Mock raf socket
 */
function createMockRaf({ lidMapping = {} } = {}) {
  return {
    sendMessage: jest.fn().mockResolvedValue({ key: { id: 'MSG_ID' } }),
    signalRepository: {
      lidMapping: {
        getPNForLID: jest.fn().mockImplementation((lid) => lidMapping[lid] || null)
      }
    }
  };
}

/**
 * Inisialisasi atau reset global state untuk keperluan testing
 * Membersihkan global.users, global.teknisiStates, dan config
 */
function setupMockGlobalState() {
  global.users = {};
  global.teknisiStates = {};
  global.temp = {}; // Menangani state percakapan lama jika masih ada
  global.config = {
    ownerNumber: ['628111111111'],
    site_url_bot: 'http://test-bot.com',
    botName: 'Antigravity Bot'
  };
  global.whatsappConnectionState = 'open';
}

/**
 * Membersihkan global state setelah testing
 */
function resetMockGlobalState() {
  delete global.users;
  delete global.teknisiStates;
  delete global.temp;
  delete global.config;
  delete global.whatsappConnectionState;
  delete global.raf;
}

module.exports = {
  createMockMessage,
  createMockRaf,
  setupMockGlobalState,
  resetMockGlobalState
};
