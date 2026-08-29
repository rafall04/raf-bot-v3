/**
 * Header Doc
 * Purpose: Logika halaman Agen (/agen-pembayaran): muat pelanggan yang ditugaskan, ajukan
 *          pembayaran (CASH, butuh approval admin), tampilkan riwayat pengajuan & fee bulan ini.
 * Caller: views/sb-admin/agen-pembayaran.php.
 * Deps: jQuery + DataTables + Bootstrap; endpoint /api/me, /api/agen/customers, /api/agen/summary,
 *       /api/requests (GET/POST), /api/requests/cancel.
 * MainFuncs: loadAgenInfo, loadCustomers, loadRequests, loadFee, submitPaymentRequest, cancelRequest.
 * SideEffects: Membuat payment request via POST /api/requests.
 */
(function () {
  let allCustomers = [];
  let myRequests = [];
  let currentFilter = 'all';
  let selectedCustomerId = null;
  let customerTable = null;
  let requestTable = null;

  $(document).ready(function () {
    loadAgenInfo();
    refreshAll();

    $('#refreshBtn').on('click', refreshAll);
    $('.filter-tab').on('click', function () {
      $('.filter-tab').removeClass('active');
      $(this).addClass('active');
      currentFilter = $(this).data('filter');
      renderCustomers();
    });
    $('#confirmPaymentBtn').on('click', submitPaymentRequest);

    // Delegasi aksi tabel.
    $('#customerTable').on('click', '.btn-ajukan', function () {
      openPaymentModal(parseInt($(this).data('id'), 10));
    });
    $('#requestTable').on('click', '.btn-cancel-request', function () {
      cancelRequest($(this).data('id'));
    });
  });

  function refreshAll() {
    loadRequests();
    loadCustomers();
    loadFee();
  }

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
    $('#agenAlerts').html(html);
    setTimeout(function () { $('#agenAlerts .alert').alert('close'); }, 5000);
  }

  function loadAgenInfo() {
    fetch('/api/me', { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.status === 200 && data.data) {
          $('#loggedInAgenInfo').text(data.data.name || data.data.username || 'Agen');
        }
      })
      .catch(function () { $('#loggedInAgenInfo').text('Agen'); });
  }

  function loadCustomers() {
    $('#refreshBtn').prop('disabled', true);
    fetch('/api/agen/customers', { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.status === 200 && Array.isArray(data.data)) {
          allCustomers = data.data;
          updateStats();
          renderCustomers();
        } else {
          showAlert('danger', (data && data.message) || 'Gagal memuat pelanggan');
        }
      })
      .catch(function () { showAlert('danger', 'Terjadi kesalahan saat memuat pelanggan'); })
      .finally(function () { $('#refreshBtn').prop('disabled', false); });
  }

  function loadRequests() {
    fetch('/api/requests', { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.status === 200 && Array.isArray(data.data)) {
          myRequests = data.data;
          renderRequests();
          renderCustomers();
        }
      })
      .catch(function (err) { console.error('Error loading requests:', err); });
  }

  function loadFee() {
    fetch('/api/agen/summary', { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.status === 200 && data.data) {
          const summary = data.data.summary || {};
          $('#feeThisMonth').text(formatCurrency(summary.net_total || 0));
          $('#feeCustomerCount').text(summary.unique_paid_customers || 0);
        }
      })
      .catch(function (err) { console.error('Error loading fee:', err); });
  }

  function hasPendingRequest(userId) {
    return myRequests.some(function (r) {
      return String(r.userId) === String(userId) && r.status === 'pending';
    });
  }

  function updateStats() {
    const total = allCustomers.length;
    const paid = allCustomers.filter(function (c) { return c.paid; }).length;
    $('#totalCustomers').text(total);
    $('#paidCount').text(paid);
    $('#unpaidCount').text(total - paid);
  }

  function renderCustomers() {
    if (customerTable) {
      customerTable.destroy();
      customerTable = null;
    }
    let rows = allCustomers;
    if (currentFilter === 'paid') {
      rows = allCustomers.filter(function (c) { return c.paid; });
    } else if (currentFilter === 'unpaid') {
      rows = allCustomers.filter(function (c) { return !c.paid; });
    }

    const tbody = $('#customerTable tbody');
    tbody.empty();
    rows.forEach(function (c) {
      const pending = hasPendingRequest(c.id);
      let badge;
      if (pending) {
        badge = '<span class="badge badge-warning"><i class="fas fa-clock"></i> Menunggu Approval</span>';
      } else if (c.paid) {
        badge = '<span class="badge badge-success"><i class="fas fa-check"></i> Lunas</span>';
      } else {
        badge = '<span class="badge badge-danger"><i class="fas fa-times"></i> Belum Bayar</span>';
      }
      let action = '-';
      if (!c.paid && !pending) {
        action = '<button class="btn btn-sm btn-success btn-ajukan" data-id="' + c.id + '">' +
          '<i class="fas fa-money-bill-wave"></i> Ajukan</button>';
      }
      const phone = c.phone_number ? c.phone_number.split('|')[0].trim() : '-';
      tbody.append(
        '<tr>' +
        '<td>' + c.id + '</td>' +
        '<td>' + escapeHtml(c.name) + '<br><small class="text-muted"><i class="fas fa-phone"></i> ' + escapeHtml(phone) + '</small></td>' +
        '<td>' + escapeHtml(c.subscription || '-') + '</td>' +
        '<td>' + formatCurrency(c.package_price) + '</td>' +
        '<td>' + badge + '</td>' +
        '<td>' + action + '</td>' +
        '</tr>'
      );
    });

    customerTable = $('#customerTable').DataTable({
      order: [[0, 'asc']],
      pageLength: 25,
      language: { search: 'Cari:', emptyTable: 'Belum ada pelanggan yang ditugaskan kepada Anda.' }
    });
  }

  function openPaymentModal(customerId) {
    const customer = allCustomers.find(function (c) { return String(c.id) === String(customerId); });
    if (!customer) {
      showAlert('danger', 'Data pelanggan tidak ditemukan');
      return;
    }
    selectedCustomerId = customerId;
    const html =
      '<h5><i class="fas fa-user"></i> ' + escapeHtml(customer.name) + '</h5>' +
      '<div class="d-flex justify-content-between"><span class="text-muted">Paket</span><span>' + escapeHtml(customer.subscription || '-') + '</span></div>' +
      '<div class="d-flex justify-content-between"><span class="text-muted">Tagihan</span><strong>' + formatCurrency(customer.package_price) + '</strong></div>';
    $('#paymentCustomerSummary').html(html);
    $('#paymentNotes').val('');
    $('#requestPaymentModal').modal('show');
  }

  function submitPaymentRequest() {
    if (!selectedCustomerId) {
      showAlert('danger', 'Pelanggan tidak dipilih');
      return;
    }
    const btn = $('#confirmPaymentBtn');
    btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Mengirim...');
    fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ userId: selectedCustomerId, newStatus: true })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && (data.status === 200 || data.status === 201)) {
          $('#requestPaymentModal').modal('hide');
          showAlert('success', 'Pengajuan pembayaran berhasil dikirim! Menunggu approval admin.');
          loadRequests();
          setTimeout(loadCustomers, 400);
        } else {
          showAlert('danger', (data && data.message) || 'Gagal mengirim pengajuan');
        }
      })
      .catch(function () { showAlert('danger', 'Terjadi kesalahan saat mengirim pengajuan'); })
      .finally(function () {
        btn.prop('disabled', false).html('<i class="fas fa-paper-plane"></i> Kirim Pengajuan');
        selectedCustomerId = null;
      });
  }

  function requestStatusBadge(status) {
    const map = {
      approved: ['badge-success', 'Disetujui'],
      pending: ['badge-warning', 'Menunggu'],
      rejected: ['badge-danger', 'Ditolak'],
      cancelled_by_agen: ['badge-secondary', 'Dibatalkan Anda'],
      cancelled_by_technician: ['badge-secondary', 'Dibatalkan'],
      cancelled_by_system: ['badge-info', 'Dibatalkan Sistem']
    };
    const entry = map[status] || ['badge-dark', status || '-'];
    return '<span class="badge ' + entry[0] + '">' + entry[1] + '</span>';
  }

  function renderRequests() {
    if (requestTable) {
      requestTable.destroy();
      requestTable = null;
    }
    const tbody = $('#requestTable tbody');
    tbody.empty();
    myRequests.forEach(function (r) {
      const created = r.created_at ? new Date(r.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
      const updated = r.updated_at ? new Date(r.updated_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
      let action = '-';
      if (r.status === 'pending') {
        action = '<button class="btn btn-sm btn-danger btn-cancel-request" data-id="' + r.id + '"><i class="fas fa-times-circle"></i> Batalkan</button>';
      }
      tbody.append(
        '<tr>' +
        '<td>' + escapeHtml(r.userName || ('ID ' + r.userId)) + '</td>' +
        '<td>' + created + '</td>' +
        '<td>' + requestStatusBadge(r.status) + '</td>' +
        '<td>' + updated + '</td>' +
        '<td>' + action + '</td>' +
        '</tr>'
      );
    });
    requestTable = $('#requestTable').DataTable({
      order: [[1, 'desc']],
      pageLength: 10,
      language: { search: 'Cari:', emptyTable: 'Belum ada pengajuan.' }
    });
  }

  function doCancelRequest(requestId) {
    fetch('/api/requests/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ requestId: requestId })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.status === 200) {
          showAlert('success', 'Pengajuan dibatalkan.');
          loadRequests();
          setTimeout(loadCustomers, 400);
        } else {
          showAlert('danger', (data && data.message) || 'Gagal membatalkan pengajuan');
        }
      })
      .catch(function () { showAlert('danger', 'Terjadi kesalahan saat membatalkan pengajuan'); });
  }

  function cancelRequest(requestId) {
    // Dialog konfirmasi SERAGAM (SweetAlert, sama seperti halaman admin lain). FALLBACK ke
    // window.confirm bila Swal gagal dimuat (agen di lapangan, koneksi CDN bisa putus) — pembatalan
    // tetap harus bisa jalan.
    if (typeof Swal === 'undefined' || !Swal.fire) {
      if (window.confirm('Batalkan pengajuan ini?')) doCancelRequest(requestId);
      return;
    }
    Swal.fire({
      title: 'Batalkan pengajuan?',
      text: 'Pengajuan pembayaran ini akan dibatalkan.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#e74a3b',
      cancelButtonColor: '#858796',
      confirmButtonText: 'Ya, batalkan',
      cancelButtonText: 'Tidak'
    }).then(function (result) {
      if (result && result.isConfirmed) doCancelRequest(requestId);
    });
  }
})();
