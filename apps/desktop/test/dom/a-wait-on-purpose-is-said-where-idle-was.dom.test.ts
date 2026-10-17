import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, shallowReactive } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import WorkingTogether from '../../src/renderer/src/components/WorkingTogether.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import type { RailSays } from '../../src/renderer/src/lib/agent-state'
import { conversationList } from '../../src/renderer/src/lib/conversation-list'
import type { ResumableSessionInfo } from '../../src/shared/runtime-ipc'
import type { TaskState } from '../../src/shared/tasks'
import type { WorkEdge } from '../../src/shared/who-called-whom'
import { assertClippedButTold, assertDrawn, drawnReady } from './drawn'
import { META, mount, paneProps, record, unmountAll } from './harness'
import { activity, identities, NOW, store, workerRows } from './parallel-workers-fixture'

/**
 * A helper whose piece is marked waiting on purpose reads so wherever it read "idle" — the rail, its
 * Sub agents card and Team — with the piece's status line as the detail, and its giver's header says
 * whom it waits on and why. A helper that is idle with no mark still reads "idle".
 */

const STATUS =
  'Plan written and shared; coaching week in progress… Waiting for the person to check in.'
const FIRST = 'Plan written and shared; coaching week in progress…'
const HOLDER = 'recipe-1'

const cast = useWhoCalledWhom()

afterEach(async () => {
  unmountAll()
  cast.listedConversations.value = null
  cast.railSays.value = null
  cast.reading.value = null
  delete (window as { api?: unknown }).api
  await page.viewport(1200, 808)
})

const settle = async (): Promise<void> => {
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
  await drawnReady()
}

const read = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** Mira's one worker, idle and not running unless at work, its piece marked waiting on purpose or not. */
function holder(marked: boolean, atWork = false): ResumableSessionInfo {
  const [row] = workerRows(1)
  return {
    ...row!,
    state: { is: atWork ? 'active' : 'idle' },
    running: atWork ? 'unwatched' : 'not-running',
    status: atWork ? 'working' : 'idle',
    named: { label: 'W90.1', title: 'Coach the person through a week of openings' },
    ...(marked ? { waitingOnPurpose: { label: 'W90.1', status: STATUS } } : {}),
  }
}

async function rail(marked: boolean, atWork = false) {
  const rows = [holder(marked, atWork)]
  window.api = {
    runtime: { listResumable: async () => rows, listUnresumable: async () => [] },
  } as never
  const m = mount(
    SideRail,
    { open: [], activeId: null, place: null, agents: identities(1), collapsed: false },
    { width: 251.68, height: 1000 },
  )
  await settle()
  return m
}

describe('the rail', () => {
  it('says "waiting on purpose", with the status line on its hover', async () => {
    const m = await rail(true)
    const word = m.q(`rail-state-word-${HOLDER}`)
    expect(read(word)).toBe('waiting on purpose')
    expect(word.title).toBe(`waiting on purpose: ${STATUS}`)
    assertDrawn(word, 'the wait on purpose on the rail', m.host)
  })

  it('the control: a helper idle with no mark still reads "idle"', async () => {
    const m = await rail(false)
    expect(read(m.q(`rail-state-word-${HOLDER}`))).toBe('idle')
  })

  it('the control: a helper at work keeps its word, though its piece is marked', async () => {
    const m = await rail(true, true)
    const word = m.q(`rail-state-word-${HOLDER}`)
    expect(read(word)).toBe('active')
    expect(word.title).not.toContain('waiting on purpose')
  })
})

/** The giver's one give to the helper, in the state the host reads it. */
const give = (state: TaskState): WorkEdge => ({
  piece: 'work_901',
  label: 'W90.1',
  title: 'Coach the person through a week of openings',
  from: META.sessionId,
  fromIdentity: 'brobot',
  to: HOLDER,
  toIdentity: 'recipe-worker',
  state,
  givenAt: NOW - 60_000,
  endedAt: null,
})

function castFor(state: TaskState, marked: boolean): void {
  const walk = <Row>(rows: Row[], kind: string) =>
    ({ rows, walk: kind, ledgers: rows.length, rowsUnread: 0 }) as never
  cast.reading.value = {
    conversation: META.sessionId,
    read: {
      conversation: META.sessionId,
      parent: null,
      children: walk([], 'every-conversation-this-one-spawned'),
      workGivenOut: walk([give(state)], 'every-conversation-this-one-gave-work-to'),
      workTakenIn: walk([], 'every-piece-of-work-this-one-was-given'),
      readAt: NOW,
    },
    answered: true,
    atWork: null,
  }
  cast.listedConversations.value = conversationList({
    resumable: [holder(marked)],
    unresumable: [],
    identities: identities(1).identities,
  })
}

describe('the Sub agents card', () => {
  const card = async (marked: boolean) => {
    // The card says what the rail says of the agent: the rail is read first, as on the screen.
    const r = await rail(marked)
    cast.railSays.value = r.vm.says as ReadonlyMap<string, RailSays>
    castFor(marked ? 'waiting-on-purpose' : 'working', marked)
    const m = mount(
      WorkingTogether,
      {
        reading: cast.reading.value,
        conversation: META.sessionId,
        identities: identities(1).identities,
        canOpen: true,
      },
      { width: 560, height: 1000 },
    )
    await settle()
    return m
  }

  it('says "waiting on purpose", with the status line on its title', async () => {
    const m = await card(true)
    const word = m.q(`cast-tile-word-${HOLDER}`)
    expect(read(word)).toBe('waiting on purpose')
    expect(word.title).toBe(`waiting on purpose: ${STATUS}`)
    assertDrawn(word, 'the wait on purpose on the card', m.host)
    // Under the word, what it waits for: the status line, cut to the card, whole on its title.
    const line = m.q(`cast-tile-on-purpose-${HOLDER}`)
    expect(read(line)).toBe(STATUS)
    expect(line.title).toBe(STATUS)
  })

  it('the control: a helper idle with no mark still reads "idle"', async () => {
    const m = await card(false)
    expect(read(m.q(`cast-tile-word-${HOLDER}`))).toBe('idle')
    expect(m.all(`cast-tile-on-purpose-${HOLDER}`)).toEqual([])
  })
})

describe('Team', () => {
  const team = async (marked: boolean, atWork = false) => {
    const rows = [holder(marked, atWork)]
    const props = shallowReactive({
      agents: identities(1),
      store,
      beingDone: activity(rows),
      conversations: conversationList({
        resumable: rows,
        unresumable: [],
        identities: identities(1).identities,
      }),
    })
    const m = mount(
      defineComponent(() => () => h(TeamWorkspace, props)),
      {},
      { width: 760, height: 1200 },
    )
    await settle()
    return m
  }

  it('says "waiting on purpose", with the status line on its title', async () => {
    const m = await team(true)
    const word = m.q(`team-worker-${HOLDER}`).querySelector<HTMLElement>('.team-now')!
    expect(read(word)).toBe('waiting on purpose')
    expect(word.title).toBe(`waiting on purpose: ${STATUS}`)
    assertDrawn(word, 'the wait on purpose on Team', m.host)
  })

  it('the control: a helper idle with no mark still reads "idle"', async () => {
    const m = await team(false)
    const word = m.q(`team-worker-${HOLDER}`).querySelector<HTMLElement>('.team-now')!
    expect(read(word)).toBe('idle')
  })

  it('the control: a helper at work keeps its word, though its piece is marked', async () => {
    const m = await team(true, true)
    const word = m.q(`team-worker-${HOLDER}`).querySelector<HTMLElement>('.team-now')!
    expect(read(word)).toBe('active')
  })
})

describe('the giver’s header', () => {
  const giver = async (state: TaskState, marked: boolean) => {
    castFor(state, marked)
    await page.viewport(1200, 808)
    const m = mount(
      ConversationPane,
      paneProps({
        record: record([{ type: 'status', state: 'idle' } as never]),
        waiting: 'waiting-on-a-worker',
        workWith: ['Mira (the owner of W90.1 · Coach the person through a week of openings)'],
      }),
      { width: 1200, height: 808 },
    )
    await settle()
    return m
  }

  it('names whom it waits on and why: the first sentence, the status line whole on its title', async () => {
    const m = await giver('waiting-on-purpose', true)
    const word = m.q('session-status')
    expect(read(word)).toBe(`Waiting on Mira, who is waiting on purpose: ${FIRST}`)
    expect(word.title).toBe(`Waiting on Mira, who is waiting on purpose: ${STATUS}`)
    // The sentence is cut to the header's width, and its title says it whole.
    assertClippedButTold(word, 'the giver’s wait on purpose', m.host)
  })

  it('the control: a give still being worked on reads as before', async () => {
    const m = await giver('working', false)
    expect(read(m.q('session-status'))).toBe('Waiting on another agent')
  })
})
