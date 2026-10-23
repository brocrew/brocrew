import type { ProviderDescriptor } from '@brobot2/shared'
import type { ApiKeyCheck } from '../../shared/runtime-ipc'

/** How long a check waits for the provider before it says it could not reach it. */
export const KEY_CHECK_TIMEOUT_MS = 15_000

type ListedModels = {
  readonly listed: Response
  readonly issuer: string
  readonly headers: Record<string, string>
  readonly unreachable: ApiKeyCheck
}

/** The shared no-cost request and its neutral HTTP refusals; providers own any further check. */
export async function checkKeyModelList(
  facts: ProviderDescriptor['apiKey'],
  key: string,
  fetchFor: typeof fetch,
): Promise<ListedModels | { readonly answer: ApiKeyCheck }> {
  const issuer = facts.issuer
  const headers: Record<string, string> = {
    [facts.header]: `${facts.prefix}${key}`,
    ...facts.extraHeaders,
  }
  const unreachable: ApiKeyCheck = {
    ok: false,
    reason: `BroCrew could not reach ${issuer} to check the key. Check this computer’s connection and try again.`,
  }
  let listed: Response
  try {
    listed = await fetchFor(facts.checkUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
    })
  } catch {
    return { answer: unreachable }
  }
  if (!succeeded(listed.status)) return { answer: refusedAt(issuer, listed.status) }
  return { listed, issuer, headers, unreachable }
}

export async function bodyOf(answer: Response): Promise<unknown> {
  try {
    return await answer.json()
  } catch {
    return null
  }
}

export function succeeded(status: number): boolean {
  return status >= 200 && status < 300
}

/** The words for a status that refused the check. */
export function refusedAt(issuer: string, status: number): ApiKeyCheck {
  if (status === 401) {
    return {
      ok: false,
      reason: `${issuer} did not accept this key. Check it, or save it again from your ${issuer} account.`,
    }
  }
  if (status === 403) {
    // Known, and refused this one request: a key restricted to fewer permissions answers so, and
    // agents may still run on it. The check cannot tell, and says only that.
    return {
      ok: false,
      reason: `${issuer} knows this key but refused the check’s request, which needs permission to list models. Agents may still run on it; if they do not, check its permissions in your ${issuer} account.`,
    }
  }
  return {
    ok: false,
    reason: `${issuer} answered ${String(status)} when the key was checked. Try again in a moment.`,
  }
}
