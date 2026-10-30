import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import PersonsQueue from '../../src/renderer/src/components/PersonsQueue.vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import type { AttentionRequest } from '../../src/renderer/src/lib/attention'
import { homeAttention } from '../../src/renderer/src/lib/home-attention'
import {
  cornerHead,
  usePersonsQueue,
  waitingOnWhoWroteView,
  type PersonsQueueRow,
  type PersonsQueueView,
  type WaitingOnWhoWroteView,
} from '../../src/renderer/src/lib/persons-queue'
import { createSessionStore } from '../../src/renderer/src/lib/session-store'
import { OPEN_THE_CONVERSATION } from '../../src/renderer/src/lib/taking-over'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import type {
  LedgerWalk,
  LedgerWalkKind,
  PersonsDecision,
  PersonsQuestion,
} from '../../src/shared/questions'
import type { WaitingOnWhoWrote } from '../../src/shared/waiting-on-who-wrote'
import { everythingOverTheWire } from '../lib/the-wire'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * F097 · the work whose agent answered a person is drawn where what needs them is, and counted.
 *
 * A piece a conversation gave, whose holder's latest turn a person's own words opened and that
 * ended with it open, waits on that person. The host lists it (`waitingOnWhoWroteForAPerson`) and
 * `persons-queue.ts` carries it beside the queue's rows: *Waiting on you* draws it as a group of its
 * own with a door to the conversation, the overlay's corner counts it in its head and lists it, and
 * the rail's badge counts it. Each section pins one layer, the way
 * `waiting-on-you-draws-from-the-hosts-reads.dom.test.ts` pins the instruction asks.
 */

const NOW = 1_700_000_000_000

const queue = usePersonsQueue()
/** ⚑ What the open door recorded, in call order — reset every test. */
let opened: string[] = []

afterEach(() => {
  unmountAll()
  queue.forget()
  opened = []
})

/** One piece of work whose agent answered a person five minutes before {@link NOW}. */
function aPieceWaiting(over: Partial<WaitingOnWhoWrote> = {}): WaitingOnWhoWrote {
  return {
    piece: 'work_1',
    label: 'W1.1',
    title: 'Build the pages',
    owner: 'sess_ada',
    ownerName: 'Ada',
    answeredAt: NOW - 300_000,
    ...over,
  }
}

/** The host's walk over the given rows. */
function walkOf(rows: readonly WaitingOnWhoWrote[], rowsUnread = 0): LedgerWalk<WaitingOnWhoWrote> {
  return { rows, walk: 'every-conversation-that-was-given-work', ledgers: 1, rowsUnread }
}

/** A ledger walk that opened a real ledger, read it whole, and found nothing — never `null`. */
function fullLedger<Row>(walk: LedgerWalkKind): LedgerWalk<Row> {
  return { rows: [], walk, ledgers: 1, rowsUnread: 0 }
}

/**
 * Hand the queue singleton a world with nothing outstanding anywhere EXCEPT the work waiting on a
 * reply — the questions and decisions read whole and empty, no wall, stall or ask looked for — so
 * only the 8th argument `queue.supply` takes varies. The open door is wired to {@link opened}.
 */
function supply(
  owed?: { walked: LedgerWalk<WaitingOnWhoWrote> | null; lastLookAnswered: boolean },
  held: ReadonlySet<string> = new Set(),
): void {
  queue.supply(
    fullLedger<PersonsQuestion>('every-conversation-that-routed'),
    fullLedger<PersonsDecision>('every-conversation-that-routed'),
    {
      held: new Set(held),
      answerable: new Map<string, AttentionRequest>(),
      now: NOW,
      lastLookAnswered: { questions: true, decisions: true },
      answeredFromHere: new Set<string>(),
    },
    {
      travel: () => {},
      settle: () => {},
      takeOver: () => {},
      open: (sessionId) => {
        opened.push(sessionId)
      },
    },
    undefined,
    undefined,
    undefined,
    owed,
  )
}

const said = (node: Element | null): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim()

/* -------------------------------------------------------------- §1 · waitingOnWhoWroteView */

describe('§1 · waitingOnWhoWroteView — the rows, and a hole for a failed read', () => {
  it('draws each piece with its agent, label, title, age and the one door, against the same now and held', () => {
    const view = waitingOnWhoWroteView(walkOf([aPieceWaiting()]), true, NOW, new Set())
    expect(view).toEqual({
      unread: false,
      short: null,
      rows: [
        {
          key: 'work_1',
          sessionId: 'sess_ada',
          agent: 'Ada',
          label: 'W1.1',
          what: 'Build the pages',
          since: '5m ago',
          held: false,
          action: OPEN_THE_CONVERSATION,
        },
      ],
    })
    // ⚑ The same row in a window that holds the conversation.
    const held = waitingOnWhoWroteView(walkOf([aPieceWaiting()]), true, NOW, new Set(['sess_ada']))
    expect(held?.rows[0]?.held).toBe(true)
  })

  it("returns null only for 'nobody has looked yet', and discloses a failed, a stopped and a short read", () => {
    expect(waitingOnWhoWroteView(null, true, NOW, new Set())).toBeNull()
    expect(waitingOnWhoWroteView(null, false, NOW, new Set())).toEqual({ rows: [], unread: true })
    // ⚑ A look that stopped answering keeps the rows it had, and says so.
    const stopped = waitingOnWhoWroteView(walkOf([aPieceWaiting()]), false, NOW, new Set())
    expect(stopped?.unread).toBe(true)
    expect(stopped?.rows).toHaveLength(1)
    // ⚑ A look that answered and could not read a row says so in the one sentence for it.
    const short = waitingOnWhoWroteView(walkOf([], 1), true, NOW, new Set())
    expect(short?.short).toContain('could not be read')
  })
})

/* -------------------------------------------------------------- §2 · cornerHead */

describe('§2 · cornerHead — the work waiting on a reply is counted and named, one noun of its own', () => {
  const allClear = {
    count: 0,
    heading: 'Nothing is waiting on you',
    mayBeShort: false,
    rows: [],
  } as unknown as PersonsQueueView
  const replies = (count: number): WaitingOnWhoWroteView =>
    waitingOnWhoWroteView(
      walkOf(Array.from({ length: count }, (_, at) => aPieceWaiting({ piece: `work_${at}` }))),
      true,
      NOW,
      new Set(),
    )!

  it('says one alone in the singular, several in the plural, and beside a question both', () => {
    expect(cornerHead(allClear, null, replies(1))).toEqual({
      heading: 'An agent is waiting on your reply',
      count: 1,
    })
    expect(cornerHead(allClear, null, replies(2))).toEqual({
      heading: '2 pieces of work that need your reply are waiting on you',
      count: 2,
    })
    const aQuestion = {
      count: 1,
      heading: 'A question is waiting on you',
      mayBeShort: false,
      rows: [{ kind: 'a-question' } as unknown as PersonsQueueRow],
    } as unknown as PersonsQueueView
    expect(cornerHead(aQuestion, null, replies(1))).toEqual({
      heading: '1 question and 1 piece of work that needs your reply are waiting on you',
      count: 2,
    })
    // ⚑ The paired contrast: with no such work the queue's own heading stands, word for word.
    expect(cornerHead(aQuestion, null, replies(0))!.heading).toBe('A question is waiting on you')
  })

  it("says the list's own hole over an all-clear, and never over a queue that is short itself", () => {
    const failed = waitingOnWhoWroteView(null, false, NOW, new Set())
    expect(cornerHead(allClear, null, failed)!.heading).toBe('One list could not be read')
    const short = waitingOnWhoWroteView(walkOf([], 1), true, NOW, new Set())
    expect(cornerHead(allClear, null, short)!.heading).toBe(
      'Some of what is waiting could not be read',
    )
    const shortQueue = {
      ...allClear,
      heading: 'One list has stopped answering',
      mayBeShort: true,
    } as unknown as PersonsQueueView
    expect(cornerHead(shortQueue, null, failed)!.heading).toBe('One list has stopped answering')
    // ⚑ Before any look at all, the hole is still said rather than nothing.
    expect(cornerHead(null, null, failed)).toEqual({
      heading: 'One list could not be read',
      count: 0,
    })
    expect(cornerHead(null, null, null)).toBeNull()
  })
})

/* -------------------------------------------------------------- §3 · usePersonsQueue */

describe('§3 · usePersonsQueue — supply(), mayBeShort, the corner and the door', () => {
  it('supply() with no such argument puts it back to nobody has looked, and forget() does too', () => {
    supply({ walked: walkOf([aPieceWaiting()]), lastLookAnswered: true })
    expect(queue.waitingOnWhoWrote.value?.rows).toHaveLength(1)
    expect(queue.corner.value).toEqual({ heading: 'An agent is waiting on your reply', count: 1 })
    supply(undefined)
    expect(queue.waitingOnWhoWrote.value).toBeNull()
    supply({ walked: walkOf([aPieceWaiting()]), lastLookAnswered: true })
    queue.forget()
    expect(queue.waitingOnWhoWrote.value).toBeNull()
  })

  it('a look that did not answer, or answered short, makes mayBeShort true; one read whole does not', () => {
    supply({ walked: null, lastLookAnswered: false })
    expect(queue.mayBeShort.value).toBe(true)
    supply({ walked: walkOf([], 1), lastLookAnswered: true })
    expect(queue.mayBeShort.value).toBe(true)
    supply({ walked: walkOf([aPieceWaiting()]), lastLookAnswered: true })
    expect(queue.mayBeShort.value).toBe(false)
  })

  it('its door opens the conversation holding the work', () => {
    supply({ walked: walkOf([aPieceWaiting()]), lastLookAnswered: true })
    queue.openWork(queue.waitingOnWhoWrote.value!.rows[0]!)
    expect(opened).toEqual(['sess_ada'])
  })
})

/* -------------------------------------------------------------- §4 · the page */

describe('§4 · Waiting on you draws it as its own group, with its door', () => {
  it('draws the group, its count, each row and the Open button, and counts it in what needs you', async () => {
    supply({ walked: walkOf([aPieceWaiting()]), lastLookAnswered: true })
    const m = mount(WaitingOnYou, { needsYou: [], clock: NOW }, { width: 1040, height: 900 })
    await nextTick()

    expect(visible(m.q('replies-group'))).toBe(true)
    expect(said(m.q('replies-count'))).toBe('1')
    const row = m.q('waiting-reply-work_1')
    expect(visible(row)).toBe(true)
    for (const words of ['Ada', 'is waiting on your reply', 'W1.1', 'Build the pages', '5m ago']) {
      expect(said(row)).toContain(words)
    }
    const button = m.q('waiting-reply-go-work_1')
    expect(said(button)).toBe(OPEN_THE_CONVERSATION)
    button.click()
    expect(opened).toEqual(['sess_ada'])

    // ⚑ It is counted with what needs the person: the page is not quiet, and says one item.
    expect(said(m.q('waiting-intro'))).toBe('1 item below is waiting on you.')
    expect(said(m.q('waiting-stat'))).toBe('1 item')
    expect(m.host.querySelector('[data-cy="live-group"]')).toBeNull()
  })

  it('draws no group over an answered empty look, and the hole over a failed one', async () => {
    supply({ walked: walkOf([]), lastLookAnswered: true })
    const empty = mount(WaitingOnYou, { needsYou: [], clock: NOW }, { width: 1040, height: 900 })
    await nextTick()
    expect(empty.host.querySelector('[data-cy="replies-group"]')).toBeNull()
    expect(said(empty.q('waiting-intro'))).toBe('Nothing here is blocked on an answer from you.')
    unmountAll()

    supply({ walked: null, lastLookAnswered: false })
    const failed = mount(WaitingOnYou, { needsYou: [], clock: NOW }, { width: 1040, height: 900 })
    await nextTick()
    expect(visible(failed.q('replies-group'))).toBe(true)
    expect(said(failed.q('replies-count'))).toBe('0')
    expect(visible(failed.q('waiting-replies-unread'))).toBe(true)
    expect(said(failed.q('waiting-intro'))).not.toBe(
      'Nothing here is blocked on an answer from you.',
    )
  })
})

/* -------------------------------------------------------------- §5 · the rail's badge */

describe('§5 · the rail’s badge counts it', () => {
  it('the screen adds it to what the badge counts, and the rail draws that number', async () => {
    // ⛔ **A source census, and it has to be one**: nothing mounts `RuntimeScreen` (it is the whole
    // window), so what it hands the rail is read off the source — prose stripped first.
    const screen = (
      (await import('../../src/renderer/src/components/RuntimeScreen.vue?raw')) as {
        default: string
      }
    ).default
    const at = screen.indexOf('const homeNeedsYou = computed(')
    expect(at, 'RuntimeScreen no longer computes homeNeedsYou').toBeGreaterThan(-1)
    const block = screen
      .slice(at, screen.indexOf('\n)\n', at))
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ')
    const onlyYou = block
      .slice(block.indexOf('onlyYou:'), block.indexOf('unread:'))
      .replace(/\s+/g, '')
    expect(onlyYou).toBe(
      'onlyYou:(persons.view.value?.count??0)+(persons.asks.value?.rows.length??0)+(persons.serverRequests.value?.rows.length??0)+(persons.waitingOnWhoWrote.value?.rows.length??0)+persons.workWaits.value.todos.rows.length+persons.workWaits.value.incidents.rows.length+providersNotChosenIn(agentStore.identities.value).length,',
    )

    // ⚑ That sum, over a module holding one piece waiting on a reply and nothing else, is the
    // badge the rail draws.
    supply({ walked: walkOf([aPieceWaiting()]), lastLookAnswered: true })
    const badgeOf = (): number =>
      homeAttention({
        requests: [],
        onlyYou:
          (queue.view.value?.count ?? 0) +
          (queue.asks.value?.rows.length ?? 0) +
          (queue.serverRequests.value?.rows.length ?? 0) +
          (queue.waitingOnWhoWrote.value?.rows.length ?? 0),
        unread: queue.mayBeShort.value,
      }).total
    const owed = badgeOf()
    expect(owed).toBe(1)
    const rail = mount(
      SideRail,
      { open: [], activeId: null, place: 'waiting', needsYou: owed },
      { width: 251.68, height: 900 },
    )
    await nextTick()
    expect(visible(rail.q('waiting-badge'))).toBe(true)
    expect(said(rail.q('waiting-badge'))).toBe('1')
    unmountAll()

    // ⚑ The paired negative: the same look, answered empty — no badge.
    supply({ walked: walkOf([]), lastLookAnswered: true })
    const quiet = mount(
      SideRail,
      { open: [], activeId: null, place: 'waiting', needsYou: badgeOf() },
      { width: 251.68, height: 900 },
    )
    await nextTick()
    expect(quiet.all('waiting-badge')).toHaveLength(0)
  })
})

/* -------------------------------------------------------------- §6 · the overlay's corner */

/** A trivial panel inside a real `OverlayHost` — which always renders `<PersonsQueue floating>`. */
async function overlay(onClose: () => void): Promise<Mounted> {
  const UnderTest = defineComponent({
    name: 'OverlayUnderTest',
    setup: () => () =>
      h(OverlayHost, { label: 'A sheet', onClose }, { default: () => h('div', 'a panel') }),
  })
  const m = mount(UnderTest, {}, { width: 10, height: 10 })
  // The host's focus-trap effect runs off a `watch`; give it a tick to settle.
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  return m
}

describe('§6 · the overlay’s corner counts it, lists it, and leaves before it opens', () => {
  it('mounts on it alone, says it at its head, and its door closes the sheet first', async () => {
    let closed = 0
    supply({ walked: walkOf([aPieceWaiting()]), lastLookAnswered: true })
    const m = await overlay(() => {
      closed += 1
    })

    m.q('persons-queue-toggle').click()
    await nextTick()
    expect(said(m.q('persons-queue-heading'))).toBe('An agent is waiting on your reply')
    expect(said(m.q('persons-queue-count'))).toBe('1')
    expect(m.q('persons-queue-replies')).toBeTruthy()
    expect(said(m.q('persons-queue-reply-work_1'))).toContain('Ada')
    m.q('persons-queue-reply-go-work_1').click()
    expect(closed).toBe(1)
    expect(opened).toEqual(['sess_ada'])

    // ⚑ The paired negative: the in-flow copy never draws it — the page's own group does.
    const inFlow = mount(PersonsQueue, {}, { width: 640, height: 400 })
    await nextTick()
    expect(inFlow.host.querySelector('[data-cy="persons-queue"]')).toBeNull()
    expect(inFlow.host.querySelector('[data-cy="persons-queue-replies"]')).toBeNull()
  })
})

/* -------------------------------------------------------------- §7 · the store read */

/** A bridge with exactly `waitingOnWhoWroteForAPerson` on it — the asks' test's pattern. */
function bridgeFor(answer: () => Promise<LedgerWalk<WaitingOnWhoWrote>>): RuntimeBridge {
  return everythingOverTheWire({
    waitingOnWhoWroteForAPerson: answer,
    onEvent: () => () => {},
    onLiveness: () => () => {},
  }) as unknown as RuntimeBridge
}

describe('§7 · a refused read is a value, never an empty list', () => {
  it('a refused read is null, and an answered one is handed on whole', async () => {
    const refused = createSessionStore(
      bridgeFor(() => Promise.reject(new Error('the host is gone'))),
    )
    await expect(refused.waitingOnWhoWroteForAPerson()).resolves.toBeNull()
    const answered = createSessionStore(bridgeFor(() => Promise.resolve(walkOf([aPieceWaiting()]))))
    await expect(answered.waitingOnWhoWroteForAPerson()).resolves.toEqual(walkOf([aPieceWaiting()]))
  })
})
