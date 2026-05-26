import type { IntentObject } from '../types/intent';
import type { DeviceEntry } from './bom';

// ─── ZTP State Machine ───────────────────────────────────────────────────────

export const ZTP_STATE_LIST = [
  'REGISTERED',
  'POWERED_ON',
  'DHCP_ACK',
  'SCRIPT_DOWNLOADED',
  'CONFIG_APPLYING',
  'CALLBACK_RECEIVED',
  'VERIFIED',
  'ONLINE',
  'FAILED',
] as const;

export type ZtpState = (typeof ZTP_STATE_LIST)[number];

export const ZTP_STATE_TRANSITIONS: Record<ZtpState, ZtpState | null> = {
  REGISTERED:        'POWERED_ON',
  POWERED_ON:        'DHCP_ACK',
  DHCP_ACK:          'SCRIPT_DOWNLOADED',
  SCRIPT_DOWNLOADED: 'CONFIG_APPLYING',
  CONFIG_APPLYING:   'CALLBACK_RECEIVED',
  CALLBACK_RECEIVED: 'VERIFIED',
  VERIFIED:          'ONLINE',
  ONLINE:            null,
  FAILED:            null,
};

export interface ZtpDeviceState {
  hostname: string;
  macAddress?: string;
  mgmtIp?: string;
  platform?: string;
  state: ZtpState;
  lastUpdated: string;
  error?: string;
}

export function ztpInitDevices(devices: DeviceEntry[]): ZtpDeviceState[] {
  return devices.map((d) => ({
    hostname:    d.hostname ?? d.id,
    platform:    d.vendor?.toLowerCase() ?? 'unknown',
    state:       'REGISTERED',
    lastUpdated: new Date().toISOString(),
  }));
}

export function ztpAdvanceState(device: ZtpDeviceState): ZtpDeviceState {
  const next = ZTP_STATE_TRANSITIONS[device.state];
  if (!next) return device;
  return { ...device, state: next, lastUpdated: new Date().toISOString() };
}

export function ztpMarkFailed(device: ZtpDeviceState, error: string): ZtpDeviceState {
  return { ...device, state: 'FAILED', error, lastUpdated: new Date().toISOString() };
}

// ─── OS Image Catalog ────────────────────────────────────────────────────────

export interface OsImageVersion {
  version: string;
  filename: string;
  sha512: string;
  sizeGB: number;
}

export interface OsImageEntry {
  stable: OsImageVersion;
  latest: OsImageVersion;
  tftp_path: string;
  http_path: string;
  boot_cmd: string;
  verify_cmd: string;
}

export const OS_IMAGE_CATALOG: Record<string, OsImageEntry> = {
  nxos: {
    stable: { version: '10.3(5)', filename: 'nxos64-cs.10.3.5.M.bin',    sha512: 'auto-verify', sizeGB: 2.1 },
    latest: { version: '10.4(1)', filename: 'nxos64-cs.10.4.1.M.bin',    sha512: 'auto-verify', sizeGB: 2.3 },
    tftp_path: '/ztp/images/nxos/', http_path: '/ztp/images/nxos/',
    boot_cmd:   'boot nxos bootflash:{filename}',
    verify_cmd: 'show version | include NXOS',
  },
  eos: {
    stable: { version: '4.32.0F', filename: 'EOS-4.32.0F.swi', sha512: 'auto-verify', sizeGB: 1.8 },
    latest: { version: '4.33.1F', filename: 'EOS-4.33.1F.swi', sha512: 'auto-verify', sizeGB: 1.9 },
    tftp_path: '/ztp/images/eos/', http_path: '/ztp/images/eos/',
    boot_cmd:   'boot system flash:/{filename}',
    verify_cmd: 'show version | grep EOS',
  },
  junos: {
    stable: { version: '23.4R1', filename: 'junos-install-qfx-x86-64-23.4R1.9.tgz', sha512: 'auto-verify', sizeGB: 1.5 },
    latest: { version: '24.2R1', filename: 'junos-install-qfx-x86-64-24.2R1.tgz',   sha512: 'auto-verify', sizeGB: 1.6 },
    tftp_path: '/ztp/images/junos/', http_path: '/ztp/images/junos/',
    boot_cmd:   'request system software add /var/tmp/{filename} reboot',
    verify_cmd: 'show version | match Junos',
  },
  iosxe: {
    stable: { version: '17.12.1', filename: 'cat9k_iosxe.17.12.01.SPA.bin', sha512: 'auto-verify', sizeGB: 1.7 },
    latest: { version: '17.13.1', filename: 'cat9k_iosxe.17.13.01.SPA.bin', sha512: 'auto-verify', sizeGB: 1.8 },
    tftp_path: '/ztp/images/iosxe/', http_path: '/ztp/images/iosxe/',
    boot_cmd:   'boot system flash:{filename}',
    verify_cmd: 'show version | include IOS-XE',
  },
  iosxr: {
    stable: { version: '7.11.1',  filename: 'xrv9k-full-x.iso-7.11.1.iso',  sha512: 'auto-verify', sizeGB: 3.2 },
    latest: { version: '24.3.1',  filename: 'xrv9k-full-x.iso-24.3.1.iso',  sha512: 'auto-verify', sizeGB: 3.5 },
    tftp_path: '/ztp/images/iosxr/', http_path: '/ztp/images/iosxr/',
    boot_cmd:   'install add source /harddisk: {filename} activate commit',
    verify_cmd: 'show version | include IOS XR',
  },
  sonic: {
    stable: { version: '202405', filename: 'sonic-vs.bin.202405', sha512: 'auto-verify', sizeGB: 0.9 },
    latest: { version: '202411', filename: 'sonic-vs.bin.202411', sha512: 'auto-verify', sizeGB: 1.0 },
    tftp_path: '/ztp/images/sonic/', http_path: '/ztp/images/sonic/',
    boot_cmd:   'sonic_installer install /host/image-{version}',
    verify_cmd: 'show version | grep SONiC',
  },
};

function platformKey(vendor: string, subLayer: string): string {
  const v = vendor.toLowerCase();
  if (v.includes('arista')) return 'eos';
  if (v.includes('juniper')) return 'junos';
  if (v.includes('nvidia')) return 'sonic';
  if (v.includes('cisco')) {
    if (subLayer === 'pe-router' || subLayer === 'p-router') return 'iosxr';
    if (subLayer === 'access' || subLayer === 'distribution') return 'iosxe';
    return 'nxos';
  }
  return 'nxos';
}

// ─── Day-0 Bootstrap Config ──────────────────────────────────────────────────
// Management-plane only per CLAUDE.md §9: hostname, mgmt IP, SSH, NTP, syslog, LLDP

export function genDay0Config(device: DeviceEntry, intent: IntentObject): string {
  const platform = platformKey(device.vendor ?? '', device.subLayer);
  const hostname  = device.hostname ?? device.id;
  const mgmtIp    = `192.168.100.${device.unit || 1}/24`;
  const mgmtGw    = '192.168.100.1';
  const ntpServer = '10.0.0.1';
  const syslogIp  = '10.0.0.2';
  const siteCode  = (intent.org.name || 'SITE').toUpperCase().slice(0, 6);

  if (platform === 'nxos') {
    return (
      `! Day-0 Bootstrap — ${hostname} (NX-OS)\n` +
      `! Generated by NetDesign AI — management plane ONLY\n` +
      `hostname ${hostname}\n` +
      `feature ssh\nfeature lldp\nfeature scp-server\n` +
      `interface mgmt0\n  ip address ${mgmtIp}\n  no shutdown\n` +
      `ip route 0.0.0.0/0 ${mgmtGw}\n` +
      `ntp server ${ntpServer} use-vrf management\n` +
      `logging server ${syslogIp} 6\n` +
      `no feature telnet\n` +
      `username admin password 0 ChangeMe123! role network-admin\n`
    );
  }

  if (platform === 'eos') {
    return (
      `! Day-0 Bootstrap — ${hostname} (Arista EOS)\n` +
      `hostname ${hostname}\n` +
      `username admin secret ChangeMe123!\nusername admin privilege 15\n` +
      `management api http-commands\n   no shutdown\n` +
      `interface Management1\n   ip address ${mgmtIp}\n` +
      `ip route 0.0.0.0/0 ${mgmtGw}\n` +
      `ntp server ${ntpServer}\n` +
      `logging host ${syslogIp}\n` +
      `lldp run\n`
    );
  }

  if (platform === 'junos') {
    return (
      `# Day-0 Bootstrap — ${hostname} (Junos)\n` +
      `set system host-name ${hostname}\n` +
      `set system root-authentication plain-text-password-value ChangeMe123!\n` +
      `set interfaces em0 unit 0 family inet address ${mgmtIp}\n` +
      `set routing-options static route 0.0.0.0/0 next-hop ${mgmtGw}\n` +
      `set system ntp server ${ntpServer}\n` +
      `set system syslog host ${syslogIp} any notice\n` +
      `set protocols lldp interface all\n`
    );
  }

  if (platform === 'iosxe') {
    return (
      `! Day-0 Bootstrap — ${hostname} (IOS-XE)\n` +
      `hostname ${hostname}\n` +
      `ip ssh version 2\nno service telnet\n` +
      `username admin privilege 15 secret ChangeMe123!\n` +
      `interface GigabitEthernet0\n ip address ${mgmtIp.replace('/24','')} 255.255.255.0\n no shutdown\n` +
      `ip default-gateway ${mgmtGw}\n` +
      `ntp server ${ntpServer}\n` +
      `logging host ${syslogIp}\n` +
      `lldp run\n`
    );
  }

  return `# Day-0 bootstrap for ${hostname} (platform: ${platform})\n# Configure manually.\n`;
  void siteCode;
}

// ─── ZTP Docker Compose ──────────────────────────────────────────────────────

export function genZtpDockerCompose(siteCode = 'SITE'): string {
  return (
    `# NetDesign AI — ZTP File Server Stack\n# Site: ${siteCode}\n` +
    `version: "3.9"\nservices:\n\n` +
    `  nginx:\n    image: nginx:alpine\n` +
    `    ports: ["8080:80","8443:443"]\n` +
    `    volumes:\n` +
    `      - ./ztp/scripts:/usr/share/nginx/html/ztp/scripts:ro\n` +
    `      - ./ztp/configs:/usr/share/nginx/html/ztp/configs:ro\n` +
    `      - ./ztp/images:/usr/share/nginx/html/ztp/images:ro\n` +
    `      - ./ztp/nginx.conf:/etc/nginx/conf.d/default.conf:ro\n\n` +
    `  tftpd:\n    image: pghalliday/tftp\n` +
    `    ports: ["69:69/udp"]\n` +
    `    volumes:\n      - ./ztp/scripts:/var/tftpboot:ro\n\n` +
    `  backend:\n    image: python:3.11-slim\n` +
    `    ports: ["5000:5000"]\n` +
    `    volumes:\n      - ./backend:/app\n` +
    `    command: python /app/app.py\n` +
    `    environment:\n      - SITE=${siteCode}\n`
  );
}

export function genZtpNginxConf(): string {
  return (
    `server {\n  listen 80;\n  server_name _;\n` +
    `  root /usr/share/nginx/html;\n` +
    `  autoindex on;\n\n` +
    `  location /ztp/ {\n    autoindex on;\n    default_type application/octet-stream;\n  }\n\n` +
    `  access_log /var/log/nginx/ztp_access.log combined;\n}\n`
  );
}

export function genZtpDhcpScope(devices: DeviceEntry[], siteCode = 'SITE', ztpServerIp = '10.0.0.100'): string {
  const staticBindings = devices
    .filter((d) => d.hostname)
    .map((d, i) =>
      `  host ${d.hostname} {\n` +
      `    hardware ethernet 00:00:00:00:00:${String(i + 1).padStart(2, '0')}; # replace with actual MAC\n` +
      `    fixed-address 192.168.100.${200 + i};\n` +
      `    option host-name "${d.hostname}";\n` +
      `    option tftp-server-name "${ztpServerIp}";\n` +
      `  }`,
    )
    .join('\n\n');

  return (
    `# ISC DHCP scope — ZTP, site ${siteCode}\n` +
    `# ZTP server: ${ztpServerIp}\n\n` +
    `subnet 192.168.100.0 netmask 255.255.255.0 {\n` +
    `  range 192.168.100.50 192.168.100.199;\n` +
    `  option routers 192.168.100.1;\n` +
    `  option domain-name-servers 8.8.8.8;\n` +
    `  option tftp-server-name "${ztpServerIp}";\n` +
    `  filename "poap.py";\n` +
    `  default-lease-time 86400;\n` +
    `}\n\n` +
    `# Static MAC bindings\n` + staticBindings + '\n'
  );
}

export function genOsImageManifest(
  devices: DeviceEntry[],
  imageChannel: 'stable' | 'latest' = 'stable',
): string {
  const platforms = new Set<string>();
  for (const dev of devices) {
    platforms.add(platformKey(dev.vendor ?? '', dev.subLayer));
  }

  const stageCmds = [...platforms].map((p) => {
    const catalog = OS_IMAGE_CATALOG[p];
    if (!catalog) return `# ${p}: no catalog entry`;
    const img = catalog[imageChannel];
    return (
      `# ${p.toUpperCase()}\n` +
      `mkdir -p \${IMAGE_BASE}/${p}\n` +
      `[ -f "\${IMAGE_BASE}/${p}/${img.filename}" ] || \\\n` +
      `  echo "MISSING: ${img.filename} (${img.sizeGB}GB) — download to \${IMAGE_BASE}/${p}/"\n`
    );
  }).join('\n');

  return (
    `#!/bin/bash\n# ZTP OS Image Manifest — auto-generated by NetDesign AI\n` +
    `# Channel: ${imageChannel}\nset -euo pipefail\n` +
    `IMAGE_BASE="/opt/ztp/images"\n\n` + stageCmds
  );
}
