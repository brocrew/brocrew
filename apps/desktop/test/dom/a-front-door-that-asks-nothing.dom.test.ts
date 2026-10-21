import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { NO_LAUNCH_CHOICES, type LaunchChoices } from '../../src/renderer/src/lib/launch-choices'
import { DEFAULT_PROFILE_ID, type CreateSessionInput } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * 417 · **A front door that asks nothing** (HO-022 §2).
 *
 * > *"Opening a new conversation opens a conversation with BroBot. That is all."*
 *
 * ⛔ **AT THE REAL VIEWPORT, which none of the launcher's seventeen dom tests used.** Every one of
 * them sized a `<div>` — thirteen at `1000×900` — inside whatever viewport the runner happened to
 * be left on, which answers about the div. `main/index.ts` declares a `1200×840` frameless window
 * and this app draws its own 32px bar, so what a person sees is `1200×808`; that is the number
 * nineteen other files in this directory use and it is the one an "is anything still here" claim
 * has to be made at. ⚠️ **The viewport is SHARED** — captured at module load, restored in
 * `afterEach`.
 */

const REAL = { width: 1200, height: 808 }
/** What is left of {@link REAL} once the rail has taken `--rail-w` (208px below the 1400px step). */
const PANE = { width: REAL.width - 208, height: REAL.height }
const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

/**
 * 🔴 **Ten of HO-022 §2's thirteen, and they are the ones HO-025 §5 did NOT put back** (435).
 *
 * ⛔ **`417` asserted all thirteen absent and three of them are on the screen again.** HO-025 §5
 * reversed half of its own ruling — *"`asks nothing` meant do not make configuring a session the
 * price of starting a conversation. It did not mean the choices should be unavailable"* — and named
 * exactly three: provider, model and reasoning effort.
 *
 * ⚠️ **The three came back under the hooks they left under, deliberately.** `435 §2.1` warns that
 * *"a screen census that cannot see a picker re-added under a new name is how this regresses in the
 * other direction"*; a `identity-select`-shaped rename would have left this list reading clean with
 * a control on the screen. ⚑ **So this list is honest about what left and what came back**, and
 * {@link OFFERED} below is the other half of the same sentence.
 *
 * ⛔ **The three container hooks stay gone and they are not a technicality.** `new-conversation-settings`
 * was a bordered `This conversation · set once, when it starts` frame and `fine-tune-toggle` /
 * `fine-tune-body` were a disclosure — *"optional — or change any time in Controls"* over a payload
 * that sometimes asked for something (`292 §3`). ⚑ **What `417` deleted was the asking, and what
 * `435` restores is the choosing**: there is nothing here to open, which is how *they do not move
 * the composer* is answered by construction rather than by a popover.
 */
const STILL_GONE = [
  'profile-select',
  'project-select',
  'cwd-input',
  'cwd-choose',
  'auto-approve',
  'fine-tune-toggle',
  'fine-tune-body',
  'plan-mode',
  'ultracode',
  'new-conversation-settings',
] as const

/**
 * ⚑ The three HO-025 §4 names, by the hook a person's click finds — see {@link STILL_GONE}.
 * ⚑ **UI-012 · ONE control holds all three now**: the model picker's face (`09` §1), whose list
 * names the provider (R-3) and whose panel holds the effort.
 */
const OFFERED = ['model-picker-face'] as const

/**
 * 🔴 **The front door column's whole vocabulary, per state** — the ONE assertion that can see a
 * control added under a name nobody wrote down.
 *
 * ⛔ **`always` is what the column draws in every state**: the row, the three controls, the one
 * sentence `579` left standing, and the two PRESSES its explanation now sits behind. Everything
 * else is conditional and belongs to the state that draws it, which is why this is a table rather
 * than a single set — see the `it.each` below.
 *
 * ## ⚑ 579 · what moved out of `always`, and it is the whole of `EXT-010` §2.1
 *
 * ⛔ **`profile-credential` and `launch-approval-bound` are no longer here.** They are the two
 * blocks the PO sent behind a disclosure — *"a sign-in explanation nobody opening a conversation is
 * wondering about, and a paragraph explaining what a setting is"* — so they belong to the state a
 * PRESS puts the column in, enumerated in {@link STATES} like every other state. ⚠️ **Their hooks
 * are unchanged**, which is what lets every instrument that reads them go on reading the same
 * element after one press rather than after a rename.
 *
 * ⚑ **Three hooks arrived**: the two openers, and `launch-approval-governs` — the clause that could
 * NOT fold, because folding the scope of a control while making it louder is the worse defect
 * `579`'s brief names.
 */
// The approved short launcher removes the explanation stack and persistent mode editor.
const VOCABULARY = {
  always: [
    'attach-path',
    'composer-band',
    'composer-hint',
    'prompt-input',
    'send-prompt',
    'launcher-choices',
    'model-picker',
    'model-picker-face',
    'model-picker-panel',
  ],
  asking: [
    'attach-path',
    'composer-band',
    'composer-hint',
    'prompt-input',
    'send-prompt',
    'launcher-choices',
    'model-picker',
    'model-picker-face',
    'model-picker-panel',
  ],
} as const

function installBridge(): void {
  ;(window as unknown as { api: unknown }).api = {
    runtime: { checkProviderAuth: () => Promise.resolve({ state: 'usable' }) },
  }
}

/**
 * ⚠️ **The choices are held by the FRAME, not by the component** (435) — which is where
 * `RuntimeScreen` holds them, and for the reason `LaunchChoices` gives: this surface is torn down
 * whenever a conversation opens over it. A test that let the component own them would be driving a
 * shape the app does not have.
 */
function open(over: Record<string, unknown> = {}): {
  m: Mounted
  started: CreateSessionInput[]
  choices: { value: LaunchChoices }
} {
  installBridge()
  const started: CreateSessionInput[] = []
  const words = ref('work through the ticket')
  const choices = ref<LaunchChoices>({ ...NO_LAUNCH_CHOICES })
  const book = createAttachmentBook()
  const Frame = defineComponent({
    name: 'FrontDoorFrame',
    setup() {
      return () =>
        h(NewConversation as Component, {
          busy: false,
          error: null,
          debug: false,
          draft: words.value,
          handing: book.handing(NEW_CONVERSATION),
          defaultProvider: 'codex',
          // 🔴 **500 · the mode a person set once** (HO-036 §3.1). ⛔ `'ask'` here is the mounted
          // default and is what makes every unqualified assertion in this file a statement about a
          // person who has not turned yolo on — the two other states (`'auto'`, and `null` for *the
          // row has not been read*) are driven by `over` where they are the subject.
          defaultApprovalMode: 'ask',
          capabilities: allProviderCapabilities(),
          // ⛔ **No list is held — nobody has answered yet** (435), which is this screen's first
          // second and the state every assertion below that does not say otherwise is made in.
          choices: choices.value,
          onStart: (input: CreateSessionInput) => started.push(input),
          'onUpdate:draft': (text: string) => (words.value = text),
          'onUpdate:choices': (next: LaunchChoices) => (choices.value = next),
          ...over,
        })
    },
  })
  // ⛔ **The pane's real width, inside the real window.** `page.viewport` puts the runner at
  // `1200×808`; this surface never occupies it — `SideRail` takes `--rail-w`, which is `208px`
  // below the 1400px step — so the box is what is left. ⚠️ Both numbers are needed and neither is
  // decorative: the viewport is what `.empty-stage`'s `overflow: auto` and the `100%` chain resolve
  // against, and the box is what a person's eye is actually looking at.
  return { m: mount(Frame, {}, { width: PANE.width, height: PANE.height }), started, choices }
}

afterEach(async () => {
  unmountAll()
  delete (window as { api?: unknown }).api
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

describe('§1 · the screen asks for nothing, and the composer is what is left', () => {
  it('⛔ none of the ten controls HO-025 §5 left deleted is in the DOM', async () => {
    await page.viewport(REAL.width, REAL.height)
    const { m } = open()
    await nextTick()
    const still = STILL_GONE.filter((cy) => m.host.querySelector(`[data-cy="${cy}"]`) !== null)
    expect(still, 'the front door is still asking for these').toEqual([])
  })

  it('⚑ …and the three HO-025 §4 names ARE here, in the one picker UI-012 made of them', async () => {
    // 🔴 **The other half of the same sentence, and `435 §2.1` is why it is written down.** `417`
    // predicted this file would *"go RED the day the roster gains a create button"* and it did not,
    // twice. ⛔ **A list of absences cannot say anything about a presence**, so the presence is
    // asserted rather than left to the closed set below to imply: these three came back under the
    // names a person's click and a live instrument already know, and a rename would have made the
    // list above read clean with the control on the screen.
    await page.viewport(REAL.width, REAL.height)
    const { m } = open()
    await nextTick()
    const here = OFFERED.filter((cy) => m.host.querySelector(`[data-cy="${cy}"]`) !== null)
    expect(here, 'the front door offers nothing after HO-025 §5').toEqual([...OFFERED])
  })

  it('⚑ …and the detector that says so can see a control when there IS one', async () => {
    await page.viewport(REAL.width, REAL.height)
    const { m } = open()
    await nextTick()
    // ⛔ **The control plants TWO**, because one planted element can be found by a query that has
    // silently narrowed to the first match. Both must come back, and the real surface must then
    // come back empty under the same walk.
    for (const cy of ['profile-select', 'cwd-input']) {
      const planted = document.createElement('select')
      planted.setAttribute('data-cy', cy)
      m.host.append(planted)
    }
    const found = STILL_GONE.filter((cy) => m.host.querySelector(`[data-cy="${cy}"]`) !== null)
    expect(found, 'the walk cannot see a planted picker, so its silence measures nothing').toEqual([
      'profile-select',
      'cwd-input',
    ])
  })

  it('🔴 …and the CLOSED set: three controls, one note, two openers, two labels — nothing else', async () => {
    // Enumerate the launcher and its composer so an extra control cannot hide under a new name.
    await page.viewport(REAL.width, REAL.height)
    const { m } = open()
    await nextTick()
    const column = m.q('launcher-column')
    const mine = [...column.querySelectorAll('[data-cy]')]
      .map((el) => el.getAttribute('data-cy'))
      .filter((cy): cy is string => cy !== null)
      .sort()
    expect(mine, JSON.stringify(mine)).toEqual([...VOCABULARY.asking].sort())
    // The shared composer belongs to this column; the shared header stays outside it.
    expect(m.host.querySelector('[data-cy="composer-band"]')).not.toBeNull()
    expect(column.querySelector('[data-cy="composer-band"]')).not.toBeNull()
  })

  /**
   * 🔴 **Every other state this column has, enumerated** (435, from its own review).
   *
   * ⛔ **The first version of this census ran in ONE state**, and its own comment conceded the gap
   * while pointing at an assertion that enumerates `.note` elements rather than hooks. A picker
   * smuggled into any conditional branch — inside `v-if="modelChoices"`, beside `model-remedy` in
   * the refused arm, inside the blocking group — would have passed the closed set, both named-hook
   * lists and the live instrument's list at once. ⚑ Which is `435 §2.1`'s regression, one layer
   * further in than the rename it was written about.
   */
  const STATES: {
    why: string
    over: Record<string, unknown>
    adds: string[]
    drops?: string[]
    press?: string[]
  }[] = [
    {
      why: 'a saved Auto default needs no repeat choice',
      over: { defaultApprovalMode: 'auto' },
      adds: [],
    },
    {
      why: 'an unread default blocks sending and shows the choice',
      over: { defaultApprovalMode: null },
      adds: ['first-approval-choice', 'choose-ask', 'choose-auto'],
    },
    {
      why: 'a never-chosen default has no preselection',
      over: { approvalDefaultChosen: false },
      adds: ['first-approval-choice', 'choose-ask', 'choose-auto'],
    },
    {
      why: 'a refused launch keeps its error',
      over: { error: 'no such binary — is codex installed?' },
      adds: ['command-error', 'launch-blocked'],
    },
  ]

  it.each(STATES)(
    '🔴 …and the closed set holds in every other state — $why',
    async ({ over, adds, drops, press }) => {
      await page.viewport(REAL.width, REAL.height)
      const { m } = open(over)
      await nextTick()
      for (const opener of press ?? []) {
        ;(m.q(opener) as HTMLButtonElement).click()
        await nextTick()
      }
      const column = m.q('launcher-column')
      const mine = [...column.querySelectorAll('[data-cy]')]
        .map((el) => el.getAttribute('data-cy'))
        .filter((cy): cy is string => cy !== null)
        .sort()
      const gone: readonly string[] = drops ?? []
      const expected = [...VOCABULARY.always, ...adds].filter((cy) => !gone.includes(cy)).sort()
      expect(mine, JSON.stringify(mine)).toEqual(expected)
    },
  )

  it('⚑ …and THAT is the assertion a renamed picker trips — the one §2.1 says keeps missing', async () => {
    // 🔴 **`435 §2.1`'s blind spot, planted.** Every absence above is a list of NAMES, so a picker
    // re-introduced as `identity-select` or `workspace-chooser` passes all of them — which is
    // exactly what `417` promised would go red and did not. ⛔ This is the assertion that catches
    // it, and this is the plant that proves it can.
    await page.viewport(REAL.width, REAL.height)
    const { m } = open()
    await nextTick()
    const column = m.q('launcher-column')
    const smuggled = document.createElement('select')
    smuggled.setAttribute('data-cy', 'identity-select')
    column.append(smuggled)
    const mine = [...column.querySelectorAll('[data-cy]')]
      .map((el) => el.getAttribute('data-cy'))
      .filter((cy): cy is string => cy !== null)
      .sort()
    // ⛔ **Against the SET the test above asserts, and not against a `toContain` on a list this
    // test just appended to.** ⚠️ The first version of this asserted `mine` contains
    // `identity-select` — true by construction of `querySelectorAll` for anything just appended —
    // and then compared two module constants, which never touches the DOM. Neither could fail, and
    // between them they never ran the assertion the test is named for.
    expect(mine, 'the enumeration cannot see a control under a new name').not.toEqual(
      VOCABULARY.asking,
    )
    // ⚠️ Widened to `string[]` at the call site: `VOCABULARY` is `as const`, so `.includes` on it
    // refuses a plain string — which is the typechecker making the same point as the assertion.
    const expected: readonly string[] = VOCABULARY.asking
    expect(mine.filter((cy) => !expected.includes(cy))).toEqual(['identity-select'])
    // ⚠️ **And it is invisible to every list of NAMES**, which is the half worth stating. ⛔ Widened
    // to `string[]` deliberately — against the literal unions the comparison does not compile,
    // which is the typechecker saying the same thing this assertion does.
    const everyNamedHook: readonly string[] = [...STILL_GONE, ...OFFERED]
    expect(
      everyNamedHook.includes('identity-select'),
      'a named-hook census cannot see a control it was not told about',
    ).toBe(false)
  })

  it('⚑ the composer is there, visible, and is the only thing that can start anything', async () => {
    await page.viewport(REAL.width, REAL.height)
    const { m, started } = open()
    await nextTick()
    const box = m.q('prompt-input') as HTMLTextAreaElement
    expect(visible(box), 'a composer at zero height is not a composer').toBe(true)
    ;(m.q('send-prompt') as HTMLButtonElement).click()
    await nextTick()
    expect(started).toHaveLength(1)
  })
})

describe('§2 · what the one remaining door opens, field by field', () => {
  /**
   * ⚠️ **The title said *"on the app frame's provider"* until `433`, and the app stopped working
   * that way at `423`.** `RuntimeScreen.frontDoorProvider` resolves BroBot's own identity row
   * FIRST and the frame's constant only as a fallback; `433` then gave a person a control that
   * writes that row. ⛔ **This mount cannot see any of it**: `defaultProvider` arrives as a PROP,
   * so what is measured here is that the door sends what it was handed and nothing else — which is
   * the claim worth having at this component, and is what the title now says.
   */
  it('⛔ BroBot, on the provider it was handed, prompting — and nothing else on the wire', async () => {
    await page.viewport(REAL.width, REAL.height)
    const { m, started } = open()
    await nextTick()
    ;(m.q('send-prompt') as HTMLButtonElement).click()
    await nextTick()
    expect(started[0]).toEqual({
      provider: 'codex',
      profileId: DEFAULT_PROFILE_ID,
      approvalMode: 'ask',
    })
  })

  /**
   * 🔴 **WITHDRAWN AT `500`, by the PO, and replaced by the weaker claim that is still true.**
   *
   * ⛔ This test read *"a front-door conversation can never begin unattended"*, and `417 §1.6`
   * measured that property getting STRONGER when the approvals checkbox left this screen. ⚑ It was
   * right about the checkbox. ⚠️ **`HO-036` §3.1 withdrew the property itself**: *"a person sets
   * their approval mode once, and every conversation they start begins there"* — from live use,
   * where the cost of the old rule was *"stopping every 3 seconds to allow something"*.
   *
   * 🔴 **So what survives is: the front door asks nothing, and sends the mode the person already
   * chose.** ⛔ **Three states, because a two-state test would be satisfied by a surface that
   * ignored the prop and echoed it** — the unread row is the one that proves the door does not
   * simply forward whatever it is handed, since `null` is not a value a launch may carry.
   */
  it('🔴 a front-door conversation begins in the mode the person set, and in ask until it is read', async () => {
    await page.viewport(REAL.width, REAL.height)
    for (const [set, sent] of [
      ['ask', 'ask'],
      ['auto', 'auto'],
      // ⛔ **The fail-safe.** `null` is *the policy read has not landed*; a launch must carry a
      // word, and the word is the one that keeps somebody being asked. ⚠️ The CONTROL says the row
      // is unread rather than claiming `ask` — that half is asserted in §4.
    ] as const) {
      const { m, started } = open({ defaultApprovalMode: set })
      await nextTick()
      ;(m.q('send-prompt') as HTMLButtonElement).click()
      await nextTick()
      expect(started, JSON.stringify(set)).toHaveLength(1)
      expect(started[0]?.approvalMode, JSON.stringify(set)).toBe(sent)
      m.unmount()
    }
  })

  it('⚑ the folder is omitted, so the host decides where BroBot works', async () => {
    await page.viewport(REAL.width, REAL.height)
    const { m, started } = open()
    await nextTick()
    ;(m.q('send-prompt') as HTMLButtonElement).click()
    await nextTick()
    expect(started).toHaveLength(1)
    const sent = started[0] as CreateSessionInput
    expect('cwd' in sent, 'a cwd sent from a control nobody was shown').toBe(false)
    expect('projectSlug' in sent, 'a project chosen by a screen with no project').toBe(false)
  })
})

describe('the explanation stack is removed from the short launcher', () => {
  it.each(['claude', 'codex'] as const)(
    'keeps the composer and model choice for %s',
    async (provider) => {
      await page.viewport(REAL.width, REAL.height)
      const { m } = open({ defaultProvider: provider })
      await nextTick()
      for (const cy of [
        'provider-is-fixed',
        'launcher-why-credential',
        'launcher-why-approval',
        'launch-approval-mode',
      ]) {
        expect(m.all(cy)).toHaveLength(0)
      }
      expect(visible(m.q('prompt-input'))).toBe(true)
      expect(visible(m.q('model-picker-face'))).toBe(true)
    },
  )
})
