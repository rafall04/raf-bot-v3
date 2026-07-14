/**
 * Header Doc
 * Purpose: Frontend Owner Cockpit (/owner) — ambil GET /api/owner/cockpit lalu render 7 kartu ELEGAN
 *          (icon chip ber-aksen + angka besar + badge tren MoM + progress bar + stat rows): Pemasukan
 *          (+tunggakan/pelunasan/MRR/tren), Pelanggan (aktif/isolir/online/offline-presisi/baru),
 *          Perlu Tindakan, Status ISP (+trafik), PSB (+terpasang/komisi), Tiket (+per-status/lama),
 *          Outage OLT. Kartu klik → panel detail; kartu ok:false degradasi anggun. Auto-refresh 60s.
 * Caller: views/sb-admin/owner-cockpit.php (butuh static/css/owner-cockpit.css).
 * Deps: fetch API, endpoint /api/owner/cockpit, FontAwesome (dari _head.php).
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
    function clampPct(n) { return Math.max(0, Math.min(100, Number(n) || 0)); }

    var OVERALL = {
        OK: { c: "success", t: "SEMUA OK" }, WARN: { c: "warning", t: "PERLU PERHATIAN" },
        DOWN: { c: "danger", t: "ADA GANGGUAN" }, OFF: { c: "neutral", t: "MONITOR OFF" }
    };

    function card(accent, icon, label, trendHtml, metricHtml, rowsHtml, href, hrefLabel) {
        return '<div class="oc-card oc-card--' + accent + '">' +
            '<div class="oc-card__top">' +
            '<div class="oc-chip"><i class="fas ' + icon + '"></i></div>' +
            '<div class="oc-labelwrap"><span class="oc-label">' + esc(label) + '</span>' + (trendHtml || '') + '</div>' +
            '</div>' + metricHtml +
            (rowsHtml ? '<div class="oc-rows">' + rowsHtml + '</div>' : '') +
            (href ? '<a href="' + href + '" class="oc-link stretched-link">' + esc(hrefLabel) + ' &rarr;</a>' : '') +
            '</div>';
    }
    function metric(v, accent) { return '<div class="oc-metric' + (accent ? ' oc-metric--accent' : '') + '">' + v + '</div>'; }
    function row(label, valueHtml, cls) { return '<div class="oc-row"><span>' + esc(label) + '</span><b' + (cls ? ' class="' + cls + '"' : '') + '>' + valueHtml + '</b></div>'; }
    function bar(pct) { return '<div class="oc-bar"><div class="oc-bar__fill" style="width:' + clampPct(pct) + '%"></div></div>'; }
    function trend(pct) {
        if (pct == null) return '';
        if (pct > 0) return '<span class="oc-trend oc-trend--up"><i class="fas fa-arrow-up"></i> ' + pct + '%</span>';
        if (pct < 0) return '<span class="oc-trend oc-trend--down"><i class="fas fa-arrow-down"></i> ' + Math.abs(pct) + '%</span>';
        return '<span class="oc-trend oc-trend--flat">0%</span>';
    }
    function naCard(icon, label) { return card("neutral", icon, label, "", '<div class="oc-na">Data tak tersedia saat ini.</div>', "", "", ""); }

    function render(d) {
        var html = "";

        // 💰 Pemasukan
        var i = d.income;
        if (i && i.ok) {
            var rows = row("Pelunasan", num(i.lunas) + "/" + num(i.totalCustomers) + (i.collectionRate != null ? " (" + i.collectionRate + "%)" : "")) +
                bar(i.collectionRate) +
                row("Target bulanan", rupiah(i.mrr)) +
                row("Tunggakan", (i.arrearsCustomers != null ? i.arrearsCustomers + " plg · " + rupiah(i.arrearsOutstanding) : "—"), i.arrearsCustomers > 0 ? "text-danger" : "") +
                row("Hari ini", i.todayCount + " (" + rupiah(i.todayAmount) + ")");
            html += card("success", "fa-wallet", "Pemasukan · " + i.period, trend(i.trendPct),
                metric(rupiah(i.netPaid)), rows, "/rekap-keuangan", "Rekap keuangan");
        } else html += naCard("fa-wallet", "Pemasukan");

        // 👥 Pelanggan
        var c = d.customers;
        if (c && c.ok) {
            // isolir === null → profil PPPoE live tak terbaca (MikroTik). JANGAN klaim "N aktif" —
            // kita tak tahu berapa yang terisolir. Tampilkan total apa adanya; baris Terisolir jadi "—".
            var cMetric = c.isolir == null
                ? (c.total + ' <small>pelanggan</small>')
                : (c.aktif + ' <small>aktif</small>');
            var crows = row("Terisolir", num(c.isolir), c.isolir > 0 ? "text-danger" : "") +
                row("PPPoE online", num(c.pppoeOnline)) +
                row("Offline (aktif)", num(c.offline), c.offline > 0 ? "text-danger" : "") +
                row("Baru bln ini", num(c.baru));
            html += card("info", "fa-users", "Pelanggan", "",
                metric(cMetric), crows, "/users", "Kelola pelanggan");
        } else html += naCard("fa-users", "Pelanggan");

        // ⚠️ Perlu Tindakan
        var a = d.actions;
        if (a && a.ok) {
            var arows = row("Bukti bayar", num(a.buktiBayar), a.buktiBayar > 0 ? "text-danger" : "") +
                row("Ganti paket", num(a.gantiPaket)) +
                row("Topup", num(a.topup)) +
                row("Approval bayar", num(a.bayarApproval));
            html += card(a.total > 0 ? "warning" : "neutral", "fa-bell", "Perlu Tindakan", "",
                metric(a.total), arows, "/konfirmasi-bayar", "Konfirmasi bayar");
        } else html += naCard("fa-bell", "Perlu Tindakan");

        // 🌐 Status ISP
        var s = d.isp;
        if (s && s.ok) {
            var ov = OVERALL[s.overall] || OVERALL.OFF;
            var chips = (s.paths || []).map(function (p) {
                return '<span class="oc-badge oc-badge--' + esc(p.status) + '">' + esc(p.label) + '</span>';
            }).join("");
            var srows = (chips ? '<div class="oc-badges">' + chips + '</div>' : '<div class="oc-na">' + (s.enabled ? "&mdash;" : "Monitor upstream nonaktif") + '</div>') +
                ((s.rxMbps != null || s.txMbps != null) ? row("Trafik", '&darr;' + num(s.rxMbps) + ' / &uarr;' + num(s.txMbps) + ' Mbps') : "");
            html += card(ov.c, "fa-globe", "Status ISP", "",
                '<div class="oc-metric oc-metric--accent" style="font-size:1.35rem">' + ov.t + '</div>', srows, "/upstream-quality", "Detail upstream");
        } else html += naCard("fa-globe", "Status ISP");

        // 🔧 PSB
        var p = d.psb;
        if (p && p.ok) {
            var prows = row("Terpasang bln ini", "<b>" + num(p.terpasangBulanIni) + "</b>", "text-success") +
                row("Menunggu · Ditugaskan", p.menunggu + " · " + p.ditugaskan) +
                (p.komisiBulanIni > 0 ? row("Komisi marketing", rupiah(p.komisiBulanIni)) : "");
            html += card(p.belumKepasang > 0 ? "warning" : "info", "fa-tools", "PSB",
                "", metric(p.belumKepasang + ' <small>belum kepasang</small>'), prows, "/papan-psb", "Papan PSB");
        } else html += naCard("fa-tools", "PSB");

        // 🎫 Tiket
        var t = d.tickets;
        if (t && t.ok) {
            var bs = t.byStatus || {};
            var bsTxt = Object.keys(bs).map(function (k) { return esc(k) + " " + bs[k]; }).join(" · ") || "—";
            var trows = row("Belum diambil", num(t.belumDiambil), t.belumDiambil > 0 ? "text-danger" : "") +
                row("Lama >24 jam", num(t.lama), t.lama > 0 ? "text-danger" : "") +
                row("Status", bsTxt);
            html += card(t.belumDiambil > 0 || t.lama > 0 ? "warning" : "info", "fa-headset", "Tiket aktif",
                "", metric(t.active), trows, "/admin/daftar-tiket", "Daftar tiket");
        } else html += naCard("fa-headset", "Tiket");

        // 📡 Outage OLT
        var o = d.olt;
        if (o && o.ok) {
            var orows = row("Sedang memulih", num(o.recovering)) + row("Antre konfirmasi", num(o.pending));
            html += card(o.activeOutage > 0 ? "danger" : "success", "fa-satellite-dish", "Outage OLT (LOS)",
                "", metric(o.activeOutage), orows, "/olt-log", "Log gangguan OLT");
        } else html += naCard("fa-satellite-dish", "Outage OLT");

        elCards.innerHTML = html;
        if (elMeta) elMeta.textContent = "Diperbarui " + new Date(d.generatedAt || Date.now()).toLocaleTimeString("id-ID") + " · auto 60 dtk";
    }

    function load() {
        fetch("/api/owner/cockpit", { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (j && j.success && j.data) render(j.data);
                else elCards.innerHTML = '<div class="oc-na">Gagal memuat cockpit (akses ditolak?).</div>';
            })
            .catch(function () { elCards.innerHTML = '<div class="oc-na">Gagal menghubungi server.</div>'; });
    }

    var btn = document.getElementById("oc-refresh");
    if (btn) btn.addEventListener("click", load);
    load();
    setInterval(load, 60000);
})();
