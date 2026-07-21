/**
 * Header Doc
 * Purpose: UI logic halaman /broadcast — template preset, mode targeting (ODP/ODC/paket/notify/manual), preview, kirim, dan riwayat.
 * Caller: `views/sb-admin/broadcast.php`.
 * Deps: jQuery (sudah dimuat di _head), Bootstrap, SweetAlert2 global, fstdropdown.
 * MainFuncs: setupForm, fetchUsers, renderFilterOptions, applyTemplate, doPreview, doSend, loadHistory.
 * SideEffects: Fetch /api/users, /api/templates, /api/broadcast/preview, /api/broadcast, /api/broadcast/history.
 */
(function () {
    "use strict";

    let allUsers = [];
    let templateCache = {};

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function uniqueSorted(values) {
        return [...new Set(values.filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b));
    }

    function getModeEl() { return document.getElementById("target-mode"); }
    function getFilterRow() { return document.getElementById("filter-row"); }
    function getFilterEl() { return document.getElementById("target-filter"); }
    function getManualSection() { return document.getElementById("manual-target-section"); }
    function getManualListEl() { return document.getElementById("manual-user-list"); }
    function getManualSearchEl() { return document.getElementById("manual-search"); }
    function getManualCountEl() { return document.getElementById("manual-selected-count"); }
    function getManualTotalEl() { return document.getElementById("manual-total-count"); }
    function getTextEl() { return document.getElementById("text"); }
    function getTemplatePresetEl() { return document.getElementById("template-preset"); }
    function getForceEl() { return document.getElementById("force-include-opt-out"); }

    const selectedManualIds = new Set();

    function renderFilterOptions(mode) {
        const select = getFilterEl();
        if (!select) return;
        let options = [];
        if (mode === "odp") {
            options = uniqueSorted(allUsers.map((u) => u.connected_odp_id || u.odp)).map((v) => ({
                value: v,
                label: `${v} (${allUsers.filter((u) => (u.connected_odp_id || u.odp) === v).length} pelanggan)`
            }));
        } else if (mode === "odc") {
            options = uniqueSorted(allUsers.map((u) => u.odc)).map((v) => ({
                value: v,
                label: `${v} (${allUsers.filter((u) => u.odc === v).length} pelanggan)`
            }));
        } else if (mode === "package") {
            options = uniqueSorted(allUsers.map((u) => u.subscription || u.package)).map((v) => ({
                value: v,
                label: `${v} (${allUsers.filter((u) => (u.subscription || u.package) === v).length} pelanggan)`
            }));
        }
        select.innerHTML = `<option value="">-- Pilih ${mode.toUpperCase()} --</option>` +
            options.map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`).join("");
    }

    function onModeChange() {
        const mode = getModeEl().value;
        const filterRow = getFilterRow();
        const manualSection = getManualSection();
        const needsFilter = mode === "odp" || mode === "odc" || mode === "package";
        filterRow.style.display = needsFilter ? "" : "none";
        manualSection.style.display = mode === "manual" ? "" : "none";
        if (needsFilter) renderFilterOptions(mode);
        if (mode === "manual") renderManualList();
    }

    function filterUsers(query) {
        const q = String(query || "").trim().toLowerCase();
        if (!q) return allUsers;
        return allUsers.filter((u) => {
            const haystack = [
                u.name, u.phone_number, u.address, u.subscription, u.package,
                u.connected_odp_id, u.odp, u.odc, u.pppoe_username
            ].filter(Boolean).join(" ").toLowerCase();
            return haystack.includes(q);
        });
    }

    function updateManualCount() {
        const countEl = getManualCountEl();
        if (countEl) countEl.textContent = String(selectedManualIds.size);
    }

    function renderManualList() {
        const list = getManualListEl();
        if (!list) return;
        const query = getManualSearchEl() ? getManualSearchEl().value : "";
        const filtered = filterUsers(query);
        const totalEl = getManualTotalEl();
        if (totalEl) totalEl.textContent = String(filtered.length);

        if (filtered.length === 0) {
            list.innerHTML = '<div class="p-3 text-center text-muted">Tidak ada pelanggan cocok.</div>';
            return;
        }
        // Render baris ringan — checkbox + nama + meta. Maks ~500 baris ringan untuk DOM.
        const visible = filtered.slice(0, 500);
        list.innerHTML = visible.map((u) => {
            const id = String(u.id);
            const checked = selectedManualIds.has(id) ? "checked" : "";
            const meta = [u.phone_number, u.connected_odp_id || u.odp, u.subscription]
                .filter(Boolean).map(escapeHtml).join(" · ");
            return `
                <label class="d-flex align-items-center px-2 py-1 manual-user-row" style="border-bottom: 1px solid var(--border-color, #e5e7eb); cursor: pointer; margin: 0;">
                    <input type="checkbox" class="manual-user-check mr-2" value="${escapeHtml(id)}" ${checked}>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 500;">${escapeHtml(u.name || u.id)}</div>
                        ${meta ? `<div class="small text-muted" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${meta}</div>` : ""}
                    </div>
                </label>
            `;
        }).join("") + (filtered.length > visible.length
            ? `<div class="p-2 text-center small text-muted">Menampilkan ${visible.length} dari ${filtered.length} hasil. Persempit pencarian untuk lihat sisanya.</div>`
            : "");
    }

    function onManualListClick(event) {
        const target = event.target;
        if (!target || target.tagName !== "INPUT" || !target.classList.contains("manual-user-check")) return;
        if (target.checked) selectedManualIds.add(target.value);
        else selectedManualIds.delete(target.value);
        updateManualCount();
    }

    function onManualSearch() {
        renderManualList();
    }

    function onManualCheckAll() {
        const query = getManualSearchEl() ? getManualSearchEl().value : "";
        filterUsers(query).forEach((u) => selectedManualIds.add(String(u.id)));
        updateManualCount();
        renderManualList();
    }

    function onManualClear() {
        selectedManualIds.clear();
        updateManualCount();
        renderManualList();
    }

    function getSelectedManualUserIds() {
        return Array.from(selectedManualIds);
    }

    function collectPayload() {
        const mode = getModeEl().value;
        const payload = {
            mode,
            text: getTextEl().value,
            template_key: getTemplatePresetEl().value || null,
            force_include_opt_out: getForceEl().checked
        };
        if (mode === "odp" || mode === "odc" || mode === "package") {
            payload.filter = getFilterEl().value;
        }
        if (mode === "manual") {
            payload.users = getSelectedManualUserIds();
        }
        return payload;
    }

    async function fetchJson(url, options = {}) {
        const response = await fetch(url, {
            credentials: "include",
            headers: { "Content-Type": "application/json", ...(options.headers || {}) },
            ...options
        });
        const data = await response.json().catch(() => ({}));
        return { ok: response.ok, status: response.status, data };
    }

    async function fetchUsers() {
        const { ok, data } = await fetchJson("/api/users");
        if (!ok || !Array.isArray(data.data)) {
            console.warn("[BROADCAST_UI] Gagal memuat daftar pelanggan", data);
            allUsers = [];
            return;
        }
        allUsers = data.data;
        // Sort by name untuk daftar manual.
        allUsers.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
        updateManualCount();
        onModeChange();
    }

    async function fetchTemplates() {
        const { ok, data } = await fetchJson("/api/templates");
        if (!ok) return;
        templateCache = (data && data.responseTemplates) || (data && data.data && data.data.responseTemplates) || {};
    }

    function applyTemplatePreset() {
        const key = getTemplatePresetEl().value;
        if (!key) return;
        const entry = templateCache[key];
        const tpl = entry && (entry.template || entry.content || entry);
        if (typeof tpl === "string" && tpl.trim()) {
            getTextEl().value = tpl;
        }
    }

    function renderPreviewList(data) {
        const sample = (data && data.sample) || [];
        if (sample.length === 0) return '<p class="text-muted">Tidak ada penerima pada segmen ini.</p>';
        const rows = sample.map((u) => `
            <tr>
                <td>${escapeHtml(u.name || "")}</td>
                <td>${escapeHtml(u.phone_number || "")}</td>
                <td>${escapeHtml(u.odp || "")}</td>
                <td>${escapeHtml(u.subscription || "")}</td>
            </tr>
        `).join("");
        return `
            <p class="mb-2">
                Total target: <strong>${data.total_targets}</strong>
                ${data.opt_out_excluded ? ` &middot; Dikecualikan (opt-out): <strong>${data.opt_out_excluded}</strong>` : ""}
            </p>
            <div style="max-height: 280px; overflow-y: auto;">
                <table class="table table-sm table-bordered">
                    <thead><tr><th>Nama</th><th>HP</th><th>ODP</th><th>Paket</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
                ${sample.length < data.total_targets ? `<small class="text-muted">Menampilkan ${sample.length} dari ${data.total_targets} pelanggan.</small>` : ""}
            </div>
        `;
    }

    async function doPreview() {
        const payload = collectPayload();
        const { ok, data } = await fetchJson("/api/broadcast/preview", {
            method: "POST",
            body: JSON.stringify(payload)
        });
        if (!ok) {
            Swal.fire({ icon: "error", title: "Preview gagal", text: (data && data.message) || "Tidak dapat memuat preview." });
            return;
        }
        Swal.fire({
            title: "Preview Penerima",
            html: renderPreviewList(data.data),
            width: 720,
            confirmButtonText: "Tutup"
        });
    }

    async function doSend() {
        const payload = collectPayload();
        if (!String(payload.text || "").trim()) {
            Swal.fire({ icon: "warning", title: "Pesan kosong", text: "Tulis pesan atau pilih template terlebih dahulu." });
            return;
        }
        const previewResp = await fetchJson("/api/broadcast/preview", {
            method: "POST",
            body: JSON.stringify(payload)
        });
        if (!previewResp.ok) {
            Swal.fire({ icon: "error", title: "Validasi gagal", text: (previewResp.data && previewResp.data.message) || "Tidak dapat memvalidasi target." });
            return;
        }
        const total = previewResp.data.data.total_targets;
        if (total === 0) {
            Swal.fire({ icon: "warning", title: "Tidak ada penerima", text: "Tidak ada pelanggan yang cocok dengan kriteria." });
            return;
        }
        const confirm = await Swal.fire({
            icon: "question",
            title: "Konfirmasi broadcast",
            html: `<p>Akan mengirim ke <strong>${total}</strong> pelanggan. Lanjutkan?</p>${payload.force_include_opt_out ? '<p class="text-danger small">⚠️ Mode KIRIM PAKSA aktif — pelanggan opt-out tetap menerima.</p>' : ""}`,
            showCancelButton: true,
            confirmButtonText: "Ya, kirim sekarang",
            cancelButtonText: "Batal"
        });
        if (!confirm.isConfirmed) return;

        const sendBtn = document.getElementById("send-btn");
        const originalLabel = sendBtn.innerHTML;
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Mengirim...';
        try {
            const { ok, data } = await fetchJson("/api/broadcast", {
                method: "POST",
                body: JSON.stringify(payload)
            });
            if (!ok) {
                throw new Error((data && data.message) || "Broadcast gagal.");
            }
            Swal.fire({
                icon: "success",
                title: "Broadcast dimulai",
                text: data.message || `Broadcast untuk ${total} pelanggan dijalankan di latar belakang.`,
                timer: 3500,
                showConfirmButton: false
            });
            setTimeout(loadHistory, 1500);
        } catch (error) {
            Swal.fire({ icon: "error", title: "Gagal", text: error.message || "Terjadi kesalahan." });
        } finally {
            sendBtn.disabled = false;
            sendBtn.innerHTML = originalLabel;
        }
    }

    function formatTime(value) {
        if (!value) return "";
        try {
            return new Date(value).toLocaleString("id-ID", { hour12: false });
        } catch (_err) {
            return value;
        }
    }

    async function loadHistory() {
        const tbody = document.getElementById("history-tbody");
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Memuat riwayat...</td></tr>';
        const { ok, data } = await fetchJson("/api/broadcast/history?limit=50");
        if (!ok) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">Gagal memuat riwayat.</td></tr>';
            return;
        }
        const items = (data && data.data && data.data.items) || [];
        if (items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Belum ada broadcast.</td></tr>';
            return;
        }
        tbody.innerHTML = items.map((row) => `
            <tr>
                <td>${escapeHtml(formatTime(row.started_at))}</td>
                <td>${escapeHtml(row.operator || "-")}</td>
                <td>${escapeHtml(row.mode || "-")}</td>
                <td>${escapeHtml(row.filter || "-")}</td>
                <td>${escapeHtml(row.template_key || "(manual)")}</td>
                <td class="text-right">${row.total_targets || 0}</td>
                <td class="text-right text-success">${row.total_sent || 0}</td>
                <td class="text-right ${row.total_failed ? "text-danger" : ""}">${row.total_failed || 0}</td>
            </tr>
        `).join("");
    }

    document.addEventListener("DOMContentLoaded", async () => {
        getModeEl().addEventListener("change", onModeChange);
        getTemplatePresetEl().addEventListener("change", applyTemplatePreset);
        document.getElementById("preview-btn").addEventListener("click", doPreview);
        document.getElementById("send-btn").addEventListener("click", doSend);

        // Manual mode: search + checkbox list controls
        const searchEl = getManualSearchEl();
        if (searchEl) searchEl.addEventListener("input", onManualSearch);
        const listEl = getManualListEl();
        if (listEl) listEl.addEventListener("change", onManualListClick);
        const checkAllBtn = document.getElementById("manual-check-all");
        if (checkAllBtn) checkAllBtn.addEventListener("click", onManualCheckAll);
        const clearBtn = document.getElementById("manual-clear");
        if (clearBtn) clearBtn.addEventListener("click", onManualClear);

        await Promise.all([fetchUsers(), fetchTemplates()]);

        // Datang dari peta jaringan: `/broadcast?mode=odp&target=<id>` langsung memilihkan sasaran.
        // Sengaja BERHENTI di layar tulis pesan — mengirim langsung dari satu klik di peta terlalu
        // mudah meleset, dan pesan ke pelanggan tak bisa ditarik kembali.
        const q = new URLSearchParams(window.location.search);
        const modeAwal = q.get("mode");
        const targetAwal = q.get("target");
        if (modeAwal && Array.from(getModeEl().options).some((o) => o.value === modeAwal)) {
            getModeEl().value = modeAwal;
            onModeChange();
            if (targetAwal) {
                const filterEl = getFilterEl();
                if (filterEl && Array.from(filterEl.options).some((o) => o.value === targetAwal)) {
                    filterEl.value = targetAwal;
                }
            }
        }

        loadHistory();
    });
})();
