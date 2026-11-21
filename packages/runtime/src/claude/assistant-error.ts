import type { SDKAssistantMessageError } from '@anthropic-ai/claude-agent-sdk'

/**
 * Claude's error words, said in words a reader can act on. Translates the SDK's
 * `SDKAssistantMessageError` union for retry frames and final assistant failures, so a raw symbol
 * such as `authentication_failed` never reaches a person.
 *
 * It is a `Record` over the union rather than a `switch` with a `default`, so an SDK that adds a
 * member breaks the build here instead of returning something plausible. The wording says what is
 * true of the conversation, not what the API returned; the status code stays on the retry line and
 * the provider's whole sentence on the error's `message`, for the log and ledger.
 */
const ASSISTANT_ERROR_WORDS: Record<SDKAssistantMessageError, string> = {
  authentication_failed: 'claude could not authenticate',
  oauth_org_not_allowed: 'this account is not allowed to use this organization',
  // The CLI's own notice (an appeal link, a provider name) rides on the error's `message`.
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
 * A readable line for one of Claude's error words. An unrecognized value (a wire that disagrees with
 * the SDK types) is reported as unrecognized rather than passed through.
 */
export function assistantErrorWords(error: string): string {
  return (
    ASSISTANT_ERROR_WORDS[error as SDKAssistantMessageError] ??
    'claude reported an error this app does not recognize'
  )
}

/**
 * The one error word that means the credential this session holds has stopped working. The others
 * stay visible errors on an open session because reopening does not fix them: `oauth_org_not_allowed`
 * and `account_on_hold`/`verification_required` are about the account, `billing_error` is not a
 * credential, and `cloud_credential_error` is the CLI's Bedrock/Vertex credential load, which it marks
 * transient itself. None is the Keychain token this child was handed.
 */
export function isCredentialFailure(error: string): boolean {
  return error === 'authentication_failed'
}
