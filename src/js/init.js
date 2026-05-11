
/* ── Keyboard navigation ────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.key === 'ArrowRight' || e.key === 'Enter' && e.ctrlKey) goStep(1);
  if (e.key === 'ArrowLeft')  goStep(-1);
  if (e.key === '?' || e.key === 'h') showKeyboardHelp();
  if (e.key === 'Escape') {
    closeDemoModal();
    document.getElementById('modal-overlay')?.classList.remove('open');
    document.getElementById('kb-help')?.remove();
  }
});

function showKeyboardHelp() {
  const existing = document.getElementById('kb-help');
  if (existing) { existing.remove(); return; }
  const d = document.createElement('div');
  d.id = 'kb-help';
  d.style.cssText = `position:fixed;bottom:5rem;right:1.5rem;z-index:500;
    background:var(--bg2);border:1px solid var(--border-hi);border-radius:10px;
    padding:1rem 1.25rem;font-size:.78rem;min-width:200px;box-shadow:var(--shadow);
    animation:fadeUp .2s ease`;
  d.innerHTML = `<div style="font-weight:700;margin-bottom:.6rem;color:var(--cyan)">⌨ Keyboard Shortcuts</div>
    <div style="color:var(--txt2);display:grid;grid-template-columns:auto 1fr;gap:.3rem .85rem">
      <kbd style="font-family:monospace;color:var(--txt0)">→</kbd><span>Next step</span>
      <kbd style="font-family:monospace;color:var(--txt0)">←</kbd><span>Previous step</span>
      <kbd style="font-family:monospace;color:var(--txt0)">Esc</kbd><span>Close modals</span>
      <kbd style="font-family:monospace;color:var(--txt0)">?</kbd><span>Toggle this help</span>
    </div>`;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 4000);
}

/* ── Share button ───────────────────────────────────────────────── */
function sharePage() {
  const url = window.location.href;
  if (navigator.share) {
    navigator.share({ title: 'NetDesign AI', text: 'AI-powered network design platform', url })
      .catch(() => {});
  } else {
    navigator.clipboard.writeText(url).then(() => toast('Link copied to clipboard!', 'success'));
  }
}

/* ── Init: restore saved state or show welcome ──────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  // Auth gate + paywall
  if (typeof initPaywall === 'function') initPaywall();
  // Similar designs panel (injects CSS)
  if (typeof initSimilarDesigns === 'function') initSimilarDesigns();
  // Landing page
  if (typeof initLanding === 'function') initLanding();

  const restored = restoreStateLS();
  if (restored && STATE.uc) {
    // If we have a saved session, skip landing automatically
    if (typeof startDesigning === 'function' && !sessionStorage.getItem('nd_landing_dismissed')) {
      // Don't auto-skip — let user see landing even with restored state
    }
    toast('Previous session restored — pick up where you left off', 'info', 4000);
  }
});

/* Auto-save on form changes */
['org-name','org-size','num-sites','redundancy','total-hosts','bw-per-server',
 'fw-model','vpn-type','latency-sla','automation','extra-notes'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', saveStateLS);
});
