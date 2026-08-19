import { describe, it, expect } from 'vitest'
import {
  generateAwsTerraform, generateAzureTerraform, generateGcpTerraform,
  buildCloudTerraform, cloudTerraformFilename,
} from '@/lib/cloud-terraform'

// Golden fingerprints captured from backend/export/terraform.py rendering the
// same context. The full byte-for-byte comparison lives in the backend suite
// (test_cloud_terraform_parity.py) where both engines can actually be run;
// these assert the shape and the substitutions the frontend is responsible for.
const OPTS = {
  orgName: 'Acme Corp', env: 'prod',
  orgCidr: '10.0.0.0/8', hubCidr: '10.254.0.0/16', bgpAsn: 65001,
}

describe('cloud Terraform generation (AA2)', () => {
  it('AWS emits a Transit Gateway hub with the design ASN and CIDRs', () => {
    const tf = generateAwsTerraform(OPTS)
    expect(tf).toContain('hashicorp/aws')
    expect(tf).toMatch(/customer_asn = 65001/)
    expect(tf).toMatch(/amazon_asn   = 64512/)      // AWS-side default
    expect(tf).toContain('10.254.0.0/16')
    expect(tf).toContain('acme-corp-tgw')
    expect(tf).not.toMatch(/\{\{|\}\}/)              // no unrendered Jinja
  })

  it('Azure emits a Virtual WAN hub and defaults ExpressRoute ASN to the design ASN', () => {
    const tf = generateAzureTerraform(OPTS)
    expect(tf).toContain('hashicorp/azurerm')
    expect(tf).toContain('acme-corp-vwan')
    expect(tf).toContain('acme-corp-network-rg')
    expect(tf).toMatch(/er_asn *= *65001/)
    // …but an explicit erAsn wins
    expect(generateAzureTerraform({ ...OPTS, erAsn: 65515 })).toMatch(/er_asn *= *65515/)
  })

  it('GCP emits a Network Connectivity Center hub with a derived project', () => {
    const tf = generateGcpTerraform(OPTS)
    expect(tf).toContain('hashicorp/google')
    expect(tf).toContain('acme-corp-ncc')
    expect(tf).toContain('acme-corp-network')
    expect(tf).toMatch(/cloud_router_asn *= *65001/)
  })

  it('the Jinja tojson spacing is reproduced exactly (["a", "b", "c"])', () => {
    // JSON.stringify would emit ["a","b","c"] and silently diverge from the
    // backend's rendering of the same template.
    const tf = generateAwsTerraform({ ...OPTS, availabilityZones: ['a', 'b', 'c'] })
    expect(tf).toContain('["a", "b", "c"]')
    expect(tf).not.toContain('["a","b","c"]')
  })

  it('every stack ends with a trailing newline, as Jinja renders it', () => {
    for (const tf of [generateAwsTerraform(OPTS), generateAzureTerraform(OPTS), generateGcpTerraform(OPTS)]) {
      expect(tf.endsWith('}\n')).toBe(true)
      expect(tf.startsWith('\n#')).toBe(true)
    }
  })

  it('multicloud emits all three providers; other use cases only what was selected', () => {
    expect(Object.keys(buildCloudTerraform('multicloud', [], OPTS)).sort())
      .toEqual(['aws', 'azure', 'gcp'])
    expect(Object.keys(buildCloudTerraform('aviatrix', ['aws'], OPTS))).toEqual(['aws'])
    expect(Object.keys(buildCloudTerraform('dc', [], OPTS))).toEqual([])
    // provider names are matched case-insensitively — the store holds 'AWS'
    expect(Object.keys(buildCloudTerraform('aviatrix', ['AWS', 'GCP'], OPTS)).sort())
      .toEqual(['aws', 'gcp'])
  })

  it('defaults produce valid output with no options at all', () => {
    for (const tf of Object.values(buildCloudTerraform('multicloud'))) {
      expect(tf.length).toBeGreaterThan(1000)
      expect(tf).not.toMatch(/undefined|NaN|\[object/)
    }
  })

  it('filenames are provider-scoped', () => {
    expect(cloudTerraformFilename('aws')).toBe('aws-hub.tf')
  })
})
