'use strict';

/* ════════════════════════════════════════════════════════════════
   INTENT MODEL — canonical JSON derived from STATE
   Every downstream artifact (topology, configs, deploy) derives
   from this single intent object — making the design deterministic
   and auditable.
════════════════════════════════════════════════════════════════ */

function buildIntentObject() {
  const protoAll = [
    ...(STATE.underlayProto || []),
    ...(STATE.overlayProto  || []),
    ...(STATE.protoFeatures || []),
  ];
  return {
    use_case:         STATE.uc || null,
    topology:         deriveTopology(),
    org:              STATE.orgName   || 'unnamed',
    scale:            STATE.orgSize   || null,
    sites:            parseInt(STATE.numSites) || 1,
    redundancy:       STATE.redundancy || null,
    traffic_pattern:  STATE.traffic || null,
    total_hosts:      parseInt(STATE.totalHosts) || null,
    bw_per_server:    STATE.bwPerServer || null,
    protocols: {
      underlay: STATE.underlayProto  || [],
      overlay:  STATE.overlayProto   || [],
      features: STATE.protoFeatures  || [],
    },
    security:         STATE.nac       || [],
    compliance:       STATE.compliance || [],
    firewall:         STATE.fwModel || null,
    vpn:              STATE.vpnType || null,
    app_types:        STATE.appTypes  || [],
    latency_sla:      STATE.latencySla || null,
    automation:       STATE.automation || null,
    gpu:              STATE.uc === 'gpu' || (STATE.gpuSpecifics || []).length > 0,
    rocev2:           (STATE.gpuSpecifics || []).includes('rocev2'),
    pfc:              (STATE.gpuSpecifics || []).includes('pfc'),
    sharp:            (STATE.gpuSpecifics || []).includes('sharp'),
    budget:           STATE.budget || null,
    vendor_preference: STATE.preferredVendors || [],
    selected_products: STATE.selectedProducts || {},
    _schema:          'netdesign-intent/v1',
    _generated:       new Date().toISOString(),
  };
}

function deriveTopology() {
  const map = {
    campus:    'access-distribution-core',
    dc:        'spine-leaf-clos',
    gpu:       'gpu-spine-tor-nonblocking',
    wan:       'hub-spoke-sdwan',
    hybrid:    'campus+spine-leaf',
    multisite: 'multi-site-dci-vxlan',
  };
  return map[STATE.uc] || null;
}

/* ── Render the intent JSON panel ───────────────────────────── */
function renderIntentPanel() {
  const el = document.getElementById('intent-json-pre');
  if (!el) return;
  const intent = buildIntentObject();
  el.innerHTML = syntaxHighlightJSON(JSON.stringify(intent, null, 2));

  // Badge: count non-empty top-level keys
  const badge = document.getElementById('intent-field-count');
  if (badge) {
    const filled = Object.entries(intent).filter(([k, v]) =>
      !k.startsWith('_') && v !== null && v !== '' &&
      !(Array.isArray(v) && v.length === 0) &&
      !(typeof v === 'object' && !Array.isArray(v) &&
        Object.values(v).every(x => !x || (Array.isArray(x) && !x.length)))
    ).length;
    badge.textContent = filled + ' fields';
  }
}

function syntaxHighlightJSON(json) {
  return json
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      match => {
        let cls = 'ij-num';
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? 'ij-key' : 'ij-str';
        } else if (/true|false/.test(match)) {
          cls = 'ij-bool';
        } else if (/null/.test(match)) {
          cls = 'ij-null';
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
}

/* ── Copy intent JSON to clipboard ─────────────────────────── */
function copyIntentJSON() {
  const intent = buildIntentObject();
  navigator.clipboard.writeText(JSON.stringify(intent, null, 2))
    .then(() => toast('Intent JSON copied to clipboard', 'success'))
    .catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = JSON.stringify(intent, null, 2);
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('Intent JSON copied', 'success');
    });
}

/* ── Toggle panel open/closed ───────────────────────────────── */
function toggleIntentPanel() {
  const body = document.getElementById('intent-panel-body');
  const arrow = document.getElementById('intent-panel-arrow');
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display  = isOpen ? 'none' : 'block';
  if (arrow) arrow.textContent = isOpen ? '▶' : '▼';
}

/* Hook: call after any STATE-mutating interaction */
function onIntentChanged() {
  renderIntentPanel();
}
