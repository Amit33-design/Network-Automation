/**
 * NetDesign AI — User-Defined Policy Rules Editor
 * ================================================
 * Lets users author, save, version, and evaluate custom YAML policy rules
 * against the current design intent and generated configs.
 *
 * Relies on STATE (from state.js) for current intent.
 * API: /api/user-policies/*
 */

const PolicyRulesEditor = (() => {
  // ── State ─────────────────────────────────────────────────────────────────
  let _savedRulesets = [];   // [{id, name, version, rule_count, updated_at}]
  let _activeId      = null; // currently loaded ruleset id (null = unsaved)
  let _dirty         = false;

  const BACKEND_URL = (() => {
    try { return window.NETDESIGN_BACKEND_URL || ''; } catch { return ''; }
  })();

  // ── DOM helpers ───────────────────────────────────────────────────────────
  const $  = id => document.getElementById(id);
  const el = id => $(id);

  function _editorVal()   { return (el('pre-editor') || {}).innerText || ''; }
  function _setEditor(v)  { const e = el('pre-editor'); if (e) e.innerText = v; _dirty = true; _updateStatus('edited'); }

  // ── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    await _loadPacks();
    await _loadSavedRulesets();
    _bindEvents();
  }

  function _bindEvents() {
    const ed = el('pre-editor');
    if (ed) ed.addEventListener('input', () => { _dirty = true; _updateStatus('edited'); });
  }

  // ── Built-in packs ────────────────────────────────────────────────────────
  async function _loadPacks() {
    if (!BACKEND_URL) return _loadPacksOffline();
    try {
      const res  = await fetch(`${BACKEND_URL}/api/user-policies/packs`);
      const data = await res.json();
      _renderPackDropdown(data);
    } catch { _loadPacksOffline(); }
  }

  function _loadPacksOffline() {
    _renderPackDropdown([
      { id: 'ai_fabric',        name: 'AI / GPU Fabric Best Practices', rule_count: 7 },
      { id: 'dc_baseline',      name: 'Data Center Baseline',           rule_count: 6 },
      { id: 'security_baseline',name: 'Security Baseline',              rule_count: 4 },
    ]);
  }

  function _renderPackDropdown(packs) {
    const sel = el('pre-pack-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Load a built-in pack —</option>';
    packs.forEach(p => {
      const opt = document.createElement('option');
      opt.value       = p.id;
      opt.textContent = `${p.name} (${p.rule_count} rules)`;
      sel.appendChild(opt);
    });
  }

  async function loadPack() {
    const packId = (el('pre-pack-select') || {}).value;
    if (!packId) return;
    if (!BACKEND_URL) { _updateStatus('error', 'Backend not connected — cannot load pack'); return; }
    try {
      const res  = await fetch(`${BACKEND_URL}/api/user-policies/packs/${packId}`);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      _setEditor(data.yaml_content);
      _activeId = null;
      _updateStatus('loaded', `Pack "${packId}" loaded — edit and save to create a ruleset`);
    } catch (e) {
      _updateStatus('error', `Failed to load pack: ${e.message}`);
    }
  }

  // ── Saved rulesets ────────────────────────────────────────────────────────
  async function _loadSavedRulesets() {
    if (!BACKEND_URL) return;
    try {
      const res  = await fetch(`${BACKEND_URL}/api/user-policies`);
      _savedRulesets = await res.json();
      _renderRulesetList();
    } catch { /* no-op — backend may be offline */ }
  }

  function _renderRulesetList() {
    const ul = el('pre-ruleset-list');
    if (!ul) return;
    if (!_savedRulesets.length) {
      ul.innerHTML = '<li class="pre-list-empty">No saved rulesets yet.</li>';
      return;
    }
    ul.innerHTML = _savedRulesets.map(r => `
      <li class="pre-list-item" onclick="PolicyRulesEditor.openRuleset('${r.id}')">
        <span class="pre-list-name">${_esc(r.name)}</span>
        <span class="pre-list-meta">v${r.version} · ${r.rule_count} rules</span>
      </li>
    `).join('');
  }

  async function openRuleset(id) {
    if (!BACKEND_URL) return;
    try {
      const res  = await fetch(`${BACKEND_URL}/api/user-policies/${id}`);
      const data = await res.json();
      _setEditor(data.yaml_content);
      _activeId = id;
      _dirty    = false;
      _updateStatus('ok', `Loaded "${data.name}" v${data.version} (${data.rule_count} rules)`);
      _renderHistory(data.version_history || []);
    } catch (e) {
      _updateStatus('error', `Load failed: ${e.message}`);
    }
  }

  function _renderHistory(history) {
    const ul = el('pre-history-list');
    if (!ul) return;
    if (!history.length) { ul.innerHTML = '<li class="pre-list-empty">No history yet.</li>'; return; }
    ul.innerHTML = [...history].reverse().map(h => `
      <li class="pre-list-item pre-list-item--history">
        <span class="pre-list-name">v${h.version} — ${_esc(h.note || 'updated')}</span>
        <span class="pre-list-meta">${_formatDate(h.changed_at)}</span>
      </li>
    `).join('');
  }

  // ── Validate ─────────────────────────────────────────────────────────────
  async function validate() {
    const yaml = _editorVal().trim();
    if (!yaml) { _updateStatus('error', 'Editor is empty'); return; }

    if (!BACKEND_URL) { _updateStatus('warn', 'Backend not connected — online validation unavailable'); return; }

    _updateStatus('running', 'Validating…');
    try {
      const res  = await fetch(`${BACKEND_URL}/api/user-policies/validate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ yaml_content: yaml }),
      });
      const data = await res.json();
      if (data.valid) {
        _updateStatus('ok', `Valid — ${data.rule_count} rule${data.rule_count !== 1 ? 's' : ''} parsed`);
        _clearResults();
      } else {
        _updateStatus('error', 'Validation failed');
        _showErrors(data.errors || []);
      }
    } catch (e) {
      _updateStatus('error', `Validation error: ${e.message}`);
    }
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function save() {
    const yaml = _editorVal().trim();
    if (!yaml) { _updateStatus('error', 'Nothing to save'); return; }
    if (!BACKEND_URL) { _updateStatus('warn', 'Backend not connected — cannot save'); return; }

    const name  = (el('pre-ruleset-name') || {}).value || 'Untitled Ruleset';
    const note  = (el('pre-change-note')  || {}).value || '';
    _updateStatus('running', 'Saving…');

    try {
      let res, data;
      if (_activeId) {
        res  = await fetch(`${BACKEND_URL}/api/user-policies/${_activeId}`, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ name, yaml_content: yaml, change_note: note }),
        });
      } else {
        res  = await fetch(`${BACKEND_URL}/api/user-policies`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ name, yaml_content: yaml, change_note: note }),
        });
      }
      data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));

      _activeId = data.id;
      _dirty    = false;
      if (el('pre-change-note')) el('pre-change-note').value = '';
      _updateStatus('ok', `Saved "${data.name}" v${data.version}`);
      await _loadSavedRulesets();
      if (data.version_history) _renderHistory(data.version_history);
    } catch (e) {
      _updateStatus('error', `Save failed: ${e.message}`);
    }
  }

  // ── Evaluate ─────────────────────────────────────────────────────────────
  async function evaluate() {
    const yaml = _editorVal().trim();
    if (!yaml) { _updateStatus('error', 'Editor is empty'); return; }
    if (!BACKEND_URL) { _updateStatus('warn', 'Backend not connected'); return; }

    // Gather intent from STATE (state.js)
    const intent = _gatherIntent();
    _updateStatus('running', 'Evaluating…');
    _clearResults();

    try {
      const res  = await fetch(`${BACKEND_URL}/api/user-policies/evaluate-yaml`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ yaml_content: yaml, intent, configs: {} }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
      _renderResults(data);
      _updateStatus(
        data.gate_status === 'PASS' ? 'ok' : data.gate_status === 'WARN' ? 'warn' : 'error',
        `${data.gate_status} — ${data.fired_count}/${data.rule_count} rules fired`
      );
    } catch (e) {
      _updateStatus('error', `Evaluate error: ${e.message}`);
    }
  }

  function _gatherIntent() {
    try {
      // Pull from global STATE object (state.js)
      const s = window.STATE || {};
      return {
        uc:              s.uc              || '',
        orgSize:         s.orgSize         || '',
        redundancy:      s.redundancy      || '',
        protocols:       s.protocols       || [],
        gpuSpecifics:    s.gpuSpecifics    || [],
        security:        s.security        || [],
        compliance:      s.compliance      || [],
        selectedProducts: s.selectedProducts || {},
        vlanId:          s.vlanId          || 1,
        spineCount:      s.spineCount      || 0,
      };
    } catch { return {}; }
  }

  // ── Results rendering ─────────────────────────────────────────────────────
  function _renderResults(data) {
    const panel = el('pre-results-panel');
    if (!panel) return;

    const statusClass = {
      PASS:  'pre-gate-pass',
      WARN:  'pre-gate-warn',
      FAIL:  'pre-gate-fail',
      BLOCK: 'pre-gate-block',
    }[data.gate_status] || 'pre-gate-info';

    const statusIcon = { PASS: '✅', WARN: '⚠️', FAIL: '❌', BLOCK: '🚫' }[data.gate_status] || '⏳';

    let html = `
      <div class="pre-gate-badge ${statusClass}">
        ${statusIcon} ${data.gate_status}
        <span class="pre-gate-sub">${data.fired_count} of ${data.rule_count} rules fired</span>
      </div>
    `;

    if (data.violations.length) {
      html += `<div class="pre-result-group pre-group-fail">
        <div class="pre-group-title">Violations (${data.violations.length})</div>`;
      data.violations.forEach(v => {
        html += `<div class="pre-result-item">
          <span class="pre-sev pre-sev-${v.severity.toLowerCase()}">${v.severity}</span>
          <span class="pre-result-name">${_esc(v.name)}</span>
          <div class="pre-result-msg">${_esc(v.message)}</div>
        </div>`;
      });
      html += '</div>';
    }

    if (data.warnings.length) {
      html += `<div class="pre-result-group pre-group-warn">
        <div class="pre-group-title">Warnings (${data.warnings.length})</div>`;
      data.warnings.forEach(w => {
        html += `<div class="pre-result-item">
          <span class="pre-sev pre-sev-warn">WARN</span>
          <span class="pre-result-name">${_esc(w.name)}</span>
          <div class="pre-result-msg">${_esc(w.message)}</div>
        </div>`;
      });
      html += '</div>';
    }

    if (data.infos.length) {
      html += `<div class="pre-result-group pre-group-info">
        <div class="pre-group-title">Info (${data.infos.length})</div>`;
      data.infos.forEach(i => {
        html += `<div class="pre-result-item">
          <span class="pre-sev pre-sev-info">INFO</span>
          <span class="pre-result-name">${_esc(i.name)}</span>
          <div class="pre-result-msg">${_esc(i.message)}</div>
        </div>`;
      });
      html += '</div>';
    }

    if (!data.violations.length && !data.warnings.length && !data.infos.length) {
      html += '<div class="pre-all-clear">No rules fired — design passes all checks.</div>';
    }

    panel.innerHTML = html;
    panel.style.display = 'block';
  }

  function _clearResults() {
    const p = el('pre-results-panel');
    if (p) { p.innerHTML = ''; p.style.display = 'none'; }
  }

  function _showErrors(errors) {
    const p = el('pre-results-panel');
    if (!p) return;
    p.innerHTML = `<div class="pre-parse-errors"><strong>Parse errors:</strong><ul>
      ${errors.map(e => `<li>${_esc(e)}</li>`).join('')}
    </ul></div>`;
    p.style.display = 'block';
  }

  // ── Status bar ────────────────────────────────────────────────────────────
  function _updateStatus(state, msg) {
    const bar = el('pre-status-bar');
    if (!bar) return;
    const icons = { ok: '✅', error: '❌', warn: '⚠️', running: '⏳', loaded: '📂', edited: '✏️' };
    bar.textContent = `${icons[state] || ''} ${msg || ''}`.trim();
    bar.className   = `pre-status-bar pre-status-${state}`;
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function deleteActive() {
    if (!_activeId) { _updateStatus('warn', 'No saved ruleset loaded'); return; }
    if (!confirm('Delete this ruleset? This cannot be undone.')) return;
    try {
      await fetch(`${BACKEND_URL}/api/user-policies/${_activeId}`, { method: 'DELETE' });
      _activeId = null;
      _setEditor('');
      _clearResults();
      _updateStatus('ok', 'Ruleset deleted');
      await _loadSavedRulesets();
    } catch (e) {
      _updateStatus('error', `Delete failed: ${e.message}`);
    }
  }

  // ── Utilities ─────────────────────────────────────────────────────────────
  function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _formatDate(iso) {
    try { return new Date(iso).toLocaleString(); } catch { return iso || ''; }
  }

  return { init, loadPack, validate, save, evaluate, openRuleset, deleteActive };
})();

document.addEventListener('DOMContentLoaded', () => PolicyRulesEditor.init());
