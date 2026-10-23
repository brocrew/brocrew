import { providerDescriptor } from '@brobot2/shared'
import type { ApiKeyCheck } from '../../../shared/runtime-ipc'
import { checkKeyModelList } from '../key-check'

/** Codex's model list checks its key without spending a token. */
export async function checkCodexKey(
  key: string,
  fetchFor: typeof fetch = fetch,
): Promise<ApiKeyCheck> {
  const checked = await checkKeyModelList(providerDescriptor('codex').apiKey, key, fetchFor)
  return 'answer' in checked ? checked.answer : { ok: true }
}

export const keyPolicy = {
  check: checkCodexKey,
  loginRunsWithoutAKey: () => true,
}
