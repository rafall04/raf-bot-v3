/**
 * Header Doc
 * Purpose: Frontend halaman /steering-pelanggan — tabel live pelanggan × jalur ISP (intended →
 *          actual + sumber), aksi steer per-pelanggan (GMDP/IH/MNI/SF/default), daftar steering
 *          aktif, kelola entri pool freedns/lokaldns (toggle/tambah/hapus), banner + tombol
 *          setup rule RAF-CUSTSTEER (cek via ?check=1).
 * Caller: `views/sb-admin/steering-pelanggan.php`.
 * Deps: fetch API, endpoint /api/customer-steering/*.
 * MainFuncs: `muatOverview`, `renderCustomers`, `renderPools`, `renderIntents`, `cekSetup`.
 * SideEffects: DOM update + interval refresh 60 dtk; aksi tulis via POST (konfirmasi dialog).
 */
(function () {
    "use strict";

    var WARNA = { gmdp: "#1cc88a", ih: "#4e73df", mni: "#e74a3b", sf: "#f6c23e" };
    var PATHS = ["gmdp", "ih", "mni", "sf"];
    var dataTerakhir = null;
    var canEdit = false;

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
        });
    }

    function notif(pesan, ok) {
        var el = document.getElementById("steer-alert");
        el.className = "alert " + (ok ? "alert-success" : "alert-danger");
        el.textContent = pesan;
        el.classList.remove("d-none");
        setTimeout(function () { el.classList.add("d-none"); }, 6000);
    }

    function badgeJalur(key) {
        var warna = WARNA[key] || "#858796";
        return '<span class="badge" style="background:' + warna + ';color:#fff">' + esc(String(key || "?").toUpperCase()) + "</span>";
    }

    function renderCounts(d) {
        var wrap = document.getElementById("steer-counts");
        var chips = PATHS.map(function (p) {
            var n = (d.counts && d.counts[p]) || 0;
            return '<span class="mr-2 mb-1 d-inline-block">' + badgeJalur(p) + ' <b>' + n + "</b> pelanggan</span>";
        }).join("");
        wrap.innerHTML = '<div class="card shadow-sm"><div class="card-body py-2">' +
            "<b>" + d.total_online + "</b> pelanggan online · " + chips +
            "</div></div>";
    }

    function renderCustomers(d) {
        var tbody = document.getElementById("steer-customers");
        var q = (document.getElementById("steer-search").value || "").toLowerCase();
        var rows = (d.customers || []).filter(function (c) {
            if (!q) return true;
            return String(c.name).toLowerCase().indexOf(q) >= 0 ||
                String(c.pppoe).toLowerCase().indexOf(q) >= 0 ||
                String(c.ip).indexOf(q) >= 0;
        });
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-muted small p-3">Tidak ada pelanggan cocok.</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(function (c) {
            var jalur = badgeJalur(c.intended);
            if (c.actual && c.actual !== c.intended) {
                jalur += ' <i class="fas fa-arrow-right small text-muted"></i> ' + badgeJalur(c.actual) +
                    ' <span class="small text-muted">(menumpang' + (c.via ? " " + esc(c.via) : "") + ")</span>";
            }
            var sumber = c.source === "default" ? '<span class="text-muted">default</span>'
                : (c.source.indexOf("steer:") === 0
                    ? '<span class="badge badge-dark">STEER</span>'
                    : esc(c.source.replace("pool:", "pool ")));
            var opsi = ['<option value="">— pilih —</option>']
                .concat(PATHS.map(function (p) {
                    return '<option value="' + p + '"' + (c.steerTarget === p ? " selected" : "") + ">" + p.toUpperCase() + "</option>";
                }))
                .concat(['<option value="__default__">Kembalikan default</option>']).join("");
            var aksi = canEdit
                ? '<div class="d-flex align-items-center">' +
                    '<select class="form-control form-control-sm mr-1 steer-sel" style="max-width:120px" data-uid="' + esc(c.userId) + '">' + opsi + "</select>" +
                    '<button class="btn btn-sm btn-primary steer-go" data-uid="' + esc(c.userId) + '" data-nama="' + esc(c.name) + '"' + (c.userId == null ? " disabled" : "") + ">OK</button>" +
                    "</div>"
                : '<span class="small text-muted">lihat saja</span>';
            return "<tr>" +
                "<td><b>" + esc(c.name) + "</b><div class='small text-muted'>" + esc(c.pppoe) + "</div></td>" +
                "<td class='small'>" + esc(c.paket) + "</td>" +
                "<td class='small'>" + esc(c.ip) + "</td>" +
                "<td>" + jalur + "<div class='small text-muted'>" + esc(c.catatan || "") + "</div></td>" +
                "<td class='small'>" + sumber + "</td>" +
                "<td>" + aksi + "</td>" +
                "</tr>";
        }).join("");

        Array.prototype.forEach.call(tbody.querySelectorAll(".steer-go"), function (b) {
            b.addEventListener("click", function () {
                var uid = b.getAttribute("data-uid");
                var nama = b.getAttribute("data-nama");
                var sel = tbody.querySelector(".steer-sel[data-uid='" + uid + "']");
                var val = sel ? sel.value : "";
                if (!val) return notif("Pilih jalur dulu.", false);
                var target = val === "__default__" ? null : val;
                var pesan = target
                    ? "Arahkan SEMUA trafik \"" + nama + "\" via " + target.toUpperCase() + "?\n\nCatatan: prioritas khusus WA/game dilewati selama steering; entri otomatis mengikuti bila IP pelanggan berganti."
                    : "Kembalikan \"" + nama + "\" ke jalur default pool-nya?";
                if (!window.confirm(pesan)) return;
                b.disabled = true;
                fetch("/api/customer-steering/steer", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId: uid, path: target })
                })
                    .then(function (r) { return r.json(); })
                    .then(function (j) {
                        var d = (j && j.data) || {};
                        notif(d.message || d.error || (j.success ? "OK" : "Gagal"), j.success === true);
                        muatOverview();
                    })
                    .catch(function () { notif("Gagal menghubungi server.", false); })
                    .then(function () { b.disabled = false; });
            });
        });
    }

    function renderIntents(d) {
        var wrap = document.getElementById("steer-intents");
        var intents = d.intents || [];
        if (!intents.length) {
            wrap.innerHTML = '<div class="small text-muted">Tidak ada steering per-pelanggan aktif — semua mengikuti pool.</div>';
            return;
        }
        wrap.innerHTML = intents.map(function (i) {
            return '<div class="border-bottom py-1 small d-flex justify-content-between align-items-center">' +
                "<div><b>" + esc(i.name || i.pppoe) + "</b> → " + badgeJalur(i.path) +
                (i.addedIp ? ' <span class="text-muted">(' + esc(i.addedIp) + ")</span>" : ' <span class="text-warning">(menunggu online)</span>') +
                '<div class="text-muted">oleh ' + esc(i.actor || "-") + " · " + esc((i.updatedAt || "").slice(0, 16).replace("T", " ")) + "</div></div>" +
                (canEdit ? '<button class="btn btn-sm btn-outline-danger steer-unset" data-uid="' + esc(i.userId) + '" data-nama="' + esc(i.name || i.pppoe) + '">Lepas</button>' : "") +
                "</div>";
        }).join("");
        Array.prototype.forEach.call(wrap.querySelectorAll(".steer-unset"), function (b) {
            b.addEventListener("click", function () {
                if (!window.confirm("Lepas steering \"" + b.getAttribute("data-nama") + "\" (kembali ke default pool)?")) return;
                fetch("/api/customer-steering/steer", {
                    method: "POST", credentials: "same-origin",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId: b.getAttribute("data-uid"), path: null })
                }).then(function (r) { return r.json(); }).then(function (j) {
                    notif(((j.data || {}).message) || "OK", j.success === true);
                    muatOverview();
                }).catch(function () { notif("Gagal menghubungi server.", false); });
            });
        });
    }

    function poolAction(body, konfirmasi) {
        if (konfirmasi && !window.confirm(konfirmasi)) return;
        fetch("/api/customer-steering/pool-entry", {
            method: "POST", credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        }).then(function (r) { return r.json(); }).then(function (j) {
            notif(j.success ? "Entri pool diperbarui." : (((j.data || {}).error) || "Gagal"), j.success === true);
            muatOverview();
        }).catch(function () { notif("Gagal menghubungi server.", false); });
    }

    function renderPools(d) {
        var wrap = document.getElementById("steer-pools");
        var lists = d.poolEntries || {};
        wrap.innerHTML = Object.keys(lists).map(function (name) {
            var rows = (lists[name] || []).map(function (e) {
                var status = e.dynamic
                    ? '<span class="badge badge-secondary">dynamic</span>'
                    : (e.disabled ? '<span class="badge badge-secondary">OFF</span>' : '<span class="badge badge-success">AKTIF</span>');
                var aksi = "";
                if (canEdit && !e.dynamic) {
                    aksi = '<button class="btn btn-sm btn-outline-' + (e.disabled ? "success" : "warning") + ' py-0 px-1 pool-toggle" data-list="' + esc(name) + '" data-id="' + esc(e.id) + '" data-dis="' + (e.disabled ? "0" : "1") + '">' + (e.disabled ? "Aktifkan" : "Matikan") + "</button> " +
                        '<button class="btn btn-sm btn-outline-danger py-0 px-1 pool-del" data-list="' + esc(name) + '" data-id="' + esc(e.id) + '" data-addr="' + esc(e.address) + '">×</button>';
                }
                return '<div class="d-flex justify-content-between align-items-center border-bottom py-1 small">' +
                    "<div><code>" + esc(e.address) + "</code> " + status +
                    (e.comment ? ' <span class="text-muted">' + esc(e.comment) + "</span>" : "") + "</div>" +
                    "<div>" + aksi + "</div></div>";
            }).join("");
            var tambah = canEdit
                ? '<div class="d-flex mt-1"><input class="form-control form-control-sm mr-1 pool-addr" data-list="' + esc(name) + '" placeholder="cth 192.168.62.0/24">' +
                  '<button class="btn btn-sm btn-outline-primary pool-add" data-list="' + esc(name) + '">Tambah</button></div>'
                : "";
            return '<div class="mb-3"><b class="small text-uppercase">' + esc(name) + "</b>" + (rows || '<div class="small text-muted">kosong</div>') + tambah + "</div>";
        }).join("");

        Array.prototype.forEach.call(wrap.querySelectorAll(".pool-toggle"), function (b) {
            b.addEventListener("click", function () {
                var keOff = b.getAttribute("data-dis") === "1";
                poolAction(
                    { action: "toggle", list: b.getAttribute("data-list"), id: b.getAttribute("data-id"), disabled: keOff },
                    (keOff ? "MATIKAN" : "AKTIFKAN") + " entri ini?\n\nIni memindahkan SATU POOL penuh (semua pelanggan subnet itu) antar jalur."
                );
            });
        });
        Array.prototype.forEach.call(wrap.querySelectorAll(".pool-del"), function (b) {
            b.addEventListener("click", function () {
                poolAction(
                    { action: "remove", list: b.getAttribute("data-list"), id: b.getAttribute("data-id") },
                    "HAPUS entri " + b.getAttribute("data-addr") + " dari " + b.getAttribute("data-list") + "?"
                );
            });
        });
        Array.prototype.forEach.call(wrap.querySelectorAll(".pool-add"), function (b) {
            b.addEventListener("click", function () {
                var inp = wrap.querySelector(".pool-addr[data-list='" + b.getAttribute("data-list") + "']");
                var addr = inp ? inp.value.trim() : "";
                if (!addr) return notif("Isi alamat subnet/IP dulu.", false);
                poolAction(
                    { action: "add", list: b.getAttribute("data-list"), address: addr },
                    "Tambah " + addr + " ke " + b.getAttribute("data-list") + "? Ini langsung memengaruhi arah trafik subnet itu."
                );
            });
        });
    }

    // ── Oper Segmen (pool → jalur) — pakai endpoint /segments{,/preview,/apply}. Tidak butuh
    //    customerSteering.enabled (apply segmen gate cfg.valid saja). Edit ikut canEdit (peran).
    function renderSegments(d) {
        var tbody = document.getElementById("seg-rows");
        var segs = (d && d.segments) || [];
        var edit = d && d.canEdit === true;
        if (!segs.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-muted small p-3">Tidak ada segmen terdaftar.</td></tr>';
            return;
        }
        tbody.innerHTML = segs.map(function (s) {
            var aksi = edit
                ? ["mni", "gmdp"].filter(function (p) { return p !== s.currentPath; }).map(function (p) {
                    return '<button class="btn btn-sm btn-outline-primary py-0 px-2 mr-1 seg-oper" data-seg="' + esc(s.id) +
                        '" data-label="' + esc(s.label) + '" data-path="' + p + '">→ ' + p.toUpperCase() + "</button>";
                }).join("")
                : '<span class="small text-muted">lihat saja</span>';
            return "<tr>" +
                "<td><b>" + esc(s.label) + "</b></td>" +
                "<td class='small'><code>" + esc(s.subnet) + "</code></td>" +
                "<td>" + badgeJalur(s.currentPath) + (s.ambiguous ? ' <span class="text-warning small" title="subnet aktif di dua list">⚠</span>' : "") + "</td>" +
                "<td class='small'>" + esc(String(s.activeCount)) + "</td>" +
                "<td>" + aksi + "</td>" +
                "</tr>";
        }).join("");
        Array.prototype.forEach.call(tbody.querySelectorAll(".seg-oper"), function (b) {
            b.addEventListener("click", function () {
                operSegmen(b.getAttribute("data-seg"), b.getAttribute("data-label"), b.getAttribute("data-path"), b);
            });
        });
    }

    function operSegmen(seg, label, path, btn) {
        btn.disabled = true;
        fetch("/api/customer-steering/segments/preview?segment=" + encodeURIComponent(seg) + "&path=" + encodeURIComponent(path), { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                var d = (j && j.data) || {};
                if (!j.success) { notif(d.error || "Gagal membuat pratinjau.", false); return; }
                if (d.noop) { notif("Segmen " + label + " sudah di " + path.toUpperCase() + ".", true); return; }
                var langkah = (d.ops || []).map(function (o, i) { return (i + 1) + ". " + o.desc; }).join("\n");
                var pesan = "Oper segmen " + label + ": " + String(d.from).toUpperCase() + " → " + path.toUpperCase() +
                    "\n\nLangkah yang akan dijalankan di router:\n" + langkah + "\n\nLanjutkan?";
                if (!window.confirm(pesan)) return;
                return fetch("/api/customer-steering/segments/apply", {
                    method: "POST", credentials: "same-origin",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ segment: seg, path: path, confirm: true })
                }).then(function (r) { return r.json(); }).then(function (j2) {
                    var d2 = (j2 && j2.data) || {};
                    notif(d2.message || d2.error || (j2.success ? "OK" : "Gagal"), j2.success === true);
                    muatSegmen();
                    muatOverview();
                });
            })
            .catch(function () { notif("Gagal menghubungi server.", false); })
            .then(function () { btn.disabled = false; });
    }

    function muatSegmen() {
        fetch("/api/customer-steering/segments", { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                var d = (j && j.data) || {};
                if (!j.success) {
                    document.getElementById("seg-rows").innerHTML = '<tr><td colspan="5" class="text-danger small p-3">' + esc(d.error || "Gagal memuat segmen.") + "</td></tr>";
                    return;
                }
                renderSegments(d);
            })
            .catch(function () { /* biarkan; overview yang tampilkan notif */ });
    }

    function cekSetup() {
        if (!canEdit) return;
        fetch("/api/customer-steering/setup?check=1", { method: "POST", credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                var rules = ((j.data || {}).rules) || [];
                var belum = rules.filter(function (r) { return r.status === "belum"; });
                var banner = document.getElementById("steer-setup-banner");
                banner.classList.toggle("d-none", belum.length === 0);
            })
            .catch(function () { /* biarkan */ });
    }

    function muatOverview() {
        fetch("/api/customer-steering/overview", { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                var d = (j && j.data) || {};
                if (!j.success) {
                    notif(d.error || "Gagal memuat data.", false);
                    return;
                }
                dataTerakhir = d;
                canEdit = d.canEdit === true && d.enabled === true;
                renderCounts(d);
                renderCustomers(d);
                renderIntents(d);
                renderPools(d);
                var meta = document.getElementById("steer-meta");
                meta.textContent = d.enabled
                    ? "Steering aktif · data live dari router · refresh otomatis 60 dtk."
                    : "MODE LIHAT SAJA — aktifkan config.customerSteering.enabled=true untuk aksi steering.";
            })
            .catch(function () { notif("Gagal menghubungi server.", false); });
    }

    document.getElementById("btn-steer-refresh").addEventListener("click", function () { muatOverview(); muatSegmen(); });
    document.getElementById("steer-search").addEventListener("input", function () {
        if (dataTerakhir) renderCustomers(dataTerakhir);
    });
    document.getElementById("btn-steer-setup").addEventListener("click", function () {
        var b = this;
        if (!window.confirm("Pasang 4 rule override RAF-CUSTSTEER di router?\n\nAman: list masih kosong → tidak ada trafik berubah sampai ada pelanggan disteer.")) return;
        b.disabled = true;
        fetch("/api/customer-steering/setup", { method: "POST", credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                notif(j.success ? "Rule steering terpasang." : (((j.data || {}).error) || "Gagal"), j.success === true);
                cekSetup();
            })
            .catch(function () { notif("Gagal menghubungi server.", false); })
            .then(function () { b.disabled = false; });
    });

    muatOverview();
    muatSegmen();
    setTimeout(cekSetup, 800);
    setInterval(function () { muatOverview(); muatSegmen(); }, 60000);
})();
