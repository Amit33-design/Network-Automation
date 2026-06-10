'use strict';

/* ════════════════════════════════════════════════════════════════
   NETDESIGN AI — Capacity Model Engine
   Deterministic switch / device count for every use-case.

   Exported functions (global scope, consumed by scoring.js,
   topology.js, configgen.js):

     campusCapacity(endpoints, opts)  → { access, dist, core, … }
     dcCapacity(servers, opts)        → { leafs, spines, … }
     gpuCapacity(gpus, opts)          → { servers, tors, spines, … }
     wanCapacity(branches, opts)      → { cpe, hubRouters, … }
     capacityFromState(state)         → unified capacity object

   Formula basis:
     Campus  — 3-tier (Access / Distribution / Core)
     DC      — Leaf-Spine CLOS (ToR density + bandwidth-driven spine)
     GPU     — Non-blocking fat-tree (1:1 oversubscription target)
     WAN     — Hub-spoke / SD-WAN (one CPE per branch)
════════════════════════════════════════════════════════════════ */

/* ── 1. CAMPUS ───────────────────────────────────────────────────
   Access layer:
     Effective endpoints = endpoints × (1 + growth)
     Usable ports/switch = floor(portsPerSwitch × (1 - reserve))
     Access switches     = ceil(effective / usable) × sites

   Distribution layer:
     perPair   = 30   (Cisco/Arista recommendation: 20–40)
     distPairs = ceil(access / perPair)
     dist      = distPairs × (HA ? 2 : 1)

   Core layer:
     core = HA ? 2 : 1   (per site; multiplied by sites if multi-site)
──────────────────────────────────────────────────────────────── */
function campusCapacity(endpoints = 100, {
  portsPerSwitch = 48,
  reserve        = 0.10,   // 10 % port reservation (uplinks + spares)
  growth         = 0.25,   // 25 % 3-year growth factor
  redundancy     = 'ha',
  sites          = 1,
} = {}) {
  const ha        = redundancy === 'ha' || redundancy === 'full';
  const effective = Math.ceil(endpoints * (1 + growth));
  const usable    = Math.floor(portsPerSwitch * (1 - reserve));
  const access    = Math.ceil(effective / usable) * sites;

  // Distribution: one HA pair per 30 access switches
  const distPairs = Math.max(1, Math.ceil(access / 30));
  const dist      = distPairs * (ha ? 2 : 1);

  // Core: one HA pair for the whole campus (per site for multi-site)
  const core = (ha ? 2 : 1) * sites;

  // Per-zone breakdown (4-zone logical model used in HLD)
  const zones        = ['Floor-1', 'Floor-2', 'Server-Farm', 'IoT-Guest'];
  const zoneWeights  = [0.35, 0.30, 0.25, 0.10];         // % of access switches per zone
  const zoneAccess   = zones.map((z, i) =>
    Math.max(1, Math.round(access * zoneWeights[i])));

  return {
    // Totals
    access, dist, core, distPairs,
    // Inputs (for display)
    endpoints, effective, usable, portsPerSwitch, reserve, growth, sites,
    // Per-zone breakdown
    zones, zoneAccess,
    // Oversubscription info
    accessToDistRatio: (access / Math.max(1, distPairs)).toFixed(1),
  };
}

/* ── 2. DATA CENTER (LEAF-SPINE CLOS) ───────────────────────────
   Leaf (ToR) count:
     totalServerPorts = servers × nicsPerServer
     leafs = ceil(totalServerPorts / portsPerLeaf)

   Spine count:
     Standard HA EVPN CLOS → 4 spines (2 HA pairs) for most scales
     Very large (> 200 leaves) → ceil(leafs / 50) × 2

   Oversubscription check:
     downlink_bw = (portsPerLeaf − uplinkPerLeaf) × speed_Gbps
     uplink_bw   = uplinkPerLeaf × uplinkSpeed_Gbps
     oversub     = downlink_bw / uplink_bw
──────────────────────────────────────────────────────────────── */
function dcCapacity(servers = 100, {
  nicsPerServer   = 2,
  portsPerLeaf    = 48,
  uplinkPerLeaf   = 0,    // 0 = derive from oversubscription target
  serverSpeed     = 25,   // Gbps (server-facing ports)
  uplinkSpeed     = 100,  // Gbps (spine-facing uplinks)
  spinePorts      = 36,   // ports on the selected spine model
  oversub         = 3,    // target oversubscription ratio N:1
  redundancy      = 'ha',
} = {}) {
  const ha            = redundancy === 'ha' || redundancy === 'full';
  const totalPorts    = servers * nicsPerServer;

  // Uplinks per leaf: honour explicit value, else derive from the
  // oversubscription target (CLAUDE.md §6 formula):
  //   uplinksNeeded = ceil(downlinkCapacity / oversub / uplinkSpeed)
  const upNeeded = uplinkPerLeaf > 0
    ? uplinkPerLeaf
    : Math.max(2, Math.ceil(portsPerLeaf * serverSpeed / (Math.max(1, oversub) * uplinkSpeed)));

  const serverPorts   = Math.max(1, portsPerLeaf - upNeeded); // downlink ports per leaf
  const leafs         = Math.max(2, Math.ceil(totalPorts / serverPorts));

  // Spine: uplink-driven CLOS count (HA floor of 4 / 2)
  const totalUplinks  = leafs * upNeeded;
  const spines        = Math.max(ha ? 4 : 2, Math.ceil(totalUplinks / Math.max(1, spinePorts)));
  const uplinkPerLeafUsed = upNeeded;

  // Bandwidth / actual oversubscription achieved
  const downlinkBW    = serverPorts * serverSpeed;             // Gbps per leaf
  const uplinkBW      = uplinkPerLeafUsed * uplinkSpeed;       // Gbps per leaf
  const oversubActual = (downlinkBW / Math.max(1, uplinkBW)).toFixed(2);

  // Function-label breakdown (PROD / STOR / DEV standard split)
  const prodLeafs = Math.ceil(leafs * 0.50);
  const storLeafs = Math.ceil(leafs * 0.25);
  const devLeafs  = leafs - prodLeafs - storLeafs;

  return {
    leafs, spines, totalPorts, serverPorts,
    servers, nicsPerServer, portsPerLeaf,
    uplinkPerLeaf: uplinkPerLeafUsed, totalUplinks, spinePorts,
    downlinkBW, uplinkBW, oversub: oversubActual,
    prodLeafs, storLeafs, devLeafs,
    serverSpeed, uplinkSpeed,
  };
}

/* ── 3. GPU / AI CLUSTER ────────────────────────────────────────
   Goal: non-blocking 1:1 oversubscription (RoCEv2 / RDMA).
   Math is vendor-agnostic — driven entirely by the selected switch
   model's port count and the GPU node count.

   One 400G NIC per GPU (ConnectX-7 style):
     servers   = ceil(gpus / gpusPerServer)
     totalNICs = gpus × nicsPerGpu

   Leaf port split for target oversubscription (1:1 → half/half):
     downPerTOR = floor(portsPerTOR × oversub / (oversub + 1))
     upPerTOR   = portsPerTOR − downPerTOR

   Standard fat-tree:
     tors = ceil(totalNICs / downPerTOR)

   Rail-optimized (NCCL training — one rail per GPU NIC position):
     rails         = gpusPerServer
     leavesPerRail = ceil(servers / downPerTOR)
     tors          = rails × leavesPerRail

   Spine (CLOS — uplink-driven):
     spines = ceil(tors × upPerTOR / spinePorts)

   Worked example (flagship 2048-GPU rail-optimized):
     8 GPUs/node × 256 nodes = 2048 × 400G GPU ports
     Leaf 64×400G → 32 down / 32 up (1:1)
     8 rails × ceil(256/32)=8 leaves/rail = 64 leaves
     64 × 32 = 2048 uplinks / 64 spine ports = 32 spines
──────────────────────────────────────────────────────────────── */
function gpuCapacity(gpus = 64, {
  gpusPerServer  = 8,
  nicsPerGpu     = 1,     // one RDMA NIC per GPU (modern training fabric)
  portsPerTOR    = 64,    // total ports on the selected leaf model
  spinePorts     = 64,    // ports on the selected spine model
  speed          = 400,   // Gbps per port
  oversub        = 1,     // target ratio — GPU fabrics are 1:1 non-blocking
  railOptimized  = false,
  topology       = 'fat-tree',
} = {}) {
  const servers    = Math.max(1, Math.ceil(gpus / gpusPerServer));
  const totalNICs  = gpus * nicsPerGpu;

  // Split leaf ports down:up at the target oversubscription ratio
  const downPerTOR = Math.max(1, Math.floor(portsPerTOR * oversub / (oversub + 1)));
  const upPerTOR   = Math.max(1, portsPerTOR - downPerTOR);

  let tors, rails = 0, leavesPerRail = 0;
  if (railOptimized) {
    rails         = gpusPerServer;                       // one rail per GPU NIC position
    leavesPerRail = Math.max(1, Math.ceil(servers / downPerTOR));
    tors          = rails * leavesPerRail;
  } else {
    tors = Math.max(2, Math.ceil(totalNICs / downPerTOR));
  }

  // Uplink-driven spine count (CLOS)
  const totalUplinks = tors * upPerTOR;
  const spines       = Math.max(2, Math.ceil(totalUplinks / spinePorts));

  // BW validation per TOR
  const torDownBW  = downPerTOR * speed;        // Gbps (server-facing)
  const torUpBW    = upPerTOR * speed;          // Gbps (spine-facing)
  const oversubActual = (torDownBW / torUpBW).toFixed(2);
  const isNonBlocking = parseFloat(oversubActual) <= 1.0;

  const railNote = railOptimized
    ? `${rails}-rail × ${leavesPerRail} leaves/rail (NCCL rail-optimized)`
    : `${topology} — enable rail-optimized topology for NCCL training`;

  return {
    gpus, servers, totalNICs, tors, spines,
    gpusPerServer, nicsPerGpu,
    nicsPerServer: gpusPerServer * nicsPerGpu,   // kept for display compat
    portsPerTOR, downPerTOR, upPerTOR, spinePorts, speed,
    rails, leavesPerRail, totalUplinks, railOptimized,
    torDownBW, torUpBW, oversub: oversubActual, isNonBlocking, railNote, topology,
  };
}

/* ── 4. WAN / SD-WAN ────────────────────────────────────────────
   CPE: one per branch (dual for HA branches)
   Hub routers: 2 HA pair at HQ minimum; add 1 per 20 branches
──────────────────────────────────────────────────────────────── */
function wanCapacity(branches = 4, {
  redundancy = 'ha',
} = {}) {
  const ha         = redundancy === 'ha' || redundancy === 'full';
  const cpe        = branches * (ha ? 2 : 1);
  const hubRouters = Math.max(2, Math.ceil(branches / 20) * 2);
  return { branches, cpe, hubRouters };
}

/* ── UNIFIED — derive capacity from UI STATE ─────────────────── */

/* Port count of the user-selected product for a layer (e.g. 'gpu-tor').
   products.js stores ports as strings like '64x 400GbE QSFP-DD' —
   parseInt extracts the leading count. Falls back to dflt when no
   product is selected yet (first scoring pass) or parse fails. */
function _selectedPorts(st, layerKey, dflt) {
  try {
    const pid = (st.selectedProducts || {})[layerKey];
    const p   = pid && typeof PRODUCTS === 'object' ? PRODUCTS[pid] : null;
    const n   = p ? parseInt(p.ports) : NaN;
    return n > 0 ? n : dflt;
  } catch (e) { return dflt; }
}

function capacityFromState(st) {
  st = st || (typeof STATE !== 'undefined' ? STATE : {});

  const uc        = st.uc || 'dc';
  const endpoints = parseInt(st.totalHosts) || 100;
  const sites     = parseInt(st.numSites)   || 1;
  const red       = st.redundancy || 'ha';
  const servers   = endpoints;   // for DC: totalHosts = servers
  const oversub   = parseInt(st.oversub) || 3;

  // GPU specifics
  const gpuSpecs   = Array.isArray(st.gpuSpecifics) ? st.gpuSpecifics : [];
  const gpuPerSrv  = parseInt(st.gpusPerServer) || 8;
  const railOpt    = gpuSpecs.some(s => /rail/i.test(s));
  // gpuCount: explicit GPU count if provided (e.g. "64 H100 GPUs" from NL parser),
  // otherwise totalHosts = GPU endpoints (one 400G NIC each). 1024 hosts →
  // 1024 × 400G ports → 32 leaves (32-down) + 16 spines (64-port) at 1:1.
  const gpuCount   = (parseInt(st.gpuCount) > 0)
    ? parseInt(st.gpuCount)
    : endpoints;
  // GPU training fabrics are 400G per port unless explicitly set otherwise
  const portSpeed  = parseInt(st.portSpeed) || parseInt(st.bwPerServer) || 400;

  // Prefer explicit counts if already set (from NL parser or backend)
  const explicitSpine = parseInt(st.spine_count) || 0;
  const explicitLeaf  = parseInt(st.leaf_count)  || 0;

  let campus = null, dc = null, gpu = null, wan = null;

  if (uc === 'campus' || uc === 'hybrid') {
    campus = campusCapacity(endpoints, {
      sites, redundancy: red,
      portsPerSwitch: _selectedPorts(st, 'campus-access', 48),
    });
  }
  if (uc === 'dc' || uc === 'hybrid' || uc === 'multisite') {
    // Multi-site / DCI: size each site for its share of endpoints,
    // then multiply the fabric by the number of sites.
    const dcSites      = (uc === 'multisite') ? Math.max(1, sites) : 1;
    const perSiteHosts = Math.max(1, Math.ceil(servers / dcSites));
    dc = dcCapacity(perSiteHosts, {
      redundancy:  red,
      oversub:     oversub,
      portsPerLeaf: _selectedPorts(st, 'dc-leaf', 48),
      spinePorts:   _selectedPorts(st, 'dc-spine', 36),
      serverSpeed:  parseInt(st.bwPerServer) || 25,
    });
    if (dcSites > 1) {
      dc.leafs    = dc.leafs  * dcSites;
      dc.spines   = dc.spines * dcSites;
      dc.sites    = dcSites;
      dc.perSiteHosts = perSiteHosts;
    }
    // Honour explicit counts if set
    if (explicitLeaf  > 0) dc.leafs  = explicitLeaf;
    if (explicitSpine > 0) dc.spines = explicitSpine;
  }
  if (uc === 'gpu') {
    gpu = gpuCapacity(gpuCount, {
      gpusPerServer: gpuPerSrv,
      speed:         portSpeed,
      portsPerTOR:   _selectedPorts(st, 'gpu-tor', 64),
      spinePorts:    _selectedPorts(st, 'gpu-spine', 64),
      oversub:       1,          // GPU training fabric — always 1:1 non-blocking
      railOptimized: railOpt,
    });
    if (explicitLeaf  > 0) gpu.tors   = explicitLeaf;
    if (explicitSpine > 0) gpu.spines = explicitSpine;
  }
  if (uc === 'wan') {
    const branches = parseInt(st.numSites) || 4;
    wan = wanCapacity(branches, { redundancy: red });
  }

  return { uc, campus, dc, gpu, wan };
}
