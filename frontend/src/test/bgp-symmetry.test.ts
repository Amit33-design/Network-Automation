import { describe, it, expect } from 'vitest'
import { buildDeviceList } from '@/lib/bom'
import { generateAllConfigs } from '@/lib/configgen'
import { stripComments } from '@/lib/config-text'

type Sess = { ip: string; ras: string }
/** Local ASN, owned addresses and BGP sessions of one device, per dialect. */
function parse(cfg: string, vendor: string) {
  const c = stripComments(cfg)
  const ips = new Set<string>()
  for (const m of c.matchAll(/(?:ip address|ipaddress|address|family inet address)\s+(\d+\.\d+\.\d+\.\d+)/g)) ips.add(m[1])
  let asn = c.match(/^router bgp (\d+)/m)?.[1] ?? c.match(/autonomous-system (\d+)/)?.[1] ?? c.match(/configure bgp AS-number (\d+)/)?.[1] ?? ''
  const sess: Sess[] = []
  if (vendor === 'Juniper') {
    // group-level peer-as, neighbor-level override
    const groupAs: Record<string, string> = {}
    for (const m of c.matchAll(/set protocols bgp group (\S+) peer-as (\d+)/g)) groupAs[m[1]] = m[2]
    for (const m of c.matchAll(/set protocols bgp group (\S+) neighbor (\d+\.\d+\.\d+\.\d+)(?: peer-as (\d+))?/g)) sess.push({ ip: m[2], ras: m[3] ?? groupAs[m[1]] ?? '?' })
  } else if (vendor === 'Cisco') {
    // NX-OS: template peer X / remote-as ; neighbor ip / inherit peer X / remote-as
    const tpl: Record<string, string> = {}
    for (const m of c.matchAll(/template peer (\S+)\n((?:[ \t]+.*\n)*)/g)) { const r = m[2].match(/remote-as (\d+)/); if (r) tpl[m[1]] = r[1] }
    for (const m of c.matchAll(/^\s+neighbor (\d+\.\d+\.\d+\.\d+)\n((?:[ \t]{4,}.*\n)*)/gm)) {
      const own = m[2].match(/remote-as (\d+)/)?.[1]; const inh = m[2].match(/inherit peer (\S+)/)?.[1]
      sess.push({ ip: m[1], ras: own ?? (inh ? tpl[inh] : undefined) ?? '?' })
    }
  } else {
    const groupAs: Record<string, string> = {}
    for (const m of c.matchAll(/neighbor ([A-Z][\w-]+) remote-as (\d+)/g)) groupAs[m[1]] = m[2]
    const seen = new Map<string, string>()
    // block form (OS10): `neighbor IP` then indented lines incl. remote-as
    for (const m of c.matchAll(/^\s*neighbor (\d+\.\d+\.\d+\.\d+)\n((?:[ \t]{3,}.*\n)*)/gm)) {
      const r = m[2].match(/remote-as (\d+)/)?.[1]; if (r) seen.set(m[1], r)
    }
    for (const m of c.matchAll(/neighbor (\d+\.\d+\.\d+\.\d+) remote-as (\d+)|create bgp neighbor (\d+\.\d+\.\d+\.\d+) remote-AS-number (\d+)/g)) {
      seen.set(m[1] ?? m[3], m[2] ?? m[4])
    }
    for (const m of c.matchAll(/neighbor (\d+\.\d+\.\d+\.\d+) peer group (\S+)/g)) if (!seen.has(m[1])) seen.set(m[1], groupAs[m[2]] ?? '?')
    for (const [ip, ras] of seen) sess.push({ ip, ras })
  }
  return { asn, ips, sess }
}

/**
 * AN4 — every configured BGP session must be real on BOTH ends: the peer
 * address belongs to a device, that device configures a session back to one
 * of our addresses, and each side's `remote-as` equals the other side's own
 * ASN. V-04 only checks the first. X1/Y1/Z8/AM5/AM6 each fixed a vendor whose
 * sessions could not form; this is the regression net that would have caught
 * them. Measured clean on all six vendors when written (2026-09-27).
 */
function problems(devs: ReturnType<typeof buildDeviceList>, cfgs: Record<string, string>, vendor: string) {
  const P = devs.filter(d => cfgs[d.id] && (d.subLayer === 'spine' || d.subLayer === 'leaf')).map(d => ({ d, ...parse(cfgs[d.id], vendor) }))
  const owner = new Map<string, typeof P[number]>()
  for (const p of P) for (const ip of p.ips) owner.set(ip, p)
  const bad: string[] = []
  let sessions = 0
  for (const p of P) for (const s of p.sess) {
    sessions++
    const t = owner.get(s.ip)
    if (!t) { bad.push(`${p.d.hostname} → ${s.ip}: owned by no device`); continue }
    if (s.ras !== t.asn) bad.push(`${p.d.hostname} → ${t.d.hostname}: remote-as ${s.ras}, peer is AS ${t.asn}`)
    const back = t.sess.find(x => p.ips.has(x.ip))
    if (!back) bad.push(`${t.d.hostname} has no session back to ${p.d.hostname}`)
    else if (back.ras !== p.asn) bad.push(`${t.d.hostname} → ${p.d.hostname}: remote-as ${back.ras}, peer is AS ${p.asn}`)
  }
  return { bad, sessions }
}

const VENDORS = ['Cisco', 'Arista', 'Juniper', 'Dell EMC', 'Extreme Networks', 'HPE Aruba']

describe('BGP sessions are symmetric with agreeing ASNs (AN4)', () => {
  for (const vendor of VENDORS) {
    it(`${vendor} DC fabric`, () => {
      const devs = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T', vendorPrefs: [vendor] })
      const { bad, sessions } = problems(devs, generateAllConfigs(devs, 'dc'), vendor)
      expect(sessions, 'guard: the parser found the sessions').toBeGreaterThan(40)
      expect(bad.slice(0, 5)).toEqual([])
    })
  }

  it('guard: a wrong remote-as on one side is caught', () => {
    const devs = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T', vendorPrefs: ['Arista'] })
    const cfgs = generateAllConfigs(devs, 'dc')
    const spine = devs.find(d => d.subLayer === 'spine')!
    cfgs[spine.id] = cfgs[spine.id].replace(/(neighbor \S+ remote-as )(\d+)/, (_m, a) => `${a}64999`)
    expect(problems(devs, cfgs, 'Arista').bad.length).toBeGreaterThan(0)
  })
})
