/**
 * Header Doc
 * Purpose: Frontend halaman /kas-usaha — pilih grup WhatsApp kas, kelola BIAYA RUTIN
 *          (tambah/ubah/hapus/catat), dan tampilkan ringkasan kas bulan berjalan.
 *          Tombol "Catat" memanggil endpoint yang sama dengan konfirmasi WhatsApp, jadi
 *          hasilnya identik: pengeluaran dibuat lewat expense-manager, bukan di sini.
 * Caller: views/sb-admin/kas-usaha.php (butuh static/css/kas-usaha.css).
 * Deps: fetch API, endpoint /api/kas-usaha/*.
 * SideEffects: Menulis config (grup) + tabel recurring_expenses; membuat expense_entries
 *              lewat aksi "Catat".
 */
(function () {
    "use strict";

    var elRutin = document.getElementById("ku-rutin");
    if (!elRutin) return;

    function el(id) {
        return document.getElementById(id);
    }
    function esc(s) {
        var d = document.createElement("div");
        d.textContent = s == null ? "" : String(s);
        return d.innerHTML;
    }
    function rupiah(n) {
        return "Rp" + (Number(n) || 0).toLocaleString("id-ID");
    }
    function pesan(teks, tone) {
        var a = el("ku-alert");
        if (!a) return;
        if (!teks) {
            a.hidden = true;
            return;
        }
        a.textContent = teks;
        a.setAttribute("data-tone", tone || "ok");
        a.hidden = false;
        if (tone === "ok") setTimeout(function () { a.hidden = true; }, 3500);
    }
    function ambil(url, opsi) {
        return fetch(url, opsi).then(function (r) {
            return r.json().then(function (j) {
                if (!r.ok || j.success === false) throw new Error(j.message || "Gagal (" + r.status + ").");
                return j;
            });
        });
    }

    var tertunda = [];

    function muatSetelan() {
        return ambil("/api/kas-usaha/setelan").then(function (j) {
            var d = j.data || {};
            var sel = el("ku-grup");
            sel.innerHTML =
                '<option value="">— belum dipilih —</option>' +
                (d.grup || []).map(function (g) {
                    return '<option value="' + esc(g.id) + '">' + esc(g.subject) + " (" + g.size + ")</option>";
                }).join("");
            // Grup tersimpan yang tak ada di daftar (bot dikeluarkan) tetap ditampilkan,
            // supaya pilihan lama tidak hilang senyap.
            if (d.groupId && !Array.prototype.some.call(sel.options, function (o) { return o.value === d.groupId; })) {
                var o = document.createElement("option");
                o.value = d.groupId;
                o.textContent = d.groupId + " (tersimpan — bot tidak di grup ini?)";
                sel.appendChild(o);
            }
            sel.value = d.groupId || "";

            el("ku-kategori").innerHTML = (d.kategori || []).map(function (k) {
                return '<option value="' + esc(k) + '">' + esc(k) + "</option>";
            }).join("");

            var st = el("ku-status-fitur");
            if (st) {
                st.textContent = d.enabled
                    ? (d.waSiap ? "" : "WhatsApp belum terkoneksi — daftar grup tak bisa dimuat")
                    : "Fitur kas usaha masih OFF di config (businessExpense.enabled)";
            }
        });
    }

    function muatRutin() {
        return ambil("/api/kas-usaha/rutin").then(function (j) {
            tertunda = j.tertunda || [];
            var rows = j.data || [];
            el("ku-tertunda").textContent = tertunda.length;
            if (!rows.length) {
                elRutin.innerHTML = '<tr><td colspan="7" class="ku-kosong">Belum ada biaya rutin. Tambahkan di bawah.</td></tr>';
                return;
            }
            elRutin.innerHTML = rows.map(function (r) {
                var tuntas = r.last_settled_period === j.periode;
                var nunggu = tertunda.indexOf(r.id) !== -1;
                var status = !r.aktif
                    ? '<span class="ku-tanda">nonaktif</span>'
                    : tuntas
                      ? '<span class="ku-tanda ku-tanda--ok">' + esc(r.last_action || "tuntas") + "</span>"
                      : nunggu
                        ? '<span class="ku-tanda ku-tanda--nunggu">menunggu konfirmasi</span>'
                        : "—";
                return (
                    "<tr><td>" + esc(r.nama) + "</td>" +
                    '<td class="ku-angka">' + rupiah(r.perkiraan) + "</td>" +
                    "<td>" + esc(r.kategori) + "</td>" +
                    '<td class="ku-angka">' + r.tanggal + "</td>" +
                    "<td>" + esc(r.metode) + "</td>" +
                    "<td>" + status + "</td>" +
                    '<td class="ku-aksi">' +
                    (r.aktif && !tuntas ? '<button class="btn btn-sm btn-outline-primary ku-catat" data-id="' + r.id + '">Catat</button> ' : "") +
                    '<button class="btn btn-sm btn-outline-secondary ku-ubah" data-id="' + r.id + '">Ubah</button> ' +
                    '<button class="btn btn-sm btn-outline-danger ku-hapus" data-id="' + r.id + '">Hapus</button>' +
                    "</td></tr>"
                );
            }).join("");
            elRutin.__rows = rows;
        });
    }

    function muatRingkasan() {
        return ambil("/api/kas-usaha/ringkasan").then(function (j) {
            el("ku-total").textContent = rupiah(j.data.total);
            el("ku-jumlah").textContent = j.data.jumlah;
        });
    }

    function muatSemua() {
        Promise.all([muatSetelan(), muatRutin(), muatRingkasan()]).catch(function (e) {
            pesan(e.message, "error");
        });
    }

    el("ku-muat-grup").addEventListener("click", function () {
        muatSetelan().then(function () { pesan("Daftar grup dimuat.", "ok"); }).catch(function (e) { pesan(e.message, "error"); });
    });

    el("ku-simpan-grup").addEventListener("click", function () {
        ambil("/api/kas-usaha/grup", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ groupId: el("ku-grup").value })
        })
            .then(function (j) { pesan(j.message, "ok"); })
            .catch(function (e) { pesan(e.message, "error"); });
    });

    el("ku-form-rutin").addEventListener("submit", function (ev) {
        ev.preventDefault();
        var body = {
            nama: el("ku-nama").value,
            perkiraan: el("ku-perkiraan").value,
            kategori: el("ku-kategori").value,
            tanggal: el("ku-tanggal").value,
            metode: el("ku-metode").value || "TUNAI"
        };
        if (el("ku-id").value) body.id = Number(el("ku-id").value);
        // Nominal dikirim apa adanya ("500rb") — diterjemahkan penerjemah yang SAMA dengan
        // jalur WhatsApp, jadi tak ada dua aturan format.
        ambil("/api/kas-usaha/rutin", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
            .then(function () {
                pesan(body.id ? "Biaya rutin diperbarui." : "Biaya rutin ditambahkan.", "ok");
                el("ku-form-rutin").reset();
                el("ku-id").value = "";
                el("ku-batal-edit").hidden = true;
                muatRutin();
            })
            .catch(function (e) { pesan(e.message, "error"); });
    });

    el("ku-batal-edit").addEventListener("click", function () {
        el("ku-form-rutin").reset();
        el("ku-id").value = "";
        el("ku-batal-edit").hidden = true;
    });

    elRutin.addEventListener("click", function (ev) {
        var btn = ev.target.closest("button");
        if (!btn) return;
        var id = btn.getAttribute("data-id");

        if (btn.classList.contains("ku-hapus")) {
            if (!window.confirm("Hapus biaya rutin ini? Pengeluaran yang sudah tercatat TIDAK ikut terhapus.")) return;
            ambil("/api/kas-usaha/rutin/" + id, { method: "DELETE" })
                .then(function () { pesan("Dihapus.", "ok"); muatRutin(); })
                .catch(function (e) { pesan(e.message, "error"); });
            return;
        }

        if (btn.classList.contains("ku-ubah")) {
            var r = (elRutin.__rows || []).find(function (x) { return String(x.id) === String(id); });
            if (!r) return;
            el("ku-id").value = r.id;
            el("ku-nama").value = r.nama;
            el("ku-perkiraan").value = r.perkiraan;
            el("ku-kategori").value = r.kategori;
            el("ku-tanggal").value = r.tanggal;
            el("ku-metode").value = r.metode;
            el("ku-batal-edit").hidden = false;
            el("ku-nama").focus();
            return;
        }

        if (btn.classList.contains("ku-catat")) {
            var r2 = (elRutin.__rows || []).find(function (x) { return String(x.id) === String(id); });
            var nominal = window.prompt(
                "Nominal sebenarnya untuk \"" + (r2 ? r2.nama : "") + "\"\n(kosongkan untuk memakai perkiraan " + (r2 ? rupiah(r2.perkiraan) : "") + ")",
                ""
            );
            if (nominal === null) return;
            ambil("/api/kas-usaha/rutin/" + id + "/catat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ nominal: nominal || undefined })
            })
                .then(function (j) {
                    pesan("Tercatat " + rupiah(j.data.jumlah) + " (pengeluaran #" + j.data.expenseId + ").", "ok");
                    muatRutin();
                    muatRingkasan();
                })
                .catch(function (e) { pesan(e.message, "error"); });
        }
    });

    muatSemua();
})();
