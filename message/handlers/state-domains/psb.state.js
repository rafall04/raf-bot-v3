/**
 * Header Doc
 * Purpose: State domain wizard PSB via DM teknisi (per-bot area) — FACADE setelah split #b396.
 *          Implementasi pindah utuh ke `psb/{shared,intake,slot-filling,confirm}`:
 *          shared.js = konstanta step + helper teks/draft/media bersama (singleton),
 *          intake.state.js = trigger & startPsbSession + resume, confirm.state.js = deteksi modem,
 *          penegasan, provisioning; slot-filling.state.js = dispatcher per-step + timeout/cancel.
 * Caller: `message/handlers/conversation-state-router.js` (owner "psb") + trigger `startPsbSession`
 *         dari `message/raf.js` (jalur DM teknisi). Ekspor & nama identik file asli.
 * Deps: re-export dari submodul; registrasi timeout/cancel tetap di file ini (perilaku load identik).
 * MainFuncs: `startPsbSession`, `handlePsbConversationState`, `handlePsbStateTimeout`,
 *            `handlePsbStateCancel`, `hasPsbDraft`, parser/format SN & PPPoE.
 * SideEffects: registrasi handler timeout/cancel saat modul dimuat (seperti aslinya).
 */
"use strict";

const shared = require("./psb/shared");
const intake = require("./psb/intake.state");
const slotFilling = require("./psb/slot-filling.state");
const confirm = require("./psb/confirm.state");

module.exports = {
    handlePsbConversationState: slotFilling.handlePsbConversationState,
    handlePsbStateTimeout: slotFilling.handlePsbStateTimeout,
    hasPsbDraft: shared.hasPsbDraft,
    startPsbSession: intake.startPsbSession,
    parsePsbScheduleRef: intake.parsePsbScheduleRef,
    buildPppoeUsername: shared.buildPppoeUsername,
    stickerSn: shared.stickerSn,
    snText: shared.snText,
    looksLikeSnInput: confirm.looksLikeSnInput,
    isPsbTutorialTrigger: intake.isPsbTutorialTrigger,
    isPsbBareCommand: intake.isPsbBareCommand,
    handlePsbStateCancel: slotFilling.handlePsbStateCancel,
    psbTutorialText: intake.psbTutorialText,
    PSB_STEPS: shared.PSB_STEPS,
    RESUMABLE_STEPS: shared.RESUMABLE_STEPS,
    STEP_COLLECT: shared.STEP_COLLECT,
    STEP_CONFIRM: shared.STEP_CONFIRM,
    STEP_PICK: shared.STEP_PICK,
    STEP_RESUME: shared.STEP_RESUME
};
