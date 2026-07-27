/**
 * End-to-end "user journey" harness.
 *
 * This is the regression net that the prior unit tests lacked: instead of
 * testing functions in isolation with static scale defs, it simulates the
 * REAL wizard flow for every use case across a matrix of scales, port
 * speeds, oversubscription ratios, site counts and vendors — then runs the
 * complete pipeline (intent → BOM → configs → cabling → optics → racks →
 * validation) and asserts cross-checked invariants at every stage.
 *
 * The bugs that shipped for months (spine count, uplinks, cabling, per-use-
 * case port-math) were all invisible to isolated unit tests because the
 * tests never exercised the integrated path with real endpoint counts and
 * only asserted weak bounds (`>= 2`). This harness asserts EXACT physical
 * consistency: the fabric a customer is quoted must actually be able to host
 * the endpoints they asked for.
 */
import { describe, it, expect } from 'vitest'
import { buildBOM, buildCabling, buildOptics, validateBOM, computeTCO } from '@/lib/bom'
import { computeRackLayout } from '@/components/RackElevation'
import { generateAllConfigs } from '@/lib/configgen'
import { validateConfigs } from '@/lib/config-validator'
import { buildZTPPlan, generateDhcpConfig } from '@/lib/ztp'
import { buildNetBoxDcimExport, netboxRackPosition } from '@/lib/netbox-dcim'
import { computeCapacityPlan } from '@/lib/capacity-planning'
import type { BOMDevice, UseCase } from '@/types'

const NON_NETWORK = new Set(['gpu-compute', 'cloud-gw', 'cloud-transit'])
const SPINE_LEAF_CASES = new Set(['dc', 'gpu', 'multisite'])

interface Journey {
  useCase: UseCase
  scale: 'small' | 'medium' | 'large'
  siteCode: string
  totalEndpoints: number
  bandwidthPerServer: string
  oversubscription: number
  numSites: number
  vendorPrefs: string[]
}

/** Run the full pipeline exactly as Step 4 does. */
function runPipeline(j: Journey) {
  const linkDistances = { 'spine-leaf': 100, 'core-dist': 200, 'dist-access': 50, 'wan-edge': 5000 }
  const { devices, grandTotal, summary } = buildBOM({
    useCase: j.useCase, scale: j.scale, siteCode: j.siteCode,
    totalEndpoints: j.totalEndpoints, bandwidthPerServer: j.bandwidthPerServer,
    oversubscription: j.oversubscription, numSites: j.numSites,
    vendorPrefs: j.vendorPrefs.length ? j.vendorPrefs : undefined,
  })
  const configs = generateAllConfigs(devices, j.useCase, [], [], [])
  const cabling = buildCabling(devices, linkDistances)
  const optics = buildOptics(devices, linkDistances)
  const racks = computeRackLayout(devices)
  const issues = validateBOM(devices, {
    useCase: j.useCase, totalEndpoints: j.totalEndpoints,
    bandwidthPerServer: j.bandwidthPerServer, oversubscription: j.oversubscription,
  })
  return { devices, grandTotal, summary, configs, cabling, optics, racks, issues }
}

/** Universal invariants that MUST hold for any produced design. */
function assertUniversalInvariants(j: Journey, p: ReturnType<typeof runPipeline>) {
  const ctx = `${j.useCase}/${j.scale}/${j.totalEndpoints}ep/${j.bandwidthPerServer}/${j.oversubscription}:1/${j.numSites}sites/${j.vendorPrefs.join('+') || 'default'}`

  // 1. Produces devices
  expect(p.devices.length, `${ctx}: no devices`).toBeGreaterThan(0)

  // 2. Every device is fully populated
  for (const d of p.devices) {
    expect(d.hostname, `${ctx}: empty hostname on ${d.id}`).toBeTruthy()
    expect(d.hostname.startsWith(j.siteCode), `${ctx}: hostname ${d.hostname} missing site prefix`).toBe(true)
    expect(d.model, `${ctx}: empty model`).toBeTruthy()
    expect(d.vendor, `${ctx}: empty vendor`).toBeTruthy()
    expect(d.unitPrice, `${ctx}: non-positive price on ${d.model}`).toBeGreaterThan(0)
  }

  // 3. Hostnames unique
  const hostnames = p.devices.map(d => d.hostname)
  expect(new Set(hostnames).size, `${ctx}: duplicate hostnames`).toBe(hostnames.length)

  // 4. grandTotal = sum of unit prices
  const sum = p.devices.reduce((s, d) => s + d.unitPrice, 0)
  expect(p.grandTotal, `${ctx}: grandTotal mismatch`).toBe(sum)

  // 5. Every network device gets a non-empty config; non-network devices get none
  for (const d of p.devices) {
    const cfg = p.configs[d.id]
    if (NON_NETWORK.has(d.subLayer)) {
      expect(cfg ?? '', `${ctx}: ${d.subLayer} should have no CLI config`).toBe('')
    } else {
      expect(cfg, `${ctx}: missing config for ${d.hostname} (${d.vendor} ${d.subLayer})`).toBeTruthy()
      expect(cfg.length, `${ctx}: empty config for ${d.hostname}`).toBeGreaterThan(50)
    }
  }

  // 6. No hardcoded secrets — high-precision backstop. The strict
  //    "<CHANGE-ME> everywhere" rule is enforced in configgen.test.ts; here
  //    we only flag a credential keyword followed by a SECRET-SHAPED literal
  //    (>=6 chars, has both a letter and a digit) that is not a placeholder.
  //    This catches real leaks (e.g. `password cisco123`) while ignoring
  //    key-ids, auth methods, and `<CHANGE-ME>` slots across vendor syntaxes.
  const CRED_RE = /\b(?:password|secret|pre-shared-key|authentication-key|key-string|psk)\b\s+(?:\d+\s+)?(?:md5\s+|sha512\s+|0\s+|7\s+|5\s+|encrypted\s+)?["']?(<?[^\s"'\]]+)/i
  const secretShaped = (v: string) => v.length >= 6 && /[A-Za-z]/.test(v) && /[0-9]/.test(v)
  for (const [id, cfg] of Object.entries(p.configs)) {
    for (const line of cfg.split('\n')) {
      const m = line.match(CRED_RE)
      if (!m) continue
      const value = m[1]
      if (value.startsWith('<CHANGE-ME') || value.startsWith('<')) continue
      if (secretShaped(value)) {
        expect.fail(`${ctx}: possible hardcoded secret in ${id}: "${line.trim()}"`)
      }
    }
  }

  // 7. Cabling references only real device layers and has positive quantities
  const presentLayers = new Set(p.devices.map(d => d.subLayer))
  for (const c of p.cabling) {
    expect(presentLayers.has(c.fromLayer), `${ctx}: cable from absent layer ${c.fromLayer}`).toBe(true)
    expect(presentLayers.has(c.toLayer), `${ctx}: cable to absent layer ${c.toLayer}`).toBe(true)
    expect(c.quantity, `${ctx}: non-positive cable qty`).toBeGreaterThan(0)
  }

  // 8a. Spine-leaf cabling quantity is physically correct: each leaf has
  //     `uplinks` cables to the spine tier (NOT a leaf×spine full-mesh count).
  if (SPINE_LEAF_CASES.has(j.useCase)) {
    const leaves = p.devices.filter(d => d.subLayer === 'leaf')
    const spines = p.devices.filter(d => d.subLayer === 'spine')
    const slCable = p.cabling.find(c =>
      (c.fromLayer === 'spine' && c.toLayer === 'leaf') ||
      (c.fromLayer === 'leaf' && c.toLayer === 'spine'))
    if (leaves.length && slCable) {
      const expected = leaves.length * (leaves[0].uplinks ?? 0)
      expect(slCable.quantity, `${ctx}: spine-leaf cable qty ${slCable.quantity} != ${expected}`).toBe(expected)
    }
    // 8a'. The spine tier must supply enough ports to TERMINATE that cabling —
    // the X5 audit found designs quoting 200 spine-leaf cables on 4×36 = 144
    // spine ports. Leaf uplinks must also fit the leaf SKU's physical ports.
    if (leaves.length && spines.length) {
      const linkCount = leaves.length * (leaves[0].uplinks ?? 0)
      const spinePortSupply = spines.reduce((s, d) => s + d.ports, 0)
      expect(spinePortSupply, `${ctx}: ${linkCount} spine-leaf links exceed ${spinePortSupply} spine ports`)
        .toBeGreaterThanOrEqual(linkCount)
      expect(leaves[0].uplinks ?? 0, `${ctx}: leaf uplinks exceed leaf SKU ports`)
        .toBeLessThanOrEqual(leaves[0].ports)
    }

    // 8a''. Y2 config-wiring honesty: for NX-OS/Arista fabrics every spine must
    // actually be wired (no dark spines while it is still BGP-peered), no spine
    // configures a port beyond its SKU, and every leaf uplink lands within the
    // leaf SKU's port range.
    const wiringVendors = new Set(['Cisco', 'Arista'])
    if (leaves.length && spines.length && wiringVendors.has(spines[0].vendor)) {
      for (const s of spines) {
        const cfg = p.configs[s.id]
        if (!cfg) continue
        // Modular chassis name ports Ethernet<slot>/<port> (Z5b/A3-6), fixed
        // boxes just EthernetN — take the LAST numeric component either way.
        const dlPorts = [...cfg.matchAll(/interface Ethernet(?:\d+\/)*(\d+)\n\s+description DOWNLINK/g)].map(m => +m[1])
        expect(dlPorts.length, `${ctx}: spine ${s.hostname} is dark (0 downlinks but BGP-peered)`).toBeGreaterThan(0)
        expect(Math.max(0, ...dlPorts), `${ctx}: spine ${s.hostname} port exceeds SKU ${s.ports}`).toBeLessThanOrEqual(s.ports)
      }
      for (const l of leaves) {
        const cfg = p.configs[l.id]
        if (!cfg) continue
        const ulPorts = [...cfg.matchAll(/interface Ethernet(?:\d+\/)*(\d+)\n\s+description UPLINK/g)].map(m => +m[1])
        const maxLeafPort = l.uplinkStart ? l.uplinkStart + l.ports : l.ports
        for (const port of ulPorts) {
          expect(port, `${ctx}: leaf ${l.hostname} uplink port ${port} out of range`).toBeLessThanOrEqual(maxLeafPort)
        }
      }
    }
  }

  // 8a'''. Z2 physical honesty: a link cannot be billed faster than the slower
  // of its two ends (a 400G QSFP-DD module does not fit a 100G QSFP28 cage),
  // and every optic must match its own link's rate.
  const gbps = (s: string): number => {
    const m = /([\d.]+)\s*(t|g|m)?/i.exec((s || '').trim())
    if (!m) return 0
    const n = parseFloat(m[1]); const u = (m[2] || 'g').toLowerCase()
    return u === 't' ? n * 1000 : u === 'm' ? n / 1000 : n
  }
  // The end that terminates on its DEDICATED uplink block presents uplinkSpeed.
  const UPLINK_SIDE: Record<string, string> = { leaf: 'spine', access: 'distribution', distribution: 'core' }
  for (const c of p.cabling) {
    if (c.fromLayer === c.toLayer) continue           // HA peer-link, both ends identical
    const a = p.devices.find(d => d.subLayer === c.fromLayer)
    const b = p.devices.find(d => d.subLayer === c.toLayer)
    if (!a || !b) continue
    const rate = (d: typeof a, other: string) =>
      gbps(UPLINK_SIDE[d.subLayer] === other ? (d.uplinkSpeed ?? d.speed) : d.speed)
    const cap = Math.min(rate(a, b.subLayer), rate(b, a.subLayer))
    if (!cap) continue
    expect(gbps(c.speed), `${ctx}: ${c.fromLayer}→${c.toLayer} billed at ${c.speed} but the slower end tops out at ${cap}G`)
      .toBeLessThanOrEqual(cap)
  }
  for (const o of p.optics) {
    const link = p.cabling.find(c => `${c.fromLayer} → ${c.toLayer}` === o.linkGroup)
    if (!link) continue
    expect(o.speed, `${ctx}: ${o.partNumber} (${o.speed}) on a ${link.speed} link`).toBe(link.speed)
  }

  // 8a''''. Z3: the north-south handoff. A firewall cabled to a spine can never
  // work — an eBGP spine is not a VTEP and carries no tenant VRF. Every cabled
  // firewall link must land on a border leaf (fabric) or distribution (campus),
  // and exactly one device tier must configure it.
  if (p.devices.some(d => d.subLayer === 'firewall')) {
    expect(p.cabling.find(c => c.fromLayer === 'firewall' && c.toLayer === 'spine'),
      `${ctx}: firewall cabled to a spine, which has no tenant VRF to route into`).toBeUndefined()
    for (const s of p.devices.filter(d => d.subLayer === 'spine')) {
      expect(p.configs[s.id] ?? '', `${ctx}: spine ${s.hostname} still configures a firewall handoff`)
        .not.toContain('FW-HANDOFF')
    }
    const handoffDevices = p.devices.filter(d => (p.configs[d.id] ?? '').includes('FW-HANDOFF'))
    for (const d of handoffDevices) {
      expect(['leaf', 'distribution'], `${ctx}: ${d.subLayer} must not own the handoff`).toContain(d.subLayer)
    }
    // Every fabric vendor's leaf must configure the handoff it is cabled for.
    // Z3/Z8/Z3b closed all six; the set is the guard against a new vendor
    // (or a regression) silently reopening the gap.
    const HANDOFF_VENDORS = new Set(['Cisco', 'Arista', 'Juniper', 'Nokia', 'Dell EMC', 'Extreme Networks', 'NVIDIA'])
    const leaves = p.devices.filter(d => d.subLayer === 'leaf')
    if (leaves.length && HANDOFF_VENDORS.has(leaves[0].vendor)) {
      expect(handoffDevices.length, `${ctx}: no device configures the cabled firewall handoff`).toBeGreaterThan(0)
    }
  }

  // 8a'''''. Z4: a campus config must only name port types its SKU actually
  // has. The C9500-48Y4C is 25G+100G with NO TenGigabitEthernet at all, so
  // every command that named one was rejected by the platform.
  for (const d of p.devices) {
    const cfg = p.configs[d.id]
    if (!cfg || !d.portIf) continue
    const prefixes = [d.portIf, d.uplinkIf].filter(Boolean) as string[]
    const named = [...cfg.matchAll(/^interface (?:range )?((?:Gigabit|TenGigabit|TwentyFiveGigE|FortyGigabit|HundredGigE)\S*?)\d+(?:-\d+)?$/gm)].map(m => m[1])
    for (const n of new Set(named)) {
      expect(prefixes, `${ctx}: ${d.model} names ${n}x but has only ${prefixes.join(' / ')}`).toContain(n)
    }
  }

  // 8b. TCO capex must equal the BOM grand total (no drift between cost views).
  const tco = computeTCO(p.devices)
  expect(tco.capex, `${ctx}: TCO capex ${tco.capex} != grandTotal ${p.grandTotal}`).toBe(p.grandTotal)

  // 8. Rack layout assigns every rack-mountable device exactly once
  const rackedIds = new Set<string>()
  for (const rack of p.racks) {
    for (const slot of rack.slots) rackedIds.add(slot.device.id)
  }
  const rackable = p.devices.filter(d => !NON_NETWORK.has(d.subLayer) || d.subLayer === 'gpu-compute')
  // every device that occupies rack units should be placed
  for (const d of rackable) {
    expect(rackedIds.has(d.id), `${ctx}: device ${d.hostname} not placed in any rack`).toBe(true)
  }
}

/** Config-content correctness — the §6 rules that make configs production-trustworthy. */
function assertConfigCorrectness(j: Journey, p: ReturnType<typeof runPipeline>) {
  const ctx = `${j.useCase}/${j.vendorPrefs.join('+') || 'default'}`

  for (const d of p.devices) {
    const cfg = p.configs[d.id]
    if (!cfg) continue

    // Rule §6.4 — single underlay: never IS-IS and OSPF in the same device.
    const hasIsis = /\brouter isis\b/.test(cfg)
    const hasOspfUnderlay = /\brouter ospf\b/.test(cfg)
    if (hasIsis && hasOspfUnderlay) {
      expect.fail(`${ctx}: ${d.hostname} has BOTH IS-IS and OSPF underlay`)
    }

    // Fabric control plane: DC/GPU/multisite spine+leaf must run BGP (EVPN).
    if (SPINE_LEAF_CASES.has(j.useCase) && (d.subLayer === 'spine' || d.subLayer === 'leaf')) {
      expect(/bgp/i.test(cfg), `${ctx}: ${d.hostname} (fabric) missing BGP`).toBe(true)
    }

    // GPU lossless fabric: leaf/spine must carry PFC / priority-flow-control.
    if (j.useCase === 'gpu' && (d.subLayer === 'spine' || d.subLayer === 'leaf')) {
      const hasPfc = /priority-flow-control|priority flow-control|\bpfc\b|no-drop|qos/i.test(cfg)
      expect(hasPfc, `${ctx}: GPU ${d.hostname} missing lossless/PFC config`).toBe(true)
    }
  }
}

/** I4 — the enterprise ZTP plan (R-series) must hold for EVERY produced design:
 *  every device identifies to a real ZTP mechanism, gets a clean Day-0, and is
 *  paired with its Day-N production config. Locks in R1-R4 across the matrix. */
function assertZTPPlanInvariants(j: Journey, p: ReturnType<typeof runPipeline>) {
  const ctx = `${j.useCase}/${j.scale}/${j.vendorPrefs.join('+') || 'default'}`
  const plan = buildZTPPlan(p.devices, p.configs)

  // One plan entry per BOM device.
  expect(plan.entries.length, `${ctx}: ZTP plan missing devices`).toBe(p.devices.length)

  for (const e of plan.entries) {
    const id = e.identity
    // 1. Fully identified: platform, mechanism, DHCP class, boot file.
    expect(id.platform, `${ctx}: ${id.hostname} has no ZTP platform`).toBeTruthy()
    expect(id.method, `${ctx}: ${id.hostname} has no ZTP method`).toBeTruthy()
    expect(id.dhcpVendorClass, `${ctx}: ${id.hostname} has no DHCP vendor-class`).toBeTruthy()
    expect(id.bootFile, `${ctx}: ${id.hostname} has no boot file`).toBeTruthy()

    // 2. Day-0 is a real management-plane bootstrap: identifies the host,
    //    carries placeholder secrets, and contains NO production config.
    expect(e.day0.length, `${ctx}: ${id.hostname} Day-0 empty`).toBeGreaterThan(50)
    expect(e.day0, `${ctx}: ${id.hostname} Day-0 missing hostname`).toContain(id.hostname)
    expect(e.day0, `${ctx}: ${id.hostname} Day-0 has hardcoded cred`).not.toMatch(/ChangeMe!|NetDesignZTP1!/)
    expect(e.day0, `${ctx}: ${id.hostname} Day-0 leaks production BGP`).not.toMatch(/\brouter bgp\b/i)

    // 3. "Push the right config": every network device that got a Day-N
    //    production config must be paired to it by BOM id.
    const hasConfig = Boolean(p.configs[id.id]?.trim())
    expect(e.hasDayN, `${ctx}: ${id.hostname} Day-N pairing mismatch`).toBe(hasConfig)
    if (hasConfig) expect(e.dayNConfigId).toBe(id.id)
  }

  // 4. Summary agrees with reality.
  const paired = plan.entries.filter(e => e.hasDayN).length
  expect(plan.summary.withDayN, `${ctx}: withDayN summary drift`).toBe(paired)

  // 5. The multi-vendor DHCP config classifies every vendor present.
  const dhcp = generateDhcpConfig(plan.entries.map(e => e.identity))
  const classes = new Set(plan.entries.map(e => e.identity.dhcpVendorClass))
  for (const vclass of classes) {
    expect(dhcp, `${ctx}: DHCP config missing option-60 class for ${vclass}`)
      .toContain(vclass.replace(/[^A-Za-z0-9]/g, '-'))
  }
}

/** The capacity invariant that was MISSED: the fabric must host the endpoints. */
function assertCapacityInvariant(j: Journey, p: ReturnType<typeof runPipeline>) {
  const ctx = `${j.useCase}/${j.totalEndpoints}ep/${j.bandwidthPerServer}/${j.oversubscription}:1`

  if (SPINE_LEAF_CASES.has(j.useCase)) {
    const leaves = p.devices.filter(d => d.subLayer === 'leaf')
    expect(leaves.length, `${ctx}: no leaves`).toBeGreaterThanOrEqual(2)
    const sample = leaves[0]
    const downlinks = sample.ports - (sample.uplinks ?? 0)
    const capacity = leaves.length * downlinks
    expect(capacity, `${ctx}: leaf capacity ${capacity} < ${j.totalEndpoints} endpoints`)
      .toBeGreaterThanOrEqual(j.totalEndpoints)
    // and validateBOM must NOT raise a capacity error for an in-spec design
    const capErr = p.issues.find(i => i.category === 'capacity' && i.severity === 'error')
    expect(capErr, `${ctx}: unexpected capacity error: ${capErr?.message}`).toBeUndefined()
  }

  if (j.useCase === 'campus') {
    const access = p.devices.filter(d => d.subLayer === 'access')
    expect(access.length, `${ctx}: no access switches`).toBeGreaterThanOrEqual(2)
    const sample = access[0]
    const downlinks = sample.ports - (sample.uplinks ?? 0)
    const capacity = access.length * downlinks
    expect(capacity, `${ctx}: access capacity ${capacity} < ${j.totalEndpoints} endpoints`)
      .toBeGreaterThanOrEqual(j.totalEndpoints)
  }

  if (j.useCase === 'gpu') {
    const servers = p.devices.filter(d => d.subLayer === 'gpu-compute')
    expect(servers.length, `${ctx}: GPU server count`).toBe(Math.ceil(j.totalEndpoints / 8))
  }
}

/** F2/F3 — the NetBox DCIM export must be structurally sound for EVERY design:
 *  every BOM device exported, cable rows match the expanded plan, every cable
 *  endpoint's interface exists, rack placements are within bounds and
 *  non-overlapping, and the device CSV references only real racks. */
function assertDcimExportInvariants(j: Journey, p: ReturnType<typeof runPipeline>) {
  const ctx = `${j.useCase}/${j.scale}/${j.vendorPrefs.join('+') || 'default'}`
  const x = buildNetBoxDcimExport(p.devices, p.cabling, j.siteCode, p.racks)

  const rows = (csv: string) => csv.trim().split('\n').slice(1)

  // 1. One device row per unique hostname; every BOM device present.
  const deviceRows = rows(x.devicesCsv)
  const exportedNames = new Set(deviceRows.map(r => r.split(',')[0]))
  for (const d of p.devices) {
    const name = d.hostname || d.model
    expect(exportedNames.has(name), `${ctx}: ${name} missing from device CSV`).toBe(true)
  }

  // 2. Cable rows match the expanded plan count.
  expect(rows(x.cablesCsv).length, `${ctx}: cable CSV row drift`).toBe(x.cableCount)

  // 3. Every cable endpoint's interface exists in the interface CSV.
  const ifaceKeys = new Set(rows(x.interfacesCsv).map(r => {
    const [device, name] = r.split(',')
    return `${device} ${name}`
  }))
  for (const r of rows(x.cablesCsv)) {
    const c = r.split(',')
    expect(ifaceKeys.has(`${c[0]} ${c[2]}`), `${ctx}: cable side_a ${c[0]} ${c[2]} not in interface CSV`).toBe(true)
    expect(ifaceKeys.has(`${c[3]} ${c[5]}`), `${ctx}: cable side_b ${c[3]} ${c[5]} not in interface CSV`).toBe(true)
  }

  // 4. Rack export: count matches, positions in bounds, no U overlap per rack,
  //    and every rack referenced by a device row exists.
  expect(x.rackCount, `${ctx}: rackCount drift`).toBe(p.racks.length)
  const rackLabels = new Set(p.racks.map(r => r.label))
  for (const rack of p.racks) {
    const occupied = new Set<number>()
    for (const slot of rack.slots) {
      const pos = netboxRackPosition(slot, rack.totalU)
      expect(pos, `${ctx}: ${rack.label} position ${pos} below rack`).toBeGreaterThanOrEqual(1)
      expect(pos + slot.heightU - 1, `${ctx}: ${rack.label} position ${pos}+${slot.heightU}U above rack`).toBeLessThanOrEqual(rack.totalU)
      for (let u = pos; u < pos + slot.heightU; u++) {
        expect(occupied.has(u), `${ctx}: ${rack.label} U${u} double-booked`).toBe(false)
        occupied.add(u)
      }
    }
  }
  for (const r of deviceRows) {
    const cells = r.split(',')
    const rackCell = cells[6]
    if (rackCell) expect(rackLabels.has(rackCell), `${ctx}: device row references unknown rack ${rackCell}`).toBe(true)
  }
}

/** H6 — the capacity plan must AGREE with the BOM's own sizing. The fabric is
 *  built to the requested oversubscription target; when the leaf SKU cannot
 *  physically carry enough uplinks the BOM knowingly degrades and validateBOM
 *  emits an 'oversubscription' warning (H4). So at year 0 either the effective
 *  ratio honors the target, or the validator flagged the degradation — a
 *  SILENT breach means the two capacity views have drifted apart. */
function assertCapacityPlanInvariants(j: Journey, p: ReturnType<typeof runPipeline>) {
  const ctx = `${j.useCase}/${j.totalEndpoints}ep/${j.bandwidthPerServer}/${j.oversubscription}:1`
  const plan = computeCapacityPlan(p.devices, j.totalEndpoints, 0.2, 5, {
    bandwidthPerServer: j.bandwidthPerServer, oversubTarget: j.oversubscription,
  })

  // Year 0 mirrors the design inputs; growth is monotonic.
  expect(plan.projections[0].endpoints, `${ctx}: year-0 endpoint drift`).toBe(j.totalEndpoints)
  for (let i = 1; i < plan.projections.length; i++) {
    expect(plan.projections[i].endpoints).toBeGreaterThanOrEqual(plan.projections[i - 1].endpoints)
  }

  if (SPINE_LEAF_CASES.has(j.useCase)) {
    // Spine-leaf BOMs always carry uplinks → the bandwidth model must engage.
    expect(plan.hasBandwidthModel, `${ctx}: bandwidth model inactive on a fabric`).toBe(true)
    const os0 = plan.projections[0].effectiveOversub
    expect(os0, `${ctx}: no effective oversub computed`).not.toBeNull()
    if (os0! > j.oversubscription + 0.01) {
      const flagged = p.issues.some(i => i.category === 'oversubscription')
      expect(flagged,
        `${ctx}: year-0 oversub ${os0!.toFixed(2)}:1 exceeds the ${j.oversubscription}:1 target ` +
        `but validateBOM raised no oversubscription warning — capacity views disagree`,
      ).toBe(true)
    }
  }
}

/** Use-case-specific role presence. */
function assertRolePresence(j: Journey, p: ReturnType<typeof runPipeline>) {
  const layers = new Set(p.devices.map(d => d.subLayer))
  const ctx = `${j.useCase}`
  const need = (role: string) => expect(layers.has(role), `${ctx}: missing role ${role}`).toBe(true)

  switch (j.useCase) {
    case 'dc': case 'gpu': need('spine'); need('leaf'); break
    case 'multisite': need('spine'); need('leaf'); need('wan-edge'); break
    case 'campus': need('access'); need('distribution'); break
    case 'wan': need('wan-edge'); break
    case 'oran':
      for (const r of ['oran-cu', 'oran-du', 'oran-ru', 'oran-fronthaul', 'oran-midhaul', 'oran-core', 'oran-timing']) need(r)
      break
    case 'multicloud': case 'aviatrix': need('cloud-transit'); need('cloud-gw'); break
  }
}

// ── The matrix ──────────────────────────────────────────────────────────────

const USE_CASES: UseCase[] = ['dc', 'gpu', 'campus', 'wan', 'multisite', 'multicloud', 'aviatrix', 'oran']
const SCALES = ['small', 'medium', 'large'] as const
const SPEEDS = ['25G', '100G', '400G']
const OVERSUBS = [1, 3]
const ENDPOINTS = [128, 512, 1024, 2048]
const VENDOR_SETS: string[][] = [
  [], ['Arista'], ['NVIDIA'], ['Juniper'], ['Nokia'], ['Dell EMC'], ['Extreme Networks'],
]

describe('E2E journey — universal invariants across full matrix', () => {
  for (const useCase of USE_CASES) {
    for (const scale of SCALES) {
      for (const endpoints of ENDPOINTS) {
        const j: Journey = {
          useCase, scale, siteCode: 'E2E',
          totalEndpoints: endpoints,
          bandwidthPerServer: '25G', oversubscription: 3, numSites: 3,
          vendorPrefs: [],
        }
        it(`${useCase}/${scale}/${endpoints}ep — pipeline holds`, () => {
          const p = runPipeline(j)
          assertUniversalInvariants(j, p)
          assertRolePresence(j, p)
          assertCapacityInvariant(j, p)
          assertConfigCorrectness(j, p)
          assertZTPPlanInvariants(j, p)
          assertDcimExportInvariants(j, p)
          assertCapacityPlanInvariants(j, p)
        })
      }
    }
  }
})

describe('E2E journey — port speed × oversubscription matrix (spine-leaf)', () => {
  for (const useCase of ['dc', 'gpu', 'multisite'] as UseCase[]) {
    for (const speed of SPEEDS) {
      for (const oversub of OVERSUBS) {
        for (const endpoints of [512, 2048]) {
          const j: Journey = {
            useCase, scale: 'large', siteCode: 'E2E',
            totalEndpoints: endpoints, bandwidthPerServer: speed,
            oversubscription: oversub, numSites: 3, vendorPrefs: [],
          }
          it(`${useCase}/${endpoints}ep/${speed}/${oversub}:1 — capacity & consistency`, () => {
            const p = runPipeline(j)
            assertUniversalInvariants(j, p)
            assertCapacityInvariant(j, p)
            assertConfigCorrectness(j, p)
            assertCapacityPlanInvariants(j, p)
          })
        }
      }
    }
  }
})

describe('E2E journey — vendor matrix (spine-leaf)', () => {
  for (const useCase of ['dc', 'gpu'] as UseCase[]) {
    for (const vendorPrefs of VENDOR_SETS) {
      const j: Journey = {
        useCase, scale: 'large', siteCode: 'E2E',
        totalEndpoints: 1024, bandwidthPerServer: '100G',
        oversubscription: 1, numSites: 1, vendorPrefs,
      }
      it(`${useCase}/${vendorPrefs.join('+') || 'Cisco'} — pipeline holds`, () => {
        const p = runPipeline(j)
        assertUniversalInvariants(j, p)
        assertCapacityInvariant(j, p)
        assertConfigCorrectness(j, p)
        assertZTPPlanInvariants(j, p)
        assertDcimExportInvariants(j, p)
        // The generated fabric must be clean per the static validator — no
        // vendor should produce a hard validation FAIL (catches regressions
        // like the jumbo-MTU / GPU-QoS / BGP-presence gaps per vendor).
        const v = validateConfigs({ configs: p.configs, devices: p.devices, useCase: j.useCase })
        const label = `${useCase}/${vendorPrefs.join('+') || 'Cisco'}`
        const fails = v.checks.filter(c => c.severity === 'fail')
        expect(
          fails.length,
          `${label}: validator FAILs — ${fails.map(f => `${f.id} ${f.detail}`).join(' | ')}`,
        ).toBe(0)
        // Checks the generated config fully controls must also be WARN-free for
        // every vendor (locks in M3–M9: hostname, mgmt, loopback, BGP presence
        // + peer reachability, single underlay, jumbo MTU, BFD).
        const CONTROLLED = new Set(['V-01', 'V-03', 'V-04', 'V-06', 'V-07', 'V-12', 'V-13', 'V-14'])
        const warns = v.checks.filter(c => c.severity === 'warn' && CONTROLLED.has(c.id))
        expect(
          warns.length,
          `${label}: unexpected validator WARNs — ${warns.map(w => `${w.id} ${w.detail}`).join(' | ')}`,
        ).toBe(0)
      })
    }
  }
})

describe('E2E journey — monotonicity (more endpoints never shrinks the design)', () => {
  for (const useCase of ['dc', 'gpu', 'campus', 'wan', 'oran'] as UseCase[]) {
    it(`${useCase}: device count is non-decreasing in endpoint count`, () => {
      let prev = 0
      for (const endpoints of [128, 256, 512, 1024, 2048, 4096]) {
        const p = runPipeline({
          useCase, scale: 'large', siteCode: 'E2E',
          totalEndpoints: endpoints, bandwidthPerServer: '25G',
          oversubscription: 3, numSites: 3, vendorPrefs: [],
        })
        expect(p.devices.length, `${useCase}@${endpoints}ep shrank below ${prev}`).toBeGreaterThanOrEqual(prev)
        prev = p.devices.length
      }
    })
  }
})

describe('E2E journey — tiny & extreme scale edges', () => {
  const edges = [1, 2, 8, 4096, 8192]
  for (const useCase of USE_CASES) {
    for (const endpoints of edges) {
      it(`${useCase}/${endpoints}ep — no overflow / pipeline holds`, () => {
        const p = runPipeline({
          useCase, scale: 'large', siteCode: 'EDG',
          totalEndpoints: endpoints, bandwidthPerServer: '100G',
          oversubscription: 1, numSites: 3, vendorPrefs: [],
        })
        assertUniversalInvariants({
          useCase, scale: 'large', siteCode: 'EDG', totalEndpoints: endpoints,
          bandwidthPerServer: '100G', oversubscription: 1, numSites: 3, vendorPrefs: [],
        }, p)
        // hostnames must remain alphanumeric even at extreme device counts (no ASCII overflow past Z)
        for (const d of p.devices) {
          expect(d.hostname, `${useCase}@${endpoints}: non-alnum hostname ${d.hostname}`)
            .toMatch(/^EDG-[A-Z0-9-]+$/)
        }
      })
    }
  }
})

describe('E2E journey — higher bandwidth never reduces spine count', () => {
  for (const useCase of ['dc', 'gpu'] as UseCase[]) {
    it(`${useCase}: spine count is non-decreasing in bandwidth`, () => {
      const spinesFor = (speed: string) => {
        const p = runPipeline({
          useCase, scale: 'large', siteCode: 'E2E',
          totalEndpoints: 2048, bandwidthPerServer: speed,
          oversubscription: 1, numSites: 1, vendorPrefs: [],
        })
        return p.devices.filter((d: BOMDevice) => d.subLayer === 'spine').length
      }
      const s25 = spinesFor('25G')
      const s100 = spinesFor('100G')
      const s400 = spinesFor('400G')
      expect(s100).toBeGreaterThanOrEqual(s25)
      expect(s400).toBeGreaterThanOrEqual(s100)
    })
  }
})
