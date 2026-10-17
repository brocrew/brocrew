import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { computed, defineComponent, h, nextTick, ref, type Component } from 'vue'
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import { providerForALaunch } from '../../src/renderer/src/lib/agent-store'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { providerIsFixed } from '../../src/renderer/src/lib/front-door-words'
import { NO_LAUNCH_CHOICES, type LaunchChoices } from '../../src/renderer/src/lib/launch-choices'
import { createModelLists, type ModelLists } from '../../src/renderer/src/lib/model-lists'
import { theList } from '../../src/shared/model-choice'
import {
  DEFAULT_PROFILE_ID,
  type CreateSessionInput,
  type ModelCatalogue,
  type ModelChoice,
  type ModelList,
  type Provider,
} from '../../src/shared/runtime-ipc'
import { MEASURED_CLAUDE } from '../fixtures/effort-launches'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * 435 · **…and offers everything** (HO-025 §5).
 *
 * > ⚑ *"The front door asks nothing and OFFERS EVERYTHING. Defaults applied, composer focused, the
 * > choices present and out of the path rather than absent."*
 *
 * ## ⛔ *Out of the path* is a phrase, and this file is the four assertions it was turned into
 *
 * `435 §2`: *"This is the whole risk of the dispatch: `present and out of the path` is a phrase, and
 * a phrase is how `417` got deleted in the first place."*
 *
 *  1. **the composer is first** — the caret lands in it on mount, and nothing below is required;
 *  2. **a person can send without touching a control** — the defaults apply, and the payload of an
 *     untouched door is byte-identical to the one `417` shipped;
 *  3. **the choices are reachable from THIS screen** — and they reach the launch;
 *  4. **and they do not move the composer.**
 *
 * ⚠️ **The fourth has no fold to open, and that is the design rather than a dodge.** `417` deleted a
 * `Fine-tune` disclosure; nothing here replaces it, so the question becomes the stronger one —
 * *does ANYTHING these controls do move the composer* — and the answer is a mechanism:
 * `.empty-stage` is `flex: 1` with `overflow: auto` and `PromptComposer` is its SIBLING, so the
 * column grows into a scroller rather than pushing anything. ⛔ **The test measures the box and not
 * the rule**, with a planted control that proves the measurement can see movement.
 *
 * ## ⚑ UI-012 · the three controls are ONE now — the model picker (`09` §1)
 *
 * Its list names the provider (R-3: picking a Codex model is choosing Codex) and its panel holds the
 * picked model's own efforts. ⚠️ **§5 went with the `<select>`**: `fixtures/effort-launches.ts`'s
 * browser end measured a select showing a value none of its options carried, and the picker
 * cannot hold a level without the model it belongs to.
 */

const REAL = { width: 1200, height: 808 }
/** What is left of {@link REAL} once the rail has taken `--rail-w` (208px below the 1400px step). */
const PANE = { width: REAL.width - 208, height: REAL.height }
const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

/**
 * 310: what `codex: null` used to mean here — *we asked and were refused* — spelled out, because
 * `null` stopped being a meaning.
 */
const REFUSED: Exclude<ModelCatalogue, { ok: true }> = {
  ok: false,
  reason: 'refused',
  detail: 'not signed in',
}

/**
 * ⚑ UI-012 · what a provider answers the list door — its rows, or why it could not be asked, or
 * `'pending'`: nobody has answered yet.
 */
type Answer = readonly ModelChoice[] | Exclude<ModelCatalogue, { ok: true }> | 'pending'

/**
 * ⚑ **UI-012 · D-042's list door, over the test's own answers** — the provider's rows, then the
 * models a person added by hand (`theList`), as the host composes them.
 */
function listsOver(answers: { value: Partial<Record<Provider, Answer>> }): ModelLists {
  const added: Record<Provider, string[]> = { claude: [], codex: [] }
  const listOf = (provider: Provider, answer: Exclude<Answer, 'pending'>): ModelList => {
    const rows = 'ok' in answer ? [] : answer
    return {
      provider,
      notAsked: 'ok' in answer ? answer : null,
      standIn: null,
      models: theList(rows, added[provider]),
      lastPicked: null,
      startsOn: null,
    }
  }
  return createModelLists(() => ({
    modelList: ({ provider }) => {
      const answer = answers.value[provider] ?? []
      return answer === 'pending'
        ? new Promise<ModelList>(() => {})
        : Promise.resolve(listOf(provider, answer))
    },
    addHandAddedModel: ({ provider, model }) => {
      added[provider] = [...added[provider], model.trim()]
      return Promise.resolve(added[provider])
    },
    deleteHandAddedModel: ({ provider, model }) => {
      added[provider] = added[provider].filter((one) => one !== model)
      return Promise.resolve(added[provider])
    },
  }))
}

function installBridge(): void {
  ;(window as unknown as { api: unknown }).api = {
    runtime: { checkProviderAuth: () => Promise.resolve({ state: 'usable' }) },
  }
}

interface Door {
  m: Mounted
  started: CreateSessionInput[]
  choices: { value: LaunchChoices }
  /** What the screen would resolve — the REAL derivation, not a constant. */
  resolved: { value: Provider }
  /** ⚑ UI-012 · what each provider's list door answers, read when the picker opens. */
  answers: { value: Partial<Record<Provider, Answer>> }
}

/**
 * The front door under a frame that owns what `RuntimeScreen` owns.
 *
 * ⛔ **The provider is RESOLVED here, through `providerForALaunch`** — not held as a ref — because
 * that is the shape the app has: the control moves the first term of one derivation and reads the
 * answer back, so the sentence, the select and the payload cannot come apart. A frame that stored
 * the pick directly would be testing a design the screen does not implement.
 */
function open(over: Record<string, unknown> = {}): Door {
  installBridge()
  const started: CreateSessionInput[] = []
  const words = ref('work through the ticket')
  const choices = ref<LaunchChoices>({ ...NO_LAUNCH_CHOICES })
  const answers = ref<Partial<Record<Provider, Answer>>>({})
  const lists = listsOver(answers)
  const book = createAttachmentBook()
  const resolved = computed<Provider>(() =>
    providerForALaunch(null, DEFAULT_PROFILE_ID, 'codex', choices.value.provider),
  )
  const Frame = defineComponent({
    name: 'OffersEverythingFrame',
    setup() {
      return () =>
        h(NewConversation as Component, {
          busy: false,
          error: null,
          debug: false,
          draft: words.value,
          handing: book.handing(NEW_CONVERSATION),
          defaultProvider: resolved.value,
          capabilities: allProviderCapabilities(),
          lists,
          choices: choices.value,
          onStart: (input: CreateSessionInput) => started.push(input),
          'onUpdate:draft': (text: string) => (words.value = text),
          'onUpdate:choices': (next: LaunchChoices) => (choices.value = next),
          ...over,
        })
    },
  })
  return {
    m: mount(Frame, {}, { width: PANE.width, height: PANE.height }),
    started,
    choices,
    resolved,
    answers,
  }
}

const box = (m: Mounted, cy: string): DOMRect => m.q(cy).getBoundingClientRect()

/** ⚑ UI-012 · let the reads and writes the picker started settle, and Vue draw what they said. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

/** ⚑ UI-012 · press the picker's face — the one gesture that opens its panel. */
async function openPicker(m: Mounted): Promise<void> {
  ;(m.q('model-picker-face') as HTMLButtonElement).click()
  await settle()
}

/** ⚑ …draft one provider's row, by its id. */
async function draftRow(m: Mounted, provider: Provider, id: string): Promise<void> {
  const row = m
    .q('model-picker-panel')
    .querySelector<HTMLInputElement>(
      `[data-cy="model-picker-provider"][data-provider="${provider}"] [data-cy="model-picker-row"][data-model="${id}"] input`,
    )
  expect(row, `no ${provider} row ${id}`).not.toBeNull()
  row!.click()
  await settle()
}

/** ⚑ …and press Take. */
async function take(m: Mounted): Promise<void> {
  ;(m.q('model-picker-take') as HTMLButtonElement).click()
  await settle()
}

async function type(m: Mounted, cy: string, value: string): Promise<void> {
  const el = m.q(cy) as HTMLInputElement
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

/** Press Send — typing the words first when the box is empty (the composer's text is a computed). */
async function send(m: Mounted): Promise<void> {
  const area = m.q('prompt-input') as HTMLTextAreaElement
  if (area.value.trim() === '') {
    area.value = 'go'
    area.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
  }
  ;(m.q('send-prompt') as HTMLButtonElement).click()
  await nextTick()
}

afterEach(async () => {
  unmountAll()
  delete (window as { api?: unknown }).api
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

describe('§1 · the composer is first', () => {
  it('⛔ the caret lands in the composer on mount, with the model picker below it', async () => {
    await page.viewport(REAL.width, REAL.height)
    const { m } = open()
    await nextTick()
    // ⚠️ **Two ticks**, because the focus call is deferred: the composer is a child and its
    // `<textarea>` is not in the document until Vue has flushed.
    await nextTick()
    expect(document.activeElement, 'the front door opens somewhere other than the composer').toBe(
      m.q('prompt-input'),
    )
  })

  it('⚑ …and the reading is not vacuous: focus really can be somewhere else', async () => {
    // ⛔ **The detector.** `activeElement` is `<body>` on a page where nothing was focused, so an
    // assertion that never saw a focus call could pass against a composer that is simply the first
    // focusable thing. This moves it away and shows the reading follows.
    await page.viewport(REAL.width, REAL.height)
    const { m } = open()
    await nextTick()
    await nextTick()
    ;(m.q('model-picker-face') as HTMLButtonElement).focus()
    expect(document.activeElement).toBe(m.q('model-picker-face'))
    expect(document.activeElement).not.toBe(m.q('prompt-input'))
  })
})

describe('§2 · a person can send without touching a control', () => {
  it('🔴 the payload of an untouched door is exactly the one 417 shipped', async () => {
    await page.viewport(REAL.width, REAL.height)
    const { m, started } = open()
    await nextTick()
    await send(m)
    // ⛔ **`asks nothing` survives as a property of the PAYLOAD.** `model` and `reasoningEffort`
    // are omissions, and an omission is what the whole stack reads as *leave the default alone*.
    expect(started[0]).toEqual({
      provider: 'codex',
      profileId: DEFAULT_PROFILE_ID,
      approvalMode: 'ask',
    })
  })

  it('⛔ …and nothing below the composer can refuse the press', async () => {
    // ⚑ `composer-parity.test.ts` excuses `blocked` FOR THE LAUNCHER on `417`'s grounds — *"the
    // launcher has nothing left to refuse a press over"* — and its own comment says the exemption
    // must go the day that stops being true. Three controls later, it is still true.
    await page.viewport(REAL.width, REAL.height)
    const { m, started } = open()
    await nextTick()
    expect((m.q('send-prompt') as HTMLButtonElement).disabled).toBe(false)
    await send(m)
    expect(started).toHaveLength(1)
  })
})

describe('§3 · the choices are reachable from THIS screen, and they reach the launch', () => {
  /** ⚑ UI-012 · one provider's section of the open panel. */
  const section = (m: Mounted, provider: Provider): HTMLElement =>
    m
      .q('model-picker-panel')
      .querySelector<HTMLElement>(`[data-cy="model-picker-provider"][data-provider="${provider}"]`)!
  const effort = (m: Mounted, id: string): HTMLInputElement =>
    m
      .q('model-picker-panel')
      .querySelector<HTMLInputElement>(
        `[data-cy="model-picker-effort"][data-effort="${id}"] input`,
      )!

  it('🔴 the provider a person picks is what starts — and what the sentence names', async () => {
    await page.viewport(REAL.width, REAL.height)
    const door = open()
    door.answers.value = { claude: MEASURED_CLAUDE, codex: REFUSED }
    await nextTick()
    expect((door.m.q('provider-is-fixed').textContent ?? '').trim()).toBe(providerIsFixed('codex'))
    // ⚑ UI-012 (R-3) · picking a Claude MODEL is choosing Claude.
    await openPicker(door.m)
    await draftRow(door.m, 'claude', 'haiku')
    await take(door.m)
    // ⚑ **One value, three readers.** The face shows it, the sentence names it, and the launch runs
    // on it — because all three read the one resolution.
    expect((door.m.q('model-picker-face').textContent ?? '').trim()).toBe('Claude · haiku')
    expect((door.m.q('provider-is-fixed').textContent ?? '').trim()).toBe(providerIsFixed('claude'))
    await send(door.m)
    expect(door.started[0]?.provider).toBe('claude')
    expect(door.started[0]?.model).toBe('haiku')
  })

  it('⚑ …a model the provider never listed is added by hand, and started on (038, `09` §6)', async () => {
    await page.viewport(REAL.width, REAL.height)
    const door = open()
    door.answers.value = { claude: MEASURED_CLAUDE, codex: REFUSED }
    await nextTick()
    await openPicker(door.m)
    section(door.m, 'claude')
      .querySelector<HTMLButtonElement>('[data-cy="model-picker-add-open"]')!
      .click()
    await settle()
    await type(door.m, 'model-picker-add-name', '  claude-haiku-4-5-20251001  ')
    ;(door.m.q('model-picker-add') as HTMLButtonElement).click()
    await settle()
    // ⚑ Added, and drafted — that is why it was added; its efforts are the provider's whole ladder.
    effort(door.m, 'high').click()
    await settle()
    await take(door.m)
    await send(door.m)
    // ⚠️ Trimmed at the one door, so a stray space cannot become a model id on the wire.
    expect(door.started[0]?.model).toBe('claude-haiku-4-5-20251001')
    expect(door.started[0]?.reasoningEffort).toBe('high')
  })

  it('⛔ UI-012 · Escape is the picker’s while it is open — the add field first, then the panel — and no one else’s', async () => {
    await page.viewport(REAL.width, REAL.height)
    const door = open()
    door.answers.value = { claude: MEASURED_CLAUDE, codex: REFUSED }
    await nextTick()
    // What the conversation and the sheet listen for, in the bubbling phase: it must never fire.
    let reachedTheWindow = 0
    const bubbling = (): void => {
      reachedTheWindow += 1
    }
    window.addEventListener('keydown', bubbling)
    const escape = (): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
      document.body.dispatchEvent(event)
      return event
    }
    try {
      // Closed: the picker listens to nothing, so an Escape passes through untouched.
      const passed = escape()
      expect(passed.defaultPrevented, 'a closed picker swallowed Escape').toBe(false)
      expect(reachedTheWindow).toBe(1)
      reachedTheWindow = 0

      await openPicker(door.m)
      section(door.m, 'claude')
        .querySelector<HTMLButtonElement>('[data-cy="model-picker-add-open"]')!
        .click()
      await settle()
      expect(door.m.q('model-picker-add-name')).toBeTruthy()

      // Escape one: the add field closes onto + Add, the panel stays.
      expect(escape().defaultPrevented).toBe(true)
      await settle()
      expect(door.m.all('model-picker-add-name')).toHaveLength(0)
      expect(door.m.q('model-picker-panel')!.matches(':popover-open')).toBe(true)

      // Escape two: the panel closes, and focus goes back to the face.
      expect(escape().defaultPrevented).toBe(true)
      await settle()
      expect(door.m.q('model-picker-panel')!.matches(':popover-open')).toBe(false)
      expect(document.activeElement).toBe(door.m.q('model-picker-face'))
      expect(reachedTheWindow, 'an Escape the picker owned reached the window').toBe(0)

      // Closed again: listened to no more.
      expect(escape().defaultPrevented).toBe(false)
    } finally {
      window.removeEventListener('keydown', bubbling)
    }
  })

  it('⚑ …and the effort a person picks out of the provider’s own menu', async () => {
    await page.viewport(REAL.width, REAL.height)
    const door = open()
    door.answers.value = { claude: REFUSED, codex: MEASURED_CLAUDE }
    await nextTick()
    await openPicker(door.m)
    await draftRow(door.m, 'codex', 'opus')
    // ⛔ **The menu is the provider's**, which is `076 §2`'s whole point: `xhigh` is not one of the
    // three `024` wrote down by hand, and it is reachable only because the provider named it.
    const offered = [...door.m.all('model-picker-effort')].map((el) => el.dataset.effort)
    expect(offered).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    effort(door.m, 'xhigh').click()
    await settle()
    await take(door.m)
    await send(door.m)
    expect(door.started[0]?.model).toBe('opus')
    expect(door.started[0]?.reasoningEffort).toBe('xhigh')
  })

  it('🔴 …and a control a person cannot OPERATE is not a choice — `disabled`, both directions', async () => {
    // ⛔ **Presence is not reachability, and every census this dispatch wrote reads presence.**
    // ⚑ UI-012 · the face always opens, and Take waits for a pick it can send.
    await page.viewport(REAL.width, REAL.height)
    const door = open()
    door.answers.value = { claude: REFUSED, codex: MEASURED_CLAUDE }
    await nextTick()
    expect((door.m.q('model-picker-face') as HTMLButtonElement).disabled).toBe(false)
    await openPicker(door.m)
    // ⚠️ **Take IS disabled here, and that is a state about the DRAFT**: nothing is picked yet.
    expect((door.m.q('model-picker-take') as HTMLButtonElement).disabled).toBe(true)
    // …and it comes back the moment there is something to send, which is the other direction and
    // the one that makes the assertion above a measurement rather than a description.
    await draftRow(door.m, 'codex', 'haiku')
    expect((door.m.q('model-picker-take') as HTMLButtonElement).disabled).toBe(false)
  })

  it('⛔ …and the sentence beside it never blames a provider that has not answered (179 §4, 310)', async () => {
    // 🔴 **Found in review, at `435`**: on the first second of every front door the only
    // explanation a person could get was *"This provider did not say which efforts it accepts"*.
    // ⛔ That is the limit-invented-from-silence `179 §4` refused. ⚑ UI-012 · the picker's panel.
    await page.viewport(REAL.width, REAL.height)
    const asking = open()
    asking.answers.value = { claude: 'pending', codex: 'pending' }
    await nextTick()
    await openPicker(asking.m)
    const said = (m: Mounted, provider: Provider): string =>
      section(m, provider).querySelector('[data-cy="model-picker-said"]')?.textContent?.trim() ?? ''
    expect(said(asking.m, 'codex'), 'a provider was blamed for a list that never answered').toBe(
      'Asking Codex what it can run…',
    )
    asking.m.unmount()

    // ⚠️ **And a model a person added while the provider cannot be asked**: its efforts are
    // UNKNOWN, never *"none"* — the host's own reading.
    const refused = open()
    refused.answers.value = { claude: REFUSED, codex: REFUSED }
    await nextTick()
    await openPicker(refused.m)
    section(refused.m, 'codex')
      .querySelector<HTMLButtonElement>('[data-cy="model-picker-add-open"]')!
      .click()
    await settle()
    await type(refused.m, 'model-picker-add-name', 'gpt-5.6-terra')
    ;(refused.m.q('model-picker-add') as HTMLButtonElement).click()
    await settle()
    const none = (m: Mounted): string => (m.q('model-picker-effort-none').textContent ?? '').trim()
    expect(none(refused.m)).toBe('Codex could not be asked which efforts “gpt-5.6-terra” offers.')
    refused.m.unmount()

    // ⚑ The paired positive: with a list, the sentence IS about the provider's row, and says so.
    const listed = open()
    listed.answers.value = { claude: REFUSED, codex: MEASURED_CLAUDE }
    await nextTick()
    await openPicker(listed.m)
    await draftRow(listed.m, 'codex', 'haiku')
    expect(none(listed.m)).toBe('“haiku” has no effort levels.')
  })

  it('⛔ …from this screen, not from a settings surface a person has to know about', async () => {
    // ⚑ HO-025 §5's other half: *"a person who has to open a settings surface to pick a provider —
    // or cannot, because the column has one writer — is worse off than before."* ⚑ UI-012 · the
    // picker is inside the front door's own column, and so is the panel its face opens.
    await page.viewport(REAL.width, REAL.height)
    const door = open()
    door.answers.value = { claude: MEASURED_CLAUDE, codex: REFUSED }
    await nextTick()
    const column = door.m.q('launcher-column')
    expect(column.contains(door.m.q('model-picker-face'))).toBe(true)
    expect(visible(door.m.q('model-picker-face')), 'the face is drawn at zero size').toBe(true)
    await openPicker(door.m)
    expect(column.contains(door.m.q('model-picker-panel'))).toBe(true)
    expect(visible(door.m.q('model-picker-panel')), 'the panel did not open').toBe(true)
  })
})

describe('§4 · and they do not move the composer', () => {
  /**
   * 🔴 **The fourth property, measured as a box** (`435 §2`).
   *
   * ⛔ **Every state these controls can be in, against one composer rectangle.** A menu filling, a
   * sentence arriving, a long refusal wrapping, a long id typed into the box — the column grows and
   * the composer does not move, because the choices follow the composer inside the scrolling stage.
   */
  it('🔴 nothing the choices do moves the box a person is typing into', async () => {
    await page.viewport(REAL.width, REAL.height)
    const door = open()
    door.answers.value = { claude: REFUSED, codex: REFUSED }
    await nextTick()
    const resting = box(door.m, 'composer-band')
    const still = (why: string): void => {
      const now = box(door.m, 'composer-band')
      expect({ top: now.top, height: now.height }, why).toEqual({
        top: resting.top,
        height: resting.height,
      })
    }

    // ⚑ UI-012 · the panel opens in the top layer, over the column, and reflows nothing.
    await openPicker(door.m)
    still('a refusal in the open panel, which is the longest sentence this screen can draw')
    ;(door.m.q('model-picker-cancel') as HTMLButtonElement).click()
    await settle()
    door.answers.value = { claude: MEASURED_CLAUDE, codex: MEASURED_CLAUDE }
    await openPicker(door.m)
    still('a list, so the rows arrive')

    // …and a person typing a long id into the add field, which is the state they are IN while this
    // happens.
    door.m
      .q('model-picker-panel')
      .querySelector<HTMLButtonElement>('[data-cy="model-picker-add-open"]')!
      .click()
    await settle()
    await type(
      door.m,
      'model-picker-add-name',
      'a-provider-id-nobody-has-ever-heard-of-and-it-is-long',
    )
    await nextTick()
    still('a long id typed')
  })

  it('⚑ …and the measurement can see movement when there IS some — the planted control', async () => {
    // A block above the composer must move it; removing the block must restore it.
    await page.viewport(REAL.width, REAL.height)
    const door = open()
    await nextTick()
    const before = box(door.m, 'composer-band')
    const plant = document.createElement('div')
    plant.style.height = '120px'
    plant.style.flex = '0 0 auto'
    door.m.q('composer-band').before(plant)
    await nextTick()
    const after = box(door.m, 'composer-band')
    expect(after.top, 'the box reading cannot see the composer move').toBeGreaterThan(before.top)
    // …and it goes back, so the reading is not a one-way ratchet.
    plant.remove()
    await nextTick()
    expect(box(door.m, 'composer-band').top).toBe(before.top)
  })

  it('⛔ …and the mechanism that makes it true is the one being relied on', async () => {
    // ⚠️ **Named, because the outcome above is what is pinned and this is why it holds.** If the
    // stage stopped scrolling, the assertions above would start depending on the column being short
    // enough — which is the kind of green that goes red on somebody else's string.
    await page.viewport(REAL.width, REAL.height)
    const { m } = open()
    await nextTick()
    const stage = m.q('launcher-column').closest('.empty-stage') as HTMLElement
    const style = getComputedStyle(stage)
    expect(style.overflowY, 'the stage stopped being a scroller').toMatch(/auto|scroll/)
    expect(style.flexGrow).toBe('1')
  })
})
