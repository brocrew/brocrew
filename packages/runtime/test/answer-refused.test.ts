import { describe, expect, it } from 'vitest'
import { AnswerRefused, answerRefusalOf, FakeRuntime } from '../src'

/**
 * Refusing an answer is a REASON, not a sentence (085).
 *
 * A three-question card can yield `user-input request number:0 is not pending (already
 * answered, settled, or unknown)`. `number:0` is an internal typed request key keeping
 * `string:7` distinct from numeric `7`; that distinction remains in the diagnostic but needs
 * a person-facing sentence on the card and banner.
 *
 * The message was never the mistake. Carrying the reason ONLY as a message was: the app had nothing
 * to switch on, so its choices were to show the diagnostic or to match its prose — and matching the
 * prose makes every adapter's diagnostic into load-bearing UI copy that nobody may reword.
 */
describe('a refused answer carries why (085)', () => {
  it('the diagnostic survives, and so does the reason — both, not one', async () => {
    const handle = await new FakeRuntime('codex').start({ cwd: '/tmp/x', providerHome: '/tmp/h' })

    const error = await handle.respondUserInput('number:0', { kind: 'reject' }).then(
      () => null,
      (caught: unknown) => caught,
    )

    expect(error, 'positive: it really did refuse').toBeInstanceOf(AnswerRefused)
    expect(answerRefusalOf(error)).toBe('not-pending')
    // ⚠️ The adapter's own words are UNCHANGED. This is the log's copy and the only place the id and
    // the phase exist; a fix that improved this string would have thrown the diagnostic away.
    expect((error as Error).message).toBe(
      'user-input request number:0 is not pending (already answered, settled, or unknown)',
    )
    await handle.close()
  })

  it('the DOUBLE refuses an unusable answer the way both adapters do, and keeps the card live (142)', async () => {
    // ⛔ **A double that accepts what the real adapters refuse is a hole under every desktop test.**
    // The whole UI suite drives `FakeRuntime`, so if an unusable answer resolved here, a card that
    // started sending one would stay green in the only tests that can see a card. Same rule, same
    // `answerToForward`, same reason value — and `not-usable` is NOT `not-pending`: the request is
    // still there, which is the difference the app renders.
    const handle = await new FakeRuntime('claude').start({ cwd: '/tmp/x', providerHome: '/tmp/h' })
    const { id, answered } = handle.simulateUserInput('pick one', ['a', 'b'])

    const error = await handle
      .respondUserInput(id, { kind: 'answer', answers: { q0: '   ' } })
      .then(
        () => null,
        (caught: unknown) => caught,
      )
    expect(error, 'positive: it really did refuse').toBeInstanceOf(AnswerRefused)
    expect(answerRefusalOf(error)).toBe('not-usable')

    // …and the card is STILL answerable, which is what makes it a refusal rather than a settlement.
    await handle.respondUserInput(id, { kind: 'answer', answers: { q0: 'a' } })
    expect(await answered).toEqual({ kind: 'answer', answers: { q0: 'a' } })
    await handle.close()
  })

  it('anything else is not a refusal, so the app cannot mistake a real fault for a stale card', () => {
    // The narrowing has to fail closed in the direction that matters: an unclassified error must
    // NOT be handed a reassuring sentence, because that is a genuine fault wearing a friendly face.
    expect(answerRefusalOf(new Error('user-input request number:0 is not pending'))).toBeNull()
    expect(answerRefusalOf(undefined)).toBeNull()
    expect(answerRefusalOf('not pending')).toBeNull()
    expect(answerRefusalOf(new AnswerRefused('not-offered', 'x'))).toBe('not-offered')
  })
})
