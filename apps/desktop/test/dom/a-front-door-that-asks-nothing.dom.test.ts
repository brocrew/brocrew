import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import { YOLO_MEANS } from '../../src/renderer/src/lib/approval-mode'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { providerIsFixed } from '../../src/renderer/src/lib/front-door-words'
import { NO_LAUNCH_CHOICES, type LaunchChoices } from '../../src/renderer/src/lib/launch-choices'
import {
  DEFAULT_PROFILE_ID,
  providerName,
  type CreateSessionInput,
} from '../../src/shared/runtime-ipc'
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
const VOCABULARY = {
  always: [
    'attach-path',
    'composer-band',
    'composer-hint',
    'prompt-input',
    'send-prompt',
    // 🔴 **500 · the one SETTING this column holds** (HO-036 §3.1). ⚠️ **`launch-approval-press` is
    // in this list because these fixtures mount with the row READ** (`defaultApprovalMode: 'ask'`);
    // the unread state drops it, and is enumerated in {@link STATES} like every other state is.
    // ⚑ **579 · `launch-approval-governs` joins them and never leaves**, the unread frame included:
    // *what this governs* is true before the row has been read.
    'launch-approval',
    'launch-approval-governs',
    'launch-approval-mode',
    'launch-approval-press',
    'launch-approval-says',
    'launcher-choices',
    // 🔴 **579 · the clause that could not fold with the credential sentence** — *a copy is kept
    // here* / *nothing is kept here*, rendered from `profileCredential().copies` INSIDE the
    // opener, so it is part of the button's accessible name. ⛔ It is `always` because the fact it
    // reports is true in every state; what folds is the adapter's paragraph explaining it.
    'launcher-sign-in-glance',
    // ⚑ **579 · the two presses**, and they are `always` for the reason the bodies are not: an
    // opener is drawn whatever a person has pressed, and that is what makes the explanation
    // REACHABLE rather than removed.
    'launcher-why-approval',
    'launcher-why-credential',
    // ⚑ **UI-012 · the one model picker** — closed, it is its face and an empty panel.
    'model-picker',
    'model-picker-face',
    'model-picker-panel',
    'provider-is-fixed',
  ],
  /**
   * Nobody has answered yet, which is the state every front door mounts in. ⚑ UI-012 · the same
   * set: what the list says lives in the picker's panel, so the column has nothing to add.
   */
  asking: [
    'attach-path',
    'composer-band',
    'composer-hint',
    'prompt-input',
    'send-prompt',
    'launch-approval',
    'launch-approval-governs',
    'launch-approval-mode',
    'launch-approval-press',
    'launch-approval-says',
    'launcher-choices',
    'launcher-sign-in-glance',
    'launcher-why-approval',
    'launcher-why-credential',
    'model-picker',
    'model-picker-face',
    'model-picker-panel',
    'provider-is-fixed',
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
    /** ⚑ **500 · what a state takes AWAY**, which no state needed until the setting had three. */
    drops?: string[]
    /**
     * ⚑ **579 · the openers to press before the column is read** — the first state in this table
     * that is reached by a GESTURE rather than by a prop, because the two explanations `EXT-010`
     * §2.1 folded are reached that way too.
     */
    press?: string[]
  }[] = [
    // ⚑ **UI-012 · the five rows about the model list went with the column's model sentences** — a
    // catalogue, a refused probe, a level's description, a model with no levels and a held rung
    // all draw inside the picker's panel now, which the column census cannot see while it is shut.
    {
      // 🔴 **500 · the mode a person set once is `auto`** — the state `HO-036` §3.1 exists for, and
      // the one `417` removed from this screen with the checkbox. ⛔ **Both halves of `367`'s
      // disclosure arrive together**: the shared sentence and the ADAPTER's own note for the
      // provider this launch runs on. `design-v2-map.ts` rules that a surface drawing one of them
      // tells a person strictly less than the running app already does.
      why: 'the person set yolo once: the door says what that removes, before they type',
      over: { defaultApprovalMode: 'auto' },
      adds: ['yolo-means', 'yolo-reach'],
    },
    {
      // ⚠️ **500 · the row has not been read yet**, which is every front door's first frame and is
      // NOT `ask` — `086`'s rule, on the one control where the wrong default is dangerous in both
      // directions. ⛔ There is nothing to promise about a press that cannot be made, so the
      // consequence line goes; the control and its bound stay, because what they say is still true.
      why: 'nobody has answered the policy read: the control says so and offers no press',
      over: { defaultApprovalMode: null },
      adds: [],
      drops: ['launch-approval-press'],
    },
    {
      why: 'the launch was refused, so the blocking group is up',
      over: { error: 'no such binary — is codex installed?' },
      adds: ['command-error', 'launch-blocked'],
    },
    {
      // 🔴 **579 · the paired POSITIVE for the two absences above** (`EXT-010` §2.1). ⛔ Without
      // this row the fold would be indistinguishable from a deletion: every other state asserts
      // the two hooks are NOT in the column, and a dispatch that had simply removed the sentences
      // would satisfy all of them. ⚑ **This is the row that says the explanation is still there**,
      // one press away, under the hooks it has always had.
      why: 'a person pressed both openers: the explanation is behind them, not gone',
      over: {},
      press: ['launcher-why-credential', 'launcher-why-approval'],
      adds: ['profile-credential', 'launch-approval-bound'],
    },
    {
      // ⚠️ **…and ONE press opens ONE fold** — the detector for the row above. A pair of openers
      // wired to the same flag would pass it, and would mean a person asking about a sign-in got
      // a paragraph about approvals as well.
      why: 'one press opens one fold and leaves the other closed',
      over: {},
      press: ['launcher-why-credential'],
      adds: ['profile-credential'],
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
      [null, 'ask'],
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

describe('§3 · the one default that is permanent says so', () => {
  it('⛔ the sentence is on the screen, above the composer', async () => {
    await page.viewport(REAL.width, REAL.height)
    const { m } = open()
    await nextTick()
    const said = m.q('provider-is-fixed')
    expect(visible(said), 'a disclosure at zero height is not a disclosure').toBe(true)
    expect((said.textContent ?? '').trim()).toBe(providerIsFixed('codex'))
  })

  it('🔴 it names the provider it is actually about — and the two do not say the same thing', async () => {
    await page.viewport(REAL.width, REAL.height)
    const onClaude = open({ defaultProvider: 'claude' })
    await nextTick()
    const claude = (onClaude.m.q('provider-is-fixed').textContent ?? '').trim()
    // ⚑ The display name (`151`), never the wire id — `PROVIDER_NAME` is what a person reads.
    expect(claude).toContain(providerName('claude'))
    expect(claude).not.toContain(providerName('codex'))
    expect(claude, 'the wire id reached a sentence a person reads').not.toContain('claude')
    // ⚠️ The distinctness check: a sentence that read the same for both would be describing the
    // app rather than reporting this conversation, which is the whole defect it exists against.
    expect(claude).not.toBe(providerIsFixed('codex'))
    expect(claude).toBe(providerIsFixed('claude'))
  })

  it('⛔ and since 579 it is the ONLY always-on line, full stop', async () => {
    await page.viewport(REAL.width, REAL.height)
    const { m } = open()
    await nextTick()
    const notes = [...m.host.querySelectorAll('.note')].map((el) => el.getAttribute('data-cy'))
    // 🔴 **ONE, and it is the always-on one** (579). ⚑ UI-012 · `model-say`, `310`'s sentence,
    // moved into the model picker's panel with the list it is about, so nothing on the column says
    // *asking* any more. ⚑ **`EXT-010` §2.1 took the other two away from this stack**, and `031`'s rule is the reason
    // the PO gave in different words: *"a line that is always on is a line nobody reads."* The
    // credential explanation and the setting's bound are one press each now, under
    // `launcher-why-credential` and `launcher-why-approval`; what stays is the one sentence about a
    // decision this screen makes permanently and silently, which is the one a person cannot check
    // any other way.
    expect(notes, 'the note stack, in order').toEqual(['provider-is-fixed'])
    // ⛔ **And the openers are there**, so this is *folded* rather than *deleted* — the same
    // distinction {@link STATES}' last two rows draw against the column's whole vocabulary.
    expect(m.all('launcher-why-credential')).toHaveLength(1)
    expect(m.all('launcher-why-approval')).toHaveLength(1)
  })

  it('⚑ …so 031 still holds: ONE always-on line, and the fold holds the bulk', async () => {
    await page.viewport(REAL.width, REAL.height)
    const { m } = open()
    await nextTick()
    const notes = [...m.host.querySelectorAll('.note')].map((el) => el.getAttribute('data-cy'))
    expect(notes, '031: a line that is always on is a line nobody reads').toEqual([
      'provider-is-fixed',
    ])
    // 🔴 **579 · the measurement, and it is the whole of `EXT-010` §2.1.** ⛔ In the state a person
    // actually meets — a provider resolved, a catalogue that answered, nothing typed — the screen
    // held THREE paragraphs of standing prose and now holds one. ⚠️ **Asserted as a character
    // count over the notes that are on screen**, not as a list of names, because the claim the PO
    // made is about how much there is to read and a list of names cannot go red when a sentence
    // doubles in length.
    const ink = notes
      .map((cy) => (m.q(cy as string).textContent ?? '').trim().length)
      .reduce((a, b) => a + b, 0)
    expect(ink, 'one sentence, and the openers are not sentences').toBeLessThan(200)
    // ⚑ **The paired positive**: the words behind the presses really are the long ones, so the
    // number above is a fold and not a deletion.
    ;(m.q('launcher-why-credential') as HTMLButtonElement).click()
    ;(m.q('launcher-why-approval') as HTMLButtonElement).click()
    await nextTick()
    const folded =
      (m.q('profile-credential').textContent ?? '').trim().length +
      (m.q('launch-approval-bound').textContent ?? '').trim().length
    expect(
      folded,
      'the fold is holding the bulk of what a person used to have to pass',
    ).toBeGreaterThan(ink * 2)
  })
})

describe('§4 · 367’s disclosure is not deleted by the simplification', () => {
  /**
   * 🔴 **REWRITTEN AT `500`, and the rewrite is the disclosure surviving rather than being deleted.**
   *
   * ⛔ This read *"the launcher no longer arms yolo, so it no longer needs to disclose it"* — true
   * from `417` until `HO-036` §3.1, which gives the launcher a mode again. ⚑ **`367`'s disclosure
   * is unchanged**: the same constant, the same adapter-owned second half, the same pairing rule.
   * What moved is WHEN this screen owes it, and the answer is *exactly when the launch will use it*.
   *
   * ⚠️ **The checkbox stays gone.** `auto-approve` is still in {@link STILL_GONE}: the mode is not
   * a per-launch choice here, it is a SETTING, and the difference is what `launch-approval-bound`
   * says in words.
   */
  it('⛔ the launcher discloses yolo exactly when the launch will use it, and never arms it per launch', async () => {
    await page.viewport(REAL.width, REAL.height)
    // 1 · the person has not turned it on — nothing to disclose, and the paired positive is the
    //     control itself, so this is not a test satisfied by a surface that rendered nothing.
    const asking = open({ defaultApprovalMode: 'ask' })
    await nextTick()
    expect(asking.m.q('launch-approval-mode').dataset.mode).toBe('ask')
    expect(asking.m.host.querySelector('[data-cy="yolo-means"]')).toBeNull()
    expect(asking.m.host.querySelector('[data-cy="yolo-reach"]')).toBeNull()
    asking.m.unmount()

    // 2 · they did, once — both halves, and they are the bytes the drawer renders.
    const yolo = open({ defaultApprovalMode: 'auto' })
    await nextTick()
    expect(yolo.m.q('yolo-means').textContent ?? '').toContain(YOLO_MEANS)
    // ⚠️ **Held in a const, so the narrowing survives the read** — two calls are two values to the
    // typechecker, and `note` lives only on the `available` arm.
    const approvals = allProviderCapabilities().codex.approvals
    expect(approvals.state).toBe('available')
    expect(yolo.m.q('yolo-reach').textContent?.trim()).toBe(
      approvals.state === 'available' ? (approvals.note ?? '') : '',
    )
    // ⛔ **And the checkbox is still gone in the state that would have wanted it most.**
    expect(yolo.m.host.querySelector('[data-cy="auto-approve"]')).toBeNull()
    yolo.m.unmount()
  })

  it('⚑ the credential line — 329’s "before, not after" — is behind a press and still BEFORE', async () => {
    await page.viewport(REAL.width, REAL.height)
    const { m } = open()
    await nextTick()
    // ⛔ **`329`'s rule was *before the choice, not after*** — its defect was a credential sentence
    // that only appeared once `SignInPanel` did, which is after a launch had already failed.
    // ⚑ **A press is still before the choice**: nothing has started, and the opener naming the
    // subject is on screen from the first frame.
    expect(m.all('profile-credential'), 'it is folded, not standing').toEqual([])
    const opener = m.q('launcher-why-credential')
    expect(visible(opener)).toBe(true)
    expect(opener.getAttribute('aria-expanded')).toBe('false')
    // ⚠️ **The opener names its own subject**, which is what makes the fold honest rather than a
    // place to hide something — two folds on one column and *what this is* would name neither.
    expect((opener.textContent ?? '').toLowerCase()).toContain('sign-in')
    ;(opener as HTMLButtonElement).click()
    await nextTick()
    expect(opener.getAttribute('aria-expanded')).toBe('true')
    const line = m.q('profile-credential')
    expect(visible(line)).toBe(true)
    expect((line.textContent ?? '').trim()).not.toBe('')
    // The adapter's own words, never this repo's: `copies` is the one bit a test can assert
    // without comparing a string to the constant it was built from.
    expect(line.getAttribute('data-copies')).toBe('yes')
    // ⛔ **And it closes again**, so `aria-expanded` is reporting a state rather than a constant.
    ;(opener as HTMLButtonElement).click()
    await nextTick()
    expect(m.all('profile-credential')).toEqual([])
    expect(opener.getAttribute('aria-expanded')).toBe('false')
  })
})
