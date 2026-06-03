/**
 * Header Doc
 * Purpose: Guardrail test untuk kontrak konteks bot standar yang dikonsumsi handler domain.
 * Caller: Jest test runner.
 * Deps: `../handlers/bot-context`.
 * MainFuncs: Memverifikasi field canonical sender, state sender, dan owner intent.
 * SideEffects: Tidak ada.
 */
"use strict";

const { buildBotContext } = require("../handlers/bot-context");

describe("bot context contract", () => {
    test("buildBotContext produces canonical contract fields", () => {
        const runtime = {
            id: "runtime-1",
            repositories: {
                users: { getAll: jest.fn(() => []) }
            },
            getConfig: jest.fn(() => ({ nama: "RAFNET" }))
        };
        const context = buildBotContext({
            raf: { sendMessage: jest.fn() },
            msg: { key: { remoteJid: "12345@lid" } },
            runtime,
            data: {
                sender: "12345@lid",
                canonicalSenderId: "628123456789@s.whatsapp.net",
                stateSender: "628123456789@s.whatsapp.net",
                intentOwner: "reporting"
            }
        });

        expect(context).toEqual(expect.objectContaining({
            sender: "12345@lid",
            canonicalSenderId: "628123456789@s.whatsapp.net",
            stateSender: "628123456789@s.whatsapp.net",
            intentOwner: "reporting",
            runtime,
            runtimeRepositories: runtime.repositories,
            runtimeConfig: { nama: "RAFNET" }
        }));
    });
});
