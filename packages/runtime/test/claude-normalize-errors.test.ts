import type { SDKAssistantMessageError, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { RuntimeEvent } from '../src/index'
import { normalizeMessage } from '../src/claude/normalize'

function sdk(message: Record<string, unknown>): SDKMessage {
  return message as unknown as SDKMessage
}

/**
 * 110 · A credential that was refused mid-session — the three real refusals, and what each becomes.
 *
 * ⛔ **Every text here was read out of this machine's own ledger, not invented.** Three incidents,
 * six weeks apart, three different sentences from the same `error: 'authentication_failed'`:
 *
 * ```
 * 2026-07-01  "Failed to authenticate. API Error: 401 Invalid authentication credentials"
 * 2026-07-22  "Not logged in · Please run /login"
 * 2026-08-10  "Failed to authenticate. API Error: 401 OAuth access token has been revoked."
 * ```
 *
 * That spread is the argument for never matching the English: three wordings, one fact, and the
 * only stable thing on the wire is the error WORD. In 7 of 7 such messages the whole content was
 * the notice — no tool call, no sentence the model wrote — which is what makes diverting the text
 * safe rather than lossy.
 */
const REAL_REFUSALS = [
  'Failed to authenticate. API Error: 401 Invalid authentication credentials',
  'Not logged in · Please run /login',
  'Failed to authenticate. API Error: 401 OAuth access token has been revoked.',
]

describe('a refused credential (110)', () => {
  // ⚑ **The frame as the SDK sends it** (680): the CLI wrote this message and says so with its model,
  // `<synthetic>` — measured on the SDK frame by `680` §1, and on the archived copy by 110. The marker,
  // not the one-text-block shape, is what diverts it now; see `a refusal is not the speaker's words`.
  const refused = (text: string): RuntimeEvent[] =>
    normalizeMessage(
      sdk({
        type: 'assistant',
        message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text }] },
        error: 'authentication_failed',
      }),
    )

  it('every real refusal becomes ONE fatal error carrying the provider’s own words', () => {
    for (const text of REAL_REFUSALS) {
      expect(refused(text), text).toEqual([
        { type: 'error', message: text, fatal: true, cause: 'auth_stale' },
      ])
    }
  })

  it('⚠️ the SDK’s notice is NOT published as something the assistant said', () => {
    for (const text of REAL_REFUSALS) {
      const events = refused(text)
      expect(
        events.filter((e) => e.type === 'assistant_message'),
        text,
      ).toEqual([])
      // …and the paired positive, or the assertion above passes over a normalizer that returned
      // nothing at all: the words still exist, on the error, verbatim.
      expect(events.filter((e) => e.type === 'error').map((e) => e.message)).toEqual([text])
    }
  })

  it('⚠️ a refusal that arrives BESIDE real content does not delete it (review)', () => {
    // ⚑ Since 680 the diversion is a rule about the MARKER — `model: "<synthetic>"` — and no longer
    // 110's shape ("the notice is the whole message"). This frame names no model, so it is not the
    // CLI's: its reply and its tool call stay, and the ending still lands. Written as "divert every
    // text run", both would have been swallowed into an `error.message` to make room for a notice.
    expect(
      normalizeMessage(
        sdk({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Let me check the logs…' },
              { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } },
            ],
          },
          error: 'authentication_failed',
        }),
      ),
    ).toEqual([
      { type: 'assistant_message', text: 'Let me check the logs…' },
      { type: 'tool_call', id: 'tu_1', name: 'Bash', summary: 'ls' },
      // …and the ending still lands, because it never depended on the diversion.
      {
        type: 'error',
        message: 'claude could not authenticate',
        fatal: true,
        cause: 'auth_stale',
      },
    ])
  })

  it('⚠️ the other unrecoverable-looking words do NOT end the session', () => {
    // `oauth_org_not_allowed` and `billing_error` are the two most easily mistaken for this, and
    // review argued both should end the session too. They must not: reopening cannot change which
    // account you are, and it cannot pay a bill — so the offer `auth_stale` makes would be wrong
    // advice, and a session ended on wrong advice is worse than one left open with a visible error.
    for (const word of ['oauth_org_not_allowed', 'billing_error']) {
      const events = normalizeMessage(
        sdk({ type: 'assistant', message: { role: 'assistant', content: [] }, error: word }),
      )
      const error = events.find((e) => e.type === 'error')
      if (!error || error.type !== 'error') throw new Error(`no error event for ${word}`)
      expect(error.fatal, word).toBe(false)
      expect(error.cause, word).toBeUndefined()
    }
  })

  it('a message that is not the CLI’s keeps its words, whatever its error word', () => {
    // ⚑ No marker, so not the CLI's notice (680). ⚠️ This is the control, not the CLI's shape: a
    // real reply cut at its limit arrives WITHOUT an error word, and the CLI's `max_output_tokens`
    // notice after it is `<synthetic>` — `a-refusal-is-not-the-speakers-words.test.ts` has both.
    expect(
      normalizeMessage(
        sdk({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'half an answer' }] },
          error: 'max_output_tokens',
        }),
      ),
    ).toEqual([
      { type: 'assistant_message', text: 'half an answer' },
      { type: 'error', message: 'the reply hit its maximum length', fatal: false },
    ])
  })

  it('a refusal with no text at all still says something a person can read', () => {
    expect(
      normalizeMessage(
        sdk({
          type: 'assistant',
          message: { role: 'assistant', content: [] },
          error: 'authentication_failed',
        }),
      ),
    ).toEqual([
      { type: 'error', message: 'claude could not authenticate', fatal: true, cause: 'auth_stale' },
    ])
  })

  const errorCases = [
    ['authentication_failed', 'claude could not authenticate'],
    ['oauth_org_not_allowed', 'this account is not allowed to use this organization'],
    ['account_on_hold', 'this account is on hold and claude will not answer it'],
    ['verification_required', 'claude will not answer until this account is verified'],
    ['cloud_credential_error', 'claude could not load the cloud credentials it runs on'],
    ['billing_error', 'claude reported a billing problem with this account'],
    ['rate_limit', 'claude is rate-limited'],
    ['overloaded', 'claude is overloaded'],
    ['invalid_request', 'claude rejected the request as invalid'],
    ['model_not_found', 'the model this conversation asks for is not available'],
    ['server_error', 'claude had a server-side error'],
    ['unknown', 'claude reported an error without saying what it was'],
    ['max_output_tokens', 'the reply hit its maximum length'],
  ] as const satisfies readonly (readonly [SDKAssistantMessageError, string])[]

  it('covers every SDK assistant error word with an independent expected sentence', () => {
    expectTypeOf<(typeof errorCases)[number][0]>().toEqualTypeOf<SDKAssistantMessageError>()
  })

  it.each(errorCases)('translates %s without exposing its SDK symbol', (word, expectedSentence) => {
    const events = normalizeMessage(
      sdk({ type: 'assistant', message: { role: 'assistant', content: [] }, error: word }),
    )
    const error = events.find((e) => e.type === 'error')
    if (!error || error.type !== 'error') throw new Error(`no error event for ${word}`)
    // Exact wording catches a mis-mapped error; the other checks also reject raw SDK symbols.
    expect(error.message, word).not.toContain('_')
    expect(error.message, word).not.toBe(word)
    expect(error.message.length, word).toBeGreaterThan(word.length)
    expect(error.message, word).toBe(expectedSentence)
  })

  it('a RETRY names the same cause in words, and deliberately does not end anything', () => {
    // Read `error` beside `error_status`; otherwise the frame shows only “API error (HTTP
    // 401)” until the ending arrives two seconds later.
    const events = normalizeMessage(
      sdk({
        type: 'system',
        subtype: 'api_retry',
        attempt: 1,
        max_retries: 10,
        retry_delay_ms: 600,
        error_status: 401,
        error: 'authentication_failed',
      }),
    )
    expect(events).toEqual([
      {
        type: 'error',
        message:
          'claude could not authenticate; retrying (attempt 1/10, retrying in 0.6s, HTTP 401)',
        fatal: false,
      },
    ])
    // No `cause`, and that is the ruling, not an oversight: a retry may still succeed, and dressing
    // it as the terminal state would end a session the SDK had not given up on.
    const retry = events[0]
    if (!retry || retry.type !== 'error') throw new Error('no error event')
    expect(retry.cause).toBeUndefined()
    expect(retry.fatal).toBe(false)
  })

  it('a retry frame that names no error still explains the pause', () => {
    // `error_status: null` is documented for connection errors with no HTTP response.
    expect(
      normalizeMessage(
        sdk({
          type: 'system',
          subtype: 'api_retry',
          attempt: 2,
          max_retries: 10,
          retry_delay_ms: 1100,
          error_status: null,
        }),
      ),
    ).toEqual([
      {
        type: 'error',
        message: 'claude hit an API error; retrying (attempt 2/10, retrying in 1.1s)',
        fatal: false,
      },
    ])
  })
})
