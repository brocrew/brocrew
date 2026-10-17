import { describe, expect, it } from 'vitest'
import {
  answerToForward,
  duplicateAnswerKey,
  isOfferedLabel,
  storedQuestionsParsed,
  userInputResponseSchema,
  type UserInputQuestion,
} from '../src'

/**
 * **146 §2 · the keys are the provider's, and nothing checked what they were.**
 *
 * ⛔ **A question id and a Claude question text are unrestricted strings on both wires.** The pinned
 * Codex `0.146.0` `request_user_input_spec.rs` validates options but not id syntax, uniqueness or
 * reserved names, and its protocol type is a bare `String`; the pinned SDK declares
 * `question: string` and permits 1–4 questions with no uniqueness condition. Every draft and every
 * answer object in this app was an ordinary `{}` keyed by one of those strings, and 145 HIGH 2
 * measured what that costs:
 *
 *  - id `constructor` → `'constructor' in answers` is TRUE on any ordinary object, so an unanswered
 *    question counted as answered and the inherited FUNCTION reached `.trim()`.
 *  - id or question text `__proto__` → the assignment changes the object's prototype instead of
 *    creating a property, so the answer is silently gone and the gesture is recorded as `Answered`.
 *
 * ⚑ **The representation chosen, and it is TWO — one per boundary, each measured.**
 *
 *  - **Anything that crosses a wire is a null-prototype OBJECT**, read with `Object.hasOwn` and a
 *    type check: the IPC answer map, Claude's answers dictionary, Codex's response payload. It has
 *    to be an object because it crosses two boundaries this app does not own — Electron's
 *    `contextBridge` and `JSON.stringify` to the provider — and a `Map` survives neither. Removing
 *    the prototype removes both failures at once: nothing to inherit, and no `__proto__` setter to
 *    swallow a write.
 *  - **The card's draft is a `Map`**, because it never leaves the renderer and an object cannot be
 *    made to work there at all: `@vue/reactivity`'s `isNonTrackableKeys` is
 *    `__proto__,__v_isRef,__isVue`, so Vue refuses to track that key by NAME whatever the prototype
 *    is. See `apps/desktop/test/dom/provider-keys.dom.test.ts`, which is where that was measured.
 *
 * Measured on the pinned versions rather than reasoned about; the schema test below is this half of
 * that measurement.
 *
 * ⚠️ **It is NOT global `Object.prototype` pollution**, and nothing here claims otherwise: the
 * damage is a crash, a denial, or a lost answer inside one request.
 */

/** An own `__proto__` property, built the way the wire builds one. `JSON.parse` defines, never sets. */
const withProtoKey = <T>(json: string): T => JSON.parse(json) as T

const question = (over: Partial<UserInputQuestion> = {}): UserInputQuestion => ({
  id: 'q0',
  prompt: 'Which one?',
  options: [{ label: 'alpha' }, { label: 'beta' }],
  multiSelect: false,
  ...over,
})

describe('a provider-chosen key cannot crash, deny, or lose an answer (146 §2)', () => {
  it('an inherited name is not an answer — `constructor` fails CLOSED instead of throwing', () => {
    // ⛔ THE DEFECT: `'constructor' in {}` is true, so this question read as answered, and the value
    // handed back was `Object` — a function, which `.trim()` throws on.
    const q = question({ id: 'constructor' })
    const forward = answerToForward([q], {})

    expect(forward.forwardable).toBe(false)
    expect(forward.forwardable === false && forward.why).toContain('unanswered: constructor')
  })

  it('…and the same id CAN be answered, so failing closed is not a denial', () => {
    // The paired positive. A guard that refused `constructor` outright would trade a crash for a
    // question nobody can ever answer, which 145 lists as the same class of failure.
    const q = question({ id: 'constructor' })
    const forward = answerToForward([q], { constructor: 'alpha' })

    expect(forward.forwardable).toBe(true)
    expect(forward.forwardable === true && [...forward.values]).toEqual([
      ['constructor', ['alpha']],
    ])
  })

  it('`toString` and the rest of the prototype behave the same way', () => {
    // One rule, not a list of names — `Object.hasOwn` does not know what `toString` is.
    for (const id of ['toString', 'valueOf', 'hasOwnProperty', '__defineGetter__']) {
      expect(answerToForward([question({ id })], {}).forwardable, `${id} unanswered`).toBe(false)
      expect(answerToForward([question({ id })], { [id]: 'alpha' }).forwardable, `${id}`).toBe(true)
    }
  })

  it('a `__proto__` answer survives the IPC schema instead of vanishing into the prototype', () => {
    // ⛔ **This is the measurement, and it is why `z.record` was not enough.** Zod 4 refuses to
    // write `__proto__` into the plain object it builds — correct for a plain object, and it drops
    // the key. The schema now rebuilds on a null-prototype object, where there is no setter to
    // swallow the write and no guard needed.
    const parsed = userInputResponseSchema.parse(
      withProtoKey('{"kind":"answer","answers":{"__proto__":"alpha","constructor":"beta"}}'),
    )
    expect(parsed.kind).toBe('answer')
    const answers = parsed.kind === 'answer' ? parsed.answers : {}

    expect(Object.getOwnPropertyNames(answers).sort()).toEqual(['__proto__', 'constructor'])
    // The negative that makes it worth having: on an ordinary object this is `{}`.
    expect(JSON.stringify(answers)).toBe('{"__proto__":"alpha","constructor":"beta"}')
    // …and the shared rule reads both back.
    const forward = answerToForward(
      [question({ id: '__proto__' }), question({ id: 'constructor', prompt: 'And?' })],
      answers,
    )
    expect(forward.forwardable).toBe(true)
  })

  it('an answer that is not a string says nothing, rather than reaching `.trim()`', () => {
    // `answerToForward` is called with hand-built objects by the fake runtime and by tests, so the
    // type is not the guard. A number is as empty as `''`.
    const numeric = { q0: 42 } as unknown as Record<string, string | string[]>
    expect(answerToForward([question()], numeric).forwardable).toBe(false)
    expect(
      answerToForward([question({ multiSelect: true })], {
        q0: ['alpha', 7] as unknown as string[],
      }).forwardable,
    ).toBe(true)
  })
})

describe('two questions that cannot be told apart never become a card (146 §2/§3)', () => {
  it('names the key that repeats, and says nothing when none does', () => {
    const two = [question(), question({ id: 'q1', prompt: 'Which one?' })]
    // Claude keys its answers by the question TEXT, and these two share it.
    expect(duplicateAnswerKey(two, (q) => q.prompt)).toBe('Which one?')
    // Codex keys by id, and these two do not share one.
    expect(duplicateAnswerKey(two, (q) => q.id)).toBeNull()
    // The positive for the id half: `codexQuestions` falls back to a positional `q{i}`, so a
    // request carrying `id: "q1"` and a question with no id at all collides without either being
    // malformed on its face.
    expect(duplicateAnswerKey([question({ id: 'q1' }), question({ id: 'q1' })], (q) => q.id)).toBe(
      'q1',
    )
  })
})

describe('one membership rule, exactly (146 §4.2)', () => {
  /**
   * ⛔ **145 MEDIUM 2, in one fixture.** The card asked `option.label === value` and the adapter
   * asked `option.label.trim() === member.trim()`, so a label padded with NBSP — typed plainly into
   * the `Other` field — was shown as free-form and arrived at the provider as the listed label,
   * with Claude's freeform signal omitted. JavaScript's `trim` removes NBSP too, which is what made
   * this reachable with a character nobody can see.
   */
  const NBSP = ' '
  const padded = question({
    id: 'q0',
    options: [{ label: `${NBSP}staging${NBSP}` }, { label: 'production' }],
    allowOther: true,
  })

  it('a padded label typed plainly is FREE-FORM on both sides, not a silent substitution', () => {
    // The card's half — the same expression `UserInputCard.isLabel` evaluates.
    expect(isOfferedLabel(padded, 'staging')).toBe(false)
    // …and the adapter's, which used to disagree.
    const forward = answerToForward([padded], { q0: 'staging' })
    expect(forward.forwardable).toBe(true)
    expect(forward.forwardable === true && forward.typed.get('q0')).toEqual(['staging'])
    expect(forward.forwardable === true && forward.values.get('q0')).toEqual(['staging'])
  })

  it('…and the label itself still round-trips byte for byte', () => {
    // The paired positive: exact equality has to keep saying yes to the exact thing (086).
    expect(isOfferedLabel(padded, `${NBSP}staging${NBSP}`)).toBe(true)
    const forward = answerToForward([padded], { q0: `${NBSP}staging${NBSP}` })
    expect(forward.forwardable === true && forward.values.get('q0')).toEqual([
      `${NBSP}staging${NBSP}`,
    ])
    expect(forward.forwardable === true && forward.typed.size).toBe(0)
  })

  it('a question that takes no other still refuses one', () => {
    const strict = question({ options: [{ label: `${NBSP}staging${NBSP}` }] })
    const forward = answerToForward([strict], { q0: 'staging' })
    expect(forward.forwardable).toBe(false)
    expect(forward.forwardable === false && forward.why).toContain('not one of the offered options')
  })

  it('typed text keeps its own spaces — the contract this file states (146 §5.1)', () => {
    // `UserInputCard.answer()` used to trim every value it sent, so a path or a secret with
    // meaningful surrounding space was altered on the one entry path a person uses and not on the
    // one a program uses. Emptiness is still decided on the trimmed value: that is a test for "said
    // nothing", not a rewrite of what was said.
    const free = question({ options: [] })
    const forward = answerToForward([free], { q0: '  /exact/path  ' })
    expect(forward.forwardable === true && forward.values.get('q0')).toEqual(['  /exact/path  '])
    expect(answerToForward([free], { q0: '   ' }).forwardable).toBe(false)
  })
})

describe('replay parses instead of trusting the cast (146 §4.1)', () => {
  it('coerces the legacy string form — the five rows on disk', () => {
    expect(
      storedQuestionsParsed([{ id: 'q0', prompt: 'Which?', options: ['alpha', 'beta'] }]),
    ).toEqual([{ id: 'q0', prompt: 'Which?', options: [{ label: 'alpha' }, { label: 'beta' }] }])
  })

  it('and REFUSES the three shapes 143 quietly trusted', () => {
    // ⛔ 145 MEDIUM 1: the hand-written coercion looked for strings and cast everything else, so
    // each of these produced a different accident — a chip with a numeric label, a throw inside
    // `label.trim()`, and a throw inside the migration itself. One parse, one outcome.
    expect(() => storedQuestionsParsed([{ id: 'q0', prompt: 'a', options: ['A', 42] }])).toThrow()
    expect(() =>
      storedQuestionsParsed([{ id: 'q0', prompt: 'a', options: [{ label: 42 }] }]),
    ).toThrow()
    expect(() => storedQuestionsParsed({ nope: true })).toThrow()
    expect(() => storedQuestionsParsed([{ id: 'q0', prompt: 'a' }])).toThrow()
  })

  it('keeps every field a stored question already had', () => {
    // The parse must not be a quiet narrowing: a row written after 143 carries five more fields.
    const rich = {
      id: 'q0',
      prompt: 'Which?',
      header: 'Scope',
      options: [{ label: 'alpha', description: 'why alpha' }],
      allowOther: true,
      secret: true,
      multiSelect: true,
    }
    expect(storedQuestionsParsed([rich])).toEqual([rich])
  })
})
