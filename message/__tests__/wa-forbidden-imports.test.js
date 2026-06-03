/**
 * Header Doc
 * Purpose: Static guardrail untuk melarang detail Baileys/socket mentah bocor ke router dan handler aktif.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source file WA aktif.
 * MainFuncs: Memverifikasi tidak ada import Baileys, `global.raf`, atau `.sendMessage(` mentah di router/handler aktif.
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function readSource(...parts) {
    return fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
}

describe("wa forbidden imports", () => {
    test("active router and handler boundaries avoid direct Baileys/socket usage", () => {
        const sources = [
            readSource("raf.js"),
            readSource("handlers", "raf-context.js"),
            readSource("handlers", "topup-handler.js"),
            readSource("handlers", "speed-payment-handler.js"),
            readSource("handlers", "reply-runtime.js")
        ];

        sources.forEach((source) => {
            expect(source).not.toContain("@whiskeysockets/baileys");
            expect(source).not.toContain("global.raf");
        });

        expect(readSource("raf.js")).not.toContain(".sendMessage(");
        expect(readSource("handlers", "topup-handler.js")).not.toContain(".sendMessage(");
        expect(readSource("handlers", "speed-payment-handler.js")).not.toContain(".sendMessage(");
    });
});
