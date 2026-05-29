'use strict';

/* ════════════════════════════════════════════════════════════════
   MULTICLOUD.JS — Enterprise / GPU → Multicloud design support
   Supports: AWS Direct Connect, Azure ExpressRoute, GCP Cloud Interconnect
   DC topology: DC-EAST (IAD, 10.10.0.0/16) + DC-WEST (SEA, 10.20.0.0/16)
   Colo hubs:   Equinix Fabric / Megaport MCR — IAD (AS 65010), SEA (AS 65011)
   Enterprise BGP AS: 65000
════════════════════════════════════════════════════════════════ */

/* ── Reference data ────────────────────────────────────────────── */
var MC_CLOUD_ASN = {
  aws:   { provider_as: 64512, customer_as: 65020 },
  azure: { provider_as: 12076, customer_as: 65021 },
  gcp:   { provider_as: 16550, customer_as: 65022 },
};

var MC_REGIONS = {
  aws: {
    'us-east-1': { site: 'IAD', cidr: '10.128.0.0/14', hub_cidr: '10.128.0.0/23', az_suffix: 'use1' },
    'us-west-2': { site: 'SEA', cidr: '10.132.0.0/14', hub_cidr: '10.132.0.0/23', az_suffix: 'usw2' },
  },
  azure: {
    'eastus':  { site: 'IAD', cidr: '10.192.0.0/14', hub_cidr: '10.192.0.0/23', az_suffix: 'eus'  },
    'westus2': { site: 'SEA', cidr: '10.196.0.0/14', hub_cidr: '10.196.0.0/23', az_suffix: 'wus2' },
  },
  gcp: {
    'us-east4': { site: 'IAD', cidr: '10.224.0.0/14', hub_cidr: '10.224.0.0/23', az_suffix: 'use4' },
    'us-west1': { site: 'SEA', cidr: '10.228.0.0/14', hub_cidr: '10.228.0.0/23', az_suffix: 'usw1' },
  },
};

var MC_CIRCUIT_TYPE = {
  aws:   'AWS Direct Connect (DX VIF + BGP/BFD)',
  azure: 'Azure ExpressRoute (ER peering)',
  gcp:   'GCP Cloud Interconnect (VLAN attach)',
};

var MC_DC_SITES = {
  'DC-EAST': { location: 'IAD', mgmt_super: '10.10.0.0/16',  loopback_base: '10.10.255.' },
  'DC-WEST': { location: 'SEA', mgmt_super: '10.20.0.0/16',  loopback_base: '10.20.255.' },
};

/* ── Helper: get selected clouds from state ─────────────────────── */
function _mcClouds(state) {
  return (state && state.mcClouds && state.mcClouds.length) ? state.mcClouds : ['aws', 'azure', 'gcp'];
}

function _mcDualDC(state) {
  return (state && state.mcDualDC !== undefined) ? state.mcDualDC : true;
}

function _mcSites(state) {
  var sites = ['DC-EAST'];
  if (_mcDualDC(state)) sites.push('DC-WEST');
  return sites;
}

function _orgName(state) {
  return (state && state.orgName) ? state.orgName : 'Acme Corp';
}

function _enterpriseAsn(state) {
  return (state && state.mcEnterpriseAsn) ? state.mcEnterpriseAsn : 65000;
}

function _coloProvider(state) {
  return (state && state.mcColoProvider) ? state.mcColoProvider : 'equinix';
}

function _dcEdgeVendor(state) {
  return (state && state.mcDCEdgeVendor) ? state.mcDCEdgeVendor : 'iosxr';
}

function _mcRegions(state, cloud) {
  var key = 'mc' + cloud.charAt(0).toUpperCase() + cloud.slice(1) + 'Regions';
  var fallbacks = { aws: ['us-east-1'], azure: ['eastus'], gcp: ['us-east4'] };
  return (state && state[key] && state[key].length) ? state[key] : fallbacks[cloud];
}

/* ════════════════════════════════════════════════════════════════
   IP PLAN
════════════════════════════════════════════════════════════════ */
window.multicloudIPPlan = function(state) {
  var rows = [];
  var clouds = _mcClouds(state);
  var sites  = _mcSites(state);
  var entAsn = _enterpriseAsn(state);

  // Enterprise super-summary
  rows.push({
    zone:         'Enterprise',
    cidr:         (state && state.mcOrgCidr) ? state.mcOrgCidr : '10.0.0.0/9',
    purpose:      'Enterprise org super-summary (all DC + cloud)',
    asn:          entAsn,
    circuit_type: 'Internal',
  });

  // DC sites
  sites.forEach(function(site) {
    var info = MC_DC_SITES[site];
    rows.push({
      zone:         site,
      cidr:         info.mgmt_super,
      purpose:      site + ' (' + info.location + ') — DC management + server subnets',
      asn:          entAsn,
      circuit_type: 'Internal',
    });
  });

  // Colo hubs
  var coloProvider = _coloProvider(state);
  var coloLabel = coloProvider === 'equinix' ? 'Equinix Fabric' : 'Megaport MCR';
  rows.push({
    zone:         'Colo-Hub-IAD',
    cidr:         '100.64.10.0/24',
    purpose:      coloLabel + ' IAD — interconnect fabric (AS 65010)',
    asn:          65010,
    circuit_type: 'Colo fabric',
  });
  if (_mcDualDC(state)) {
    rows.push({
      zone:         'Colo-Hub-SEA',
      cidr:         '100.64.20.0/24',
      purpose:      coloLabel + ' SEA — interconnect fabric (AS 65011)',
      asn:          65011,
      circuit_type: 'Colo fabric',
    });
  }

  // Cloud regions
  clouds.forEach(function(cloud) {
    var regions = _mcRegions(state, cloud);
    var asns    = MC_CLOUD_ASN[cloud];
    regions.forEach(function(region) {
      var rInfo = (MC_REGIONS[cloud] || {})[region];
      if (!rInfo) return;
      rows.push({
        zone:         cloud.toUpperCase() + '-' + region.toUpperCase(),
        cidr:         rInfo.cidr,
        purpose:      cloud.toUpperCase() + ' ' + region + ' — workload VPCs/VNets',
        asn:          asns.customer_as,
        circuit_type: MC_CIRCUIT_TYPE[cloud],
      });
      rows.push({
        zone:         cloud.toUpperCase() + '-' + region.toUpperCase() + '-HUB',
        cidr:         rInfo.hub_cidr,
        purpose:      cloud.toUpperCase() + ' ' + region + ' — transit/inspection hub subnet',
        asn:          asns.provider_as,
        circuit_type: MC_CIRCUIT_TYPE[cloud],
      });
    });
  });

  return rows;
};

/* ════════════════════════════════════════════════════════════════
   BGP PEERS
════════════════════════════════════════════════════════════════ */
window.multicloudBGPPeers = function(state) {
  var peers   = [];
  var clouds  = _mcClouds(state);
  var sites   = _mcSites(state);
  var entAsn  = _enterpriseAsn(state);

  // Peer IPs indexed by [site][cloud][idx]
  var peerIPs = {
    'DC-EAST': {
      aws:   ['169.254.10.1', '169.254.10.5'],
      azure: ['172.16.10.1',  '172.16.10.5'],
      gcp:   ['169.254.20.1', '169.254.20.5'],
    },
    'DC-WEST': {
      aws:   ['169.254.11.1', '169.254.11.5'],
      azure: ['172.16.11.1',  '172.16.11.5'],
      gcp:   ['169.254.21.1', '169.254.21.5'],
    },
  };

  sites.forEach(function(site) {
    clouds.forEach(function(cloud) {
      var asns      = MC_CLOUD_ASN[cloud];
      var cloudIPs  = (peerIPs[site] || {})[cloud] || ['169.254.0.1'];
      var circuitLabel = {
        aws:   'DX VIF BGP/BFD',
        azure: 'ER peering',
        gcp:   'VLAN attach',
      }[cloud];

      cloudIPs.forEach(function(peerIP, i) {
        var suffix = i === 0 ? 'primary' : 'backup';
        peers.push({
          device:      site + '-EDGE-01',
          local_as:    entAsn,
          peer_ip:     peerIP,
          peer_as:     asns.customer_as,
          description: cloud.toUpperCase() + ' ' + suffix + ' (' + site + ')',
          bfd:         true,
          policy_in:   'PERMIT-' + cloud.toUpperCase() + '-PREFIXES-IN',
          policy_out:  'PERMIT-DC-TO-' + cloud.toUpperCase() + '-OUT',
          circuit:     circuitLabel,
        });
      });
    });
  });

  return peers;
};

/* ════════════════════════════════════════════════════════════════
   TERRAFORM HCL GENERATORS
════════════════════════════════════════════════════════════════ */

/* ── AWS TGW Hub ────────────────────────────────────────────────── */
window.genAWSTerraform = function(state, region) {
  region = region || 'us-east-1';
  var rInfo  = (MC_REGIONS.aws || {})[region] || { cidr: '10.128.0.0/14', hub_cidr: '10.128.0.0/23', az_suffix: 'use1' };
  var org    = _orgName(state);
  var entAsn = _enterpriseAsn(state);
  var asns   = MC_CLOUD_ASN.aws;
  var suffix = rInfo.az_suffix;
  var stackName = 'aws-prod-' + suffix;
  var azList = region.startsWith('us-east') ? '["us-east-1a","us-east-1b"]' : '["us-west-2a","us-west-2b"]';

  return [
    '# ═══════════════════════════════════════════════════════════',
    '# Stack  : ' + stackName,
    '# Region : ' + region,
    '# Org    : ' + org,
    '# Generated by NetDesign AI — multicloud use case',
    '# ═══════════════════════════════════════════════════════════',
    '',
    'terraform {',
    '  required_version = ">= 1.6"',
    '  required_providers {',
    '    aws = {',
    '      source  = "hashicorp/aws"',
    '      version = "~> 5.0"',
    '    }',
    '  }',
    '  backend "s3" {',
    '    bucket         = "' + org.toLowerCase().replace(/\s+/g, '-') + '-tf-state"',
    '    key            = "network/' + stackName + '/terraform.tfstate"',
    '    region         = "' + region + '"',
    '    dynamodb_table = "tf-state-lock"',
    '    encrypt        = true',
    '  }',
    '}',
    '',
    'provider "aws" {',
    '  region = "' + region + '"',
    '  default_tags {',
    '    tags = {',
    '      ManagedBy   = "Terraform"',
    '      Environment = "prod"',
    '      Stack       = "' + stackName + '"',
    '      Org         = "' + org + '"',
    '    }',
    '  }',
    '}',
    '',
    'locals {',
    '  org_name    = "' + org.toLowerCase().replace(/\s+/g, '-') + '"',
    '  stack_name  = "' + stackName + '"',
    '  region      = "' + region + '"',
    '  region_code = "' + suffix + '"',
    '  env         = "prod"',
    '  cidr        = "' + rInfo.cidr + '"',
    '  hub_cidr    = "' + rInfo.hub_cidr + '"',
    '  amazon_asn  = ' + asns.provider_as,
    '  customer_asn = ' + asns.customer_as,
    '  azs         = ' + azList,
    '  dx_prefixes = ["' + rInfo.cidr + '"]',
    '}',
    '',
    '# ── Transit Gateway ─────────────────────────────────────────',
    'module "tgw" {',
    '  source  = "../../../../modules/aws-tgw-hub"',
    '  version = "~> 2.0"',
    '',
    '  org_name     = local.org_name',
    '  stack_name   = local.stack_name',
    '  region       = local.region',
    '  region_code  = local.region_code',
    '  env          = local.env',
    '  cidr         = local.cidr',
    '  hub_cidr     = local.hub_cidr',
    '  amazon_asn   = local.amazon_asn',
    '  customer_asn = local.customer_asn',
    '  azs          = local.azs',
    '  dx_prefixes  = local.dx_prefixes',
    '',
    '  # Route table attachment IDs (populated after attachment)',
    '  enable_inspection_vpc    = true',
    '  enable_shared_services   = true',
    '  inspection_vpc_cidr      = local.hub_cidr',
    '  gwlb_target_group_arn    = module.inspection.gwlb_target_group_arn',
    '}',
    '',
    '# ── Inspection VPC (PA VM-Series behind GWLB) ────────────────',
    'module "inspection" {',
    '  source = "../../../../modules/aws-inspection-vpc"',
    '',
    '  org_name   = local.org_name',
    '  vpc_cidr   = local.hub_cidr',
    '  region     = local.region',
    '  azs        = local.azs',
    '',
    '  # PA VM-Series AMI — set via SSM param',
    '  pa_ami_id  = data.aws_ssm_parameter.pa_ami.value',
    '  pa_version = "11.1"',
    '}',
    '',
    '# ── Direct Connect Gateway ───────────────────────────────────',
    'resource "aws_dx_gateway" "main" {',
    '  name            = "${local.org_name}-dxgw-${local.region_code}"',
    '  amazon_side_asn = local.amazon_asn',
    '}',
    '',
    'resource "aws_dx_gateway_association" "tgw" {',
    '  dx_gateway_id         = aws_dx_gateway.main.id',
    '  associated_gateway_id = module.tgw.tgw_id',
    '  allowed_prefixes      = local.dx_prefixes',
    '}',
    '',
    '# ── PA AMI lookup ────────────────────────────────────────────',
    'data "aws_ssm_parameter" "pa_ami" {',
    '  name = "/aws/service/marketplace/prod-pa-vm-series/11.1/ami-id"',
    '}',
    '',
    '# ── Outputs ──────────────────────────────────────────────────',
    'output "tgw_id" {',
    '  value       = module.tgw.tgw_id',
    '  description = "Transit Gateway ID"',
    '}',
    '',
    'output "dxgw_id" {',
    '  value       = aws_dx_gateway.main.id',
    '  description = "Direct Connect Gateway ID"',
    '}',
    '',
    'output "inspection_vpc_id" {',
    '  value       = module.inspection.vpc_id',
    '  description = "Inspection VPC ID"',
    '}',
  ].join('\n');
};

/* ── Azure vWAN Hub ─────────────────────────────────────────────── */
window.genAzureTerraform = function(state, region) {
  region = region || 'eastus';
  var rInfo  = (MC_REGIONS.azure || {})[region] || { cidr: '10.192.0.0/14', hub_cidr: '10.192.0.0/23', az_suffix: 'eus' };
  var org    = _orgName(state);
  var asns   = MC_CLOUD_ASN.azure;
  var suffix = rInfo.az_suffix;
  var stackName = 'azure-prod-' + suffix;
  var rgName  = org.toLowerCase().replace(/\s+/g, '-') + '-network-' + suffix;

  return [
    '# ═══════════════════════════════════════════════════════════',
    '# Stack  : ' + stackName,
    '# Region : ' + region,
    '# Org    : ' + org,
    '# Generated by NetDesign AI — multicloud use case',
    '# ═══════════════════════════════════════════════════════════',
    '',
    'terraform {',
    '  required_version = ">= 1.6"',
    '  required_providers {',
    '    azurerm = {',
    '      source  = "hashicorp/azurerm"',
    '      version = "~> 3.90"',
    '    }',
    '  }',
    '  backend "azurerm" {',
    '    resource_group_name  = "' + rgName + '-tfstate"',
    '    storage_account_name = "' + org.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0,20) + 'tfstate"',
    '    container_name       = "tfstate"',
    '    key                  = "network/' + stackName + '/terraform.tfstate"',
    '  }',
    '}',
    '',
    'provider "azurerm" {',
    '  features {}',
    '}',
    '',
    'locals {',
    '  org_name   = "' + org + '"',
    '  stack_name = "' + stackName + '"',
    '  location   = "' + region + '"',
    '  env        = "prod"',
    '  cidr       = "' + rInfo.cidr + '"',
    '  hub_cidr   = "' + rInfo.hub_cidr + '"',
    '  er_asn     = ' + asns.customer_as,
    '  rg_name    = "' + rgName + '"',
    '}',
    '',
    '# ── Resource Group ────────────────────────────────────────────',
    'resource "azurerm_resource_group" "network" {',
    '  name     = local.rg_name',
    '  location = local.location',
    '  tags = {',
    '    ManagedBy   = "Terraform"',
    '    Environment = local.env',
    '    Org         = local.org_name',
    '  }',
    '}',
    '',
    '# ── vWAN + vHub ───────────────────────────────────────────────',
    'module "vwan" {',
    '  source  = "../../../../modules/azure-vwan-hub"',
    '  version = "~> 2.0"',
    '',
    '  org_name          = local.org_name',
    '  resource_group_id = azurerm_resource_group.network.id',
    '  location          = local.location',
    '  env               = local.env',
    '  hub_cidr          = local.hub_cidr',
    '  er_asn            = local.er_asn',
    '',
    '  # Azure Firewall Premium — routing intent',
    '  enable_azure_firewall      = true',
    '  firewall_sku_tier          = "Premium"',
    '  enable_routing_intent      = true',
    '  routing_intent_destinations = ["Internet", "PrivateTraffic"]',
    '}',
    '',
    '# ── ExpressRoute Gateway ──────────────────────────────────────',
    'module "er_gateway" {',
    '  source = "../../../../modules/azure-er-gateway"',
    '',
    '  resource_group_id = azurerm_resource_group.network.id',
    '  location          = local.location',
    '  virtual_hub_id    = module.vwan.virtual_hub_id',
    '  er_sku            = "ErGw3AZ"',
    '}',
    '',
    '# ── Outputs ───────────────────────────────────────────────────',
    'output "vwan_id" {',
    '  value       = module.vwan.vwan_id',
    '  description = "Virtual WAN ID"',
    '}',
    '',
    'output "virtual_hub_id" {',
    '  value       = module.vwan.virtual_hub_id',
    '  description = "Virtual Hub ID"',
    '}',
    '',
    'output "er_gateway_id" {',
    '  value       = module.er_gateway.gateway_id',
    '  description = "ExpressRoute Gateway ID"',
    '}',
    '',
    'output "firewall_private_ip" {',
    '  value       = module.vwan.firewall_private_ip',
    '  description = "Azure Firewall Premium private IP"',
    '}',
  ].join('\n');
};

/* ── GCP NCC Hub ─────────────────────────────────────────────────── */
window.genGCPTerraform = function(state, region) {
  region = region || 'us-east4';
  var rInfo    = (MC_REGIONS.gcp || {})[region] || { cidr: '10.224.0.0/14', hub_cidr: '10.224.0.0/23', az_suffix: 'use4' };
  var org      = _orgName(state);
  var asns     = MC_CLOUD_ASN.gcp;
  var suffix   = rInfo.az_suffix;
  var stackName = 'gcp-prod-' + suffix;
  var projectId = org.toLowerCase().replace(/\s+/g, '-') + '-network-prod';

  return [
    '# ═══════════════════════════════════════════════════════════',
    '# Stack  : ' + stackName,
    '# Region : ' + region,
    '# Org    : ' + org,
    '# Generated by NetDesign AI — multicloud use case',
    '# ═══════════════════════════════════════════════════════════',
    '',
    'terraform {',
    '  required_version = ">= 1.6"',
    '  required_providers {',
    '    google = {',
    '      source  = "hashicorp/google"',
    '      version = "~> 5.0"',
    '    }',
    '  }',
    '  backend "gcs" {',
    '    bucket = "' + org.toLowerCase().replace(/\s+/g, '-') + '-tf-state"',
    '    prefix = "network/' + stackName + '"',
    '  }',
    '}',
    '',
    'provider "google" {',
    '  project = "' + projectId + '"',
    '  region  = "' + region + '"',
    '}',
    '',
    'locals {',
    '  org_name    = "' + org + '"',
    '  stack_name  = "' + stackName + '"',
    '  project     = "' + projectId + '"',
    '  region      = "' + region + '"',
    '  env         = "prod"',
    '  cidr        = "' + rInfo.cidr + '"',
    '  hub_cidr    = "' + rInfo.hub_cidr + '"',
    '  cloud_router_asn = ' + asns.customer_as,
    '}',
    '',
    '# ── NCC Hub + Host VPC ────────────────────────────────────────',
    'module "ncc" {',
    '  source  = "../../../../modules/gcp-ncc-hub"',
    '  version = "~> 2.0"',
    '',
    '  org_name         = local.org_name',
    '  project          = local.project',
    '  region           = local.region',
    '  env              = local.env',
    '  cidr             = local.cidr',
    '  hub_cidr         = local.hub_cidr',
    '  cloud_router_asn = local.cloud_router_asn',
    '',
    '  # Cloud NGFW',
    '  enable_cloud_ngfw      = true',
    '  ngfw_tier              = "STANDARD"',
    '  enable_cloud_nat        = true',
    '}',
    '',
    '# ── Cloud Interconnect VLAN attachments ──────────────────────',
    'module "interconnect" {',
    '  source = "../../../../modules/gcp-cloud-interconnect"',
    '',
    '  project    = local.project',
    '  region     = local.region',
    '  router_id  = module.ncc.cloud_router_id',
    '  vlan_cidr  = "169.254.20.0/29"',
    '  peer_asn   = 65000',
    '  bandwidth  = "BPS_10G"',
    '  redundancy = "REDUNDANT"',
    '}',
    '',
    '# ── Outputs ───────────────────────────────────────────────────',
    'output "ncc_hub_id" {',
    '  value       = module.ncc.hub_id',
    '  description = "NCC Hub ID"',
    '}',
    '',
    'output "cloud_router_id" {',
    '  value       = module.ncc.cloud_router_id',
    '  description = "Cloud Router ID"',
    '}',
    '',
    'output "interconnect_attachment_ids" {',
    '  value       = module.interconnect.attachment_ids',
    '  description = "Cloud Interconnect VLAN attachment IDs"',
    '}',
  ].join('\n');
};

/* ════════════════════════════════════════════════════════════════
   ANSIBLE VARS GENERATOR
════════════════════════════════════════════════════════════════ */
window.genAnsibleVars = function(state) {
  var clouds  = _mcClouds(state);
  var sites   = _mcSites(state);
  var entAsn  = _enterpriseAsn(state);
  var org     = _orgName(state);
  var lines   = [];

  lines.push('---');
  lines.push('# Ansible host_vars — dc-edge-bgp role');
  lines.push('# Org     : ' + org);
  lines.push('# Generated by NetDesign AI — multicloud use case');
  lines.push('');
  lines.push('bgp_local_as: ' + entAsn);
  lines.push('bgp_router_id: "{{ ansible_host }}"');
  lines.push('');
  lines.push('bgp_cloud_peers:');

  var peerIPs = {
    'DC-EAST': {
      aws:   ['169.254.10.1', '169.254.10.5'],
      azure: ['172.16.10.1',  '172.16.10.5'],
      gcp:   ['169.254.20.1', '169.254.20.5'],
    },
    'DC-WEST': {
      aws:   ['169.254.11.1', '169.254.11.5'],
      azure: ['172.16.11.1',  '172.16.11.5'],
      gcp:   ['169.254.21.1', '169.254.21.5'],
    },
  };

  sites.forEach(function(site) {
    var siteLabel = site.toLowerCase().replace(/-/g, '_');
    clouds.forEach(function(cloud) {
      var asns     = MC_CLOUD_ASN[cloud];
      var ips      = (peerIPs[site] || {})[cloud] || [];
      var cloudUp  = cloud.toUpperCase();

      ips.forEach(function(ip, i) {
        var suffix = i === 0 ? 'primary' : 'backup';
        lines.push('  - name: "' + site + '-' + cloudUp + '-' + suffix + '"');
        lines.push('    peer_ip: "' + ip + '"');
        lines.push('    peer_as: ' + asns.customer_as);
        lines.push('    local_as: ' + entAsn);
        lines.push('    bfd: true');
        lines.push('    description: "' + cloudUp + ' ' + suffix + ' via ' + site + '"');
        lines.push('    route_policy_in:  "PERMIT-' + cloudUp + '-PREFIXES-IN"');
        lines.push('    route_policy_out: "PERMIT-DC-TO-' + cloudUp + '-OUT"');
        lines.push('    circuit_type: "' + ({ aws: 'dx-vif', azure: 'er-peering', gcp: 'vlan-attach' }[cloud]) + '"');
        lines.push('');
      });
    });
  });

  lines.push('prefix_sets:');
  clouds.forEach(function(cloud) {
    var cloudUp  = cloud.toUpperCase();
    var regions  = _mcRegions(state, cloud);
    lines.push('  PERMIT-' + cloudUp + '-PREFIXES-IN:');
    regions.forEach(function(region) {
      var rInfo = (MC_REGIONS[cloud] || {})[region];
      if (rInfo) {
        lines.push('    - "' + rInfo.cidr + '"');
      }
    });
  });

  lines.push('');
  lines.push('route_policies:');
  clouds.forEach(function(cloud) {
    var cloudUp = cloud.toUpperCase();
    lines.push('  PERMIT-' + cloudUp + '-PREFIXES-IN:');
    lines.push('    - match_prefix_set: "PERMIT-' + cloudUp + '-PREFIXES-IN"');
    lines.push('      action: permit');
    lines.push('  PERMIT-DC-TO-' + cloudUp + '-OUT:');
    lines.push('    - match_prefix_set: "DC-AGGREGATE-PREFIXES"');
    lines.push('      action: permit');
    lines.push('    - action: deny');
  });

  lines.push('');
  lines.push('dc_aggregate_prefixes:');
  Object.keys(MC_DC_SITES).forEach(function(site) {
    lines.push('  - "' + MC_DC_SITES[site].mgmt_super + '"');
  });
  lines.push('  - "' + ((state && state.mcOrgCidr) || '10.0.0.0/9') + '"');

  return lines.join('\n');
};

/* ════════════════════════════════════════════════════════════════
   DC EDGE BGP CONFIG GENERATORS
════════════════════════════════════════════════════════════════ */

/* ── IOS-XR ─────────────────────────────────────────────────────── */
window.genDCEdgeBGP_IOSXR = function(state, site) {
  site = site || 'DC-EAST';
  var clouds  = _mcClouds(state);
  var entAsn  = _enterpriseAsn(state);
  var org     = _orgName(state);
  var siteInfo = MC_DC_SITES[site] || MC_DC_SITES['DC-EAST'];
  var hostname = site + '-EDGE-01';
  var lines   = [];

  var peerIPs = {
    'DC-EAST': {
      aws:   ['169.254.10.1', '169.254.10.5'],
      azure: ['172.16.10.1',  '172.16.10.5'],
      gcp:   ['169.254.20.1', '169.254.20.5'],
    },
    'DC-WEST': {
      aws:   ['169.254.11.1', '169.254.11.5'],
      azure: ['172.16.11.1',  '172.16.11.5'],
      gcp:   ['169.254.21.1', '169.254.21.5'],
    },
  };

  lines.push('! ═══════════════════════════════════════════════════════════');
  lines.push('! Device   : ' + hostname);
  lines.push('! Role     : DC Edge BGP (Multicloud)');
  lines.push('! Site     : ' + site + ' (' + siteInfo.location + ')');
  lines.push('! OS       : Cisco IOS-XR');
  lines.push('! Org      : ' + org);
  lines.push('! Generated by NetDesign AI — ' + new Date().toISOString().slice(0, 10));
  lines.push('! ═══════════════════════════════════════════════════════════');
  lines.push('!');
  lines.push('hostname ' + hostname);
  lines.push('!');

  // Prefix-sets
  lines.push('! ── ROUTING POLICY — PREFIX SETS ──────────────────────────');
  clouds.forEach(function(cloud) {
    var cloudUp = cloud.toUpperCase();
    var regions = _mcRegions(state, cloud);
    lines.push('prefix-set PERMIT-' + cloudUp + '-PREFIXES');
    regions.forEach(function(region, i) {
      var rInfo = (MC_REGIONS[cloud] || {})[region];
      if (rInfo) {
        var comma = (i < regions.length - 1) ? ',' : '';
        lines.push('  ' + rInfo.cidr + comma);
      }
    });
    lines.push('end-set');
    lines.push('!');
  });

  lines.push('prefix-set DC-AGGREGATE-PREFIXES');
  Object.keys(MC_DC_SITES).forEach(function(s, i) {
    var arr = Object.keys(MC_DC_SITES);
    var comma = (i < arr.length - 1) ? ',' : '';
    lines.push('  ' + MC_DC_SITES[s].mgmt_super + comma);
  });
  lines.push('end-set');
  lines.push('!');

  // Route policies
  lines.push('! ── ROUTE POLICIES ─────────────────────────────────────────');
  clouds.forEach(function(cloud) {
    var cloudUp = cloud.toUpperCase();
    lines.push('route-policy PERMIT-' + cloudUp + '-PREFIXES-IN');
    lines.push('  if destination in PERMIT-' + cloudUp + '-PREFIXES then');
    lines.push('    pass');
    lines.push('  else');
    lines.push('    drop');
    lines.push('  endif');
    lines.push('end-policy');
    lines.push('!');
    lines.push('route-policy PERMIT-DC-TO-' + cloudUp + '-OUT');
    lines.push('  if destination in DC-AGGREGATE-PREFIXES then');
    lines.push('    pass');
    lines.push('  else');
    lines.push('    drop');
    lines.push('  endif');
    lines.push('end-policy');
    lines.push('!');
  });

  // BGP
  lines.push('! ── BGP ─────────────────────────────────────────────────────');
  lines.push('router bgp ' + entAsn);
  lines.push(' bgp router-id ' + siteInfo.loopback_base + '1');
  lines.push(' bgp graceful-restart');
  lines.push(' address-family ipv4 unicast');
  lines.push('  network ' + siteInfo.mgmt_super.replace('/16', '') + ' 255.255.0.0');
  lines.push(' !');

  clouds.forEach(function(cloud) {
    var cloudUp = cloud.toUpperCase();
    var asns    = MC_CLOUD_ASN[cloud];
    var ips     = (peerIPs[site] || {})[cloud] || [];
    var label   = { aws: 'Direct Connect VIF', azure: 'ExpressRoute peering', gcp: 'Cloud Interconnect VLAN' }[cloud];

    ips.forEach(function(ip, i) {
      var suffix = i === 0 ? 'primary' : 'backup';
      lines.push(' !');
      lines.push(' ! ' + cloudUp + ' ' + suffix + ' — ' + label);
      lines.push(' neighbor ' + ip);
      lines.push('  remote-as ' + asns.customer_as);
      lines.push('  description "' + cloudUp + '-' + suffix.toUpperCase() + '-' + site + '"');
      lines.push('  bfd fast-detect');
      lines.push('  bfd minimum-interval 300');
      lines.push('  bfd multiplier 3');
      lines.push('  address-family ipv4 unicast');
      lines.push('   route-policy PERMIT-' + cloudUp + '-PREFIXES-IN in');
      lines.push('   route-policy PERMIT-DC-TO-' + cloudUp + '-OUT out');
      lines.push('   maximum-prefix 200 90');
      lines.push('   soft-reconfiguration inbound always');
      lines.push('  !');
    });
  });

  lines.push('!');
  return lines.join('\n');
};

/* ── Arista EOS ─────────────────────────────────────────────────── */
window.genDCEdgeBGP_EOS = function(state, site) {
  site = site || 'DC-EAST';
  var clouds  = _mcClouds(state);
  var entAsn  = _enterpriseAsn(state);
  var org     = _orgName(state);
  var siteInfo = MC_DC_SITES[site] || MC_DC_SITES['DC-EAST'];
  var hostname = site + '-EDGE-01';
  var lines   = [];

  var peerIPs = {
    'DC-EAST': {
      aws:   ['169.254.10.1', '169.254.10.5'],
      azure: ['172.16.10.1',  '172.16.10.5'],
      gcp:   ['169.254.20.1', '169.254.20.5'],
    },
    'DC-WEST': {
      aws:   ['169.254.11.1', '169.254.11.5'],
      azure: ['172.16.11.1',  '172.16.11.5'],
      gcp:   ['169.254.21.1', '169.254.21.5'],
    },
  };

  lines.push('! ═══════════════════════════════════════════════════════════');
  lines.push('! Device   : ' + hostname);
  lines.push('! Role     : DC Edge BGP (Multicloud)');
  lines.push('! Site     : ' + site + ' (' + siteInfo.location + ')');
  lines.push('! OS       : Arista EOS');
  lines.push('! Org      : ' + org);
  lines.push('! Generated by NetDesign AI — ' + new Date().toISOString().slice(0, 10));
  lines.push('! ═══════════════════════════════════════════════════════════');
  lines.push('!');
  lines.push('hostname ' + hostname);
  lines.push('!');

  // IP prefix-lists
  lines.push('! ── IP PREFIX-LISTS ─────────────────────────────────────────');
  clouds.forEach(function(cloud) {
    var cloudUp = cloud.toUpperCase();
    var regions = _mcRegions(state, cloud);
    var seq = 10;
    regions.forEach(function(region) {
      var rInfo = (MC_REGIONS[cloud] || {})[region];
      if (rInfo) {
        lines.push('ip prefix-list PERMIT-' + cloudUp + '-PREFIXES seq ' + seq + ' permit ' + rInfo.cidr);
        seq += 10;
      }
    });
    lines.push('!');
  });

  var seq = 10;
  Object.keys(MC_DC_SITES).forEach(function(s) {
    lines.push('ip prefix-list DC-AGGREGATE-PREFIXES seq ' + seq + ' permit ' + MC_DC_SITES[s].mgmt_super);
    seq += 10;
  });
  lines.push('!');

  // Route maps
  lines.push('! ── ROUTE MAPS ──────────────────────────────────────────────');
  clouds.forEach(function(cloud) {
    var cloudUp = cloud.toUpperCase();
    lines.push('route-map PERMIT-' + cloudUp + '-PREFIXES-IN permit 10');
    lines.push('   match ip address prefix-list PERMIT-' + cloudUp + '-PREFIXES');
    lines.push('!');
    lines.push('route-map PERMIT-' + cloudUp + '-PREFIXES-IN deny 9999');
    lines.push('!');
    lines.push('route-map PERMIT-DC-TO-' + cloudUp + '-OUT permit 10');
    lines.push('   match ip address prefix-list DC-AGGREGATE-PREFIXES');
    lines.push('!');
    lines.push('route-map PERMIT-DC-TO-' + cloudUp + '-OUT deny 9999');
    lines.push('!');
  });

  // BGP
  lines.push('! ── BGP ─────────────────────────────────────────────────────');
  lines.push('router bgp ' + entAsn);
  lines.push('   router-id ' + siteInfo.loopback_base + '1');
  lines.push('   graceful-restart');
  lines.push('   bgp log-neighbor-changes');
  lines.push('   !');

  clouds.forEach(function(cloud) {
    var cloudUp = cloud.toUpperCase();
    var asns    = MC_CLOUD_ASN[cloud];
    var ips     = (peerIPs[site] || {})[cloud] || [];

    ips.forEach(function(ip, i) {
      var suffix = i === 0 ? 'primary' : 'backup';
      lines.push('   ! ' + cloudUp + ' ' + suffix);
      lines.push('   neighbor ' + ip + ' remote-as ' + asns.customer_as);
      lines.push('   neighbor ' + ip + ' description ' + cloudUp + '-' + suffix.toUpperCase());
      lines.push('   neighbor ' + ip + ' bfd');
      lines.push('   neighbor ' + ip + ' route-map PERMIT-' + cloudUp + '-PREFIXES-IN in');
      lines.push('   neighbor ' + ip + ' route-map PERMIT-DC-TO-' + cloudUp + '-OUT out');
      lines.push('   neighbor ' + ip + ' maximum-routes 200 warning-only');
      lines.push('   !');
    });
  });

  lines.push('   address-family ipv4');
  clouds.forEach(function(cloud) {
    var ips = (peerIPs[site] || {})[cloud] || [];
    ips.forEach(function(ip) {
      lines.push('      neighbor ' + ip + ' activate');
    });
  });
  lines.push('   !');
  lines.push('!');
  return lines.join('\n');
};

/* ── JunOS ──────────────────────────────────────────────────────── */
window.genDCEdgeBGP_JunOS = function(state, site) {
  site = site || 'DC-EAST';
  var clouds  = _mcClouds(state);
  var entAsn  = _enterpriseAsn(state);
  var org     = _orgName(state);
  var siteInfo = MC_DC_SITES[site] || MC_DC_SITES['DC-EAST'];
  var hostname = site + '-EDGE-01';
  var lines   = [];

  var peerIPs = {
    'DC-EAST': {
      aws:   ['169.254.10.1', '169.254.10.5'],
      azure: ['172.16.10.1',  '172.16.10.5'],
      gcp:   ['169.254.20.1', '169.254.20.5'],
    },
    'DC-WEST': {
      aws:   ['169.254.11.1', '169.254.11.5'],
      azure: ['172.16.11.1',  '172.16.11.5'],
      gcp:   ['169.254.21.1', '169.254.21.5'],
    },
  };

  lines.push('# ═══════════════════════════════════════════════════════════');
  lines.push('# Device   : ' + hostname);
  lines.push('# Role     : DC Edge BGP (Multicloud)');
  lines.push('# Site     : ' + site + ' (' + siteInfo.location + ')');
  lines.push('# OS       : Juniper JunOS');
  lines.push('# Org      : ' + org);
  lines.push('# Generated by NetDesign AI — ' + new Date().toISOString().slice(0, 10));
  lines.push('# ═══════════════════════════════════════════════════════════');
  lines.push('');
  lines.push('system {');
  lines.push('    host-name ' + hostname + ';');
  lines.push('}');
  lines.push('');

  // Policy options
  lines.push('policy-options {');

  clouds.forEach(function(cloud) {
    var cloudUp = cloud.toUpperCase();
    var regions = _mcRegions(state, cloud);
    lines.push('    prefix-list PERMIT-' + cloudUp + '-PREFIXES {');
    regions.forEach(function(region) {
      var rInfo = (MC_REGIONS[cloud] || {})[region];
      if (rInfo) {
        lines.push('        ' + rInfo.cidr + ';');
      }
    });
    lines.push('    }');
  });

  lines.push('    prefix-list DC-AGGREGATE-PREFIXES {');
  Object.keys(MC_DC_SITES).forEach(function(s) {
    lines.push('        ' + MC_DC_SITES[s].mgmt_super + ';');
  });
  lines.push('    }');

  clouds.forEach(function(cloud) {
    var cloudUp = cloud.toUpperCase();
    lines.push('    policy-statement PERMIT-' + cloudUp + '-PREFIXES-IN {');
    lines.push('        term ACCEPT-' + cloudUp + ' {');
    lines.push('            from {');
    lines.push('                prefix-list PERMIT-' + cloudUp + '-PREFIXES;');
    lines.push('            }');
    lines.push('            then accept;');
    lines.push('        }');
    lines.push('        term DENY-OTHERS {');
    lines.push('            then reject;');
    lines.push('        }');
    lines.push('    }');
    lines.push('    policy-statement PERMIT-DC-TO-' + cloudUp + '-OUT {');
    lines.push('        term ACCEPT-DC {');
    lines.push('            from {');
    lines.push('                prefix-list DC-AGGREGATE-PREFIXES;');
    lines.push('            }');
    lines.push('            then accept;');
    lines.push('        }');
    lines.push('        term DENY-OTHERS {');
    lines.push('            then reject;');
    lines.push('        }');
    lines.push('    }');
  });
  lines.push('}');
  lines.push('');

  // BGP
  lines.push('protocols {');
  lines.push('    bgp {');
  lines.push('        group CLOUD-PEERS {');
  lines.push('            type external;');
  lines.push('            local-as ' + entAsn + ';');
  lines.push('            bfd-liveness-detection {');
  lines.push('                minimum-interval 300;');
  lines.push('                multiplier 3;');
  lines.push('            }');

  clouds.forEach(function(cloud) {
    var cloudUp = cloud.toUpperCase();
    var asns    = MC_CLOUD_ASN[cloud];
    var ips     = (peerIPs[site] || {})[cloud] || [];

    ips.forEach(function(ip, i) {
      var suffix = i === 0 ? 'primary' : 'backup';
      lines.push('            # ' + cloudUp + ' ' + suffix);
      lines.push('            neighbor ' + ip + ' {');
      lines.push('                description "' + cloudUp + '-' + suffix.toUpperCase() + '";');
      lines.push('                peer-as ' + asns.customer_as + ';');
      lines.push('                import PERMIT-' + cloudUp + '-PREFIXES-IN;');
      lines.push('                export PERMIT-DC-TO-' + cloudUp + '-OUT;');
      lines.push('            }');
    });
  });

  lines.push('        }');
  lines.push('    }');
  lines.push('}');
  return lines.join('\n');
};

/* ════════════════════════════════════════════════════════════════
   DEVICE LIST
════════════════════════════════════════════════════════════════ */
window.multicloudDevices = function(state) {
  var devs   = [];
  var clouds = _mcClouds(state);
  var sites  = _mcSites(state);
  var vendor = _dcEdgeVendor(state);

  var vendorMap = {
    iosxr:  { vendor: 'Cisco', platform: 'ASR-9922' },
    eos:    { vendor: 'Arista', platform: 'DCS-7280CR3' },
    junos:  { vendor: 'Juniper', platform: 'MX480' },
  };
  var vInfo = vendorMap[vendor] || vendorMap.iosxr;

  // DC edge routers
  sites.forEach(function(site, si) {
    ['01', '02'].forEach(function(num, ni) {
      devs.push({
        id:       site.toLowerCase().replace(/-/g, '') + '-edge-' + num,
        name:     site + '-EDGE-' + num,
        layer:    'mc-dc-edge',
        vendor:   vInfo.vendor,
        role:     'DC Edge Router (Multicloud BGP)',
        platform: vInfo.platform,
        icon:     'R',
        idx:      si * 2 + ni,
        _site:    site,
      });
    });
  });

  // Cloud hub virtual devices
  clouds.forEach(function(cloud) {
    var regions = _mcRegions(state, cloud);
    regions.forEach(function(region) {
      var rInfo  = (MC_REGIONS[cloud] || {})[region] || {};
      var suffix = rInfo.az_suffix || region;
      var cloudUp = cloud.toUpperCase();

      var hubName = {
        aws:   'AWS-TGW-' + suffix.toUpperCase(),
        azure: 'AZURE-VHUB-' + suffix.toUpperCase(),
        gcp:   'GCP-NCC-' + suffix.toUpperCase(),
      }[cloud];

      var layerMap = { aws: 'mc-aws', azure: 'mc-azure', gcp: 'mc-gcp' };
      var iconMap  = { aws: '☁', azure: '☁', gcp: '☁' };
      var roleMap  = {
        aws:   'AWS TGW + DX Gateway',
        azure: 'Azure vWAN vHub + ER GW',
        gcp:   'GCP NCC Hub + Cloud Router',
      };

      devs.push({
        id:       cloud + '-hub-' + suffix,
        name:     hubName,
        layer:    layerMap[cloud],
        vendor:   cloudUp,
        role:     roleMap[cloud],
        platform: cloudUp + ' Managed',
        icon:     iconMap[cloud],
        idx:      0,
        _cloud:   cloud,
        _region:  region,
        _terraform: true,
      });
    });
  });

  // Ansible inventory device
  devs.push({
    id:      'ansible-dc-edge-bgp',
    name:    'Ansible: dc-edge-bgp',
    layer:   'mc-ansible',
    vendor:  'Ansible',
    role:    'Ansible vars for dc-edge-bgp role',
    platform: 'YAML',
    icon:    'A',
    idx:     0,
    _ansible: true,
  });

  // ── GitHub Actions workflows ─────────────────────────────────────
  devs.push({ id:'gha-tf-plan',  name:'GHA: terraform-plan.yml',
    layer:'mc-cicd', vendor:'GitHub Actions', icon:'⚙',
    role:'CI: plan on PR + PR comment', platform:'YAML', idx:0, _gha:'plan' });
  devs.push({ id:'gha-tf-apply', name:'GHA: terraform-apply.yml',
    layer:'mc-cicd', vendor:'GitHub Actions', icon:'⚙',
    role:'CI: apply on merge (gated, sequential)', platform:'YAML', idx:1, _gha:'apply' });
  devs.push({ id:'gha-drift',    name:'GHA: drift-detection.yml',
    layer:'mc-cicd', vendor:'GitHub Actions', icon:'⚙',
    role:'CI: hourly drift → auto-open GitHub issue', platform:'YAML', idx:2, _gha:'drift' });

  // ── Terraform outputs.tf (per stack) ─────────────────────────────
  var clouds2 = _mcClouds(state);
  clouds2.forEach(function(c) {
    var key = 'mc' + c.charAt(0).toUpperCase() + c.slice(1) + 'Regions';
    var regs = (state && state[key]) || Object.keys(MC_REGIONS[c]).slice(0, 1);
    regs.forEach(function(region) {
      var suf = MC_REGIONS[c] && MC_REGIONS[c][region] ? MC_REGIONS[c][region].az_suffix : region;
      devs.push({ id:c+'-outputs-'+suf, name:c.toUpperCase()+' outputs.tf ('+region+')',
        layer:'mc-tf-outputs', vendor:'Terraform', icon:'📤',
        role:'Stack outputs fed to validate_post_apply.py', platform:'HCL',
        idx:0, _cloud:c, _region:region, _outputs:true });
    });
  });

  // ── Terraform bootstrap ───────────────────────────────────────────
  devs.push({ id:'tf-bootstrap-aws', name:'terraform/bootstrap/aws/main.tf',
    layer:'mc-tf-bootstrap', vendor:'Terraform', icon:'🏗',
    role:'One-time S3 + DynamoDB state backend bootstrap', platform:'HCL',
    idx:0, _bootstrap:'aws' });

  // ── Repo scaffolding ──────────────────────────────────────────────
  devs.push({ id:'pre-commit-cfg',    name:'.pre-commit-config.yaml',
    layer:'mc-repo', vendor:'pre-commit', icon:'🔒',
    role:'tf fmt/validate/tflint/tfsec, ansible-lint, gitleaks', platform:'YAML', idx:0, _repo:'precommit' });
  devs.push({ id:'codeowners',        name:'.github/CODEOWNERS',
    layer:'mc-repo', vendor:'GitHub', icon:'👥',
    role:'Prod stacks require network-leads + security-reviewers', platform:'Text', idx:1, _repo:'codeowners' });
  devs.push({ id:'pr-template',       name:'.github/pull_request_template.md',
    layer:'mc-repo', vendor:'GitHub', icon:'📋',
    role:'CR ref, blast radius, rollback plan checklist', platform:'Markdown', idx:2, _repo:'prtemplate' });
  devs.push({ id:'gitignore',         name:'.gitignore',
    layer:'mc-repo', vendor:'Git', icon:'🚫',
    role:'TF state, secrets, caches, plan artifacts', platform:'Text', idx:3, _repo:'gitignore' });
  devs.push({ id:'python-req',        name:'python/requirements.txt',
    layer:'mc-repo', vendor:'Python', icon:'🐍',
    role:'ansible-core, boto3, azure-identity, google-cloud-compute', platform:'Text', idx:4, _repo:'pyrequirements' });
  devs.push({ id:'ansible-cfg',       name:'ansible/ansible.cfg',
    layer:'mc-repo', vendor:'Ansible', icon:'A',
    role:'NetBox inventory, ssh pipelining, forks=20', platform:'INI', idx:5, _repo:'ansiblecfg' });

  // ── Aviatrix devices (only when orchestration = aviatrix) ──────────
  var orch = (state && state.mcOrchestration) ? state.mcOrchestration : 'native';
  if (orch === 'aviatrix') {
    devs.push({
      id:'avx-controller', name:'Aviatrix: controller.tf',
      layer:'mc-aviatrix', vendor:'Aviatrix', icon:'🛡',
      role:'Controller VM + provider bootstrap', platform:'HCL', idx:0, _avx:'controller',
    });
    devs.push({
      id:'avx-transit', name:'Aviatrix: transit_gateways.tf',
      layer:'mc-aviatrix', vendor:'Aviatrix', icon:'🛡',
      role:'Transit GW per cloud (HPE, Active-Active HA)', platform:'HCL', idx:1, _avx:'transit',
    });
    devs.push({
      id:'avx-peering', name:'Aviatrix: transit_peering.tf',
      layer:'mc-aviatrix', vendor:'Aviatrix', icon:'🛡',
      role:'Cross-cloud encrypted Transit Gateway Peering', platform:'HCL', idx:2, _avx:'peering',
    });
    devs.push({
      id:'avx-onprem', name:'Aviatrix: onprem_bgp.tf',
      layer:'mc-aviatrix', vendor:'Aviatrix', icon:'🛡',
      role:'BGP External Device Connection (DC edge → Transit GW)', platform:'HCL', idx:3, _avx:'onprem',
    });
    if (state && state.mcAvxSegments) {
      devs.push({
        id:'avx-segments', name:'Aviatrix: segmentation.tf',
        layer:'mc-aviatrix', vendor:'Aviatrix', icon:'🛡',
        role:'Network Domains: Prod / Dev / Mgmt + Connection Policies', platform:'HCL', idx:4, _avx:'segments',
      });
    }
    if (state && state.mcAvxFireNet) {
      devs.push({
        id:'avx-firenet', name:'Aviatrix: firenet.tf',
        layer:'mc-aviatrix', vendor:'Aviatrix', icon:'🛡',
        role:'FireNet inline FW insertion (' + (state.mcAvxFireNetFW || 'paloalto') + ')', platform:'HCL', idx:5, _avx:'firenet',
      });
    }
    devs.push({
      id:'avx-copilot', name:'Aviatrix: copilot.tf',
      layer:'mc-aviatrix', vendor:'Aviatrix', icon:'🛡',
      role:'CoPilot VM — FlowIQ, topology, ThreatIQ, AppIQ', platform:'HCL', idx:6, _avx:'copilot',
    });
  }

  return devs;
};

/* ════════════════════════════════════════════════════════════════
   CONFIG GENERATOR — dispatch
════════════════════════════════════════════════════════════════ */
window.genMulticloudConfig = function(device, state) {
  if (!device) return '# No device selected';

  // DC edge BGP config
  if (device.layer === 'mc-dc-edge') {
    var site   = device._site || 'DC-EAST';
    var vendor = _dcEdgeVendor(state);
    if (vendor === 'eos')   return window.genDCEdgeBGP_EOS(state, site);
    if (vendor === 'junos') return window.genDCEdgeBGP_JunOS(state, site);
    return window.genDCEdgeBGP_IOSXR(state, site);
  }

  // Terraform for cloud hubs
  if (device.layer === 'mc-aws' && device._terraform) {
    return window.genAWSTerraform(state, device._region);
  }
  if (device.layer === 'mc-azure' && device._terraform) {
    return window.genAzureTerraform(state, device._region);
  }
  if (device.layer === 'mc-gcp' && device._terraform) {
    return window.genGCPTerraform(state, device._region);
  }

  // Ansible vars
  if (device.layer === 'mc-ansible') {
    return window.genAnsibleVars(state);
  }

  // Terraform outputs.tf
  if (device.layer === 'mc-tf-outputs' && device._outputs) {
    return _genTFOutputs(device._cloud, device._region, state);
  }

  // Terraform bootstrap
  if (device.layer === 'mc-tf-bootstrap') {
    return _genTFBootstrap(state);
  }

  // GitHub Actions workflows
  if (device.layer === 'mc-cicd' && device._gha) {
    if (device._gha === 'plan')  return _genGHAPlan(state);
    if (device._gha === 'apply') return _genGHAApply(state);
    if (device._gha === 'drift') return _genGHADrift(state);
  }

  // Repo scaffolding
  if (device.layer === 'mc-repo' && device._repo) {
    if (device._repo === 'precommit')     return _genPreCommit();
    if (device._repo === 'codeowners')    return _genCodeOwners(state);
    if (device._repo === 'prtemplate')    return _genPRTemplate();
    if (device._repo === 'gitignore')     return _genGitignore();
    if (device._repo === 'pyrequirements') return _genPyRequirements();
    if (device._repo === 'ansiblecfg')    return _genAnsibleCfg();
  }

  // Aviatrix Terraform configs
  if (device.layer === 'mc-aviatrix' && device._avx) {
    if (device._avx === 'controller') return _genAviatrixControllerTF(state);
    if (device._avx === 'transit')    return _genAviatrixTransitTF(state);
    if (device._avx === 'peering')    return _genAviatrixPeeringTF(state);
    if (device._avx === 'onprem')     return _genAviatrixOnPremBGP(state);
    if (device._avx === 'segments')   return _genAviatrixSegmentsTF(state);
    if (device._avx === 'firenet')    return _genAviatrixFireNetTF(state);
    if (device._avx === 'copilot')    return _genAviatrixCoPilotTF(state);
  }

  return '# Config not available for device: ' + (device.name || device.id);
};

/* ════════════════════════════════════════════════════════════════
   TERRAFORM OUTPUTS
════════════════════════════════════════════════════════════════ */
function _genTFOutputs(cloud, region, state) {
  var org = _orgSlug(state);
  if (cloud === 'aws') {
    return [
      '# =============================================================================',
      '# Outputs — aws stack (' + region + ')',
      '# Consumed by validate_post_apply.py and sync_to_netbox.py',
      '# =============================================================================',
      '',
      'output "transit_gateway_id" {',
      '  description = "TGW ID — used by validate_post_apply.py"',
      '  value       = module.hub.transit_gateway_id',
      '}',
      '',
      'output "dx_gateway_id" {',
      '  description = "Direct Connect Gateway ID"',
      '  value       = module.hub.dx_gateway_id',
      '}',
      '',
      'output "inspection_vpc_id" {',
      '  description = "Inspection VPC ID"',
      '  value       = module.hub.inspection_vpc_id',
      '}',
      '',
      'output "bgp_peering_info" {',
      '  description = "BGP ASN and peer info for NetBox sync"',
      '  value = {',
      '    amazon_asn   = module.hub.amazon_side_asn',
      '    customer_asn = module.hub.customer_asn',
      '    region       = "' + region + '"',
      '  }',
      '}',
    ].join('\n');
  }
  if (cloud === 'azure') {
    return [
      '# =============================================================================',
      '# Outputs — azure stack (' + region + ')',
      '# =============================================================================',
      '',
      'output "virtual_hub_id" {',
      '  description = "vWAN hub resource ID — used by validate_post_apply.py"',
      '  value       = module.hub.virtual_hub_id',
      '}',
      '',
      'output "firewall_private_ip" {',
      '  description = "Azure Firewall private IP for routing"',
      '  value       = module.hub.firewall_private_ip',
      '}',
      '',
      'output "expressroute_gateway_id" {',
      '  description = "ER gateway resource ID"',
      '  value       = module.hub.expressroute_gateway_id',
      '}',
    ].join('\n');
  }
  if (cloud === 'gcp') {
    return [
      '# =============================================================================',
      '# Outputs — gcp stack (' + region + ')',
      '# =============================================================================',
      '',
      'output "network_id" {',
      '  description = "Host VPC self_link — used by validate_post_apply.py"',
      '  value       = module.hub.network_id',
      '}',
      '',
      'output "network_name" {',
      '  description = "Host VPC name — used by sync_to_netbox.py"',
      '  value       = module.hub.network_name',
      '}',
      '',
      'output "cloud_router_name" {',
      '  description = "Cloud Router name for BGP monitoring"',
      '  value       = module.hub.cloud_router_name',
      '}',
      '',
      'output "ncc_hub_id" {',
      '  description = "NCC hub resource ID"',
      '  value       = module.hub.ncc_hub_id',
      '}',
    ].join('\n');
  }
  return '# outputs.tf not implemented for cloud: ' + cloud;
}

/* ════════════════════════════════════════════════════════════════
   TERRAFORM BOOTSTRAP (AWS S3 + DynamoDB)
════════════════════════════════════════════════════════════════ */
function _genTFBootstrap(state) {
  var org = _orgSlug(state);
  return [
    '# =============================================================================',
    '# terraform/bootstrap/aws/main.tf',
    '# Run ONCE per AWS account to create the remote state backend.',
    '# After apply: migrate state to the bucket it just created.',
    '# =============================================================================',
    '',
    'terraform {',
    '  required_version = ">= 1.6"',
    '  required_providers {',
    '    aws = { source = "hashicorp/aws", version = "~> 5.40" }',
    '  }',
    '  # Bootstrap state is stored locally until the bucket exists.',
    '  # After: terraform init -migrate-state',
    '}',
    '',
    'provider "aws" {',
    '  region = "us-east-1"',
    '}',
    '',
    'data "aws_caller_identity" "current" {}',
    '',
    '# S3 bucket — one per AWS account, versioned + encrypted',
    'resource "aws_s3_bucket" "tfstate" {',
    '  bucket = "' + org + '-tfstate-${data.aws_caller_identity.current.account_id}"',
    '  tags   = { ManagedBy = "terraform", Purpose = "terraform-state" }',
    '}',
    '',
    'resource "aws_s3_bucket_versioning" "tfstate" {',
    '  bucket = aws_s3_bucket.tfstate.id',
    '  versioning_configuration { status = "Enabled" }',
    '}',
    '',
    'resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {',
    '  bucket = aws_s3_bucket.tfstate.id',
    '  rule {',
    '    apply_server_side_encryption_by_default {',
    '      sse_algorithm = "aws:kms"',
    '    }',
    '  }',
    '}',
    '',
    'resource "aws_s3_bucket_public_access_block" "tfstate" {',
    '  bucket                  = aws_s3_bucket.tfstate.id',
    '  block_public_acls       = true',
    '  block_public_policy     = true',
    '  ignore_public_acls      = true',
    '  restrict_public_buckets = true',
    '}',
    '',
    '# DynamoDB table — state locking',
    'resource "aws_dynamodb_table" "tflock" {',
    '  name         = "terraform-locks"',
    '  billing_mode = "PAY_PER_REQUEST"',
    '  hash_key     = "LockID"',
    '  attribute { name = "LockID"; type = "S" }',
    '  tags = { ManagedBy = "terraform", Purpose = "terraform-lock" }',
    '}',
    '',
    '# IAM role trusted by GitHub Actions (OIDC)',
    'resource "aws_iam_role" "gha" {',
    '  name = "' + org + '-GHA-Network-Platform"',
    '  assume_role_policy = jsonencode({',
    '    Version = "2012-10-17"',
    '    Statement = [{',
    '      Effect    = "Allow"',
    '      Principal = { Federated = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com" }',
    '      Action    = "sts:AssumeRoleWithWebIdentity"',
    '      Condition = { StringLike = { "token.actions.githubusercontent.com:sub" = "repo:YOUR-ORG/network-platform:*" } }',
    '    }]',
    '  })',
    '}',
    '',
    'output "tfstate_bucket" { value = aws_s3_bucket.tfstate.id }',
    'output "gha_role_arn"   { value = aws_iam_role.gha.arn }',
  ].join('\n');
}

/* ════════════════════════════════════════════════════════════════
   GITHUB ACTIONS — TERRAFORM PLAN
════════════════════════════════════════════════════════════════ */
function _ghaStacks(state) {
  var stacks = [];
  var clouds = _mcClouds(state);
  clouds.forEach(function(c) {
    var key = 'mc' + c.charAt(0).toUpperCase() + c.slice(1) + 'Regions';
    var regs = (state && state[key]) || Object.keys(MC_REGIONS[c]).slice(0, 1);
    regs.forEach(function(region) {
      var suf = MC_REGIONS[c] && MC_REGIONS[c][region] ? MC_REGIONS[c][region].az_suffix : region;
      stacks.push(c + '-prod-' + suf);
    });
  });
  return stacks;
}

function _ghaAuthSteps(indent) {
  var p = indent || '      ';
  return [
    p + '- name: AWS OIDC',
    p + '  if: startsWith(matrix.stack, \'aws-\')',
    p + '  uses: aws-actions/configure-aws-credentials@v4',
    p + '  with:',
    p + '    role-to-assume: ${{ vars.AWS_GHA_ROLE_ARN }}',
    p + '    aws-region: us-east-1',
    p + '',
    p + '- name: Azure OIDC',
    p + '  if: startsWith(matrix.stack, \'azure-\')',
    p + '  uses: azure/login@v2',
    p + '  with:',
    p + '    client-id: ${{ vars.AZ_CLIENT_ID }}',
    p + '    tenant-id: ${{ vars.AZ_TENANT_ID }}',
    p + '    subscription-id: ${{ vars.AZ_SUB_ID }}',
    p + '',
    p + '- name: GCP OIDC',
    p + '  if: startsWith(matrix.stack, \'gcp-\')',
    p + '  uses: google-github-actions/auth@v2',
    p + '  with:',
    p + '    workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}',
    p + '    service_account: ${{ vars.GCP_SERVICE_ACCOUNT }}',
  ].join('\n');
}

function _ghaInitStep(indent) {
  var p = indent || '      ';
  return [
    p + '- name: terraform init',
    p + '  working-directory: terraform/stacks/${{ matrix.stack }}',
    p + '  run: |',
    p + '    case "${{ matrix.stack }}" in',
    p + '      aws-*)   terraform init -backend-config="bucket=${{ vars.AWS_TFSTATE_BUCKET }}" -backend-config="dynamodb_table=terraform-locks" ;;',
    p + '      azure-*) terraform init -backend-config="storage_account_name=${{ vars.AZ_TFSTATE_SA }}" -backend-config="resource_group_name=${{ vars.AZ_TFSTATE_RG }}" ;;',
    p + '      gcp-*)   terraform init -backend-config="bucket=${{ vars.GCP_TFSTATE_BUCKET }}" ;;',
    p + '    esac',
  ].join('\n');
}

function _genGHAPlan(state) {
  var stacks = _ghaStacks(state);
  var stacksYaml = stacks.map(function(s) { return '          - ' + s; }).join('\n');
  return [
    'name: terraform-plan',
    '',
    'on:',
    '  pull_request:',
    '    paths: [\'terraform/**\', \'ansible/**\']',
    '',
    'permissions:',
    '  id-token: write      # required for OIDC',
    '  contents: read',
    '  pull-requests: write  # post plan as PR comment',
    '',
    'jobs:',
    '  plan:',
    '    runs-on: ubuntu-latest',
    '    strategy:',
    '      fail-fast: false',
    '      matrix:',
    '        stack:',
    stacksYaml,
    '',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '',
    '      - uses: hashicorp/setup-terraform@v3',
    '        with: { terraform_version: 1.6.6, terraform_wrapper: false }',
    '',
    _ghaAuthSteps('      '),
    '',
    _ghaInitStep('      '),
    '',
    '      - name: terraform plan',
    '        working-directory: terraform/stacks/${{ matrix.stack }}',
    '        run: |',
    '          terraform plan -out=tfplan -no-color',
    '          terraform show -no-color tfplan > plan.txt',
    '',
    '      - name: tfsec',
    '        uses: aquasecurity/tfsec-pr-commenter-action@v1.2.0',
    '        with:',
    '          github_token: ${{ github.token }}',
    '          working_directory: terraform/stacks/${{ matrix.stack }}',
    '',
    '      - name: Post plan comment on PR',
    '        uses: actions/github-script@v7',
    '        with:',
    '          script: |',
    '            const fs = require(\'fs\');',
    '            const plan = fs.readFileSync(\'terraform/stacks/${{ matrix.stack }}/plan.txt\', \'utf8\');',
    '            github.rest.issues.createComment({',
    '              issue_number: context.issue.number,',
    '              owner: context.repo.owner, repo: context.repo.repo,',
    '              body: \'**Plan: ${{ matrix.stack }}**\\n```hcl\\n\' + plan.slice(0, 60000) + \'\\n```\',',
    '            });',
  ].join('\n');
}

/* ════════════════════════════════════════════════════════════════
   GITHUB ACTIONS — TERRAFORM APPLY
════════════════════════════════════════════════════════════════ */
function _genGHAApply(state) {
  return [
    'name: terraform-apply',
    '',
    'on:',
    '  push:',
    '    branches: [main]',
    '    paths: [\'terraform/**\']',
    '',
    'permissions:',
    '  id-token: write',
    '  contents: read',
    '',
    'concurrency:',
    '  group: tf-apply-${{ github.ref }}',
    '  cancel-in-progress: false   # never cancel an in-flight apply',
    '',
    'jobs:',
    '  detect-stacks:',
    '    runs-on: ubuntu-latest',
    '    outputs:',
    '      stacks: ${{ steps.find.outputs.stacks }}',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with: { fetch-depth: 2 }',
    '      - id: find',
    '        run: |',
    '          CHANGED=$(git diff --name-only HEAD~1 HEAD -- terraform/ \\',
    '            | awk -F/ \'/^terraform\\/stacks\\// {print $3}\' | sort -u)',
    '          # If a shared module changed, run all stacks',
    '          if git diff --name-only HEAD~1 HEAD -- terraform/modules/ | grep -q .; then',
    '            CHANGED=$(ls terraform/stacks/)',
    '          fi',
    '          STACKS=$(echo "$CHANGED" | jq -R . | jq -sc \'map(select(length > 0))\')',
    '          echo "stacks=$STACKS" >> "$GITHUB_OUTPUT"',
    '',
    '  apply:',
    '    name: apply ${{ matrix.stack }}',
    '    needs: detect-stacks',
    '    if: needs.detect-stacks.outputs.stacks != \'[]\'',
    '    runs-on: ubuntu-latest',
    '    environment: ${{ contains(matrix.stack, \'prod\') && \'production\' || \'nonprod\' }}',
    '    strategy:',
    '      fail-fast: true',
    '      max-parallel: 1    # sequential — never apply two stacks simultaneously',
    '      matrix:',
    '        stack: ${{ fromJson(needs.detect-stacks.outputs.stacks) }}',
    '',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: hashicorp/setup-terraform@v3',
    '        with: { terraform_version: 1.6.6, terraform_wrapper: false }',
    '',
    _ghaAuthSteps('      '),
    '',
    _ghaInitStep('      '),
    '',
    '      - name: terraform apply',
    '        working-directory: terraform/stacks/${{ matrix.stack }}',
    '        run: terraform apply -auto-approve -lock-timeout=15m -input=false',
    '',
    '      - name: post-apply validation',
    '        run: |',
    '          python3 -m pip install -r python/requirements.txt -q',
    '          python3 python/scripts/validate_post_apply.py \\',
    '            --stack ${{ matrix.stack }} \\',
    '            --workdir terraform/stacks/${{ matrix.stack }}',
    '',
    '      - name: sync to NetBox',
    '        run: |',
    '          terraform -chdir=terraform/stacks/${{ matrix.stack }} output -json > /tmp/outputs.json',
    '          python3 python/scripts/sync_to_netbox.py \\',
    '            --stack ${{ matrix.stack }} --outputs-file /tmp/outputs.json',
    '        env:',
    '          NETBOX_URL:   ${{ vars.NETBOX_URL }}',
    '          NETBOX_TOKEN: ${{ secrets.NETBOX_TOKEN }}',
    '',
    '      - name: Update ServiceNow CR',
    '        if: always() && contains(matrix.stack, \'prod\')',
    '        run: |',
    '          CR=$(grep -oE \'CHG[0-9]{7}\' <<<\'${{ github.event.head_commit.message }}\' | head -1 || echo "")',
    '          if [ -n "$CR" ]; then',
    '            STATE=$([ "${{ job.status }}" = "success" ] && echo 3 || echo 4)',
    '            curl -fsS -X PATCH \\',
    '              -u "${{ secrets.SN_USER }}:${{ secrets.SN_TOKEN }}" \\',
    '              -H \'Content-Type: application/json\' \\',
    '              -d "{\\"state\\":\\"$STATE\\",\\"close_notes\\":\\"GHA run ${{ github.run_id }}\\"}" \\',
    '              "${{ vars.SN_URL }}/api/now/table/change_request?sysparm_query=number=$CR"',
    '          fi',
  ].join('\n');
}

/* ════════════════════════════════════════════════════════════════
   GITHUB ACTIONS — DRIFT DETECTION
════════════════════════════════════════════════════════════════ */
function _genGHADrift(state) {
  var stacks = _ghaStacks(state);
  var stacksYaml = stacks.map(function(s) { return '          - ' + s; }).join('\n');
  return [
    'name: drift-detection',
    '',
    'on:',
    '  schedule:',
    '    - cron: \'0 * * * *\'   # hourly',
    '  workflow_dispatch:         # manual trigger for ad-hoc checks',
    '',
    'permissions:',
    '  id-token: write',
    '  contents: read',
    '  issues: write              # open drift issue',
    '',
    'jobs:',
    '  drift:',
    '    runs-on: ubuntu-latest',
    '    strategy:',
    '      fail-fast: false       # check all stacks even if one errors',
    '      matrix:',
    '        stack:',
    stacksYaml,
    '',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: hashicorp/setup-terraform@v3',
    '        with: { terraform_version: 1.6.6, terraform_wrapper: false }',
    '',
    _ghaAuthSteps('      '),
    '',
    _ghaInitStep('      '),
    '',
    '      - name: detect-only plan',
    '        id: plan',
    '        working-directory: terraform/stacks/${{ matrix.stack }}',
    '        run: |',
    '          set +e',
    '          terraform plan -detailed-exitcode -lock=false -no-color -out=tfplan',
    '          EXIT=$?',
    '          set -e',
    '          # 0=no change  2=drift  other=error',
    '          if [ "$EXIT" = "2" ]; then',
    '            terraform show -no-color tfplan > drift.txt',
    '            echo "drift=true" >> "$GITHUB_OUTPUT"',
    '          elif [ "$EXIT" != "0" ]; then exit "$EXIT"; fi',
    '',
    '      - name: Open drift issue',
    '        if: steps.plan.outputs.drift == \'true\'',
    '        uses: actions/github-script@v7',
    '        with:',
    '          script: |',
    '            const fs = require(\'fs\');',
    '            const body = fs.readFileSync(\'terraform/stacks/${{ matrix.stack }}/drift.txt\', \'utf8\');',
    '            await github.rest.issues.create({',
    '              owner: context.repo.owner, repo: context.repo.repo,',
    '              title: `Drift detected: ${{ matrix.stack }}`,',
    '              labels: [\'drift\', \'urgent\'],',
    '              body: \'```hcl\\n\' + body.slice(0, 60000) + \'\\n```\',',
    '            });',
  ].join('\n');
}

/* ════════════════════════════════════════════════════════════════
   REPO SCAFFOLDING GENERATORS
════════════════════════════════════════════════════════════════ */
function _genPreCommit() {
  return [
    'repos:',
    '  - repo: https://github.com/pre-commit/pre-commit-hooks',
    '    rev: v4.6.0',
    '    hooks:',
    '      - id: trailing-whitespace',
    '      - id: end-of-file-fixer',
    '      - id: check-yaml',
    '        args: [\'--allow-multiple-documents\']',
    '      - id: check-merge-conflict',
    '      - id: check-added-large-files',
    '        args: [\'--maxkb=500\']',
    '      - id: detect-private-key',
    '',
    '  - repo: https://github.com/antonbabenko/pre-commit-terraform',
    '    rev: v1.88.0',
    '    hooks:',
    '      - id: terraform_fmt',
    '      - id: terraform_validate',
    '      - id: terraform_tflint',
    '        args: [\'--args=--minimum-failure-severity=warning\']',
    '      - id: terraform_tfsec',
    '      - id: terraform_docs',
    '        args:',
    '          - \'--hook-config=--path-to-file=README.md\'',
    '          - \'--hook-config=--add-to-existing-file=true\'',
    '          - \'--hook-config=--create-file-if-not-exist=true\'',
    '',
    '  - repo: https://github.com/ansible/ansible-lint',
    '    rev: v24.2.0',
    '    hooks:',
    '      - id: ansible-lint',
    '        files: ^ansible/',
    '        additional_dependencies: [jsonschema]',
    '',
    '  - repo: https://github.com/astral-sh/ruff-pre-commit',
    '    rev: v0.4.0',
    '    hooks:',
    '      - id: ruff',
    '        args: [--fix]',
    '        files: ^python/',
    '      - id: ruff-format',
    '        files: ^python/',
    '',
    '  - repo: https://github.com/gitleaks/gitleaks',
    '    rev: v8.18.4',
    '    hooks:',
    '      - id: gitleaks',
  ].join('\n');
}

function _genCodeOwners(state) {
  var org = _orgName(state).replace(/\s+/g, '-').toLowerCase();
  return [
    '# =============================================================================',
    '# CODEOWNERS — ' + _orgName(state) + ' network-platform',
    '# Prod stacks require 2 reviewers (network-leads + security-reviewers).',
    '# Module changes require senior platform engineers.',
    '# =============================================================================',
    '',
    '# Catch-all',
    '*                                   @' + org + '/network-platform-leads',
    '',
    '# Terraform stacks: prod requires network + security; nonprod requires network only',
    '/terraform/stacks/aws-prod-*/       @' + org + '/network-leads @' + org + '/security-reviewers',
    '/terraform/stacks/azure-prod-*/     @' + org + '/network-leads @' + org + '/security-reviewers',
    '/terraform/stacks/gcp-prod-*/       @' + org + '/network-leads @' + org + '/security-reviewers',
    '/terraform/stacks/*-nonprod-*/      @' + org + '/network-engineers',
    '',
    '# Modules: senior platform engineers',
    '/terraform/modules/                 @' + org + '/platform-seniors',
    '/terraform/bootstrap/               @' + org + '/platform-admins',
    '',
    '# Ansible: network engineers',
    '/ansible/roles/                     @' + org + '/network-engineers',
    '/ansible/playbooks/                 @' + org + '/network-engineers',
    '',
    '# Pipelines and security: platform admins only',
    '/.github/workflows/                 @' + org + '/platform-admins',
    '/.github/CODEOWNERS                 @' + org + '/platform-admins',
    '/.pre-commit-config.yaml            @' + org + '/platform-admins',
    '',
    '# Python validation',
    '/python/                            @' + org + '/platform-seniors',
  ].join('\n');
}

function _genPRTemplate() {
  return [
    '<!--',
    'Title format: <type>(<scope>): <short description>',
    'Examples:',
    '  feat(aws): add us-west-2 TGW hub stack',
    '  fix(ansible): correct BFD interval on DC edge',
    '  chore(deps): bump azurerm provider to 3.115',
    '-->',
    '',
    '## Change description',
    '<!-- What is changing and why. One paragraph. -->',
    '',
    '## Change Request',
    '- ServiceNow CR: `CHG#######`  ← required for production paths',
    '- Risk: [ ] Low  [ ] Medium  [ ] High',
    '- Blast radius: [ ] single stack  [ ] cloud-wide  [ ] multi-cloud',
    '',
    '## Pre-deployment checklist',
    '- [ ] `terraform plan` reviewed and reasonable',
    '- [ ] `tfsec` / `checkov` — no new HIGH findings',
    '- [ ] Batfish — no reachability regressions (snapshot ID: ___)',
    '- [ ] Tested in non-prod (link to evidence: ___)',
    '- [ ] Rollback plan documented below',
    '- [ ] Affected teams notified (channels: ___)',
    '',
    '## Rollback plan',
    '<!-- Specific steps. "Revert the PR" is not a rollback plan if state was applied. -->',
    '',
    '## Post-deployment validation',
    '<!-- What evidence will we collect that the change worked? -->',
    '',
    '## Notes for reviewers',
    '<!-- Timing, coordination, expected drift, etc. -->',
  ].join('\n');
}

function _genGitignore() {
  return [
    '# Terraform',
    '**/.terraform/',
    '*.tfstate',
    '*.tfstate.*',
    '*.tfvars',
    '!*.tfvars.example',
    'crash.log',
    'crash.*.log',
    '.terraform.lock.hcl.bak',
    'override.tf',
    'tfplan',
    'plan.txt',
    'drift.txt',
    '',
    '# Python',
    '__pycache__/',
    '*.py[cod]',
    '.pytest_cache/',
    '.ruff_cache/',
    'venv/',
    '.venv/',
    '',
    '# Ansible',
    '*.retry',
    '.ansible/',
    'ansible-netbox-cache*',
    '',
    '# Editor',
    '.vscode/',
    '.idea/',
    '*.swp',
    '.DS_Store',
    '',
    '# Secrets — defense in depth; real secrets must never be committed',
    '*.pem',
    '*.key',
    '.envrc',
    '.env',
    'secrets.yml',
    'secrets.yaml',
  ].join('\n');
}

function _genPyRequirements() {
  return [
    'ansible-core>=2.16',
    'pynetbox>=7.3',
    'pybatfish>=2024.1',
    'nornir>=3.4',
    'diagrams>=0.23',
    'jinja2>=3.1',
    'pytest>=8.0',
    'ruff>=0.4',
    '# Cloud SDKs — used by validate_post_apply.py and sync_to_netbox.py',
    'boto3>=1.34',
    'azure-identity>=1.16',
    'azure-mgmt-network>=25.4',
    'google-cloud-compute>=1.19',
    'requests>=2.32',
  ].join('\n');
}

function _genAnsibleCfg() {
  return [
    '[defaults]',
    'inventory         = inventory/netbox.yml',
    'roles_path        = roles',
    'host_key_checking = False',
    'retry_files_enabled = False',
    'stdout_callback   = yaml',
    'deprecation_warnings = False',
    'forks             = 20',
    'timeout           = 30',
    '',
    '[persistent_connection]',
    'connect_timeout = 60',
    'command_timeout = 60',
    '',
    '[ssh_connection]',
    'pipelining = True',
    'ssh_args   = -o ControlMaster=auto -o ControlPersist=300s',
  ].join('\n');
}

/* ════════════════════════════════════════════════════════════════
   AVIATRIX — Encrypted Multicloud Transit Orchestration
   Generates Terraform HCL using the aviatrix/aviatrix provider.

   Architecture:
     Controller VM (single, in primary cloud account)
     Transit GW per cloud/region   → encrypted IPsec mesh (HPE)
     Spoke GW per shared-services VPC
     Transit Gateway Peering       → cross-cloud full mesh
     External Device Connection    → BGP from DC edge routers
     FireNet                       → inline Palo/Fortigate/CheckPoint
     Network Domains               → Prod / Dev / Mgmt segmentation
     CoPilot VM                    → FlowIQ, ThreatIQ, AppIQ
════════════════════════════════════════════════════════════════ */

/* ── Aviatrix cloud type codes ────────────────────────────────── */
var AVX_CLOUD_TYPE = { aws: 1, azure: 8, gcp: 4, oci: 16 };

/* ── GW instance sizing (HPE-capable) ────────────────────────── */
var AVX_GW_SIZE = {
  aws:   { transit: 'c5n.4xlarge',  spoke: 'c5.xlarge' },
  azure: { transit: 'Standard_D8_v5', spoke: 'Standard_D4_v5' },
  gcp:   { transit: 'n2-standard-8',  spoke: 'n2-standard-4' },
};

/* ── Header boilerplate ───────────────────────────────────────── */
function _avxHeader(title) {
  return [
    '# ============================================================',
    '# ' + title,
    '# Generated by NetDesign AI — Aviatrix Multicloud Orchestration',
    '# Provider: aviatrix/aviatrix  ≥ 3.1',
    '# ============================================================',
    '',
  ].join('\n');
}

function _orgSlug(state) {
  var name = (state && state.orgName) ? state.orgName : 'acme';
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/* ────────────────────────────────────────────────────────────────
   1. CONTROLLER  —  aviatrix/controller.tf
   Deploys the Aviatrix Controller VM and configures accounts
   for each selected cloud provider.
──────────────────────────────────────────────────────────────── */
function _genAviatrixControllerTF(state) {
  var clouds = _mcClouds(state);
  var org    = _orgSlug(state);
  var hpe    = (state && state.mcAvxHPE !== false);

  var lines = [_avxHeader('Aviatrix Controller + Cloud Account Bootstrap')];

  lines.push(
    'terraform {',
    '  required_version = ">= 1.5"',
    '  required_providers {',
    '    aviatrix = {',
    '      source  = "AviatrixSystems/aviatrix"',
    '      version = "~> 3.1"',
    '    }',
    '    aws = { source = "hashicorp/aws"; version = "~> 5.0" }',
    '  }',
    '  backend "s3" {',
    '    bucket         = "' + org + '-tf-state"',
    '    key            = "aviatrix/controller/terraform.tfstate"',
    '    region         = "us-east-1"',
    '    dynamodb_table = "' + org + '-tf-lock"',
    '    encrypt        = true',
    '  }',
    '}',
    '',
    'provider "aviatrix" {',
    '  controller_ip = var.avx_controller_ip',
    '  username      = var.avx_username',
    '  password      = var.avx_password',
    '}',
    '',
    'provider "aws" {',
    '  region = "us-east-1"',
    '  default_tags { tags = { ManagedBy = "Terraform", Project = "aviatrix-' + org + '" } }',
    '}',
    '',
    '# ── Variables ─────────────────────────────────────────────',
    'variable "avx_controller_ip" { description = "Controller FQDN or IP" }',
    'variable "avx_username"      { description = "Controller admin username"; default = "admin" }',
    'variable "avx_password"      { description = "Controller admin password"; sensitive = true }',
    '',
  );

  // Cloud account onboarding
  if (clouds.includes('aws')) {
    lines.push(
      '# ── AWS Account Access ────────────────────────────────────',
      'resource "aviatrix_account" "aws_primary" {',
      '  account_name       = "aws-' + org + '"',
      '  cloud_type         = 1  # AWS',
      '  aws_account_number = var.aws_account_id',
      '  aws_iam            = true  # IAM role-based (OIDC preferred)',
      '  aws_role_app       = "arn:aws:iam::${var.aws_account_id}:role/aviatrix-role-app"',
      '  aws_role_ec2       = "arn:aws:iam::${var.aws_account_id}:role/aviatrix-role-ec2"',
      '}',
      '',
      'variable "aws_account_id" { description = "AWS account ID for primary account" }',
      '',
    );
  }
  if (clouds.includes('azure')) {
    lines.push(
      '# ── Azure Account Access ──────────────────────────────────',
      'resource "aviatrix_account" "azure_primary" {',
      '  account_name                     = "azure-' + org + '"',
      '  cloud_type                       = 8  # Azure',
      '  arm_subscription_id              = var.azure_subscription_id',
      '  arm_directory_id                 = var.azure_tenant_id',
      '  arm_application_id               = var.azure_app_id',
      '  arm_application_key              = var.azure_app_secret',
      '}',
      '',
      'variable "azure_subscription_id" {}',
      'variable "azure_tenant_id"       {}',
      'variable "azure_app_id"          {}',
      'variable "azure_app_secret"      { sensitive = true }',
      '',
    );
  }
  if (clouds.includes('gcp')) {
    lines.push(
      '# ── GCP Account Access ────────────────────────────────────',
      'resource "aviatrix_account" "gcp_primary" {',
      '  account_name                           = "gcp-' + org + '"',
      '  cloud_type                             = 4  # GCP',
      '  gcloud_project_id                      = var.gcp_project_id',
      '  gcloud_project_credentials_filepath    = var.gcp_credentials_path',
      '}',
      '',
      'variable "gcp_project_id"       {}',
      'variable "gcp_credentials_path" { default = "/run/secrets/gcp-sa.json" }',
      '',
    );
  }

  lines.push(
    '# ── Controller version pin ────────────────────────────────',
    'resource "aviatrix_controller_config" "this" {',
    '  sg_management_account_name = aviatrix_account.aws_primary.account_name',
    '  http_access                = false',
    '  fqdn_exception_rule        = true',
    '}',
    '',
    '# NOTE: The Controller VM itself is deployed via Marketplace.',
    '# Use the Aviatrix bootstrap module or GH Marketplace Launch:',
    '# https://docs.aviatrix.com/documentation/latest/getting-started/',
  );

  return lines.join('\n');
}

/* ────────────────────────────────────────────────────────────────
   2. TRANSIT GATEWAYS  —  aviatrix/transit_gateways.tf
   Deploys Transit GW + HA GW per cloud per region.
   Spoke GW for shared-services VPC (DNS, NTP, monitoring).
──────────────────────────────────────────────────────────────── */
function _genAviatrixTransitTF(state) {
  var clouds = _mcClouds(state);
  var org    = _orgSlug(state);
  var hpe    = (state && state.mcAvxHPE !== false);
  var lines  = [_avxHeader('Aviatrix Transit Gateways — All Clouds')];

  lines.push(
    '# HPE / Insane Mode: ' + (hpe ? 'ENABLED (multi-tunnel parallel IPsec, up to 100 Gbps on private)' : 'disabled'),
    '# Gateway sizing: network-optimised instances with jumbo frames',
    '',
  );

  clouds.forEach(function(cloud) {
    var regions  = _mcRegions(state, cloud);
    var acctRef  = 'aviatrix_account.' + cloud + '_primary.account_name';
    var gwSize   = AVX_GW_SIZE[cloud] || AVX_GW_SIZE.aws;
    var cloudNum = AVX_CLOUD_TYPE[cloud] || 1;

    regions.forEach(function(region) {
      var rInfo = MC_REGIONS[cloud] && MC_REGIONS[cloud][region];
      if (!rInfo) return;
      var suffix   = rInfo.az_suffix;
      var hubCIDR  = rInfo.hub_cidr || rInfo.cidr;
      var gwName   = org + '-transit-' + cloud + '-' + suffix;
      var vpcCIDR  = rInfo.cidr;

      lines.push(
        '# ── ' + cloud.toUpperCase() + ' Transit — ' + region + ' ─────────────────────────',
      );

      // VPC / VNet is assumed pre-existing or managed separately
      // Reference it via locals / data sources
      lines.push(
        'locals {',
        '  ' + cloud + '_' + suffix + '_transit_vpc_id  = var.' + cloud + '_' + suffix + '_transit_vpc_id',
        '  ' + cloud + '_' + suffix + '_transit_subnet  = var.' + cloud + '_' + suffix + '_transit_subnet',
        '  ' + cloud + '_' + suffix + '_ha_subnet       = var.' + cloud + '_' + suffix + '_ha_subnet',
        '}',
        '',
        'variable "' + cloud + '_' + suffix + '_transit_vpc_id" { description = "' + cloud.toUpperCase() + ' Transit VPC/VNet ID (' + region + ')" }',
        'variable "' + cloud + '_' + suffix + '_transit_subnet"  { description = "Transit GW subnet CIDR (' + region + ')" }',
        'variable "' + cloud + '_' + suffix + '_ha_subnet"       { description = "Transit HA GW subnet CIDR (' + region + ')" }',
        '',
        'resource "aviatrix_transit_gateway" "' + gwName.replace(/-/g,'_') + '" {',
        '  cloud_type                  = ' + cloudNum,
        '  account_name                = ' + acctRef,
        '  gw_name                     = "' + gwName + '"',
        '  vpc_id                      = local.' + cloud + '_' + suffix + '_transit_vpc_id',
        '  vpc_reg                     = "' + region + '"',
        '  gw_subnet                   = local.' + cloud + '_' + suffix + '_transit_subnet',
        '  gw_size                     = "' + gwSize.transit + '"',
        '',
        '  # Active-Active HA',
        '  ha_subnet                   = local.' + cloud + '_' + suffix + '_ha_subnet',
        '  ha_gw_size                  = "' + gwSize.transit + '"',
        '',
        hpe ? (
          '  # High Performance Encryption — Insane Mode\n' +
          '  insane_mode                 = true\n' +
          '  insane_mode_az              = "' + (cloud === 'aws' ? region + 'a' : '') + '"'
        ) : '  insane_mode                 = false',
        '',
        '  # BGP + Transit features',
        '  connected_transit           = true   # full-mesh spoke-to-spoke',
        '  enable_active_standby       = false  # active-active (both GWs forward)',
        '  local_as_number             = "' + (MC_CLOUD_ASN[cloud] ? MC_CLOUD_ASN[cloud].customer_as : 65020) + '"',
        '',
        '  # Encryption',
        '  enable_encrypt_volume       = true',
        '  tunnel_encryption_cipher    = "AES-256-GCM-128"',
        '',
        '  tags = {',
        '    Name        = "' + gwName + '"',
        '    Environment = "production"',
        '    ManagedBy   = "Terraform"',
        '    Org         = "' + org + '"',
        '  }',
        '}',
        '',
      );

      // Shared-services Spoke GW
      var spkName = org + '-spoke-shared-' + cloud + '-' + suffix;
      lines.push(
        '# Spoke GW — Shared Services VPC (' + cloud.toUpperCase() + ' ' + region + ')',
        'resource "aviatrix_spoke_gateway" "' + spkName.replace(/-/g,'_') + '" {',
        '  cloud_type   = ' + cloudNum,
        '  account_name = ' + acctRef,
        '  gw_name      = "' + spkName + '"',
        '  vpc_id       = var.' + cloud + '_' + suffix + '_shared_vpc_id',
        '  vpc_reg      = "' + region + '"',
        '  gw_subnet    = var.' + cloud + '_' + suffix + '_shared_subnet',
        '  gw_size      = "' + gwSize.spoke + '"',
        '  ha_subnet    = var.' + cloud + '_' + suffix + '_shared_ha_subnet',
        '  ha_gw_size   = "' + gwSize.spoke + '"',
        '  enable_active_mesh = true',
        '}',
        '',
        '# Attach spoke to its regional transit',
        'resource "aviatrix_spoke_transit_attachment" "' + spkName.replace(/-/g,'_') + '_attach" {',
        '  spoke_gw_name   = aviatrix_spoke_gateway.' + spkName.replace(/-/g,'_') + '.gw_name',
        '  transit_gw_name = aviatrix_transit_gateway.' + gwName.replace(/-/g,'_') + '.gw_name',
        '}',
        '',
        'variable "' + cloud + '_' + suffix + '_shared_vpc_id"    {}',
        'variable "' + cloud + '_' + suffix + '_shared_subnet"     {}',
        'variable "' + cloud + '_' + suffix + '_shared_ha_subnet"  {}',
        '',
      );
    });
  });

  return lines.join('\n');
}

/* ────────────────────────────────────────────────────────────────
   3. TRANSIT PEERING  —  aviatrix/transit_peering.tf
   Full-mesh encrypted peering between all Transit GWs.
   When HPE is enabled, peering uses parallel IPsec tunnels.
──────────────────────────────────────────────────────────────── */
function _genAviatrixPeeringTF(state) {
  var clouds  = _mcClouds(state);
  var org     = _orgSlug(state);
  var hpe     = (state && state.mcAvxHPE !== false);
  var lines   = [_avxHeader('Aviatrix Transit Gateway Peering — Cross-Cloud Full Mesh')];

  lines.push(
    '# Each pair gets a dedicated peering resource.',
    '# HPE: ' + (hpe ? 'parallel tunnels (up to 20) for maximum throughput' : 'standard single tunnel'),
    '# enable_peering_over_private_network = true when DX/ExpressRoute is available.',
    '',
  );

  // Build list of all transit GW names
  var gws = [];
  clouds.forEach(function(cloud) {
    var regions = _mcRegions(state, cloud);
    regions.forEach(function(region) {
      var rInfo = MC_REGIONS[cloud] && MC_REGIONS[cloud][region];
      if (!rInfo) return;
      gws.push({
        cloud: cloud,
        region: region,
        suffix: rInfo.az_suffix,
        name: org + '-transit-' + cloud + '-' + rInfo.az_suffix,
        ref:  'aviatrix_transit_gateway.' + (org + '-transit-' + cloud + '-' + rInfo.az_suffix).replace(/-/g,'_') + '.gw_name',
      });
    });
  });

  // Full-mesh: every pair (i < j)
  var pairIdx = 0;
  for (var i = 0; i < gws.length; i++) {
    for (var j = i + 1; j < gws.length; j++) {
      var a = gws[i];
      var b = gws[j];
      var resourceName = 'peer_' + a.cloud + '_' + a.suffix + '_to_' + b.cloud + '_' + b.suffix;
      var sameCloud    = a.cloud === b.cloud;
      lines.push(
        '# ' + a.cloud.toUpperCase() + ' ' + a.region + '  ↔  ' + b.cloud.toUpperCase() + ' ' + b.region,
        'resource "aviatrix_transit_gateway_peering" "' + resourceName + '" {',
        '  transit_gateway_name1 = ' + a.ref,
        '  transit_gateway_name2 = ' + b.ref,
        '',
        hpe && !sameCloud ? (
          '  # HPE over private network (DX/ExpressRoute)\n' +
          '  enable_peering_over_private_network              = true\n' +
          '  enable_insane_mode_encryption_over_internet      = false\n' +
          '  tunnels                                          = 4  # 4 parallel tunnels per pair'
        ) : (
          hpe && sameCloud ? (
            '  # Same cloud, different region — HPE over AWS backbone\n' +
            '  enable_insane_mode_encryption_over_internet    = true\n' +
            '  tunnels                                        = 4'
          ) : '  # Standard single-tunnel peering'
        ),
        '}',
        '',
      );
      pairIdx++;
    }
  }

  if (pairIdx === 0) {
    lines.push('# Add more cloud providers in Step 2 to generate peering configs.');
  }

  return lines.join('\n');
}

/* ────────────────────────────────────────────────────────────────
   4. ON-PREM BGP  —  aviatrix/onprem_bgp.tf
   External Device Connection from DC edge routers to each
   Transit GW (BGP over IPsec or BGP over LAN via Colo).
──────────────────────────────────────────────────────────────── */
function _genAviatrixOnPremBGP(state) {
  var clouds   = _mcClouds(state);
  var org      = _orgSlug(state);
  var entAsn   = _enterpriseAsn(state);
  var hpe      = (state && state.mcAvxHPE !== false);
  var sites    = _mcSites(state);
  var lines    = [_avxHeader('Aviatrix External Device Connection — DC Edge BGP')];

  lines.push(
    '# BGP over IPsec from DC edge routers to each cloud Transit GW.',
    '# BFD enabled for sub-second failover detection.',
    '# Use BGP over LAN instead if the colo NVA is in the same VPC.',
    '',
  );

  clouds.forEach(function(cloud) {
    var regions = _mcRegions(state, cloud);
    regions.forEach(function(region) {
      var rInfo = MC_REGIONS[cloud] && MC_REGIONS[cloud][region];
      if (!rInfo) return;
      var suffix   = rInfo.az_suffix;
      var gwName   = org + '-transit-' + cloud + '-' + suffix;
      var gwRef    = 'aviatrix_transit_gateway.' + gwName.replace(/-/g,'_') + '.gw_name';
      var cloudAsn = MC_CLOUD_ASN[cloud] ? MC_CLOUD_ASN[cloud].customer_as : 65020;

      sites.forEach(function(site) {
        var siteInfo = MC_DC_SITES[site];
        var siteLow  = site.toLowerCase().replace('-','_');
        var connName = org + '-' + siteLow + '-to-' + cloud + '-' + suffix;
        var edgeLoop = siteInfo ? siteInfo.loopback_base + '1' : '10.10.255.1';

        lines.push(
          '# ' + site + ' → ' + cloud.toUpperCase() + ' ' + region,
          'resource "aviatrix_transit_external_device_conn" "' + connName.replace(/-/g,'_') + '" {',
          '  vpc_id                    = local.' + cloud + '_' + suffix + '_transit_vpc_id',
          '  connection_name           = "' + connName + '"',
          '  gw_name                   = ' + gwRef,
          '  connection_type           = "bgp"',
          '  tunnel_protocol           = "IPsec"',
          '',
          '  # Aviatrix side',
          '  bgp_local_as_num          = "' + cloudAsn + '"',
          '',
          '  # DC Edge side',
          '  remote_gateway_ip         = var.' + siteLow + '_edge_public_ip',
          '  bgp_remote_as_num         = "' + entAsn + '"',
          '',
          hpe ? (
            '  # High-performance: 4 parallel tunnels\n' +
            '  enable_ikev2                = true\n' +
            '  custom_algorithms           = true\n' +
            '  phase1_authentication       = "SHA-512"\n' +
            '  phase1_dh_groups            = "21"\n' +
            '  phase2_authentication       = "HMAC-SHA-512"\n' +
            '  phase2_dh_groups            = "21"'
          ) : (
            '  enable_ikev2                = true'
          ),
          '',
          '  # Pre-shared key (use AWS Secrets Manager / Vault in production)',
          '  pre_shared_key              = var.' + siteLow + '_' + cloud + '_psk',
          '',
          '  # BFD for fast failover',
          '  enable_bfd                  = true',
          '',
          '  # Backup (HA) tunnel to HA Transit GW',
          '  backup_remote_gateway_ip    = var.' + siteLow + '_edge_backup_ip',
          '  backup_pre_shared_key       = var.' + siteLow + '_' + cloud + '_psk_ha',
          '  backup_bgp_remote_as_num    = "' + entAsn + '"',
          '}',
          '',
          'variable "' + siteLow + '_edge_public_ip"   { description = "' + site + ' edge router public IP for ' + cloud.toUpperCase() + ' tunnel" }',
          'variable "' + siteLow + '_edge_backup_ip"   { description = "' + site + ' HA edge router public IP" }',
          'variable "' + siteLow + '_' + cloud + '_psk"    { sensitive = true; description = "IPsec PSK (' + site + ' → ' + cloud.toUpperCase() + ')" }',
          'variable "' + siteLow + '_' + cloud + '_psk_ha" { sensitive = true; description = "IPsec PSK HA (' + site + ' → ' + cloud.toUpperCase() + ')" }',
          '',
        );
      });
    });
  });

  return lines.join('\n');
}

/* ────────────────────────────────────────────────────────────────
   5. FIRENET  —  aviatrix/firenet.tf
   Inline firewall insertion into the Transit Gateway data path.
   Supports Palo Alto VM-Series, Fortinet FortiGate, Check Point.
──────────────────────────────────────────────────────────────── */
function _genAviatrixFireNetTF(state) {
  var clouds  = _mcClouds(state);
  var org     = _orgSlug(state);
  var fwType  = (state && state.mcAvxFireNetFW) ? state.mcAvxFireNetFW : 'paloalto';
  var lines   = [_avxHeader('Aviatrix FireNet — Inline Firewall Insertion')];

  var fwMeta = {
    paloalto:   { label: 'Palo Alto VM-Series', fw_size: 'c5.4xlarge',  fw_size_az: 'Standard_D8s_v3', login: 'admin', bootstrap: 'S3 bucket bootstrap with day-0 XML config' },
    fortinet:   { label: 'Fortinet FortiGate',  fw_size: 'c5.2xlarge',  fw_size_az: 'Standard_D4s_v3', login: 'admin', bootstrap: 'FortiManager / user-data script' },
    checkpoint: { label: 'Check Point CloudGuard', fw_size: 'c5.2xlarge', fw_size_az: 'Standard_D4s_v3', login: 'admin', bootstrap: 'Management server or smart-1 cloud' },
  };
  var fw = fwMeta[fwType] || fwMeta.paloalto;

  lines.push(
    '# Firewall: ' + fw.label,
    '# Each Transit GW gets a FireNet + one HA firewall instance.',
    '# CRITICAL: FireNet and Network Segmentation are mutually exclusive per Transit GW.',
    '# If both are needed, use separate Transit GWs for each function.',
    '',
  );

  clouds.forEach(function(cloud) {
    var regions = _mcRegions(state, cloud);
    regions.forEach(function(region) {
      var rInfo = MC_REGIONS[cloud] && MC_REGIONS[cloud][region];
      if (!rInfo) return;
      var suffix  = rInfo.az_suffix;
      var gwName  = org + '-transit-' + cloud + '-' + suffix;
      var gwRef   = 'aviatrix_transit_gateway.' + gwName.replace(/-/g,'_') + '.vpc_id';
      var fnName  = org + '-firenet-' + cloud + '-' + suffix;

      lines.push(
        '# FireNet — ' + cloud.toUpperCase() + ' ' + region,
        'resource "aviatrix_firenet" "' + fnName.replace(/-/g,'_') + '" {',
        '  vpc_id              = ' + gwRef,
        '  inspection_enabled  = true   # East-West + North-South inspection',
        '  egress_enabled      = true   # Inspect outbound internet traffic',
        '  egress_static_cidrs = ["0.0.0.0/0"]',
        '  keep_alive_via_lan_interface_enabled = true',
        '}',
        '',
        '# ' + fw.label + ' instance',
        'resource "aviatrix_firewall_instance" "' + fnName.replace(/-/g,'_') + '_fw1" {',
        '  vpc_id               = ' + gwRef,
        '  firenet_gw_name      = aviatrix_transit_gateway.' + gwName.replace(/-/g,'_') + '.gw_name',
        '  firewall_name        = "' + org + '-fw-' + cloud + '-' + suffix + '-01"',
        '  firewall_image       = "' + _avxFWImage(fwType, cloud) + '"',
        '  firewall_size        = "' + (cloud === 'azure' ? fw.fw_size_az : fw.fw_size) + '"',
        '  username             = "' + fw.login + '"',
        '  password             = var.fw_admin_password',
        '  management_subnet    = var.' + cloud + '_' + suffix + '_fw_mgmt_subnet',
        '  egress_subnet        = var.' + cloud + '_' + suffix + '_fw_egress_subnet',
        '  # Bootstrap: ' + fw.bootstrap,
        '}',
        '',
        'resource "aviatrix_firewall_instance_association" "' + fnName.replace(/-/g,'_') + '_fw1_assoc" {',
        '  vpc_id          = ' + gwRef,
        '  firenet_gw_name = aviatrix_transit_gateway.' + gwName.replace(/-/g,'_') + '.gw_name',
        '  instance_id     = aviatrix_firewall_instance.' + fnName.replace(/-/g,'_') + '_fw1.instance_id',
        '  attached        = true',
        '}',
        '',
        'variable "' + cloud + '_' + suffix + '_fw_mgmt_subnet"   {}',
        'variable "' + cloud + '_' + suffix + '_fw_egress_subnet"  {}',
        '',
      );
    });
  });

  lines.push(
    'variable "fw_admin_password" {',
    '  sensitive   = true',
    '  description = "Firewall admin password (store in Secrets Manager)"',
    '}',
  );

  return lines.join('\n');
}

function _avxFWImage(fwType, cloud) {
  var images = {
    paloalto: {
      aws:   'Palo Alto Networks VM-Series Next-Generation Firewall (BYOL)',
      azure: 'Palo Alto Networks VM-Series Next Generation Firewall Bundle 1',
      gcp:   'Palo Alto Networks VM-Series Next-Generation Firewall BYOL',
    },
    fortinet: {
      aws:   'Fortinet FortiGate (BYOL) Next Generation Firewall',
      azure: 'Fortinet FortiGate Next-Generation Firewall',
      gcp:   'FortiGate Next-Generation Firewall (BYOL)',
    },
    checkpoint: {
      aws:   'Check Point CloudGuard IaaS Next Gen Firewall w. Threat Prevention',
      azure: 'Check Point CloudGuard Network Security for Gateways-PAYG',
      gcp:   'Check Point CloudGuard IaaS Firewall and Threat Prevention (BYOL)',
    },
  };
  return (images[fwType] && images[fwType][cloud]) ? images[fwType][cloud] : images.paloalto.aws;
}

/* ────────────────────────────────────────────────────────────────
   6. SEGMENTATION  —  aviatrix/segmentation.tf
   Network Domains: Prod / Dev / Mgmt — intent-based isolation.
   Connection Policies define allowed cross-domain flows.
   NOTE: Cannot coexist with FireNet on same Transit GW.
──────────────────────────────────────────────────────────────── */
function _genAviatrixSegmentsTF(state) {
  var org   = _orgSlug(state);
  var lines = [_avxHeader('Aviatrix Network Domain Segmentation')];

  var domains = [
    { name: 'prod',    label: 'Production',       color: '#00e87a' },
    { name: 'dev',     label: 'Development',       color: '#1a7fff' },
    { name: 'mgmt',    label: 'Management',        color: '#9955ff' },
    { name: 'shared',  label: 'Shared Services',   color: '#ff8c00' },
  ];

  // Allowed cross-domain flows: prod↔shared, dev↔shared, mgmt→all, dev↔dev is blocked by default
  var policies = [
    ['prod',   'shared',  'Production can reach Shared Services (DNS, NTP, logging)'],
    ['dev',    'shared',  'Development can reach Shared Services'],
    ['mgmt',   'prod',    'Management can reach Production for ops access'],
    ['mgmt',   'dev',     'Management can reach Development'],
    ['mgmt',   'shared',  'Management can reach Shared Services'],
  ];

  lines.push(
    '# Network Domains map spoke VPCs into logical groups.',
    '# Default: intra-domain traffic allowed; inter-domain blocked unless policy defined.',
    '# Prod ↔ Dev is intentionally BLOCKED (no policy defined).',
    '',
  );

  domains.forEach(function(d) {
    lines.push(
      'resource "aviatrix_segmentation_network_domain" "' + d.name + '" {',
      '  domain_name = "' + org + '-' + d.name + '"',
      '}',
      '',
    );
  });

  lines.push(
    '# ── Spoke association (one per application VPC) ───────────────',
    '# Associate each spoke gateway with its domain.',
    '# Duplicate this block for every additional application spoke.',
    '',
    '# Example: Prod spoke in AWS us-east-1',
    'resource "aviatrix_segmentation_network_domain_association" "prod_aws_use1" {',
    '  transit_gateway_name = "' + org + '-transit-aws-use1"',
    '  network_domain_name  = aviatrix_segmentation_network_domain.prod.domain_name',
    '  attachment_name      = "' + org + '-spoke-prod-aws-use1"  # spoke GW name or TGW attachment',
    '}',
    '',
  );

  lines.push('# ── Connection Policies ───────────────────────────────────────');
  policies.forEach(function(p) {
    var resourceName = 'allow_' + p[0] + '_to_' + p[1];
    lines.push(
      '# ' + p[2],
      'resource "aviatrix_segmentation_network_domain_connection_policy" "' + resourceName + '" {',
      '  domain_name_1 = aviatrix_segmentation_network_domain.' + p[0] + '.domain_name',
      '  domain_name_2 = aviatrix_segmentation_network_domain.' + p[1] + '.domain_name',
      '}',
      '',
    );
  });

  lines.push(
    '# ── Outputs ───────────────────────────────────────────────────',
    'output "network_domains" {',
    '  description = "Aviatrix Network Domain names"',
    '  value = {',
    '    prod   = aviatrix_segmentation_network_domain.prod.domain_name',
    '    dev    = aviatrix_segmentation_network_domain.dev.domain_name',
    '    mgmt   = aviatrix_segmentation_network_domain.mgmt.domain_name',
    '    shared = aviatrix_segmentation_network_domain.shared.domain_name',
    '  }',
    '}',
  );

  return lines.join('\n');
}

/* ────────────────────────────────────────────────────────────────
   7. COPILOT  —  aviatrix/copilot.tf
   CoPilot VM deployment: FlowIQ, topology, ThreatIQ, AppIQ.
   Separate VM in same VPC as Controller.
──────────────────────────────────────────────────────────────── */
function _genAviatrixCoPilotTF(state) {
  var org   = _orgSlug(state);
  var lines = [_avxHeader('Aviatrix CoPilot — Observability & Analytics')];

  lines.push(
    '# CoPilot: FlowIQ (NetFlow analytics), Dynamic Topology, AppIQ (path trace),',
    '# ThreatIQ (Proofpoint threat feeds), Network Behavior Analytics.',
    '# Deploy in the same VPC/account as the Controller.',
    '# Sizing: t3.2xlarge minimum (recommended: c5.4xlarge for >500 GWs or high flow volume)',
    '',
    'data "aws_ami" "aviatrix_copilot" {',
    '  most_recent = true',
    '  owners      = ["679593333241"]  # Aviatrix AWS Marketplace account',
    '  filter {',
    '    name   = "name"',
    '    values = ["aviatrix-copilot-*"]',
    '  }',
    '}',
    '',
    'resource "aws_instance" "aviatrix_copilot" {',
    '  ami                    = data.aws_ami.aviatrix_copilot.id',
    '  instance_type          = "c5.4xlarge"',
    '  subnet_id              = var.controller_subnet_id',
    '  vpc_security_group_ids = [aws_security_group.copilot_sg.id]',
    '  iam_instance_profile   = aws_iam_instance_profile.copilot_profile.name',
    '  ebs_optimized          = true',
    '',
    '  root_block_device {',
    '    volume_type           = "gp3"',
    '    volume_size           = 100  # GB — increase to 500+ for long retention',
    '    encrypted             = true',
    '    delete_on_termination = false',
    '  }',
    '',
    '  # Additional EBS for NetFlow storage (1 TB for ~6 months at moderate scale)',
    '  ebs_block_device {',
    '    device_name           = "/dev/sdb"',
    '    volume_type           = "gp3"',
    '    volume_size           = 1000',
    '    encrypted             = true',
    '    delete_on_termination = false',
    '  }',
    '',
    '  tags = {',
    '    Name      = "' + org + '-aviatrix-copilot"',
    '    ManagedBy = "Terraform"',
    '  }',
    '}',
    '',
    'resource "aws_security_group" "copilot_sg" {',
    '  name   = "' + org + '-copilot-sg"',
    '  vpc_id = var.controller_vpc_id',
    '',
    '  # HTTPS from controller + admin CIDRs',
    '  ingress {',
    '    from_port   = 443',
    '    to_port     = 443',
    '    protocol    = "tcp"',
    '    cidr_blocks = [var.admin_cidr, var.controller_private_ip + "/32"]',
    '  }',
    '',
    '  # NetFlow from all Aviatrix Gateways (UDP 31283)',
    '  ingress {',
    '    from_port   = 31283',
    '    to_port     = 31283',
    '    protocol    = "udp"',
    '    cidr_blocks = ["0.0.0.0/0"]  # Restrict to GW elastic IPs in production',
    '  }',
    '',
    '  egress {',
    '    from_port   = 0',
    '    to_port     = 0',
    '    protocol    = "-1"',
    '    cidr_blocks = ["0.0.0.0/0"]',
    '  }',
    '}',
    '',
    '# ── CoPilot integration with Controller ───────────────────────',
    'resource "aviatrix_copilot_association" "this" {',
    '  copilot_address = aws_instance.aviatrix_copilot.private_ip',
    '}',
    '',
    '# ── Outputs ───────────────────────────────────────────────────',
    'output "copilot_url" {',
    '  description = "CoPilot HTTPS URL (configure DNS CNAME in production)"',
    '  value       = "https://${aws_instance.aviatrix_copilot.public_ip}"',
    '}',
    '',
    'variable "controller_vpc_id"    {}',
    'variable "controller_subnet_id" {}',
    'variable "controller_private_ip" {}',
    'variable "admin_cidr" { description = "Admin source CIDR for UI access"; default = "10.0.0.0/8" }',
    '',
    '# ── ThreatIQ Notes ────────────────────────────────────────────',
    '# ThreatIQ is automatically activated in CoPilot once a customer ID is registered.',
    '# ThreatGuard (prevention) integrates with DCF rules — no additional TF config needed.',
    '# GeoBlocking: configure in CoPilot UI → Security → GeoBlocking.',
  );

  return lines.join('\n');
}
