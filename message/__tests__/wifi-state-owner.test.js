/**
 * Header Doc
 * Purpose: Source guardrail untuk memastikan managed WiFi state di-own oleh domain WiFi.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, source `../handlers/state-domains/wifi.state.js`.
 * MainFuncs: Memverifikasi daftar step WiFi terkunci di owner domain WiFi.
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("wifi state owner", () => {
    test("wifi managed state steps are centralized in wifi state domain", () => {
        const wifiSource = fs.readFileSync(path.join(__dirname, "..", "handlers", "state-domains", "wifi.state.js"), "utf8");

        expect(wifiSource).toContain("managedConversationSteps");
        expect(wifiSource).toContain('"ASK_NEW_PASSWORD"');
    });
});
