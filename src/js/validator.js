'use strict';

/* ════════════════════════════════════════════════════════════════
   REQUIREMENTS VALIDATOR

   Renders a live validation panel in Step 2 showing protocol
   compatibility warnings, scale advisories, and a capacity
   preview (device count + estimated cost) as requirements are
   filled in.

   Public API:
     validateRequirements(state) → { issues, errorCount, warnCount, infoCount }
     renderRequirementsPreview() → renders into #req-validator
════════════════════════════════════════════════════════════════ */

/* ── Validation rule table ───────────────────────────────────── */
var _RULES = [

  /* Protocol compatibility */
  {
    check: function(s) {
      return (s.underlayProto || []).includes('EIGRP') &&
        (s.preferredVendors || []).length > 0 &&
        !(s.preferredVendors || []).some(function(v) { return /cisco/i.test(v); });
    },
    level: 'error',
    msg:   'EIGRP is Cisco-proprietary — incompatible with selected vendors.',
    fix:   'Switch underlay to OSPF or BGP for multi-vendor environments.',
    tag:   'eigrp-vendor',
  },

  {
    check: function(s) {
      return (s.overlayProto || []).some(function(o) { return /VXLAN/i.test(o); }) &&
        !(s.underlayProto || []).includes('BGP');
    },
    level: 'warn',
    msg:   'VXLAN/EVPN control-plane requires BGP.',
    fix:   'Add BGP as underlay protocol, or use OSPF + BGP EVPN in combination.',
    tag:   'vxlan-no-bgp',
  },

  {
    check: function(s) {
      return (s.protoFeatures || []).includes('FlowSpec / BGP-FS') &&
        !(s.underlayProto || []).includes('BGP');
    },
    level: 'error',
    msg:   'FlowSpec (RFC 5575/8955) requires BGP to distribute flow routes.',
    fix:   'Add BGP to underlay protocols to enable FlowSpec distribution.',
    tag:   'flowspec-no-bgp',
  },

  {
    check: function(s) {
      return (s.overlayProto || []).some(function(o) { return /MPLS/i.test(o); }) &&
        !(s.underlayProto || []).includes('OSPF') &&
        !(s.underlayProto || []).includes('IS-IS');
    },
    level: 'warn',
    msg:   'MPLS/Segment Routing requires an IGP underlay (OSPF or IS-IS).',
    fix:   'Add OSPF or IS-IS to distribute loopback prefixes for MPLS label allocation.',
    tag:   'mpls-no-igp',
  },

  {
    check: function(s) {
      return (s.protoFeatures || []).includes('BGP Unnumbered (RFC 5549)') &&
        s.uc !== 'dc' && s.uc !== 'multisite' && s.uc !== 'gpu';
    },
    level: 'info',
    msg:   'BGP Unnumbered (RFC 5549) is designed for DC fabric — limited support in campus/WAN.',
    fix:   'Use numbered BGP peering for campus or WAN environments.',
    tag:   'bgp-unnumbered-non-dc',
  },

  /* Security / compliance */
  {
    check: function(s) {
      return (s.compliance || []).some(function(c) { return /pci/i.test(c); }) &&
        !(s.protoFeatures || []).includes('MACSec Link Encryption') &&
        !(s.overlayProto || []).includes('IPsec');
    },
    level: 'warn',
    msg:   'PCI-DSS requires encryption in transit — no MACSec or IPsec selected.',
    fix:   'Enable MACSec for L2 link encryption or IPsec for L3 overlay encryption.',
    tag:   'pci-no-encrypt',
  },

  {
    check: function(s) {
      return (s.compliance || []).some(function(c) { return /hipaa/i.test(c); }) &&
        (s.nac || []).length === 0;
    },
    level: 'warn',
    msg:   'HIPAA environments require network access control (NAC) for device identity.',
    fix:   'Enable 802.1X under Security Requirements.',
    tag:   'hipaa-no-nac',
  },

  {
    check: function(s) {
      return (s.compliance || []).some(function(c) { return /fedramp|dod|cmmc/i.test(c); }) &&
        !(s.protoFeatures || []).includes('MACSec Link Encryption');
    },
    level: 'warn',
    msg:   'FedRAMP/DoD/CMMC frameworks mandate link-layer encryption.',
    fix:   'Enable MACSec Link Encryption to satisfy data-in-transit requirements.',
    tag:   'fedramp-no-macsec',
  },

  /* Application / latency */
  {
    check: function(s) {
      var hasRT = (s.appTypes || []).some(function(a) { return /voice|video/i.test(a); });
      var hasBFD = (s.protoFeatures || []).includes('BFD Fast Failover');
      var hasProto = (s.underlayProto || []).length > 0;
      return hasRT && !hasBFD && hasProto;
    },
    level: 'warn',
    msg:   'Voice/video applications require fast failover — BFD not selected.',
    fix:   'Enable BFD Fast Failover (target: 300 ms detection) for real-time traffic.',
    tag:   'voice-no-bfd',
  },

  {
    check: function(s) {
      return s.latencySla === 'ultra' &&
        !(s.gpuSpecifics || []).some(function(g) { return /RoCE|InfiniBand/i.test(g); });
    },
    level: 'info',
    msg:   'Ultra-low latency (<5 µs) requires RDMA — no RoCEv2 or InfiniBand selected.',
    fix:   'Enable RoCEv2 or InfiniBand under GPU cluster specifics.',
    tag:   'ultra-latency-no-rdma',
  },

  {
    check: function(s) {
      return (s.appTypes || []).some(function(a) { return /nvme|iscsi|block/i.test(a); }) &&
        (s.overlayProto || []).length === 0;
    },
    level: 'info',
    msg:   'Block storage (iSCSI/NVMe-oF) benefits from a dedicated storage VLAN / overlay.',
    fix:   'Consider VXLAN for storage isolation or a dedicated storage fabric.',
    tag:   'storage-no-overlay',
  },

  /* Use-case specific */
  {
    check: function(s) {
      return s.uc === 'gpu' && (s.gpuSpecifics || []).length === 0;
    },
    level: 'info',
    msg:   'GPU cluster selected — specify RDMA transport to optimise fabric design.',
    fix:   'Enable RoCEv2 (Ethernet/PFC) or InfiniBand under GPU cluster specifics.',
    tag:   'gpu-no-rdma',
  },

  {
    check: function(s) {
      return s.uc === 'wan' &&
        !(s.underlayProto || []).includes('OSPF') &&
        !(s.underlayProto || []).includes('BGP') &&
        (s.underlayProto || []).length === 0;
    },
    level: 'info',
    msg:   'WAN design with no routing protocol selected.',
    fix:   'Add OSPF for DMVPN spoke routing, or BGP for Internet peering and path selection.',
    tag:   'wan-no-routing',
  },

  {
    check: function(s) {
      return (s.protoFeatures || []).includes('Multicast (PIM-SM)') &&
        !(s.appTypes || []).some(function(a) { return /voice|video|stream/i.test(a); });
    },
    level: 'info',
    msg:   'PIM-SM multicast enabled — no multicast application type (voice/video) selected.',
    fix:   'Add Voice/UC or Video Streaming under Application Flows.',
    tag:   'pim-no-app',
  },

  /* Scale */
  {
    check: function(s) {
      return (s.uc === 'campus' || s.uc === 'hybrid') &&
        parseInt(s.totalHosts) > 15000;
    },
    level: 'warn',
    msg:   'Campus design with >15 000 endpoints — consider a multi-site or DC fabric topology.',
    fix:   'Switch to Multi-Site DC/DCI or Hybrid use case for large-scale deployments.',
    tag:   'campus-too-large',
  },

  {
    check: function(s) {
      return s.uc === 'dc' && parseInt(s.totalHosts) > 0 && parseInt(s.totalHosts) < 8;
    },
    level: 'info',
    msg:   'DC fabric with fewer than 8 servers — a simpler 2-tier design may suffice.',
    fix:   'Consider Campus or Hybrid use case for small server deployments.',
    tag:   'dc-too-small',
  },

];

/* ── Validate ────────────────────────────────────────────────── */
function validateRequirements(state) {
  var issues = _RULES
    .filter(function(r) { return r.check(state); })
    .map(function(r) { return { level: r.level, msg: r.msg, fix: r.fix, tag: r.tag }; });
  return {
    issues:     issues,
    errorCount: issues.filter(function(i) { return i.level === 'error'; }).length,
    warnCount:  issues.filter(function(i) { return i.level === 'warn';  }).length,
    infoCount:  issues.filter(function(i) { return i.level === 'info';  }).length,
  };
}

/* ── Capacity preview ────────────────────────────────────────── */
function _buildCapacityRows(state) {
  if (typeof getLayersForUC !== 'function' || typeof estimateCounts !== 'function') return [];
  if (!state.uc) return [];

  var layers = getLayersForUC();
  var rows   = [];

  layers.forEach(function(layer) {
    var qty = estimateCounts(layer.key);
    if (qty <= 0) return;

    var prodId = state.selectedProducts && state.selectedProducts[layer.key];
    var prod = (typeof PRODUCTS !== 'undefined' && prodId) ? PRODUCTS[prodId] : null;

    var unitCost = prod ? (prod.estimatedCostUSD || 0) : 0;
    rows.push({
      key:      layer.key,
      label:    layer.label || layer.key,
      icon:     layer.icon || '🔌',
      qty:      qty,
      prodName: prod ? (prod.vendor + ' ' + (prod.model || prod.name)) : '(no product selected)',
      unitCost: unitCost,
      extCost:  unitCost * qty,
      selected: !!prod,
    });
  });

  return rows;
}

/* ── Render ──────────────────────────────────────────────────── */
function renderRequirementsPreview() {
  var el = document.getElementById('req-validator');
  if (!el) return;

  var state = typeof STATE !== 'undefined' ? STATE : {};

  /* Don't show anything until a use case is selected */
  if (!state.uc) { el.innerHTML = ''; return; }

  var result  = validateRequirements(state);
  var capRows = _buildCapacityRows(state);
  var totalDevices = capRows.reduce(function(s, r) { return s + r.qty; }, 0);
  var totalCost    = capRows.reduce(function(s, r) { return s + r.extCost; }, 0);
  var anySel       = capRows.some(function(r) { return r.selected; });

  /* ── Issue list ── */
  var issueHtml = '';
  if (result.issues.length) {
    issueHtml = result.issues.map(function(issue) {
      var clsMap = { error: 'rval-issue-error', warn: 'rval-issue-warn', info: 'rval-issue-info' };
      var iconMap = { error: '✗', warn: '⚠', info: 'ℹ' };
      return '<div class="rval-issue ' + clsMap[issue.level] + '">' +
        '<span class="rval-issue-icon">' + iconMap[issue.level] + '</span>' +
        '<div class="rval-issue-body">' +
          '<div class="rval-issue-msg">' + _esc(issue.msg) + '</div>' +
          '<div class="rval-issue-fix">Fix: ' + _esc(issue.fix) + '</div>' +
        '</div>' +
        '</div>';
    }).join('');
  } else {
    issueHtml = '<div class="rval-all-clear">✓ No protocol compatibility issues detected</div>';
  }

  /* ── Badge summary ── */
  var badges = '';
  if (result.errorCount) badges += '<span class="rval-badge rval-badge-error">' + result.errorCount + ' error' + (result.errorCount > 1 ? 's' : '') + '</span>';
  if (result.warnCount)  badges += '<span class="rval-badge rval-badge-warn">'  + result.warnCount  + ' warning' + (result.warnCount > 1 ? 's' : '')  + '</span>';
  if (result.infoCount)  badges += '<span class="rval-badge rval-badge-info">'  + result.infoCount  + ' advisory' + (result.infoCount > 1 ? 'ies' : 'y') + '</span>';
  if (!result.issues.length) badges = '<span class="rval-badge rval-badge-ok">All checks passed</span>';

  /* ── Capacity preview table ── */
  var capHtml = '';
  if (capRows.length > 0) {
    var capRows2 = capRows.map(function(r) {
      var costCell = r.selected && r.unitCost
        ? '<span style="color:var(--green)">$' + _fmt(r.extCost) + '</span>' +
          '<span style="color:var(--txt2);font-size:.72rem"> ($' + _fmt(r.unitCost) + '/ea)</span>'
        : '<span style="color:var(--txt2)">—</span>';
      return '<tr>' +
        '<td>' + r.icon + ' ' + _esc(r.label) + '</td>' +
        '<td style="text-align:center;font-weight:700;color:var(--cyan)">' + r.qty + '</td>' +
        '<td style="font-size:.78rem;color:var(--txt1)">' + _esc(r.prodName) + '</td>' +
        '<td style="white-space:nowrap">' + costCell + '</td>' +
        '</tr>';
    }).join('');

    var totalLine = anySel
      ? '<tr style="border-top:1px solid var(--border-hi)">' +
          '<td style="font-weight:700">Total</td>' +
          '<td style="text-align:center;font-weight:700;color:var(--cyan)">' + totalDevices + '</td>' +
          '<td></td>' +
          '<td style="font-weight:700;color:var(--green)">$' + _fmt(totalCost) + '</td>' +
        '</tr>'
      : '';

    capHtml =
      '<div class="rval-cap-wrap">' +
        '<div class="rval-cap-head">📦 Capacity Preview' +
          (totalDevices > 0 ? '<span class="rval-cap-count">' + totalDevices + ' estimated devices</span>' : '') +
        '</div>' +
        '<div class="rval-cap-note">' +
          (anySel
            ? 'Based on your requirements and selected products. Go to Step 3 to update product selections.'
            : 'Select products in Step 3 to see cost estimates.') +
        '</div>' +
        '<table class="rval-cap-table">' +
          '<thead><tr><th>Layer</th><th style="text-align:center">Qty</th><th>Product</th><th>Est. Cost</th></tr></thead>' +
          '<tbody>' + capRows2 + totalLine + '</tbody>' +
        '</table>' +
      '</div>';
  }

  el.innerHTML =
    '<div class="rval-panel">' +
      '<div class="rval-hdr">' +
        '<div class="rval-title">🔍 Design Validation</div>' +
        '<div class="rval-badges">' + badges + '</div>' +
      '</div>' +
      '<div class="rval-issues">' + issueHtml + '</div>' +
      capHtml +
    '</div>';
}

/* ── Helpers ─────────────────────────────────────────────────── */
function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _fmt(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000)    return Math.round(n / 1000) + 'K';
  return String(Math.round(n));
}

/* ── Exports ─────────────────────────────────────────────────── */
window.validateRequirements      = validateRequirements;
window.renderRequirementsPreview = renderRequirementsPreview;
