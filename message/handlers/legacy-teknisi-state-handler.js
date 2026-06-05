/**
 * Header Doc
 * Purpose: Menangani transisi state teknisi legacy yang sebelumnya tertanam langsung di `message/raf.js`.
 * Caller: `message/raf.js`.
 * Deps: State teknisi aktif, helper state manager, formatter pesan, dan handler workflow teknisi existing.
 * MainFuncs: `handleLegacyTeknisiStateTransitions`.
 * SideEffects: Memperbarui state teknisi dan mengirim reply melalui callback yang diberikan caller.
 */
"use strict";

async function handleLegacyTeknisiStateTransitions(context) {
    const {
        teknisiState,
        chats,
        stateSender,
        setUserState,
        deleteUserState,
        reply,
        format,
        handleCompleteTicket,
        handleTeknisiResolutionNotesState,
        handleTeknisiCompletionConfirmationState
    } = context;

    if (!teknisiState) {
        return { handled: false };
    }

    if (
        teknisiState.step === "AWAITING_PHOTO_CATEGORY_3" &&
        (chats.toLowerCase().trim() === "skip" || chats.toLowerCase().trim() === "lewati")
    ) {
        setUserState(stateSender, {
            ...teknisiState,
            step: "AWAITING_PHOTO_EXTRA_CONFIRM",
            currentPhotoCategory: "extra"
        });

        return {
            handled: true,
            message: `⚪ *FOTO HASIL DI-SKIP*

━━━━━━━━━━━━━━━━
📊 *STATUS DOKUMENTASI:*
━━━━━━━━━━━━━━━━

✅ 1. Foto penyebab masalah ✓
✅ 2. Screenshot speedtest ✓
⚪ 3. Foto hasil (di-skip)

━━━━━━━━━━━━━━━━
📎 *FOTO TAMBAHAN?*
━━━━━━━━━━━━━━━━

📸 Ingin tambah foto pendukung lainnya?
• Foto dari sudut berbeda
• Foto detail tertentu

Ketik:
• *YA* - untuk upload foto tambahan
• *TIDAK* - untuk selesaikan tiket

➡️ *Pilihan Anda...*`
        };
    }

    if (teknisiState.step === "AWAITING_PHOTO_EXTRA_CONFIRM") {
        const response = chats.toLowerCase().trim();
        if (response === "ya" || response === "yes") {
            teknisiState.step = "AWAITING_PHOTO_EXTRA";
            teknisiState.currentPhotoCategory = "extra";
            return {
                handled: true,
                message: `✅ *SIAP TERIMA FOTO TAMBAHAN*

━━━━━━━━━━━━━━━━
📎 *UPLOAD FOTO TAMBAHAN*
━━━━━━━━━━━━━━━━

📸 Kirim foto tambahan:
• Foto sudut berbeda
• Foto detail tertentu
• Dokumentasi lain yang relevan

💡 *Batas:*
• Maksimal ${5 - teknisiState.uploadedPhotos.length} foto lagi
• Setelah selesai ketik *DONE*

➡️ *Kirim foto sekarang...*`
            };
        }
        if (response === "tidak" || response === "no") {
            teknisiState.step = "AWAITING_COMPLETION_CONFIRMATION";
            const problemFilled = teknisiState.photoCategories.problem ? "✅" : "⚪";
            const speedtestFilled = teknisiState.photoCategories.speedtest ? "✅" : "⚪";
            const resultFilled = teknisiState.photoCategories.result ? "✅" : "⚪";
            return {
                handled: true,
                message: `✅ *DOKUMENTASI LENGKAP!*

━━━━━━━━━━━━━━━━
📊 *RINGKASAN DOKUMENTASI:*
━━━━━━━━━━━━━━━━

${problemFilled} 1. Foto penyebab masalah
${speedtestFilled} 2. Screenshot speedtest
${resultFilled} 3. Foto hasil perbaikan
⚪ Tidak ada foto tambahan

━━━━━━━━━━━━━━━━
📌 *STEP TERAKHIR:*
━━━━━━━━━━━━━━━━

➡️ Ketik salah satu:
   • *done*
   • *lanjut*
   • *next*

Untuk melanjutkan input catatan perbaikan`
            };
        }
    }

    const teknisiNotesResult = await handleTeknisiResolutionNotesState(stateSender, chats);
    if (teknisiNotesResult.handled) {
        return { handled: true, message: teknisiNotesResult.message || null };
    }

    const teknisiConfirmResult = await handleTeknisiCompletionConfirmationState(stateSender, chats);
    if (teknisiConfirmResult.handled) {
        return { handled: true, message: teknisiConfirmResult.message || null };
    }

    if (teknisiState.step === "AWAITING_RESOLUTION_NOTES") {
        if (chats.length < 10) {
            return { handled: true, message: format("error_notes_too_short") };
        }

        setUserState(stateSender, {
            ...teknisiState,
            resolutionNotes: chats,
            step: "AWAITING_CONFIRMATION"
        });

        return {
            handled: true,
            message: `📝 *REVIEW SEBELUM FINALISASI*
━━━━━━━━━━━━━━━━

📋 *ID Tiket:* ${teknisiState.ticketId}
📸 *Dokumentasi:* ${teknisiState.uploadedPhotos.length} foto
📝 *Catatan Resolusi:*
${chats}

━━━━━━━━━━━━━━━━
⚠️ *KONFIRMASI PENYELESAIAN*

Apakah perbaikan sudah selesai dan data di atas sudah benar?

📌 *STEP TERAKHIR:*
➡️ Ketik *ya* = Selesaikan tiket & kirim ke pelanggan
➡️ Ketik *tidak* = Edit ulang catatan`
        };
    }

    if (teknisiState.step === "AWAITING_CONFIRMATION") {
        const response = chats.toLowerCase().trim();
        if (response === "ya" || response === "yes") {
            const result = await handleCompleteTicket(stateSender, teknisiState);
            deleteUserState(stateSender);
            return { handled: true, message: result.message || null };
        }
        if (response === "tidak" || response === "no") {
            setUserState(stateSender, {
                ...teknisiState,
                step: "AWAITING_RESOLUTION_NOTES"
            });
            return { handled: true, message: format("info_notes_edit_cancelled") };
        }
        return { handled: true, message: format("error_invalid_choice") };
    }

    return { handled: false, reply };
}

module.exports = {
    handleLegacyTeknisiStateTransitions
};
