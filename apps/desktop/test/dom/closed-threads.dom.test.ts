import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ResumableSessions from '../../src/renderer/src/components/ResumableSessions.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import type {
  ImportedRecording,
  ResumableSessionInfo,
  UnresumableSessionInfo,
} from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'
import { DEFAULT_PROFILE_ID, DEFAULT_PROFILE_LABEL } from '../../src/shared/runtime-ipc'

/**
 * 118 · The closed-conversations list, and the row it must stop offering a button on.
 *
 * An app-owned adopted Codex child must retain its identity through the resume DTO. A child
 * with `canAcceptDirectInput:false` must not receive the parent’s Resume action.
 *
 * ⚠️ **A real engine rather than SSR, and that is load-bearing here** (083, and the standing
 * `brobot2-ssr-tests-pass-vacuously` rule). Every assertion below is about a control that is
 * ABSENT, and the two rows are drawn by the same `v-for` off the same fetch — so a component that
 * failed to mount, or a fetch that resolved to nothing, would satisfy every negative in this file.
 * The paired positive is therefore never a courtesy: it is what makes the negatives mean anything.
 *
 * ⚑ **D-017b · there is no closed list any more.** Every row on the Sessions page, and every row of
 * the rail's one list, opens its conversation in the one full view whatever it is doing — so the
 * Resume and Read presses this file was written about are gone, and what is asserted is the one
 * press (`sessions-open-…`, the rail's `open-session-…`) and the refusal sentence a row still says.
 */

afterEach(unmountAll)

const base = {
  provider: 'codex' as const,
  cwd: '/tmp/work',
  status: 'idle' as const,
  // ⚑ **D-016 · commit 7 · R2 — it holds no piece**, so a row is titled by its agent, as it was.
  named: null,
  approvalMode: null,
  profileId: DEFAULT_PROFILE_ID,
  reasoningEffort: null,
  model: null,
  planMode: null,
  adoptedAt: 1_700_000_000_000,
  hasTranscript: true,
  // 222 — a FINISHED base row, so the negatives below are about a row that has an ending.
  lastEnding: 'completed' as const,
  updatedAt: 1_700_000_001_000,
}

/**
 * An ordinary conversation the sweep imported into a home we own.
 *
 * ⚑ **`109`'s "a generic resume would be false for both providers" does NOT reach this row**, and
 * `116` sharpened the ruling to say so. It is adopted, it is Codex, and it is offered.
 */
const PARENT: ResumableSessionInfo = {
  ...base,
  // ⚑ **421 · a recording, which is what every row in this file is.** The running population has
  // its own section and its own fixtures, in `a-live-conversation-is-never-drawn-as-ended.dom.test.ts`.
  running: 'not-running',
  // ⚑ **D-017b · the one state the host says of it** — what the rail's one list draws.
  state: { is: 'idle' },
  sessionId: 'sess_parent',
  ref: { provider: 'codex', sessionId: 'parent-thread', cwd: '/tmp/work', rotation: 0 },
  child: null,
  resumeRefusal: null,
}

/**
 * The same row in every respect but one: another agent spawned it.
 *
 * ⚠️ **Nicknamed and ROLE-LESS, because that is what a child looks like now** (121 §5.1). `114` and
 * `115` measured it on the real corpus: 16 of 827 children carry a role, every one of them written
 * before 2026-07-20, and the provider now writes the field explicitly null — while 808 of 827 are
 * nicknamed. This fixture used to carry `role: 'worker'` and was the only child example in the
 * file, so it taught the `(role)` shape as the ordinary one. The branch is still covered, one test
 * below, by a row that says in its own words that it is the historical form.
 */
const CHILD: ResumableSessionInfo = {
  ...base,
  running: 'not-running',
  state: { is: 'idle' },
  sessionId: 'sess_child',
  ref: { provider: 'codex', sessionId: 'child-thread', cwd: '/tmp/work', rotation: 0 },
  child: { parentSessionId: 'parent-thread', depth: 1, nickname: 'Turing', role: null },
  resumeRefusal:
    'a sub-agent conversation — another agent spawned it, and the provider does not accept ' +
    'direct input on a thread it did not start',
}

/**
 * ⚠️ **The stub's signature matches the declared one and the cast goes through `unknown`** — the
 * same reason `surface-boundaries.dom.test.ts` gives: `window.api` is globally declared, so a
 * narrower fake is not comparable to it and `vue-tsc` reports the drift on the first line.
 */
type ResumeApi = {
  runtime: {
    listResumable: () => Promise<ResumableSessionInfo[]>
    listUnresumable: () => Promise<UnresumableSessionInfo[]>
    importRecordedSession?: (input: { sessionId: string }) => Promise<ImportedRecording>
  }
}

const stubbed = (): { api?: ResumeApi } => window as unknown as { api?: ResumeApi }

/**
 * Mount the list over a stubbed fetch and wait for it to land.
 *
 * ⚠️ **A macrotask, not a count of `nextTick`s.** `refresh()` awaits a `Promise.all` and then falls
 * through assignments into a `finally`, so the number of microtask hops between mounting and the
 * first painted row is an implementation detail of a function this file does not own. Two ticks was
 * measurably not enough — the list was still on *"looking…"* — and three would be a number that
 * happens to work today. A `setTimeout(0)` drains the microtask queue whatever is in it, and the
 * `nextTick` after it flushes the render. The assertion below is what makes the difference visible
 * rather than silent: without it every row query returns nothing and the file passes over an empty
 * list, which is the exact failure mode this suite's own comments keep naming.
 */
/**
 * How many times the list has gone back to the host, and what it gets when it does.
 *
 * ⚑ **Counted since 119 (review).** `importMessages` refreshes the list when something landed, and
 * that re-fetch is the whole point of the control: it is what turns *"prior messages not imported
 * yet"* into a Read button. Nothing could see it — the stub returned one constant array — so
 * deleting the refresh left every test in this file green and the user staring at a row that still
 * said the messages were missing.
 */
let fetches = 0
/** What the NEXT fetch answers with, so a refresh can return a different world from the first. */
let served: ResumableSessionInfo[] = []

async function list(
  rows: ResumableSessionInfo[],
  onOpen?: (sessionId: string) => void,
  onImport?: (sessionId: string) => Promise<ImportedRecording>,
): Promise<ReturnType<typeof mount>> {
  fetches = 0
  served = rows
  stubbed().api = {
    runtime: {
      listResumable: () => {
        fetches += 1
        return Promise.resolve(served)
      },
      listUnresumable: () => Promise.resolve([]),
      ...(onImport ? { importRecordedSession: ({ sessionId }) => onImport(sessionId) } : {}),
    },
  }
  const view = mount(ResumableSessions, onOpen ? { onOpen } : {}, { width: 320 })
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  expect(view.all('resumable-row'), 'the stubbed fetch never reached the list').toHaveLength(
    rows.length,
  )
  return view
}

afterEach(() => {
  delete stubbed().api
})

describe('a row that cannot take input does not offer a button that would (118)', () => {
  it('⛔ D-017b · the child and the parent get the SAME one press — and no row offers a Resume', async () => {
    // ⚑ **Re-aimed from *"the child gets no Resume — and the parent beside it still does"*.** 118's
    // Resume is gone: every row opens its conversation in the one full view, whatever it is doing,
    // and a message sent there continues it — or, on the child, is refused in the host's words (the
    // sentence the next test reads). So the press is no longer a claim that the row takes input.
    const view = await list([PARENT, CHILD])

    // Same list, same fetch, same `v-for`: the one press on both rows.
    expect(view.q('sessions-open-sess_parent').textContent?.trim()).toBe('Open')
    expect(view.q('sessions-open-sess_child').textContent?.trim()).toBe('Open')

    // ⚑ **The selector the live smokes now use, run against the real markup** —
    // `resumeFromTheReopenList` presses `sessions-open-<id>`, so the expression is pinned here
    // rather than only in a script nothing gates. Both rows are pickable.
    const pickable = view
      .all('resumable-row')
      .filter((row) => row.querySelector('button[data-cy^="sessions-open-"]'))
      .map((row) => row.dataset.sessionId)
    expect(pickable).toEqual(['sess_parent', 'sess_child'])
    // ⛔ …and the old one names no BUTTON at all: `resume-refused-…` is the child's <p>, the one
    // element left under that prefix, so a smoke still selecting on it would press nothing.
    expect(
      view.all('resumable-row').filter((row) => row.querySelector('button[data-cy^="resume-"]')),
    ).toHaveLength(0)
    expect(view.q('resume-refused-sess_child').tagName).toBe('P')
  })

  it('…and says why, in the host’s own words rather than a shrug', async () => {
    const view = await list([PARENT, CHILD])
    const why = view.q('resume-refused-sess_child')
    expect(why.textContent).toContain('sub-agent conversation')
    expect(why.textContent).toContain('does not accept direct input')
    // ⛔ **Not an error, and not PAINTED as one: nothing failed here.** The class check alone would
    // be a string comparison against markup; the colour is the claim, and the real stylesheet is
    // loaded in this project precisely so it can be asked. It resolves to the same ink as the row's
    // own meta line — a positive comparison rather than "not danger", which would pass on any
    // colour at all including none.
    expect(why.classList.contains('err')).toBe(false)
    const ink = getComputedStyle(why).color
    // ⛔ **`not.toBe('')` was inert and review said so** — Chromium never returns an empty computed
    // colour, so the guard it advertised could not fire, and the comparison below would then have
    // passed for two elements both inheriting the same default black. The non-vacuity check that
    // BITES is a contrast: this text is muted and the row's own path is not, so if the stylesheet
    // had failed to load they would be equal and this fails.
    expect(ink).not.toBe(getComputedStyle(view.host.querySelector('.cwd')!).color)
    expect(ink).toBe(getComputedStyle(view.q('resumable-profile')).color)
    // The paired positive: the row that CAN be resumed carries no such sentence.
    expect(view.all('resume-refused-sess_parent')).toHaveLength(0)
  })

  it('⚑ what it offers instead is a real destination, and pressing it says which row', async () => {
    // ⛔ "Removing the button and leaving nothing is not the fix." `115` gave a child a destination
    // and this row has one of its own: we hold the conversation, so it can be opened.
    // ⚑ **D-017b · the destination is the conversation's one full view** — the READ-ONLY press
    // (`read-…`) went with the reading-only pane, and the child's press is the parent's.
    const opened: string[] = []
    const view = await list([PARENT, CHILD], (sessionId) => opened.push(sessionId))

    expect(view.all('read-sess_child'), 'the reading-only press is gone').toHaveLength(0)
    const button = view.q('sessions-open-sess_child')
    expect(button.textContent?.trim()).toBe('Open')
    button.click()
    await nextTick()
    // The IDENTITY of the row, which is all this surface knows — the screen resolves the
    // conversation behind it rather than this list composing a thinner one.
    expect(opened).toEqual(['sess_child'])
  })

  it('⛔ …and the rail carries that press up to the screen (118, review)', async () => {
    // ⚠️ **The hop nothing crossed.** The test above proves this list emits `read`; the screen
    // proves it can resolve one. Between them sits the rail's own forwarding, and `vue-tsc` catches
    // a RENAMED handler but not a deleted one — so removing that line would have made the whole
    // Read feature inert with every test still green.
    //
    // ⚑ **151 moved the rail off this component and the hop still has to hold.** The rail now draws
    // its own compact rows, so the press is on the ROW rather than on a button inside a page
    // surface — the same gesture, one element up. ⚑ **D-017b · the row is in the ONE list**, with
    // no collapsed *Closed conversations* section to open first, and its press is the rail's one
    // `select`: the screen opens the conversation in its full view. What is asserted HERE is only
    // that the rail hands it to the screen.
    stubbed().api = {
      runtime: {
        listResumable: () => Promise.resolve([CHILD]),
        listUnresumable: () => Promise.resolve([]),
      },
    }
    const forwarded: string[] = []
    const rail = mount(
      SideRail,
      {
        open: [],
        activeId: null,
        place: null,
        onSelect: (sessionId: string) => forwarded.push(sessionId),
      },
      { width: 320 },
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    const row = rail.q('open-session-sess_child')
    expect(row.tagName, 'a row that can be opened is a control').toBe('BUTTON')
    row.click()
    await nextTick()
    expect(forwarded).toEqual(['sess_child'])
  })

  it('names the descent the Library has been showing since 111', async () => {
    // The common fixture is nicknamed without a role: 808 of 827 measured children were
    // nicknamed, and none written since 2026-07-20 carried a role.
    const view = await list([PARENT, CHILD])
    expect(view.q('resumable-child-sess_child').textContent?.trim()).toBe('sub-agent · Turing')
    expect(view.all('resumable-child-sess_parent')).toHaveLength(0)
  })

  it('…and the role form still renders, for the 16 rows that have one', async () => {
    /**
     * ⚠️ **Kept, and kept SEPARATE** (121 §5.1). `childLabel`'s three-part branch is not dead code
     * — 16 real rows reach it — but it is historical, so it gets a row that says so rather than
     * being the shape every other fixture in this file teaches. Delete the branch and this fires;
     * make it the default and the test above fires.
     */
    const historical = {
      ...CHILD,
      sessionId: 'sess_old',
      child: { parentSessionId: 'parent-thread', depth: 1, nickname: 'Turing', role: 'worker' },
    }
    const view = await list([historical])
    expect(view.q('resumable-child-sess_old').textContent?.trim()).toBe(
      'sub-agent · Turing (worker)',
    )
  })

  it('⚠️ offers nothing to read when there is nothing read — and still refuses Resume', async () => {
    // An adopted row whose transcript has not been imported yet (088). A Read button here would be
    // a control onto an empty pane — 106's "unwired control hinted at" — so it is absent, and the
    // row's own meta line already says the prior messages have not been imported.
    const view = await list([{ ...CHILD, hasTranscript: false }])
    expect(view.all('resume-sess_child')).toHaveLength(0)
    expect(view.all('read-sess_child')).toHaveLength(0)
    // ⚑ **D-017b · the one press is still there**, so the two absences above are measured on a row
    // that draws a button — its view says what the ledger holds.
    expect(view.all('sessions-open-sess_child')).toHaveLength(1)
    // …and the things it DOES still offer, so "no buttons" is not what happened.
    expect(view.all('resume-refused-sess_child')).toHaveLength(1)
    expect(view.all('export-native-sess_child')).toHaveLength(1)
    // ⚑ **Since 119 the sentence has a control** — see the suite below.
    expect(view.all('import-messages-sess_child')).toHaveLength(1)
    // ⚑ **563 · and the sentence this block's own comment leans on is asserted BY NAME.** ⛔ Every
    // positive above is a count — `not.toBeNull()` three times over — so *"the row's own meta line
    // already says the prior messages have not been imported"* was a claim in a comment that
    // nothing checked, on a row that could have rendered empty.
    expect(view.q('resumable-adopted').textContent).toContain('prior messages not imported yet')
  })
})

/**
 * 119 · The sentence that named an action nothing performed.
 *
 * ⛔ **`118` §8.3, and the PM's ruling on it: *"put it on the row"*.** The meta line has said
 * *"prior messages not imported yet"* since 087. `106` forbade a control that looks like it does
 * something and does not; a sentence naming an action with no control anywhere is the same lie told
 * by omission. The Library's Import could not be widened to cover it — that command takes the
 * PROVIDER's id and looks in the user's own home, and this row is ours.
 */
describe('an adopted row with no messages offers the import it has been naming (119)', () => {
  /**
   * The row the sentence appears on: adopted, and we hold nothing of it.
   *
   * ⚠️ **Its own `sessionId`.** Every `data-cy` in this list is keyed by it, so reusing `CHILD`'s
   * would have put two rows behind one selector and made every query below ambiguous — including
   * the negatives, which would then have been measuring the wrong row.
   */
  const EMPTY: ResumableSessionInfo = { ...CHILD, sessionId: 'sess_empty', hasTranscript: false }

  it('offers import exactly where the sentence is — and not where it is not', async () => {
    /**
     * ⚠️ Three rows through one `v-for`, so the negatives cannot pass over an empty list.
     *
     * ⛔ **Each negative is excluded by exactly ONE clause, and the mutation check is why.** The
     * first version put `hasTranscript: true` on the not-adopted row — so BOTH clauses ruled it
     * out, and dropping `session.adoptedAt` from the condition changed nothing this file could
     * see. It survived. A row this app RAN and holds nothing of is the only shape that isolates
     * that clause, and it is a real one: a conversation closed before its first turn.
     */
    const view = await list([
      EMPTY,
      CHILD,
      { ...PARENT, sessionId: 'sess_ours', adoptedAt: null, hasTranscript: false },
    ])

    expect(view.all('resumable-row')).toHaveLength(3)
    expect(view.q('resumable-adopted').textContent).toContain('prior messages not imported yet')
    expect(view.all('import-messages-sess_empty')).toHaveLength(1)
    expect(view.q('import-messages-sess_empty').textContent?.trim()).toBe('import messages')
    // Adopted, and its messages are already here — the `!hasTranscript` clause alone rules it out.
    expect(view.all('import-messages-sess_child')).toHaveLength(0)
    // Never adopted, and nothing to read — the `adoptedAt` clause alone rules it out. There is no
    // provider file this was imported from, so there is nothing an import could go and get.
    expect(view.all('import-messages-sess_ours')).toHaveLength(0)
    // …and the row that says nothing about importing does not say it either.
    expect(view.all('resumable-adopted')).toHaveLength(2)
  })

  it('⚠️ three controls still fit the rail it lives in', async () => {
    // The rail is 320px and this row now carries a third link beside the two exports. A control
    // that pushes the row sideways is not a smaller version of a control that fits — the list
    // scrolls vertically, so the overflow would be permanent and would clip the button itself.
    const view = await list([EMPTY])
    const actions = view.host.querySelector('.row-actions') as HTMLElement
    const buttons = [...actions.querySelectorAll('button')]
    expect(buttons).toHaveLength(3)
    // Non-vacuity: a stylesheet that failed to load would give every element a zero width and the
    // comparisons below would pass over nothing.
    expect(actions.scrollWidth).toBeGreaterThan(0)
    expect(actions.scrollWidth).toBeLessThanOrEqual(actions.clientWidth)
    const row = view.q('resumable-row')
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)
    // ⛔ **Width alone could not report the regression this test is named for** (review). These are
    // shrinkable flex items with wrapping text, so a label too long to fit WRAPS instead of
    // overflowing: the row grows taller and `scrollWidth` never moves. Equal heights is what says
    // every label is still on one line, and the container matching them is what says the row did
    // not grow to hold a second.
    const heights = buttons.map((button) => button.getBoundingClientRect().height)
    expect(Math.max(...heights)).toBe(Math.min(...heights))
    expect(actions.getBoundingClientRect().height).toBeCloseTo(heights[0]!, 0)
  })

  it('presses through to the host and prints its answer, in the host’s own words', async () => {
    const asked: string[] = []
    const view = await list([EMPTY], undefined, async (sessionId) => {
      asked.push(sessionId)
      // What the store would say afterwards, so the refresh has something new to report — the
      // import is the only thing that could have changed `hasTranscript`.
      served = [{ ...EMPTY, hasTranscript: true }]
      return { outcome: 'imported', readable: true, note: 'Its prior messages are here now.' }
    })

    view.q('import-messages-sess_empty').click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()

    expect(asked).toEqual(['sess_empty'])
    expect(view.q('import-result-sess_empty').textContent).toContain('here now')
    // ⚑ **The row went back to the host and caught up with itself.** `hasTranscript` is read from
    // the store, so the only way the row can stop saying its messages are missing is a re-fetch —
    // and the note survives it, keyed by session id. (⚑ D-017b · it was a Read button appearing,
    // and the Read press is gone.)
    expect(fetches, 'a landed import must refresh the list').toBe(2)
    expect(view.q('resumable-adopted').textContent).not.toContain('prior messages not imported yet')
    expect(
      view.all('import-messages-sess_empty'),
      'and there is nothing left to import',
    ).toHaveLength(0)
    // ⛔ **Not painted as a failure**, and the real stylesheet is loaded here so the colour can be
    // asked rather than the class name compared. It is the muted ink the row's own meta line uses.
    expect(view.q('import-result-sess_empty').classList.contains('err')).toBe(false)
    const ink = getComputedStyle(view.q('import-result-sess_empty')).color
    // ⛔ **The contrast FIRST, and this file already learned why** (see the refusal test above).
    // Comparing two elements for equal ink passes over nothing if the stylesheet failed to load and
    // both inherited the same default. The row's own path is not muted, so this is what bites.
    expect(ink).not.toBe(getComputedStyle(view.host.querySelector('.cwd')!).color)
    expect(ink).toBe(getComputedStyle(view.q('resumable-profile')).color)
  })

  it('⚠️ an outcome that changed nothing is reported, not swallowed', async () => {
    // `readable: false` is the honest empty — the provider's file is gone, so there was nothing to
    // bring in. 086's rule: report it rather than dress it as either a success or a fault.
    const view = await list([EMPTY], undefined, async () => ({
      outcome: 'skipped',
      readable: false,
      note: 'There is nothing of this conversation in its provider home to import.',
    }))

    view.q('import-messages-sess_empty').click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()

    expect(view.q('import-result-sess_empty').textContent).toContain('nothing of this conversation')
    // ⚑ **And it did NOT go back to the host.** Re-fetching after an outcome that changed nothing
    // would make a no-op look like work — the paired half of the assertion in the test above, and
    // the reason the refresh is guarded on `readable` rather than run unconditionally.
    expect(fetches).toBe(1)
    // The row did not quietly redraw itself as readable either: it still says its messages are
    // missing, because `hasTranscript` is a fact read back from the store and nothing landed.
    expect(view.q('resumable-adopted').textContent).toContain('prior messages not imported yet')
    expect(view.all('import-messages-sess_empty'), 'and the control is still there').toHaveLength(1)
  })
})

/**
 * 🔴 **167 §4 · what the two surfaces say about a profile that is not `default`.**
 *
 * The dispatch asked for a CHECK — *"the rail and the Sessions page already SHOW `profileId`, check
 * they still read correctly"* — and the check found something. Two corrections, both here:
 *
 * ⛔ **The unresumable half was fabricating a profile.** It rendered `session.profileId ?? 'default'`,
 * and this is the only list that shows rows the sweep took out of the user's OWN provider folder —
 * for which `profileId` is `null` because there IS no profile (`foundInUserHome` is literally
 * `adoptedAt !== null && profileId === null`). A conversation from `~/.claude` was therefore
 * labelled with the name of a BroBot home it has never been in.
 *
 * The rail carries one fact, without a second line or separate profile field. Assert that a
 * non-default profile does not change the row’s structure; two rows differing only by profile
 * can therefore look identical in a 200px column.
 */
describe('a profile that is not the default, on the surfaces that show one (167 §4)', () => {
  const RECORDED: UnresumableSessionInfo = {
    sessionId: 'sess_ours',
    provider: 'claude',
    cwd: '/tmp/work',
    status: 'ended',
    running: 'not-running',
    state: { is: 'idle' },
    named: null,
    profileId: 'developer',
    adoptedAt: null,
    updatedAt: 1_700_000_001_000,
    hasTranscript: true,
    lastEnding: 'completed',
    foundInUserHome: false,
    restoredFromBundle: false,
    reason: 'its provider ref did not survive',
  }

  /** The row the sweep found in the user's own `~/.claude` — no profile, and none to invent. */
  const THEIRS: UnresumableSessionInfo = {
    ...RECORDED,
    sessionId: 'sess_theirs',
    profileId: null,
    adoptedAt: 1_700_000_000_000,
    foundInUserHome: true,
    restoredFromBundle: false,
    reason: 'it was found in your own provider home, which this app only reads',
  }

  async function listBoth(
    resumable: ResumableSessionInfo[],
    unresumable: UnresumableSessionInfo[],
  ): Promise<ReturnType<typeof mount>> {
    stubbed().api = {
      runtime: {
        listResumable: () => Promise.resolve(resumable),
        listUnresumable: () => Promise.resolve(unresumable),
      },
    }
    const view = mount(ResumableSessions, {}, { width: 640 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    return view
  }

  // ⚑ **714 · R41 (`712` F-4) — *agent:* and a NAME since `714`**; with no roster handed in, the
  // name is the slug (`agentName`'s own answer), which is what these rows were already about.
  // `names-a-new-project-and-a-command-with-files.dom.test.ts` §1 hands a roster and reads *Ada*.
  it('the Sessions page names a non-default agent as itself', async () => {
    const view = await list([{ ...PARENT, profileId: 'developer' }])
    expect(view.q('resumable-profile').textContent?.trim()).toBe('agent: developer')
  })

  it('…and names the default one as BroBot, the same word the launcher offers it under', async () => {
    // The paired positive, and 167 §2: `default` is the product's own identity rather than an unset
    // field, so it is labelled the same way wherever it appears.
    const view = await list([PARENT])
    expect(view.q('resumable-profile').textContent?.trim()).toBe(`agent: ${DEFAULT_PROFILE_LABEL}`)

    // A row older than the column reaches the same place honestly: `resumable()` drops the
    // user-home rows, so the only `null` that gets here really did run in the default profile.
    const older = await list([{ ...PARENT, profileId: null }])
    expect(older.q('resumable-profile').textContent?.trim()).toBe(`agent: ${DEFAULT_PROFILE_LABEL}`)
  })

  it('⛔ does NOT call a conversation from the user’s own home a BroBot profile', async () => {
    const view = await listBoth([], [THEIRS])

    const said = view.q('unresumable-profile').textContent?.replace(/\s+/g, ' ').trim() ?? ''
    expect(said, 'the fabrication 167 §4 found').not.toContain(DEFAULT_PROFILE_ID)
    expect(said).not.toContain('BroBot')
    // 169 §2 · and it names the program whose folder it is, from the row's own `provider` — the
    // repo's word for that directory is not a word anybody outside this repo has met.
    // ⚑ **714** — it ran as NO agent, so it no longer takes the row's word: it says where it came from.
    expect(said).toBe("from Claude's own folder")
    expect(said).not.toContain('provider home')

    const codex = await listBoth([], [{ ...THEIRS, provider: 'codex' }])
    expect(
      codex.q('unresumable-profile').textContent?.replace(/\s+/g, ' ').trim(),
      'the other one, so the label is read off the row rather than assumed',
    ).toBe("from Codex's own folder")
  })

  it('…while a row that IS ours still says which profile it is in', async () => {
    // The pairing. Without it the negative above passes on a surface that stopped saying anything
    // about profiles at all, which would lose the fact 085 put there.
    const view = await listBoth([], [RECORDED])
    expect(view.q('unresumable-profile').textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'agent: developer',
    )
  })

  /**
   * The row’s subject is its identity.
   *
   * ⛔ **It read *"the rail shows no profile, by ruling"*** and asserted that a non-default row does
   * not carry its identity anywhere. ⚠️ **He asked for the opposite, over a screenshot of three
   * rows that could not be told apart:** *"in the left conversation list panel, can we actually
   * show the role? now it shows `brobot-workspace` and that is not a relevant information."*
   *
   * ⚑ **What survives is `151`'s ONE-FACT rule, and that is what this test is for now**: the row
   * says who and where on one `<small>`, and still carries none of the page-scale facts
   * `ResumableSessions.vue` draws — no target home sentence, no approval mode, no path, no
   * controls. 🔴 **The identity became the row's NAME; it did not become a fourth line.**
   */
  it('the rail names a non-default row by its identity, and still carries one fact (151)', async () => {
    stubbed().api = {
      runtime: {
        listResumable: () => Promise.resolve([{ ...PARENT, profileId: 'developer' }]),
        listUnresumable: () => Promise.resolve([]),
      },
    }
    const rail = mount(SideRail, { open: [], activeId: null, place: null }, { width: 320 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()

    // ⚑ **D-017b · the row is in the rail's ONE list** — no collapsed section to open first.
    const row = rail.q('open-session-sess_parent')
    // The positive first, so the negatives below are about a row that really rendered.
    expect(row.textContent).toContain('work')
    // ⛔ **The identity is the row's NAME**, in the `<strong>` — not an extra fact appended to the
    // line, which is what `151`'s rule forbids and what the negatives below still check.
    expect(row.querySelector('strong')!.textContent).toBe('developer')
    // ⚑ **And still exactly one `<small>`**, carrying the folder the name used to be.
    expect(row.querySelectorAll('small')).toHaveLength(1)
    expect(row.querySelector('small')!.textContent).toContain('work')
    // ⚠️ **The word `profile` is still absent**, which is the half of the old negative that was
    // never about the identity: a rail row is not a page row, and naming the column a value came
    // out of is page copy.
    expect(row.textContent).not.toContain('profile')
  })
})

/**
 * 🔴 **701 · a conversation the QUIT left open is not a closed one** (PM ruling R34b: *"Open means
 * where the person left it: in the rail, not under Closed conversations"*).
 *
 * ⚠️ **It was listed here, under *Reopen a closed conversation*, reading `ended`** — the status the
 * quit wrote — with a Resume that started it: `692` F-a on a second surface. ⚑ `701` left it off
 * this list.
 *
 * ⚑ **D-017b · re-aimed: there is no closed list to keep it off.** Every recorded conversation is on
 * this page, whatever it is doing, and each one's press OPENS it — nothing starts until a message is
 * sent. So a conversation whose recorded status is `ended` sits beside its neighbour with the same
 * press, which is what `701` wanted for it on the rail.
 */
describe('701 · the Sessions page does not call a conversation the quit left open closed', () => {
  it('🔴 D-017b · a conversation whose status reads ended is listed with the one press — beside its neighbour', async () => {
    const stopped: ResumableSessionInfo = {
      ...PARENT,
      sessionId: 'sess_kept',
      status: 'ended',
    }
    stubbed().api = {
      runtime: {
        listResumable: () => Promise.resolve([stopped, PARENT]),
        listUnresumable: () => Promise.resolve([]),
      },
    }
    const view = mount(ResumableSessions, {}, { width: 320 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    // ⚑ the fetch landed, READ rather than mounted: each row says its status and offers Open
    expect(view.all('resumable-row')).toHaveLength(2)
    expect(view.q('resumable-status-sess_parent').textContent?.trim()).toBe(PARENT.status)
    expect(view.q('resumable-status-sess_kept').textContent?.trim()).toBe('ended')
    expect(view.q('sessions-open-sess_parent').textContent?.trim()).toBe('Open')
    expect(view.q('sessions-open-sess_kept').textContent?.trim()).toBe('Open')
    // ⛔ …and neither offers the Resume that STARTED it (`692` F-a) — the press opens, and starts
    // nothing.
    expect(view.all('resume-sess_kept')).toHaveLength(0)
    expect(view.all('resume-sess_parent')).toHaveLength(0)
  })
})
