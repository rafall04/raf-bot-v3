/**
 * Header Doc
 * Purpose: Persistence owner antrian BUKTI PEMBAYARAN pelanggan (foto/dokumen bukti transfer) yang
 *   menunggu konfirmasi admin. Metadata disimpan di database/payment_proofs.json, file bukti di
 *   temp/payment_proofs/. Selalu baca-tulis dari disk (volume kecil, single-instance) dan bungkus
 *   mutasi dengan withLock agar read-modify-write tidak balapan dengan submit/konfirmasi lain.
 * Caller: services/payment-proof.service.js (Fase 1 submit; Fase 2/3 list/serve/konfirmasi).
 * Deps: fs, path, lib/request-lock (withLock).
 * MainFuncs: createPaymentProofRepository -> { create, list, listPending, getById, update, softDelete, getFilePath }.
 * SideEffects: Menulis JSON store + menyimpan file bukti di temp/payment_proofs/ (softDelete juga MENGHAPUS file bukti).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { withLock } = require("../lib/request-lock");

function createPaymentProofRepository(options = {}) {
    const storePath = options.storePath
        || path.join(__dirname, "..", "database", "payment_proofs.json");
    const proofDir = options.proofDir
        || path.join(__dirname, "..", "temp", "payment_proofs");
    const lockKey = `payment-proof-store:${storePath}`;

    function ensureDirs() {
        const storeDir = path.dirname(storePath);
        if (!fs.existsSync(storeDir)) fs.mkdirSync(storeDir, { recursive: true });
        if (!fs.existsSync(proofDir)) fs.mkdirSync(proofDir, { recursive: true });
    }

    // Baca dari disk tiap panggilan — volume kecil, dan menjamin Fase 2 (API admin) melihat apa
    // yang baru saja ditulis Fase 1 (handler bot) tanpa cache basi.
    function readAll() {
        try {
            if (!fs.existsSync(storePath)) return [];
            const raw = fs.readFileSync(storePath, "utf8");
            const parsed = JSON.parse(raw || "[]");
            return Array.isArray(parsed) ? parsed : [];
        } catch (err) {
            console.error("[PAYMENT_PROOF_STORE] Gagal membaca store:", err.message);
            return [];
        }
    }

    function writeAll(records) {
        ensureDirs();
        fs.writeFileSync(storePath, JSON.stringify(records, null, 2));
    }

    /**
     * Simpan record baru + (opsional) file bukti. File dinamai `${record.id}.${ext}`.
     * @returns record final (dengan fileName bila buffer ada).
     */
    async function create(record, buffer = null, ext = "jpg") {
        return withLock(lockKey, async () => {
            ensureDirs();
            const finalRecord = { ...record };
            if (buffer && buffer.length) {
                const fileName = `${record.id}.${ext}`;
                fs.writeFileSync(path.join(proofDir, fileName), buffer);
                finalRecord.fileName = fileName;
            }
            const records = readAll();
            records.push(finalRecord);
            writeAll(records);
            return finalRecord;
        });
    }

    function list() {
        return readAll();
    }

    function listPending() {
        return readAll().filter((r) => r.status === "pending");
    }

    function getById(id) {
        return readAll().find((r) => r.id === id) || null;
    }

    async function update(id, patch) {
        return withLock(lockKey, async () => {
            const records = readAll();
            const idx = records.findIndex((r) => r.id === id);
            if (idx === -1) return null;
            records[idx] = { ...records[idx], ...patch };
            writeAll(records);
            return records[idx];
        });
    }

    /**
     * Soft-delete sebuah bukti: perbarui metadata (mis. status "deleted") DALAM SATU lock dan
     * BUANG file bukti dari disk. Dipakai saat foto ternyata BUKAN bukti bayar (mis. keluhan) —
     * beda dari reject, jalur ini TIDAK menyentuh pelanggan sama sekali. Metadata record
     * dipertahankan (jejak audit: siapa/kapan menghapus); hanya file fisiknya yang dibuang supaya
     * foto pelanggan yang tak relevan tidak menumpuk di temp/payment_proofs/.
     * @returns record final (fileName di-null-kan), atau null bila id tak ada.
     */
    async function softDelete(id, patch = {}) {
        return withLock(lockKey, async () => {
            const records = readAll();
            const idx = records.findIndex((r) => r.id === id);
            if (idx === -1) return null;
            const current = records[idx];
            if (current.fileName) {
                try {
                    fs.unlinkSync(path.join(proofDir, current.fileName));
                } catch (err) {
                    // File hilang duluan = tak apa; error lain cukup di-log (best-effort, jangan gagalkan hapus).
                    if (err && err.code !== "ENOENT") {
                        console.warn("[PAYMENT_PROOF_STORE] Gagal menghapus file bukti:", err.message);
                    }
                }
            }
            records[idx] = { ...current, ...patch, fileName: null };
            writeAll(records);
            return records[idx];
        });
    }

    function getFilePath(record) {
        if (!record || !record.fileName) return null;
        return path.join(proofDir, record.fileName);
    }

    return { create, list, listPending, getById, update, softDelete, getFilePath, storePath, proofDir };
}

module.exports = { createPaymentProofRepository };
