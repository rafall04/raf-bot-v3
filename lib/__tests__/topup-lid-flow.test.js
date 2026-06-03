"use strict";

const { handleSaldoSteps } = require('../../message/handlers/steps/saldo-steps');
const saldoManager = require('../../lib/saldo-manager');
const jidUtils = require('../../lib/jid-utils');

// Mock saldoManager
jest.mock('../../lib/saldo-manager', () => ({
  createTopupRequest: jest.fn()
}));

// Mock jidUtils to control LID resolution
jest.mock('../../lib/jid-utils', () => {
  const actual = jest.requireActual('../../lib/jid-utils');
  return {
    ...actual,
    toCanonicalJid: jest.fn()
  };
});

describe('Topup LID Flow Integration Test', () => {
  let mockReply;
  let mockSetUserState;
  let mockDeleteUserState;
  let mockRaf;

  const LID_SENDER = '12345@lid';
  const CANONICAL_PN = '628123456789';
  const CANONICAL_JID = `${CANONICAL_PN}@s.whatsapp.net`;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReply = jest.fn().mockResolvedValue(true);
    mockSetUserState = jest.fn();
    mockDeleteUserState = jest.fn();
    
    // Setup global.config for admin recipient lookup
    global.config = {
      ownerNumber: ['628111111111'],
      site_url_bot: 'http://test-bot.com'
    };

    // Setup mockRaf with lidMapping
    mockRaf = {
      signalRepository: {
        lidMapping: {
          getPNForLID: jest.fn()
        }
      }
    };

    // Default mock for toCanonicalJid
    jidUtils.toCanonicalJid.mockImplementation(async (jid) => {
      if (jid === LID_SENDER) return CANONICAL_JID;
      return jid;
    });

    // Mock createTopupRequest to return a dummy request object
    saldoManager.createTopupRequest.mockReturnValue({
      id: 'TOP-12345',
      agentTransactionId: null
    });
  });

  test('TODO-7.2: Topup init from @lid -> state key canonical -> createTopupRequest called with canonical JID', async () => {
    // 1. User starts topup flow (handled in raf.js usually, but we test the steps here)
    // We simulate the flow through handleSaldoSteps
    
    // Step 1: TOPUP_SELECT_METHOD
    const state1 = {
      step: 'TOPUP_SELECT_METHOD',
      type: 'topup',
      paymentSender: CANONICAL_JID // Phase 5 requirement: paymentSender is already canonicalId
    };

    const result1 = await handleSaldoSteps({
      userState: state1,
      sender: LID_SENDER,
      chats: '1', // Select transfer
      pushname: 'Test User',
      reply: mockReply,
      setUserState: mockSetUserState,
      deleteUserState: mockDeleteUserState
    });

    expect(result1.success).toBe(true);
    expect(mockSetUserState).toHaveBeenCalledWith(LID_SENDER, expect.objectContaining({
      step: 'TOPUP_INPUT_AMOUNT',
      paymentMethod: 'transfer'
    }));

    // Step 2: TOPUP_INPUT_AMOUNT
    const state2 = {
      ...state1,
      step: 'TOPUP_INPUT_AMOUNT',
      paymentMethod: 'transfer'
    };

    const result2 = await handleSaldoSteps({
      userState: state2,
      sender: LID_SENDER,
      chats: '50000',
      pushname: 'Test User',
      reply: mockReply,
      setUserState: mockSetUserState,
      deleteUserState: mockDeleteUserState
    });

    expect(result2.success).toBe(true);
    expect(mockSetUserState).toHaveBeenCalledWith(LID_SENDER, expect.objectContaining({
      step: 'TOPUP_CONFIRM',
      amount: 50000
    }));

    // Step 3: TOPUP_CONFIRM
    const state3 = {
      ...state2,
      step: 'TOPUP_CONFIRM',
      amount: 50000
    };

    const result3 = await handleSaldoSteps({
      userState: state3,
      sender: LID_SENDER,
      chats: 'ya',
      pushname: 'Test User',
      reply: mockReply,
      setUserState: mockSetUserState,
      deleteUserState: mockDeleteUserState
    });

    expect(result3.success).toBe(true);
    
    // VERIFICATION: createTopupRequest MUST be called with CANONICAL_JID, not LID_SENDER
    expect(saldoManager.createTopupRequest).toHaveBeenCalledWith(
      CANONICAL_JID, // This is the crucial check
      50000,
      'transfer',
      null,
      'Test User'
    );
    
    // Verification: deleteUserState called with LID_SENDER
    expect(mockDeleteUserState).toHaveBeenCalledWith(LID_SENDER);
  });
});
