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
                el('recentBody').innerHTML = '<tr><td colspan="6" class="text-center py-3 text-danger">' + esc((d && d.error) || 'Gagal memuat.') + '</td></tr>';
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
                    var kode, aksi;
                    if (x.code) {
                        kode = '<code class="vc-code">' + esc(x.code) + '</code>'
                            + '<button type="button" class="vc-copy" data-code="' + esc(x.code) + '" title="Salin kode">Salin</button>';
                        aksi = '<button type="button" class="vc-resend" data-ref="' + esc(x.ref) + '">Kirim ulang</button>';
                    } else if (x.failed) {
                        kode = '<span class="vc-badge-fail">⚠ gagal terbit</span>';
                        aksi = '<span class="vc-muted">perlu terbitkan ulang</span>';
                    } else {
                        kode = '<span class="vc-muted">—</span>';
                        aksi = '';
                    }
                    return '<tr><td>' + fmtDate(x.ts) + '</td><td>' + esc(x.paket) + '</td><td>' + rupiah(x.amount) + '</td><td>' + (x.tag === 'buynowweb' ? 'Web' : 'WhatsApp') + '</td><td>' + kode + '</td><td>' + aksi + '</td></tr>';
                }).join('')
                : '<tr><td colspan="6" class="text-center py-3 text-muted">Belum ada penjualan.</td></tr>';
        })
        .catch(function () {
            el('recentBody').innerHTML = '<tr><td colspan="6" class="text-center py-3 text-danger">Gagal memuat data.</td></tr>';
        });

    // Salin kode + kirim ulang (delegasi klik; baris di-render async setelah fetch).
    function fallbackCopy(text) {
        try { var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t); } catch (_e) {}
    }
    var body = el('recentBody');
    if (body) {
        body.addEventListener('click', function (e) {
            var cp = e.target.closest && e.target.closest('.vc-copy');
            if (cp) {
                var code = cp.getAttribute('data-code') || '';
                var done = function () { var o = cp.textContent; cp.textContent = 'Tersalin'; setTimeout(function () { cp.textContent = o; }, 1200); };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(code).then(done).catch(function () { fallbackCopy(code); done(); });
                } else { fallbackCopy(code); done(); }
                return;
            }
            var rs = e.target.closest && e.target.closest('.vc-resend');
            if (rs) {
                var ref = rs.getAttribute('data-ref');
                if (!ref) return;
                rs.disabled = true; var orig = rs.textContent; rs.textContent = 'Mengirim…';
                fetch('/api/voucher/resend', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reff: ref }) })
                    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
                    .then(function (res) {
                        rs.disabled = false; rs.textContent = orig;
                        var m = (res.j && res.j.message) || (res.ok ? 'Terkirim.' : 'Gagal.');
                        if (res.j && res.j.code && !res.ok) m += '\n\nKode: ' + res.j.code + ' (salin & kirim manual)';
                        alert(m);
                    })
                    .catch(function () { rs.disabled = false; rs.textContent = orig; alert('Gagal menghubungi server.'); });
                return;
            }
        });
    }
})();
