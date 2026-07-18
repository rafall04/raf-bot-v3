/**
 * Header Doc
 * Purpose: Frontend halaman Survei Kepuasan (/survei) — ambil GET /api/owner/csat?period=YYYY-MM lalu
 *          render: tiles ringkas (terkirim/menjawab/rata-rata/detractor/optout), sebaran skor 1-5,
 *          tabel detractor (skor <=2) + No HP + komentar, tabel semua masukan, daftar non-responder,
 *          dan tren per bulan. Selektor periode diisi dari tren. Auth via cookie (credentials same-origin).
 * Caller: views/sb-admin/survei.php (butuh static/css/survei.css).
 * Deps: fetch API, endpoint /api/owner/csat, FontAwesome (dari _head.php).
 * SideEffects: DOM update.
 */
(function () {
    "use strict";
    var elSummary = document.getElementById("csat-summary");
    var elContent = document.getElementById("csat-content");
    var elMeta = document.getElementById("csat-meta");
    var elPeriod = document.getElementById("csat-period");
    if (!elSummary || !elContent) return;

    function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
    function num(n) { return n == null ? "—" : String(n); }
    function pad2(n) { return String(n).padStart(2, "0"); }
    function scoreClass(s) { return s <= 2 ? "csat-badge--bad" : (s === 3 ? "csat-badge--mid" : "csat-badge--good"); }
    function stars(s) { return s == null ? "—" : (s + "⭐"); }

    function tile(label, value, sub, accent) {
        return '<div class="csat-tile csat-tile--' + (accent || "neutral") + '">' +
            '<div class="csat-tile__val">' + value + '</div>' +
            '<div class="csat-tile__label">' + esc(label) + '</div>' +
            (sub ? '<div class="csat-tile__sub">' + sub + '</div>' : '') +
            '</div>';
    }

    function distRow(star, count, total) {
        var pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return '<div class="csat-dist__row">' +
            '<span class="csat-dist__label">' + star + '⭐</span>' +
            '<span class="csat-dist__bar"><span class="csat-dist__fill csat-dist__fill--' + (star <= 2 ? "bad" : (star === 3 ? "mid" : "good")) + '" style="width:' + pct + '%"></span></span>' +
            '<span class="csat-dist__n">' + count + '</span></div>';
    }

    function table(title, icon, headers, rowsHtml, emptyMsg) {
        return '<div class="card shadow mb-3"><div class="card-header py-2"><b>' + icon + ' ' + esc(title) + '</b></div>' +
            '<div class="card-body p-0">' +
            (rowsHtml
                ? '<div class="table-responsive"><table class="table table-sm table-hover mb-0 csat-table"><thead><tr>' +
                  headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join("") + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>'
                : '<div class="csat-na p-3">' + esc(emptyMsg) + '</div>') +
            '</div></div>';
    }

    function render(d) {
        var r = d.report || {};
        var dist = r.distribution || {};
        var total = r.responded || 0;

        // Tiles
        var avgTxt = r.avg != null ? (r.avg + " <small>/5</small>") : "—";
        var avgAccent = r.avg == null ? "neutral" : (r.avg <= 2.5 ? "bad" : (r.avg < 4 ? "mid" : "good"));
        elSummary.innerHTML =
            tile("Terkirim", num(r.delivered), null, "neutral") +
            tile("Menjawab", num(r.responded), (r.responseRate != null ? r.responseRate + "% response" : ""), "info") +
            tile("Rata-rata skor", avgTxt, null, avgAccent) +
            tile("Perlu perhatian", num((d.detractors || []).length), "skor ≤ 2", (d.detractors || []).length > 0 ? "bad" : "good") +
            tile("Minta stop", num(r.optout), null, "neutral");

        // Distribution
        var distHtml = '<div class="card shadow mb-3"><div class="card-header py-2"><b>📊 Sebaran skor</b></div>' +
            '<div class="card-body csat-dist">' +
            [5, 4, 3, 2, 1].map(function (s) { return distRow(s, dist[s] || 0, total); }).join("") +
            (total === 0 ? '<div class="csat-na">Belum ada jawaban untuk periode ini.</div>' : "") +
            '</div></div>';

        // Detractors
        var detrRows = (d.detractors || []).map(function (x) {
            return '<tr><td>' + esc(x.name || "-") + '</td><td>' + esc(x.phone || "-") +
                '</td><td><span class="csat-badge ' + scoreClass(x.score) + '">' + stars(x.score) + '</span></td><td>' + esc(x.comment || "—") + '</td></tr>';
        }).join("");
        var detrHtml = table("Perlu perhatian (detractor ≤ 2)", "⚠️", ["Nama", "No HP", "Skor", "Komentar"], detrRows, "Tidak ada detractor 🎉");

        // All comments
        var cmtRows = (d.comments || []).map(function (x) {
            return '<tr><td>' + esc(x.name || "-") + '</td><td>' + esc(x.phone || "-") +
                '</td><td><span class="csat-badge ' + scoreClass(x.score) + '">' + stars(x.score) + '</span></td><td>' + esc(x.comment || "—") + '</td></tr>';
        }).join("");
        var cmtHtml = table("Semua masukan pelanggan", "💬", ["Nama", "No HP", "Skor", "Komentar"], cmtRows, "Belum ada komentar.");

        // Non-responders
        var nrRows = (d.nonResponders || []).map(function (x) {
            return '<tr><td>' + esc(x.name || "-") + '</td><td>' + esc(x.phone || "-") + '</td></tr>';
        }).join("");
        var nrHtml = table("Belum menjawab", "🔕", ["Nama", "No HP"], nrRows, "Semua sudah menjawab 👍");

        // Trend
        var trRows = (d.trend || []).map(function (x) {
            return '<tr><td>' + esc(x.period) + '</td><td>' + num(x.delivered) + '</td><td>' + num(x.responded) +
                " (" + (x.responseRate != null ? x.responseRate + "%" : "—") + ')</td><td>' + (x.avg != null ? x.avg + " ⭐" : "—") + '</td></tr>';
        }).join("");
        var trHtml = table("Tren per bulan", "📈", ["Periode", "Terkirim", "Menjawab", "Rata-rata"], trRows, "Belum ada riwayat.");

        elContent.innerHTML = distHtml + detrHtml + cmtHtml + nrHtml + trHtml;

        if (elMeta) elMeta.textContent = "Periode " + esc(d.period) + " · diperbarui " + new Date().toLocaleTimeString("id-ID");
        fillPeriodSelector(d.trend, d.period);
    }

    function fillPeriodSelector(trend, current) {
        if (!elPeriod) return;
        var periods = (trend || []).map(function (x) { return x.period; });
        // pastikan periode berjalan selalu ada di daftar walau belum ada data
        var now = new Date();
        var cur = now.getFullYear() + "-" + pad2(now.getMonth() + 1);
        if (periods.indexOf(cur) === -1) periods.unshift(cur);
        if (current && periods.indexOf(current) === -1) periods.unshift(current);
        if (elPeriod.options.length !== periods.length) {
            elPeriod.innerHTML = periods.map(function (p) { return '<option value="' + p + '">' + p + '</option>'; }).join("");
        }
        elPeriod.value = current || cur;
    }

    function load(period) {
        var url = "/api/owner/csat" + (period ? "?period=" + encodeURIComponent(period) : "");
        elSummary.innerHTML = '<div class="csat-na">Memuat…</div>';
        fetch(url, { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (j && j.success && j.data) render(j.data);
                else { elSummary.innerHTML = '<div class="csat-na">Gagal memuat (akses ditolak?).</div>'; elContent.innerHTML = ""; }
            })
            .catch(function () { elSummary.innerHTML = '<div class="csat-na">Gagal menghubungi server.</div>'; elContent.innerHTML = ""; });
    }

    var btn = document.getElementById("csat-refresh");
    if (btn) btn.addEventListener("click", function () { load(elPeriod ? elPeriod.value : null); });
    if (elPeriod) elPeriod.addEventListener("change", function () { load(elPeriod.value); });
    load();
})();
