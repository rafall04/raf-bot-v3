/**
 * Header Doc
 * Purpose: Ambil & render statistik penjualan voucher online (halaman /voucher-sales).
 * Caller: views/sb-admin/voucher-sales.php.
 * Deps: GET /api/voucher/sales-stats (staff-guarded).
 * MainFuncs: fetch stats → isi stat-card, paket terlaris, penjualan terbaru.
 * SideEffects: Menulis DOM; read-only (tidak mengubah data).
 */
(function () {
    function rupiah(n) { return 'Rp' + (parseInt(n, 10) || 0).toLocaleString('id-ID'); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function fmtDate(ts) {
        if (!ts) return '-';
        var d = new Date(ts);
        return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    }
    function el(id) { return document.getElementById(id); }

    fetch('/api/voucher/sales-stats', { credentials: 'include' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (!d || d.error) {
                el('recentBody').innerHTML = '<tr><td colspan="4" class="text-center py-3 text-danger">' + esc((d && d.error) || 'Gagal memuat.') + '</td></tr>';
                return;
            }
            el('stToday').textContent = (d.today && d.today.count) || 0;
            el('stWeek').textContent = (d.week && d.week.count) || 0;
            el('stTotal').textContent = (d.total && d.total.count) || 0;
            el('stRevenue').textContent = rupiah(d.total && d.total.revenue);

            var top = d.topPackages || [];
            el('topPackages').innerHTML = top.length
                ? top.map(function (t, i) {
                    return '<div class="d-flex justify-content-between align-items-center py-2"' + (i < top.length - 1 ? ' style="border-bottom:1px solid rgba(128,128,128,.15)"' : '') + '>'
                        + '<span>' + (i + 1) + '. ' + esc(t.name) + '</span><b>' + t.count + '×</b></div>';
                }).join('')
                : '<div class="text-muted text-center py-3">Belum ada penjualan.</div>';

            var rec = d.recent || [];
            el('recentBody').innerHTML = rec.length
                ? rec.map(function (x) {
                    return '<tr><td>' + fmtDate(x.ts) + '</td><td>' + esc(x.paket) + '</td><td>' + rupiah(x.amount) + '</td><td>' + (x.tag === 'buynowweb' ? 'Web' : 'WhatsApp') + '</td></tr>';
                }).join('')
                : '<tr><td colspan="4" class="text-center py-3 text-muted">Belum ada penjualan.</td></tr>';
        })
        .catch(function () {
            el('recentBody').innerHTML = '<tr><td colspan="4" class="text-center py-3 text-danger">Gagal memuat data.</td></tr>';
        });
})();
