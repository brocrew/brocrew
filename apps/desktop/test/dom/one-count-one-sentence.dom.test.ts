import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import TeamForest from '../../src/renderer/src/components/TeamForest.vue'
import SessionWork from '../../src/renderer/src/components/SessionWork.vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import PersonsQueue from '../../src/renderer/src/components/PersonsQueue.vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { DRAWER_W_MIN } from '../../src/renderer/src/lib/drawer'
import { forestView } from '../../src/renderer/src/lib/the-forest'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import type { AttentionRequest } from '../../src/renderer/src/lib/attention'
import type {
  LedgerWalk,
  LedgerWalkKind,
  PersonsDecision,
  PersonsQuestion,
} from '../../src/shared/questions'
import type { StalledWork } from '../../src/shared/stalled-work'
import type { WorkGivenOut } from '../../src/shared/tasks'
import type { ForestNode, TheWholeForest } from '../../src/shared/the-whole-forest'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../../src/shared/who-called-whom'
import { META, drawerProps, mount, unmountAll, visible } from './harness'

/**
 * # 🔴 678 · F-R18 — one count, one sentence, read as TEXT on every surface that draws it
 *
 * ⚑ **`671` made the ledger walks COUNT a row they could not read (`rowsUnread`) instead of raising**,
 * and the count now means two things: a piece of work may be MISSING, or a drawn one's STATE may be
 * wrong. ⛔ **Before `678` each surface said the first half in its own words, and two said nothing**
 * — the band's two work lists (`631` took their hooks) and the stalled band.
 *
 * ⚑ **The sentence is spelled here as a LITERAL**, never through `rowsUnreadSays` —
 * `a-fixture-built-with-the-helper-under-test-proves-nothing`. 🔴 **Its load-bearing clause —
 * *"or its state may be wrong"* — is asserted by name** (standing rule 5), and every surface has a
 * planted control: the same mount at `rowsUnread: 0` draws no line at all.
 */

afterEach(() => {
  unmountAll()
  // ⚑ the queue is one per window — what one test supplies must not open the next test's page
  usePersonsQueue().forget()
})

const NOW = 1_800_000_000_000
const said = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** ⚑ The whole line, as a person reads it — the lead, then the sentence. */
const LINE = (n: number): string =>
  `This may not be accurate ${String(n)} ${n === 1 ? 'row' : 'rows'} of this app’s record could not be read, so a piece of work may be missing here, or its state may be wrong.`

const walk = <Row>(
  rows: readonly Row[],
  kind: LedgerWalkKind,
  over: Partial<LedgerWalk<Row>> = {},
): LedgerWalk<Row> => ({ rows, walk: kind, ledgers: rows.length, rowsUnread: 0, ...over })

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the Team page's forest (F-R18c)
// ─────────────────────────────────────────────────────────────────────────────────────────────

const conversation = (): ForestNode =>
  ({
    node: 'a-conversation',
    conversation: 'sess_a',
    under: { is: 'the-person' },
    identity: 'worker',
    provider: 'claude',
    status: 'idle',
    running: 'unwatched',
    standsInFor: [],
    inItsPlace: null,
    startedAt: NOW - 60_000,
    updatedAt: NOW - 1_000,
  }) as ForestNode

const forest = (rowsUnread: number) =>
  forestView({
    forest: {
      readAt: NOW,
      nodes: {
        rows: [conversation()],
        walk: 'every-conversation-this-app-placed',
        ledgers: 1,
        rowsUnread,
      },
      conversations: 1,
      heldByNoAgent: 0,
    } as TheWholeForest,
    atWork: null,
    waits: null,
    identities: null,
    held: new Set<string>(),
  })!

describe('§1 · the forest — F-R18c', () => {
  it('🔴 3 unread rows read as the one sentence, both halves, and not the old half', () => {
    const m = mount(TeamForest, { view: forest(3) }, { width: 1200, height: 900 })
    const line = m.q('forest-rows-unread')
    expect(visible(line)).toBe(true)
    expect(said(line)).toBe(LINE(3))
    expect(said(line)).toContain('or its state may be wrong')
    // ⛔ the sentence it replaced — true of half the count
    expect(said(line)).not.toContain('may be absent')
  })

  it('⚑ the control — the same forest with nothing unread draws no line', () => {
    const m = mount(TeamForest, { view: forest(0) }, { width: 1200, height: 900 })
    expect(m.host.querySelector('[data-cy="forest-rows-unread"]')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the drawer's Work tab (F-R18d) — and the empty line it drew BESIDE the short one
// ─────────────────────────────────────────────────────────────────────────────────────────────

const work = (rowsUnread: number, rows: readonly WorkGivenOut[] = []) =>
  mount(
    SessionWork,
    {
      conversation: 'sess_a',
      identities: null,
      reading: {
        conversation: 'sess_a',
        walk: walk<WorkGivenOut>(rows, 'every-conversation-this-one-gave-work-to', { rowsUnread }),
        answered: true,
        at: Date.now(),
      },
    },
    { width: 520, height: 700 },
  )

describe('§2 · the Work tab — F-R18d', () => {
  it('🔴 2 unread rows read as the one sentence', () => {
    const m = work(2)
    expect(said(m.q('work-short'))).toBe(LINE(2))
    expect(said(m.q('work-short'))).not.toContain('This list is short')
  })

  it('🔴 …and the tab no longer says it gave nobody work over rows it could not read', () => {
    // ⛔ **The defect `678`'s scout found**: *"This conversation has not given anybody work"* drawn
    // one line above *"a piece of work may be missing here"* — two claims that cannot both be true.
    const m = work(2)
    expect(m.host.querySelector('[data-cy="work-empty"]')).toBeNull()
  })

  it('⚑ the control — nothing unread: no short line, and the empty sentence IS drawn', () => {
    const m = work(0)
    expect(m.host.querySelector('[data-cy="work-short"]')).toBeNull()
    expect(said(m.q('work-empty'))).toContain('This conversation has not given anybody work')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the band's two work lists (F-R18a) — folded since 671, drawn by nothing until 678
// ─────────────────────────────────────────────────────────────────────────────────────────────

const answer = (gave: number, took: number): WhoCalledWhom => ({
  conversation: META.sessionId,
  parent: null,
  children: walk<SpawnEdge>([], 'every-conversation-this-one-spawned'),
  workGivenOut: walk<WorkEdge>([], 'every-conversation-this-one-gave-work-to', {
    rowsUnread: gave,
  }),
  workTakenIn: walk<WorkEdge>([], 'every-piece-of-work-this-one-was-given', { rowsUnread: took }),
  readAt: Date.now(),
})

function band(read: WhoCalledWhom) {
  const cast = useWhoCalledWhom()
  cast.reading.value = { conversation: META.sessionId, read, answered: true, atWork: null }
  cast.goTo.value = null
  return mount(SessionDrawer as never, drawerProps({ identities: null }), {
    width: DRAWER_W_MIN,
    height: 900,
  })
}

describe('§3 · the band — F-R18a', () => {
  it('🔴 each list says its own count, under its own heading — never summed', async () => {
    const m = band(answer(2, 1))
    await nextTick()
    expect(said(m.q('cast-given-short'))).toBe(LINE(2))
    expect(said(m.q('cast-taken-short'))).toBe(LINE(1))
    // ⚑ the heading names *here* even though neither list read a row
    expect(said(m.q('cast-tasks-heading'))).toBe('Assigned by it')
    // The agent card shows the work given to it as its “Current task”.
    expect(said(m.q('cast-taken-heading'))).toBe('Current task')
    // ⛔ the line sits UNDER its heading, in pixels — a heading below its line names nothing
    expect(m.q('cast-given-short').getBoundingClientRect().top).toBeGreaterThan(
      m.q('cast-tasks-heading').getBoundingClientRect().top,
    )
  })

  it('⚑ the control — nothing unread: neither line and neither heading', async () => {
    const m = band(answer(0, 0))
    await nextTick()
    for (const cy of ['cast-given-short', 'cast-taken-short', 'cast-tasks-heading']) {
      expect(m.host.querySelector(`[data-cy="${cy}"]`), cy).toBeNull()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · the stalled band on the person's queue (F-R18b)
// ─────────────────────────────────────────────────────────────────────────────────────────────

function supplyStalls(stalled: LedgerWalk<StalledWork>): void {
  const EMPTY = <Row>(): LedgerWalk<Row> =>
    ({
      rows: [],
      walk: 'every-conversation-that-routed',
      ledgers: 1,
      rowsUnread: 0,
    }) as LedgerWalk<Row>
  usePersonsQueue().supply(
    EMPTY<PersonsQuestion>(),
    EMPTY<PersonsDecision>(),
    {
      held: new Set<string>(),
      answerable: new Map<string, AttentionRequest>(),
      now: 900_000,
      lastLookAnswered: { questions: true, decisions: true },
      answeredFromHere: new Set<string>(),
    },
    { open: () => {}, takeOver: () => {}, openWork: () => {} } as never,
    undefined,
    { walked: stalled, lastLookAnswered: true },
  )
}

async function queue(stalled: LedgerWalk<StalledWork>) {
  supplyStalls(stalled)
  await page.viewport(900, 700)
  const m = mount(PersonsQueue as never, { floating: true }, { width: 880, height: 680 })
  await nextTick()
  return m
}

const STALLS = (rowsUnread: number): LedgerWalk<StalledWork> =>
  ({
    rows: [],
    walk: 'every-conversation-that-routed',
    ledgers: 1,
    rowsUnread,
  }) as LedgerWalk<StalledWork>

describe('§4 · the stalled band — F-R18b', () => {
  it('🔴 a stall walk that answered and could not read 4 rows OPENS the queue and says so', async () => {
    // ⛔ **The all-clear this band exists not to give**: before `678` a walk that dropped its only
    // row drew no band, and an empty queue reads as *every piece of work that stopped reached
    // somebody*.
    const m = await queue(STALLS(4))
    expect(visible(m.q('persons-queue'))).toBe(true)
    expect(said(m.q('persons-queue-stalled-short'))).toBe(
      '4 rows of this app’s record could not be read, so a piece of work may be missing here, or its state may be wrong.',
    )
    // ⛔ and it is not the line for a look that did NOT answer — a different fact
    expect(m.host.querySelector('[data-cy="persons-queue-stalled-unread"]')).toBeNull()
  })

  it('⚑ the control — nothing unread and nothing stalled: no queue at all', async () => {
    const m = await queue(STALLS(0))
    expect(m.host.querySelector('[data-cy="persons-queue"]')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · …and on the page a person goes to — Waiting on you (found by `678`'s review)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⛔ **The line in §4 was drawn in the corner copy only.** `WaitingOnYou` mounted the queue on
 * `personsRows`, `attention.unread` and the providers, and none of them reads the stalled band — so
 * stopped work (its rows, a look that did not answer, and `678`'s unread rows) said nothing on the
 * page, while the corner copy exists only when a sheet is open. ⚑ `stallSaysSomething` opens it.
 */
describe('§5 · the stalled band reaches Waiting on you', () => {
  /** ⚑ This page's all-clear, as `homeAttention` words it for a screen with nothing owed and no hole. */
  const ALL_CLEAR = 'Nothing here is blocked on an answer from you.'

  const page_ = async () => {
    await page.viewport(1400, 1200)
    const m = mount(WaitingOnYou, { needsYou: [], clock: NOW }, { width: 1351, height: 1200 })
    await nextTick()
    return m
  }

  it('🔴 a stall walk that answered with 4 unread rows and nothing else draws its line on the page', async () => {
    supplyStalls(STALLS(4))
    const m = await page_()
    const line = m.q('persons-queue-stalled-short')
    expect(visible(line)).toBe(true)
    expect(said(line)).toContain('4 rows of this app’s record could not be read')
    // ⛔ **and the page above it does not call itself quiet** — `401`'s adjacent contradiction, which
    // this page could not show until it drew the band (`678`'s review)
    expect(said(m.q('waiting-intro'))).not.toBe(ALL_CLEAR)
    expect(said(m.q('waiting-stat'))).not.toBe('All clear')
  })

  it('🔴 stalled WORK alone — no hole, nothing owed — reaches the page too', async () => {
    // ⚠️ **The holes above now also forbid *quiet*, which opens the page on their own; this case is
    // what `stallSaysSomething` is for**: a row of stopped work, read cleanly, owed by nobody here.
    supplyStalls({
      rows: [
        {
          piece: 'work_x',
          label: 'W1.3',
          title: 'Build the world clock page.',
          owner: 'sess_pam',
          ownerName: 'Pam',
          giver: 'sess_ada',
          giverName: 'Ada',
          because: 'turn_ended',
          stalledAt: 1_000,
        } as StalledWork,
      ],
      walk: 'every-conversation-that-routed',
      ledgers: 1,
      rowsUnread: 0,
    } as LedgerWalk<StalledWork>)
    const m = await page_()
    expect(visible(m.q('persons-queue-stall-says-work_x'))).toBe(true)
  })

  it('⚑ the control — nothing stalled and nothing unread: the page draws no queue', async () => {
    supplyStalls(STALLS(0))
    const m = await page_()
    expect(m.host.querySelector('[data-cy="persons-queue"]')).toBeNull()
    // ⚑ the paired positive: the same page, with nothing wrong, DOES give the all-clear
    expect(said(m.q('waiting-intro'))).toBe(ALL_CLEAR)
    expect(said(m.q('waiting-stat'))).toBe('All clear')
  })
})
