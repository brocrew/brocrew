import type { TranscriptEvent } from '../../src/shared/conversation-events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import AgentInputPopup from '../../src/renderer/src/components/AgentInputPopup.vue'
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
import type { CreatedSession } from '../../src/shared/runtime-ipc'
import { givenAnswer } from './what-this-agent-was-given.fixture'
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

afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
})

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
    vi.stubGlobal('api', { runtime: { whatThisAgentWasGiven: async () => givenAnswer() } })
    const view = pane()
    view.q('told-index').click()
    await nextTick()

    const sheet = view.q('input-popup')
    await expect.poll(() => view.all('input-provider-about').length).toBe(1)
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

    for (const tab of sheet.querySelectorAll<HTMLButtonElement>('[data-cy^="input-tab-"]')) {
      tab.click()
      await nextTick()
      for (const details of sheet.querySelectorAll('details')) details.open = true
      await nextTick()
      for (const { entry, selector } of conversationFacts) {
        expect(
          sheet.querySelector(selector),
          `${entry.cy} is the conversation's and it is inside the agent's sheet`,
        ).toBeNull()
      }
    }

    view.q('input-tab-1').click()
    await nextTick()
    const composition = view.q('told-composition')
    composition.querySelector<HTMLButtonElement>('[data-cy="doc-view-raw"]')?.click()
    await nextTick()
    expect(composition.textContent).toContain(COMPOSED)
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
    expect(view.all('input-popup'), 'the sheet is open before anything was pressed').toHaveLength(0)

    view.q('told-index').click()
    await nextTick()

    expect(view.all('input-popup'), 'the entry opened nothing').toHaveLength(1)
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
    expect(host.contains(view.q('input-popup'))).toBe(true)
    // ⚑ **Whether that stop is REACHABLE with this panel in front of it is a different question**,
    // and it is asked where it is asked of every other sheet: `a-stop-a-modal-cannot-cover`'s §2,
    // which needs the spawn-safety read seeded and gained an `AgentInputPopup` row in this
    // dispatch. ⛔ Asserting it here with no seed would draw no stop at all and pass on an
    // absence — the shape `193` is about.
  })

  it('⚑ closing it puts the reader back on the entry that opened it', async () => {
    const view = pane()
    const entry = view.q('told-index')
    entry.focus()
    entry.click()
    await nextTick()
    expect(view.q('input-popup')).not.toBeNull()

    view.q('close-overlay').click()
    await nextTick()
    expect(view.all('input-popup'), 'the sheet did not close').toHaveLength(0)
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
    expect(view.all('input-popup'), 'the entry opened nothing').toHaveLength(1)

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
      view.all('input-popup'),
      'the previous conversation’s instructions are over this one’s transcript',
    ).toHaveLength(0)
    // …and the pane really swapped, so this is a guard rather than an unmount.
    expect(view.q('reading-surface').textContent).toContain('a different thread')
  })
})

/* ------------------------------------------- §5 · the block chooses its own face and its own scale */

describe('the reader on the overlay', () => {
  function reader(style?: string) {
    return mount(
      defineComponent({
        setup() {
          return () =>
            h('div', { style, 'data-chat-theme': 'light' }, [
              h(AgentInputPopup, {
                sessionId: 'sess_1',
                provider: 'claude',
                who: 'Ada',
                profile: null,
                state: null,
                startLoaded: false,
                instructions: INFO.instructions,
                ...ASKED,
              }),
            ])
        },
      }),
      {},
      { width: 1200, height: 900 },
    )
  }

  it('sets its reading size inside a host using micro-labels', () => {
    const view = reader('font-size: var(--text-4xs)')
    const body = view.q('input-popup-body')
    expect(px(view.host.firstElementChild!)).toBe(tokenPx('--text-4xs', body))
    expect(px(body)).toBe(tokenPx('--type-body', body))
    expect(px(body)).toBeGreaterThan(px(view.host.firstElementChild!))
  })

  it('heads its own launch evidence', async () => {
    const view = reader()
    const popup = view.q('input-popup')
    const evidence = view.q('input-launch-evidence') as HTMLDetailsElement
    evidence.open = true
    await nextTick()
    const composition = view.q('told-composition')
    expect(visible(composition)).toBe(true)
    expect(headedBy(composition)).toBe('agent')
    expect(composition.closest('[data-subject]')).toBe(popup)
  })

  it('uses monospace for paths and the reading face for the summary', async () => {
    const view = reader()
    const body = view.q('input-popup-body')
    for (const fold of body.querySelectorAll<HTMLDetailsElement>('details')) fold.open = true
    await nextTick()
    const paths = [...body.querySelectorAll('.path, .bb-mono')].filter(visible)
    const mono = tokenFace('--font-mono', body)
    const sans = tokenFace('--font-sans', body)
    expect(paths.length).toBeGreaterThan(2)
    expect(mono).not.toBe(sans)
    for (const path of paths) expect(getComputedStyle(path).fontFamily).toBe(mono)
    expect(getComputedStyle(view.q('told-composition').querySelector('summary')!).fontFamily).toBe(
      sans,
    )
  })

  it('keeps the disclosed paths and papers readable on the light overlay', async () => {
    const view = reader()
    const body = view.q('input-popup-body')
    for (const fold of body.querySelectorAll<HTMLDetailsElement>('details')) fold.open = true
    await nextTick()
    expect(view.q('told-composition').querySelector('[data-cy="document-body"]')).not.toBeNull()

    const leaves = textBearing(body)
    expect(leaves.length).toBeGreaterThan(20)
    const tooSmall = leaves.filter((el) => px(el) < 12)
    expect(tooSmall.map((el) => el.dataset.cy ?? el.className)).toEqual([])
    for (const el of leaves) {
      const colour = parseColor(getComputedStyle(el).color)
      expect(colour, el.textContent ?? '').not.toBeNull()
      const { fg, bg } = paintedInk(el, colour!)
      expect(contrast(fg, bg), el.textContent ?? '').toBeGreaterThan(3)
    }
  })
})
