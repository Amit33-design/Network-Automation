'use strict';

/* ════════════════════════════════════════════════════════════════
   TROUBLESHOOTING ENGINE
   Standalone network analysis tool — works against existing infra,
   no NetDesign design required.
════════════════════════════════════════════════════════════════ */

const TsEngine = (() => {

  /* ── State ───────────────────────────────────────────────────── */
  let _devices  = [];   // [{ hostname, ip, platform, status }]
  let _links    = [];   // [{ localDev, localPort, remoteDev, remotePort, status }]
  let _snmpTimer = null;
  let _eventCount = 0;

  /* ── Helpers ─────────────────────────────────────────────────── */
  function _log(msg, type = '') {
    const log = document.getElementById('ts-snmp-log');
    if (!log) return;
    _eventCount++;
    _updateStat('ts-stat-events', _eventCount);
    const ts  = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = 'ts-event-line' + (type ? ' ' + type : '');
    div.textContent = `[${ts}] ${msg}`;
    // Remove placeholder
    log.querySelector('[style*="text-align"]')?.remove();
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function _updateStat(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function _backendUrl() {
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
    const url = _backendUrl() + path;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._authHeader() },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  /* ── Discovery ───────────────────────────────────────────────── */
  async function discover() {
    const seeds   = (document.getElementById('ts-seed-hosts')?.value     || '').trim();
    const comm    = (document.getElementById('ts-snmp-community')?.value  || 'public').trim();
    const ver     = document.getElementById('ts-snmp-ver')?.value         || 'v2c';
    const v3user  = (document.getElementById('ts-snmp-v3-user')?.value   || '').trim();

    if (!seeds) { _showStatus('Enter at least one seed host or IP range', 'warn'); return; }

    _showStatus('⏳ Discovering…', '');
    const base = _backendUrl();
    if (!base) {
      _simulateDiscovery(seeds.split('\n').map(s => s.trim()).filter(Boolean));
      return;
    }
    try {
      const result = await _post('/api/troubleshoot/discover', { seeds: seeds.split('\n').map(s=>s.trim()).filter(Boolean), community: comm, version: ver, v3_user: v3user });
      _devices = result.devices || [];
      _links   = result.links   || [];
      _renderTopology();
      _showStatus(`✅ Found ${_devices.length} devices, ${_links.length} links`, 'ok');
    } catch (e) {
      _showStatus(`Backend unavailable — simulating discovery`, 'warn');
      _simulateDiscovery(seeds.split('\n').map(s => s.trim()).filter(Boolean));
    }
  }

  function _simulateDiscovery(seeds) {
    _devices = seeds.slice(0, 12).map((ip, i) => ({
      hostname: `device-${String(i+1).padStart(2,'0')}`,
      ip,
      platform: ['Cisco NX-OS', 'Arista EOS', 'Juniper Junos', 'SONiC'][i % 4],
      status: i % 7 === 0 ? 'down' : i % 5 === 0 ? 'degraded' : 'up',
    }));
    // Simulate chain links
    _links = _devices.slice(0, -1).map((d, i) => ({
      localDev: d.hostname, localPort: `Ethernet1/${i+1}`,
      remoteDev: _devices[i+1].hostname, remotePort: `Ethernet1/${i+1}`,
      status: i % 4 === 0 ? 'down' : 'up',
    }));
    _renderTopology();
    _showStatus(`✅ Simulated ${_devices.length} devices, ${_links.length} links (no backend)`, 'ok');
  }

  /* ── CDP / LLDP Parser ───────────────────────────────────────── */
  function parseNeighbors() {
    const raw = (document.getElementById('ts-neighbor-input')?.value || '').trim();
    if (!raw) { _showPreview('Paste neighbor output first'); return; }

    const newDevices = new Map();
    const newLinks   = [];
    let current = {};

    // Regex patterns for CDP detail / LLDP detail
    const patterns = {
      deviceId:    /Device ID[:\s]+([^\n,]+)/i,
      ip:          /IP address[:\s]+(\d+\.\d+\.\d+\.\d+)/i,
      platform:    /Platform[:\s]+([^,\n]+)/i,
      localIface:  /Interface[:\s]+([^,\n]+),?\s*Port ID/i,
      remoteIface: /Port ID[^:]*[:\s]+([^\n]+)/i,
      // LLDP variants
      sysName:     /System Name[:\s]+([^\n]+)/i,
      portDescr:   /Port Description[:\s]+([^\n]+)/i,
    };

    // Split on blank line or "---" separators
    const blocks = raw.split(/\n(?=Device ID|System Name|\-{3,})/gi).filter(b => b.trim());

    blocks.forEach(block => {
      const devId   = (block.match(patterns.deviceId)  || block.match(patterns.sysName))?.[1]?.trim();
      const ip      = block.match(patterns.ip)?.[1]?.trim()      || '';
      const plat    = block.match(patterns.platform)?.[1]?.trim() || 'Unknown';
      const lIface  = block.match(patterns.localIface)?.[1]?.trim() || '';
      const rIface  = (block.match(patterns.remoteIface)?.[1] || block.match(patterns.portDescr)?.[1] || '').trim();

      if (!devId) return;

      if (!newDevices.has(devId)) {
        newDevices.set(devId, { hostname: devId, ip, platform: plat.replace(/\s+/g,' '), status: 'up' });
      }

      if (lIface && rIface) {
        newLinks.push({ localDev: '(local)', localPort: lIface, remoteDev: devId, remotePort: rIface, status: 'up' });
      }
    });

    // Merge into _devices / _links
    newDevices.forEach(d => { if (!_devices.find(x => x.hostname === d.hostname)) _devices.push(d); });
    newLinks.forEach(l => _links.push(l));

    const preview = [...newDevices.values()].map(d =>
      `${d.hostname.padEnd(24)} ${d.ip.padEnd(16)} ${d.platform}`
    ).join('\n');

    document.getElementById('ts-topo-preview').textContent = preview || 'No devices parsed — check input format';
    _renderTopology();
    _showStatus(`✅ Parsed ${newDevices.size} neighbors, ${newLinks.length} links`, 'ok');
  }

  /* ── Topology Render ─────────────────────────────────────────── */
  function _renderTopology() {
    _updateStat('ts-stat-devices', _devices.length);
    _updateStat('ts-stat-links',   _links.length);

    const issueCount = _devices.filter(d => d.status !== 'up').length +
                       _links.filter(l => l.status !== 'up').length;
    _updateStat('ts-stat-issues', issueCount);

    const empty   = document.getElementById('ts-topo-empty');
    const content = document.getElementById('ts-topo-content');
    if (!_devices.length) { if(empty) empty.style.display=''; if(content) content.style.display='none'; return; }
    if (empty)   empty.style.display   = 'none';
    if (content) content.style.display = '';

    // Devices table
    const dtbody = document.getElementById('ts-device-tbody');
    if (dtbody) {
      dtbody.innerHTML = _devices.map(d => {
        const badge = d.status === 'up' ? '<span class="ts-status-badge ts-badge-ok">UP</span>'
          : d.status === 'down'         ? '<span class="ts-status-badge ts-badge-down">DOWN</span>'
          :                              '<span class="ts-status-badge ts-badge-warn">DEGRADED</span>';
        return `<tr><td>${d.hostname}</td><td>${d.ip||'—'}</td><td>${d.platform||'—'}</td><td>${badge}</td></tr>`;
      }).join('');
    }

    // Links table
    const ltbody = document.getElementById('ts-link-tbody');
    if (ltbody) {
      ltbody.innerHTML = _links.map(l => {
        const badge = l.status === 'up' ? '<span class="ts-status-badge ts-badge-ok">UP</span>'
          :                               '<span class="ts-status-badge ts-badge-down">DOWN</span>';
        return `<tr><td>${l.localDev}</td><td>${l.localPort}</td><td>${l.remoteDev}</td><td>${l.remotePort}</td><td>${badge}</td></tr>`;
      }).join('');
    }
  }

  /* ── SNMP Polling ────────────────────────────────────────────── */
  function startSnmpPoll() {
    const targets  = (document.getElementById('ts-snmp-targets')?.value || '').split('\n').map(s=>s.trim()).filter(Boolean);
    const interval = +(document.getElementById('ts-snmp-interval')?.value || 30) * 1000;
    const oids     = (document.getElementById('ts-snmp-oids')?.value     || 'ifOperStatus').split(',').map(s=>s.trim()).filter(Boolean);
    const community= (document.getElementById('ts-snmp-community')?.value || 'public').trim();

    if (!targets.length) { _log('No SNMP targets configured', 'warn'); return; }
    if (_snmpTimer) clearInterval(_snmpTimer);

    document.getElementById('ts-snmp-status').textContent = '● Polling';
    document.getElementById('ts-snmp-status').style.color = 'var(--green)';

    const _poll = async () => {
      const base = _backendUrl();
      if (base) {
        try {
          const res = await _post('/api/troubleshoot/snmp-poll', { targets, community, oids });
          (res.events || []).forEach(ev => _log(`[${ev.host}] ${ev.oid}: ${ev.value}`, ev.severity === 'error' ? 'err' : ev.severity === 'warning' ? 'warn' : 'ok'));
        } catch {
          _log('Backend unreachable — simulating SNMP', 'warn');
          _simulateSnmpEvent(targets, oids);
        }
      } else {
        _simulateSnmpEvent(targets, oids);
      }
    };

    _poll();
    _snmpTimer = setInterval(_poll, interval);
  }

  function stopSnmpPoll() {
    if (_snmpTimer) { clearInterval(_snmpTimer); _snmpTimer = null; }
    const s = document.getElementById('ts-snmp-status');
    if (s) { s.textContent = 'Stopped'; s.style.color = 'var(--txt3)'; }
  }

  function clearSnmpLog() {
    const log = document.getElementById('ts-snmp-log');
    if (log) log.innerHTML = '<div style="color:var(--txt3);text-align:center;padding-top:2rem">SNMP event log cleared</div>';
  }

  const _SNMP_SIMS = [
    ['ifOperStatus', 'ifOperStatus.Ethernet1/1 = 1 (up)',         'ok'],
    ['bgpPeerState', 'bgpPeerState.10.0.0.2 = 6 (established)',   'ok'],
    ['sysUpTime',    'sysUpTime = 8d 14h 22m 11s',                'ok'],
    ['ifOperStatus', 'ifOperStatus.Ethernet1/3 = 2 (down)',        'err'],
    ['bgpPeerState', 'bgpPeerState.10.0.0.5 = 2 (active)',        'warn'],
    ['ifHCInOctets', 'ifHCInOctets.Ethernet1/1 = 98712345678',    'ok'],
    ['ifInErrors',   'ifInErrors.Ethernet1/2 = 142 (CRC errors)', 'warn'],
  ];
  let _simIdx = 0;
  function _simulateSnmpEvent(targets, oids) {
    const sim = _SNMP_SIMS[_simIdx++ % _SNMP_SIMS.length];
    const host = targets[Math.floor(Math.random() * targets.length)];
    if (oids.some(o => sim[0].toLowerCase().includes(o.toLowerCase()) || o === sim[0])) {
      _log(`[${host}] ${sim[1]}`, sim[2]);
    } else {
      _log(`[${host}] ${oids[0]}: OK`, 'ok');
    }
  }

  /* ── Diagnostic Playbooks ────────────────────────────────────── */
  const _PLAYBOOKS = {
    'bgp-down': {
      title: '🔴 BGP Neighbor Down — Diagnostic Steps',
      steps: [
        { cmd: 'show bgp summary',          desc: 'Check peer state (Idle/Active/Established)' },
        { cmd: 'show bgp neighbors <peer>', desc: 'Check hold-time, keepalive, error notifications' },
        { cmd: 'show ip route bgp',         desc: 'Verify BGP prefixes in routing table' },
        { cmd: 'show interface <iface>',    desc: 'Verify underlay interface is up/up' },
        { cmd: 'ping <peer-ip> source <lo>',desc: 'Test reachability to BGP peer loopback' },
        { cmd: 'show bgp neighbors <peer> policy', desc: 'Verify no policy is filtering all prefixes' },
      ],
      checks: [
        'Is the AS number correct on both sides?',
        'Are authentication passwords matching?',
        'Is the update-source interface up?',
        'Are ACLs blocking TCP 179?',
        'Is the peer IP reachable via IGP?',
        'Did a config change happen recently? (check "show logging")',
      ],
    },
    'interface-flap': {
      title: '🟡 Interface Flapping — Diagnostic Steps',
      steps: [
        { cmd: 'show interface <iface>',       desc: 'Check flap counter, CRC, input errors' },
        { cmd: 'show logging | grep <iface>',  desc: 'Find up/down events and timestamps' },
        { cmd: 'show interface <iface> transceiver', desc: 'Check Rx/Tx power, SFP health' },
        { cmd: 'show cdp/lldp neighbors <iface>', desc: 'Verify peer is still detected' },
        { cmd: 'show interface counters errors',  desc: 'CRC, runts, giants, input errors' },
      ],
      checks: [
        'Check physical cable — reseat SFP on both ends',
        'Verify duplex/speed match (no auto-neg mismatch)',
        'Check DOM Rx power — below −10 dBm = bad cable/SFP',
        'Look for ESD events or power issues on the line card',
        'Is storm-control threshold too low? (causing port shutdown)',
        'Check if spanning-tree portfast is configured correctly',
      ],
    },
    'high-cpu': {
      title: '🔴 High CPU / Memory — Diagnostic Steps',
      steps: [
        { cmd: 'show processes cpu sorted',    desc: 'Find top CPU consumers' },
        { cmd: 'show processes memory sorted', desc: 'Find memory hogs' },
        { cmd: 'show logging | grep CPUHOG',   desc: 'Check for CPU hog messages' },
        { cmd: 'show ip traffic',              desc: 'Check for broadcast/multicast storm' },
        { cmd: 'show interface counters',      desc: 'Look for high input/output rates' },
        { cmd: 'show storm-control',           desc: 'Verify storm-control is active' },
      ],
      checks: [
        'Is BGP or OSPF reconverging? (large routing table churn)',
        'Is there a broadcast/multicast storm on any VLAN?',
        'Are there too many ARP requests? (check CAM table size)',
        'Is software forwarding (process switching) being used instead of hardware?',
        'Is a management process (SNMP, syslog) consuming CPU?',
        'Consider rate-limiting control plane traffic with CoPP',
      ],
    },
    'packet-loss': {
      title: '🟡 Packet Loss / Latency — Diagnostic Steps',
      steps: [
        { cmd: 'ping <dest> count 1000',        desc: 'Baseline loss measurement' },
        { cmd: 'traceroute <dest>',             desc: 'Find where loss occurs in path' },
        { cmd: 'show queue statistics',         desc: 'Check QoS queue drops' },
        { cmd: 'show interface counters drops', desc: 'Input/output drops per interface' },
        { cmd: 'show ip cef <dest>',            desc: 'Verify CEF/ECMP forwarding path' },
        { cmd: 'show policy-map interface',     desc: 'Check QoS policy drops per class' },
      ],
      checks: [
        'Is there a QoS mismatch? (DSCP remarking at boundary)',
        'Is the interface running at 100% utilization? (check bps)',
        'Are ECMP paths balanced? (check hash polarization)',
        'Is there a buffer overflow on a specific queue?',
        'Are MTU mismatches causing fragmentation/drops?',
        'Is ICMP rate-limited on intermediate hops? (use UDP traceroute)',
      ],
    },
    'stp-issue': {
      title: '🟡 Spanning Tree Issue — Diagnostic Steps',
      steps: [
        { cmd: 'show spanning-tree detail',          desc: 'Check root bridge, port roles/states' },
        { cmd: 'show spanning-tree summary',         desc: 'Quick overview of all VLANs' },
        { cmd: 'show logging | grep TOPOLOGY',       desc: 'Find TCN events and frequency' },
        { cmd: 'show mac address-table count',       desc: 'Rapid MAC churn = possible loop' },
        { cmd: 'show spanning-tree inconsistentports', desc: 'Find BPDU guard/loop guard blocked ports' },
      ],
      checks: [
        'Is the root bridge the intended device? (check priority)',
        'Are any edge ports receiving BPDUs? (BPDU Guard will disable them)',
        'Is topology change notification (TCN) firing rapidly?',
        'Are trunk ports in forwarding state on all intended VLANs?',
        'Is PortFast enabled on access ports only (not trunk)?',
        'Consider enabling RSTP (802.1w) if running classic STP',
      ],
    },
    'vlan-missing': {
      title: '⚪ VLAN / L2 Reachability — Diagnostic Steps',
      steps: [
        { cmd: 'show vlan brief',                  desc: 'Verify VLAN exists and is active' },
        { cmd: 'show interface trunk',             desc: 'Check VLAN is in allowed list' },
        { cmd: 'show mac address-table vlan <id>', desc: 'Verify MAC is learned on correct port' },
        { cmd: 'show arp',                         desc: 'Check ARP resolution for gateway' },
        { cmd: 'show interface <svi> status',      desc: 'Verify SVI is up/up' },
        { cmd: 'show ip interface brief',          desc: 'Check L3 interfaces are up' },
      ],
      checks: [
        'Is the VLAN created on every switch in the path?',
        'Is the VLAN in the allowed list on all trunk ports?',
        'Is the native VLAN consistent on both ends of each trunk?',
        'Is the SVI / L3 gateway up?',
        'Are there any VTP conflicts or VTP mode mismatches?',
        'Check private VLAN or VLAN ACL (VACL) config',
      ],
    },
    'evpn-vxlan': {
      title: '🔵 EVPN / VXLAN Issue — Diagnostic Steps',
      steps: [
        { cmd: 'show bgp l2vpn evpn summary',        desc: 'Check EVPN peer state' },
        { cmd: 'show nve peers',                      desc: 'Verify VXLAN tunnel state' },
        { cmd: 'show bgp l2vpn evpn vni <id>',       desc: 'Check type-2/type-3 routes for VNI' },
        { cmd: 'show vxlan vni',                      desc: 'Verify VNI → VLAN mapping' },
        { cmd: 'show mac address-table vni <id>',    desc: 'Verify remote MACs learned over VXLAN' },
        { cmd: 'show nve interface nve1',             desc: 'NVE source IP, state, VNIs' },
      ],
      checks: [
        'Is the underlay (OSPF/IS-IS) fully converged?',
        'Is the VTEP loopback advertised in the underlay?',
        'Is the VNI correctly mapped to the VLAN on both ends?',
        'Are the EVPN route-targets matching (import/export)?',
        'Is the NVE interface up and using the correct source loopback?',
        'Is L3 EVPN (IRB/distributed anycast gateway) configured if needed?',
      ],
    },
    'rdma-pfc': {
      title: '🧠 RoCEv2 / PFC Issue — Diagnostic Steps',
      steps: [
        { cmd: 'show interface counters qos',        desc: 'Check PFC pause frames sent/received' },
        { cmd: 'show queuing interface <iface>',     desc: 'Check queue depth and drops' },
        { cmd: 'show interface <iface> priority-flow-control', desc: 'Verify PFC mode on/off per priority' },
        { cmd: 'show system qos',                    desc: 'Verify system QoS policy is applied' },
        { cmd: 'show interface counters errors',     desc: 'Check for CRC/FCS errors causing retransmits' },
        { cmd: 'show roce detail',                   desc: 'RoCEv2 stats (on supported platforms)' },
      ],
      checks: [
        'Is PFC enabled on the same priorities on both ends?',
        'Is ECN correctly configured (min/max thresholds match buffer size)?',
        'Is there a PFC storm? (pause frames with no traffic = misconfiguration)',
        'Are DSCP markings preserved end-to-end? (check remarking at boundaries)',
        'Is the buffer pool sized correctly for lossless queues?',
        'Is jumbo MTU (9216) configured consistently across the AI fabric?',
        'Are any access-list or policy-map rules dropping RoCEv2 traffic (DSCP 26)?',
      ],
    },
  };

  function runPlaybook(name) {
    const pb  = _PLAYBOOKS[name];
    const out = document.getElementById('ts-playbook-output');
    if (!pb || !out) return;
    out.style.display = '';

    const stepsHtml = pb.steps.map(s => `
      <div style="display:flex;gap:.75rem;align-items:flex-start;margin:.4rem 0">
        <code style="background:var(--bg4);padding:.15rem .45rem;border-radius:4px;white-space:nowrap;font-size:.76rem;flex-shrink:0">${s.cmd}</code>
        <span style="color:var(--txt2);font-size:.8rem">${s.desc}</span>
      </div>`).join('');

    const checksHtml = pb.checks.map(c => `
      <div style="display:flex;gap:.5rem;margin:.25rem 0">
        <span style="color:var(--cyan);flex-shrink:0">→</span>
        <span style="font-size:.8rem;color:var(--txt)">${c}</span>
      </div>`).join('');

    out.innerHTML = `
      <div style="font-weight:700;font-size:.92rem;margin-bottom:.75rem;color:var(--txt0)">${pb.title}</div>
      <div style="font-size:.72rem;font-weight:700;letter-spacing:.08em;color:var(--txt3);text-transform:uppercase;margin-bottom:.4rem">Diagnostic Commands</div>
      ${stepsHtml}
      <div style="font-size:.72rem;font-weight:700;letter-spacing:.08em;color:var(--txt3);text-transform:uppercase;margin:.85rem 0 .4rem">Checklist</div>
      ${checksHtml}
    `;
    out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ── RCA (uses backend if available, else guidance) ──────────── */
  async function runRca() {
    const symptom = (document.getElementById('ts-rca-symptom')?.value || '').trim();
    const devices = (document.getElementById('ts-rca-devices')?.value || '').split(',').map(s=>s.trim()).filter(Boolean);
    const out     = document.getElementById('ts-rca-output');
    if (!symptom || !out) return;

    out.style.display = '';
    out.innerHTML = '<div style="color:var(--txt3)">⏳ Analyzing…</div>';

    const base = _backendUrl();
    if (base) {
      try {
        const res = await _post('/api/rca/analyze', { symptom, affectedDevices: devices, designId: null });
        _renderRcaResult(out, res);
        return;
      } catch { /* fall through to client-side */ }
    }
    _renderRcaClientSide(out, symptom, devices);
  }

  function _renderRcaResult(out, res) {
    const hyps = res.hypotheses || [];
    if (!hyps.length) { out.innerHTML = '<div style="color:var(--txt3)">No hypotheses generated</div>'; return; }
    out.innerHTML = hyps.map(h => `
      <div style="display:flex;gap:.75rem;align-items:flex-start;padding:.6rem;background:var(--bg4);border-radius:6px;margin:.4rem 0">
        <div style="width:38px;height:38px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-weight:800;color:var(--cyan);flex-shrink:0">${Math.round((h.confidence||0)*100)}%</div>
        <div>
          <div style="font-weight:700;font-size:.85rem">${h.hypothesis}</div>
          <div style="font-size:.76rem;color:var(--txt2);margin-top:.2rem">${h.evidence||''}</div>
          <div style="font-size:.72rem;color:var(--cyan);margin-top:.3rem">${(h.remediation||[]).join(' · ')}</div>
        </div>
      </div>`).join('');
  }

  function _renderRcaClientSide(out, symptom, devices) {
    const sl = symptom.toLowerCase();
    const candidates = [
      { kw: ['bgp','neighbor','peer','session'],   hypothesis:'BGP session down',           confidence:.87, evidence:'Symptom matches BGP peering failure pattern', remediation:['Check AS/auth','Verify underlay','show bgp neighbors'] },
      { kw: ['interface','flap','down','link'],    hypothesis:'Physical/optic link failure', confidence:.81, evidence:'Interface events indicate physical layer issue', remediation:['Check SFP DOM','Reseat cable','show interface counters'] },
      { kw: ['cpu','high','slow','performance'],   hypothesis:'Control-plane overload',      confidence:.76, evidence:'Performance degradation suggests CPU exhaustion', remediation:['show processes cpu sorted','Check for storms','Rate-limit SNMP'] },
      { kw: ['packet loss','drop','latency'],      hypothesis:'QoS queue congestion',        confidence:.79, evidence:'Loss pattern consistent with egress queue drops', remediation:['show queue statistics','Check DSCP markings','Expand buffer'] },
      { kw: ['vlan','reachab','l2','mac'],         hypothesis:'VLAN provisioning gap',       confidence:.83, evidence:'L2 reachability issue suggests missing VLAN config', remediation:['show vlan brief','Verify trunk allow list','Check SVI'] },
      { kw: ['rdma','roce','pfc','pause','lossless'], hypothesis:'PFC storm / buffer misconfiguration', confidence:.85, evidence:'RoCEv2 symptoms point to PFC or ECN misconfiguration', remediation:['Verify PFC priorities match','Check ECN thresholds','show interface counters qos'] },
      { kw: ['evpn','vxlan','vtep','vni'],         hypothesis:'EVPN/VXLAN signaling failure', confidence:.82, evidence:'Overlay symptom matches EVPN route or NVE issue', remediation:['show nve peers','Verify VNI-to-VLAN','Check underlay BGP'] },
    ];

    const matched = candidates
      .filter(c => c.kw.some(k => sl.includes(k)))
      .sort((a,b) => b.confidence - a.confidence)
      .slice(0, 3);

    if (!matched.length) {
      out.innerHTML = `<div style="color:var(--txt3)">No matching hypothesis — try describing the symptom more specifically (e.g. "BGP neighbor down", "interface flapping", "packet loss")</div>`;
      return;
    }
    _renderRcaResult(out, { hypotheses: matched.map(m => ({ hypothesis: m.hypothesis, confidence: m.confidence, evidence: m.evidence + (devices.length ? ` (affected: ${devices.join(', ')})` : ''), remediation: m.remediation })) });
  }

  /* ── Misc ────────────────────────────────────────────────────── */
  function clearAll() {
    _devices = []; _links = []; _eventCount = 0;
    ['ts-stat-devices','ts-stat-links','ts-stat-issues','ts-stat-events'].forEach(id => _updateStat(id, 0));
    const empty = document.getElementById('ts-topo-empty');
    const cont  = document.getElementById('ts-topo-content');
    if (empty) empty.style.display = '';
    if (cont)  cont.style.display  = 'none';
    _showStatus('Cleared', '');
  }

  function _showStatus(msg, type) {
    const el = document.getElementById('ts-discover-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = type === 'ok' ? 'var(--green)' : type === 'warn' ? 'var(--orange)' : 'var(--txt3)';
  }

  /* ── Public API ──────────────────────────────────────────────── */
  return { discover, parseNeighbors, startSnmpPoll, stopSnmpPoll, clearSnmpLog, runPlaybook, runRca, clearAll };

})();
