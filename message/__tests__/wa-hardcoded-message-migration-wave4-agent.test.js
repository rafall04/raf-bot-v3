/**
 * Header Doc
 * Purpose: Source guardrail Wave 4 migrasi pesan WhatsApp hardcoded agent self-service ke responseTemplates.
 * Caller: Jest test runner.
 * Deps: fs, path, message/handlers/agent.js, database/response_templates.json.
 * MainFuncs: readSource, expectKeys.
 * SideEffects: Membaca source dan JSON template tanpa menjalankan handler.
 */

const fs = require('fs');
const path = require('path');

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function expectKeys(source, keys) {
  keys.forEach((key) => expect(source).toContain(`'${key}'`));
}

const responseTemplates = require('../../database/response_templates.json');

const agentWave4Keys = [
  'agent_transaction_confirm_format',
  'agent_transaction_not_found',
  'agent_transaction_status_not_pending',
  'agent_transaction_pin_invalid',
  'agent_transaction_saldo_failed',
  'agent_transaction_confirm_error',
  'agent_transaction_not_registered',
  'agent_transaction_today_empty',
  'agent_transaction_today_error',
  'agent_topup_status_empty',
  'agent_topup_status_error',
  'agent_pin_not_registered',
  'agent_pin_format',
  'agent_pin_digits_only',
  'agent_pin_length',
  'agent_pin_same',
  'agent_pin_success',
  'agent_pin_failed',
  'agent_pin_error',
  'agent_profile_not_registered',
  'agent_profile_data_missing',
  'agent_profile_address_format',
  'agent_profile_hours_format',
  'agent_profile_phone_format',
  'agent_profile_invalid_type',
  'agent_profile_address_success',
  'agent_profile_hours_success',
  'agent_profile_phone_success',
  'agent_profile_update_failed',
  'agent_profile_update_error',
  'agent_status_open_success',
  'agent_status_close_success',
  'agent_status_update_failed',
  'agent_status_update_error',
  'agent_self_not_registered',
  'agent_self_profile_error',
];

describe('WA hardcoded message migration wave 4 agent self-service', () => {
  test('response template keys tersedia', () => {
    agentWave4Keys.forEach((key) => {
      expect(responseTemplates[key]).toEqual(expect.objectContaining({
        name: expect.any(String),
        template: expect.any(String),
      }));
    });
  });

  test('agent handler memakai key wave 4', () => {
    const source = readSource('handlers/agent.js');
    expect(source).toContain('function renderResponseTemplate(key, fallback, data = {})');
    expectKeys(source, agentWave4Keys);
  });
});
