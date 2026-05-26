import type { DeviceEntry } from './bom';

const RACK_SIZE_U = 42;

const U_HEIGHT: Record<string, number> = {
  'super-spine':  2,
  spine:          2,
  core:           2,
  distribution:   2,
  leaf:           1,
  access:         1,
  firewall:       2,
  'wan-edge':     2,
  'cloud-transit':0,
  'cloud-gw':     0,
};

const ROLE_ORDER = [
  'super-spine','spine','core','distribution','leaf','access','firewall','wan-edge',
];

export const ROLE_COLOR: Record<string, string> = {
  'super-spine': '#6366f1',
  spine:         '#3b82f6',
  core:          '#8b5cf6',
  distribution:  '#a855f7',
  leaf:          '#22c55e',
  access:        '#14b8a6',
  firewall:      '#f97316',
  'wan-edge':    '#eab308',
};

function uHeight(dev: DeviceEntry): number {
  const h = U_HEIGHT[dev.subLayer];
  return h !== undefined ? h : 1;
}

function rackId(index: number): string {
  return 'A' + String(index + 1).padStart(2, '0');
}

export interface PlacedDevice extends DeviceEntry {
  rack: string;
  unit: number;
  unitHeight: number;
}

export interface Rack {
  id: string;
  devices: PlacedDevice[];
  freeU: number;
  slots: Array<PlacedDevice | null>;
}

export function assignRackPositions(devices: DeviceEntry[]): Rack[] {
  if (!devices.length) return [];

  const physDevices = devices
    .filter((d) => uHeight(d) > 0)
    .map((d) => ({ ...d }) as PlacedDevice);
  const virtDevices = devices
    .filter((d) => uHeight(d) === 0)
    .map((d) => ({ ...d }) as PlacedDevice);

  physDevices.sort((a, b) => {
    let ai = ROLE_ORDER.indexOf(a.subLayer);
    let bi = ROLE_ORDER.indexOf(b.subLayer);
    if (ai === -1) ai = ROLE_ORDER.length;
    if (bi === -1) bi = ROLE_ORDER.length;
    return ai - bi;
  });

  const racks: Rack[] = [];

  function newRack(): Rack {
    const r: Rack = {
      id: rackId(racks.length),
      slots: new Array<PlacedDevice | null>(RACK_SIZE_U + 2).fill(null),
      devices: [],
      freeU: RACK_SIZE_U,
    };
    racks.push(r);
    return r;
  }

  let currentRack = newRack();
  let lastRole: string | null = null;
  let nextStart = RACK_SIZE_U;

  function startNewRack() {
    currentRack = newRack();
    nextStart = RACK_SIZE_U;
    lastRole = null;
  }

  for (const dev of physDevices) {
    const h   = uHeight(dev);
    const gap = lastRole !== null && lastRole !== dev.subLayer ? 1 : 0;

    if (nextStart - h - gap < 0) {
      startNewRack();
    }

    nextStart -= gap;
    const topU = nextStart;
    const botU = nextStart - h + 1;

    dev.rack       = currentRack.id;
    dev.unit       = topU;
    dev.unitHeight = h;

    for (let u = topU; u >= botU; u--) {
      currentRack.slots[u] = dev;
    }
    currentRack.devices.push(dev);
    currentRack.freeU -= h + gap;
    nextStart = botU - 1;
    lastRole = dev.subLayer;
  }

  for (const dev of virtDevices) {
    dev.rack       = 'VIRTUAL';
    dev.unit       = 0;
    dev.unitHeight = 0;
  }

  // Merge virtual devices back into the returned list — callers filter as needed
  return racks;
}

const PDU_SIZES_KW = [7.2, 10.4, 14.4, 17.3, 21.6, 36, 60];

const COOLING_TIERS = [
  { maxW: 5000,     label: 'Standard air (≤5 kW)',            desc: '2 perforated floor tiles per rack, standard CRAC airflow' },
  { maxW: 10000,    label: 'High-density air (5–10 kW)',       desc: 'Blanking panels essential; consider hot-aisle/cold-aisle containment' },
  { maxW: 20000,    label: 'In-row cooling (10–20 kW)',        desc: 'In-row CRAH or rear-door heat exchanger recommended' },
  { maxW: Infinity, label: 'Liquid/direct cooling (>20 kW)',  desc: 'Direct liquid cooling or liquid-cooled rear-door HX required' },
];

const BTU_PER_WATT_HR    = 3.412;
const TONS_PER_KW        = 0.2843;
const DEFAULT_PUE        = 1.5;
const POWER_USD_PER_KWH  = 0.10;

function pduSize(rackPowerW: number): number {
  const needed = rackPowerW / 1000 * 1.25;
  for (const size of PDU_SIZES_KW) {
    if (size >= needed) return size;
  }
  return Math.ceil(needed / 10) * 10;
}

function coolingTier(rackPowerW: number) {
  return COOLING_TIERS.find((t) => rackPowerW <= t.maxW) ?? COOLING_TIERS[COOLING_TIERS.length - 1];
}

export interface RackPowerEntry {
  rackId: string;
  deviceCount: number;
  totalPowerW: number;
  totalPowerKw: number;
  usedU: number;
  freeU: number;
  pduKw: number;
  coolingKw: number;
  coolTons: number;
  btuHr: number;
  tier: { label: string; desc: string };
}

export interface RackPowerTotals {
  totalITW: number;
  totalITKw: number;
  facilityKw: number;
  coolingKw: number;
  coolingTons: number;
  annualKwh: number;
  annualCostUSD: number;
  rackCount: number;
}

export interface RackPowerResult {
  racks: RackPowerEntry[];
  pue: number;
  totals: RackPowerTotals;
}

export function calcRackPower(devices: DeviceEntry[], pue = DEFAULT_PUE): RackPowerResult {
  if (!devices.length) return { racks: [], pue, totals: {} as RackPowerTotals };

  const rackMap: Record<string, { rackId: string; totalPowerW: number; usedU: number; count: number }> = {};

  for (const d of devices) {
    if (!d.rack || d.rack === 'VIRTUAL') continue;
    if (!rackMap[d.rack]) rackMap[d.rack] = { rackId: d.rack, totalPowerW: 0, usedU: 0, count: 0 };
    rackMap[d.rack].totalPowerW += d.powerW ?? 0;
    rackMap[d.rack].usedU       += d.unitHeight || uHeight(d);
    rackMap[d.rack].count++;
  }

  const rackEntries: RackPowerEntry[] = Object.values(rackMap).map((r) => {
    const pw       = r.totalPowerW;
    const pduKw    = pduSize(pw);
    const tier     = coolingTier(pw);
    const btuHr    = Math.round(pw * BTU_PER_WATT_HR);
    const coolingKw = Math.round(pw / 1000 * 10) / 10;
    const coolTons  = Math.round(coolingKw * TONS_PER_KW * 10) / 10;
    return {
      rackId:      r.rackId,
      deviceCount: r.count,
      totalPowerW: pw,
      totalPowerKw:Math.round(pw / 100) / 10,
      usedU:       r.usedU,
      freeU:       RACK_SIZE_U - r.usedU,
      pduKw,
      coolingKw,
      coolTons,
      btuHr,
      tier,
    };
  });

  const totalITW     = rackEntries.reduce((s, r) => s + r.totalPowerW, 0);
  const facilityW    = Math.round(totalITW * pue);
  const coolingW     = facilityW - totalITW;
  const coolingTons  = Math.round(coolingW / 1000 * TONS_PER_KW * 10) / 10;
  const annualKwh    = Math.round(facilityW * 8760 / 1000);
  const annualCostUSD= Math.round(annualKwh * POWER_USD_PER_KWH);

  return {
    racks: rackEntries,
    pue,
    totals: {
      totalITW,
      totalITKw:   Math.round(totalITW / 100) / 10,
      facilityKw:  Math.round(facilityW / 100) / 10,
      coolingKw:   Math.round(coolingW / 100) / 10,
      coolingTons,
      annualKwh,
      annualCostUSD,
      rackCount:   rackEntries.length,
    },
  };
}

export function exportRackLayoutCSV(devices: DeviceEntry[]): string {
  const header = 'Hostname,Model,Vendor,Role,Rack,Top-U,Height-U,Power-W';
  const rows = devices.map((d) =>
    [d.hostname ?? '', d.model ?? '', d.vendor ?? '', d.subLayer ?? '',
     d.rack ?? '', d.unit ?? '', d.unitHeight ?? (U_HEIGHT[d.subLayer] ?? 1),
     d.powerW ?? ''].join(','),
  );
  return [header, ...rows].join('\n');
}
