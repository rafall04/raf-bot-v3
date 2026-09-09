/**
 * Header Doc
 * Purpose: Owner orchestration fitur Cetak Voucher — gabungkan settings (repo) dengan default dari `global.config` (nama wifi, CS, logo, login_url), daftar layout, render lembar cetak (HTML flow/grid), render PDF server-side (via helper html-to-pdf), kirim PDF ke WhatsApp owner/admin, dan impor template Mikhmon. Route tetap adapter tipis.
 * Caller: `routes/api-voucher-routes.js`.
 * Deps: `repositories/voucher-print.repository.js`, `services/voucher-print/render`, `services/voucher-print/mikhmon-import`, dan (opsional, di-inject) `htmlToPdf`, `sendMessageToMany`, `ensureJid`, `getAdminJids`, `renderCaption`, `getConfig`.
 * MainFuncs: `createVoucherPrintService` -> getSettings, listLayouts, getLayout, saveSettings, saveLayout, deleteLayout, renderPrint, renderPdf, renderPdfAndSend, generateBatch, importMikhmonLayout.
 * SideEffects: Persistensi via repository (file JSON). renderPdf menjalankan Chromium headless (via htmlToPdf). renderPdfAndSend mengirim dokumen WhatsApp. Render HTML murni in-memory.
 */
"use strict";

const { renderSheet } = require("./voucher-print/render");
const { convertMikhmonTemplate } = require("./voucher-print/mikhmon-import");

function defaultDeps() {
    return {
        repository: null,
        trackingRepository: null,
        getConfig: () => global.config || {},
        qrcode: null,
        addHotspotUsersBatch: null,
        htmlToPdf: null,
        sendMessageToMany: null,
        ensureJid: null,
        getAdminJids: null,
        renderResponseTemplate: null,
        logger: console
    };
}

function digitsOnly(value) {
    return String(value || "").replace(/[^0-9]/g, "");
}

function slugify(value, fallback) {
    const s = String(value || "").trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return s || fallback;
}

function createVoucherPrintService(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };

    // Kunci in-flight per-instance (app single-instance) untuk operasi BERAT/BERISIKO:
    //   'generate' — cegah provision GANDA di MikroTik (2 klik/2 tab -> 2x N user).
    //   'render'   — cegah dua render Chromium 360-kartu bersamaan (lonjakan memori).
    // Menolak CEPAT (code 'BUSY') alih-alih antre, supaya double-submit tak diam-diam jalan dua kali.
    const inFlight = new Set();
    async function withInFlight(key, busyMessage, fn) {
        if (inFlight.has(key)) {
            return { ok: false, code: "BUSY", message: busyMessage };
        }
        inFlight.add(key);
        try {
            return await fn();
        } finally {
            inFlight.delete(key);
        }
    }

    function getMergedSettings() {
        const config = deps.getConfig() || {};
        const stored = deps.repository.getSettings();
        const ownerDigits = Array.isArray(config.ownerNumber) && config.ownerNumber[0]
            ? digitsOnly(config.ownerNumber[0])
            : "";
        // login_url: pakai setting eksplisit; bila kosong, TURUNKAN origin dari autologin_url_template
        // yang SUDAH ada (mis. "http://10.10.0.1/login?u={kode}" -> "http://10.10.0.1") supaya tidak
        // ada nilai kembar untuk gateway yang sama (anti shadow-ownership). Per-instance dengan sendirinya.
        let loginUrl = stored.login_url || "";
        if (!loginUrl && stored.autologin_url_template) {
            const m = String(stored.autologin_url_template).match(/^(https?:\/\/[^/\s]+)/i);
            if (m) loginUrl = m[1];
        }
        return {
            ...stored,
            wifi_name: stored.wifi_name || config.nama || config.nama_wifi || "RAF NET",
            cs_number: stored.cs_number || config.telfon || ownerDigits || "",
            logo_url: stored.logo_url || (config.company && config.company.logoPath) || "",
            autologin_url_template: stored.autologin_url_template || "",
            login_url: loginUrl,
            print_page_size: stored.print_page_size || "a4"
        };
    }

    // Rakit HTML lembar cetak + resolusi layout/grid/pageSize. Dipakai renderPrint (HTML) & renderPdf (PDF).
    async function buildSheetHtml({ layoutId, vouchers, thermal = false, title, pageSize, columns, rows } = {}) {
        const settings = getMergedSettings();
        const layout = (layoutId && deps.repository.getLayout(layoutId))
            || deps.repository.getLayout(settings.default_layout)
            || deps.repository.getLayouts()[0];
        if (!layout) {
            throw new Error("Tidak ada layout voucher tersedia");
        }
        const list = Array.isArray(vouchers) ? vouchers : [];
        const resolvedPageSize = String(pageSize || settings.print_page_size || "a4").toLowerCase();
        const cols = parseInt(columns, 10);
        const rws = parseInt(rows, 10);
        // Grid dari request menang; kalau tidak ada, pakai metadata layout (mis. mikhmon36 4x9).
        const grid = (cols > 0 && rws > 0) ? { cols, rows: rws } : (layout.grid || null);
        const perPage = grid ? grid.cols * grid.rows : list.length;
        const pageOpts = {
            thermal: Boolean(thermal),
            title: title || `Cetak Voucher - ${settings.wifi_name}`,
            pageSize: resolvedPageSize
        };
        if (grid && !thermal) pageOpts.grid = grid;
        const html = await renderSheet(layout, list, settings, { qrcode: deps.qrcode }, pageOpts);
        return { html, layout, settings, count: list.length, perPage, pageSize: resolvedPageSize };
    }

    return {
        deps,

        getSettings() {
            return getMergedSettings();
        },

        saveSettings(patch = {}) {
            return deps.repository.saveSettings(patch);
        },

        listLayouts() {
            return deps.repository.getLayouts();
        },

        getLayout(id) {
            return deps.repository.getLayout(id);
        },

        saveLayout(layout) {
            return deps.repository.saveLayout({ ...layout, updated_at: new Date().toISOString() });
        },

        deleteLayout(id) {
            return deps.repository.deleteLayout(id);
        },

        async renderPrint(input = {}) {
            const { html, layout, count } = await buildSheetHtml(input);
            return { html, layoutId: layout.id, count };
        },

        // Render lembar -> PDF Buffer via helper html-to-pdf (Chromium headless). GAGAL-KERAS: kembalikan
        // {ok:false,...}, JANGAN pernah pulangkan buffer HTML dilabeli PDF (jebakan fallback invoice lama).
        async renderPdf(input = {}) {
            if (typeof deps.htmlToPdf !== "function") {
                return { ok: false, code: "PDF_ENGINE_MISSING", message: "Engine PDF (html-to-pdf) tidak tersedia" };
            }
            // Kunci 'render' cegah dua render Chromium 360-kartu bersamaan (lonjakan memori single-instance).
            return withInFlight("render", "Render PDF voucher lain sedang berjalan. Tunggu sebentar lalu coba lagi.", async () => {
                let built;
                try {
                    built = await buildSheetHtml(input);
                } catch (error) {
                    return { ok: false, code: "RENDER_FAILED", message: error && error.message ? error.message : "Gagal render lembar" };
                }
                const isLetter = String(built.pageSize).toLowerCase() === "letter";
                try {
                    const buffer = await deps.htmlToPdf(built.html, {
                        format: isLetter ? "Letter" : "A4",
                        margin: isLetter ? "8mm" : "7mm",
                        printBackground: true,
                        waitUntil: "load",
                        // Timeout eksplisit: batch besar ber-QR yang lambat GAGAL-KERAS bersih, tak menggantung.
                        timeoutMs: 90000
                    });
                    return { ok: true, buffer, count: built.count, perPage: built.perPage, pageSize: built.pageSize, settings: built.settings, layout: built.layout };
                } catch (error) {
                    deps.logger.error("[VOUCHER_PRINT_PDF_ERROR]", error && error.message ? error.message : error);
                    return { ok: false, code: "PDF_FAILED", message: error && error.message ? error.message : "Gagal render PDF (Chromium)" };
                }
            });
        },

        // Render lembar -> PDF -> kirim ke WhatsApp owner/admin (Opsi A). Gated config.voucherPrint.*.
        // Penerima default = getAdminJids (accounts role admin/owner); staff boleh override nomor.
        // JANGAN throw dari jalur kirim; JANGAN @lid sebagai target.
        async renderPdfAndSend(input = {}) {
            const config = deps.getConfig() || {};
            const vp = config.voucherPrint || {};
            if (vp.enabled !== true) {
                return { ok: false, code: "DISABLED", message: "Cetak PDF server nonaktif (config.voucherPrint.enabled=false)" };
            }
            if (!vp.sendWhatsApp || vp.sendWhatsApp.enabled !== true) {
                return { ok: false, code: "WA_DISABLED", message: "Kirim WhatsApp voucher nonaktif (config.voucherPrint.sendWhatsApp.enabled=false)" };
            }
            if (typeof deps.sendMessageToMany !== "function") {
                return { ok: false, code: "WA_ENGINE_MISSING", message: "Pengirim WhatsApp tidak tersedia" };
            }

            // Resolusi penerima: nomor dari staff (dinormalkan) atau owner/admin dari accounts.json.
            const requested = Array.isArray(input.phones)
                ? input.phones
                : (input.phone ? [input.phone] : []);
            let recipients = [];
            if (requested.length) {
                recipients = requested
                    .map((p) => (typeof deps.ensureJid === "function" ? deps.ensureJid(p) : String(p || "")))
                    .filter(Boolean);
            } else if (typeof deps.getAdminJids === "function") {
                recipients = deps.getAdminJids();
            }
            // Buang @lid (angka @lid BUKAN nomor telepon; jangan pernah jadi target kirim).
            recipients = recipients.filter((jid) => jid && !/@lid$/i.test(jid));
            if (!recipients.length) {
                return { ok: false, code: "NO_RECIPIENTS", message: "Tak ada penerima admin/owner valid (cek accounts.json role admin/owner)" };
            }

            const pdf = await this.renderPdf(input);
            if (!pdf.ok) return pdf;

            const settings = pdf.settings || getMergedSettings();
            const jumlah = pdf.count;
            const perLembar = pdf.perPage || jumlah || 1;
            const totalLembar = Math.max(1, Math.ceil(jumlah / perLembar));
            const paket = (Array.isArray(input.vouchers) && input.vouchers[0]
                && (input.vouchers[0].profileName || input.vouchers[0].profile)) || "voucher";
            const loginUrl = settings.login_url || "";

            const fallbackCaption = `🎟️ *${jumlah} voucher* siap cetak (${paket}).\nPDF terlampir — ${perLembar}/lembar, ${totalLembar} lembar.${loginUrl ? `\nLogin: ${loginUrl}` : ""}`;
            const caption = typeof deps.renderResponseTemplate === "function"
                ? deps.renderResponseTemplate("voucher_print_sheet_sent", fallbackCaption, {
                    jumlah, paket, perLembar, totalLembar, loginUrl,
                    wifi: settings.wifi_name || ""
                })
                : fallbackCaption;

            const dateTag = new Date().toISOString().slice(0, 10);
            const fileName = `Voucher-${slugify(settings.wifi_name, "RAFNET")}-${jumlah}pcs-${dateTag}.pdf`;

            let delivery;
            try {
                delivery = await deps.sendMessageToMany(
                    recipients,
                    { document: pdf.buffer, fileName, mimetype: "application/pdf", caption },
                    { skipDuplicateCheck: true }
                );
            } catch (error) {
                deps.logger.error("[VOUCHER_PRINT_SEND_ERROR]", error && error.message ? error.message : error);
                return { ok: false, code: "SEND_FAILED", message: error && error.message ? error.message : "Gagal kirim WhatsApp" };
            }

            const sent = Boolean(delivery && delivery.sent);
            return {
                ok: sent,
                code: sent ? null : ((delivery && delivery.errorCode) || "SEND_FAILED"),
                count: jumlah,
                fileName,
                recipients: (delivery && delivery.recipients) || [],
                warning: (delivery && delivery.warning) || null
            };
        },

        async generateBatch({ profile, count, length, chartype, prefix, usernames } = {}) {
            if (!profile) return { ok: false, message: "Profil voucher wajib dipilih" };
            const custom = Array.isArray(usernames) ? usernames.map((u) => String(u).trim()).filter(Boolean) : [];
            const n = parseInt(count, 10) || 0;
            if (custom.length === 0 && n < 1) return { ok: false, message: "Jumlah voucher minimal 1" };
            if (typeof deps.addHotspotUsersBatch !== "function") {
                return { ok: false, message: "Bridge MikroTik batch tidak tersedia" };
            }
            // Kunci 'generate' cegah provision GANDA (double-submit -> 2x N user di router).
            return withInFlight("generate", "Batch voucher lain sedang diproses. Tunggu hingga selesai lalu coba lagi.", async () => {
                const stored = deps.repository.getSettings();
                const result = await deps.addHotspotUsersBatch({
                    profile,
                    count: n,
                    comment: "VoucherPrint",
                    length: parseInt(length, 10) || stored.code_length || 6,
                    chartype: chartype || stored.code_chartype || "safe",
                    prefix: (prefix !== null && typeof prefix !== "undefined") ? prefix : (stored.code_prefix || ""),
                    usernames: custom
                }, { caller: "voucher-print.generateBatch" });
                if (!result || result.ok !== true) {
                    return { ok: false, message: (result && result.message) || "Gagal generate batch dari MikroTik" };
                }
                const data = result.data || {};
                return {
                    ok: true,
                    vouchers: data.vouchers || [],
                    created: data.created || 0,
                    failed: data.failed || 0,
                    requested: data.requested || n
                };
            });
        },

        async getVoucherReport(filters = {}) {
            if (!deps.trackingRepository) return { aktivasi: 0, revenue: 0, byProfile: [] };
            return deps.trackingRepository.getReport(filters);
        },

        async listVoucherActivations(filters = {}) {
            if (!deps.trackingRepository) return [];
            return deps.trackingRepository.listActivations(filters);
        },

        previewMikhmonImport({ php } = {}) {
            return convertMikhmonTemplate(php || "");
        },

        importMikhmonLayout({ id, name, php, mergeColors = true } = {}) {
            const { template, colors } = convertMikhmonTemplate(php || "");
            const slug = String(id || name || `mikhmon-${Date.now()}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            const saved = deps.repository.saveLayout({
                id: slug || `mikhmon-${Date.now()}`,
                name: name || "Impor Mikhmon",
                width: 200,
                template,
                updated_at: new Date().toISOString()
            });
            if (mergeColors && colors && colors.map && Object.keys(colors.map).length > 0) {
                const patch = { price_colors: colors.map };
                if (colors.default) patch.default_color = colors.default;
                deps.repository.saveSettings(patch);
            }
            return { layout: saved, colors };
        }
    };
}

module.exports = { createVoucherPrintService };
