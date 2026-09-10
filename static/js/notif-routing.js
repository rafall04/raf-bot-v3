/**
 * Header Doc
 * Purpose: Halaman /notif-routing — atur tujuan notifikasi per-kategori ke GRUP WhatsApp. Muat
 *   GET /api/notif-routing (status + kategori + daftar grup), toggle master (PUT .../aktif),
 *   simpan grup+severity per kategori (PUT .../:category), dan kirim pesan uji (POST .../:category/uji).
 *   Admin-only (endpoint requireAdmin). Multi-pilih grup pakai <select multiple>.
 * Caller: views/sb-admin/notif-routing.php.
 * Deps: Fetch API (JWT cookie), jQuery/Bootstrap.
 * MainFuncs: load, render, saveCategory, toggleMaster, uji.
 * SideEffects: HTTP ke /api/notif-routing*; mutasi DOM.
 */
(function () {
    "use strict";
    var API = "/api/notif-routing";
    var STATE = { grup: [], waSiap: false, adminFallbackCount: 0, categories: [] };

    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

    function toast(msg, type) {
        var box = $("nrMessage");
        if (!box) return;
        box.innerHTML = '<div class="alert alert-' + (type || "info") + ' alert-dismissible fade show" role="alert">' +
            msg + '<button type="button" class="close" data-dismiss="alert">&times;</button></div>';
    }

    function optionsFor(selected) {
        var sel = {};
        (selected || []).forEach(function (j) { sel[j] = true; });
        var html = "";
        // Grup yang bot ikuti.
        STATE.grup.forEach(function (g) {
            html += '<option value="' + esc(g.id) + '"' + (sel[g.id] ? " selected" : "") + '>' + esc(g.subject || g.id) + '</option>';
            delete sel[g.id];
        });
        // Grup tersimpan tapi bot TIDAK di dalamnya (atau WA belum konek) — tampilkan jujur.
        Object.keys(sel).forEach(function (j) {
            html += '<option value="' + esc(j) + '" selected>' + esc(j) + ' (tersimpan — bot tidak di grup ini?)</option>';
        });
        return html;
    }

    function render(data) {
        STATE.grup = data.grup || [];
        STATE.waSiap = !!data.waSiap;
        STATE.adminFallbackCount = data.adminFallbackCount || 0;
        STATE.categories = data.categories || [];

        var master = $("nrMaster");
        master.checked = data.enabled === true;
        $("nrMasterLabel").textContent = data.enabled ? "ON" : "OFF";
        $("nrWaStatus").textContent = STATE.waSiap
            ? ("WhatsApp terkoneksi — " + STATE.grup.length + " grup terdeteksi · fallback DM admin: " + STATE.adminFallbackCount + " nomor")
            : ("WhatsApp belum terkoneksi — dropdown grup kosong; nilai lama tetap tersimpan. Fallback DM admin: " + STATE.adminFallbackCount + " nomor");

        var html = "";
        STATE.categories.forEach(function (c) {
            var terarah = (c.groups && c.groups.length) ? (c.groups.length + " grup") : "belum → DM admin";
            html += '<div class="card shadow mb-3" data-cat="' + esc(c.key) + '"><div class="card-body">' +
                '<div class="d-flex justify-content-between align-items-start flex-wrap" style="gap:.5rem;">' +
                '<div><div style="font-weight:700;">' + esc(c.label) +
                ' <span class="badge badge-' + (c.severity === "critical" ? "danger" : "secondary") + '">' + esc(c.severity) + '</span></div>' +
                '<div class="small text-muted">' + esc(c.desc) + '</div>' +
                '<div class="small" style="opacity:.6;">notif: ' + esc(c.key) + ' · saat ini: ' + esc(terarah) + '</div></div></div>' +
                '<div class="form-group mt-2 mb-2"><label class="small font-weight-bold mb-1">Kirim ke grup (boleh lebih dari satu):</label>' +
                '<select multiple class="form-control nr-groups" size="4" data-cat="' + esc(c.key) + '">' + optionsFor(c.groups) + '</select>' +
                '<small class="text-muted">Kosongkan = jatuh ke DM admin.</small></div>' +
                '<div class="d-flex" style="gap:.5rem;">' +
                '<button class="btn btn-sm btn-primary nr-save" data-cat="' + esc(c.key) + '"><i class="fas fa-save"></i> Simpan</button>' +
                '<button class="btn btn-sm btn-outline-secondary nr-test" data-cat="' + esc(c.key) + '"><i class="fas fa-paper-plane"></i> Kirim Uji</button>' +
                '</div></div></div>';
        });

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
        var sel = document.querySelector('.nr-groups[data-cat="' + cat + '"]');
        if (!sel) return [];
        return Array.prototype.filter.call(sel.options, function (o) { return o.selected; }).map(function (o) { return o.value; });
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
            $("nrMasterLabel").textContent = enabled ? "ON" : "OFF";
            toast('<i class="fas fa-check-circle"></i> ' + esc(json.message), "success");
        } catch (err) {
            master.checked = !enabled;
            $("nrMasterLabel").textContent = master.checked ? "ON" : "OFF";
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
            var extra = (json.unknownGroups && json.unknownGroups.length) ? (" (peringatan: " + json.unknownGroups.length + " grup — bot mungkin tidak di dalamnya)") : "";
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
