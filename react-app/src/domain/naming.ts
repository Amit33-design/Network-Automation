import type { IntentObject } from '../types/intent';

export const ROLE_CODE: Record<string, string> = {
  spine:          'SPINE',
  leaf:           'LEAF',
  distribution:   'DIST',
  access:         'ACC',
  'wan-edge':     'WAN',
  firewall:       'FW',
  'cloud-gw':     'CGW',
  'cloud-transit':'CTGW',
  core:           'CORE',
};

export interface DeviceLike {
  hostname?: string;
  subLayer?: string;
  role?: string;
  [key: string]: unknown;
}

function rackLabel(idx: number): string {
  return String.fromCharCode(65 + Math.floor(idx / 2));
}

export function generateHostnames(devices: DeviceLike[], intent: Partial<IntentObject>): DeviceLike[] {
  if (!devices || !devices.length) return devices;
  const site = (intent.org?.name ?? 'SITE').toUpperCase().replace(/\s+/g, '').slice(0, 5) || 'SITE';
  const roleCounters: Record<string, number> = {};

  devices.forEach((dev) => {
    const role = dev.subLayer ?? dev.role ?? 'unknown';
    const code = ROLE_CODE[role] ?? role.toUpperCase().slice(0, 4);
    if (!roleCounters[code]) roleCounters[code] = 0;
    const idx = roleCounters[code]++;
    const rack = rackLabel(idx);
    const num = String((idx % 2) + 1).padStart(2, '0');
    dev.hostname = `${site}-${code}-${rack}${num}`;
  });

  return devices;
}
