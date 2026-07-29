/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/auto-outage.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/auto-outage.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

    const apiBase = '/api/admin/auto-outage';
    let currentRule = null;

    function asBool(value) { return value === true || value === 'true' || value === '1'; }
    function showResult(value) { document.getElementById('lastResult').textContent = JSON.stringify(value, null, 2); }
    function jsonField(form, name, fallback) {
      const raw = form.elements[name].value.trim();
      if (!raw) return fallback;
      return JSON.parse(raw);
    }
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
    function rulePayload() {
      const form = document.getElementById('ruleForm');
      return {
        id: form.elements.id.value || undefined,
        name: form.elements.name.value,
        enabled: asBool(form.elements.enabled.value),
        router_id: form.elements.router_id.value || 'default',
        offline_threshold_hours: Number(form.elements.offline_threshold_hours.value || 3),
        scan_interval_minutes: Number(form.elements.scan_interval_minutes.value || 30),
        broadcast_cooldown_minutes: Number(form.elements.broadcast_cooldown_minutes.value || 720),
        max_broadcast_per_incident: Number(form.elements.max_broadcast_per_incident.value || 1),
        target_scope: form.elements.target_scope.value,
        target_filter_json: jsonField(form, 'target_filter_json', {}),
        template_initial: form.elements.template_initial.value,
        options_json: jsonField(form, 'options_json', []),
        auto_ticket_enabled: true
      };
    }
    function fillRule(rule) {
      if (!rule) return;
      currentRule = rule;
      const form = document.getElementById('ruleForm');
      form.elements.id.value = rule.id || '';
      form.elements.name.value = rule.name || 'Auto Outage Utama';
      form.elements.enabled.value = rule.enabled ? 'true' : 'false';
      form.elements.router_id.value = rule.router_id || 'default';
      form.elements.offline_threshold_hours.value = Math.max(1, Math.round((rule.offline_threshold_minutes || 180) / 60));
      form.elements.scan_interval_minutes.value = rule.scan_interval_minutes || 30;
      form.elements.broadcast_cooldown_minutes.value = rule.broadcast_cooldown_minutes || 720;
      form.elements.max_broadcast_per_incident.value = rule.max_broadcast_per_incident || 1;
      form.elements.target_scope.value = rule.target_scope || 'all';
      form.elements.target_filter_json.value = JSON.stringify(rule.target_filter_json || {}, null, 2);
      if (rule.template_initial) form.elements.template_initial.value = rule.template_initial;
      form.elements.options_json.value = JSON.stringify(rule.options_json || [], null, 2);
    }
    async function loadRules() {
      const payload = await request('/rules');
      const rules = payload.data.items || [];
      const box = document.getElementById('rulesList');
      box.innerHTML = rules.length ? '' : '<span class="text-muted">Belum ada rule. Simpan rule terlebih dahulu.</span>';
      rules.forEach((rule) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'btn btn-sm btn-outline-primary mr-2 mb-2';
        item.textContent = `${rule.enabled ? 'Aktif' : 'Nonaktif'} - ${rule.name}`;
        item.onclick = () => fillRule(rule);
        box.appendChild(item);
      });
      if (!currentRule && rules[0]) fillRule(rules[0]);
    }
    async function loadStates() {
      const payload = await request('/states?limit=200');
      const items = payload.data.items || [];
      const tbody = document.querySelector('#statesTable tbody');
      tbody.innerHTML = '';
      const counts = items.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {});
      document.getElementById('metricOffline').textContent = counts.offline || 0;
      document.getElementById('metricOnline').textContent = counts.online || 0;
      const escapeHtml = (value) => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      items.forEach((item) => {
        tbody.insertAdjacentHTML('beforeend', `<tr><td><span class="ao-pill">${escapeHtml(item.status || '-')}</span></td><td>${escapeHtml(item.user_id || '-')}</td><td>${escapeHtml(item.pppoe_username || '-')}</td><td>${escapeHtml(item.router_id || '-')}</td><td>${escapeHtml(item.offline_since || '-')}</td><td>${escapeHtml(item.last_logged_out || '-')}</td><td>${item.broadcast_count || 0}</td><td>${escapeHtml(item.last_detection_reason || '-')}</td></tr>`);
      });
    }
    async function loadLogs() {
      const payload = await request('/scan-logs?limit=20');
      const items = payload.data.items || [];
      const tbody = document.querySelector('#logsTable tbody');
      tbody.innerHTML = '';
      const latest = items[0];
      document.getElementById('metricIgnored').textContent = latest?.summary_json?.ignored_active_ppp || 0;
      const escapeHtml = (value) => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      items.forEach((item) => {
        tbody.insertAdjacentHTML('beforeend', `<tr><td>${escapeHtml(item.started_at || '-')}</td><td>${escapeHtml(item.router_id || '-')}</td><td>${item.total_db_users || 0}</td><td>${item.total_active_ppp || 0}</td><td>${item.total_offline_candidates || 0}</td><td>${item.total_skipped || 0}</td><td>${escapeHtml(item.error_message || '-')}</td></tr>`);
      });
    }
    async function refreshAll() { await Promise.all([loadRules(), loadStates(), loadLogs()]); }

    document.getElementById('ruleForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const payload = await request('/rules', { method: 'POST', body: JSON.stringify(rulePayload()) });
        fillRule(payload.data);
        showResult(payload);
        await loadRules();
        Swal.fire('Tersimpan', 'Rule auto outage berhasil disimpan.', 'success');
      } catch (error) { Swal.fire('Gagal', error.message, 'error'); }
    });
    document.getElementById('btnScan').onclick = async () => {
      try {
        const payload = await request('/scan', { method: 'POST', body: JSON.stringify({ router_id: document.querySelector('[name="router_id"]').value || 'default' }) });
        showResult(payload);
        await Promise.all([loadStates(), loadLogs()]);
        Swal.fire('Scan selesai', payload.message, 'success');
      } catch (error) { Swal.fire('Gagal scan', error.message, 'error'); }
    };
    document.getElementById('btnDryRun').onclick = async () => {
      try {
        const payload = await request('/dry-run', { method: 'POST', body: JSON.stringify(rulePayload()) });
        document.getElementById('metricEligible').textContent = payload.data.summary.total_eligible || 0;
        showResult(payload);
      } catch (error) { Swal.fire('Dry-run gagal', error.message, 'error'); }
    };
    document.getElementById('btnBroadcast').onclick = async () => {
      const confirm = await Swal.fire({ title: 'Broadcast pelanggan eligible?', text: 'Pesan akan dikirim hanya ke pelanggan DB yang offline dan lolos rule.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Kirim' });
      if (!confirm.isConfirmed) return;
      try {
        const payload = await request('/broadcast', { method: 'POST', body: JSON.stringify(rulePayload()) });
        showResult(payload);
        await loadStates();
        Swal.fire('Broadcast selesai', `${payload.data.summary.total_sent} pesan diproses.`, 'success');
      } catch (error) { Swal.fire('Broadcast gagal', error.message, 'error'); }
    };
    document.getElementById('btnRefresh').onclick = refreshAll;
    refreshAll().catch((error) => showResult({ error: error.message }));
  
