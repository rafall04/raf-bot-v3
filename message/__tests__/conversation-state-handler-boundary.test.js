/**
 * Header Doc
 * Purpose: Source guardrail untuk memastikan chain managed conversation state tidak lagi meneruskan parameter `temp` zombie.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source handler state yang dibersihkan.
 * MainFuncs: Memverifikasi `conversation-state-handler` dan sub-handler prioritas tidak mengandung signature/call-site `temp`.
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function read(relativeParts) {
    return fs.readFileSync(path.join(__dirname, "..", ...relativeParts), "utf8");
}

describe("conversation state handler boundary", () => {
    test("managed conversation state chain no longer passes temp", () => {
        const conversationStateSource = read(["handlers", "conversation-state-handler.js"]);
        const wifiNameSource = read(["handlers", "states", "wifi-name-state-handler.js"]);
        const wifiPasswordSource = read(["handlers", "states", "wifi-password-state-handler.js"]);
        const otherStateSource = read(["handlers", "states", "other-state-handler.js"]);

        expect(conversationStateSource).not.toContain("temp,");
        expect(wifiNameSource).not.toContain("temp,");
        expect(wifiPasswordSource).not.toContain("temp,");
        expect(otherStateSource).not.toContain("temp,");
    });
});
