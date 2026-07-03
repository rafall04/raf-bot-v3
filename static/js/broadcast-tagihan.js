/**
 * Header Doc
 * Purpose: UI logic halaman /broadcast-tagihan — muat daftar pelanggan (belum bayar/semua) dengan
 *          nominal & status HP, seleksi (search + pilih-semua), pratinjau pesan tagihan (link+nominal
 *          terisi), dan kirim. Kirim REUSE endpoint /api/broadcast (mesin broadcast + riwayat).
 * Caller: `views/sb-admin/broadcast-tagihan.php`.
 * Deps: jQuery/Bootstrap (dimuat di _head), SweetAlert2 global.
 * MainFuncs: loadCustomers, renderCustomers, doPreview, doSend, loadHistory.
 * SideEffects: Fetch /api/broadcast-tagihan/{customers,default-template,preview}, POST /api/broadcast, GET /api/broadcast/history.
 */
(function () {
    "use strict";

    let customers = [];
    const selected = new Set();

    const el = (id) => document.getElementById(id);

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    function rupiah(n) {
        return "Rp " + Number(n || 0).toLocaleString("id-ID");
    }

    async function apiFetch(url, options = {}) {
        const res = await fetch(url, {
            credentials: "include",
            headers: { "Content-Type": "application/json", ...(options.headers || {}) },
            ...options
        });
        let data = {};
        try { data = await res.json(); } catch (_e) { /* non-json */ }
        return { ok: res.ok, status: res.status, data };
    }

    function filteredCustomers() {
        const q = el("customer-search").value.trim().toLowerCase();
        if (!q) return customers;
        return customers.filter((c) =>
            (`${c.name} ${c.phone_number} ${c.subscription}`).toLowerCase().includes(q));
    }

    function updateCounts() {
        el("selected-count").textContent = selected.size;
        el("total-count").textContent = customers.length;
        const noPhone = customers.filter((c) => !c.has_phone).length;
        el("nophone-note").textContent = noPhone
            ? ` · ${noPhone} tanpa HP (tak bisa dikirim sampai No HP diisi).`
            : "";
    }

    function renderCustomers() {
        const list = filteredCustomers();
        const box = el("customer-list");
        if (!list.length) {
            box.innerHTML = '<div class="text-center text-muted p-3">Tidak ada pelanggan.</div>';
            updateCounts();
            return;
        }
        box.innerHTML = list.map((c) => {
            const checked = selected.has(String(c.id)) ? "checked" : "";
            const noPhone = !c.has_phone;
            const phoneBadge = c.has_phone
                ? `<span class="badge badge-light">${escapeHtml(c.phone_number)}</span>`
                : '<span class="badge badge-warning">Tanpa HP — isi dulu</span>';
            const paidBadge = c.paid
                ? '<span class="badge badge-success">Lunas</span>'
                : '<span class="badge badge-danger">Belum bayar</span>';
            return `<label class="d-flex align-items-center px-3 py-2 border-bottom" style="gap:0.6rem; margin:0; cursor:${noPhone ? "not-allowed" : "pointer"}; ${noPhone ? "opacity:0.7;" : ""}">
                <input type="checkbox" class="cust-cb" value="${escapeHtml(c.id)}" ${checked} ${noPhone ? "disabled" : ""}>
                <span style="flex:1;">
                    <strong>${escapeHtml(c.name)}</strong> ${paidBadge}<br>
                    <small class="text-muted">${escapeHtml(c.subscription || "-")} · ${rupiah(c.price)} · </small>${phoneBadge}
                </span>
            </label>`;
        }).join("");
        box.querySelectorAll(".cust-cb").forEach((cb) => {
            cb.addEventListener("change", () => {
                if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
                updateCounts();
            });
        });
        updateCounts();
    }

    async function loadCustomers() {
        const status = el("status-filter").value;
        el("customer-list").innerHTML = '<div class="text-center text-muted p-3">Memuat daftar pelanggan…</div>';
        const resp = await apiFetch(`/api/broadcast-tagihan/customers?status=${encodeURIComponent(status)}`);
        customers = (resp.data && resp.data.data && resp.data.data.items) || [];
        // buang pilihan yang tak lagi ada di daftar
        [...selected].forEach((id) => {
            if (!customers.some((c) => String(c.id) === id)) selected.delete(id);
        });
        renderCustomers();
    }

    function checkAllFiltered() {
        filteredCustomers().filter((c) => c.has_phone).forEach((c) => selected.add(String(c.id)));
        renderCustomers();
    }

    function clearAll() {
        selected.clear();
        renderCustomers();
    }

    async function loadDefaultTemplate() {
        const resp = await apiFetch("/api/broadcast-tagihan/default-template");
        const text = (resp.data && resp.data.data && resp.data.data.text) || "";
        const ta = el("text");
        if (ta && !ta.value.trim()) ta.value = text;
    }

    async function doPreview() {
        const ids = [...selected];
        if (!ids.length) {
            Swal.fire({ icon: "warning", title: "Pilih pelanggan", text: "Pilih minimal 1 pelanggan untuk pratinjau." });
            return;
        }
        const resp = await apiFetch("/api/broadcast-tagihan/preview", {
            method: "POST",
            body: JSON.stringify({ user_id: ids[0], text: el("text").value })
        });
        if (!resp.ok) {
            Swal.fire({ icon: "error", title: "Pratinjau gagal", text: (resp.data && resp.data.message) || "Gagal memuat pratinjau." });
            return;
        }
        const d = resp.data.data;
        el("preview-name").textContent = d.user.name + (d.user.has_phone ? "" : " (TANPA HP)");
        el("preview-text").textContent = d.message;
        el("preview-box").style.display = "block";
    }

    async function doSend() {
        const ids = [...selected];
        if (!ids.length) {
            Swal.fire({ icon: "warning", title: "Belum ada penerima", text: "Pilih pelanggan dulu." });
            return;
        }
        const text = el("text").value.trim();
        if (!text) {
            Swal.fire({ icon: "warning", title: "Pesan kosong", text: "Tulis pesan tagihan dulu." });
            return;
        }
        const confirm = await Swal.fire({
            icon: "question",
            title: "Kirim tagihan?",
            html: `Kirim pesan tagihan ke <strong>${ids.length}</strong> pelanggan terpilih?<br><small class="text-muted">Pelanggan tanpa HP otomatis dilewati.</small>`,
            showCancelButton: true,
            confirmButtonText: "Kirim",
            cancelButtonText: "Batal"
        });
        if (!confirm.isConfirmed) return;

        const resp = await apiFetch("/api/broadcast", {
            method: "POST",
            body: JSON.stringify({
                users: ids,
                text,
                template_key: "broadcast_tagihan",
                mode: "manual",
                // Tagihan = komunikasi esensial → abaikan opt-out info-gangguan (notify_outage).
                force_include_opt_out: true
            })
        });
        if (resp.status === 202 || resp.ok) {
            Swal.fire({ icon: "success", title: "Terkirim", text: (resp.data && resp.data.message) || "Broadcast tagihan dimulai." });
            selected.clear();
            renderCustomers();
            setTimeout(loadHistory, 3000);
        } else {
            Swal.fire({ icon: "error", title: "Gagal", text: (resp.data && resp.data.message) || "Gagal mengirim broadcast." });
        }
    }

    async function loadHistory() {
        const resp = await apiFetch("/api/broadcast/history?limit=20");
        const raw = resp.data && resp.data.data;
        const rows = Array.isArray(raw) ? raw : (raw && raw.items) || [];
        const tbody = el("history-tbody");
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Belum ada riwayat.</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map((r) => `<tr>
            <td>${escapeHtml(r.finished_at || r.started_at || "")}</td>
            <td>${escapeHtml(r.operator || "")}</td>
            <td>${escapeHtml(r.template_key || "-")}</td>
            <td class="text-right">${r.total_targets || 0}</td>
            <td class="text-right text-success">${r.total_sent || 0}</td>
            <td class="text-right text-danger">${r.total_failed || 0}</td>
        </tr>`).join("");
    }

    function init() {
        el("status-filter").addEventListener("change", loadCustomers);
        el("customer-search").addEventListener("input", renderCustomers);
        el("check-all").addEventListener("click", checkAllFiltered);
        el("clear-all").addEventListener("click", clearAll);
        el("preview-btn").addEventListener("click", doPreview);
        el("send-btn").addEventListener("click", doSend);
        loadCustomers();
        loadDefaultTemplate();
        loadHistory();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
