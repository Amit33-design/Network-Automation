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

  // QoS / PFC (AI fabric) — NX-OS, EOS, Cumulus, SONiC
  let _qosEnabled  = false;

  // Palo Alto security model
  let _secZones    = [];   // [{ name, type, interfaces }]
  let _secRules    = [];   // [{ name, from, to, app, service, action, log }]
  let _natRules    = [];   // [{ name, from, to, src_addr, dst_addr, nat_type, translated_addr }]

  // Fortinet firewall model
  let _fwPolicies  = [];   // [{ name, srcintf, dstintf, srcaddr, dstaddr, service, action, nat }]
  let _vipObjects  = [];   // [{ name, extip, mappedip, extintf, extport, mappedport }]

  /* ── Platform visibility ─────────────────────────────────────── */

  const _QOS_PLATFORMS  = new Set(['cisco_nxos','arista_eos','nvidia_cumulus','sonic']);
  const _SECPOL_PLATFORM = 'palo_alto';
  const _FWPOL_PLATFORM  = 'fortinet';

  function _onPlatformChange() {
    const p = document.getElementById('cp-device-type')?.value || '';
    const qos  = document.getElementById('cp-qos-section');
    const sec  = document.getElementById('cp-secpol-section');
    const fw   = document.getElementById('cp-fwpol-section');
    if (qos) qos.style.display = _QOS_PLATFORMS.has(p) ? '' : 'none';
    if (sec) sec.style.display = p === _SECPOL_PLATFORM  ? '' : 'none';
    if (fw)  fw.style.display  = p === _FWPOL_PLATFORM   ? '' : 'none';
    // hide QoS fields if checkbox was unchecked
    if (!_QOS_PLATFORMS.has(p)) {
      const f = document.getElementById('cp-qos-fields');
      if (f) f.style.display = 'none';
      const cb = document.getElementById('cp-qos-enable');
      if (cb) cb.checked = false;
      _qosEnabled = false;
    }
  }

  /* ── QoS helpers ─────────────────────────────────────────────── */

  function _onQosToggle() {
    _qosEnabled = !!document.getElementById('cp-qos-enable')?.checked;
    const f = document.getElementById('cp-qos-fields');
    if (f) f.style.display = _qosEnabled ? 'flex' : 'none';
  }

  function _applyQosPreset(type) {
    const cb = document.getElementById('cp-qos-enable');
    if (cb && !cb.checked) { cb.checked = true; _onQosToggle(); }

    if (type === 'rdma') {
      _setVal('cp-pfc-prios',  '3,4');
      _setVal('cp-dscp-map',   '26:4  (RoCEv2/RDMA — lossless)\n46:5  (EF/Voice — low latency)\n34:4  (AF41 — storage)\n0:0   (Best effort)');
      _setVal('cp-ecn-min',    '150');
      _setVal('cp-ecn-max',    '1500');
      _setVal('cp-buf-pool',   '16384');
      _setVal('cp-qos-mtu',    '9216');
      _setVal('cp-q-weights',  '5,5,5,15,50,15,5,0');
      const ecn = document.getElementById('cp-ecn-enable');
      if (ecn) ecn.checked = true;
    } else if (type === 'storage') {
      _setVal('cp-pfc-prios',  '3');
      _setVal('cp-dscp-map',   '34:3  (AF41 — NVMe-oF/iSCSI lossless)\n26:3  (RoCEv2 mapped to storage class)\n0:0   (Best effort)');
      _setVal('cp-ecn-min',    '300');
      _setVal('cp-ecn-max',    '3000');
      _setVal('cp-buf-pool',   '32768');
      _setVal('cp-qos-mtu',    '9216');
      _setVal('cp-q-weights',  '5,5,5,60,20,5,5,0');
      const ecn = document.getElementById('cp-ecn-enable');
      if (ecn) ecn.checked = true;
    }
  }

  function _setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  function _getQosCfg() {
    if (!_qosEnabled) return null;
    const pfcRaw = (document.getElementById('cp-pfc-prios')?.value || '3,4').trim();
    const pfc_priorities = pfcRaw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    const dscpRaw = (document.getElementById('cp-dscp-map')?.value || '').trim();
    const dscp_map = dscpRaw.split('\n').map(l => {
      const m = l.match(/^(\d+)\s*:\s*(\d+)/);
      return m ? { dscp: +m[1], tc: +m[2] } : null;
    }).filter(Boolean);
    const ecn_enabled = !!document.getElementById('cp-ecn-enable')?.checked;
    const weightsRaw = (document.getElementById('cp-q-weights')?.value || '').trim();
    const queue_weights = weightsRaw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    return {
      pfc_priorities,
      dscp_map,
      ecn: {
        enabled:       ecn_enabled,
        min_threshold: +(document.getElementById('cp-ecn-min')?.value || 150),
        max_threshold: +(document.getElementById('cp-ecn-max')?.value || 1500),
      },
      buffer_pool:   +(document.getElementById('cp-buf-pool')?.value || 16384),
      mtu:           +(document.getElementById('cp-qos-mtu')?.value  || 9216),
      scheduler:     document.getElementById('cp-sched-type')?.value || 'dwrr',
      queue_weights,
    };
  }

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

  /* ── Security Zones (Palo Alto) ─────────────────────────────── */

  function _renderZones() {
    const c = document.getElementById('cp-zone-rows');
    if (!c) return;
    c.innerHTML = _secZones.map((z, i) => `
      <div class="cp-row" data-idx="${i}">
        <input class="cp-input" type="text" placeholder="Zone name (e.g. trust)"
          value="${_esc(z.name)}" oninput="CustomPolicy._updateZone(${i},'name',this.value)" style="flex:1">
        <select class="cp-select" onchange="CustomPolicy._updateZone(${i},'type',this.value)" style="width:130px">
          <option value="layer3"       ${z.type==='layer3'      ?'selected':''}>layer3</option>
          <option value="tap"          ${z.type==='tap'         ?'selected':''}>tap</option>
          <option value="virtual-wire" ${z.type==='virtual-wire'?'selected':''}>virtual-wire</option>
          <option value="external"     ${z.type==='external'    ?'selected':''}>external</option>
        </select>
        <input class="cp-input" type="text" placeholder="Interfaces (e.g. ethernet1/1,ethernet1/2)"
          value="${_esc(z.interfaces)}" oninput="CustomPolicy._updateZone(${i},'interfaces',this.value)" style="flex:2">
        <button class="cp-rm-btn" onclick="CustomPolicy._removeZone(${i})">✕</button>
      </div>`).join('');
  }
  function _addZone()            { _secZones.push({ name:'', type:'layer3', interfaces:'' }); _renderZones(); }
  function _removeZone(i)        { _secZones.splice(i,1); _renderZones(); }
  function _updateZone(i,k,v)    { if (_secZones[i]) _secZones[i][k]=v; }

  /* ── Security Rules (Palo Alto) ──────────────────────────────── */

  function _renderSecRules() {
    const c = document.getElementById('cp-secrule-rows');
    if (!c) return;
    c.innerHTML = _secRules.map((r, i) => `
      <div class="cp-card" data-idx="${i}">
        <div class="cp-card-header">
          <span>Rule ${i+1}: ${_esc(r.name||'unnamed')}</span>
          <button class="cp-rm-btn" onclick="CustomPolicy._removeSecRule(${i})">✕</button>
        </div>
        <div class="cp-row" style="flex-wrap:wrap;gap:.4rem">
          <input class="cp-input" type="text" placeholder="Rule name"
            value="${_esc(r.name)}" oninput="CustomPolicy._updateSecRule(${i},'name',this.value)" style="flex:2;min-width:140px">
          <input class="cp-input" type="text" placeholder="From zone"
            value="${_esc(r.from)}" oninput="CustomPolicy._updateSecRule(${i},'from',this.value)" style="flex:1;min-width:90px">
          <input class="cp-input" type="text" placeholder="To zone"
            value="${_esc(r.to)}" oninput="CustomPolicy._updateSecRule(${i},'to',this.value)" style="flex:1;min-width:90px">
          <input class="cp-input" type="text" placeholder="Application (any)"
            value="${_esc(r.app)}" oninput="CustomPolicy._updateSecRule(${i},'app',this.value)" style="flex:1;min-width:100px">
          <input class="cp-input" type="text" placeholder="Service (application-default)"
            value="${_esc(r.service)}" oninput="CustomPolicy._updateSecRule(${i},'service',this.value)" style="flex:1;min-width:120px">
          <select class="cp-select" onchange="CustomPolicy._updateSecRule(${i},'action',this.value)" style="width:100px">
            <option value="allow" ${r.action==='allow'?'selected':''}>allow</option>
            <option value="deny"  ${r.action==='deny' ?'selected':''}>deny</option>
            <option value="drop"  ${r.action==='drop' ?'selected':''}>drop</option>
          </select>
          <label style="font-size:.78rem;display:flex;align-items:center;gap:.3rem">
            <input type="checkbox" ${r.log?'checked':''} onchange="CustomPolicy._updateSecRule(${i},'log',this.checked)"> Log
          </label>
        </div>
      </div>`).join('');
  }
  function _addSecRule()          { _secRules.push({ name:'', from:'any', to:'any', app:'any', service:'application-default', action:'allow', log:true }); _renderSecRules(); }
  function _removeSecRule(i)      { _secRules.splice(i,1); _renderSecRules(); }
  function _updateSecRule(i,k,v)  { if (_secRules[i]) _secRules[i][k]=v; }

  /* ── NAT Rules (Palo Alto) ───────────────────────────────────── */

  function _renderNatRules() {
    const c = document.getElementById('cp-natrule-rows');
    if (!c) return;
    c.innerHTML = _natRules.map((r, i) => `
      <div class="cp-card" data-idx="${i}">
        <div class="cp-card-header">
          <span>NAT ${i+1}: ${_esc(r.name||'unnamed')}</span>
          <button class="cp-rm-btn" onclick="CustomPolicy._removeNatRule(${i})">✕</button>
        </div>
        <div class="cp-row" style="flex-wrap:wrap;gap:.4rem">
          <input class="cp-input" type="text" placeholder="Rule name"
            value="${_esc(r.name)}" oninput="CustomPolicy._updateNatRule(${i},'name',this.value)" style="flex:2;min-width:130px">
          <input class="cp-input" type="text" placeholder="From zone"
            value="${_esc(r.from)}" oninput="CustomPolicy._updateNatRule(${i},'from',this.value)" style="flex:1;min-width:90px">
          <input class="cp-input" type="text" placeholder="To zone"
            value="${_esc(r.to)}" oninput="CustomPolicy._updateNatRule(${i},'to',this.value)" style="flex:1;min-width:90px">
          <select class="cp-select" onchange="CustomPolicy._updateNatRule(${i},'nat_type',this.value)" style="width:190px">
            <option value="dynamic-ip-and-port" ${r.nat_type==='dynamic-ip-and-port'?'selected':''}>Dynamic IP+Port (SNAT)</option>
            <option value="dynamic-ip"          ${r.nat_type==='dynamic-ip'         ?'selected':''}>Dynamic IP</option>
            <option value="static-ip"           ${r.nat_type==='static-ip'          ?'selected':''}>Static IP (DNAT)</option>
            <option value="none"                ${r.nat_type==='none'               ?'selected':''}>None (U-turn)</option>
          </select>
          <input class="cp-input" type="text" placeholder="Translated address or interface"
            value="${_esc(r.translated_addr)}" oninput="CustomPolicy._updateNatRule(${i},'translated_addr',this.value)" style="flex:2;min-width:160px">
        </div>
      </div>`).join('');
  }
  function _addNatRule()          { _natRules.push({ name:'', from:'trust', to:'untrust', nat_type:'dynamic-ip-and-port', translated_addr:'egress-interface' }); _renderNatRules(); }
  function _removeNatRule(i)      { _natRules.splice(i,1); _renderNatRules(); }
  function _updateNatRule(i,k,v)  { if (_natRules[i]) _natRules[i][k]=v; }

  /* ── Firewall Policies (Fortinet) ────────────────────────────── */

  function _renderFwPolicies() {
    const c = document.getElementById('cp-fwpol-rows');
    if (!c) return;
    c.innerHTML = _fwPolicies.map((p, i) => `
      <div class="cp-card" data-idx="${i}">
        <div class="cp-card-header">
          <span>Policy ${i+1}: ${_esc(p.name||'unnamed')}</span>
          <button class="cp-rm-btn" onclick="CustomPolicy._removeFwPolicy(${i})">✕</button>
        </div>
        <div class="cp-row" style="flex-wrap:wrap;gap:.4rem">
          <input class="cp-input" type="text" placeholder="Policy name"
            value="${_esc(p.name)}" oninput="CustomPolicy._updateFwPolicy(${i},'name',this.value)" style="flex:2;min-width:130px">
          <input class="cp-input" type="text" placeholder="Src intf"
            value="${_esc(p.srcintf)}" oninput="CustomPolicy._updateFwPolicy(${i},'srcintf',this.value)" style="flex:1;min-width:80px">
          <input class="cp-input" type="text" placeholder="Dst intf"
            value="${_esc(p.dstintf)}" oninput="CustomPolicy._updateFwPolicy(${i},'dstintf',this.value)" style="flex:1;min-width:80px">
          <input class="cp-input" type="text" placeholder="Src addr (all)"
            value="${_esc(p.srcaddr)}" oninput="CustomPolicy._updateFwPolicy(${i},'srcaddr',this.value)" style="flex:1;min-width:90px">
          <input class="cp-input" type="text" placeholder="Dst addr (all)"
            value="${_esc(p.dstaddr)}" oninput="CustomPolicy._updateFwPolicy(${i},'dstaddr',this.value)" style="flex:1;min-width:90px">
          <input class="cp-input" type="text" placeholder="Service (ALL)"
            value="${_esc(p.service)}" oninput="CustomPolicy._updateFwPolicy(${i},'service',this.value)" style="flex:1;min-width:80px">
          <select class="cp-select" onchange="CustomPolicy._updateFwPolicy(${i},'action',this.value)" style="width:90px">
            <option value="accept" ${p.action==='accept'?'selected':''}>accept</option>
            <option value="deny"   ${p.action==='deny'  ?'selected':''}>deny</option>
          </select>
          <label style="font-size:.78rem;display:flex;align-items:center;gap:.3rem">
            <input type="checkbox" ${p.nat?'checked':''} onchange="CustomPolicy._updateFwPolicy(${i},'nat',this.checked)"> NAT
          </label>
        </div>
      </div>`).join('');
  }
  function _addFwPolicy()          { _fwPolicies.push({ name:'', srcintf:'port1', dstintf:'port2', srcaddr:'all', dstaddr:'all', service:'ALL', action:'accept', nat:true }); _renderFwPolicies(); }
  function _removeFwPolicy(i)      { _fwPolicies.splice(i,1); _renderFwPolicies(); }
  function _updateFwPolicy(i,k,v)  { if (_fwPolicies[i]) _fwPolicies[i][k]=v; }

  /* ── VIP Objects (Fortinet) ──────────────────────────────────── */

  function _renderVips() {
    const c = document.getElementById('cp-vip-rows');
    if (!c) return;
    c.innerHTML = _vipObjects.map((v, i) => `
      <div class="cp-row" data-idx="${i}">
        <input class="cp-input" type="text" placeholder="VIP name"
          value="${_esc(v.name)}" oninput="CustomPolicy._updateVip(${i},'name',this.value)" style="flex:1;min-width:100px">
        <input class="cp-input" type="text" placeholder="External IP"
          value="${_esc(v.extip)}" oninput="CustomPolicy._updateVip(${i},'extip',this.value)" style="flex:1;min-width:100px">
        <input class="cp-input" type="text" placeholder="Mapped IP"
          value="${_esc(v.mappedip)}" oninput="CustomPolicy._updateVip(${i},'mappedip',this.value)" style="flex:1;min-width:100px">
        <input class="cp-input" type="text" placeholder="Ext intf (e.g. port2)"
          value="${_esc(v.extintf)}" oninput="CustomPolicy._updateVip(${i},'extintf',this.value)" style="flex:1;min-width:80px">
        <input class="cp-input" type="number" placeholder="Ext port"
          value="${_esc(v.extport)}" oninput="CustomPolicy._updateVip(${i},'extport',+this.value)" style="width:80px">
        <input class="cp-input" type="number" placeholder="Map port"
          value="${_esc(v.mappedport)}" oninput="CustomPolicy._updateVip(${i},'mappedport',+this.value)" style="width:80px">
        <button class="cp-rm-btn" onclick="CustomPolicy._removeVip(${i})">✕</button>
      </div>`).join('');
  }
  function _addVip()          { _vipObjects.push({ name:'', extip:'', mappedip:'', extintf:'port2', extport:80, mappedport:80 }); _renderVips(); }
  function _removeVip(i)      { _vipObjects.splice(i,1); _renderVips(); }
  function _updateVip(i,k,v)  { if (_vipObjects[i]) _vipObjects[i][k]=v; }

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

    const qos = _getQosCfg();

    const sec_zones = _secZones.filter(z => z.name);
    const sec_rules = _secRules.filter(r => r.name);
    const nat_rules = _natRules.filter(r => r.name);
    const fw_policies = _fwPolicies.filter(p => p.name);
    const vip_objects = _vipObjects.filter(v => v.name && v.extip && v.mappedip);

    return {
      name,
      device_type,
      vlans,
      bgp,
      prefix_lists,
      interfaces,
      ntp_servers,
      dns_servers,
      banner:      banner || undefined,
      qos:         qos    || undefined,
      sec_zones:   sec_zones.length   ? sec_zones   : undefined,
      sec_rules:   sec_rules.length   ? sec_rules   : undefined,
      nat_rules:   nat_rules.length   ? nat_rules   : undefined,
      fw_policies: fw_policies.length ? fw_policies : undefined,
      vip_objects: vip_objects.length ? vip_objects : undefined,
    };
  }

  /* ── Client-side config generator (works without backend) ───── */

  function _generateClientSide(p) {
    const L = (s) => s + '\n';
    const iff = (cond, s) => cond ? s : '';

    function ios(p) {
      let c = `! ${'='.repeat(56)}\n! Custom Policy: ${p.name}\n! Platform: Cisco IOS / IOS-XE\n! Generated by NetDesign AI\n! ${'='.repeat(56)}\n!\n`;
      if (p.banner) c += `banner motd ^\n${p.banner}\n^\n!\n`;
      if (p.vlans?.length) {
        c += '! --- VLANs ---\n';
        p.vlans.forEach(v => { c += `vlan ${v.id}\n name ${v.name}\n`; if (v.description) c += ` ! ${v.description}\n`; });
        c += '!\n';
      }
      if (p.interfaces?.length) {
        c += '! --- Interfaces ---\n';
        p.interfaces.forEach(i => {
          c += `interface ${i.name}\n`;
          if (i.description) c += ` description ${i.description}\n`;
          if (i.vlan_id) c += ` switchport access vlan ${i.vlan_id}\n switchport mode access\n`;
          else c += ` ip address ${i.ip_address}\n`;
          c += ` no shutdown\n!\n`;
        });
      }
      if (p.prefix_lists?.length) {
        c += '! --- Prefix Lists ---\n';
        p.prefix_lists.forEach(pl => pl.prefixes.forEach(pr => { c += `ip prefix-list ${pl.name} ${pl.action} ${pr}\n`; }));
        c += '!\n';
      }
      if (p.bgp) {
        c += `! --- BGP ---\nrouter bgp ${p.bgp.asn}\n bgp router-id ${p.bgp.router_id}\n bgp log-neighbor-changes\n`;
        p.bgp.peer_groups?.forEach(pg => {
          c += ` neighbor ${pg.name} peer-group\n neighbor ${pg.name} remote-as ${pg.remote_as}\n neighbor ${pg.name} update-source ${pg.update_source}\n`;
          pg.peer_ips?.forEach(ip => { c += ` neighbor ${ip} peer-group ${pg.name}\n`; });
        });
        c += '!\n';
      }
      if (p.ntp_servers?.length) { c += '! --- NTP ---\n'; p.ntp_servers.forEach(n => { c += `ntp server ${n}\n`; }); c += '!\n'; }
      if (p.dns_servers?.length) { c += '! --- DNS ---\n'; p.dns_servers.forEach(d => { c += `ip name-server ${d}\n`; }); c += '!\n'; }
      return c + 'end\n';
    }

    function nxos(p) {
      let c = `! ${'='.repeat(56)}\n! Custom Policy: ${p.name}\n! Platform: Cisco NX-OS\n! Generated by NetDesign AI\n! ${'='.repeat(56)}\n!\n`;
      if (p.banner) c += `banner motd #\n${p.banner}\n#\n!\n`;

      if (p.vlans?.length) {
        c += '! --- VLANs ---\n';
        p.vlans.forEach(v => { c += `vlan ${v.id}\n  name ${v.name}\n  state active\n`; });
        c += '!\n';
      }

      if (p.interfaces?.length) {
        c += '! --- Interfaces ---\n';
        p.interfaces.forEach(i => {
          c += `interface ${i.name}\n`;
          if (i.description) c += `  description ${i.description}\n`;
          if (i.vlan_id) c += `  switchport\n  switchport mode access\n  switchport access vlan ${i.vlan_id}\n`;
          else           c += `  ip address ${i.ip_address}\n`;
          if (p.qos) c += `  priority-flow-control mode on\n`;
          c += `  no shutdown\n!\n`;
        });
      }

      if (p.prefix_lists?.length) {
        c += '! --- IP Prefix Lists ---\n';
        p.prefix_lists.forEach(pl => pl.prefixes.forEach(pr => { c += `ip prefix-list ${pl.name} ${pl.action} ${pr}\n`; }));
        c += '!\n';
      }

      if (p.bgp) {
        c += `! --- BGP ---\nrouter bgp ${p.bgp.asn}\n  router-id ${p.bgp.router_id}\n  log-neighbor-changes\n`;
        p.bgp.peer_groups?.forEach(pg => {
          c += `  neighbor ${pg.name}\n    remote-as ${pg.remote_as}\n    update-source ${pg.update_source}\n`;
          pg.peer_ips?.forEach(ip => { c += `  neighbor ${ip}\n    remote-as ${pg.remote_as}\n    update-source ${pg.update_source}\n`; });
        });
        c += '!\n';
      }

      if (p.qos) {
        const q = p.qos;
        const mtu = q.mtu || 9216;
        const bufBytes = (q.buffer_pool || 16384) * 1024;
        c += `! ${'─'.repeat(54)}\n! QoS / PFC — AI Fabric (RoCEv2 lossless)\n! ${'─'.repeat(54)}\n!\n`;
        c += `feature qos\n!\n`;

        // DSCP classification class-maps
        if (q.dscp_map?.length) {
          c += '! --- DSCP Class-Maps ---\n';
          q.dscp_map.forEach((m, idx) => {
            c += `class-map type qos match-all CL-DSCP-${m.dscp}\n  match dscp ${m.dscp}\n`;
          });
          c += '!\n';
          c += '! --- Network-QoS lossless class-maps ---\n';
          const losslessTCs = new Set(q.pfc_priorities.map(String));
          q.dscp_map.filter(m => losslessTCs.has(String(m.tc))).forEach(m => {
            c += `class-map type network-qos match-all CL-NQ-TC${m.tc}\n  match qos-group ${m.tc}\n`;
          });
          c += '!\n';
          q.dscp_map.forEach(m => {
            c += `class-map type queuing CL-Q-TC${m.tc}\n  match qos-group ${m.tc}\n`;
          });
          c += '!\n';

          // DSCP → QoS-group policy
          c += '! --- Policy-map: DSCP classify ---\npolicy-map type qos PM-DSCP-IN\n';
          q.dscp_map.forEach(m => {
            c += `  class CL-DSCP-${m.dscp}\n    set qos-group ${m.tc}\n`;
          });
          c += `  class class-default\n    set qos-group 0\n!\n`;

          // Network-QoS lossless pause
          c += '! --- Policy-map: lossless PAUSE ---\npolicy-map type network-qos PM-LOSSLESS\n';
          const seenTCs = new Set();
          q.dscp_map.filter(m => losslessTCs.has(String(m.tc))).forEach(m => {
            if (seenTCs.has(m.tc)) return; seenTCs.add(m.tc);
            c += `  class type network-qos CL-NQ-TC${m.tc}\n    pause no-drop\n    mtu ${mtu}\n`;
          });
          c += `  class type network-qos class-default\n    mtu 1500\n!\n`;

          // Queuing / DWRR
          c += `! --- Policy-map: queuing (${q.scheduler.toUpperCase()}) ---\npolicy-map type queuing PM-QUEUE-OUT\n`;
          const weights = q.queue_weights || [];
          const seenQ = new Set();
          q.dscp_map.forEach(m => {
            if (seenQ.has(m.tc)) return; seenQ.add(m.tc);
            const w = weights[m.tc] ?? 0;
            const isLL = losslessTCs.has(String(m.tc));
            if (q.scheduler === 'strict' || (q.scheduler === 'mixed' && isLL)) {
              c += `  class type queuing CL-Q-TC${m.tc}\n    priority\n`;
            } else {
              c += `  class type queuing CL-Q-TC${m.tc}\n    bandwidth percent ${w||5}\n`;
            }
            if (isLL) c += `    queue-limit bytes ${bufBytes}\n`;
            if (q.ecn?.enabled && isLL) {
              c += `    random-detect minimum-threshold ${q.ecn.min_threshold} kbytes maximum-threshold ${q.ecn.max_threshold} kbytes\n`;
            }
          });
          c += '!\n';
        }

        // System QoS apply
        c += `! --- System QoS apply ---\nsystem qos\n`;
        c += `  service-policy type qos input PM-DSCP-IN\n`;
        c += `  service-policy type network-qos PM-LOSSLESS\n`;
        c += `  service-policy type queuing output PM-QUEUE-OUT\n!\n`;

        // PFC note
        c += `! --- PFC (enable on AI fabric ports) ---\n`;
        c += `! interface Ethernet1/X\n!   priority-flow-control mode on\n`;
        c += `! (PFC is auto-applied to listed interfaces above)\n!\n`;
      }

      if (p.ntp_servers?.length) { c += '! --- NTP ---\n'; p.ntp_servers.forEach(n => { c += `ntp server ${n} use-vrf management\n`; }); c += '!\n'; }
      if (p.dns_servers?.length) { c += '! --- DNS ---\n'; p.dns_servers.forEach(d => { c += `ip name-server ${d}\n`; }); c += '!\n'; }
      return c;
    }

    function junos(p) {
      let c = `# ${'='.repeat(56)}\n# Custom Policy: ${p.name}\n# Platform: Juniper Junos\n# Generated by NetDesign AI\n# ${'='.repeat(56)}\n#\n`;
      if (p.banner) c += `set system login message "${p.banner}"\n#\n`;
      if (p.vlans?.length) {
        c += '# --- VLANs ---\n';
        p.vlans.forEach(v => { c += `set vlans ${v.name} vlan-id ${v.id}\n`; if (v.description) c += `set vlans ${v.name} description "${v.description}"\n`; });
        c += '#\n';
      }
      if (p.interfaces?.length) {
        c += '# --- Interfaces ---\n';
        p.interfaces.forEach(i => {
          c += `set interfaces ${i.name} description "${i.description}"\n`;
          if (i.vlan_id) c += `set interfaces ${i.name} unit 0 family ethernet-switching vlan members ${i.vlan_id}\n`;
          else c += `set interfaces ${i.name} unit 0 family inet address ${i.ip_address}\n`;
        });
        c += '#\n';
      }
      if (p.prefix_lists?.length) {
        c += '# --- Prefix Lists ---\n';
        p.prefix_lists.forEach(pl => pl.prefixes.forEach(pr => { c += `set policy-options prefix-list ${pl.name} ${pr}\n`; }));
        c += '#\n';
      }
      if (p.bgp) {
        c += `# --- BGP ---\nset routing-options router-id ${p.bgp.router_id}\nset routing-options autonomous-system ${p.bgp.asn}\n`;
        p.bgp.peer_groups?.forEach(pg => {
          c += `set protocols bgp group ${pg.name} type external\nset protocols bgp group ${pg.name} peer-as ${pg.remote_as}\nset protocols bgp group ${pg.name} local-address ${p.bgp.router_id}\n`;
          pg.peer_ips?.forEach(ip => { c += `set protocols bgp group ${pg.name} neighbor ${ip}\n`; });
        });
        c += '#\n';
      }
      if (p.ntp_servers?.length) { c += '# --- NTP ---\n'; p.ntp_servers.forEach(n => { c += `set system ntp server ${n}\n`; }); c += '#\n'; }
      if (p.dns_servers?.length) { c += '# --- DNS ---\n'; p.dns_servers.forEach(d => { c += `set system name-server ${d}\n`; }); c += '#\n'; }
      return c;
    }

    function eos(p) {
      let c = `! ${'='.repeat(56)}\n! Custom Policy: ${p.name}\n! Platform: Arista EOS\n! Generated by NetDesign AI\n! ${'='.repeat(56)}\n!\n`;
      if (p.banner) c += `banner motd\n${p.banner}\nEOF\n!\n`;

      if (p.vlans?.length) {
        c += '! --- VLANs ---\n';
        p.vlans.forEach(v => { c += `vlan ${v.id}\n   name ${v.name}\n`; if (v.description) c += `   ! ${v.description}\n`; });
        c += '!\n';
      }

      if (p.interfaces?.length) {
        c += '! --- Interfaces ---\n';
        p.interfaces.forEach(i => {
          c += `interface ${i.name}\n`;
          if (i.description) c += `   description ${i.description}\n`;
          if (i.vlan_id) c += `   switchport mode access\n   switchport access vlan ${i.vlan_id}\n`;
          else           c += `   ip address ${i.ip_address}\n`;
          if (p.qos) {
            c += `   priority-flow-control on\n`;
            (p.qos.pfc_priorities || []).forEach(pr => { c += `   priority-flow-control priority ${pr} no-drop\n`; });
          }
          c += `   no shutdown\n!\n`;
        });
      }

      if (p.qos) {
        const q = p.qos;
        c += `! ${'─'.repeat(54)}\n! QoS / PFC — AI Fabric (RoCEv2 lossless)\n! ${'─'.repeat(54)}\n!\n`;

        // DSCP → TC maps
        if (q.dscp_map?.length) {
          c += '! --- DSCP → Traffic Class ---\n';
          q.dscp_map.forEach(m => { c += `qos map dscp ${m.dscp} to traffic-class ${m.tc}\n`; });
          c += '!\n';

          // TC → TX queue
          const seenTC = new Set();
          c += '! --- TC → TX Queue ---\n';
          q.dscp_map.forEach(m => { if (!seenTC.has(m.tc)) { seenTC.add(m.tc); c += `qos map traffic-class ${m.tc} to tx-queue ${m.tc}\n`; } });
          c += '!\n';
        }

        // Traffic policy for classification
        c += '! --- Traffic Policy (apply on ingress fabric ports) ---\ntraffic-policies\n   traffic-policy TP-AI-FABRIC-IN\n';
        q.dscp_map?.forEach((m, idx) => {
          c += `      match DSCP-${m.dscp}\n         dscp ${m.dscp}\n         actions\n            set traffic class ${m.tc}\n         !\n`;
        });
        c += '   !\n!\n';

        // PFC + ECN per lossless queue
        const losslessTCs = new Set((q.pfc_priorities || []).map(String));
        c += '! --- QoS Profiles (lossless queues) ---\n';
        [...losslessTCs].forEach(tc => {
          c += `qos profile TC${tc}-LOSSLESS\n`;
          if (q.ecn?.enabled) {
            c += `   ecn minimum-threshold ${q.ecn.min_threshold} kbytes\n`;
            c += `   ecn maximum-threshold ${q.ecn.max_threshold} kbytes\n`;
          }
          c += `!\n`;
        });

        // Scheduler
        const weights = q.queue_weights || [];
        c += `! --- TX Queue Scheduling (${q.scheduler.toUpperCase()}) ---\nqos profile SCHED-${q.scheduler.toUpperCase()}\n`;
        const seenQ = new Set();
        (q.dscp_map || []).forEach(m => {
          if (seenQ.has(m.tc)) return; seenQ.add(m.tc);
          const w = weights[m.tc] ?? 5;
          const isLL = losslessTCs.has(String(m.tc));
          if (q.scheduler === 'strict' || (q.scheduler === 'mixed' && isLL)) {
            c += `   tx-queue ${m.tc} priority strict\n`;
          } else {
            c += `   tx-queue ${m.tc} bandwidth percent ${w} ${isLL ? 'no-drop' : ''}\n`;
          }
        });
        c += '!\n';

        c += `! --- Note: apply traffic policy on AI fabric interfaces ---\n`;
        c += `! interface EthernetX\n!    traffic-policy input TP-AI-FABRIC-IN\n!\n`;
      }

      if (p.prefix_lists?.length) {
        c += '! --- IP Prefix Lists ---\n';
        p.prefix_lists.forEach(pl => pl.prefixes.forEach(pr => { c += `ip prefix-list ${pl.name} ${pl.action} ${pr}\n`; }));
        c += '!\n';
      }

      if (p.bgp) {
        c += `! --- BGP ---\nrouter bgp ${p.bgp.asn}\n   router-id ${p.bgp.router_id}\n   bgp log-neighbor-changes\n`;
        p.bgp.peer_groups?.forEach(pg => {
          c += `   neighbor ${pg.name} peer group\n   neighbor ${pg.name} remote-as ${pg.remote_as}\n   neighbor ${pg.name} update-source ${pg.update_source}\n`;
          pg.peer_ips?.forEach(ip => { c += `   neighbor ${ip} peer group ${pg.name}\n`; });
        });
        c += '!\n';
      }

      if (p.ntp_servers?.length) { c += '! --- NTP ---\n'; p.ntp_servers.forEach(n => { c += `ntp server ${n}\n`; }); c += '!\n'; }
      if (p.dns_servers?.length) { c += '! --- DNS ---\n'; p.dns_servers.forEach(d => { c += `ip name-server ${d}\n`; }); c += '!\n'; }
      return c + 'end\n';
    }

    function palo_alto(p) {
      let c = `# ${'='.repeat(56)}\n# Custom Policy: ${p.name}\n# Platform: Palo Alto PAN-OS\n# Generated by NetDesign AI\n# ${'='.repeat(56)}\n\n`;

      if (p.banner) c += `set deviceconfig system login-banner "${p.banner}"\n\n`;

      if (p.vlans?.length) {
        c += '# --- Layer-3 Sub-interfaces (VLAN) ---\n';
        p.vlans.forEach(v => {
          c += `set network interface ethernet ethernet1/1 layer3 units ethernet1/1.${v.id} tag ${v.id}\n`;
          c += `set network interface ethernet ethernet1/1 layer3 units ethernet1/1.${v.id} comment "${v.description || v.name}"\n`;
        });
        c += '\n';
      }

      if (p.interfaces?.length) {
        c += '# --- Layer-3 Interfaces ---\n';
        p.interfaces.forEach(i => {
          c += `set network interface ethernet ${i.name} layer3 ip ${i.ip_address}\n`;
          if (i.description) c += `set network interface ethernet ${i.name} comment "${i.description}"\n`;
        });
        c += '\n';
      }

      if (p.prefix_lists?.length) {
        c += '# --- Address Objects (from prefix lists) ---\n';
        p.prefix_lists.forEach(pl => {
          pl.prefixes.forEach((pr, idx) => {
            const obj = `${pl.name}-${idx + 1}`;
            c += `set address ${obj} ip-netmask ${pr}\n`;
            c += `set address ${obj} description "${pl.action} prefix for ${pl.name}"\n`;
          });
          const members = pl.prefixes.map((_, idx) => `${pl.name}-${idx + 1}`).join(' ');
          c += `set address-group ${pl.name} static [ ${members} ]\n`;
        });
        c += '\n';
      }

      if (p.bgp) {
        c += `# --- BGP (Virtual Router: default) ---\nset network virtual-router default routing-table ip static-route bgp\n`;
        c += `set network virtual-router default protocol bgp enable yes\n`;
        c += `set network virtual-router default protocol bgp router-id ${p.bgp.router_id}\n`;
        c += `set network virtual-router default protocol bgp local-as ${p.bgp.asn}\n`;
        p.bgp.peer_groups?.forEach(pg => {
          c += `set network virtual-router default protocol bgp peer-group ${pg.name} type ebgp\n`;
          c += `set network virtual-router default protocol bgp peer-group ${pg.name} peer-as ${pg.remote_as}\n`;
          pg.peer_ips?.forEach(ip => {
            c += `set network virtual-router default protocol bgp peer-group ${pg.name} peer ${ip} peer-address ${ip}\n`;
            c += `set network virtual-router default protocol bgp peer-group ${pg.name} peer ${ip} local-address ip ${p.bgp.router_id}\n`;
          });
        });
        c += '\n';
      }

      // Security zones
      if (p.sec_zones?.length) {
        c += '# --- Security Zones ---\n';
        p.sec_zones.forEach(z => {
          c += `set zone ${z.name} network ${z.type}\n`;
          if (z.interfaces) {
            z.interfaces.split(',').map(s => s.trim()).filter(Boolean).forEach(iface => {
              c += `set zone ${z.name} network ${z.type} interface ${iface}\n`;
            });
          }
        });
        c += '\n';
      }

      // Security rules
      if (p.sec_rules?.length) {
        c += `# --- Security Policy Rules ---\n`;
        p.sec_rules.forEach(r => {
          c += `set rulebase security rules "${r.name}" from ${r.from || 'any'}\n`;
          c += `set rulebase security rules "${r.name}" to ${r.to || 'any'}\n`;
          c += `set rulebase security rules "${r.name}" source any\n`;
          c += `set rulebase security rules "${r.name}" destination any\n`;
          c += `set rulebase security rules "${r.name}" application ${r.app || 'any'}\n`;
          c += `set rulebase security rules "${r.name}" service ${r.service || 'application-default'}\n`;
          c += `set rulebase security rules "${r.name}" action ${r.action || 'allow'}\n`;
          c += `set rulebase security rules "${r.name}" log-start no\n`;
          c += `set rulebase security rules "${r.name}" log-end ${r.log ? 'yes' : 'no'}\n`;
          c += `set rulebase security rules "${r.name}" profile-setting profiles virus default\n`;
          c += `set rulebase security rules "${r.name}" profile-setting profiles spyware default\n`;
          c += '\n';
        });
        c += '# Implicit deny-all is always last (built-in)\n\n';
      }

      // NAT rules
      if (p.nat_rules?.length) {
        c += `# --- NAT Rules ---\n`;
        p.nat_rules.forEach(r => {
          c += `set rulebase nat rules "${r.name}" from ${r.from || 'trust'}\n`;
          c += `set rulebase nat rules "${r.name}" to ${r.to || 'untrust'}\n`;
          c += `set rulebase nat rules "${r.name}" source any\n`;
          c += `set rulebase nat rules "${r.name}" destination any\n`;
          c += `set rulebase nat rules "${r.name}" service any\n`;
          c += `set rulebase nat rules "${r.name}" nat-type ipv4\n`;
          if (r.nat_type === 'dynamic-ip-and-port') {
            c += `set rulebase nat rules "${r.name}" source-translation dynamic-ip-and-port interface-address interface ${r.translated_addr || 'ethernet1/2'}\n`;
          } else if (r.nat_type === 'static-ip') {
            c += `set rulebase nat rules "${r.name}" destination-translation translated-address ${r.translated_addr || '10.0.0.10'}\n`;
          } else if (r.nat_type === 'dynamic-ip') {
            c += `set rulebase nat rules "${r.name}" source-translation dynamic-ip translated-address ${r.translated_addr || '203.0.113.0/24'}\n`;
          }
          c += '\n';
        });
      }

      if (p.ntp_servers?.length) {
        c += '# --- NTP ---\n';
        if (p.ntp_servers[0]) c += `set deviceconfig system ntp-servers primary-ntp-server ntp-server-address ${p.ntp_servers[0]}\n`;
        if (p.ntp_servers[1]) c += `set deviceconfig system ntp-servers secondary-ntp-server ntp-server-address ${p.ntp_servers[1]}\n`;
        c += '\n';
      }
      if (p.dns_servers?.length) {
        c += '# --- DNS ---\n';
        if (p.dns_servers[0]) c += `set deviceconfig system dns-setting servers primary ${p.dns_servers[0]}\n`;
        if (p.dns_servers[1]) c += `set deviceconfig system dns-setting servers secondary ${p.dns_servers[1]}\n`;
        c += '\n';
      }
      return c;
    }

    function fortinet(p) {
      let c = `# ${'='.repeat(56)}\n# Custom Policy: ${p.name}\n# Platform: Fortinet FortiOS\n# Generated by NetDesign AI\n# ${'='.repeat(56)}\n\n`;

      if (p.banner) c += `config system global\n    set pre-login-banner "${p.banner}"\nend\n\n`;

      if (p.vlans?.length) {
        c += '# --- VLANs ---\nconfig system interface\n';
        p.vlans.forEach(v => {
          c += `    edit "vlan${v.id}"\n`;
          c += `        set type vlan\n        set vlanid ${v.id}\n`;
          if (v.description) c += `        set description "${v.description}"\n`;
          c += `        set interface "port1"\n    next\n`;
        });
        c += 'end\n\n';
      }

      if (p.interfaces?.length) {
        c += '# --- Interfaces ---\nconfig system interface\n';
        p.interfaces.forEach(i => {
          const [addr, mask] = _cidrToFortinet(i.ip_address);
          c += `    edit "${i.name}"\n`;
          c += `        set ip ${addr} ${mask}\n`;
          c += `        set allowaccess ping\n`;
          if (i.description) c += `        set description "${i.description}"\n`;
          c += `    next\n`;
        });
        c += 'end\n\n';
      }

      if (p.prefix_lists?.length) {
        c += '# --- IP Prefix Lists ---\nconfig router prefix-list\n';
        p.prefix_lists.forEach(pl => {
          c += `    edit "${pl.name}"\n        config rule\n`;
          pl.prefixes.forEach((pr, idx) => {
            c += `            edit ${idx + 1}\n                set action ${pl.action}\n                set prefix ${pr}\n            next\n`;
          });
          c += `        end\n    next\n`;
        });
        c += 'end\n\n';
      }

      if (p.bgp) {
        c += `# --- BGP ---\nconfig router bgp\n    set as ${p.bgp.asn}\n    set router-id ${p.bgp.router_id}\n    config neighbor-group\n`;
        p.bgp.peer_groups?.forEach(pg => {
          c += `        edit "${pg.name}"\n            set remote-as ${pg.remote_as}\n            set update-source "${pg.update_source}"\n        next\n`;
        });
        c += `    end\n    config neighbor\n`;
        p.bgp.peer_groups?.forEach(pg => {
          pg.peer_ips?.forEach(ip => {
            c += `        edit "${ip}"\n            set neighbor-group "${pg.name}"\n            set remote-as ${pg.remote_as}\n        next\n`;
          });
        });
        c += `    end\nend\n\n`;
      }

      // VIP objects
      if (p.vip_objects?.length) {
        c += '# --- VIP Objects (DNAT) ---\nconfig firewall vip\n';
        p.vip_objects.forEach((v, idx) => {
          c += `    edit "${v.name}"\n`;
          c += `        set extip ${v.extip}\n`;
          c += `        set mappedip "${v.mappedip}"\n`;
          c += `        set extintf "${v.extintf || 'port2'}"\n`;
          if (v.extport && v.mappedport) {
            c += `        set portforward enable\n`;
            c += `        set extport ${v.extport}\n`;
            c += `        set mappedport ${v.mappedport}\n`;
          }
          c += `    next\n`;
        });
        c += 'end\n\n';
      }

      // Firewall policies
      if (p.fw_policies?.length) {
        c += '# --- Firewall Policies ---\nconfig firewall policy\n';
        p.fw_policies.forEach((pol, idx) => {
          c += `    edit ${idx + 1}\n`;
          c += `        set name "${pol.name}"\n`;
          c += `        set srcintf "${pol.srcintf}"\n`;
          c += `        set dstintf "${pol.dstintf}"\n`;
          c += `        set srcaddr "${pol.srcaddr || 'all'}"\n`;
          c += `        set dstaddr "${pol.dstaddr || 'all'}"\n`;
          c += `        set action ${pol.action || 'accept'}\n`;
          c += `        set schedule "always"\n`;
          c += `        set service "${pol.service || 'ALL'}"\n`;
          if (pol.nat) c += `        set nat enable\n`;
          c += `        set logtraffic all\n`;
          c += `        set logtraffic-start enable\n`;
          c += `    next\n`;
        });
        c += 'end\n\n';
      }

      if (p.ntp_servers?.length) {
        c += '# --- NTP ---\nconfig system ntp\n    set status enable\n    config ntpserver\n';
        p.ntp_servers.forEach((n, idx) => { c += `        edit ${idx + 1}\n            set server "${n}"\n        next\n`; });
        c += `    end\nend\n\n`;
      }
      if (p.dns_servers?.length) {
        c += '# --- DNS ---\nconfig system dns\n';
        if (p.dns_servers[0]) c += `    set primary ${p.dns_servers[0]}\n`;
        if (p.dns_servers[1]) c += `    set secondary ${p.dns_servers[1]}\n`;
        c += 'end\n\n';
      }
      return c;
    }

    function nvidia_cumulus(p) {
      return _frrBased(p, 'NVIDIA Cumulus Linux', _cumulusInterfaces);
    }

    function sonic(p) {
      return _frrBased(p, 'SONiC (FRR)', _sonicInterfaces);
    }

    function _frrBased(p, platformLabel, ifaceRenderer) {
      const isSonic = platformLabel.includes('SONiC');
      let c = `# ${'='.repeat(56)}\n# Custom Policy: ${p.name}\n# Platform: ${platformLabel}\n# Generated by NetDesign AI\n# ${'='.repeat(56)}\n\n`;

      if (p.banner) c += `# MOTD: set via /etc/motd\n# ${p.banner}\n\n`;

      c += ifaceRenderer(p);

      if (p.vlans?.length) {
        c += '# --- Bridge / VLAN config (/etc/network/interfaces) ---\n';
        c += 'auto bridge\niface bridge\n    bridge-vlan-aware yes\n';
        c += '    bridge-vids ' + p.vlans.map(v => v.id).join(' ') + '\n\n';
        p.vlans.forEach(v => {
          c += `# VLAN ${v.id}: ${v.name}${v.description ? ' — ' + v.description : ''}\n`;
        });
        c += '\n';
      }

      if (p.prefix_lists?.length || p.bgp) {
        c += '# --- FRR config (/etc/frr/frr.conf) ---\n';
        c += 'frr version 8.5\nfrr defaults datacenter\nhostname ' + (p.name.replace(/\s+/g, '-') || 'router') + '\nno ipv6 forwarding\n!\n';

        if (p.prefix_lists?.length) {
          p.prefix_lists.forEach(pl => {
            pl.prefixes.forEach((pr, idx) => {
              c += `ip prefix-list ${pl.name} seq ${(idx + 1) * 10} ${pl.action} ${pr}\n`;
            });
          });
          c += '!\n';
        }

        if (p.bgp) {
          c += `router bgp ${p.bgp.asn}\n bgp router-id ${p.bgp.router_id}\n bgp log-neighbor-changes\n`;
          c += ` no bgp ebgp-requires-policy\n`;
          p.bgp.peer_groups?.forEach(pg => {
            c += ` neighbor ${pg.name} peer-group\n`;
            c += ` neighbor ${pg.name} remote-as ${pg.remote_as}\n`;
            if (pg.update_source && pg.update_source !== 'Loopback0') {
              c += ` neighbor ${pg.name} update-source ${pg.update_source}\n`;
            }
            pg.peer_ips?.forEach(ip => { c += ` neighbor ${ip} peer-group ${pg.name}\n`; });
          });
          c += ' !\n address-family ipv4 unicast\n';
          p.bgp.peer_groups?.forEach(pg => { c += `  neighbor ${pg.name} activate\n`; });
          c += ' exit-address-family\n!\n';
        }
      }

      // QoS / PFC for AI fabric
      if (p.qos) {
        const q = p.qos;
        c += `# ${'─'.repeat(54)}\n# QoS / PFC — AI Fabric (RoCEv2 lossless)\n# ${'─'.repeat(54)}\n\n`;

        if (isSonic) {
          // SONiC CLI commands
          c += '# --- SONiC QoS (run as root) ---\n';
          c += '# Step 1: DSCP → TC map\n';
          q.dscp_map?.forEach(m => { c += `config qos map dscp-tc add RDMA-DSCP-TC ${m.dscp} ${m.tc}\n`; });
          c += '\n# Step 2: TC → Priority Group (lossless)\n';
          (q.pfc_priorities || []).forEach(pr => { c += `config qos map tc-pg add RDMA-TC-PG ${pr} ${pr}\n`; });
          c += '\n# Step 3: WRED/ECN profile\n';
          if (q.ecn?.enabled) {
            c += `config ecn ecn-on -profile RDMA-ECN -min ${q.ecn.min_threshold * 1024} -max ${q.ecn.max_threshold * 1024} -gdrop 100\n`;
          }
          c += '\n# Step 4: PFC (per fabric interface)\n';
          c += '# Replace <iface> with each AI fabric port (e.g. Ethernet0, Ethernet4 …)\n';
          (q.pfc_priorities || []).forEach(pr => { c += `config interface pfc priority <iface> ${pr} on\n`; });
          c += '\n# Step 5: Buffer profile (lossless)\n';
          c += `config buffer profile add RDMA-BUF --xon 18432 --xoff 165888 --size ${(q.buffer_pool || 16384) * 1024} --dynamic_th 3 --pool ingress_lossless_pool\n`;
          c += '\n# Step 6: Apply QoS config\nconfig qos reload\n\n';

          // Scheduling
          c += '# --- Scheduler (config_db.json excerpt) ---\n';
          c += '# Add to /etc/sonic/config_db.json under "SCHEDULER":\n';
          const weights = q.queue_weights || [];
          q.dscp_map?.forEach((m, idx) => {
            const w = weights[m.tc] ?? 5;
            const isLL = (q.pfc_priorities || []).includes(m.tc);
            const type = (q.scheduler === 'strict' || (q.scheduler === 'mixed' && isLL)) ? 'STRICT' : 'DWRR';
            c += `#   "SCHEDULER|RDMA-SCHED-Q${m.tc}": { "type": "${type}", "weight": "${w}" }\n`;
          });
          c += '\n';
        } else {
          // NVIDIA Cumulus — qos_policy.conf (NVUE / YAML style)
          c += '# --- /etc/cumulus/datapath/qos/qos_policy.conf ---\n';
          c += 'version: 1\nremark:\n  type: dscp\n  dscp_map:\n';
          q.dscp_map?.forEach(m => { c += `    - { dscp: ${m.dscp}, cos: ${m.tc} }\n`; });
          c += `\ntraffic_pool:\n  - id: 0\n    name: lossless-pool\n    mode: lossless\n    size_bytes: ${(q.buffer_pool || 16384) * 1024}\n\n`;
          c += 'priority_groups:\n';
          (q.pfc_priorities || []).forEach(pr => {
            c += `  - name: pg-lossless-${pr}\n    cos: [${pr}]\n    is_lossless: true\n    buffer_pool: 0\n`;
          });
          c += '\nscheduler:\n  algorithm: ' + (q.scheduler === 'strict' ? 'strict' : 'dwrr') + '\n  port_queues:\n';
          (q.queue_weights || []).forEach((w, i) => {
            if (w > 0) c += `    - { id: ${i}, bandwidth_percent: ${w} }\n`;
          });
          c += '\n';
          if (q.ecn?.enabled) {
            c += '# --- ECN (NVUE commands) ---\n';
            (q.pfc_priorities || []).forEach(pr => {
              c += `nv set qos congestion-control profile RDMA-ECN traffic-class ${pr} min-threshold ${q.ecn.min_threshold}KB max-threshold ${q.ecn.max_threshold}KB ecn enable\n`;
            });
            c += '\n';
          }
          c += '# --- PFC (NVUE — apply to each AI fabric port) ---\n';
          c += '# Replace swp1,swp2,... with actual fabric ports\n';
          (q.pfc_priorities || []).forEach(pr => {
            c += `nv set interface swp1 qos pfc priority ${pr} tx enable on rx enable on\n`;
          });
          c += 'nv config apply\n\n';
        }
      }

      if (p.ntp_servers?.length) {
        c += '# --- NTP (/etc/chrony.conf) ---\n';
        p.ntp_servers.forEach(n => { c += `server ${n} iburst\n`; });
        c += '\n';
      }
      if (p.dns_servers?.length) {
        c += '# --- DNS (/etc/resolv.conf) ---\n';
        p.dns_servers.forEach(d => { c += `nameserver ${d}\n`; });
        c += '\n';
      }
      return c;
    }

    function _cumulusInterfaces(p) {
      if (!p.interfaces?.length) return '';
      let c = '# --- Interfaces (/etc/network/interfaces) ---\n';
      p.interfaces.forEach(i => {
        c += `auto ${i.name}\niface ${i.name}\n`;
        if (i.ip_address) c += `    address ${i.ip_address}\n`;
        if (i.description) c += `    alias "${i.description}"\n`;
        c += '\n';
      });
      return c;
    }

    function _sonicInterfaces(p) {
      if (!p.interfaces?.length) return '';
      let c = '# --- Interfaces (sonic-cli / config DB) ---\n';
      p.interfaces.forEach(i => {
        c += `sudo config interface ip add ${i.name} ${i.ip_address}\n`;
        if (i.description) c += `sudo config interface description ${i.name} "${i.description}"\n`;
        c += `sudo config interface startup ${i.name}\n\n`;
      });
      return c;
    }

    function _cidrToFortinet(cidr) {
      if (!cidr || !cidr.includes('/')) return [cidr || '0.0.0.0', '255.255.255.255'];
      const [addr, bits] = cidr.split('/');
      const b = parseInt(bits, 10);
      const mask = b === 0 ? '0.0.0.0' : (~(0xFFFFFFFF >>> b) >>> 0);
      const maskStr = [(mask >>> 24) & 255, (mask >>> 16) & 255, (mask >>> 8) & 255, mask & 255].join('.');
      return [addr, maskStr];
    }

    const generators = { cisco_ios: ios, cisco_nxos: nxos, juniper_junos: junos, arista_eos: eos, palo_alto, fortinet, nvidia_cumulus, sonic };
    const fn = generators[p.device_type];
    if (!fn) throw new Error(`Unknown platform: ${p.device_type}`);
    return { configs: { [p.name]: fn(p) } };
  }

  function _validateClientSide(p) {
    const errors = [], warnings = [];
    if (!p.name) errors.push('Policy name is required');

    const knownPlatforms = ['cisco_ios','cisco_nxos','juniper_junos','arista_eos','palo_alto','fortinet','nvidia_cumulus','sonic'];
    if (!knownPlatforms.includes(p.device_type)) errors.push(`Unknown platform: ${p.device_type}`);

    p.vlans?.forEach(v => {
      if (v.id < 1 || v.id > 4094) errors.push(`VLAN ${v.id}: ID must be 1–4094`);
      if (!v.name) warnings.push(`VLAN ${v.id}: no name set`);
    });
    const vlanIds = p.vlans?.map(v => v.id) || [];
    if (new Set(vlanIds).size !== vlanIds.length) errors.push('Duplicate VLAN IDs detected');

    if (p.bgp) {
      if (!p.bgp.router_id) errors.push('BGP router-id is required');
      if (p.bgp.asn < 1 || p.bgp.asn > 4294967295) errors.push('BGP ASN must be 1–4294967295');
      p.bgp.peer_groups?.forEach(pg => {
        if (!pg.name) errors.push('BGP peer group has no name');
        if (!pg.remote_as) errors.push(`Peer group ${pg.name}: remote-as is required`);
        if (!pg.peer_ips?.length) warnings.push(`Peer group ${pg.name}: no neighbor IPs configured`);
      });
      if (p.device_type === 'palo_alto') {
        warnings.push('Palo Alto: BGP runs inside a Virtual Router — ensure "default" VR is the target or adjust the generated set commands');
      }
      if (p.device_type === 'fortinet') {
        warnings.push('FortiOS: BGP requires "config router bgp" to be committed before neighbors become active');
      }
    }

    p.prefix_lists?.forEach(pl => {
      if (!pl.prefixes?.length) warnings.push(`Prefix list ${pl.name}: no prefixes`);
    });

    if ((p.device_type === 'nvidia_cumulus' || p.device_type === 'sonic') && p.vlans?.length) {
      warnings.push('Cumulus/SONiC: VLAN-aware bridge config requires the physical bridge interface to already exist');
    }
    if (p.device_type === 'palo_alto' && p.interfaces?.length) {
      warnings.push('Palo Alto: interfaces must be assigned to a Security Zone after creation');
    }
    if (p.device_type === 'fortinet' && p.interfaces?.length) {
      const badCidr = p.interfaces.filter(i => !i.ip_address.includes('/'));
      if (badCidr.length) warnings.push('FortiOS: interface IPs should be in CIDR notation (e.g. 10.0.0.1/24) for correct mask conversion');
    }

    // QoS validation
    if (p.qos) {
      const q = p.qos;
      if (!q.pfc_priorities?.length) errors.push('QoS: at least one PFC priority queue is required');
      if (!q.dscp_map?.length)       warnings.push('QoS: no DSCP→TC mappings defined — use a preset or add entries');
      if (q.ecn?.enabled) {
        if (q.ecn.min_threshold >= q.ecn.max_threshold) errors.push('QoS ECN: min threshold must be less than max threshold');
        if (q.ecn.max_threshold > 65536) warnings.push('QoS ECN: max threshold >65536 KB may exceed available buffer on most ASICs');
      }
      if (q.buffer_pool > 131072) warnings.push('QoS: buffer pool >128 MB is unusual — verify ASIC headroom');
      if (!_QOS_PLATFORMS.has(p.device_type)) warnings.push('QoS/PFC is only supported on NX-OS, EOS, Cumulus, and SONiC');
    }

    // Palo Alto security policy validation
    if (p.sec_zones?.length) {
      const zoneNames = new Set(p.sec_zones.map(z => z.name));
      p.sec_rules?.forEach(r => {
        if (r.from !== 'any' && !zoneNames.has(r.from)) warnings.push(`Security rule "${r.name}": from-zone "${r.from}" is not defined`);
        if (r.to   !== 'any' && !zoneNames.has(r.to))   warnings.push(`Security rule "${r.name}": to-zone "${r.to}" is not defined`);
      });
      p.nat_rules?.forEach(r => {
        if (!zoneNames.has(r.from)) warnings.push(`NAT rule "${r.name}": from-zone "${r.from}" is not defined`);
        if (!zoneNames.has(r.to))   warnings.push(`NAT rule "${r.name}": to-zone "${r.to}" is not defined`);
      });
    }
    if (p.device_type === 'palo_alto' && p.sec_rules?.length) {
      const hasDefaultDeny = p.sec_rules.some(r => r.action === 'deny' && r.from === 'any' && r.to === 'any');
      if (!hasDefaultDeny) warnings.push('Palo Alto: consider adding an explicit deny-all rule at the bottom for audit visibility');
    }

    // Fortinet firewall policy validation
    if (p.fw_policies?.length) {
      p.fw_policies.forEach(pol => {
        if (!pol.srcintf) errors.push(`Firewall policy "${pol.name}": srcintf is required`);
        if (!pol.dstintf) errors.push(`Firewall policy "${pol.name}": dstintf is required`);
      });
    }
    if (p.vip_objects?.length) {
      p.vip_objects.forEach(v => {
        if (!v.extip)    errors.push(`VIP "${v.name}": external IP is required`);
        if (!v.mappedip) errors.push(`VIP "${v.name}": mapped IP is required`);
      });
    }

    return { errors, warnings };
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
      let data;
      const base = _backendUrl();
      if (base) {
        // Only call backend when an explicit URL is configured (avoids unnecessary
        // network round-trips on GitHub Pages / offline, which freeze mobile browsers)
        try {
          data = await _post('/api/custom-policy/generate', payload);
        } catch (_) {
          data = _generateClientSide(payload);
        }
      } else {
        data = _generateClientSide(payload);
      }
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
      let data;
      const base = _backendUrl();
      if (base) {
        try {
          data = await _post('/api/custom-policy/validate', payload);
        } catch (_) {
          data = _validateClientSide(payload);
        }
      } else {
        data = _validateClientSide(payload);
      }
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
      warningsEl.innerHTML = `<div class="cp-msg cp-msg-error">Validation failed: ${_esc(err.message)}</div>`;
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
    init,
    // base sections
    _addVlan,        _removeVlan,        _updateVlan,
    _addPeerGroup,   _removePeerGroup,   _updatePG,
    _addPrefixList,  _removePL,          _updatePL,
    _addInterface,   _removeIface,       _updateIface,
    // platform-aware UI
    _onPlatformChange,
    _onQosToggle,    _applyQosPreset,
    // Palo Alto
    _addZone,        _removeZone,        _updateZone,
    _addSecRule,     _removeSecRule,     _updateSecRule,
    _addNatRule,     _removeNatRule,     _updateNatRule,
    // Fortinet
    _addFwPolicy,    _removeFwPolicy,    _updateFwPolicy,
    _addVip,         _removeVip,         _updateVip,
    // output
    _copyConfig,
    generate,
    validate,
  };

  function init() {
    _renderVlans();
    _renderPeerGroups();
    _renderPrefixLists();
    _renderInterfaces();
    _renderZones();
    _renderSecRules();
    _renderNatRules();
    _renderFwPolicies();
    _renderVips();
    // set initial section visibility based on default platform (cisco_ios)
    _onPlatformChange();
  }

})();

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => CustomPolicy.init());
} else {
  CustomPolicy.init();
}
