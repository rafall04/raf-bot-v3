/**
 * Header Doc
 * Purpose: Source guardrail migrasi pesan WhatsApp hardcoded fase 1 ke responseTemplates.
 * Caller: Jest test runner.
 * Deps: fs, path, handler WiFi state, handler agent voucher, database/response_templates.json.
 * MainFuncs: readSource, responseTemplates.
 * SideEffects: Membaca file source dan JSON template tanpa menjalankan handler.
 */

const fs = require('fs');
const path = require('path');

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const responseTemplates = require('../../database/response_templates.json');

describe('WA hardcoded message migration phase 1', () => {
  test('response template keys tersedia untuk WiFi state dan agent voucher', () => {
    [
      'wifi_password_select_ssid_prompt',
      'wifi_password_confirm_all_ssid',
      'wifi_password_confirm_single_ssid',
      'wifi_password_enter_new_password',
      'wifi_password_change_success',
      'wifi_name_confirm_change',
      'wifi_name_change_success',
      'agent_voucher_agent_not_registered',
      'agent_voucher_agent_not_found',
      'agent_voucher_empty_stock',
      'agent_voucher_generic_error',
      'agent_voucher_purchase_prompt',
      'agent_voucher_sale_prompt',
      'agent_voucher_invalid_choice',
      'agent_voucher_cancelled',
      'agent_voucher_invalid_quantity_purchase',
      'agent_voucher_purchase_quantity_prompt',
      'agent_voucher_purchase_payment_prompt',
      'agent_voucher_invalid_payment_choice',
      'agent_voucher_purchase_failed',
      'agent_voucher_purchase_success_saldo',
      'agent_voucher_purchase_success_pending',
      'agent_voucher_purchase_process_error',
      'agent_voucher_sale_quantity_prompt',
      'agent_voucher_invalid_quantity_sale',
      'agent_voucher_insufficient_stock',
      'agent_voucher_sale_summary_confirm',
      'agent_voucher_customer_phone_prompt',
      'agent_voucher_invalid_phone',
      'agent_voucher_invalid_confirmation',
      'agent_voucher_sale_failed',
      'agent_voucher_customer_delivery_message',
      'agent_voucher_sale_success_agent',
      'agent_voucher_sale_process_error',
      'agent_voucher_inventory_empty',
      'agent_voucher_purchase_history_empty',
      'agent_voucher_sales_history_empty',
    ].forEach((key) => {
      expect(responseTemplates[key]).toEqual(expect.objectContaining({
        name: expect.any(String),
        template: expect.any(String),
      }));
    });
  });

  test('WiFi password state memakai template key fase 1', () => {
    const source = readSource('handlers/states/wifi-password-state-handler.js');

    [
      'wifi_password_select_ssid_prompt',
      'wifi_password_confirm_all_ssid',
      'wifi_password_confirm_single_ssid',
      'wifi_password_enter_new_password',
      'wifi_password_change_success',
    ].forEach((key) => {
      expect(source).toContain(`'${key}'`);
    });
  });

  test('WiFi name state memakai template key fase 1', () => {
    const source = readSource('handlers/states/wifi-name-state-handler.js');

    expect(source).toContain("'wifi_name_confirm_change'");
    expect(source).toContain("'wifi_name_change_success'");
  });

  test('agent voucher handler memakai helper template dan key fase 1', () => {
    const source = readSource('handlers/agent-voucher-handler.js');

    expect(source).toContain('function renderResponseTemplate(key, fallback, data = {})');
    [
      'agent_voucher_agent_not_registered',
      'agent_voucher_agent_not_found',
      'agent_voucher_empty_stock',
      'agent_voucher_generic_error',
      'agent_voucher_purchase_prompt',
      'agent_voucher_sale_prompt',
      'agent_voucher_invalid_choice',
      'agent_voucher_cancelled',
      'agent_voucher_invalid_quantity_purchase',
      'agent_voucher_purchase_quantity_prompt',
      'agent_voucher_purchase_payment_prompt',
      'agent_voucher_invalid_payment_choice',
      'agent_voucher_purchase_failed',
      'agent_voucher_purchase_success_saldo',
      'agent_voucher_purchase_success_pending',
      'agent_voucher_purchase_process_error',
      'agent_voucher_sale_quantity_prompt',
      'agent_voucher_invalid_quantity_sale',
      'agent_voucher_insufficient_stock',
      'agent_voucher_sale_summary_confirm',
      'agent_voucher_customer_phone_prompt',
      'agent_voucher_invalid_phone',
      'agent_voucher_invalid_confirmation',
      'agent_voucher_sale_failed',
      'agent_voucher_customer_delivery_message',
      'agent_voucher_sale_success_agent',
      'agent_voucher_sale_process_error',
      'agent_voucher_inventory_empty',
      'agent_voucher_purchase_history_empty',
      'agent_voucher_sales_history_empty',
    ].forEach((key) => {
      expect(source).toContain(`'${key}'`);
    });
  });
});
