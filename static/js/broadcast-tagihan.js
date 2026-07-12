/**
 * Header Doc
 * Purpose: UI logic halaman /broadcast-tagihan ("Broadcast Terarah") — pilih template broadcast
 *          (tagihan / masa tenggang / isolir / selamat datang), muat daftar pelanggan dengan filter
 *          status (belum/sudah bayar, semua, terisolir, menunggak) + nominal & status HP, seleksi
 *          (search + pilih-semua), pratinjau pesan terisi, dan kirim. Kirim REUSE endpoint
 *          /api/broadcast (mesin broadcast + riwayat).
 * Caller: `views/sb-admin/broadcast-tagihan.php`.
 * Deps: jQuery/Bootstrap (dimuat di _head), SweetAlert2 global.
 * MainFuncs: loadTemplates, onTemplateChange, loadCustomers, renderCustomers, doPreview, doSend, loadHistory.
 * SideEffects: Fetch /api/broadcast-tagihan/{customers,templates,default-template,preview}, POST /api/broadcast, GET /api/broadcast/history.
 */
(function () {
    "use strict";

    let customers = [];
    const selected = new Set();

    let templates = [];               // [{id,label,key}]
    let currentTemplateId = "";       // id template terpilih
    let lastLoadedTemplateText = "";  // teks yang terakhir kita isikan otomatis (deteksi edit manual)

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

    function currentTemplateKey() {
        const t = templates.find((x) => x.id === currentTemplateId);
        return t ? t.key : "";
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
            // Nominal tunggakan hanya muncul di mode "menunggak" (server menyertakan c.outstanding).
            const arrearsBadge = (c.outstanding != null && Number(c.outstanding) > 0)
                ? ` <span class="badge badge-warning">Nunggak ${escapeHtml(rupiah(c.outstanding))}</span>`
                : "";
            return `<label class="d-flex align-items-center px-3 py-2 border-bottom" style="gap:0.6rem; margin:0; cursor:${noPhone ? "not-allowed" : "pointer"}; ${noPhone ? "opacity:0.7;" : ""}">
                <input type="checkbox" class="cust-cb" value="${escapeHtml(c.id)}" ${checked} ${noPhone ? "disabled" : ""}>
                <span style="flex:1;">
                    <strong>${escapeHtml(c.name)}</strong> ${paidBadge}${arrearsBadge}<br>
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

    // Muat daftar template ke dropdown, lalu isi editor dengan template pertama (default: tagihan).
    async function loadTemplates() {
        const resp = await apiFetch("/api/broadcast-tagihan/templates");
        templates = (resp.data && resp.data.data && resp.data.data.items) || [];
        const sel = el("template-select");
        if (!templates.length) {
            sel.innerHTML = '<option value="">(template tidak tersedia)</option>';
            return;
        }
        sel.innerHTML = templates.map((t) =>
            `<option value="${escapeHtml(t.id)}">${escapeHtml(t.label)}</option>`).join("");
        currentTemplateId = templates[0].id;
        sel.value = currentTemplateId;
        await loadTemplateText(currentTemplateId, { force: true });
    }

    // Ambil teks default template terpilih dan isikan ke editor. Bila admin sudah mengedit manual,
    // minta konfirmasi sebelum menimpa (kecuali force / editor masih berisi template yang kita isi).
    async function loadTemplateText(templateId, opts = {}) {
        const ta = el("text");
        const edited = ta.value.trim() && ta.value !== lastLoadedTemplateText;
        if (!opts.force && edited) {
            const confirm = await Swal.fire({
                icon: "warning",
                title: "Ganti template?",
                text: "Kotak pesan sudah Anda ubah. Ganti template akan menimpa isinya.",
                showCancelButton: true,
                confirmButtonText: "Ganti",
                cancelButtonText: "Batal"
            });
            if (!confirm.isConfirmed) {
                // kembalikan dropdown ke template sebelumnya
                el("template-select").value = currentTemplateId;
                return;
            }
        }
        const resp = await apiFetch(`/api/broadcast-tagihan/default-template?template=${encodeURIComponent(templateId)}`);
        const text = (resp.data && resp.data.data && resp.data.data.text) || "";
        ta.value = text;
        lastLoadedTemplateText = text;
        currentTemplateId = templateId;
        el("preview-box").style.display = "none";
    }

    function onTemplateChange() {
        const id = el("template-select").value;
        if (!id || id === currentTemplateId) return;
        loadTemplateText(id);
    }

    async function doPreview() {
        const ids = [...selected];
        if (!ids.length) {
            Swal.fire({ icon: "warning", title: "Pilih pelanggan", text: "Pilih minimal 1 pelanggan untuk pratinjau." });
            return;
        }
        const resp = await apiFetch("/api/broadcast-tagihan/preview", {
            method: "POST",
            body: JSON.stringify({ user_id: ids[0], text: el("text").value, template: currentTemplateId })
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
            Swal.fire({ icon: "warning", title: "Pesan kosong", text: "Tulis / pilih template pesan dulu." });
            return;
        }
        const templateLabel = (templates.find((t) => t.id === currentTemplateId) || {}).label || "pesan";
        const confirm = await Swal.fire({
            icon: "question",
            title: "Kirim broadcast?",
            html: `Kirim <strong>${escapeHtml(templateLabel)}</strong> ke <strong>${ids.length}</strong> pelanggan terpilih?<br><small class="text-muted">Pelanggan tanpa HP otomatis dilewati.</small>`,
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
                // Key template terpilih — dicatat di riwayat broadcast (audit). Teks final tetap dari `text`.
                template_key: currentTemplateKey() || undefined,
                mode: "manual",
                // Broadcast terarah = komunikasi esensial yang admin pilih sadar → abaikan opt-out info-gangguan.
                force_include_opt_out: true
            })
        });
        if (resp.status === 202 || resp.ok) {
            Swal.fire({ icon: "success", title: "Terkirim", text: (resp.data && resp.data.message) || "Broadcast dimulai." });
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
        el("template-select").addEventListener("change", onTemplateChange);
        el("preview-btn").addEventListener("click", doPreview);
        el("send-btn").addEventListener("click", doSend);
        loadCustomers();
        loadTemplates();
        loadHistory();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
