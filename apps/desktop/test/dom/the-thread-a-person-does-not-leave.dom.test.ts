import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import AgentInstructionsSheet from '../../src/renderer/src/components/AgentInstructionsSheet.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import {
  ROLE_SIZE,
  SUBJECTS,
  SUBJECT_WORDS,
  WHOSE_FACT,
  factOf,
  type Subject,
} from '../../src/renderer/src/lib/what-survives-the-conversation'
import {
  applyEvent,
  createTranscript,
  type TranscriptState,
} from '../../src/renderer/src/lib/transcript'
import type { CreatedSession, TranscriptEvent } from '../../src/shared/runtime-ipc'
import {
  META,
  contrast,
  drawerProps,
  mount,
  paneProps,
  paintedInk,
  parseColor,
  record,
  unmountAll,
  visible,
  type Mounted,
} from './harness'

/**
 * 🔴 **527 · close the conversation and see what is left.**
 *
 * ## ⛔ The two rails this file exists to make assertions rather than conventions
 *
 * `HO-050` §1.1 ruled the subject question, and it ruled it as a TEST a person can apply:
 *
 * > ⚑ **"Close the conversation. What goes with it was the session's; what remains was the
 * > agent's."**
 *
 * ⛔ **"The index may list both. The surfaces may not mix them."**
 * ⛔ **"What must not happen is one sheet headed with a fact from each."**
 *
 * ⚠️ **A rail stated in a docblock is a comment** (standing rule 5), and this one had already been
 * broken twice by surfaces that were each individually sensible — `SessionInfo` grew a working
 * directory four rows above an agent's memory without any dispatch deciding to. So §2 below walks
 * every element that carries a fact and asks which subject HEADS it, per element and in both
 * directions: `a-file-level-contains-cannot-tell-sibling-declarations-apart`.
 *
 * ## ⚑ …and the half the PO added, which is about not losing the thread
 *
 * > ⚠️ **"A person reading a transcript who has to leave it to find out what the agent was told
 * > has lost the thread."** ⚑ **"An index entry that opens wide satisfies both; a separate screen
 * > he has to navigate to does not."**
 *
 * ⛔ **That is a claim about the DOM, so §4 mounts the real pane and presses the real entry.** A
 * sheet that unmounted the transcript, or a route that replaced the pane, would pass every
 * assertion in §1–§3 and fail the ruling.
 *
 * ## ⚠️ In the DOM project, and there is no SSR version of any of this
 *
 * `visible()` needs layout, the sizes are what the ENGINE resolved rather than what a stylesheet
 * says, and *"the transcript is still there"* is a statement about two layers of a real one. ⛔ The
 * viewport is shared across this directory, so nothing here resizes it.
 */

/* ------------------------------------------------------------------------------- the fixture */

const COMPOSED = [
  '# BroBot',
  '',
  'You are the project manager for this workspace. Answer in short sentences.',
].join('\n')

/**
 * ⚑ **Populated on purpose**, because the shared `drawerProps` renders empty instructions — which
 * is the right default everywhere else and would make every check here run over nothing.
 */
const INFO: CreatedSession = {
  ...META,
  // ⚑ **What the provider reports it is RUNNING** (081) — a `v-for`, so the roster matches it as a
  // family. ⛔ Populated here because the shared fixture leaves it absent, and an entry the walk
  // never meets is an entry that has stopped describing the app.
  liveness: { ...META.liveness, agent: [{ label: 'model', value: 'claude-opus-5' }] },
  config: {
    ...META.config,
    files: [
      {
        name: 'auth.json',
        path: '/homes/claude/auth.json',
        exists: true,
        note: 'the credential this profile signs in with',
      },
    ],
  },
  instructions: {
    ...META.instructions,
    injected: [
      {
        kind: 'workspace-instructions',
        path: '/work/checkout/CLAUDE.md',
        text: 'Use conventional commits.',
        bytes: 1240,
        truncated: false,
      },
    ],
    agentMemory: [
      {
        kind: 'agent-memory',
        path: '/homes/claude/memory/MEMORY.md',
        text: '- the user prefers short answers',
        bytes: 2310,
        truncated: false,
        reach: 'prompt',
      },
    ],
    provider: [{ path: '/work/checkout/AGENTS.md', scope: 'project' }],
    refused: [{ path: '/work/checkout/.claude/link.md', reason: 'dangling-link' }],
    note: 'read at launch; searched 2 directories',
    recallsReported: true,
    writesReported: true,
    composed: COMPOSED,
  },
  // ⛔ **529 · the two facts `HO-050` §1.2 sent to this surface, populated for the same reason
  // everything above is.** Both rows are `sometimes` in the roster — an ordinary conversation has
  // granted nothing and has no other caller — and *an entry the walk never meets is an entry that
  // has stopped describing the app*.
  blanketGrants: ['Bash', 'Write'],
  hasACommander: true,
}

/**
 * ⚑ **739 · what *Always allow* kept in this conversation, populated for the same reason** — the
 * drawer's control projection (`state`) holding one Claude card answered `allow_always`, whose rule
 * and file the Info index draws as the AGENT's (`info-kept`, `info-note-kept`: `736` F-1, *"disclose
 * kept grants apart from conversation grants"*). ⚠️ The shared `drawerProps` state is empty, and a
 * roster line the walk never meets is a line that has stopped describing the app. ⚑ A kept rule with
 * CONTENT (`Bash(make build *)`, `740`'s MEASURED card — kept in the project's
 * `.claude/settings.local.json`, R99; an `rm` is offered no *Always allow* since `740`) is listed under
 * no `blanketGrants` name, so `info-grants` still draws `Bash · Write` beside it.
 */
function keptHere(): TranscriptState {
  const state = createTranscript()
  const rule = { kind: 'tool' as const, tool: 'Bash', content: 'make build *' }
  applyEvent(state, {
    type: 'permission_request',
    id: 'req_kept',
    kind: 'command',
    action: 'Bash',
    detail: 'make build',
    scope: {
      cwd: '/work/checkout',
      paths: [],
      networkHosts: [],
      persistence: 'always',
      grants: {
        allow_for_session: [rule],
        allow_all_for_session: [{ kind: 'tool', tool: 'Bash' }],
        allow_always: [rule],
        alwaysFile: '/work/checkout/.claude/settings.local.json',
      },
      amendments: [],
      availableDecisions: [
        'allow',
        'allow_for_session',
        'allow_all_for_session',
        'allow_always',
        'deny',
        'cancel',
      ],
      underDisclosed: true,
    },
  } as TranscriptEvent)
  applyEvent(state, {
    type: 'user_decision',
    requestId: 'req_kept',
    outcome: 'allow_always',
    by: { who: 'a-person' },
  } as TranscriptEvent)
  return state
}

const ASKED = {
  onReadInstruction: async () => ({ ok: false as const, reason: 'gone' as const }),
  onRevealPath: async () => ({ ok: false as const, reason: 'gone' as const }),
}

/* ------------------------------------------------------------------------------ the instruments */

const px = (el: Element): number => Number.parseFloat(getComputedStyle(el).fontSize)

/** Direct text only, so a wrapper is not counted again for the words inside its child. */
const ownsText = (el: Element): boolean =>
  [...el.childNodes].some(
    (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
  )

const textBearing = (root: HTMLElement): HTMLElement[] =>
  [root, ...root.querySelectorAll<HTMLElement>('*')].filter((el) => ownsText(el) && visible(el))

/** The root itself, so a walk includes it rather than only its descendants. */
const root = (el: HTMLElement): HTMLElement => el

/** Every element carrying a `data-cy`, visible, inside `root` — the addresses a fact can have. */
const hooked = (root: HTMLElement): HTMLElement[] =>
  [root, ...root.querySelectorAll<HTMLElement>('[data-cy]')].filter(
    (el) => el.dataset.cy !== undefined && visible(el),
  )

/**
 * ⛔ **The token, resolved by the engine, in the place the element sits** — `526`'s probe. A
 * planted `<span>` takes the same cascade and the same used-value rounding the subject took, so
 * the comparison is engine-to-engine rather than against a number typed twice.
 */
/** The same probe, for a face — `getPropertyValue` returns the authored token, not a computed one. */
function tokenFace(token: string, beside: Element): string {
  const probe = document.createElement('span')
  probe.style.fontFamily = `var(${token})`
  ;(beside.parentElement ?? document.body).append(probe)
  const resolved = getComputedStyle(probe).fontFamily
  probe.remove()
  expect(resolved, `${token} resolved to nothing`).not.toBe('')
  return resolved
}

function tokenPx(token: string, beside: Element): number {
  const probe = document.createElement('span')
  probe.style.fontSize = `var(${token})`
  ;(beside.parentElement ?? document.body).append(probe)
  const resolved = Number.parseFloat(getComputedStyle(probe).fontSize)
  probe.remove()
  expect(resolved, `${token} resolved to nothing`).toBeGreaterThan(0)
  return resolved
}

/**
 * ⛔ **Elements that carry a `data-cy` and own text and are deliberately NOT facts**, each with the
 * reason — `a-guard-that-only-a-live-run-can-trip-is-dark-by-default`'s companion rule: an
 * exemption that is not named is a gap.
 */
const NOT_A_FACT: Record<string, string> = {
  // ⚠️ **Its subject is POSITIONAL, and that is why it cannot be rostered.** One hook, drawn inside
  // whichever row was pressed — the conversation's `cwd` or the agent's `home` or `config` — so a
  // single subject on it would be wrong on two of the three. ⚑ The walk still holds it: §2 requires
  // every fact to sit inside exactly one `[data-subject]`, and this one inherits its row's.
  'info-refusal':
    'a per-row refusal, drawn inside whichever row was pressed — its subject is the row’s',
  // ⚠️ The file row's own wrapper: a path and its Finder button, and the *not present* sentence for
  // a file that is absent. It is inside the agent group like everything around it.
  'config-file-': 'the wrapper for one file in the home — the row, not a fact of its own',
}

/** Open every disclosure on the index, so the three notes are on screen to be measured. */
async function openEveryFold(body: HTMLElement): Promise<void> {
  for (const b of body.querySelectorAll<HTMLElement>('[data-cy^="info-why-"]')) b.click()
  await nextTick()
}

/** The subject of the nearest surface that HEADS this element, or null if nothing does. */
const headedBy = (el: Element): Subject | null =>
  (el.closest('[data-subject]') as HTMLElement | null)?.dataset.subject as Subject | null

/**
 * ⚑ **583, relay 2 · "only ONE tab is in the DOM at a time."**
 *
 * ⛔ **Every walk in §2 and §5 below used to read one static mount** — `AgentInstructionsSheet`
 * drew all five `told.layers`, the compiled bundle and the provider/refused lists in one flowing
 * document, so a query against the whole subtree saw everything the sheet could ever show. `583`
 * regrouped that document into a tab strip where `showing`/`current` gate a `v-if`/`v-else-if`/
 * `v-else`, so a query against one static mount now sees exactly ONE owner's rows — a fact that
 * moved to a tab nobody pressed is a fact these walks would silently stop seeing.
 *
 * ⚠️ **So the walk presses, rather than reads.** `walkEveryToldTab` visits every `told-tab-<key>`
 * in turn, opens every `told-block-toggle` it finds there (the `as sent` tab needs no press: its
 * account layer is open by construction), and calls back once per stop — which is the same
 * `openEveryFold` idea one surface over, aimed at a strip instead of a list of discloures.
 */
async function pressTold(view: Mounted, key: string): Promise<void> {
  view.q(`told-tab-${key}`).click()
  await nextTick()
}

/** Open every closed block on whichever tab is on screen right now. */
async function openEveryToldBlock(host: HTMLElement): Promise<void> {
  for (const b of host.querySelectorAll<HTMLElement>('[data-cy="told-block-toggle"]')) b.click()
  await nextTick()
}

/**
 * Press every tab of the instructions sheet in turn, opening every block each one draws, and call
 * `visit` once per stop — so a walk that used to run over one mount now runs over every state the
 * tab strip can be in.
 */
async function walkEveryToldTab(view: Mounted, visit: () => void): Promise<void> {
  const keys = [...view.host.querySelectorAll<HTMLElement>('[data-cy^="told-tab-"]')].map((b) =>
    b.dataset.cy!.slice('told-tab-'.length),
  )
  for (const key of keys) {
    await pressTold(view, key)
    await openEveryToldBlock(view.host)
    visit()
  }
}

function info(over: Record<string, unknown> = {}) {
  return mount(
    SessionDrawer,
    drawerProps({ tab: 'info', session: INFO, state: keptHere(), ...ASKED, ...over }),
    { width: 380, height: 900 },
  )
}

function pane(over: Record<string, unknown> = {}) {
  const held = record([{ type: 'user_turn', text: 'what were you told?' } as TranscriptEvent])
  held.meta = INFO
  return mount(
    ConversationPane,
    paneProps({ record: held, drawerOpen: true, drawerTab: 'info', ...ASKED, ...over }),
    { width: 1200, height: 800 },
  )
}

afterEach(unmountAll)

/* ------------------------------------------------------------- §1 · the grouping is the teaching */

describe('§1 · the index is two headed groups, and the heading says what the lifetime IS', () => {
  it('🔴 draws both subjects, each with the sentence that teaches the split', () => {
    const view = info()
    for (const subject of SUBJECTS) {
      const group = view.q(`session-subject-${subject}`)
      expect(group.dataset.subject, `${subject}'s group does not declare its subject`).toBe(subject)
      expect(group.textContent, `${subject}'s group is not headed`).toContain(
        SUBJECT_WORDS[subject].title,
      )
      // ⚑ **The PO's own sentence, drawn.** *"The grouping in the index is where the distinction
      // gets taught"* — a group headed with a word and nothing else teaches a vocabulary, not a
      // rule, and the reader would have to be taught the word first.
      expect(group.textContent, `${subject}'s group states no lifetime`).toContain(
        SUBJECT_WORDS[subject].says,
      )
    }
  })

  it('⛔ the two sentences are DIFFERENT, so the grouping distinguishes something', () => {
    // `an-enumeration-whose-members-must-differ-needs-a-distinctness-check`: two groups headed
    // with one sentence would satisfy every assertion above and teach nothing at all.
    expect(SUBJECT_WORDS.conversation.says).not.toBe(SUBJECT_WORDS.agent.says)
    expect(SUBJECT_WORDS.conversation.title).not.toBe(SUBJECT_WORDS.agent.title)
  })
})

/* ------------------------------------------------- §2 · no surface is headed with a fact from each */

describe('§2 · every fact on the index is under the subject the ruling gives it', () => {
  it('🔴 per element, and a fact under the wrong head is named', () => {
    const view = info()
    const body = view.host.querySelector<HTMLElement>('.drawer-body')!
    const wrong: string[] = []
    const unheaded: string[] = []
    let checked = 0
    for (const el of hooked(body)) {
      const entry = factOf(el.dataset.cy!)
      if (entry === null) continue
      checked += 1
      const head = headedBy(el)
      if (head === null) unheaded.push(el.dataset.cy!)
      else if (head !== entry.subject)
        wrong.push(`${el.dataset.cy}: the ruling says ${entry.subject}, the surface says ${head}`)
    }
    // ⛔ Non-vacuity, first: a walk that classified nothing satisfies both lists below.
    expect(checked, 'no rostered fact was on screen at all').toBeGreaterThan(5)
    expect(unheaded, 'a fact is drawn on a surface that declares no subject').toEqual([])
    expect(wrong, 'a surface is headed with a fact from the other side').toEqual([])
  })

  it('⚑ …and the roster has no line describing something this app stops drawing', async () => {
    // ⛔ **The other direction.** An entry nothing draws is a classification that has quietly
    // stopped being about the app — the shape `525` F8 found in the design map, one artefact over.
    const view = info()
    const body = view.host.querySelector<HTMLElement>('.drawer-body')!
    for (const button of body.querySelectorAll<HTMLElement>('[data-cy^="info-why-"]')) {
      button.click()
    }
    await nextTick()
    const drawn = new Set(hooked(body).map((el) => el.dataset.cy!))
    const dead = WHOSE_FACT.filter(
      (entry) =>
        ![...drawn].some((cy) =>
          entry.cy.endsWith('-') ? cy.startsWith(entry.cy) : cy === entry.cy,
        ),
    ).map((entry) => entry.cy)
    expect(dead, 'the roster classifies a fact the index no longer draws').toEqual([])
  })

  /**
   * 🔴 **529 relay 1 · the two facts `HO-050` §1.2 sent here, named rather than swept.**
   *
   * ⛔ **The loops above would pass if these had landed under the agent** — they check whatever is
   * in the roster against whatever heads it, and a wrong roster line is consistent with a wrong
   * surface. ⚑ So the subject is asserted from the RULING rather than from the roster: a blanket
   * grant is a set inside the adapter whose own sentence says *"one allowed for this conversation
   * ends when it is closed"* (`HOW_THESE_GRANTS_END` since `739`; what *Always allow* KEPT here is the
   * agent's row, `info-kept`), and a commander is `SessionSlot.commandedBy`, fixed at reservation and
   * gone with the slot. **Close the conversation and both go with it.**
   */
  it('🔴 the grants and the commander are the CONVERSATION’s, and they are drawn there', () => {
    const view = info()
    for (const cy of ['info-grants', 'info-has-a-commander']) {
      const el = view.q(cy)
      expect(visible(el), `${cy} did not draw on the populated fixture`).toBe(true)
      expect(headedBy(el), `${cy} is not under the conversation`).toBe('conversation')
      // ⛔ …and the roster agrees with the ruling, which is the half a wrong line would break.
      expect(factOf(cy)?.subject, `${cy} is classified as the agent's`).toBe('conversation')
    }
    // ⚠️ **And neither is inside the agent's group**, which the walk above cannot say on its own:
    // `closest` finds the nearest head, so a fact nested in BOTH would report the inner one.
    const agent = view.q('session-subject-agent')
    for (const cy of ['info-grants', 'info-has-a-commander']) {
      expect(
        agent.querySelector(`[data-cy="${cy}"]`),
        `${cy} is inside the agent's group`,
      ).toBeNull()
    }
  })

  it('⛔ the WIDE surface is headed by one subject, and carries no fact from the other', async () => {
    const view = pane()
    view.q('told-index').click()
    await nextTick()

    const sheet = view.q('agent-sheet')
    expect(sheet.dataset.subject, 'the sheet declares no subject').toBe('agent')

    // ⚑ **Measured by exclusion, and paired** (`193`): every conversation-side hook is asserted
    // ABSENT from the sheet and PRESENT on the index at the same moment, so the absence is about
    // the sheet rather than about a mount that drew nothing. The pairing itself reads the index,
    // which no tab touches, so it is computed once — only the sheet side of the check has to be
    // re-asked per tab, below.
    const onTheIndex = view.q('session-info')
    const conversationFacts = WHOSE_FACT.filter((one) => one.subject === 'conversation')
      .map((entry) => ({
        entry,
        selector: entry.cy.endsWith('-') ? `[data-cy^="${entry.cy}"]` : `[data-cy="${entry.cy}"]`,
      }))
      .filter(({ selector }) => onTheIndex.querySelector(selector) !== null)
    expect(
      conversationFacts.length,
      'no conversation fact was on the index to pair the absence with',
    ).toBeGreaterThan(2)

    // ⚑ **583 relay 2 · re-asked on every tab, not on one static mount.** Before the tab strip
    // this sheet was one flowing document and a single query saw everything it could ever draw; a
    // conversation fact that leaked onto the SECOND or THIRD tab would have passed a check that
    // only ever looked at the mount as it first rendered. `walkEveryToldTab` presses each tab (and
    // opens what it finds) so the absence holds at every stop, not only at the landing one.
    await walkEveryToldTab(view, () => {
      for (const { entry, selector } of conversationFacts) {
        expect(
          sheet.querySelector(selector),
          `${entry.cy} is the conversation's and it is inside the agent's sheet`,
        ).toBeNull()
      }
    })

    // For the paired positive, press `as sent` and verify the sheet draws the agent’s
    // composed prompt. It is not visible on the landing tab.
    await pressTold(view, 'as-sent')
    expect(sheet.querySelector('[data-cy="told-composition"]')).not.toBeNull()
    expect(sheet.querySelector('[data-cy="session-instructions"]')).not.toBeNull()
  })
})

/* ------------------------------------------------------------- §3 · the sizes the ruling paid for */

describe('§3 · the index reads at the floor, and its prose reads above it', () => {
  it('🔴 nothing on the index is under the 12 px floor, and the group headings are uppercase', () => {
    const view = info()
    const body = view.host.querySelector<HTMLElement>('.drawer-body')!
    const under = textBearing(body)
      .filter((el) => px(el) < 12)
      .map((el) => `${el.dataset.cy ?? el.className}@${px(el)}`)
    expect(under, 'text under the 12 px floor').toEqual([])
    // The headings share the rows' size and are told apart by being uppercase labels.
    const headings = [...body.querySelectorAll<HTMLElement>('.group-title')]
    expect(headings, 'the two group headings did not draw').toHaveLength(2)
    for (const el of headings) {
      expect(px(el)).toBe(tokenPx(ROLE_SIZE.heading, body))
      expect(getComputedStyle(el).textTransform).toBe('uppercase')
    }
  })

  it('🔴 every rostered fact is at the size its ROLE names — per element, in the engine', async () => {
    // ⛔ **The half that makes `role` load-bearing rather than documentation.** The roster answers
    // two questions about one element — whose fact it is, and what kind of text it carries — and a
    // field nothing reads is a field that drifts. ⚑ **The token is resolved by the ENGINE beside
    // the subject**, not compared against a number typed twice (`526`).
    const view = info()
    const body = view.host.querySelector<HTMLElement>('.drawer-body')!
    // ⛔ **The folds open, or the three notes are not on screen and the rule runs over the rows
    // that were never the defect.** `525` Q5 measured the prose, not the paths.
    await openEveryFold(body)
    const wrong: string[] = []
    let checked = 0
    for (const el of hooked(body)) {
      const entry = factOf(el.dataset.cy!)
      if (entry === null) continue
      checked += 1
      const wanted = tokenPx(ROLE_SIZE[entry.role], el)
      if (px(el) !== wanted)
        wrong.push(`${el.dataset.cy}: ${entry.role} is ${wanted}px, the element is ${px(el)}px`)
    }
    expect(checked, 'no rostered fact was on screen at all').toBeGreaterThan(8)
    expect(wrong, 'a fact is drawn at a size its role does not name').toEqual([])
  })

  it('🔴 …and no role drifts below the CONTRACT, which is a sentence and not a token', () => {
    // ⛔ **`526 M25`'s lesson, applied to this roster before it could cost anything.** Every
    // assertion above resolves `ROLE_SIZE` to decide what `ROLE_SIZE` should be, so moving a whole
    // role would satisfy all of them at once — *a true mutation measures nothing*.
    // The contract is typed here, not read from the tokens: every role is at least the 12 px floor
    // and no larger than the 15 px reading size, so a token that slid down is red here.
    const view = info()
    const body = view.host.querySelector<HTMLElement>('.drawer-body')!
    for (const [role, token] of Object.entries(ROLE_SIZE)) {
      const size = tokenPx(token, body)
      expect(size, `${role} is below the 12 px floor`).toBeGreaterThanOrEqual(12)
      expect(size, `${role} is above the reading size`).toBeLessThanOrEqual(15)
    }
  })

  it('⛔ …and every fact-bearing element on the index is classified, or named as not a fact', async () => {
    // 🔴 **The completeness direction, and without it the walk above is a SAMPLE.** `factOf`
    // answering `null` makes an element invisible to every rule in this file, so a fact that fell
    // out of the roster — or one added to the template and never classified — would be waved
    // through. ⚑ `526`'s roster half, one surface over: *without it a roster is an inventory that
    // has never been counted.*
    const view = info()
    const body = view.host.querySelector<HTMLElement>('.drawer-body')!
    await openEveryFold(body)
    // ⛔ **The refusal has to be DRAWN**, or the exemption below is an entry for something this
    // surface cannot produce. The fixture's reveal answers `gone`, which is the state a file
    // removed after the session read it really is in.
    view.q('info-reveal-cwd').click()
    await nextTick()
    await nextTick()
    const loose = hooked(body)
      .filter((el) => ownsText(el) && visible(el))
      .filter((el) => el.tagName !== 'BUTTON')
      .filter((el) => factOf(el.dataset.cy!) === null)
      .filter((el) => !(el.dataset.cy! in NOT_A_FACT))
      .map((el) => el.dataset.cy!)
    expect(loose, 'a fact on the index that no line classifies').toEqual([])
    // ⛔ …and the exemption has to keep earning itself: an entry nothing can draw is a line that
    // has stopped describing this surface.
    for (const cy of Object.keys(NOT_A_FACT))
      expect(
        view.host.querySelector(`[data-cy="${cy}"], [data-cy^="${cy}"]`),
        `${cy} is exempt from a census it is not in`,
      ).not.toBeNull()
  })

  it('⚑ …and the roles really are a SCALE — no two of them collapse into one size', () => {
    // ⛔ **`a-positive-assertion-must-differ-from-the-default`.** If every role resolved to the same
    // number the assertion above would hold over a stylesheet with no hierarchy at all. ⚠️ `label`
    // and `value` are the one deliberate pair, and the module says why.
    const view = info()
    const body = view.host.querySelector<HTMLElement>('.drawer-body')!
    const sizes = Object.fromEntries(
      Object.entries(ROLE_SIZE).map(([role, token]) => [role, tokenPx(token, body)]),
    )
    expect(sizes.label).toBe(sizes.value)
    // The headings share the rows' size; being uppercase is what sets them apart.
    expect(sizes.heading).toBe(sizes.label)
    expect(sizes.label).toBeLessThan(sizes.prose!)
    expect(sizes.prose).toBeLessThan(sizes.entry!)
  })

  it('⚑ the sentence that teaches the split is prose-sized, not label-sized', () => {
    const view = info()
    const body = view.host.querySelector<HTMLElement>('.drawer-body')!
    const prose = tokenPx(ROLE_SIZE.prose, body)
    for (const subject of SUBJECTS) {
      const says = view.q(`session-subject-${subject}`).querySelector<HTMLElement>('.group-says')!
      expect(px(says), `${subject}'s teaching line is not at the prose size`).toBe(prose)
    }
    // ⛔ The pair: prose really is a step above the floor, so the assertion above is about
    // something. A token file where the two collapsed would make it vacuous.
    expect(prose).toBeGreaterThan(tokenPx(ROLE_SIZE.label, body))
  })
})

/* ------------------------------------------ §4 · it opens wide, and the thread is never left */

describe('§4 · the entry opens wide over a transcript that stays where it was', () => {
  it('🔴 the pane, the transcript and the drawer are all still mounted under the sheet', async () => {
    const view = pane()
    const before = view.q('reading-surface')
    expect(view.all('agent-sheet'), 'the sheet is open before anything was pressed').toHaveLength(0)

    view.q('told-index').click()
    await nextTick()

    expect(view.all('agent-sheet'), 'the entry opened nothing').toHaveLength(1)
    // ⛔ **The ruling, as four elements.** *"A separate screen he has to navigate to does not."*
    expect(view.all('conversation-pane'), 'the pane unmounted').toHaveLength(1)
    expect(view.q('reading-surface'), 'the transcript is a different element').toBe(before)
    expect(view.q('reading-surface').textContent).toContain('what were you told?')
    expect(view.all('session-info'), 'the drawer left the Info tab').toHaveLength(1)
  })

  it('⛔ it is a modal LAYER rather than a route — the host is the app’s own, with its stop', async () => {
    const view = pane()
    view.q('told-index').click()
    await nextTick()
    const host = view.q('overlay-host')
    expect(host.getAttribute('aria-modal'), 'the sheet is not a dialog').toBe('true')
    expect(host.getAttribute('role')).toBe('dialog')
    // ⛔ **The sheet is INSIDE the app's own host rather than beside it**, which is what makes it
    // carry the layer's chrome — Escape, the backdrop, the focus trap, and the emergency stop
    // `OverlayHost` draws for every sheet in the app (`390`).
    expect(host.contains(view.q('agent-sheet'))).toBe(true)
    // ⚑ **Whether that stop is REACHABLE with this panel in front of it is a different question**,
    // and it is asked where it is asked of every other sheet: `a-stop-a-modal-cannot-cover`'s §2,
    // which needs the spawn-safety read seeded and gained an `AgentInstructionsSheet` row in this
    // dispatch. ⛔ Asserting it here with no seed would draw no stop at all and pass on an
    // absence — the shape `193` is about.
  })

  it('⚑ closing it puts the reader back on the entry that opened it', async () => {
    const view = pane()
    const entry = view.q('told-index')
    entry.focus()
    entry.click()
    await nextTick()
    expect(view.q('agent-sheet')).not.toBeNull()

    view.q('close-overlay').click()
    await nextTick()
    expect(view.all('agent-sheet'), 'the sheet did not close').toHaveLength(0)
    // ⛔ **Focus is given back by `OverlayHost`'s own `onUnmounted`** — the reader is standing
    // where they were, which is the other half of not losing the thread.
    expect(document.activeElement, 'focus was left on the body').toBe(view.q('told-index'))
  })

  it('⚠️ a second conversation never inherits the first one’s open sheet', async () => {
    // ⛔ **`067`'s guard, and it has to be measured on ONE mount.** `RuntimeScreen` renders
    // `ConversationPane` without a `:key`, so switching conversation SWAPS the record in place —
    // and a test that unmounted and mounted a fresh pane would be asserting that a new component
    // starts with its own state, which is true of every component and proves nothing.
    // ⚑ The id rides the value, so one conversation's composed instructions can never float over
    // another's transcript.
    const held = ref(
      record([{ type: 'user_turn', text: 'what were you told?' } as TranscriptEvent]),
    )
    held.value.meta = INFO
    const view = mount(
      defineComponent({
        setup() {
          return () =>
            h(ConversationPane as never, {
              ...paneProps({ record: held.value, drawerOpen: true, drawerTab: 'info', ...ASKED }),
            })
        },
      }),
      {},
      { width: 1200, height: 800 },
    )
    view.q('told-index').click()
    await nextTick()
    expect(view.all('agent-sheet'), 'the entry opened nothing').toHaveLength(1)

    // ⛔ **The RECORD's id, which is what the guard reads** — `createSessionRecord` mints it and
    // `meta.sessionId` is the host's echo of the same fact. A fixture that moved only the echo
    // would leave the two halves disagreeing and this test passing for the wrong reason.
    const other = record(
      [{ type: 'user_turn', text: 'a different thread' } as TranscriptEvent],
      'sess_2',
    )
    other.meta = { ...INFO, sessionId: 'sess_2' }
    held.value = other
    await nextTick()
    await nextTick()

    expect(
      view.all('agent-sheet'),
      'the previous conversation’s instructions are over this one’s transcript',
    ).toHaveLength(0)
    // …and the pane really swapped, so this is a guard rather than an unmount.
    expect(view.q('reading-surface').textContent).toContain('a different thread')
  })
})

/* ------------------------------------------- §5 · the block chooses its own face and its own scale */

describe('§5 · independently mountable means it brings its own typography', () => {
  it('🔴 the block sets a reading size on its own root — it does not inherit one', () => {
    // ⛔ **`525`'s named refactor cost, as an assertion.** It emitted `<dt>`/`<dd>` fragments into
    // `SessionInfo`'s `<dl>` and took that component's mono 8.5 px root, which is why every
    // sentence in it was a micro-label. ⚑ A root that declares nothing would render at whatever
    // mounted it — the defect, exactly — so this asks the ENGINE what the block came out at inside
    // a sheet that sets no size of its own.
    // ⛔ **Mounted inside the trap the defect really was** — a mono `--text-4xs` box, which is
    // `SessionInfo`'s own root and what this block inherited for four dispatches
    // (`a-control-must-be-trapped-the-way-the-subject-is`). A mount into a bare div would inherit
    // the app's body default, which happens to BE the reading size, and the assertion would hold
    // over a component that declares nothing at all.
    const view = mount(
      defineComponent({
        setup() {
          return () =>
            h('div', { style: 'font-family: var(--font-mono); font-size: var(--text-4xs)' }, [
              h(AgentInstructionsSheet as never, {
                instructions: INFO.instructions,
                relaunched: false,
                ...ASKED,
              }),
            ])
        },
      }),
      {},
      { width: 1200, height: 900 },
    )
    const block = view.q('agent-instructions')
    // ⚑ The trap really is one: the box around the sheet is at the size this block used to take.
    const trap = view.host.firstElementChild!
    expect(px(trap), 'the trap does not hold the old size').toBe(tokenPx('--text-4xs', block))
    expect(px(block), 'the block took the size of whatever mounted it').toBe(
      tokenPx('--text-base', block),
    )
    expect(getComputedStyle(block).fontFamily).toBe(tokenFace('--font-sans', block))
  })

  it('🔴 …and it heads ITSELF, so it cannot be dropped into a mixed surface unnoticed', async () => {
    // ⛔ **Two surfaces declare `agent`, and both have to.** The sheet is what a person opens; the
    // block is what a test — or a future surface — mounts on its own. ⚠️ A block that relied on its
    // host to declare the subject would carry the ruling only as far as the host it happens to
    // have, and `HO-050` §1.1's rail is about the element that HEADS a surface.
    const view = mount(
      AgentInstructionsSheet,
      { instructions: INFO.instructions, relaunched: false, ...ASKED },
      { width: 1200, height: 900 },
    )
    const block = view.q('agent-instructions')
    expect(block.dataset.subject, 'the block declares no subject of its own').toBe('agent')
    // ⚑ **583 relay 2 · `told-sentence` moved behind the `as sent` tab** — it is the account's own
    // lead line and that account now lives on its own tab rather than at the top of one flowing
    // document, so it has to be pressed into view before it can be found under `block` at all.
    await pressTold(view, 'as-sent')
    // ⚑ …and it is the NEAREST head for everything inside it, which is what makes it the one that
    // would catch a conversation fact added to this component.
    const inside = block.querySelector<HTMLElement>('[data-cy="told-sentence"]')!
    expect(headedBy(inside)).toBe('agent')
    expect(inside.closest('[data-subject]')).toBe(block)
  })

  it('⛔ a path NAMES the monospace face — it no longer arrives from the panel that hosted it', async () => {
    // ⚠️ **The defect a move creates and only a mount can see.** With a root of its own the block
    // is `--font-sans`; a `.path` that inherited its face would render a terminal path in a
    // reading face, and every string assertion in the repo would still pass.
    const view = mount(
      AgentInstructionsSheet,
      { instructions: INFO.instructions, relaunched: false, ...ASKED },
      { width: 1200, height: 900 },
    )
    const root = view.q('agent-instructions')
    // ⛔ **Resolved beside `root` rather than beside a path itself.** `root` is the one element
    // that survives every tab switch below; a probe planted beside a `.path` from a tab the walk
    // has since left would read a DETACHED subtree's computed style, which Chromium reports as an
    // empty string rather than as the face that was actually painted.
    const mono = tokenFace('--font-mono', root)
    const sans = tokenFace('--font-sans', root)
    expect(mono, 'the two faces are the same, so this rule is about nothing').not.toBe(sans)

    // ⚑ **583 relay 2 · checked on every tab while it is live, not off one mount collected after
    // the fact.** A `.path` used to sit in whichever of the five always-open sections drew it; now
    // the factory/learned file, the provider's own list and the refused list are each behind their
    // own tab, so the walk visits every one and asserts each path's face WHILE that tab is still
    // the one in the DOM — the same reason `told-composition` needed a press two tests up.
    let pathCount = 0
    let sentenceFace = ''
    await walkEveryToldTab(view, () => {
      for (const path of root.querySelectorAll<HTMLElement>('.path')) {
        pathCount += 1
        expect(getComputedStyle(path).fontFamily).toBe(mono)
      }
      const sentence = view.all('told-sentence')[0]
      if (sentence) sentenceFace = getComputedStyle(sentence).fontFamily
    })
    expect(pathCount, 'no path was drawn at all').toBeGreaterThan(2)
    // ⛔ The pair, on the `as sent` tab that holds it now: its lead sentence is NOT mono, so the
    // assertion above is about the paths rather than about a block that is mono throughout.
    expect(sentenceFace, 'the as-sent tab was never visited').not.toBe('')
    expect(sentenceFace).toBe(sans)
  })

  it('🔴 …and it is READABLE on the paper the overlay layer puts it on', async () => {
    // ⛔ **`346`'s class, and this repo has paid for it twice.** `OverlayHost` carries
    // `data-chat-theme="light"` for everything it hosts, so a sheet added today is light because it
    // was hosted rather than because somebody remembered — and `color` INHERITS as a RESOLVED
    // colour, which is how five sheets once computed a near-white ink on their own roots and were
    // saved only by every text element happening to declare a colour of its own.
    // ⚠️ **A near-white sentence on white paper passes every assertion in this file**, which is why
    // the sensor here is contrast rather than a class name
    // (`an-alpha-fill-in-a-light-scope-is-not-a-light-surface`).
    const view = mount(
      defineComponent({
        setup() {
          return () =>
            h('div', { 'data-chat-theme': 'light' }, [
              h(AgentInstructionsSheet as never, {
                instructions: INFO.instructions,
                relaunched: false,
                ...ASKED,
              }),
            ])
        },
      }),
      {},
      { width: 1200, height: 900 },
    )
    const worst: { where: string; ratio: number }[] = []
    // ⚑ **583 relay 2 · sampled across every tab, not off one static mount.** Before the tab strip
    // this sheet drew all five `told.layers`, the compiled bundle and both lists in one document,
    // so a single walk covered everything it could paint. `583` gates that behind `showing`/
    // `current`, so a colour that only ever appears on the second or third tab — the provider's
    // own scope chip, the refused-file italics — would have been invisible to a walk that read one
    // mount and never pressed anything. ⛔ **Not deduped by element identity**: Vue PATCHES an
    // unkeyed node (e.g. `.lead-short`) in place across sibling group tabs rather than replacing
    // it, so the same element can carry a DIFFERENT sentence on the next tab — a Set keyed by the
    // node would sample only the first tab's colour and silently skip every one after it.
    await walkEveryToldTab(view, () => {
      for (const el of textBearing(view.host.querySelector<HTMLElement>('.sheet-body')!)) {
        const colour = parseColor(getComputedStyle(el).color)
        if (colour === null) continue
        const { fg, bg } = paintedInk(el, colour)
        worst.push({ where: el.dataset.cy ?? el.className, ratio: contrast(fg, bg) })
      }
    })
    expect(worst.length, 'nothing on the sheet had ink to read').toBeGreaterThan(20)
    const faintest = worst.reduce((a, b) => (b.ratio < a.ratio ? b : a))
    // ⛔ **3:1 is the floor this app's own paper tests use for its quietest register** — muted meta
    // on a card — and everything on a READING surface has to clear it.
    // ⚑ **Measured at this commit the faintest is 5.62:1**, the `Open` button's caption, so the
    // margin is 2.6 and the bound is not one a reflow could cross (standing rule 22: say what makes
    // the number reachable and write the derivation down). ⚠️ The bound is deliberately the FLOOR
    // rather than the measurement: pinning 5.62 would redden on any legitimate palette move.
    expect(
      faintest.ratio,
      `${faintest.where} is ${faintest.ratio.toFixed(2)}:1 on paper`,
    ).toBeGreaterThan(3)
  })

  it('⚑ nothing on the sheet is under the 12 px floor, with every tab and paper open', async () => {
    const view = mount(
      AgentInstructionsSheet,
      { instructions: INFO.instructions, relaunched: false, ...ASKED },
      { width: 1200, height: 900 },
    )
    const body = view.host.querySelector<HTMLElement>('.sheet-body')!
    const under: string[] = []
    let walked = 0
    // Walked across every tab, with each block's paper open, so the paper's own toolbar label is
    // measured too. Not deduped by node: Vue reuses nodes across tabs.
    await walkEveryToldTab(view, () => {
      for (const el of [root(body), ...body.querySelectorAll<HTMLElement>('*')]) {
        if (!ownsText(el) || !visible(el)) continue
        walked += 1
        if (px(el) < 12) under.push(`${el.dataset.cy ?? el.className}@${px(el)}`)
      }
    })
    expect(walked, 'the walk measured nothing').toBeGreaterThan(20)
    expect(
      body.querySelector('.lbl'),
      'no paper was opened, so its label was never measured',
    ).not.toBeNull()
    expect(under, 'text under the 12 px floor').toEqual([])
  })
})
