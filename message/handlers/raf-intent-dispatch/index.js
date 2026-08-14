/**
 * Header Doc
 * Purpose: Registry skeleton map-based untuk modul intent dispatch yang diekstrak dari `raf-intent-dispatch.js`.
 * Caller: `message/handlers/raf-intent-dispatch.js` dan guardrail refactor internal dispatcher.
 * Deps: Sub-map intent per domain di folder yang sama.
 * MainFuncs: `INTENT_DISPATCH_MODULES`, `getIntentDispatchMap`.
 * SideEffects: Tidak ada; registry statis.
 */
"use strict";

const { CONVERSATION_INTENT_HANDLERS } = require('./conversation-intents');
const { MENU_INTENT_HANDLERS } = require('./menu-intents');
const { REPORTING_INTENT_HANDLERS } = require('./reporting-intents');
const { TICKET_CUSTOMER_INTENT_HANDLERS } = require('./ticket-customer-intents');
const { TICKET_TEKNISI_INTENT_HANDLERS } = require('./ticket-teknisi-intents');
const { STATUS_MIKROTIK_INTENT_HANDLERS } = require('./status-mikrotik-intents');
const { SALDO_INTENT_HANDLERS } = require('./saldo-intents');
const { AGENT_INTENT_HANDLERS } = require('./agent-intents');
const { WIFI_INTENT_HANDLERS } = require('./wifi-intents');
const { NETWORK_ADMIN_INTENT_HANDLERS } = require('./network-admin-intents');
const { CUSTOMER_SERVICE_INTENT_HANDLERS } = require('./customer-service-intents');
const { OWNER_ADMIN_INTENT_HANDLERS } = require('./owner-admin-intents');
const { VERIFICATION_INTENT_HANDLERS } = require('./verification-intents');
const { GAJI_TEKNISI_INTENT_HANDLERS } = require('./gaji-teknisi-intents');

const INTENT_DISPATCH_MODULES = Object.freeze({
    conversation: CONVERSATION_INTENT_HANDLERS,
    menu: MENU_INTENT_HANDLERS,
    reporting: REPORTING_INTENT_HANDLERS,
    ticketCustomer: TICKET_CUSTOMER_INTENT_HANDLERS,
    ticketTeknisi: TICKET_TEKNISI_INTENT_HANDLERS,
    statusMikrotik: STATUS_MIKROTIK_INTENT_HANDLERS,
    saldo: SALDO_INTENT_HANDLERS,
    agent: AGENT_INTENT_HANDLERS,
    wifi: WIFI_INTENT_HANDLERS,
    networkAdmin: NETWORK_ADMIN_INTENT_HANDLERS,
    customerService: CUSTOMER_SERVICE_INTENT_HANDLERS,
    ownerAdmin: OWNER_ADMIN_INTENT_HANDLERS,
    verification: VERIFICATION_INTENT_HANDLERS,
    gajiTeknisi: GAJI_TEKNISI_INTENT_HANDLERS
});

function getIntentDispatchMap() {
    return {
        ...INTENT_DISPATCH_MODULES.conversation,
        ...INTENT_DISPATCH_MODULES.menu,
        ...INTENT_DISPATCH_MODULES.reporting,
        ...INTENT_DISPATCH_MODULES.ticketCustomer,
        ...INTENT_DISPATCH_MODULES.ticketTeknisi,
        ...INTENT_DISPATCH_MODULES.statusMikrotik,
        ...INTENT_DISPATCH_MODULES.saldo,
        ...INTENT_DISPATCH_MODULES.agent,
        ...INTENT_DISPATCH_MODULES.wifi,
        ...INTENT_DISPATCH_MODULES.networkAdmin,
        ...INTENT_DISPATCH_MODULES.customerService,
        ...INTENT_DISPATCH_MODULES.ownerAdmin,
        ...INTENT_DISPATCH_MODULES.verification,
        // Terdaftar di INTENT_DISPATCH_MODULES sejak #b218 tapi TAK PERNAH di-spread ke sini,
        // sehingga `gaji saya` / `cek gaji` / `slip gaji` / `komisi saya` mencetak
        // "[INTENT_DEBUG] Final intent: GAJI_SAYA" lalu dispatchIntent tak menemukan handler
        // dan bot DIAM. Fiturnya tak pernah bisa dipakai teknisi.
        ...INTENT_DISPATCH_MODULES.gajiTeknisi
    };
}

module.exports = {
    INTENT_DISPATCH_MODULES,
    getIntentDispatchMap
};
