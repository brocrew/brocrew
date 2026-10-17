import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  TURN_FAILED,
  providerErrorSentence,
  refusalSentence,
  turnFailureDetail,
} from '../src/renderer/src/lib/provider-error'
import {
  applyEvent,
  createTranscript,
  type NoticeItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'

/**
 * ⛔ **One failure, told once** (246 §1, from `244`'s only finding).
 *
 * ⚑ **Every string below marked MEASURED came off the wire**, in the run `scripts/ui-live-smoke.mjs`
 * step 73 makes: a Codex conversation launched on `brobot-246-no-such-model`, one plain prompt, and
 * the app's own ledger at ordinals 8/15/16/17. Nothing here is a plausible-looking fixture.
 */

/** MEASURED — the `error` notification's whole message, 177 characters of envelope. */
const ENVELOPE =
  '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The ' +
  "'brobot-246-no-such-model' model is not supported when using Codex with a ChatGPT account.\"}}"

/** MEASURED — the sentence inside it, which is what a person is owed. */
const SENTENCE =
  "The 'brobot-246-no-such-model' model is not supported when using Codex with a ChatGPT account."

/** MEASURED — the fallback-model warning, which is a DIFFERENT fact and 246 §4 forbids folding. */
const WARNING =
  'warning: Model metadata for `brobot-246-no-such-model` not found. Defaulting to fallback ' +
  'metadata; this can degrade performance and cause issues.'

function notices(state: TranscriptState): string[] {
  return state.items
    .filter((item): item is NoticeItem & { at?: number } => item.kind === 'notice')
    .map((item) => item.text)
}

function feed(state: TranscriptState, ...events: TranscriptEvent[]): TranscriptState {
  for (const event of events) applyEvent(state, event)
  return state
}

/** The four events 244 read, in the order the ledger recorded them. */
function theFourNarrations(): TranscriptEvent[] {
  return [
    { type: 'user_turn', text: 'Reply with exactly OK.' },
    { type: 'error', message: WARNING, fatal: false },
    { type: 'error', message: ENVELOPE, fatal: false },
    { type: 'error', message: `turn failed: ${ENVELOPE}`, fatal: false },
    { type: 'turn', state: 'failed' },
  ]
}

describe('the sentence inside a machine envelope (246 §1)', () => {
  it('⛔ takes the message out of the 400 a person cannot read', () => {
    expect(providerErrorSentence(ENVELOPE)).toBe(SENTENCE)
  })

  it('⛔ leaves text that is ALREADY a sentence exactly as it arrived', () => {
    // Preserve the provider’s own measured error words rather than inventing a rewrite. All
    // three fixtures come from observed provider outputs.
    for (const said of [
      'claude is approaching its rate limit (seven_day); resets 2026-08-18T19:00:00.000Z',
      'Claude Code native binary at /Users/…/claude exists but failed to launch.',
      WARNING,
    ]) {
      expect(providerErrorSentence(said)).toBe(said)
    }
  })

  it('⛔ hands back the envelope when it cannot be opened, rather than an empty line', () => {
    // Malformed, not an object, and an object whose only `message` is whitespace. A notice with no
    // text at all is worse than one a reader has to squint at.
    expect(providerErrorSentence('{"error": {')).toBe('{"error": {')
    expect(providerErrorSentence('["not", "an", "object"]')).toBe('["not", "an", "object"]')
    expect(providerErrorSentence('{"error":{"message":"   "}}')).toBe('{"error":{"message":"   "}}')
    expect(providerErrorSentence('{"status":400}')).toBe('{"status":400}')
  })

  it('⛔ prefers the DEEPEST message — the transport summary is not what happened', () => {
    expect(
      providerErrorSentence('{"message":"Request failed","error":{"message":"the model is gone"}}'),
    ).toBe('the model is gone')
  })

  it('⚑ opens an envelope nested inside an envelope, and stops', () => {
    const inner = JSON.stringify({ error: { message: 'the innermost sentence' } })
    expect(providerErrorSentence(JSON.stringify({ error: { message: inner } }))).toBe(
      'the innermost sentence',
    )
    // ⚠️ Bounded: a payload that nests forever costs a constant amount of work and still returns a
    // string rather than hanging the fold. This is the 052/069 rule, applied to a string off the wire.
    let deep = '{"message":"floor"}'
    for (let level = 0; level < 200; level += 1) deep = `{"error":${deep}}`
    expect(typeof providerErrorSentence(deep)).toBe('string')
  })
})

describe('recognizing the turn’s own ending (246 §1)', () => {
  it('reads the reason out of a prefixed terminal message, and nothing else', () => {
    expect(turnFailureDetail(`turn failed: ${ENVELOPE}`)).toBe(ENVELOPE)
    expect(turnFailureDetail(TURN_FAILED)).toBe('')
    expect(turnFailureDetail('turn failed to start the sandbox')).toBeNull()
    expect(turnFailureDetail(ENVELOPE)).toBeNull()
    expect(turnFailureDetail('')).toBeNull()
  })

  it('⛔ …and every producer of that string still produces one this recognizes', () => {
    // ⛔ **The constant lives here and the three producers live in `packages/runtime`, which 246 §4
    // put out of bounds** (it is 243's tree). So it is pinned by reading them: every `turn failed`
    // STRING LITERAL in the three files that build one is rendered with a probe in place of its
    // interpolations and handed to `turnFailureDetail`. A rename there fails here, loudly, instead
    // of turning the fold into a silent no-op.
    const producers = [
      '../../../packages/runtime/src/codex/normalize.ts',
      '../../../packages/runtime/src/claude/normalize.ts',
      '../../../packages/runtime/src/internal/session-machine.ts',
    ]
    const built: string[] = []
    for (const rel of producers) {
      const source = readFileSync(new URL(rel, import.meta.url), 'utf8')
      // Delimited literals only: the doc comment in `session-machine.ts` quotes
      // `"turn failed: error_during_execution"` as prose, and prose is not a producer.
      for (const literal of source.match(/[`']turn failed[^`'\n]*[`']/g) ?? []) {
        built.push(literal.slice(1, -1).replaceAll(/\$\{[^}]*\}/g, 'PROBE'))
      }
    }
    // Non-vacuous: three files, at least one literal each. A regex that matched nothing would make
    // every assertion below pass over an empty list.
    expect(built.length, `found: ${built.join(' · ')}`).toBeGreaterThanOrEqual(producers.length)
    for (const message of built) {
      expect(
        turnFailureDetail(message),
        `a producer builds "${message}", which this app no longer reads as the turn's own ending`,
      ).not.toBeNull()
    }
  })
})

describe('what a person reads when a turn fails (246 §1)', () => {
  it('⛔ 244’s conversation: one cause, then one receipt — the envelope read ZERO times', () => {
    const said = notices(feed(createTranscript(), ...theFourNarrations()))

    // ⛔ THE finding, as a count. 244 read the 177-char envelope twice.
    expect(said.filter((line) => line.includes(ENVELOPE))).toEqual([])
    expect(said.filter((line) => line.includes(SENTENCE))).toHaveLength(1)
    // ⛔ 177/246 §4: the reroute/fallback disclosure is a different fact and survives beside it.
    expect(said).toEqual([WARNING, SENTENCE, 'turn failed'])
  })

  it('⛔ …and the fold is what does it, not the shape of this one payload', () => {
    // The same three narrations with a cause that is already words. The duplicate still goes, and
    // the words still stand — so nothing here depends on the cause being JSON.
    const said = notices(
      feed(
        createTranscript(),
        { type: 'user_turn', text: 'go' },
        { type: 'error', message: 'the workspace is read-only', fatal: false },
        { type: 'error', message: 'turn failed: the workspace is read-only', fatal: false },
        { type: 'turn', state: 'failed' },
      ),
    )
    expect(said).toEqual(['the workspace is read-only', 'turn failed'])
  })

  it('⛔ a reason said NOWHERE else is still said — Claude’s subtype is the only account it has', () => {
    // `claudeResultOutcome` builds `turn failed: <subtype>` and there is no separate error
    // notification behind it. Dropping every prefixed message would delete the only thing the
    // conversation ever says about why.
    const said = notices(
      feed(
        createTranscript(),
        { type: 'user_turn', text: 'go' },
        { type: 'error', message: 'turn failed: error_during_execution', fatal: false },
        { type: 'turn', state: 'failed' },
      ),
    )
    expect(said).toEqual(['error_during_execution', 'turn failed'])
  })

  it('⛔ a DIFFERENT reason is not swallowed by a cause said earlier in the turn', () => {
    const said = notices(
      feed(
        createTranscript(),
        { type: 'user_turn', text: 'go' },
        { type: 'error', message: 'claude is rate-limited', fatal: false },
        { type: 'error', message: 'turn failed: the sandbox exited', fatal: false },
        { type: 'turn', state: 'failed' },
      ),
    )
    expect(said).toEqual(['claude is rate-limited', 'the sandbox exited', 'turn failed'])
  })

  it('⛔ the bare `turn failed` says nothing the receipt does not, and is not said twice', () => {
    // `SessionMachine.completeTurn` emits exactly this when the provider named no reason at all.
    // Before 246 the transcript drew it AND the receipt: `turn failed` on two consecutive lines.
    const said = notices(
      feed(
        createTranscript(),
        { type: 'user_turn', text: 'go' },
        { type: 'error', message: 'turn failed', fatal: false },
        { type: 'turn', state: 'failed' },
      ),
    )
    expect(said).toEqual(['turn failed'])
  })

  it('⛔ a rejected credential is said in OUR words, and the provider’s repeat of it is not', () => {
    // 098/110's split, and the pair `auth-state.ts` documents: the refusal arrives typed, is drawn
    // as the sentence a person can act on, and then the turn's terminal message carries the
    // provider's own words verbatim. Only the RAW half of the memory catches that one.
    const provider =
      'Your access token could not be refreshed because your refresh token was already used. ' +
      'Please log out and sign in again.'
    const said = notices(
      feed(
        createTranscript(),
        { type: 'user_turn', text: 'go' },
        { type: 'error', message: provider, fatal: false, cause: 'auth' },
        { type: 'error', message: `turn failed: ${provider}`, fatal: false },
        { type: 'turn', state: 'failed' },
      ),
    )
    expect(said).toHaveLength(2)
    expect(said[0]).toContain('sign-in was rejected')
    expect(said[0]).not.toContain('refresh token')
    expect(said[1]).toBe('turn failed')
  })

  it('⛔ two envelopes, one sentence — the app does not repeat itself over a reworded report', () => {
    // The other half of the memory. The provider's two accounts of one failure need not be
    // byte-identical: the `error` notification and the turn's own `turn.error.message` are built by
    // different parts of the app-server. What a person must not read twice is the SENTENCE.
    const said = notices(
      feed(
        createTranscript(),
        { type: 'user_turn', text: 'go' },
        {
          type: 'error',
          message: '{"status":400,"error":{"message":"the model is gone"}}',
          fatal: false,
        },
        {
          type: 'error',
          message: 'turn failed: {"error":{"message":"the model is gone"}}',
          fatal: false,
        },
        { type: 'turn', state: 'failed' },
      ),
    )
    expect(said).toEqual(['the model is gone', 'turn failed'])
  })

  it('⛔ what one turn said cannot silence the NEXT turn’s ending', () => {
    // The memory is scoped to a turn. Without the clear, a conversation that hit the same failure
    // twice would explain it once and then simply stop saying why.
    const state = createTranscript()
    feed(
      state,
      { type: 'user_turn', text: 'first' },
      { type: 'error', message: ENVELOPE, fatal: false },
      { type: 'error', message: `turn failed: ${ENVELOPE}`, fatal: false },
      { type: 'turn', state: 'failed' },
      { type: 'user_turn', text: 'second' },
      { type: 'error', message: `turn failed: ${ENVELOPE}`, fatal: false },
      { type: 'turn', state: 'failed' },
    )
    expect(notices(state)).toEqual([SENTENCE, 'turn failed', SENTENCE, 'turn failed'])
  })

  it('⛔ …including across a turn boundary with NO `turn` event — a ledger that ends mid-turn', () => {
    // ⚠️ **Both clears are load-bearing, and this is the one the `turn` event cannot cover.** A
    // conversation quit while a turn ran has no terminal for it — `appendTx` closes it as `unknown`
    // when the next `user_turn` arrives — so the replayed transcript goes prompt → prompt. Without
    // the clear on `user_turn`, the FIRST turn's cause silences the second turn's ending.
    const state = createTranscript()
    feed(
      state,
      { type: 'user_turn', text: 'first' },
      { type: 'error', message: ENVELOPE, fatal: false },
      { type: 'user_turn', text: 'second' },
      { type: 'error', message: `turn failed: ${ENVELOPE}`, fatal: false },
      { type: 'turn', state: 'failed' },
    )
    expect(notices(state)).toEqual([SENTENCE, SENTENCE, 'turn failed'])
  })

  it('⚠️ the OTHER adapter, audited — Claude leaks no envelope, and says less than it holds', () => {
    // ⛔ **246 §1: *"check whether the other adapter does the same thing on the same class of
    // failure, and say so either way."*** The answer is no, and worse.
    //
    // Claude does NOT leak an envelope: `assistantErrorWords` (110) turns its error words (ten then,
    // thirteen since the 0.3.281 bump, 680) into
    // sentences, and `model_not_found` — the same class as 244's gesture — reads *"the model this
    // conversation asks for is not available"*. What it does instead is say a `.d.ts` symbol.
    //
    // ⚑ **`claudeResultOutcome` reads `result`, and the ERROR variant does not declare one.**
    // `SDKResultSuccess` has `result: string`; `SDKResultError` has `errors: string[]` — so the
    // `||` always falls through and a failed Claude turn's whole account of WHY is
    // `turn failed: error_during_execution`. The provider's own reasons sit in `errors`, which
    // nothing in the adapter reads.
    //
    // ⛔ **Named, not fixed**: `claude/normalize.ts` is in `packages/runtime`, which 246 §4 puts out
    // of bounds (it is 243's tree), and translating a closed union belongs where the union is known
    // — 110's `Record`, with its compile-time exhaustiveness — not behind a string match here.
    // Pinned so the report above stays a fact rather than a memory.
    const sdk = readFileSync(
      new URL(
        'sdk.d.ts',
        pathToFileURL(createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk')),
      ),
      'utf8',
    )
    const start = sdk.indexOf('export declare type SDKResultError = {')
    expect(start, 'the SDK no longer declares SDKResultError').toBeGreaterThan(-1)
    const errorVariant = sdk.slice(start, sdk.indexOf('};', start))
    expect(errorVariant).toContain('errors: string[]')
    expect(
      errorVariant,
      'the error result now HAS a `result` — the finding has fixed itself',
    ).not.toMatch(/^\s+result\??:/m)
    expect(
      readFileSync(
        new URL('../../../packages/runtime/src/claude/normalize.ts', import.meta.url),
        'utf8',
      ),
      'the adapter no longer reaches for a field only the success variant has',
    ).toContain("readString(message, 'result') || message.subtype")
  })

  it('⚠️ a fatal terminal message still terminalizes the session', () => {
    // The early return added for the ending must not skip `markTerminal` — a fatal error that
    // happened to be phrased as the turn's ending would otherwise leave the composer open on a
    // session that is over.
    const state = feed(
      createTranscript(),
      { type: 'user_turn', text: 'go' },
      { type: 'error', message: 'turn failed: the provider process died', fatal: true },
    )
    expect(state.ended).toBe(true)
    expect(notices(state)).toEqual(['the provider process died'])
  })
})

/**
 * 🔴 **680 · a refusal the adapter RECOGNISED is said from its values, never from its advice** (PM
 * ruling R28c).
 *
 * ⚑ `NOTICE` is the provider's sentence exactly as the SDK handed it over on 2026-09-24
 * (`packages/runtime/test/fixtures/claude-model-floor-refusal.json`). Its advice — `claude update`,
 * the desktop app — changes the person's own Claude Code and never the one this app spawns; what
 * works is the conversation's own model, and 680 §1 measured that it does.
 */
describe('680 · the version floor, said so a person can act on it (R28c)', () => {
  const NOTICE =
    "API Error: 400 Claude Code 2.1.218 does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again."
  const REFUSAL = {
    is: 'model-needs-a-newer-cli',
    model: 'claude-opus-5-5[1m]',
    needs: '2.1.280',
    runs: '2.1.218',
  } as const

  it('🔴 one line: the model, the floor, the version this app runs — and what to do HERE', () => {
    const state = feed(
      createTranscript(),
      { type: 'user_turn', text: 'hello' },
      { type: 'error', message: NOTICE, fatal: false, refusal: REFUSAL },
    )
    expect(notices(state)).toEqual([
      'claude-opus-5-5[1m] needs Claude Code 2.1.280 or newer, and this app runs Claude Code ' +
        '2.1.218. Update Claude Code, or choose another model for this conversation.',
    ])
    // The provider's own advice is not quoted: it names a command and another app.
    expect(notices(state).join('\n')).not.toContain('claude update')
    expect(notices(state).join('\n')).not.toContain('desktop app')
    // ⚑ Our words, so they are not marked as the provider's.
    const drawn = state.items.find((item) => item.kind === 'notice') as NoticeItem
    expect(drawn.providersWords).toBeUndefined()
    expect(drawn.level).toBe('warn')
  })

  it('⛔ the control — the same error WITHOUT values shows the provider’s sentence (R28b)', () => {
    expect(
      notices(feed(createTranscript(), { type: 'error', message: NOTICE, fatal: false })),
    ).toEqual([NOTICE])
  })

  it('⚑ rendered from the values, so other values say other things', () => {
    expect(refusalSentence({ ...REFUSAL, model: 'm-9', needs: '3.0.0', runs: '2.9.1' })).toBe(
      'm-9 needs Claude Code 3.0.0 or newer, and this app runs Claude Code 2.9.1. Update Claude ' +
        'Code, or choose another model for this conversation.',
    )
  })

  it('⚑ the provider’s restatement of the same sentence is not drawn a second time', () => {
    const said = notices(
      feed(
        createTranscript(),
        { type: 'error', message: NOTICE, fatal: false, refusal: REFUSAL },
        { type: 'error', message: `turn failed: ${NOTICE}`, fatal: false },
      ),
    )
    expect(said).toHaveLength(1)
  })

  it('⚑ the cut reply is said as what is true, and the environment variable is not handed over', () => {
    const cut =
      "API Error: Claude's response exceeded the 32000 output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable."
    const said = notices(
      feed(createTranscript(), {
        type: 'error',
        message: cut,
        fatal: false,
        refusal: { is: 'reply-cut-at-its-output-limit', limit: '32000' },
      }),
    )
    expect(said).toEqual(['The reply was cut off at its output limit of 32000 tokens.'])
    expect(said.join('\n')).not.toContain('CLAUDE_CODE_MAX_OUTPUT_TOKENS')
  })

  it('⛔ a replayed row is read as a member — an unknown kind and a null both fall back to the provider’s sentence', () => {
    // A ledger or `.brobot` bundle from a later build, or a hand-edited row: `boundStoredEvent` does
    // not bound this field, so the fold must not trust it (680's review).
    for (const refusal of [{ is: 'a-kind-from-a-later-build', x: '1' }, null, 'nonsense']) {
      const event = {
        type: 'error',
        message: NOTICE,
        fatal: false,
        refusal,
      } as unknown as TranscriptEvent
      expect(notices(feed(createTranscript(), event)), JSON.stringify(refusal)).toEqual([NOTICE])
    }
  })
})
