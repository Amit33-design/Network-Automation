'use strict';

// ─── Visual Policy Editor (G-49) ─────────────────────────────────────────────
// Drag-and-drop policy chain builder: ACL / route-map / QoS
// Serialises to window.STATE.policies via window.policyToIntent()
// ES5 only — no arrow functions, no const/let, no template literals.

(function() {

  // ── Internal helpers ──────────────────────────────────────────────────────

  var _idSeq = 0;
  function _uid(prefix) {
    _idSeq += 1;
    return (prefix || 'id') + '-' + _idSeq;
  }

  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _injectStyles() {
    if (document.getElementById('policy-editor-style')) return;
    var style = document.createElement('style');
    style.id = 'policy-editor-style';
    style.textContent = [
      '.pe-card{background:var(--surface,#1e293b);border:1px solid var(--border,#334155);border-radius:8px;margin-bottom:16px;overflow:hidden;}',
      '.pe-card-header{padding:10px 14px;display:flex;align-items:center;gap:10px;}',
      '.pe-card-header.type-rm{border-left:4px solid #3b82f6;}',
      '.pe-card-header.type-acl{border-left:4px solid #f97316;}',
      '.pe-card-header.type-qos{border-left:4px solid #a855f7;}',
      '.pe-card-body{padding:12px;}',
      '.pe-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;}',
      '.pe-rule-table{width:100%;border-collapse:collapse;font-size:12px;}',
      '.pe-rule-table th{background:var(--surface2,#0f172a);color:var(--text-dim,#64748b);padding:5px 8px;font-weight:600;text-align:left;}',
      '.pe-rule-table td{padding:4px 6px;border-bottom:1px solid var(--border,#334155);vertical-align:middle;}',
      '.pe-rule-table input,.pe-rule-table select{background:var(--surface2,#0f172a);border:1px solid var(--border,#334155);color:var(--text,#e2e8f0);border-radius:4px;padding:2px 6px;font-size:11px;width:100%;}',
      '.pe-preview{background:var(--surface2,#0f172a);border:1px solid var(--border,#334155);border-radius:6px;padding:12px;font-family:monospace;font-size:12px;color:#86efac;white-space:pre;overflow:auto;max-height:300px;}',
      '.pe-card-title{flex:1;background:transparent;border:none;color:var(--text,#e2e8f0);font-size:14px;font-weight:600;outline:none;min-width:0;}',
      '.pe-card-title:focus{border-bottom:1px solid #3b82f6;}',
      '.pe-type-badge{font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;}',
      '.pe-type-badge.type-rm{background:#1e3a5f;color:#93c5fd;}',
      '.pe-type-badge.type-acl{background:#431407;color:#fdba74;}',
      '.pe-type-badge.type-qos{background:#3b0764;color:#d8b4fe;}',
      '.pe-btn{padding:5px 12px;border-radius:5px;border:none;cursor:pointer;font-size:12px;font-weight:600;}',
      '.pe-btn-primary{background:#2563eb;color:#fff;}',
      '.pe-btn-primary:hover{background:#1d4ed8;}',
      '.pe-btn-danger{background:#dc2626;color:#fff;}',
      '.pe-btn-danger:hover{background:#b91c1c;}',
      '.pe-btn-secondary{background:var(--surface2,#0f172a);color:var(--text,#e2e8f0);border:1px solid var(--border,#334155);}',
      '.pe-btn-secondary:hover{background:#334155;}',
      '.pe-btn-sm{padding:2px 7px;font-size:11px;border-radius:4px;border:none;cursor:pointer;font-weight:600;}',
      '.pe-btn-move{background:#1e3a5f;color:#93c5fd;}',
      '.pe-btn-move:hover{background:#1e40af;}',
      '.pe-btn-del{background:#431407;color:#fdba74;}',
      '.pe-btn-del:hover{background:#7c2d12;}',
      '.pe-add-rule{margin-top:8px;}',
      '.pe-empty{color:var(--text-dim,#64748b);font-size:13px;padding:20px;text-align:center;}',
      '.pe-section-label{font-size:11px;color:var(--text-dim,#64748b);font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;}'
    ].join('');
    document.head.appendChild(style);
  }

  function _findPol(id) {
    for (var i = 0; i < window.POLICY_STORE.length; i++) {
      if (window.POLICY_STORE[i].id === id) return window.POLICY_STORE[i];
    }
    return null;
  }

  function _findRule(pol, ruleId) {
    for (var i = 0; i < pol.rules.length; i++) {
      if (pol.rules[i].id === ruleId) return pol.rules[i];
    }
    return null;
  }

  // Recalculate seq numbers (10, 20, 30…) after any mutation
  function _reseq(pol) {
    for (var i = 0; i < pol.rules.length; i++) {
      pol.rules[i].seq = (i + 1) * 10;
    }
  }

  // ── Config generators ─────────────────────────────────────────────────────

  function _genRouteMapConfig(pol) {
    var lines = [];
    for (var i = 0; i < pol.rules.length; i++) {
      var r = pol.rules[i];
      var pfx = r.match.prefix || '';
      var action = r.action || 'permit';
      lines.push('route-map ' + _esc(pol.name) + ' ' + action + ' ' + r.seq);
      if (pfx && pfx !== 'any') {
        lines.push('  match ip address prefix-list PFX-' + _esc(pol.name) + '-' + r.seq);
      }
      if (r.match.community) {
        lines.push('  match community ' + _esc(r.match.community));
      }
      if (r.set.local_pref) {
        lines.push('  set local-preference ' + _esc(r.set.local_pref));
      }
      if (r.set.next_hop) {
        lines.push('  set ip next-hop ' + _esc(r.set.next_hop));
      }
      if (r.set.community) {
        lines.push('  set community ' + _esc(r.set.community));
      }
      if (r.set.dscp) {
        lines.push('  set dscp ' + _esc(r.set.dscp));
      }
      lines.push('!');
      if (pfx && pfx !== 'any') {
        lines.push('ip prefix-list PFX-' + _esc(pol.name) + '-' + r.seq + ' permit ' + _esc(pfx));
      }
    }
    return lines.join('\n');
  }

  function _genAclConfig(pol) {
    var lines = ['ip access-list extended ' + _esc(pol.name)];
    for (var i = 0; i < pol.rules.length; i++) {
      var r = pol.rules[i];
      var action = r.action || 'permit';
      var proto  = (r.match.protocol && r.match.protocol !== 'any') ? r.match.protocol : 'ip';
      var src    = (r.match.prefix && r.match.prefix !== 'any') ? r.match.prefix : 'any';
      // Normalise prefix to source/wildcard (simplified: use host or any)
      var srcStr = src;
      if (srcStr !== 'any' && srcStr.indexOf('/') === -1) {
        srcStr = 'host ' + srcStr;
      } else if (srcStr.indexOf('/') !== -1) {
        // Convert CIDR to address wildcard mask (basic)
        var parts  = srcStr.split('/');
        var addr   = parts[0];
        var bits   = parseInt(parts[1]);
        var hostBits = 32 - bits;
        // Build wildcard as 0.0.0.X style (simplified)
        var wcard = '0.0.' + (hostBits >= 16 ? '255.' : '0.') + (hostBits >= 8 ? '255' : (Math.pow(2, hostBits) - 1));
        srcStr = addr + ' ' + wcard;
      }
      lines.push('  ' + r.seq + ' ' + action + ' ' + proto + ' ' + srcStr + ' any');
    }
    return lines.join('\n');
  }

  function _genQosConfig(pol) {
    var lines = [];
    // Class-maps
    for (var i = 0; i < pol.rules.length; i++) {
      var r = pol.rules[i];
      var cmName = 'CM-' + _esc(pol.name) + '-' + r.seq;
      var matchDscp = (r.match.dscp && r.match.dscp !== 'any') ? r.match.dscp : '';
      lines.push('class-map match-all ' + cmName);
      if (matchDscp) {
        lines.push('  match dscp ' + matchDscp);
      } else {
        lines.push('  match any');
      }
      lines.push('!');
    }
    // Policy-map
    lines.push('policy-map PM-' + _esc(pol.name));
    for (var j = 0; j < pol.rules.length; j++) {
      var rr = pol.rules[j];
      var cmn = 'CM-' + _esc(pol.name) + '-' + rr.seq;
      lines.push('  class ' + cmn);
      if (rr.set.dscp) {
        lines.push('    set dscp ' + _esc(rr.set.dscp));
      }
      if (rr.action === 'deny') {
        lines.push('    drop');
      }
    }
    return lines.join('\n');
  }

  // ── Rule table HTML ───────────────────────────────────────────────────────

  var DSCP_OPTS = ['any','ef','af41','af31','af21','af11','cs3','cs2','cs1'];
  var PROTO_OPTS = ['any','tcp','udp','icmp'];
  var ACTION_OPTS = ['permit','deny'];
  var DSCP_SET_OPTS = ['','ef','af41','af31','af21','af11','cs3','cs2','cs1'];

  function _dscpSelect(polId, ruleId, field, currentVal) {
    var opts = '';
    var list = (field === 'set') ? DSCP_SET_OPTS : DSCP_OPTS;
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      var label = v === '' ? '— no-set —' : v;
      var sel = (currentVal === v) ? ' selected' : '';
      opts += '<option value="' + _esc(v) + '"' + sel + '>' + _esc(label) + '</option>';
    }
    return '<select onchange="window._peRuleFieldChange(\'' + polId + '\',\'' + ruleId + '\',\'' + field + '_dscp\',' + 'this.value)">' + opts + '</select>';
  }

  function _protoSelect(polId, ruleId, currentVal) {
    var opts = '';
    for (var i = 0; i < PROTO_OPTS.length; i++) {
      var v = PROTO_OPTS[i];
      var sel = (currentVal === v) ? ' selected' : '';
      opts += '<option value="' + _esc(v) + '"' + sel + '>' + _esc(v) + '</option>';
    }
    return '<select onchange="window._peRuleFieldChange(\'' + polId + '\',\'' + ruleId + '\',\'match_protocol\',' + 'this.value)">' + opts + '</select>';
  }

  function _actionSelect(polId, ruleId, currentVal) {
    var opts = '';
    for (var i = 0; i < ACTION_OPTS.length; i++) {
      var v = ACTION_OPTS[i];
      var sel = (currentVal === v) ? ' selected' : '';
      opts += '<option value="' + _esc(v) + '"' + sel + '>' + _esc(v) + '</option>';
    }
    return '<select onchange="window._peRuleFieldChange(\'' + polId + '\',\'' + ruleId + '\',\'action\',' + 'this.value)">' + opts + '</select>';
  }

  function _renderRuleTable(pol) {
    if (!pol.rules.length) {
      return '<p class="pe-empty">No rules. Click "Add Rule" to create one.</p>';
    }
    var th = '<tr>' +
      '<th style="width:40px">Seq</th>' +
      '<th style="width:70px">Action</th>' +
      '<th>Match Prefix</th>' +
      '<th>Match DSCP</th>' +
      '<th>Match Proto</th>' +
      '<th>Set Next-Hop</th>' +
      '<th>Set DSCP</th>' +
      '<th style="width:80px">Set Local-Pref</th>' +
      '<th style="width:80px">Set Community</th>' +
      '<th style="width:60px">Move</th>' +
      '<th style="width:30px"></th>' +
    '</tr>';

    var rows = '';
    for (var i = 0; i < pol.rules.length; i++) {
      var r = pol.rules[i];
      var pid = pol.id;
      var rid = r.id;
      rows += '<tr>' +
        '<td><strong>' + r.seq + '</strong></td>' +
        '<td>' + _actionSelect(pid, rid, r.action) + '</td>' +
        '<td><input type="text" value="' + _esc(r.match.prefix) + '" placeholder="any"' +
          ' oninput="window._peRuleFieldChange(\'' + pid + '\',\'' + rid + '\',\'match_prefix\',this.value)"></td>' +
        '<td>' + _dscpSelect(pid, rid, 'match', r.match.dscp) + '</td>' +
        '<td>' + _protoSelect(pid, rid, r.match.protocol) + '</td>' +
        '<td><input type="text" value="' + _esc(r.set.next_hop) + '" placeholder="&mdash;"' +
          ' oninput="window._peRuleFieldChange(\'' + pid + '\',\'' + rid + '\',\'set_next_hop\',this.value)"></td>' +
        '<td>' + _dscpSelect(pid, rid, 'set', r.set.dscp) + '</td>' +
        '<td><input type="number" value="' + _esc(r.set.local_pref) + '" placeholder="&mdash;" min="0" max="65535"' +
          ' oninput="window._peRuleFieldChange(\'' + pid + '\',\'' + rid + '\',\'set_local_pref\',this.value)"></td>' +
        '<td><input type="text" value="' + _esc(r.set.community) + '" placeholder="&mdash;"' +
          ' oninput="window._peRuleFieldChange(\'' + pid + '\',\'' + rid + '\',\'set_community\',this.value)"></td>' +
        '<td>' +
          '<button class="pe-btn-sm pe-btn-move" onclick="window.policyRuleMove(\'' + pid + '\',\'' + rid + '\',\'up\')" title="Move up">&uarr;</button> ' +
          '<button class="pe-btn-sm pe-btn-move" onclick="window.policyRuleMove(\'' + pid + '\',\'' + rid + '\',\'down\')" title="Move down">&darr;</button>' +
        '</td>' +
        '<td>' +
          '<button class="pe-btn-sm pe-btn-del" onclick="window.policyRuleRemove(\'' + pid + '\',\'' + rid + '\')" title="Delete rule">&times;</button>' +
        '</td>' +
      '</tr>';
    }

    return '<table class="pe-rule-table"><thead>' + th + '</thead><tbody>' + rows + '</tbody></table>';
  }

  // ── Single policy card HTML ───────────────────────────────────────────────

  function _typeClass(type) {
    if (type === 'route-map') return 'type-rm';
    if (type === 'acl')       return 'type-acl';
    if (type === 'qos')       return 'type-qos';
    return 'type-rm';
  }

  function _typeLabel(type) {
    if (type === 'route-map') return 'Route-Map';
    if (type === 'acl')       return 'ACL';
    if (type === 'qos')       return 'QoS';
    return type;
  }

  function _renderPolicyCard(pol) {
    var tc = _typeClass(pol.type);
    var html = '<div class="pe-card" id="pe-card-' + pol.id + '">' +
      '<div class="pe-card-header ' + tc + '">' +
        '<span class="pe-type-badge ' + tc + '">' + _typeLabel(pol.type) + '</span>' +
        '<input class="pe-card-title" type="text" value="' + _esc(pol.name) + '"' +
          ' oninput="window._pePolicyNameChange(\'' + pol.id + '\',this.value)"' +
          ' placeholder="Policy name">' +
        '<button class="pe-btn pe-btn-danger" onclick="window.policyDelete(\'' + pol.id + '\')">Delete</button>' +
      '</div>' +
      '<div class="pe-card-body" id="pe-rules-' + pol.id + '">' +
        _renderRuleTable(pol) +
        '<button class="pe-btn pe-btn-secondary pe-add-rule" onclick="window.policyRuleAdd(\'' + pol.id + '\')">+ Add Rule</button>' +
      '</div>' +
    '</div>';
    return html;
  }

  // ── Re-render helpers (partial DOM updates) ───────────────────────────────

  function _refreshRules(polId) {
    var pol = _findPol(polId);
    if (!pol) return;
    var container = document.getElementById('pe-rules-' + polId);
    if (!container) { window.renderPolicyEditor(); return; }
    container.innerHTML =
      _renderRuleTable(pol) +
      '<button class="pe-btn pe-btn-secondary pe-add-rule" onclick="window.policyRuleAdd(\'' + polId + '\')">+ Add Rule</button>';
  }

  function _refreshAll() {
    var root = document.getElementById('policy-editor-root');
    if (!root) return;
    root.innerHTML = _buildEditorHTML();
  }

  // ── Build full editor HTML ────────────────────────────────────────────────

  function _buildEditorHTML() {
    var toolbar = '<div class="pe-toolbar">' +
      '<button class="pe-btn pe-btn-primary" onclick="window.policyAdd(\'route-map\')">+ Route-Map</button>' +
      '<button class="pe-btn pe-btn-primary" onclick="window.policyAdd(\'acl\')" style="background:#ea580c">+ ACL</button>' +
      '<button class="pe-btn pe-btn-primary" onclick="window.policyAdd(\'qos\')" style="background:#9333ea">+ QoS Policy</button>' +
      '<button class="pe-btn pe-btn-secondary" onclick="window.policyExport()">Export JSON</button>' +
      '<button class="pe-btn pe-btn-secondary" onclick="window._pePreviewAll()">Generate Config Preview</button>' +
    '</div>';

    var cards = '';
    if (!window.POLICY_STORE.length) {
      cards = '<p class="pe-empty">No policies yet. Use the buttons above to create one.</p>';
    } else {
      for (var i = 0; i < window.POLICY_STORE.length; i++) {
        cards += _renderPolicyCard(window.POLICY_STORE[i]);
      }
    }

    var preview = '<div id="pe-preview-section" style="display:none;">' +
      '<p class="pe-section-label">Config Preview</p>' +
      '<pre class="pe-preview" id="pe-preview-text"></pre>' +
    '</div>';

    return toolbar + cards + preview;
  }

  // ── Preview helper ────────────────────────────────────────────────────────

  window._pePreviewAll = function() {
    var cfg = window.policyGenConfig();
    var section = document.getElementById('pe-preview-section');
    var pre = document.getElementById('pe-preview-text');
    if (section) section.style.display = '';
    if (pre) pre.textContent = cfg;
  };

  // ── Field-change handler (called by oninput/onchange in rule rows) ────────

  window._peRuleFieldChange = function(polId, ruleId, field, value) {
    var pol = _findPol(polId);
    if (!pol) return;
    var r = _findRule(pol, ruleId);
    if (!r) return;

    if (field === 'action')           { r.action = value; }
    else if (field === 'match_prefix')   { r.match.prefix = value; }
    else if (field === 'match_dscp')     { r.match.dscp = value; }
    else if (field === 'match_protocol') { r.match.protocol = value; }
    else if (field === 'set_next_hop')   { r.set.next_hop = value; }
    else if (field === 'set_dscp')       { r.set.dscp = value; }
    else if (field === 'set_local_pref') { r.set.local_pref = value; }
    else if (field === 'set_community')  { r.set.community = value; }

    window.policyToIntent();
  };

  // ── Policy name change ────────────────────────────────────────────────────

  window._pePolicyNameChange = function(polId, value) {
    var pol = _findPol(polId);
    if (!pol) return;
    pol.name = value;
    window.policyToIntent();
  };

  // ═════════════════════════════════════════════════════════════════════════
  // Public API — exposed on window
  // ═════════════════════════════════════════════════════════════════════════

  // Policy store — single source of truth
  window.POLICY_STORE = [];

  // Render the full policy editor UI into #policy-editor-root
  window.renderPolicyEditor = function() {
    _injectStyles();
    var root = document.getElementById('policy-editor-root');
    if (!root) return;
    root.innerHTML = _buildEditorHTML();
  };

  // Add a new empty policy
  window.policyAdd = function(type) {
    type = type || 'route-map';
    var pol = {
      id:    _uid('pol'),
      name:  _typeLabel(type) + '-' + (window.POLICY_STORE.length + 1),
      type:  type,
      rules: []
    };
    window.POLICY_STORE.push(pol);
    window.policyToIntent();
    _refreshAll();
  };

  // Delete a policy by id
  window.policyDelete = function(id) {
    var idx = -1;
    for (var i = 0; i < window.POLICY_STORE.length; i++) {
      if (window.POLICY_STORE[i].id === id) { idx = i; break; }
    }
    if (idx !== -1) window.POLICY_STORE.splice(idx, 1);
    window.policyToIntent();
    _refreshAll();
  };

  // Add a rule to a policy
  window.policyRuleAdd = function(polId) {
    var pol = _findPol(polId);
    if (!pol) return;
    var rule = {
      id:     _uid('r'),
      seq:    (pol.rules.length + 1) * 10,
      action: 'permit',
      match:  { prefix: '', protocol: 'any', dscp: 'any', community: '' },
      set:    { next_hop: '', dscp: '', local_pref: '', community: '' }
    };
    pol.rules.push(rule);
    _reseq(pol);
    window.policyToIntent();
    _refreshRules(polId);
  };

  // Remove a rule from a policy
  window.policyRuleRemove = function(polId, ruleId) {
    var pol = _findPol(polId);
    if (!pol) return;
    var idx = -1;
    for (var i = 0; i < pol.rules.length; i++) {
      if (pol.rules[i].id === ruleId) { idx = i; break; }
    }
    if (idx !== -1) pol.rules.splice(idx, 1);
    _reseq(pol);
    window.policyToIntent();
    _refreshRules(polId);
  };

  // Move a rule up or down within a policy
  window.policyRuleMove = function(polId, ruleId, dir) {
    var pol = _findPol(polId);
    if (!pol) return;
    var idx = -1;
    for (var i = 0; i < pol.rules.length; i++) {
      if (pol.rules[i].id === ruleId) { idx = i; break; }
    }
    if (idx === -1) return;
    var newIdx = (dir === 'up') ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= pol.rules.length) return;
    var tmp = pol.rules[idx];
    pol.rules[idx]    = pol.rules[newIdx];
    pol.rules[newIdx] = tmp;
    _reseq(pol);
    window.policyToIntent();
    _refreshRules(polId);
  };

  // Generate CLI config preview for all policies (IOS-XE / NX-OS syntax)
  window.policyGenConfig = function() {
    if (!window.POLICY_STORE.length) return '! No policies defined.\n';
    var out = ['! NetDesign AI — Policy Config Preview', '! Generated: ' + new Date().toISOString(), ''];
    for (var i = 0; i < window.POLICY_STORE.length; i++) {
      var pol = window.POLICY_STORE[i];
      out.push('! ── ' + pol.name + ' (' + pol.type + ') ──────────────');
      if (pol.type === 'route-map') {
        out.push(_genRouteMapConfig(pol));
      } else if (pol.type === 'acl') {
        out.push(_genAclConfig(pol));
      } else if (pol.type === 'qos') {
        out.push(_genQosConfig(pol));
      }
      out.push('');
    }
    return out.join('\n');
  };

  // Export POLICY_STORE as a JSON file download
  window.policyExport = function() {
    var json = JSON.stringify(window.POLICY_STORE, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = 'policies.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function() {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  };

  // Serialize POLICY_STORE into STATE.policies (intent format)
  window.policyToIntent = function() {
    if (window.STATE) {
      window.STATE.policies = window.POLICY_STORE;
    }
  };

}());
