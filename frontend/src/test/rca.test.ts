import { describe, it, expect } from 'vitest'
import { analyzeRca, normalizeRcaResponse, type RcaDesignState } from '@/lib/rca'

const fabric: RcaDesignState = {
  useCase: 'dc',
  protocols: ['VXLAN', 'EVPN', 'isis'],
  devices: [
    { hostname: 'IAD-SPINE-01', role: 'spine' },
    { hostname: 'IAD-SPINE-02', role: 'spine' },
    { hostname: 'IAD-LEAF-01', role: 'leaf' },
    { hostname: 'IAD-LEAF-02', role: 'leaf' },
    { hostname: 'IAD-FW-01', role: 'firewall' },
  ],
}

describe('analyzeRca — hypothesis checkers', () => {
  it('flags BGP session loss on a BGP symptom', () => {
    const h = analyzeRca({ symptom: 'BGP neighbor down, prefixes dropped', affectedDevices: ['IAD-SPINE-01'], design: fabric })
    const bgp = h.find(x => x.rootCause === 'BGP Session Loss')
    expect(bgp).toBeTruthy()
    expect(bgp!.confidence).toBeGreaterThan(0.5)
    expect(bgp!.automationAvailable).toBe(true)
    expect(bgp!.automationPlaybook).toContain('bgp')
    expect(bgp!.remediationSteps.length).toBeGreaterThan(1)
  })

  it('flags PFC deadlock and boosts confidence for a GPU design', () => {
    const gpu: RcaDesignState = { ...fabric, useCase: 'gpu' }
    const h = analyzeRca({ symptom: 'PFC watchdog triggered, RoCE stall', affectedDevices: ['IAD-LEAF-01'], design: gpu })
    const pfc = h.find(x => x.rootCause === 'PFC Watchdog Deadlock')
    expect(pfc).toBeTruthy()
    expect(pfc!.evidence.some(e => /GPU\/RDMA/.test(e))).toBe(true)
    expect(pfc!.confidence).toBeGreaterThan(0.6)
  })

  it('flags EVPN/VXLAN overlay fault and credits the overlay protocol', () => {
    const h = analyzeRca({ symptom: 'VXLAN VNI not learning MAC across VTEPs', affectedDevices: ['IAD-LEAF-02'], design: fabric })
    const evpn = h.find(x => x.rootCause === 'EVPN/VXLAN Overlay Fault')
    expect(evpn).toBeTruthy()
    expect(evpn!.evidence.some(e => /EVPN\/VXLAN overlay/.test(e))).toBe(true)
    expect(evpn!.automationAvailable).toBe(false)
  })

  it('flags underlay/IGP failure and escalates for multiple spines', () => {
    const h = analyzeRca({
      symptom: 'OSPF adjacency flapping, interface CRC errors',
      affectedDevices: ['IAD-SPINE-01', 'IAD-SPINE-02'],
      design: fabric,
    })
    const under = h.find(x => x.rootCause === 'Underlay / IGP Failure')
    expect(under).toBeTruthy()
    expect(under!.evidence.some(e => /Multiple spine devices/.test(e))).toBe(true)
  })

  it('flags recent deployment change on a temporal symptom', () => {
    const h = analyzeRca({ symptom: 'issue started right after the maintenance window deploy', design: fabric })
    const dep = h.find(x => x.rootCause === 'Recent Deployment Change')
    expect(dep).toBeTruthy()
    expect(dep!.automationPlaybook).toContain('rollback')
  })
})

describe('analyzeRca — ranking, dedup, blast radius, fallback', () => {
  it('returns hypotheses ranked by descending confidence with sequential ranks', () => {
    const h = analyzeRca({ symptom: 'BGP peer down and OSPF interface flap', affectedDevices: ['IAD-SPINE-01'], design: fabric })
    expect(h.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < h.length; i++) {
      expect(h[i - 1].confidence).toBeGreaterThanOrEqual(h[i].confidence)
    }
    expect(h.map(x => x.rank)).toEqual(h.map((_, i) => i + 1))
  })

  it('computes a blast radius that expands from an affected leaf to its spines', () => {
    const h = analyzeRca({ symptom: 'BGP down', affectedDevices: ['IAD-LEAF-01'], design: fabric })
    const bgp = h.find(x => x.rootCause === 'BGP Session Loss')!
    expect(bgp.blastRadius).toContain('IAD-LEAF-01')
    // leaf -> spines (adjacency) within 2 hops
    expect(bgp.blastRadius).toContain('IAD-SPINE-01')
    expect(bgp.blastRadius).toContain('IAD-SPINE-02')
  })

  it('confidence never exceeds 1', () => {
    const gpu: RcaDesignState = { ...fabric, useCase: 'gpu' }
    const h = analyzeRca({ symptom: 'pfc rdma roce deadlock watchdog gpu', affectedDevices: ['IAD-LEAF-01'], design: gpu })
    for (const x of h) expect(x.confidence).toBeLessThanOrEqual(1)
  })

  it('returns a generic fallback when nothing matches (never empty)', () => {
    const h = analyzeRca({ symptom: 'the printer is jammed', design: fabric })
    expect(h.length).toBe(1)
    expect(h[0].rootCause).toBe('Undetermined Root Cause')
    expect(h[0].remediationSteps.length).toBeGreaterThan(0)
  })

  it('handles no design/devices gracefully (empty blast radius)', () => {
    const h = analyzeRca({ symptom: 'bgp session down' })
    expect(h.length).toBeGreaterThan(0)
    expect(h[0].blastRadius).toEqual([])
  })
})

describe('normalizeRcaResponse', () => {
  it('maps the real engine (snake_case) rich shape', () => {
    const raw = [{
      root_cause: 'BGP Session Loss',
      confidence: 0.82,
      evidence: ['peer down'],
      blast_radius: ['A', 'B'],
      remediation_steps: ['step 1', 'step 2'],
      automation_available: true,
      automation_playbook: 'playbooks/rca/bgp_session_restore.yml',
    }]
    const [h] = normalizeRcaResponse(raw)
    expect(h.rootCause).toBe('BGP Session Loss')
    expect(h.confidence).toBe(0.82)
    expect(h.blastRadius).toEqual(['A', 'B'])
    expect(h.remediationSteps).toEqual(['step 1', 'step 2'])
    expect(h.automationAvailable).toBe(true)
    expect(h.automationPlaybook).toContain('bgp')
  })

  it('maps the legacy stub shape (cause + single remediation string) and assigns ranks by confidence', () => {
    const raw = [
      { rank: 2, cause: 'Low conf', confidence: 0.3, evidence: [], remediation: 'do X' },
      { rank: 1, cause: 'High conf', confidence: 0.9, evidence: ['e'], remediation: 'do Y' },
    ]
    const out = normalizeRcaResponse(raw)
    // stub provides explicit ranks -> preserved
    expect(out.find(h => h.rootCause === 'High conf')!.rank).toBe(1)
    expect(out.find(h => h.rootCause === 'Low conf')!.remediationSteps).toEqual(['do X'])
    expect(out.find(h => h.rootCause === 'Low conf')!.automationAvailable).toBe(false)
  })

  it('assigns ranks by descending confidence when the backend omits ranks', () => {
    const raw = [
      { root_cause: 'B', confidence: 0.4, remediation_steps: [] },
      { root_cause: 'A', confidence: 0.7, remediation_steps: [] },
    ]
    const out = normalizeRcaResponse(raw)
    expect(out[0].rootCause).toBe('A')
    expect(out[0].rank).toBe(1)
    expect(out[1].rank).toBe(2)
  })

  it('returns [] for a non-array payload', () => {
    expect(normalizeRcaResponse(null)).toEqual([])
    expect(normalizeRcaResponse({ detail: 'error' })).toEqual([])
  })
})
