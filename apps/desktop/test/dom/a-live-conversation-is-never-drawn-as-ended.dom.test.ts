import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import type { ResumableSessionInfo, UnresumableSessionInfo } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 421 · a live conversation is never drawn as ended — at the width the rail really is
 *
 * ⛔ **HO-023 §2.3, in the PO's words:** *"Listing it under **Closed conversations**, labelling it
 * **ended**, and offering **Reopen** — then refusing the reopen by naming a window that does not
 * exist — is four surfaces lying in sequence."* Three of those four are things a person READS off a
 * 200px column, and a string comparison cannot tell you whether they were readable.
 *
 * ## ⚑ D-017b · one list, so the claim got stronger
 *
 * ⚑ **The rail drew two sections until D-017b** — running conversations apart from closed ones —
 * and this file measured that the live one was never under *Closed* and never read *ended*. ⚑ There
 * is ONE list now (`conversation-list.ts`): every conversation is a row of it, whatever its process
 * is doing, pressing any row opens it in its full view, and NO row says *ended* — so the arms below
 * measure the live row beside a stopped one in the same list, and both beside one another window
 * holds, which says only where it is.
 *
 * ## ⚠️ Why a real engine, and why 200px
 *
 * ⛔ **`closed-rail.dom.test.ts`'s rule, and the reason is the same one**: *"the old surface was a
 * management page wedged into this column; every layout claim below is only worth making at the
 * real size."*
 *
 * ⚠️ **Every negative here is paired with a positive in the same mount** (`brobot2-ssr-tests-pass-
 * vacuously`): a fetch that never landed would satisfy *"the running row does not say ended"* by
 * drawing no rows at all, so the stopped row is always on screen beside it.
 */

const NOW = Date.now()

const base = {
  provider: 'codex' as const,
  cwd: '/Users/alex/dev/alpha',
  // ⚑ **D-016 · commit 7 · R2 — it holds no piece**, so a row is titled by its agent, as it was.
  named: null,
  approvalMode: 'ask' as const,
  profileId: 'worker',
  reasoningEffort: null,
  model: null,
  planMode: null,
  adoptedAt: null,
  hasTranscript: true,
  child: null,
  resumeRefusal: null,
  lastEnding: 'completed' as const,
  updatedAt: NOW - 240_000,
}

/** 🔴 The conversation an agent started: this app is running it and no window holds it. */
const UNWATCHED: ResumableSessionInfo = {
  ...base,
  sessionId: 'sess_unwatched',
  ref: { provider: 'codex', sessionId: 'thread-live', cwd: base.cwd, rotation: 0 },
  // ⚠️ **`idle` on purpose, and it is the same word the stopped row below carries.**
  status: 'idle',
  running: 'unwatched',
  state: { is: 'idle' },
}

/** ⚑ The control, in every test: a conversation nothing runs — its row status says `ended`. */
const STOPPED: ResumableSessionInfo = {
  ...base,
  sessionId: 'sess_stopped',
  cwd: '/Users/alex/dev/beta',
  ref: { provider: 'codex', sessionId: 'thread-over', cwd: '/Users/alex/dev/beta', rotation: 0 },
  status: 'ended',
  running: 'not-running',
  state: { is: 'idle' },
  updatedAt: NOW - 300_000,
}

/** …and one a second window is running, which is the row that says where it is. */
const IN_A_WINDOW: UnresumableSessionInfo = {
  sessionId: 'sess_elsewhere',
  provider: 'codex',
  cwd: '/Users/alex/dev/gamma',
  status: 'working',
  running: 'in-a-window',
  state: { is: 'active' },
  named: null,
  profileId: 'worker',
  adoptedAt: null,
  updatedAt: NOW - 60_000,
  hasTranscript: true,
  lastEnding: null,
  foundInUserHome: false,
  restoredFromBundle: false,
  reason: 'no turn was ever taken in this one, so there is nothing to carry on from',
}

type RailApi = {
  runtime: {
    listResumable: () => Promise<ResumableSessionInfo[]>
    listUnresumable: () => Promise<UnresumableSessionInfo[]>
  }
}

const stubbed = (): { api?: RailApi } => window as unknown as { api?: RailApi }

/**
 * The rail at 200px, with both host lists stubbed.
 *
 * ⚠️ **A macrotask before the tick** — `closed-rail.dom.test.ts` learned why: the fetch is a
 * `Promise.all` inside a `try`, so the number of microtask hops before the first painted row is an
 * implementation detail this file does not own.
 */
async function rail(
  rows: { resumable?: ResumableSessionInfo[]; unresumable?: UnresumableSessionInfo[] } = {},
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
    },
    // ⛔ **200px, the width the rail really is.**
    { width: 200, height: 900 },
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  return Object.assign(m, { selected })
}

const rowOf = (m: Mounted, sessionId: string): HTMLElement => m.q(`open-session-${sessionId}`)

afterEach(() => {
  unmountAll()
  delete stubbed().api
})

describe('the rail draws a running conversation as a conversation, never as ended (421, D-017b)', () => {
  it('🔴 D-017b · ONE list: the running conversation and a stopped one are rows of it, under one heading', async () => {
    const m = await rail({ resumable: [UNWATCHED, STOPPED] })

    // ⚑ **2026-10-01 · both are the worker's**, so the one heading over them is the other agents'
    // section's — the rail's conversations are in BroBot's section and the other agents'.
    const list = m.q('rail-section-agents')
    expect(visible(list)).toBe(true)
    expect(list.textContent).toContain('Other agents')
    expect(m.q('rail-count-agents').textContent).toBe('2')
    // ⚑ **Both rows, in the same list** — the positive the negatives below stand on.
    expect(m.all(`open-session-${UNWATCHED.sessionId}`)).toHaveLength(1)
    expect(m.all(`open-session-${STOPPED.sessionId}`)).toHaveLength(1)
    expect(list.contains(rowOf(m, UNWATCHED.sessionId))).toBe(true)
    expect(list.contains(rowOf(m, STOPPED.sessionId))).toBe(true)
    // ⛔ **No section per state**: no running section, no closed section, and none of their words.
    expect(m.all('rail-running-unwatched')).toHaveLength(0)
    expect(m.all('rail-closed-conversations')).toHaveLength(0)
    expect(m.host.textContent).not.toContain('Closed conversations')
    expect(m.host.textContent).not.toContain('Not open in this window')
  })

  it('🔴 the live row does not say ended — and neither does the stopped one', async () => {
    const m = await rail({ resumable: [UNWATCHED, STOPPED] })

    const live = rowOf(m, UNWATCHED.sessionId)
    const over = rowOf(m, STOPPED.sessionId)
    const plate = (row: HTMLElement): HTMLElement =>
      row.querySelector('[data-cy="agent-state"]') as HTMLElement

    // ⚑ **The plates are drawn** — the positive the two negatives are measured against.
    expect(plate(live)).not.toBeNull()
    expect(plate(over)).not.toBeNull()
    // 🔴 **Neither channel says ended**, for either row: `data-being` is what the CSS draws the
    // underline from and `aria-label` is what a screen reader says. `418` read `ended` off this exact
    // attribute for a conversation whose provider was mid-answer. ⚑ **D-017b** — and a stopped one
    // is not *ended* either: a message continues it.
    for (const row of [live, over]) {
      expect(plate(row).getAttribute('data-being'), row.dataset.cy).toBeNull()
      expect(plate(row).getAttribute('aria-label'), row.dataset.cy).not.toContain('ended')
      expect(row.textContent, row.dataset.cy).not.toContain('ended')
      // ⚑ **What the row SAYS is the one state** — the host's word, the one `list_agents` says.
      expect(row.textContent, row.dataset.cy).toContain('codex · idle')
    }
    // ⛔ **No process word, and no where-word that is a process word** (`05` rule 5): it said
    // *"not open in any window"* (D-017 · F024), and before that *"nobody is watching it"*.
    expect(live.textContent).not.toContain('not open in any window')
    expect(live.textContent).not.toContain('nobody')
  })

  it('🔴 pressing it opens it — the one press, and the stopped one takes the same', async () => {
    const m = await rail({ resumable: [UNWATCHED, STOPPED] })
    const live = rowOf(m, UNWATCHED.sessionId)

    // ⛔ **A real control, not a `div`** — `118`'s rule is that a row which can act is a button.
    expect(live.tagName).toBe('BUTTON')
    // ⛔ **No gesture of its own** — *Take it over and open it* went with the fork.
    expect(live.dataset.gesture).toBeUndefined()
    expect(live.getAttribute('aria-label')).not.toBe('Take it over and open it')

    live.click()
    await nextTick()
    expect(m.selected).toEqual([UNWATCHED.sessionId])

    // ⚑ **The control, same mount, same press**: the stopped conversation opens the same way.
    rowOf(m, STOPPED.sessionId).click()
    await nextTick()
    expect(m.selected).toEqual([UNWATCHED.sessionId, STOPPED.sessionId])
  })

  it('⛔ a conversation another window holds says where it is — never ended — and opens like any other', async () => {
    const m = await rail({ resumable: [STOPPED], unresumable: [IN_A_WINDOW] })
    const held = rowOf(m, IN_A_WINDOW.sessionId)

    expect(held.textContent).toContain('open in another window')
    expect(held.textContent).not.toContain('ended')
    // ⚑ **The control**: the row beside it does not say it.
    expect(rowOf(m, STOPPED.sessionId).textContent).not.toContain('open in another window')

    // ⚑ **D-017b · one press everywhere** — it opens in its view, where a message says to switch
    // windows (`HELD_ELSEWHERE`); the row itself is not inert any more.
    held.click()
    await nextTick()
    expect(m.selected).toEqual([IN_A_WINDOW.sessionId])
  })

  it('⚑ every row is the SAME row — one rule, not a copy per state', async () => {
    const m = await rail({ resumable: [UNWATCHED, STOPPED] })
    const live = rowOf(m, UNWATCHED.sessionId)
    const over = rowOf(m, STOPPED.sessionId)

    // ⛔ **`151`'s whole mechanical claim.** *"Looks exactly like the row above it"* is a property of
    // shared CSS. ⚠️ Read from the COMPUTED style, because a rule that does not match is invisible in
    // the source (`scoped-css-is-unmeasurable-until-something-mounts-it`).
    const columns = (row: HTMLElement): string => getComputedStyle(row).gridTemplateColumns
    expect(columns(live)).toBe(columns(over))
    // …and it is a real three-column grid rather than two empty strings compared with each other.
    expect(columns(live).split(' ')).toHaveLength(3)
    expect(live.getBoundingClientRect().height).toBe(over.getBoundingClientRect().height)
  })

  it('⚠️ no section is drawn per state, and the one list fits the column', async () => {
    const quiet = await rail({ resumable: [STOPPED] })
    // ⛔ **`106` and `031`**: a heading over no rows teaches a person to stop reading this part of
    // the rail — and since D-017b there is no per-state heading to draw at all.
    expect(quiet.all('rail-running-unwatched')).toHaveLength(0)
    // ⚑ …and the mount really did paint: the row's words are there to read.
    expect(rowOf(quiet, STOPPED.sessionId).textContent).toContain('codex')
    quiet.unmount()

    const m = await rail({ resumable: [UNWATCHED, STOPPED], unresumable: [IN_A_WINDOW] })
    const aside = m.host.querySelector('.rail') as HTMLElement
    // ⛔ **The column does not scroll sideways**, which is the one layout claim a 200px rail owes.
    expect(aside.scrollWidth).toBeLessThanOrEqual(aside.clientWidth)
    for (const id of [UNWATCHED.sessionId, IN_A_WINDOW.sessionId, STOPPED.sessionId]) {
      const row = rowOf(m, id)
      expect(row.getBoundingClientRect().width, row.dataset.cy).toBeLessThanOrEqual(200)
    }
  })
})
