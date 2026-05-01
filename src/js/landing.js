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
  // Hide the main app UI behind the landing
  document.getElementById('app').style.visibility     = 'hidden';
  document.getElementById('bottom-nav').style.display = 'none';
  document.getElementById('header').style.opacity     = '0';

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
    document.getElementById('app').style.visibility     = '';
    document.getElementById('bottom-nav').style.display = '';
    document.getElementById('header').style.opacity     = '';
    document.getElementById('header').style.transition  = 'opacity .4s ease';
    document.getElementById('header').style.opacity     = '1';
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
