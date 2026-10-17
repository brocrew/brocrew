import { afterEach, describe, expect, it } from 'vitest'
import type { UserInputResponse } from '../../src/shared/runtime-ipc'
import UserInputCard from '../../src/renderer/src/components/UserInputCard.vue'
import type { UserInputItem } from '../../src/renderer/src/lib/transcript'
import { contrast, mount, paintedInk, parseColor, show, unmountAll, visible } from './harness'

/**
 * **139 · a question that only takes one answer, and one that does not.**
 *
 * A provider input assembled from `input_json_delta` frames can contain two questions with
 * `multiSelect: true` and `multiSelect: false`. The neutral question must preserve that field
 * so the cards do not render both as single choice.
 *
 * ⚠️ **In the DOM project rather than beside the SSR card tests, because every claim here is about a
 * CLICK.** `renderToString` can see that a chip exists; it cannot press one, press a second, and ask
 * whether the first is still lit — which is the entire difference between the two modes. The SSR
 * file (`ui-honesty.render.test.ts`) keeps asserting what the markup says; this one asserts what the
 * control does.
 */

afterEach(unmountAll)

// 143: options arrive as strings or as the `{label, description}` both providers send. Taking both
// here is what lets every question written before this dispatch stand unchanged while a new one can
// carry the description the card now has room for.
const request = (
  questions: {
    id: string
    prompt: string
    options: (string | { label: string; description?: string })[]
    multiSelect?: boolean
    header?: string
    allowOther?: boolean
    secret?: boolean
  }[],
): UserInputItem['request'] => ({
  type: 'user_input_request',
  id: 'toolu_1',
  prompt: 'AskUserQuestion',
  questions: questions.map((question) => ({
    ...question,
    options: question.options.map((option) =>
      typeof option === 'string' ? { label: option } : option,
    ),
  })),
})

const MULTI = {
  id: 'q0',
  prompt: 'Which capability groups should the showcase cover?',
  options: ['Core rendering', 'Interactive UI', 'Agents & skills'],
  multiSelect: true,
}
const SINGLE = {
  id: 'q1',
  prompt: 'Where should demo files be written?',
  options: ['A ui-demo/ subfolder', 'Workspace root'],
  multiSelect: false,
}

/** The card, plus every response it emitted — the only thing a card can actually do. */
function card(
  questions: {
    id: string
    prompt: string
    options: (string | { label: string; description?: string })[]
    multiSelect?: boolean
    header?: string
    allowOther?: boolean
    secret?: boolean
  }[],
): {
  m: ReturnType<typeof mount>
  sent: () => UserInputResponse[]
  chip: (question: string, option: string) => HTMLButtonElement
} {
  const seen: UserInputResponse[] = []
  const item: UserInputItem & { at: number } = {
    kind: 'userInput',
    id: 'ui_1',
    request: request(questions),
    answered: null,
    note: null,
    refused: null,
    at: 1_000,
  }
  const m = mount(
    UserInputCard,
    { item, onRespond: (_id: string, response: UserInputResponse) => seen.push(response) },
    { width: 900 },
  )
  const chip = (question: string, option: string): HTMLButtonElement => {
    const el = m.host.querySelector<HTMLButtonElement>(
      `[data-cy="user-input-choice-${question}"][data-option="${option}"]`,
    )
    expect(el, `no chip for ${question}/${option}`).not.toBeNull()
    return el!
  }
  return { m, sent: () => seen, chip }
}

const answers = (response: UserInputResponse): Record<string, string | string[]> =>
  response.kind === 'answer' ? response.answers : {}

describe('a multiple-choice question renders as multiple choice (139)', () => {
  it('a second pick ADDS, and the answer leaves as a list', async () => {
    const { m, sent, chip } = card([MULTI])

    // ⛔ **Clicked LAST-then-FIRST, and 141 is why** (142 §4.1). This clicked option 1 then option 3
    // and claimed to prove *"the question's order, not the click order"* — but click order already
    // equalled question order, so a click-order implementation passed it, and the comment beside it
    // said "clicked second-then-third", which is not what it did either. Reversing the clicks is the
    // whole fix: `['Core rendering', 'Agents & skills']` is now reachable ONLY from the question.
    chip('q0', 'Agents & skills').click()
    chip('q0', 'Core rendering').click()
    await Promise.resolve()

    // ⛔ THE DEFECT: pre-139 the second click replaced the first and exactly one chip was ever lit.
    expect(chip('q0', 'Core rendering').classList.contains('selected')).toBe(true)
    expect(chip('q0', 'Agents & skills').classList.contains('selected')).toBe(true)
    // …and the one nobody touched is not, so "selected" still means something.
    expect(chip('q0', 'Interactive UI').classList.contains('selected')).toBe(false)

    m.q('user-input-answer').click()
    expect(sent()).toHaveLength(1)
    expect(answers(sent()[0]!)).toEqual({ q0: ['Core rendering', 'Agents & skills'] })
  })

  it('picking the same option twice takes it back off, and does not answer twice', async () => {
    const { m, sent, chip } = card([MULTI])

    chip('q0', 'Interactive UI').click()
    chip('q0', 'Core rendering').click()
    chip('q0', 'Interactive UI').click()
    await Promise.resolve()

    expect(chip('q0', 'Interactive UI').classList.contains('selected')).toBe(false)
    m.q('user-input-answer').click()
    expect(answers(sent()[0]!)).toEqual({ q0: ['Core rendering'] })
  })

  it('says it is multi-select BEFORE anything is clicked, and the tick only appears when it is', async () => {
    const { m, chip } = card([MULTI])

    // State the selection mode in words before interaction. A row of chips alone cannot tell
    // the person that several choices are allowed.
    const mode = m.q('user-input-mode-q0')
    expect(mode.textContent?.trim()).toBe('pick as many as you like')
    // ⛔ **…and it is actually SHOWN** (142 §4.3). `textContent` is true of a `visibility: hidden`
    // node, so the line above passes over a label nobody can see — the sensor limit 126 named and
    // 141 found this test leaning on.
    expect(visible(mode), 'the mode label is painted, not merely present').toBe(true)
    expect(m.host.querySelectorAll('.choice .tick')).toHaveLength(0)

    chip('q0', 'Core rendering').click()
    await Promise.resolve()
    const tick = m.host.querySelector<SVGElement>('.choice .tick')
    expect(tick, 'a chosen multi-select chip wears a tick').not.toBeNull()
    // 089's rule: a glyph that references a symbol the sprite does not have paints NOTHING and looks
    // like a styling bug. The size proves it is laid out; the `use` proves what it points at.
    expect(tick!.querySelector('use')?.getAttribute('href')).toBe('#i-check')
    expect(tick!.getBoundingClientRect().width).toBeGreaterThan(0)
    expect(visible(tick!), 'and the tick is painted too').toBe(true)
  })

  it('the visibility sensor can actually return false — the paired negative (142 §4.3)', async () => {
    // ⚠️ **A sensor nobody has watched fail is not coverage.** Every assertion above would stay green
    // against a hidden element if `visible` were wired wrong, so here is the one place the failure
    // mode is produced on purpose: the same label, the same query, `visibility: hidden` — which is
    // invisible to `textContent`, to `getBoundingClientRect`, and to `paintedInk` by its own
    // docstring, and which this sees.
    const { m } = card([MULTI])
    const mode = m.q('user-input-mode-q0')
    expect(visible(mode)).toBe(true)
    expect(mode.textContent?.trim()).toBe('pick as many as you like')

    mode.style.visibility = 'hidden'
    expect(visible(mode), 'hidden means hidden').toBe(false)
    // …and the sensors that could not see it still say everything is fine.
    expect(mode.textContent?.trim()).toBe('pick as many as you like')
    expect(mode.getBoundingClientRect().width).toBeGreaterThan(0)

    mode.style.visibility = ''
    expect(visible(mode)).toBe(true)
  })
})

describe('the single-select question beside it is untouched (139, the paired positive)', () => {
  it('a second pick REPLACES, and the answer leaves as the plain string it always was', async () => {
    const { m, sent, chip } = card([SINGLE])

    chip('q1', 'A ui-demo/ subfolder').click()
    chip('q1', 'Workspace root').click()
    await Promise.resolve()

    expect(chip('q1', 'A ui-demo/ subfolder').classList.contains('selected')).toBe(false)
    expect(chip('q1', 'Workspace root').classList.contains('selected')).toBe(true)

    m.q('user-input-answer').click()
    // A STRING, not a one-element list: no existing caller had to move, and none may be made to.
    expect(answers(sent()[0]!)).toEqual({ q1: 'Workspace root' })
  })

  it('wears no mode label and no tick — the two modes are told apart on screen', async () => {
    const { m, chip } = card([SINGLE])
    chip('q1', 'Workspace root').click()
    await Promise.resolve()

    expect(m.all('user-input-mode-q1')).toHaveLength(0)
    expect(m.host.querySelectorAll('.choice .tick')).toHaveLength(0)
    expect(m.all('user-input-empty-q1')).toHaveLength(0)
  })

  it('a question with no options is still a text field, and still answers with a string', async () => {
    // The third shape on this card, and the one a `string | string[]` draft could most easily have
    // broken: `v-model` had to become `:value`/`@input` to narrow the union, and a field that stopped
    // writing into the draft would leave Answer dead with no way to see why.
    const { m, sent } = card([{ id: 'q2', prompt: 'Anything else?', options: [] }])
    const field = m.q('user-input-answer-q2') as HTMLInputElement

    field.value = 'a typed answer'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()

    expect((m.q('user-input-answer') as HTMLButtonElement).disabled).toBe(false)
    m.q('user-input-answer').click()
    expect(answers(sent()[0]!)).toEqual({ q2: 'a typed answer' })
  })
})

describe('choosing nothing (139 §7)', () => {
  it('Answer stays off, the card says why, and the reason is legible', async () => {
    const { m, chip } = card([MULTI, SINGLE])

    const button = m.q('user-input-answer') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    // ⛔ 086: an honest refusal beats a disabled button with no reason. "None of them" is a thing a
    // person can genuinely mean of a checkbox list, and it is the one answer this card cannot send.
    const why = m.q('user-input-empty-q0')
    expect(why.textContent).toContain('Answer stays off until you pick at least one')
    // Shown, before anything is asked about its contrast: `paintedInk` reads colour and opacity and
    // says in its own docstring that it does not model visibility (142 §4.3).
    expect(visible(why), 'the reason is on screen at all').toBe(true)

    // Readable, measured through the sensor that can see a fade (126) rather than off the
    // stylesheet: a reason nobody can read is the disabled button with no reason.
    const colour = parseColor(getComputedStyle(why).color)
    expect(colour, 'the engine resolved a colour for this text').not.toBeNull()
    const painted = paintedInk(why, colour!)
    expect(painted.bg[3], 'the card composites to an opaque surface').toBe(1)
    expect(
      contrast(painted.fg, painted.bg),
      `the empty-answer reason reads at ${show(painted.fg)} on ${show(painted.bg)}`,
    ).toBeGreaterThan(3)

    // The single-select question beside it gets no such line — its unlit chips already say it.
    expect(m.all('user-input-empty-q1')).toHaveLength(0)

    chip('q0', 'Agents & skills').click()
    chip('q1', 'Workspace root').click()
    await Promise.resolve()
    // Non-vacuity for the disabled assertion: the button really does come alive, and the reason goes
    // away when it stops being true.
    expect((m.q('user-input-answer') as HTMLButtonElement).disabled).toBe(false)
    expect(m.all('user-input-empty-q0')).toHaveLength(0)
  })

  it('taking the last pick back puts the card straight back into that state', async () => {
    const { m, chip } = card([MULTI])
    chip('q0', 'Core rendering').click()
    await Promise.resolve()
    expect((m.q('user-input-answer') as HTMLButtonElement).disabled).toBe(false)

    chip('q0', 'Core rendering').click()
    await Promise.resolve()
    expect((m.q('user-input-answer') as HTMLButtonElement).disabled).toBe(true)
    expect(m.q('user-input-empty-q0').textContent).toContain('Nothing chosen yet')
  })
})

/**
 * **143 · an answer the provider expects you to be able to give.**
 *
 * 141 proved the same defect on both providers: Codex's normalizer forces `is_other = true` on every
 * ordinary question and its options are *"2–3 mutually exclusive choices"*; Claude's pinned typings
 * tell the model *"There should be no 'Other' option, that will be provided automatically"*. This
 * card rendered a free-text field only when `options.length === 0` — which both normalizers forbid —
 * so the escape both providers guarantee was unreachable, and the `header` and `description` they
 * both send were dropped before the card ever saw them.
 */
describe('the answer that is not on the list, and the words around it (143)', () => {
  const DESCRIBED = {
    id: 'q0',
    prompt: 'Which capability groups should the showcase cover?',
    header: 'Scope',
    options: [
      { label: 'Core rendering', description: 'markdown, diffs, tool output and images' },
      { label: 'Interactive UI', description: 'checklists, pickers and permission prompts' },
      { label: 'Agents & skills' },
    ],
    allowOther: true,
    multiSelect: false,
  }

  it('offers a free-text answer BESIDE the options, and sends what was typed', async () => {
    const { m, sent } = card([DESCRIBED])

    // ⛔ The control that could not exist before 143: options AND a field, on one question.
    expect(m.all('user-input-choice-q0')).toHaveLength(3)
    const other = m.q('user-input-other-q0') as HTMLInputElement
    expect(visible(other), 'the Other field is on screen').toBe(true)

    other.value = 'none of these — the exporter'
    other.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()

    m.q('user-input-answer').click()
    expect(answers(sent()[0]!)).toEqual({ q0: 'none of these — the exporter' })
  })

  it('a question that takes NO other offers no field — the paired negative', async () => {
    // Without this, the test above passes on a card that draws the field unconditionally, which
    // would offer a control the adapter refuses to forward (106: no control that cannot act).
    const { m } = card([{ ...DESCRIBED, allowOther: false }])
    expect(m.all('user-input-choice-q0')).toHaveLength(3)
    expect(m.all('user-input-other-q0'), 'no escape where the provider offered none').toHaveLength(
      0,
    )
  })

  it('choosing a listed option still sends the label unchanged', async () => {
    // ⚑ The paired positive acceptance 2 asks for: adding the escape must not change what a
    // perfectly ordinary click sends.
    const { m, sent, chip } = card([DESCRIBED])
    chip('q0', 'Interactive UI').click()
    await Promise.resolve()
    m.q('user-input-answer').click()
    expect(answers(sent()[0]!)).toEqual({ q0: 'Interactive UI' })
  })

  it('typing replaces a pick, and picking clears what was typed', async () => {
    // One answer, one slot — the card holds no second map for the typed text, so the two can never
    // disagree about which of them the user meant.
    const { m, sent, chip } = card([DESCRIBED])
    chip('q0', 'Core rendering').click()
    await Promise.resolve()
    const other = m.q('user-input-other-q0') as HTMLInputElement
    expect(other.value, 'a chosen label is not echoed into the Other field').toBe('')

    other.value = 'something else'
    other.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
    expect(chip('q0', 'Core rendering').classList.contains('selected')).toBe(false)

    chip('q0', 'Core rendering').click()
    await Promise.resolve()
    expect((m.q('user-input-other-q0') as HTMLInputElement).value).toBe('')

    m.q('user-input-answer').click()
    expect(answers(sent()[0]!)).toEqual({ q0: 'Core rendering' })
  })

  it('an EMPTY Other cannot answer, and a multi-select keeps both kinds at once', async () => {
    // ⛔ 139 §7's rule, extended rather than contradicted: nothing chosen means Answer stays off,
    // and a field the user opened and left blank is nothing chosen.
    const { m, sent, chip } = card([{ ...DESCRIBED, multiSelect: true }])
    const button = m.q('user-input-answer') as HTMLButtonElement
    expect(button.disabled).toBe(true)

    const other = m.q('user-input-other-q0') as HTMLInputElement
    other.value = '   '
    other.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
    expect((m.q('user-input-answer') as HTMLButtonElement).disabled, 'blank is nothing').toBe(true)

    // A typed answer JOINS the picks on a multi-select question rather than replacing them — and the
    // labels stay in the question's order with the typed one last.
    chip('q0', 'Agents & skills').click()
    other.value = 'and one more'
    other.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
    chip('q0', 'Core rendering').click()
    await Promise.resolve()

    m.q('user-input-answer').click()
    expect(answers(sent()[0]!)).toEqual({
      q0: ['Core rendering', 'Agents & skills', 'and one more'],
    })
  })

  it('renders the header and every description, and NOTHING where there is none', async () => {
    const { m } = card([DESCRIBED])

    const header = m.q('user-input-header-q0')
    expect(header.textContent!.trim()).toBe('Scope')
    expect(visible(header)).toBe(true)

    const described = m.host.querySelectorAll('.choice .describe')
    // ⛔ Two, not three: the third option carries no description and must draw no line at all (086).
    // A placeholder or an empty node would make "the model gave no reason" and "the model gave the
    // empty reason" indistinguishable on screen.
    expect(described).toHaveLength(2)
    expect([...described].map((el) => el.textContent!.trim())).toEqual([
      'markdown, diffs, tool output and images',
      'checklists, pickers and permission prompts',
    ])

    // ⛔ **EVERY description, not just the first** (146 §5.3, from 145 LOW 3). This established
    // visibility and ink for `described[0]` alone and checked the second by text — so CSS that hid
    // only the second described row stayed green, which is exactly the escape 083 built this
    // project to close. `textContent` survives `visibility: hidden` untouched.
    //
    // Readable, measured with the sensor that can see a fade (126) rather than read off the
    // stylesheet — a 142-character reason nobody can read is not a reason.
    for (const el of described) {
      expect(visible(el), `a description is shown: ${el.textContent!.trim()}`).toBe(true)
      const colour = parseColor(getComputedStyle(el).color)
      expect(colour).not.toBeNull()
      const painted = paintedInk(el, colour!)
      expect(painted.bg[3], 'the option composites to an opaque surface').toBe(1)
      expect(
        contrast(painted.fg, painted.bg),
        `the description reads at ${show(painted.fg)} on ${show(painted.bg)}`,
      ).toBeGreaterThan(3)
    }
  })

  it('a described option gets room; an undescribed question keeps its chip row', async () => {
    // ⚠️ **142 measured why this is a layout change and not a longer pill**: seven real descriptions
    // reassembled from `sess_71a5b654` ran 105–177 characters, mean 142.7. A 28px chip cannot hold
    // one, which is what 139 and 108 both refused `description` on.
    const described = card([DESCRIBED])
    const row = described.m.host.querySelector('.input-choices')!
    expect(row.classList.contains('described')).toBe(true)
    expect(described.chip('q0', 'Core rendering').getBoundingClientRect().height).toBeGreaterThan(
      28,
    )

    // …and a question whose options carry none is untouched: every pre-143 ledger row is this shape.
    const plain = card([MULTI])
    expect(plain.m.host.querySelector('.input-choices')!.classList.contains('described')).toBe(
      false,
    )
    expect(plain.chip('q0', 'Core rendering').getBoundingClientRect().height).toBe(28)
  })

  it('a header is drawn only where the provider sent one', async () => {
    const { m } = card([MULTI])
    expect(m.all('user-input-header-q0'), 'no header, no chip').toHaveLength(0)
  })

  it('a secret question masks what is typed, and an ordinary one does not (141 §3.1)', async () => {
    const secret = card([{ ...DESCRIBED, secret: true }])
    const masked = secret.m.q('user-input-other-q0') as HTMLInputElement
    expect(masked.type).toBe('password')
    // ⛔ **And it is SHOWN** (146 §5.3, from 145 LOW 3). `type=password` on a field CSS has hidden
    // is a masking claim about a control nobody can reach — the check passed over exactly that.
    expect(visible(masked)).toBe(true)
    // The paired positive: masking is read off the question, not applied to every field.
    const plain = card([DESCRIBED])
    const open = plain.m.q('user-input-other-q0') as HTMLInputElement
    expect(open.type).toBe('text')
    expect(visible(open)).toBe(true)
  })

  it('a question with no options at all still answers exactly as it always did', async () => {
    // ⚑ Non-vacuity for the whole describe: the pure free-form question keeps its original
    // `user-input-answer-` hook, which is what the live smoke's card reader drives.
    const { m, sent } = card([{ id: 'q0', prompt: 'name it', options: [] }])
    expect(m.all('user-input-other-q0')).toHaveLength(0)
    const field = m.q('user-input-answer-q0') as HTMLInputElement
    field.value = 'the exporter'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
    m.q('user-input-answer').click()
    expect(answers(sent()[0]!)).toEqual({ q0: 'the exporter' })
  })
})

/**
 * # 🔴 The word on the button, and the request that asks nothing (214 §3, from 213 finding 3)
 *
 * `213` read Home saying *"The agent has finished planning and asks you to approve its plan"* over
 * **Reject · Open** and *"carries no question and nothing to approve"* — and then opened the
 * conversation and found the correct **Approve**. Two surfaces, one request, opposite answers.
 *
 * ⛔ **Nothing in this repository asserted the card's half.** `attention-queue.test.ts` covered the
 * overview and `ui-honesty.render.test.ts` covered the button's EXISTENCE; the word in it —
 * `questions.length > 0 ? 'Answer' : 'Approve'`, the one true copy of a rule the overview held
 * differently — was asserted nowhere, which is precisely how the two came apart without a red.
 */
/**
 * ⚠️ **The WORD, not the whole control** (482). The button holds two children now — the word and
 * what pressing it does — so `textContent` is *"Approvethe request is approved with…"*. ⛔ Reading
 * the `<strong>` keeps this pair about the thing `214` §3 is about, and narrowing it is what makes
 * it still able to fail: an assertion over the whole button would now pass on a card that had lost
 * the word and kept the sentence.
 */
const wordOn = (button: HTMLElement): string =>
  button.querySelector('strong')?.textContent?.trim() ?? ''

describe('214 §3 · what the positive control says', () => {
  it('🔴 a request that asks NOTHING reads Approve, and sends the empty answer', () => {
    // A Claude `ExitPlanMode`: no questions, no permission scope. The shape Home refused.
    const { m, sent } = card([])
    const button = m.q('user-input-answer') as HTMLButtonElement

    expect(wordOn(button)).toBe('Approve')
    expect(visible(button)).toBe(true)
    expect(button.disabled).toBe(false)

    button.click()
    // ⛔ The card's own payload since 020 — `answerToForward` reports it forwardable (its loop has
    // no questions to walk) and Claude's `respondUserInput` settles the plan gesture on it.
    expect(sent()).toEqual([{ kind: 'answer', answers: {} }])
  })

  it('⚑ …and a request that DOES ask reads Answer — the discrimination, not a label', () => {
    // The paired positive: a component that said "Approve" on everything would pass the test above.
    const { m } = card([SINGLE])
    expect(wordOn(m.q('user-input-answer'))).toBe('Answer')
  })
})
