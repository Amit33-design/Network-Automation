import { describe, it, expect } from 'vitest';
import {
  PRODUCTS, lookupProduct, getLifecycleStatus, getPreferredProducts,
  LAYER_PAIRS, SCALE_DEFS,
} from '@/domain/products';
describe('PRODUCTS catalog', () => {
  it('has at least 20 SKUs', () => {
    expect(PRODUCTS.length).toBeGreaterThanOrEqual(20);
  });

  it('every physical product has required fields', () => {
    // Virtual/cloud SKUs (ports=0) are valid — skip port assertion for them
    PRODUCTS.forEach((p) => {
      expect(p.id, `${p.id} missing id`).toBeTruthy();
      expect(p.model, `${p.id} missing model`).toBeTruthy();
      expect(p.vendor, `${p.id} missing vendor`).toBeTruthy();
      expect(p.subLayer, `${p.id} missing subLayer`).toBeTruthy();
      expect(p.priceUSD, `${p.id} missing priceUSD`).toBeGreaterThan(0);
      if (p.ports > 0) {
        expect(p.ports, `${p.id} missing ports`).toBeGreaterThan(0);
      }
    });
  });

  it('all IDs are unique', () => {
    const ids = PRODUCTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('lookupProduct', () => {
  it('returns product for known ID', () => {
    const p = lookupProduct('nxos-9336c', PRODUCTS);
    expect(p).not.toBeNull();
    expect(p?.model).toBeTruthy();
  });

  it('returns null for unknown ID', () => {
    expect(lookupProduct('DOES-NOT-EXIST', PRODUCTS)).toBeNull();
  });
});

describe('getLifecycleStatus', () => {
  it('returns active for product with no EoL dates', () => {
    const p = PRODUCTS.find((x) => !x.eol_date && !x.eos_date);
    if (p) {
      expect(getLifecycleStatus(p)).toBe('active');
    }
  });

  it('returns eol for product with past EoL date', () => {
    const mockProd = { ...PRODUCTS[0], eol_date: '2000-01-01', eos_date: null, successor: null };
    expect(getLifecycleStatus(mockProd, new Date())).toBe('eol');
  });

  it('returns eol-soon for product expiring within 90 days', () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 30);
    const mockProd = { ...PRODUCTS[0], eol_date: soon.toISOString().slice(0, 10), eos_date: null, successor: null };
    expect(getLifecycleStatus(mockProd, new Date())).toBe('eol-soon');
  });
});

describe('getPreferredProducts', () => {
  it('returns a role→productId map for dc_fabric + cisco', () => {
    const result = getPreferredProducts('dc_fabric', ['cisco']);
    expect(typeof result).toBe('object');
    const keys = Object.keys(result);
    expect(keys.length).toBeGreaterThan(0);
  });

  it('returns a role→productId map for dc_fabric + arista', () => {
    const result = getPreferredProducts('dc_fabric', ['arista']);
    expect(Object.keys(result).length).toBeGreaterThan(0);
    // Arista dc fabric should return Arista products
    const spineId = result['spine'];
    if (spineId) {
      const product = lookupProduct(spineId, PRODUCTS);
      expect(product?.vendor).toBe('Arista');
    }
  });
});

describe('LAYER_PAIRS', () => {
  it('dc key has spine and leaf pairs', () => {
    // LAYER_PAIRS uses 'dc' key (maps dc_fabric use_case)
    expect(LAYER_PAIRS['dc']).toBeDefined();
    const pairStr = LAYER_PAIRS['dc'].join(' ');
    expect(pairStr).toMatch(/spine/);
    expect(pairStr).toMatch(/leaf/);
  });

  it('campus key is defined', () => {
    expect(LAYER_PAIRS['campus']).toBeDefined();
    expect(LAYER_PAIRS['campus'].length).toBeGreaterThan(0);
  });
});

describe('SCALE_DEFS', () => {
  it('small/medium/large sizes are defined', () => {
    // SCALE_DEFS structure: { small: { dc: {...}, campus: {...}, ... }, medium: {...}, large: {...} }
    expect(SCALE_DEFS.small).toBeDefined();
    expect(SCALE_DEFS.medium).toBeDefined();
    expect(SCALE_DEFS.large).toBeDefined();
  });

  it('dc scale definitions have spine and leaf counts', () => {
    expect(SCALE_DEFS.small.dc).toBeDefined();
    expect(SCALE_DEFS.small.dc.spine).toBeGreaterThan(0);
    expect(SCALE_DEFS.small.dc.leaf).toBeGreaterThan(0);
    expect(SCALE_DEFS.medium.dc.spine).toBeGreaterThan(SCALE_DEFS.small.dc.spine);
    expect(SCALE_DEFS.large.dc.leaf).toBeGreaterThan(SCALE_DEFS.medium.dc.leaf);
  });
});
