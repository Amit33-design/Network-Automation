import type { IntentObject } from '../types/intent';
import type { DeviceEntry } from './bom';

export interface TopologyNode {
  id: string;
  hostname: string;
  model: string;
  role: string;
  asn?: string;
  loopback?: string;
  color: string;
  layer: 'spine' | 'leaf' | 'distribution' | 'access' | 'wan' | 'cloud' | 'firewall' | 'other';
}

export interface TopologyLink {
  id: string;
  source: string;
  target: string;
  speed: string;
  layerPair: string;
  label?: string;
}

export interface TopologyGraph {
  nodes: TopologyNode[];
  links: TopologyLink[];
  useCase: string;
  title: string;
}

const ROLE_COLOR: Record<string, string> = {
  spine:               '#3b82f6',
  'super-spine':       '#6366f1',
  leaf:                '#22c55e',
  core:                '#8b5cf6',
  distribution:        '#a855f7',
  access:              '#14b8a6',
  firewall:            '#f97316',
  'wan-edge':          '#eab308',
  'pe-router':         '#6366f1',
  'p-router':          '#818cf8',
  'sdwan-controller':  '#64748b',
  'sdwan-orchestrator':'#94a3b8',
  'cloud-transit':     '#64748b',
  'cloud-gw':          '#60a5fa',
  fronthaul:           '#22c55e',
  midhaul:             '#3b82f6',
  'storage-fabric':    '#6366f1',
  'storage-leaf':      '#22c55e',
};

function roleToLayer(subLayer: string): TopologyNode['layer'] {
  if (['spine','super-spine','p-router'].includes(subLayer))  return 'spine';
  if (['leaf','fronthaul','storage-leaf'].includes(subLayer)) return 'leaf';
  if (['distribution','core','pe-router','storage-fabric'].includes(subLayer)) return 'distribution';
  if (['access'].includes(subLayer)) return 'access';
  if (['wan-edge','sdwan-controller','sdwan-orchestrator'].includes(subLayer)) return 'wan';
  if (['cloud-transit','cloud-gw'].includes(subLayer)) return 'cloud';
  if (['firewall'].includes(subLayer)) return 'firewall';
  return 'other';
}

// Simplified ASN assignment for topology labeling
function assignAsn(device: DeviceEntry, intent: IntentObject, index: number): string {
  const baseAsn = intent.protocols.underlay === 'bgp' ? 65000 : 0;
  if (!baseAsn) return '';
  const layer = roleToLayer(device.subLayer);
  if (layer === 'spine') return String(baseAsn + 1);
  return String(baseAsn + 100 + index);
}

const CONNECTS: Array<{ from: string; to: string }> = [
  { from: 'spine',         to: 'leaf'         },
  { from: 'super-spine',   to: 'spine'        },
  { from: 'core',          to: 'distribution' },
  { from: 'distribution',  to: 'access'       },
  { from: 'wan-edge',      to: 'spine'        },
  { from: 'wan-edge',      to: 'distribution' },
  { from: 'firewall',      to: 'spine'        },
  { from: 'firewall',      to: 'distribution' },
  { from: 'cloud-transit', to: 'cloud-gw'     },
  { from: 'pe-router',     to: 'p-router'     },
  { from: 'fronthaul',     to: 'midhaul'      },
  { from: 'storage-fabric',to: 'storage-leaf' },
];

function ucTitle(useCase: string): string {
  const labels: Record<string, string> = {
    dc_fabric:  'Data Center Leaf-Spine',
    gpu_cluster:'AI/GPU Cluster',
    campus:     'Campus/Enterprise LAN',
    hybrid:     'Hybrid Campus+DC',
    wan:        'WAN/SD-WAN',
    dci:        'Multi-Site DCI',
    multicloud: 'Enterprise→Multicloud',
    sp_mpls:    'Service Provider MPLS',
    private_5g: 'Private 5G/O-RAN',
    storage:    'Storage Networking',
  };
  return labels[useCase] ?? useCase;
}

export function buildTopologyGraph(
  intent: IntentObject,
  devices: DeviceEntry[],
): TopologyGraph {
  const nodes: TopologyNode[] = devices.map((dev, i) => ({
    id:       dev.hostname ?? dev.id,
    hostname: dev.hostname ?? dev.id,
    model:    dev.model,
    role:     dev.subLayer,
    asn:      assignAsn(dev, intent, i),
    color:    ROLE_COLOR[dev.subLayer] ?? '#64748b',
    layer:    roleToLayer(dev.subLayer),
  }));

  const byLayer: Record<string, TopologyNode[]> = {};
  for (const n of nodes) {
    (byLayer[n.role] ??= []).push(n);
  }

  const links: TopologyLink[] = [];
  let linkSeq = 1;

  for (const conn of CONNECTS) {
    const fromNodes = byLayer[conn.from] ?? [];
    const toNodes   = byLayer[conn.to]   ?? [];
    if (!fromNodes.length || !toNodes.length) continue;

    // Spine-leaf: full mesh. Others: first→first (representative)
    const isFullMesh = conn.from === 'spine' || conn.from === 'super-spine' || conn.from === 'pe-router';

    if (isFullMesh) {
      for (const src of fromNodes) {
        for (const dst of toNodes) {
          const srcDev = devices.find((d) => d.hostname === src.id);
          links.push({
            id:        `link-${linkSeq++}`,
            source:    src.id,
            target:    dst.id,
            speed:     srcDev?.speed ?? '100G',
            layerPair: `${conn.from}-${conn.to}`,
          });
        }
      }
    } else {
      // Single representative link per pair for clarity
      const srcDev = devices.find((d) => d.hostname === fromNodes[0].id);
      links.push({
        id:        `link-${linkSeq++}`,
        source:    fromNodes[0].id,
        target:    toNodes[0].id,
        speed:     srcDev?.speed ?? '100G',
        layerPair: `${conn.from}-${conn.to}`,
        label:     fromNodes.length > 1 ? `${fromNodes.length}×${conn.from}` : undefined,
      });
    }
  }

  return {
    nodes,
    links,
    useCase: intent.use_case,
    title:   ucTitle(intent.use_case),
  };
}
