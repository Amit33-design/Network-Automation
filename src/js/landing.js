'use strict';

/* ════════════════════════════════════════════════════════════════
   LANDING PAGE — hero shown on first load; dismissed with CTA
════════════════════════════════════════════════════════════════ */

function initLanding() {
  // Skip landing if user already dismissed this session
  if (sessionStorage.getItem('nd_landing_dismissed')) {
    document.getElementById('landing')?.remove();
    return;
  }
  // Hide dashboard layout behind landing
  const layout = document.getElementById('dashboard-layout');
  if (layout) layout.style.visibility = 'hidden';

  // Start counter animations once visible
  animateCounters();
}

function startDesigning() {
  sessionStorage.setItem('nd_landing_dismissed', '1');
  const land = document.getElementById('landing');
  if (!land) return;

  land.classList.add('landing-exit');
  setTimeout(() => {
    land.remove();
    const layout = document.getElementById('dashboard-layout');
    if (layout) {
      layout.style.visibility = '';
      layout.style.opacity    = '0';
      layout.style.transition = 'opacity .4s ease';
      requestAnimationFrame(() => { layout.style.opacity = '1'; });
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, 450);
}

function tryDemo() {
  startDesigning();
  // Wait for app to appear, then open demo modal
  setTimeout(() => openDemoModal(), 500);
}

function animateCounters() {
  document.querySelectorAll('[data-count]').forEach(el => {
    const target = parseInt(el.dataset.count, 10);
    let current  = 0;
    const step   = Math.max(1, Math.floor(target / 40));
    const timer  = setInterval(() => {
      current = Math.min(current + step, target);
      el.textContent = current + (el.dataset.suffix || '');
      if (current >= target) clearInterval(timer);
    }, 28);
  });
}
