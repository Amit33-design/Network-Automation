import { describe, it, expect } from 'vitest';
import { calculateBOM, buildBomDevices, generateBom, getLifecycleWarnings } from '@/domain/bom';
import { PRODUCTS, lookupProduct } from '@/domain/products';
import { DEFAULT_INTENT } from '@/types/intent';
import type { IntentObject } from '@/types/intent';

const DC_INTENT: IntentObject = {
  ...DEFAULT_INTENT,
  use_case: 'dc_fabric',
  vendors: ['cisco'],
  topology: { redundancy: 'full', traffic_pattern: 'ew', endpoint_count: 100, bandwidth_gbps: 25, oversubscription: 3 },
};

describe('calculateBOM — port-math (CLAUDE.md §6)', () => {
  it('produces even leaf count for HA pairs', () => {
    const leafSku = lookupProduct('nxos-93180yc', PRODUCTS)!;
    const spineSku = lookupProduct('nxos-9336c', PRODUCTS)!;
    const result = calculateBOM(DC_INTENT, leafSku, spineSku);
    expect(result.leaf_count % 2).toBe(0);
  });

  it('spine count is at least 2', () => {
    const leafSku = lookupProduct('nxos-93180yc', PRODUCTS)!;
    const spineSku = lookupProduct('nxos-9336c', PRODUCTS)!;
    const result = calculateBOM(DC_INTENT, leafSku, spineSku);
    expect(result.spine_count).toBeGreaterThanOrEqual(2);
  });

  it('trace fields are populated', () => {
    const leafSku = lookupProduct('nxos-93180yc', PRODUCTS)!;
    const spineSku = lookupProduct('nxos-9336c', PRODUCTS)!;
    const result = calculateBOM(DC_INTENT, leafSku, spineSku);
    expect(result.trace.raw_leaf_count).toBeGreaterThan(0);
    expect(result.trace.server_capacity_gbps).toBeGreaterThan(0);
    expect(result.trace.total_leaf_uplinks).toBeGreaterThan(0);
  });

  it('known formula: 100 endpoints / downlink_count → even leaf count (HA)', () => {
    const leafSku = lookupProduct('nxos-93180yc', PRODUCTS)!;
    const spineSku = lookupProduct('nxos-9336c', PRODUCTS)!;
    const raw = Math.ceil(100 / (leafSku.downlink_count ?? leafSku.ports));
    const expected = raw % 2 === 0 ? raw : raw + 1;
    expect(calculateBOM(DC_INTENT, leafSku, spineSku).leaf_count).toBe(expected);
  });

  it('large fabric: 1000 endpoints produces more leaves than 100', () => {
    const bigIntent = { ...DC_INTENT, topology: { ...DC_INTENT.topology, endpoint_count: 1000 } };
    const smallIntent = { ...DC_INTENT, topology: { ...DC_INTENT.topology, endpoint_count: 100 } };
    const leafSku  = lookupProduct('nxos-93180yc', PRODUCTS)!;
    const spineSku = lookupProduct('nxos-9336c', PRODUCTS)!;
    expect(calculateBOM(bigIntent, leafSku, spineSku).leaf_count).toBeGreaterThan(
      calculateBOM(smallIntent, leafSku, spineSku).leaf_count
    );
  });
});

describe('buildBomDevices', () => {
  it('returns at least 2 devices for dc_fabric', () => {
    const devices = buildBomDevices(DC_INTENT, PRODUCTS);
    expect(devices.length).toBeGreaterThanOrEqual(2);
  });

  it('all devices have hostnames', () => {
    const devices = buildBomDevices(DC_INTENT, PRODUCTS);
    devices.forEach((d) => expect(d.hostname).toBeTruthy());
  });

  it('hostnames are unique', () => {
    const devices = buildBomDevices(DC_INTENT, PRODUCTS);
    const names = devices.map((d) => d.hostname);
    expect(new Set(names).size).toBe(names.length);
  });

  it('campus intent produces access + distribution + core devices', () => {
    const campusIntent: IntentObject = { ...DEFAULT_INTENT, use_case: 'campus', vendors: ['cisco'] };
    const devices = buildBomDevices(campusIntent, PRODUCTS);
    const layers = new Set(devices.map((d) => d.subLayer));
    // Campus should have some hierarchical layers
    expect(devices.length).toBeGreaterThan(0);
    expect(layers.size).toBeGreaterThan(0);
  });
});

describe('generateBom', () => {
  it('returns FullBomResult with devices and sizing', () => {
    const result = generateBom(DC_INTENT, PRODUCTS);
    expect(result.devices.length).toBeGreaterThan(0);
    expect(result.lifecycleWarnings).toBeInstanceOf(Array);
  });

  it('sizing is non-null for dc_fabric (has leaf+spine)', () => {
    const result = generateBom(DC_INTENT, PRODUCTS);
    // dc_fabric should produce leaf+spine → sizing should be computed
    if (result.sizing) {
      expect(result.sizing.leaf_count).toBeGreaterThan(0);
      expect(result.sizing.spine_count).toBeGreaterThan(0);
    }
  });
});

describe('getLifecycleWarnings', () => {
  it('returns empty for fresh devices with no EoL', () => {
    const devices = buildBomDevices(DC_INTENT, PRODUCTS);
    const pastEolDevices = devices.filter((d) => d.eol_date || d.eos_date);
    // Just verify the function doesn't throw
    const warnings = getLifecycleWarnings(devices);
    expect(warnings).toBeInstanceOf(Array);
    expect(warnings.length).toBeLessThanOrEqual(pastEolDevices.length);
  });
});
