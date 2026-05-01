'use strict';

/* ── App State ───────────────────────────────────────────────────── */
const STATE = {
  step: 1,
  totalSteps: 6,
  uc: null,
  industry: null,
  orgName: '',
  orgSize: '',
  numSites: '',
  redundancy: '',
  traffic: 'ns',
  totalHosts: '',
  bwPerServer: '',
  oversub: 3,
  underlayProto: [],
  overlayProto: [],
  protoFeatures: [],
  fwModel: '',
  vpnType: '',
  compliance: [],
  nac: [],
  appTypes: [],
  latencySla: '',
  automation: '',
  gpuSpecifics: [],
  extraNotes: '',
  selectedProducts: {},   // layerKey → prodId
  // Phase 2 additions
  budget: '',             // smb | mid | enterprise | hyperscale
  preferredVendors: [],   // ['Cisco','Fortinet', ...]  — empty = any
  numSitesTopology: 3,    // for multi-site diagram (3-6)
};

/* ── Step metadata ───────────────────────────────────────────────── */
const STEPS = [
  { n: 1, label: 'Use Case',         id: 'step-1' },
  { n: 2, label: 'Requirements',     id: 'step-2' },
  { n: 3, label: 'Products',         id: 'step-3' },
  { n: 4, label: 'Design',           id: 'step-4' },
  { n: 5, label: 'Configuration',    id: 'step-5' },
  { n: 6, label: 'Deploy & Validate',id: 'step-6' },
];

const UC_LABELS = {
  campus:     'Campus / Enterprise LAN',
  dc:         'Data Center Fabric',
  gpu:        'AI / GPU Cluster',
  hybrid:     'Hybrid (Campus + DC)',
  wan:        'WAN / SD-WAN',
  multisite:  'Multi-Site DC / DCI',
};

/* ── Budget labels ───────────────────────────────────────────────── */
const BUDGET_LABELS = {
  smb:        'SMB  (< $50K)',
  mid:        'Mid-Market  ($50K – $500K)',
  enterprise: 'Enterprise  ($500K – $5M)',
  hyperscale: 'Hyperscale  ($5M+)',
};
