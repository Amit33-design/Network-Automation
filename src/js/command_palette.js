/**
 * command_palette.js — G-47 Command Palette (Ctrl+K / Cmd+K)
 * NetDesign AI (NDAL v1.0)
 *
 * Exposes window.initCommandPalette()
 * Auto-inits on DOMContentLoaded (or immediately if DOM is already ready).
 */

(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Command registry                                                      */
  /* ------------------------------------------------------------------ */
  var COMMANDS = [
    // Navigation
    { id: 'step1',     label: 'Go to Step 1 — Use Case & Requirements',   category: 'Navigate', action: function () { window.goToStep && window.goToStep(1); } },
    { id: 'step2',     label: 'Go to Step 2 — BOM & Topology',            category: 'Navigate', action: function () { window.goToStep && window.goToStep(2); } },
    { id: 'step3',     label: 'Go to Step 3 — Generate Configs',          category: 'Navigate', action: function () { window.renderStep3 && window.renderStep3(); window.goToStep && window.goToStep(3); } },
    { id: 'step4',     label: 'Go to Step 4 — Deploy & Validate',         category: 'Navigate', action: function () { window.goToStep && window.goToStep(4); } },
    { id: 'step5',     label: 'Go to Step 5 — Monitoring',                category: 'Navigate', action: function () { window.goToStep && window.goToStep(5); } },
    { id: 'step6',     label: 'Go to Step 6 — ZTP / Automation',          category: 'Navigate', action: function () { window.goToStep && window.goToStep(6); } },
    { id: 'step7',     label: 'Go to Step 7 — Jinja Config Engine',       category: 'Navigate', action: function () { window.goToStep && window.goToStep(7); } },
    // Actions
    { id: 'gen-bom',   label: 'Generate BOM — build device list',         category: 'Action',   action: function () { var btn = document.getElementById('btn-generate-bom'); if (btn) btn.click(); } },
    { id: 'gen-cfg',   label: 'Generate Configs — all platforms',         category: 'Action',   action: function () { window.renderStep3 && window.renderStep3(); window.goToStep && window.goToStep(3); } },
    { id: 'exp-bom',   label: 'Export BOM — download CSV',                category: 'Export',   action: function () { window.exportBOM && window.exportBOM(); } },
    { id: 'exp-svg',   label: 'Export HLD — download SVG',                category: 'Export',   action: function () { window.exportHLDSvg && window.exportHLDSvg(); } },
    { id: 'exp-png',   label: 'Export HLD — download PNG',                category: 'Export',   action: function () { window.exportHLDPng && window.exportHLDPng(); } },
    { id: 'gen-ztp',   label: 'Generate ZTP scripts',                     category: 'Action',   action: function () { window.goToStep && window.goToStep(6); } },
    { id: 'gen-jinja', label: 'Open Jinja Config Engine',                 category: 'Action',   action: function () { window.renderJinjaPane && window.renderJinjaPane(); window.goToStep && window.goToStep(7); } },
    { id: 'dark',      label: 'Toggle dark/light theme',                  category: 'UI',       action: function () { document.body.classList.toggle('light-mode'); } },
    { id: 'reset',     label: 'Reset — clear all design state',           category: 'Danger',   action: function () { if (confirm('Reset all design state?')) { window.location.reload(); } } },
    { id: 'kbd',       label: 'Keyboard shortcuts — show this palette',   category: 'Help',     action: function () { /* opens itself — handled by open() call in Enter handler */ } },
  ];

  /* ------------------------------------------------------------------ */
  /* Fuzzy match                                                           */
  /* ------------------------------------------------------------------ */
  function fuzzyMatch(cmd, q) {
    if (!q) return true;
    var hay = (cmd.label + ' ' + cmd.category).toLowerCase();
    return q.toLowerCase().split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
  }

  /* ------------------------------------------------------------------ */
  /* State                                                                 */
  /* ------------------------------------------------------------------ */
  var selectedIndex = 0;
  var visibleCommands = [];

  /* ------------------------------------------------------------------ */
  /* CSS injection (only once)                                             */
  /* ------------------------------------------------------------------ */
  function injectStyles() {
    if (document.getElementById('cmd-palette-style')) return;
    var style = document.createElement('style');
    style.id = 'cmd-palette-style';
    style.textContent = [
      '#cmd-palette-overlay {',
      '  position: fixed; inset: 0; z-index: 9999;',
      '  background: rgba(0,0,0,.6); backdrop-filter: blur(4px);',
      '  display: flex; align-items: flex-start; justify-content: center; padding-top: 12vh;',
      '}',
      '#cmd-palette-box {',
      '  background: #1e293b; border: 1px solid #334155; border-radius: 10px;',
      '  width: min(640px, 92vw); max-height: 60vh;',
      '  display: flex; flex-direction: column; overflow: hidden;',
      '  box-shadow: 0 24px 64px rgba(0,0,0,.6);',
      '}',
      '#cmd-palette-header { padding: 12px 16px; border-bottom: 1px solid #334155; }',
      '#cmd-palette-input {',
      '  width: 100%; background: transparent; border: none; outline: none;',
      '  color: #e2e8f0; font-size: 16px; font-family: inherit;',
      '}',
      '#cmd-palette-list { overflow-y: auto; flex: 1; padding: 8px 0; }',
      '.cmd-item {',
      '  padding: 10px 16px; cursor: pointer; display: flex;',
      '  align-items: center; justify-content: space-between; gap: 12px;',
      '  font-size: 13px; color: #cbd5e1;',
      '}',
      '.cmd-item:hover, .cmd-item.cmd-active { background: #334155; color: #f1f5f9; }',
      '.cmd-item-label { flex: 1; }',
      '.cmd-item-cat {',
      '  font-size: 10px; padding: 2px 7px; border-radius: 3px;',
      '  background: #0f172a; color: #64748b; white-space: nowrap;',
      '}',
      '.cmd-item-cat.cat-danger { color: #ef4444; background: #450a0a20; }',
      '#cmd-palette-footer {',
      '  padding: 8px 16px; border-top: 1px solid #1e293b;',
      '  font-size: 11px; color: #475569; text-align: center;',
      '}',
    ].join('\n');
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------ */
  /* DOM construction (only once)                                          */
  /* ------------------------------------------------------------------ */
  function buildDOM() {
    if (document.getElementById('cmd-palette-overlay')) return;

    var overlay = document.createElement('div');
    overlay.id = 'cmd-palette-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = [
      '<div id="cmd-palette-box">',
      '  <div id="cmd-palette-header">',
      '    <input id="cmd-palette-input" type="text"',
      '           placeholder="Search actions… (Esc to close)"',
      '           autocomplete="off" spellcheck="false">',
      '  </div>',
      '  <div id="cmd-palette-list"></div>',
      '  <div id="cmd-palette-footer">↑↓ navigate · Enter select · Esc close</div>',
      '</div>',
    ].join('');

    document.body.appendChild(overlay);
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                             */
  /* ------------------------------------------------------------------ */
  function renderList(query) {
    visibleCommands = COMMANDS.filter(function (cmd) { return fuzzyMatch(cmd, query); });
    selectedIndex = 0;

    var list = document.getElementById('cmd-palette-list');
    if (!list) return;

    list.innerHTML = visibleCommands.map(function (cmd, i) {
      var catClass = 'cmd-item-cat' + (cmd.category === 'Danger' ? ' cat-danger' : '');
      var activeClass = i === 0 ? ' cmd-active' : '';
      return [
        '<div class="cmd-item' + activeClass + '" data-index="' + i + '">',
        '  <span class="cmd-item-label">' + escapeHtml(cmd.label) + '</span>',
        '  <span class="' + catClass + '">' + escapeHtml(cmd.category) + '</span>',
        '</div>',
      ].join('');
    }).join('');

    // Attach click listeners
    var items = list.querySelectorAll('.cmd-item');
    for (var j = 0; j < items.length; j++) {
      items[j].addEventListener('click', onItemClick);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setActive(index) {
    var list = document.getElementById('cmd-palette-list');
    if (!list) return;
    var items = list.querySelectorAll('.cmd-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('cmd-active', i === index);
    }
    if (items[index]) {
      items[index].scrollIntoView({ block: 'nearest' });
    }
    selectedIndex = index;
  }

  /* ------------------------------------------------------------------ */
  /* Open / Close                                                          */
  /* ------------------------------------------------------------------ */
  function open() {
    var overlay = document.getElementById('cmd-palette-overlay');
    var input = document.getElementById('cmd-palette-input');
    if (!overlay || !input) return;

    overlay.style.display = 'flex';
    input.value = '';
    renderList('');
    input.focus();
  }

  function close() {
    var overlay = document.getElementById('cmd-palette-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  function executeCommand(cmd) {
    close();
    if (cmd && typeof cmd.action === 'function') {
      // Small delay so the overlay closes before any confirm() dialogs
      setTimeout(function () { cmd.action(); }, 10);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Event handlers                                                        */
  /* ------------------------------------------------------------------ */
  function onItemClick(e) {
    var item = e.currentTarget;
    var index = parseInt(item.getAttribute('data-index'), 10);
    if (!isNaN(index) && visibleCommands[index]) {
      executeCommand(visibleCommands[index]);
    }
  }

  function onInputKeydown(e) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive(Math.min(selectedIndex + 1, visibleCommands.length - 1));
        break;

      case 'ArrowUp':
        e.preventDefault();
        setActive(Math.max(selectedIndex - 1, 0));
        break;

      case 'Enter':
        e.preventDefault();
        if (visibleCommands[selectedIndex]) {
          executeCommand(visibleCommands[selectedIndex]);
        }
        break;

      case 'Escape':
        e.preventDefault();
        close();
        break;
    }
  }

  function onInputChange() {
    var input = document.getElementById('cmd-palette-input');
    if (!input) return;
    renderList(input.value.trim());
  }

  function onOverlayClick(e) {
    var box = document.getElementById('cmd-palette-box');
    // Close only when clicking the backdrop (outside the box)
    if (box && !box.contains(e.target)) {
      close();
    }
  }

  function onGlobalKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      var overlay = document.getElementById('cmd-palette-overlay');
      // Toggle: if already open, close it
      if (overlay && overlay.style.display !== 'none') {
        close();
      } else {
        open();
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Public init                                                           */
  /* ------------------------------------------------------------------ */
  window.initCommandPalette = function () {
    injectStyles();
    buildDOM();

    var input = document.getElementById('cmd-palette-input');
    var overlay = document.getElementById('cmd-palette-overlay');

    if (input) {
      input.addEventListener('keydown', onInputKeydown);
      input.addEventListener('input', onInputChange);
    }

    if (overlay) {
      overlay.addEventListener('click', onOverlayClick);
    }

    document.addEventListener('keydown', onGlobalKeydown);
  };

  /* ------------------------------------------------------------------ */
  /* Auto-init                                                             */
  /* ------------------------------------------------------------------ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.initCommandPalette);
  } else {
    window.initCommandPalette();
  }

}());
