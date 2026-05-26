import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { IntentObject } from '@/types/intent';
import { DEFAULT_INTENT } from '@/types/intent';

interface IntentStore {
  intent: IntentObject;
  activeStep: number;
  setIntent: (patch: Partial<IntentObject>) => void;
  setIntentFull: (intent: IntentObject) => void;
  resetIntent: () => void;
  setActiveStep: (step: number) => void;
}

export const useIntentStore = create<IntentStore>()(
  devtools(
    persist(
      (set) => ({
        intent: DEFAULT_INTENT,
        activeStep: 1,

        setIntent: (patch) =>
          set((state) => ({
            intent: { ...state.intent, ...patch },
          })),

        setIntentFull: (intent) => set({ intent }),

        resetIntent: () => set({ intent: DEFAULT_INTENT, activeStep: 1 }),

        setActiveStep: (step) => set({ activeStep: step }),
      }),
      {
        name: 'ndal-intent',
        // Only persist the intent object, not UI state
        partialize: (state) => ({ intent: state.intent }),
      }
    ),
    { name: 'NDAL Intent Store' }
  )
);
