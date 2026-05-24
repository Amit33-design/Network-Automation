'use strict';

/* ════════════════════════════════════════════════════════════════
   Mermaid Topology Export
   Converts the BOM topology into Mermaid flowchart syntax that
   engineers can paste directly into GitHub, Confluence, Notion,
   or any Mermaid-compatible renderer for instant documentation.

   Public API (window.*):
     genMermaidTopology(state)   → string (Mermaid flowchart)
     copyMermaidToClipboard()    → copies to clipboard + toast
     downloadMermaidFile()       → downloads topology.mmd
     renderMermaidPanel()        → injects panel into #mermaid-panel
════════════════════════════════════════════════════════════════ */

/* ── Layer → Mermaid class + icon ────────────────────────────── */
var _LAYER_META = {
  'fw':            { cls: 'fw',     icon: '🔒', label: 'Firewall'       },
  'campus-core':   { cls: 'core',   icon: '⚙️', label: 'Core'           },
  'campus-dist':   { cls: 'dist',   icon: '🔀', label: 'Distribution'   },
  'campus-access': { cls: 'access', icon: '🔌', label: 'Access'         },
  'dc-spine':      { cls: 'spine',  icon: '🦴', label: 'DC Spine'       },
  'dc-leaf':       { cls: 'leaf',   icon: '🍃', label: 'DC Leaf'        },
  'gpu-spine':     { cls: 'gspine', icon: '🧠', label: 'GPU Spine'      },
  'gpu-tor':       { cls: 'tor',    icon: '⚡', label: 'GPU TOR'        },
  'wan-hub':       { cls: 'hub',    icon: '🌐', label: 'WAN Hub'        },
  'wan-branch':    { cls: 'branch', icon: '🏢', label: 'WAN Branch'     },
};

/* ── Sanitise a device name to a valid Mermaid node ID ──────── */
function _mmdId(name) {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}

/* ── Build adjacency list from cabling matrix (if available) ── */
function _buildEdges(devs) {
  var edges = [];
  if (typeof generateCablingMatrix !== 'function') return edges;
  if (typeof getLayersForUC !== 'function') return edges;
  try {
    var layerKeys = getLayersForUC();
    if (!layerKeys || !layerKeys.length) return edges;
    var cables = generateCablingMatrix(layerKeys, STATE);
    if (!cables || !cables.length) return edges;
    var seen = {};
    cables.forEach(function (cable) {
      var details = cable.details || [];
      details.forEach(function (d) {
        if (!d.deviceA || !d.deviceB) return;
        var key = [_mmdId(d.deviceA), _mmdId(d.deviceB)].sort().join('--');
        if (seen[key]) return;
        seen[key] = true;
        edges.push({
          a: d.deviceA, b: d.deviceB,
          speed: cable.speed || '', type: cable.cableType || ''
        });
      });
    });
  } catch (e) { /* ignore cabling errors — fallback to layer-derived edges */ }
  return edges;
}

/* ── Derive layer-to-layer edges when cabling unavailable ─────  */
function _deriveLayerEdges(devs) {
  var byLayer = {};
  devs.forEach(function (d) {
    if (!byLayer[d.layer]) byLayer[d.layer] = [];
    byLayer[d.layer].push(d);
  });

  var LAYER_PAIRS = [
    ['fw',           'campus-core'],
    ['fw',           'dc-spine'],
    ['campus-core',  'campus-dist'],
    ['campus-dist',  'campus-access'],
    ['dc-spine',     'dc-leaf'],
    ['gpu-spine',    'gpu-tor'],
    ['fw',           'gpu-spine'],
  ];

  var edges = [];
  LAYER_PAIRS.forEach(function (pair) {
    var upper = byLayer[pair[0]] || [];
    var lower = byLayer[pair[1]] || [];
    if (!upper.length || !lower.length) return;
    // Full-mesh if small, collapsed (first→all) if large
    var maxMesh = 4;
    if (upper.length <= maxMesh && lower.length <= maxMesh) {
      upper.forEach(function (u) {
        lower.forEach(function (l) {
          edges.push({ a: u.name, b: l.name, speed: '', type: '' });
        });
      });
    } else {
      // Spine-leaf: each leaf connects to each spine (up to 4 spines)
      var spines = upper.slice(0, 4);
      lower.forEach(function (l) {
        spines.forEach(function (s) {
          edges.push({ a: s.name, b: l.name, speed: '', type: '' });
        });
      });
    }
  });

  // WAN: branches to hub(s)
  (byLayer['campus-core'] || []).slice(0, 1).forEach(function (hub) {
    if (byLayer['campus-dist']) return; // only when no dist (WAN use case)
  });

  return edges;
}

/* ── Main generator ─────────────────────────────────────────── */
function genMermaidTopology(state) {
  if (typeof buildDeviceList !== 'function') {
    return 'graph TD\n  note["Complete Steps 1–3 first to generate topology"]\n';
  }

  var allDevs = buildDeviceList().filter(function (d) {
    return d.layer && d.layer.indexOf('mc-') !== 0;
  });

  if (!allDevs.length) {
    return 'graph TD\n  note["No devices — complete Steps 1–3"]\n';
  }

  var orgName = (state && state.orgName) ? state.orgName : 'NetDesign AI';
  var uc      = (state && state.uc) ? state.uc : '';
  var date    = new Date().toISOString().slice(0, 10);

  var lines = [];
  lines.push('---');
  lines.push('title: ' + orgName + ' Network Topology (' + date + ')');
  lines.push('---');
  lines.push('graph TD');
  lines.push('');

  // ── Group devices by layer ──────────────────────────────────
  var byLayer = {};
  var layerOrder = [
    'fw', 'campus-core', 'campus-dist', 'campus-access',
    'dc-spine', 'dc-leaf', 'gpu-spine', 'gpu-tor'
  ];

  allDevs.forEach(function (d) {
    if (!byLayer[d.layer]) byLayer[d.layer] = [];
    byLayer[d.layer].push(d);
  });

  // Collect layers that exist in the design
  var presentLayers = layerOrder.filter(function (l) { return byLayer[l] && byLayer[l].length; });
  // Plus any layers not in the ordered list
  Object.keys(byLayer).forEach(function (l) {
    if (layerOrder.indexOf(l) === -1) presentLayers.push(l);
  });

  // ── Emit subgraph per layer with device nodes ───────────────
  presentLayers.forEach(function (layer) {
    var devList = byLayer[layer] || [];
    if (!devList.length) return;

    var meta    = _LAYER_META[layer] || { cls: 'generic', icon: '📦', label: layer };
    var sgLabel = meta.icon + ' ' + meta.label + ' (' + devList.length + ')';

    lines.push('  subgraph ' + _mmdId(layer) + ' ["' + sgLabel + '"]');

    devList.forEach(function (dev) {
      var nodeId   = _mmdId(dev.name);
      var hostname = (typeof generateHostnames === 'function')
        ? (generateHostnames([dev], STATE)[dev.id] || dev.name)
        : dev.name;

      // Get product model if available
      var prod  = PRODUCTS && STATE.selectedProducts && STATE.selectedProducts[layer]
        ? PRODUCTS[STATE.selectedProducts[layer]] : null;
      var model = prod ? prod.model : '';
      var label = hostname + (model ? '<br/><sub>' + model + '</sub>' : '');

      lines.push('    ' + nodeId + '["' + label + '"]');
    });

    lines.push('  end');
    lines.push('');
  });

  // ── Emit edges ──────────────────────────────────────────────
  lines.push('  %% Connections');
  var edges = _buildEdges(allDevs);
  if (!edges.length) {
    edges = _deriveLayerEdges(allDevs);
  }

  edges.forEach(function (e) {
    var idA = _mmdId(e.a);
    var idB = _mmdId(e.b);
    var lbl = '';
    if (e.speed && e.type) {
      lbl = '|' + e.speed + ' ' + e.type + '|';
    } else if (e.speed) {
      lbl = '|' + e.speed + '|';
    }
    lines.push('  ' + idA + ' --' + lbl + '-- ' + idB);
  });

  lines.push('');
  lines.push('  %% Styles');

  // ── Class definitions ────────────────────────────────────────
  var classDefs = [
    'classDef fw     fill:#ff4d4d22,stroke:#ff4d4d,color:#e0e4ef',
    'classDef core   fill:#1a7fff22,stroke:#1a7fff,color:#e0e4ef',
    'classDef dist   fill:#ff8c0022,stroke:#ff8c00,color:#e0e4ef',
    'classDef access fill:#00e87a22,stroke:#00e87a,color:#e0e4ef',
    'classDef spine  fill:#9955ff22,stroke:#9955ff,color:#e0e4ef',
    'classDef leaf   fill:#00d4ff22,stroke:#00d4ff,color:#e0e4ef',
    'classDef gspine fill:#ff6b9d22,stroke:#ff6b9d,color:#e0e4ef',
    'classDef tor    fill:#ffd70022,stroke:#ffd700,color:#e0e4ef',
    'classDef hub    fill:#1a7fff22,stroke:#1a7fff,color:#e0e4ef',
    'classDef branch fill:#00e87a22,stroke:#00e87a,color:#e0e4ef',
    'classDef generic fill:#44444422,stroke:#888,color:#e0e4ef',
  ];
  classDefs.forEach(function (cd) { lines.push('  ' + cd); });
  lines.push('');

  // ── Apply classes ────────────────────────────────────────────
  presentLayers.forEach(function (layer) {
    var devList = byLayer[layer] || [];
    if (!devList.length) return;
    var meta    = _LAYER_META[layer] || { cls: 'generic' };
    var nodeIds = devList.map(function (d) { return _mmdId(d.name); }).join(',');
    lines.push('  class ' + nodeIds + ' ' + meta.cls);
  });

  return lines.join('\n');
}

/* ── Copy to clipboard ───────────────────────────────────────── */
function copyMermaidToClipboard() {
  var text = genMermaidTopology(STATE);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () {
      if (typeof toast === 'function') toast('Mermaid diagram copied to clipboard', 'success');
    }).catch(function () {
      _mmdFallbackCopy(text);
    });
  } else {
    _mmdFallbackCopy(text);
  }
}

function _mmdFallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    if (typeof toast === 'function') toast('Mermaid diagram copied to clipboard', 'success');
  } catch (e) {
    if (typeof toast === 'function') toast('Copy failed — use the Download button', 'error');
  }
  document.body.removeChild(ta);
}

/* ── Download .mmd file ─────────────────────────────────────── */
function downloadMermaidFile() {
  var text = genMermaidTopology(STATE);
  var orgSlug = (STATE.orgName || 'netdesign').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  var blob = new Blob([text], { type: 'text/plain' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = orgSlug + '-topology.mmd';
  a.click();
  URL.revokeObjectURL(url);
  if (typeof toast === 'function') toast('Mermaid topology downloaded', 'success');
}

/* ── Render the panel into #mermaid-panel ────────────────────── */
function renderMermaidPanel() {
  var el = document.getElementById('mermaid-panel');
  if (!el) return;

  var text  = genMermaidTopology(STATE);
  var lines = text.split('\n').length;
  var devs  = (typeof buildDeviceList === 'function')
    ? buildDeviceList().filter(function (d) { return d.layer && d.layer.indexOf('mc-') !== 0; })
    : [];

  el.innerHTML = [
    '<div class="mmd-panel">',
    '  <div class="mmd-panel-hdr">',
    '    <div>',
    '      <div class="mmd-panel-title">Mermaid Topology Diagram</div>',
    '      <div class="mmd-panel-sub">' + devs.length + ' device' + (devs.length !== 1 ? 's' : '') + ' · ' + lines + ' lines · paste into GitHub, Confluence, or Notion</div>',
    '    </div>',
    '    <div class="mmd-panel-actions">',
    '      <button class="btn btn-ghost mmd-btn" onclick="copyMermaidToClipboard()" title="Copy to clipboard">📋 Copy</button>',
    '      <button class="btn btn-ghost mmd-btn" onclick="downloadMermaidFile()" title="Download .mmd file">⬇ Download</button>',
    '    </div>',
    '  </div>',
    '  <div class="mmd-hint">',
    '    Paste this into a <code>```mermaid</code> block in GitHub markdown, or use',
    '    <a href="https://mermaid.live" target="_blank" rel="noopener">mermaid.live</a> to preview.',
    '  </div>',
    '  <div class="mmd-code-wrap">',
    '    <pre class="mmd-code" id="mmd-code-pre">' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ── Expose public API ───────────────────────────────────────── */
window.genMermaidTopology      = genMermaidTopology;
window.copyMermaidToClipboard  = copyMermaidToClipboard;
window.downloadMermaidFile     = downloadMermaidFile;
window.renderMermaidPanel      = renderMermaidPanel;
