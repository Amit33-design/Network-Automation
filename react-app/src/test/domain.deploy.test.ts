import { describe, it, expect } from 'vitest';
import {
  genPreCheckScript, genPostCheckScript,
  genCanaryDeployScript, genDriftDetectionScript, genBatfishScript,
} from '@/domain/deploy';
import { genRollbackScript } from '@/domain/rollback';
import { generateAllConfigs } from '@/domain/configgen';
import { buildBomDevices } from '@/domain/bom';
import { PRODUCTS } from '@/domain/products';
import { DEFAULT_INTENT } from '@/types/intent';

const DC_INTENT = { ...DEFAULT_INTENT, use_case: 'dc_fabric' as const, vendors: ['cisco' as const] };
const devices = buildBomDevices(DC_INTENT, PRODUCTS);
const configs = generateAllConfigs(DC_INTENT, devices);

describe('genPreCheckScript', () => {
  it('generates Python script with device inventory', () => {
    const script = genPreCheckScript(devices, 'TEST');
    expect(script).toMatch(/python/i);
    expect(script).toContain('NET_USER');
    expect(script).toContain('NET_PASS');
  });

  it('includes all device hostnames in inventory', () => {
    const script = genPreCheckScript(devices, 'TEST');
    devices.forEach((d) => expect(script).toContain(d.hostname));
  });

  it('captures BGP summary command', () => {
    const script = genPreCheckScript(devices, 'TEST');
    expect(script).toMatch(/bgp|summary/i);
  });

  it('returns placeholder for empty device list', () => {
    const script = genPreCheckScript([], 'TEST');
    expect(script).toContain('#');
  });
});

describe('genPostCheckScript', () => {
  it('references baseline comparison', () => {
    const script = genPostCheckScript(devices, 'TEST');
    expect(script).toMatch(/baseline|diff|before|after/i);
  });

  it('includes all device hostnames', () => {
    const script = genPostCheckScript(devices, 'TEST');
    devices.forEach((d) => expect(script).toContain(d.hostname));
  });
});

describe('genCanaryDeployScript', () => {
  it('deploys canary device first', () => {
    const script = genCanaryDeployScript(devices, configs, 'TEST');
    expect(script).toMatch(/canary|first/i);
  });

  it('references BGP verification', () => {
    const script = genCanaryDeployScript(devices, configs, 'TEST');
    expect(script).toMatch(/bgp|verify/i);
  });
});

describe('genDriftDetectionScript', () => {
  it('uses base64-encoded intended configs', () => {
    const script = genDriftDetectionScript(devices, configs, 'TEST');
    expect(script).toMatch(/base64|diff/i);
  });

  it('includes drift output filename', () => {
    const script = genDriftDetectionScript(devices, configs, 'TEST');
    expect(script).toMatch(/drift/i);
  });
});

describe('genBatfishScript', () => {
  it('references pybatfish', () => {
    const script = genBatfishScript(devices, configs, 'TEST');
    expect(script).toMatch(/batfish|pybatfish/i);
  });
});

describe('genRollbackScript', () => {
  it('generates platform-native rollback commands (CLAUDE.md §7)', () => {
    const script = genRollbackScript(devices as unknown as Parameters<typeof genRollbackScript>[0]);
    expect(script.length).toBeGreaterThan(0);
    // NX-OS checkpoint strategy
    expect(script).toMatch(/checkpoint|rollback|configure replace|commit confirmed/i);
  });

  it('credentials from environment variables', () => {
    const script = genRollbackScript(devices as unknown as Parameters<typeof genRollbackScript>[0]);
    expect(script).toContain('NET_USER');
    expect(script).toContain('NET_PASS');
  });
});
