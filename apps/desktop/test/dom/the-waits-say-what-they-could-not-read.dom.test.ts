import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import TeamForest from '../../src/renderer/src/components/TeamForest.vue'
import { createSessionRecord } from '../../src/renderer/src/lib/session-record'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import { forestView } from '../../src/renderer/src/lib/the-forest'
import type { CreatedSession } from '../../src/shared/runtime-ipc'
import type { WhatEachConversationIsWaitingOn } from '../../src/shared/tasks'
import type { ForestNode, TheWholeForest } from '../../src/shared/the-whole-forest'
import { assertDrawn, drawnReady } from './drawn'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * # 🔴 685 · §2.3 — the waits reading's unread rows, on the rail and on the Team page (`676` F-R18a)
 *
 * ⚑ **The derivation is `the-waits-say-what-they-could-not-read.test.ts`**; this file is the drawing
 * — the line under the rail's rows at `--rail-w` (251.68) and at 266.2, drawn whole, and the forest's
 * line beside its own count. ⛔ Every positive has its control on the same mount shape.
 */

const NOW = 1_700_000_000_000
/** ⚑ The waits count's line — a plate may read *idle* while it waits. */
const LINE = (n: number): string =>
  `This may not be accurate ${String(n)} ${n === 1 ? 'row' : 'rows'} of this app’s record could not be read, so a conversation shown here may be waiting without saying so.`
/** The forest walk's own line (`678`). */
const WORK_LINE = (n: number): string =>
  `This may not be accurate ${String(n)} ${n === 1 ? 'row' : 'rows'} of this app’s record could not be read, so a piece of work may be missing here, or its state may be wrong.`
const said = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

function conversation(sessionId: string): unknown {
  const record = createSessionRecord(sessionId)
  record.meta = {
    sessionId,
    provider: 'claude',
    cwd: '/Users/alex/dev/brobot',
    profileId: 'default',
    liveness: { state: 'live', since: NOW },
  } as CreatedSession
  record.phase = 'open'
  applyEvent(record.control, { type: 'status', state: 'idle' }, NOW)
  return record
}

const reading = (rowsUnread: number, covers = ['sess_a']): WhatEachConversationIsWaitingOn => ({
  readAt: NOW,
  conversations: covers.map((one) => ({
    conversation: one,
    identity: 'default',
    waiting: null,
    work: null,
  })),
  rowsUnread,
})

async function rail(
  width: number,
  waiting: WhatEachConversationIsWaitingOn | null,
): Promise<Mounted> {
  const stub = window as unknown as { api?: unknown }
  stub.api = {
    runtime: {
      listResumable: () => Promise.resolve([]),
      listUnresumable: () => Promise.resolve([]),
    },
  }
  const m = mount(
    SideRail,
    {
      open: [conversation('sess_a'), conversation('sess_b')],
      activeId: null,
      place: null,
      waiting,
    },
    { width, height: 900 },
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  await drawnReady()
  return m
}

afterEach(async () => {
  unmountAll()
  await page.viewport(1100, 900)
})

describe('685 §2.3 · the rail says it once, under the rows it qualifies', () => {
  for (const width of [251.68, 266.2]) {
    it(`🔴 at ${String(width)}px — the one sentence, drawn whole, below the last row`, async () => {
      const m = await rail(width, reading(2))
      const line = m.q('rail-waits-unread')
      expect(said(line)).toBe(LINE(2))
      assertDrawn(line, 'the waits reading’s unread line')
      // ⚑ inside the open-conversations section, and under its LAST row
      const last = m.q('open-session-sess_b')
      expect(line.parentElement?.contains(last)).toBe(true)
      expect(line.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        last.getBoundingClientRect().bottom - 1,
      )
      // ⚑ once — however many rows it covers
      expect(m.all('rail-waits-unread')).toHaveLength(1)
    })
  }

  it('⛔ the controls — nothing unread; nobody looked; a reading that covers no row here', async () => {
    for (const waiting of [reading(0), null, reading(2, ['sess_elsewhere'])]) {
      const m = await rail(251.68, waiting)
      expect(m.all('rail-waits-unread')).toHaveLength(0)
      // ⚑ …and the rows are still drawn, so the absence is about the line and not the mount
      expect(m.all('open-session-sess_a')).toHaveLength(1)
      unmountAll()
    }
  })
})

const node = (id: string): ForestNode =>
  ({
    node: 'a-conversation',
    conversation: id,
    under: { is: 'the-person' },
    identity: 'worker',
    provider: 'claude',
    status: 'idle',
    running: 'unwatched',
    standsInFor: [],
    inItsPlace: null,
    startedAt: NOW - 60_000,
    updatedAt: NOW - 1_000,
    spawnedAt: null,
    spawnReason: null,
  }) as ForestNode

const view = (forestUnread: number, waits: WhatEachConversationIsWaitingOn | null) =>
  forestView({
    forest: {
      readAt: NOW,
      nodes: {
        rows: [node('sess_a')],
        walk: 'every-conversation-this-app-placed',
        ledgers: 1,
        rowsUnread: forestUnread,
      },
      conversations: 1,
      heldByNoAgent: 0,
    } as TheWholeForest,
    atWork: null,
    waits,
    identities: null,
    held: new Set<string>(),
  })!

describe('685 §2.3 · the Team page’s forest draws the waits count beside its own', () => {
  it('🔴 forest 3 and waits 2 — two lines, two counts, never one summed line', async () => {
    // ⚠️ The page is sized to hold the box — a box wider than the viewport is cut by `<body>`.
    await page.viewport(1300, 900)
    const m = mount(TeamForest, { view: view(3, reading(2)) }, { width: 1200, height: 900 })
    await drawnReady()
    expect(said(m.q('forest-rows-unread'))).toBe(WORK_LINE(3))
    expect(said(m.q('forest-waits-unread'))).toBe(LINE(2))
    assertDrawn(m.q('forest-waits-unread'), 'the forest’s waits line')
    expect(m.host.textContent).not.toContain('5 rows')
  })

  it('⛔ the control — waits 0 draws no waits line, and the forest’s own still stands', () => {
    const m = mount(TeamForest, { view: view(3, reading(0)) }, { width: 1200, height: 900 })
    expect(m.all('forest-waits-unread')).toHaveLength(0)
    expect(said(m.q('forest-rows-unread'))).toBe(WORK_LINE(3))
  })
})
