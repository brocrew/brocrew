import type { AuthState } from '../auth-state'
import type { CodexTransport } from './codex-transport'

/**
 * Asking Codex whether this profile's credential still works — instead of reading its error
 * sentence after a turn has already failed (098).
 *
 * ## Measured, on the bundled 0.146.0 binary, against three real homes
 *
 * Two requests answer it, and **both are local**: no network call, no token spent. That is not an
 * assumption — a synthetic credential holding an unsigned JWT with a far-future `exp` and the email
 * `probe@example.invalid` came back as a signed-in `chatgpt` account, which no server would have
 * agreed to. `account/read` is reading the token in the file, not phoning home.
 *
 * | `CODEX_HOME` holds | `getAuthStatus.authMethod` | `account/read.account` | verdict |
 * |---|---|---|---|
 * | no `auth.json` | `null` | `null` | absent |
 * | synthetic API key | `"apikey"` | `{type:'apiKey'}` | usable |
 * | valid synthetic ChatGPT tokens | `"chatgpt"` | `{type:'chatgpt', email, planType}` | usable |
 * | stale ChatGPT profile copy | `"chatgpt"` | `null` | stale |
 *
 * ⚠️ **`getAuthStatus` alone cannot tell you.** It reports `"chatgpt"` for a credential that expired
 * eleven days ago exactly as it does for a working one — it answers "what KIND of login is
 * configured here", which is a different question. The dispatch named it as the verb and it is half
 * of the verb; `account/read` is the half that knows.
 *
 * **What `account: null` tracks, isolated by two more synthetic homes:**
 *
 * | id token | access token | `account/read` |
 * |---|---|---|
 * | expired | valid | `{type:'chatgpt', …}` |
 * | valid | **expired** | **`null`** |
 *
 * So it follows the **access** token — the one that has to be refreshed for a turn to run, and the
 * one whose refresh is what fails. That is the fact we want, and not a proxy for it.
 *
 * ## What this probe deliberately does NOT do
 *
 * 🔒 **`refreshToken` is `false`, always, and it is not a tuning knob.** `GetAuthStatusParams` and
 * `GetAccountParams` both offer to refresh first, and doing so would consume the refresh token —
 * which the profile copy **shares** with the user's own `~/.codex`. OAuth rotates that token on
 * use, so a refresh here invalidates their CLI. The bug this file exists to detect would then be
 * caused by the detector. A background auto-refresh is the same mistake on a timer.
 *
 * 🔒 **`includeToken` is `false`.** The response would otherwise carry the bearer token itself into
 * our process and into anything that logged the response. We never need it and we never ask.
 */

/** The two probe requests, pinned to their generated params shapes with both refresh knobs off. */
const AUTH_STATUS_PARAMS = { includeToken: false, refreshToken: false }
const ACCOUNT_PARAMS = { refreshToken: false }

/**
 * Use `CodexErrorInfo`'s credential-rejection member as the machine-readable reason for UI translation. Keep `TurnError.message` verbatim for diagnostics. A stale credential can produce this wire shape:
 *
 * ```
 * ← {"method":"error","params":{"error":{
 *      "message":"Your access token could not be refreshed because your refresh token was already used…",
 *      "codexErrorInfo":"unauthorized","additionalDetails":null},"willRetry":false,…}}
 * ```
 *
 * ⚠️ It arrives on `error` **and** again inside `turn/completed`'s `turn.error`, because the turn
 * fails rather than the request — which is exactly why 085's refusal conversion did not already
 * cover this path.
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
 * Whether a `TurnError` (from an `error` notification or a failed `turn/completed`) is the provider
 * saying the credential was rejected: `unauthorized`, or a 401 on a member that carries a status.
 *
 * ⚠️ **The check is on `codexErrorInfo`, never on `message`.** Matching the English would make every
 * one of those diagnostics load-bearing UI copy — 085's finding, and the reason this takes the typed
 * field even though the prose is more specific. ⚑ One refusal Codex does not type is the exception,
 * and it is matched whole: {@link CODEX_SIGN_IN_REFUSED_AT_ROUTING}.
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
 * ⛔ **The one sentence this file reads**, because Codex gives this refusal no type. When the
 * request that finds a ChatGPT account's workspace is answered 401, Codex first re-reads the sign-in
 * file and tries a renewal; only when both are spent does it fail, with the category
 * `WorkspaceRoutingError::DiscoveryUnauthorized`
 * (`app-server/src/request_processors/account_processor/workspace_routing.rs`). That reaches a
 * client as an I/O error, which Codex types `other`, so this fixed sentence is all that tells a
 * refused sign-in from a network fault, whose categories read otherwise. ⚑ Matched whole, against
 * the turn's own failure. ⚠️ `pnpm run protocol:check` fails when the bundled Codex no longer holds
 * it: read that file at the new tag before changing this.
 */
export const CODEX_SIGN_IN_REFUSED_AT_ROUTING = 'workspace routing discovery unauthorized (401)'

/**
 * The verdict, from the two responses alone — **pure**, so the classification is testable without a
 * process and the live probe below is only the part that fetches.
 *
 * `authMethod` present with no account is the whole point of the pair: a credential is configured
 * and the provider cannot use it. That is `stale` and not `absent`, and the difference decides which
 * remedy a surface offers.
 */
export function codexAuthStateFrom(status: unknown, account: unknown): AuthState {
  // ⚠️ **Key PRESENCE first, and it is the difference between two opposite claims.** Both generated
  // response types declare their field as `T | null` — `GetAuthStatusResponse.authMethod`,
  // `GetAccountResponse.account` — so a real answer always carries the key, and an explicit `null`
  // means "I looked, there is nothing". A response with the key MISSING is a server that did not
  // answer the question at all: an older app-server, a non-conformant one, a stub. Reading that as
  // `absent` would tell a user their profile is signed out on the evidence of a method that was
  // never implemented, which is 029/030's mistake in a place where it costs a credential.
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

  // ⚠️ **A RECORD, not merely "not null"** (review finding 10). The generated `Account` is a union of
  // objects; `false`, `0`, `''` and a bare string are all "not null" and none of them is an account.
  // Reading any of them as `usable` would let a non-conformant reply wave through a credential the
  // provider never said was good — the one direction this classifier must never be wrong in.
  const accountValue = readField(account, 'account')
  if (!isRecord(accountValue)) {
    return {
      state: 'stale',
      reason: "This profile's Codex sign-in has expired and can no longer start a turn.",
    }
  }
  // ⚑ `Account` is a union: a `chatgpt` account reports an email and a plan, an `apiKey` one nothing
  // (`{type:'apiKey'}`). The account is its EMAIL — identity only, `auth-state.ts`' note — and the
  // plan is its own field. ⚠️ A category (`apiKey`, `amazonBedrock`) is never offered as an identity:
  // *"signed in as apiKey"* answers *"which account am I on?"* with a non-answer.
  const email = readString(accountValue, 'email')
  const plan = readString(accountValue, 'planType')
  return {
    state: 'usable',
    ...(email ? { account: email } : {}),
    // ⚑ A sign-in to an account is ChatGPT's (`chatgpt`, `chatgptAuthTokens`); every other method
    // Codex names — `apikey`, Bedrock's keys, a personal access token, headers — is a key it was given.
    login: authMethod.startsWith('chatgpt') ? 'account' : 'api-key',
    // ⚑ `unknown` is Codex not knowing the plan, so there is no plan to say.
    ...(plan && plan !== 'unknown' ? { plan } : {}),
    // ⚑ Codex renews its own token and reports no expiry for it, so it is not known here.
    expiresAt: null,
  }
}

/** Whether the provider answered this field AT ALL — `null` is an answer, absence is not. */
function hasKey(value: unknown, key: string): boolean {
  return isRecord(value) && key in value
}

/**
 * Ask a **running** app-server. Two round trips on a transport the caller already has, so the
 * session-start path pays a couple of milliseconds rather than a second spawn.
 *
 * A request that throws yields {@link AuthState.unknown} rather than a verdict: the transport
 * failing tells us nothing about the credential, and reporting it as an expired login would be the
 * fabrication this module exists to prevent.
 */
export async function probeCodexAuth(transport: CodexTransport): Promise<AuthState> {
  try {
    const [status, account] = await Promise.all([
      transport.request('getAuthStatus', AUTH_STATUS_PARAMS),
      transport.request('account/read', ACCOUNT_PARAMS),
    ])
    return codexAuthStateFrom(status, account)
  } catch {
    // 🔒 **The provider's diagnostic is deliberately NOT carried out of here** (review finding 9).
    // A rejected `CodexTransport.request` is built from up to 500 bytes of the child's raw stderr —
    // and the child is the one holding a credential. `reason` is rendered to a person, so it is ours;
    // the raw text belongs in a log, which is the host's job (see `logAuthDiagnostic`) and is where
    // 085 put every other adapter diagnostic.
    return {
      state: 'unknown',
      reason: "Codex did not answer when asked about this profile's sign-in.",
    }
  }
}
