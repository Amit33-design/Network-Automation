import type { DeviceEntry } from './bom';
import type { CableEntry } from './cabling';
import type { OpticRecommendation } from './optics';

interface LicenseRate {
  swLicPct: number;
  supportPct: number;
  notes: string;
}

export const TCO_LICENSE_RATES: Record<string, LicenseRate> = {
  Cisco:      { swLicPct: 0.12, supportPct: 0.08, notes: 'Cisco DNA Advantage + Smart Net' },
  Arista:     { swLicPct: 0.08, supportPct: 0.09, notes: 'EOS+ / AVD license + hardware support' },
  Juniper:    { swLicPct: 0.10, supportPct: 0.08, notes: 'Junos SW sub + Juniper Care' },
  NVIDIA:     { swLicPct: 0.06, supportPct: 0.08, notes: 'Spectrum-X / Enterprise support' },
  Fortinet:   { swLicPct: 0.22, supportPct: 0.05, notes: 'FortiGuard + FortiCare bundles' },
  'Palo Alto':{ swLicPct: 0.25, supportPct: 0.05, notes: 'Threat prevention + WildFire subs' },
  HPE:        { swLicPct: 0.07, supportPct: 0.08, notes: 'Aruba CX Unlimited support' },
  Dell:       { swLicPct: 0.07, supportPct: 0.08, notes: 'Dell EMC hardware support' },
  Extreme:    { swLicPct: 0.08, supportPct: 0.08, notes: 'Extreme Elements + support' },
};

const TCO_DEFAULT_RATE: LicenseRate = { swLicPct: 0.10, supportPct: 0.08, notes: 'Estimated SW license + support' };
const POWER_RATE_USD_PER_KWH = 0.10;
const HOURS_PER_YEAR = 8760;
const TCO_YEARS = 3;

function licenseRate(vendor: string): LicenseRate {
  return TCO_LICENSE_RATES[vendor] ?? TCO_DEFAULT_RATE;
}

export interface DeviceTcoRow {
  hostname: string;
  model: string;
  vendor: string;
  subLayer: string;
  rack: string;
  hwCapex: number;
  swLicYr: number;
  supportYr: number;
  powerYr: number;
  annualOpex: number;
  tco3yr: number;
  licenseNotes: string;
}

function deviceTCO(dev: DeviceEntry): DeviceTcoRow {
  const hw    = dev.priceUSD ?? 0;
  const powerW = dev.powerW ?? 0;
  const rates  = licenseRate(dev.vendor ?? '');

  const swLicYr   = Math.round(hw * rates.swLicPct);
  const supportYr = Math.round(hw * rates.supportPct);
  const powerYr   = Math.round(powerW * HOURS_PER_YEAR / 1000 * POWER_RATE_USD_PER_KWH);

  return {
    hostname:     dev.hostname ?? dev.id,
    model:        dev.model,
    vendor:       dev.vendor ?? '—',
    subLayer:     dev.subLayer,
    rack:         dev.rack ?? '—',
    hwCapex:      hw,
    swLicYr,
    supportYr,
    powerYr,
    annualOpex:   swLicYr + supportYr + powerYr,
    tco3yr:       hw + (swLicYr + supportYr + powerYr) * TCO_YEARS,
    licenseNotes: rates.notes,
  };
}

export interface TcoTotals {
  hwCapex: number;
  cablingCapex: number;
  opticsCapex: number;
  infraCapex: number;
  totalCapex: number;
  swLicYr: number;
  supportYr: number;
  powerYr: number;
  totalOpexYr: number;
  tco3yr: number;
}

export interface TcoResult {
  devices: DeviceTcoRow[];
  years: number;
  powerRate: number;
  totals: TcoTotals;
}

export function calcTCO(
  devices: DeviceEntry[],
  cabling: CableEntry[] = [],
  optics: OpticRecommendation[] = [],
): TcoResult {
  const deviceRows = (devices ?? [])
    .filter((d) => (d.priceUSD ?? 0) > 0)
    .map(deviceTCO);

  const totalHw      = deviceRows.reduce((s, r) => s + r.hwCapex,    0);
  const totalSwLicYr = deviceRows.reduce((s, r) => s + r.swLicYr,    0);
  const totalSupYr   = deviceRows.reduce((s, r) => s + r.supportYr,  0);
  const totalPwrYr   = deviceRows.reduce((s, r) => s + r.powerYr,    0);
  const totalOpex    = deviceRows.reduce((s, r) => s + r.annualOpex, 0);

  const cablingCost  = cabling.reduce((s, r) => s + (r.totalCostUSD ?? 0), 0);
  const opticsCost   = optics.reduce((s, r)  => s + (r.totalCostUSD ?? 0), 0);
  const infraCapex   = cablingCost + opticsCost;
  const totalCapex   = totalHw + infraCapex;
  const tco3yr       = totalCapex + totalOpex * TCO_YEARS;

  return {
    devices: deviceRows,
    years: TCO_YEARS,
    powerRate: POWER_RATE_USD_PER_KWH,
    totals: {
      hwCapex:     totalHw,
      cablingCapex:cablingCost,
      opticsCapex: opticsCost,
      infraCapex,
      totalCapex,
      swLicYr:     totalSwLicYr,
      supportYr:   totalSupYr,
      powerYr:     totalPwrYr,
      totalOpexYr: totalOpex,
      tco3yr,
    },
  };
}

export function exportTCOCSV(result: TcoResult): string {
  const tot = result.totals;
  const header = 'Hostname,Model,Vendor,Role,Rack,HW CapEx,SW License/yr,Support/yr,Power/yr,Annual OpEx,3yr TCO';
  const rows = result.devices.map((r) =>
    [r.hostname, r.model, r.vendor, r.subLayer, r.rack,
     r.hwCapex, r.swLicYr, r.supportYr, r.powerYr, r.annualOpex, r.tco3yr].join(','),
  );
  const footer = [
    '\n# Totals',
    `Hardware CapEx,${tot.hwCapex}`,
    `Infra CapEx (cabling+optics),${tot.infraCapex}`,
    `Total CapEx,${tot.totalCapex}`,
    `SW License/yr,${tot.swLicYr}`,
    `Support/yr,${tot.supportYr}`,
    `Power/yr,${tot.powerYr}`,
    `Total Annual OpEx,${tot.totalOpexYr}`,
    `3-Year TCO,${tot.tco3yr}`,
  ].join('\n');
  return [header, ...rows].join('\n') + footer;
}
