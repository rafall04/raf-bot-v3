/**
 * Header Doc
 * Purpose: Panel Feature Flags (P2) — muat GET /api/feature-flags, render toggle per-kategori, dan
 *   POST /api/feature-flags {key,enabled} saat di-toggle. Menutup pola "fitur dibangun tapi gelap"
 *   (dulu hanya bisa dinyalakan via SSH edit config.json). Admin-only (endpoint requireAdmin).
 * Caller: views/sb-admin/feature-flags.php.
 * Deps: Fetch API (credentials JWT cookie), jQuery/Bootstrap (toast + switch).
 * MainFuncs: load, render, toggle.
 * SideEffects: HTTP ke /api/feature-flags; mutasi DOM.
 */
(function () {
    "use strict";
    var API = "/api/feature-flags";
    function $(id) { return document.getElementById(id); }

    function toast(msg, type) {
        var box = $("ffMessage");
        if (!box) return;
        box.innerHTML = '<div class="alert alert-' + (type || "info") + ' alert-dismissible fade show" role="alert">' +
            msg + '<button type="button" class="close" data-dismiss="alert">&times;</button></div>';
    }

    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

    function render(flags) {
        var byCat = {};
        flags.forEach(function (f) { (byCat[f.kategori] = byCat[f.kategori] || []).push(f); });
        var html = "";
        Object.keys(byCat).forEach(function (cat) {
            html += '<div class="card shadow mb-4"><div class="card-header py-3"><h6 class="m-0 font-weight-bold text-primary">' + esc(cat) + '</h6></div><div class="card-body">';
            byCat[cat].forEach(function (f) {
                html += '<div class="d-flex align-items-start justify-content-between py-2" style="border-bottom:1px solid var(--line);gap:1rem;">' +
                    '<div style="flex:1;"><div style="font-weight:600;">' + esc(f.label) + '</div>' +
                    '<div class="small text-muted">' + esc(f.desc) + '</div>' +
                    '<div class="small" style="opacity:.6;">config.' + esc(f.key) + '</div></div>' +
                    '<div class="custom-control custom-switch" style="padding-top:.25rem;white-space:nowrap;">' +
                    '<input type="checkbox" class="custom-control-input ff-toggle" id="ff_' + esc(f.key) + '" data-key="' + esc(f.key) + '"' + (f.enabled ? " checked" : "") + '>' +
                    '<label class="custom-control-label" for="ff_' + esc(f.key) + '">' + (f.enabled ? "ON" : "OFF") + '</label></div></div>';
            });
            html += '</div></div>';
        });
        var box = $("ffContainer");
        box.innerHTML = html;
        box.classList.remove("d-none");
        $("ffLoading").classList.add("d-none");
        Array.prototype.forEach.call(box.querySelectorAll(".ff-toggle"), function (el) {
            el.addEventListener("change", function () { toggle(el); });
        });
    }

    async function load() {
        try {
            var res = await fetch(API + "?_=" + Date.now(), { credentials: "include" });
            var json = await res.json();
            if (!res.ok || json.status !== 200 || !json.data) throw new Error((json && json.message) || "Gagal memuat.");
            render(json.data);
        } catch (err) {
            $("ffLoading").innerHTML = '<div class="text-danger"><i class="fas fa-times-circle"></i> ' + esc(err.message || err) + "</div>";
        }
    }

    async function toggle(el) {
        var key = el.getAttribute("data-key");
        var enabled = el.checked;
        el.disabled = true;
        try {
            var res = await fetch(API, {
                method: "POST", credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: key, enabled: enabled }),
            });
            var json = await res.json();
            if (!res.ok || json.status !== 200) throw new Error((json && json.message) || "Gagal.");
            var lbl = el.parentNode.querySelector(".custom-control-label");
            if (lbl) lbl.textContent = enabled ? "ON" : "OFF";
            toast('<i class="fas fa-check-circle"></i> ' + esc(json.message), "success");
        } catch (err) {
            el.checked = !enabled; // rollback UI
            var lbl2 = el.parentNode.querySelector(".custom-control-label");
            if (lbl2) lbl2.textContent = el.checked ? "ON" : "OFF";
            toast('<i class="fas fa-times-circle"></i> ' + esc(err.message || err), "danger");
        } finally {
            el.disabled = false;
        }
    }

    document.addEventListener("DOMContentLoaded", load);
})();
