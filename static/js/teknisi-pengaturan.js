/**
 * Header Doc
 * Purpose: Logika halaman "Pengaturan Saya" teknisi (#b354 self-service, RONDE 6 Fase A). Muat prefs
 *   milik SENDIRI (GET /api/teknisi/prefs, self-scoped by JWT), render ke form, simpan (POST). Snooze
 *   dihitung client → ISO. Banner jujur bila fitur belum diaktifkan admin (featureEnabled=false).
 * Caller: views/sb-admin/teknisi-pengaturan.php.
 * Deps: Fetch API (credentials:'include' → JWT cookie), jQuery (toast/DOM), Bootstrap.
 * MainFuncs: loadPrefs, renderPrefs, collectPatch, savePrefs.
 * SideEffects: Panggilan HTTP ke /api/teknisi/prefs; mutasi DOM form.
 */
(function () {
    "use strict";

    var API = "/api/teknisi/prefs";
    var pendingSnooze; // undefined = tak diubah; null = batalkan; string ISO = set

    function $(id) { return document.getElementById(id); }

    function toast(msg, type) {
        var box = $("globalMessage");
        if (!box) return;
        box.innerHTML =
            '<div class="alert alert-' + (type || "info") + ' alert-dismissible fade show" role="alert">' +
            msg +
            '<button type="button" class="close" data-dismiss="alert">&times;</button></div>';
    }

    function setBusy(busy) {
        ["btnSimpan", "btnSimpanBottom"].forEach(function (id) {
            var b = $(id);
            if (b) b.disabled = busy;
        });
    }

    async function loadPrefs() {
        try {
            var res = await fetch(API + "?_=" + Date.now(), { credentials: "include" });
            var json = await res.json();
            if (!res.ok || json.status !== 200 || !json.data) {
                throw new Error((json && json.message) || "Gagal memuat pengaturan.");
            }
            renderPrefs(json.data);
            $("loadingState").classList.add("d-none");
            $("prefsForm").classList.remove("d-none");
            if (json.data.featureEnabled === false) $("gateBanner").classList.remove("d-none");
            setBusy(false);
        } catch (err) {
            $("loadingState").innerHTML =
                '<div class="text-danger"><i class="fas fa-times-circle"></i> ' + (err.message || err) + "</div>";
        }
    }

    function renderPrefs(data) {
        var p = data.prefs || {};
        $("enabled").checked = p.enabled !== false;
        var alerts = p.alerts || {};
        Array.prototype.forEach.call(document.querySelectorAll(".alert-class"), function (cb) {
            cb.checked = alerts[cb.getAttribute("data-key")] !== false;
        });
        $("channel").value = ["dm", "group", "both"].indexOf(p.channel) >= 0 ? p.channel : "both";
        $("areas").value = Array.isArray(p.areas) ? p.areas.join(", ") : "";

        var qh = p.quietHours || {};
        $("qh_enabled").checked = !!qh.enabled;
        if (qh.start) $("qh_start").value = qh.start;
        if (qh.end) $("qh_end").value = qh.end;

        var pantau = p.pantau || {};
        $("pantau_interval").value = pantau.intervalMs ? Math.round(pantau.intervalMs / 60000) : "";
        $("pantau_target").value = typeof pantau.targetDbm === "number" ? pantau.targetDbm : "";

        renderSnoozeStatus(p.snoozeUntil);
    }

    function renderSnoozeStatus(iso) {
        var el = $("snoozeStatus");
        if (!el) return;
        var active = iso && new Date(iso).getTime() > Date.now();
        el.textContent = active ? "Alert dijeda sampai " + new Date(iso).toLocaleString("id-ID") : "Tidak ada jeda aktif.";
    }

    function collectPatch() {
        var patch = {
            enabled: $("enabled").checked,
            channel: $("channel").value,
            alerts: {},
            areas: $("areas").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean),
            quietHours: { enabled: $("qh_enabled").checked, start: $("qh_start").value, end: $("qh_end").value },
            pantau: {},
        };
        Array.prototype.forEach.call(document.querySelectorAll(".alert-class"), function (cb) {
            patch.alerts[cb.getAttribute("data-key")] = cb.checked;
        });
        var mins = parseFloat($("pantau_interval").value);
        if (isFinite(mins) && mins > 0) patch.pantau.intervalMs = Math.round(mins * 60000);
        var tgt = parseFloat($("pantau_target").value);
        if (isFinite(tgt)) patch.pantau.targetDbm = tgt;
        if (pendingSnooze !== undefined) patch.snoozeUntil = pendingSnooze;
        return patch;
    }

    async function savePrefs(ev) {
        if (ev) ev.preventDefault();
        setBusy(true);
        try {
            var res = await fetch(API, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(collectPatch()),
            });
            var json = await res.json();
            if (!res.ok || json.status !== 200) throw new Error((json && json.message) || "Gagal menyimpan.");
            pendingSnooze = undefined;
            if (json.data && json.data.prefs) renderSnoozeStatus(json.data.prefs.snoozeUntil);
            toast('<i class="fas fa-check-circle"></i> Pengaturan tersimpan.', "success");
        } catch (err) {
            toast('<i class="fas fa-times-circle"></i> ' + (err.message || err), "danger");
        } finally {
            setBusy(false);
        }
    }

    function bindSnooze() {
        var group = $("snoozeGroup");
        if (!group) return;
        group.addEventListener("click", function (e) {
            var btn = e.target.closest("button[data-mins]");
            if (!btn) return;
            var mins = parseInt(btn.getAttribute("data-mins"), 10);
            pendingSnooze = mins > 0 ? new Date(Date.now() + mins * 60000).toISOString() : null;
            renderSnoozeStatus(pendingSnooze);
            toast(mins > 0 ? "Jeda disetel — klik Simpan untuk menerapkan." : "Jeda akan dibatalkan — klik Simpan.", "info");
        });
    }

    document.addEventListener("DOMContentLoaded", function () {
        var form = $("prefsForm");
        if (form) form.addEventListener("submit", savePrefs);
        var topBtn = $("btnSimpan");
        if (topBtn) topBtn.addEventListener("click", savePrefs);
        bindSnooze();
        loadPrefs();
    });
})();
