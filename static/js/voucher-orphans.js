/**
 * Header Doc
 * Purpose: Halaman /voucher-orphans — worklist rekonsiliasi voucher orphan. Menampilkan
 *   statistik (open/resolved/total) + tabel entri dengan aksi per-baris:
 *     fulfill  → terbitkan voucher BARU (entri paid_unissued: bayar sukses, voucher gagal).
 *     send     → kirim ulang kode voucher yang SUDAH terbit (entri created_unpaid).
 *     manual   → tandai selesai (admin tindak manual di luar sistem).
 *     refund   → tandai selesai sebagai refund (uang dikembalikan di luar sistem).
 * Caller: views/sb-admin/voucher-orphans.php.
 * Deps: GET /api/voucher/orphans, POST /api/voucher/orphans/:id/resolve (staff-guarded).
 * MainFuncs: loadOrphans, renderRows, resolveOrphan.
 * SideEffects: Fetch API + DOM render; konfirmasi via confirm()/prompt() bawaan browser.
 */
(function () {
    'use strict';

    var currentStatus = 'open';

    function el(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function rupiah(n) {
        var v = parseInt(n, 10) || 0;
        return 'Rp' + v.toLocaleString('id-ID');
    }
    function fmtDate(v) {
        var d = new Date(v);
        return isNaN(d) ? '-' : d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    }
    function toast(msg, isErr) {
        var t = el('voToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'voToast';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.className = 'vo-toast show' + (isErr ? ' err' : '');
        setTimeout(function () { t.className = 'vo-toast'; }, 3500);
    }

    function kindLabel(o) {
        return o.kind === 'created_unpaid'
            ? '<span class="vo-kind vo-kind-warn">Terbit tanpa tagihan</span>'
            : '<span class="vo-kind vo-kind-fail">Gagal terbit</span>';
    }

    function actionButtons(o) {
        if (o.resolved) {
            var res = o.resolution || {};
            var lbl = res.action === 'fulfill' ? 'Diterbitkan' : res.action === 'send' ? 'Dikirim ulang'
                : res.action === 'refund' ? 'Refund' : 'Manual';
            return '<span class="vo-done">✓ ' + esc(lbl) + '</span>'
                + (res.note ? '<div class="vo-note">' + esc(res.note) + '</div>' : '');
        }
        var btns = [];
        if (o.kind === 'paid_unissued' && o.referenceId && o.profile && o.sender) {
            btns.push('<button type="button" class="vo-btn vo-btn-fulfill" data-id="' + esc(o.id) + '" data-action="fulfill">Terbitkan</button>');
        }
        if (o.kind === 'created_unpaid' && o.voucherCode && /^[0-9]{9,}$/.test(String(o.sender).replace(/\D/g, ''))) {
            btns.push('<button type="button" class="vo-btn vo-btn-send" data-id="' + esc(o.id) + '" data-action="send">Kirim WA</button>');
        }
        btns.push('<button type="button" class="vo-btn vo-btn-manual" data-id="' + esc(o.id) + '" data-action="manual">Manual</button>');
        if (o.kind === 'paid_unissued') {
            btns.push('<button type="button" class="vo-btn vo-btn-refund" data-id="' + esc(o.id) + '" data-action="refund">Refund</button>');
        }
        return btns.join(' ');
    }

    function renderRows(items) {
        var tb = el('orphanBody');
        if (!items.length) {
            tb.innerHTML = '<tr><td colspan="8" class="text-center py-3 text-muted">Tidak ada entri.</td></tr>';
            return;
        }
        tb.innerHTML = items.map(function (o) {
            var kode = o.voucherCode
                ? '<code class="vo-code">' + esc(o.voucherCode) + '</code>'
                : '<span class="vo-muted">—</span>';
            var ket = o.error ? '<span class="vo-note">' + esc(o.error) + '</span>' : '<span class="vo-muted">—</span>';
            if (o.type) ket = '<span class="vo-note">' + esc(o.type) + '</span><br>' + ket;
            if (o.referenceId) ket += '<div class="vo-note">ref: ' + esc(o.referenceId) + '</div>';
            return '<tr>'
                + '<td>' + esc(fmtDate(o.timestamp)) + '</td>'
                + '<td>' + kindLabel(o) + '</td>'
                + '<td>' + esc(o.profile || '-') + '</td>'
                + '<td>' + rupiah(o.amount) + '</td>'
                + '<td>' + esc(o.sender || '-') + '</td>'
                + '<td>' + kode + '</td>'
                + '<td>' + ket + '</td>'
                + '<td>' + actionButtons(o) + '</td>'
                + '</tr>';
        }).join('');
    }

    function loadOrphans() {
        fetch('/api/voucher/orphans?status=' + currentStatus, { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.stats) {
                    el('stOpen').textContent = d.stats.open;
                    el('stResolved').textContent = d.stats.resolved;
                    el('stTotal').textContent = d.stats.total;
                }
                renderRows(d.items || []);
            })
            .catch(function () {
                el('orphanBody').innerHTML = '<tr><td colspan="8" class="text-center py-3 text-danger">Gagal memuat data.</td></tr>';
            });
    }

    var ACTION_CONFIRM = {
        fulfill: 'Terbitkan voucher BARU untuk pembelian ini? Voucher MikroTik dibuat sekali — pastikan entri belum diproses.',
        send: 'Kirim ulang kode voucher yang sudah ada ke WhatsApp pembeli?',
        manual: 'Tandai selesai tanpa aksi otomatis? (admin menindak manual di luar sistem)',
        refund: 'Tandai sebagai REFUND? Pastikan uang sudah dikembalikan ke pembeli di luar sistem.'
    };

    function resolveOrphan(id, action, btn) {
        if (!confirm(ACTION_CONFIRM[action])) return;
        var note = '';
        if (action === 'manual' || action === 'refund') {
            note = window.prompt('Catatan (opsional):', '') || '';
        }
        btn.disabled = true;
        fetch('/api/voucher/orphans/' + encodeURIComponent(id) + '/resolve', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: action, note: note })
        })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
            .then(function (res) {
                toast(res.d.message || (res.ok ? 'Berhasil.' : 'Gagal.'), !res.ok);
                loadOrphans();
            })
            .catch(function () {
                toast('Gagal menghubungi server.', true);
                btn.disabled = false;
            });
    }

    document.addEventListener('click', function (e) {
        var tab = e.target.closest && e.target.closest('.vo-tab');
        if (tab) {
            document.querySelectorAll('.vo-tab').forEach(function (t) { t.classList.remove('active'); });
            tab.classList.add('active');
            currentStatus = tab.getAttribute('data-status');
            loadOrphans();
            return;
        }
        var btn = e.target.closest && e.target.closest('.vo-btn');
        if (btn && !btn.disabled) {
            resolveOrphan(btn.getAttribute('data-id'), btn.getAttribute('data-action'), btn);
        }
    });

    loadOrphans();
})();
