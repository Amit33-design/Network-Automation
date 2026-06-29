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
    const slCable = p.cabling.find(c =>
      (c.fromLayer === 'spine' && c.toLayer === 'leaf') ||
      (c.fromLayer === 'leaf' && c.toLayer === 'spine'))
    if (leaves.length && slCable) {
      const expected = leaves.length * (leaves[0].uplinks ?? 0)
      expect(slCable.quantity, `${ctx}: spine-leaf cable qty ${slCable.quantity} != ${expected}`).toBe(expected)
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
        // every vendor (locks in M3–M7: hostname, mgmt, loopback, BGP, single
        // underlay, jumbo MTU, BFD). V-04 (placeholder peer IPs) is excluded —
        // its CHANGE-ME cross-references warn by design across all vendors.
        const CONTROLLED = new Set(['V-01', 'V-03', 'V-06', 'V-07', 'V-12', 'V-13', 'V-14'])
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
