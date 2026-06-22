<?php
/**
 * Header Doc
 * Purpose: Halaman admin bot Telegram teknisi — status runtime bot, konfigurasi (enable/token/
 *          poll), dan manajemen whitelist chat_id (tambah/hapus/aktif-nonaktif). READ-ONLY bot
 *          (fase 1): teknisi cek redaman/koneksi/modem/olt/pelanggan via Telegram.
 * Caller: `routes/pages.js` pada path `/telegram-teknisi`.
 * Deps: `_head.php`, `_navbar.php`, `topbar.php`, API `/api/admin/telegram-teknisi/*`,
 *       Bootstrap, jQuery, SweetAlert2.
 * MainFuncs: Render kartu status (termasuk banner "token ditolak"/galat poll dari status.terminal
 *            & status.lastError), form config, form tambah + tabel whitelist.
 * SideEffects: Memanggil API admin untuk baca/tulis whitelist & config.
 */
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <?php
    $pageTitle = 'RAF BOT - Bot Teknisi (Telegram)';
    $themeRole = 'admin';
    $pageDescription = 'RAF BOT Telegram Teknisi';
    include __DIR__ . '/_head.php';
    ?>
  <style>
    .tg-card { background:#fff; border:1px solid #e5e7eb; border-radius:14px; box-shadow:0 12px 30px rgba(15,23,42,0.06); }
    .tg-card .card-header { background:transparent; border-bottom:1px solid #e5e7eb; }
    .tg-metric { border-radius:12px; padding:1rem; background:linear-gradient(135deg,#0ea5e9,#0369a1); color:#fff; min-height:92px; }
    .tg-metric.is-danger { background:linear-gradient(135deg,#ef4444,#b91c1c); }
    .tg-metric strong { font-size:1.4rem; display:block; }
    .tg-table { font-size:.86rem; }
    .badge-on { background:#dcfce7; color:#166534; }
    .badge-off { background:#f3f4f6; color:#374151; }
    .badge-pill2 { font-size:.72rem; padding:.3rem .55rem; border-radius:999px; }
  </style>
</head>
<body id="page-top">
  <div id="wrapper">
    <?php include '_navbar.php'; ?>
    <div id="content-wrapper" class="d-flex flex-column">
      <div id="content">
        <?php include 'topbar.php'; ?>
        <div class="container-fluid">
          <div class="dashboard-header">
            <div class="d-flex align-items-center justify-content-between flex-wrap">
              <div>
                <h1><i class="fab fa-telegram-plane"></i> Bot Teknisi (Telegram)</h1>
                <p>Teknisi cek <strong>redaman (modem + OLT)</strong>, koneksi PPPoE, modem, dan status OLT lewat Telegram. Hanya <strong>chat_id</strong> yang di-whitelist di bawah yang bisa memakai bot.</p>
              </div>
              <div class="d-flex flex-wrap" style="gap:.5rem;">
                <button id="btnRefresh" class="btn btn-light"><i class="fas fa-sync"></i> Refresh</button>
              </div>
            </div>
          </div>

          <div class="alert alert-info" role="alert" style="border-radius:12px;">
            <i class="fas fa-info-circle"></i>
            Cara teknisi mendaftar: minta teknisi kirim apa saja ke bot, bot membalas <strong>chat_id</strong>-nya. Masukkan chat_id itu di tabel whitelist. Token bot <strong>WAJIB berbeda</strong> dari bot backup database.
          </div>

          <div class="row mb-2">
            <div class="col-md-3 mb-3"><div class="tg-metric"><span>Status Bot</span><strong id="mStatus">-</strong><small id="mStatusSub">&nbsp;</small></div></div>
            <div class="col-md-3 mb-3"><div class="tg-metric"><span>Token</span><strong id="mToken">-</strong><small>config.telegramTeknisi</small></div></div>
            <div class="col-md-3 mb-3"><div class="tg-metric"><span>Teknisi Terdaftar</span><strong id="mCount">0</strong><small>whitelist chat_id</small></div></div>
            <div class="col-md-3 mb-3"><div class="tg-metric"><span>Poll Terakhir</span><strong id="mPoll" style="font-size:.95rem;">-</strong><small>long-poll getUpdates</small></div></div>
          </div>

          <div id="tgStatusAlert" class="alert" role="alert" style="display:none;border-radius:12px;"></div>

          <div class="tg-card mb-4">
            <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-dark">Konfigurasi Bot</h6></div>
            <div class="card-body">
              <form id="cfgForm">
                <div class="form-row">
                  <div class="form-group col-md-4">
                    <label>Status</label>
                    <select class="form-control" name="enabled"><option value="false">Nonaktif</option><option value="true">Aktif</option></select>
                  </div>
                  <div class="form-group col-md-5">
                    <label>Bot Token <small class="text-muted">(kosongkan = pertahankan token lama)</small></label>
                    <input type="text" class="form-control" name="botToken" placeholder="paste token dari @BotFather" autocomplete="off">
                  </div>
                  <div class="form-group col-md-3">
                    <label>Poll Timeout (detik)</label>
                    <input type="number" min="1" max="300" class="form-control" name="pollTimeoutSec" value="50">
                  </div>
                </div>
                <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Simpan &amp; Restart Bot</button>
                <small class="text-muted ml-2">Menyimpan akan me-restart loop bot agar perubahan token/status langsung berlaku.</small>
              </form>
            </div>
          </div>

          <div class="tg-card mb-4">
            <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-dark">Whitelist Teknisi</h6></div>
            <div class="card-body">
              <form id="addForm" class="form-inline mb-3">
                <input type="text" class="form-control mr-2 mb-2" name="chatId" placeholder="chat_id (mis. 878008307)" required>
                <input type="text" class="form-control mr-2 mb-2" name="name" placeholder="nama teknisi (opsional)">
                <button type="submit" class="btn btn-success mb-2"><i class="fas fa-plus"></i> Tambah</button>
              </form>
              <div class="table-responsive">
                <table class="table table-bordered tg-table" id="waTable">
                  <thead><tr><th>chat_id</th><th>Nama</th><th>Ditambah oleh</th><th>Waktu</th><th>Status</th><th>Aksi</th></tr></thead>
                  <tbody></tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
  <script src="/js/sb-admin-2.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
  <script>
    const apiBase = '/api/admin/telegram-teknisi';
    function asBool(v) { return v === true || v === 'true' || v === '1'; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

    async function request(path, options = {}) {
      const response = await fetch(apiBase + path, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Request gagal');
      return payload;
    }

    function renderStatus(status, config, count) {
      const running = status && status.running;
      const terminal = status && status.terminal;            // token ditolak → loop berhenti permanen
      const lastError = status && status.lastError;
      const statusEl = document.getElementById('mStatus');
      const metricEl = statusEl.closest('.tg-metric');
      statusEl.textContent = terminal ? 'TOKEN DITOLAK' : (running ? 'AKTIF' : 'BERHENTI');
      if (metricEl) metricEl.classList.toggle('is-danger', !!terminal);
      document.getElementById('mStatusSub').textContent = terminal
        ? 'token salah — perbaiki & simpan ulang'
        : ((config && config.enabled) ? 'enabled' : 'disabled di config');
      document.getElementById('mToken').textContent = (config && config.tokenConfigured) ? 'TERPASANG' : 'KOSONG';
      document.getElementById('mCount').textContent = count;
      document.getElementById('mPoll').textContent = (status && status.lastPollAt) ? new Date(status.lastPollAt).toLocaleString('id-ID') : '-';

      // Banner: token ditolak (merah, butuh aksi admin) atau galat poll transient (kuning, retry otomatis).
      const alertEl = document.getElementById('tgStatusAlert');
      if (terminal) {
        alertEl.style.display = '';
        alertEl.className = 'alert alert-danger';
        alertEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> <strong>Token ditolak Telegram</strong> — loop bot dihentikan. Perbaiki <strong>Bot Token</strong> di bawah lalu klik <strong>Simpan &amp; Restart Bot</strong>.'
          + (lastError && lastError.message ? ' <span class="small text-muted">(' + esc(lastError.message) + ')</span>' : '');
      } else if (lastError && lastError.message) {
        const when = lastError.at ? new Date(lastError.at).toLocaleString('id-ID') : '';
        alertEl.style.display = '';
        alertEl.className = 'alert alert-warning';
        alertEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> Galat poll terakhir: <code>' + esc(lastError.message) + '</code>'
          + (when ? ' <span class="small text-muted">@ ' + esc(when) + '</span>' : '') + '. Bot akan mencoba lagi otomatis.';
      } else {
        alertEl.style.display = 'none';
        alertEl.innerHTML = '';
      }

      const f = document.getElementById('cfgForm');
      f.elements.enabled.value = (config && config.enabled) ? 'true' : 'false';
      f.elements.pollTimeoutSec.value = (config && config.pollTimeoutSec) || 50;
    }

    function renderTable(list) {
      const tbody = document.querySelector('#waTable tbody');
      tbody.innerHTML = '';
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Belum ada teknisi terdaftar.</td></tr>';
        return;
      }
      list.forEach((t) => {
        const on = t.enabled !== false;
        const when = t.addedAt ? new Date(t.addedAt).toLocaleString('id-ID') : '-';
        const badge = on ? '<span class="badge-pill2 badge-on">Aktif</span>' : '<span class="badge-pill2 badge-off">Nonaktif</span>';
        tbody.insertAdjacentHTML('beforeend',
          `<tr>`
          + `<td><code>${esc(t.chatId)}</code></td>`
          + `<td>${esc(t.name || '-')}</td>`
          + `<td>${esc(t.addedBy || '-')}</td>`
          + `<td>${esc(when)}</td>`
          + `<td>${badge}</td>`
          + `<td>`
          + `<button class="btn btn-sm btn-outline-secondary mr-1 btn-toggle" data-id="${esc(t.chatId)}" data-on="${on}">${on ? 'Nonaktifkan' : 'Aktifkan'}</button>`
          + `<button class="btn btn-sm btn-outline-danger btn-del" data-id="${esc(t.chatId)}">Hapus</button>`
          + `</td></tr>`);
      });
      tbody.querySelectorAll('.btn-toggle').forEach((b) => b.onclick = () => toggle(b.dataset.id, !asBool(b.dataset.on)));
      tbody.querySelectorAll('.btn-del').forEach((b) => b.onclick = () => remove(b.dataset.id));
    }

    async function loadAll() {
      const payload = await request('/list');
      const d = payload.data || {};
      const list = d.technicians || [];
      renderStatus(d.status, d.config, list.length);
      renderTable(list);
    }

    async function toggle(chatId, enabled) {
      try { await request('/toggle', { method: 'POST', body: JSON.stringify({ chatId, enabled }) }); await loadAll(); }
      catch (e) { Swal.fire('Gagal', e.message, 'error'); }
    }
    async function remove(chatId) {
      const ok = await Swal.fire({ title: 'Hapus teknisi?', text: chatId, icon: 'warning', showCancelButton: true, confirmButtonText: 'Hapus' });
      if (!ok.isConfirmed) return;
      try { await request('/remove', { method: 'POST', body: JSON.stringify({ chatId }) }); await loadAll(); }
      catch (e) { Swal.fire('Gagal', e.message, 'error'); }
    }

    document.getElementById('addForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const chatId = f.elements.chatId.value.trim();
      const name = f.elements.name.value.trim();
      if (!chatId) return;
      try {
        await request('/add', { method: 'POST', body: JSON.stringify({ chatId, name }) });
        f.reset();
        await loadAll();
      } catch (err) { Swal.fire('Gagal', err.message, 'error'); }
    });

    document.getElementById('cfgForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = {
        enabled: asBool(f.elements.enabled.value),
        botToken: f.elements.botToken.value.trim(),
        pollTimeoutSec: Number(f.elements.pollTimeoutSec.value)
      };
      try {
        await request('/config', { method: 'POST', body: JSON.stringify(body) });
        f.elements.botToken.value = '';
        Swal.fire('Tersimpan', 'Konfigurasi bot disimpan & bot di-restart.', 'success');
        await loadAll();
      } catch (err) { Swal.fire('Gagal', err.message, 'error'); }
    });

    document.getElementById('btnRefresh').onclick = () => loadAll().catch((e) => Swal.fire('Gagal', e.message, 'error'));
    loadAll().catch((e) => Swal.fire('Gagal memuat', e.message, 'error'));
    setInterval(() => { loadAll().catch(() => {}); }, 30000);
  </script>
</body>
</html>
