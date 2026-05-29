/**
 * Runtime environment config injected into the browser.
 * In production, Vercel generates this from secret env vars at deploy time.
 * For local development, edit this file directly.
 *
 * DO NOT put secret keys here — only public/publishable keys.
 */
window.__ENV = {
  CLERK_PUBLISHABLE_KEY: "pk_test_ZmFjdHVhbC1rcmlsbC01LmNsZXJrLmFjY291bnRzLmRldiQ",
  POSTHOG_KEY:           "",   // phc_... from PostHog dashboard
  SENTRY_DSN:            "https://724c40d69fc3247f9d9012aceed3dcb2@o4511372838109184.ingest.us.sentry.io/4511372844531712",
  APP_ENV:               "development",
  BACKEND_URL:           "http://localhost:8000",
};
