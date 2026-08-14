/**
 * Header Doc
 * Purpose: Logika halaman admin Laporan Komisi Agen (/laporan-agen): filter periode/agen,
 *          tampilkan ringkasan + rincian fee agen dari /api/agen/report.
 * Caller: views/sb-admin/laporan-agen.php.
 * Deps: jQuery + DataTables; endpoint /api/agen/list, /api/agen/report.
 * MainFuncs: initFilters, loadAgents, loadReport.
 * SideEffects: Tidak ada (read-only).
 */
(function () {
  let summaryTable = null;
  let entryTable = null;
  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  $(document).ready(function () {
    initFilters();
    loadAgents();
    loadReport();
    $('#applyFilterBtn').on('click', loadReport);
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

  function loadAgents() {
    fetch('/api/agen/list', { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.status === 200 && Array.isArray(data.data)) {
          const select = $('#filterAgen');
          data.data.forEach(function (a) {
            select.append('<option value="' + a.id + '">' + escapeHtml(a.name) + '</option>');
          });
        }
      })
      .catch(function (err) { console.error('Error loading agents:', err); });
  }

  function loadReport() {
    const month = $('#filterMonth').val();
    const year = $('#filterYear').val();
    const agenId = $('#filterAgen').val();
    let url = '/api/agen/report?month=' + encodeURIComponent(month) + '&year=' + encodeURIComponent(year);
    if (agenId) { url += '&agen_id=' + encodeURIComponent(agenId); }

    fetch(url, { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.status !== 200 || !data.data) {
          showAlert('danger', (data && data.message) || 'Gagal memuat laporan');
          return;
        }
        const d = data.data;
        const totals = d.totals || {};
        $('#totalCredit').text(formatCurrency(totals.total_credit));
        $('#totalDebit').text(formatCurrency(totals.total_debit));
        $('#totalNet').text(formatCurrency(totals.net_total));
        $('#commissionPer').text(formatCurrency(d.commission_per_customer));
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
      tbody.append(
        '<tr>' +
        '<td>' + escapeHtml(s.agen_name) + '</td>' +
        '<td>' + (s.unique_paid_customers || 0) + '</td>' +
        '<td class="text-success">' + formatCurrency(s.total_credit) + '</td>' +
        '<td class="text-danger">' + formatCurrency(s.total_debit) + '</td>' +
        '<td><strong>' + formatCurrency(s.net_total) + '</strong></td>' +
        '</tr>'
      );
    });
    summaryTable = $('#summaryTable').DataTable({
      order: [[4, 'desc']],
      pageLength: 10,
      language: { search: 'Cari:', emptyTable: 'Belum ada fee pada periode ini.' }
    });
  }

  function renderEntries(entries) {
    if (entryTable) { entryTable.destroy(); entryTable = null; }
    const tbody = $('#entryTable tbody');
    tbody.empty();
    entries.forEach(function (e) {
      const dateStr = e.created_at ? new Date(e.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
      const isCredit = e.direction === 'credit';
      const jenis = isCredit
        ? '<span class="badge badge-success">Fee</span>'
        : '<span class="badge badge-danger">Reversal</span>';
      const nominal = (isCredit ? '+' : '-') + formatCurrency(e.commission_amount);
      tbody.append(
        '<tr>' +
        '<td>' + dateStr + '</td>' +
        '<td>' + escapeHtml(e.agen_name) + '</td>' +
        '<td>' + escapeHtml(e.user_name) + '</td>' +
        '<td>' + jenis + '</td>' +
        '<td class="' + (isCredit ? 'text-success' : 'text-danger') + '">' + nominal + '</td>' +
        '</tr>'
      );
    });
    entryTable = $('#entryTable').DataTable({
      order: [[0, 'desc']],
      pageLength: 25,
      language: { search: 'Cari:', emptyTable: 'Belum ada transaksi.' }
    });
  }
})();
