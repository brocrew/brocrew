import { afterEach, describe, expect, it } from 'vitest'
import type { AttentionRequest } from '../../src/renderer/src/lib/attention'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import type {
  LedgerWalk,
  LedgerWalkKind,
  PersonsDecision,
  PersonsQuestion,
} from '../../src/shared/questions'
import type { WaitingOnWhoWrote } from '../../src/shared/waiting-on-who-wrote'

/**
 * # The screen's clock · it ticks while a reply is owed
 *
 * The rows of work waiting on a person's reply say how long ago the agent answered, measured
 * against the `now` the screen hands the persons queue, which is the screen's clock. That clock
 * ticks only while something is waiting; a reply owed is one of the things that keeps it ticking.
 *
 * | § | what it pins | why the existing tests do not reach it |
 * |---|---|---|
 * | 1 | the condition that starts the screen's clock includes the replies owed, beside every other arm | nothing mounts `RuntimeScreen`, so the condition is read off its source, as the rail-badge census reads `homeNeedsYou` |
 * | 2 | the same owed row, handed a later `now`, says a later age | the existing view test reads one row at one `now` |
 */

const NOW = 1_700_000_000_000

const queue = usePersonsQueue()

afterEach(() => {
  queue.forget()
})

function aPieceWaiting(): WaitingOnWhoWrote {
  return {
    piece: 'work_1',
    label: 'W1.1',
    title: 'Build the pages',
    owner: 'sess_ada',
    ownerName: 'Ada',
    answeredAt: NOW - 300_000,
  }
}

function fullLedger<Row>(walk: LedgerWalkKind): LedgerWalk<Row> {
  return { rows: [], walk, ledgers: 1, rowsUnread: 0 }
}

/** The queue handed one owed row and nothing else, against `now`. */
function supplyAt(now: number): void {
  queue.supply(
    fullLedger<PersonsQuestion>('every-conversation-that-routed'),
    fullLedger<PersonsDecision>('every-conversation-that-routed'),
    {
      held: new Set<string>(),
      answerable: new Map<string, AttentionRequest>(),
      now,
      lastLookAnswered: { questions: true, decisions: true },
      answeredFromHere: new Set<string>(),
    },
    { travel: () => {}, settle: () => {}, takeOver: () => {}, open: () => {} },
    undefined,
    undefined,
    undefined,
    {
      walked: {
        rows: [aPieceWaiting()],
        walk: 'every-conversation-that-was-given-work',
        ledgers: 1,
        rowsUnread: 0,
      },
      lastLookAnswered: true,
    },
  )
}

/** The screen's source with its comments stripped and its whitespace removed, from `from` to `to`. */
async function screenSourceBetween(from: string, to: string): Promise<string> {
  const screen = (
    (await import('../../src/renderer/src/components/RuntimeScreen.vue?raw')) as {
      default: string
    }
  ).default
  const at = screen.indexOf(from)
  expect(at, `RuntimeScreen no longer holds ${from}`).toBeGreaterThan(-1)
  const end = screen.indexOf(to, at)
  expect(end, `RuntimeScreen no longer holds ${to} after ${from}`).toBeGreaterThan(at)
  return screen
    .slice(at, end)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\s+/g, '')
}

describe('§1 · the screen’s clock starts while a reply is owed', () => {
  it('⚑ the watch that starts the clock reads every kind of waiting; ⛔ the replies owed are one of them', async () => {
    const block = await screenSourceBetween('const clock = ref(Date.now())', '{ immediate: true }')
    expect(block).toContain('ticking=setInterval(()=>(clock.value=Date.now()),1_000)')
    const condition = block.slice(block.indexOf('watch('), block.indexOf('(waiting)=>'))
    expect(condition).toBe(
      'watch(()=>needsYou.value.length>0||' +
        '(persons.view.value?.count??0)>0||' +
        '(persons.limits.value?.walls.length??0)>0||' +
        '(persons.waitingOnWhoWrote.value?.rows.length??0)>0||' +
        '(persons.stalled.value?.rows.length??0)>0,',
    )
  })

  it('⚑ the clock is the `now` the screen hands the persons queue', async () => {
    const block = await screenSourceBetween('watchEffect(() => {\n  persons.supply(', '})\n')
    expect(block).toContain('now:clock.value,')
  })
})

describe('§2 · a later clock ages the owed row', () => {
  it('⚑ at the moment it was read it says 5m ago; ⛔ a minute later it no longer does, and says 6m ago', () => {
    supplyAt(NOW)
    expect(queue.waitingOnWhoWrote.value?.rows.map((row) => row.since)).toEqual(['5m ago'])
    supplyAt(NOW + 60_000)
    expect(queue.waitingOnWhoWrote.value?.rows.map((row) => row.since)).toEqual(['6m ago'])
  })
})
