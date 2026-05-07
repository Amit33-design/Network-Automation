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
  uplinkPerLeaf   = 4,
  serverSpeed     = 25,   // Gbps (server-facing ports)
  uplinkSpeed     = 100,  // Gbps (spine-facing uplinks)
  redundancy      = 'ha',
} = {}) {
  const ha            = redundancy === 'ha' || redundancy === 'full';
  const totalPorts    = servers * nicsPerServer;
  const serverPorts   = portsPerLeaf - uplinkPerLeaf; // downlink ports per leaf
  const leafs         = Math.max(2, Math.ceil(totalPorts / serverPorts));

  // Spine: 4 for standard scale, scale up for very large fabrics
  const spines = leafs <= 200
    ? (ha ? 4 : 2)
    : Math.ceil(leafs / 50) * 2;

  // Bandwidth / oversubscription
  const downlinkBW = serverPorts * serverSpeed;           // Gbps per leaf
  const uplinkBW   = uplinkPerLeaf * uplinkSpeed;         // Gbps per leaf
  const oversub    = (downlinkBW / uplinkBW).toFixed(2);  // e.g. "3.00"

  // Function-label breakdown (PROD / STOR / DEV standard split)
  const prodLeafs = Math.ceil(leafs * 0.50);
  const storLeafs = Math.ceil(leafs * 0.25);
  const devLeafs  = leafs - prodLeafs - storLeafs;

  return {
    leafs, spines, totalPorts, serverPorts,
    servers, nicsPerServer, portsPerLeaf, uplinkPerLeaf,
    downlinkBW, uplinkBW, oversub,
    prodLeafs, storLeafs, devLeafs,
    serverSpeed, uplinkSpeed,
  };
}

/* ── 3. GPU / AI CLUSTER ────────────────────────────────────────
   Goal: non-blocking 1:1 oversubscription (RoCEv2 / RDMA)

   Servers:
     servers = ceil(gpus / gpusPerServer)

   TOR switches:
     totalNICs = servers × nicsPerServer
     tors = ceil(totalNICs / portsPerTOR)

   Spine switches (non-blocking requirement):
     spines = max(2, tors)   // equal or greater for 1:1

   Bandwidth validation:
     leafDownBW = portsPerTOR × speed (Gbps)
     uplinkBW   = spines × speed       (one uplink per spine)
     → target oversub ≤ 1.0
──────────────────────────────────────────────────────────────── */
function gpuCapacity(gpus = 64, {
  gpusPerServer  = 8,
  nicsPerServer  = 2,
  portsPerTOR    = 32,
  speed          = 100,   // Gbps (per port, e.g. 100G/200G/400G)
  topology       = 'fat-tree',
} = {}) {
  const servers    = Math.max(1, Math.ceil(gpus / gpusPerServer));
  const totalNICs  = servers * nicsPerServer;
  const tors       = Math.max(2, Math.ceil(totalNICs / portsPerTOR));

  // Non-blocking spine count
  const spines     = Math.max(2, tors);

  // BW validation
  const torDownBW  = portsPerTOR * speed;       // Gbps (server-facing)
  const torUpBW    = spines * speed;            // Gbps (spine-facing — 1 per spine)
  const oversub    = (torDownBW / torUpBW).toFixed(2);
  const isNonBlocking = parseFloat(oversub) <= 1.0;

  // Rail-optimised topology note
  const railNote   = topology === 'rail' || topology === 'fat-tree'
    ? `${Math.ceil(tors / 2)}-rail fat-tree` : topology;

  return {
    gpus, servers, totalNICs, tors, spines,
    gpusPerServer, nicsPerServer, portsPerTOR, speed,
    torDownBW, torUpBW, oversub, isNonBlocking, railNote, topology,
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
function capacityFromState(st) {
  st = st || (typeof STATE !== 'undefined' ? STATE : {});

  const uc        = st.uc || 'dc';
  const endpoints = parseInt(st.totalHosts) || 100;
  const sites     = parseInt(st.numSites)   || 1;
  const red       = st.redundancy || 'ha';
  const servers   = endpoints;   // for DC: totalHosts = servers

  // GPU specifics
  const gpuSpecs   = Array.isArray(st.gpuSpecifics) ? st.gpuSpecifics : [];
  // gpuCount: use explicit GPU count if provided (e.g. "64 H100 GPUs" from NL parser),
  // otherwise totalHosts means GPU *servers* → multiply by GPUs-per-server.
  const gpuCount   = (parseInt(st.gpuCount) > 0)
    ? parseInt(st.gpuCount)
    : endpoints * gpuPerSrv;
  const gpuPerSrv  = parseInt(st.gpusPerServer) || 8;
  const portSpeed  = parseInt(st.portSpeed) || 100;

  // Prefer explicit counts if already set (from NL parser or backend)
  const explicitSpine = parseInt(st.spine_count) || 0;
  const explicitLeaf  = parseInt(st.leaf_count)  || 0;

  let campus = null, dc = null, gpu = null, wan = null;

  if (uc === 'campus' || uc === 'hybrid') {
    campus = campusCapacity(endpoints, { sites, redundancy: red });
  }
  if (uc === 'dc' || uc === 'hybrid' || uc === 'multisite') {
    dc = dcCapacity(servers, { redundancy: red });
    // Honour explicit counts if set
    if (explicitLeaf  > 0) dc.leafs  = explicitLeaf;
    if (explicitSpine > 0) dc.spines = explicitSpine;
  }
  if (uc === 'gpu') {
    gpu = gpuCapacity(gpuCount, {
      gpusPerServer: gpuPerSrv,
      speed: portSpeed,
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
