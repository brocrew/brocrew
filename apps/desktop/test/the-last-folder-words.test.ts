import { describe, expect, it } from 'vitest'
import { refuseResource } from '../src/main/resources/resources'
import { composeProfileBundle, type ProfileBundleContext } from '../src/main/runtime/factory-text'

/**
 * 🔴 **731 · HO-097's remedy keeps its act and loses its folder** (the PM, ruling on `726` §9).
 *
 * > *"HO-097's 'Keep it in the project folder' remedy becomes a habit, in §2a's words: files the
 * > agent creates go in its working folder unless it is asked to put them elsewhere. It is never a
 * > condition for anything to work."*
 *
 * ⛔ Until `731` the refusal for a type the store does not hold read *"Keep it in the
 * project folder and name its path in your summary instead."* — one of the two refusals left that
 * made a folder part of an act (the other, `summary-too-long`, is `the-act-inside-the-cut.test.ts`'s,
 * which censuses every vocabulary for it), after `726` §2a turned the factory text's own rule into
 * a habit.
 * ⚑ So the habit here is the factory text's sentence, read off the text an agent is actually given,
 * and the two cannot drift apart without this going red.
 */

/**
 * The habit is in the profile's file, which nothing about the conversation changes; the
 * conversation's own text (`thisConversationSpans`) names no habit.
 */
function context(): ProfileBundleContext {
  return { configured: null }
}

describe('731 · the last folder words', () => {
  it('🔴 the refusal names no folder as a condition — the act, then the factory text’s own habit', () => {
    const reason = refuseResource('resource-not-a-form-this-app-keeps').reason
    // ⛔ On `main`: *"…Keep it in the project folder and name its path in your summary instead."*
    expect(reason).not.toMatch(/project folder/i)

    // The refusal ends with the core's folder clause, said as a sentence of its own.
    const factory = composeProfileBundle(context())
    const habit = 'Use the assigned folder.'
    expect(factory, 'the factory text teaches no habit to compare with').toContain(
      `${habit.slice(0, -1)};`,
    )
    expect(reason).toContain(habit)

    // ⚑ The act comes first, so it stays inside the cut a person's row is drawn at (`675`).
    // ⛔ Presence before order: an absent anchor would sit "before" everything.
    // ⚑ D-016 · door-neutral: a reply, a give's inputs and `update_work` all say it, so the path is
    // named in *what you write*, not in a reply's summary.
    const act = 'Keep it where it is and name its full path in what you write.'
    expect(reason).toContain(act)
    expect(reason.indexOf(act)).toBeLessThan(reason.indexOf(habit))
  })

  it('⚑ THE CONTROL — a file that could be held is still told to write another, with no habit', () => {
    // The two acts differ on purpose (`635` M12): *write another file* is for a carrier that failed.
    for (const rail of ['resource-too-large', 'resource-empty', 'resource-not-text'] as const) {
      const reason = refuseResource(rail).reason
      expect(reason, rail).toContain('Write a file and offer that path instead')
      expect(reason, rail).not.toContain('Use the assigned folder')
    }
  })
})
