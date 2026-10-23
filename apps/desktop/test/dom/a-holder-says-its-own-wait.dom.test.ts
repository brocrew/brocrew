import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { conversationList } from '../../src/renderer/src/lib/conversation-list'
import { clockTime } from '../../src/shared/clock'
import type { ResumableSessionInfo } from '../../src/shared/runtime-ipc'
import type { WaitOn } from '../../src/shared/tasks'
import type { WorkEdge } from '../../src/shared/who-called-whom'
import { drawnReady } from './drawn'
import { META, mount, paneProps, record, unmountAll } from './harness'
import { identities, NOW, workerRows } from './parallel-workers-fixture'

/**
 * A conversation that holds a piece with a typed wait says that wait on its own page — in its
 * header, on its agent card and on its Current task chip — in the words its giver's page uses.
 */

const STATUS = 'Plan shared; coaching week in progress. Waiting on the next check-in.'
const AT = NOW + 3_600_000

const cast = useWhoCalledWhom()

afterEach(async () => {
  unmountAll()
  cast.listedConversations.value = null
  cast.reading.value = null
  await page.viewport(1200, 808)
})

const read = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** Mira's row, idle, holding a piece with the given wait. */
function holder(on: WaitOn | null, agentName?: string, untyped = false): ResumableSessionInfo {
  const [row] = workerRows(1)
  const base: ResumableSessionInfo = {
    ...row!,
    sessionId: META.sessionId,
    state: { is: 'idle' },
    running: 'not-running',
    status: 'idle',
    named: { label: 'W90.1', title: 'Coach the person through a week of openings' },
  }
  if (untyped) {
    return { ...base, waitingOnPurpose: { label: 'W90.1', status: STATUS } }
  }
  return on === null
    ? base
    : {
        ...base,
        waitingOnPurpose: {
          label: 'W90.1',
          status: STATUS,
          on,
          ...(agentName === undefined ? {} : { agentName }),
        },
      }
}

const given: WorkEdge = {
  piece: 'work_901',
  label: 'W90.1',
  title: 'Coach the person through a week of openings',
  from: 'menu-conversation',
  fromIdentity: 'brobot',
  to: META.sessionId,
  toIdentity: 'recipe-worker',
  state: 'waiting-on-purpose',
  givenAt: NOW - 60_000,
  endedAt: null,
}

async function ownPage(on: WaitOn | null, agentName?: string, untyped = false) {
  const walk = <Row>(rows: Row[], kind: string) =>
    ({ rows, walk: kind, ledgers: rows.length, rowsUnread: 0 }) as never
  cast.reading.value = {
    conversation: META.sessionId,
    read: {
      conversation: META.sessionId,
      parent: null,
      children: walk([], 'every-conversation-this-one-spawned'),
      workGivenOut: walk([], 'every-conversation-this-one-gave-work-to'),
      workTakenIn: walk([given], 'every-piece-of-work-this-one-was-given'),
      readAt: NOW,
    },
    answered: true,
    atWork: null,
  }
  cast.listedConversations.value = conversationList({
    resumable: [holder(on, agentName, untyped)],
    unresumable: [],
    identities: identities(1).identities,
  })
  await page.viewport(1400, 900)
  const m = mount(
    ConversationPane,
    paneProps({
      record: record([{ type: 'status', state: 'idle' } as never]),
      drawerOpen: true,
    }),
    { width: 1400, height: 900 },
  )
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
  await drawnReady()
  return m
}

const WAITS: readonly {
  readonly kind: string
  readonly on: WaitOn
  readonly agentName?: string
  readonly says: string
}[] = [
  { kind: 'time', on: { kind: 'time', at: AT }, says: `waiting until ${clockTime(AT)}` },
  {
    kind: 'agent',
    on: { kind: 'agent', piece: 'work_902', label: 'W90.2' },
    agentName: 'Noor',
    says: 'waiting on Noor',
  },
  { kind: 'person', on: { kind: 'person', request: 'req_1' }, says: 'waiting on you' },
]

describe('a holder’s own page says its typed wait', () => {
  for (const wait of WAITS) {
    it(`a ${wait.kind} wait: header, agent card and Current task say it`, async () => {
      const m = await ownPage(wait.on, wait.agentName)
      const header = read(m.q('session-status'))
      expect(header).toBe(wait.says.charAt(0).toUpperCase() + wait.says.slice(1))
      expect(read(m.q('session-bot-word'))).toBe(wait.says)
      expect(read(m.q('cast-taken-work').querySelector('.tword')!)).toBe(wait.says)
      expect(m.all('cast-work-why')).toEqual([])
    })
  }

  it('the control: a wait that names nothing leaves the header and card as they were', async () => {
    const m = await ownPage(null, undefined, true)
    expect(read(m.q('session-status'))).toBe('Idle')
    expect(read(m.q('session-bot-word'))).toBe('idle')
  })

  it('the control: an idle conversation with no wait still reads idle', async () => {
    const m = await ownPage(null)
    expect(read(m.q('session-status'))).toBe('Idle')
    expect(read(m.q('session-bot-word'))).toBe('idle')
  })
})
