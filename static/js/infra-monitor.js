/**
 * Header Doc
 * Purpose: Logika halaman Monitor Infrastruktur — menampilkan status modem PPPoE yang
 *          ditandai account_type='infrastruktur' (mis. modem CCTV/monitoring) dengan
 *          memakai ulang endpoint OLT yang sudah ada (/api/olt/matched).
 * Caller: views/sb-admin/infra-monitor.php.
 * Deps: jQuery (sudah dimuat halaman), endpoint GET /api/olt/matched.
 * MainFuncs: loadInfraData, renderRows, renderSummary, statusBadge.
 * SideEffects: Polling backend OLT (read-only) untuk merefresh tampilan; tidak menulis DB.
 */
/* global $ */
(function () {
    "use strict";

    let autoRefreshTimer = null;
    const AUTO_REFRESH_MS = 60000; // 60 detik

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function isInfra(row) {
        return String(row && row.account_type ? row.account_type : "").toLowerCase() === "infrastruktur";
    }

    // Status efektif: Dying Gasp > LOS > Online > Offline.
    function classifyStatus(row) {
        if (row.is_dying_gasp) return { key: "dying", label: "Dying Gasp", badge: "badge-danger" };
        if (row.is_los) return { key: "los", label: "LOS", badge: "badge-warning" };
        const s = String(row.olt_status || "").toLowerCase();
        if (s === "online") return { key: "online", label: "Online", badge: "badge-success" };
        return { key: "offline", label: row.olt_status || "Offline", badge: "badge-secondary" };
    }

    function statusBadge(row) {
        const c = classifyStatus(row);
        return `<span class="badge ${c.badge}">${escapeHtml(c.label)}</span>`;
    }

    // Redaman buruk bila lebih negatif dari -27 dBm (ambang umum; sekadar penanda visual).
    function renderRedaman(rxPower) {
        if (rxPower == null || rxPower === "N/A" || rxPower === "") {
            return '<span class="text-muted">N/A</span>';
        }
        const num = parseFloat(String(rxPower).match(/-?\d+(\.\d+)?/));
        const text = escapeHtml(rxPower);
        if (!Number.isNaN(num) && num <= -27) {
            return `<span class="text-danger font-weight-bold" title="Redaman lemah">${text} dBm</span>`;
        }
        return `${text}${String(rxPower).includes("dBm") ? "" : " dBm"}`;
    }

    function renderSummary(rows) {
        let online = 0;
        let down = 0;
        let badRx = 0;
        rows.forEach((row) => {
            const c = classifyStatus(row);
            if (c.key === "online") online += 1;
            else down += 1;
            const num = parseFloat(String(row.rx_power).match(/-?\d+(\.\d+)?/));
            if (!Number.isNaN(num) && num <= -27) badRx += 1;
        });
        $("#infraTotal").text(rows.length);
        $("#infraOnline").text(online);
        $("#infraDown").text(down);
        $("#infraBadRx").text(badRx);
    }

    function renderRows(rows) {
        const tbody = $("#infraTableBody");
        if (!rows.length) {
            tbody.html(
                '<tr><td colspan="7" class="text-center text-muted py-4">' +
                'Belum ada akun infrastruktur. Tandai modem (mis. CCTV) sebagai <strong>Infrastruktur</strong> ' +
                'di menu <a href="/users">Data Pelanggan</a> (tab Infrastruktur/CCTV).' +
                "</td></tr>"
            );
            return;
        }

        // Yang bermasalah (down/LOS/dying) didahulukan agar gampang di-troubleshoot.
        const sorted = rows.slice().sort((a, b) => {
            const rank = (r) => (classifyStatus(r).key === "online" ? 1 : 0);
            return rank(a) - rank(b);
        });

        const html = sorted.map((row) => {
            const name = escapeHtml(row.customer_name || "(tanpa nama)");
            const pppoe = escapeHtml(row.pppoe_username || "-");
            const pon = escapeHtml(row.pon_name || "-");
            const olt = escapeHtml(row.olt_name || "-");
            const cause = escapeHtml(row.last_down_cause || row.log_event || "-");
            return (
                "<tr>" +
                `<td>${name} <span class="badge badge-dark" title="Akun infrastruktur">INFRA</span></td>` +
                `<td><code>${pppoe}</code></td>` +
                `<td>${statusBadge(row)}</td>` +
                `<td>${renderRedaman(row.rx_power)}</td>` +
                `<td>${pon}</td>` +
                `<td>${olt}</td>` +
                `<td>${cause}</td>` +
                "</tr>"
            );
        }).join("");
        tbody.html(html);
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
        setStatus("Memuat status dari OLT...", "info");

        fetch(`/api/olt/matched?_=${new Date().getTime()}`, { credentials: "include" })
            .then((res) => res.json())
            .then((result) => {
                const all = Array.isArray(result.data) ? result.data : [];
                const rows = all.filter(isInfra);
                renderSummary(rows);
                renderRows(rows);
                $("#lastUpdateTime").text("Diperbarui " + new Date().toLocaleTimeString("id-ID"));
                if (rows.length === 0) {
                    setStatus("Belum ada akun yang ditandai infrastruktur.", "info");
                } else {
                    $("#infraStatusAlert").hide();
                }
            })
            .catch((err) => {
                console.error("[infra-monitor] gagal memuat:", err);
                setStatus("Gagal memuat data OLT: " + err.message, "danger");
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
    });
})();
