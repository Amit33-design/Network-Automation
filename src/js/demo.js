/* demo.js — Lab Demo API client (ZTP, Pre/Post Checks, Monitoring)
 * Loaded last in index.html; all functions exposed on window for inline handlers.
 */
(function () {
  'use strict';

  // ── Device list cache (for fault-injection selects) ───────────────────────

  let _devices = [];

  async function loadDeviceList() {
    try {
      const res = await fetch('/api/topology/devices');
      if (!res.ok) return;
      _devices = await res.json();

      ['ztp-fail-device', 'checks-fail-device'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        while (sel.options.length > 1) sel.remove(1);
        _devices.forEach(d => {
          sel.add(new Option(`${d.name}  (${d.role})`, d.name));
        });
      });
    } catch (_) { /* server not running — leave selects empty */ }
  }

  // ── ZTP ───────────────────────────────────────────────────────────────────

  async function loadZTPTopology() {
    try {
      const res = await fetch('/api/topology');
      if (!res.ok) return;
      const d = await res.json();
      _setText('ztp-total',    d.total);
      _setText('ztp-routers',  d.routers);
      _setText('ztp-switches', d.switches);
      _setText('ztp-firewalls', d.firewalls);
      _setText('ztp-lbs',      d.load_balancers);
      _setText('ztp-gpu-fws',  d.gpu_firewalls);
      _setText('ztp-gpu-srvs', d.gpu_servers);
    } catch (_) {}
  }

  window.runZTP = async function () {
    const failDevice = _val('ztp-fail-device');
    const failAt     = _val('ztp-fail-at');
    const payload    = failDevice ? { fail_device: failDevice, fail_at: failAt } : {};

    await _withBtn('ztp-run-btn', 'Running…', async () => {
      const data = await _post('/api/ztp/run', payload);
      _renderZTPResults(data);
      window.showToast(`ZTP complete — ${data.summary.online} online, ${data.summary.failed} failed`,
        data.summary.failed ? 'warning' : 'success');
    });
  };

  function _renderZTPResults(data) {
    _show('ztp-result-summary');
    _setText('ztp-res-total',  data.summary.total_events);
    _setText('ztp-res-online', data.summary.online);
    _setText('ztp-res-failed', data.summary.failed);

    _show('ztp-log-wrap');
    const tbody = document.getElementById('ztp-log-body');
    tbody.innerHTML = '';

    data.events.forEach(evt => {
      const tr = document.createElement('tr');
      const label = evt.state.replace(/_/g, ' ').toUpperCase();
      const badge = evt.success
        ? '<span class="check-badge check-pass">✔ OK</span>'
        : '<span class="check-badge check-fail">✘ FAILED</span>';
      tr.innerHTML = `
        <td><strong>${evt.device_name}</strong></td>
        <td><code style="font-size:11px;color:var(--text-dim)">${label}</code></td>
        <td style="font-size:12px;color:var(--text-dim)">${evt.message}</td>
        <td>${badge}</td>`;
      if (!evt.success) tr.className = 'ztp-row-failed';
      tbody.appendChild(tr);
    });
  }

  window.resetZTPLog = function () {
    _hide('ztp-result-summary');
    _hide('ztp-log-wrap');
    document.getElementById('ztp-log-body').innerHTML = '';
    _val('ztp-fail-device', '');
  };

  // ── Pre / Post Checks ─────────────────────────────────────────────────────

  window.runChecks = async function (phase) {
    const failDevice = _val('checks-fail-device');
    const failCheck  = _val('checks-fail-check');
    const payload    = (failDevice && failCheck)
      ? { fail_devices: { [failDevice]: [failCheck] } }
      : {};

    const btnId = phase === 'pre' ? 'checks-pre-btn' : 'checks-post-btn';
    const label = phase === 'pre' ? '▶ Run Pre-Checks' : '▶ Run Post-Checks';

    await _withBtn(btnId, 'Running…', async () => {
      const data = await _post(`/api/checks/${phase}`, payload);
      _renderChecksResults(data, phase);
      const fails = data.results.filter(r => r.status === 'FAIL').length;
      window.showToast(
        `${phase.toUpperCase()}-checks done — ${data.results.filter(r => r.status === 'PASS').length} PASS, ${fails} FAIL`,
        fails ? 'warning' : 'success'
      );
    }, label);
  };

  function _renderChecksResults(data, phase) {
    const results = data.results;
    const pass = results.filter(r => r.status === 'PASS').length;
    const fail = results.filter(r => r.status === 'FAIL').length;
    const warn = results.filter(r => r.status === 'WARN').length;

    _show('checks-summary');
    _setText('chk-phase', phase.toUpperCase() + '-DEPLOY');
    _setText('chk-pass',  pass);
    _setText('chk-fail',  fail);
    _setText('chk-warn',  warn);

    _show('checks-table-wrap');
    const tbody = document.getElementById('checks-body');
    tbody.innerHTML = '';

    results.forEach(r => {
      const badgeCls = { PASS: 'check-pass', FAIL: 'check-fail', WARN: 'check-warn' }[r.status] || 'check-skip';
      const icon     = { PASS: '✔', FAIL: '✘', WARN: '⚠', SKIP: '–' }[r.status] || '–';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${r.device}</strong></td>
        <td><code style="font-size:11px">${r.name}</code></td>
        <td><span class="check-badge ${badgeCls}">${icon} ${r.status}</span></td>
        <td style="font-size:12px">${r.message}</td>
        <td style="font-size:11px;color:var(--warn)">${r.remediation || ''}</td>`;
      if (r.status === 'FAIL') tr.className = 'checks-row-fail';
      tbody.appendChild(tr);
    });
  }

  window.clearChecks = function () {
    _hide('checks-summary');
    _hide('checks-table-wrap');
    document.getElementById('checks-body').innerHTML = '';
    _val('checks-fail-device', '');
    _val('checks-fail-check',  '');
  };

  // ── Monitoring ────────────────────────────────────────────────────────────

  window.pollMonitoring = async function (failDevices) {
    const hasFail = failDevices && Object.keys(failDevices).length > 0;

    await _withBtn('mon-poll-btn', 'Polling…', async () => {
      let data;
      if (hasFail) {
        data = await _post('/api/monitoring/poll', { fail_devices: failDevices });
      } else {
        const res = await fetch('/api/monitoring/poll');
        if (!res.ok) throw new Error(res.statusText);
        data = await res.json();
      }
      _renderMonitoringResults(data);
      const s = data.summary;
      window.showToast(
        `Monitoring: ${s.healthy} healthy, ${s.degraded} degraded, ${s.down} down`,
        s.degraded || s.down ? 'warning' : 'success'
      );
    });
  };

  window.pollMonitoringDegraded = function () {
    window.pollMonitoring({
      'edge-rtr1': ['interfaces_up'],
      'lb1':       ['virtual_servers'],
      'gpu-fw1':   ['rdma_policy'],
    });
  };

  function _renderMonitoringResults(data) {
    const s = data.summary;

    _show('mon-summary');
    _setText('mon-total',         s.total);
    _setText('mon-healthy',       s.healthy);
    _setText('mon-degraded',      s.degraded);
    _setText('mon-down',          s.down);
    _setText('mon-alerts-count',  s.alerts.length);

    _show('mon-table-wrap');
    const tbody = document.getElementById('mon-body');
    tbody.innerHTML = '';

    const dotCls   = { healthy: 'dot-healthy', degraded: 'dot-degraded', down: 'dot-down' };
    const txtColor = {
      healthy:  'var(--success)',
      degraded: 'var(--warn)',
      down:     'var(--danger)',
      unknown:  'var(--text-dim)',
    };

    Object.values(data.health)
      .sort((a, b) => a.device_name.localeCompare(b.device_name))
      .forEach(h => {
        const uptime = h.metrics.uptime_seconds >= 3600
          ? Math.floor(h.metrics.uptime_seconds / 3600) + 'h'
          : h.metrics.uptime_seconds + 's';
        const alertStr = h.alerts.length
          ? h.alerts.join(' · ')
          : '<span style="color:var(--text-dim)">—</span>';

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${h.device_name}</strong></td>
          <td style="color:var(--text-dim);font-size:12px">${h.role}</td>
          <td style="color:${txtColor[h.status] || ''}">
            <span class="status-dot ${dotCls[h.status] || ''}"></span>${h.status}
          </td>
          <td>${h.metrics.cpu}%</td>
          <td style="color:var(--text-dim);font-size:12px">${uptime}</td>
          <td style="font-size:11px;color:var(--warn)">${alertStr}</td>`;
        if (h.status === 'degraded') tr.className = 'mon-row-degraded';
        else if (h.status === 'down') tr.className = 'mon-row-down';
        tbody.appendChild(tr);
      });

    // Alert list
    if (s.alerts.length > 0) {
      _show('mon-alerts-wrap');
      const list = document.getElementById('mon-alerts-list');
      list.innerHTML = '';
      s.alerts.forEach(a => {
        const div = document.createElement('div');
        div.className = 'alert-item';
        div.innerHTML = `<span class="alert-device">${a.device}</span>${a.alert}`;
        list.appendChild(div);
      });
    } else {
      _hide('mon-alerts-wrap');
    }
  }

  window.clearMonitoring = function () {
    _hide('mon-summary');
    _hide('mon-table-wrap');
    _hide('mon-alerts-wrap');
    document.getElementById('mon-body').innerHTML = '';
  };

  // ── Private utilities ─────────────────────────────────────────────────────

  function _show(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  }
  function _hide(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
  function _val(id, set) {
    const el = document.getElementById(id);
    if (!el) return '';
    if (set !== undefined) { el.value = set; return; }
    return el.value;
  }

  async function _post(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  async function _withBtn(btnId, loadingLabel, fn, restoreLabel) {
    const btn = document.getElementById(btnId);
    const orig = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = loadingLabel; }
    try {
      await fn();
    } catch (e) {
      window.showToast('Request failed: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = restoreLabel || orig; }
    }
  }

  // ── Bootstrap: load data when demo tabs become active ─────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    // Eagerly seed the topology cards and device dropdowns
    loadZTPTopology();
    loadDeviceList();

    // Reload on tab click in case the server wasn't up on page load
    document.querySelectorAll('.step-tab').forEach(tab => {
      tab.addEventListener('click', function () {
        const step = parseInt(this.dataset.step, 10);
        if (step === 4) { loadZTPTopology(); loadDeviceList(); }
        if (step === 5) { loadDeviceList(); }
      });
    });
  });

})();
