'use strict';

/* ════════════════════════════════════════════════════════════════
   POLICY ENGINE  v2
   ─────────────────────────────────────────────────────────────
   Pipeline:
     STATE
       → buildIntentObject()        (pure derivation, intentmodel.js)
       → deriveInitialState(intent)  (policy-mutable resolved state)
       → runPolicyEngine(intent)     (two-phase evaluation)
           Phase 1 — AUTO_FIX rules, sorted by priority, mutate state
           Phase 2 — all rules evaluated on resolved state, collect results
       → RESOLVED_STATE              (global, read by configgen.js)
       → POLICY_RESULTS              (feeds gate.js + renderPolicyPanel)

   Rule contract
   ─────────────
   {
     id:          string              unique rule identifier
     description: string              human-readable label
     severity:    'FAIL'|'WARN'|'INFO'  shown in UI, affects confidence score
     priority:    number              AUTO_FIX ordering (lower = runs first)

     condition:   (intent, state) → bool
                  Returns true when the rule fires.
                  intent is frozen — read only.
                  state  is mutable — AUTO_FIX rules may write here.

     action: {
       type:  'AUTO_FIX' | 'SUGGEST' | 'BLOCK' | 'NOOP'
              AUTO_FIX — apply() mutates state, fix message shown in UI
              SUGGEST  — advisory recommendation shown in UI
              BLOCK    — hard gate block, no override possible
              NOOP     — fires but takes no action (pure reporting)

       apply: (intent, state) → { message: string }
              Called only when condition fires AND type !== 'NOOP'.
              MUST only write to state, never to intent.
     }
   }

   Severity vs. action.type — not the same thing:
     severity FAIL + BLOCK → hard block, no override
     severity FAIL + AUTO_FIX → engine fixed it; UI shows ✔ FIX APPLIED
     severity FAIL + SUGGEST  → strong warning; user can override with confirm
     severity WARN + SUGGEST  → advisory; deploy proceeds normally
════════════════════════════════════════════════════════════════ */


// ── Global outputs (read by gate.js and configgen.js) ────────────
let RESOLVED_STATE = null;   // set after each runPolicyEngine() call

const POLICY_RESULTS = {
  violations: [],    // severity FAIL  (not auto-fixed)
  warnings:   [],    // severity WARN
  infos:      [],    // severity INFO
  fixes:      [],    // AUTO_FIX rules that fired + were applied
  blocks:     [],    // BLOCK action rules — hard gate stops
  timestamp:  null,
};


// ════════════════════════════════════════════════════════════════
//  DERIVED STATE
//  Mutable layer between intent (frozen) and config generator.
//  AUTO_FIX rules write here; configgen.js reads from RESOLVED_STATE.
// ════════════════════════════════════════════════════════════════

function deriveInitialState(intent) {
  const proto = intent.protocols || {};
  const allProtos = [
    ...(proto.underlay || []),
    ...(proto.overlay  || []),
    ...(proto.features || []),
  ].map(p => p.toLowerCase());

  // Build initial VLAN list from intent; used by VLAN-related rules
  const intentVlans = Array.isArray(intent.vlans) ? [...intent.vlans] : [];

  return {
    // ── Routing ─────────────────────────────────────────────────
    routing:          allProtos,                  // normalised protocol list
    bgpEnabled:       allProtos.some(p => p.includes('bgp')),
    ospfEnabled:      allProtos.some(p => p.includes('ospf')),
    isisEnabled:      allProtos.some(p => p.includes('is-is') || p.includes('isis')),
    eigrpEnabled:     allProtos.some(p => p.includes('eigrp')),
    evpnEnabled:      allProtos.some(p => p.includes('evpn')),
    vxlanEnabled:     allProtos.some(p => p.includes('vxlan')),
    srEnabled:        allProtos.some(p => p.includes('segment') || p.includes('sr-mpls') || p.includes('srv6')),

    // ── Fabric ──────────────────────────────────────────────────
    pfcEnabled:       allProtos.some(p => p.includes('pfc') || p.includes('dcb') || p.includes('lossless'))
                       || (intent.pfc === true),
    roceEnabled:      allProtos.some(p => p.includes('roce') || p.includes('rdma'))
                       || (intent.rocev2 === true),
    ecnEnabled:       allProtos.some(p => p.includes('ecn')),

    // ── Security ─────────────────────────────────────────────────
    dot1xEnabled:     (intent.security || []).some(s => /802\.1x|dot1x|nac/i.test(s)),
    macsecEnabled:    (intent.security || []).some(s => /macsec/i.test(s)),
    ipsecEnabled:     (intent.vpn || '').toLowerCase().includes('ipsec')
                       || (intent.security || []).some(s => /ipsec/i.test(s)),

    // ── Topology ─────────────────────────────────────────────────
    spineCount:       intent.topology?.spine_count || 0,
    redundant:        intent.topology?.redundant   || false,
    siteCount:        parseInt(intent.sites) || 1,

    // ── VLANs ────────────────────────────────────────────────────
    vlans:            intentVlans,
    usedVlanIds:      new Set(intentVlans.map(v => v.id)),
    vacl:             false,
    iotVlanAdded:     false,

    // ── Wireless ─────────────────────────────────────────────────
    wirelessEnabled:  !!intent.wireless,

    // ── Overlays ─────────────────────────────────────────────────
    overlay:          proto.overlay || [],

    // ── Compliance ────────────────────────────────────────────────
    compliance:       intent.compliance || [],

    // ── Use case shortcuts ────────────────────────────────────────
    uc:               intent.use_case || '',
    isGpu:            !!intent.gpu,
    isDC:             ['datacenter','dc','gpu','hybrid','multisite'].includes(intent.use_case),
    isCampus:         ['campus','hybrid'].includes(intent.use_case),
    isWAN:            intent.use_case === 'wan',
  };
}


// ════════════════════════════════════════════════════════════════
//  POLICY RULES
//  Organised into categories for readability.
//  priority: lower number runs first in the AUTO_FIX phase.
// ════════════════════════════════════════════════════════════════

const POLICY_RULES = [

  // ── Category: FABRIC / GPU ───────────────────────────────────

  {
    id:          'gpu-requires-pfc',
    description: 'GPU fabric requires PFC/DCB for lossless RoCEv2',
    severity:    'FAIL',
    priority:    10,
    condition:   (intent, state) => state.isGpu && !state.pfcEnabled,
    action: {
      type:  'AUTO_FIX',
      apply: (intent, state) => {
        state.pfcEnabled = true;
        state.routing.push('pfc');
        return { message: 'PFC/DCB automatically enabled — lossless fabric required for RDMA/RoCEv2' };
      },
    },
  },

  {
    id:          'gpu-requires-roce',
    description: 'GPU cluster without RoCEv2 overlay',
    severity:    'WARN',
    priority:    11,
    condition:   (intent, state) => state.isGpu && !state.roceEnabled,
    action: {
      type:  'SUGGEST',
      apply: () => ({ message: 'Enable RoCEv2 — RDMA over Converged Ethernet improves GPU-to-GPU throughput by up to 5×' }),
    },
  },

  {
    id:          'gpu-requires-ecn',
    description: 'GPU fabric without ECN / DCQCN congestion control',
    severity:    'WARN',
    priority:    12,
    condition:   (intent, state) => state.isGpu && !state.ecnEnabled,
    action: {
      type:  'SUGGEST',
      apply: () => ({ message: 'Enable ECN + DCQCN — prevents RoCEv2 retransmits that stall GPU collective operations' }),
    },
  },


  // ── Category: ROUTING ─────────────────────────────────────────

  {
    id:          'evpn-requires-bgp',
    description: 'EVPN control plane requires BGP',
    severity:    'FAIL',
    priority:    5,
    condition:   (intent, state) => state.evpnEnabled && !state.bgpEnabled,
    action: {
      type:  'AUTO_FIX',
      apply: (intent, state) => {
        state.bgpEnabled = true;
        state.routing.push('bgp');
        return { message: 'BGP automatically enabled — required as EVPN control plane' };
      },
    },
  },

  {
    id:          'vxlan-requires-evpn-or-flood',
    description: 'VXLAN fabric without a control plane (EVPN recommended)',
    severity:    'INFO',
    priority:    20,
    condition:   (intent, state) => state.vxlanEnabled && !state.evpnEnabled,
    action: {
      type:  'SUGGEST',
      apply: () => ({ message: 'Add BGP-EVPN as VXLAN control plane — eliminates flood-and-learn, enables L3 mobility and multi-tenancy' }),
    },
  },

  {
    id:          'multisite-no-segment-routing',
    description: 'Multi-site design (≥3 sites) without traffic engineering',
    severity:    'INFO',
    priority:    30,
    condition:   (intent, state) => state.siteCount >= 3 && !state.srEnabled,
    action: {
      type:  'SUGGEST',
      apply: (intent, state) => ({ message: `${state.siteCount}-site design — consider SR-MPLS or SRv6 for deterministic inter-site path control` }),
    },
  },


  // ── Category: REDUNDANCY / TOPOLOGY ──────────────────────────

  {
    id:          'single-spine-spof',
    description: 'Single spine is a single point of failure',
    severity:    'WARN',
    priority:    40,
    condition:   (intent, state) => state.isDC && state.spineCount < 2,
    action: {
      type:  'SUGGEST',
      apply: (intent, state) => ({ message: `Only ${state.spineCount || 1} spine configured — add a second spine for ECMP and fault tolerance` }),
    },
  },

  {
    id:          'large-no-redundancy',
    description: 'Large deployment without HA redundancy',
    severity:    'WARN',
    priority:    41,
    condition:   (intent, state) => {
      const scale = (intent.scale || '').toLowerCase();
      return ['enterprise','large'].includes(scale) && !state.redundant;
    },
    action: {
      type:  'SUGGEST',
      apply: () => ({ message: 'Enterprise scale without HA — single device failures could cause widespread outage; configure redundant pairs' }),
    },
  },

  {
    id:          'no-products-selected',
    description: 'No products selected — cannot generate configuration',
    severity:    'FAIL',
    priority:    1,   // must run first
    condition:   (intent) => {
      const prods = intent.selected_products || {};
      return Object.keys(prods).length === 0 || Object.values(prods).every(v => !v);
    },
    action: {
      type:  'BLOCK',
      apply: () => ({ message: 'Select at least one product in the Products step before generating or deploying configuration' }),
    },
  },


  // ── Category: SECURITY ────────────────────────────────────────

  {
    id:          'campus-no-nac',
    description: 'Campus design without NAC / 802.1X',
    severity:    'WARN',
    priority:    50,
    condition:   (intent, state) => state.isCampus && !state.dot1xEnabled,
    action: {
      type:  'SUGGEST',
      apply: () => ({ message: 'Enable 802.1X/NAC — user and device authentication strongly recommended for campus access layer' }),
    },
  },

  {
    id:          'campus-enable-dot1x',
    description: 'Auto-enable 802.1X flag for campus designs that have NAC vendor selected',
    severity:    'INFO',
    priority:    51,
    condition:   (intent, state) => {
      // Fire if a NAC product is selected but dot1xEnabled wasn't caught yet
      const nac = (intent.security || []).some(s => /nac|ise|clearpass|aruba/i.test(s));
      return state.isCampus && nac && !state.dot1xEnabled;
    },
    action: {
      type:  'AUTO_FIX',
      apply: (intent, state) => {
        state.dot1xEnabled = true;
        return { message: '802.1X enabled — NAC solution detected in security selection' };
      },
    },
  },

  {
    id:          'wan-no-encryption',
    description: 'WAN design without transit encryption',
    severity:    'WARN',
    priority:    55,
    condition:   (intent, state) => state.isWAN && !state.ipsecEnabled && !state.macsecEnabled,
    action: {
      type:  'SUGGEST',
      apply: () => ({ message: 'WAN design without encryption — add IPsec or MACsec for transit data protection' }),
    },
  },

  {
    id:          'no-compliance-framework',
    description: 'Production design without a compliance framework',
    severity:    'INFO',
    priority:    60,
    condition:   (intent, state) => {
      const uc = state.uc;
      return ['campus','wan','dc','datacenter','hybrid'].includes(uc) && state.compliance.length === 0;
    },
    action: {
      type:  'SUGGEST',
      apply: () => ({ message: 'No compliance framework selected — consider PCI-DSS, HIPAA, or SOC 2 controls for production environments' }),
    },
  },


  // ── Category: VLAN / L2 ──────────────────────────────────────

  {
    id:          'campus-iot-vlan-isolation',
    description: 'Campus design without dedicated IoT VLAN isolation',
    severity:    'INFO',
    priority:    70,
    condition:   (intent, state) => {
      if (!state.isCampus) return false;
      // Only suggest if IoT/BMS is mentioned in app types or scale implies it
      const hasIoT = (intent.app_types || []).some(a => /iot|bms|ot|scada/i.test(a));
      if (!hasIoT) return false;
      // Check that no IoT VLAN is already defined
      const vlans = state.vlans || [];
      return !vlans.some(v => /iot|bms|ot|scada/i.test(v.name || ''));
    },
    action: {
      type:  'SUGGEST',
      apply: (intent, state) => {
        // Find an unused VLAN ID (scan from 60 upward, skip reserved)
        const reserved = new Set([1, 1002, 1003, 1004, 1005]);
        let candidate = 60;
        while (state.usedVlanIds.has(candidate) || reserved.has(candidate)) candidate++;
        return {
          message: `Add a dedicated IoT VLAN (suggested ID ${candidate}) with VACL isolation — prevents lateral movement from compromised IoT devices`,
        };
      },
    },
  },

  {
    id:          'dc-no-evpn',
    description: 'Data center without BGP-EVPN/VXLAN overlay',
    severity:    'INFO',
    priority:    75,
    condition:   (intent, state) => state.isDC && !state.evpnEnabled && !state.vxlanEnabled,
    action: {
      type:  'SUGGEST',
      apply: () => ({ message: 'Data center without BGP-EVPN — modern L2/L3 overlay fabric control plane strongly recommended' }),
    },
  },

];


// ════════════════════════════════════════════════════════════════
//  ENGINE RUNNER
// ════════════════════════════════════════════════════════════════

function runPolicyEngine(intent) {
  // Freeze intent so no rule's apply() can accidentally mutate it
  const frozenIntent = Object.freeze(JSON.parse(JSON.stringify(intent)));

  // Derive mutable resolved state from the frozen intent
  const state = deriveInitialState(frozenIntent);

  const fixes      = [];   // AUTO_FIX rules that fired
  const violations = [];   // FAIL severity (not fixed)
  const warnings   = [];   // WARN severity
  const infos      = [];   // INFO severity
  const blocks     = [];   // BLOCK action rules

  // ── Phase 1: AUTO_FIX pass ────────────────────────────────────
  // Run only AUTO_FIX rules, sorted by priority (lowest first).
  // This lets prerequisite fixes (e.g. EVPN→BGP) run before dependent rules check state.

  const fixRules = POLICY_RULES
    .filter(r => r.action?.type === 'AUTO_FIX')
    .sort((a, b) => (a.priority || 99) - (b.priority || 99));

  for (const rule of fixRules) {
    let fired = false;
    try { fired = rule.condition(frozenIntent, state); } catch (_) { continue; }
    if (!fired) continue;

    let result;
    try { result = rule.action.apply(frozenIntent, state); } catch (_) { continue; }

    fixes.push({
      id:          rule.id,
      description: rule.description,
      severity:    rule.severity,
      message:     result.message,
    });
  }

  // ── Phase 2: Evaluation pass ──────────────────────────────────
  // Evaluate ALL rules on the now-resolved state.
  // AUTO_FIX rules that already fired will have condition = false (state is fixed).
  // Non-AUTO_FIX rules are evaluated for the first time here.

  const evalRules = POLICY_RULES.sort((a, b) => (a.priority || 99) - (b.priority || 99));

  for (const rule of evalRules) {
    let fired = false;
    try { fired = rule.condition(frozenIntent, state); } catch (_) { continue; }
    if (!fired) continue;

    // AUTO_FIX already handled in phase 1 — skip re-adding to violations
    if (rule.action?.type === 'AUTO_FIX') continue;

    let message = rule.description;
    try {
      const result = rule.action?.apply ? rule.action.apply(frozenIntent, state) : null;
      if (result?.message) message = result.message;
    } catch (_) {}

    const entry = {
      id:          rule.id,
      description: rule.description,
      severity:    rule.severity,
      actionType:  rule.action?.type || 'NOOP',
      message,
    };

    if (rule.action?.type === 'BLOCK') {
      blocks.push(entry);
    } else if (rule.severity === 'FAIL') {
      violations.push(entry);
    } else if (rule.severity === 'WARN') {
      warnings.push(entry);
    } else {
      infos.push(entry);
    }
  }

  // Publish resolved state globally (configgen.js reads RESOLVED_STATE)
  RESOLVED_STATE = state;

  // Publish policy results
  POLICY_RESULTS.violations = violations;
  POLICY_RESULTS.warnings   = warnings;
  POLICY_RESULTS.infos      = infos;
  POLICY_RESULTS.fixes      = fixes;
  POLICY_RESULTS.blocks     = blocks;
  POLICY_RESULTS.timestamp  = new Date().toISOString();

  // Feed gate
  if (typeof updateGate === 'function') {
    const hasBlock = blocks.length > 0;
    const hasFail  = violations.length > 0;
    const status   = hasBlock ? 'BLOCK'
                   : hasFail  ? 'FAIL'
                   : warnings.length > 0 ? 'WARN'
                   : 'PASS';
    updateGate('policy', status);
  }

  return { state, results: POLICY_RESULTS };
}

// Thin wrapper — kept for backward compat (gate.js calls runPolicies())
function runPolicies() {
  const intent = (typeof buildIntentObject === 'function') ? buildIntentObject() : {};
  return runPolicyEngine(intent);
}


// ════════════════════════════════════════════════════════════════
//  UI RENDERER
// ════════════════════════════════════════════════════════════════

function renderPolicyPanel() {
  const el = document.getElementById('policy-panel');
  if (!el) return;

  runPolicies();   // re-evaluates + updates POLICY_RESULTS + RESOLVED_STATE

  const r = POLICY_RESULTS;
  const totalIssues = r.blocks.length + r.violations.length + r.warnings.length + r.infos.length;
  const totalFixes  = r.fixes.length;

  // ── All-clear ────────────────────────────────────────────────
  if (totalIssues === 0 && totalFixes === 0) {
    el.innerHTML = `
      <div class="policy-pass">
        <span style="font-size:1.4rem">✅</span>
        <div>
          <strong>All policies passed</strong>
          <div style="font-size:.78rem;color:var(--txt3);margin-top:.15rem">Design follows network engineering best practices</div>
        </div>
      </div>`;
    return;
  }

  // ── Row builders ─────────────────────────────────────────────

  const mkBlock = (e) => `
    <div class="pol-row pol-block">
      <span class="pol-badge pol-badge-block">🚫 BLOCK</span>
      <div class="pol-content">
        <div class="pol-name">${e.description}</div>
        <div class="pol-msg">${e.message}</div>
      </div>
    </div>`;

  const mkViolation = (e) => `
    <div class="pol-row pol-fail">
      <span class="pol-badge pol-badge-fail">❌ FAIL</span>
      <div class="pol-content">
        <div class="pol-name">${e.description}</div>
        <div class="pol-msg">${e.message}</div>
        ${e.actionType === 'SUGGEST'
          ? `<div class="pol-override-hint">⚠️ Acknowledge required before deployment</div>`
          : ''}
      </div>
    </div>`;

  const mkWarn = (e) => `
    <div class="pol-row pol-warn">
      <span class="pol-badge pol-badge-warn">⚠️ WARN</span>
      <div class="pol-content">
        <div class="pol-name">${e.description}</div>
        <div class="pol-msg">${e.message}</div>
      </div>
    </div>`;

  const mkInfo = (e) => `
    <div class="pol-row pol-info">
      <span class="pol-badge pol-badge-info">ℹ️ INFO</span>
      <div class="pol-content">
        <div class="pol-name">${e.description}</div>
        <div class="pol-msg">${e.message}</div>
      </div>
    </div>`;

  const mkFix = (e) => `
    <div class="pol-row pol-fix">
      <span class="pol-badge pol-badge-fix">✔ AUTO-FIX</span>
      <div class="pol-content">
        <div class="pol-name">${e.description}</div>
        <div class="pol-msg pol-fix-msg">${e.message}</div>
      </div>
    </div>`;

  // ── Summary line ──────────────────────────────────────────────
  const parts = [];
  if (r.blocks.length)     parts.push(`<span style="color:var(--red)">🚫 ${r.blocks.length} blocked</span>`);
  if (r.violations.length) parts.push(`<span style="color:var(--red)">❌ ${r.violations.length} failed</span>`);
  if (r.warnings.length)   parts.push(`<span style="color:var(--yellow)">⚠️ ${r.warnings.length} warned</span>`);
  if (r.fixes.length)      parts.push(`<span style="color:var(--green)">✔ ${r.fixes.length} auto-fixed</span>`);
  if (r.infos.length)      parts.push(`<span style="color:var(--txt3)">ℹ️ ${r.infos.length} advisory</span>`);

  const summary = `<div class="pol-summary">${parts.join('  ·  ')}</div>`;

  el.innerHTML = summary + [
    ...r.blocks.map(mkBlock),
    ...r.violations.map(mkViolation),
    ...r.warnings.map(mkWarn),
    ...r.fixes.map(mkFix),       // fixes shown after violations so context is clear
    ...r.infos.map(mkInfo),
  ].join('');
}

/* ════════════════════════════════════════════════════════════════
   ACL GENERATOR — Named ACLs from compliance + segmentation
   Covers: IOS-XE, NX-OS, EOS, JunOS
   Called from config gen and downloadable standalone.
════════════════════════════════════════════════════════════════ */

var _ACL_ZONES = {
  pci: {
    label: 'PCI DSS — Cardholder Data Zone',
    zones: ['CHD', 'MGMT'],
    permitServices: [
      { proto: 'tcp', dst: 443, note: 'HTTPS — payment gateway' },
      { proto: 'tcp', dst: 8443, note: 'HTTPS alt — payment app' },
      { proto: 'tcp', dst: 1521, note: 'Oracle DB' },
      { proto: 'tcp', dst: 3306, note: 'MySQL' },
      { proto: 'tcp', dst: 5432, note: 'PostgreSQL' },
      { proto: 'tcp', dst: 22,   note: 'SSH admin' },
      { proto: 'tcp', dst: 514,  note: 'Syslog' },
      { proto: 'udp', dst: 161,  note: 'SNMP' },
    ],
  },
  hipaa: {
    label: 'HIPAA — Protected Health Information Zone',
    zones: ['PHI', 'EHR', 'MGMT'],
    permitServices: [
      { proto: 'tcp', dst: 443,  note: 'HTTPS — EHR portal' },
      { proto: 'tcp', dst: 8080, note: 'HTTP alt — HL7/FHIR API' },
      { proto: 'tcp', dst: 2575, note: 'HL7 MLLP' },
      { proto: 'tcp', dst: 1433, note: 'SQL Server — EHR backend' },
      { proto: 'tcp', dst: 22,   note: 'SSH admin' },
      { proto: 'udp', dst: 514,  note: 'Syslog' },
      { proto: 'udp', dst: 161,  note: 'SNMP v3' },
    ],
  },
  soc2: {
    label: 'SOC 2 — Restricted Zone',
    zones: ['RESTRICTED', 'MGMT'],
    permitServices: [
      { proto: 'tcp', dst: 443, note: 'HTTPS' },
      { proto: 'tcp', dst: 22,  note: 'SSH admin' },
      { proto: 'udp', dst: 161, note: 'SNMP' },
    ],
  },
};

function genACLs(state, vendor) {
  var s = state || (typeof STATE !== 'undefined' ? STATE : {});
  var compliance = s.compliance || [];
  var v = (vendor || 'ios-xe').toLowerCase();
  if (!compliance.length) return '';

  var out = '';

  compliance.forEach(function(comp) {
    var key = comp.toLowerCase().replace(/[^a-z0-9]/g, '');
    // Match pci, hipaa, soc2
    var zone = _ACL_ZONES[key] || _ACL_ZONES[key.slice(0,5)];
    if (!zone) return;

    var aclName = comp.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_PERMIT';
    var services = zone.permitServices;

    if (v === 'ios-xe') {
      out += '\n! ── ACL: ' + zone.label + '\nip access-list extended ' + aclName + '\n';
      out += '  remark === ' + zone.label + ' — auto-generated by NetDesign AI ===\n';
      services.forEach(function(svc) {
        out += '  permit ' + svc.proto + ' any any eq ' + svc.dst + '    ! ' + svc.note + '\n';
      });
      out += '  deny   ip any any log    ! default deny\n!\n';

    } else if (v === 'nxos') {
      out += '\n! ── ACL: ' + zone.label + '\nip access-list ' + aclName + '\n';
      var seq = 10;
      services.forEach(function(svc) {
        out += '  ' + seq + ' permit ' + svc.proto + ' any any eq ' + svc.dst + '    ! ' + svc.note + '\n';
        seq += 10;
      });
      out += '  ' + seq + ' deny ip any any    ! default deny\n!\n';

    } else if (v === 'eos') {
      out += '\n! ── ACL: ' + zone.label + '\nip access-list ' + aclName + '\n';
      var seq2 = 10;
      services.forEach(function(svc) {
        out += '   ' + seq2 + ' permit ' + svc.proto + ' any any eq ' + svc.dst + '    ! ' + svc.note + '\n';
        seq2 += 10;
      });
      out += '   ' + seq2 + ' deny ip any any\n!\n';

    } else if (v === 'junos') {
      out += '\n# ── Firewall filter: ' + zone.label + '\nset firewall family inet filter ' + aclName + ' term PERMIT-SERVICES from protocol [';
      var protos = [...new Set(services.map(function(s) { return s.proto; }))];
      out += protos.join(' ') + ']\n';
      services.forEach(function(svc) {
        out += 'set firewall family inet filter ' + aclName + ' term PERMIT-SERVICES from destination-port ' + svc.dst + '    # ' + svc.note + '\n';
      });
      out += 'set firewall family inet filter ' + aclName + ' term PERMIT-SERVICES then accept\n';
      out += 'set firewall family inet filter ' + aclName + ' term DEFAULT-DENY then reject\n';
    }
  });

  return out;
}

/* Download standalone ACL file */
function downloadACLs() {
  var s = typeof STATE !== 'undefined' ? STATE : {};
  if (!s.compliance || !s.compliance.length) {
    if (typeof toast === 'function') toast('No compliance requirements selected in Step 2', 'warn');
    return;
  }
  var vendors = ['ios-xe', 'nxos', 'eos', 'junos'];
  var content = '! NetDesign AI — ACL Generator\n! Generated: ' + new Date().toISOString().slice(0,10) + '\n';
  content += '! Compliance: ' + s.compliance.join(', ') + '\n\n';
  vendors.forEach(function(v) {
    content += '\n! ═══════ ' + v.toUpperCase() + ' ═══════\n';
    content += genACLs(s, v);
  });
  var blob = new Blob([content], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'acls-' + (s.compliance || ['custom']).join('-').toLowerCase() + '.txt';
  a.click();
  if (typeof toast === 'function') toast('ACL configs downloaded', 'success');
}

window.genACLs       = genACLs;
window.downloadACLs  = downloadACLs;

/* ════════════════════════════════════════════════════════════════
   BGP ROUTE-POLICY VALIDATOR
   Checks generated BGP configs for common mistakes.
════════════════════════════════════════════════════════════════ */

var _BGP_CHECKS = [
  {
    id: 'no-default-deny',
    label: 'Missing default deny in route-map',
    severity: 'error',
    test: function(cfg) {
      /* route-map present but no deny at end */
      var rms = cfg.match(/^route-map\s+\S+\s+permit\s+\d+/gm) || [];
      if (!rms.length) return false;
      var hasDeny = /^route-map\s+\S+\s+deny\s+/m.test(cfg);
      return rms.length > 0 && !hasDeny;
    },
    fix: 'Add a "route-map <NAME> deny 65535" at the end of each route-map to enforce default deny.',
  },
  {
    id: 'max-prefix-missing',
    label: 'BGP maximum-prefix not configured',
    severity: 'warning',
    test: function(cfg) {
      var hasNeighbor = /^\s*neighbor\s+\S+\s+remote-as/m.test(cfg);
      var hasMaxPrefix = /maximum-prefix/i.test(cfg);
      return hasNeighbor && !hasMaxPrefix;
    },
    fix: 'Add "neighbor <IP> maximum-prefix <N> [warning-only]" to protect against route leaks.',
  },
  {
    id: 'community-not-stripped',
    label: 'Communities may not be stripped on export',
    severity: 'warning',
    test: function(cfg) {
      var hasCommunity = /send-community/i.test(cfg) || /community\s+\d+:\d+/i.test(cfg);
      var hasStripOut  = /community\s+none|strip.*community/i.test(cfg) ||
                         /route-map.*deny.*community/i.test(cfg);
      return hasCommunity && !hasStripOut;
    },
    fix: 'Verify outbound route-maps strip internal communities before advertising to external peers.',
  },
  {
    id: 'as-path-prepend-check',
    label: 'AS-path prepend without route-map guard',
    severity: 'info',
    test: function(cfg) {
      return /set as-path prepend/i.test(cfg) && !/route-map.*permit.*\nset as-path prepend/s.test(cfg);
    },
    fix: 'Ensure AS-path prepend is inside a permit route-map term, not a bare neighbor statement.',
  },
  {
    id: 'next-hop-self-missing',
    label: 'next-hop-self not set on iBGP peers',
    severity: 'warning',
    test: function(cfg) {
      /* iBGP = same ASN remote-as as local ASN in router bgp block */
      var localAS = (cfg.match(/^router bgp\s+(\d+)/m) || [])[1];
      if (!localAS) return false;
      var ibgpPeers = cfg.match(new RegExp('neighbor\\s+\\S+\\s+remote-as\\s+' + localAS, 'gm')) || [];
      var hasNextHopSelf = /next-hop-self/i.test(cfg);
      return ibgpPeers.length > 0 && !hasNextHopSelf;
    },
    fix: 'Add "neighbor <IP> next-hop-self" for iBGP peers on route-reflectors and ASBR devices.',
  },
  {
    id: 'soft-reconfiguration',
    label: 'soft-reconfiguration inbound not enabled',
    severity: 'info',
    test: function(cfg) {
      var hasNeighbor = /^\s*neighbor\s+\S+\s+remote-as/m.test(cfg);
      var hasSoftReconfig = /soft-reconfiguration inbound/i.test(cfg);
      return hasNeighbor && !hasSoftReconfig;
    },
    fix: 'Add "neighbor <IP> soft-reconfiguration inbound" to allow policy changes without session reset.',
  },
];

function validateBGPPolicies(configText) {
  var results = [];
  _BGP_CHECKS.forEach(function(check) {
    try {
      if (check.test(configText)) {
        results.push({ id: check.id, label: check.label, severity: check.severity, fix: check.fix });
      }
    } catch(e) { /* skip on regex error */ }
  });
  return results;
}

/* Validate all generated configs and render into a panel */
function runBGPValidator() {
  var el = document.getElementById('bgp-validator-results');
  if (!el) return;

  /* Collect all generated config text */
  var allConfig = '';
  try {
    if (typeof DEVICE_LIST !== 'undefined' && DEVICE_LIST.length) {
      DEVICE_LIST.forEach(function(dev) {
        if (typeof generateConfig === 'function') {
          var os = (dev.platform || 'ios-xe');
          allConfig += generateConfig(dev, os) + '\n';
        }
      });
    }
  } catch(e) {}

  if (!allConfig.trim()) {
    el.innerHTML = '<div class="obs-placeholder">Generate configs in Step 5 first, then re-run validation.</div>';
    return;
  }

  var issues = validateBGPPolicies(allConfig);

  if (!issues.length) {
    el.innerHTML = '<div style="color:var(--green);padding:.75rem">✅ No BGP policy issues found.</div>';
    return;
  }

  var icons = { error: '❌', warning: '⚠️', info: 'ℹ️' };
  el.innerHTML = issues.map(function(iss) {
    return '<div style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:.7rem .9rem;margin:.4rem 0">' +
      '<div style="font-weight:600;margin-bottom:.25rem">' + (icons[iss.severity] || '') + ' ' + iss.label + '</div>' +
      '<div style="font-size:.78rem;color:var(--txt2)">Fix: ' + iss.fix + '</div>' +
      '</div>';
  }).join('');
}

window.validateBGPPolicies = validateBGPPolicies;
window.runBGPValidator     = runBGPValidator;
