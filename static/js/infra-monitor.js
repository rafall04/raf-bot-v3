/**
 * Header Doc
 * Purpose: Logika halaman Monitor Infrastruktur — status modem PPPoE yang ditandai
 *          account_type='infrastruktur' (mis. modem CCTV/monitoring). Sumber: endpoint
 *          khusus GET /api/olt/infra-status yang menggabungkan status PPPoE online/offline
 *          (MikroTik, sinyal utama) + enrichment redaman/LOS dari OLT. Tiap modem infra
 *          dijamin muncul (termasuk yang sedang mati / tak ke-match OLT).
 * Caller: views/sb-admin/infra-monitor.php.
 * Deps: jQuery (sudah dimuat halaman), endpoint GET /api/olt/infra-status.
 * MainFuncs: loadInfraData, render, renderSummary, applyFilters.
 * SideEffects: Polling backend (read-only) untuk merefresh tampilan; tidak menulis DB.
 */
/* global $ */
(function () {
    "use strict";

    let autoRefreshTimer = null;
    let allRows = [];                 // data terakhir dari server (semua akun infra)
    let currentStatusFilter = "all";  // all | online | offline | los | dying
    let currentSearch = "";
    const AUTO_REFRESH_MS = 60000; // 60 detik

    const STATUS_META = {
        online: { label: "Online", badge: "badge-success" },
        los: { label: "LOS", badge: "badge-danger" },
        dying: { label: "Dying Gasp", badge: "badge-warning" },
        offline: { label: "Offline", badge: "badge-secondary" }
    };

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function statusMeta(key) {
        return STATUS_META[key] || STATUS_META.offline;
    }

    function rxNumeric(rx) {
        if (rx == null || rx === "N/A" || rx === "") return NaN;
        const m = String(rx).match(/-?\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : NaN;
    }

    // Redaman buruk bila lebih negatif dari -27 dBm (penanda visual).
    function renderRedaman(rx) {
        const num = rxNumeric(rx);
        if (Number.isNaN(num)) return '<span class="text-muted">N/A</span>';
        const text = escapeHtml(rx);
        const withUnit = String(rx).includes("dBm") ? text : text + " dBm";
        if (num <= -27) {
            return `<span class="text-danger font-weight-bold" title="Redaman lemah">${withUnit}</span>`;
        }
        return withUnit;
    }

    function applyFilters(rows) {
        const q = currentSearch.trim().toLowerCase();
        return rows.filter((r) => {
            if (currentStatusFilter !== "all" && r.status_key !== currentStatusFilter) return false;
            if (!q) return true;
            return [r.name, r.pppoe_username, r.ip, r.olt_name].map((v) => String(v || "").toLowerCase()).join(" ").includes(q);
        });
    }

    function renderSummary(rows) {
        let online = 0;
        let down = 0;
        let badRx = 0;
        rows.forEach((r) => {
            if (r.status_key === "online") online += 1;
            else down += 1;
            const num = rxNumeric(r.rx_power);
            if (!Number.isNaN(num) && num <= -27) badRx += 1;
        });
        $("#infraTotal").text(rows.length);
        $("#infraOnline").text(online);
        $("#infraDown").text(down);
        $("#infraBadRx").text(badRx);
    }

    function pppoeCell(r) {
        const pppoe = escapeHtml(r.pppoe_username || "-");
        const ip = r.pppoe_status === "online" && r.ip ? `<br><small class="text-muted">${escapeHtml(r.ip)}</small>` : "";
        return `<code>${pppoe}</code>${ip}`;
    }

    function statusCell(r) {
        const meta = statusMeta(r.status_key);
        const nonOlt = r.in_olt ? "" : ' <small class="text-muted" title="Tidak ditemukan di OLT (status dari PPPoE saja)">·non-OLT</small>';
        return `<span class="badge ${meta.badge}">${meta.label}</span>${nonOlt}`;
    }

    function renderTable() {
        const tbody = $("#infraTableBody");
        if (!allRows.length) {
            tbody.html(
                '<tr><td colspan="7" class="text-center text-muted py-4">' +
                'Belum ada akun infrastruktur. Tandai modem (mis. CCTV) sebagai <strong>Infrastruktur</strong> ' +
                'di menu <a href="/users">Data Pelanggan</a> (tab Infrastruktur/CCTV).' +
                "</td></tr>"
            );
            return;
        }

        const filtered = applyFilters(allRows);
        if (!filtered.length) {
            tbody.html('<tr><td colspan="7" class="text-center text-muted py-4">Tidak ada modem yang cocok dengan filter.</td></tr>');
            return;
        }

        // Yang bermasalah (offline/LOS/dying) didahulukan agar gampang di-troubleshoot.
        const sorted = filtered.slice().sort((a, b) => {
            const rank = (r) => (r.status_key === "online" ? 1 : 0);
            return rank(a) - rank(b);
        });

        const html = sorted.map((r) => {
            const name = escapeHtml(r.name || "(tanpa nama)");
            return (
                "<tr>" +
                `<td>${name} <span class="badge badge-dark" title="Akun infrastruktur">INFRA</span></td>` +
                `<td>${pppoeCell(r)}</td>` +
                `<td>${statusCell(r)}</td>` +
                `<td>${renderRedaman(r.rx_power)}</td>` +
                `<td>${escapeHtml(r.pon_name || "-")}</td>` +
                `<td>${escapeHtml(r.olt_name || "-")}</td>` +
                `<td>${escapeHtml(r.last_down_cause || "-")}</td>` +
                "</tr>"
            );
        }).join("");
        tbody.html(html);
    }

    function render() {
        renderSummary(allRows); // ringkasan selalu atas SEMUA infra (bukan hasil filter)
        renderTable();
    }

    function setStatus(message, type) {
        const el = $("#infraStatusAlert");
        el.removeClass("alert-info alert-danger alert-success").addClass("alert-" + (type || "info"));
        $("#infraStatusMessage").text(message);
        el.show();
    }

    function loadInfraData() {
        const btn = $("#refreshInfraBtn");
        btn.prop("disabled", true).html('<i class="fas fa-sync-alt fa-spin"></i> Memuat...');
        setStatus("Memuat status dari MikroTik & OLT...", "info");

        fetch(`/api/olt/infra-status?_=${new Date().getTime()}`, { credentials: "include" })
            .then((res) => res.json())
            .then((result) => {
                allRows = Array.isArray(result.data) ? result.data : [];
                render();
                $("#lastUpdateTime").text("Diperbarui " + new Date().toLocaleTimeString("id-ID"));
                if (allRows.length === 0) {
                    setStatus("Belum ada akun yang ditandai infrastruktur.", "info");
                } else if (result.oltEnabled === false) {
                    setStatus("Status dari PPPoE MikroTik. (Enrichment OLT/redaman tidak tersedia saat ini.)", "info");
                } else {
                    $("#infraStatusAlert").hide();
                }
            })
            .catch((err) => {
                console.error("[infra-monitor] gagal memuat:", err);
                setStatus("Gagal memuat data: " + err.message, "danger");
            })
            .finally(() => {
                btn.prop("disabled", false).html('<i class="fas fa-sync-alt"></i> Refresh');
            });
    }

    function setAutoRefresh(enabled) {
        if (autoRefreshTimer) {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
        }
        if (enabled) {
            autoRefreshTimer = setInterval(loadInfraData, AUTO_REFRESH_MS);
        }
    }

    $(function () {
        loadInfraData();
        $("#refreshInfraBtn").on("click", loadInfraData);
        $("#autoRefreshToggle").on("change", function () {
            setAutoRefresh($(this).is(":checked"));
        });
        $("#infraSearch").on("input", function () {
            currentSearch = $(this).val() || "";
            renderTable();
        });
        $("#infraStatusFilter").on("change", function () {
            currentStatusFilter = $(this).val() || "all";
            renderTable();
        });
    });
})();
