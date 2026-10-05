import { describe, it, expect } from 'vitest'
import {
  computeRackLayout, buildCableSchedule, rackRedundancy, faultDomain,
  RACK_POWER_BUDGET_W, GPU_RACK_POWER_BUDGET_W, assumedHeights,
} from '@/components/RackElevation'
import type { BOMDevice, CableLink } from '@/types'
import { buildDeviceList, buildCabling, computeTCO, deviceRackUnits } from '@/lib/bom'
import { expandCablePlan } from '@/lib/netbox-dcim'

function makeDevice(overrides: Partial<BOMDevice> = {}): BOMDevice {
  return {
    id: 'test-1',
    hostname: 'IAD-SPINE-A01',
    role: 'spine',
    subLayer: 'spine',
    model: 'Nexus 9336C-FX2',
    vendor: 'Cisco',
    count: 1,
    unitPrice: 28000,
    totalPrice: 28000,
    speed: '100G',
    ports: 36,
    features: ['BGP', 'VXLAN'],
    ...overrides,
  }
}

describe('computeRackLayout (G-A14)', () => {
  it('assigns devices to rack slots in role order', () => {
    const devices = [
      makeDevice({ id: 'l1', hostname: 'LEAF-A01', subLayer: 'leaf' }),
      makeDevice({ id: 's1', hostname: 'SPINE-A01', subLayer: 'spine' }),
      makeDevice({ id: 'f1', hostname: 'FW-A01', subLayer: 'firewall' }),
    ]
    const racks = computeRackLayout(devices)
    expect(racks).toHaveLength(1)
    expect(racks[0].slots[0].device.subLayer).toBe('firewall')
    expect(racks[0].slots[1].device.subLayer).toBe('spine')
    expect(racks[0].slots[2].device.subLayer).toBe('leaf')
  })

  it('assigns correct RU heights per role', () => {
    const devices = [
      makeDevice({ id: 's1', subLayer: 'spine' }),
      makeDevice({ id: 'l1', subLayer: 'leaf' }),
      makeDevice({ id: 'f1', subLayer: 'firewall' }),
    ]
    const racks = computeRackLayout(devices)
    const spine = racks[0].slots.find(s => s.device.subLayer === 'spine')
    const leaf = racks[0].slots.find(s => s.device.subLayer === 'leaf')
    const fw = racks[0].slots.find(s => s.device.subLayer === 'firewall')
    expect(spine?.heightU).toBe(2)
    expect(leaf?.heightU).toBe(1)
    expect(fw?.heightU).toBe(1)
  })

  it('calculates total power from the real SKU, not a role average', () => {
    // Was 2x800, a `ROLE_POWER` guess. The layout now uses the catalogue
    // figure for this actual model (AF2) — the Nexus 9336C-FX2 draws 650 W,
    // and the rack layout is what decides how many cabinets are needed.
    const devices = [
      makeDevice({ id: 's1', subLayer: 'spine' }),
      makeDevice({ id: 's2', subLayer: 'spine' }),
    ]
    const racks = computeRackLayout(devices)
    expect(racks[0].totalPowerW).toBe(1300)
  })

  it('closes a rack on POWER, not only on units (AF2)', () => {
    // The layout tracked totalPowerW and never used it. A 1024-endpoint DC
    // put 32 devices and 17.3 kW into one 42U cabinet — a standard cabinet is
    // 5-10 kW — and the cable schedule simultaneously priced every
    // spine-leaf run at the 100 m the user had specified.
    const devices = Array.from({ length: 20 }, (_, i) =>
      makeDevice({ id: `s${i}`, hostname: `SPINE-${i}`, subLayer: 'spine' }),
    )
    const racks = computeRackLayout(devices)
    for (const rack of racks) {
      expect(rack.totalPowerW, `${rack.label} draws over budget`)
        .toBeLessThanOrEqual(RACK_POWER_BUDGET_W)
      expect(rack.usedU).toBeLessThanOrEqual(42)
    }
    // 20 x 650 W = 13 kW, so it cannot be one rack even though 40U fits.
    expect(racks.length).toBeGreaterThan(1)
    expect(racks.flatMap(r => r.slots).length, 'a device was dropped').toBe(20)
  })

  it('still places a device that alone exceeds the budget, rather than looping', () => {
    const hog = makeDevice({
      id: 'hog', hostname: 'HOG', subLayer: 'gpu-compute',
      model: 'GPU Server 4U (8x H100)',
    })
    const racks = computeRackLayout([hog, hog, hog].map((d, i) => ({ ...d, id: `h${i}` })))
    expect(racks.flatMap(r => r.slots).length).toBe(3)
  })

  it('splits into multiple racks when exceeding 42U', () => {
    const devices = Array.from({ length: 44 }, (_, i) =>
      makeDevice({ id: `l${i}`, hostname: `LEAF-${i}`, subLayer: 'leaf' })
    )
    const racks = computeRackLayout(devices)
    expect(racks.length).toBeGreaterThan(1)
    expect(racks[0].usedU).toBeLessThanOrEqual(42)
  })

  it('excludes cloud devices (0 RU) from rack layout', () => {
    const devices = [
      makeDevice({ id: 'cg1', subLayer: 'cloud-gw' }),
      makeDevice({ id: 's1', subLayer: 'spine' }),
    ]
    const racks = computeRackLayout(devices)
    expect(racks[0].slots).toHaveLength(1)
    expect(racks[0].slots[0].device.subLayer).toBe('spine')
  })

  it('assigns sequential U positions', () => {
    const devices = [
      makeDevice({ id: 'f1', subLayer: 'firewall' }),
      makeDevice({ id: 's1', subLayer: 'spine' }),
      makeDevice({ id: 'l1', subLayer: 'leaf' }),
    ]
    const racks = computeRackLayout(devices)
    expect(racks[0].slots[0].startU).toBe(1)
    expect(racks[0].slots[1].startU).toBe(2)
    expect(racks[0].slots[2].startU).toBe(4)
  })

  it('returns at least one rack even with no devices', () => {
    const racks = computeRackLayout([])
    expect(racks).toHaveLength(1)
    expect(racks[0].usedU).toBe(0)
  })

  it('places SD-WAN controllers before WAN edges', () => {
    const devices = [
      makeDevice({ id: 'w1', subLayer: 'wan-edge', hostname: 'WAN-A01' }),
      makeDevice({ id: 'c1', subLayer: 'sdwan-controller', hostname: 'SDCTL-A01' }),
    ]
    const racks = computeRackLayout(devices)
    expect(racks[0].slots[0].device.subLayer).toBe('sdwan-controller')
    expect(racks[0].slots[1].device.subLayer).toBe('wan-edge')
  })
})

describe('computeRackLayout — ToR + GPU compute', () => {
  function makeCompute(id: string): BOMDevice {
    return makeDevice({
      id, hostname: `IAD-GPU-${id}`, subLayer: 'gpu-compute',
      model: 'GPU Server 4U (8x H100)', vendor: 'NVIDIA',
      unitPrice: 150000, totalPrice: 150000, ports: 4,
    })
  }

  it('uses ToR layout when gpu-compute devices present', () => {
    const devices = [
      makeDevice({ id: 's1', hostname: 'SPINE-A01', subLayer: 'spine' }),
      makeDevice({ id: 'l1', hostname: 'LEAF-A01', subLayer: 'leaf' }),
      makeDevice({ id: 'l2', hostname: 'LEAF-A02', subLayer: 'leaf' }),
      makeCompute('001'), makeCompute('002'), makeCompute('003'),
    ]
    const racks = computeRackLayout(devices)
    const computeRacks = racks.filter(r => r.rackId.startsWith('CR'))
    const netRacks = racks.filter(r => r.rackId.startsWith('NW'))
    expect(computeRacks.length).toBe(1) // 3 servers fit in 1 rack
    expect(netRacks.length).toBe(1) // 1 spine
    // Compute rack has leaf pair at top + compute below
    expect(computeRacks[0].slots[0].device.subLayer).toBe('leaf')
    expect(computeRacks[0].slots[1].device.subLayer).toBe('leaf')
    expect(computeRacks[0].slots[2].device.subLayer).toBe('gpu-compute')
  })

  it('fills a compute rack to its POWER budget, not just its units', () => {
    // This asserted 10 servers per rack, from 40U / 4U. Ten 8xH100 nodes at
    // 6.5 kW each is 65 kW in one 42U cabinet, which nothing delivers — the
    // layout was fitting boxes it could never energise (AF2). Servers per
    // rack now comes from min(units, 40 kW budget).
    const leaves = Array.from({ length: 4 }, (_, i) =>
      makeDevice({ id: `l${i}`, hostname: `LEAF-${i}`, subLayer: 'leaf' }),
    )
    const servers = Array.from({ length: 20 }, (_, i) => makeCompute(`${i}`))
    const racks = computeRackLayout([...leaves, ...servers])
    const computeRacks = racks.filter(r => r.rackId.startsWith('CR'))
    for (const rack of computeRacks) {
      expect(rack.totalPowerW, `${rack.label} exceeds the high-density budget`)
        .toBeLessThanOrEqual(GPU_RACK_POWER_BUDGET_W)
    }
    // ...and every server is still placed somewhere.
    const placed = computeRacks
      .flatMap(r => r.slots).filter(s => s.device.subLayer === 'gpu-compute').length
    expect(placed).toBe(20)
  })

  it('assigns gpu-compute 4U height', () => {
    const devices = [
      makeDevice({ id: 'l1', subLayer: 'leaf' }),
      makeDevice({ id: 'l2', subLayer: 'leaf' }),
      makeCompute('001'),
    ]
    const racks = computeRackLayout(devices)
    const gpuSlot = racks[0].slots.find(s => s.device.subLayer === 'gpu-compute')
    expect(gpuSlot?.heightU).toBe(4)
  })

  it('spines go to network rack, not compute rack', () => {
    const devices = [
      makeDevice({ id: 's1', subLayer: 'spine' }),
      makeDevice({ id: 's2', subLayer: 'spine' }),
      makeDevice({ id: 'l1', subLayer: 'leaf' }),
      makeDevice({ id: 'l2', subLayer: 'leaf' }),
      makeCompute('001'),
    ]
    const racks = computeRackLayout(devices)
    const netRack = racks.find(r => r.rackId.startsWith('NW'))
    expect(netRack).toBeDefined()
    expect(netRack!.slots.every(s => s.device.subLayer === 'spine')).toBe(true)
  })

  it('labels compute racks with alphaLabel', () => {
    const servers = Array.from({ length: 30 }, (_, i) => makeCompute(`${i}`))
    const racks = computeRackLayout(servers)
    const computeRacks = racks.filter(r => r.rackId.startsWith('CR'))
    expect(computeRacks[0].label).toBe('Compute A')
    expect(computeRacks[1].label).toBe('Compute B')
    expect(computeRacks[2].label).toBe('Compute C')
  })

  it('handles a large GPU fabric, at a power density that exists', () => {
    const leaves = Array.from({ length: 52 }, (_, i) =>
      makeDevice({ id: `l${i}`, hostname: `LEAF-${i}`, subLayer: 'leaf' }),
    )
    const servers = Array.from({ length: 256 }, (_, i) => makeCompute(`${i}`))
    const spines = Array.from({ length: 3 }, (_, i) =>
      makeDevice({ id: `s${i}`, hostname: `SPINE-${i}`, subLayer: 'spine' }),
    )
    const racks = computeRackLayout([...spines, ...leaves, ...servers])
    const computeRacks = racks.filter(r => r.rackId.startsWith('CR'))
    const netRacks = racks.filter(r => r.rackId.startsWith('NW'))
    // Was 26, i.e. 10 servers and 65 kW per cabinet. At the 40 kW budget it
    // takes roughly twice as many racks — which is the real facilities cost
    // of 256 H100 nodes, and the number the data-centre team needs (AF2).
    expect(computeRacks.length).toBe(52)
    for (const rack of racks) {
      expect(rack.totalPowerW, `${rack.label} over budget`)
        .toBeLessThanOrEqual(GPU_RACK_POWER_BUDGET_W)
    }
    expect(netRacks.length).toBeGreaterThanOrEqual(1)
    // Each compute rack should have leaf pair + servers
    expect(computeRacks[0].slots[0].device.subLayer).toBe('leaf')
  })

  it('falls back to dense layout when no gpu-compute devices', () => {
    const devices = [
      makeDevice({ id: 's1', subLayer: 'spine' }),
      makeDevice({ id: 'l1', subLayer: 'leaf' }),
    ]
    const racks = computeRackLayout(devices)
    // Dense layout puts spine before leaf (role order), uses R-prefix rack IDs
    expect(racks[0].rackId).toBe('R1')
    expect(racks[0].slots[0].device.subLayer).toBe('spine')
  })
})

describe('buildCableSchedule (G-A14)', () => {
  it('generates cable runs from cabling data', () => {
    const devices = [
      makeDevice({ id: 's1', hostname: 'SPINE-A01', subLayer: 'spine' }),
      makeDevice({ id: 'l1', hostname: 'LEAF-A01', subLayer: 'leaf' }),
    ]
    const cabling: CableLink[] = [{
      id: 'c1', fromLayer: 'spine', toLayer: 'leaf',
      fromDevice: '1x spine', toDevice: '1x leaf',
      cableType: 'DAC', speed: '100G', lengthM: 3,
      quantity: 1, pricePerUnit: 80, totalPrice: 80,
    }]
    const runs = buildCableSchedule(devices, cabling)
    expect(runs).toHaveLength(1)
    expect(runs[0].from).toBe('SPINE-A01')
    expect(runs[0].to).toBe('LEAF-A01')
    expect(runs[0].cableType).toBe('DAC')
  })

  it('generates cross-product cable runs for multi-device layers', () => {
    const devices = [
      makeDevice({ id: 's1', hostname: 'SPINE-A01', subLayer: 'spine' }),
      makeDevice({ id: 's2', hostname: 'SPINE-B01', subLayer: 'spine' }),
      makeDevice({ id: 'l1', hostname: 'LEAF-A01', subLayer: 'leaf' }),
      makeDevice({ id: 'l2', hostname: 'LEAF-B01', subLayer: 'leaf' }),
    ]
    const cabling: CableLink[] = [{
      id: 'c1', fromLayer: 'spine', toLayer: 'leaf',
      fromDevice: '2x spine', toDevice: '2x leaf',
      cableType: 'DAC', speed: '100G', lengthM: 3,
      quantity: 4, pricePerUnit: 80, totalPrice: 320,
    }]
    const runs = buildCableSchedule(devices, cabling)
    expect(runs).toHaveLength(4)
  })

  it('returns empty array when no cabling data', () => {
    const runs = buildCableSchedule([], [])
    expect(runs).toHaveLength(0)
  })
})

// ── AQ2: the schedule is the real cable plan, not a full mesh ──────────────
describe('cable schedule matches the billed plan and the configs (AQ2)', () => {
  const design = (vendor: string, useCase: 'dc' | 'campus' | 'gpu') => {
    const devices = buildDeviceList({ useCase, scale: 'medium', siteCode: 'AQ2', vendorPrefs: [vendor], totalEndpoints: 512 })
    const cabling = buildCabling(devices, {} as never)
    return { devices, cabling, runs: buildCableSchedule(devices, cabling, useCase) }
  }

  it.each([['Cisco', 'dc'], ['Juniper', 'dc'], ['Arista', 'campus'], ['NVIDIA', 'gpu']] as const)('%s %s: one run per billed cable', (vendor, uc) => {
    const { cabling, runs } = design(vendor, uc)
    expect(runs.length).toBe(cabling.reduce((s, c) => s + c.quantity, 0))
  })

  it('lands on the same interfaces as the NetBox DCIM export', () => {
    const { devices, cabling, runs } = design('Cisco', 'dc')
    const dcim = expandCablePlan(devices, cabling, 'dc')
    expect(runs.map(r => `${r.from}:${r.fromPort}|${r.to}:${r.toPort}`)).toEqual(dcim.map(c => `${c.a.device}:${c.a.iface}|${c.b.device}:${c.b.iface}`))
  })

  it('names real interfaces — no placeholder "uplink"/"downlink" ports — and every fabric end is configured', () => {
    const { devices, runs } = design('Arista', 'dc')
    const byHost = new Map(devices.map(d => [d.hostname, d]))
    for (const r of runs) expect(`${r.fromPort} ${r.toPort}`).not.toMatch(/uplink|downlink/)
    const fabric = runs.filter(r => byHost.get(r.from)?.subLayer === 'spine' && byHost.get(r.to)?.subLayer === 'leaf')
    expect(fabric.length).toBeGreaterThan(0)
    for (const r of fabric) expect(r.fromConfigured && r.toConfigured, `${r.from}:${r.fromPort} ↔ ${r.to}:${r.toPort}`).toBe(true)
  })

  it('every run names the rack each end sits in', () => {
    const { runs } = design('Cisco', 'dc')
    for (const r of runs) {
      expect(r.fromRack, `${r.from} has no rack`).toBeTruthy()
      expect(r.toRack, `${r.to} has no rack`).toBeTruthy()
    }
  })
})

// ── AQ3: dual redundancy splits HA pairs across racks ───────────────────────
describe('rack layout follows the redundancy selection (AQ3)', () => {
  const SPLIT = ['firewall', 'wan-edge', 'core', 'spine', 'distribution']
  const layout = (vendor: string, useCase: 'dc' | 'campus' | 'gpu' | 'wan', redundancy: 'single' | 'dual') => {
    const devices = buildDeviceList({ useCase, scale: 'medium', siteCode: 'AQ3', vendorPrefs: [vendor], totalEndpoints: 512 })
    return { devices, racks: computeRackLayout(devices, { redundancy }) }
  }
  const rackOf = (racks: ReturnType<typeof computeRackLayout>) =>
    new Map(racks.flatMap(r => r.slots.map(s => [s.device.id, r.rackId] as const)))

  it.each([['Cisco', 'dc'], ['Juniper', 'campus'], ['NVIDIA', 'gpu'], ['Cisco', 'wan']] as const)(
    '%s %s dual: no rack holds both members of an HA pair', (vendor, uc) => {
      const { devices, racks } = layout(vendor, uc, 'dual')
      const where = rackOf(racks)
      let pairs = 0
      for (const tier of SPLIT) {
        const t = devices.filter(d => d.subLayer === tier)
        for (let i = 0; i + 1 < t.length; i += 2) {
          pairs++
          expect(where.get(t[i].id), `${t[i].hostname} and ${t[i + 1].hostname} share a rack`).not.toBe(where.get(t[i + 1].id))
        }
      }
      expect(pairs).toBeGreaterThan(0)
      for (const r of racks) expect(r.side, `${r.label} has no fault domain`).toMatch(/^[AB]$/)
    })

  it('dual keeps each leaf pair together — it is the top-of-rack pair for that rack', () => {
    const { devices, racks } = layout('Arista', 'dc', 'dual')
    const where = rackOf(racks)
    const leaves = devices.filter(d => d.subLayer === 'leaf')
    for (let i = 0; i + 1 < leaves.length; i += 2) expect(where.get(leaves[i].id)).toBe(where.get(leaves[i + 1].id))
  })

  it('the selection changes the layout: single packs pair members into one rack, dual never does', () => {
    const single = layout('Cisco', 'dc', 'single')
    const fw = single.devices.filter(d => d.subLayer === 'firewall')
    expect(fw.length).toBe(2)
    expect(rackOf(single.racks).get(fw[0].id)).toBe(rackOf(single.racks).get(fw[1].id))
    const dual = layout('Cisco', 'dc', 'dual')
    expect(rackOf(dual.racks).get(fw[0].id)).not.toBe(rackOf(dual.racks).get(fw[1].id))
    expect(faultDomain(fw[0], dual.devices)).not.toBe(faultDomain(fw[1], dual.devices))
  })

  it('dual still respects the unit and power budgets and places every device once', () => {
    const { devices, racks } = layout('Cisco', 'dc', 'dual')
    const placed = racks.flatMap(r => r.slots.map(s => s.device.id))
    expect(new Set(placed).size).toBe(placed.length)
    expect(placed.length).toBe(devices.filter(d => !d.subLayer.startsWith('cloud-')).length)
    for (const r of racks) {
      expect(r.usedU).toBeLessThanOrEqual(r.totalU)
      expect(r.totalPowerW).toBeLessThanOrEqual(RACK_POWER_BUDGET_W)
    }
  })

  it('Step 2 redundancy model wins over Step 1 when set', () => {
    expect(rackRedundancy('single', 'ha')).toBe('dual')
    expect(rackRedundancy('dual', 'none')).toBe('single')
    expect(rackRedundancy('dual', undefined)).toBe('dual')
    expect(rackRedundancy(undefined, undefined)).toBe('single')
  })
})

describe('rack units come from the SKU datasheet (AQ5)', () => {
  const heightOf = (devices: BOMDevice[], model: string) => {
    const racks = computeRackLayout(devices)
    const slot = racks.flatMap(r => r.slots).find(sl => sl.device.model === model)
    return slot?.heightU
  }

  it('draws each model at its datasheet height, not the role guess', () => {
    const nv = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'AQ5', vendorPrefs: ['NVIDIA'], totalEndpoints: 512 })
    expect(heightOf(nv, 'NVIDIA Spectrum SN4600C')).toBe(2)   // a 2U leaf, the role default said 1
    const cisco = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'AQ5', vendorPrefs: ['Cisco'], totalEndpoints: 512 })
    const spine = cisco.find(d => d.subLayer === 'spine')!
    expect(spine.rackUnits).toBe(1)                           // Nexus 9336C-FX2 is 1RU, the role default said 2
    expect(heightOf(cisco, spine.model)).toBe(1)
  })

  it('a 3U firewall occupies three units', () => {
    const fw = makeDevice({ id: 'pa', hostname: 'FW-A01', subLayer: 'firewall', model: 'PA-5260', rackUnits: 3 })
    const [rack] = computeRackLayout([fw])
    expect(rack.slots[0].heightU).toBe(3)
    expect(rack.usedU).toBe(3)
  })

  it('TCO footprint equals the units the rack elevation occupies', () => {
    for (const vendor of ['Cisco', 'NVIDIA', 'Arista', 'Juniper']) {
      for (const useCase of ['dc', 'gpu', 'campus'] as const) {
        const devices = buildDeviceList({ useCase, scale: 'medium', siteCode: 'AQ5', vendorPrefs: [vendor], totalEndpoints: 512 })
        const racks = computeRackLayout(devices)
        const placed = racks.reduce((s, r) => s + r.usedU, 0)
        expect(computeTCO(devices).totalRackUnits, `${vendor} ${useCase}`).toBe(placed)
      }
    }
  })

  it('names the models drawn at an assumed height', () => {
    const arista = buildDeviceList({ useCase: 'dc', scale: 'large', siteCode: 'AQ5', vendorPrefs: ['Arista'], totalEndpoints: 2048 })
    const chassis = arista.filter(d => d.rackUnitsNote)
    expect(chassis.length).toBeGreaterThan(0)                 // the 7800R3 spine is a chassis family
    const notes = assumedHeights(arista)
    expect(notes.map(n => n.model).sort()).toEqual([...new Set(chassis.map(d => d.model))].sort())
    for (const n of notes) expect(n.note.length).toBeGreaterThan(10)
    // a datasheet height is never listed as assumed
    const cisco = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'AQ5', vendorPrefs: ['Cisco'], totalEndpoints: 512 })
    expect(assumedHeights(cisco)).toEqual([])
  })

  it('the PTP grandmaster is racked, the radio is not', () => {
    expect(deviceRackUnits({ subLayer: 'oran-timing' })).toBe(1)
    expect(deviceRackUnits({ subLayer: 'oran-ru' })).toBe(0)
  })
})
