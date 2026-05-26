import { describe, it, expect } from 'vitest';
import {
  SYMPTOM_DB, SYMPTOM_CATEGORIES,
  classifySymptom,
  bgpConvergencePredictor,
} from '@/domain/troubleshoot';
import { DEFAULT_INTENT } from '@/types/intent';

describe('SYMPTOM_DB', () => {
  it('has at least 30 entries', () => {
    expect(SYMPTOM_DB.length).toBeGreaterThanOrEqual(30);
  });

  it('every entry has required fields', () => {
    SYMPTOM_DB.forEach((e) => {
      expect(e.id).toBeTruthy();
      expect(e.cat).toBeTruthy();
      expect(e.symptom).toBeTruthy();
      expect(e.causes.length).toBeGreaterThan(0);
      expect(e.fix).toBeTruthy();
    });
  });

  it('all IDs are unique', () => {
    const ids = SYMPTOM_DB.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('SYMPTOM_CATEGORIES', () => {
  it('includes BGP category', () => {
    expect(SYMPTOM_CATEGORIES).toContain('BGP');
  });

  it('has multiple categories', () => {
    expect(SYMPTOM_CATEGORIES.length).toBeGreaterThanOrEqual(4);
  });
});

describe('classifySymptom', () => {
  it('returns matches for "bgp"', () => {
    const results = classifySymptom('bgp');
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns all entries for empty query', () => {
    const results = classifySymptom('');
    expect(results.length).toBe(SYMPTOM_DB.length);
  });

  it('filters by category when provided', () => {
    const bgpOnly = classifySymptom('session', 'BGP');
    bgpOnly.forEach((r) => expect(r.cat).toBe('BGP'));
  });

  it('results are sorted by relevance — bgp query returns BGP results first', () => {
    const results = classifySymptom('bgp');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].cat).toBe('BGP');
  });

  it('interface query returns interface-related symptoms', () => {
    const results = classifySymptom('interface');
    expect(results.length).toBeGreaterThan(0);
  });

  it('unknown phrase returns empty', () => {
    const results = classifySymptom('zzzzqqqxxx_no_match_expected');
    expect(results.length).toBe(0);
  });
});

describe('bgpConvergencePredictor', () => {
  it('returns ConvergenceEstimate with required fields', () => {
    const result = bgpConvergencePredictor({}, DEFAULT_INTENT);
    expect(result.best_ms).toBeGreaterThan(0);
    expect(result.worst_ms).toBeGreaterThanOrEqual(result.best_ms);
    expect(result.breakdown).toBeInstanceOf(Array);
    expect(result.breakdown.length).toBeGreaterThan(0);
    expect(result.sla).toBeDefined();
    expect(typeof result.meets_sla).toBe('boolean');
    expect(result.warnings).toBeInstanceOf(Array);
  });

  it('BFD enabled reduces convergence time vs no BFD', () => {
    const noBfd   = bgpConvergencePredictor({ has_bfd: false, hold_timer: 180 }, DEFAULT_INTENT);
    const withBfd = bgpConvergencePredictor({ has_bfd: true,  hold_timer: 9   }, DEFAULT_INTENT);
    expect(withBfd.best_ms).toBeLessThan(noBfd.worst_ms);
  });

  it('dc_fabric SLA is tighter than wan SLA', () => {
    // bgpConvergencePredictor reads use_case from params, not from intent
    const dc  = bgpConvergencePredictor({ use_case: 'dc_fabric' }, DEFAULT_INTENT);
    const wan = bgpConvergencePredictor({ use_case: 'wan' },        DEFAULT_INTENT);
    expect(dc.sla.target_ms).toBeLessThan(wan.sla.target_ms);
  });

  it('breakdown phases sum to approximately worst_ms', () => {
    const result = bgpConvergencePredictor({}, DEFAULT_INTENT);
    const sum = result.breakdown.reduce((acc, p) => acc + p.ms, 0);
    expect(Math.abs(sum - result.worst_ms)).toBeLessThanOrEqual(500);
  });
});
