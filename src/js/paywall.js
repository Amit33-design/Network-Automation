/**
 * NetDesign AI — Clerk auth + freemium paywall gate
 *
 * Controls:
 *   - Sign-in/sign-out UI (top nav buttons)
 *   - Step 5 (config gen) and Step 6 (deploy) are gated behind auth
 *   - Free plan: rate-limit counter shown; upgrade modal on limit hit
 *   - Pro plan: unlimited, no modal
 *
 * Relies on Clerk JS loaded in index.html head.
 * Exports: initPaywall(), requireAuth(), trackConfigGenQuota()
 */

const PAYWALL_STEPS  = [5, 6]; // steps requiring sign-in
const UPGRADE_URL    = "https://app.netdesignai.com/upgrade";
const CHECKOUT_PLANS = {
  pro:  { label: "Pro — $50/mo",          url: `${UPGRADE_URL}?plan=pro`  },
  team: { label: "Team 10-seat — $400/yr", url: `${UPGRADE_URL}?plan=team` },
  dept: { label: "Dept 50-seat — $1500/yr",url: `${UPGRADE_URL}?plan=dept` },
};

// ── Clerk state ──────────────────────────────────────────────────────────────

let _clerk  = null;
let _user   = null;
let _plan   = "free";   // populated from Clerk session claims or license validation

async function _loadClerk() {
  if (!window.__ENV?.CLERK_PUBLISHABLE_KEY) return;   // dev mode — skip
  const script = document.getElementById("clerk-script");
  if (!script) return;
  await new Promise(resolve => {
    if (window.Clerk) { resolve(); return; }
    script.addEventListener("load", resolve);
    setTimeout(resolve, 3000); // timeout fallback
  });
  if (!window.Clerk) return;
  await window.Clerk.load({ publishableKey: window.__ENV.CLERK_PUBLISHABLE_KEY });
  _clerk = window.Clerk;
  _user  = _clerk.user;
  _plan  = _user?.publicMetadata?.plan ?? "free";

  // Identify user in PostHog + Sentry
  if (_user) {
    if (window.posthog) posthog.identify(_user.id, { email: _user.primaryEmailAddress?.emailAddress, plan: _plan });
    if (typeof Sentry !== "undefined") Sentry.setUser({ id: _user.id, email: _user.primaryEmailAddress?.emailAddress });
  }

  _clerk.addListener(({ user }) => {
    _user = user;
    _plan = user?.publicMetadata?.plan ?? "free";
    _renderAuthButtons();
  });

  _renderAuthButtons();
}

// ── UI ───────────────────────────────────────────────────────────────────────

function _renderAuthButtons() {
  const container = document.getElementById("auth-buttons");
  if (!container) return;

  if (!_clerk) {
    container.innerHTML = ""; // no Clerk config → hide
    return;
  }

  if (_user) {
    const avatar = _user.imageUrl
      ? `<img src="${_user.imageUrl}" style="width:28px;height:28px;border-radius:50%;object-fit:cover" alt="avatar">`
      : `<span style="width:28px;height:28px;border-radius:50%;background:var(--blue);display:flex;align-items:center;justify-content:center;font-size:14px">
           ${(_user.firstName?.[0] ?? "U").toUpperCase()}
         </span>`;
    const planBadge = _plan !== "free"
      ? `<span style="font-size:10px;background:rgba(0,229,160,.15);color:var(--cyan);padding:2px 8px;border-radius:10px;margin-left:8px">${_plan.toUpperCase()}</span>`
      : `<span style="font-size:10px;background:rgba(255,255,255,.08);color:#888;padding:2px 8px;border-radius:10px;margin-left:8px">FREE</span>`;

    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px">
        ${_plan === "free" ? `<button class="btn btn-primary" onclick="openUpgradeModal()" style="font-size:.75rem;padding:.3rem .8rem">⚡ Upgrade</button>` : ""}
        <button onclick="window._paywallSignOut()" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 8px;cursor:pointer;display:flex;align-items:center;gap:8px;color:var(--text)">
          ${avatar}${planBadge}
        </button>
      </div>`;
  } else {
    container.innerHTML = `
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" onclick="window._paywallSignIn()" style="font-size:.78rem;padding:.3rem .8rem">Sign in</button>
        <button class="btn btn-primary" onclick="window._paywallSignUp()" style="font-size:.78rem;padding:.3rem .9rem">Get started →</button>
      </div>`;
  }
}

window._paywallSignIn  = () => _clerk?.openSignIn({ afterSignInUrl: window.location.href });
window._paywallSignUp  = () => _clerk?.openSignUp({ afterSignUpUrl: window.location.href });
window._paywallSignOut = () => _clerk?.signOut();

// ── Gate logic ───────────────────────────────────────────────────────────────

/**
 * Call before entering a gated step. Resolves if user can proceed.
 * Throws (and shows modal) if not signed in.
 */
async function requireAuth(stepNumber) {
  if (!PAYWALL_STEPS.includes(stepNumber)) return true;
  if (!_clerk) return true;    // Clerk not configured → open access (dev/Docker)
  if (_user) return true;

  // Not signed in → open sign-up modal with context
  _showAuthModal(stepNumber);
  throw new Error("auth_required");
}

function _showAuthModal(stepNumber) {
  const modal = document.getElementById("paywall-modal");
  if (!modal) { _clerk?.openSignUp(); return; }
  modal.style.display = "flex";
  const title = modal.querySelector(".paywall-modal-title");
  if (title) title.textContent = `Sign in to access Step ${stepNumber}`;
}

window.closePaywallModal = () => {
  const modal = document.getElementById("paywall-modal");
  if (modal) modal.style.display = "none";
};

window.paywallSignUp = () => {
  window.closePaywallModal();
  _clerk?.openSignUp({ afterSignUpUrl: window.location.href });
};

// ── Rate limit / upgrade modal ───────────────────────────────────────────────

/**
 * Called after config gen completes. Checks quota, shows upgrade modal if needed.
 * Returns { blocked: bool }
 */
async function trackConfigGenQuota() {
  if (!_clerk || _plan !== "free") return { blocked: false };

  try {
    const token = await _clerk.session?.getToken();
    const resp  = await fetch("/api/designs/quota", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return { blocked: false };
    const { remaining, limit } = await resp.json();
    _updateQuotaBadge(remaining, limit);
    if (remaining <= 0) {
      openUpgradeModal("config_gen_limit");
      return { blocked: true };
    }
    return { blocked: false };
  } catch {
    return { blocked: false };
  }
}

function _updateQuotaBadge(remaining, limit) {
  const badge = document.getElementById("quota-badge");
  if (!badge) return;
  badge.textContent  = `${remaining}/${limit} gens left today`;
  badge.style.color  = remaining <= 2 ? "var(--warn)" : "var(--muted)";
  badge.style.display = "inline";
}

window.openUpgradeModal = function(trigger = "manual") {
  if (window.posthog) posthog.capture("upgrade_modal_shown", { trigger });
  let modal = document.getElementById("upgrade-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "upgrade-modal";
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal" style="max-width:480px">
        <button class="modal-close" onclick="document.getElementById('upgrade-modal').style.display='none'">✕</button>
        <h2 style="margin-bottom:4px;font-size:1.2rem">Unlock unlimited access</h2>
        <p style="color:var(--muted);font-size:.85rem;margin-bottom:20px">Free plan: 10 config generations per hour. Upgrade for unlimited access, design history, and team collaboration.</p>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${Object.entries(CHECKOUT_PLANS).map(([key, p]) => `
            <a href="${p.url}" target="_blank" onclick="posthog?.capture('upgrade_clicked',{plan:'${key}',trigger:'${trigger}'})"
               style="display:block;padding:14px 18px;background:#111;border:1px solid var(--border);border-radius:6px;text-decoration:none;color:var(--text);transition:.15s"
               onmouseover="this.style.borderColor='var(--cyan)'" onmouseout="this.style.borderColor='var(--border)'">
              <strong>${p.label}</strong>
            </a>`).join("")}
        </div>
        <p style="margin-top:16px;font-size:.75rem;color:var(--muted)">Instant activation via Stripe. Cancel anytime.</p>
      </div>`;
    document.body.appendChild(modal);
  }
  modal.style.display = "flex";
};

// ── Paywall modal HTML (injected if missing) ─────────────────────────────────

function _ensurePaywallModalExists() {
  if (document.getElementById("paywall-modal")) return;
  const el = document.createElement("div");
  el.id = "paywall-modal";
  el.className = "modal-overlay";
  el.style.display = "none";
  el.innerHTML = `
    <div class="modal" style="max-width:400px;text-align:center">
      <div style="font-size:2rem;margin-bottom:12px">🔒</div>
      <h2 class="paywall-modal-title" style="margin-bottom:8px">Sign in to continue</h2>
      <p style="color:var(--muted);font-size:.85rem;margin-bottom:20px">
        Create a free account to generate configs and access all 6 steps.
        No credit card required.
      </p>
      <div style="display:flex;gap:10px;justify-content:center">
        <button class="btn btn-ghost" onclick="closePaywallModal()">Cancel</button>
        <button class="btn btn-primary" onclick="paywallSignUp()">Create free account →</button>
      </div>
    </div>`;
  document.body.appendChild(el);
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function initPaywall() {
  _ensurePaywallModalExists();
  await _loadClerk();
}

export { initPaywall, requireAuth, trackConfigGenQuota };
