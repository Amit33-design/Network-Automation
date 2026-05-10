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
          else c += `  ip address ${i.ip_address}\n`;
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
          else c += `   ip address ${i.ip_address}\n`;
          c += `   no shutdown\n!\n`;
        });
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
          p.bgp.peer_groups?.forEach(pg => {
            c += `  neighbor ${pg.name} activate\n`;
          });
          c += ' exit-address-family\n!\n';
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
