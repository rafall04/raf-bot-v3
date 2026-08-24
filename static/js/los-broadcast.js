/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/los-broadcast.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/los-broadcast.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

    const apiBase = '/api/admin/los-broadcast';
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

    function fillConfig(cfg) {
      const f = document.getElementById('cfgForm');
      f.elements.enabled.value = cfg.enabled ? 'true' : 'false';
      f.elements.confirmationWindowMinutes.value = cfg.confirmationWindowMinutes;
      f.elements.rebroadcastCooldownMinutes.value = cfg.rebroadcastCooldownMinutes;
      f.elements.clusterFlushSeconds.value = cfg.clusterFlushSeconds;
      f.elements.clusterThreshold.value = cfg.clusterThreshold;
      f.elements.notifyGroup.value = cfg.notifyGroup ? 'true' : 'false';
      f.elements.notifyTeknisi.value = (cfg.notifyTeknisi === false) ? 'false' : 'true';
      // Notif PULIH
      f.elements.notifyRecovery.value = cfg.notifyRecovery ? 'true' : 'false';
      f.elements.recoveryConfirmSeconds.value = cfg.recoveryConfirmSeconds != null ? cfg.recoveryConfirmSeconds : 60;
      f.elements.recoveryClusterFlushSeconds.value = cfg.recoveryClusterFlushSeconds != null ? cfg.recoveryClusterFlushSeconds : 20;
      // Auto-tiket
      const at = cfg.autoTicket || {};
      f.elements.autoTicketEnabled.value = at.enabled ? 'true' : 'false';
      f.elements.autoTicketAssignTeknisi.value = at.assignTeknisi || '';
      f.elements.autoTicketPriority.value = (at.priority === 'MEDIUM') ? 'MEDIUM' : 'HIGH';
      // Verifikasi via scrape web OLT
      const vs = cfg.verifyViaScrape || {};
      f.elements.verifyEnabled.value = (vs.enabled === false) ? 'false' : 'true';
      f.elements.verifyMaxPages.value = vs.maxPages != null ? vs.maxPages : 20;
      f.elements.verifyTimeWindowMinutes.value = vs.timeWindowMinutes != null ? vs.timeWindowMinutes : 15;
      setGroupSelect(cfg.groupId || '');
      // Notifikasi pelanggan
      const nc = cfg.notifyCustomer || {};
      const c = document.getElementById('custForm');
      c.elements.notifyCustomerEnabled.value = nc.enabled ? 'true' : 'false';
      c.elements.customerNotifyDelayMinutes.value = nc.delayMinutes != null ? nc.delayMinutes : 60;
      c.elements.customerOnlyIfStillDown.value = (nc.onlyIfStillDown === false) ? 'false' : 'true';
      c.elements.customerMessageTemplate.value = nc.messageTemplate || '';
      if (c.elements.customerPenangananTemplate) c.elements.customerPenangananTemplate.value = nc.penangananTemplate || '';
      if (c.elements.customerPenangananLuarJamTemplate) c.elements.customerPenangananLuarJamTemplate.value = nc.penangananLuarJamTemplate || '';
    }
    // Endpoint /config mengganti SELURUH config, jadi payload selalu gabungan kedua form.
    function configPayload() {
      const f = document.getElementById('cfgForm');
      const c = document.getElementById('custForm');
      return {
        enabled: asBool(f.elements.enabled.value),
        confirmationWindowMinutes: Number(f.elements.confirmationWindowMinutes.value),
        rebroadcastCooldownMinutes: Number(f.elements.rebroadcastCooldownMinutes.value),
        clusterFlushSeconds: Number(f.elements.clusterFlushSeconds.value),
        clusterThreshold: Number(f.elements.clusterThreshold.value),
        notifyGroup: asBool(f.elements.notifyGroup.value),
        groupId: f.elements.groupId.value,
        notifyTeknisi: asBool(f.elements.notifyTeknisi.value),
        notifyRecovery: asBool(f.elements.notifyRecovery.value),
        recoveryConfirmSeconds: Number(f.elements.recoveryConfirmSeconds.value),
        recoveryClusterFlushSeconds: Number(f.elements.recoveryClusterFlushSeconds.value),
        autoTicketEnabled: asBool(f.elements.autoTicketEnabled.value),
        autoTicketAssignTeknisi: f.elements.autoTicketAssignTeknisi.value,
        autoTicketPriority: f.elements.autoTicketPriority.value,
        verifyEnabled: asBool(f.elements.verifyEnabled.value),
        verifyMaxPages: Number(f.elements.verifyMaxPages.value),
        verifyTimeWindowMinutes: Number(f.elements.verifyTimeWindowMinutes.value),
        notifyCustomerEnabled: asBool(c.elements.notifyCustomerEnabled.value),
        customerNotifyDelayMinutes: Number(c.elements.customerNotifyDelayMinutes.value),
        customerOnlyIfStillDown: asBool(c.elements.customerOnlyIfStillDown.value),
        customerPenangananTemplate: c.elements.customerPenangananTemplate ? c.elements.customerPenangananTemplate.value : undefined,
        customerPenangananLuarJamTemplate: c.elements.customerPenangananLuarJamTemplate ? c.elements.customerPenangananLuarJamTemplate.value : undefined,
        customerMessageTemplate: c.elements.customerMessageTemplate.value
      };
    }

    async function loadConfig() {
      const payload = await request('/config');
      fillConfig(payload.data);
    }
    async function loadState() {
      const payload = await request('/state');
      const s = payload.data || {};
      document.getElementById('statePendingCount').textContent = s.pendingCount || 0;
      document.getElementById('metricPending').textContent = s.pendingCount || 0;
      document.getElementById('statePendingMacs').textContent = (s.pendingMacs && s.pendingMacs.length) ? s.pendingMacs.join('\n') : '-';
      const ac = document.getElementById('stateActiveCount');
      if (ac) ac.textContent = s.activeIncidentCount || 0;
    }
    async function loadIncidents() {
      const status = document.getElementById('statusFilter').value;
      const payload = await request('/incidents?limit=200' + (status ? '&status=' + encodeURIComponent(status) : ''));
      const items = payload.data.items || [];
      const tbody = document.querySelector('#incidentsTable tbody');
      tbody.innerHTML = '';
      const dayAgo = Date.now() - 24 * 3600 * 1000;
      let bc = 0, rec = 0;
      items.forEach((it) => {
        const t = it.detectedAt ? new Date(it.detectedAt) : null;
        if (it.status === 'broadcasted' && t && t.getTime() >= dayAgo) bc++;
        if (it.status === 'recovered_before_broadcast') rec++;
        const cust = it.customer ? (it.customer.name || '-') + (it.customer.address ? ' — ' + it.customer.address : '') : '-';
        const slotOnu = (it.slot != null || it.onu != null) ? esc(it.slot) + '/' + esc(it.onu) : '-';
        const delivered = (it.deliveredCount != null && it.recipientsCount != null) ? (it.deliveredCount + '/' + it.recipientsCount) : '-';
        const cnotif = it.customerNotifyStatus || '-';
        tbody.insertAdjacentHTML('beforeend',
          `<tr><td>${esc(it.detectedAt)}</td>`
          + `<td><span class="badge-status st-${esc(it.status)}">${esc(it.status)}</span></td>`
          + `<td>${esc(it.mac)}</td><td>${slotOnu}</td><td>${esc(it.oltId)}</td>`
          + `<td>${esc(cust)}</td><td>${it.confidence != null ? esc(it.confidence) : '-'}</td>`
          + `<td>${it.areaOutage ? 'Ya' : '-'}</td><td>${esc(delivered)}</td><td>${esc(cnotif)}</td></tr>`);
      });
      document.getElementById('metricBroadcasted').textContent = bc;
      document.getElementById('metricRecovered').textContent = rec;
    }
    async function refreshAll() {
      await Promise.all([loadConfig(), loadState(), loadIncidents()]);
    }

    async function saveConfig(successMsg) {
      try {
        await request('/config', { method: 'POST', body: JSON.stringify(configPayload()) });
        Swal.fire('Tersimpan', successMsg, 'success');
        await loadConfig();
      } catch (err) { Swal.fire('Gagal', err.message, 'error'); }
    }
    async function loadGroups() {
      const sel = document.getElementById('groupIdSelect');
      const cur = sel.value;
      const btn = document.getElementById('btnLoadGroups');
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memuat…';
      try {
        const res = await fetch('/api/whatsapp/groups', { credentials: 'include' });
        const json = await res.json();
        if (!json.success || !Array.isArray(json.groups)) throw new Error(json.message || 'Bot WhatsApp belum terkoneksi.');
        sel.innerHTML = '<option value="">— pilih grup —</option>';
        json.groups.forEach((g) => {
          const opt = document.createElement('option');
          opt.value = g.id; opt.textContent = g.subject + (g.size != null ? ' (' + g.size + ' anggota)' : '');
          sel.appendChild(opt);
        });
        if (cur && Array.prototype.some.call(sel.options, (o) => o.value === cur)) sel.value = cur;
        Swal.fire({ icon: 'success', title: 'Grup dimuat', text: json.groups.length + ' grup ditemukan.', timer: 1500, showConfirmButton: false });
      } catch (e) {
        Swal.fire('Gagal memuat grup', e.message, 'error');
      } finally {
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync"></i> Muat Grup';
      }
    }
    function setGroupSelect(groupId) {
      const sel = document.getElementById('groupIdSelect');
      if (!sel) return;
      if (groupId && !Array.prototype.some.call(sel.options, (o) => o.value === groupId)) {
        const opt = document.createElement('option');
        opt.value = groupId; opt.textContent = groupId + ' (tersimpan)';
        sel.appendChild(opt);
      }
      sel.value = groupId || '';
    }
    document.getElementById('btnLoadGroups').addEventListener('click', loadGroups);
    document.getElementById('cfgForm').addEventListener('submit', (e) => {
      e.preventDefault();
      saveConfig('Konfigurasi LOS broadcast berhasil disimpan.');
    });
    document.getElementById('custForm').addEventListener('submit', (e) => {
      e.preventDefault();
      saveConfig('Konfigurasi notifikasi pelanggan berhasil disimpan.');
    });
    document.getElementById('btnRefresh').onclick = () => refreshAll().catch((e) => Swal.fire('Gagal', e.message, 'error'));
    document.getElementById('statusFilter').onchange = () => loadIncidents().catch(() => {});
    refreshAll().catch((e) => Swal.fire('Gagal memuat', e.message, 'error'));
    setInterval(() => { loadState().catch(() => {}); loadIncidents().catch(() => {}); }, 30000);
  
