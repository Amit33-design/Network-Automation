'use strict';

// ─── G-01: NLP Intent Parser ──────────────────────────────────────────────────
// Parses free-text network design descriptions into structured intent fields.
// Two tiers:
//   1. Heuristic JS parser — works offline, no API key required
//   2. Claude AI parser  — calls Anthropic API if key is supplied (optional)

// ─── Heuristic patterns ───────────────────────────────────────────────────────

var NLP_PATTERNS = {

  useCase: [
    { re: /\b(gpu|ai[\s-]+(cluster|fabric)|rdma|rocev2|h100|a100|b200|dgx|nvlink|infiniband)\b/i,  val: 'gpu' },
    { re: /\b(aviatrix)\b/i,                                                                         val: 'aviatrix' },
    { re: /\b(multi[\s-]?cloud|hybrid[\s-]cloud)\b/i,                                               val: 'multicloud' },
    { re: /\b(multi[\s-]?site|dci|data[\s-]center[\s-]interconnect|inter[\s-]dc)\b/i,               val: 'multisite' },
    { re: /\b(wan|sd[\s-]?wan|mpls[\s-]?wan|site[\s-]to[\s-]site|remote[\s-]branch)\b/i,           val: 'wan' },
    { re: /\b(data[\s-]cent(er|re)|dc[\s-]fabric|leaf[\s-]spine|spine[\s-]leaf|clos|nexus[\s-]fab)\b/i, val: 'dc' },
    { re: /\b(campus|enterprise[\s-]lan|access[\s-]layer|wiring[\s-]closet|dist[\s-]access)\b/i,   val: 'campus' }
  ],

  scale: [
    { re: /\b(poc|proof[\s-]of[\s-]concept|lab|pilot|dev[\s-]env|small[\s-]scale)\b/i,    val: 'small' },
    { re: /\b(hyperscal|web[\s-]scale|massive|huge|tier[\s-]1|large[\s-]scale)\b/i,       val: 'large' },
    { re: /\blarge\b/i,                                                                     val: 'large' },
    { re: /\bmedium\b/i,                                                                    val: 'medium' },
    { re: /\bsmall\b/i,                                                                     val: 'small' }
  ],

  redundancy: [
    { re: /\b(full[\s-]redundan|dual[\s-]plane|quad[\s-]link|four[\s-]way)\b/i,           val: 'full' },
    { re: /\b(high[\s-]avail|ha[\s-]pair|\bha\b|dual[\s-]homed|active[\s-]active)\b/i,   val: 'ha' },
    { re: /\b(basic[\s-]redundan|single[\s-]uplink)\b/i,                                  val: 'basic' },
    { re: /\b(no[\s-]redundan|single[\s-]path|simplex)\b/i,                               val: 'none' }
  ],

  underlay: [
    { re: /\beigrp\b/i,                              val: 'eigrp' },
    { re: /\bis[\s-]?is\b/i,                          val: 'is-is' },
    { re: /\bospf\b/i,                               val: 'ospf' },
    { re: /\b(ebgp|ibgp|bgp)\b/i,                   val: 'bgp' },
    { re: /\bstatic[\s-]rout/i,                      val: 'static' }
  ],

  gpuTransport: [
    { re: /\b(infiniband|\bib\b)\b/i,   val: 'ib' },
    { re: /\b(rocev2|rdma|roce)\b/i,    val: 'rocev2' }
  ]
};

var NLP_VENDOR_MAP = {
  cisco:    /\bcisco\b/i,
  arista:   /\barista\b/i,
  juniper:  /\bjuniper\b/i,
  nvidia:   /\bnvidia\b/i,
  fortinet: /\bfortinet\b/i,
  hpe:      /\bhpe\b/i,
  dell:     /\bdell\b/i,
  extreme:  /\bextreme\b/i
};

var NLP_OVERLAY_MAP = {
  vxlan_evpn: /\b(vxlan|evpn)\b/i,
  mpls_sr:    /\b(mpls[\s-]?sr|segment[\s-]routing)\b/i,
  gre:        /\bgre\b/i,
  ipsec:      /\bipsec\b/i,
  geneve:     /\bgeneve\b/i,
  otv:        /\botv\b/i
};

var NLP_FEATURE_MAP = {
  bfd:       /\bbfd\b/i,
  ecmp:      /\becmp\b/i,
  vrf:       /\bvrf[\s-]?lite?\b/i,
  flowspec:  /\b(flowspec|bgp[\s-]fs)\b/i,
  ipv6:      /\bipv6\b/i,
  multicast: /\b(multicast|pim|igmp)\b/i,
  qos:       /\bqos\b/i
};

function _firstMatch(text, patterns) {
  for (var i = 0; i < patterns.length; i++) {
    if (patterns[i].re.test(text)) return patterns[i].val;
  }
  return null;
}

/**
 * Parse free-text into an intent object + confidence map.
 * confidence values: 'extracted' | 'inferred' | 'default'
 */
window.parseIntentHeuristic = function(text) {
  var intent = {};
  var conf   = {};

  // ── Single-value fields ────────────────────────────────────────────────────
  var uc = _firstMatch(text, NLP_PATTERNS.useCase);
  if (uc) { intent.useCase = uc; conf.useCase = 'extracted'; }

  var sc = _firstMatch(text, NLP_PATTERNS.scale);
  if (sc) { intent.scale = sc; conf.scale = 'extracted'; }

  var rd = _firstMatch(text, NLP_PATTERNS.redundancy);
  if (rd) { intent.redundancy = rd; conf.redundancy = 'extracted'; }

  var ul = _firstMatch(text, NLP_PATTERNS.underlay);
  if (ul) { intent.underlay = ul; conf.underlay = 'extracted'; }

  var gt = _firstMatch(text, NLP_PATTERNS.gpuTransport);
  if (gt) { intent.gpuTransport = gt; conf.gpuTransport = 'extracted'; }

  // ── Endpoint / server count ────────────────────────────────────────────────
  var cntM = text.match(/(\d[\d,]*)\s*(servers?|endpoints?|hosts?|nodes?|vms?|blades?|switches?)/i);
  if (cntM) {
    intent.endpointCount = parseInt(cntM[1].replace(/,/g,''), 10);
    conf.endpointCount = 'extracted';
  }

  // ── Bandwidth per server ───────────────────────────────────────────────────
  var bwM = text.match(/(\d+)\s*[Gg](b?[Ee]|bps)?[\s-]*(per[\s-]server|server|downlink|access|host)?/i);
  if (bwM) {
    var bw = parseInt(bwM[1], 10);
    if ([1, 10, 25, 100, 400].indexOf(bw) !== -1) {
      intent.bandwidth = bw;
      conf.bandwidth = 'extracted';
    }
  }

  // ── Oversubscription ratio ─────────────────────────────────────────────────
  var osM = text.match(/(\d+)\s*:\s*1\s*(oversub|ratio)/i) ||
            text.match(/oversub\w*[\s:=]+(\d+)/i);
  if (osM) {
    intent.oversubscription = parseInt(osM[1], 10);
    conf.oversubscription = 'extracted';
  }

  // ── Site name ─────────────────────────────────────────────────────────────
  var snM = text.match(/\b(site|dc|campus|location|facility)\s*[:\-]?\s*([A-Za-z][A-Za-z0-9 ]{1,30})/i);
  if (snM) {
    intent.siteName = snM[2].trim();
    conf.siteName = 'extracted';
  }

  // ── Site code from abbreviation like "IAD", "SJC", "LHR" ─────────────────
  var scM = text.match(/\b([A-Z]{3,5})\b/);
  if (scM && !intent.siteName) {
    intent.siteCode = scM[1];
    conf.siteCode = 'extracted';
  }

  // ── Vendors ───────────────────────────────────────────────────────────────
  var vendors = Object.keys(NLP_VENDOR_MAP).filter(function(v) {
    return NLP_VENDOR_MAP[v].test(text);
  });
  if (vendors.length) { intent.vendors = vendors; conf.vendors = 'extracted'; }

  // ── Overlay ───────────────────────────────────────────────────────────────
  var overlay = Object.keys(NLP_OVERLAY_MAP).filter(function(k) {
    return NLP_OVERLAY_MAP[k].test(text);
  });
  if (overlay.length) { intent.overlay = overlay; conf.overlay = 'extracted'; }

  // ── Protocol features ─────────────────────────────────────────────────────
  var features = Object.keys(NLP_FEATURE_MAP).filter(function(k) {
    return NLP_FEATURE_MAP[k].test(text);
  });
  if (features.length) { intent.features = features; conf.features = 'extracted'; }

  // ── Smart inferences ──────────────────────────────────────────────────────
  // DC fabric + no underlay stated → infer BGP
  if (intent.useCase === 'dc' && !intent.underlay) {
    intent.underlay = 'bgp'; conf.underlay = 'inferred';
  }
  // DC fabric + no overlay stated → infer VXLAN/EVPN
  if (intent.useCase === 'dc' && !intent.overlay) {
    intent.overlay = ['vxlan_evpn']; conf.overlay = 'inferred';
  }
  // GPU cluster → infer RoCEv2 if not stated
  if (intent.useCase === 'gpu' && !intent.gpuTransport) {
    intent.gpuTransport = 'rocev2'; conf.gpuTransport = 'inferred';
  }
  // GPU → NVIDIA if no vendor stated
  if (intent.useCase === 'gpu' && !intent.vendors) {
    intent.vendors = ['nvidia']; conf.vendors = 'inferred';
  }
  // Campus → OSPF underlay if not stated
  if (intent.useCase === 'campus' && !intent.underlay) {
    intent.underlay = 'ospf'; conf.underlay = 'inferred';
  }

  return { intent: intent, confidence: conf };
};

// ─── Form filler ─────────────────────────────────────────────────────────────

window.fillFormFromIntent = function(intent, conf) {
  var filled = [];

  function mark(el, field) {
    if (!el) return;
    el.classList.add('intent-filled');
    el.setAttribute('data-intent-conf', conf[field] || 'extracted');
  }

  if (intent.siteName) {
    var el = document.getElementById('inp-sitename');
    if (el) { el.value = intent.siteName; mark(el, 'siteName'); filled.push('Site Name'); }
  }
  if (intent.siteCode) {
    var el = document.getElementById('inp-sitecode');
    if (el) { el.value = intent.siteCode.toUpperCase().slice(0, 5); mark(el, 'siteCode'); filled.push('Site Code'); }
  }
  if (intent.useCase) {
    var el = document.getElementById('sel-usecase');
    if (el) { el.value = intent.useCase; mark(el, 'useCase'); filled.push('Use Case'); }
    if (window.onUseCaseChange) window.onUseCaseChange();
  }
  if (intent.scale) {
    var el = document.getElementById('sel-scale');
    if (el) { el.value = intent.scale; mark(el, 'scale'); filled.push('Scale'); }
  }
  if (intent.redundancy) {
    var el = document.getElementById('sel-redundancy');
    if (el) { el.value = intent.redundancy; mark(el, 'redundancy'); filled.push('Redundancy'); }
  }
  if (intent.endpointCount) {
    var el = document.getElementById('inp-endpoint-count');
    if (el) { el.value = intent.endpointCount; mark(el, 'endpointCount'); filled.push('Endpoint Count'); }
  }
  if (intent.bandwidth) {
    var el = document.getElementById('sel-bandwidth-gbps');
    if (el) { el.value = intent.bandwidth; mark(el, 'bandwidth'); filled.push('Bandwidth'); }
  }
  if (intent.oversubscription) {
    var el = document.getElementById('sel-oversubscription');
    if (el) { el.value = intent.oversubscription; mark(el, 'oversubscription'); filled.push('Oversubscription'); }
  }
  if (intent.vendors && intent.vendors.length) {
    document.querySelectorAll('.chk-vendor').forEach(function(cb) { cb.checked = false; });
    intent.vendors.forEach(function(v) {
      var cb = document.querySelector('.chk-vendor[value="' + v + '"]');
      if (cb) { cb.checked = true; mark(cb.closest('.checkbox-item'), 'vendors'); }
    });
    filled.push('Vendors');
  }
  if (intent.underlay) {
    var el = document.getElementById('sel-underlay');
    if (el) { el.value = intent.underlay; mark(el, 'underlay'); filled.push('Underlay'); }
  }
  if (intent.overlay && intent.overlay.length) {
    document.querySelectorAll('.chk-overlay').forEach(function(cb) { cb.checked = false; });
    intent.overlay.forEach(function(ov) {
      var cb = document.querySelector('.chk-overlay[value="' + ov + '"]');
      if (cb) { cb.checked = true; mark(cb.closest('.checkbox-item'), 'overlay'); }
    });
    filled.push('Overlay');
  }
  if (intent.features && intent.features.length) {
    intent.features.forEach(function(f) {
      var cb = document.querySelector('.chk-feature[value="' + f + '"]');
      if (cb) { cb.checked = true; mark(cb.closest('.checkbox-item'), 'features'); }
    });
    filled.push('Features');
  }
  if (intent.gpuTransport) {
    var el = document.getElementById('sel-gpu-transport');
    if (el) { el.value = intent.gpuTransport; mark(el, 'gpuTransport'); filled.push('GPU Transport'); }
  }

  return filled;
};

window.clearIntentHighlights = function() {
  document.querySelectorAll('.intent-filled').forEach(function(el) {
    el.classList.remove('intent-filled');
    el.removeAttribute('data-intent-conf');
  });
  var res = document.getElementById('nlp-result');
  if (res) { res.style.display = 'none'; res.innerHTML = ''; }
  var ta = document.getElementById('nlp-intent-text');
  if (ta) ta.value = '';
};

// ─── Claude AI parser (optional — requires Anthropic API key) ─────────────────

window.parseIntentAI = function(text, apiKey) {
  var SYSTEM = 'You are a network design assistant. Extract network design intent from the user text and return ONLY a compact JSON object with these optional fields:\n'
    + '  use_case: dc|campus|gpu|wan|multisite|multicloud|aviatrix\n'
    + '  scale: small|medium|large\n'
    + '  redundancy: none|basic|ha|full\n'
    + '  endpoint_count: integer\n'
    + '  bandwidth_gbps: 1|10|25|100|400\n'
    + '  oversubscription: integer 1-20\n'
    + '  vendors: array from [cisco,arista,juniper,nvidia,fortinet,hpe,dell,extreme]\n'
    + '  underlay: bgp|ospf|is-is|eigrp|static\n'
    + '  overlay: array from [vxlan_evpn,mpls_sr,gre,ipsec,geneve,otv,none]\n'
    + '  features: array from [bfd,ecmp,vrf,flowspec,ipv6,multicast,qos]\n'
    + '  gpu_transport: rocev2|ib|none\n'
    + '  site_name: string\n'
    + '  site_code: 3-5 char uppercase string\n'
    + 'Omit fields you cannot determine. Return ONLY valid JSON, no markdown, no explanation.';

  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: SYSTEM,
      messages: [{ role: 'user', content: text }]
    })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.error) throw new Error(data.error.message);
    var raw = data.content[0].text.trim()
      .replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
    var parsed = JSON.parse(raw);
    // Normalise key names from snake_case to camelCase
    return {
      useCase:       parsed.use_case,
      scale:         parsed.scale,
      redundancy:    parsed.redundancy,
      endpointCount: parsed.endpoint_count,
      bandwidth:     parsed.bandwidth_gbps,
      oversubscription: parsed.oversubscription,
      vendors:       parsed.vendors,
      underlay:      parsed.underlay,
      overlay:       parsed.overlay,
      features:      parsed.features,
      gpuTransport:  parsed.gpu_transport,
      siteName:      parsed.site_name,
      siteCode:      parsed.site_code
    };
  });
};
