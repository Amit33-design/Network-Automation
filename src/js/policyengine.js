'use strict';

/* ════════════════════════════════════════════════════════════════
   POLICY ENGINE
   Codified network best-practice rules evaluated against the
   live intent model. Results feed into the Deployment Gate.
════════════════════════════════════════════════════════════════ */

const POLICY_RESULTS = {
  violations: [],   // severity FAIL  → blocks gate
  warnings:   [],   // severity WARN  → gate warns
  infos:      [],   // severity INFO  → advisory only
  timestamp:  null,
};

/* ── Rule definitions ───────────────────────────────────────── */
const POLICIES = [
  {
    id: 'gpu-requires-pfc',
    name: 'GPU cluster requires PFC/DCB',
    severity: 'FAIL',
    check(intent) {
      if (!intent.gpu) return null;
      const feats = (intent.protocols?.features || []).join(' ').toLowerCase();
      if (feats.includes('pfc') || feats.includes('dcb') || feats.includes('lossless')) return null;
      return 'GPU workload detected but PFC/DCB not enabled — lossless fabric is required for RDMA/RoCEv2';
    },
  },
  {
    id: 'single-spine-spof',
    name: 'Single spine is a single point of failure',
    severity: 'WARN',
    check(intent) {
      const spines = intent.topology?.spine_count || 0;
      if (spines >= 2) return null;
      return `Only ${spines || 1} spine node configured — minimum 2 required for fabric redundancy`;
    },
  },
  {
    id: 'large-no-redundancy',
    name: 'Large deployment without HA/redundancy',
    severity: 'WARN',
    check(intent) {
      const scale = (intent.scale || '').toLowerCase();
      if (!['enterprise', 'large'].includes(scale)) return null;
      if (intent.topology?.redundant) return null;
      return 'Large-scale deployment without HA — a single device failure could cause widespread outage';
    },
  },
  {
    id: 'gpu-no-roce',
    name: 'GPU fabric without RoCEv2',
    severity: 'WARN',
    check(intent) {
      if (!intent.gpu) return null;
      const overlay = (intent.protocols?.overlay || []).join(' ').toLowerCase();
      if (overlay.includes('roce') || overlay.includes('rdma')) return null;
      return 'GPU cluster without RoCEv2 overlay — RDMA over Converged Ethernet improves GPU-to-GPU throughput by up to 5×';
    },
  },
  {
    id: 'wan-no-encryption',
    name: 'WAN/campus without transit encryption',
    severity: 'WARN',
    check(intent) {
      const uc = intent.use_case || '';
      if (uc !== 'wan' && uc !== 'campus') return null;
      const feats = (intent.protocols?.features || []).join(' ').toLowerCase();
      if (feats.includes('vpn') || feats.includes('ipsec') || feats.includes('macsec')) return null;
      return 'WAN design without encryption — recommend IPsec or MACsec for transit data protection';
    },
  },
  {
    id: 'campus-no-nac',
    name: 'Campus without NAC / 802.1X',
    severity: 'WARN',
    check(intent) {
      if (intent.use_case !== 'campus') return null;
      const security = (intent.security || []).join(' ').toLowerCase();
      if (security.includes('nac') || security.includes('802.1x') || security.includes('dot1x')) return null;
      return 'Campus design without NAC/802.1X — user and device authentication strongly recommended';
    },
  },
  {
    id: 'dc-no-evpn',
    name: 'Data center without BGP-EVPN/VXLAN',
    severity: 'INFO',
    check(intent) {
      const uc = intent.use_case || '';
      if (!['datacenter', 'dc', 'gpu', 'hybrid'].includes(uc)) return null;
      const overlay = (intent.protocols?.overlay || []).join(' ').toLowerCase();
      if (overlay.includes('evpn') || overlay.includes('vxlan')) return null;
      return 'Data center without BGP-EVPN — modern L2/L3 overlay fabric control plane recommended';
    },
  },
  {
    id: 'multisite-no-te',
    name: 'Multi-site without traffic engineering',
    severity: 'INFO',
    check(intent) {
      const sites = intent.topology?.site_count || 1;
      if (sites < 3) return null;
      const underlay = (intent.protocols?.underlay || []).join(' ').toLowerCase();
      if (underlay.includes('segment') || underlay.includes('sr-mpls') || underlay.includes('srv6') || underlay.includes(' te')) return null;
      return `${sites}-site design without Segment Routing — consider SR-MPLS or SRv6 for inter-site path control`;
    },
  },
  {
    id: 'no-compliance',
    name: 'Production design without compliance framework',
    severity: 'INFO',
    check(intent) {
      const uc = intent.use_case || '';
      if (!['campus', 'wan', 'datacenter', 'hybrid', 'dc'].includes(uc)) return null;
      if ((intent.compliance || []).length > 0) return null;
      return 'No compliance framework selected — consider PCI-DSS, HIPAA, or SOC 2 controls for production';
    },
  },
];

/* ── Evaluation ─────────────────────────────────────────────── */
function runPolicies() {
  const intent = (typeof buildIntentObject === 'function') ? buildIntentObject() : {};
  const violations = [], warnings = [], infos = [];

  for (const policy of POLICIES) {
    let msg;
    try { msg = policy.check(intent); } catch (_) { continue; }
    if (!msg) continue;
    const entry = { id: policy.id, name: policy.name, msg, severity: policy.severity };
    if      (policy.severity === 'FAIL') violations.push(entry);
    else if (policy.severity === 'WARN') warnings.push(entry);
    else                                  infos.push(entry);
  }

  POLICY_RESULTS.violations = violations;
  POLICY_RESULTS.warnings   = warnings;
  POLICY_RESULTS.infos      = infos;
  POLICY_RESULTS.timestamp  = new Date().toISOString();

  // Feed result into gate
  if (typeof updateGate === 'function') {
    const status = violations.length > 0 ? 'FAIL'
                 : warnings.length   > 0 ? 'WARN'
                 : 'PASS';
    updateGate('policy', status);
  }

  return POLICY_RESULTS;
}

/* ── Render policy panel ─────────────────────────────────────── */
function renderPolicyPanel() {
  const el = document.getElementById('policy-panel');
  if (!el) return;

  const r = runPolicies();
  const total = r.violations.length + r.warnings.length + r.infos.length;

  if (total === 0) {
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

  const mkRow = (e) => {
    const cls  = e.severity === 'FAIL' ? 'fail' : e.severity === 'WARN' ? 'warn' : 'info';
    const icon = e.severity === 'FAIL' ? '❌'   : e.severity === 'WARN' ? '⚠️'  : 'ℹ️';
    return `<div class="pol-row pol-${cls}">
      <span class="pol-badge pol-badge-${cls}">${icon} ${e.severity}</span>
      <div class="pol-content">
        <div class="pol-name">${e.name}</div>
        <div class="pol-msg">${e.msg}</div>
      </div>
    </div>`;
  };

  el.innerHTML = [
    ...r.violations.map(mkRow),
    ...r.warnings.map(mkRow),
    ...r.infos.map(mkRow),
  ].join('');
}
