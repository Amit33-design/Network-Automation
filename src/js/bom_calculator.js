'use strict';

// calculateBOM() — deterministic port-math sizing, never AI-estimated.
//
// leafSku:  { downlink_count|ports, uplink_count|uplinks, uplink_speed_gbps, model }
// spineSku: { port_count|ports }
//
// intent:   full state object — topology, useCase, gpu
//
// GPU rail-optimized path (intent.useCase==='gpu' && intent.gpu.rail_optimized):
//   Each GPU NIC gets its own dedicated rail (leaf switch).
//   Formula:  rails = gpus_per_node
//             leaves_per_rail = ceil(nodes / leaf_downlinks)
//             total_leaves = rails * leaves_per_rail
//             total_uplinks = total_leaves * leaf_uplinks
//             spines = ceil(total_uplinks / spine_ports)
//
// Standard DC/campus path:
//   rawLeaves = ceil(endpoint_count / leaf_downlinks)
//   leafCount = even(rawLeaves)
//   uplinksNeeded = ceil(serverCapacity / oversubscription / uplink_speed)
//   spines = max(ceil(total_uplinks / spine_ports), 2)

window.calculateBOM = function(intent, leafSku, spineSku) {
  var topo         = intent.topology || {};
  var gpu          = intent.gpu      || {};
  var useCase      = intent.useCase  || '';

  var endpoint_count   = topo.endpoint_count   || 500;
  var bandwidth_gbps   = topo.bandwidth_gbps   || 25;
  var oversubscription = topo.oversubscription || 3;

  // Normalize SKU fields — support both naming conventions
  var leafDownlinks = leafSku.downlink_count || leafSku.ports || 48;
  var leafUplinkCnt = leafSku.uplink_count   || leafSku.uplinks || 8;
  var leafUplinkSpd = leafSku.uplink_speed_gbps || 100;
  var spinePorts    = spineSku.port_count    || spineSku.ports || 64;

  // ── GPU rail-optimized: 1 rail per GPU NIC, all nodes on every rail ────────
  if (useCase === 'gpu' && gpu.rail_optimized) {
    var gpusPerNode   = Math.max(1, parseInt(gpu.gpus_per_node) || 8);
    var rails         = gpusPerNode;
    var leavesPerRail = Math.ceil(endpoint_count / leafDownlinks);
    var totalLeaves   = rails * leavesPerRail;
    var totalUplinks  = totalLeaves * leafUplinkCnt;
    var spineCount    = Math.ceil(totalUplinks / spinePorts);

    return {
      leaf_count:        totalLeaves,
      spine_count:       spineCount,
      uplinks_per_leaf:  leafUplinkCnt,
      uplink_capacity_ok: true,
      rail_optimized:    true,
      rails:             rails,
      leaves_per_rail:   leavesPerRail,
      total_gpu_ports:   gpusPerNode * endpoint_count,
      trace: {
        servers_per_leaf:     leafDownlinks,
        raw_leaf_count:       totalLeaves,
        server_capacity_gbps: leafDownlinks * leafUplinkSpd,
        required_uplink_gbps: leafDownlinks * leafUplinkSpd,
        total_leaf_uplinks:   totalUplinks,
        gpus_per_node:        gpusPerNode,
        total_nodes:          endpoint_count
      },
      warning: null
    };
  }

  // ── Standard formula (DC / campus / non-rail GPU) ─────────────────────────
  var rawLeaves             = Math.ceil(endpoint_count / leafDownlinks);
  var leafCount             = rawLeaves % 2 === 0 ? rawLeaves : rawLeaves + 1; // even HA pairs

  var serverCapacityPerLeaf = leafDownlinks * bandwidth_gbps;
  var uplinksNeeded         = Math.ceil(serverCapacityPerLeaf / oversubscription / leafUplinkSpd);
  var uplinkOk              = uplinksNeeded <= leafUplinkCnt;

  var totalLeafUplinks      = leafCount * uplinksNeeded;
  var rawSpines             = Math.ceil(totalLeafUplinks / spinePorts);
  var spineCount            = Math.max(rawSpines, 2);

  return {
    leaf_count:         leafCount,
    spine_count:        spineCount,
    uplinks_per_leaf:   uplinksNeeded,
    uplink_capacity_ok: uplinkOk,
    rail_optimized:     false,
    trace: {
      servers_per_leaf:     leafDownlinks,
      raw_leaf_count:       rawLeaves,
      server_capacity_gbps: serverCapacityPerLeaf,
      required_uplink_gbps: serverCapacityPerLeaf / oversubscription,
      total_leaf_uplinks:   totalLeafUplinks
    },
    warning: !uplinkOk
      ? (leafSku.model || 'Leaf') + ' has only ' + leafUplinkCnt + '\xD7' +
        leafUplinkSpd + 'GbE uplinks but ' + uplinksNeeded +
        ' needed at ' + oversubscription + ':1 oversubscription'
      : null
  };
};
