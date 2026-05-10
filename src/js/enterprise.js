'use strict';

/* ═══════════════════════════════════════════════════════════════════
   ENTERPRISE MODULE  — Approvals · Integrations · Exports · Profile
   All API calls proxy through BackendClient helpers (auth + baseURL).
═══════════════════════════════════════════════════════════════════ */

const Enterprise = (() => {

  /* ── API helpers ──────────────────────────────────────────────── */
  function _base() {
    return (typeof BackendClient !== 'undefined' ? BackendClient.getBackendUrl() : '').replace(/\/$/, '');
  }
  function _hdr(json = true) {
    const tok = typeof BackendClient !== 'undefined' ? BackendClient.getToken() : '';
    const h = tok ? { 'Authorization': `Bearer ${tok}` } : {};
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }
  async function _get(path) {
    const r = await fetch(_base() + path, { headers: _hdr(false) });
    if (!r.ok) { const e = await r.json().catch(() => ({ detail: r.statusText })); throw new Error(e.detail || `HTTP ${r.status}`); }
    return r.json();
  }
  async function _post(path, body) {
    const r = await fetch(_base() + path, { method: 'POST', headers: _hdr(), body: JSON.stringify(body) });
    if (!r.ok) { const e = await r.json().catch(() => ({ detail: r.statusText })); throw new Error(e.detail || `HTTP ${r.status}`); }
    return r.json();
  }
  async function _patch(path, body) {
    const r = await fetch(_base() + path, { method: 'PATCH', headers: _hdr(), body: JSON.stringify(body) });
    if (!r.ok) { const e = await r.json().catch(() => ({ detail: r.statusText })); throw new Error(e.detail || `HTTP ${r.status}`); }
    return r.json();
  }
  async function _del(path, body) {
    const opts = { method: 'DELETE', headers: _hdr(!!(body)) };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(_base() + path, opts);
    if (!r.ok && r.status !== 204) { const e = await r.json().catch(() => ({ detail: r.statusText })); throw new Error(e.detail || `HTTP ${r.status}`); }
    return r.status === 204 ? null : r.json();
  }
  async function _download(path, body, filename, mime) {
    const r = await fetch(_base() + path, { method: 'POST', headers: _hdr(), body: JSON.stringify(body) });
    if (!r.ok) { const e = await r.json().catch(() => ({ detail: r.statusText })); throw new Error(e.detail || `HTTP ${r.status}`); }
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  /* ── Toast helper ─────────────────────────────────────────────── */
  function toast(msg, type = 'info', dur = 3500) {
    const t = document.createElement('div');
    t.className = 'ent-toast ent-toast-' + type;
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('ent-toast-show'));
    setTimeout(() => { t.classList.remove('ent-toast-show'); setTimeout(() => t.remove(), 400); }, dur);
  }

  function _modal(id) { return document.getElementById(id); }
  function openModal(id)  { const m = _modal(id); if (m) m.style.display = 'flex'; }
  function closeModal(id) { const m = _modal(id); if (m) m.style.display = 'none'; }

  /* ═══════════════════════════════════════════════════════════════
     1. APPROVALS
  ═══════════════════════════════════════════════════════════════ */

  let _approvals = [];

  function openApprovals() {
    openModal('ent-approvals-modal');
    switchApprovalsTab('pending');
    loadApprovals('pending');
  }
  function closeApprovals() { closeModal('ent-approvals-modal'); }

  function switchApprovalsTab(tab) {
    document.querySelectorAll('#ent-approvals-modal .ent-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.querySelectorAll('#ent-approvals-modal .ent-tab-pane').forEach(p => {
      p.style.display = p.dataset.pane === tab ? 'block' : 'none';
    });
    if (tab === 'pending') loadApprovals('pending');
    if (tab === 'all')     loadApprovals();
  }

  async function loadApprovals(status) {
    const listEl = document.getElementById(status ? 'ent-apr-pending-list' : 'ent-apr-all-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="ent-loading">Loading…</div>';
    try {
      if (!_base()) { listEl.innerHTML = '<div class="ent-empty">Connect backend first (sidebar → Backend)</div>'; return; }
      const path = '/api/approvals' + (status ? `?status=${status}` : '');
      _approvals = await _get(path);
      renderApprovalList(listEl, _approvals);
    } catch(e) { listEl.innerHTML = `<div class="ent-empty" style="color:#f66">${e.message}</div>`; }
  }

  function renderApprovalList(el, list) {
    if (!list.length) { el.innerHTML = '<div class="ent-empty">No approvals found</div>'; return; }
    el.innerHTML = list.map(a => {
      const cls   = { pending:'ent-badge-warn', approved:'ent-badge-ok', rejected:'ent-badge-err', expired:'ent-badge-muted', cancelled:'ent-badge-muted' }[a.status] || 'ent-badge-muted';
      const risk  = a.risk_score >= 80 ? '#f66' : a.risk_score >= 50 ? '#fa0' : '#4c8';
      const since = new Date(a.created_at).toLocaleString();
      const actions = a.status === 'pending' ? `
        <button class="btn-ent btn-ent-ok"  onclick="Enterprise.approve('${a.id}')">✓ Approve</button>
        <button class="btn-ent btn-ent-err" onclick="Enterprise.reject('${a.id}')">✕ Reject</button>
        <button class="btn-ent btn-ent-ghost" onclick="Enterprise.escalate('${a.id}')">↑ Escalate</button>
        <button class="btn-ent btn-ent-ghost" onclick="Enterprise.cancel('${a.id}')">✕ Cancel</button>
      ` : '';
      return `
        <div class="ent-apr-card">
          <div class="ent-apr-card-top">
            <div>
              <span class="ent-badge ${cls}">${a.status.toUpperCase()}</span>
              <span style="font-weight:700;margin-left:.5rem">${a.environment}</span>
              <span style="color:var(--txt3);font-size:.8rem;margin-left:.5rem">#${a.id.slice(0,8)}</span>
            </div>
            <div style="font-size:.8rem;color:var(--txt3)">${since}</div>
          </div>
          <div class="ent-apr-summary">${a.summary || 'No summary provided'}</div>
          <div class="ent-apr-meta">
            <span>Risk: <strong style="color:${risk}">${a.risk_score}/100</strong></span>
            <span>Devices: <strong>${a.device_count}</strong></span>
            <span>By: <strong>${a.requested_by.slice(0,16)}</strong></span>
            ${a.reviewer_note ? `<span>Note: <em>${a.reviewer_note}</em></span>` : ''}
          </div>
          ${actions ? `<div class="ent-apr-actions">${actions}</div>` : ''}
        </div>`;
    }).join('');
  }

  async function submitApproval() {
    const env     = document.getElementById('ent-apr-env').value;
    const summary = document.getElementById('ent-apr-summary').value.trim();
    const risk    = parseInt(document.getElementById('ent-apr-risk').value) || 50;
    const devices = parseInt(document.getElementById('ent-apr-devices').value) || 1;
    const design_id = (typeof STATE !== 'undefined' && STATE.designId) || document.getElementById('ent-apr-design').value.trim();

    if (!design_id) { toast('Enter a Design ID', 'error'); return; }
    if (!summary)   { toast('Enter a summary', 'error'); return; }

    const btn = document.getElementById('ent-apr-submit-btn');
    btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      const res = await _post('/api/approvals', { design_id, environment: env, summary, risk_score: risk, device_count: devices });
      toast(`Approval requested — ID: ${res.id.slice(0,8)}`, 'success');
      document.getElementById('ent-apr-summary').value = '';
      switchApprovalsTab('pending');
    } catch(e) { toast(e.message, 'error', 5000); }
    finally { btn.disabled = false; btn.textContent = 'Submit for Approval'; }
  }

  async function approve(id) {
    const note = prompt('Approval note (optional):') || '';
    try {
      await _post(`/api/approvals/${id}/approve`, { decision: 'approved', note });
      toast('Approved ✓', 'success');
      loadApprovals('pending');
    } catch(e) { toast(e.message, 'error', 5000); }
  }

  async function reject(id) {
    const note = prompt('Rejection reason (required):');
    if (note === null) return;
    try {
      await _post(`/api/approvals/${id}/reject`, { decision: 'rejected', note });
      toast('Rejected', 'info');
      loadApprovals('pending');
    } catch(e) { toast(e.message, 'error', 5000); }
  }

  async function escalate(id) {
    try {
      await _post(`/api/approvals/${id}/escalate`, {});
      toast('Escalated — TTL extended, re-notified', 'info');
      loadApprovals('pending');
    } catch(e) { toast(e.message, 'error', 5000); }
  }

  async function cancel(id) {
    if (!confirm('Cancel this approval request?')) return;
    try {
      await _del(`/api/approvals/${id}`);
      toast('Approval cancelled', 'info');
      loadApprovals('pending');
    } catch(e) { toast(e.message, 'error', 5000); }
  }

  /* ═══════════════════════════════════════════════════════════════
     2. INTEGRATIONS
  ═══════════════════════════════════════════════════════════════ */

  const INTEGRATION_PROVIDERS = ['slack','teams','servicenow','jira','netbox','gitops'];
  let _intConfigs = {};

  function openIntegrations() {
    openModal('ent-int-modal');
    loadIntegrations();
    switchIntTab('slack');
  }
  function closeIntegrations() { closeModal('ent-int-modal'); }

  async function loadIntegrations() {
    try {
      if (!_base()) return;
      const list = await _get('/api/integrations');
      _intConfigs = {};
      list.forEach(c => { _intConfigs[c.provider] = c; });
      INTEGRATION_PROVIDERS.forEach(p => populateIntForm(p));
    } catch(e) { /* silent — backend may not be connected */ }
  }

  function switchIntTab(prov) {
    document.querySelectorAll('#ent-int-modal .ent-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === prov));
    document.querySelectorAll('#ent-int-modal .ent-int-pane').forEach(p =>
      p.style.display = p.dataset.pane === prov ? 'block' : 'none');
  }

  function populateIntForm(prov) {
    const cfg = (_intConfigs[prov] || {}).config || {};
    const en  = (_intConfigs[prov] || {}).enabled !== false;
    const tog = document.getElementById(`ent-int-${prov}-enabled`);
    if (tog) tog.checked = en;
    Object.entries(cfg).forEach(([k, v]) => {
      const el = document.getElementById(`ent-int-${prov}-${k}`);
      if (el) el.value = v;
    });
  }

  function _collectIntForm(prov) {
    const fields = document.querySelectorAll(`#ent-int-pane-${prov} [data-field]`);
    const config = {};
    fields.forEach(f => { if (f.value.trim()) config[f.dataset.field] = f.value.trim(); });
    const enabled = document.getElementById(`ent-int-${prov}-enabled`)?.checked !== false;
    return { provider: prov, enabled, config };
  }

  async function saveIntegration(prov) {
    const body = _collectIntForm(prov);
    const btn  = document.getElementById(`ent-int-${prov}-save`);
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      await _post('/api/integrations', body);
      toast(`${prov} integration saved`, 'success');
      await loadIntegrations();
    } catch(e) { toast(e.message, 'error', 5000); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Save'; } }
  }

  async function testIntegration(prov) {
    const btn = document.getElementById(`ent-int-${prov}-test`);
    if (btn) { btn.disabled = true; btn.textContent = 'Testing…'; }
    try {
      const res = await _post(`/api/integrations/test/${prov}`, {});
      toast(`${prov} test OK ✓  ${res.message || JSON.stringify(res)}`, 'success', 5000);
    } catch(e) { toast(`${prov} test failed: ${e.message}`, 'error', 6000); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Test'; } }
  }

  /* ═══════════════════════════════════════════════════════════════
     3. EXPORTS
  ═══════════════════════════════════════════════════════════════ */

  function _getDesignState() {
    if (typeof STATE === 'undefined') return null;
    return {
      id:       STATE.designId || STATE.id || 'design',
      orgName:  STATE.orgName  || 'network',
      useCase:  STATE.useCase,
      topology: STATE.topology,
      devices:  STATE.devices  || STATE.selectedDevices,
      vlans:    STATE.vlans,
      ipPlan:   STATE.ipPlan,
    };
  }

  function _getIpPlan() {
    return (typeof STATE !== 'undefined') ? STATE.ipPlan || null : null;
  }

  function _getConfigs() {
    if (typeof configOutputs !== 'undefined') return configOutputs;
    const el = document.getElementById('cfg-output');
    if (!el) return {};
    return {};
  }

  async function exportDrawio() {
    if (!_base()) { toast('Connect backend first', 'error'); return; }
    const ds = _getDesignState();
    if (!ds) { toast('Generate a design first (Step 4)', 'error'); return; }
    const btn = document.getElementById('ent-btn-drawio');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Exporting…'; }
    try {
      await _download('/api/export/drawio', { design_state: ds, ip_plan: _getIpPlan() },
        `${(ds.orgName||'network').replace(/\s+/g,'_')}_topology.drawio`, 'application/xml');
      toast('draw.io file downloaded', 'success');
    } catch(e) { toast(`Export failed: ${e.message}`, 'error', 5000); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '📐 draw.io'; } }
  }

  async function exportRunbook(format = 'md') {
    if (!_base()) { toast('Connect backend first', 'error'); return; }
    const ds = _getDesignState();
    if (!ds) { toast('Generate a design first (Step 4)', 'error'); return; }
    const path    = format === 'pdf' ? '/api/export/runbook/pdf' : '/api/export/runbook';
    const ext     = format === 'pdf' ? 'pdf' : 'md';
    const btnId   = format === 'pdf' ? 'ent-btn-runbook-pdf' : 'ent-btn-runbook';
    const btn     = document.getElementById(btnId);
    const origTxt = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }
    try {
      const body = { design_state: ds, configs: _getConfigs(), ip_plan: _getIpPlan() };
      await _download(path, body, `${(ds.orgName||'network').replace(/\s+/g,'_')}_runbook.${ext}`,
        format === 'pdf' ? 'application/pdf' : 'text/markdown');
      toast(`Runbook ${ext.toUpperCase()} downloaded`, 'success');
    } catch(e) { toast(`Export failed: ${e.message}`, 'error', 5000); }
    finally { if (btn) { btn.disabled = false; btn.textContent = origTxt; } }
  }

  async function syncToNetbox() {
    if (!_base()) { toast('Connect backend first', 'error'); return; }
    const ds = _getDesignState();
    const devices = (ds && (ds.devices || []));
    if (!devices.length) { toast('No devices in current design', 'error'); return; }
    try {
      const res = await _post('/api/integrations/netbox/sync-devices', { devices });
      toast(`Netbox sync: ${res.synced} devices synced${res.errors?.length ? `, ${res.errors.length} errors` : ''}`, 'success', 5000);
    } catch(e) { toast(e.message, 'error', 5000); }
  }

  async function commitToGit() {
    if (!_base()) { toast('Connect backend first', 'error'); return; }
    const ds = _getDesignState();
    if (!ds) { toast('Generate a design first', 'error'); return; }
    const message = prompt('Commit message:', `Deploy: ${ds.orgName || 'network'} design`);
    if (!message) return;
    try {
      const res = await _post('/api/integrations/gitops/commit', {
        design_id:   ds.id,
        design_name: (ds.orgName || 'network').replace(/\s+/g, '-'),
        configs:     _getConfigs(),
        message,
      });
      const prMsg = res.pr_url ? ` — PR: ${res.pr_url}` : '';
      toast(`Git commit ${(res.commit_sha||'').slice(0,7)} — ${res.committed?.length || 0} files${prMsg}`, 'success', 8000);
      if (res.pr_url) {
        if (confirm(`GitHub PR created!\n${res.pr_url}\n\nOpen in browser?`)) window.open(res.pr_url, '_blank');
      }
    } catch(e) { toast(e.message, 'error', 5000); }
  }

  /* ═══════════════════════════════════════════════════════════════
     4. PROFILE / MFA / API KEYS
  ═══════════════════════════════════════════════════════════════ */

  let _profile = null;

  async function openProfile() {
    openModal('ent-profile-modal');
    switchProfileTab('profile');
    await loadProfile();
  }
  function closeProfile() { closeModal('ent-profile-modal'); }

  function switchProfileTab(tab) {
    document.querySelectorAll('#ent-profile-modal .ent-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('#ent-profile-modal .ent-prof-pane').forEach(p =>
      p.style.display = p.dataset.pane === tab ? 'block' : 'none');
  }

  async function loadProfile() {
    const infoEl = document.getElementById('ent-prof-info');
    if (!infoEl) return;
    if (!_base()) { infoEl.innerHTML = '<div class="ent-empty">Connect backend to view profile</div>'; return; }
    try {
      _profile = await _get('/api/users/me');
      infoEl.innerHTML = `
        <div class="ent-prof-row"><label>Email</label><span>${_profile.email}</span></div>
        <div class="ent-prof-row"><label>Display Name</label><span id="ent-prof-name-display">${_profile.display_name || '—'}</span></div>
        <div class="ent-prof-row"><label>Role</label><span class="ent-badge ent-badge-ok">${_profile.org_role || '—'}</span></div>
        <div class="ent-prof-row"><label>MFA</label><span class="ent-badge ${_profile.totp_enabled ? 'ent-badge-ok' : 'ent-badge-muted'}">${_profile.totp_enabled ? 'Enabled' : 'Disabled'}</span></div>
        <div class="ent-prof-row"><label>Last Login</label><span>${_profile.last_login_at ? new Date(_profile.last_login_at).toLocaleString() : 'Never'}</span></div>
      `;
      const mfaStatus = document.getElementById('ent-mfa-status');
      if (mfaStatus) mfaStatus.textContent = _profile.totp_enabled ? '✅ TOTP is enabled on your account' : '⬜ TOTP is not enabled';
    } catch(e) {
      infoEl.innerHTML = `<div class="ent-empty" style="color:#f66">${e.message}</div>`;
    }
  }

  async function updateProfile() {
    const name = document.getElementById('ent-prof-name').value.trim();
    const curPw = document.getElementById('ent-prof-cur-pw').value;
    const newPw = document.getElementById('ent-prof-new-pw').value;
    const body  = {};
    if (name)  body.display_name   = name;
    if (newPw) { body.current_password = curPw; body.new_password = newPw; }
    if (!Object.keys(body).length) { toast('Nothing to update', 'info'); return; }
    try {
      await _patch('/api/users/me', body);
      toast('Profile updated', 'success');
      await loadProfile();
      document.getElementById('ent-prof-new-pw').value = '';
      document.getElementById('ent-prof-cur-pw').value = '';
    } catch(e) { toast(e.message, 'error', 5000); }
  }

  async function setupTotp() {
    try {
      const res = await _post('/api/users/me/totp/setup', {});
      document.getElementById('ent-totp-secret').textContent = res.secret;
      document.getElementById('ent-totp-qr-link').href = res.otpauth_url;
      document.getElementById('ent-totp-qr-link').style.display = 'inline-block';
      document.getElementById('ent-totp-setup-box').style.display = 'block';
      toast('Scan the QR code in your authenticator app, then enter the 6-digit code below', 'info', 6000);
    } catch(e) { toast(e.message, 'error', 5000); }
  }

  async function enableTotp() {
    const code = document.getElementById('ent-totp-code').value.trim();
    if (!code) { toast('Enter the 6-digit code from your authenticator', 'error'); return; }
    try {
      await _post('/api/users/me/totp/enable', { code });
      toast('TOTP / MFA enabled ✓', 'success');
      document.getElementById('ent-totp-setup-box').style.display = 'none';
      await loadProfile();
    } catch(e) { toast(e.message, 'error', 5000); }
  }

  async function disableTotp() {
    const pw = prompt('Enter your password to disable MFA:');
    if (!pw) return;
    try {
      await _del('/api/users/me/totp', { password: pw });
      toast('TOTP disabled', 'info');
      await loadProfile();
    } catch(e) { toast(e.message, 'error', 5000); }
  }

  async function generateApiKey() {
    if (!confirm('Generate a new API key? This will invalidate the previous key.')) return;
    try {
      const res = await _post('/api/users/me/api-keys', {});
      const box = document.getElementById('ent-apikey-box');
      const el  = document.getElementById('ent-apikey-value');
      if (box) box.style.display = 'block';
      if (el)  el.textContent = res.api_key;
      toast('API key generated — copy it now, it will not be shown again', 'success', 7000);
    } catch(e) { toast(e.message, 'error', 5000); }
  }

  async function revokeApiKey() {
    if (!confirm('Revoke your API key?')) return;
    try {
      await _del('/api/users/me/api-keys');
      const box = document.getElementById('ent-apikey-box');
      if (box) box.style.display = 'none';
      toast('API key revoked', 'info');
    } catch(e) { toast(e.message, 'error', 5000); }
  }

  function copyApiKey() {
    const val = document.getElementById('ent-apikey-value')?.textContent || '';
    navigator.clipboard.writeText(val).then(() => toast('API key copied', 'success'));
  }

  /* ═══════════════════════════════════════════════════════════════
     5. LOGIN modal
  ═══════════════════════════════════════════════════════════════ */

  function openLogin() {
    openModal('ent-login-modal');
    // Pre-fill URL from BackendClient and update dot
    const urlEl = document.getElementById('ent-login-url');
    if (urlEl) {
      const saved = typeof BackendClient !== 'undefined' ? BackendClient.getBackendUrl() : '';
      urlEl.value = saved || 'http://localhost:8000';
      _updateLoginDot(urlEl.value);
    }
    document.getElementById('ent-login-totp-row').style.display = 'none';
  }
  function closeLogin() { closeModal('ent-login-modal'); }

  function saveLoginUrl(url) {
    if (typeof BackendClient !== 'undefined') {
      const key = BackendClient.getApiKey ? BackendClient.getApiKey() : '';
      BackendClient.configure(url.trim(), key, true);
    }
    _updateLoginDot(url);
  }

  function _updateLoginDot(url) {
    const dot = document.getElementById('ent-login-url-dot');
    if (!dot) return;
    dot.style.background = url && url.startsWith('http') ? '#4c8' : '#f66';
  }

  async function doLogin() {
    const urlEl  = document.getElementById('ent-login-url');
    const rawUrl = (urlEl ? urlEl.value.trim() : '') || _base();
    const user   = document.getElementById('ent-login-user').value.trim();
    const pass   = document.getElementById('ent-login-pass').value;
    const btn    = document.getElementById('ent-login-btn');

    if (!rawUrl) { toast('Enter the backend URL (e.g. http://localhost:8000)', 'error'); return; }
    if (!user)   { toast('Enter your username', 'error'); return; }
    if (!pass)   { toast('Enter your password', 'error'); return; }

    // Persist URL before login attempt
    saveLoginUrl(rawUrl);

    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const endpoint = rawUrl.replace(/\/$/, '') + '/api/auth/token';
      const r = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: user, password: pass }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);

      if (data.mfa_required) {
        document.getElementById('ent-login-totp-row').style.display = 'block';
        toast('MFA required — enter your 6-digit TOTP code', 'info');
        return;
      }
      if (data.access_token && typeof BackendClient !== 'undefined') {
        BackendClient.setToken(data.access_token);
      }
      toast(`Signed in as ${user} (${data.role || 'user'}) ✓`, 'success');
      closeLogin();
      if (typeof updateBackendDot === 'function') updateBackendDot();
    } catch(e) {
      toast(`Login failed: ${e.message}`, 'error', 6000);
    } finally {
      btn.disabled = false; btn.textContent = 'Sign In';
    }
  }

  async function doTotpVerify() {
    const code   = document.getElementById('ent-login-totp').value.trim();
    const urlEl  = document.getElementById('ent-login-url');
    const rawUrl = (urlEl ? urlEl.value.trim() : '') || _base();
    try {
      const r = await fetch(rawUrl.replace(/\/$/, '') + '/api/auth/totp-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ..._hdr(false) },
        body:   JSON.stringify({ code }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
      if (data.access_token && typeof BackendClient !== 'undefined') BackendClient.setToken(data.access_token);
      toast('Signed in with MFA ✓', 'success');
      closeLogin();
    } catch(e) { toast(e.message, 'error', 5000); }
  }

  /* ═══════════════════════════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════════════════════════ */
  return {
    openApprovals, closeApprovals, switchApprovalsTab,
    submitApproval, approve, reject, escalate, cancel,
    openIntegrations, closeIntegrations, switchIntTab,
    saveIntegration, testIntegration,
    exportDrawio, exportRunbook, syncToNetbox, commitToGit,
    openProfile, closeProfile, switchProfileTab,
    updateProfile, setupTotp, enableTotp, disableTotp,
    generateApiKey, revokeApiKey, copyApiKey,
    openLogin, closeLogin, doLogin, doTotpVerify, saveLoginUrl,
  };

})();
