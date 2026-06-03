const stateManager = require('../state-manager');

describe('State Manager', () => {
  beforeEach(() => {
    stateManager.clearAll();
  });

  describe('lock per-sender', () => {
    const sender = '6281234567890@s.whatsapp.net';

    test('isProcessing false untuk sender baru', () => {
      expect(stateManager.isProcessing(sender)).toBe(false);
    });

    test('setProcessing berhasil acquire lock', () => {
      const result = stateManager.setProcessing(sender);
      expect(result).toBe(true);
      expect(stateManager.isProcessing(sender)).toBe(true);
    });

    test('setProcessing gagal jika sudah di-lock', () => {
      stateManager.setProcessing(sender);
      const result = stateManager.setProcessing(sender);
      expect(result).toBe(false);
      expect(stateManager.isProcessing(sender)).toBe(true);
    });

    test('clearProcessing melepas lock', () => {
      stateManager.setProcessing(sender);
      expect(stateManager.isProcessing(sender)).toBe(true);
      
      stateManager.clearProcessing(sender);
      expect(stateManager.isProcessing(sender)).toBe(false);
    });

    test('lock auto-expire setelah timeout', (done) => {
      // Kita bisa mock Date.now() atau menggunakan timer palsu jest
      // Namun untuk unit test yang sederhana, kita coba gunakan jest fake timers jika memungkinkan
      // Atau kita manipulasi internal state jika bisa (tidak direkomendasikan jika blackbox)
      
      // Menggunakan jest fake timers
      jest.useFakeTimers();
      
      stateManager.setProcessing(sender);
      expect(stateManager.isProcessing(sender)).toBe(true);
      
      // Majukan waktu melewati LOCK_TIMEOUT
      jest.advanceTimersByTime(stateManager.LOCK_TIMEOUT + 1);
      
      expect(stateManager.isProcessing(sender)).toBe(false);
      
      jest.useRealTimers();
      done();
    });

    test('clearAll membersihkan semua lock', () => {
      stateManager.setProcessing('sender1');
      stateManager.setProcessing('sender2');
      
      expect(stateManager.getStats().totalLocks).toBe(2);
      
      stateManager.clearAll();
      expect(stateManager.getStats().totalLocks).toBe(0);
    });
  });
});
