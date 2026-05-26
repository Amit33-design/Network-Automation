import type { DeviceEntry } from './bom';

export interface CableType {
  id: string;
  type: 'DAC' | 'AOC' | 'MPO' | 'LC-LC';
  desc: string;
  maxDist: number;
  speeds: string[];
  partPrefix: string;
  costPerM: number;
  unitCost: number;
}

export const CABLE_TYPES: CableType[] = [
  { id: 'DAC-1M',       type: 'DAC',   desc: 'Direct Attach Copper 1m',      maxDist: 1,     speeds: ['1G','10G','25G','40G','100G'],  partPrefix: 'SFP-H10GB-CU1M',   costPerM: 0,   unitCost: 25  },
  { id: 'DAC-3M',       type: 'DAC',   desc: 'Direct Attach Copper 3m',      maxDist: 3,     speeds: ['1G','10G','25G','40G','100G'],  partPrefix: 'SFP-H10GB-CU3M',   costPerM: 0,   unitCost: 35  },
  { id: 'DAC-5M',       type: 'DAC',   desc: 'Direct Attach Copper 5m',      maxDist: 5,     speeds: ['1G','10G','25G','40G','100G'],  partPrefix: 'SFP-H10GB-CU5M',   costPerM: 0,   unitCost: 45  },
  { id: 'QSFP-DAC-1M',  type: 'DAC',   desc: 'QSFP DAC 1m',                  maxDist: 1,     speeds: ['40G','100G','400G'],            partPrefix: 'QSFP-100G-CU1M',   costPerM: 0,   unitCost: 55  },
  { id: 'QSFP-DAC-3M',  type: 'DAC',   desc: 'QSFP DAC 3m',                  maxDist: 3,     speeds: ['40G','100G','400G'],            partPrefix: 'QSFP-100G-CU3M',   costPerM: 0,   unitCost: 65  },
  { id: 'AOC-10M',      type: 'AOC',   desc: 'Active Optical Cable 10m',      maxDist: 10,    speeds: ['10G','25G','40G','100G'],       partPrefix: 'SFP-10G-AOC10M',   costPerM: 8,   unitCost: 80  },
  { id: 'AOC-30M',      type: 'AOC',   desc: 'Active Optical Cable 30m',      maxDist: 30,    speeds: ['10G','25G','40G','100G'],       partPrefix: 'SFP-10G-AOC30M',   costPerM: 8,   unitCost: 240 },
  { id: 'QSFP-AOC-10M', type: 'AOC',   desc: 'QSFP AOC 10m',                  maxDist: 10,    speeds: ['40G','100G'],                   partPrefix: 'QSFP-100G-AOC10M', costPerM: 10,  unitCost: 100 },
  { id: 'LC-LC-SM',     type: 'LC-LC', desc: 'LC-LC Single-mode Fiber',        maxDist: 10000, speeds: ['1G','10G','25G','100G'],        partPrefix: 'LC-LC-SM',         costPerM: 0.5, unitCost: 15  },
  { id: 'MPO-12',       type: 'MPO',   desc: 'MPO-12 OM4 multimode',           maxDist: 100,   speeds: ['40G','100G','400G'],            partPrefix: 'MPO-12-OM4',       costPerM: 1.2, unitCost: 20  },
  { id: 'MPO-16',       type: 'MPO',   desc: 'MPO-16 OM5 multimode',           maxDist: 150,   speeds: ['400G'],                         partPrefix: 'MPO-16-OM5',       costPerM: 1.5, unitCost: 30  },
];

const PRIORITY: Record<string, number> = { DAC: 0, AOC: 1, MPO: 2, 'LC-LC': 3 };

export function selectCableType(distanceM: number, speed: string): CableType {
  let candidates = CABLE_TYPES.filter(
    (c) => c.maxDist >= distanceM && c.speeds.includes(speed),
  );
  if (!candidates.length) {
    candidates = CABLE_TYPES.filter((c) => c.type === 'LC-LC');
  }
  candidates.sort((a, b) => (PRIORITY[a.type] ?? 9) - (PRIORITY[b.type] ?? 9));
  return candidates[0] ?? CABLE_TYPES[CABLE_TYPES.length - 1];
}

function buildPartNumber(cable: CableType, speed: string, distanceM: number): string {
  return `${cable.partPrefix}-${speed.replace('G', '')}G-${distanceM}M`;
}

export interface CableEntry {
  id: number;
  layerPair: string;
  deviceA: string;
  portA: string;
  deviceB: string;
  portB: string;
  cableType: string;
  cableDesc: string;
  lengthM: number;
  qty: number;
  partNumber: string;
  unitCostUSD: number;
  totalCostUSD: number;
}

const CONNECTS: Array<{ from: string; to: string; key: string }> = [
  { from: 'spine',         to: 'leaf',         key: 'spine-leaf'    },
  { from: 'core',          to: 'distribution', key: 'core-dist'     },
  { from: 'distribution',  to: 'access',       key: 'dist-access'   },
  { from: 'wan-edge',      to: 'distribution', key: 'wan-edge'      },
  { from: 'wan-edge',      to: 'spine',        key: 'wan-edge'      },
  { from: 'firewall',      to: 'distribution', key: 'firewall-dist' },
  { from: 'firewall',      to: 'spine',        key: 'firewall-spine'},
  { from: 'cloud-transit', to: 'cloud-gw',     key: 'cloud-transit' },
];

export function generateCablingMatrix(
  devices: DeviceEntry[],
  linkDistances: Record<string, number> = {},
): CableEntry[] {
  if (!devices.length) return [];

  const defaultDist = 5;
  const byLayer: Record<string, DeviceEntry[]> = {};
  for (const dev of devices) {
    const l = dev.subLayer ?? 'unknown';
    (byLayer[l] ??= []).push(dev);
  }

  const schedule: CableEntry[] = [];
  let linkId = 1;

  for (const conn of CONNECTS) {
    const fromDevices = byLayer[conn.from] ?? [];
    const toDevices   = byLayer[conn.to]   ?? [];
    if (!fromDevices.length || !toDevices.length) continue;

    const distM = linkDistances[conn.key] ?? defaultDist;
    const uplinkSpeed = fromDevices[0].speed ?? '100G';

    for (let si = 0; si < fromDevices.length; si++) {
      for (let di = 0; di < toDevices.length; di++) {
        const src = fromDevices[si];
        const dst = toDevices[di];
        const cable = selectCableType(distM, uplinkSpeed);
        const unitCost = cable.unitCost + cable.costPerM * distM;
        schedule.push({
          id:           linkId++,
          layerPair:    `${conn.from} → ${conn.to}`,
          deviceA:      src.hostname ?? src.id,
          portA:        `Et1/${di + 1}`,
          deviceB:      dst.hostname ?? dst.id,
          portB:        `Et1/${si + 1}`,
          cableType:    cable.type,
          cableDesc:    cable.desc,
          lengthM:      distM,
          qty:          1,
          partNumber:   buildPartNumber(cable, uplinkSpeed, distM),
          unitCostUSD:  Math.round(unitCost),
          totalCostUSD: Math.round(unitCost),
        });
      }
    }
  }

  return schedule;
}

export function exportCablingCSV(schedule: CableEntry[]): string {
  const header = ['#','Layer Pair','Device A','Port A','Device B','Port B',
                  'Cable Type','Description','Length (m)','Qty','Part Number',
                  'Unit Cost USD','Total Cost USD'].join(',');
  const rows = schedule.map((r) =>
    [r.id, r.layerPair, r.deviceA, r.portA, r.deviceB, r.portB,
     r.cableType, r.cableDesc, r.lengthM, r.qty, r.partNumber,
     r.unitCostUSD, r.totalCostUSD].join(','),
  );
  return [header, ...rows].join('\n');
}
