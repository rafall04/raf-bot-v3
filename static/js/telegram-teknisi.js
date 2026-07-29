/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/telegram-teknisi.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/telegram-teknisi.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

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
  
