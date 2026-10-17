import type { SDKAssistantMessageError } from '@anthropic-ai/claude-agent-sdk'

/**
 * Claude's error WORDS, said in words a reader can act on (110) — thirteen at the pinned 0.3.281.
 *
 * Translate the SDK's `SDKAssistantMessageError` union for both retry frames and final assistant failures. Rendering the raw symbol, such as `authentication_failed`, leaves the person a type name instead of an explanation.
 *
 * ⚠️ **A `Record` over the union rather than a `switch` with a `default`.** The point of translating
 * is that no untranslated symbol can reach a surface, and a `default` arm is exactly how the next
 * member would: it would return something plausible and no test would fail. Written this way, an SDK
 * that adds a member breaks the build here, which is the same guard `messageTypeCategory` uses in
 * `normalize.ts` and the reason `rate_limit_event` was caught before a user saw it.
 *
 * The wording is deliberately about **what is true of the conversation**, not about what the API
 * returned: "claude could not authenticate" rather than "HTTP 401 authentication_failed". The status
 * code is not lost — it stays on the retry line, which is a diagnostic register, and the provider's
 * whole sentence stays on the error's `message` for the log and the ledger (085's split).
 */
const ASSISTANT_ERROR_WORDS: Record<SDKAssistantMessageError, string> = {
  authentication_failed: 'claude could not authenticate',
  oauth_org_not_allowed: 'this account is not allowed to use this organization',
  // ⚑ **Three words the pinned SDK grew between 0.3.218 and 0.3.281** (680) — this `Record` failed
  // the build on the bump, which is what it is for. Each is said as what is true of the conversation;
  // the CLI's own notice (an appeal link, a provider name) rides on the error's `message` (680, R28b).
  account_on_hold: 'this account is on hold and claude will not answer it',
  verification_required: 'claude will not answer until this account is verified',
  cloud_credential_error: 'claude could not load the cloud credentials it runs on',
  billing_error: 'claude reported a billing problem with this account',
  rate_limit: 'claude is rate-limited',
  overloaded: 'claude is overloaded',
  invalid_request: 'claude rejected the request as invalid',
  model_not_found: 'the model this conversation asks for is not available',
  server_error: 'claude had a server-side error',
  unknown: 'claude reported an error without saying what it was',
  max_output_tokens: 'the reply hit its maximum length',
}

/**
 * A readable line for one of Claude's error words. An unrecognized value — a wire that disagrees
 * with the pinned types — is reported AS unrecognized rather than passed through, so a symbol still
 * cannot reach a surface by the one route the type system does not cover.
 */
export function assistantErrorWords(error: string): string {
  return (
    ASSISTANT_ERROR_WORDS[error as SDKAssistantMessageError] ??
    'claude reported an error this app does not recognize'
  )
}

/**
 * The one error word that means **the credential this session is holding has stopped working**.
 *
 * Deliberately just the one. `oauth_org_not_allowed` is about who the account IS and reopening
 * cannot change it; `billing_error` is not a credential at all. Both are real refusals and both keep
 * today's behaviour — a visible error on a session that stays open — because neither is fixed by the
 * thing `auth_stale` offers. ⚑ So are 0.3.281's three (680): `account_on_hold` and
 * `verification_required` are about the account, and `cloud_credential_error` is the CLI's
 * Bedrock/Vertex credential load, which it marks transient itself — none of them is the Keychain
 * token this child was handed, and none is fixed by reopening.
 */
export function isCredentialFailure(error: string): boolean {
  return error === 'authentication_failed'
}
