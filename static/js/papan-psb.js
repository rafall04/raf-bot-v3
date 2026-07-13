/* Papan PSB — daftar PSB (belum kepasang) + list papan. Paritas dgn WA #jadwal (identitas + 3 bukti). */
"use strict";

function val(id) { return (document.getElementById(id).value || "").trim(); }
function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function showAlert(msg, type) {
    document.getElementById("formAlert").innerHTML = `<div class="alert alert-${type} alert-dismissible fade show" role="alert">${esc(msg)}<button type="button" class="close" data-dismiss="alert">&times;</button></div>`;
}

// Ekstrak lat,lng dari link Google Maps atau "lat,lng".
function parseLokasi(s) {
    s = String(s || "").trim();
    let m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (!m) m = s.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
    if (!m) m = s.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    if (!m) return null;
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (Number.isNaN(lat) || Number.isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
}

function ambilLokasi() {
    if (!navigator.geolocation) return showAlert("Browser tak mendukung lokasi.", "warning");
    navigator.geolocation.getCurrentPosition(
        (pos) => { document.getElementById("fLokasi").value = pos.coords.latitude.toFixed(6) + "," + pos.coords.longitude.toFixed(6); },
        () => showAlert("Gagal ambil lokasi — izinkan akses lokasi atau tempel link Maps.", "warning"),
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

async function uploadFoto(tempId, fieldname, file) {
    const fd = new FormData();
    fd.append("photo", file);
    const r = await fetch(`/api/psb/upload-photo?tempId=${encodeURIComponent(tempId)}&fieldname=${fieldname}`, { method: "POST", credentials: "include", body: fd });
    const j = await r.json().catch(() => ({}));
    const p = j.webPath || j.path || (j.data && (j.data.webPath || j.data.path));
    if (!r.ok || !p) throw new Error(j.message || "upload foto gagal");
    return p;
}

async function submitPsb() {
    const btn = document.getElementById("btnSubmit");
    document.getElementById("formAlert").innerHTML = "";
    const nama = val("fNama"); const hp = val("fHp"); const dusun = val("fDusun"); const paket = val("fPaket"); const catatan = val("fCatatan");
    const ktpFile = document.getElementById("fKtp").files[0];
    const rumahFile = document.getElementById("fRumah").files[0];
    const lok = parseLokasi(val("fLokasi"));
    if (!nama || !hp || !dusun || !paket) return showAlert("Nama, HP, Dusun, Paket wajib diisi.", "danger");
    if (!ktpFile) return showAlert("Foto KTP wajib.", "danger");
    if (!rumahFile) return showAlert("Foto rumah wajib.", "danger");
    if (!lok) return showAlert("Lokasi tak valid — tempel link Google Maps atau format lat,lng.", "danger");

    btn.disabled = true; btn.innerHTML = "Mengunggah…";
    try {
        const tempId = "WEB_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
        const ktpPath = await uploadFoto(tempId, "ktp_photo", ktpFile);
        const housePath = await uploadFoto(tempId, "house_photo", rumahFile);
        const r = await fetch("/api/psb-schedule", {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nama, hp, dusun, paket, latitude: lok.lat, longitude: lok.lng, catatan, ktp_photo_path: ktpPath, house_photo_path: housePath })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.message || "gagal menyimpan");
        showAlert("✅ " + (j.message || "Terjadwal") + " — sudah diumumkan ke grup.", "success");
        document.getElementById("formPsb").reset();
        muatPapan();
    } catch (e) {
        showAlert("❌ " + e.message, "danger");
    } finally {
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Daftarkan &amp; umumkan ke grup';
    }
}

function statusBadge(s) {
    const map = { menunggu: "badge-warning", ditugaskan: "badge-info", terpasang: "badge-success", batal: "badge-secondary" };
    return `<span class="badge ${map[s] || "badge-light"}">${esc(s || "-")}</span>`;
}

let currentUser = null; // {id, role, name} dari /api/me
let teknisiList = [];   // [{id,name}] untuk dropdown TUGASKAN (admin)

function isAdmin() { return currentUser && ["admin", "owner", "superadmin"].includes(String(currentUser.role || "").toLowerCase()); }

function teknisiOptions(selectedId) {
    const opts = ['<option value="">— pilih teknisi —</option>'];
    teknisiList.forEach((t) => {
        const sel = String(t.id) === String(selectedId) ? " selected" : "";
        opts.push(`<option value="${esc(t.id)}"${sel}>${esc(t.name)}</option>`);
    });
    return opts.join("");
}

// Sel Aksi per baris: admin → dropdown teknisi + Tugaskan/Alihkan; teknisi → Ambil (hanya saat menunggu).
function actionCell(r) {
    if (r.status === "terpasang" || r.status === "batal") return '<span class="text-muted">—</span>';
    if (isAdmin()) {
        const label = r.status === "ditugaskan" ? "Alihkan" : "Tugaskan";
        return `<div class="d-flex" style="gap:4px">
            <select class="form-control form-control-sm" style="width:auto" id="tek-${esc(r.id)}">${teknisiOptions(r.assigned_teknisi_id)}</select>
            <button class="btn btn-sm btn-primary" onclick="assignRow(${esc(r.id)})">${label}</button>
        </div>`;
    }
    if (r.status === "menunggu") return `<button class="btn btn-sm btn-success" onclick="claimRow(${esc(r.id)})">Ambil</button>`;
    return '<span class="text-muted">—</span>';
}

function renderList(rows) {
    const tb = document.getElementById("papanBody");
    if (!rows.length) { tb.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Belum ada data</td></tr>'; return; }
    tb.innerHTML = rows.map((r) => `<tr>
        <td><code>${esc(r.ref || r.id)}</code></td>
        <td>${esc(r.name)}</td>
        <td>${esc(r.dusun)}</td>
        <td>${esc(r.paket)}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${r.assigned_teknisi_name ? esc(r.assigned_teknisi_name) : '<span class="text-muted">—</span>'}</td>
        <td>${actionCell(r)}</td>
    </tr>`).join("");
}

async function assignRow(id) {
    const sel = document.getElementById(`tek-${id}`);
    const teknisiId = sel ? sel.value : "";
    if (!teknisiId) return showAlert("Pilih teknisi dulu.", "warning");
    try {
        const r = await fetch(`/api/psb-schedule/${id}/assign`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teknisiId }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.message || "gagal menugaskan");
        showAlert("✅ " + (j.message || "Ditugaskan"), "success");
        muatPapan();
    } catch (e) { showAlert("❌ " + e.message, "danger"); }
}

async function claimRow(id) {
    try {
        const r = await fetch(`/api/psb-schedule/${id}/claim`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.message || "gagal mengambil");
        showAlert("✅ " + (j.message || "Diambil"), "success");
        muatPapan();
    } catch (e) { showAlert("❌ " + e.message, "danger"); }
}

async function muatPapan() {
    try {
        const [sr, lr] = await Promise.all([
            fetch("/api/psb-schedule/summary", { credentials: "include" }).then((r) => r.json()),
            fetch("/api/psb-schedule", { credentials: "include" }).then((r) => r.json())
        ]);
        const s = (sr && sr.data) || {};
        setText("sumBelum", s.belum_kepasang != null ? s.belum_kepasang : 0);
        setText("sumMenunggu", s.menunggu != null ? s.menunggu : 0);
        setText("sumDitugaskan", s.ditugaskan != null ? s.ditugaskan : 0);
        setText("sumTerpasang", s.terpasang_bulan_ini != null ? s.terpasang_bulan_ini : 0);
        renderList((lr && lr.data) || []);
    } catch (_e) {
        document.getElementById("papanBody").innerHTML = '<tr><td colspan="7" class="text-center text-danger">Gagal memuat papan</td></tr>';
    }
}

// Init: kenali peran (Tugaskan vs Ambil) + muat daftar teknisi (admin) SEBELUM render papan.
async function initPapan() {
    try {
        const me = await fetch("/api/me", { credentials: "include" }).then((r) => r.json());
        if (me && me.data) currentUser = me.data;
    } catch (_e) { /* biar default non-admin */ }
    if (isAdmin()) {
        try {
            const t = await fetch("/api/psb-schedule/teknisi", { credentials: "include" }).then((r) => r.json());
            teknisiList = (t && t.data) || [];
        } catch (_e) { teknisiList = []; }
    }
    await muatPapan();
}

document.addEventListener("DOMContentLoaded", initPapan);

// Dipanggil dari onclick di papan-psb.php.
window.muatPapan = muatPapan;
window.ambilLokasi = ambilLokasi;
window.submitPsb = submitPsb;
window.assignRow = assignRow;
window.claimRow = claimRow;
