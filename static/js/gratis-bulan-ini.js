/*
 * gratis-bulan-ini.js — halaman admin "Gratis Bulan Ini" (waiver bebas tagihan).
 * Menandai periode terpilih sebagai GRATIS untuk pelanggan baru: periode dihitung LUNAS (kebal isolir)
 * TANPA masuk pemasukan (waiver terpisah), pelanggan mulai bayar bulan depan.
 * Auth: cookie httpOnly `token` via credentials:'include'.
 * API: GET /api/payment-status/read-model (daftar+status) · POST /api/payment-status/free (aksi waiver).
 */
(function () {
  "use strict";

  var BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  var isLoading = false;
  var rows = []; // read-model users untuk periode terpilih

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function rupiah(n) { return "Rp " + Number(n || 0).toLocaleString("id-ID"); }
  function el(id) { return document.getElementById(id); }

  function getPeriod() {
    return { month: parseInt(el("filter-month").value, 10), year: parseInt(el("filter-year").value, 10) };
  }

  // Hanya pelanggan bertagihan bulanan yang relevan untuk waiver: buang voucher & paket gratis (amount 0),
  // sejalan dengan guard endpoint /free (tolak PAKET-VOUCHER & whitelist).
  function isBillable(u) {
    return u.subscription !== "PAKET-VOUCHER" && Number(u.amount_due || 0) > 0;
  }
  function isActionable(u) {
    // Bisa digratiskan = belum lunas & belum digratiskan (kalau sudah bayar cash, waiver tak masuk akal).
    return isBillable(u) && !u.is_waived && !(u.paid === 1 || u.paid === true);
  }

  function statusBadge(u) {
    if (u.is_waived) return '<span class="badge badge-success">GRATIS bulan ini</span>';
    if (u.paid === 1 || u.paid === true) return '<span class="badge badge-secondary">Sudah lunas</span>';
    return '<span class="badge badge-warning">Belum bayar</span>';
  }

  function visibleRows() {
    var q = String(el("search-input").value || "").trim().toLowerCase();
    var onlyUnpaid = el("only-unpaid").checked;
    return rows.filter(function (u) {
      if (!isBillable(u)) return false;
      if (onlyUnpaid && !isActionable(u)) return false;
      if (!q) return true;
      var hay = (String(u.name || "") + " " + String(u.phone_number || "")).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function rowHtml(u) {
    var actionable = isActionable(u);
    var cb = actionable
      ? '<input type="checkbox" class="row-check" value="' + esc(u.id) + '">'
      : '';
    // !! JANGAN kembali ke onclick="gratiskan('...')". Nama dulu ditambal dengan
    // `esc(nama).replace(/'/g, "\\'")` — dan itu TIDAK PERNAH cocok, karena esc() sudah
    // lebih dulu mengubah ' jadi &#39;. Saat peramban mengurai atribut onclick, entitasnya
    // dikembalikan jadi apostrof dan memecah string JS-nya: gratiskan('2','Ma'ruf',110000)
    // -> SyntaxError, tombol diam tanpa pesan apa pun. Nama seperti Ma'ruf / Sa'diyah lazim
    // di basis pelanggan ini. Data dibawa lewat atribut data-*, dipasang lewat delegasi klik
    // di bawah, sehingga tak ada lagi nama yang masuk ke dalam kode. Lihat boundary #b294.
    var btn = actionable
      ? '<button type="button" class="btn btn-sm btn-success btn-gratiskan"' +
        ' data-id="' + esc(u.id) + '"' +
        ' data-nama="' + esc(String(u.name || "")) + '"' +
        ' data-amount="' + Number(u.amount_due || 0) + '">' +
        '<i class="fas fa-gift"></i> Gratiskan</button>'
      : '<span class="text-muted small">—</span>';
    return '' +
      '<tr data-id="' + esc(u.id) + '">' +
        '<td>' + cb + '</td>' +
        '<td><div class="font-weight-bold">' + esc(u.name || "-") + '</div>' +
          '<div class="text-muted small">' + esc(u.phone_number || "") + '</div></td>' +
        '<td>' + esc(u.subscription || "-") + '</td>' +
        '<td>' + rupiah(u.amount_due) + '</td>' +
        '<td>' + statusBadge(u) + '</td>' +
        '<td class="text-right">' + btn + '</td>' +
      '</tr>';
  }

  function render() {
    var items = visibleRows();
    var tbody = el("free-tbody");
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted p-4">' +
        'Tidak ada pelanggan yang cocok. Coba matikan filter "Hanya yang belum lunas" atau ubah pencarian.</td></tr>';
    } else {
      tbody.innerHTML = items.map(rowHtml).join("");
    }
    el("select-all").checked = false;
    updateSelectedCount();
  }

  function selectedIds() {
    return Array.prototype.slice.call(document.querySelectorAll(".row-check:checked")).map(function (c) { return c.value; });
  }
  function updateSelectedCount() {
    var n = selectedIds().length;
    el("selected-count").textContent = n;
    el("bulk-free-btn").disabled = n === 0;
  }

  async function loadList() {
    if (isLoading) return;
    isLoading = true;
    var tbody = el("free-tbody");
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted p-4">Memuat data pelanggan…</td></tr>';
    try {
      var p = getPeriod();
      var res = await fetch("/api/payment-status/read-model?period_month=" + p.month + "&period_year=" + p.year + "&_=" + Date.now(), {
        credentials: "include"
      });
      if (!res.ok) {
        if (res.status === 401) { window.location.href = "/login"; return; }
        throw new Error("HTTP " + res.status);
      }
      var data = await res.json();
      rows = data && data.status === 200 && Array.isArray(data.data) ? data.data : [];
      render();
    } catch (e) {
      console.error("[gratis-bulan-ini] gagal memuat:", e);
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger p-4">Gagal memuat data: ' + esc(e.message) + '</td></tr>';
    } finally {
      isLoading = false;
    }
  }

  async function applyFree(userId) {
    var p = getPeriod();
    var res = await fetch("/api/payment-status/free", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        userId: userId,
        period_month: p.month,
        period_year: p.year,
        reason: "Pelanggan baru — bebas tagihan bulan pemasangan (Gratis Bulan Ini)"
      })
    });
    var j = await res.json().catch(function () { return {}; });
    return { ok: res.ok, message: (j && j.message) || ("HTTP " + res.status) };
  }

  window.gratiskan = function (id, nama, amount) {
    var p = getPeriod();
    Swal.fire({
      title: "Gratiskan bulan ini?",
      html: "Bebaskan tagihan <b>" + esc(nama) + "</b> (" + rupiah(amount) + ") untuk periode <b>" + BULAN[p.month - 1] + " " + p.year + "</b>?" +
        "<br><small class='text-muted'>Periode ditandai <b>lunas</b> (kebal isolir) tanpa masuk pemasukan. Pelanggan mulai bayar bulan depan.</small>",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Ya, Gratiskan",
      cancelButtonText: "Batal",
      confirmButtonColor: "#1cc88a",
      reverseButtons: true
    }).then(function (r) {
      if (!r.isConfirmed) return;
      Swal.fire({ title: "Memproses…", didOpen: function () { Swal.showLoading(); }, allowOutsideClick: false, showConfirmButton: false });
      applyFree(id).then(function (o) {
        if (!o.ok) { Swal.fire({ icon: "error", title: "Gagal", text: o.message }); return; }
        Swal.fire({ icon: "success", title: "Digratiskan", text: o.message, timer: 2200, showConfirmButton: false });
        loadList();
      }).catch(function (e) { Swal.fire({ icon: "error", title: "Gagal", text: String((e && e.message) || e) }); });
    });
  };

  function bulkFree() {
    var ids = selectedIds();
    if (!ids.length) return;
    var p = getPeriod();
    Swal.fire({
      title: "Bebaskan " + ids.length + " pelanggan?",
      html: "Tandai <b>" + ids.length + "</b> pelanggan GRATIS untuk periode <b>" + BULAN[p.month - 1] + " " + p.year + "</b>?" +
        "<br><small class='text-muted'>Semua periode ditandai lunas tanpa masuk pemasukan.</small>",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Ya, Bebaskan",
      cancelButtonText: "Batal",
      confirmButtonColor: "#1cc88a",
      reverseButtons: true
    }).then(async function (r) {
      if (!r.isConfirmed) return;
      Swal.fire({ title: "Memproses 0/" + ids.length + "…", didOpen: function () { Swal.showLoading(); }, allowOutsideClick: false, showConfirmButton: false });
      var ok = 0, fail = 0;
      for (var i = 0; i < ids.length; i++) {
        try {
          var o = await applyFree(ids[i]);
          if (o.ok) ok++; else fail++;
        } catch (_e) { fail++; }
        Swal.update({ title: "Memproses " + (i + 1) + "/" + ids.length + "…" });
      }
      Swal.fire({
        icon: fail === 0 ? "success" : "warning",
        title: "Selesai",
        text: ok + " digratiskan" + (fail ? ", " + fail + " gagal" : "") + ".",
        timer: 2600, showConfirmButton: false
      });
      loadList();
    });
  }

  function initPeriodSelectors() {
    var now = new Date();
    var mSel = el("filter-month");
    var ySel = el("filter-year");
    for (var m = 1; m <= 12; m++) {
      var o = document.createElement("option");
      o.value = m; o.textContent = BULAN[m - 1];
      if (m === now.getMonth() + 1) o.selected = true;
      mSel.appendChild(o);
    }
    var y0 = now.getFullYear();
    for (var y = y0 - 1; y <= y0 + 1; y++) {
      var oy = document.createElement("option");
      oy.value = y; oy.textContent = y;
      if (y === y0) oy.selected = true;
      ySel.appendChild(oy);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    initPeriodSelectors();
    loadList();
    el("filter-month").addEventListener("change", loadList);
    el("filter-year").addEventListener("change", loadList);
    el("only-unpaid").addEventListener("change", render);
    el("search-input").addEventListener("input", render);
    el("refresh-btn").addEventListener("click", loadList);
    el("bulk-free-btn").addEventListener("click", bulkFree);
    el("select-all").addEventListener("change", function () {
      var on = this.checked;
      document.querySelectorAll(".row-check").forEach(function (c) { c.checked = on; });
      updateSelectedCount();
    });
    // Delegasi: perbarui hitungan saat checkbox baris diklik.
    el("free-tbody").addEventListener("change", function (e) {
      if (e.target && e.target.classList.contains("row-check")) updateSelectedCount();
    });
    // Tombol Gratiskan dipasang lewat delegasi, bukan onclick sebaris — lihat catatan di rowHtml().
    el("free-tbody").addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest(".btn-gratiskan") : null;
      if (!btn) return;
      window.gratiskan(btn.dataset.id, btn.dataset.nama, Number(btn.dataset.amount || 0));
    });
  });
})();
