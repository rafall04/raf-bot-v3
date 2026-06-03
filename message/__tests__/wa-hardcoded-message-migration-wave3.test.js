/**
 * Header Doc
 * Purpose: Source guardrail Wave 3 migrasi pesan WhatsApp hardcoded ke responseTemplates.
 * Caller: Jest test runner.
 * Deps: fs, path, handler dispatcher/agent/monitoring, database/response_templates.json.
 * MainFuncs: readSource, expectKeys.
 * SideEffects: Membaca source dan JSON template tanpa menjalankan handler.
 */

const fs = require('fs');
const path = require('path');

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function readRafIntentDispatcherSources() {
  const baseDir = path.join(__dirname, '..', 'handlers');
  const splitDir = path.join(baseDir, 'raf-intent-dispatch');
  const splitSources = fs.readdirSync(splitDir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => fs.readFileSync(path.join(splitDir, file), 'utf8'));

  return [
    fs.readFileSync(path.join(baseDir, 'raf-intent-dispatch.js'), 'utf8'),
    ...splitSources,
  ].join('\n');
}

function expectKeys(source, keys) {
  keys.forEach((key) => expect(source).toContain(`'${key}'`));
}

const responseTemplates = require('../../database/response_templates.json');

const rafKeys = [
  'raf_dispatch_qa_unavailable',
  'raf_dispatch_cancel_customer_only',
  'raf_dispatch_cancel_no_active_report',
  'raf_dispatch_cancel_not_found',
  'raf_dispatch_cancel_not_owned',
  'raf_dispatch_cancel_already_cancelled',
  'raf_dispatch_cancel_already_done',
  'raf_dispatch_cancel_in_progress',
  'raf_dispatch_cancel_confirm',
  'raf_dispatch_cancel_status_unsupported',
  'raf_dispatch_confirm_agent_format',
  'raf_dispatch_confirm_ticket_format',
];

const agentKeys = [
  'agent_general_empty',
  'agent_general_fetch_error',
  'agent_general_area_empty',
  'agent_general_area_not_found',
  'agent_general_services_error',
  'agent_general_search_empty',
  'agent_general_search_not_found',
  'agent_general_search_error',
  'agent_general_detail_not_found',
  'agent_general_detail_error',
];

const monitoringKeys = [
  'monitoring_ppp_loading',
  'monitoring_ppp_error',
  'monitoring_hotspot_loading',
  'monitoring_hotspot_error',
  'monitoring_statusap_wrapper',
  'monitoring_statusap_error',
  'monitoring_wifi_placeholder',
];

describe('WA hardcoded message migration wave 3', () => {
  test('response template keys tersedia', () => {
    [...rafKeys, ...agentKeys, ...monitoringKeys].forEach((key) => {
      expect(responseTemplates[key]).toEqual(expect.objectContaining({
        name: expect.any(String),
        template: expect.any(String),
      }));
    });
  });

  test('raf intent dispatcher memakai key wave 3', () => {
    expectKeys(readRafIntentDispatcherSources(), rafKeys);
  });

  test('agent handler memakai key wave 3', () => {
    const source = readSource('handlers/agent.js');
    expect(source).toContain('function renderResponseTemplate(key, fallback, data = {})');
    expectKeys(source, agentKeys);
  });

  test('monitoring handler memakai key wave 3', () => {
    const source = readSource('handlers/monitoring-handler.js');
    expect(source).toContain("const { renderResponseTemplate } = require('./template-helpers');");
    expectKeys(source, monitoringKeys);
  });
});
