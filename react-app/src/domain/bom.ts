import type { IntentObject } from '../types/intent';
import {
  PRODUCTS,
  SCALE_DEFS,
  getPreferredProducts,
  getScaleSize,
  lookupProduct,
  getLifecycleStatus,
  type Product,
} from './products';

// ─── BOM sizing formulas — CLAUDE.md §6 ─────────────────────────────────────

export interface BomSizingTrace {
  servers_per_leaf: number;
  raw_leaf_count: number;
  server_capacity_gbps: number;
  required_uplink_gbps: number;
  total_leaf_uplinks: number;
}

export interface BomSizingResult {
  leaf_count: number;
  spine_count: number;
  uplinks_per_leaf: number;
  uplink_capacity_ok: boolean;
  trace: BomSizingTrace;
  warning: string | null;
}

export function calculateBOM(
  intent: IntentObject,
  leafSku: Product,
  spineSku: Product,
): BomSizingResult {
  const { endpoint_count, bandwidth_gbps, oversubscription } = intent.topology;
  const downlinks = leafSku.downlink_count ?? leafSku.ports;
  const uplinkSpeed = leafSku.uplink_speed_gbps ?? 100;
  const uplinkCount = leafSku.uplinks;
  const spinePortCount = spineSku.ports;

  // Leaf sizing
  const rawLeaves = Math.ceil(endpoint_count / downlinks);
  const leafCount  = rawLeaves % 2 === 0 ? rawLeaves : rawLeaves + 1; // always even (HA pairs)

  // Uplink validation
  const serverCapacityPerLeaf = downlinks * bandwidth_gbps;
  const uplinksNeeded = Math.ceil(serverCapacityPerLeaf / oversubscription / uplinkSpeed);
  const uplinkOk = uplinksNeeded <= uplinkCount;

  // Spine sizing
  const totalLeafUplinks = leafCount * uplinksNeeded;
  const rawSpines = Math.ceil(totalLeafUplinks / spinePortCount);
  const spineCount = Math.max(rawSpines, 2); // minimum 2 for HA

  return {
    leaf_count: leafCount,
    spine_count: spineCount,
    uplinks_per_leaf: uplinksNeeded,
    uplink_capacity_ok: uplinkOk,
    trace: {
      servers_per_leaf: downlinks,
      raw_leaf_count: rawLeaves,
      server_capacity_gbps: serverCapacityPerLeaf,
      required_uplink_gbps: serverCapacityPerLeaf / oversubscription,
      total_leaf_uplinks: totalLeafUplinks,
    },
    warning: uplinkOk ? null :
      `${leafSku.model} has only ${uplinkCount}×${uplinkSpeed}GbE uplinks but ${uplinksNeeded} needed at ${oversubscription}:1 oversubscription`,
  };
}

// ─── Device entry — extended product with hostname/rack/BOM positioning ──────

export interface DeviceEntry extends Product {
  hostname: string;
  rack: string;
  unit: number;
  unitHeight: number;
  qty: number;
}

function makeHostname(role: string, index: number, site?: string): string {
  const prefix = site ? site.toLowerCase().replace(/\s+/g, '-') + '-' : '';
  const roleShort: Record<string, string> = {
    spine: 'spine',
    leaf: 'leaf',
    distribution: 'dist',
    access: 'acc',
    'wan-edge': 'wan',
    firewall: 'fw',
    'cloud-gw': 'cgw',
    'cloud-transit': 'ctr',
    'pe-router': 'pe',
    'p-router': 'pr',
    fronthaul: 'fh',
    midhaul: 'mh',
    'storage-fabric': 'san',
    'storage-leaf': 'sleaf',
    'sdwan-controller': 'vsmart',
    'sdwan-orchestrator': 'vbond',
  };
  const abbr = roleShort[role] ?? role.replace(/[^a-z0-9]/g, '');
  return prefix + abbr + String(index + 1).padStart(2, '0');
}

export function buildBomDevices(intent: IntentObject, products: Product[] = PRODUCTS): DeviceEntry[] {
  const useCase = intent.use_case;
  const scaleSizeKey = getScaleSize(intent);
  const scaleDef = SCALE_DEFS[scaleSizeKey][useCase] ?? SCALE_DEFS[scaleSizeKey]['dc'];
  const preferred = getPreferredProducts(useCase, intent.vendors);

  const devices: DeviceEntry[] = [];

  for (const [role, count] of Object.entries(scaleDef)) {
    const productId = preferred[role];
    if (!productId) continue;
    const sku = lookupProduct(productId, products);
    if (!sku) continue;

    for (let i = 0; i < count; i++) {
      devices.push({
        ...sku,
        hostname: makeHostname(role, i),
        rack: '',
        unit: 0,
        unitHeight: 0,
        qty: 1,
      });
    }
  }

  return devices;
}

// ─── Lifecycle banner data ────────────────────────────────────────────────────

export interface LifecycleItem {
  hostname: string;
  model: string;
  status: 'eol' | 'eos' | 'eol-soon';
  eol_date: string | null;
  eos_date: string | null;
  successor: string | null;
}

export function getLifecycleWarnings(devices: DeviceEntry[], today = new Date()): LifecycleItem[] {
  const seen = new Set<string>();
  const warnings: LifecycleItem[] = [];

  for (const dev of devices) {
    if (seen.has(dev.id)) continue;
    seen.add(dev.id);
    const status = getLifecycleStatus(dev, today);
    if (status !== 'active') {
      warnings.push({
        hostname: dev.hostname,
        model: dev.model,
        status,
        eol_date: dev.eol_date,
        eos_date: dev.eos_date,
        successor: dev.successor,
      });
    }
  }

  return warnings;
}

// ─── Full BOM result (devices + sizing math) ─────────────────────────────────

export interface FullBomResult {
  devices: DeviceEntry[];
  sizing: BomSizingResult | null;
  lifecycleWarnings: LifecycleItem[];
}

export function generateBom(intent: IntentObject, products: Product[] = PRODUCTS): FullBomResult {
  const devices = buildBomDevices(intent, products);

  // Run port-math sizing if we have leaf + spine
  const leaves = devices.filter((d) => d.subLayer === 'leaf');
  const spines = devices.filter((d) => d.subLayer === 'spine');
  let sizing: BomSizingResult | null = null;
  if (leaves.length > 0 && spines.length > 0) {
    sizing = calculateBOM(intent, leaves[0], spines[0]);
  }

  return {
    devices,
    sizing,
    lifecycleWarnings: getLifecycleWarnings(devices),
  };
}
