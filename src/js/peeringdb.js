'use strict';

/* ════════════════════════════════════════════════════════════════
   PEERINGDB INTEGRATION
   Fetches IX peering data from the PeeringDB public API and
   surfaces relevant IXPs and peer ASNs in the WAN / multicloud
   use-case panels.

   PeeringDB API is public + CORS-enabled — no proxy needed.
   All requests are read-only, no auth required.

   Public API (window.*):
     fetchPeeringData(asn)          → promise → { ix_list, nets }
     renderPeeringPanel()           → render panel in #peeringdb-panel
     window.peeringSearch()         → onclick handler
════════════════════════════════════════════════════════════════ */

var _PEERINGDB_BASE = 'https://www.peeringdb.com/api';

/* ── Fetch helpers ───────────────────────────────────────────── */
function _pdbGet(path) {
  return fetch(_PEERINGDB_BASE + path, {
    headers: { 'Accept': 'application/json' },
  }).then(function(r) {
    if (!r.ok) throw new Error('PeeringDB HTTP ' + r.status);
    return r.json();
  });
}

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: fetchPeeringData
   Given an ASN, returns the IXPs the ASN peers at + peer networks.
═══════════════════════════════════════════════════════════════ */
function fetchPeeringData(asn) {
  var cleanASN = parseInt(String(asn).replace(/[^0-9]/g, ''), 10);
  if (!cleanASN || isNaN(cleanASN)) return Promise.reject(new Error('Invalid ASN'));

  // 1. Look up the network record for this ASN
  return _pdbGet('/net?asn=' + cleanASN + '&depth=1').then(function(netData) {
    var nets = netData.data || [];
    if (!nets.length) throw new Error('ASN ' + cleanASN + ' not found in PeeringDB');
    var net = nets[0];

    // 2. Get the netixlan records (IXP connections for this ASN)
    return _pdbGet('/netixlan?asn=' + cleanASN + '&depth=2').then(function(nixData) {
      var nixlans = nixData.data || [];

      // 3. Collect unique IXP (ix) IDs
      var ixIDs = {};
      nixlans.forEach(function(nix) {
        var ixId = nix.ixlan && nix.ixlan.ix_id;
        if (ixId) ixIDs[ixId] = true;
      });

      // 4. Fetch peer ASNs at each IXP in parallel (limit to first 5 IXPs)
      var ixList = nixlans.map(function(nix) {
        return {
          ix_id:   nix.ixlan && nix.ixlan.ix_id,
          ix_name: nix.name || 'Unknown IXP',
          ipaddr4: nix.ipaddr4 || '',
          ipaddr6: nix.ipaddr6 || '',
          speed:   nix.speed || 0,
        };
      });

      var uniqueIXIDs = Object.keys(ixIDs).slice(0, 5).map(Number);
      var peerFetches = uniqueIXIDs.map(function(ixId) {
        return _pdbGet('/netixlan?ixlan__ix=' + ixId + '&depth=1&limit=50').then(function(d) {
          return { ix_id: ixId, peers: d.data || [] };
        }).catch(function() { return { ix_id: ixId, peers: [] }; });
      });

      return Promise.all(peerFetches).then(function(peerResults) {
        var peersByIX = {};
        peerResults.forEach(function(pr) {
          peersByIX[pr.ix_id] = pr.peers.filter(function(p) {
            return p.asn !== cleanASN;
          }).slice(0, 20);
        });

        return {
          asn:       cleanASN,
          net_name:  net.name || ('AS' + cleanASN),
          info_type: net.info_type || '',
          policy:    net.policy_general || '',
          ix_list:   ixList,
          peers_by_ix: peersByIX,
        };
      });
    });
  });
}
window.fetchPeeringData = fetchPeeringData;

/* ── Format speed ────────────────────────────────────────────── */
function _fmtSpeed(mbps) {
  if (!mbps) return '—';
  if (mbps >= 1000) return (mbps / 1000).toFixed(0) + 'G';
  return mbps + 'M';
}

/* ── HTML escape ─────────────────────────────────────────────── */
function _pdbEsc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Saved peering result ────────────────────────────────────── */
var _pdbLastResult = null;

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: renderPeeringPanel
   Renders the ASN lookup form + results into #peeringdb-panel
═══════════════════════════════════════════════════════════════ */
function renderPeeringPanel() {
  var container = document.getElementById('peeringdb-panel');
  if (!container) return;

  var ucOk = typeof STATE !== 'undefined' &&
             (STATE.uc === 'wan' || STATE.uc === 'multicloud' || STATE.uc === 'multisite' || !STATE.uc);

  if (!ucOk) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = [
    '<div class="form-card pdb-card">',
    '  <div class="form-card-head">',
    '    <div class="ico" style="background:rgba(255,160,50,.15)">🌐</div>',
    '    <div>',
    '      <h3>PeeringDB — IX Peering Data <span class="nb-badge-optional">WAN / Multicloud</span></h3>',
    '      <p>Look up Internet Exchange peering points and peer ASNs to inform WAN design, route policies, and multicloud connectivity planning.</p>',
    '    </div>',
    '  </div>',
    '  <div class="nb-form-row">',
    '    <div class="field" style="flex:1">',
    '      <label>Your ASN</label>',
    '      <input id="pdb-asn" class="nb-input" type="number" placeholder="e.g. 65000" min="1" max="4294967295">',
    '    </div>',
    '    <div class="field nb-btn-field">',
    '      <label>&nbsp;</label>',
    '      <button class="btn-action nb-connect-btn" onclick="peeringSearch()">Look up ASN</button>',
    '    </div>',
    '  </div>',
    '  <div id="pdb-results" style="display:none;margin-top:.9rem"></div>',
    '</div>',
  ].join('\n');
}
window.renderPeeringPanel = renderPeeringPanel;

/* ═══════════════════════════════════════════════════════════════
   UI callback: peeringSearch
═══════════════════════════════════════════════════════════════ */
function peeringSearch() {
  var asnEl = document.getElementById('pdb-asn');
  var asn   = asnEl ? asnEl.value.trim() : '';
  if (!asn) {
    if (typeof toast === 'function') toast('Enter an ASN number', 'error');
    return;
  }

  var btn = document.querySelector('.nb-connect-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Fetching…'; }
  var results = document.getElementById('pdb-results');
  if (results) results.style.display = 'none';

  fetchPeeringData(asn).then(function(data) {
    _pdbLastResult = data;
    _renderPeeringResults(data);
    if (typeof toast === 'function') {
      toast('PeeringDB: AS' + data.asn + ' — ' + data.ix_list.length + ' IXPs found', 'success');
    }
  }).catch(function(err) {
    if (typeof toast === 'function') toast('PeeringDB error: ' + err.message, 'error', 6000);
  }).then(function() {
    if (btn) { btn.disabled = false; btn.textContent = 'Look up ASN'; }
  });
}
window.peeringSearch = peeringSearch;

function _renderPeeringResults(data) {
  var el = document.getElementById('pdb-results');
  if (!el) return;

  var ixRows = data.ix_list.slice(0, 10).map(function(ix) {
    var peers = (data.peers_by_ix[ix.ix_id] || []);
    var peerStr = peers.slice(0, 6).map(function(p) {
      return '<span class="pdb-asn-badge">AS' + _pdbEsc(String(p.asn)) + '</span>';
    }).join(' ');
    if (peers.length > 6) peerStr += ' <span style="color:var(--txt3);font-size:.72rem">+' + (peers.length - 6) + ' more</span>';
    return [
      '<tr>',
      '  <td>' + _pdbEsc(ix.ix_name) + '</td>',
      '  <td><code>' + _pdbEsc(ix.ipaddr4 || '—') + '</code></td>',
      '  <td>' + _fmtSpeed(ix.speed) + '</td>',
      '  <td>' + (peerStr || '<span style="color:var(--txt3)">—</span>') + '</td>',
      '</tr>',
    ].join('');
  }).join('');

  el.innerHTML = [
    '<div class="pdb-summary">',
    '  <strong>' + _pdbEsc(data.net_name) + '</strong>',
    '  <span class="pdb-meta">AS' + data.asn + '</span>',
    '  <span class="pdb-meta">' + _pdbEsc(data.info_type) + '</span>',
    '  <span class="pdb-meta">Policy: ' + _pdbEsc(data.policy || '—') + '</span>',
    '</div>',
    data.ix_list.length ? [
      '<table class="nb-table pdb-table" style="margin-top:.6rem">',
      '  <thead><tr><th>IXP</th><th>Peering IP (v4)</th><th>Port</th><th>Sample Peers</th></tr></thead>',
      '  <tbody>' + (ixRows || '<tr><td colspan="4" style="color:var(--txt3)">No IXP sessions found</td></tr>') + '</tbody>',
      '</table>',
    ].join('') : '<div class="obs-placeholder" style="margin-top:.6rem">No IXP sessions recorded in PeeringDB for AS' + data.asn + '.</div>',
    data.ix_list.length ? [
      '<div class="nb-preview-actions" style="margin-top:.6rem">',
      '  <button class="btn-action checks-dl-btn" onclick="downloadPeeringReport()">⬇ Download IXP Report</button>',
      '  <span style="font-size:.72rem;color:var(--txt3);margin-left:.75rem">Data from <a href="https://www.peeringdb.com" target="_blank" style="color:var(--blue)">PeeringDB</a> (CC0)</span>',
      '</div>',
    ].join('') : '',
  ].join('');

  el.style.display = 'block';
}

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: downloadPeeringReport
   Downloads the last peering lookup as a CSV
═══════════════════════════════════════════════════════════════ */
function downloadPeeringReport() {
  if (!_pdbLastResult) {
    if (typeof toast === 'function') toast('Look up an ASN first', 'error');
    return;
  }
  var d   = _pdbLastResult;
  var ts  = new Date().toISOString().slice(0, 10);
  var csv = ['IXP Name,Peering IP v4,Port Speed,Sample Peer ASNs'];
  d.ix_list.forEach(function(ix) {
    var peers = (d.peers_by_ix[ix.ix_id] || []).slice(0, 10).map(function(p) { return 'AS' + p.asn; }).join(' ');
    csv.push([
      '"' + String(ix.ix_name).replace(/"/g, '""') + '"',
      ix.ipaddr4 || '',
      _fmtSpeed(ix.speed),
      '"' + peers + '"',
    ].join(','));
  });
  var blob = new Blob([csv.join('\n')], { type: 'text/csv' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = 'AS' + d.asn + '_peeringdb_' + ts + '.csv';
  document.body.appendChild(a); a.click();
  setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 500);
  if (typeof toast === 'function') toast('IXP report downloaded', 'success');
}
window.downloadPeeringReport = downloadPeeringReport;
