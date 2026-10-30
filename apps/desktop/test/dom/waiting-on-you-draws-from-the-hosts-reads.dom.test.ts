import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import PersonsQueue from '../../src/renderer/src/components/PersonsQueue.vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import { listedNowhereElse, type AttentionRequest } from '../../src/renderer/src/lib/attention'
import {
  cornerHead,
  instructionAsksView,
  usePersonsQueue,
  type InstructionAskRow,
  type InstructionAsksView,
  type PersonsQueueRow,
  type PersonsQueueView,
} from '../../src/renderer/src/lib/persons-queue'
import { createSessionStore } from '../../src/renderer/src/lib/session-store'
import type { InstructionAskWaiting } from '../../src/shared/own-instructions'
import type { InstructionProposedEvent, RuntimeBridge } from '../../src/shared/runtime-ipc'
import type {
  LedgerWalk,
  LedgerWalkKind,
  PersonsDecision,
  PersonsQuestion,
} from '../../src/shared/questions'
import { everythingOverTheWire } from '../lib/the-wire'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * ⚑ **D-017 · R19 — what an agent asked a person about an identity's rules, unpinned before this
 * file.** `45a11477` widened `listedNowhereElse` (a routed card is somebody else's list now, not
 * this one) and gave `persons-queue.ts` a whole second population — `instructionAsksView`,
 * `cornerHead`'s widened heading, `decideInstruction` — that *Waiting on you* and the overlay's
 * corner both draw from, plus a seventh store read whose refusal is `null` rather than `[]`. None
 * of it had a test naming it; this file is that test, one behaviour a section.
 *
 * ⚠️ **Setup copied from four files, because the four things pinned here sit at four layers**:
 * `home-attention.test.ts`'s hand-cast fixture style for the pure folds, `own-instructions.dom.test.ts`'s
 * `InstructionAskWaiting` shape, `persons-queue.dom.test.ts`'s `supply()`/`overlay()` pattern for the
 * queue singleton, and `persons-queue.test.ts` §7's `bridgeThat`/`createSessionStore` pattern for the
 * one store-level read.
 */

const NOW = 1_700_000_000_000

const queue = usePersonsQueue()
/** ⚑ What `decideInstruction`'s door recorded, in call order — reset every test. */
let decided: Array<[string, boolean]> = []

afterEach(() => {
  unmountAll()
  queue.forget()
  decided = []
})

/** The identity function every test that does not care about names may hand `instructionAsksView`. */
const nameOf = (slug: string): string => slug

/** One ask nobody has answered, copying `own-instructions.dom.test.ts`'s `HELD.waiting[0]` shape. */
function askWaiting(over: Partial<InstructionProposedEvent> = {}, at = NOW): InstructionAskWaiting {
  return {
    asked: {
      type: 'instruction_proposed',
      askId: 'iprop_1',
      ask: 'propose',
      about: 'worker',
      proposedBy: 'project-manager',
      text: 'Always run the gate before reporting.',
      why: 'three dispatches reported green without one',
      ...over,
    },
    conversation: 'sess_pm',
    at,
  }
}

/** A ledger walk that opened a real ledger, read it whole, and found nothing — never `null`. */
function fullLedger<Row>(walk: LedgerWalkKind): LedgerWalk<Row> {
  return { rows: [], walk, ledgers: 1, rowsUnread: 0 }
}

/**
 * Hand the queue singleton a world with nothing outstanding anywhere EXCEPT the asks — the
 * questions/decisions reads are both real, whole and fully answered (so `view.mayBeShort` is false
 * on its own), and no wall or stalled-work look has ever landed (so neither contributes either).
 * Only `asks` varies between calls — the 7th argument `queue.supply` takes, D-017 · R19's (⚑ the
 * 8th until D-016 took the proposals read out).
 * `decideInstruction`'s door is wired to {@link decided}.
 */
function supply(asks?: {
  walked: readonly InstructionAskWaiting[] | null
  lastLookAnswered: boolean
  nameOf: (slug: string) => string
}): void {
  queue.supply(
    fullLedger<PersonsQuestion>('every-conversation-that-routed'),
    fullLedger<PersonsDecision>('every-conversation-that-routed'),
    {
      held: new Set<string>(),
      answerable: new Map<string, AttentionRequest>(),
      now: NOW,
      lastLookAnswered: { questions: true, decisions: true },
      answeredFromHere: new Set<string>(),
    },
    {
      travel: () => {},
      settle: () => {},
      takeOver: () => {},
      open: () => {},
      decideInstruction: (askId, approve) => {
        decided.push([askId, approve])
      },
    },
    undefined,
    undefined,
    asks,
  )
}

/* -------------------------------------------------------------- §1 · listedNowhereElse */

describe('§1 · listedNowhereElse keeps only the cards nothing else already lists', () => {
  // ⚑ D-016: *…and every proposal* went with proposals — no card of that kind is drawn any more.
  it('keeps a plain card and drops a routed one', () => {
    const plain = { key: 'sess_a:req_1', kind: 'permission' } as unknown as AttentionRequest
    const routedOne = {
      key: 'sess_b:req_1',
      kind: 'permission',
      routed: true,
    } as unknown as AttentionRequest

    const kept = listedNowhereElse([plain, routedOne])

    expect(kept.map((one) => one.key)).toEqual(['sess_a:req_1'])
    // ⚑ The paired positive: the plain card survives — this is not a filter that empties everything.
    expect(kept).toContain(plain)
  })
})

/* -------------------------------------------------------------- §2 · instructionAsksView */

describe('§2 · instructionAsksView — a hole for a failed read, never for an unopened one', () => {
  it("returns null only for 'nobody has looked yet', and discloses a hole for a read that failed", () => {
    const failed = instructionAsksView(null, false, nameOf)
    expect(failed).not.toBeNull()
    expect(failed!.partial).toBe(true)
    expect(failed!.rows).toEqual([])

    // ⚑ The paired positive: nobody has looked yet, unchanged from before this dispatch.
    expect(instructionAsksView(null, true, nameOf)).toBeNull()
  })

  it('marks a look that stopped answering as stale without dropping the rows it already had', () => {
    const theAsk = askWaiting()

    const stopped = instructionAsksView([theAsk], false, nameOf)
    expect(stopped).not.toBeNull()
    expect(stopped!.stale).toBe(true)
    expect(stopped!.partial).toBe(false)
    expect(stopped!.rows).toHaveLength(1)

    // ⚑ The paired positive: the same rows, but the look answered.
    const answering = instructionAsksView([theAsk], true, nameOf)
    expect(answering!.stale).toBe(false)
  })

  it('never swaps who asked for whose rules', () => {
    const theAsk = askWaiting({ proposedBy: 'pm', about: 'worker' })
    const named = (slug: string): string =>
      ({ pm: 'Project Manager', worker: 'Worker One' })[slug] ?? slug

    const rows = instructionAsksView([theAsk], true, named)!.rows

    expect(rows[0]!.askedBy).toBe('Project Manager')
    expect(rows[0]!.about).toBe('Worker One')
    expect(rows[0]!.why).toBe(theAsk.asked.why)
    expect(rows[0]!.text).toBe(theAsk.asked.text)
  })
})

/* -------------------------------------------------------------- §3 · cornerHead */

describe('§3 · cornerHead — the queue keeps its own hole, and one ask sings in the singular', () => {
  it("keeps the queue's own hole rather than the asks' when the queue itself is short, not merely empty", () => {
    const shortView = {
      count: 0,
      heading: 'Some other list has stopped answering',
      mayBeShort: true,
      rows: [],
    } as unknown as PersonsQueueView
    const stoppedAsks = { rows: [], partial: false, stale: true } as InstructionAsksView

    expect(cornerHead(shortView, stoppedAsks, null)!.heading).toBe(
      'Some other list has stopped answering',
    )

    // ⚑ The paired positive: a genuine all-clear (not short) lets the asks' own hole through.
    const allClearView = { ...shortView, mayBeShort: false } as unknown as PersonsQueueView
    expect(cornerHead(allClearView, stoppedAsks, null)!.heading).toBe(
      'One list has stopped answering',
    )
  })

  it('sings one ask in the singular even beside another population', () => {
    const view = {
      count: 1,
      heading: '1 question is waiting on you',
      mayBeShort: false,
      rows: [{ kind: 'a-question' } as unknown as PersonsQueueRow],
    } as unknown as PersonsQueueView
    const oneAsk = {
      rows: [{} as unknown as InstructionAskRow],
      partial: false,
      stale: false,
    } as InstructionAsksView

    const joined = cornerHead(view, oneAsk, null)
    expect(joined!.heading).toBe("1 question and 1 ask to set an agent's rules are waiting on you")
    expect(joined!.count).toBe(2)

    // ⚑ The paired contrast: no asks at all — the view's own heading stands, with no ask phrase
    // appended, which is what shows the phrase is additive rather than baked into every heading.
    expect(cornerHead(view, null, null)!.heading).toBe('1 question is waiting on you')
  })
})

/* -------------------------------------------------------------- §4 · usePersonsQueue */

describe('§4 · usePersonsQueue — supply(), mayBeShort, and the door for an ask', () => {
  it("supply() with no asks argument puts the queue's asks back to nobody has looked", () => {
    supply({ walked: [askWaiting()], lastLookAnswered: true, nameOf })
    expect(queue.asks.value).not.toBeNull()
    expect(queue.asks.value!.rows).toHaveLength(1)

    supply(undefined)
    expect(queue.asks.value).toBeNull()
  })

  it('an unanswered look for asks alone makes mayBeShort true, and an answered one does not', () => {
    supply({ walked: [], lastLookAnswered: false, nameOf })
    expect(queue.mayBeShort.value).toBe(true)

    supply({ walked: [], lastLookAnswered: true, nameOf })
    expect(queue.mayBeShort.value).toBe(false)
  })

  it('decideInstruction hands the door the askId and the approval, in that order', () => {
    supply(undefined)

    queue.decideInstruction('iprop_9', true)
    expect(decided).toEqual([['iprop_9', true]])

    queue.decideInstruction('iprop_9', false)
    expect(decided).toEqual([
      ['iprop_9', true],
      ['iprop_9', false],
    ])
  })
})

/* -------------------------------------------------------------- §5 · the two surfaces that draw it */

/** A trivial panel inside a real `OverlayHost` — which always renders `<PersonsQueue floating>`. */
const OverlayUnderTest = defineComponent({
  name: 'OverlayUnderTest',
  setup: () => () => h(OverlayHost, { label: 'A sheet' }, { default: () => h('div', 'a panel') }),
})

async function overlay(): Promise<Mounted> {
  const m = mount(OverlayUnderTest, {}, { width: 10, height: 10 })
  // The host's focus-trap effect runs off a `watch`; give it a tick to settle, as
  // `persons-queue.dom.test.ts`'s own `overlayOf` does.
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  return m
}

describe('§5 · Waiting on you and the overlay corner draw the same asks', () => {
  it("draws an agent's rule-ask as its own group, and folds it into whether anything needs you", async () => {
    const ask = askWaiting()
    supply({ walked: [ask], lastLookAnswered: true, nameOf })

    const m = mount(WaitingOnYou, { needsYou: [], clock: NOW })
    await nextTick()

    expect(visible(m.q('asks-group'))).toBe(true)
    expect(m.q('asks-count').textContent?.trim()).toBe('1')

    const row = m.q(`waiting-ask-${ask.asked.askId}`)
    expect(row.textContent).toContain(ask.asked.proposedBy)
    expect(row.textContent).toContain(ask.asked.about)
    expect(row.textContent).toContain(ask.asked.why)
    expect(row.textContent).toContain(ask.asked.text)

    m.q(`waiting-ask-approve-${ask.asked.askId}`).click()
    expect(decided).toEqual([[ask.asked.askId, true]])

    // ⚑ D-017 · R19: `onlyYou` is widened by the ask, so the page says something is waiting even
    // though `needsYou` is empty and the ordinary queue has no rows either — ⚑ **UI-009 (F052)**:
    // and it draws no empty *Conversations 0* group above it.
    expect(m.q('waiting-intro').textContent?.trim()).toBe('1 item below is waiting on you.')
    expect(m.host.querySelector('[data-cy="live-group"]')).toBeNull()

    // ⚑ The paired negative: with no asks and nothing else waiting, neither group draws at all,
    // and the page is quiet.
    unmountAll()
    supply(undefined)
    const empty = mount(WaitingOnYou, { needsYou: [], clock: NOW })
    await nextTick()
    expect(empty.host.querySelector('[data-cy="asks-group"]')).toBeNull()
    expect(empty.host.querySelector('[data-cy="live-group"]')).toBeNull()
    expect(empty.q('waiting-intro').textContent?.trim()).toBe(
      'Nothing here is blocked on an answer from you.',
    )
  })

  it('the overlay corner counts and lists the asks beside the queue’s own rows, and mounts on asks alone', async () => {
    const ask = askWaiting()
    supply({ walked: [ask], lastLookAnswered: true, nameOf })

    const m = await overlay()
    m.q('persons-queue-toggle').click()
    await nextTick()

    // ⚑ Pre-D-017 this card would not mount at all with nothing else present — see the `floating &&
    // asksSaySomething` clause `PersonsQueue.vue` added.
    expect(m.q('persons-queue-heading').textContent?.trim()).toBe(
      "An ask to set an agent's rules is waiting on you",
    )
    expect(m.q('persons-queue-count').textContent?.trim()).toBe('1')
    expect(m.q('persons-queue-asks')).toBeTruthy()
    expect(m.q(`persons-queue-ask-approve-${ask.asked.askId}`)).toBeTruthy()
    expect(m.q(`persons-queue-ask-refuse-${ask.asked.askId}`)).toBeTruthy()

    // ⚑ The paired negative: the SAME asks, mounted as the in-flow copy rather than the floating
    // corner one — it never draws `InstructionAsks`, which is `WaitingOnYou`'s own group's job.
    const inFlow = mount(PersonsQueue, {}, { width: 640, height: 400 })
    await nextTick()
    expect(inFlow.host.querySelector('[data-cy="persons-queue"]')).toBeNull()
    expect(inFlow.host.querySelector('[data-cy="persons-queue-asks"]')).toBeNull()
  })
})

/* -------------------------------------------------------------- §6 · the store read */

/** A bridge with exactly `instructionAsksForAPerson` on it — `persons-queue.test.ts` §7's pattern. */
function bridgeForAsks(answer: () => Promise<readonly InstructionAskWaiting[]>): RuntimeBridge {
  return everythingOverTheWire({
    instructionAsksForAPerson: answer,
    onEvent: () => () => {},
    onLiveness: () => () => {},
  }) as unknown as RuntimeBridge
}

describe('§6 · a refused read for instruction asks is a value, never an empty list', () => {
  it('a refused read for instruction asks is null, and an empty one is []', async () => {
    const refused = createSessionStore(
      bridgeForAsks(() => Promise.reject(new Error('the host is gone'))),
    )
    await expect(refused.instructionAsksForAPerson()).resolves.toBeNull()

    const empty = createSessionStore(bridgeForAsks(() => Promise.resolve([])))
    await expect(empty.instructionAsksForAPerson()).resolves.toEqual([])
  })
})
