/**
 * Header Doc
 * Purpose: Route admin halaman "Konfirmasi Bayar" — daftar bukti pembayaran pelanggan yang menunggu
 *          verifikasi, serve file bukti (auth admin, TIDAK lewat /temp static yang bisa bocor), serta
 *          aksi konfirmasi (catat lunas + reaktivasi + struk) / tolak. Semua logika ada di
 *          services/payment-proof.service; route ini tipis.
 * Caller: routes/admin-router.js (composer) via registerAdminKonfirmasiBayarRoutes.
 * Deps: Express router, ensureAdmin (routes/api-route-helpers), asyncHandler (lib/error-handler),
 *       services/payment-proof.service (singleton), fs/path untuk sendFile.
 * MainFuncs: registerAdminKonfirmasiBayarRoutes.
 * SideEffects: Konfirmasi/tolak menulis ledger pembayaran + kirim WA (lewat service).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { asyncHandler } = require("../lib/error-handler");
const { ensureAdmin } = require("./api-route-helpers");
const { getPaymentProofService } = require("../services/payment-proof.service");

function toClientRecord(r) {
    return {
        id: r.id,
        userName: r.userName,
        phone: r.phone,
        periode: `${String(r.periodMonth).padStart(2, "0")}/${r.periodYear}`,
        amountDue: r.amountDue,
        wasFullyPaidAtSubmit: r.wasFullyPaidAtSubmit,
        fileType: r.fileType,
        caption: r.caption,
        submittedAt: r.submittedAt,
        status: r.status
    };
}

function statusCodeForReason(reason) {
    if (reason === "not_found") return 404;
    if (reason === "already_processed") return 409;
    return 422;
}

function messageForReason(result) {
    switch (result.reason) {
        case "not_found": return "Bukti tidak ditemukan.";
        case "already_processed": return `Bukti sudah diproses (status: ${result.status}).`;
        case "user_not_found": return "Data pelanggan tidak ditemukan.";
        case "settle_failed": return `Gagal mencatat lunas: ${result.error || "kesalahan sistem"}.`;
        default: return "Gagal memproses bukti.";
    }
}

function resolveAdminName(req) {
    return (req.user && (req.user.name || req.user.username)) || "admin";
}

function registerAdminKonfirmasiBayarRoutes(router, deps = {}) {
    const guard = deps.ensureAdmin || ensureAdmin;
    const service = deps.paymentProofService || getPaymentProofService();

    // Daftar bukti menunggu konfirmasi (read-only).
    router.get("/api/konfirmasi-bayar/list", guard, asyncHandler(async (_req, res) => {
        const items = service.listPending().map(toClientRecord);
        res.status(200).json({
            status: 200,
            message: `${items.length} bukti menunggu konfirmasi.`,
            data: { items, total: items.length }
        });
    }));

    // Serve file bukti — WAJIB lewat sini (ber-auth), JANGAN tautkan langsung ke /temp (bisa bocor
    // karena middleware auth melewati request berekstensi gambar).
    router.get("/api/konfirmasi-bayar/:id/proof", guard, asyncHandler(async (req, res) => {
        const record = service.getById(req.params.id);
        if (!record) {
            return res.status(404).json({ status: 404, message: "Bukti tidak ditemukan." });
        }
        const filePath = service.getFilePath(record);
        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(404).json({ status: 404, message: "File bukti tidak tersedia." });
        }
        return res.sendFile(path.resolve(filePath));
    }));

    // Konfirmasi lunas → catat lunas + reaktivasi + struk (via service).
    router.post("/api/konfirmasi-bayar/:id/konfirmasi", guard, asyncHandler(async (req, res) => {
        const result = await service.confirmProof(req.params.id, {
            adminName: resolveAdminName(req),
            notes: (req.body && req.body.notes) || ""
        });
        if (!result.ok) {
            const code = statusCodeForReason(result.reason);
            return res.status(code).json({ status: code, message: messageForReason(result) });
        }
        res.status(200).json({
            status: 200,
            message: result.alreadyPaid
                ? "Periode ini sudah tercatat lunas; bukti ditandai terkonfirmasi."
                : "Pembayaran dikonfirmasi. Pelanggan diaktifkan (bila terisolir) & diberi struk.",
            data: { id: req.params.id }
        });
    }));

    // Tolak bukti → tandai rejected + beri tahu pelanggan (via service).
    router.post("/api/konfirmasi-bayar/:id/tolak", guard, asyncHandler(async (req, res) => {
        const result = await service.rejectProof(req.params.id, {
            adminName: resolveAdminName(req),
            reason: (req.body && req.body.reason) || ""
        });
        if (!result.ok) {
            const code = statusCodeForReason(result.reason);
            return res.status(code).json({ status: code, message: messageForReason(result) });
        }
        res.status(200).json({ status: 200, message: "Bukti ditolak & pelanggan diberi tahu.", data: { id: req.params.id } });
    }));

    return {};
}

module.exports = { registerAdminKonfirmasiBayarRoutes };
