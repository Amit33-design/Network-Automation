import type { CableEntry } from './cabling';
import type { DeviceEntry } from './bom';

export interface Optic {
  id: string;
  model: string;
  vendor: string;
  formFactor: string;
  speed: string;
  reach_m: number;
  reach_om3?: number;
  wavelength: string;
  fiberType: string;
  fiberFamily: 'mmf' | 'smf' | 'smf-mpo';
  connector: string;
  estimatedCostUSD: number;
  compatibleSubLayers: string[];
  notes: string;
}

export const OPTICS: Optic[] = [
  {
    id: 'SFP-10G-SR', model: 'SFP-10G-SR', vendor: 'Generic / Cisco-compatible',
    formFactor: 'SFP+', speed: '10G', reach_m: 400, reach_om3: 300,
    wavelength: '850nm', fiberType: 'MMF OM3/OM4', fiberFamily: 'mmf', connector: 'LC',
    estimatedCostUSD: 25, compatibleSubLayers: ['leaf','access','distribution'],
    notes: 'SR = Short-Reach, 400m OM4 / 300m OM3',
  },
  {
    id: 'SFP-10G-LR', model: 'SFP-10G-LR', vendor: 'Generic / Cisco-compatible',
    formFactor: 'SFP+', speed: '10G', reach_m: 10000,
    wavelength: '1310nm', fiberType: 'SMF OS2', fiberFamily: 'smf', connector: 'LC',
    estimatedCostUSD: 55, compatibleSubLayers: ['leaf','distribution','wan-edge','firewall'],
    notes: 'LR = Long-Reach, 10km on SMF OS2',
  },
  {
    id: 'SFP-10G-ER', model: 'SFP-10G-ER', vendor: 'Generic',
    formFactor: 'SFP+', speed: '10G', reach_m: 40000,
    wavelength: '1550nm', fiberType: 'SMF OS2', fiberFamily: 'smf', connector: 'LC',
    estimatedCostUSD: 120, compatibleSubLayers: ['wan-edge'],
    notes: 'ER = Extended-Reach, 40km on SMF',
  },
  {
    id: 'SFP-25G-SR', model: 'SFP28-25G-SR', vendor: 'Generic / Cisco-compatible',
    formFactor: 'SFP28', speed: '25G', reach_m: 100, reach_om3: 70,
    wavelength: '850nm', fiberType: 'MMF OM3/OM4', fiberFamily: 'mmf', connector: 'LC',
    estimatedCostUSD: 45, compatibleSubLayers: ['leaf','distribution'],
    notes: '25G SR, 100m OM4 / 70m OM3',
  },
  {
    id: 'SFP-25G-LR', model: 'SFP28-25G-LR', vendor: 'Generic / Cisco-compatible',
    formFactor: 'SFP28', speed: '25G', reach_m: 10000,
    wavelength: '1310nm', fiberType: 'SMF OS2', fiberFamily: 'smf', connector: 'LC',
    estimatedCostUSD: 120, compatibleSubLayers: ['leaf','distribution','wan-edge'],
    notes: '25G LR, 10km on SMF',
  },
  {
    id: 'QSFP-28-100G-SR4', model: 'QSFP-100G-SR4', vendor: 'Generic / Cisco-compatible',
    formFactor: 'QSFP28', speed: '100G', reach_m: 100, reach_om3: 70,
    wavelength: '850nm', fiberType: 'MMF OM3/OM4 (MPO-12)', fiberFamily: 'mmf', connector: 'MPO-12',
    estimatedCostUSD: 180, compatibleSubLayers: ['spine','leaf','distribution'],
    notes: '4x25G NRZ, 100m OM4 / 70m OM3',
  },
  {
    id: 'QSFP-28-100G-LR4', model: 'QSFP-100G-LR4', vendor: 'Generic / Cisco-compatible',
    formFactor: 'QSFP28', speed: '100G', reach_m: 10000,
    wavelength: '1295-1310nm CWDM', fiberType: 'SMF OS2', fiberFamily: 'smf', connector: 'LC',
    estimatedCostUSD: 420, compatibleSubLayers: ['spine','leaf','wan-edge'],
    notes: '4-lambda CWDM4, 10km SMF LC',
  },
  {
    id: 'QSFP-28-100G-PSM4', model: 'QSFP-100G-PSM4', vendor: 'Generic',
    formFactor: 'QSFP28', speed: '100G', reach_m: 500,
    wavelength: '1310nm', fiberType: 'SMF OS2 (MPO-12)', fiberFamily: 'smf-mpo', connector: 'MPO-12',
    estimatedCostUSD: 95, compatibleSubLayers: ['spine','leaf'],
    notes: 'Parallel SMF MPO, 500m, cost-effective intra-DC',
  },
  {
    id: 'QSFP-28-100G-DR', model: 'QSFP-100G-DR', vendor: 'Generic',
    formFactor: 'QSFP28', speed: '100G', reach_m: 500,
    wavelength: '1310nm', fiberType: 'SMF OS2', fiberFamily: 'smf', connector: 'LC',
    estimatedCostUSD: 85, compatibleSubLayers: ['spine','leaf','distribution'],
    notes: '100G DR, 500m SMF LC (single-lambda PAM4)',
  },
  {
    id: 'QSFP-DD-400G-DR4', model: 'QSFP-DD-400G-DR4', vendor: 'Generic / Cisco-compatible',
    formFactor: 'QSFP-DD', speed: '400G', reach_m: 500,
    wavelength: '1310nm', fiberType: 'SMF OS2 (MPO-12)', fiberFamily: 'smf-mpo', connector: 'MPO-12',
    estimatedCostUSD: 680, compatibleSubLayers: ['spine'],
    notes: '4x100G PAM4, 500m SMF MPO, intra-DC',
  },
  {
    id: 'QSFP-DD-400G-FR4', model: 'QSFP-DD-400G-FR4', vendor: 'Generic / Cisco-compatible',
    formFactor: 'QSFP-DD', speed: '400G', reach_m: 2000,
    wavelength: '1271-1331nm CWDM', fiberType: 'SMF OS2', fiberFamily: 'smf', connector: 'LC',
    estimatedCostUSD: 950, compatibleSubLayers: ['spine','wan-edge'],
    notes: '4-lambda CWDM4, 2km SMF LC',
  },
  {
    id: 'QSFP-DD-400G-LR4', model: 'QSFP-DD-400G-LR4', vendor: 'Generic',
    formFactor: 'QSFP-DD', speed: '400G', reach_m: 10000,
    wavelength: '1295-1310nm CWDM', fiberType: 'SMF OS2', fiberFamily: 'smf', connector: 'LC',
    estimatedCostUSD: 1400, compatibleSubLayers: ['spine','wan-edge'],
    notes: '10km LR4 SMF LC, inter-site / DCI',
  },
];

export type FiberConstraint = 'auto' | 'mmf-om4' | 'mmf-om3' | 'smf-lc' | 'smf-mpo';

const LAYER_PAIR_TO_KEY: Record<string, string> = {
  'spine → leaf':            'spine-leaf',
  'core → distribution':     'core-dist',
  'distribution → access':   'dist-access',
  'wan-edge → distribution': 'wan-edge',
  'wan-edge → spine':        'wan-edge',
  'firewall → distribution': 'dist-access',
  'firewall → spine':        'spine-leaf',
  'cloud-transit → cloud-gw':'wan-edge',
};

function fiberMatches(optic: Optic, fc: FiberConstraint): boolean {
  if (!fc || fc === 'auto') return true;
  if (fc === 'mmf-om4' || fc === 'mmf-om3') return optic.fiberFamily === 'mmf';
  if (fc === 'smf-lc')  return optic.fiberFamily === 'smf';
  if (fc === 'smf-mpo') return optic.fiberFamily === 'smf-mpo';
  return true;
}

function effectiveReach(optic: Optic, fc: FiberConstraint): number {
  if (fc === 'mmf-om3' && optic.reach_om3 !== undefined) return optic.reach_om3;
  return optic.reach_m;
}

export interface OpticRecommendation {
  speed: string;
  distanceM: number;
  subLayer: string;
  fiberConstraint: FiberConstraint;
  opticId: string;
  opticModel: string;
  formFactor: string;
  wavelength: string;
  fiberType: string;
  reach_m: number;
  notes: string;
  unitCostUSD: number;
  qty: number;
  totalCostUSD: number;
  warning: string | null;
}

export function recommendOptics(
  cablingSchedule: CableEntry[],
  devices: DeviceEntry[],
  fiberTypes: Record<string, FiberConstraint> = {},
): OpticRecommendation[] {
  if (!cablingSchedule.length) return [];

  // Group links by (speed, distanceM, layerPair, fiberConstraint)
  const linkGroups: Record<string, { speed: string; distanceM: number; subLayer: string; fiberConstraint: FiberConstraint; count: number }> = {};

  for (const link of cablingSchedule) {
    const devA  = devices.find((d) => d.hostname === link.deviceA);
    const speed = devA?.speed ?? '100G';
    const dist  = link.lengthM;
    const layer = devA?.subLayer ?? 'leaf';
    const lpKey = LAYER_PAIR_TO_KEY[link.layerPair] ?? 'spine-leaf';
    const fiber = (fiberTypes[lpKey] as FiberConstraint) ?? 'auto';
    const key   = `${speed}|${dist}|${layer}|${fiber}`;
    if (!linkGroups[key]) {
      linkGroups[key] = { speed, distanceM: dist, subLayer: layer, fiberConstraint: fiber, count: 0 };
    }
    linkGroups[key].count += 2; // 2 optics per link
  }

  const recommendations: OpticRecommendation[] = [];

  for (const group of Object.values(linkGroups)) {
    const fc = group.fiberConstraint;

    let candidates = OPTICS.filter(
      (o) => o.speed === group.speed &&
             fiberMatches(o, fc) &&
             effectiveReach(o, fc) >= group.distanceM &&
             o.compatibleSubLayers.includes(group.subLayer),
    );

    if (!candidates.length) {
      candidates = OPTICS.filter(
        (o) => o.speed === group.speed && fiberMatches(o, fc) && effectiveReach(o, fc) >= group.distanceM,
      );
    }

    let warning: string | null = null;
    if (!candidates.length && fc !== 'auto') {
      warning = `No ${fc} optic covers ${group.distanceM}m at ${group.speed} — falling back to any compatible optic.`;
      candidates = OPTICS.filter((o) => o.speed === group.speed && o.reach_m >= group.distanceM);
    }

    if (!candidates.length) continue;

    candidates.sort((a, b) => a.estimatedCostUSD - b.estimatedCostUSD);
    const best  = candidates[0];
    const reach = effectiveReach(best, fc);

    recommendations.push({
      speed:           group.speed,
      distanceM:       group.distanceM,
      subLayer:        group.subLayer,
      fiberConstraint: fc,
      opticId:         best.id,
      opticModel:      best.model,
      formFactor:      best.formFactor,
      wavelength:      best.wavelength,
      fiberType:       best.fiberType,
      reach_m:         reach,
      notes:           best.notes,
      unitCostUSD:     best.estimatedCostUSD,
      qty:             group.count,
      totalCostUSD:    best.estimatedCostUSD * group.count,
      warning,
    });
  }

  return recommendations;
}

export function exportOpticsCSV(recommendations: OpticRecommendation[]): string {
  const header = ['Model','Form Factor','Speed','Wavelength','Fiber',
                  'Max Reach (m)','Link Distance (m)','Sub-Layer','Qty',
                  'Unit Cost USD','Total Cost USD','Notes'].join(',');
  const rows = recommendations.map((r) =>
    [r.opticModel, r.formFactor, r.speed, r.wavelength, r.fiberType,
     r.reach_m, r.distanceM, r.subLayer, r.qty, r.unitCostUSD, r.totalCostUSD,
     `"${r.notes}"`].join(','),
  );
  return [header, ...rows].join('\n');
}
