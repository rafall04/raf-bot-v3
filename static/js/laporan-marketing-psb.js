/**
 * Header Doc
 * Purpose: Logika halaman admin Laporan Marketing PSB (/laporan-marketing-psb): filter periode/rentang,
 *          tampilkan ringkasan komisi per PEMBERI LEAD + rincian per pemasangan dari
 *          /api/psb-schedule/marketing-report.
 * Caller: views/sb-admin/laporan-marketing-psb.php.
 * Deps: jQuery + DataTables; endpoint /api/psb-schedule/marketing-report.
 * MainFuncs: initFilters, loadReport, renderSummary, renderEntries.
 * SideEffects: Tidak ada (read-only).
 */
(function () {
  let summaryTable = null;
  let entryTable = null;
  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  $(document).ready(function () {
    initFilters();
    loadReport();
    $('#applyFilterBtn').on('click', loadReport);
    $('#filterScope').on('change', function () {
      const period = $(this).val() === 'period';
      $('#filterMonth,#filterYear').prop('disabled', !period);
    });
  });

  function formatCurrency(amount) {
    return 'Rp ' + Number(amount || 0).toLocaleString('id-ID');
  }

  // Delegasi ke helper bersama (static/js/html-escape.js, dimuat lewat _head.php).

  // Implementasi lama memakai `div.textContent -> div.innerHTML`, yang HANYA meloloskan

  // & < > — TIDAK " maupun '. Untuk atribut/argumen handler, nama ber-apostrof memutus string.

  function escapeHtml(text) {

      return typeof rafEscapeHtml === 'function'

          ? rafEscapeHtml(text)

          : String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {

              return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];

          });

  }

  function showAlert(type, message) {
    const html = '<div class="alert alert-' + type + ' alert-dismissible fade show" role="alert">' +
      escapeHtml(message) +
      '<button type="button" class="close" data-dismiss="alert"><span>&times;</span></button></div>';
    $('#laporanAlerts').html(html);
    setTimeout(function () { $('#laporanAlerts .alert').alert('close'); }, 5000);
  }

  function typeBadge(type) {
    if (type === 'teknisi') return '<span class="badge badge-info">Teknisi</span>';
    if (type === 'luar') return '<span class="badge badge-warning">Luar</span>';
    return '<span class="badge badge-light">Belum diklasifikasi</span>';
  }

  function statusBadge(status) {
    if (status === 'paid') return '<span class="badge badge-success">Dibayar (kas)</span>';
    if (status === 'settled') return '<span class="badge badge-info">Via gaji</span>';
    return '<span class="badge badge-secondary">Belum dibayar</span>';
  }

  function initFilters() {
    const now = new Date();
    const monthSel = $('#filterMonth');
    MONTHS.forEach(function (name, idx) {
      monthSel.append('<option value="' + (idx + 1) + '">' + name + '</option>');
    });
    monthSel.val(now.getMonth() + 1);

    const yearSel = $('#filterYear');
    const currentYear = now.getFullYear();
    for (let y = currentYear; y >= currentYear - 3; y--) {
      yearSel.append('<option value="' + y + '">' + y + '</option>');
    }
    yearSel.val(currentYear);
  }

  function loadReport() {
    let url = '/api/psb-schedule/marketing-report';
    if ($('#filterScope').val() === 'period') {
      const month = $('#filterMonth').val();
      const year = $('#filterYear').val();
      url += '?month=' + encodeURIComponent(month) + '&year=' + encodeURIComponent(year);
    }

    fetch(url, { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.status !== 200 || !data.data) {
          showAlert('danger', (data && data.message) || 'Gagal memuat laporan');
          return;
        }
        const d = data.data;
        const totals = d.totals || {};
        $('#totalFee').text(formatCurrency(totals.total_fee));
        $('#totalCount').text(totals.count || 0);
        $('#totalPending').text(formatCurrency(totals.pending_amount));
        $('#totalPaid').text(formatCurrency(totals.paid_amount));
        $('#totalSettled').text(formatCurrency(totals.settled_amount));
        renderSummary(d.summary || []);
        renderEntries(d.entries || []);
      })
      .catch(function () { showAlert('danger', 'Terjadi kesalahan saat memuat laporan'); });
  }

  function renderSummary(summary) {
    if (summaryTable) { summaryTable.destroy(); summaryTable = null; }
    const tbody = $('#summaryTable tbody');
    tbody.empty();
    summary.forEach(function (s) {
      const nama = escapeHtml(s.name) + (s.phone ? ' <small class="text-muted">' + escapeHtml(s.phone) + '</small>' : '');
      tbody.append(
        '<tr>' +
        '<td>' + nama + '</td>' +
        '<td>' + typeBadge(s.type) + '</td>' +
        '<td>' + (s.count || 0) + '</td>' +
        '<td><strong>' + formatCurrency(s.total_fee) + '</strong></td>' +
        '<td class="text-secondary">' + formatCurrency(s.pending_amount) + '</td>' +
        '<td class="text-success">' + formatCurrency((s.paid_amount || 0) + (s.settled_amount || 0)) + '</td>' +
        '</tr>'
      );
    });
    summaryTable = $('#summaryTable').DataTable({
      order: [[3, 'desc']],
      pageLength: 10,
      language: { search: 'Cari:', emptyTable: 'Belum ada komisi marketing pada rentang ini.' }
    });
  }

  function renderEntries(entries) {
    if (entryTable) { entryTable.destroy(); entryTable = null; }
    const tbody = $('#entryTable tbody');
    tbody.empty();
    entries.forEach(function (e) {
      const dateStr = e.date ? new Date(e.date).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
      tbody.append(
        '<tr>' +
        '<td>' + dateStr + '</td>' +
        '<td><code>' + escapeHtml(e.ref) + '</code></td>' +
        '<td>' + escapeHtml(e.customer_name) + '</td>' +
        '<td>' + escapeHtml(e.referrer_name) + '</td>' +
        '<td>' + typeBadge(e.type) + '</td>' +
        '<td>' + formatCurrency(e.fee) + '</td>' +
        '<td>' + statusBadge(e.status) + '</td>' +
        '</tr>'
      );
    });
    entryTable = $('#entryTable').DataTable({
      order: [[0, 'desc']],
      pageLength: 25,
      language: { search: 'Cari:', emptyTable: 'Belum ada pemasangan berkomisi.' }
    });
  }
})();
