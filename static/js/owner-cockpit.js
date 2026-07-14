/**
 * Header Doc
 * Purpose: Frontend Owner Cockpit (/owner) — ambil GET /api/owner/cockpit lalu render 7 kartu ringkas:
 *          Pemasukan (+tunggakan/pelunasan/MRR), Pelanggan (aktif/isolir/baru/online), Perlu Tindakan,
 *          Status ISP (+trafik), PSB (+terpasang/komisi), Tiket (+per-status/lama), Outage OLT (+offline).
 *          Tiap kartu klik → panel detail (stretched-link); kartu ok:false degradasi anggun. Auto-refresh 60s.
 * Caller: views/sb-admin/owner-cockpit.php.
 * Deps: fetch API, endpoint /api/owner/cockpit.
 * SideEffects: DOM update + interval timer.
 */
(function () {
    "use strict";
    var elCards = document.getElementById("oc-cards");
    var elMeta = document.getElementById("oc-meta");
    if (!elCards) return;

    function rupiah(n) { return "Rp " + (Number(n) || 0).toLocaleString("id-ID"); }
    function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
    function num(n) { return n == null ? "—" : String(n); }

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
    function big(v) { return '<div class="h4 mb-0 font-weight-bold text-gray-800">' + v + '</div>'; }
    function sub(v) { return '<div class="small text-muted mt-1">' + v + '</div>'; }
    function naCard(title) { return card("secondary", title, '<div class="small text-muted">Data tak tersedia saat ini.</div>'); }

    function render(d) {
        var html = "";

        // 💰 Pemasukan
        var i = d.income;
        if (i && i.ok) {
            var extra = "";
            if (i.arrearsCustomers != null) extra += '<div class="small text-danger mt-1">Tunggakan: <b>' + i.arrearsCustomers + '</b> plg · ' + rupiah(i.arrearsOutstanding) + '</div>';
            extra += sub('Lunas ' + num(i.lunas) + '/' + num(i.totalCustomers) + (i.collectionRate != null ? ' (' + i.collectionRate + '%)' : '') + ' · target ' + rupiah(i.mrr));
            html += card("success", "💰 Pemasukan (periode " + esc(i.period) + ")",
                big(rupiah(i.netPaid)) + sub(i.paymentTransactions + ' transaksi · hari ini ' + i.todayCount + ' (' + rupiah(i.todayAmount) + ')') + extra,
                "/rekap-keuangan", "Rekap keuangan");
        } else html += naCard("💰 Pemasukan");

        // 👥 Pelanggan
        var cst = d.customers;
        if (cst && cst.ok) {
            html += card(cst.isolir > 0 ? "warning" : "info", "👥 Pelanggan",
                big(cst.aktif + ' <span class="small text-muted">aktif</span>') +
                sub('isolir <b>' + cst.isolir + '</b> · baru bln ini ' + cst.baru + ' · PPPoE online ' + num(cst.pppoeOnline)),
                "/users", "Kelola pelanggan");
        } else html += naCard("👥 Pelanggan");

        // ⚠️ Perlu Tindakan
        var a = d.actions;
        if (a && a.ok) {
            html += card(a.total > 0 ? "warning" : "success", "⚠️ Perlu Tindakan",
                big(a.total) +
                sub('bukti bayar ' + a.buktiBayar + ' · ganti paket ' + a.gantiPaket + ' · topup ' + a.topup + ' · approval ' + a.bayarApproval),
                "/konfirmasi-bayar", "Konfirmasi bayar");
        } else html += naCard("⚠️ Perlu Tindakan");

        // 🌐 Status ISP
        var s = d.isp;
        if (s && s.ok) {
            var ov = OVERALL[s.overall] || OVERALL.OFF;
            var chips = (s.paths || []).map(function (p) {
                var b = ISP_BADGE[p.status] || "secondary";
                return '<span class="badge badge-' + b + ' mr-1 mb-1">' + esc(p.label) + ': ' + esc(p.status) + '</span>';
            }).join("");
            var traffic = (s.rxMbps != null || s.txMbps != null) ? sub('Trafik: &darr;' + num(s.rxMbps) + ' / &uarr;' + num(s.txMbps) + ' Mbps') : "";
            html += card(ov.c, "🌐 Status ISP",
                '<div class="h5 mb-2 font-weight-bold text-' + ov.c + '">' + ov.t + '</div>' +
                (chips || '<div class="small text-muted">' + (s.enabled ? "&mdash;" : "Monitor upstream nonaktif") + '</div>') + traffic,
                "/upstream-quality", "Detail upstream");
        } else html += naCard("🌐 Status ISP");

        // 🔧 PSB
        var p = d.psb;
        if (p && p.ok) {
            var komisi = p.komisiBulanIni > 0 ? '<div class="small text-success mt-1">Komisi marketing bln ini: ' + rupiah(p.komisiBulanIni) + '</div>' : "";
            html += card(p.belumKepasang > 0 ? "warning" : "info", "🔧 PSB",
                big(p.belumKepasang + ' <span class="small text-muted">belum kepasang</span>') +
                sub('menunggu ' + p.menunggu + ' · ditugaskan ' + p.ditugaskan + ' · <b>terpasang bln ini ' + p.terpasangBulanIni + '</b>') + komisi,
                "/papan-psb", "Papan PSB");
        } else html += naCard("🔧 PSB");

        // 🎫 Tiket
        var t = d.tickets;
        if (t && t.ok) {
            var bs = t.byStatus || {};
            var bsTxt = Object.keys(bs).map(function (k) { return esc(k) + ' ' + bs[k]; }).join(" · ");
            html += card(t.belumDiambil > 0 || t.lama > 0 ? "warning" : "info", "🎫 Tiket aktif",
                big(t.active) +
                sub('belum diambil ' + t.belumDiambil + ' · lama &gt;24j ' + t.lama) +
                (bsTxt ? '<div class="small text-muted">' + bsTxt + '</div>' : ""),
                "/admin/daftar-tiket", "Daftar tiket");
        } else html += naCard("🎫 Tiket");

        // 📡 Outage OLT
        var o = d.olt;
        if (o && o.ok) {
            html += card(o.activeOutage > 0 ? "danger" : "success", "📡 Outage OLT (LOS)",
                big(o.activeOutage) +
                sub('pelanggan offline ' + num(o.offline) + ' · memulih ' + o.recovering + ' · antre ' + o.pending),
                "/olt-log", "Log gangguan OLT");
        } else html += naCard("📡 Outage OLT");

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
