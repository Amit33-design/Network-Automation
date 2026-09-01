/**
 * containerlab.ts — Generate containerlab topology YAML from BOM + cabling (N1)
 *
 * Maps BOM vendors/models to container images and generates a complete
 * containerlab topology file that users can run with `clab deploy`.
 */

import type { BOMDevice, CableLink } from '@/types'
import { expandCablePlan } from '@/lib/netbox-dcim'

// ── Vendor → container image mapping ──────────────────────────────────────────

export interface ContainerImage {
  image: string
  kind: string
}

const VENDOR_IMAGES: Record<string, ContainerImage> = {
  'Cisco-nxos':    { image: 'vrnetlab/vr-n9kv:10.3.1', kind: 'cisco_n9kv' },
  'Cisco-iosxe':   { image: 'vrnetlab/vr-csr:17.03.04a', kind: 'cisco_csr1000v' },
  'Cisco-iosxr':   { image: 'vrnetlab/vr-xrv9k:7.7.1', kind: 'cisco_xrv9k' },
  'Arista':        { image: 'ceos:4.32.0F', kind: 'ceos' },
  'Juniper':       { image: 'crpd:23.4R1.10', kind: 'crpd' },
  'Nokia':         { image: 'ghcr.io/nokia/srlinux:24.3.2', kind: 'nokia_srlinux' },
  'NVIDIA':        { image: 'networkop/cx:5.4.0', kind: 'cvx' },
  'Palo Alto':     { image: 'vrnetlab/vr-panos:11.0.1', kind: 'paloalto_panos' },
}

function resolveImage(dev: BOMDevice): ContainerImage {
  const features = dev.features ?? []
  if (dev.vendor === 'Cisco') {
    if (features.includes('IOS-XR') || dev.model.startsWith('ASR') || dev.model.startsWith('NCS'))
      return VENDOR_IMAGES['Cisco-iosxr']
    if (features.includes('IOS-XE') || dev.model.startsWith('C9') || dev.model.startsWith('ISR'))
      return VENDOR_IMAGES['Cisco-iosxe']
    return VENDOR_IMAGES['Cisco-nxos']
  }
  return VENDOR_IMAGES[dev.vendor] ?? { image: 'linux:latest', kind: 'linux' }
}

// ── Node name sanitizer ───────────────────────────────────────────────────────

function sanitizeName(hostname: string): string {
  return hostname
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    || 'node'
}

// ── Expand BOM devices by count ───────────────────────────────────────────────

export interface ClabNode {
  name: string
  kind: string
  image: string
  hostname: string
  /** BOM device id — `generateAllConfigs` keys its output by this, not by
   *  hostname, so without it no node ever found its startup config (AG1). */
  deviceId: string
  startupConfig?: string
}

function expandDevices(devices: BOMDevice[]): ClabNode[] {
  const nodes: ClabNode[] = []
  for (const dev of devices) {
    if (dev.count === 1) {
      const name = sanitizeName(dev.hostname)
      nodes.push({
        name,
        kind: resolveImage(dev).kind,
        image: resolveImage(dev).image,
        hostname: dev.hostname,
        deviceId: dev.id,
      })
    } else {
      for (let i = 1; i <= dev.count; i++) {
        const suffix = String(i).padStart(2, '0')
        const hostname = `${dev.hostname}-${suffix}`
        const name = sanitizeName(hostname)
        nodes.push({
          name,
          kind: resolveImage(dev).kind,
          image: resolveImage(dev).image,
          hostname,
          deviceId: dev.id,
        })
      }
    }
  }
  return nodes
}

// ── Link generation ───────────────────────────────────────────────────────────

export interface ClabLink {
  a: string
  b: string
}

function interfacePrefix(kind: string): string {
  switch (kind) {
    case 'ceos': return 'eth'
    case 'crpd': return 'eth'
    case 'nokia_srlinux': return 'e1-'
    case 'cisco_n9kv': return 'eth'
    case 'cisco_csr1000v': return 'Gi'
    case 'cisco_xrv9k': return 'Gi0/0/0/'
    case 'cvx': return 'swp'
    default: return 'eth'
  }
}

/**
 * Concrete node-to-node links.
 *
 * This used to read `cable.fromDevice` as a hostname. It is not: `buildCabling`
 * sets it to a human summary like "16x leaf", so the node lookup missed on
 * every cable and the topology came out with ZERO links — twenty isolated
 * switches. The 19 tests over this passed because the test helper built a
 * CableLink with a hostname in that field, a shape the BOM never produces.
 *
 * The aggregate plan is expanded by `expandCablePlan`, which already does
 * exactly this for the NetBox DCIM export (F2). Reusing it keeps the lab and
 * the cable schedule describing the same physical wiring — writing a third
 * expansion is how they would drift.
 */
function generateLinks(
  nodes: ClabNode[],
  devices: BOMDevice[],
  cabling: CableLink[],
): ClabLink[] {
  const links: ClabLink[] = []
  const byHostname = new Map(nodes.map(n => [n.hostname, n]))
  const portCounters = new Map<string, number>()

  function nextPort(node: ClabNode): string {
    const count = portCounters.get(node.name) ?? 1
    portCounters.set(node.name, count + 1)
    return `${interfacePrefix(node.kind)}${count}`
  }

  for (const run of expandCablePlan(devices, cabling)) {
    const a = byHostname.get(run.a.device)
    const b = byHostname.get(run.b.device)
    if (!a || !b) continue
    links.push({ a: `${a.name}:${nextPort(a)}`, b: `${b.name}:${nextPort(b)}` })
  }

  return links
}

// ── YAML generation (hand-rolled, no dependency) ──────────────────────────────

function indent(s: string, level: number): string {
  return ' '.repeat(level * 2) + s
}

export interface ContainerlabTopology {
  name: string
  nodes: ClabNode[]
  links: ClabLink[]
}

export function buildContainerlabTopology(
  devices: BOMDevice[],
  cabling: CableLink[],
  configs: Record<string, string>,
  name: string,
): ContainerlabTopology {
  const nodes = expandDevices(devices)

  for (const node of nodes) {
    // Keyed by BOM id — the hostname lookup this used to do never matched, so
    // every lab booted bare devices with none of the generated config (AG1).
    if (configs[node.deviceId]) {
      node.startupConfig = `configs/${node.hostname}.cfg`
    }
  }

  const links = generateLinks(nodes, devices, cabling)
  return { name: sanitizeName(name), nodes, links }
}

export function topologyToYAML(topo: ContainerlabTopology): string {
  const lines: string[] = [
    `# Generated by NetDesign AI — containerlab topology`,
    `# Deploy: clab deploy -t ${topo.name}.clab.yml`,
    `# Destroy: clab destroy -t ${topo.name}.clab.yml`,
    ``,
    `name: ${topo.name}`,
    ``,
    `topology:`,
    indent('nodes:', 1),
  ]

  for (const node of topo.nodes) {
    lines.push(indent(`${node.name}:`, 2))
    lines.push(indent(`kind: ${node.kind}`, 3))
    lines.push(indent(`image: ${node.image}`, 3))
    if (node.startupConfig) {
      lines.push(indent(`startup-config: ${node.startupConfig}`, 3))
    }
  }

  if (topo.links.length > 0) {
    lines.push('')
    lines.push(indent('links:', 1))
    for (const link of topo.links) {
      lines.push(indent(`- endpoints: ["${link.a}", "${link.b}"]`, 2))
    }
  }

  lines.push('')
  return lines.join('\n')
}

export function generateStartupConfigs(
  topo: ContainerlabTopology,
  configs: Record<string, string>,
): { filename: string; content: string }[] {
  const files: { filename: string; content: string }[] = []
  for (const node of topo.nodes) {
    const cfg = configs[node.deviceId]
    if (cfg) {
      files.push({
        filename: `configs/${node.hostname}.cfg`,
        content: cfg,
      })
    }
  }
  return files
}

/**
 * A single self-contained file that stands up the whole lab.
 *
 * The topology references `configs/<host>.cfg` for every node, but the UI only
 * ever downloaded the YAML — so the lab pointed at config files that were
 * never written, and the user got bare devices even once the wiring was fixed
 * (AG1). Browsers cannot hand over a directory and this project takes no new
 * dependencies for a zip, so the bundle is a shell script that writes the
 * tree and deploys it.
 */
export function containerlabBundle(
  topo: ContainerlabTopology,
  configs: Record<string, string>,
): string {
  const files = generateStartupConfigs(topo, configs)
  // A heredoc delimiter that cannot appear inside a device config.
  const EOF = 'NETDESIGN_EOF'
  const write = (path: string, body: string) => [
    `mkdir -p "$(dirname '${path}')"`,
    `cat > '${path}' <<'${EOF}'`,
    body.replace(/\r/g, ''),
    EOF,
    '',
  ].join('\n')

  return [
    '#!/usr/bin/env bash',
    '# Generated by NetDesign AI — containerlab lab bundle',
    '#',
    `# Writes ${topo.name}.clab.yml plus ${files.length} startup config(s), then deploys.`,
    '#   chmod +x this file and run it from an empty directory.',
    'set -euo pipefail',
    '',
    write(`${topo.name}.clab.yml`, topologyToYAML(topo)),
    ...files.map(f => write(f.filename, f.content)),
    `echo "Wrote ${topo.name}.clab.yml and ${files.length} config file(s)."`,
    'if command -v clab >/dev/null 2>&1; then',
    `  clab deploy -t "${topo.name}.clab.yml"`,
    'else',
    '  echo "containerlab not found — install it, then: clab deploy -t ' + topo.name + '.clab.yml"',
    'fi',
    '',
  ].join('\n')
}

export function containerlabReadme(topo: ContainerlabTopology): string {
  return `# ${topo.name} — Containerlab Topology

Generated by NetDesign AI.

## Quick Start

\`\`\`bash
# Deploy the lab
clab deploy -t ${topo.name}.clab.yml

# List running nodes
clab inspect -t ${topo.name}.clab.yml

# SSH into a node
ssh admin@clab-${topo.name}-<node-name>

# Destroy the lab
clab destroy -t ${topo.name}.clab.yml
\`\`\`

## Nodes (${topo.nodes.length})

| Name | Kind | Image | Startup Config |
|------|------|-------|----------------|
${topo.nodes.map(n => `| ${n.name} | ${n.kind} | ${n.image} | ${n.startupConfig ?? '—'} |`).join('\n')}

## Links (${topo.links.length})

| Endpoint A | Endpoint B |
|------------|------------|
${topo.links.map(l => `| ${l.a} | ${l.b} |`).join('\n')}
`
}
