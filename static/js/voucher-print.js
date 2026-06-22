/* Cetak Voucher — generate batch, pilih layout, pratinjau & cetak. Mengonsumsi /voucher/* dan /voucher/print/*. */
(function () {
    "use strict";

    var vouchers = [];
    var layouts = [];
    var settings = {};
    var profilesByProf = {};
    var selectedLayoutId = null;

    function $(id) { return document.getElementById(id); }

    function api(method, url, body) {
        var opts = { method: method, headers: { "Content-Type": "application/json" } };
        if (body) opts.body = JSON.stringify(body);
        return fetch(url, opts).then(function (r) { return r.json(); });
    }

    function toast(icon, title) {
        if (window.Swal) {
            window.Swal.fire({ toast: true, position: "top-end", timer: 2200, showConfirmButton: false, icon: icon, title: title });
        }
    }

    function applyTpl(tpl, map) {
        return String(tpl || "").replace(/\{\{(\w+)\}\}/g, function (_m, k) {
            return (map[k] !== null && typeof map[k] !== "undefined") ? String(map[k]) : "";
        });
    }

    function sampleMap() {
        return {
            wifi: settings.wifi_name || "WiFi", kode: "7ChD66", sandi: "7ChD66",
            harga: "Rp 5.000", harga_angka: "5.000", masa_aktif: "1 Hari", durasi: "1 Hari", kuota: "",
            paket: "Paket", qr: '<div style="width:100%;height:100%;background:#eee;border:1px solid #ddd;display:flex;align-items:center;justify-content:center;font-size:8px;color:#888;">QR</div>',
            logo: "", cs: settings.cs_number || "08xx", portal: settings.portal_text || "", warna: "#FF4500", tanggal: ""
        };
    }

    function renderGallery() {
        var box = $("vpGallery");
        if (!layouts.length) { box.innerHTML = '<span class="text-muted small">Belum ada layout.</span>'; return; }
        box.innerHTML = "";
        layouts.forEach(function (layout) {
            var thumb = document.createElement("div");
            thumb.className = "vp-thumb" + (layout.id === selectedLayoutId ? " selected" : "");
            thumb.setAttribute("data-id", layout.id);
            var badge = layout.builtin ? '<span class="badge badge-secondary">bawaan</span>' : '<span class="badge badge-info">custom</span>';
            thumb.innerHTML = '<div class="vp-thumb-box"><div>' + applyTpl(layout.template, sampleMap()) + "</div></div>" +
                '<div class="vp-thumb-name">' + (layout.name || layout.id) + " " + badge + "</div>";
            thumb.addEventListener("click", function () { selectLayout(layout.id); });
            box.appendChild(thumb);
        });
    }

    function selectLayout(id) {
        selectedLayoutId = id;
        renderGallery();
        var layout = layouts.filter(function (l) { return l.id === id; })[0];
        if (layout) {
            $("edLayoutId").value = layout.id;
            $("edLayoutName").value = layout.name || "";
            $("edLayoutTpl").value = layout.template || "";
        }
        updatePrintState();
    }

    function updatePrintState() {
        $("vpBtnPrint").disabled = !(vouchers.length > 0 && selectedLayoutId);
        $("vpReady").textContent = vouchers.length > 0
            ? (vouchers.length + " voucher siap dicetak.")
            : "Belum ada voucher disiapkan.";
    }

    function attachProfileData(list) {
        var prof = $("vpProfile").value;
        var p = profilesByProf[prof] || {};
        return list.map(function (v) {
            return {
                username: v.username, password: v.password || v.username, profile: prof,
                price: p.hargavc || 0, validity: p.durasivc || "", profileName: p.namavc || prof
            };
        });
    }

    function renderRequest() {
        return { layoutId: selectedLayoutId, vouchers: vouchers, thermal: $("vpThermal").checked };
    }

    function fetchRenderHtml() {
        return fetch("/api/voucher/print/render", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(renderRequest())
        }).then(function (r) { return r.text(); });
    }

    // ---- actions ----
    function doGenerate() {
        var prof = $("vpProfile").value;
        if (!prof) { toast("warning", "Pilih paket dulu"); return; }
        var qty = parseInt($("vpQty").value, 10) || 1;
        $("vpBtnGenerate").disabled = true;
        api("POST", "/api/voucher/generate-send", {
            profile: prof, quantity: qty, voucherType: "random",
            sendWhatsApp: false, transaction_context: "direct_customer_sale", phones: []
        }).then(function (res) {
            $("vpBtnGenerate").disabled = false;
            if (res.status !== 200 || !res.vouchers) { toast("error", res.message || "Gagal generate"); return; }
            vouchers = attachProfileData(res.vouchers);
            updatePrintState();
            toast("success", "Generate " + vouchers.length + " voucher");
        }).catch(function (e) { $("vpBtnGenerate").disabled = false; toast("error", e.message); });
    }

    function doManual() {
        var prof = $("vpProfile").value;
        if (!prof) { toast("warning", "Pilih paket dulu"); return; }
        var lines = $("vpManual").value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
        if (!lines.length) { toast("warning", "Daftar kosong"); return; }
        var parsed = lines.map(function (line) {
            var parts = line.split(",");
            return { username: parts[0].trim(), password: (parts[1] || parts[0]).trim() };
        });
        vouchers = attachProfileData(parsed);
        updatePrintState();
        toast("success", vouchers.length + " voucher siap");
    }

    function doPreview() {
        if (!selectedLayoutId) { toast("warning", "Pilih layout"); return; }
        if (!vouchers.length) { toast("warning", "Siapkan voucher dulu"); return; }
        fetchRenderHtml().then(function (html) { $("vpPreview").srcdoc = html; });
    }

    function doPrint() {
        if (!vouchers.length || !selectedLayoutId) return;
        fetchRenderHtml().then(function (html) {
            var blob = new Blob([html], { type: "text/html" });
            var url = URL.createObjectURL(blob);
            window.open(url, "_blank");
        });
    }

    function saveSettings() {
        var colors;
        try { colors = JSON.parse($("setColors").value || "{}"); }
        catch (_e) { toast("error", "JSON warna tidak valid"); return; }
        var patch = {
            wifi_name: $("setWifi").value, cs_number: $("setCs").value, portal_text: $("setPortal").value,
            logo_url: $("setLogo").value, qr_mode: $("setQrMode").value, default_color: $("setDefaultColor").value,
            autologin_url_template: $("setAutologin").value, price_colors: colors
        };
        api("POST", "/api/voucher/print/settings", patch).then(function (res) {
            if (res.status === 200) { settings = res.data; toast("success", "Pengaturan tersimpan"); renderGallery(); }
            else { toast("error", res.message || "Gagal"); }
        });
    }

    function saveLayout() {
        var id = $("edLayoutId").value.trim();
        var tpl = $("edLayoutTpl").value;
        if (!id || !tpl) { toast("warning", "ID & template wajib"); return; }
        api("POST", "/api/voucher/print/layout", { id: id, name: $("edLayoutName").value.trim() || id, template: tpl }).then(function (res) {
            if (res.status === 200) { toast("success", "Layout tersimpan"); loadLayouts(id); }
            else { toast("error", res.message || "Gagal"); }
        });
    }

    function deleteLayout() {
        var id = $("edLayoutId").value.trim();
        if (!id) return;
        api("DELETE", "/api/voucher/print/layout/" + encodeURIComponent(id)).then(function (res) {
            if (res.status === 200) { toast("success", "Layout dihapus"); loadLayouts(); }
            else { toast("error", res.message || "Gagal"); }
        });
    }

    function importMikhmon() {
        var php = $("edMikhmonPhp").value;
        if (!php.trim()) { toast("warning", "Tempel template Mikhmon"); return; }
        api("POST", "/api/voucher/print/import-mikhmon", { name: $("edMikhmonName").value.trim() || "Impor Mikhmon", php: php }).then(function (res) {
            if (res.status === 200) { toast("success", "Template diimpor"); loadSettings(); loadLayouts(res.data && res.data.layout ? res.data.layout.id : null); }
            else { toast("error", res.message || "Gagal"); }
        });
    }

    // ---- loaders ----
    function loadProfiles() {
        api("GET", "/api/voucher/profiles").then(function (res) {
            var list = (res && res.data) || [];
            var sel = $("vpProfile");
            sel.innerHTML = "";
            if (!list.length) { sel.innerHTML = '<option value="">(belum ada paket voucher)</option>'; return; }
            list.forEach(function (p) {
                profilesByProf[p.prof] = p;
                var opt = document.createElement("option");
                opt.value = p.prof;
                opt.textContent = (p.namavc || p.prof) + " — Rp " + (p.hargavc || 0) + " (" + (p.durasivc || "-") + ")";
                sel.appendChild(opt);
            });
        });
    }

    function loadSettings() {
        api("GET", "/api/voucher/print/settings").then(function (res) {
            settings = (res && res.data) || {};
            $("setWifi").value = settings.wifi_name || "";
            $("setCs").value = settings.cs_number || "";
            $("setPortal").value = settings.portal_text || "";
            $("setLogo").value = settings.logo_url || "";
            $("setQrMode").value = settings.qr_mode || "code";
            $("setDefaultColor").value = settings.default_color || "";
            $("setAutologin").value = settings.autologin_url_template || "";
            $("setColors").value = JSON.stringify(settings.price_colors || {}, null, 2);
            if (!selectedLayoutId) selectedLayoutId = settings.default_layout || null;
            renderGallery();
        });
    }

    function loadLayouts(selectId) {
        api("GET", "/api/voucher/print/layouts").then(function (res) {
            layouts = (res && res.data) || [];
            if (selectId) selectedLayoutId = selectId;
            if (!selectedLayoutId && layouts.length) selectedLayoutId = layouts[0].id;
            renderGallery();
            updatePrintState();
        });
    }

    document.addEventListener("DOMContentLoaded", function () {
        loadProfiles();
        loadSettings();
        loadLayouts();
        $("vpBtnGenerate").addEventListener("click", doGenerate);
        $("vpBtnManual").addEventListener("click", doManual);
        $("vpBtnPreview").addEventListener("click", doPreview);
        $("vpBtnPrint").addEventListener("click", doPrint);
        $("vpBtnSaveSettings").addEventListener("click", saveSettings);
        $("vpBtnSaveLayout").addEventListener("click", saveLayout);
        $("vpBtnDeleteLayout").addEventListener("click", deleteLayout);
        $("vpBtnImportMikhmon").addEventListener("click", importMikhmon);
    });
})();
