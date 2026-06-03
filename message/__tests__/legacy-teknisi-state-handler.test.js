/**
 * Purpose: Guardrail test untuk ekstraksi state teknisi legacy dari raf router.
 * Caller: Jest test runner.
 * Deps: ../handlers/legacy-teknisi-state-handler.
 * MainFuncs: createContext.
 * SideEffects: Tidak ada.
 */

const { handleLegacyTeknisiStateTransitions } = require('../handlers/legacy-teknisi-state-handler');

function createContext(step) {
  return {
    chats: 'ya',
    teknisiState: {
      step,
      uploadedPhotos: [],
      photoCategories: { problem: true, speedtest: true, result: true },
    },
    stateSender: '62812@s.whatsapp.net',
    setUserState: jest.fn(),
    deleteUserState: jest.fn(),
    reply: jest.fn(),
    format: jest.fn((key) => key),
    handleCompleteTicket: jest.fn(async () => ({ handled: true, message: 'selesai' })),
    saveTeknisiState: jest.fn(),
    handleTeknisiResolutionNotesState: jest.fn(async () => ({ handled: true, message: 'catatan' })),
    handleTeknisiCompletionConfirmationState: jest.fn(async () => ({ handled: true, message: 'konfirmasi' })),
  };
}

describe('handleLegacyTeknisiStateTransitions', () => {
  test('menangani state AWAITING_PHOTO_EXTRA_CONFIRM', async () => {
    const context = createContext('AWAITING_PHOTO_EXTRA_CONFIRM');

    const result = await handleLegacyTeknisiStateTransitions(context);

    expect(result.handled).toBe(true);
  });

  test('mendelegasikan AWAITING_RESOLUTION_NOTES ke handler resolusi', async () => {
    const context = createContext('AWAITING_RESOLUTION_NOTES');

    const result = await handleLegacyTeknisiStateTransitions(context);

    expect(result).toEqual({ handled: true, message: 'catatan' });
    expect(context.handleTeknisiResolutionNotesState).toHaveBeenCalledWith(context.stateSender, context.chats);
  });

  test('mendelegasikan AWAITING_CONFIRMATION ke handler konfirmasi', async () => {
    const context = createContext('AWAITING_CONFIRMATION');
    context.handleTeknisiResolutionNotesState.mockResolvedValue({ handled: false });

    const result = await handleLegacyTeknisiStateTransitions(context);

    expect(result).toEqual({ handled: true, message: 'konfirmasi' });
    expect(context.handleTeknisiCompletionConfirmationState).toHaveBeenCalledWith(context.stateSender, context.chats);
  });

  test('tetap mendahulukan handler resolusi jika masih menangani AWAITING_CONFIRMATION', async () => {
    const context = createContext('AWAITING_CONFIRMATION');

    const result = await handleLegacyTeknisiStateTransitions(context);

    expect(result).toEqual({ handled: true, message: 'catatan' });
    expect(context.handleTeknisiCompletionConfirmationState).not.toHaveBeenCalled();
  });

  test('memindahkan AWAITING_PHOTO_CATEGORY_3 ke AWAITING_PHOTO_EXTRA_CONFIRM saat skip', async () => {
    const context = createContext('AWAITING_PHOTO_CATEGORY_3');
    context.chats = 'skip';

    const result = await handleLegacyTeknisiStateTransitions(context);

    expect(result.handled).toBe(true);
    expect(context.setUserState).toHaveBeenCalledWith(context.stateSender, expect.objectContaining({
      step: 'AWAITING_PHOTO_EXTRA_CONFIRM',
      currentPhotoCategory: 'extra'
    }));
  });

  test('menyelesaikan dokumentasi saat extra confirm dijawab tidak', async () => {
    const context = createContext('AWAITING_PHOTO_EXTRA_CONFIRM');
    context.chats = 'tidak';
    context.handleTeknisiResolutionNotesState.mockResolvedValue({ handled: false });

    const result = await handleLegacyTeknisiStateTransitions(context);

    expect(result.handled).toBe(true);
    expect(result.message).toContain('STEP TERAKHIR');
    expect(context.teknisiState.step).toBe('AWAITING_COMPLETION_CONFIRMATION');
  });
});
