import { describe, it, expect } from 'vitest';
import { buildTopologyGraph } from '@/domain/topology';
import { buildBomDevices } from '@/domain/bom';
import { PRODUCTS } from '@/domain/products';
import { DEFAULT_INTENT } from '@/types/intent';
import type { IntentObject } from '@/types/intent';

const DC_INTENT: IntentObject = {
  ...DEFAULT_INTENT,
  use_case: 'dc_fabric',
  vendors: ['cisco'],
  topology: { redundancy: 'full', traffic_pattern: 'ew', endpoint_count: 48, bandwidth_gbps: 25, oversubscription: 3 },
};

describe('buildTopologyGraph — dc_fabric', () => {
  const devices = buildBomDevices(DC_INTENT, PRODUCTS);
  const graph   = buildTopologyGraph(DC_INTENT, devices);

  it('produces nodes for every device', () => {
    expect(graph.nodes.length).toBe(devices.length);
  });

  it('every node has id, hostname, role, color', () => {
    graph.nodes.forEach((n) => {
      expect(n.id).toBeTruthy();
      expect(n.hostname).toBeTruthy();
      expect(n.role).toBeTruthy();
      expect(n.color).toBeTruthy();
    });
  });

  it('node IDs are unique', () => {
    const ids = graph.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces links between spine and leaf nodes', () => {
    expect(graph.links.length).toBeGreaterThan(0);
    // all link source/target IDs should exist as node IDs
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    graph.links.forEach((l) => {
      expect(nodeIds.has(l.source), `source ${l.source} not in nodes`).toBe(true);
      expect(nodeIds.has(l.target), `target ${l.target} not in nodes`).toBe(true);
    });
  });

  it('full mesh: every leaf connects to every spine', () => {
    const spineIds = graph.nodes.filter((n) => n.role === 'spine').map((n) => n.id);
    const leafIds  = graph.nodes.filter((n) => n.role === 'leaf').map((n) => n.id);

    spineIds.forEach((spineId) => {
      leafIds.forEach((leafId) => {
        const hasLink = graph.links.some(
          (l) => (l.source === spineId && l.target === leafId) ||
                 (l.source === leafId  && l.target === spineId)
        );
        expect(hasLink, `no link between ${spineId} and ${leafId}`).toBe(true);
      });
    });
  });
});

describe('buildTopologyGraph — empty devices', () => {
  it('returns empty nodes and links', () => {
    const graph = buildTopologyGraph(DC_INTENT, []);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.links).toHaveLength(0);
  });
});

describe('buildTopologyGraph — campus', () => {
  const campusIntent: IntentObject = { ...DEFAULT_INTENT, use_case: 'campus', vendors: ['cisco'] };
  const devices = buildBomDevices(campusIntent, PRODUCTS);
  const graph   = buildTopologyGraph(campusIntent, devices);

  it('produces nodes for campus devices', () => {
    if (devices.length > 0) {
      expect(graph.nodes.length).toBe(devices.length);
    }
  });
});
