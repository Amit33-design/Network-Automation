import { describe, it, expect } from 'vitest';
import { validateIntent } from '@/domain/constraints';
import { DEFAULT_INTENT } from '@/types/intent';
import type { IntentObject } from '@/types/intent';

describe('validateIntent — constraint rules (CLAUDE.md §5)', () => {
  it('clean intent returns no violations', () => {
    const intent: IntentObject = {
      ...DEFAULT_INTENT,
      protocols: { underlay: 'bgp', overlay: ['vxlan_evpn'], features: ['bfd', 'ecmp'] },
    };
    const result = validateIntent(intent);
    expect(result.filter((v) => v.severity === 'error')).toHaveLength(0);
  });

  it('R-01: EIGRP + VXLAN/EVPN is an error', () => {
    const intent: IntentObject = {
      ...DEFAULT_INTENT,
      protocols: { underlay: 'eigrp', overlay: ['vxlan_evpn'], features: [] },
    };
    const errors = validateIntent(intent).filter((v) => v.severity === 'error');
    expect(errors.some((e) => e.id === 'R-01')).toBe(true);
  });

  it('R-02: GENEVE + Cisco is an error', () => {
    const intent: IntentObject = {
      ...DEFAULT_INTENT,
      vendors: ['cisco'],
      protocols: { underlay: 'bgp', overlay: ['geneve'], features: [] },
    };
    const errors = validateIntent(intent).filter((v) => v.severity === 'error');
    expect(errors.some((e) => e.id === 'R-02')).toBe(true);
  });

  it('R-03: FlowSpec without BGP underlay is an error', () => {
    const intent: IntentObject = {
      ...DEFAULT_INTENT,
      protocols: { underlay: 'ospf', overlay: [], features: ['flowspec'] },
    };
    const errors = validateIntent(intent).filter((v) => v.severity === 'error');
    expect(errors.some((e) => e.id === 'R-03')).toBe(true);
  });

  it('R-04: full redundancy + static routing is an error', () => {
    const intent: IntentObject = {
      ...DEFAULT_INTENT,
      topology: { ...DEFAULT_INTENT.topology, redundancy: 'full' },
      protocols: { underlay: 'static', overlay: [], features: [] },
    };
    const errors = validateIntent(intent).filter((v) => v.severity === 'error');
    expect(errors.some((e) => e.id === 'R-04')).toBe(true);
  });

  it('R-05: campus + IS-IS is a warning (not error)', () => {
    const intent: IntentObject = {
      ...DEFAULT_INTENT,
      use_case: 'campus',
      protocols: { underlay: 'is-is', overlay: [], features: [] },
    };
    const results = validateIntent(intent);
    const r05 = results.find((v) => v.id === 'R-05');
    expect(r05).toBeDefined();
    expect(r05?.severity).toBe('warning');
  });

  it('R-06: InfiniBand transport without NVIDIA is a warning', () => {
    const intent: IntentObject = {
      ...DEFAULT_INTENT,
      vendors: ['cisco'],
      gpu: { ...DEFAULT_INTENT.gpu, transport: 'ib' },
    };
    const results = validateIntent(intent);
    expect(results.some((v) => v.id === 'R-06')).toBe(true);
  });

  it('multiple violations can fire simultaneously', () => {
    const intent: IntentObject = {
      ...DEFAULT_INTENT,
      vendors: ['cisco'],
      protocols: { underlay: 'eigrp', overlay: ['vxlan_evpn', 'geneve'], features: ['flowspec'] },
      topology: { ...DEFAULT_INTENT.topology, redundancy: 'full' },
    };
    // R-01 (eigrp+evpn), R-02 (geneve+cisco), R-03 (flowspec without bgp), R-04 (full+eigrp treated as static? No - R-04 is static)
    const errors = validateIntent(intent).filter((v) => v.severity === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
