import { claudeCredentialsFileReader, parseClaudeOAuthToken } from '@brobot2/runtime'
import { providerDescriptor } from '@brobot2/shared'
import type { ApiKeyCheck } from '../../../shared/runtime-ipc'
import { bodyOf, checkKeyModelList, KEY_CHECK_TIMEOUT_MS, refusedAt, succeeded } from '../key-check'

/**
 * Whether removing a provider's key leaves a login it runs on here, for the words a refused key is
 * said with. Codex has its own sign-in on either platform. Claude runs on the person's own Claude
 * Code login: on a Mac it is not read for this; on Windows its file is, and an expired one counts,
 * since a start renews it. Linux, where the tests run, answers as a Mac does.
 */
export function aLoginRunsWithoutAKey(
  platform: NodeJS.Platform = process.platform,
  readClaudeLogin: () => string | null = () => claudeCredentialsFileReader()(),
): boolean {
  if (!providerDescriptor('claude').apiKey.windowsLoginNeedsFile || platform !== 'win32')
    return true
  try {
    return parseClaudeOAuthToken(readClaudeLogin(), 0) !== null
  } catch {
    return false
  }
}

/** Where a Claude check sends its one-token request, to learn whether the key's account can pay. */
const CLAUDE_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'

/**
 * The model a Claude check spends its one token on: the newest Haiku in the provider's own list,
 * the cheapest family, or else the newest model listed. Read from the list rather than named here,
 * so a retired model is never asked for. `null` when the list names none.
 */
export function theCheapestModel(ids: readonly string[]): string | null {
  return ids.find((id) => id.includes('haiku')) ?? ids[0] ?? null
}

/** The `id`s of an Anthropic model list, newest first as the provider sends them. */
function modelIdsIn(body: unknown): string[] {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  return data.flatMap((row) => {
    const id = (row as { id?: unknown } | null)?.id
    return typeof id === 'string' ? [id] : []
  })
}

/**
 * Whether an Anthropic refusal says the key's account can't pay. Its `billing_error` type, or a 402,
 * says so; a request refused for a balance with no credit comes back as a 400
 * `invalid_request_error` whose only sign is its message, so that is read too. Only classified,
 * never shown.
 */
function cannotPay(status: number, body: unknown): boolean {
  const error = (body as { error?: { type?: unknown; message?: unknown } } | null)?.error
  if (status === 402 || error?.type === 'billing_error') return true
  return (
    status === 400 &&
    typeof error?.message === 'string' &&
    error.message.toLowerCase().includes('credit balance')
  )
}

/** The native one-token billing check, after the same no-cost list request. */
export async function checkClaudeKey(
  key: string,
  fetchFor: typeof fetch = fetch,
): Promise<ApiKeyCheck> {
  const checked = await checkKeyModelList(providerDescriptor('claude').apiKey, key, fetchFor)
  if ('answer' in checked) return checked.answer
  const { listed, issuer, headers, unreachable } = checked
  if (!providerDescriptor('claude').apiKey.spendsToken) return { ok: true }
  const model = theCheapestModel(modelIdsIn(await bodyOf(listed)))
  if (model === null) return { ok: true }
  let asked: Response
  try {
    asked = await fetchFor(CLAUDE_MESSAGES_URL, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'Hi' }] }),
      signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
    })
  } catch {
    return unreachable
  }
  if (succeeded(asked.status)) return { ok: true, answeredARequest: true }
  if (cannotPay(asked.status, await bodyOf(asked))) {
    return {
      ok: false,
      cannotPay: true,
      reason: `${issuer} knows this key, but the account it belongs to can’t pay for a request. Add credit to that account in the ${issuer} console, or save another key.`,
    }
  }
  if (asked.status === 429) {
    return {
      ok: false,
      reason: `${issuer} accepted the key but is limiting requests on it right now, so the check could not tell whether its account can pay. Try again in a moment.`,
    }
  }
  if (asked.status === 403) {
    return {
      ok: false,
      reason: `${issuer} knows this key but refused the check’s one-token request, so agents may not run on it either. Check its permissions in your ${issuer} account.`,
    }
  }
  return refusedAt(issuer, asked.status)
}

export const keyPolicy = {
  check: checkClaudeKey,
  loginRunsWithoutAKey: aLoginRunsWithoutAKey,
}
