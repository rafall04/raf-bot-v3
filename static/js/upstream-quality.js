/**
 * Header Doc
 * Purpose: Frontend halaman /upstream-quality — kartu status per jalur + grafik loss/RTT
 *          (Chart.js v2) dari API /api/upstream-quality/status & /history, auto-refresh 60 dtk,
 *          tombol probe manual.
 * Caller: `views/sb-admin/upstream-quality.php`.
 * Deps: Chart.js vendor (global `Chart`), fetch API, endpoint admin upstream-quality.
 * MainFuncs: `muatStatus`, `muatGrafik`, `renderCards`.
 * SideEffects: DOM update + interval timer di halaman.
 */
(function () {
    "use strict";

    var WARNA = {
        gmdp: "#1cc88a",
        ih: "#4e73df",
        mni: "#e74a3b",
        sf: "#f6c23e"
    };
    var KELAS_STATUS = {
        NORMAL: { border: "border-left-success", badge: "badge-success" },
        DEGRADASI: { border: "border-left-warning", badge: "badge-warning" },
        GANGGUAN: { border: "border-left-danger", badge: "badge-danger" },
        PUTUS: { border: "border-left-danger", badge: "badge-dark" },
        UNKNOWN: { border: "border-left-secondary", badge: "badge-secondary" }
    };

    var chartLoss = null;
    var chartRtt = null;

    function jamWib(iso) {
        var d = new Date(iso);
        return ("0" + ((d.getUTCHours() + 7) % 24)).slice(-2) + ":" + ("0" + d.getUTCMinutes()).slice(-2);
    }

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
        });
    }

    function renderCards(report) {
        var wrap = document.getElementById("upq-cards");
        var html = "";
        (report.paths || []).forEach(function (p) {
            var k = KELAS_STATUS[p.status] || KELAS_STATUS.UNKNOWN;
            var rows = "";
            (p.targets || []).forEach(function (t) {
                rows += '<div class="small text-gray-700">' + esc(t.target) +
                    ": loss <b>" + (t.loss_avg_pct == null ? "-" : t.loss_avg_pct + "%") + "</b>" +
                    " · rtt <b>" + (t.rtt_avg_ms == null ? "-" : t.rtt_avg_ms + "ms") + "</b>" +
                    (t.baseline_rtt_ms ? ' <span class="text-muted">(normal ±' + t.baseline_rtt_ms + "ms)</span>" : "") +
                    "</div>";
            });
            if (!rows) rows = '<div class="small text-muted">Belum ada sampel di jendela ini.</div>';
            html += '<div class="col-xl-3 col-md-6 mb-3">' +
                '<div class="card ' + k.border + ' shadow h-100 py-2">' +
                '<div class="card-body py-2">' +
                '<div class="d-flex justify-content-between align-items-center mb-1">' +
                '<div class="font-weight-bold" style="color:' + (WARNA[p.key] || "#5a5c69") + '">' + esc(p.label) + "</div>" +
                '<span class="badge ' + k.badge + '">' + esc(p.status) + "</span>" +
                "</div>" +
                '<div class="small text-muted mb-1">table: ' + esc(p.routing_table) + "</div>" +
                rows +
                "</div></div></div>";
        });
        wrap.innerHTML = html;

        // Banner failover (mis. MNI pindah ke backup SF).
        var fo = report.failover || {};
        var aktif = Object.keys(fo).filter(function (m) { return fo[m].failover; });
        var banner = document.getElementById("upq-alert-failover");
        if (aktif.length) {
            banner.classList.remove("d-none");
            banner.innerHTML = "<b>Failover aktif:</b> " + aktif.map(function (m) {
                return esc(m) + " → " + esc(fo[m].backup_gateway);
            }).join(", ");
        } else {
            banner.classList.add("d-none");
        }

        var meta = document.getElementById("upq-meta");
        var st = report.poller || {};
        meta.textContent = "Jendela status " + report.window_minutes + " menit · baseline " + report.baseline_hours +
            " jam · siklus poller: " + (st.poll_count || 0) +
            (st.last_poll_at ? " · probe terakhir " + jamWib(st.last_poll_at) + " WIB" : "") +
            (st.last_error ? " · ERROR: " + st.last_error.message : "");
    }

    function kelompokkanHistory(rows) {
        // rows → per path → per probed_at (rata-rata lintas target)
        var byPath = {};
        rows.forEach(function (r) {
            byPath[r.path] = byPath[r.path] || {};
            var c = (byPath[r.path][r.probed_at] = byPath[r.path][r.probed_at] || { loss: [], rtt: [] });
            if (r.loss_pct != null) c.loss.push(r.loss_pct);
            if (r.rtt_avg_ms != null) c.rtt.push(r.rtt_avg_ms);
        });
        var stempel = {};
        rows.forEach(function (r) { stempel[r.probed_at] = true; });
        var labels = Object.keys(stempel).sort();
        function seri(field) {
            return Object.keys(byPath).map(function (path) {
                var data = labels.map(function (at) {
                    var c = byPath[path][at];
                    if (!c || !c[field].length) return null;
                    var sum = c[field].reduce(function (a, b) { return a + b; }, 0);
                    return Math.round((sum / c[field].length) * 10) / 10;
                });
                return {
                    label: path.toUpperCase(),
                    data: data,
                    borderColor: WARNA[path] || "#858796",
                    backgroundColor: "transparent",
                    pointRadius: 1,
                    borderWidth: 2,
                    lineTension: 0.2,
                    spanGaps: true
                };
            });
        }
        return { labels: labels.map(jamWib), loss: seri("loss"), rtt: seri("rtt") };
    }

    function buatChart(ctx, datasets, labels, maxY) {
        return new Chart(ctx, {
            type: "line",
            data: { labels: labels, datasets: datasets },
            options: {
                animation: false,
                maintainAspectRatio: false,
                legend: { display: true, position: "bottom" },
                scales: {
                    xAxes: [{ ticks: { maxTicksLimit: 12 } }],
                    yAxes: [{ ticks: { beginAtZero: true, suggestedMax: maxY } }]
                },
                tooltips: { mode: "index", intersect: false }
            }
        });
    }

    function muatGrafik() {
        fetch("/api/upstream-quality/history?minutes=360", { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                var g = kelompokkanHistory((j.data && j.data.rows) || []);
                if (chartLoss) { chartLoss.destroy(); }
                if (chartRtt) { chartRtt.destroy(); }
                chartLoss = buatChart(document.getElementById("chart-loss").getContext("2d"), g.loss, g.labels, 100);
                chartRtt = buatChart(document.getElementById("chart-rtt").getContext("2d"), g.rtt, g.labels, undefined);
            })
            .catch(function () { /* biarkan grafik lama tampil */ });
    }

    function muatStatus() {
        fetch("/api/upstream-quality/status", { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (j) { if (j && j.data) renderCards(j.data); })
            .catch(function () { /* biarkan kartu lama tampil */ });
    }

    function muatSemua() {
        muatStatus();
        muatGrafik();
    }

    document.getElementById("btn-refresh").addEventListener("click", muatSemua);
    document.getElementById("btn-poll-now").addEventListener("click", function () {
        var btn = this;
        btn.disabled = true;
        fetch("/api/upstream-quality/poll-now", { method: "POST", credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function () { setTimeout(muatSemua, 1500); })
            .catch(function () {})
            .then(function () { btn.disabled = false; });
    });

    muatSemua();
    setInterval(muatSemua, 60000);
})();
