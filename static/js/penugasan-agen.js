/**
 * Header Doc
 * Purpose: Logika halaman admin Penugasan Agen (/penugasan-agen): pilih agen, centang pelanggan,
 *          lalu tugaskan/lepas penugasan (users.assigned_agen_id) via /api/agen/assign.
 * Caller: views/sb-admin/penugasan-agen.php.
 * Deps: jQuery + DataTables; endpoint /api/agen/list, /api/agen/assignments, /api/agen/assign.
 * MainFuncs: loadAgents, loadCustomers, doAssign.
 * SideEffects: Menulis penugasan agen lewat POST /api/agen/assign.
 */
(function () {
  let table = null;
  const selectedIds = new Set();

  $(document).ready(function () {
    loadAgents();
    loadCustomers();

    $('#agenSelect').on('change', updateButtons);
    $('#assignBtn').on('click', function () { doAssign(false); });
    $('#unassignBtn').on('click', function () { doAssign(true); });

    // Filter "Tampilkan": Semua / Belum ditugaskan / Ditugaskan ke <agen>. Custom search DataTables
    // (dibaca dari #filterAgen + atribut data-agen-id tiap baris). Didaftarkan SEKALI (global, tapi
    // dijaga ke id tabel ini) supaya tak menumpuk saat tabel dibangun ulang.
    $.fn.dataTable.ext.search.push(function (settings, dataRow, dataIndex) {
      if (!settings.nTable || settings.nTable.id !== 'assignTable') return true;
      const f = $('#filterAgen').val() || '__all__';
      if (f === '__all__') return true;
      const node = table ? table.row(dataIndex).node() : null;
      const agenId = node ? String($(node).attr('data-agen-id') || '') : '';
      if (f === '__none__') return agenId === '';
      return agenId === String(f);
    });
    $('#filterAgen').on('change', function () { if (table) table.draw(); });

    // "Pilih semua" menghormati filter aktif: centang SEMUA baris terfilter (lintas halaman),
    // bukan cuma halaman yang tampak — supaya "tampilkan belum ditugaskan → pilih semua → tugaskan".
    $('#selectAll').on('change', function () {
      const checked = $(this).is(':checked');
      if (!table) return;
      table.rows({ search: 'applied' }).nodes().each(function (rowNode) {
        const cb = $(rowNode).find('.row-check');
        cb.prop('checked', checked);
        const id = String(cb.data('id'));
        if (checked) { selectedIds.add(id); } else { selectedIds.delete(id); }
      });
      updateButtons();
    });

    $('#assignTable').on('change', '.row-check', function () {
      const id = String($(this).data('id'));
      if ($(this).is(':checked')) { selectedIds.add(id); } else { selectedIds.delete(id); }
      updateButtons();
    });
  });

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
    $('#penugasanAlerts').html(html);
    setTimeout(function () { $('#penugasanAlerts .alert').alert('close'); }, 5000);
  }

  function updateButtons() {
    const hasSelection = selectedIds.size > 0;
    const hasAgen = $('#agenSelect').val() !== '';
    $('#assignBtn').prop('disabled', !(hasSelection && hasAgen));
    $('#unassignBtn').prop('disabled', !hasSelection);
  }

  function loadAgents() {
    fetch('/api/agen/list', { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.status === 200 && Array.isArray(data.data)) {
          const select = $('#agenSelect');
          const filterSel = $('#filterAgen');
          data.data.forEach(function (a) {
            select.append('<option value="' + a.id + '">' + escapeHtml(a.name) + ' (' + escapeHtml(a.username) + ')</option>');
            filterSel.append('<option value="' + a.id + '">Ditugaskan ke: ' + escapeHtml(a.name) + '</option>');
          });
          if (data.data.length === 0) {
            showAlert('info', 'Belum ada akun dengan role "agen". Buat dulu di menu Akun Admin.');
          }
        }
      })
      .catch(function () { showAlert('danger', 'Gagal memuat daftar agen'); });
  }

  function loadCustomers() {
    if (table) { table.destroy(); table = null; }
    selectedIds.clear();
    $('#selectAll').prop('checked', false);
    updateButtons();

    fetch('/api/agen/assignments', { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        const tbody = $('#assignTable tbody');
        tbody.empty();
        if (data && data.status === 200 && Array.isArray(data.data)) {
          data.data.forEach(function (c) {
            const agenLabel = c.assigned_agen_name
              ? '<span class="badge badge-info">' + escapeHtml(c.assigned_agen_name) + '</span>'
              : '<span class="text-muted">-</span>';
            tbody.append(
              '<tr data-agen-id="' + (c.assigned_agen_id != null ? escapeHtml(String(c.assigned_agen_id)) : '') + '">' +
              '<td><input type="checkbox" class="row-check" data-id="' + c.id + '"></td>' +
              '<td>' + c.id + '</td>' +
              '<td>' + escapeHtml(c.name) + '</td>' +
              '<td>' + escapeHtml(c.subscription || '-') + '</td>' +
              '<td>' + agenLabel + '</td>' +
              '</tr>'
            );
          });
        }
        table = $('#assignTable').DataTable({
          order: [[1, 'asc']],
          pageLength: 25,
          columnDefs: [{ orderable: false, targets: 0 }],
          language: { search: 'Cari:', emptyTable: 'Tidak ada pelanggan.' }
        });
      })
      .catch(function () { showAlert('danger', 'Gagal memuat data pelanggan'); });
  }

  function doAssign(unassign) {
    const userIds = Array.from(selectedIds).map(function (id) { return parseInt(id, 10); });
    if (userIds.length === 0) {
      showAlert('warning', 'Pilih minimal satu pelanggan.');
      return;
    }
    const agenId = unassign ? null : parseInt($('#agenSelect').val(), 10);
    if (!unassign && !agenId) {
      showAlert('warning', 'Pilih agen terlebih dahulu.');
      return;
    }

    const btn = unassign ? $('#unassignBtn') : $('#assignBtn');
    const originalHtml = btn.html();
    btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Memproses...');

    fetch('/api/agen/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ agenId: agenId, userIds: userIds })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.status === 200) {
          showAlert('success', data.message || 'Penugasan berhasil diperbarui.');
          loadCustomers();
        } else {
          showAlert('danger', (data && data.message) || 'Gagal memperbarui penugasan');
        }
      })
      .catch(function () { showAlert('danger', 'Terjadi kesalahan saat memproses penugasan'); })
      .finally(function () { btn.html(originalHtml); });
  }
})();
