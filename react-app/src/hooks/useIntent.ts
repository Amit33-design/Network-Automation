import { useIntentStore } from '@/store/intentStore';
import type { IntentObject } from '@/types/intent';

// Convenience hook — components import this instead of the store directly
export function useIntent() {
  return useIntentStore((s) => s.intent);
}

export function useSetIntent() {
  return useIntentStore((s) => s.setIntent);
}

export function useActiveStep() {
  return useIntentStore((s) => ({
    activeStep: s.activeStep,
    setActiveStep: s.setActiveStep,
  }));
}

// Derive a URL-shareable base64 string from the intent
export function encodeIntent(intent: IntentObject): string {
  return btoa(encodeURIComponent(JSON.stringify(intent)));
}

export function decodeIntent(encoded: string): IntentObject | null {
  try {
    return JSON.parse(decodeURIComponent(atob(encoded))) as IntentObject;
  } catch {
    return null;
  }
}
