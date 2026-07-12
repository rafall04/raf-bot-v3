/**
 * Header Doc
 * Purpose: Route admin halaman "Broadcast Terarah" (dulu Broadcast Tagihan) — data pendukung
 *          untuk blast manual + terarah ke pelanggan terpilih: (1) daftar pelanggan dengan filter
 *          status (belum/sudah bayar, semua, sedang terisolir, menunggak-berbasis-ledger), (2) daftar
 *          template broadcast yang bisa dipilih (tagihan/masa tenggang/isolir/selamat datang) untuk
 *          pra-isi editor, (3) preview pesan terisi untuk 1 pelanggan sampel. PENGIRIMAN tetap
 *          REUSE endpoint `/api/broadcast` (mesin broadcast + throttle + opt-in + riwayat) — bukan
 *          jalur kirim baru. Read-only + render string.
 * Caller: `routes/admin-router.js` (composer) via `registerAdminBroadcastTagihanRoutes`.
 * Deps: Express router, `ensureAuthenticatedStaff`, `lib/account-classification` (isInfrastructure),
 *       `services/admin-broadcast.service` (formatBroadcastMessage), `lib/response-template-helper`
 *       (renderResponseTemplate), `lib/template-service` (renderCategoryTemplate — resolusi template
 *       notifikasi lintas kategori untuk prefill), `services/arrears.service` (daftar penunggak
 *       berbasis ledger), `lib/error-handler` (asyncHandler), global.users/packages/config.
 * MainFuncs: `registerAdminBroadcastTagihanRoutes`, `resolveDirectedTemplateText`, `findDirectedTemplate`.
 * SideEffects: Tidak ada (read-only + render string + baca users.sqlite via arrears service).
 *              Pengiriman WA terjadi di `/api/broadcast`.
 */
"use strict";

const { asyncHandler } = require("../lib/error-handler");
const { isInfrastructure } = require("../lib/account-classification");
const { formatBroadcastMessage } = require("../services/admin-broadcast.service");
const { renderResponseTemplate } = require("../lib/response-template-helper");
const templateService = require("../lib/template-service");
const { createArrearsService } = require("../services/arrears.service");

// Fallback runtime yang aman (invariant: teks user-facing wajib punya fallback). Teks yang sama
// dipasang sebagai default key `broadcast_tagihan` di database/response_templates.json (bisa diedit admin).
const BROADCAST_TAGIHAN_FALLBACK = [
    "Yth. Pelanggan *${nama_pelanggan}*,",
    "",
    "Kami dari *${nama_wifi}* mengingatkan tagihan internet Anda periode *${periode}* telah tersedia dan jatuh tempo pada *${jatuh_tempo}*.",
    "",
    "Detail Tagihan:",
    "- Paket: *${nama_paket}*",
    "- Total: *${harga}*",
    "",
    "💳 Pembayaran via transfer ke:",
    "${rekening}",
    "",
    "Setelah transfer, mohon kirim *foto bukti pembayaran* ke chat ini agar kami proses. Bila sudah membayar, mohon abaikan pesan ini.",
    "",
    "Terima kasih,",
    "*${nama_bot}*"
].join("\n");

// Fallback ringkas untuk template notifikasi (message_templates.json). Hanya dipakai bila key
// tersimpan hilang — teks lengkap yang dapat diedit admin tetap ada di message_templates.json.
const MASA_TENGGANG_FALLBACK = [
    "⚠️ *PEMBERITAHUAN MASA TENGGANG*",
    "",
    "Yth. *${nama_pelanggan}*,",
    "",
    "Tagihan periode *${periode}* telah melewati jatuh tempo (*${jatuh_tempo}*). Mohon selesaikan pembayaran *sebelum ${tanggal_isolir}* agar layanan tidak dinonaktifkan sementara.",
    "",
    "- Paket: *${nama_paket}*",
    "- Total: *${harga}*",
    "",
    "Transfer ke:",
    "${rekening}",
    "",
    "Terima kasih,",
    "*${nama_bot}*"
].join("\n");

const ISOLIR_FALLBACK = [
    "Yth. *${nama_pelanggan}*,",
    "",
    "Layanan internet Anda saat ini *terisolir* karena tagihan periode *${periode}* belum kami terima.",
    "",
    "Mohon segera lakukan pembayaran agar layanan dapat aktif kembali.",
    "",
    "Transfer ke:",
    "${rekening}",
    "",
    "Terima kasih,",
    "Admin *${nama_wifi}*"
].join("\n");

const WELCOME_FALLBACK = [
    "👋 *Halo ${nama_pelanggan}!*",
    "",
    "Nomor WhatsApp Anda telah terdaftar di layanan *${nama_wifi}*.",
    "",
    "📦 Paket: *${nama_paket}* (*${display_profile}*)",
    "",
    "Ketik *menuwifi* untuk melihat menu layanan.",
    "",
    "Terima kasih 🙏",
    "*${nama_bot}*"
].join("\n");

// Registry template broadcast terarah. `category` menentukan sumber resolusi teks:
//  - responseTemplates → database/response_templates.json (via renderResponseTemplate)
//  - notificationTemplates → database/message_templates.json (via templateService.renderCategoryTemplate)
// Semua slot per-pelanggan (${nama_pelanggan}/${harga}/${link_bayar}/${tanggal_isolir}/${display_profile}/…)
// diisi mesin broadcast (`formatBroadcastMessage`) saat kirim; prefill hanya mengisi slot brand.
const DIRECTED_TEMPLATES = [
    { id: "tagihan", key: "broadcast_tagihan", category: "responseTemplates", label: "Tagihan / Pembayaran", fallback: BROADCAST_TAGIHAN_FALLBACK },
    { id: "tenggang", key: "masa_tenggang_reminder", category: "notificationTemplates", label: "Masa Tenggang", fallback: MASA_TENGGANG_FALLBACK },
    { id: "isolir", key: "isolir_notification", category: "notificationTemplates", label: "Isolir (Layanan Diblokir)", fallback: ISOLIR_FALLBACK },
    { id: "welcome", key: "import_welcome", category: "notificationTemplates", label: "Selamat Datang (resend)", fallback: WELCOME_FALLBACK }
];

// Predikat filter status pelanggan (in-memory dari global.users). `menunggak` ditangani terpisah
// (async, berbasis ledger) di handler karena butuh query SQLite.
const STATUS_PREDICATES = {
    all: () => true,
    unpaid: (u) => !u.paid,
    paid: (u) => Boolean(u.paid),
    isolir: (u) => String(u.status || "").toLowerCase() === "isolir"
};
const STATUS_LABELS = {
    all: "semua",
    unpaid: "belum bayar",
    paid: "sudah bayar",
    isolir: "sedang terisolir",
    menunggak: "menunggak"
};

function priceForSubscription(subscription) {
    const pkg = (global.packages || []).find((p) => p.name === subscription);
    return pkg && pkg.price ? Number(pkg.price) : 0;
}

function hasPhone(user) {
    return String(user?.phone_number || "").trim() !== "";
}

function toCustomerItem(user, extra = {}) {
    return {
        id: user.id,
        name: user.name || "",
        has_phone: hasPhone(user),
        phone_number: user.phone_number || "",
        subscription: user.subscription || user.package || "",
        price: priceForSubscription(user.subscription || user.package),
        paid: Boolean(user.paid),
        status: user.status || null,
        has_device: Boolean(user.device_id),
        ...extra
    };
}

// Pilih entri template berdasarkan id (default: tagihan). Selalu mengembalikan entri valid.
function findDirectedTemplate(id) {
    const wanted = String(id || "").trim().toLowerCase();
    return DIRECTED_TEMPLATES.find((t) => t.id === wanted) || DIRECTED_TEMPLATES[0];
}

// Render teks template untuk pra-isi editor. Resolusi lintas-kategori: mesin broadcast (`renderText`)
// hanya membaca responseTemplates, jadi template notifikasi (isolir/tenggang/welcome) di-resolve di sini.
// Data `{}` → slot brand terisi default, slot per-pelanggan tetap mentah untuk diisi mesin saat kirim.
function resolveDirectedTemplateText(entry) {
    if (!entry) return "";
    if (entry.category === "responseTemplates") {
        return renderResponseTemplate(entry.key, entry.fallback, {});
    }
    try {
        const result = templateService.renderCategoryTemplate(entry.category, entry.key, {});
        if (result && result.found && typeof result.text === "string" && result.text.trim()) {
            return result.text;
        }
    } catch (_err) {
        // Jatuh ke fallback aman di bawah (invariant: teks user-facing tak boleh kosong/melempar).
    }
    return entry.fallback || "";
}

function registerAdminBroadcastTagihanRoutes(router, deps = {}) {
    const ensureAuthenticatedStaff = deps.ensureAuthenticatedStaff || ((_req, _res, next) => next());

    // Daftar pelanggan untuk seleksi. Filter status: unpaid (default) | paid | all | isolir | menunggak.
    // Read-only; `menunggak` berbasis ledger (payment_history) via arrears service.
    router.get("/api/broadcast-tagihan/customers", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const status = String(req.query?.status || "unpaid").toLowerCase();
        const all = Array.isArray(global.users) ? global.users : [];
        const base = all.filter((u) => !isInfrastructure(u));

        let items;
        if (status === "menunggak") {
            const now = new Date();
            const readModel = await createArrearsService().getArrearsReadModel({
                periodMonth: now.getMonth() + 1,
                periodYear: now.getFullYear()
            });
            const outstandingByUserId = new Map(
                (readModel.rows || []).map((r) => [String(r.user_id), r.total_outstanding])
            );
            items = base
                .filter((u) => outstandingByUserId.has(String(u.id)))
                .map((u) => toCustomerItem(u, { outstanding: outstandingByUserId.get(String(u.id)) || 0 }));
        } else {
            const predicate = STATUS_PREDICATES[status] || STATUS_PREDICATES.unpaid;
            items = base.filter(predicate).map((u) => toCustomerItem(u));
        }

        items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        const label = STATUS_LABELS[status] || STATUS_LABELS.unpaid;
        res.status(200).json({
            status: 200,
            message: `${items.length} pelanggan (${label}).`,
            data: { items, total: items.length, status, unpaid_only: status === "unpaid" }
        });
    }));

    // Daftar template broadcast yang bisa dipilih (untuk isi dropdown FE).
    router.get("/api/broadcast-tagihan/templates", ensureAuthenticatedStaff, asyncHandler(async (_req, res) => {
        const items = DIRECTED_TEMPLATES.map((t) => ({ id: t.id, label: t.label, key: t.key }));
        res.status(200).json({ status: 200, message: `${items.length} template broadcast.`, data: { items } });
    }));

    // Template default (dengan placeholder utuh) untuk pra-isi editor — hindari duplikasi teks di FE.
    // `?template=<id>` memilih template (default: tagihan). Backward-compatible dgn pemanggilan lama.
    router.get("/api/broadcast-tagihan/default-template", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const entry = findDirectedTemplate(req.query?.template);
        const text = resolveDirectedTemplateText(entry);
        res.status(200).json({
            status: 200,
            message: "Template broadcast.",
            data: { template_id: entry.id, template_key: entry.key, text }
        });
    }));

    // Preview — render pesan jadi untuk 1 pelanggan sampel (placeholder terisi nyata).
    // Jika `text` kosong, resolve dari template terpilih (`template` id).
    router.post("/api/broadcast-tagihan/preview", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const sampleId = req.body?.user_id ?? (Array.isArray(req.body?.users) ? req.body.users[0] : null);
        const all = Array.isArray(global.users) ? global.users : [];
        const user = all.find((u) => String(u.id) === String(sampleId)) || null;
        if (!user) {
            return res.status(400).json({ status: 400, message: "Pilih minimal 1 pelanggan untuk pratinjau." });
        }
        // Ikuti pola renderText mesin broadcast: text editan → template terpilih + fallback.
        let raw = String(req.body?.text || "");
        if (!raw) {
            raw = resolveDirectedTemplateText(findDirectedTemplate(req.body?.template));
        }
        const message = formatBroadcastMessage(raw, user);
        res.status(200).json({
            status: 200,
            message: "Pratinjau pesan broadcast.",
            data: { user: { id: user.id, name: user.name, has_phone: hasPhone(user) }, message }
        });
    }));

    return { BROADCAST_TAGIHAN_FALLBACK, DIRECTED_TEMPLATES };
}

module.exports = {
    registerAdminBroadcastTagihanRoutes,
    resolveDirectedTemplateText,
    findDirectedTemplate,
    DIRECTED_TEMPLATES,
    BROADCAST_TAGIHAN_FALLBACK
};
