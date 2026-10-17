import { afterEach, describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import type { UserInputResponse } from '../../src/shared/runtime-ipc'
import UserInputCard from '../../src/renderer/src/components/UserInputCard.vue'
import type { UserInputItem } from '../../src/renderer/src/lib/transcript'
import { createSessionRecord, requestDraft } from '../../src/renderer/src/lib/session-record'
import { mount, unmountAll, visible } from './harness'

/**
 * **146 §2 · the card's half — a question id the provider chose.**
 *
 * ⛔ **145 HIGH 2 put the worst of this here, before any adapter is involved.** The card's draft was
 * an ordinary `{}` keyed by `question.id`, and both pinned protocols accept any string as one:
 *
 *  - `constructor` → `draft.answers['constructor']` returned the inherited FUNCTION, and `chosen()`
 *    called `.trim()` on it. **The card crashed during render, before the user could answer.**
 *  - `__proto__` → `draft.answers['__proto__'] = label` changed the object's prototype instead of
 *    storing anything, so the chip never lit, Answer never enabled and the question could not be
 *    answered at all.
 *
 * ⛔ **The representation is a `Map`, and `Object.create(null)` was measured and REJECTED for this
 * layer.** A null-prototype draft stores `__proto__` correctly — and the card still does not
 * update, because `@vue/reactivity`'s `isNonTrackableKeys` is `__proto__,__v_isRef,__isVue`: Vue
 * refuses to track that key by NAME, whatever the object's prototype is. Measured on 3.5.40 with
 * this very card: the value lands in the draft and the chip stays unlit. A reactive `Map` tracks it
 * like any other key. **These tests are what caught that**, which is why the failing one had to
 * fail on the chip rather than on the draft.
 *
 * ⚑ The type check on every read stays for the other half — an inherited name in a draft this card
 * did not create (the read-only pane, and every test that mounts the card on its own).
 *
 * ⚠️ **The runtime half is `packages/runtime/test/provider-keys.test.ts`**, which asserts the same
 * keys through `answerToForward`, the IPC schema and both adapters' payloads.
 */

afterEach(unmountAll)

const request = (id: string): UserInputItem['request'] => ({
  type: 'user_input_request',
  id: 'toolu_1',
  prompt: 'AskUserQuestion',
  questions: [
    {
      id,
      prompt: 'Which one?',
      options: [{ label: 'alpha' }, { label: 'beta' }],
      multiSelect: false,
    },
  ],
})

const card = (id: string): { m: ReturnType<typeof mount>; sent: () => UserInputResponse[] } => {
  const seen: UserInputResponse[] = []
  const m = mount(
    UserInputCard,
    {
      item: {
        kind: 'userInput',
        id: 'ui_1',
        request: request(id),
        answered: null,
        note: null,
        refused: null,
        at: 1_000,
      } satisfies UserInputItem & { at: number },
      onRespond: (_id: string, response: UserInputResponse) => seen.push(response),
    },
    { width: 900 },
  )
  return { m, sent: () => seen }
}

describe('a question id from the prototype chain (146 §2)', () => {
  for (const id of ['constructor', '__proto__', 'toString', 'valueOf']) {
    it(`renders, lights and answers a question whose id is \`${id}\``, async () => {
      // ⛔ **The mount itself is the first assertion**: `constructor` used to throw in `chosen()`
      // during render, so there was no card to click.
      const { m, sent } = card(id)
      expect(visible(m.q('user-input-card'))).toBe(true)

      const chip = m.host.querySelector<HTMLButtonElement>(
        `[data-cy="user-input-choice-${CSS.escape(id)}"][data-option="alpha"]`,
      )
      expect(chip, `no chip for ${id}/alpha`).not.toBeNull()
      chip!.click()
      await Promise.resolve()

      // ⛔ `__proto__` stored nothing at all, so neither of these could ever become true.
      expect(chip!.classList.contains('selected')).toBe(true)
      const answer = m.q('user-input-answer') as HTMLButtonElement
      expect(answer.disabled).toBe(false)

      answer.click()
      expect(sent()).toHaveLength(1)
      const first = sent()[0]!
      const answers = first.kind === 'answer' ? first.answers : {}
      // ⛔ **Own properties, not `toEqual`.** A payload that had merely set its own prototype would
      // satisfy a structural match on some of these keys and serialise as `{}` on the wire.
      expect(Object.getOwnPropertyNames(answers)).toEqual([id])
      expect(JSON.parse(JSON.stringify(answers))).toEqual(JSON.parse(`{"${id}":"alpha"}`))
    })
  }

  it('an ordinary id is unaffected — the negative for all of the above', async () => {
    // Non-vacuity: everything here must be true of `q0` too, or the fix is a special case rather
    // than a representation.
    const { m, sent } = card('q0')
    const chip = m.host.querySelector<HTMLButtonElement>(
      '[data-cy="user-input-choice-q0"][data-option="beta"]',
    )
    chip!.click()
    await Promise.resolve()
    ;(m.q('user-input-answer') as HTMLButtonElement).click()
    const first = sent()[0]!
    const answers = first.kind === 'answer' ? first.answers : {}
    expect(Object.getOwnPropertyNames(answers)).toEqual(['q0'])
    expect(JSON.stringify(answers)).toBe('{"q0":"beta"}')
  })
})

/**
 * 🔴 **150 · the same hostility, one level OUT — the id of the REQUEST rather than of a question.**
 *
 * 146 hardened the inner keys and 148 confirmed that path clean; the outer id stayed a plain object
 * key, and Claude takes it straight from the SDK's `toolUseID`. `requestDraft(record, '__proto__')`
 * returned `Object.prototype`, and `constructor`/`toString`/`hasOwnProperty` returned the inherited
 * FUNCTION — all truthy, so all handed to this card as a draft. `chosen()` reads `draft.answers`,
 * which none of them has, and **the card threw during render**.
 *
 * ⚠️ **The draft here comes from a real {@link SessionRecord}, not a literal.** A hand-built draft
 * would prove nothing: the defect was in what `requestDraft` HANDS BACK, so the test has to ask it.
 */
describe('a REQUEST id from the prototype chain, around the card (150, from 148 H3)', () => {
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    it(`renders and answers a card whose REQUEST id is \`${id}\``, async () => {
      // ⚠️ `reactive`, because the store wraps every record in it — an unwrapped record hands the
      // card a RAW draft, whose mutations Vue never hears about, and the chip would not light for
      // an ordinary id either. The point of this test is the id, so everything else must match the
      // app.
      const record = reactive(createSessionRecord('sess_1'))
      const draft = requestDraft(record, id)

      const seen: UserInputResponse[] = []
      const m = mount(
        UserInputCard,
        {
          item: {
            kind: 'userInput',
            id: 'ui_1',
            request: { ...request('q0'), id },
            answered: null,
            note: null,
            refused: null,
            at: 1_000,
          } satisfies UserInputItem & { at: number },
          draft,
          onRespond: (_id: string, response: UserInputResponse) => seen.push(response),
        },
        { width: 900 },
      )
      // ⛔ The mount is the assertion: this is where it threw.
      expect(visible(m.q('user-input-card'))).toBe(true)

      const chip = m.host.querySelector<HTMLButtonElement>(
        '[data-cy="user-input-choice-q0"][data-option="alpha"]',
      )
      expect(chip, `no chip under request id ${id}`).not.toBeNull()
      chip!.click()
      await Promise.resolve()
      expect(chip!.classList.contains('selected')).toBe(true)

      const answer = m.q('user-input-answer') as HTMLButtonElement
      expect(answer.disabled).toBe(false)
      answer.click()
      expect(seen).toHaveLength(1)
      // …and the draft that was written is the one the record holds under that id, not a stray.
      expect(record.requests.get(id)?.answers.get('q0')).toBe('alpha')
      // ⛔ Nothing reached the prototype: `sent` is the field PermissionCard's click writes.
      expect(Object.hasOwn(Object.prototype, 'sent')).toBe(false)
      expect(Object.hasOwn(Object.prototype, 'answers')).toBe(false)
    })
  }
})
