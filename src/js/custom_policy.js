'use strict';

/* ════════════════════════════════════════════════════════════════
   CUSTOM POLICY MODULE
   Handles the "Custom Policy" section in the NetDesign AI app.

   API surface:
     POST /api/custom-policy/generate  — render configs
     POST /api/custom-policy/validate  — validate + warnings
     GET  /api/custom-policy/schema    — JSON schema

   UI entry point:
     CustomPolicy.init()         called by init.js after DOM ready
     CustomPolicy.open()         called by the nav button
════════════════════════════════════════════════════════════════ */

const CustomPolicy = (() => {

  /* ── Internal state ──────────────────────────────────────────── */
  let _vlans       = [];   // [{ id, name, description }]
  let _peerGroups  = [];   // [{ name, remote_as, update_source, peer_ips }]
  let _prefixLists = [];   // [{ name, action, prefixes }]
  let _interfaces  = [];   // [{ name, ip_address, description, vlan_id }]

  /* ── Helpers ─────────────────────────────────────────────────── */

  function _backendUrl() {
    // Reuse BackendClient settings if available, else fall back to relative
    if (typeof BackendClient !== 'undefined' && BackendClient.getBackendUrl) {
      return (BackendClient.getBackendUrl() || '').replace(/\/$/, '');
    }
    return '';
  }

  function _authHeader() {
    if (typeof BackendClient !== 'undefined' && BackendClient._authHeader) {
      return BackendClient._authHeader();
    }
    return {};
  }

  async function _post(path, body) {
    const base = _backendUrl();
    const url  = base ? base + path : path;
    const res  = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._authHeader() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }

  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _toast(msg, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
    } else {
      console.log('[CustomPolicy]', msg);
    }
  }

  /* ── VLAN rows ───────────────────────────────────────────────── */

  function _renderVlans() {
    const container = document.getElementById('cp-vlan-rows');
    if (!container) return;
    container.innerHTML = _vlans.map((v, i) => `
      <div class="cp-row" data-idx="${i}">
        <input class="cp-input cp-vlan-id"   type="number" min="1" max="4094"
          placeholder="VLAN ID" value="${_esc(v.id)}"
          oninput="CustomPolicy._updateVlan(${i},'id',+this.value)">
        <input class="cp-input cp-vlan-name" type="text"
          placeholder="Name" value="${_esc(v.name)}"
          oninput="CustomPolicy._updateVlan(${i},'name',this.value)">
        <input class="cp-input cp-vlan-desc" type="text"
          placeholder="Description (optional)" value="${_esc(v.description||'')}"
          oninput="CustomPolicy._updateVlan(${i},'description',this.value)">
        <button class="cp-rm-btn" onclick="CustomPolicy._removeVlan(${i})" title="Remove">✕</button>
      </div>
    `).join('');
  }

  function _addVlan() {
    _vlans.push({ id: '', name: '', description: '' });
    _renderVlans();
    // Focus the new ID input
    const rows = document.querySelectorAll('#cp-vlan-rows .cp-vlan-id');
    if (rows.length) rows[rows.length - 1].focus();
  }

  function _removeVlan(i) {
    _vlans.splice(i, 1);
    _renderVlans();
  }

  function _updateVlan(i, key, val) {
    if (_vlans[i]) _vlans[i][key] = val;
  }

  /* ── Peer group rows ─────────────────────────────────────────── */

  function _renderPeerGroups() {
    const container = document.getElementById('cp-pg-rows');
    if (!container) return;
    container.innerHTML = _peerGroups.map((pg, i) => `
      <div class="cp-card" data-idx="${i}">
        <div class="cp-card-header">
          <span>Peer Group ${i + 1}</span>
          <button class="cp-rm-btn" onclick="CustomPolicy._removePeerGroup(${i})" title="Remove">✕</button>
        </div>
        <div class="cp-row">
          <input class="cp-input" type="text" placeholder="Group name"
            value="${_esc(pg.name)}"
            oninput="CustomPolicy._updatePG(${i},'name',this.value)">
          <input class="cp-input" type="number" placeholder="Remote AS"
            value="${_esc(pg.remote_as)}"
            oninput="CustomPolicy._updatePG(${i},'remote_as',+this.value)">
          <input class="cp-input" type="text" placeholder="Update source (e.g. Loopback0)"
            value="${_esc(pg.update_source)}"
            oninput="CustomPolicy._updatePG(${i},'update_source',this.value)">
        </div>
        <div style="margin-top:.5rem">
          <label class="cp-label">Peer IPs (one per line)</label>
          <textarea class="cp-textarea" rows="3"
            placeholder="10.0.0.1&#10;10.0.0.2"
            oninput="CustomPolicy._updatePG(${i},'peer_ips_raw',this.value)"
          >${_esc((pg.peer_ips || []).join('\n'))}</textarea>
        </div>
      </div>
    `).join('');
  }

  function _addPeerGroup() {
    _peerGroups.push({ name: '', remote_as: '', update_source: 'Loopback0', peer_ips: [] });
    _renderPeerGroups();
  }

  function _removePeerGroup(i) {
    _peerGroups.splice(i, 1);
    _renderPeerGroups();
  }

  function _updatePG(i, key, val) {
    if (!_peerGroups[i]) return;
    if (key === 'peer_ips_raw') {
      _peerGroups[i].peer_ips = val.split('\n').map(s => s.trim()).filter(Boolean);
    } else {
      _peerGroups[i][key] = val;
    }
  }

  /* ── Prefix list rows ────────────────────────────────────────── */

  function _renderPrefixLists() {
    const container = document.getElementById('cp-pl-rows');
    if (!container) return;
    container.innerHTML = _prefixLists.map((pl, i) => `
      <div class="cp-card" data-idx="${i}">
        <div class="cp-card-header">
          <span>Prefix List ${i + 1}</span>
          <button class="cp-rm-btn" onclick="CustomPolicy._removePL(${i})" title="Remove">✕</button>
        </div>
        <div class="cp-row">
          <input class="cp-input" type="text" placeholder="List name"
            value="${_esc(pl.name)}"
            oninput="CustomPolicy._updatePL(${i},'name',this.value)">
          <select class="cp-select"
            onchange="CustomPolicy._updatePL(${i},'action',this.value)">
            <option value="permit" ${pl.action==='permit'?'selected':''}>permit</option>
            <option value="deny"   ${pl.action==='deny'  ?'selected':''}>deny</option>
          </select>
        </div>
        <div style="margin-top:.5rem">
          <label class="cp-label">Prefixes (one per line, e.g. 10.0.0.0/8)</label>
          <textarea class="cp-textarea" rows="3"
            placeholder="10.0.0.0/8&#10;192.168.0.0/16"
            oninput="CustomPolicy._updatePL(${i},'prefixes_raw',this.value)"
          >${_esc((pl.prefixes || []).join('\n'))}</textarea>
        </div>
      </div>
    `).join('');
  }

  function _addPrefixList() {
    _prefixLists.push({ name: '', action: 'permit', prefixes: [] });
    _renderPrefixLists();
  }

  function _removePL(i) {
    _prefixLists.splice(i, 1);
    _renderPrefixLists();
  }

  function _updatePL(i, key, val) {
    if (!_prefixLists[i]) return;
    if (key === 'prefixes_raw') {
      _prefixLists[i].prefixes = val.split('\n').map(s => s.trim()).filter(Boolean);
    } else {
      _prefixLists[i][key] = val;
    }
  }

  /* ── Interface rows ──────────────────────────────────────────── */

  function _renderInterfaces() {
    const container = document.getElementById('cp-iface-rows');
    if (!container) return;
    container.innerHTML = _interfaces.map((iface, i) => `
      <div class="cp-row" data-idx="${i}">
        <input class="cp-input" type="text" placeholder="Interface (e.g. Gi0/0)"
          value="${_esc(iface.name)}"
          oninput="CustomPolicy._updateIface(${i},'name',this.value)">
        <input class="cp-input" type="text" placeholder="IP/prefix (e.g. 10.0.0.1/24)"
          value="${_esc(iface.ip_address)}"
          oninput="CustomPolicy._updateIface(${i},'ip_address',this.value)">
        <input class="cp-input" type="text" placeholder="Description"
          value="${_esc(iface.description||'')}"
          oninput="CustomPolicy._updateIface(${i},'description',this.value)">
        <input class="cp-input cp-vlan-id" type="number" min="1" max="4094"
          placeholder="VLAN (opt)" value="${_esc(iface.vlan_id||'')}"
          oninput="CustomPolicy._updateIface(${i},'vlan_id',this.value?+this.value:null)">
        <button class="cp-rm-btn" onclick="CustomPolicy._removeIface(${i})" title="Remove">✕</button>
      </div>
    `).join('');
  }

  function _addInterface() {
    _interfaces.push({ name: '', ip_address: '', description: '', vlan_id: null });
    _renderInterfaces();
  }

  function _removeIface(i) {
    _interfaces.splice(i, 1);
    _renderInterfaces();
  }

  function _updateIface(i, key, val) {
    if (_interfaces[i]) _interfaces[i][key] = val;
  }

  /* ── Build payload ───────────────────────────────────────────── */

  function _buildPayload() {
    const name        = (document.getElementById('cp-policy-name')?.value || '').trim();
    const device_type = document.getElementById('cp-device-type')?.value || 'cisco_ios';
    const bgp_asn     = document.getElementById('cp-bgp-asn')?.value;
    const bgp_rid     = (document.getElementById('cp-bgp-rid')?.value || '').trim();
    const ntp_raw     = (document.getElementById('cp-ntp')?.value || '').trim();
    const dns_raw     = (document.getElementById('cp-dns')?.value || '').trim();
    const banner      = (document.getElementById('cp-banner')?.value || '').trim();

    const ntp_servers = ntp_raw ? ntp_raw.split('\n').map(s => s.trim()).filter(Boolean) : [];
    const dns_servers = dns_raw ? dns_raw.split('\n').map(s => s.trim()).filter(Boolean) : [];

    const vlans = _vlans
      .filter(v => v.id && v.name)
      .map(v => ({ id: +v.id, name: v.name, description: v.description || undefined }));

    const peer_groups = _peerGroups
      .filter(pg => pg.name && pg.remote_as)
      .map(pg => ({
        name:          pg.name,
        remote_as:     +pg.remote_as,
        update_source: pg.update_source || 'Loopback0',
        peer_ips:      pg.peer_ips || [],
      }));

    const bgp = (bgp_asn && bgp_rid)
      ? { asn: +bgp_asn, router_id: bgp_rid, peer_groups }
      : null;

    const prefix_lists = _prefixLists
      .filter(pl => pl.name && pl.prefixes.length)
      .map(pl => ({ name: pl.name, action: pl.action, prefixes: pl.prefixes }));

    const interfaces = _interfaces
      .filter(iface => iface.name && iface.ip_address)
      .map(iface => ({
        name:        iface.name,
        ip_address:  iface.ip_address,
        description: iface.description || '',
        vlan_id:     iface.vlan_id || undefined,
      }));

    return {
      name,
      device_type,
      vlans,
      bgp,
      prefix_lists,
      interfaces,
      ntp_servers,
      dns_servers,
      banner: banner || undefined,
    };
  }

  /* ── Generate ────────────────────────────────────────────────── */

  async function generate() {
    const payload = _buildPayload();

    if (!payload.name) {
      _toast('Please enter a policy name', 'error');
      document.getElementById('cp-policy-name')?.focus();
      return;
    }

    const btn = document.getElementById('cp-generate-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }

    const out = document.getElementById('cp-output');
    if (out) out.innerHTML = '<div class="cp-spinner">⏳ Generating config…</div>';

    try {
      const data = await _post('/api/custom-policy/generate', payload);
      _renderOutput(data.configs);
    } catch (err) {
      _toast('Generation failed: ' + err.message, 'error');
      if (out) out.innerHTML = `<div class="cp-error">Error: ${_esc(err.message)}</div>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⚙️ Generate Config'; }
    }
  }

  /* ── Validate ────────────────────────────────────────────────── */

  async function validate() {
    const payload = _buildPayload();
    const warningsEl = document.getElementById('cp-warnings');
    if (!warningsEl) return;

    try {
      const data = await _post('/api/custom-policy/validate', payload);
      let html = '';
      if (data.errors.length) {
        html += data.errors.map(e => `<div class="cp-msg cp-msg-error">❌ ${_esc(e)}</div>`).join('');
      }
      if (data.warnings.length) {
        html += data.warnings.map(w => `<div class="cp-msg cp-msg-warn">⚠️ ${_esc(w)}</div>`).join('');
      }
      if (!data.errors.length && !data.warnings.length) {
        html = '<div class="cp-msg cp-msg-ok">✅ No issues found</div>';
      }
      warningsEl.innerHTML = html;
      warningsEl.style.display = 'block';
    } catch (err) {
      warningsEl.innerHTML = `<div class="cp-msg cp-msg-error">Validation request failed: ${_esc(err.message)}</div>`;
      warningsEl.style.display = 'block';
    }
  }

  /* ── Render output ───────────────────────────────────────────── */

  function _renderOutput(configs) {
    const out = document.getElementById('cp-output');
    if (!out) return;

    if (!configs || !Object.keys(configs).length) {
      out.innerHTML = '<div class="cp-error">No config was generated</div>';
      return;
    }

    const html = Object.entries(configs).map(([device, text]) => `
      <div class="cp-config-block">
        <div class="cp-config-header">
          <span class="cp-config-device">📄 ${_esc(device)}</span>
          <button class="btn btn-ghost" style="font-size:.75rem;padding:.25rem .6rem"
            onclick="CustomPolicy._copyConfig(${JSON.stringify(text)}, this)">
            📋 Copy
          </button>
        </div>
        <pre class="cp-pre"><code>${_esc(text)}</code></pre>
      </div>
    `).join('');

    out.innerHTML = html;
    out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function _copyConfig(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent;
      btn.textContent = '✅ Copied!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    }).catch(() => {
      _toast('Clipboard access denied', 'error');
    });
  }

  /* ── Public API ──────────────────────────────────────────────── */

  return {
    // lifecycle
    init,
    // exposed for inline event handlers
    _addVlan,      _removeVlan,      _updateVlan,
    _addPeerGroup, _removePeerGroup, _updatePG,
    _addPrefixList,_removePL,        _updatePL,
    _addInterface, _removeIface,     _updateIface,
    _copyConfig,
    generate,
    validate,
  };

  function init() {
    // Nothing to pre-fetch; schema is loaded on demand if needed
    _renderVlans();
    _renderPeerGroups();
    _renderPrefixLists();
    _renderInterfaces();
  }

})();

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => CustomPolicy.init());
} else {
  CustomPolicy.init();
}
