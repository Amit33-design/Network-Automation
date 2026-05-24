'use strict';

// calculateBOM() — from CLAUDE.md §6 exactly. Never AI-estimate quantities.
// leafSku: { downlink_count, uplink_count, uplink_speed_gbps, model }
// spineSku: { port_count }
window.calculateBOM = function(intent, leafSku, spineSku) {
  var topo            = intent.topology || {};
  var endpoint_count  = topo.endpoint_count   || 500;
  var bandwidth_gbps  = topo.bandwidth_gbps   || 25;
  var oversubscription = topo.oversubscription || 3;

  // Leaf sizing
  var rawLeaves = Math.ceil(endpoint_count / leafSku.downlink_count);
  var leafCount = rawLeaves % 2 === 0 ? rawLeaves : rawLeaves + 1; // always even (HA pairs)

  // Uplink validation
  var serverCapacityPerLeaf = leafSku.downlink_count * bandwidth_gbps;  // Gbps
  var uplinksNeeded         = Math.ceil(serverCapacityPerLeaf / oversubscription / leafSku.uplink_speed_gbps);
  var uplinkOk              = uplinksNeeded <= leafSku.uplink_count;

  // Spine sizing
  var totalLeafUplinks = leafCount * uplinksNeeded;
  var rawSpines        = Math.ceil(totalLeafUplinks / spineSku.port_count);
  var spineCount       = Math.max(rawSpines, 2); // minimum 2 for HA

  return {
    leaf_count:        leafCount,
    spine_count:       spineCount,
    uplinks_per_leaf:  uplinksNeeded,
    uplink_capacity_ok: uplinkOk,
    trace: {
      servers_per_leaf:      leafSku.downlink_count,
      raw_leaf_count:        rawLeaves,
      server_capacity_gbps:  serverCapacityPerLeaf,
      required_uplink_gbps:  serverCapacityPerLeaf / oversubscription,
      total_leaf_uplinks:    totalLeafUplinks
    },
    warning: !uplinkOk
      ? leafSku.model + ' has only ' + leafSku.uplink_count + '\xD7' +
        leafSku.uplink_speed_gbps + 'GbE uplinks but ' + uplinksNeeded +
        ' needed at ' + oversubscription + ':1 oversubscription'
      : null
  };
};
