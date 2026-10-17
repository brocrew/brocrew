import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import PersonsQueue from '../../src/renderer/src/components/PersonsQueue.vue'
import type { AttentionRequest } from '../../src/renderer/src/lib/attention'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { userInputOffer, whatThisAnswerDoes } from '../../src/renderer/src/lib/user-input-offer'
import type { UserInputRequestEvent } from '../../src/renderer/src/lib/transcript'
import {
  decisionReading,
  readingSentence,
  type LedgerWalk,
  type PersonsDecision,
  type RoutedRequest,
  type RequestOnlyAPersonCanSettle,
} from '../../src/shared/questions'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 478 · the two sentences, as a person actually reads them
 *
 * ⛔ **The dispatch's third piece of evidence is *"the sentences as a person reads them"***, and
 * the two files beside this one cannot supply it: one drives the adapters, the other folds events.
 * ⚑ **A sentence can be correct in a `Record` and unreadable on the control it belongs to** — and
 * the effect line is an 11px `<small>` inside a button, which is exactly the place a longer
 * sentence goes wrong.
 *
 * ## ⚠️ What is measured here, and what is deliberately left to the neighbours
 *
 * ⛔ **No sentence is spelled in this file.** Every expectation is read from `whatThisAnswerDoes`,
 * so this cannot become a third copy of the copy — it asserts that the copy ARRIVES on the button,
 * inside it, and legibly.
 *
 * ⚠️ **The viewport is shared across this directory**, so it is captured before the first resize
 * and restored after every test.
 */

const NOW = 1_700_000_000_000
const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
const NAME = (id: string): string => id.replace('sess_', '')

const queue = usePersonsQueue()
let settled: unknown[] = []
let view: Mounted | null = null

/** One `user_input_request`, built whole — what `userInputOffer` reads. */
const asking = (over: Partial<UserInputRequestEvent> = {}): UserInputRequestEvent => ({
  type: 'user_input_request',
  id: 'req_c',
  prompt: 'the agent asks you to approve something',
  questions: [],
  ...over,
})

function walked<Row>(rows: readonly Row[]): LedgerWalk<Row> {
  return {
    rows,
    walk: 'every-conversation-that-routed',
    ledgers: Math.max(rows.length, 1),
    rowsUnread: 0,
  }
}

function routed(requestId: string, askedBy: string): RoutedRequest {
  return {
    parent: 'sess_pm-alpha',
    went: {
      is: 'the-person-the-channel-left-it-with',
      to: 'a-person',
      because: 'a-permission-decision',
    },
    at: NOW,
    state: 'open',
    endedAt: null,
    escalatedAt: null,
    requestId,
    askedBy,
  }
}

/** The `a-decision` population row — what puts a decision on the person's queue at all. */
function decisionRow(requestId: string, askedBy: string): PersonsDecision {
  // ⚑ **611 · the ARM re-stated as a literal**, because `RequestOnlyAPersonCanSettle` narrows
  // `went` to the refused arm and `RoutedRequest` allows all three — the same lines
  // `persons-queue.dom.test.ts` writes, for the same reason.
  const request = {
    ...routed(requestId, askedBy),
    went: {
      is: 'the-person-the-channel-left-it-with',
      to: 'a-person',
      because: 'a-permission-decision',
    },
  } as const satisfies RequestOnlyAPersonCanSettle
  const reading = decisionReading(request.askedBy, NAME)
  return {
    request,
    reading,
    sentence: readingSentence(reading),
    says: 'a command or file approval, which is a person’s to give',
    work: [],
  }
}

/** The live attention row that makes it answerable where it stands (434). */
function live(key: string, over: Partial<AttentionRequest> = {}): AttentionRequest {
  const [sessionId = '', requestId = ''] = key.split(':')
  return {
    key,
    sessionId,
    requestId,
    itemId: `item_${requestId}`,
    kind: 'permission',
    where: 'worker-7',
    hasACommander: false,
    provider: 'claude',
    profileId: null,
    who: null,
    standing: 'waiting: permission',
    asked: 'run a command',
    scope: [],
    underDisclosed: false,
    detailOmitted: null,
    // ⚑ **487 · overridable like every other field here** — null is a request that can be allowed.
    noPositive: null,
    at: NOW,
    decisions: [],
    limit: null,
    sent: false,
    refused: null,
    ...over,
  }
}

function supply(rows: readonly AttentionRequest[]): void {
  queue.supply(
    walked([]),
    walked(
      rows.map((row) => decisionRow(row.requestId, `sess_${row.sessionId.replace('sess_', '')}`)),
    ),
    {
      held: new Set<string>(),
      answerable: new Map(rows.map((row) => [row.key, row])),
      now: NOW + 120_000,
      lastLookAnswered: { questions: true, decisions: true },
      answeredFromHere: new Set<string>(),
    },
    {
      travel: () => {},
      settle: (row, decision) => settled.push({ row, decision }),
      takeOver: () => {},
      open: () => {},
    },
  )
}

beforeEach(() => {
  settled = []
})

afterEach(async () => {
  unmountAll()
  view = null
  queue.forget()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/**
 * Every answer's effect the queue drew, in the card's order, as a person reads them with each row's
 * more options open: a primary answer's on the line its button is described by (*"Allow: …"*), a
 * broader answer's in the `<small>` inside its own button.
 */
async function effectLines(host: HTMLElement): Promise<{ text: string; el: HTMLElement }[]> {
  for (const more of host.querySelectorAll<HTMLDetailsElement>('details.pq-more')) more.open = true
  await nextTick()
  return [
    ...host.querySelectorAll<HTMLElement>(
      '.pq-more-body > .pq-does, .pq-more-body button.pq-answer small',
    ),
  ].map((el) => ({
    text: el.classList.contains('pq-does')
      ? el.innerText.trim().replace(/^[^:]*: /, '')
      : el.innerText.trim(),
    el,
  }))
}

describe('478 · the effect line is on the control, inside it, and readable', () => {
  it('🔴 a permission row draws every answer’s own effect, Cancel’s included', async () => {
    await page.viewport(1180, 808)
    supply([
      live('sess_worker-7:req_p', {
        decisions: [
          { kind: 'permission', label: 'Allow', decision: { outcome: 'allow' } },
          { kind: 'permission', label: 'Deny', decision: { outcome: 'deny' } },
          { kind: 'permission', label: 'Cancel', decision: { outcome: 'cancel' } },
        ],
      }),
    ])
    view = mount(PersonsQueue, {}, { width: 1180, height: 808 })
    await nextTick()

    const lines = await effectLines(view.host)
    // ⛔ **Read from the production function, never spelled here** — a third copy of the copy is
    // the `214` §3 defect this dispatch is a descendant of.
    expect(lines.map((line) => line.text)).toEqual([
      whatThisAnswerDoes({ kind: 'permission', label: 'Allow', decision: { outcome: 'allow' } }),
      whatThisAnswerDoes({ kind: 'permission', label: 'Deny', decision: { outcome: 'deny' } }),
      whatThisAnswerDoes({ kind: 'permission', label: 'Cancel', decision: { outcome: 'cancel' } }),
    ])
    for (const line of lines) expect(visible(line.el)).toBe(true)
  })

  it('⛔ …and the longest of them is not clipped by the button it lives in', async () => {
    // ⚠️ **The measurement this file exists for.** `478` made the Cancel line three times its old
    // length, and a `<small>` that overflows its button is a sentence a person cannot finish.
    await page.viewport(1180, 808)
    supply([
      live('sess_worker-7:req_p', {
        decisions: [
          { kind: 'permission', label: 'Cancel', decision: { outcome: 'cancel' } },
          { kind: 'permission', label: 'Allow', decision: { outcome: 'allow' } },
        ],
      }),
    ])
    view = mount(PersonsQueue, {}, { width: 1180, height: 808 })
    await nextTick()

    const lines = await effectLines(view.host)
    const longest = lines.reduce((a, b) => (a.text.length >= b.text.length ? a : b))
    expect(longest.text).toBe(
      whatThisAnswerDoes({ kind: 'permission', label: 'Cancel', decision: { outcome: 'cancel' } }),
    )
    const button = longest.el.closest('button')
    if (!button) throw new Error('the effect line is not inside a button')
    const line = longest.el.getBoundingClientRect()
    const box = button.getBoundingClientRect()
    // ⚑ Inside, on both axes, with the tolerance a sub-pixel layout needs and no more.
    expect(line.right).toBeLessThanOrEqual(box.right + 0.5)
    expect(line.bottom).toBeLessThanOrEqual(box.bottom + 0.5)
    // ⛔ **And it is laid out rather than collapsed** — a zero-height box is inside every other box
    // there is, so the two rects above would pass over a line nobody can read. ⚠️ **Not an
    // assertion that it WRAPPED**: at this width the sentence fits on one line, and a comment
    // claiming two would be the class of false sentence this whole dispatch is about.
    expect(line.height).toBeGreaterThan(0)
    // ⛔ **The overflow check proper** — this is what `white-space: nowrap` or a narrowed button
    // would trip, and it is the reason the longer sentence is safe on this control.
    expect(longest.el.scrollWidth).toBeLessThanOrEqual(Math.ceil(longest.el.clientWidth) + 1)
  })

  it('🔴 a zero-question consent draws the sentence its OWN request earns', async () => {
    // ⛔ **The §3.3 defect, on the surface.** Three requests share one button and one payload; the
    // three lines below must differ, and each must be the one its request earns.
    await page.viewport(1180, 808)
    const grant = asking({ permission: { paths: ['write /work/out'], network: false } })
    const enter = asking({ consent: 'start-planning' })
    const leave = asking({ consent: 'stop-planning' })
    supply([
      live('sess_a:req_grant', { kind: 'question', decisions: userInputOffer(grant).decisions }),
      live('sess_b:req_enter', { kind: 'question', decisions: userInputOffer(enter).decisions }),
      live('sess_c:req_leave', { kind: 'question', decisions: userInputOffer(leave).decisions }),
    ])
    view = mount(PersonsQueue, {}, { width: 1180, height: 808 })
    await nextTick()

    const approvals = (await effectLines(view.host))
      .map((line) => line.text)
      .filter((text) => text !== whatThisAnswerDoes({ kind: 'reject', label: 'Reject' }))
    expect(approvals).toHaveLength(3)
    // ⚑ Three rows, three different promises — the distinctness check a set whose members must
    // differ needs, taken on the painted DOM rather than on the table behind it.
    expect(new Set(approvals).size).toBe(3)
    expect(approvals).toEqual([
      whatThisAnswerDoes(userInputOffer(grant).decisions[0]!),
      whatThisAnswerDoes(userInputOffer(enter).decisions[0]!),
      whatThisAnswerDoes(userInputOffer(leave).decisions[0]!),
    ])
  })
})
