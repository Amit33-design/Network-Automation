import { describe, it, expect } from 'vitest';
import { generateAllConfigs, BGP_TIMER_PRESETS } from '@/domain/configgen';
import { buildBomDevices } from '@/domain/bom';
import { PRODUCTS } from '@/domain/products';
import { DEFAULT_INTENT } from '@/types/intent';
import type { IntentObject } from '@/types/intent';

const DC_INTENT: IntentObject = {
  ...DEFAULT_INTENT,
  use_case: 'dc_fabric',
  vendors: ['cisco'],
  topology: { redundancy: 'full', traffic_pattern: 'ew', endpoint_count: 48, bandwidth_gbps: 25, oversubscription: 3 },
  protocols: { underlay: 'bgp', overlay: ['vxlan_evpn'], features: ['bfd', 'ecmp', 'vrf'] },
};

const ARISTA_INTENT: IntentObject = {
  ...DC_INTENT,
  vendors: ['arista'],
};

describe('BGP_TIMER_PRESETS', () => {
  it('dc_aggressive has 3/9 keepalive/hold', () => {
    expect(BGP_TIMER_PRESETS.dc_aggressive.keepalive).toBe(3);
    expect(BGP_TIMER_PRESETS.dc_aggressive.hold).toBe(9);
  });

  it('conservative has 60/180', () => {
    expect(BGP_TIMER_PRESETS.conservative.keepalive).toBe(60);
    expect(BGP_TIMER_PRESETS.conservative.hold).toBe(180);
  });

  it('all three presets defined', () => {
    expect(Object.keys(BGP_TIMER_PRESETS)).toEqual(
      expect.arrayContaining(['dc_aggressive', 'wan_standard', 'conservative'])
    );
  });
});

describe('generateAllConfigs — Cisco NX-OS', () => {
  const devices = buildBomDevices(DC_INTENT, PRODUCTS);
  const configs = generateAllConfigs(DC_INTENT, devices);

  it('generates a config for every device', () => {
    expect(Object.keys(configs).length).toBe(devices.length);
  });

  it('all config values are non-empty strings', () => {
    Object.values(configs).forEach((cfg) => {
      expect(typeof cfg).toBe('string');
      expect(cfg.length).toBeGreaterThan(0);
    });
  });

  it('spine configs contain "router bgp"', () => {
    const spines = devices.filter((d) => d.subLayer === 'spine');
    spines.forEach((d) => {
      const cfg = configs[d.hostname];
      expect(cfg).toMatch(/router bgp/i);
    });
  });

  it('leaf configs contain EVPN-related config when overlay includes vxlan_evpn', () => {
    const leaves = devices.filter((d) => d.subLayer === 'leaf');
    leaves.forEach((d) => {
      const cfg = configs[d.hostname];
      // EVPN features or NVE overlay
      expect(cfg).toMatch(/evpn|nv overlay|nve/i);
    });
  });

  it('all device hostnames appear as "hostname X" in their config', () => {
    devices.forEach((d) => {
      const cfg = configs[d.hostname];
      expect(cfg).toMatch(new RegExp(`hostname\\s+${d.hostname}`, 'i'));
    });
  });
});

describe('generateAllConfigs — Arista EOS', () => {
  const devices = buildBomDevices(ARISTA_INTENT, PRODUCTS);
  const configs = generateAllConfigs(ARISTA_INTENT, devices);

  it('generates configs for all Arista devices', () => {
    expect(Object.keys(configs).length).toBe(devices.length);
    Object.values(configs).forEach((cfg) => expect(cfg.length).toBeGreaterThan(0));
  });

  it('Arista spine configs do not contain NX-OS "feature" commands', () => {
    const spines = devices.filter((d) => d.subLayer === 'spine');
    if (spines.length > 0) {
      const cfg = configs[spines[0].hostname];
      expect(cfg).not.toMatch(/^feature\s/m);
    }
  });
});

describe('generateAllConfigs — empty devices', () => {
  it('returns empty object for no devices', () => {
    const configs = generateAllConfigs(DC_INTENT, []);
    expect(configs).toEqual({});
  });
});

describe('generateAllConfigs — feature flags', () => {
  it('QoS feature produces QoS-related config blocks', () => {
    const qosIntent = { ...DC_INTENT, protocols: { ...DC_INTENT.protocols, features: [...DC_INTENT.protocols.features, 'qos'] } };
    const devices = buildBomDevices(qosIntent, PRODUCTS);
    const configs = generateAllConfigs(qosIntent, devices);
    const allConfigs = Object.values(configs).join('\n');
    expect(allConfigs).toMatch(/class-map|policy-map|qos|dscp/i);
  });

  it('IPv6 feature produces IPv6 config blocks', () => {
    const v6Intent = { ...DC_INTENT, protocols: { ...DC_INTENT.protocols, features: [...DC_INTENT.protocols.features, 'ipv6'] } };
    const devices = buildBomDevices(v6Intent, PRODUCTS);
    const configs = generateAllConfigs(v6Intent, devices);
    const allConfigs = Object.values(configs).join('\n');
    expect(allConfigs).toMatch(/ipv6|ospfv3|fd00/i);
  });
});
