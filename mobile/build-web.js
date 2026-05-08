#!/usr/bin/env node
/**
 * Copies the static web frontend into mobile/www/ for Capacitor.
 * Run: node build-web.js
 */
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT  = path.join(__dirname, 'www');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

// Clean www
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// Copy root index.html
fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(OUT, 'index.html'));

// Copy frontend assets
for (const dir of ['src']) {
  const s = path.join(ROOT, dir);
  if (fs.existsSync(s)) copyDir(s, path.join(OUT, dir));
}

// Copy preview svg if exists
const svg = path.join(ROOT, 'preview.svg');
if (fs.existsSync(svg)) fs.copyFileSync(svg, path.join(OUT, 'preview.svg'));

// Inject mobile-specific overrides into index.html
let html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');

// Inject Capacitor core + mobile CSS before </head>
const capacitorInject = `
  <!-- Capacitor runtime -->
  <script src="capacitor.js"></script>
  <style>
    /* Mobile safe areas */
    body { padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
    /* Prevent text selection on tap */
    * { -webkit-tap-highlight-color: transparent; user-select: none; }
    input, textarea { user-select: text; }
  </style>
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`;

html = html.replace('</head>', capacitorInject + '\n</head>');

// Inject mobile backend config panel trigger before </body>
const mobilePanel = `
  <script>
    // Mobile: show backend config if no URL set
    document.addEventListener('DOMContentLoaded', () => {
      const s = JSON.parse(localStorage.getItem('nd_backend_settings') || '{}');
      if (!s.backendUrl) {
        // Show config panel on first launch
        const banner = document.createElement('div');
        banner.id = 'mobile-setup-banner';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#1e40af;color:#fff;padding:12px 16px;font-family:sans-serif;font-size:14px;display:flex;align-items:center;justify-content:space-between;gap:8px;';
        banner.innerHTML = '<span>⚙ Set your NetDesign AI server URL to enable AI features</span><button onclick="document.getElementById(\'nd-mobile-config\').style.display=\'flex\'" style="background:#fff;color:#1e40af;border:none;border-radius:6px;padding:6px 14px;font-weight:600;cursor:pointer;">Configure</button>';
        document.body.appendChild(banner);
      }
    });
  </script>
  <!-- Mobile backend config modal -->
  <div id="nd-mobile-config" style="display:none;position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.7);align-items:center;justify-content:center;">
    <div style="background:#1e293b;border-radius:16px;padding:28px;width:90%;max-width:400px;color:#f1f5f9;font-family:sans-serif;">
      <h2 style="margin:0 0 6px;font-size:20px;">Connect to Server</h2>
      <p style="margin:0 0 20px;color:#94a3b8;font-size:14px;">Enter the URL of your NetDesign AI backend server.</p>
      <label style="display:block;margin-bottom:6px;font-size:13px;color:#94a3b8;">Server URL</label>
      <input id="nd-url-input" type="url" placeholder="https://your-server.railway.app" style="width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#f1f5f9;font-size:15px;margin-bottom:16px;">
      <label style="display:block;margin-bottom:6px;font-size:13px;color:#94a3b8;">Username</label>
      <input id="nd-user-input" type="text" placeholder="admin" style="width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#f1f5f9;font-size:15px;margin-bottom:16px;">
      <label style="display:block;margin-bottom:6px;font-size:13px;color:#94a3b8;">Password</label>
      <input id="nd-pass-input" type="password" placeholder="Your password" style="width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#f1f5f9;font-size:15px;margin-bottom:24px;">
      <button onclick="ndMobileSave()" style="width:100%;padding:14px;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;">Connect</button>
      <button onclick="document.getElementById('nd-mobile-config').style.display='none'" style="width:100%;padding:12px;background:transparent;color:#64748b;border:none;font-size:14px;cursor:pointer;margin-top:8px;">Cancel</button>
    </div>
  </div>
  <script>
    async function ndMobileSave() {
      const url  = document.getElementById('nd-url-input').value.trim().replace(/\/$/, '');
      const user = document.getElementById('nd-user-input').value.trim();
      const pass = document.getElementById('nd-pass-input').value;
      if (!url) return alert('Please enter a server URL');
      try {
        // Get JWT token
        const fd = new FormData();
        fd.append('username', user || 'admin');
        fd.append('password', pass);
        const r = await fetch(url + '/api/auth/token', { method: 'POST', body: fd });
        if (!r.ok) throw new Error('Login failed — check username and password');
        const { access_token } = await r.json();
        localStorage.setItem('nd_backend_settings', JSON.stringify({ backendUrl: url, liveMode: true, token: access_token }));
        document.getElementById('nd-mobile-config').style.display = 'none';
        const b = document.getElementById('mobile-setup-banner');
        if (b) b.remove();
        location.reload();
      } catch(e) {
        alert(e.message || 'Could not connect. Check the URL and credentials.');
      }
    }
  </script>`;

html = html.replace('</body>', mobilePanel + '\n</body>');

fs.writeFileSync(path.join(OUT, 'index.html'), html);

console.log('✅ Web assets copied to mobile/www/');
console.log('   Next: npx cap sync android   (or ios)');
