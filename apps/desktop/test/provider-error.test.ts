import type { TranscriptEvent } from '../src/shared/conversation-events'
import { describe, expect, it } from 'vitest'
import { eventForDisplay } from '../src/main/providers/claude/transcripts'

import {
  TURN_FAILED,
  providerErrorSentence,
  turnFailureDetail,
} from '../src/renderer/src/lib/provider-error'
import {
  applyEvent,
  createTranscript,
  type NoticeItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'

/** A real `error` notification's whole message, envelope included. */
const ENVELOPE =
  '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The ' +
  "'brobot-246-no-such-model' model is not supported when using Codex with a ChatGPT account.\"}}"

/** The sentence inside it. */
const SENTENCE =
  "The 'brobot-246-no-such-model' model is not supported when using Codex with a ChatGPT account."

/** The fallback-model warning: a different fact, never folded into the failure. */
const WARNING =
  'warning: Model metadata for `brobot-246-no-such-model` not found. Defaulting to fallback ' +
  'metadata; this can degrade performance and cause issues.'

function notices(state: TranscriptState): string[] {
  return state.items
    .filter((item): item is NoticeItem & { at?: number } => item.kind === 'notice')
    .map((item) => item.text)
}

function feed(state: TranscriptState, ...events: TranscriptEvent[]): TranscriptState {
  for (const event of events) applyEvent(state, eventForDisplay(event))
  return state
}

/** A failed turn's narrations, in the order the ledger recorded them. */
function theFourNarrations(): TranscriptEvent[] {
  return [
    { type: 'user_turn', text: 'Reply with exactly OK.' },
    { type: 'error', message: WARNING, fatal: false },
    { type: 'error', message: ENVELOPE, fatal: false },
    { type: 'error', message: `turn failed: ${ENVELOPE}`, fatal: false },
    { type: 'turn', state: 'failed' },
  ]
}

describe('the sentence inside a machine envelope', () => {
  it('takes the message out of the 400 a person cannot read', () => {
    expect(providerErrorSentence(ENVELOPE)).toBe(SENTENCE)
  })

  it('leaves text that is ALREADY a sentence exactly as it arrived', () => {
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

  it('hands back the envelope when it cannot be opened, rather than an empty line', () => {
    // Malformed, not an object, and an object whose only `message` is whitespace. A notice with no
    // text at all is worse than one a reader has to squint at.
    expect(providerErrorSentence('{"error": {')).toBe('{"error": {')
    expect(providerErrorSentence('["not", "an", "object"]')).toBe('["not", "an", "object"]')
    expect(providerErrorSentence('{"error":{"message":"   "}}')).toBe('{"error":{"message":"   "}}')
    expect(providerErrorSentence('{"status":400}')).toBe('{"status":400}')
  })

  it('prefers the DEEPEST message — the transport summary is not what happened', () => {
    expect(
      providerErrorSentence('{"message":"Request failed","error":{"message":"the model is gone"}}'),
    ).toBe('the model is gone')
  })

  it('opens an envelope nested inside an envelope, and stops', () => {
    const inner = JSON.stringify({ error: { message: 'the innermost sentence' } })
    expect(providerErrorSentence(JSON.stringify({ error: { message: inner } }))).toBe(
      'the innermost sentence',
    )
    let deep = '{"message":"floor"}'
    for (let level = 0; level < 200; level += 1) deep = `{"error":${deep}}`
    expect(typeof providerErrorSentence(deep)).toBe('string')
  })
})

describe('recognizing the turn’s own ending', () => {
  it('reads the reason out of a prefixed terminal message, and nothing else', () => {
    expect(turnFailureDetail(`turn failed: ${ENVELOPE}`)).toBe(ENVELOPE)
    expect(turnFailureDetail(TURN_FAILED)).toBe('')
    expect(turnFailureDetail('turn failed to start the sandbox')).toBeNull()
    expect(turnFailureDetail(ENVELOPE)).toBeNull()
    expect(turnFailureDetail('')).toBeNull()
  })
})

describe('what a person reads when a turn fails', () => {
  it('one cause, then one receipt — the envelope is never shown', () => {
    const said = notices(feed(createTranscript(), ...theFourNarrations()))

    expect(said.filter((line) => line.includes(ENVELOPE))).toEqual([])
    expect(said.filter((line) => line.includes(SENTENCE))).toHaveLength(1)
    expect(said).toEqual([WARNING, SENTENCE, 'turn failed'])
  })

  it('…and the fold is what does it, not the shape of this one payload', () => {
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

  it('a reason said NOWHERE else is still said — Claude’s subtype is the only account it has', () => {
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

  it('a DIFFERENT reason is not swallowed by a cause said earlier in the turn', () => {
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

  it('the bare `turn failed` says nothing the receipt does not, and is not said twice', () => {
    // `SessionMachine.completeTurn` emits exactly this when the provider named no reason at all.
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

  it('a rejected credential is said in OUR words, and the provider’s repeat of it is not', () => {
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

  it('two envelopes, one sentence — the app does not repeat itself over a reworded report', () => {
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

  it('what one turn said cannot silence the NEXT turn’s ending', () => {
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

  it('…including across a turn boundary with NO `turn` event — a ledger that ends mid-turn', () => {
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

  it('a fatal terminal message still terminalizes the session', () => {
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

describe('supplied error presentation', () => {
  it('renders fictional remedy words unchanged and keeps the raw diagnostic for repeats', () => {
    const state = feed(
      createTranscript(),
      {
        type: 'error',
        message: ENVELOPE,
        fatal: false,
        presentation: { message: 'Fable needs a different workspace. Open Fable settings.' },
      },
      { type: 'error', message: `turn failed: ${ENVELOPE}`, fatal: false },
    )
    expect(notices(state)).toEqual(['Fable needs a different workspace. Open Fable settings.'])
    expect(state.lastError?.raw).toBe(ENVELOPE)
    expect(state.ended).toBe(false)
  })

  it('keeps fatal ending semantics when the supplied words are opaque', () => {
    const state = feed(createTranscript(), {
      type: 'error',
      message: 'fictional provider diagnostic',
      fatal: true,
      presentation: { message: 'Choose a workspace in Fable.' },
    })
    expect(notices(state)).toEqual(['Choose a workspace in Fable.'])
    expect(state.ended).toBe(true)
  })

  it('uses generic diagnostic rendering when no display words were supplied', () => {
    for (const presentation of [undefined, { message: '' }]) {
      const state = feed(createTranscript(), {
        type: 'error',
        message: ENVELOPE,
        fatal: false,
        presentation,
      })
      expect(notices(state)).toEqual([SENTENCE])
    }
  })
})

/** A refusal the adapter recognised is said from its values, never from the provider's advice. */
describe('the version floor, said so a person can act on it', () => {
  const NOTICE =
    "API Error: 400 Claude Code 2.1.218 does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again."
  const REFUSAL = {
    is: 'model-needs-a-newer-cli',
    model: 'claude-opus-5-5[1m]',
    needs: '2.1.280',
    runs: '2.1.218',
  } as const

  it('one line: the model, the floor, the version this app runs — and what to do HERE', () => {
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
    const drawn = state.items.find((item) => item.kind === 'notice') as NoticeItem
    expect(drawn.providersWords).toBeUndefined()
    expect(drawn.level).toBe('warn')
  })

  it('the control — the same error WITHOUT values shows the provider’s sentence', () => {
    expect(
      notices(feed(createTranscript(), { type: 'error', message: NOTICE, fatal: false })),
    ).toEqual([NOTICE])
  })

  it('the provider’s restatement of the same sentence is not drawn a second time', () => {
    const said = notices(
      feed(
        createTranscript(),
        { type: 'error', message: NOTICE, fatal: false, refusal: REFUSAL },
        { type: 'error', message: `turn failed: ${NOTICE}`, fatal: false },
      ),
    )
    expect(said).toHaveLength(1)
  })

  it('the cut reply is said as what is true, and the environment variable is not handed over', () => {
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

  it('a replayed row is read as a member — an unknown kind and a null both fall back to the provider’s sentence', () => {
    // A ledger or `.brobot` bundle from a later build, or a hand-edited row: `boundStoredEvent` does
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
