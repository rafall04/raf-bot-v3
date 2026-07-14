/**
 * Header Doc
 * Purpose: Frontend Owner Cockpit (/owner) — ambil GET /api/owner/cockpit lalu render 5 kartu
 *          ringkas (Pemasukan, Status ISP, PSB belum-kepasang, Tiket aktif, Outage OLT), tiap kartu
 *          klik → panel detail (stretched-link). Kartu ok:false degradasi anggun. Auto-refresh 60 dtk.
 * Caller: views/sb-admin/owner-cockpit.php.
 * Deps: fetch API, endpoint /api/owner/cockpit. TANPA vendor tambahan.
 * SideEffects: DOM update + interval timer.
 */
(function () {
    "use strict";
    var elCards = document.getElementById("oc-cards");
    var elMeta = document.getElementById("oc-meta");
    if (!elCards) return;

    function rupiah(n) { return "Rp " + (Number(n) || 0).toLocaleString("id-ID"); }
    function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }

    var ISP_BADGE = { NORMAL: "success", DEGRADASI: "warning", GANGGUAN: "danger", PUTUS: "danger", UNKNOWN: "secondary" };
    var OVERALL = {
        OK: { c: "success", t: "SEMUA OK" }, WARN: { c: "warning", t: "PERLU PERHATIAN" },
        DOWN: { c: "danger", t: "ADA GANGGUAN" }, OFF: { c: "secondary", t: "MONITOR OFF" }
    };

    function card(border, title, bodyHtml, href, hrefLabel) {
        var link = href ? '<a href="' + href + '" class="small stretched-link">' + esc(hrefLabel || "Detail") + ' &rarr;</a>' : '';
        return '<div class="col-xl-4 col-md-6 mb-4"><div class="card shadow h-100 border-left-' + border + '">' +
            '<div class="card-body position-relative">' +
            '<div class="text-xs font-weight-bold text-' + border + ' text-uppercase mb-1">' + esc(title) + '</div>' +
            bodyHtml + link +
            '</div></div></div>';
    }
    function naCard(title) { return card("secondary", title, '<div class="small text-muted">Data tak tersedia saat ini.</div>'); }

    function render(d) {
        var html = "";

        var i = d.income;
        html += (i && i.ok)
            ? card("success", "💰 Pemasukan (periode " + esc(i.period) + ")",
                '<div class="h4 mb-0 font-weight-bold text-gray-800">' + rupiah(i.netPaid) + '</div>' +
                '<div class="small text-muted mt-1">' + i.paymentTransactions + ' transaksi · hari ini ' + i.todayCount + ' (' + rupiah(i.todayAmount) + ')</div>',
                "/rekap-keuangan", "Rekap keuangan")
            : naCard("💰 Pemasukan");

        var s = d.isp;
        if (s && s.ok) {
            var ov = OVERALL[s.overall] || OVERALL.OFF;
            var chips = (s.paths || []).map(function (p) {
                var b = ISP_BADGE[p.status] || "secondary";
                return '<span class="badge badge-' + b + ' mr-1 mb-1">' + esc(p.label) + ': ' + esc(p.status) + '</span>';
            }).join("");
            html += card(ov.c, "🌐 Status ISP",
                '<div class="h5 mb-2 font-weight-bold text-' + ov.c + '">' + ov.t + '</div>' +
                (chips || '<div class="small text-muted">' + (s.enabled ? "&mdash;" : "Monitor upstream nonaktif") + '</div>'),
                "/upstream-quality", "Detail upstream");
        } else html += naCard("🌐 Status ISP");

        var p = d.psb;
        html += (p && p.ok)
            ? card(p.belumKepasang > 0 ? "warning" : "info", "🔧 PSB (belum kepasang)",
                '<div class="h4 mb-0 font-weight-bold text-gray-800">' + p.belumKepasang + '</div>' +
                '<div class="small text-muted mt-1">menunggu ' + p.menunggu + ' · ditugaskan ' + p.ditugaskan + ' · terpasang bln ini ' + p.terpasangBulanIni + '</div>',
                "/papan-psb", "Papan PSB")
            : naCard("🔧 PSB");

        var t = d.tickets;
        html += (t && t.ok)
            ? card(t.belumDiambil > 0 ? "warning" : "info", "🎫 Tiket aktif",
                '<div class="h4 mb-0 font-weight-bold text-gray-800">' + t.active + '</div>' +
                '<div class="small text-muted mt-1">belum diambil ' + t.belumDiambil + '</div>',
                "/admin-daftar-tiket", "Daftar tiket")
            : naCard("🎫 Tiket");

        var o = d.olt;
        html += (o && o.ok)
            ? card(o.activeOutage > 0 ? "danger" : "success", "📡 Outage OLT (LOS)",
                '<div class="h4 mb-0 font-weight-bold text-gray-800">' + o.activeOutage + '</div>' +
                '<div class="small text-muted mt-1">memulih ' + o.recovering + ' · antre ' + o.pending + '</div>',
                "/olt-log", "Log gangguan OLT")
            : naCard("📡 Outage OLT");

        elCards.innerHTML = html;
        if (elMeta) elMeta.textContent = "Diperbarui: " + new Date(d.generatedAt || Date.now()).toLocaleString("id-ID");
    }

    function load() {
        fetch("/api/owner/cockpit", { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (j && j.success && j.data) render(j.data);
                else elCards.innerHTML = '<div class="col-12"><div class="alert alert-warning small mb-0">Gagal memuat cockpit (akses ditolak?).</div></div>';
            })
            .catch(function () {
                elCards.innerHTML = '<div class="col-12"><div class="alert alert-danger small mb-0">Gagal menghubungi server.</div></div>';
            });
    }

    var btn = document.getElementById("oc-refresh");
    if (btn) btn.addEventListener("click", load);
    load();
    setInterval(load, 60000);
})();
