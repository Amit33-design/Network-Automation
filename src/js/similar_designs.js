/**
 * NetDesign AI — "Start from a similar design" panel
 *
 * Queries POST /api/designs/similar with the current intent object.
 * Renders up to 3 cards above Step 1 when matches score > 0.75.
 * Clicking a card clones that design's state into the wizard.
 *
 * The panel only shows for signed-in users (Clerk) and only when
 * at least one similar design exists.
 *
 * Usage:
 *   import { initSimilarDesigns, querySimilarDesigns } from './similar_designs.js';
 *   initSimilarDesigns();                 // call once on app boot
 *   querySimilarDesigns({ use_case, intent, vendor });  // call after Step 1 intent
 */

import { track } from "./analytics.js";

const CONTAINER_ID = "similar-designs-panel";
let _currentMatches = [];

// ── API ──────────────────────────────────────────────────────────────────────

async function _fetchSimilar({ intent = {}, topology_params = {}, use_case = "", vendor = "" }) {
  try {
    const token = await window.Clerk?.session?.getToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const resp = await fetch("/api/designs/similar", {
      method:  "POST",
      headers,
      body:    JSON.stringify({ intent, topology_params, use_case, vendor, top_k: 3 }),
    });
    if (!resp.ok) return [];
    const { matches } = await resp.json();
    return matches ?? [];
  } catch {
    return [];
  }
}

// ── Render ───────────────────────────────────────────────────────────────────

function _scoreBar(score) {
  const pct   = Math.round(score * 100);
  const color = pct >= 90 ? "#00e5a0" : pct >= 80 ? "#7c6aff" : "#ffb347";
  return `
    <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
      <div style="flex:1;height:3px;background:#1e1e2e;border-radius:2px">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:2px"></div>
      </div>
      <span style="font-size:10px;color:${color};font-family:monospace">${pct}% match</span>
    </div>`;
}

function _renderCards(matches) {
  const useCaseIcon = { gpu_fabric: "🎮", data_center: "🏢", campus: "🏫", wan: "🌐", hpc: "⚡", sd_wan: "☁️" };

  return matches.map((m, i) => `
    <div class="similar-card" data-index="${i}"
         style="background:#16161f;border:1px solid #1e1e2e;border-radius:6px;padding:14px 16px;cursor:pointer;transition:.15s"
         onmouseover="this.style.borderColor='var(--cyan)'" onmouseout="this.style.borderColor='#1e1e2e'"
         onclick="window._cloneSimilarDesign(${i})">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <span style="font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:#e8e8f0">
          ${useCaseIcon[m.use_case] ?? "🌐"} ${m.design_name}
        </span>
        <span style="font-size:10px;background:rgba(124,106,255,.12);color:#7c6aff;padding:2px 8px;border-radius:10px;white-space:nowrap;margin-left:8px">
          ${m.vendor || "multi-vendor"}
        </span>
      </div>
      <p style="font-size:11px;color:#6b6b8a;line-height:1.55;margin:0">${m.intent_summary || "No description"}</p>
      ${_scoreBar(m.score)}
    </div>`).join("");
}

function _showPanel(matches) {
  let panel = document.getElementById(CONTAINER_ID);
  if (!panel) {
    panel = document.createElement("div");
    panel.id = CONTAINER_ID;
    panel.style.cssText = "margin-bottom:20px;animation:fadeIn .3s ease";
    // Insert before Step 1 content
    const step1 = document.getElementById("step1") ?? document.querySelector(".step-content");
    if (step1) step1.parentNode.insertBefore(panel, step1);
    else document.body.appendChild(panel);
  }

  if (!matches.length) { panel.style.display = "none"; return; }

  panel.style.display = "block";
  panel.innerHTML = `
    <div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">
      <div>
        <span style="font-family:'Syne',sans-serif;font-size:10px;font-weight:700;letter-spacing:.15em;color:#6b6b8a;text-transform:uppercase">
          ✨ Similar past designs
        </span>
        <p style="font-size:11px;color:#6b6b8a;margin:2px 0 0">Start from one of these instead of from scratch</p>
      </div>
      <button onclick="document.getElementById('${CONTAINER_ID}').style.display='none'"
              style="background:none;border:none;color:#6b6b8a;cursor:pointer;font-size:16px">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
      ${_renderCards(matches)}
    </div>`;

  track("similar_designs_shown", { count: matches.length });
}

// ── Clone handler ────────────────────────────────────────────────────────────

window._cloneSimilarDesign = function(index) {
  const match = _currentMatches[index];
  if (!match) return;

  track("similar_design_clicked", {
    design_id:   match.id,
    design_name: match.design_name,
    use_case:    match.use_case,
    score:       match.score,
  });

  // Load the design state from backend and merge into wizard
  const token = window.Clerk?.session?.getToken();
  Promise.resolve(token).then(t => {
    const headers = {};
    if (t) headers["Authorization"] = `Bearer ${t}`;
    return fetch(`/api/designs/${match.id}/state`, { headers });
  }).then(r => r.ok ? r.json() : null).then(data => {
    if (!data?.state) return;
    // Merge state into the app — the wizard's loadState function handles this
    if (typeof window.loadDesignState === "function") {
      window.loadDesignState(data.state);
    } else if (typeof window._setState === "function") {
      window._setState(data.state);
    }
    document.getElementById(CONTAINER_ID).style.display = "none";
    // Show confirmation toast
    _toast(`Loaded design: ${match.design_name}`);
  }).catch(() => _toast("Could not load design — try again"));
};

function _toast(msg) {
  const t = document.createElement("div");
  t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#16161f;border:1px solid #00e5a0;color:#00e5a0;padding:10px 20px;border-radius:6px;font-size:12px;z-index:9999;animation:fadeIn .2s ease";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function querySimilarDesigns({ intent = {}, topology_params = {}, use_case = "", vendor = "" } = {}) {
  // Only show for signed-in users — free/pro/team/dept all get this
  if (!window.Clerk?.user) return;
  const matches    = await _fetchSimilar({ intent, topology_params, use_case, vendor });
  _currentMatches  = matches;
  _showPanel(matches);
  return matches;
}

export function initSimilarDesigns() {
  // Inject fade-in keyframe if not already present
  if (!document.getElementById("similar-designs-style")) {
    const s = document.createElement("style");
    s.id = "similar-designs-style";
    s.textContent = "@keyframes fadeIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}";
    document.head.appendChild(s);
  }
}
