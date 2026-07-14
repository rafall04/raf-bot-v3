/**
 * Header Doc
 * Purpose: Frontend "Rapikan ODP" (/rapikan-odp) — tampilkan pelanggan ber-GPS yang belum tersambung
 *          ke ODP + usulan ODP terdekat (yang masih bersisa port), lalu simpan pilihan admin.
 *          Bot MENGUSULKAN, admin MEMUTUSKAN: jarak garis lurus adalah tebakan, kabel drop bisa saja
 *          ditarik ke ODP lain → tak ada penetapan otomatis diam-diam. Borongan pun DIBATASI ke
 *          usulan < 50 m (yang praktis pasti benar) dan tetap satu klik sadar dari admin.
 * Caller: views/sb-admin/rapikan-odp.php
 * Deps: GET /api/map/odp-tidy (usulan), POST /api/users/:id (penetapan — jalur tulis yang SUDAH ADA,
 *       lengkap dgn validasi ODP + hitung-ulang port). Tidak ada endpoint tulis baru.
 * SideEffects: Menulis `connected_odp_id` pelanggan lewat API users.
 */
(function () {
    "use strict";

    var BULK_MAX_METERS = 50;
    var rows = [];
    var noGpsRows = [];
    var odps = [];

    function esc(s) {
        var d = document.createElement("div");
        d.textContent = s == null ? "" : String(s);
        return d.innerHTML;
    }
    function jarak(m) {
        return m >= 1000 ? (m / 1000).toFixed(1) + " km" : m + " m";
    }
    function el(id) { return document.getElementById(id); }

    function chip(label, value, cls) {
        return '<div class="col-md-3 col-6 mb-2">'
            + '<div class="card border-left-' + cls + ' shadow h-100 py-2"><div class="card-body py-2">'
            + '<div class="text-xs font-weight-bold text-' + cls + ' text-uppercase mb-1">' + esc(label) + "</div>"
            + '<div class="h5 mb-0 font-weight-bold text-gray-800">' + esc(value) + "</div>"
            + "</div></div></div>";
    }

    function alertBox(kind, html) {
        el("ro-alert").innerHTML = '<div class="alert alert-' + kind + ' alert-dismissible fade show" role="alert">'
            + html
            + '<button type="button" class="close" data-dismiss="alert">&times;</button></div>';
    }

    // Dropdown ODP untuk penetapan MANUAL (pelanggan tanpa titik). Tampilkan hunian supaya admin tak
    // menjejalkan ODP yang sudah penuh — yang penuh memang tak bisa dipilih (ditolak juga oleh API).
    function odpOptions() {
        return '<option value="">— pilih ODP —</option>' + odps.map(function (o) {
            var huni = o.capacity > 0 ? o.used + "/" + o.capacity : o.used + " (tak dibatasi)";
            return '<option value="' + esc(o.id) + '"' + (o.full ? " disabled" : "") + ">"
                + esc(o.name) + " — " + huni + (o.full ? " · PENUH" : "") + "</option>";
        }).join("");
    }

    function renderNoGps() {
        var q = (el("ro-search").value || "").trim().toLowerCase();
        var qd = q.replace(/[^0-9]/g, "");
        var tampil = noGpsRows.filter(function (r) {
            if (!q) return true;
            if (String(r.name).toLowerCase().indexOf(q) !== -1) return true;
            return qd.length >= 3 && String(r.phone).replace(/[^0-9]/g, "").indexOf(qd) !== -1;
        });

        var tbody = el("ro-nogps-rows");
        if (!odps.length) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-4">'
                + "Belum ada ODP terdaftar — petakan dulu lewat WhatsApp (<code>#ODP &lt;nama&gt;</code>)."
                + "</td></tr>";
            return;
        }
        if (!tampil.length) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-4">'
                + (noGpsRows.length ? "Tak ada yang cocok dengan pencarian." : "Semua pelanggan sudah punya titik GPS. 🎉")
                + "</td></tr>";
            return;
        }

        tbody.innerHTML = tampil.map(function (r) {
            return '<tr data-nrow="' + esc(r.id) + '">'
                + "<td>" + esc(r.name)
                + '<div class="small text-muted">' + esc(r.phone || "—") + (r.address ? " · " + esc(r.address) : "") + "</div></td>"
                + '<td><select class="form-control form-control-sm ro-npick" data-id="' + esc(r.id) + '">'
                + odpOptions() + "</select></td>"
                + '<td><button class="btn btn-sm btn-primary ro-nsave" data-id="' + esc(r.id) + '">Simpan</button></td>'
                + "</tr>";
        }).join("");
    }

    function render(data) {
        rows = data.rows || [];
        noGpsRows = data.tanpaGpsRows || [];
        odps = data.odps || [];

        var dekat = rows.filter(function (r) {
            return r.suggestions.length && r.suggestions[0].meters < BULK_MAX_METERS;
        }).length;

        el("ro-count-gps").textContent = rows.length;
        el("ro-count-nogps").textContent = noGpsRows.length;

        el("ro-summary").innerHTML =
            chip("Belum ber-ODP (ada GPS)", rows.length, "warning")
            + chip("Usulan < 50 m", dekat, "success")
            + chip("Tanpa GPS (pilih manual)", noGpsRows.length, "secondary")
            + chip("ODP terdaftar", data.totalOdp, "info");

        renderNoGps();

        var bulkBtn = el("ro-bulk");
        bulkBtn.disabled = dekat === 0;
        bulkBtn.innerHTML = '<i class="fas fa-bolt fa-sm mr-1"></i>Terapkan ' + dekat + " usulan &lt; 50 m";

        if (data.totalOdp === 0) {
            alertBox("info", "<strong>Belum ada ODP terdaftar.</strong> Minta teknisi memetakan dulu lewat WhatsApp: "
                + "<code>#ODC &lt;nama&gt;</code> lalu <code>#ODP &lt;nama&gt;</code> (cukup share lokasi di depan boks-nya).");
        }

        var tbody = el("ro-rows");
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">'
                + (noGpsRows.length > 0
                    ? "Tidak ada pelanggan ber-GPS yang belum tersambung. Sisanya ada di tab <strong>Tanpa GPS</strong> (" + noGpsRows.length + ")."
                    : "Semua pelanggan sudah tersambung ke ODP. 🎉")
                + "</td></tr>";
            return;
        }

        tbody.innerHTML = rows.map(function (r) {
            var top = r.suggestions[0];
            var opsi = r.suggestions.map(function (s) {
                var sisa = s.sisa == null ? "tak dibatasi" : "sisa " + s.sisa;
                return '<option value="' + esc(s.id) + '">' + esc(s.name) + " — " + jarak(s.meters) + " (" + sisa + ")</option>";
            }).join("");

            var kolomUsulan = r.suggestions.length
                ? '<select class="form-control form-control-sm ro-pick" data-id="' + esc(r.id) + '">' + opsi + "</select>"
                : '<span class="text-muted small">tak ada ODP dalam radius ini</span>';

            var kolomJarak = top
                ? '<span class="badge badge-' + (top.meters < BULK_MAX_METERS ? "success" : "warning") + '">' + jarak(top.meters) + "</span>"
                : '<span class="text-muted">—</span>';

            return "<tr data-row=\"" + esc(r.id) + '">'
                + "<td>" + esc(r.name)
                + '<div class="small text-muted">' + esc(r.address || "") + " · "
                + '<a href="https://maps.google.com/?q=' + r.latitude + "," + r.longitude + '" target="_blank" rel="noopener">lihat titik</a></div></td>'
                + "<td>" + kolomJarak + "</td>"
                + "<td>" + kolomUsulan + "</td>"
                + '<td><button class="btn btn-sm btn-primary ro-save" data-id="' + esc(r.id) + '"'
                + (r.suggestions.length ? "" : " disabled") + ">Simpan</button></td>"
                + "</tr>";
        }).join("");
    }

    function muat() {
        var radius = el("ro-radius").value;
        el("ro-rows").innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">Memuat…</td></tr>';

        fetch("/api/map/odp-tidy?maxMeters=" + encodeURIComponent(radius), { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!j || j.status !== 200) throw new Error((j && j.message) || "gagal memuat");
                render(j.data);
            })
            .catch(function (e) {
                el("ro-rows").innerHTML = '<tr><td colspan="4" class="text-center text-danger py-4">Gagal memuat: '
                    + esc(e.message) + "</td></tr>";
            });
    }

    // Penetapan lewat endpoint users yang SUDAH ADA → validasi (ODP terdaftar? penuh?) + hitung-ulang
    // port ikut jalan. Tak ada jalur tulis baru yang bisa diam-diam beda aturan.
    function simpan(userId, odpId) {
        return fetch("/api/users/" + encodeURIComponent(userId), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ connected_odp_id: odpId })
        }).then(function (r) {
            return r.json().then(function (j) {
                if (r.status !== 200) throw new Error((j && j.message) || "gagal menyimpan");
                return j;
            });
        });
    }

    document.addEventListener("click", function (ev) {
        // Tab "Tanpa GPS": ODP dipilih MANUAL oleh admin (jarak tak bisa menolong tanpa koordinat).
        var nbtn = ev.target.closest ? ev.target.closest(".ro-nsave") : null;
        if (nbtn) {
            var nid = nbtn.getAttribute("data-id");
            var nsel = document.querySelector('.ro-npick[data-id="' + nid + '"]');
            if (!nsel || !nsel.value) {
                alertBox("warning", "Pilih ODP-nya dulu.");
                return;
            }
            nbtn.disabled = true;
            nbtn.textContent = "…";
            simpan(nid, nsel.value)
                .then(function () { muat(); })
                .catch(function (e) {
                    nbtn.disabled = false;
                    nbtn.textContent = "Simpan";
                    alertBox("danger", "<strong>Gagal:</strong> " + esc(e.message));
                });
            return;
        }

        var btn = ev.target.closest ? ev.target.closest(".ro-save") : null;
        if (btn) {
            var id = btn.getAttribute("data-id");
            var sel = document.querySelector('.ro-pick[data-id="' + id + '"]');
            if (!sel) return;
            btn.disabled = true;
            btn.textContent = "…";
            simpan(id, sel.value)
                .then(function () {
                    var tr = document.querySelector('tr[data-row="' + id + '"]');
                    if (tr) tr.remove();
                    muat();
                })
                .catch(function (e) {
                    btn.disabled = false;
                    btn.textContent = "Simpan";
                    alertBox("danger", "<strong>Gagal:</strong> " + esc(e.message));
                });
            return;
        }

        if (ev.target.closest && ev.target.closest("#ro-bulk")) {
            var dekat = rows.filter(function (r) {
                return r.suggestions.length && r.suggestions[0].meters < BULK_MAX_METERS;
            });
            if (!dekat.length) return;
            if (!window.confirm("Terapkan " + dekat.length + " usulan ODP yang jaraknya < " + BULK_MAX_METERS + " m?")) return;

            var bulk = el("ro-bulk");
            bulk.disabled = true;
            bulk.textContent = "Menyimpan…";

            var ok = 0;
            var gagal = [];
            // Berurutan (bukan paralel): tulis ODP menghitung ulang pemakaian port tiap kali —
            // biar kapasitas ditegakkan apa adanya, bukan diserbu bersamaan.
            dekat.reduce(function (p, r) {
                return p.then(function () {
                    return simpan(r.id, r.suggestions[0].id)
                        .then(function () { ok++; })
                        .catch(function (e) { gagal.push(r.name + ": " + e.message); });
                });
            }, Promise.resolve()).then(function () {
                alertBox(gagal.length ? "warning" : "success",
                    "<strong>" + ok + " pelanggan tersambung.</strong>"
                    + (gagal.length ? "<br>Gagal " + gagal.length + ": " + esc(gagal.join(" · ")) : ""));
                muat();
            });
        }
    });

    el("ro-refresh").addEventListener("click", muat);
    el("ro-radius").addEventListener("change", muat);
    el("ro-search").addEventListener("input", renderNoGps); // filter lokal, tanpa bolak-balik server
    muat();
})();
