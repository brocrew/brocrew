import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import * as persons from '../../src/renderer/src/lib/persons-queue'
import { useOverlays } from '../../src/renderer/src/lib/overlay-store'
import {
  decisionReading,
  readingSentence,
  type LedgerWalk,
  type PersonsDecision,
  type RequestOnlyAPersonCanSettle,
} from '../../src/shared/questions'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import { agentName, type AgentIdentity } from '../../src/shared/runtime-ipc'
import { assertDrawn, drawnReady } from './drawn'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 737 · Draw 2, second half, DRAWN — two conversations of one agent, told apart (`734` F-2)
 *
 * ⚑ **The finding, verbatim** (`734` §4 F-2): *"Two rows that both read "Bob waiting on you"
 * (§1.7). Each row has its conversation (`PersonsQueueRow.sessionId`), so the drawing can tell them
 * apart — the words are yours."*
 *
 * | § | surface | 🔴 subject (RED on `main` 92209678) | ⚑ control, one fact over (green on both) |
 * |---|---|---|---|
 * | 1 | the person's queue, on its destination (`WaitingOnYou` → `PersonsQueue`) | Grace's Bob and Ada's Bob, both parked: each row draws its line whole, directly after its chain and outside it, inside its own row — and the two lines differ | a Bob and an Ada; one Bob conversation holding two requests — no line |
 *
 * ⚑ **The rows are the REAL fold's** — `usePersonsQueue().supply` over `PersonsDecision` doubles
 * shaped as `RuntimeHost.decisionsForAPerson` sends them, each conversation NAMED by the real
 * `agentName` (R41) — and the surface is mounted as the app mounts it, at the width a
 * destination is drawn at beside the rail (1180 − 208 = 972 px), in a window that wide, and left
 * mounted until the test ends.
 *
 * ⛔ **The chain is not touched.** `the-chain-a-question-carries.dom.test.ts` pins each hop's
 * `innerText` (*"Bob asked"*, *"you"*), and every subject here reads it back unchanged beside the
 * new line.
 *
 * ⚠️ **What `main` draws instead**: the two rows, identical but for their age — no
 * `persons-queue-namesake-*` element exists there, so each
 * subject fails on `m.q(…)` finding nothing. ⚑ `namesakesIn` and `namesakeSays` are new exports of
 * a module `main` HAS: they are read off the module's namespace, never by a named import (which
 * would fail the whole file there), and only inside subjects, after the drawing was asserted.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
const WINDOW_W = 1180
const WINDOW_H = 808
const RAIL_W = 208
const PANE_W = WINDOW_W - RAIL_W

const NOW = 1_700_000_000_000
const MINUTE = 60_000

/* ------------------------------------------------------------------ the roster and the names */

function identity(slug: string, displayName: string): AgentIdentity {
  return {
    id: `aid:${slug}`,
    slug,
    displayName,
    createdAt: NOW - 86_400_000,
    createdBy: null,
    capabilities: DEFAULT_CAPABILITIES,
    chosen: {} as AgentIdentity['chosen'],
    provider: null,
    externalMcpServerIds: [],
  }
}

const ROSTER = [identity('pm-g', 'Ada'), identity('worker-g', 'Bob')]

/** ⚑ Which identity each conversation runs under — Grace's Bob and Ada's Bob are ONE identity. */
const RUNS_AS: Readonly<Record<string, string>> = {
  sess_ada: 'pm-g',
  'sess_bob-of-grace': 'worker-g',
  'sess_bob-of-ada': 'worker-g',
}

/** ⚑ R41 — named by `agentName`, as `734`'s host names a conversation on a person's queue. */
const NAME = (sessionId: string): string => agentName(RUNS_AS[sessionId] ?? null, ROSTER)

const GRACES_BOB = 'sess_bob-of-grace'
const ADAS_BOB = 'sess_bob-of-ada'

/* ------------------------------------------------------------------ the wire's rows */

/** ⚑ A permission its asker parked on, `minutesAgo` before now — `decisionsForAPerson`'s row. */
function parked(askedBy: string, requestId: string, minutesAgo: number): PersonsDecision {
  const request: RequestOnlyAPersonCanSettle = {
    requestId,
    askedBy,
    parent: askedBy === ADAS_BOB ? 'sess_ada' : 'sess_grace',
    went: {
      is: 'the-person-the-channel-left-it-with',
      to: 'a-person',
      because: 'a-permission-decision',
    },
    at: NOW - minutesAgo * MINUTE,
    state: 'open',
    endedAt: null,
    escalatedAt: null,
  }
  const reading = decisionReading(request.askedBy, NAME)
  return {
    request,
    reading,
    sentence: readingSentence(reading),
    says: 'a command or file approval, which is a person’s to give',
    work: [],
  }
}

/** ⚑ §1.7's shape: Grace's Bob parked nine minutes ago, Ada's Bob two. */
const TWO_BOBS = (): PersonsDecision[] => [
  parked(ADAS_BOB, 'req_ada', 2),
  parked(GRACES_BOB, 'req_grace', 9),
]

const OLDER = `${GRACES_BOB}:req_grace`
const NEWER = `${ADAS_BOB}:req_ada`

/** ⚑ The words, verbatim ONCE — rule 5 pins them by `namesakeSays` in each subject. */
const WAITED_LONGER =
  'Bob has another conversation asking you something too; this conversation reached you first.'
const THE_NEWER =
  'Bob has another conversation asking you something too; this conversation reached you second.'

/* ------------------------------------------------------------------ the queue */

const queue = persons.usePersonsQueue()

const walk = <Row>(rows: readonly Row[]): LedgerWalk<Row> => ({
  rows,
  walk: 'every-conversation-that-routed',
  ledgers: Math.max(rows.length, 1),
  rowsUnread: 0,
})

/** Hand the module a world, the way `RuntimeScreen`'s `watchEffect` does. */
function supply(decisions: readonly PersonsDecision[]): void {
  queue.supply(
    walk([]),
    walk(decisions),
    {
      held: new Set<string>(),
      answerable: new Map(),
      now: NOW,
      lastLookAnswered: { questions: true, decisions: true },
      answeredFromHere: new Set<string>(),
    },
    { travel: () => {}, settle: () => {}, takeOver: () => {}, open: () => {} },
  )
}

/**
 * ⚑ The rows the surface draws — the module's own view, never a copy of it. ⚑ D-016: the project
 * band that drew them too is gone.
 */
function theLook(): readonly persons.PersonsQueueRow[] {
  const rows = queue.view.value?.rows
  expect(rows, 'the queue has no view').toBeDefined()
  return rows!
}

/**
 * ⚑ **rule 5 — what the module says for one row**, by its own two functions over the whole look.
 * ⚠️ Reached off the namespace, and only once a subject has asserted the drawing (see the header).
 */
function theModuleSays(key: string): string {
  const one = persons.namesakesIn(theLook()).get(key)
  expect(one, `the module found no namesake for ${key}`).toBeDefined()
  return persons.namesakeSays(one!)
}

/* ------------------------------------------------------------------ the mounts */

async function settle(): Promise<void> {
  await nextTick()
  await drawnReady()
}

/** ⚑ The queue's destination, beside the rail, in a window that wide. */
async function home(): Promise<Mounted> {
  await page.viewport(WINDOW_W, WINDOW_H)
  const m = mount(WaitingOnYou, { clock: NOW }, { width: PANE_W, height: WINDOW_H })
  await settle()
  return m
}

beforeEach(() => {
  useOverlays().overlay.value = null
  // ⛔ **The queue is a MODULE singleton**, so a supply left by one test is the next one's world.
  queue.forget()
})

afterEach(async () => {
  unmountAll()
  useOverlays().overlay.value = null
  queue.forget()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/* ------------------------------------------------------------------ reading a row */

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** ⚑ Each hop's `innerText` — what `the-chain-a-question-carries.dom.test.ts` pins. */
const hops = (chain: HTMLElement): string[] =>
  [...chain.children].map((li) => (li as HTMLElement).innerText.trim())

/** ⚑ Every namesake line on a surface, whatever row it is on — so a control can count none. */
const namesakeLines = (m: Mounted, prefix: string): HTMLElement[] => [
  ...m.host.querySelectorAll<HTMLElement>(`[data-cy^="${prefix}-namesake-"]`),
]

/**
 * ⚑ **One row's line, read where a person meets it** — drawn whole, directly after the row's chain
 * and OUTSIDE it, inside the row's own box; the chain beside it still the host's.
 */
function theLineBeside(m: Mounted, key: string) {
  const row = m.q(`persons-queue-row-${key}`)
  const chain = m.q(`persons-queue-chain-${key}`)
  // ⛔ On `main` there is no such element, and the row reads like its namesake's.
  const line = m.q(`persons-queue-namesake-${key}`)
  expect(visible(line), `the namesake line of ${key} is not painted`).toBe(true)
  assertDrawn(line, `the namesake line of ${key}`, m.host)
  // ⚑ Beside the name — the chain's next sibling — and never one of its hops.
  expect(chain.nextElementSibling).toBe(line)
  expect(chain.contains(line)).toBe(false)
  expect(row.contains(line)).toBe(true)
  // ⚑ Inside the row's own box, under the chain: a person reads it as this row's.
  const inRow = row.getBoundingClientRect()
  const box = line.getBoundingClientRect()
  expect(box.left).toBeGreaterThanOrEqual(inRow.left)
  expect(box.right).toBeLessThanOrEqual(inRow.right)
  expect(box.top).toBeGreaterThanOrEqual(chain.getBoundingClientRect().bottom - 0.5)
  expect(box.bottom).toBeLessThanOrEqual(inRow.bottom)
  // ⛔ The chain is unchanged — the name, the act, and you.
  expect(hops(chain)).toEqual(['Bob asked', 'you'])
  return line
}

/* ------------------------------------------------------------------ §1 */

describe('§1 · the person’s queue — two parents’ Bobs, both parked', () => {
  it('🔴 each row draws its line whole, beside its chain and outside it — and the two lines differ', async () => {
    supply(TWO_BOBS())
    const m = await home()
    // ⚑ The premise, off the screen: two rows, both *Bob*, oldest first.
    const drawn = [...m.q('persons-queue-rows').children].map((li) => li.getAttribute('data-cy'))
    expect(drawn).toEqual([`persons-queue-row-${OLDER}`, `persons-queue-row-${NEWER}`])
    expect(m.q(`persons-queue-chain-${OLDER}`).getAttribute('aria-label')).toBe(
      'Bob waiting on you',
    )
    expect(m.q(`persons-queue-chain-${NEWER}`).getAttribute('aria-label')).toBe(
      'Bob waiting on you',
    )

    const older = theLineBeside(m, OLDER)
    const newer = theLineBeside(m, NEWER)
    expect(text(older)).toBe(WAITED_LONGER)
    expect(text(newer)).toBe(THE_NEWER)
    expect(text(older)).not.toBe(text(newer))
    expect(namesakeLines(m, 'persons-queue')).toHaveLength(2)

    // ⚑ rule 5 — the module's words for these rows.
    expect(text(older)).toBe(theModuleSays(OLDER))
    expect(text(newer)).toBe(theModuleSays(NEWER))
  })

  it('⚑ THE CONTROL — a Bob and an Ada: two rows, two names, no line', async () => {
    supply([parked('sess_ada', 'req_a', 2), parked(GRACES_BOB, 'req_grace', 9)])
    const m = await home()
    expect(hops(m.q(`persons-queue-chain-${OLDER}`))).toEqual(['Bob asked', 'you'])
    expect(hops(m.q('persons-queue-chain-sess_ada:req_a'))).toEqual(['Ada asked', 'you'])
    expect(visible(m.q(`persons-queue-row-${OLDER}`))).toBe(true)
    expect(visible(m.q('persons-queue-row-sess_ada:req_a'))).toBe(true)
    expect(namesakeLines(m, 'persons-queue')).toEqual([])
  })

  it('⚑ THE CONTROL — ONE Bob conversation holding two requests: two rows, and no line', async () => {
    supply([parked(GRACES_BOB, 'req_2', 2), parked(GRACES_BOB, 'req_1', 9)])
    const m = await home()
    for (const key of [`${GRACES_BOB}:req_1`, `${GRACES_BOB}:req_2`]) {
      expect(visible(m.q(`persons-queue-row-${key}`))).toBe(true)
      expect(hops(m.q(`persons-queue-chain-${key}`))).toEqual(['Bob asked', 'you'])
    }
    expect(namesakeLines(m, 'persons-queue')).toEqual([])
  })
})
