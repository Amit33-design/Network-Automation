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

  return '# Config not available for device: ' + (device.name || device.id);
};
