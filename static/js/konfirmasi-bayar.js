/*
 * konfirmasi-bayar.js — front-end halaman admin "Konfirmasi Bayar".
 * Memuat daftar bukti pending, menampilkan foto/dokumen bukti, dan mengirim aksi konfirmasi/tolak.
 * Auth: cookie httpOnly `token` otomatis ikut via credentials:'same-origin' (tak ada token manual).
 * API: /api/konfirmasi-bayar/{list, :id/proof, :id/konfirmasi, :id/tolak}.
 */
(function () {
  "use strict";

  var isLoading = false;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function rupiah(n) {
    return "Rp " + Number(n || 0).toLocaleString("id-ID");
  }

  function tanggal(iso) {
    try { return new Date(iso).toLocaleString("id-ID"); } catch (_e) { return String(iso || ""); }
  }

  function statusBadge(rec) {
    if (rec.wasFullyPaidAtSubmit === true) {
      return '<span class="badge badge-secondary">Sudah lunas</span>';
    }
    if (rec.wasFullyPaidAtSubmit === false) {
      return '<span class="badge badge-warning">Belum lunas</span>';
    }
    return '<span class="badge badge-light">Status tak diketahui</span>';
  }

  function proofMedia(rec) {
    var url = "/api/konfirmasi-bayar/" + encodeURIComponent(rec.id) + "/proof";
    if (rec.fileType === "document") {
      return '<a href="' + url + '" target="_blank" rel="noopener" class="btn btn-sm btn-outline-secondary">' +
        '<i class="fas fa-file-pdf"></i> Buka dokumen bukti</a>';
    }
    return '<a href="' + url + '" target="_blank" rel="noopener">' +
      '<img src="' + url + '" alt="bukti pembayaran" loading="lazy" ' +
      'style="max-width:100%;max-height:240px;border-radius:8px;object-fit:contain;border:1px solid var(--gray-300,#dddfeb);"/></a>';
  }

  function card(rec) {
    // AKSI LEWAT data-* + DELEGASI, bukan onclick inline.
    //
    // Dulu nama pelanggan disisipkan sebagai argumen string di dalam atribut onclick:
    //   var namaArg = esc(rec.userName).replace(/'/g, "\\'");
    // `esc()` sudah mengubah `'` menjadi `&#39;`, jadi replace-nya TAK PERNAH cocok —
    // sementara parser HTML men-DECODE `&#39;` kembali menjadi `'` SEBELUM JS di-parse.
    // Untuk pelanggan bernama Ma'ruf / Sa'diyah (lazim di basis pelanggan ini) string
    // handler putus dan ketiga tombol DIAM TOTAL tanpa pesan galat apa pun: pembayaran
    // tak pernah tercatat lunas dan pelanggan tetap kena isolir. Kartunya tampak normal
    // karena bagian teks memakai esc() dengan benar — jadi admin tak melihat gejala.
    // Varian jahat `x',alert(document.cookie),'` pun ikut dieksekusi.
    var namaAttr = esc(rec.userName);
    var actions =
      '<button class="btn btn-sm btn-success" data-aksi="konfirmasi" data-id="' + esc(rec.id) + '" data-nama="' + namaAttr + '" data-amount="' + Number(rec.amountDue || 0) + '">' +
        '<i class="fas fa-check"></i> Konfirmasi Lunas</button>' +
      '<button class="btn btn-sm btn-outline-danger" data-aksi="tolak" data-id="' + esc(rec.id) + '" data-nama="' + namaAttr + '">' +
        '<i class="fas fa-times"></i> Tolak</button>' +
      '<button class="btn btn-sm btn-outline-secondary" data-aksi="hapus" data-id="' + esc(rec.id) + '" data-nama="' + namaAttr + '">' +
        '<i class="fas fa-trash"></i> Hapus (bukan bukti bayar)</button>';

    return '' +
      '<div class="dashboard-card" style="height:auto;" data-id="' + esc(rec.id) + '">' +
        '<div class="card-body">' +
          '<div class="d-flex justify-content-between align-items-start flex-wrap" style="gap:.5rem;">' +
            '<div>' +
              '<h5 class="mb-0">' + esc(rec.userName) + '</h5>' +
              '<div class="text-muted small">' + esc(rec.phone) + ' &middot; tagihan ' + esc(rec.periode) + ' &middot; kode ' + esc(rec.id) + '</div>' +
            '</div>' +
            '<div>' + statusBadge(rec) + '</div>' +
          '</div>' +
          '<div class="my-2">' + proofMedia(rec) + '</div>' +
          (rec.caption ? '<div class="small text-muted mb-2">Catatan pelanggan: &ldquo;' + esc(rec.caption) + '&rdquo;</div>' : '') +
          '<div class="small mb-2">Tagihan: <strong>' + rupiah(rec.amountDue) + '</strong> &middot; dikirim ' + esc(tanggal(rec.submittedAt)) + '</div>' +
          '<div class="d-flex flex-wrap" style="gap:.5rem;">' + actions + '</div>' +
        '</div>' +
      '</div>';
  }

  function render(items) {
    var wrap = document.getElementById("proof-list");
    var countEl = document.getElementById("pending-count");
    if (countEl) countEl.textContent = items.length;
    if (!wrap) return;
    if (!items.length) {
      wrap.innerHTML =
        '<div class="dashboard-card"><div class="card-body text-center text-muted p-4">' +
        '<i class="fas fa-inbox fa-2x mb-2 d-block"></i>' +
        'Belum ada bukti pembayaran yang menunggu konfirmasi.</div></div>';
      return;
    }
    wrap.innerHTML = items.map(card).join("");
  }

  // Satu listener terdelegasi untuk seluruh daftar. Karena nilainya dibaca dari `dataset`
  // (bukan diurai ulang sebagai kode), karakter apa pun di nama pelanggan — apostrof, kutip,
  // tanda kurung — tak bisa lagi memutus handler maupun dieksekusi.
  function pasangDelegasiAksi() {
    var wrap = document.getElementById("proof-list");
    if (!wrap || wrap.dataset.delegasiTerpasang === "1") return;
    wrap.dataset.delegasiTerpasang = "1";

    wrap.addEventListener("click", function (ev) {
      var tombol = ev.target.closest("[data-aksi]");
      if (!tombol || !wrap.contains(tombol)) return;

      var id = tombol.dataset.id;
      var nama = tombol.dataset.nama || "";

      if (tombol.dataset.aksi === "konfirmasi") {
        window.konfirmasiBukti(id, nama, Number(tombol.dataset.amount || 0));
      } else if (tombol.dataset.aksi === "tolak") {
        window.tolakBukti(id, nama);
      } else if (tombol.dataset.aksi === "hapus") {
        window.hapusBukti(id, nama);
      }
    });
  }

  async function loadList() {
    if (isLoading) return;
    isLoading = true;
    try {
      var res = await fetch("/api/konfirmasi-bayar/list?_=" + Date.now(), {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin"
      });
      if (!res.ok) {
        if (res.status === 401) { window.location.href = "/login"; return; }
        throw new Error("HTTP " + res.status);
      }
      var data = await res.json();
      var items = data && data.data && Array.isArray(data.data.items) ? data.data.items : [];
      render(items);
    } catch (e) {
      console.error("[konfirmasi-bayar] gagal memuat:", e);
    } finally {
      isLoading = false;
    }
  }

  function postAction(url, body, successTitle) {
    Swal.fire({
      title: "Memproses…",
      didOpen: function () { Swal.showLoading(); },
      allowOutsideClick: false,
      showConfirmButton: false
    });
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body || {})
    })
      .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, j: j }; }); })
      .then(function (o) {
        if (!o.ok) {
          Swal.fire({ icon: "error", title: "Gagal", text: (o.j && o.j.message) || "Terjadi kesalahan." });
          return;
        }
        Swal.fire({
          icon: "success",
          title: successTitle || "Berhasil",
          text: (o.j && o.j.message) || "Selesai.",
          timer: 2600,
          showConfirmButton: false
        });
        loadList();
      })
      .catch(function (e) {
        Swal.fire({ icon: "error", title: "Gagal", text: String((e && e.message) || e) });
      });
  }

  window.konfirmasiBukti = function (id, nama, amount) {
    Swal.fire({
      title: "Konfirmasi Lunas?",
      html: "Tandai pembayaran <b>" + esc(nama) + "</b> sebesar <b>" + rupiah(amount) + "</b> sebagai LUNAS?" +
        "<br><small class='text-muted'>Pelanggan akan diaktifkan kembali bila terisolir, lalu menerima struk otomatis.</small>",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Ya, Konfirmasi",
      cancelButtonText: "Batal",
      confirmButtonColor: "#1cc88a",
      reverseButtons: true
    }).then(function (r) {
      if (!r.isConfirmed) return;
      postAction("/api/konfirmasi-bayar/" + encodeURIComponent(id) + "/konfirmasi", {}, "Terkonfirmasi");
    });
  };

  window.tolakBukti = function (id, nama) {
    Swal.fire({
      title: "Tolak Bukti?",
      html: "Tolak bukti dari <b>" + esc(nama) + "</b>?" +
        "<br><small class='text-muted'>Pakai bila ini <b>memang</b> bukti bayar tapi belum sah (nominal kurang, buram). Pelanggan diberi tahu untuk mengirim ulang.</small>",
      input: "text",
      inputPlaceholder: "Alasan (opsional, dikirim ke pelanggan)",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Tolak",
      cancelButtonText: "Batal",
      confirmButtonColor: "#e74a3b",
      reverseButtons: true
    }).then(function (r) {
      if (!r.isConfirmed) return;
      postAction("/api/konfirmasi-bayar/" + encodeURIComponent(id) + "/tolak", { reason: r.value || "" }, "Ditolak");
    });
  };

  // Hapus = untuk foto yang ternyata BUKAN bukti bayar (mis. keluhan yang salah masuk antrian).
  // Beda dari Tolak: entri dibuang tanpa memberi tahu pelanggan sama sekali.
  window.hapusBukti = function (id, nama) {
    Swal.fire({
      title: "Hapus bukti ini?",
      html: "Hapus entri dari <b>" + esc(nama) + "</b>?" +
        "<br><small class='text-muted'>Gunakan bila foto ini sebenarnya <b>bukan bukti bayar</b> (mis. keluhan). Entri dibuang dari antrian dan <b>pelanggan tidak diberi tahu</b>. Berbeda dari Tolak.</small>",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Ya, Hapus",
      cancelButtonText: "Batal",
      confirmButtonColor: "#858796",
      reverseButtons: true
    }).then(function (r) {
      if (!r.isConfirmed) return;
      postAction("/api/konfirmasi-bayar/" + encodeURIComponent(id) + "/hapus", {}, "Dihapus");
    });
  };

  document.addEventListener("DOMContentLoaded", function () {
    // Dipasang SEKALI di kontainer, sebelum daftar pertama dirender. Karena delegasi,
    // kartu yang digambar ulang tiap 30 detik tak perlu di-bind ulang.
    pasangDelegasiAksi();
    loadList();
    var btn = document.getElementById("refresh-btn");
    if (btn) btn.addEventListener("click", loadList);
    // Auto-refresh ringan; skip saat tab tak aktif atau saat request sebelumnya belum selesai.
    setInterval(function () {
      if (!isLoading && document.visibilityState === "visible") loadList();
    }, 30000);
  });
})();
