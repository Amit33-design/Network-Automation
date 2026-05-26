export interface RollbackStrategy {
  pre: string | null;
  deploy: string | null;
  exec: string;
  verify: string;
}

// Platform-native rollback strategies — CLAUDE.md §7
// Never config-paste. Each platform uses its own checkpoint/replace mechanism.
export const ROLLBACK_STRATEGIES: Record<string, RollbackStrategy> = {
  nxos: {
    pre:    'checkpoint pre-deploy-{ts}',
    deploy: null,
    exec:   'rollback running-config checkpoint pre-deploy-{ts} atomic',
    verify: 'show checkpoint summary',
  },
  iosxe: {
    pre:    'copy running-config flash:pre-deploy-{ts}.cfg',
    deploy: null,
    exec:   'configure replace flash:pre-deploy-{ts}.cfg force',
    verify: 'show archive',
  },
  eos: {
    pre:    'copy running-config checkpoint://pre-deploy-{ts}',
    deploy: null,
    exec:   'rollback clean-config checkpoint://pre-deploy-{ts}',
    verify: 'show checkpoint',
  },
  junos: {
    pre:    null,  // JunOS commit history is automatic
    deploy: 'commit confirmed 5',  // auto-rollback if not re-confirmed within 5 min
    exec:   'rollback 1',
    verify: 'show system commit',
  },
  sonic: {
    pre:    'config save /etc/sonic/config_db_pre_{ts}.json',
    deploy: null,
    exec:   'config load /etc/sonic/config_db_pre_{ts}.json',
    verify: 'show runningconfiguration all',
  },
};

export interface DeviceForRollback {
  hostname?: string;
  vendor?: string;
  model?: string;
  subLayer?: string;
  [key: string]: unknown;
}

export interface RollbackPlanEntry {
  hostname: string;
  platform: string;
  pre: string | null;
  deploy_note: string;
  rollback: string;
  verify: string;
}

export interface RollbackPlan {
  ts: string;
  devices: RollbackPlanEntry[];
}

const PLATFORM_NETMIKO: Record<string, string> = {
  nxos:  'cisco_nxos',
  iosxe: 'cisco_ios',
  eos:   'arista_eos',
  junos: 'juniper_junos',
  sonic: 'linux',
};

function strategyKey(dev: DeviceForRollback): string | null {
  const v = (dev.vendor ?? '').toLowerCase();
  if (v === 'cisco') {
    const m = (dev.model ?? '').toLowerCase();
    if (m.includes('nxos') || m.includes('nexus') || m.includes('93') || m.includes('95') ||
        dev.subLayer === 'spine' || dev.subLayer === 'leaf') {
      return 'nxos';
    }
    return 'iosxe';
  }
  if (v === 'arista')  return 'eos';
  if (v === 'juniper') return 'junos';
  if (v === 'nvidia')  return 'sonic';
  return null;
}

function fill(tmpl: string | null, ts: string): string | null {
  return tmpl ? tmpl.replace(/\{ts\}/g, ts) : null;
}

export function genRollbackPlan(devices: DeviceForRollback[]): RollbackPlan {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const out: RollbackPlanEntry[] = [];

  for (const dev of (devices ?? [])) {
    const key = strategyKey(dev);
    if (!key) continue;
    const s = ROLLBACK_STRATEGIES[key];
    out.push({
      hostname:    dev.hostname ?? 'unknown',
      platform:    key,
      pre:         fill(s.pre, ts),
      deploy_note: s.deploy ?? 'standard config push (commit / copy run start)',
      rollback:    fill(s.exec, ts) ?? s.exec,
      verify:      s.verify,
    });
  }

  return { ts, devices: out };
}

export function genRollbackScript(devices: DeviceForRollback[]): string {
  const plan = genRollbackPlan(devices);

  const deviceBlocks = plan.devices.map((d) => {
    const nmType   = PLATFORM_NETMIKO[d.platform] ?? 'autodetect';
    const preLines = d.pre ? JSON.stringify([d.pre]) : 'None  # automatic';
    const rollLines = JSON.stringify([d.rollback]);
    const verLines  = JSON.stringify([d.verify]);
    return (
      '    {\n' +
      `        "host": "${d.hostname}",  # replace with mgmt IP\n` +
      `        "device_type": "${nmType}",\n` +
      `        "pre_cmds":      ${preLines},\n` +
      `        "rollback_cmds": ${rollLines},\n` +
      `        "verify_cmds":   ${verLines},\n` +
      '    }'
    );
  }).join(',\n');

  return (
    '#!/usr/bin/env python3\n' +
    `"""NetDesign AI — platform-native rollback  (ts=${plan.ts})\n` +
    'Run pre_cmds BEFORE pushing config; run rollback_cmds to revert.\n' +
    'Credentials from environment: NET_USER / NET_PASS / NET_ENABLE\n' +
    '"""\n' +
    'import os, sys\n' +
    'from netmiko import ConnectHandler\n\n' +
    'USER   = os.environ["NET_USER"]\n' +
    'PASS   = os.environ["NET_PASS"]\n' +
    'ENABLE = os.environ.get("NET_ENABLE", PASS)\n\n' +
    'DEVICES = [\n' +
    deviceBlocks + '\n' +
    ']\n\n' +
    'def run(device, cmds, label):\n' +
    '    if not cmds:\n' +
    '        print(f"  [{label}] skipped (platform handles automatically)")\n' +
    '        return\n' +
    '    conn = ConnectHandler(\n' +
    '        host=device["host"], device_type=device["device_type"],\n' +
    '        username=USER, password=PASS, secret=ENABLE\n' +
    '    )\n' +
    '    for cmd in cmds:\n' +
    '        out = conn.send_command(cmd, expect_string=r"#")\n' +
    '        print(f"  [{label}] {cmd}\\n{out[:200]}")\n' +
    '    conn.disconnect()\n\n' +
    'if __name__ == "__main__":\n' +
    '    action = sys.argv[1] if len(sys.argv) > 1 else "pre"\n' +
    '    for d in DEVICES:\n' +
    '        print(f"\\n=== {d[\'host\']} ({d[\'device_type\']}) — {action} ===")\n' +
    '        if action == "pre":\n' +
    '            run(d, d["pre_cmds"], "pre-checkpoint")\n' +
    '        elif action == "rollback":\n' +
    '            run(d, d["rollback_cmds"], "rollback")\n' +
    '        elif action == "verify":\n' +
    '            run(d, d["verify_cmds"], "verify")\n' +
    '        else:\n' +
    '            print("Usage: rollback.py [pre|rollback|verify]")\n' +
    '            sys.exit(1)\n'
  );
}
