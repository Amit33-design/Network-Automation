'use strict';

/* ════════════════════════════════════════════════════════════════
   ZTP — Zero Touch Provisioning Manager
   Manages device onboarding via the NetDesign AI ZTP server.

   Workflow:
     1. User enters device serials + metadata in the ZTP panel
     2. Pre-register sends POST /ztp/register for each device
     3. Status board polls GET /ztp/status every 10s while panel open
     4. Devices boot → fetch /ztp/bootstrap/{serial} from DHCP redirect
     5. Devices check in → status updates to PROVISIONED

   Integration:
     - ZTP panel appears in Step 6 sidebar (deployment tab)
     - Uses BackendClient.getBackendUrl() for server URL
     - Works without backend (simulation mode shows mock states)
════════════════════════════════════════════════════════════════ */

const ZTP = (() => {

  /* ── State ──────────────────────────────────────────────────── */
  let _devices = [];      // local registry mirror
  let _pollTimer = null;
  let _pollingActive = false;

  const STATE_ICONS = {
    waiting:      '⏳',
    contacted:    '📡',
    provisioning: '⚙️',
    provisioned:  '✅',
    failed:       '❌',
    unknown:      '❓',
  };

  const STATE_LABELS = {
    waiting:      'Waiting',
    contacted:    'Contacted',
    provisioning: 'Applying Config',
    provisioned:  'Provisioned',
    failed:       'Failed',
    unknown:      'Unknown',
  };

  /* ── Helpers ────────────────────────────────────────────────── */
  function _apiBase() {
    if (typeof BackendClient !== 'undefined' && BackendClient.getBackendUrl()) {
      return BackendClient.getBackendUrl().replace(/\/$/, '');
    }
    return '';
  }

  function _liveMode() {
    return typeof BackendClient !== 'undefined' && BackendClient.isLiveMode();
  }

  async function _apiFetch(method, path, body) {
    const base = _apiBase();
    if (!base) throw new Error('No backend URL configured');
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': typeof BackendClient !== 'undefined' ? BackendClient.getApiKey() : '',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(base + path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }

  /* ── Device rows builder ─────────────────────────────────────── */
  function _buildDeviceRow(dev, index) {
    const icon  = STATE_ICONS[dev.state] || '⏳';
    const label = STATE_LABELS[dev.state] || dev.state;
    const cls   = `ztp-state-${dev.state}`;
    const ptime = dev.provisioned_at
      ? new Date(dev.provisioned_at * 1000).toLocaleTimeString()
      : '—';
    const bakeBadge = dev.bake_policies
      ? '<span class="ztp-bake-badge" title="Full production config on first boot">⚙️ Full</span>'
      : '<span class="ztp-bake-badge ztp-bake-day0" title="Minimal Day 0 only">🌱 Day0</span>';
    return `
      <tr class="ztp-device-row ${cls}" data-serial="${dev.serial}">
        <td class="ztp-icon">${icon}</td>
        <td><code>${dev.serial}</code></td>
        <td>${dev.hostname}</td>
        <td><span class="ztp-platform-badge ${dev.platform}">${dev.platform}</span></td>
        <td>${dev.role}</td>
        <td>${dev.mgmt_ip}</td>
        <td>${bakeBadge}</td>
        <td><span class="ztp-state-pill ${cls}">${label}</span></td>
        <td>${ptime}</td>
        <td>
          <button class="ztp-btn-sm" onclick="ZTP.resetDevice('${dev.serial}')">↺</button>
          <button class="ztp-btn-sm ztp-btn-danger" onclick="ZTP.deleteDevice('${dev.serial}')">✕</button>
        </td>
      </tr>`;
  }

  /* ── Stats bar ───────────────────────────────────────────────── */
  function _renderStats(stats) {
    const total = Object.values(stats).reduce((a, b) => a + b, 0);
    const provisioned = stats.provisioned || 0;
    const failed = stats.failed || 0;
    const pending = total - provisioned - failed;
    const pct = total ? Math.round(provisioned / total * 100) : 0;

    const el = document.getElementById('ztp-stats');
    if (!el) return;
    el.innerHTML = `
      <div class="ztp-stat">
        <span class="ztp-stat-num">${total}</span>
        <span class="ztp-stat-label">Total</span>
      </div>
      <div class="ztp-stat ztp-ok">
        <span class="ztp-stat-num">${provisioned}</span>
        <span class="ztp-stat-label">Provisioned</span>
      </div>
      <div class="ztp-stat ztp-warn">
        <span class="ztp-stat-num">${pending}</span>
        <span class="ztp-stat-label">Pending</span>
      </div>
      <div class="ztp-stat ztp-err">
        <span class="ztp-stat-num">${failed}</span>
        <span class="ztp-stat-label">Failed</span>
      </div>
      <div class="ztp-progress-wrap">
        <div class="ztp-progress-bar" style="width:${pct}%"></div>
        <span class="ztp-progress-label">${pct}% provisioned</span>
      </div>`;
  }

  /* ── Render full board ───────────────────────────────────────── */
  function renderBoard(data) {
    _devices = data.devices || [];
    _renderStats(data.stats || {});

    const tbody = document.getElementById('ztp-device-tbody');
    if (!tbody) return;

    if (_devices.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="ztp-empty">
        No devices registered yet. Add devices below or import from CSV.
      </td></tr>`;
      return;
    }

    tbody.innerHTML = _devices
      .sort((a, b) => {
        const order = { failed:0, provisioning:1, contacted:2, waiting:3, provisioned:4 };
        return (order[a.state] || 5) - (order[b.state] || 5);
      })
      .map((d, i) => _buildDeviceRow(d, i))
      .join('');
  }

  /* ── Simulation fallback ─────────────────────────────────────── */
  function _simulatePoll() {
    // Advance some devices through ZTP stages for demo
    _devices = _devices.map(d => {
      const transitions = {
        waiting: 'contacted',
        contacted: 'provisioning',
        provisioning: 'provisioned',
      };
      if (Math.random() < 0.3 && transitions[d.state]) {
        return { ...d, state: transitions[d.state] };
      }
      return d;
    });
    const stats = { waiting:0, contacted:0, provisioning:0, provisioned:0, failed:0 };
    _devices.forEach(d => { stats[d.state] = (stats[d.state] || 0) + 1; });
    renderBoard({ devices: _devices, stats });
  }

  /* ── Polling ─────────────────────────────────────────────────── */
  async function _poll() {
    if (!_pollingActive) return;
    try {
      if (_liveMode()) {
        const data = await _apiFetch('GET', '/ztp/status');
        renderBoard(data);
      } else {
        _simulatePoll();
      }
    } catch (e) {
      console.warn('ZTP poll error:', e.message);
    }
    _pollTimer = setTimeout(_poll, 10000);
  }

  function startPolling() {
    _pollingActive = true;
    clearTimeout(_pollTimer);
    _poll();
  }

  function stopPolling() {
    _pollingActive = false;
    clearTimeout(_pollTimer);
  }

  /* ── Register single device ──────────────────────────────────── */
  async function registerDevice(deviceData) {
    if (_liveMode()) {
      return _apiFetch('POST', '/ztp/register', deviceData);
    }
    // Simulation: add locally
    const dev = {
      ...deviceData,
      state: 'waiting',
      registered_at: Date.now() / 1000,
      contacted_at: null,
      provisioned_at: null,
      error: null,
    };
    _devices.push(dev);
    const stats = {};
    _devices.forEach(d => { stats[d.state] = (stats[d.state] || 0) + 1; });
    renderBoard({ devices: _devices, stats });
    return dev;
  }

  /* ── Bulk register from form ─────────────────────────────────── */
  async function registerFromForm() {
    const rows = document.querySelectorAll('#ztp-register-rows .ztp-reg-row');
    if (!rows.length) {
      showZTPStatus('Add at least one device below', 'warn');
      return;
    }

    const devices = [];
    let valid = true;
    rows.forEach(row => {
      const serial   = row.querySelector('.zrr-serial')?.value.trim();
      const hostname = row.querySelector('.zrr-hostname')?.value.trim();
      const platform = row.querySelector('.zrr-platform')?.value;
      const role     = row.querySelector('.zrr-role')?.value;
      const mgmt_ip  = row.querySelector('.zrr-mgmt')?.value.trim();
      const mgmt_gw  = row.querySelector('.zrr-gw')?.value.trim();
      const loopback = row.querySelector('.zrr-loopback')?.value.trim();
      const bgp_asn      = parseInt(row.querySelector('.zrr-asn')?.value || '65000');
      const bake_policies= row.querySelector('.zrr-bake')?.checked ?? false;

      if (!serial || !hostname || !mgmt_ip) {
        row.classList.add('ztp-row-error');
        valid = false;
        return;
      }
      row.classList.remove('ztp-row-error');
      devices.push({ serial, hostname, platform, role, mgmt_ip, mgmt_gw,
                     loopback_ip: loopback, bgp_asn, bake_policies });
    });

    if (!valid) {
      showZTPStatus('Fill required fields: Serial, Hostname, Mgmt IP', 'error');
      return;
    }

    showZTPStatus(`Registering ${devices.length} device(s)…`, 'info');

    try {
      if (_liveMode()) {
        const res = await _apiFetch('POST', '/ztp/register/bulk', { devices });
        showZTPStatus(`✅ Registered ${res.registered} devices`, 'ok');
      } else {
        for (const d of devices) await registerDevice(d);
        showZTPStatus(`✅ Registered ${devices.length} devices (simulation)`, 'ok');
      }
      // Clear form rows
      document.getElementById('ztp-register-rows').innerHTML = '';
      addDeviceRow();
      startPolling();
    } catch (e) {
      showZTPStatus(`❌ ${e.message}`, 'error');
    }
  }

  /* ── Import CSV ──────────────────────────────────────────────── */
  function importCSV(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const lines = e.target.result.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      const header = lines.shift().toLowerCase().split(',').map(h => h.trim());
      const devices = lines.map(line => {
        const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const obj = {};
        header.forEach((h, i) => { obj[h] = vals[i] || ''; });
        return {
          serial:      obj.serial || obj['serial number'] || '',
          hostname:    obj.hostname || '',
          platform:    obj.platform || 'ios-xe',
          role:        obj.role || 'campus-access',
          mgmt_ip:     obj.mgmt_ip || obj['management ip'] || '',
          mgmt_gw:     obj.mgmt_gw || obj.gateway || '',
          loopback_ip: obj.loopback_ip || '',
          bgp_asn:     parseInt(obj.bgp_asn || obj.asn || '65000'),
        };
      }).filter(d => d.serial && d.mgmt_ip);

      if (!devices.length) {
        showZTPStatus('CSV has no valid rows (need serial, mgmt_ip)', 'error');
        return;
      }

      try {
        if (_liveMode()) {
          const res = await _apiFetch('POST', '/ztp/register/bulk', { devices });
          showZTPStatus(`✅ Imported ${res.registered} devices from CSV`, 'ok');
        } else {
          for (const d of devices) await registerDevice(d);
          showZTPStatus(`✅ Imported ${devices.length} devices (simulation)`, 'ok');
        }
        startPolling();
      } catch (err) {
        showZTPStatus(`❌ Import failed: ${err.message}`, 'error');
      }
    };
    reader.readAsText(file);
  }

  /* ── Reset / Delete ──────────────────────────────────────────── */
  async function resetDevice(serial) {
    try {
      if (_liveMode()) {
        await _apiFetch('POST', `/ztp/device/${serial}/reset`);
      } else {
        const dev = _devices.find(d => d.serial === serial);
        if (dev) { dev.state = 'waiting'; dev.contacted_at = null; dev.provisioned_at = null; }
      }
      await _poll();
    } catch (e) {
      showZTPStatus(`Reset failed: ${e.message}`, 'error');
    }
  }

  async function deleteDevice(serial) {
    try {
      if (_liveMode()) {
        await _apiFetch('DELETE', `/ztp/device/${serial}`);
      } else {
        _devices = _devices.filter(d => d.serial !== serial);
      }
      await _poll();
    } catch (e) {
      showZTPStatus(`Delete failed: ${e.message}`, 'error');
    }
  }

  /* ── DHCP Options dialog ─────────────────────────────────────── */
  async function showDHCPOptions() {
    const modal = document.getElementById('ztp-dhcp-modal');
    if (!modal) return;

    let content = '';
    if (_liveMode()) {
      try {
        const data = await _apiFetch('GET', '/ztp/dhcp-options');
        const iscDhcp = data.isc_dhcp;
        content = `
          <h4>ISC-DHCP / Kea Configuration</h4>
          <p>Add these options to your DHCP server to enable ZTP auto-provisioning:</p>
          <div class="ztp-dhcp-block">
            <label>NX-OS POAP (option 67)</label>
            <pre>${iscDhcp?.option_43_nxos_poap || ''}</pre>
          </div>
          <div class="ztp-dhcp-block">
            <label>Arista EOS ZTP (option 67)</label>
            <pre>${iscDhcp?.option_67_eos_ztp || ''}</pre>
          </div>
          <div class="ztp-dhcp-block">
            <label>IOS-XE PnP (option 43)</label>
            <pre>${iscDhcp?.option_43_iosxe_pnp || ''}</pre>
          </div>
          <div class="ztp-dhcp-block">
            <label>Junos ZTP (option 67)</label>
            <pre>${iscDhcp?.option_67_junos_ztp || ''}</pre>
          </div>`;
      } catch (e) {
        content = `<p class="error">Could not fetch DHCP options: ${e.message}</p>`;
      }
    } else {
      const base = _apiBase() || 'http://your-ztp-server:8000';
      content = `
        <h4>DHCP Server Configuration</h4>
        <p>Add these options to your ISC-DHCP or Kea server:</p>
        <div class="ztp-dhcp-block">
          <label>NX-OS POAP (option 67)</label>
          <pre>option bootfile-name "http://${base.split('//')[1] || base}/ztp/script/nxos";</pre>
        </div>
        <div class="ztp-dhcp-block">
          <label>Arista EOS ZTP (option 67)</label>
          <pre>option bootfile-name "http://${base.split('//')[1] || base}/ztp/script/eos";</pre>
        </div>
        <div class="ztp-dhcp-block">
          <label>IOS-XE PnP (option 43)</label>
          <pre>option 43 ascii "5A;K4;B2;I${base.split('//')[1] || base};J80";</pre>
        </div>
        <div class="ztp-dhcp-block">
          <label>Junos ZTP (option 67)</label>
          <pre>option bootfile-name "http://${base.split('//')[1] || base}/ztp/script/junos";</pre>
        </div>`;
    }

    document.getElementById('ztp-dhcp-content').innerHTML = content;
    modal.style.display = 'flex';
  }

  function closeDHCPModal() {
    const modal = document.getElementById('ztp-dhcp-modal');
    if (modal) modal.style.display = 'none';
  }

  /* ── Status bar ──────────────────────────────────────────────── */
  function showZTPStatus(msg, type = 'info') {
    const el = document.getElementById('ztp-status-msg');
    if (!el) return;
    const icons = { info: 'ℹ️', ok: '✅', warn: '⚠️', error: '❌' };
    el.className = `ztp-status-msg ztp-status-${type}`;
    el.innerHTML = `${icons[type] || ''} ${msg}`;
    el.style.display = 'block';
    if (type !== 'error') setTimeout(() => { el.style.display = 'none'; }, 4000);
  }

  /* ── Add device row to registration form ─────────────────────── */
  function addDeviceRow(prefill = {}) {
    const container = document.getElementById('ztp-register-rows');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'ztp-reg-row';
    row.innerHTML = `
      <input class="zrr-serial"   type="text"   placeholder="Serial / S/N *" value="${prefill.serial || ''}" />
      <input class="zrr-hostname" type="text"   placeholder="Hostname *"     value="${prefill.hostname || ''}" />
      <select class="zrr-platform">
        <option value="ios-xe" ${prefill.platform==='ios-xe'?'selected':''}>IOS-XE</option>
        <option value="nxos"   ${prefill.platform==='nxos'?'selected':''}>NX-OS</option>
        <option value="eos"    ${prefill.platform==='eos'?'selected':''}>EOS</option>
        <option value="junos"  ${prefill.platform==='junos'?'selected':''}>Junos</option>
        <option value="sonic"  ${prefill.platform==='sonic'?'selected':''}>SONiC</option>
      </select>
      <select class="zrr-role">
        <option value="campus-access"  >Campus Access</option>
        <option value="campus-dist"    >Campus Dist</option>
        <option value="campus-core"    >Campus Core</option>
        <option value="dc-leaf"        >DC Leaf</option>
        <option value="dc-spine"       >DC Spine</option>
        <option value="gpu-spine"      >GPU Spine</option>
        <option value="gpu-tor"        >GPU ToR</option>
        <option value="fw"             >Firewall</option>
      </select>
      <input class="zrr-mgmt"     type="text"   placeholder="Mgmt IP *"      value="${prefill.mgmt_ip || ''}" />
      <input class="zrr-gw"       type="text"   placeholder="Gateway"         value="${prefill.mgmt_gw || ''}" />
      <input class="zrr-loopback" type="text"   placeholder="Loopback IP"     value="${prefill.loopback_ip || ''}" />
      <input class="zrr-asn"      type="number" placeholder="BGP ASN"         value="${prefill.bgp_asn || 65000}" min="1" max="4294967295" />
      <label class="zrr-bake-label" title="Bake all policies into ZTP bootstrap (full production config on first boot)">
        <input class="zrr-bake" type="checkbox" ${prefill.bake_policies ? 'checked' : ''} />
        <span class="zrr-bake-txt">Bake</span>
      </label>
      <button class="ztp-btn-sm ztp-btn-danger" onclick="this.closest('.ztp-reg-row').remove()">✕</button>`;
    container.appendChild(row);
  }

  /* ── Auto-populate from topology ────────────────────────────── */
  function populateFromTopology() {
    if (typeof buildDeviceList !== 'function') return;
    const devs = buildDeviceList();
    const container = document.getElementById('ztp-register-rows');
    if (!container) return;
    container.innerHTML = '';
    devs.forEach((d, i) => {
      addDeviceRow({
        serial:      `SN-${d.id.toUpperCase()}-001`,
        hostname:    d.name || d.id.toUpperCase(),
        platform:    _guessPlatform(d.layer),
        role:        d.layer,
        mgmt_ip:     `10.100.${i + 1}.1`,
        mgmt_gw:     '10.100.0.1',
        loopback_ip: `10.0.${i}.${i}`,
        bgp_asn:     65000 + i,
      });
    });
    showZTPStatus(`Populated ${devs.length} devices from topology`, 'ok');
  }

  function _guessPlatform(layer) {
    if (!layer) return 'ios-xe';
    if (layer.includes('gpu-spine')) return 'eos';
    if (layer.includes('gpu-tor'))   return 'sonic';
    if (layer.includes('dc'))        return 'nxos';
    if (layer.includes('juniper'))   return 'junos';
    return 'ios-xe';
  }

  /* ── Panel init ──────────────────────────────────────────────── */
  function initZTPPanel() {
    addDeviceRow();
    // If backend is live, fetch existing devices immediately
    if (_liveMode()) {
      _apiFetch('GET', '/ztp/status')
        .then(data => renderBoard(data))
        .catch(() => {});
    }
  }

  /* ── Public API ──────────────────────────────────────────────── */
  return {
    initPanel:           initZTPPanel,
    startPolling,
    stopPolling,
    renderBoard,
    registerDevice,
    registerFromForm,
    importCSV,
    resetDevice,
    deleteDevice,
    showDHCPOptions,
    closeDHCPModal,
    addDeviceRow,
    populateFromTopology,
    showZTPStatus,
  };

})();
