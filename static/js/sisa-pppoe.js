/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/sisa-pppoe.php — memuat kredensial PPPoE yatim dari
 *          `/api/users/orphan-pppoe` dan menghapusnya SATU PER SATU.
 * Caller : views/sb-admin/sisa-pppoe.php lewat <script src>.
 * SideEffects: memanggil API internal; tombol hapus memutus kredensial di MikroTik.
 */
(function () {
    "use strict";

    var tbody = document.getElementById("sisaTbody");
    var ringkas = document.getElementById("sisaRingkas");
    var kotakPesan = document.getElementById("sisaPesan");

    function pesan(teks, jenis) {
        kotakPesan.innerHTML = '<div class="alert alert-' + (jenis || "info") + '">' + teks + "</div>";
    }

    function esc(v) {
        return String(v === null || v === undefined ? "" : v)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    // Status dipisah tiga, BUKAN dua. "Tak terbaca" tidak boleh terlihat sama dengan "bebas" —
    // itu yang membuat orang menghapus kredensial yang sedang dipakai.
    function selStatus(row) {
        if (row.sedangAktif === true) return '<span class="badge badge-danger">Sedang dipakai</span>';
        if (row.sedangAktif === null) return '<span class="badge badge-secondary">Tak terbaca</span>';
        return '<span class="badge badge-success">Tidak ada sesi</span>';
    }

    function baris(row) {
        var bisaHapus = row.aman_dihapus === true;
        var tombol = bisaHapus
            ? '<button class="btn btn-sm btn-danger" data-hapus="' + esc(row.username) + '"><i class="fas fa-trash"></i> Hapus</button>'
            : '<button class="btn btn-sm btn-secondary" disabled title="' + esc(row.catatan) + '">Tidak bisa dihapus</button>';
        return "<tr>"
            + "<td><code>" + esc(row.username) + "</code></td>"
            + "<td>" + esc(row.profile || "-") + "</td>"
            + "<td>" + selStatus(row) + '<div class="small text-muted">' + esc(row.catatan) + "</div></td>"
            + "<td>" + esc(row.terakhirLogout || "-") + "</td>"
            + "<td>" + tombol + "</td>"
            + "</tr>";
    }

    function muat() {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">Memuat…</td></tr>';
        kotakPesan.innerHTML = "";
        fetch("/api/users/orphan-pppoe", { credentials: "include" })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
            .then(function (res) {
                if (!res.ok) {
                    // Kegagalan baca TIDAK boleh tampil sebagai tabel kosong yang menenangkan.
                    ringkas.textContent = "Gagal memeriksa";
                    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">—</td></tr>';
                    pesan("<b>Pemeriksaan gagal, bukan berarti tidak ada sisa.</b> " + esc(res.d.message || ""), "danger");
                    return;
                }
                var data = res.d.data || [];
                ringkas.textContent = data.length
                    ? data.length + " kredensial tanpa pelanggan · " + res.d.jumlahAmanDihapus + " tidak sedang dipakai"
                    : "Bersih — semua kredensial punya pelanggan";
                if (!res.d.sesiTerbaca) {
                    pesan("Status sesi tak terbaca dari router, jadi tak ada yang bisa dihapus sekarang. Coba muat ulang setelah router bisa dibaca.", "warning");
                }
                tbody.innerHTML = data.length
                    ? data.map(baris).join("")
                    : '<tr><td colspan="5" class="text-center text-muted">Tidak ada sisa.</td></tr>';
            })
            .catch(function (e) {
                ringkas.textContent = "Gagal memeriksa";
                pesan("Terjadi kesalahan: " + esc(e.message), "danger");
            });
    }

    tbody.addEventListener("click", function (ev) {
        var btn = ev.target.closest("[data-hapus]");
        if (!btn) return;
        var username = btn.getAttribute("data-hapus");
        if (!confirm("Hapus kredensial PPPoE \"" + username + "\" dari MikroTik?\n\nPastikan ini bukan VPN, akun monitoring, atau layanan gratis.")) return;

        btn.disabled = true;
        fetch("/api/users/orphan-pppoe/" + encodeURIComponent(username), { method: "DELETE", credentials: "include" })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
            .then(function (res) {
                pesan(esc(res.d.message || (res.ok ? "Terhapus." : "Gagal.")), res.ok ? "success" : "warning");
                muat();
            })
            .catch(function (e) {
                btn.disabled = false;
                pesan("Terjadi kesalahan: " + esc(e.message), "danger");
            });
    });

    document.getElementById("btnMuatUlang").addEventListener("click", muat);
    muat();
})();
