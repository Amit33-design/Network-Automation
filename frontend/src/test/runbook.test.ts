import { describe, it, expect } from 'vitest'
import { buildDeviceList, buildBOM, validateBOM } from '@/lib/bom'
import { generateAllConfigs } from '@/lib/configgen'
import { validateConfigs } from '@/lib/config-validator'
import { buildRunbook, configFingerprint, runbookFilename } from '@/lib/runbook'
import type { BOMDevice } from '@/types'

const NOW = new Date('2026-03-04T09:15:00Z')
const dcDesign = () => {
  const devices = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'IAD', totalEndpoints: 200 })
  return { devices, configs: generateAllConfigs(devices, 'dc') }
}

describe('deployment runbook (AB8)', () => {
  it('the device table carries real roles and platforms, not em-dashes', () => {
    // The backend generator receives only {hostname: config}, so its table is
    // `| host | — | — |`. The browser has the BOM.
    const { devices, configs } = dcDesign()
    const md = buildRunbook({ devices, configs, siteCode: 'IAD', useCase: 'dc', now: NOW })
    const leaf = devices.find(d => d.subLayer === 'leaf')!
    expect(md).toContain(leaf.hostname)
    expect(md).toContain(leaf.model)
    expect(md).toContain(leaf.vendor)
    expect(md).toMatch(/\| leaf \|/)
    expect(md).not.toMatch(/\| — \| — \|/)
  })

  it('deployment order follows the tiers actually present, with a reason each', () => {
    const { devices } = dcDesign()
    const md = buildRunbook({ devices, siteCode: 'IAD', useCase: 'dc', now: NOW })
    const order = md.slice(md.indexOf('## 4. Deployment order'), md.indexOf('## 5.'))
    // firewalls before spines before leaves
    const at = (t: string) => order.indexOf(`**${t}**`)
    expect(at('spine')).toBeGreaterThan(-1)
    expect(at('leaf')).toBeGreaterThan(at('spine'))
    // …and pairs are called out, not just listed
    expect(order).toMatch(/vPC\/MLAG pairs/)
    // a campus design lists campus tiers instead
    const campus = buildDeviceList({ useCase: 'campus', scale: 'small', siteCode: 'SJC', totalEndpoints: 300 })
    const cmd = buildRunbook({ devices: campus, useCase: 'campus', now: NOW })
    expect(cmd).toMatch(/\*\*access\*\*/)
    expect(cmd).not.toMatch(/\*\*spine\*\*/)
  })

  it('blocking findings stop the runbook; a clean design says so', () => {
    const { devices, configs } = dcDesign()
    const clean = buildRunbook({ devices, configs, bomIssues: [], now: NOW })
    expect(clean).toContain('No blocking findings')

    const blocked = buildRunbook({
      devices, configs, now: NOW,
      bomIssues: [{ severity: 'error', category: 'fan-out', message: 'spine ports exhausted' }],
    })
    expect(blocked).toContain('**STOP.**')
    expect(blocked).toContain('spine ports exhausted')
  })

  it('surfaces real validator output rather than a generic checklist', () => {
    const { devices, configs } = dcDesign()
    const md = buildRunbook({
      devices, configs, now: NOW,
      bomIssues: validateBOM(devices, { useCase: 'dc', totalEndpoints: 200 }),
      validation: validateConfigs({ configs, devices, useCase: 'dc' }),
    })
    expect(md).toContain('1. Pre-flight')
    // any warn/fail is reported with its check id (V-xx)
    const v = validateConfigs({ configs, devices, useCase: 'dc' })
    for (const c of v.checks.filter(x => x.severity === 'fail' || x.severity === 'warn')) {
      expect(md, `${c.id} not reported`).toContain(c.id)
    }
  })

  it('backup and rollback come from the same strategies the advisor uses', () => {
    const { devices, configs } = dcDesign()
    const md = buildRunbook({ devices, configs, now: NOW, siteCode: 'IAD' })
    // NX-OS leaf/spine → checkpoint + rollback, stamped with one timestamp
    expect(md).toMatch(/checkpoint pre-deploy-20260304-\d{6}/)
    expect(md).toMatch(/rollback running-config checkpoint pre-deploy-/)
    // the same tag appears in the header, the backup step and the rollback step
    const tags = [...md.matchAll(/pre-deploy-(\d{8}-\d{6})/g)].map(m => m[1])
    expect(new Set(tags).size, 'checkpoint tag differs between sections').toBe(1)
  })

  it('config fingerprints are stable and distinguish different configs', () => {
    expect(configFingerprint('hostname A')).toBe(configFingerprint('hostname A'))
    expect(configFingerprint('hostname A')).not.toBe(configFingerprint('hostname B'))
    expect(configFingerprint('x')).toHaveLength(12)
  })

  it('is deterministic for a fixed clock', () => {
    const { devices, configs } = dcDesign()
    const a = buildRunbook({ devices, configs, now: NOW })
    const b = buildRunbook({ devices, configs, now: NOW })
    expect(a).toBe(b)
  })

  it('non-deployable tiers are excluded from scope', () => {
    const gpu = buildDeviceList({
      useCase: 'gpu', scale: 'small', siteCode: 'G',
      totalEndpoints: 128, bandwidthPerServer: '400G', oversubscription: 1,
    })
    const md = buildRunbook({ devices: gpu, useCase: 'gpu', now: NOW })
    const servers = gpu.filter(d => d.subLayer === 'gpu-compute')
    expect(servers.length).toBeGreaterThan(0)
    expect(md).not.toContain(servers[0].hostname)
    expect(md).toMatch(/Devices in scope \| \d+/)
  })

  it('every use case produces a runbook with no undefined leaking', () => {
    for (const useCase of ['campus', 'dc', 'gpu', 'wan', 'multisite', 'oran'] as const) {
      const { devices } = buildBOM({ useCase, scale: 'small', siteCode: 'X', totalEndpoints: 400, numSites: 3 })
      const md = buildRunbook({ devices, useCase, now: NOW })
      expect(md, useCase).not.toContain('undefined')
      expect(md, useCase).toContain('# Deployment Runbook')
    }
  })

  it('handles an empty design without throwing', () => {
    const md = buildRunbook({ devices: [] as BOMDevice[], now: NOW })
    expect(md).toContain('Devices in scope | 0')
    expect(md).toContain('_None._')
  })

  it('filenames are slugged', () => {
    expect(runbookFilename('IAD')).toBe('IAD-deployment-runbook.md')
  })
})
