import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import TeamForest from '../../src/renderer/src/components/TeamForest.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { DRAWER_W_MIN, DRAWER_W_MAX } from '../../src/renderer/src/lib/drawer'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import type { LedgerWalk, LedgerWalkKind } from '../../src/shared/questions'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../../src/shared/who-called-whom'
import { assertDrawn, cutsOf, drawnReady } from './drawn'
import { conv, forestDrawn, task, viewOf } from './forest-fixture'
import { META, drawerProps, mount, unmountAll, visible } from './harness'

/**
 * # ⚑ The agent card draws its current task
 *
 * The Current task `CardSection` draws the active piece’s label, state word, title, and
 * brief. Clamp the brief to three lines with “Show more” below; show a quiet box when no
 * piece is current.
 *
 * ⚑ Measured in a real engine at every width the drawer takes. ⛔ The controls: a short brief offers
 * no *Show more*, and the card of an agent under the strip — whose transcript this window does not
 * hold — draws its piece without a brief rather than with a guessed one.
 */

afterEach(() => {
  unmountAll()
  const cast = useWhoCalledWhom()
  cast.reading.value = null
  cast.goTo.value = null
})

const NOW = Date.now()

const LONG_BRIEF = [
  'Go through a few states, so the person can watch how the window shows each.',
  'Take screenshots, compare the differences between states, and report anything unusual.',
  'Then write it all up in a note for the team so they can read it tomorrow morning,',
  'with every screenshot named after the state it shows and the one that looked wrong first.',
].join(' ')

const walk = <Row>(rows: readonly Row[], kind: LedgerWalkKind): LedgerWalk<Row> => ({
  rows,
  walk: kind,
  ledgers: rows.length,
  rowsUnread: 0,
})

const edge = (over: Partial<WorkEdge> = {}): WorkEdge => ({
  piece: 'work_63',
  label: 'W63',
  title: 'Inspect the window states',
  from: 'sess_parent',
  fromIdentity: 'brobot',
  to: META.sessionId,
  toIdentity: 'inspector',
  state: 'working',
  givenAt: NOW - 120_000,
  endedAt: null,
  ...over,
})

const answer = (over: Partial<WhoCalledWhom> = {}): WhoCalledWhom => ({
  conversation: META.sessionId,
  parent: null,
  children: walk<SpawnEdge>([], 'every-conversation-this-one-spawned'),
  workGivenOut: walk<WorkEdge>([], 'every-conversation-this-one-gave-work-to'),
  workTakenIn: walk<WorkEdge>([], 'every-piece-of-work-this-one-was-given'),
  readAt: NOW,
  ...over,
})

/** ⚑ The piece's brief, arrived in this conversation as the turn that opened it. */
const briefed = (brief: string) => {
  const state = createTranscript()
  const events = [
    {
      type: 'work_given',
      piece: 'work_63',
      label: 'W63',
      parent: 'work_1',
      givenBy: 'sess_parent',
      title: 'Inspect the window states',
      brief,
    },
    {
      type: 'user_turn',
      text: brief,
      relayedFrom: 'sess_parent',
      relayedFromProfile: 'brobot',
      piece: 'work_63',
      label: 'W63',
    },
  ] as unknown as TranscriptEvent[]
  for (const event of events) applyEvent(state, event, NOW)
  return state
}

function show(read: WhoCalledWhom, state = createTranscript(), width = DRAWER_W_MIN) {
  const cast = useWhoCalledWhom()
  cast.reading.value = { conversation: META.sessionId, read, answered: true, atWork: null }
  return mount(SessionDrawer as never, drawerProps({ state, shown: state }), {
    width,
    height: 900,
  })
}

const said = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('the agent card draws its current task', () => {
  for (const width of [DRAWER_W_MIN, 460, DRAWER_W_MAX]) {
    it(`🔴 at ${String(width)}px — under the agent, the piece it is on: label, state, title and brief`, async () => {
      const m = show(
        answer({ workTakenIn: walk([edge()], 'every-piece-of-work-this-one-was-given') }),
        briefed(LONG_BRIEF),
        width,
      )
      await drawnReady()
      const box = m.q('card-task')
      // ⚑ Under the agent, never above it.
      expect(m.q('session-bot').getBoundingClientRect().bottom).toBeLessThanOrEqual(
        box.getBoundingClientRect().top,
      )
      assertDrawn(m.q('cast-taken-heading'), 'the Current task heading')
      expect(said(m.q('cast-taken-heading'))).toBe('Current task')
      const line = m.q('cast-taken-work')
      expect(said(line)).toContain('W63')
      expect(said(line)).toContain('being worked on')
      expect(said(line)).toContain('Inspect the window states')
      assertDrawn(line.querySelector<HTMLElement>('.tword')!, 'the current piece’s state in words')
      // ⚑ The brief, cut at three lines, and the rest one press away.
      const brief = m.q('cast-work-brief')
      expect(visible(brief)).toBe(true)
      expect(brief.textContent).toBe(LONG_BRIEF)
      expect(cutsOf(brief), 'the long brief was not cut').not.toEqual([])
      expect(m.all('card-task-empty')).toHaveLength(0)
    })
  }

  it('🔴 Show more draws the whole brief, and Show less cuts it again', async () => {
    const m = show(
      answer({ workTakenIn: walk([edge()], 'every-piece-of-work-this-one-was-given') }),
      briefed(LONG_BRIEF),
      DRAWER_W_MIN,
    )
    await drawnReady()
    const more = m.q('cast-work-brief-more')
    expect(said(more)).toBe('Show more')
    more.click()
    await nextTick()
    assertDrawn(m.q('cast-work-brief'), 'the whole brief, after Show more')
    expect(said(m.q('cast-work-brief-more'))).toBe('Show less')
    m.q('cast-work-brief-more').click()
    await nextTick()
    const brief = m.q('cast-work-brief')
    expect(cutsOf(brief), 'Show less did not cut the brief again').not.toEqual([])
  })

  it('⛔ THE CONTROL — a brief that fits offers no Show more', async () => {
    const m = show(
      answer({ workTakenIn: walk([edge()], 'every-piece-of-work-this-one-was-given') }),
      briefed('Check the header.'),
    )
    await drawnReady()
    expect(said(m.q('cast-work-brief'))).toBe('Check the header.')
    expect(m.all('cast-work-brief-more')).toHaveLength(0)
  })

  it('⛔ THE CONTROL — no work given draws the quiet box, and no list', async () => {
    const m = show(answer())
    await drawnReady()
    const empty = m.q('card-task-empty')
    expect(visible(empty)).toBe(true)
    expect(said(empty.querySelector('.says')!)).toBe('No current task')
    expect(said(empty.querySelector('.hint')!)).toBe('Work given to this agent appears here.')
    expect(m.all('cast-taken-work')).toHaveLength(0)
  })

  it('⛔ THE CONTROL — a kid in the graph draws its piece, and no brief it cannot read', async () => {
    // ⚑ **The graph is the Team page's forest since 2026-09-30** — a kid's card carries the piece it
    // holds, and this window holds no transcript of the kid, so no brief is drawn rather than a
    // guessed one.
    const m = mount(
      TeamForest,
      {
        view: viewOf([
          conv(META.sessionId, null),
          conv('sess_child', META.sessionId),
          task('sess_child', 'work_out', 'W1.1', 'Inspect the window states', META.sessionId),
        ]),
      },
      { width: 1000, height: 700 },
    )
    await forestDrawn()
    const kid = m.q('forest-row-sess_child')
    expect(said(kid.querySelector('[data-cy="forest-row-work_out"]')!)).toContain('W1.1')
    expect(said(kid)).toContain('Inspect the window states')
    expect(m.all('cast-work-brief')).toHaveLength(0)
  })
})
