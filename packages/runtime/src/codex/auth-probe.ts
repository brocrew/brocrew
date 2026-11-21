import type { AuthState } from '../auth-state'
import type { CodexTransport } from './codex-transport'

/**
 * Ask Codex whether this profile's credential still works, using two local requests that spend no
 * network call or token: `getAuthStatus` reports the configured login kind and `account/read`
 * reports the account only when the access token is usable. `getAuthStatus` alone cannot detect an
 * expired credential.
 *
 * Both probes pass `refreshToken: false`: the profile copy shares its refresh token with the user's
 * own `~/.codex`, and refreshing rotates it and would sign that CLI out. `includeToken` is also
 * false so the bearer token never enters this process or its logs.
 */

/** Both probe requests, with refresh and token inclusion off. */
const AUTH_STATUS_PARAMS = { includeToken: false, refreshToken: false }
const ACCOUNT_PARAMS = { refreshToken: false }

/**
 * `CodexErrorInfo` value for a rejected credential. It arrives on `error` and again in
 * `turn/completed`'s `turn.error`, so callers match this typed field instead of `message`, which
 * stays verbatim for diagnostics.
 */
export const CODEX_UNAUTHORIZED = 'unauthorized'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

function readString(value: unknown, key: string): string {
  const field = readField(value, key)
  return typeof field === 'string' ? field : ''
}

/**
 * The `codexErrorInfo` members that carry the provider's HTTP status: a 401 on any of them is the
 * credential refused. Codex 0.160 reports a key OpenAI refuses as `httpConnectionFailed` with 401,
 * after its reconnects, not as `unauthorized`.
 */
const WITH_A_STATUS = [
  'httpConnectionFailed',
  'responseStreamConnectionFailed',
  'responseStreamDisconnected',
  'responseTooManyFailedAttempts',
] as const

/**
 * Whether a `TurnError` is the provider rejecting the credential: `unauthorized`, or a 401 on a
 * member that carries a status. It reads `codexErrorInfo` rather than `message` so UI behaviour does
 * not depend on English diagnostics; the one untyped refusal is {@link CODEX_SIGN_IN_REFUSED_AT_ROUTING}.
 */
export function isCodexUnauthorized(turnError: unknown): boolean {
  const info = readField(turnError, 'codexErrorInfo')
  if (info === CODEX_UNAUTHORIZED) return true
  if (WITH_A_STATUS.some((kind) => readField(readField(info, kind), 'httpStatusCode') === 401)) {
    return true
  }
  return readField(turnError, 'message') === CODEX_SIGN_IN_REFUSED_AT_ROUTING
}

/**
 * Codex fails a refused ChatGPT workspace-routing discovery (401) with this message and types it
 * `other`, so the whole message is the only way to tell it from a network fault. `pnpm run
 * protocol:check` fails when the bundled Codex stops carrying it.
 */
export const CODEX_SIGN_IN_REFUSED_AT_ROUTING = 'workspace routing discovery unauthorized (401)'

/**
 * Classify auth state from the two probe responses. A login kind with no account is `stale`, not
 * `absent`, because the remedy differs.
 */
export function codexAuthStateFrom(status: unknown, account: unknown): AuthState {
  // Both response fields are `T | null`, so a real answer always carries the key. A missing key means
  // the server did not answer, which must not be read as signed out.
  if (!hasKey(status, 'authMethod') || !hasKey(account, 'account')) {
    return {
      state: 'unknown',
      reason: 'This Codex build did not answer whether this profile is signed in.',
    }
  }

  const method = readField(status, 'authMethod')
  const authMethod = typeof method === 'string' && method.length > 0 ? method : null
  if (authMethod === null) {
    return { state: 'absent', reason: 'This profile has no Codex sign-in yet.' }
  }

  // The account must be an object: other non-null values are not an account and must not count as
  // usable.
  const accountValue = readField(account, 'account')
  if (!isRecord(accountValue)) {
    return {
      state: 'stale',
      reason: "This profile's Codex sign-in has expired and can no longer start a turn.",
    }
  }
  // The identity is the email; a login category such as `apiKey` is never shown as an account.
  const email = readString(accountValue, 'email')
  const plan = readString(accountValue, 'planType')
  return {
    state: 'usable',
    ...(email ? { account: email } : {}),
    // `chatgpt*` methods are account sign-ins; every other method is a supplied key.
    login: authMethod.startsWith('chatgpt') ? 'account' : 'api-key',
    // `unknown` means Codex has no plan to report.
    ...(plan && plan !== 'unknown' ? { plan } : {}),
    // Codex renews its own token and reports no expiry.
    expiresAt: null,
  }
}

/** Whether the provider answered this field at all; `null` is an answer, absence is not. */
function hasKey(value: unknown, key: string): boolean {
  return isRecord(value) && key in value
}

/**
 * Ask a running app-server. A failing request yields `unknown` rather than a verdict, since a
 * transport failure says nothing about the credential.
 */
export async function probeCodexAuth(transport: CodexTransport): Promise<AuthState> {
  try {
    const [status, account] = await Promise.all([
      transport.request('getAuthStatus', AUTH_STATUS_PARAMS),
      transport.request('account/read', ACCOUNT_PARAMS),
    ])
    return codexAuthStateFrom(status, account)
  } catch {
    // The transport error can embed the child's raw stderr, so it is not put in `reason`, which is
    // shown to a person.
    return {
      state: 'unknown',
      reason: "Codex did not answer when asked about this profile's sign-in.",
    }
  }
}
