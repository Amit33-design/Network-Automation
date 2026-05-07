'use strict';

/* ════════════════════════════════════════════════════════════════
   BACKEND CLIENT
   Handles all communication with the NetDesign AI Python backend.
   When STATE.liveMode is false (or no backendUrl set), all
   deploy functions fall through to the existing simulation code.

   Protocol:
     REST  POST /api/*          — all deploy operations
     WS    /ws/terminal/{sid}   — real-time log streaming
════════════════════════════════════════════════════════════════ */

const BackendClient = (() => {

  /* ── Settings (persisted in localStorage) ──────────────────── */
  const STORAGE_KEY = 'nd_backend_settings';

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveSettings(obj) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  }

  function getBackendUrl()  { return loadSettings().backendUrl || ''; }
  function getApiKey()      { return loadSettings().apiKey     || ''; }
  function getToken()       { return loadSettings().token      || getApiKey(); }
  function isLiveMode()     { return !!(loadSettings().liveMode && getBackendUrl()); }

  function configure(backendUrl, apiKey, liveMode) {
    saveSettings({ backendUrl, apiKey, liveMode });
  }

  /** Store a JWT obtained from POST /api/auth/token */
  function setToken(jwt) {
    const s = loadSettings();
    s.token = jwt;
    saveSettings(s);
  }

  /** Exchange username+password for a JWT, store it, return token */
  async function login(username, password) {
    const url = getBackendUrl().replace(/\/$/, '') + '/api/auth/token';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `Login failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data.access_token) setToken(data.access_token);
    return data;
  }

  /* ── HTTP helpers ───────────────────────────────────────────── */
  function _authHeader() {
    const tok = getToken();
    // Support legacy X-API-Key as fallback; prefer Bearer
    return tok ? { 'Authorization': `Bearer ${tok}` } : {};
  }

  async function _post(path, body) {
    const url = getBackendUrl().replace(/\/$/, '') + path;
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ..._authHeader() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function _put(path, body) {
    const url = getBackendUrl().replace(/\/$/, '') + path;
    const res = await fetch(url, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json', ..._authHeader() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function _get(path) {
    const url = getBackendUrl().replace(/\/$/, '') + path;
    const res = await fetch(url, { headers: _authHeader() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function _delete(path) {
    const url = getBackendUrl().replace(/\/$/, '') + path;
    const res = await fetch(url, { method: 'DELETE', headers: _authHeader() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
  }

  /* ── Payload builders ───────────────────────────────────────── */
  function buildDeployPayload(sessionId) {
    return {
      session_id: sessionId,
      intent:     typeof buildIntentObject === 'function' ? buildIntentObject() : {},
      devices:    _getDeviceInventory(),
    };
  }

  function _getDeviceInventory() {
    // Read devices from the backend settings inventory panel
    const rows = document.querySelectorAll('#backend-device-rows .backend-device-row');
    if (rows.length === 0) return [];
    return [...rows].map(row => ({
      id:           row.dataset.devId,
      name:         row.querySelector('.bdr-name')?.value || row.dataset.devId,
      hostname:     row.querySelector('.bdr-host')?.value || '',
      platform:     row.querySelector('.bdr-platform')?.value || 'ios-xe',
      role:         row.dataset.role || '',
      username:     row.querySelector('.bdr-user')?.value || 'admin',
      password:     row.querySelector('.bdr-pass')?.value || '',
      enable_secret:row.querySelector('.bdr-enable')?.value || '',
      port:         parseInt(row.querySelector('.bdr-port')?.value || '22'),
    })).filter(d => d.hostname);
  }

  /* ── Session ────────────────────────────────────────────────── */
  let _sessionId = null;

  async function createSession() {
    const intent  = typeof buildIntentObject === 'function' ? buildIntentObject() : {};
    const devices = _getDeviceInventory();
    if (!devices.length) throw new Error('No devices configured in backend settings');

    const r = await _post('/api/session/create', { intent, devices });
    _sessionId = r.session_id;
    return r;
  }

  function getSessionId() { return _sessionId; }

  /* ── WebSocket terminal ─────────────────────────────────────── */
  let _ws = null;

  function connectTerminal(sessionId, onEvent) {
    const baseUrl = getBackendUrl().replace(/^http/, 'ws').replace(/\/$/, '');
    const wsUrl   = `${baseUrl}/ws/terminal/${sessionId}`;
    _ws = new WebSocket(wsUrl);

    _ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        // Route to existing termLog() system
        if (typeof termLog === 'function') {
          const cls = event.level === 'success' ? 't-ok'
                    : event.level === 'error'   ? 't-err'
                    : event.level === 'warn'     ? 't-warn'
                    : 't-dim';
          termLog(`[${event.stage || 'backend'}] ${event.msg}`, cls);
        }
        if (onEvent) onEvent(event);
      } catch (_) {}
    };

    _ws.onerror = () => {
      if (typeof termLog === 'function')
        termLog('WebSocket connection error — check backend URL', 't-err');
    };

    _ws.onclose = () => {
      if (typeof termLog === 'function')
        termLog('Terminal stream disconnected', 't-dim');
    };

    return _ws;
  }

  function disconnectTerminal() {
    if (_ws) { _ws.close(); _ws = null; }
  }

  /* ── API call wrappers ──────────────────────────────────────── */

  async function health() {
    return _get('/health');
  }

  /* ── Design persistence ─────────────────────────────────────── */

  /**
   * Persist the current STATE to the backend.
   * Returns {id, name} on success; throws on failure.
   */
  async function saveDesign(stateSnap, name, useCase) {
    if (!isLiveMode()) throw new Error('Backend not configured');
    return _post('/api/designs', { name, use_case: useCase, state: stateSnap });
  }

  /**
   * Update an existing design by ID (partial update).
   * fields: any subset of {name, state, ip_plan, vlan_plan, bgp_design}
   */
  async function updateDesign(designId, fields) {
    if (!isLiveMode()) throw new Error('Backend not configured');
    return _put(`/api/designs/${designId}`, fields);
  }

  /** Fetch full design state by ID. */
  async function fetchDesign(designId) {
    return _get(`/api/designs/${designId}/state`);
  }

  /** List designs for the current user. */
  async function listDesigns(useCase) {
    const qs = useCase ? `?use_case=${encodeURIComponent(useCase)}` : '';
    return _get(`/api/designs${qs}`);
  }

  /** Soft-delete a design. */
  async function deleteDesign(designId) {
    return _delete(`/api/designs/${designId}`);
  }

  /** List deployments for a design. */
  async function listDeployments(designId) {
    const qs = designId ? `?design_id=${encodeURIComponent(designId)}` : '';
    return _get(`/api/deployments${qs}`);
  }

  /** Trigger a rollback for a deployment. */
  async function rollbackDeployment(deploymentId) {
    return _post(`/api/deployments/${deploymentId}/rollback`, {});
  }

  async function generateConfig() {
    if (!_sessionId) await createSession();
    return _post('/api/config/generate', buildDeployPayload(_sessionId));
  }

  async function runPrecheck() {
    if (!_sessionId) await createSession();
    connectTerminal(_sessionId);
    return _post('/api/precheck', buildDeployPayload(_sessionId));
  }

  async function backup() {
    if (!_sessionId) throw new Error('No session — run pre-checks first');
    return _post('/api/backup', buildDeployPayload(_sessionId));
  }

  async function deployFull() {
    if (!_sessionId) throw new Error('No session — run pre-checks first');
    return _post('/api/deploy/full', buildDeployPayload(_sessionId));
  }

  async function deployDelta() {
    if (!_sessionId) throw new Error('No session — run pre-checks first');
    return _post('/api/deploy/delta', buildDeployPayload(_sessionId));
  }

  async function runPostcheck() {
    if (!_sessionId) throw new Error('No session — run deploy first');
    return _post('/api/postcheck', buildDeployPayload(_sessionId));
  }

  async function rollback(scope, deviceIds = []) {
    if (!_sessionId) throw new Error('No session');
    return _post(`/api/rollback/${scope}`, {
      session_id: _sessionId,
      scope,
      device_ids: deviceIds,
    });
  }

  /* ── Result → UI mappers ────────────────────────────────────── */

  /**
   * Map a CheckSuiteResult (from /api/precheck or /api/postcheck)
   * to the existing check-grid DOM format.
   */
  function renderCheckResults(results, gridId) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.innerHTML = results.map(r => {
      const icons = { pass:'✅', fail:'❌', warn:'⚠️', skip:'⏭️', pending:'⏳' };
      const cls   = r.status === 'pending' ? '' : r.status;
      return `<div class="check-card ${cls}">
        <div class="check-icon">${icons[r.status] || '⏳'}</div>
        <div class="check-info">
          <div class="ck-name">${r.name}</div>
          <div class="ck-detail">${r.detail}</div>
          ${r.value ? `<div class="ck-val">${r.value}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  /**
   * Map DeployResult device list to existing device-status-table rows.
   */
  function applyDeployResult(deployResult) {
    if (typeof setDeviceStatus !== 'function') return;
    for (const dev of deployResult.devices) {
      const action = dev.status === 'success'
        ? `✓ ${dev.lines_pushed} lines pushed`
        : dev.status === 'skipped' ? 'Skipped (no config)'
        : `✗ ${dev.error?.slice(0, 60) || 'failed'}`;
      setDeviceStatus(dev.device_id, dev.status === 'success' ? 'done' : 'failed', action);
    }
  }

  /* ── Public surface ─────────────────────────────────────────── */
  return {
    isLiveMode,
    configure,
    getBackendUrl,
    getApiKey,
    getToken,
    setToken,
    login,
    getSessionId,
    health,
    createSession,
    connectTerminal,
    disconnectTerminal,
    generateConfig,
    runPrecheck,
    backup,
    deployFull,
    deployDelta,
    runPostcheck,
    rollback,
    renderCheckResults,
    applyDeployResult,
    // Design persistence (Phase 2)
    saveDesign,
    updateDesign,
    fetchDesign,
    listDesigns,
    deleteDesign,
    listDeployments,
    rollbackDeployment,
  };
})();
