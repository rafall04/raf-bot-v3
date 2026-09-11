/**
 * Header Doc
 * Purpose: Halaman /notif-routing — atur tujuan notifikasi per-kategori ke GRUP WhatsApp, dikelompokkan
 *   per DOMAIN (Pembayaran / Jaringan / Voucher & Billing) agar mudah dipahami admin non-teknis.
 *   Pemilih grup = CHECKBOX (bukan multi-select ctrl-click). Muat GET /api/notif-routing, toggle master
 *   (PUT .../aktif), simpan per kategori (PUT .../:category), kirim uji (POST .../:category/uji).
 * Caller: views/sb-admin/notif-routing.php.
 * Deps: Fetch API (JWT cookie), jQuery/Bootstrap.
 * MainFuncs: load, render, saveCategory, toggleMaster, uji.
 * SideEffects: HTTP ke /api/notif-routing*; mutasi DOM.
 */
(function () {
    "use strict";
    var API = "/api/notif-routing";
    var STATE = { grup: [], waSiap: false, adminFallbackCount: 0, categories: [] };

    // Kelompokkan kategori per DOMAIN supaya sejenis berkumpul. Kunci = key kategori dari server.
    var DOMAINS = [
        { title: "Pembayaran", icon: "fa-money-bill-wave", keys: ["payment_request", "otorisasi_gagal"] },
        { title: "Jaringan", icon: "fa-wifi", keys: ["network_quality", "los_alarm"] },
        { title: "Voucher & Billing", icon: "fa-ticket-alt", keys: ["voucher_sale", "billing_isolir"] },
    ];

    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

    function toast(msg, type) {
        var box = $("nrMessage");
        if (!box) return;
        box.innerHTML = '<div class="alert alert-' + (type || "info") + ' alert-dismissible fade show" role="alert">' +
            msg + '<button type="button" class="close" data-dismiss="alert">&times;</button></div>';
        box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function grupSubject(id) {
        for (var i = 0; i < STATE.grup.length; i++) { if (STATE.grup[i].id === id) return STATE.grup[i].subject; }
        return null;
    }

    // Baris status "Sekarang: ..." — bahasa awam, tegas ke mana notif ini pergi SAAT INI.
    function statusLine(cat) {
        if (!STATE.masterOn) {
            return '<span class="text-muted"><i class="fas fa-user-shield"></i> Sekarang: ke <b>chat pribadi admin</b> (routing grup mati)</span>';
        }
        if (cat.groups && cat.groups.length) {
            var nama = cat.groups.map(function (id) { return esc(grupSubject(id) || id); }).join(", ");
            return '<span class="text-success"><i class="fas fa-users"></i> Sekarang: ke grup <b>' + nama + "</b></span>";
        }
        return '<span class="text-warning"><i class="fas fa-user-shield"></i> Sekarang: ke <b>chat pribadi admin</b> (belum dipilih grup)</span>';
    }

    function severityBadge(sev) {
        return sev === "critical"
            ? '<span class="badge badge-danger">Penting</span>'
            : '<span class="badge badge-light border">Biasa</span>';
    }

    // Daftar CHECKBOX grup untuk satu kategori. Grup tersimpan tapi bot tak di dalamnya ditandai jujur.
    function groupChecklist(cat) {
        var chosen = {};
        (cat.groups || []).forEach(function (g) { chosen[g] = true; });

        var html = '<div class="nr-grouplist" style="max-height:180px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:.5rem .75rem;">';
        if (!STATE.grup.length && !cat.groups.length) {
            html += '<div class="small text-muted">' + (STATE.waSiap
                ? "Bot belum tergabung di grup mana pun. Tambahkan bot ke grup WhatsApp dulu."
                : "WhatsApp belum terhubung — daftar grup tak bisa dimuat sekarang.") + "</div>";
        }
        STATE.grup.forEach(function (g) {
            var id = "nrg_" + cat.key + "_" + g.id.replace(/[^a-zA-Z0-9]/g, "");
            html += '<div class="custom-control custom-checkbox py-1">' +
                '<input type="checkbox" class="custom-control-input nr-grp" id="' + id + '" data-cat="' + esc(cat.key) + '" value="' + esc(g.id) + '"' + (chosen[g.id] ? " checked" : "") + ">" +
                '<label class="custom-control-label" for="' + id + '">' + esc(g.subject || g.id) +
                (g.size ? ' <span class="small text-muted">(' + g.size + " anggota)</span>" : "") + "</label></div>";
            delete chosen[g.id];
        });
        // Sisa = grup tersimpan tapi tak ada di daftar (bot dikeluarkan / WA offline).
        Object.keys(chosen).forEach(function (id) {
            var eid = "nrg_" + cat.key + "_" + id.replace(/[^a-zA-Z0-9]/g, "");
            html += '<div class="custom-control custom-checkbox py-1">' +
                '<input type="checkbox" class="custom-control-input nr-grp" id="' + eid + '" data-cat="' + esc(cat.key) + '" value="' + esc(id) + '" checked>' +
                '<label class="custom-control-label text-warning" for="' + eid + '">' + esc(id) +
                ' <span class="small">(tersimpan — bot mungkin tak di grup ini)</span></label></div>';
        });
        html += "</div>";
        return html;
    }

    function categoryCard(cat) {
        return '<div class="border rounded p-3 mb-3" data-cat="' + esc(cat.key) + '" style="background:var(--surface);">' +
            '<div class="d-flex justify-content-between align-items-start" style="gap:.5rem;">' +
            '<div><div style="font-weight:700;font-size:1rem;">' + esc(cat.label) + " " + severityBadge(cat.severity) + "</div>" +
            '<div class="small text-muted mt-1">' + esc(cat.desc) + "</div></div></div>" +
            '<div class="mt-2 mb-2 small">' + statusLine(cat) + "</div>" +
            '<div class="small font-weight-bold mb-1">Kirim ke grup: <span class="text-muted font-weight-normal">(centang; kosongkan = ke chat admin)</span></div>' +
            groupChecklist(cat) +
            '<div class="d-flex mt-2" style="gap:.5rem;">' +
            '<button class="btn btn-sm btn-primary nr-save" data-cat="' + esc(cat.key) + '"><i class="fas fa-save"></i> Simpan</button>' +
            '<button class="btn btn-sm btn-outline-secondary nr-test" data-cat="' + esc(cat.key) + '"><i class="fas fa-paper-plane"></i> Kirim Uji</button>' +
            "</div></div>";
    }

    function render(data) {
        STATE.grup = data.grup || [];
        STATE.waSiap = !!data.waSiap;
        STATE.adminFallbackCount = data.adminFallbackCount || 0;
        STATE.categories = data.categories || [];
        STATE.masterOn = data.enabled === true;

        var master = $("nrMaster");
        master.checked = STATE.masterOn;
        $("nrMasterLabel").textContent = STATE.masterOn ? "AKTIF" : "MATI";
        $("nrWaStatus").innerHTML = STATE.waSiap
            ? ('<i class="fas fa-check-circle text-success"></i> WhatsApp terhubung — ' + STATE.grup.length + " grup terdeteksi.")
            : ('<i class="fas fa-exclamation-triangle text-warning"></i> WhatsApp belum terhubung — daftar grup kosong; setelan lama tetap tersimpan.');

        var byKey = {};
        STATE.categories.forEach(function (c) { byKey[c.key] = c; });

        var html = "";
        DOMAINS.forEach(function (dom) {
            var cards = dom.keys.map(function (k) { return byKey[k] ? categoryCard(byKey[k]) : ""; }).join("");
            if (!cards) return;
            html += '<div class="card shadow mb-4"><div class="card-header py-3">' +
                '<h6 class="m-0 font-weight-bold text-primary"><i class="fas ' + dom.icon + ' mr-2"></i>' + esc(dom.title) + "</h6></div>" +
                '<div class="card-body">' + cards + "</div></div>";
        });
        // Kategori yang tak masuk domain mana pun (mis. kategori baru) — tampung di "Lainnya".
        var known = {};
        DOMAINS.forEach(function (d) { d.keys.forEach(function (k) { known[k] = true; }); });
        var sisa = STATE.categories.filter(function (c) { return !known[c.key]; });
        if (sisa.length) {
            html += '<div class="card shadow mb-4"><div class="card-header py-3"><h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-bell mr-2"></i>Lainnya</h6></div><div class="card-body">' +
                sisa.map(categoryCard).join("") + "</div></div>";
        }

        var box = $("nrContainer");
        box.innerHTML = html;
        box.classList.remove("d-none");
        $("nrLoading").classList.add("d-none");

        Array.prototype.forEach.call(box.querySelectorAll(".nr-save"), function (b) {
            b.addEventListener("click", function () { saveCategory(b.getAttribute("data-cat")); });
        });
        Array.prototype.forEach.call(box.querySelectorAll(".nr-test"), function (b) {
            b.addEventListener("click", function () { uji(b.getAttribute("data-cat")); });
        });
    }

    function selectedGroups(cat) {
        var out = [];
        Array.prototype.forEach.call(document.querySelectorAll('.nr-grp[data-cat="' + cat + '"]'), function (el) {
            if (el.checked) out.push(el.value);
        });
        return out;
    }

    async function load() {
        try {
            var res = await fetch(API + "?_=" + Date.now(), { credentials: "include" });
            var json = await res.json();
            if (!res.ok || json.status !== 200 || !json.data) throw new Error((json && json.message) || "Gagal memuat.");
            render(json.data);
        } catch (err) {
            $("nrLoading").innerHTML = '<div class="text-danger"><i class="fas fa-times-circle"></i> ' + esc(err.message || err) + "</div>";
        }
    }

    async function toggleMaster() {
        var master = $("nrMaster");
        var enabled = master.checked;
        master.disabled = true;
        try {
            var res = await fetch(API + "/aktif", { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: enabled }) });
            var json = await res.json();
            if (!res.ok || json.status !== 200) throw new Error((json && json.message) || "Gagal.");
            STATE.masterOn = enabled;
            $("nrMasterLabel").textContent = enabled ? "AKTIF" : "MATI";
            if (json.data) render({ ...json.data, grup: STATE.grup, waSiap: STATE.waSiap, adminFallbackCount: STATE.adminFallbackCount });
            toast('<i class="fas fa-check-circle"></i> ' + esc(json.message), "success");
        } catch (err) {
            master.checked = !enabled;
            $("nrMasterLabel").textContent = master.checked ? "AKTIF" : "MATI";
            toast('<i class="fas fa-times-circle"></i> ' + esc(err.message || err), "danger");
        } finally {
            master.disabled = false;
        }
    }

    async function saveCategory(cat) {
        var groups = selectedGroups(cat);
        try {
            var res = await fetch(API + "/" + encodeURIComponent(cat), { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groups: groups }) });
            var json = await res.json();
            if (!res.ok || json.status !== 200) throw new Error((json && json.message) || "Gagal.");
            if (json.data) render({ ...json.data, grup: STATE.grup, waSiap: STATE.waSiap, adminFallbackCount: STATE.adminFallbackCount });
            var extra = (json.unknownGroups && json.unknownGroups.length) ? (" (catatan: " + json.unknownGroups.length + " grup — bot mungkin tak di dalamnya)") : "";
            toast('<i class="fas fa-check-circle"></i> ' + esc(json.message) + esc(extra), (extra ? "warning" : "success"));
        } catch (err) {
            toast('<i class="fas fa-times-circle"></i> ' + esc(err.message || err), "danger");
        }
    }

    async function uji(cat) {
        try {
            var res = await fetch(API + "/" + encodeURIComponent(cat) + "/uji", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
            var json = await res.json();
            if (!res.ok || json.status !== 200) throw new Error((json && json.message) || "Gagal.");
            toast('<i class="fas fa-paper-plane"></i> ' + esc(json.message), "info");
        } catch (err) {
            toast('<i class="fas fa-times-circle"></i> ' + esc(err.message || err), "danger");
        }
    }

    document.addEventListener("DOMContentLoaded", function () {
        var master = $("nrMaster");
        if (master) master.addEventListener("change", toggleMaster);
        load();
    });
})();
