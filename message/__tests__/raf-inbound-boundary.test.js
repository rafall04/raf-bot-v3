/**
 * Header Doc
 * Purpose: Guardrail source test untuk memastikan router bot memakai inbound adapter owner, bukan parsing Baileys mentah.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, source `../raf.js`, dan `../handlers/raf-context.js`.
 * MainFuncs: Memverifikasi `message/raf.js` hanya mengonsumsi `extractMessageContext` dari boundary context/inbound.
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("raf inbound boundary", () => {
    test("router bot no longer loads Baileys helper directly for message parsing", () => {
        const rafSource = fs.readFileSync(path.join(__dirname, "..", "raf.js"), "utf8");
        const contextSource = fs.readFileSync(path.join(__dirname, "..", "handlers", "raf-context.js"), "utf8");

        expect(rafSource).toContain("extractMessageContext");
        expect(rafSource).not.toContain("loadBaileysModule");
        expect(contextSource).toContain("require(\"../../lib/whatsapp-inbound-adapter\")");
        expect(contextSource).toContain("return normalizeIncomingMessage(msg);");
        expect(contextSource).not.toContain("@whiskeysockets/baileys");
    });
});
