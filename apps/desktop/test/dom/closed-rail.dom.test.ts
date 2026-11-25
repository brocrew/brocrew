import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { answerTheCatalogue } from './answered-catalogue'
import { nextTick } from 'vue'
import { userEvent } from 'vitest/browser'
import SessionLibrary from '../../src/renderer/src/components/SessionLibrary.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import type { ResumableSessionInfo, UnresumableSessionInfo } from '../../src/shared/runtime-ipc'
import { fullTime } from '../../src/renderer/src/lib/clock'
import { createSessionRecord } from '../../src/renderer/src/lib/session-record'
import {
  contrast,
  mount,
  paintedInk,
  parseColor,
  unmountAll,
  visible,
  type Mounted,
} from './harness'
import { recordingPage } from './library-recording-fixture'
import { heldRecord, ordinaryRowBase, stubbed } from './ordinary-rail-rows.fixture'

beforeAll(answerTheCatalogue) // Rows name providers as the window's catalogue supplies them.

/**
 * **151 · a closed conversation, shown the way an open one is** — and since D-017b, simply ONE list.
 *
 * All conversation rail rows use the same avatar and row grammar rather than presenting
 * stopped conversations as paths with a separate resume button.
 *
 * Every conversation belongs to the rail’s single list. `conversation-list.ts` folds the
 * host’s two lists, with this window’s records alongside them, and each row opens the full
 * view through one press. There is no closed group, summary, or reopen/read split.
 * Host-listed and window-held rows share the same structure; the Sessions page retains
 * details omitted from the rail.
 *
 * ⚠️ **A real engine, and here it is not a preference.** Half of what this file asserts is about
 * what a row IS — `BUTTON` or not — and the other half is about ink that a string cannot report. It
 * also mounts the whole rail rather than a row component, because *"looks exactly like the row above
 * it"* is a claim about shared CSS.
 *
 * ⚑ **The paired negatives are the point of the ticket and the vacuity risk is real** (the standing
 * `brobot2-ssr-tests-pass-vacuously` rule). Every "the rail does not show X" below is preceded by a
 * positive that proves the row is on screen, and the Sessions page blocks prove the page still shows
 * every one of those X's — because without them, deleting the feature outright would turn this file
 * green.
 */

/* ------------------------------------------------------------------ fixtures */

const NOW = Date.now()

const resumableBase = {
  ...ordinaryRowBase,
  cwd: '/Users/alex/dev/brobot-2',
  updatedAt: NOW - 240_000,
}

/** An ordinary conversation nothing runs: it has a ref, so a message continues it. */
const OPENABLE: ResumableSessionInfo = {
  ...resumableBase,
  // ⚑ **421 · every host row in this file is a RECORDING** — nothing runs it. The running
  // population is drawn from this window's own records (`open`) where a test needs one.
  running: 'not-running',
  sessionId: 'sess_openable',
  ref: { provider: 'claude', sessionId: 'thread-1', cwd: resumableBase.cwd, rotation: 0 },
  resumeRefusal: null,
}

/**
 * A sub-agent thread (118): no input end, but we hold its messages.
 *
 * ⚑ It is also the row carrying the page-scale facts the rail must not show: adopted, in a
 * named profile, with a descent. Without those on a row this file draws, the negatives below would
 * be about a row that never had anything to hide.
 */
const READABLE: ResumableSessionInfo = {
  ...resumableBase,
  running: 'not-running',
  sessionId: 'sess_child',
  cwd: '/Users/alex/dev/acme/billing-api',
  ref: {
    provider: 'claude',
    sessionId: 'thread-2',
    cwd: '/Users/alex/dev/acme/billing-api',
    rotation: 0,
  },
  adoptedAt: NOW - 86_400_000,
  profileId: 'reviewer',
  child: { parentSessionId: 'thread-1', depth: 1, nickname: 'Turing', role: null },
  resumeRefusal:
    'a sub-agent conversation — another agent drove it, so there is no input end to reopen',
}

/** No reopen, and nothing to read either. */
const INERT: ResumableSessionInfo = {
  ...READABLE,
  sessionId: 'sess_inert',
  cwd: '/Users/alex/scratch/nothing-here',
  hasTranscript: false,
}

/**
 * A personal Claude conversation adopted from its provider home belongs on the Sessions page
 * and is excluded from this rail.
 *
 * ⚠️ **It is still here, and it has to be.** It is the fixture for both halves of `154`: that the
 * rail does not draw it, and that the Sessions page still does, with every control it ever had.
 */
const USER_HOME: UnresumableSessionInfo = {
  sessionId: 'sess_userhome',
  provider: 'claude',
  cwd: '/Users/alex/dev/other/thing',
  status: 'ended',
  running: 'not-running',
  state: { is: 'idle' },
  named: null,
  profileId: null,
  adoptedAt: NOW - 172_800_000,
  updatedAt: NOW - 7_200_000,
  hasTranscript: true,
  lastEnding: 'completed',
  foundInUserHome: true,
  restoredFromBundle: false,
  reason:
    "one of your own Claude conversations, found in Claude's own folder — BroBot can read it " +
    "here, but a reopen would start Claude in BroCrew's own folder, where this conversation is not",
}

/**
 * A conversation THIS APP ran whose ref no longer parses: unresumable, and we hold its messages.
 *
 * ⚑ **`154` is why this exists** — the same shape as {@link USER_HOME} from the half of the
 * population the rail keeps.
 */
const LOST_REF: UnresumableSessionInfo = {
  ...USER_HOME,
  sessionId: 'sess_lostref',
  cwd: '/Users/alex/dev/other/thing',
  profileId: 'recipe-worker',
  adoptedAt: null,
  foundInUserHome: false,
  restoredFromBundle: false,
  reason: 'we can no longer read where this conversation lives, so it cannot be reopened',
}

/** Recorded, never sent, nothing held: the other inert shape, from the other list. */
const NEVER_STARTED: UnresumableSessionInfo = {
  ...USER_HOME,
  sessionId: 'sess_refless',
  cwd: '/Users/alex/dev/other/empty',
  status: 'idle',
  profileId: 'recipe-worker',
  adoptedAt: null,
  hasTranscript: false,
  foundInUserHome: false,
  restoredFromBundle: false,
  reason: 'no turn was ever taken in this one, so there is nothing to reopen',
}

const heldHere = (sessionId: string, cwd: string, profileId?: string): unknown =>
  heldRecord(sessionId, cwd, NOW, profileId)

/**
 * The rail over a stubbed pair of host lists, with every press it raises counted.
 *
 * ⚠️ **A macrotask before the tick**: the fetch is a `Promise.all` inside a `try`, so the number of
 * microtask hops before the first painted row is an implementation detail this file does not own.
 * The row-count assertion at the end is what makes a fetch that never landed loud instead of silent.
 */
async function rail(
  rows: { resumable?: ResumableSessionInfo[]; unresumable?: UnresumableSessionInfo[] } = {},
  props: Record<string, unknown> = {},
): Promise<Mounted & { selected: string[] }> {
  const selected: string[] = []
  stubbed().api = {
    runtime: {
      listResumable: () => Promise.resolve(rows.resumable ?? []),
      listUnresumable: () => Promise.resolve(rows.unresumable ?? []),
    },
  }
  const m = mount(
    SideRail,
    {
      open: [],
      activeId: null,
      place: null,
      onSelect: (id: string) => selected.push(id),
      ...props,
    },
    // ⛔ **200px, the width the ticket is about.** Every layout claim below is only worth making at
    // the real size.
    { width: 200, height: 900 },
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  // ⚠️ **The guard that makes every negative in this file mean something.** A fetch that never
  // landed would leave the list empty and satisfy every "the rail does not show X" below. ⚑ One row
  // per conversation: a host row this window also holds is drawn ONCE, from its record.
  const held = new Set(
    ((props.open as { sessionId: string }[] | undefined) ?? []).map((r) => r.sessionId),
  )
  const expected =
    held.size +
    [...(rows.resumable ?? []), ...(rows.unresumable ?? [])].filter(
      // ⛔ **`foundInUserHome` subtracts, since 154** — as `restoredFromBundle` does (214).
      (session) =>
        !held.has(session.sessionId) &&
        !('foundInUserHome' in session && session.foundInUserHome) &&
        !('restoredFromBundle' in session && session.restoredFromBundle),
    ).length
  expect(
    m.host.querySelectorAll('[data-cy^="open-session-"]'),
    'the stubbed fetch never reached the rail',
  ).toHaveLength(expected)
  return Object.assign(m, { selected })
}

/** One row, by session id. */
const row = (m: Mounted, sessionId: string): HTMLElement => m.q(`open-session-${sessionId}`)

afterEach(() => {
  unmountAll()
  delete stubbed().api
})

/* ------------------------------------------------- 1 · the same three elements */

describe('a row the host lists is made of what a row this window holds is made of (151 §1, D-017b)', () => {
  it('⛔ draws the plate, the label and ONE small — the same three the held row has', async () => {
    const m = await rail(
      { resumable: [OPENABLE] },
      { open: [heldHere('sess_live', '/Users/alex/dev/live-one')] },
    )

    const held = row(m, 'sess_live')
    const listed = row(m, 'sess_openable')
    // The positive that makes every negative below mean something: both rows are on screen.
    expect(visible(held)).toBe(true)
    expect(visible(listed)).toBe(true)

    // Draw the avatar at the same size and in the same column as the other conversation rows.
    expect(listed.querySelectorAll('[data-cy="agent-state"]')).toHaveLength(1)
    expect(listed.querySelector('[data-cy="agent-state"]')!.getAttribute('data-size')).toBe(
      held.querySelector('[data-cy="agent-state"]')!.getAttribute('data-size'),
    )
    // The label identifies the agent’s role. A shared `brobot-workspace` directory name
    // cannot distinguish conversations started in the same workspace.
    expect(listed.querySelector('strong')!.textContent).toBe('recipe-worker')
    // 3 · exactly one `<small>` of facts, never a second line. ⚑ **449 kept this**: the folder
    //     moved INTO that one line rather than taking a second one.
    expect(listed.querySelectorAll('small')).toHaveLength(1)
    expect(listed.querySelector('small')!.textContent).toContain('Claude · ')
    // ⛔ **And the directory did not go away** — see the label test at the foot of this section.
    expect(listed.querySelector('small')!.textContent).toContain('brobot-2')

    // ⛔ **The geometry, measured rather than read off the stylesheet.** One selector, one grid;
    // a stylesheet edit that remembered only one kind of row fails here.
    expect(getComputedStyle(listed).gridTemplateColumns).toBe(
      getComputedStyle(held).gridTemplateColumns,
    )
    expect(listed.getBoundingClientRect().height).toBe(held.getBoundingClientRect().height)
  })

  it('⛔ …and NOT of what the page row is made of — the paired negative', async () => {
    // `READABLE` carries every fact the ticket names: an adopted mark, a target home, a descent and
    // a full path. It is on screen, and none of them are.
    const m = await rail({ resumable: [READABLE] })
    const listed = row(m, 'sess_child')
    expect(visible(listed)).toBe(true)

    const said = listed.textContent ?? ''
    expect(said, 'no cwd in mono — the folder name, never the path').not.toContain('/Users/alex')
    expect(listed.querySelectorAll('.mono')).toHaveLength(0)
    // The row’s name is its identity: this row says `reviewer`.
    expect(listed.querySelector('strong')!.textContent, 'the identity is the name now').toBe(
      'reviewer',
    )
    expect(said, 'no adopted mark').not.toContain('adopted')
    expect(said, 'no child descent').not.toContain('Turing')
    // …and no page controls at all: no Resume or Open button, no export, no import, no scan.
    expect(m.all('resumable-row')).toHaveLength(0)
    expect(m.host.querySelectorAll('[data-cy^="resume-"]')).toHaveLength(0)
    expect(m.host.querySelectorAll('[data-cy^="sessions-open-"]')).toHaveLength(0)
    expect(m.host.querySelectorAll('[data-cy^="export-"]')).toHaveLength(0)
    expect(m.all('scan-sessions')).toHaveLength(0)
    // ⚑ **449 · the FOLDER survived all of that**, which is what says the row is still a row.
    expect(listed.querySelector('small')!.textContent).toContain('billing-api')
  })

  // Current state comes from the host. Activity time never implies how a conversation runs.
  it('⚑ says the one state the host gives it — and nothing about a process, a reopen or a refusal', async () => {
    const m = await rail({
      resumable: [OPENABLE, READABLE, { ...INERT, state: { is: 'active' } }],
    })
    // The place stays last. Relative activity is separate from the host's current state.
    for (const [entry, standing, place] of [
      [OPENABLE, 'idle', 'brobot-2'],
      [READABLE, 'idle', 'billing-api'],
      [INERT, 'active', 'nothing-here'],
    ] as const) {
      const line = row(m, entry.sessionId).querySelector('small')!
      const activity = line.querySelector('time')!
      expect(activity.title).toBe(`${activity.textContent} · ${fullTime(entry.updatedAt)}`)
      expect(line.textContent?.trim()).toBe(
        `Claude · ${standing} · ${activity.textContent} · ${place}`,
      )
    }
    expect(row(m, 'sess_child').textContent).not.toMatch(
      /sub-agent conversation|ended|not running|reopen/i,
    )
  })

  /**
   * ⚑ **D-017b · re-aimed** — the plate said *ENDED* for a row nothing runs; that was a process
   * word. ⚑ It is the host's state now, as the line beside it is: `idle` draws the idle plate and
   * `active` the working one, with no `ended` anywhere.
   */
  it('⚑ the plate is the host’s state — never ENDED (086, D-017b)', async () => {
    const m = await rail({
      resumable: [OPENABLE, { ...READABLE, state: { is: 'active' } }],
      unresumable: [LOST_REF],
    })
    const plate = row(m, 'sess_openable').querySelector('[data-cy="agent-state"]')!
    expect(plate.getAttribute('data-doing')).toBe('idle')
    expect(plate.getAttribute('data-being')).not.toBe('ended')
    expect(plate.getAttribute('aria-label') ?? '').not.toContain('ended')
    // ⚠️ **And nothing is DEMANDING anything** — the one facet that can shout (081).
    expect(row(m, 'sess_openable').querySelectorAll('[data-cy="agent-needing"]')).toHaveLength(0)
    // ⚑ **The paired positive**: the plate reads the state, so the active row's is the working one.
    expect(
      row(m, 'sess_child').querySelector('[data-cy="agent-state"]')!.getAttribute('data-doing'),
    ).toBe('working')
  })

  /**
   * 🔴 **449 · the fallback MOVED, and this test moved with it.** ⚑ A listed row's identity always
   * answers, so what can be missing is the PLACE, and the row must then say one fewer thing rather
   * than draw an empty separator.
   */
  it('⛔ with no directory to name, the row says WHO and simply stops', async () => {
    const m = await rail({ resumable: [{ ...OPENABLE, cwd: '' }] })
    const only = row(m, 'sess_openable')
    expect(only.querySelector('strong')!.textContent).toBe('recipe-worker')
    const line = only.querySelector('small')!
    const activity = line.querySelector('time')!
    expect(line.textContent?.trim()).toBe(`Claude · idle · ${activity.textContent}`)
    // ⛔ **No trailing separator**, which is the shape a naive interpolation would have left.
    expect(line.textContent?.trim().endsWith('·')).toBe(false)
    expect(line.getAttribute('data-place')).toBeNull()
  })
})

/* ------------------------------------------------- 2 · one press */

/**
 * ⚑ **D-017b · re-aimed** — this said *"the click does the work the button used to"*: reopen a row
 * that could be reopened, READ one that could not, draw a row with nothing to open as a `DIV`, and
 * hold a reopen in flight on its row. ⛔ All of that went with the split. ⚑ What is left is the
 * one press: every row, whatever the conversation is doing and whatever the host can do with it, is
 * the same control, and its press opens that conversation in its full view — which then says, in the
 * host's words, when a message cannot continue it.
 */
describe('every row is the same control, and its press opens that conversation (151 §2, D-017b)', () => {
  it('⛔ a row a message continues, one it cannot, and one with nothing recorded — one press each', async () => {
    const m = await rail({
      resumable: [OPENABLE, READABLE, INERT],
      unresumable: [LOST_REF, NEVER_STARTED],
    })
    const ids = ['sess_openable', 'sess_child', 'sess_inert', 'sess_lostref', 'sess_refless']
    for (const id of ids) {
      const one = row(m, id)
      expect(visible(one), `${id} is on screen`).toBe(true)
      expect(one.getAttribute('role'), `${id} is not a control`).toBe('button')
      expect(getComputedStyle(one).cursor, `${id}'s cursor says it does nothing`).not.toBe(
        'default',
      )
      const before = m.selected.length
      one.click()
      await nextTick()
      expect(m.selected.slice(before)).toEqual([id])
      expect(one.tabIndex).toBe(0)
      one.focus()
      expect(document.activeElement).toBe(one)
      await userEvent.keyboard('{Enter}')
      expect(m.selected.slice(before)).toEqual([id, id])
      await userEvent.keyboard(' ')
      expect(m.selected.slice(before)).toEqual([id, id, id])
    }
    // Each pointer, Enter and Space gesture opens its own row once, in order.
    expect(m.selected).toEqual(ids.flatMap((id) => [id, id, id]))
    expect(m.host.querySelectorAll('[data-cy^="cancel-reopen-"]')).toHaveLength(0)
  })
})

/* ------------------------------------------------- 3 · one row per conversation */

describe('one row per conversation, and the count is the rows (090, D-017b)', () => {
  /**
   * ⚑ **D-017b · re-aimed** — this said a RUNNING conversation is in neither the closed list nor its
   * count (`hideOpen`). ⛔ There is no closed list: a conversation this window holds is IN the one
   * list — drawn once, from its own record, and never a second time from the host's row.
   */
  it('⛔ a conversation this window holds is drawn ONCE, from its record — never twice', async () => {
    const m = await rail(
      { resumable: [OPENABLE, READABLE], unresumable: [LOST_REF] },
      { open: [heldHere('sess_openable', '/Users/alex/dev/held-here')] },
    )
    expect(m.all('open-session-sess_openable')).toHaveLength(1)
    // ⚑ …and it is the RECORD's row: the folder its record names, not the host row's.
    expect(row(m, 'sess_openable').textContent).toContain('held-here')
    // The paired positive: the others are still here, so one row was merged and not the list.
    expect(m.all('open-session-sess_child')).toHaveLength(1)
    expect(m.all('open-session-sess_lostref')).toHaveLength(1)
    expect(m.q('rail-count-recent').textContent).toBe('3 shown')
  })

  it('⚠️ …and it reaches the UNRESUMABLE half too', async () => {
    const m = await rail(
      { unresumable: [LOST_REF, NEVER_STARTED] },
      { open: [heldHere('sess_lostref', '/Users/alex/dev/held-here')] },
    )
    expect(m.all('open-session-sess_lostref')).toHaveLength(1)
    expect(m.all('open-session-sess_refless')).toHaveLength(1)
    expect(m.q('rail-count-recent').textContent).toBe('2 shown')
    // ⚑ **Drawn from its RECORD, not the host's row** (`151 M28`, landing D-017b): the held record's
    // folder is its own, so a host row that took its place would read `thing` instead.
    expect(row(m, 'sess_lostref').textContent).toContain('held-here')
    expect(row(m, 'sess_lostref').textContent).not.toContain('thing')
  })

  /** A failed read is reported rather than presented as an empty conversation list. */
  it('a list that could not be READ says so, in the error’s own words', async () => {
    stubbed().api = {
      runtime: {
        listResumable: () => Promise.reject(new Error('the database is locked')),
        listUnresumable: () => Promise.resolve([]),
      },
    }
    const broken = mount(
      SideRail,
      { open: [], activeId: null, place: null },
      { width: 200, height: 900 },
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    await vi.waitFor(() => expect(broken.all('conversations-error')).toHaveLength(1), {
      timeout: 3_000,
    })
    const err = broken.q('conversations-error')
    expect(visible(err)).toBe(true)
    expect(err.textContent).toContain('the database is locked')
    expect(broken.host.querySelectorAll('[data-cy^="open-session-"]')).toHaveLength(0)
    // ⚑ The paired positive: a list that WAS read says no error.
    broken.unmount()
    const read = await rail({ resumable: [OPENABLE] })
    expect(read.all('conversations-error')).toHaveLength(0)
  })
})

/* ------------------------------------------------- 4 · the row is readable at 200px */

describe('the row survives the column it lives in (126)', () => {
  it('keeps these short titles and their metadata compact with complete text reachable', async () => {
    const m = await rail({ resumable: [READABLE], unresumable: [LOST_REF] })
    const scroll = m.host.querySelector('.rail-scroll') as HTMLElement
    // Non-vacuity: a stylesheet that failed to load gives every element a zero width, and the
    // comparison below would then pass over nothing.
    expect(scroll.clientWidth).toBeGreaterThan(0)
    expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth)

    // Both kinds of row stay compact, with full text on hover and in their accessible description.
    for (const id of ['sess_child', 'sess_lostref']) {
      const box = row(m, id).getBoundingClientRect()
      const title = row(m, id).querySelector<HTMLElement>('.rail-copy > strong')!
      const titleLine = Number.parseFloat(getComputedStyle(title).lineHeight)
      expect(title.title).toBe(title.textContent?.trim())
      expect(row(m, id).getAttribute('aria-label')).toBe(title.title)
      expect(Number(getComputedStyle(title).fontWeight)).toBeLessThanOrEqual(500)
      expect(
        title.getBoundingClientRect().height,
        `${id}: the title has no height`,
      ).toBeGreaterThan(0)
      expect(
        title.getBoundingClientRect().height,
        `${id}: the title ran past one line`,
      ).toBeLessThanOrEqual(titleLine + 1)
      const lines = row(m, id).querySelectorAll<HTMLElement>('.rail-copy > small')
      expect(lines.length, `${id}: the row drew no line under its title`).toBeGreaterThan(0)
      for (const line of lines) {
        expect(getComputedStyle(line).whiteSpace).toBe('nowrap')
        expect(getComputedStyle(line).textOverflow).toBe('ellipsis')
        expect(line.getAttribute('title')).toBe(line.textContent?.trim())
        expect(row(m, id).getAttribute('aria-describedby')).toContain(line.id)
        expect(line.scrollHeight, `${id}: a line was clipped`).toBeLessThanOrEqual(
          line.clientHeight + 1,
        )
        expect(line.getBoundingClientRect().height).toBeLessThanOrEqual(
          Number.parseFloat(getComputedStyle(line).lineHeight) + 1,
        )
      }
      for (const line of row(m, id).querySelectorAll<HTMLElement>('.rail-copy > *')) {
        const r = line.getBoundingClientRect()
        expect(r.right, `${id}: a line left its row`).toBeLessThanOrEqual(box.right + 1)
        expect(r.bottom, `${id}: a line left its row`).toBeLessThanOrEqual(box.bottom + 1)
      }
    }
  })

  it('⛔ the one small is readable where it sits — measured, not read off the stylesheet', async () => {
    const m = await rail({ resumable: [OPENABLE] })
    const small = row(m, 'sess_openable').querySelector('small')!
    // ⚑ **`visible()` FIRST** (141/148 L4): `paintedInk` cannot see `visibility: hidden`, so a
    // contrast assertion on an invisible element is a number about nothing.
    expect(visible(small)).toBe(true)
    const ink = paintedInk(small, parseColor(getComputedStyle(small).color)!)
    expect(contrast(ink.fg, ink.bg)).toBeGreaterThan(3)
    // ⛔ **Never amber** (080). The attention channel is the one place this app shouts, and an
    // idle conversation is not asking for anything.
    const amber = parseColor(
      getComputedStyle(document.documentElement).getPropertyValue('--waiting-text-label'),
    )
    if (amber)
      expect(Math.abs(ink.fg[0] - amber[0]) + Math.abs(ink.fg[2] - amber[2])).toBeGreaterThan(30)
  })
})

/* ------------------------------------------------- 5 · the page kept everything */

it('keeps recorded controls and the existing search on the one Library row', async () => {
  ;(window as unknown as { api?: unknown }).api = {
    runtime: {
      listLibrary: async () => recordingPage([READABLE, USER_HOME]),
      listResumable: async () => [READABLE],
    },
  }
  const m = mount(SessionLibrary, {}, { width: 1100, height: 900 })
  await expect.poll(() => m.all('export-native-sess_child').length).toBe(1)
  const row = m.q('library-row-sess_child')
  expect(row.textContent).toContain('/Users/alex/dev/acme/billing-api')
  expect(m.q('library-child-sess_child').textContent?.trim()).toBe('sub-agent · Turing')
  expect(row.contains(m.q('export-native-sess_child'))).toBe(true)
  expect(row.contains(m.q('export-bundle-sess_child'))).toBe(true)
  for (const hook of [
    'library-search',
    'library-facet-provider',
    'library-counts',
    'library-check-homes',
  ]) {
    expect(visible(m.q(hook))).toBe(true)
  }
  expect(m.all('library-reopen')).toHaveLength(0)
})

/**
 * **153 §4 · the string 151 named and left.**
 *
 * ⛔ *"Everything here, and everything in your provider homes."* 151 rewrote three refusals out of
 * this vocabulary and reported this line as outside its scope; the PM ruled that it is the FIRST
 * place a user meets the phrase, which makes it the worst place to leave it. *"Provider home"* is a
 * term for a directory layout — it appears in this repo's own module names — and it is being asked
 * to explain what is behind a link.
 */
describe('the rail says where the Sessions list comes from, in words (153 §4)', () => {
  afterEach(() => {
    unmountAll()
  })

  it('names the two programs and the computer holding their chats', async () => {
    const m = mount(
      SideRail,
      { open: [], activeId: null, place: null },
      { width: 200, height: 900 },
    )
    await nextTick()
    const said = m.q('rail-sessions').textContent ?? ''
    // The approved plain subtitle names the programs and computer instead of their folders.
    expect(said).toContain('All conversations')
    expect(said).toContain('Includes chats from Claude and Codex on this computer.')
    // ⛔ The jargon itself, gone from the one line this ticket is about.
    expect(said).not.toContain('provider home')
    // …and the item is still the wired link it was, not a label this rewrite turned into prose.
    expect(m.q('rail-sessions').getAttribute('data-wired')).toBe('true')
  })
})

/**
 * **154 · the rail is conversations you can pick up, not everything we ever saw.**
 *
 * A read-only conversation found outside BroBot must not appear among the app’s own
 * conversation rail rows.
 *
 * He was right about the row: one of his own Claude conversations, from his own project, swept out
 * of `~/.claude` by `046`/`047` and indexed whole. ⚑ **It was not a bug in the sweep, it was the
 * wrong surface.** `047`'s split — *"what do we hold"* against *"what can I pick up again"* — puts
 * an adopted row in the first and never the second, and it was sitting in the list whose entire
 * purpose is picking things up.
 *
 * ⚠️ **Both surfaces in one file, deliberately.** *"The rail drops it"* and *"the page keeps it"*
 * are one claim, and split across two files the second half is the one that gets deleted.
 */
describe('a conversation from the user’s own folder is not on the rail (154 §1)', () => {
  it('⛔ is absent, while the app-owned row beside it is drawn', async () => {
    const m = await rail({ resumable: [OPENABLE], unresumable: [LOST_REF, USER_HOME] })
    expect(m.all('open-session-sess_userhome')).toHaveLength(0)
    // ⚑ **The paired positives, in the same mount.** Without them this passes over a rail that
    // drew nothing at all — the standing `brobot2-ssr-tests-pass-vacuously` rule, and the exact
    // shape of failure the `rail()` guard exists for.
    expect(visible(row(m, 'sess_openable'))).toBe(true)
    expect(visible(row(m, 'sess_lostref'))).toBe(true)
    // …and the row that stayed is the same KIND of row: unresumable, and a press opens it. The
    // rule is about whose conversation it is, not about whether it can be reopened.
    expect(row(m, 'sess_lostref').getAttribute('role')).toBe('button')
  })

  it('⛔ a LIVE conversation on a non-default profile IS drawn — the pair 154 needs (172)', async () => {
    // In one mount, exclude adopted conversations while still drawing the running app-owned
    // row. `profileId` distinguishes them. The positive prevents removal of the whole open
    // list from satisfying the exclusion.
    const live = createSessionRecord('sess_developer')
    live.meta = {
      sessionId: 'sess_developer',
      provider: 'claude',
      cwd: '/private/tmp/brobot-otherproj',
      profileId: 'developer',
      ref: {
        provider: 'claude',
        sessionId: 'live',
        cwd: '/private/tmp/brobot-otherproj',
        rotation: 0,
      },
      approvalMode: 'ask',
      planNeedsGoAhead: false,
      liveness: { state: 'live', since: NOW },
    } as never
    const m = await rail({ unresumable: [USER_HOME] }, { open: [live] })

    const drawn = m.q('open-session-sess_developer')
    expect(visible(drawn)).toBe(true)
    expect(drawn.textContent).toContain('brobot-otherproj')
    // …and the adopted row, in the same rail, still is not.
    expect(m.all('open-session-sess_userhome')).toHaveLength(0)
    // The Recent count uses the displayed rows and excludes the adopted row.
    expect(m.q('rail-count-recent').textContent).toBe('1 shown')
    // ⚠️ **571 · RE-AIMED, not stripped** (standing rule 26). ⛔ This read
    // `expect(m.all('no-open-sessions')).toHaveLength(0)`, and `571` deleted that element: the
    // empty sentence *"Nothing running. Start one above, or reopen one below."* was this rail's
    // only live signal and `EXT-008` §2 lists it by name as prose to take out of the column.
    // 🔴 **Left as it was, the assertion would have gone GREEN over a changed world** — a query
    // for a `data-cy` nothing renders is empty in every state, which is exactly the repair
    // `520`'s census was told not to make. ⚑ **What it pins NOW** is the claim the old line
    // carried and the new one cannot: this rail says nothing about what is RUNNING, in a mount
    // where something is. ⚠️ The paired positive is the drawn row above.
    expect(m.host.textContent).not.toContain('Nothing running')

    // ⛔ **And it is a way IN, not a line of text** (172 acceptance 6). A row that is drawn and does
    // nothing on a press would satisfy every assertion above and leave the conversation exactly as
    // unreachable as it was — which is what the ticket is about.
    expect(drawn.getAttribute('role')).toBe('button')
    drawn.click()
    expect(m.selected).toEqual(['sess_developer'])
  })

  /** ⚑ **D-017b · re-aimed** — the collapsed summary went with the group; the count is the list's. */
  it('⛔ takes the count with it', async () => {
    const m = await rail({ resumable: [OPENABLE], unresumable: [LOST_REF, USER_HOME] })
    // Three rows in, two out. A count still taken from the two host lists would promise a row
    // this list will not draw — `086`, and the failure `119` fixed on the scan button.
    expect(m.q('rail-count-recent').textContent).toBe('2 shown')
  })

  /**
   * ⚑ **D-017b · re-aimed** — the empty group's sentence went with the group. ⛔ What stays is §2's
   * ruling: nothing in this section points at the rows it does not show.
   */
  it('⚠️ a rail holding NOTHING BUT adopted rows draws none, and points nowhere', async () => {
    const m = await rail({ unresumable: [USER_HOME] })
    expect(m.all('open-session-sess_userhome')).toHaveLength(0)
    // ⚑ **2026-10-01 · a section with no rows is not drawn**, so a rail with none of ours draws
    // neither BroBot's section nor the other agents' — and the block says nothing at all.
    expect(m.host.querySelectorAll('[data-cy^="rail-section-"]')).toHaveLength(0)
    expect((m.q('rail-conversations').textContent ?? '').trim()).toBe('')
    unmountAll()

    // ⚑ The positive, one fact over: one conversation of ours beside the adopted row draws its
    // section, so the negatives below are about what a drawn section says.
    const ours = await rail({ unresumable: [USER_HOME, LOST_REF] })
    const section = ours.q('rail-conversations')
    expect(visible(section)).toBe(true)
    const said = section.textContent ?? ''
    expect(said).toContain('Recent')
    expect(ours.q('open-session-sess_lostref').textContent).toContain('recipe-worker')
    expect(ours.q('rail-count-recent').textContent).toBe('1 shown')
    // Keep adopted conversations visible only in the Sessions UI. The rail adds no hint,
    // badge, count, or other reference to the excluded rows.
    expect(said).not.toContain('Sessions')
    expect(said).not.toContain('All conversations')
    expect(said).not.toContain('own folder')
  })

  async function mountLibrary(rows: UnresumableSessionInfo[]) {
    ;(window as unknown as { api?: unknown }).api = {
      runtime: {
        listLibrary: async () => recordingPage(rows),
        listResumable: async () => [],
        listUnresumable: async () => rows,
      },
    }
    const view = mount(SessionLibrary, {}, { width: 1100, height: 900 })
    await expect.poll(() => view.all(rows.length ? 'library-rows' : 'library-empty').length).toBe(1)
    return view
  }

  it('⛔ and the Sessions page still has the row, with the controls the rail never had', async () => {
    const m = await mountLibrary([USER_HOME])

    // ⛔ **THE assertion that stops this fix becoming a deletion.** The same row, by the same id,
    // on the surface `119`/`120`/`121` were built for.
    const kept = m.host.querySelector('[data-session-id="sess_userhome"]') as HTMLElement | null
    expect(kept, 'the adopted row left the rail and the page too').not.toBeNull()
    expect(visible(kept!)).toBe(true)
    const said = kept!.textContent ?? ''
    expect(said, 'the full working directory, which the rail reduced to a label').toContain(
      '/Users/alex/dev/other/thing',
    )
    expect(said).toContain('imported')
    expect(kept!.querySelector('.conversation-row')).not.toBeNull()
    expect(m.q('library-read-sess_userhome').textContent).toContain('Open')

    // ⚑ **The page's own noun, and it has to agree with the item that navigates here** (§2b).
    expect(m.q('session-library').textContent).toContain('All conversations')
  })

  it('⚠️ …and the page says the same noun when it is holding nothing at all (§2b)', async () => {
    // The copy sweep reached this sentence too, and a string nothing asserts is a string the next
    // rename walks past. Both host lists empty, which is the only state that renders it.
    const m = await mountLibrary([])

    const said = m.q('library-empty').textContent ?? ''
    // ⚑ **D-017b** — *"becomes resumable"* went with the reopen: the page lists what is recorded.
    expect(said).toContain('No conversations yet.')
    expect(said).not.toContain('A session')
  })
})

it('keeps distinct turn endings on Open with hover and accessible descriptions', async () => {
  const finished = {
    ...OPENABLE,
    sessionId: 'finished',
    status: 'ended' as const,
    lastEnding: 'completed' as const,
  }
  const cut = { ...finished, sessionId: 'cut', lastEnding: 'ended' as const }
  const unknown = { ...finished, sessionId: 'unknown', lastEnding: 'unknown' as const }
  const imported = { ...USER_HOME, lastEnding: 'interrupted' as const }
  const rows = [finished, cut, unknown, imported]
  ;(window as unknown as { api?: unknown }).api = {
    runtime: {
      listLibrary: async () => recordingPage(rows),
      listResumable: async () => rows.slice(0, 3),
    },
  }
  const view = mount(SessionLibrary, {}, { width: 1100 })
  await expect.poll(() => view.all('library-read-finished').length).toBe(1)
  expect(view.q('library-read-finished').title).toBe('its last turn finished')
  expect(view.q('library-read-cut').title).toBe('it stopped while a turn was still running')
  expect(view.q('library-read-unknown').title).toBe(
    'a turn was still running, and this app never saw how it ended',
  )
  expect(view.q(`library-read-${imported.sessionId}`).title).toBe(
    'its last turn was stopped before it finished',
  )
  for (const row of rows) {
    const open = view.q(`library-read-${row.sessionId}`)
    expect(open.getAttribute('aria-description')).toBe(open.title)
  }
})
