import { useMutation } from '@tanstack/react-query'
import { parseIntent } from '@/api/client'
import type { IntentParseResult } from '@/types'

export function useIntentParse() {
  return useMutation<IntentParseResult, Error, string>({
    mutationFn: (description) => parseIntent(description),
  })
}
