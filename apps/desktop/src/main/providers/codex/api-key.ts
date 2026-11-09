const KEY_CHECK = {
  issuer: 'OpenAI',
  checkUrl: 'https://api.openai.com/v1/models',
  spendsToken: false,
  header: 'authorization',
  prefix: 'Bearer ',
  extraHeaders: {},
  windowsLoginNeedsFile: false,
}
import type { ApiKeyCheck } from '../../../shared/runtime-ipc'
import { checkKeyModelList } from '../key-check'

/** Codex's model list checks its key without spending a token. */
async function checkCodexKey(key: string, fetchFor: typeof fetch = fetch): Promise<ApiKeyCheck> {
  const checked = await checkKeyModelList(KEY_CHECK, key, fetchFor)
  return 'answer' in checked ? checked.answer : { ok: true }
}

export const keyPolicy = {
  check: checkCodexKey,
  loginRunsWithoutAKey: () => true,
}
