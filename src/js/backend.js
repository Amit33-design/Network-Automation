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
  function isLiveMode()     { return !!(loadSettings().liveMode && getBackendUrl() && getApiKey()); }

  function configure(backendUrl, apiKey, liveMode) {
    saveSettings({ backendUrl, apiKey, liveMode });
  }

  /* ── HTTP helpers ───────────────────────────────────────────── */
  async function _post(path, body) {
    const url = getBackendUrl().replace(/\/$/, '') + path;
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key':    getApiKey(),
      },
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
    const res = await fetch(url, {
      headers: { 'X-API-Key': getApiKey() },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
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
    return _get('/api/health');
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
  };
})();
