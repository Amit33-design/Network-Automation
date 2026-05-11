/**
 * NetDesign AI — PostHog funnel tracking
 *
 * Key funnel:
 *   landing_viewed → app_launched → step1_complete → step2_complete →
 *   step3_complete → step4_complete → step5_start (paywall) →
 *   config_downloaded → purchase_clicked → purchase_complete
 *
 * Additional events:
 *   use_case_selected, vendor_selected, feature_used, error_encountered,
 *   similar_design_clicked, design_saved, deploy_started, deploy_complete
 *
 * Usage:
 *   import { track, page, identify } from './analytics.js';
 *   track('step1_complete', { use_case: 'gpu_fabric', scale: '128_gpu' });
 */

function _ph() { return window.posthog ?? null; }

/**
 * Track a named event with optional properties.
 * No-ops silently when PostHog is not loaded (dev / Docker).
 */
function track(event, props = {}) {
  try { _ph()?.capture(event, props); } catch { /* never throw */ }
}
window.track = track;

function page(name, props = {}) {
  try { _ph()?.capture("$pageview", { page: name, ...props }); } catch { /* */ }
}
window.ndPage = page;

function identify(userId, traits = {}) {
  try { _ph()?.identify(userId, traits); } catch { /* */ }
}
window.ndIdentify = identify;

function reset() {
  try { _ph()?.reset(); } catch { /* */ }
}
window.ndReset = reset;

// ── Convenience wrappers for the 6-step wizard funnel ───────────────────────

const Funnel = window.Funnel = {
  landingViewed:    (props = {}) => track("landing_viewed", props),
  appLaunched:      (props = {}) => track("app_launched", props),
  demoStarted:      (props = {}) => track("demo_started", props),

  step1Complete:    (props) => track("step1_complete", props),   // use_case selected
  step2Complete:    (props) => track("step2_complete", props),   // hw selected
  step3Complete:    (props) => track("step3_complete", props),   // topology complete
  step4Complete:    (props) => track("step4_complete", props),   // design reviewed
  step5Start:       (props) => track("step5_start",    props),   // paywall hit
  configDownloaded: (props) => track("config_downloaded", props),
  step6Start:       (props) => track("step6_start",    props),   // deploy wizard
  deployStarted:    (props) => track("deploy_started",  props),
  deployComplete:   (props) => track("deploy_complete", props),

  paywallShown:     (trigger) => track("paywall_shown", { trigger }),
  upgradeClicked:   (plan)    => track("upgrade_clicked", { plan }),
  purchaseComplete: (plan)    => track("purchase_complete", { plan }),

  useCaseSelected:        (use_case) => track("use_case_selected",         { use_case }),
  vendorSelected:         (vendor)   => track("vendor_selected",           { vendor }),
  similarDesignClicked:   (props)    => track("similar_design_clicked",    props),
  similarDesignShown:     (count)    => track("similar_designs_shown",     { count }),
  policyRuleViolation:    (rule)     => track("policy_rule_violation",     { rule }),
  errorEncountered:       (context)  => track("error_encountered",         { context }),
};

// ── Auto-instrument step navigation ─────────────────────────────────────────

/**
 * Call this once at app init. Patches window.goToStep() (if it exists) to
 * fire funnel events on each step transition automatically.
 */
function instrumentStepNavigation() {
  const originalGoToStep = window.goToStep;
  if (typeof originalGoToStep !== "function") return;

  const stepEvents = [null, "step1_complete", "step2_complete", "step3_complete",
                      "step4_complete", "step5_start", "step6_start"];

  window.goToStep = function(targetStep, ...args) {
    const event = stepEvents[targetStep];
    if (event) {
      const state = window._appState?.() ?? {};
      track(event, {
        use_case:   state.useCase    ?? "",
        vendor:     state.vendor     ?? "",
        scale:      state.scale      ?? "",
        node_count: state.nodeCount  ?? 0,
      });
    }
    return originalGoToStep.call(this, targetStep, ...args);
  };
}
