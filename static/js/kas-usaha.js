/**
 * Header Doc
 * Purpose: Frontend halaman /kas-usaha — sakelar aktif, pilih grup WhatsApp kas, tentukan
 *          PEMILIK yang boleh mencatat, kelola BIAYA RUTIN (tambah/ubah/hapus/catat), dan
 *          tampilkan ringkasan kas bulan berjalan.
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
    // Toast MENGAMBANG di atas halaman. Karena melapisi konten, ia wajib bisa ditutup:
    // pesan error dulu menetap selamanya (auto-tutup hanya untuk nada "ok"), dan sebagai
    // blok dalam alur itu tak mengganggu — sebagai lapisan, ia menutupi isi terus-menerus.
    var jedaToast = null;
    function pesan(teks, tone) {
        var a = el("ku-alert");
        if (!a) return;
        if (jedaToast) { clearTimeout(jedaToast); jedaToast = null; }
        if (!teks) {
            a.hidden = true;
            return;
        }
        a.textContent = teks;
        a.setAttribute("data-tone", tone || "ok");
        a.hidden = false;
        // Error diberi umur lebih panjang (perlu dibaca), tapi tetap berakhir.
        jedaToast = setTimeout(function () { a.hidden = true; }, tone === "error" ? 9000 : 3500);
    }
    function ambil(url, opsi) {
        return fetch(url, opsi).then(function (r) {
            return r.json().then(function (j) {
                if (!r.ok || j.success === false) throw new Error(j.message || "Gagal (" + r.status + ").");
                return j;
            });
        });
    }

    // Klik toast = tutup sekarang, tanpa menunggu jedanya habis.
    (function () {
        var a = el("ku-alert");
        if (a) a.addEventListener("click", function () { a.hidden = true; });
    })();

    var tertunda = [];
    // Kesiapan WA dari muatan terakhir — dipakai tombol "Muat grup" untuk melapor jujur.
    var terakhirWaSiap = true;

    function muatSetelan() {
        return ambil("/api/kas-usaha/setelan").then(function (j) {
            var d = j.data || {};
            terakhirWaSiap = d.waSiap !== false;
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

            var sak = el("ku-aktif");
            if (sak) sak.checked = d.enabled === true;
            var dg = el("ku-digest");
            if (dg) {
                dg.checked = d.digest === true;
                // Ringkasan hanya bermakna kalau fiturnya menyala — jangan tawarkan yang mustahil.
                dg.disabled = d.enabled !== true;
            }

            gambarPemilik(d);

            var st = el("ku-status-fitur");
            if (st) {
                // Status yang JUJUR soal syarat: satu saja belum terpenuhi = bot diam.
                var jmlPemilik = (d.ownerJids || []).length + (d.ownerLids || []).length;
                if (!d.enabled) st.textContent = "Kas usaha OFF — nyalakan lewat sakelar di bawah.";
                else if (!d.groupId) st.textContent = "Aktif, tapi grup kas belum dipilih — pengingat belum akan terkirim.";
                else if (!jmlPemilik) st.textContent = "Aktif, tapi belum ada pemilik — perintah kas di grup akan diabaikan.";
                else if (!d.waSiap) st.textContent = "WhatsApp belum terkoneksi — daftar grup tak bisa dimuat.";
                else st.textContent = "";
            }
        });
    }

    // Pemilik ditampilkan sebagai DAFTAR CENTANG anggota grup. Mengetik nomor manual gampang
    // salah satu digit, dan gerbangnya gagal-tertutup: nomor meleset = perintah diabaikan
    // tanpa pesan error. Nomor di luar grup tetap bisa ditambah lewat kolom manual.
    function gambarPemilik(d) {
        var box = el("ku-pemilik");
        if (!box) return;
        var terpilih = (d.ownerJids || []).concat(d.ownerLids || []).map(String);
        var peserta = d.peserta || [];

        var luarGrup = terpilih.filter(function (j) {
            return !peserta.some(function (p) { return p.id === j; });
        });

        if (!peserta.length && !luarGrup.length) {
            box.innerHTML = '<span class="ku-kosong">' +
                (d.groupId
                    ? (d.waSiap ? "Grup ini belum punya anggota terbaca." : "WhatsApp belum terkoneksi — anggota grup tak bisa dimuat. Pakai kolom nomor manual di bawah.")
                    : "Pilih grup dulu untuk melihat anggotanya.") +
                "</span>";
            return;
        }

        function baris(id, label, dicentang) {
            return '<label class="ku-pemilik__item"><input type="checkbox" class="ku-pemilik__cek" value="' +
                esc(id) + '"' + (dicentang ? " checked" : "") + "><span>" + esc(label) + "</span></label>";
        }

        // Tampilkan LABEL yang dibuat server (nama kontak > nomor > penanda jujur), bukan `@lid`
        // mentah: deretan angka acak tak berarti apa-apa dan bikin salah pilih pemilik kas.
        box.innerHTML =
            peserta.map(function (p) {
                var label = p.label || p.id.split("@")[0];
                return baris(p.id, label + (p.admin ? " (admin grup)" : ""), terpilih.indexOf(p.id) !== -1);
            }).join("") +
            luarGrup.map(function (j) {
                var label = j.indexOf("@lid") !== -1 ? "anggota lama (nomor belum dikenali)" : j.split("@")[0];
                return baris(j, label + " (di luar grup)", true);
            }).join("");
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

    // Nilai yang TAK TERBACA ditulis apa adanya, tak pernah Rp0 — nol menuntut tindakan,
    // "tak terbaca" berarti kita sedang buta. Dua hal itu tak boleh terlihat sama.
    function nilai(n) {
        return n == null ? "—" : rupiah(n);
    }

    var grafikKas = null;
    var WARNA = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#f97316", "#64748b"];

    function gambarGrafik(perKategori) {
        var kanvas = el("ku-grafik");
        var kosong = el("ku-grafik-kosong");
        if (!kanvas || typeof window.Chart === "undefined") return;

        var pasangan = Object.keys(perKategori || {})
            .map(function (k) { return { k: k, v: Number(perKategori[k]) || 0 }; })
            .filter(function (x) { return x.v > 0; })
            .sort(function (a, b) { return b.v - a.v; });

        if (grafikKas) { grafikKas.destroy(); grafikKas = null; }
        if (!pasangan.length) {
            kanvas.hidden = true;
            kosong.hidden = false;
            return;
        }
        kanvas.hidden = false;
        kosong.hidden = true;

        grafikKas = new window.Chart(kanvas.getContext("2d"), {
            type: "bar",
            data: {
                labels: pasangan.map(function (x) { return x.k; }),
                datasets: [{
                    data: pasangan.map(function (x) { return x.v; }),
                    backgroundColor: pasangan.map(function (_x, i) { return WARNA[i % WARNA.length]; }),
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                legend: { display: false },
                tooltips: {
                    callbacks: {
                        label: function (item) { return " " + rupiah(item.xLabel != null ? item.xLabel : item.yLabel); }
                    }
                },
                scales: {
                    xAxes: [{ ticks: { beginAtZero: true, callback: function (v) { return rupiah(v); } } }]
                }
            }
        });
        // Batang mendatar supaya nama kategori panjang tetap terbaca.
        grafikKas.config.type = "horizontalBar";
        grafikKas.update();
    }

    function muatArusKas() {
        return ambil("/api/kas-usaha/cashflow").then(function (j) {
            var d = j.data || {};

            el("ku-omset").textContent = nilai(d.omsetAktif);
            el("ku-masuk").textContent = nilai(d.masuk);
            el("ku-total").textContent = nilai(d.keluar);
            el("ku-sisa").textContent = nilai(d.sisa);
            el("ku-jumlah").textContent = d.jumlahCatatan != null ? d.jumlahCatatan : "—";

            // Selisih omset penuh vs tanpa isolir DIJELASKAN. Dua angka bernama "omset" yang
            // berbeda tanpa keterangan adalah cara tercepat membuat orang tak percaya keduanya.
            var jejak = el("ku-omset-jejak");
            if (!d.isolirTerbaca) {
                jejak.textContent = "Status isolir tak terbaca — angka ini masih memuat semua pelanggan.";
            } else if (d.isolirJumlah) {
                jejak.textContent = d.isolirJumlah + " terisolir dikeluarkan (" + rupiah(d.isolirNilai) + ")";
            } else {
                jejak.textContent = "Tidak ada pelanggan terisolir.";
            }

            el("ku-belum").textContent = d.belumMasuk != null ? "Belum masuk " + rupiah(d.belumMasuk) : "";

            var sisaJejak = el("ku-sisa-jejak");
            if (d.sisa == null) sisaJejak.textContent = "Belum bisa dihitung — salah satu sisinya tak terbaca.";
            else sisaJejak.textContent = d.sisa < 0 ? "Bulan ini keluar lebih besar dari masuk." : "";

            el("ku-grafik-meta").textContent = "Periode " + (d.periode || "") +
                ((d.gagal || []).length ? " · sebagian angka tak terbaca (" + d.gagal.join(", ") + ")" : "");

            gambarGrafik(d.perKategori);
        });
    }

    function muatSemua() {
        Promise.all([muatSetelan(), muatRutin(), muatArusKas()]).catch(function (e) {
            pesan(e.message, "error");
        });
    }

    // Sakelar aktif — langsung tersimpan (tanpa tombol Simpan terpisah) supaya tak ada
    // keadaan "kelihatan menyala di layar tapi belum tersimpan". Gagal simpan mengembalikan
    // posisi sakelar agar layar tak berbohong.
    var sakelar = el("ku-aktif");
    if (sakelar) {
        sakelar.addEventListener("change", function () {
            var mau = sakelar.checked;
            sakelar.disabled = true;
            ambil("/api/kas-usaha/aktif", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: mau, digest: el("ku-digest") ? el("ku-digest").checked : undefined })
            }).then(function (j) {
                pesan(j.message || (mau ? "Kas usaha diaktifkan." : "Kas usaha dimatikan."), "ok");
                return muatSetelan();
            }).catch(function (e) {
                sakelar.checked = !mau;
                pesan(e.message, "error");
            }).then(function () {
                sakelar.disabled = false;
            });
        });
    }

    var sakelarDigest = el("ku-digest");
    if (sakelarDigest) {
        sakelarDigest.addEventListener("change", function () {
            var mau = sakelarDigest.checked;
            sakelarDigest.disabled = true;
            ambil("/api/kas-usaha/aktif", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: el("ku-aktif").checked, digest: mau })
            }).then(function () {
                pesan(mau ? "Ringkasan uang akan dikirim tiap pagi." : "Ringkasan uang harian dimatikan.", "ok");
                return muatSetelan();
            }).catch(function (e) {
                sakelarDigest.checked = !mau;
                pesan(e.message, "error");
            }).then(function () {
                sakelarDigest.disabled = el("ku-aktif").checked !== true;
            });
        });
    }

    // Sengaja MELAPORKAN APA ADANYA. Dulu selalu "Daftar grup dimuat." — termasuk saat
    // WhatsApp putus dan nol grup terbaca. Orang lalu menyangka grupnya memang tak ada dan
    // mencari kesalahan di tempat yang salah, padahal botnya sekadar belum tersambung.
    el("ku-muat-grup").addEventListener("click", function () {
        muatSetelan()
            .then(function () {
                var n = el("ku-grup").querySelectorAll("option[value]:not([value=''])").length;
                if (!terakhirWaSiap) pesan("WhatsApp belum tersambung — daftar grup tak bisa dimuat.", "error");
                else if (n === 0) pesan("WhatsApp tersambung, tapi bot belum masuk grup mana pun.", "error");
                else pesan(n + " grup dimuat.", "ok");
            })
            .catch(function (e) { pesan(e.message, "error"); });
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

    el("ku-simpan-pemilik").addEventListener("click", function () {
        var pemilik = Array.prototype.map.call(
            document.querySelectorAll(".ku-pemilik__cek:checked"),
            function (c) { return c.value; }
        );
        var manual = el("ku-pemilik-manual").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        ambil("/api/kas-usaha/pemilik", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pemilik: pemilik.concat(manual) })
        })
            .then(function (j) {
                el("ku-pemilik-manual").value = "";
                pesan(j.message, "ok");
                return muatSetelan();
            })
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
            // Baris lama bisa menyimpan metode di luar dua pilihan (dulu kolom ini bebas ketik).
            // Nilai asing tak boleh diam-diam berubah jadi TUNAI saat diedit — tampilkan apa adanya.
            var selMetode = el("ku-metode");
            var adaOpsi = Array.prototype.some.call(selMetode.options, function (o) { return o.value === r.metode; });
            if (!adaOpsi && r.metode) {
                var o = document.createElement("option");
                o.value = r.metode;
                o.textContent = r.metode + " (nilai lama)";
                selMetode.appendChild(o);
            }
            selMetode.value = r.metode || "TUNAI";
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
                    muatArusKas();
                })
                .catch(function (e) { pesan(e.message, "error"); });
        }
    });

    muatSemua();
})();
