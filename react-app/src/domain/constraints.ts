import type { IntentObject } from '../types/intent';

export interface Constraint {
  id: string;
  severity: 'error' | 'warning';
  check: (i: IntentObject) => boolean;
  msg: string;
  fix: string;
  fields?: string[];
}

export interface ValidationResult extends Constraint {
  triggered: true;
}

// Constraint rules from CLAUDE.md §5 — exact copy
export const CONSTRAINTS: Constraint[] = [
  {
    id: 'R-01', severity: 'error',
    check: (i) => i.protocols.underlay === 'eigrp' && i.protocols.overlay.includes('vxlan_evpn'),
    msg: 'EIGRP cannot underlay VXLAN/EVPN — EVPN requires BGP as control plane.',
    fix: 'Change underlay to BGP.',
    fields: ['fs-protocols'],
  },
  {
    id: 'R-02', severity: 'error',
    check: (i) => i.protocols.overlay.includes('geneve') && i.vendors.includes('cisco'),
    msg: 'GENEVE is not supported on Cisco IOS-XE or NX-OS in hardware.',
    fix: 'Use VXLAN, or switch to Linux-based SONiC.',
    fields: ['fs-vendors', 'fs-protocols'],
  },
  {
    id: 'R-03', severity: 'error',
    check: (i) => i.protocols.features.includes('flowspec') && i.protocols.underlay !== 'bgp',
    msg: 'FlowSpec (BGP-FS) requires BGP as underlay.',
    fix: 'Change underlay to BGP.',
    fields: ['fs-protocols'],
  },
  {
    id: 'R-04', severity: 'error',
    check: (i) => i.topology.redundancy === 'full' && i.protocols.underlay === 'static',
    msg: 'Static routing cannot provide full redundancy (no SPOF protection).',
    fix: 'Use BGP or OSPF with BFD.',
    fields: ['fs-architecture', 'fs-protocols'],
  },
  {
    id: 'R-05', severity: 'warning',
    check: (i) => i.use_case === 'campus' && i.protocols.underlay === 'is-is',
    msg: 'IS-IS is uncommon for campus. Cisco CVD and Arista AVD both recommend OSPF.',
    fix: 'Consider OSPF for campus LAN.',
    fields: ['fs-protocols'],
  },
  {
    id: 'R-06', severity: 'warning',
    check: (i) => i.gpu.transport === 'ib' && !i.vendors.includes('nvidia'),
    msg: 'InfiniBand requires NVIDIA Quantum switches.',
    fix: 'Add NVIDIA to vendor preferences, or use RoCEv2 for Ethernet-based GPU fabric.',
    fields: ['fs-vendors', 'fs-gpu'],
  },
  {
    id: 'R-07', severity: 'error',
    check: (i) => i.protocols.overlay.includes('otv') && i.org.sites <= 1,
    msg: 'OTV is a multi-site DCI technology. Meaningless for single-site designs.',
    fix: 'Use VXLAN/EVPN for L2 extension within a single site.',
    fields: ['fs-protocols', 'fs-site-identity'],
  },
  {
    id: 'R-08', severity: 'warning',
    check: (i) => (i.use_case === 'dc_fabric' || i.use_case === 'gpu_cluster') &&
      (i as IntentObject & { bgp_timers?: string }).bgp_timers === 'conservative',
    msg: 'Default BGP timers (60/180s) in a DC fabric mean 3-minute convergence on BGP failure without BFD.',
    fix: 'Use DC Aggressive preset (3/9s) + BFD.',
    fields: ['fs-protocols'],
  },
];

export function validateIntent(intent: IntentObject): ValidationResult[] {
  const violations: ValidationResult[] = [];
  for (const rule of CONSTRAINTS) {
    try {
      if (rule.check(intent)) violations.push({ ...rule, triggered: true });
    } catch {
      // skip malformed intent fields
    }
  }
  return violations.sort((a, b) =>
    (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1)
  );
}
