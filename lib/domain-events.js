/**
 * Header Doc
 * Purpose: Menyediakan bridge event internal agar domain dapat memicu notifikasi tanpa mengikat langsung ke transport WhatsApp.
 * Caller: Route/controller/service yang mulai didecouple dari pengiriman WA sinkron.
 * Deps: `events`.
 * MainFuncs: `DOMAIN_EVENTS`, `emitAsync`, `onAsync`, dan `domainEvents`.
 * SideEffects: Menjalankan listener terdaftar untuk event domain internal.
 */
"use strict";

const { EventEmitter } = require("events");

const domainEvents = new EventEmitter({ captureRejections: true });

const DOMAIN_EVENTS = {
    PACKAGE_CHANGE_APPROVED: "package.change.approved",
    DISCOUNT_APPLIED: "discount.applied",
    PARTIAL_PAYMENT_REQUESTED: "payment.partial.requested",
    TICKET_CUSTOMER_UPDATE_REQUESTED: "ticket.customer.update.requested"
};

async function emitAsync(eventName, payload) {
    const listeners = domainEvents.listeners(eventName);
    if (!listeners.length) {
        return [];
    }

    const results = [];
    for (const listener of listeners) {
        results.push(await listener(payload));
    }
    return results;
}

function onAsync(eventName, listener) {
    domainEvents.on(eventName, listener);
    return () => domainEvents.off(eventName, listener);
}

domainEvents.on("error", (error) => {
    console.error("[DOMAIN_EVENTS_ERROR]", error);
});

module.exports = {
    DOMAIN_EVENTS,
    domainEvents,
    emitAsync,
    onAsync
};
