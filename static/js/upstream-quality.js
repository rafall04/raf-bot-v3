/**
 * Header Doc
 * Purpose: Frontend halaman /upstream-quality — kartu status per jalur (verdict + SEGMEN
 *          penyebab + loss gateway + utilisasi + flap), grafik loss/RTT/throughput (Chart.js v2),
 *          Rapor ISP 7 hari, daftar insiden (alert/flap/traceroute bukti), tombol probe & trace
 *          manual, auto-refresh 60 dtk.
 * Caller: `views/sb-admin/upstream-quality.php`.
 * Deps: Chart.js vendor (global `Chart`), fetch API, endpoint /api/upstream-quality/*.
 * MainFuncs: `muatStatus`, `muatGrafik`, `muatWan`, `muatRapor`, `muatInsiden`, `renderCards`.
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
    var BADGE_SEGMEN = {
        JENUH: "badge-warning",
        LINK_ISP: "badge-danger",
        UPSTREAM_ISP: "badge-danger",
        SEHAT: "badge-success",
        UNKNOWN: "badge-secondary"
    };

    var chartLoss = null;
    var chartRtt = null;
    var chartWan = null;

    function jamWib(iso) {
        var d = new Date(iso);
        return ("0" + ((d.getUTCHours() + 7) % 24)).slice(-2) + ":" + ("0" + d.getUTCMinutes()).slice(-2);
    }

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
        });
    }

    function nilai(v, satuan) {
        return v == null ? "-" : v + (satuan || "");
    }

    function renderCards(report) {
        var wrap = document.getElementById("upq-cards");
        var html = "";
        (report.paths || []).forEach(function (p) {
            var k = KELAS_STATUS[p.status] || KELAS_STATUS.UNKNOWN;
            var rows = "";
            (p.targets || []).forEach(function (t) {
                rows += '<div class="small text-gray-700">' + esc(t.target) +
                    ": loss <b>" + nilai(t.loss_avg_pct, "%") + "</b>" +
                    " · rtt <b>" + nilai(t.rtt_avg_ms, "ms") + "</b>" +
                    (t.baseline_rtt_ms ? ' <span class="text-muted">(normal ±' + t.baseline_rtt_ms + "ms)</span>" : "") +
                    "</div>";
            });
            if (!rows) rows = '<div class="small text-muted">Belum ada sampel di jendela ini.</div>';

            var segmen = "";
            if (p.segment && p.segment !== "SEHAT" && p.segment !== "UNKNOWN") {
                segmen = '<div class="small mt-1"><span class="badge ' + (BADGE_SEGMEN[p.segment] || "badge-secondary") + '">' +
                    esc(p.segment_label || p.segment) + "</span></div>";
            }
            var gw = p.gateway
                ? '<div class="small text-gray-600">gw ISP: loss <b>' + nilai(p.gateway.loss_avg_pct, "%") + "</b> · rtt <b>" + nilai(p.gateway.rtt_avg_ms, "ms") + "</b></div>"
                : "";
            var wan = "";
            if (p.wan) {
                wan = '<div class="small text-gray-600">trafik: ↓' + nilai(p.wan.rx_mbps, "Mbps") + " ↑" + nilai(p.wan.tx_mbps, "Mbps");
                if (p.wan.util_down_max_pct != null || p.wan.util_up_max_pct != null) {
                    wan += " · util maks ↓" + nilai(p.wan.util_down_max_pct, "%") + " ↑" + nilai(p.wan.util_up_max_pct, "%");
                }
                if (p.wan.flaps_24h) wan += ' · <span class="text-danger">flap 24j: ' + p.wan.flaps_24h + "</span>";
                if (p.wan.errors || p.wan.drops) wan += " · err/drop: " + p.wan.errors + "/" + p.wan.drops;
                wan += "</div>";
            }

            html += '<div class="col-xl-3 col-md-6 mb-3">' +
                '<div class="card ' + k.border + ' shadow h-100 py-2">' +
                '<div class="card-body py-2">' +
                '<div class="d-flex justify-content-between align-items-center mb-1">' +
                '<div class="font-weight-bold" style="color:' + (WARNA[p.key] || "#5a5c69") + '">' + esc(p.label) + "</div>" +
                '<span class="badge ' + k.badge + '">' + esc(p.status) + "</span>" +
                "</div>" +
                '<div class="small text-muted mb-1">table: ' + esc(p.routing_table) + "</div>" +
                rows + gw + wan + segmen +
                '<div class="mt-2"><button class="btn btn-xs btn-outline-secondary btn-sm py-0 px-2 upq-trace" data-path="' + esc(p.key) + '">Trace</button></div>' +
                "</div></div></div>";
        });
        wrap.innerHTML = html;

        Array.prototype.forEach.call(document.querySelectorAll(".upq-trace"), function (btn) {
            btn.addEventListener("click", function () {
                var b = this;
                b.disabled = true;
                b.textContent = "Trace…";
                fetch("/api/upstream-quality/trace/" + b.getAttribute("data-path"), { method: "POST", credentials: "same-origin" })
                    .then(function (r) { return r.json(); })
                    .then(function () { muatInsiden(); })
                    .catch(function () {})
                    .then(function () { b.disabled = false; b.textContent = "Trace"; });
            });
        });

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

    function kelompokkanHistory(rows, fields) {
        var byPath = {};
        rows.forEach(function (r) {
            byPath[r.path] = byPath[r.path] || {};
            var c = (byPath[r.path][r.probed_at || r.sampled_at] = byPath[r.path][r.probed_at || r.sampled_at] || {});
            fields.forEach(function (f) {
                if (r[f] != null) (c[f] = c[f] || []).push(Number(r[f]));
            });
        });
        var stempel = {};
        rows.forEach(function (r) { stempel[r.probed_at || r.sampled_at] = true; });
        var labels = Object.keys(stempel).sort();
        return { byPath: byPath, labels: labels };
    }

    function seriDari(grouped, field, transform, labelSuffix, dashed) {
        return Object.keys(grouped.byPath).map(function (path) {
            var data = grouped.labels.map(function (at) {
                var c = grouped.byPath[path][at];
                if (!c || !c[field] || !c[field].length) return null;
                var sum = c[field].reduce(function (a, b) { return a + b; }, 0);
                var avg = sum / c[field].length;
                return Math.round((transform ? transform(avg) : avg) * 10) / 10;
            });
            return {
                label: path.toUpperCase() + (labelSuffix || ""),
                data: data,
                borderColor: WARNA[path] || "#858796",
                backgroundColor: "transparent",
                pointRadius: 1,
                borderWidth: 2,
                borderDash: dashed ? [5, 3] : undefined,
                lineTension: 0.2,
                spanGaps: true
            };
        });
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
                var rows = ((j.data && j.data.rows) || []).filter(function (r) { return r.target_key !== "gateway"; });
                var g = kelompokkanHistory(rows, ["loss_pct", "rtt_avg_ms"]);
                var labels = g.labels.map(jamWib);
                if (chartLoss) chartLoss.destroy();
                if (chartRtt) chartRtt.destroy();
                chartLoss = buatChart(document.getElementById("chart-loss").getContext("2d"), seriDari(g, "loss_pct"), labels, 100);
                chartRtt = buatChart(document.getElementById("chart-rtt").getContext("2d"), seriDari(g, "rtt_avg_ms"), labels, undefined);
            })
            .catch(function () { /* biarkan grafik lama tampil */ });
    }

    function muatWan() {
        var el = document.getElementById("chart-wan");
        if (!el) return;
        fetch("/api/upstream-quality/wan-history?minutes=360", { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                var rows = (j.data && j.data.rows) || [];
                var g = kelompokkanHistory(rows, ["rx_bps", "tx_bps"]);
                var labels = g.labels.map(jamWib);
                var keMbps = function (bps) { return bps / 1e6; };
                var datasets = seriDari(g, "rx_bps", keMbps, " ↓")
                    .concat(seriDari(g, "tx_bps", keMbps, " ↑", true));
                if (chartWan) chartWan.destroy();
                chartWan = buatChart(el.getContext("2d"), datasets, labels, undefined);
            })
            .catch(function () { /* biarkan grafik lama tampil */ });
    }

    function muatRapor() {
        var tbody = document.getElementById("upq-report");
        if (!tbody) return;
        fetch("/api/upstream-quality/report?days=7", { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                var rows = (j.data && j.data.rows) || [];
                if (!rows.length) {
                    tbody.innerHTML = '<tr><td colspan="6" class="text-muted small">Belum ada data.</td></tr>';
                    return;
                }
                tbody.innerHTML = rows.map(function (r) {
                    var avail = r.availability_pct;
                    var warnaAvail = avail == null ? "" : (avail >= 99.5 ? "text-success" : (avail >= 97 ? "text-warning" : "text-danger"));
                    return "<tr>" +
                        '<td style="color:' + (WARNA[r.path] || "#5a5c69") + '"><b>' + esc(r.label || r.path) + "</b></td>" +
                        '<td class="' + warnaAvail + '"><b>' + nilai(avail, "%") + "</b></td>" +
                        "<td>" + nilai(r.loss_avg, "%") + "</td>" +
                        "<td>" + nilai(r.rtt_avg, "ms") + "</td>" +
                        "<td>" + nilai(r.sick_pct, "%") + "</td>" +
                        "<td>" + (r.flaps || 0) + "</td>" +
                        "</tr>";
                }).join("");
            })
            .catch(function () {});
    }

    function muatInsiden() {
        var wrap = document.getElementById("upq-incidents");
        if (!wrap) return;
        fetch("/api/upstream-quality/incidents?limit=25", { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                var rows = (j.data && j.data.rows) || [];
                if (!rows.length) {
                    wrap.innerHTML = '<div class="small text-muted">Belum ada insiden. 👍</div>';
                    return;
                }
                wrap.innerHTML = rows.map(function (r) {
                    var detail = {};
                    try { detail = JSON.parse(r.detail || "{}") || {}; } catch (_e) { /* teks polos */ }
                    var isi = "";
                    if (r.kind === "trace") {
                        var fb = detail.first_bad_hop;
                        isi = fb
                            ? "loss mulai hop <b>" + esc(fb.address) + "</b> (" + nilai(fb.loss_pct, "%") + ")"
                            : "trace " + esc(detail.target || "") + " — " + ((detail.hops && detail.hops.length) || 0) + " hop tercatat";
                    } else if (r.kind === "flap") {
                        isi = "tunnel re-dial / link down (" + esc(detail.iface || "") + ")";
                    } else if (r.kind === "alert") {
                        isi = "alert " + esc(detail.level || "") + " — loss " + nilai(detail.loss_avg && Math.round(detail.loss_avg), "%");
                    } else {
                        isi = esc(r.kind);
                    }
                    var badge = r.kind === "alert" ? "badge-danger" : (r.kind === "flap" ? "badge-warning" : "badge-info");
                    return '<div class="border-bottom py-1 small">' +
                        '<span class="badge ' + badge + ' mr-1">' + esc(r.kind) + "</span>" +
                        '<b style="color:' + (WARNA[r.path] || "#5a5c69") + '">' + esc(r.path.toUpperCase()) + "</b> · " +
                        jamWib(r.created_at) + " WIB — " + isi +
                        "</div>";
                }).join("");
            })
            .catch(function () {});
    }

    function muatSwitch() {
        var section = document.getElementById("upq-switch-section");
        var wrap = document.getElementById("upq-switch-list");
        if (!section || !wrap) return;
        fetch("/api/wan-switch/status", { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                var data = (j && j.data) || {};
                if (!data.enabled || !data.switches || !data.switches.length) {
                    section.classList.add("d-none");
                    return;
                }
                section.classList.remove("d-none");
                wrap.innerHTML = data.switches.map(function (s) {
                    var applied = s.applied === true;
                    var badge = s.applied === null
                        ? '<span class="badge badge-secondary">tak terbaca</span>'
                        : (applied ? '<span class="badge badge-warning">SEDANG DIALIHKAN</span>' : '<span class="badge badge-success">normal</span>');
                    var btn = s.applied === null ? "" : (applied
                        ? '<button class="btn btn-sm btn-outline-success upq-sw" data-act="restore" data-id="' + esc(s.id) + '" data-label="' + esc(s.label) + '">Kembalikan ke normal</button>'
                        : '<button class="btn btn-sm btn-warning upq-sw" data-act="apply" data-id="' + esc(s.id) + '" data-label="' + esc(s.label) + '">Alihkan sekarang</button>');
                    return '<div class="border-bottom py-2 d-flex justify-content-between align-items-center flex-wrap">' +
                        '<div class="mr-2"><b>' + esc(s.label) + '</b> ' + badge +
                        (s.affects ? '<div class="small text-muted">Terdampak: ' + esc(s.affects) + "</div>" : "") + "</div>" +
                        "<div>" + btn + "</div></div>";
                }).join("");

                Array.prototype.forEach.call(wrap.querySelectorAll(".upq-sw"), function (b) {
                    b.addEventListener("click", function () {
                        var act = b.getAttribute("data-act");
                        var id = b.getAttribute("data-id");
                        var label = b.getAttribute("data-label");
                        var pesan = act === "restore"
                            ? "Kembalikan \"" + label + "\" ke jalur normal?\n\nKoneksi jalur ini akan terputus sesaat saat berpindah."
                            : "Alihkan \"" + label + "\" sekarang?\n\nKoneksi jalur ini akan terputus sesaat saat berpindah. Ini memindahkan trafik pelanggan.";
                        if (!window.confirm(pesan)) return;
                        b.disabled = true;
                        b.textContent = "Memproses…";
                        fetch("/api/wan-switch/" + act + "/" + encodeURIComponent(id), { method: "POST", credentials: "same-origin" })
                            .then(function (r) { return r.json(); })
                            .then(function (res) {
                                var d = (res && res.data) || {};
                                window.alert(d.ok ? ("✅ " + (d.message || "Berhasil") + "\n\n" + (d.summary || "")) : ("❌ " + (d.message || "Gagal")));
                                setTimeout(function () { muatStatus(); muatSwitch(); muatInsiden(); }, 1200);
                            })
                            .catch(function () { window.alert("Gagal menghubungi server."); })
                            .then(function () { b.disabled = false; });
                    });
                });
            })
            .catch(function () { section.classList.add("d-none"); });
    }

    function muatSemua() {
        muatStatus();
        muatSwitch();
        muatGrafik();
        muatWan();
        muatRapor();
        muatInsiden();
    }

    function muatStatus() {
        fetch("/api/upstream-quality/status", { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (j) { if (j && j.data) renderCards(j.data); })
            .catch(function () { /* biarkan kartu lama tampil */ });
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
