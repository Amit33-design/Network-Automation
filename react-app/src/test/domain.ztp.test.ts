import { describe, it, expect } from 'vitest';
import {
  ztpInitDevices, ztpAdvanceState, ztpMarkFailed,
  genDay0Config, genZtpDockerCompose, genZtpDhcpScope, genOsImageManifest,
  ZTP_STATE_TRANSITIONS, OS_IMAGE_CATALOG,
} from '@/domain/ztp';
import { buildBomDevices } from '@/domain/bom';
import { PRODUCTS } from '@/domain/products';
import { DEFAULT_INTENT } from '@/types/intent';

const DC_INTENT = { ...DEFAULT_INTENT, use_case: 'dc_fabric' as const, vendors: ['cisco' as const] };

describe('ZTP state machine', () => {
  const devices = buildBomDevices(DC_INTENT, PRODUCTS);
  const states  = ztpInitDevices(devices);

  it('initialises all devices as REGISTERED', () => {
    states.forEach((s) => expect(s.state).toBe('REGISTERED'));
  });

  it('advance moves REGISTERED → POWERED_ON', () => {
    const next = ztpAdvanceState(states[0]);
    expect(next.state).toBe('POWERED_ON');
  });

  it('advance through full chain reaches ONLINE', () => {
    let s = states[0];
    while (ZTP_STATE_TRANSITIONS[s.state] !== null) {
      s = ztpAdvanceState(s);
    }
    expect(s.state).toBe('ONLINE');
  });

  it('markFailed sets state to FAILED and records error', () => {
    const failed = ztpMarkFailed(states[0], 'TFTP timeout');
    expect(failed.state).toBe('FAILED');
    expect(failed.error).toBe('TFTP timeout');
  });

  it('advance on FAILED does not change state', () => {
    const failed = ztpMarkFailed(states[0], 'err');
    const advanced = ztpAdvanceState(failed);
    expect(advanced.state).toBe('FAILED');
  });
});

describe('genDay0Config', () => {
  const devices = buildBomDevices(DC_INTENT, PRODUCTS);

  it('generates non-empty config for every device', () => {
    devices.forEach((d) => {
      const cfg = genDay0Config(d, DC_INTENT);
      expect(cfg.length).toBeGreaterThan(0);
    });
  });

  it('Day-0 config contains hostname', () => {
    const d = devices[0];
    const cfg = genDay0Config(d, DC_INTENT);
    expect(cfg).toMatch(new RegExp(d.hostname, 'i'));
  });

  it('Day-0 config does NOT contain BGP (management-plane only per §9)', () => {
    devices.forEach((d) => {
      const cfg = genDay0Config(d, DC_INTENT);
      expect(cfg).not.toMatch(/^router bgp/im);
    });
  });

  it('Day-0 config does NOT contain VXLAN/VNI', () => {
    devices.forEach((d) => {
      const cfg = genDay0Config(d, DC_INTENT);
      expect(cfg).not.toMatch(/vxlan|vni|nve/i);
    });
  });

  it('Day-0 config contains NTP server', () => {
    const d = devices[0];
    const cfg = genDay0Config(d, DC_INTENT);
    expect(cfg).toMatch(/ntp/i);
  });
});

describe('genZtpDockerCompose', () => {
  it('produces valid YAML structure with nginx and tftpd', () => {
    const yaml = genZtpDockerCompose('TESTSITE');
    expect(yaml).toContain('nginx');
    expect(yaml).toContain('tftpd');
    expect(yaml).toContain('TESTSITE');
  });
});

describe('genZtpDhcpScope', () => {
  it('includes static bindings for each device', () => {
    const devices = buildBomDevices(DC_INTENT, PRODUCTS);
    const dhcp = genZtpDhcpScope(devices, 'TEST');
    devices.forEach((d) => {
      if (d.hostname) expect(dhcp).toContain(d.hostname);
    });
  });

  it('includes subnet declaration', () => {
    const dhcp = genZtpDhcpScope([], 'TEST');
    expect(dhcp).toMatch(/subnet\s+192\.168\.100\.0/);
  });
});

describe('OS_IMAGE_CATALOG', () => {
  it('has entries for all major platforms', () => {
    ['nxos', 'eos', 'junos', 'iosxe', 'iosxr', 'sonic'].forEach((p) => {
      expect(OS_IMAGE_CATALOG[p]).toBeDefined();
      expect(OS_IMAGE_CATALOG[p].stable.filename).toBeTruthy();
      expect(OS_IMAGE_CATALOG[p].latest.filename).toBeTruthy();
    });
  });
});

describe('genOsImageManifest', () => {
  it('produces a shell script', () => {
    const devices = buildBomDevices(DC_INTENT, PRODUCTS);
    const manifest = genOsImageManifest(devices, 'stable');
    expect(manifest).toMatch(/^#!/);
    expect(manifest).toContain('IMAGE_BASE');
  });
});
