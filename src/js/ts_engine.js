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

    // ── Extract local hostname from CLI prompt (user@hostname> or hostname#) ──
    const promptMatch = raw.match(/^(\S+?)[@>](\S+?)(?:[>#])/m) ||
                        raw.match(/^(\S+)[>#]/m);
    const localHost = promptMatch ? (promptMatch[2] || promptMatch[1]) : '(local)';

    // ── Detect Juniper / tabular LLDP format ──────────────────────────
    // Header: "Local Interface  Parent Interface  Chassis Id  Port info  System Name"
    const juniperHdr = /Local Interface\s+Parent Interface\s+Chassis Id\s+Port info\s+System Name/i;
    if (juniperHdr.test(raw)) {
      const lines = raw.split('\n');
      // Find the header line to establish column offsets
      const hdrLineIdx = lines.findIndex(l => juniperHdr.test(l));
      const hdrLine    = lines[hdrLineIdx] || '';
      const colLocal   = hdrLine.search(/Local Interface/i);
      const colChassis = hdrLine.search(/Chassis Id/i);
      const colPort    = hdrLine.search(/Port info/i);
      const colSysName = hdrLine.search(/System Name/i);

      lines.slice(hdrLineIdx + 1).forEach(line => {
        if (!line.trim() || /^[-=\s]*$/.test(line)) return;
        // Tabular: extract by character position (columns are fixed-width padded)
        const localIface = line.substring(colLocal,   colChassis).trim();
        const chassis    = line.substring(colChassis, colPort).trim();
        const portInfo   = line.substring(colPort,    colSysName).trim();
        const sysName    = line.substring(colSysName).trim();

        if (!sysName || !localIface) return;

        if (!newDevices.has(sysName)) {
          newDevices.set(sysName, { hostname: sysName, ip: '', platform: chassis || 'Unknown', status: 'up' });
        }
        newLinks.push({ localDev: localHost, localPort: localIface, remoteDev: sysName, remotePort: portInfo, status: 'up' });
      });

    } else {
      // ── Cisco CDP detail / LLDP detail block format ──────────────────
      const patterns = {
        deviceId:    /Device ID[:\s]+([^\n,]+)/i,
        ip:          /IP address[:\s]+(\d+\.\d+\.\d+\.\d+)/i,
        platform:    /Platform[:\s]+([^,\n]+)/i,
        localIface:  /Interface[:\s]+([^,\n]+),?\s*Port ID/i,
        remoteIface: /Port ID[^:]*[:\s]+([^\n]+)/i,
        sysName:     /System Name[:\s]+([^\n]+)/i,
        portDescr:   /Port Description[:\s]+([^\n]+)/i,
        mgmtAddr:    /Management Address[^:]*:\s*\n\s*IP[:\s]+(\d+\.\d+\.\d+\.\d+)/i,
      };

      const blocks = raw.split(/\n(?=Device ID|System Name|\-{3,})/gi).filter(b => b.trim());
      blocks.forEach(block => {
        const devId  = (block.match(patterns.deviceId) || block.match(patterns.sysName))?.[1]?.trim();
        const ip     = (block.match(patterns.ip) || block.match(patterns.mgmtAddr))?.[1]?.trim() || '';
        const plat   = block.match(patterns.platform)?.[1]?.trim() || 'Unknown';
        const lIface = block.match(patterns.localIface)?.[1]?.trim() || '';
        const rIface = (block.match(patterns.remoteIface)?.[1] || block.match(patterns.portDescr)?.[1] || '').trim();

        if (!devId) return;
        if (!newDevices.has(devId)) {
          newDevices.set(devId, { hostname: devId, ip, platform: plat.replace(/\s+/g,' '), status: 'up' });
        }
        if (lIface && rIface) {
          newLinks.push({ localDev: localHost, localPort: lIface, remoteDev: devId, remotePort: rIface, status: 'up' });
        }
      });
    }

    // ── Merge into _devices / _links ──────────────────────────────────
    newDevices.forEach(d => { if (!_devices.find(x => x.hostname === d.hostname)) _devices.push(d); });
    // Add local device itself if it has links
    if (newLinks.length && !_devices.find(x => x.hostname === localHost)) {
      _devices.push({ hostname: localHost, ip: '', platform: 'local', status: 'up' });
    }
    newLinks.forEach(l => _links.push(l));

    const preview = [...newDevices.values()].map(d =>
      `${d.hostname.padEnd(30)} ${d.ip.padEnd(16)} ${d.platform}`
    ).join('\n');

    document.getElementById('ts-topo-preview').textContent = preview || 'No devices parsed — check input format';
    _renderTopology();
    _showStatus(`✅ Parsed ${newDevices.size} neighbors, ${newLinks.length} links (local: ${localHost})`, 'ok');
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

    // ── RCA knowledge base ────────────────────────────────────────────
    // Each entry: kw[] = keywords to match (any), hypothesis, confidence,
    // layer, evidence description, step-by-step investigation, remediation cmds
    const KB = [

      /* ── Layer 1: Physical ──────────────────────────────────────── */
      {
        kw: ['sfp','optic','dom','transceiver','laser','rx power','tx power','light'],
        layer:'L1 Physical', hypothesis:'Faulty / degraded SFP or optic',
        confidence:.88,
        evidence:'Optical symptoms (power alarms, CRC errors, intermittent link) point to SFP DOM threshold violation or dirty/damaged connector.',
        steps:['Check SFP DOM: show interfaces <iface> transceiver detail','Look for Rx/Tx power outside -3 dBm operating range','Inspect fiber end-face for contamination or bend radius violation','Swap SFP with known-good spare','Test fiber with OTDR or optical power meter'],
        remediation:['show interfaces transceiver','Clean fiber connector (IEC 61300-3-35)','Replace SFP / fiber patch'],
      },
      {
        kw: ['interface','flap','down','link','carrier','err-disabled','shutdown'],
        layer:'L1 Physical', hypothesis:'Physical link instability or err-disable',
        confidence:.83,
        evidence:'Repeated link up/down events indicate physical layer issue: bad cable, SFP, duplex mismatch, or err-disable triggered by BPDU/port-security.',
        steps:['show interface <iface> — look for input/output errors, CRC, flaps','show log | include <iface> — check timing of events','Check auto-negotiation: force speed/duplex if peer does not support autoneg','Verify err-disable cause: show interfaces status err-disabled','Check cable length/type (Cat6A for 10G, single-mode for LR)'],
        remediation:['show interfaces status err-disabled','errdisable recovery cause all','Force speed duplex: speed 1000; duplex full'],
      },
      {
        kw: ['duplex','half duplex','auto-neg','autoneg','negotiation'],
        layer:'L1 Physical', hypothesis:'Duplex or speed mismatch',
        confidence:.84,
        evidence:'Duplex mismatch causes late collisions on the half-duplex side and CRC/FCS errors on the full-duplex side with very high utilization discrepancy.',
        steps:['show interfaces — compare input/output utilization on both ends','Look for late collisions (indicates duplex mismatch)','Verify both sides force same speed and duplex','Check NIC teaming or bonding overrides'],
        remediation:['interface EthX; speed 10000; duplex full; no shutdown','Disable auto-neg on NIC: ethtool -s eth0 speed 10000 duplex full autoneg off'],
      },

      /* ── Layer 2: Switching ──────────────────────────────────────── */
      {
        kw: ['stp','spanning tree','topology change','bpdu','reconverg','loop','broadcast storm'],
        layer:'L2 STP', hypothesis:'STP topology change or broadcast storm',
        confidence:.87,
        evidence:'Rapid topology changes cause MAC table flushes and flooding. Sustained broadcast storms peg CPU and collapse forwarding.',
        steps:['show spanning-tree — identify root bridge and port roles','show spanning-tree detail | include topology','Check for TCN storms: show spanning-tree summary totals','Identify rogue device sending superior BPDUs','Enable BPDU Guard on access ports (portfast + bpduguard)'],
        remediation:['spanning-tree portfast bpduguard default','show spanning-tree topology-change','debug spanning-tree events (brief)','Enable RSTP/MST if still running legacy STP'],
      },
      {
        kw: ['mac','mac table','mac flood','cam','overflow','unknown unicast'],
        layer:'L2 Switching', hypothesis:'MAC table overflow / flooding attack',
        confidence:.80,
        evidence:'MAC table saturation causes unknown unicast flooding, raising CPU and creating a broadcast-like traffic pattern across all ports.',
        steps:['show mac address-table count — compare used vs capacity','Check for port with thousands of source MACs (MAC flood tool)','Enable port-security or 802.1X to limit MACs per port','Review syslog for %SW_MATM-4-MACFLAP_NOTIF entries'],
        remediation:['switchport port-security maximum 5','switchport port-security violation restrict','ip dhcp snooping (prevents IP spoofing along with MAC flood)'],
      },
      {
        kw: ['vlan','trunk','native vlan','allowed vlan','access vlan','dot1q','tagging'],
        layer:'L2 VLAN', hypothesis:'VLAN misconfiguration or trunk mismatch',
        confidence:.84,
        evidence:'Missing VLAN in allowed list or native VLAN mismatch causes traffic blackholing or unintended inter-VLAN flooding.',
        steps:['show interfaces trunk — check allowed VLANs and native VLAN','show vlan brief — verify VLAN exists in database','Compare trunk allowed list on both ends of the link','Check SVI is up/up: show ip interface brief | include Vlan'],
        remediation:['switchport trunk allowed vlan add <id>','switchport trunk native vlan <id>','vlan <id> ; name <name>','interface VlanX ; no shutdown'],
      },
      {
        kw: ['lacp','port-channel','bond','lag','aggregation','member port','etherchannel'],
        layer:'L2 LACP', hypothesis:'LACP / Port-Channel misconfiguration or flap',
        confidence:.85,
        evidence:'Port-channel instability causes traffic interruption. Common causes: LACP key/mode mismatch, speed mismatch between members, hash imbalance.',
        steps:['show etherchannel summary — verify all members are in P (bundled) state','show lacp neighbor — compare system-id and port-key','Verify all members same speed, duplex, VLAN config','Check LACP timers: fast vs slow (must match peer)','Review LACP PDU counters for drops'],
        remediation:['channel-group X mode active (both ends active for LACP)','Ensure all member ports identical config','lacp rate fast','show lacp counters'],
      },

      /* ── Layer 3: Routing ───────────────────────────────────────── */
      {
        kw: ['bgp','neighbor','peer','session','established','open','notification','hold timer'],
        layer:'L3 BGP', hypothesis:'BGP session failure',
        confidence:.89,
        evidence:'BGP peering failure is typically caused by: AS mismatch, MD5 auth failure, unreachable next-hop, hold-timer expiry, or policy blocking updates.',
        steps:['show bgp neighbors <ip> — check state and last error','Ping BGP peer src loopback — verify underlay reachability','Check TTL: eBGP needs TTL≥1, use ebgp-multihop if multi-hop','Verify MD5 password matches on both sides','Check local-as, remote-as match peer config','Review inbound/outbound policy: show route-policy','Check max-prefix limit not reached'],
        remediation:['show bgp neighbors <ip> | include state|error|prefix','clear bgp <ip> soft (soft reset without dropping session)','debug bgp neighbor <ip> events','show bgp summary'],
      },
      {
        kw: ['ospf','adjacency','neighbor','exstart','exchange','dead interval','hello','lsa','database'],
        layer:'L3 OSPF', hypothesis:'OSPF adjacency failure',
        confidence:.87,
        evidence:'OSPF neighbors stuck in EXSTART/EXCHANGE usually indicate MTU mismatch. Stuck in INIT means hellos are one-way. Area/auth mismatch keeps state at DOWN.',
        steps:['show ip ospf neighbor — check state and dead time','Verify hello/dead intervals match on both ends (default 10/40s)','Check MTU: ip ospf mtu-ignore if MTU mismatch between peers','Verify area IDs and area types match (stub/NSSA)','Check authentication type/password','Verify network statement covers the interface subnet'],
        remediation:['ip ospf mtu-ignore (if MTU mismatch)','show ip ospf interface <iface>','debug ip ospf adj','show ip ospf database'],
      },
      {
        kw: ['isis','is-is','adjacency','clns','tlv','metric','level','circuit'],
        layer:'L3 IS-IS', hypothesis:'IS-IS adjacency or route failure',
        confidence:.83,
        evidence:'IS-IS adjacency failures are caused by: area address mismatch, system-id collision, metric-style mismatch (narrow vs wide), or authentication failure.',
        steps:['show isis neighbors — verify state is UP','Check area address: must match for L1, does not matter for L2','Verify metric-style: isis metric-style wide (both ends)','Check IS-IS authentication key/type','show isis database — look for missing prefixes','Verify interface in IS-IS process: show isis interface'],
        remediation:['isis metric-style wide','show clns neighbors detail','show isis adjacency','clear isis * (use with caution)'],
      },
      {
        kw: ['route','routing table','prefix','missing route','blackhole','null','unreachable'],
        layer:'L3 Routing', hypothesis:'Missing or incorrect route',
        confidence:.81,
        evidence:'Traffic blackholing or unreachability without a protocol event suggests a static route is missing, redistributed incorrectly, or filtered by route-policy.',
        steps:['show ip route <dest> — trace exact match and recursive resolution','show ip route longer-prefixes <prefix/len>','Check route redistribution: show ip protocols','Verify route-map/prefix-list not filtering the prefix','Check administrative distance: preferred protocol winning?','Test: traceroute from both ends to pinpoint where path breaks'],
        remediation:['ip route <dest> <mask> <nexthop> (add static)','show route-policy (Cisco IOS-XR)','show ip route summary','traceroute <dest> source <loopback>'],
      },
      {
        kw: ['mtu','fragmentation','pmtud','jumbo','1500','9000','df bit','icmp unreachable'],
        layer:'L3 MTU', hypothesis:'MTU / PMTUD blackhole',
        confidence:.86,
        evidence:'Connections that work for small packets but fail for large ones are a classic PMTUD blackhole — an intermediate device drops oversized frames without sending ICMP Fragmentation Needed.',
        steps:['ping <dest> size 1472 df-bit (test 1500B path)','ping <dest> size 8972 df-bit (test 9000B jumbo path)','show interfaces — compare MTU values hop-by-hop','Check if ICMP type 3 code 4 is filtered by firewall/ACL','Enable ip tcp adjust-mss 1452 on WAN-facing interfaces'],
        remediation:['ip tcp adjust-mss 1452 (ingress WAN interface)','set interfaces xe-0/0/0 mtu 9000 (Juniper)','Permit ICMP unreachable through all ACLs/firewalls'],
      },
      {
        kw: ['arp','gratuitous','garp','arp table','duplicate ip','mac conflict'],
        layer:'L3 ARP', hypothesis:'ARP failure or IP/MAC conflict',
        confidence:.80,
        evidence:'ARP failures prevent L3 forwarding even when routing is correct. Duplicate IPs cause gratuitous ARP conflicts and intermittent drops.',
        steps:['show arp <ip> — verify correct MAC mapping','ping <gateway> — check ARP resolution','show log | include ARP — look for duplicate IP warnings','Check for IP overlap between static and DHCP pool','Verify proxy-ARP setting if hosts across routed segments'],
        remediation:['clear arp <ip>','no ip proxy-arp (if unintended proxy)','ip dhcp excluded-address <static-range>'],
      },
      {
        kw: ['asymmetric','rpf','reverse path','uRPF','spoofing','strict mode'],
        layer:'L3 Routing', hypothesis:'Asymmetric routing / uRPF failure',
        confidence:.79,
        evidence:'uRPF strict mode drops legitimate traffic when the return path differs from the forward path — common in ECMP or multi-homed scenarios.',
        steps:['show ip interface <iface> | include Verify','Check uRPF mode: strict (drops asymmetric) vs loose (only checks route exists)','Verify ECMP paths are symmetric across both directions','traceroute in both directions — compare hop sequence'],
        remediation:['ip verify unicast source reachable-via any (loose mode)','Disable uRPF on internal interfaces: no ip verify unicast source'],
      },

      /* ── Layer 3: MPLS ──────────────────────────────────────────── */
      {
        kw: ['mpls','ldp','lsp','label','rsvp','te tunnel','fec','lfib'],
        layer:'L3 MPLS', hypothesis:'MPLS LSP or LDP failure',
        confidence:.82,
        evidence:'MPLS forwarding failures occur when LDP sessions drop, FEC mapping is missing, or RSVP TE tunnels lose their signaled path.',
        steps:['show mpls ldp neighbor — verify all sessions up','show mpls forwarding-table — check label entries exist','Verify LDP discovery: show mpls ldp discovery','For TE: show mpls traffic-eng tunnels — check admin/oper state','Check RSVP bandwidth constraints if using TE'],
        remediation:['show mpls ldp bindings','show mpls ldp neighbor detail','mpls ldp router-id Loopback0 force','clear mpls ldp neighbor <ip> (use with caution)'],
      },

      /* ── Overlay / Tunnels ──────────────────────────────────────── */
      {
        kw: ['evpn','vxlan','vtep','vni','nve','overlay','mac mobility','type-2','type-5'],
        layer:'Overlay EVPN', hypothesis:'EVPN/VXLAN MAC or IP route failure',
        confidence:.85,
        evidence:'EVPN overlay reachability breaks when BGP EVPN sessions drop, VNI binding is wrong, type-2/type-5 routes are not imported, or VTEP encapsulation is mismatched.',
        steps:['show bgp l2vpn evpn — check for type-2 and type-5 routes','show nve peers — verify VTEP reachability and state','Verify VNI-to-VLAN mapping: show vxlan address-table','Check route-targets: import/export must match between VTEPs','Verify underlay: ping VTEP loopback src loopback','Check MAC mobility sequence numbers for duplicate MAC'],
        remediation:['show bgp l2vpn evpn route-type 2','show nve vni','Verify: vni <id> l2 vlan <vlan> (NX-OS)','clear bgp l2vpn evpn * soft (use with caution)'],
      },
      {
        kw: ['ipsec','vpn','tunnel','ike','isakmp','phase1','phase2','transform','proposal'],
        layer:'VPN IPSec', hypothesis:'IPSec VPN tunnel failure (IKE/Phase negotiation)',
        confidence:.86,
        evidence:'IPSec tunnel failures occur in IKE Phase 1 (mismatched encryption/hash/DH group or auth) or Phase 2 (mismatched transform-set or proxy ID/traffic selectors).',
        steps:['show crypto isakmp sa — check state (should be QM_IDLE)','show crypto ipsec sa — verify packet encrypt/decrypt counts incrementing','Verify Phase 1 match: encryption, hash, DH group, lifetime','Verify Phase 2 match: transform-set, PFS group, proxy-IDs','Check NAT traversal: is NAT between peers? Enable NAT-T (UDP 4500)','Verify pre-shared key or certificate matches on both ends'],
        remediation:['show crypto isakmp sa detail','debug crypto isakmp (brief use)','show crypto ipsec sa peer <ip>','clear crypto isakmp (use cautiously)'],
      },
      {
        kw: ['gre','tunnel','encapsulation','keepalive','mtu','tunnel down'],
        layer:'VPN GRE', hypothesis:'GRE tunnel failure or MTU issue',
        confidence:.78,
        evidence:'GRE tunnels fail due to underlay reachability loss, ACL blocking proto 47, or inner MTU causing fragmentation of GRE+outer headers.',
        steps:['Ping tunnel destination from tunnel source interface','Check ACL: GRE = IP protocol 47 (must be permitted)','Verify tunnel MTU = underlay MTU - 24 bytes (GRE overhead)','show interface Tunnel0 — check line protocol and keepalive','Verify no NAT translating tunnel source/dest'],
        remediation:['ip tcp adjust-mss 1436 (GRE overhead 24B + TCP 20B + IP 20B)','ip access-list extended — permit gre any any','tunnel keepalive 10 3'],
      },

      /* ── QoS & Performance ──────────────────────────────────────── */
      {
        kw: ['packet loss','drop','latency','jitter','queue','congestion','buffer'],
        layer:'QoS', hypothesis:'Egress queue congestion / QoS misconfiguration',
        confidence:.82,
        evidence:'Traffic loss without physical errors indicates egress queue drops. Latency spikes with no drops may indicate tail-drop before RED kicks in.',
        steps:['show queue statistics interface <iface> — look for tail-drops in specific queues','show policy-map interface <iface> — check class drop counts','Verify DSCP markings are preserved end-to-end (no remarking)','Check interface utilization: sustained >80% causes queuing','Review WRED min/max thresholds — too aggressive = pre-mature drops'],
        remediation:['show policy-map interface (Cisco)','show qos interface (Arista)','Adjust WRED thresholds','Move latency-sensitive traffic to priority queue (LLQ/EF DSCP 46)'],
      },
      {
        kw: ['rdma','roce','pfc','pause','lossless','priority flow control','ecn','congestion notification'],
        layer:'AI Fabric / RoCEv2', hypothesis:'PFC storm or ECN misconfiguration degrading RoCEv2',
        confidence:.88,
        evidence:'PFC pause frames should be confined to lossless priorities (typically P3/P4). A PFC storm or misconfigured ECN threshold causes global head-of-line blocking.',
        steps:['show interface counters qos | include pfc_pause — check pause frame counts','Verify PFC enabled only on lossless priority (e.g. priority 3)','Check ECN thresholds: min-threshold should be ~20% of buffer, max 80%','Verify DSCP→TC mapping is consistent switch-to-NIC','Check NIC RoCE config: roce pfc-priority 3; roce cnp-priority 6','Monitor CNP (Congestion Notification Packet) generation rate'],
        remediation:['show interface counters detailed (PFC counters)','Verify: dcbx mode ieee (both ends)','Set ECN: random-detect ecn minimum-threshold 150KB maximum-threshold 1500KB','Verify NIC: show roce counters'],
      },
      {
        kw: ['cpu','high cpu','control plane','policing','copp','punt','management'],
        layer:'Control Plane', hypothesis:'Control-plane CPU overload',
        confidence:.83,
        evidence:'High CPU is commonly caused by: excessive BGP updates, OSPF LSA storms, STP TCNs, SNMP polling overload, or ARP/ICMP flood punted to CPU.',
        steps:['show processes cpu sorted — identify top consumer','show platform rate-limiter — check punted packet rates','show copp statistics (Cisco) or show system-internal control-plane rates','Check SNMP walk frequency and OID count','Look for excessive log generation draining CPU'],
        remediation:['Tune CoPP policy to rate-limit ARP/ICMP','Reduce SNMP polling interval or use streaming telemetry','show ip traffic | include fragment (high frag = re-assembly load)','Tune BGP: adjust advertisement-interval 30'],
      },

      /* ── Security / ACL / Firewall ──────────────────────────────── */
      {
        kw: ['acl','access list','permit','deny','firewall','blocked','policy','rule','drop','filter'],
        layer:'Security ACL', hypothesis:'ACL or firewall policy blocking traffic',
        confidence:.84,
        evidence:'Traffic blocked by ACL/firewall typically shows no ICMP unreachable (implicit deny) or a specific reject. Hit counters help identify the offending rule.',
        steps:['show ip access-lists — look for unexpected hit counts on deny lines','Check firewall logs for drop reason and source/dest','Test with packet capture: tcpdump / ERSPAN to verify traffic is reaching firewall','Verify NAT is not interfering with policy match','Check stateful inspection: is return traffic being allowed?'],
        remediation:['show access-list <name> (check hit counts)','packet-tracer input <zone> tcp <src> <dst> 80 (Cisco ASA/FTD)','show conn (ASA) or show session (FortiGate)','Temporarily add log keyword to deny rules'],
      },
      {
        kw: ['nat','translation','snat','dnat','overload','pat','masquerade','port exhaustion'],
        layer:'Security NAT', hypothesis:'NAT translation table full or misconfigured',
        confidence:.81,
        evidence:'NAT port exhaustion causes new sessions to be silently dropped. Misconfigured NAT translates the wrong traffic or fails to create translations.',
        steps:['show ip nat translations total — check table size vs limit','show ip nat statistics — look for failed translations','Verify NAT rule order: more specific rules before general ones','Check NAT pool exhaustion: are all IPs/ports in use?','Verify access-list used for NAT correctly identifies traffic'],
        remediation:['ip nat translation max-entries 100000','show ip nat translations | count','Clear stale: clear ip nat translation *','Extend NAT pool or add PAT overload'],
      },
      {
        kw: ['ddos','flood','attack','syn flood','amplification','rate limit','scrubbing'],
        layer:'Security DDoS', hypothesis:'DDoS or traffic flood attack',
        confidence:.77,
        evidence:'Sudden traffic spike with uniform packet size/rate, spoofed sources, or known amplification vectors (DNS/NTP/SSDP) indicates volumetric or protocol DDoS.',
        steps:['show interface counters — look for pps spike on ingress','Capture sample: show ip traffic for protocol breakdown','Identify top talkers: show ip cache flow (NetFlow)','Check if BGP communities trigger RTBH (blackhole) upstream','Enable rate-limiting on amplification protocols (DNS UDP 53, NTP UDP 123)'],
        remediation:['ip access-list — rate-limit attack source','BGP RTBH: community no-export to upstream','Enable uRPF strict to drop spoofed sources','Activate upstream scrubbing center if available'],
      },

      /* ── DNS / DHCP / NTP ───────────────────────────────────────── */
      {
        kw: ['dns','resolution','nslookup','resolve','hostname','name server','dnssec','timeout'],
        layer:'Services DNS', hypothesis:'DNS resolution failure',
        confidence:.85,
        evidence:'DNS failure causes application-level outages even when IP routing works. Causes: unreachable resolver, wrong search domain, DNSSEC validation failure, split-DNS misconfiguration.',
        steps:['nslookup <hostname> <dns-server> — test direct to resolver','dig @<dns-ip> <hostname> +short — verify response','Check DNS server reachability: ping <dns-ip>','Verify firewall permits UDP/TCP 53 to resolver','Check /etc/resolv.conf or DHCP-provided DNS option 6','Test DNSSEC: dig @resolver <domain> +dnssec — look for AD flag'],
        remediation:['nslookup <hostname>','dig +trace <hostname> (full recursion trace)','Verify: ip name-server <ip> (Cisco) or set system name-server <ip> (Juniper)','Check split-DNS: internal vs external zones'],
      },
      {
        kw: ['dhcp','ip address','lease','pool','exhausted','scope','option','discover','offer'],
        layer:'Services DHCP', hypothesis:'DHCP pool exhaustion or relay misconfiguration',
        confidence:.83,
        evidence:'Clients failing to get an IP address are caused by DHCP pool full, incorrect relay-agent configuration, or a rogue DHCP server answering first.',
        steps:['show ip dhcp binding — count active leases vs pool size','show ip dhcp pool — check available addresses','show ip dhcp conflict — duplicate IPs causing blacklist','Verify ip helper-address on SVI/interface points to correct DHCP server','Check for rogue DHCP: DHCP snooping authoritative server vs untrusted ports'],
        remediation:['ip dhcp pool CORP; network 10.0.0.0 /22; lease 8','ip dhcp excluded-address 10.0.0.1 10.0.0.20','ip dhcp snooping (enable to block rogue DHCP)','Clear old bindings: clear ip dhcp binding *'],
      },
      {
        kw: ['ntp','clock','time','sync','stratum','drift','offset','peer'],
        layer:'Services NTP', hypothesis:'NTP synchronization failure',
        confidence:.80,
        evidence:'NTP failure causes certificate validation errors, log timestamp drift, and Kerberos/RADIUS authentication failures. Stratum 16 = unsynchronized.',
        steps:['show ntp status — verify synchronized, stratum < 10','show ntp associations — check peer reachability and offset','Ping NTP server — verify UDP 123 is not blocked','Check NTP authentication key matches','Verify system timezone is correct (NTP provides UTC)'],
        remediation:['ntp server <ip> prefer source Loopback0','ntp authenticate; ntp authentication-key 1 md5 <key>','show ntp associations detail','Permit UDP 123 inbound on perimeter firewall'],
      },

      /* ── Wireless / Campus ──────────────────────────────────────── */
      {
        kw: ['wireless','wifi','ssid','association','deauth','roaming','ap','wlan','eap','radius'],
        layer:'Wireless', hypothesis:'Wi-Fi association or RADIUS authentication failure',
        confidence:.79,
        evidence:'Wireless clients failing to associate are caused by: RADIUS timeout, EAP certificate mismatch, channel interference causing high retries, or AP-controller connectivity loss.',
        steps:['Check AP controller: are APs joined and client-serving?','Review RADIUS server logs for reject reason','Test RADIUS connectivity from WLC: radius-server test <ip>','Check channel utilization and SNR — interference causing high retry rate','Verify 802.1X supplicant certificate is valid and trusted','Check roaming: verify PMK caching or 802.11r FT enabled'],
        remediation:['show wireless client detail <mac>','show ap summary (WLC)','debug dot1x events (client-level)','Verify RADIUS shared secret matches on AP/WLC and RADIUS'],
      },

      /* ── Data Center Fabric ─────────────────────────────────────── */
      {
        kw: ['ecmp','load balance','hash','unequal','imbalance','elephant flow','link utilization'],
        layer:'DC Fabric ECMP', hypothesis:'ECMP hash imbalance or elephant flow',
        confidence:.78,
        evidence:'Uneven link utilization in a spine-leaf fabric indicates ECMP hash polarization or a persistent elephant flow overwhelming one path.',
        steps:['show interface counters — compare utilization across parallel links','Check ECMP hash inputs: src/dst IP, src/dst port, protocol','Enable flowlet switching to break elephant flows','Verify equal-cost routes exist: show ip route <prefix>','Use ECMP with RTAG7 hashing (Arista) or consistent hashing'],
        remediation:['ip load-sharing per-packet (last resort)','Flowlet: ip load-sharing address port universal-id <seed>','Check: show ip load-sharing (Cisco)','DCBX: verify traffic-class mapping for storage vs compute'],
      },
      {
        kw: ['spine','leaf','underlay','anycast','vtep loopback','ibgp','route reflector'],
        layer:'DC Fabric BGP', hypothesis:'Spine-leaf BGP underlay failure',
        confidence:.82,
        evidence:'BGP underlay failure in a spine-leaf fabric prevents VTEP loopbacks from being advertised, breaking all overlay (VXLAN/EVPN) connectivity.',
        steps:['show bgp summary — verify all spine-leaf iBGP sessions are Established','Verify loopback0 advertised in BGP: show bgp <loopback-prefix>','Check route reflector config on spine nodes','Ping VTEP loopback from all leaves','Verify next-hop-self on route reflectors for iBGP'],
        remediation:['neighbor <ip> next-hop-self','show bgp neighbors <spine-ip>','Verify: network <loopback>/32 (in BGP process)'],
      },
      {
        kw: ['storage','iscsi','nfs','cifs','smb','fc','fce','zoning','multipath','mpio'],
        layer:'Storage Network', hypothesis:'Storage network or multipath failure',
        confidence:.77,
        evidence:'Storage access failures in data center are caused by: iSCSI multipath imbalance, FC zoning gap, NFS stale file handle, or SMB signing mismatch.',
        steps:['Check multipath: multipath -ll (Linux) or mpclaim (Windows)','Verify all paths active: no single-path dependency','iSCSI: show iscsi session (initiator) — check target discovery','FC: show topology (fabric) — verify zone has both initiator and target','NFS: showmount -e <server> — verify export exists'],
        remediation:['multipathd reconfigure','iscsiadm -m session (rescan)','Verify Fibre Channel zone: zone name <z>; member pwwn <init>; member pwwn <target>'],
      },

      /* ── Monitoring & Management ────────────────────────────────── */
      {
        kw: ['snmp','community','oid','walk','timeout','mib','trap','version'],
        layer:'Mgmt SNMP', hypothesis:'SNMP community/version mismatch or ACL blocking',
        confidence:.76,
        evidence:'SNMP polling failures are caused by: wrong community string, version mismatch (v2c vs v3), ACL blocking UDP 161, or device CPU rate-limiting SNMP punts.',
        steps:['snmpwalk -v2c -c <community> <ip> sysDescr — test basic reachability','Check SNMP access-list: only NMS IPs should be permitted','Verify UDP 161 open: nc -uvz <ip> 161','Check SNMP group/user for v3: show snmp user','Review CPU rate-limiter for SNMP process'],
        remediation:['snmp-server community <string> RO <acl>','snmp-server host <nms-ip> version 2c <community>','ip access-list standard SNMP-ACL ; permit <nms-ip>'],
      },
      {
        kw: ['syslog','log','logging','messages','severity','facility','unreachable'],
        layer:'Mgmt Syslog', hypothesis:'Syslog server unreachable or misconfigured',
        confidence:.73,
        evidence:'Missing logs from network devices indicate: wrong syslog server IP, UDP 514 blocked, wrong facility/severity filter, or VRF routing for management traffic.',
        steps:['Ping syslog server from device management interface','Verify UDP 514 not blocked on mgmt firewall','Check VRF: logging source-interface Mgmt0 vrf management','Verify severity level: logging trap informational (or higher)','Test: logger -p local0.info "test" (Linux syslog test)'],
        remediation:['logging host <syslog-ip> vrf management','logging trap debugging','logging source-interface Loopback0'],
      },
      {
        kw: ['netflow','ipfix','flow','telemetry','collector','sampling','export'],
        layer:'Mgmt Telemetry', hypothesis:'NetFlow/IPFIX export failure',
        confidence:.72,
        evidence:'NetFlow collection gaps cause visibility blind spots. Common causes: wrong collector IP, UDP 2055/4739 blocked, sampling rate too high, or interface not in monitor session.',
        steps:['show flow exporter <name> statistics — check export packet count','Verify UDP 2055 (NetFlow) or 4739 (IPFIX) reachable','Check flow monitor applied to interfaces: show flow interface','Verify sampler rate — 1:1000 typical for high-speed links','Check flow record matches expected fields (src/dst ip/port, protocol)'],
        remediation:['flow exporter NMS; destination <ip>; transport udp 2055','flow monitor MAIN; exporter NMS; cache timeout active 60','interface Eth1/1; ip flow monitor MAIN input'],
      },
    ];

    // Score candidates: keyword match + boost for exact phrase match
    const scored = KB
      .map(c => {
        const hits  = c.kw.filter(k => sl.includes(k)).length;
        const boost = c.kw.some(k => k.split(' ').length > 1 && sl.includes(k)) ? 0.05 : 0;
        return hits > 0 ? { ...c, score: (hits / c.kw.length) * 0.4 + c.confidence * 0.6 + boost } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (!scored.length) {
      out.innerHTML = `<div style="padding:.75rem;background:var(--bg4);border-radius:6px;color:var(--txt3);font-size:.83rem">
        No matching hypothesis found.<br>
        <strong style="color:var(--txt2)">Try being more specific</strong> — example symptoms:<br>
        <span style="font-size:.78rem">"BGP neighbor down", "STP topology change loop", "OSPF stuck in EXSTART", "DHCP pool exhausted", "PFC pause storm RoCEv2"</span>
      </div>`;
      return;
    }

    const affectedStr = devices.length ? `<span style="color:var(--orange)"> — Affected: ${devices.join(', ')}</span>` : '';
    out.innerHTML = scored.map((m, idx) => {
      const pct     = Math.round(m.score * 100);
      const barClr  = pct >= 85 ? 'var(--red)' : pct >= 75 ? 'var(--orange)' : 'var(--cyan)';
      const stepsHtml = (m.steps || []).map((s,i) => `<div style="font-size:.76rem;color:var(--txt2);padding:.15rem 0;display:flex;gap:.4rem"><span style="color:var(--cyan);flex-shrink:0">${i+1}.</span><span>${s}</span></div>`).join('');
      const cmdHtml   = (m.remediation || []).map(r => `<code style="font-size:.73rem;background:var(--bg2);padding:.1rem .35rem;border-radius:3px;margin:.15rem .15rem 0 0;display:inline-block">${r}</code>`).join('');
      return `
      <div style="background:var(--bg4);border:1px solid var(--border);border-radius:8px;padding:.7rem .9rem;margin:.5rem 0">
        <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.4rem">
          <div style="width:40px;height:40px;border-radius:50%;background:var(--bg3);border:2px solid ${barClr};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.82rem;color:${barClr};flex-shrink:0">${pct}%</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:.88rem">${idx === 0 ? '🎯 ' : ''}${m.hypothesis}${idx === 0 ? affectedStr : ''}</div>
            <div style="font-size:.72rem;color:var(--cyan);font-weight:600;letter-spacing:.03em">${m.layer}</div>
          </div>
        </div>
        <div style="font-size:.78rem;color:var(--txt2);margin-bottom:.4rem">${m.evidence}</div>
        ${stepsHtml ? `<details style="margin-top:.4rem"><summary style="font-size:.76rem;font-weight:600;color:var(--txt2);cursor:pointer">▶ Investigation steps</summary><div style="margin-top:.3rem">${stepsHtml}</div></details>` : ''}
        ${cmdHtml ? `<div style="margin-top:.4rem;border-top:1px solid var(--border);padding-top:.35rem">${cmdHtml}</div>` : ''}
      </div>`;
    }).join('');
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
  function rcaChip(btn, text) {
    const inp = document.getElementById('ts-rca-symptom');
    if (inp) inp.value = text;
    document.querySelectorAll('#ts-rca-chips .layer-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    runRca();
  }

  return { discover, parseNeighbors, startSnmpPoll, stopSnmpPoll, clearSnmpLog, runPlaybook, runRca, rcaChip, clearAll };

})();
