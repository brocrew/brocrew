import { permissionDecisionRow, routedPermission } from '../helpers/queue-fixtures'
import type { LedgerWalk, PersonsDecision } from '../../src/shared/question-contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import PersonsQueue from '../../src/renderer/src/components/PersonsQueue.vue'
import {
  attentionToACardNobodyHolds,
  type AttentionRequest,
} from '../../src/renderer/src/lib/attention'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { userInputOffer, whatThisAnswerDoes } from '../../src/renderer/src/lib/user-input-offer'
import type { UserInputRequestEvent } from '../../src/renderer/src/lib/transcript'
import { mount, permission, permissionOnQueue, unmountAll, visible, type Mounted } from './harness'

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

function decisionRow(requestId: string, askedBy: string): PersonsDecision {
  return permissionDecisionRow(routedPermission(askedBy, requestId, NOW, 'sess_pm-alpha'), NAME)
}

function consent(
  sessionId: string,
  requestId: string,
  request: UserInputRequestEvent,
): AttentionRequest {
  const row = attentionToACardNobodyHolds(
    sessionId,
    { asked: { ...request, id: requestId }, provider: 'claude', profileId: 'default' },
    { sent: false, refused: null },
    NAME,
  )
  if (!row) throw new Error('fixture did not produce a consent card')
  return row
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

/** Read the consequence inside each actual answer control. */
function effectLines(host: HTMLElement): { text: string; el: HTMLElement }[] {
  return [
    ...host.querySelectorAll<HTMLElement>(
      '[data-permission-decision] small, [data-cy="user-input-answer-does"], [data-cy="user-input-reject-does"]',
    ),
  ].map((el) => ({ text: el.innerText.trim(), el }))
}

describe('478 · the effect line is on the control, inside it, and readable', () => {
  it('🔴 a permission row draws every answer’s own effect, Cancel’s included', async () => {
    await page.viewport(1180, 808)
    const event = permission('req_p')
    supply([
      permissionOnQueue('sess_worker-7', {
        ...event,
        scope: { ...event.scope, availableDecisions: ['allow', 'deny', 'cancel'] },
      }),
    ])
    view = mount(PersonsQueue, {}, { width: 1180, height: 808 })
    await nextTick()

    const lines = effectLines(view.host)
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
    const event = permission('req_p')
    supply([
      permissionOnQueue('sess_worker-7', {
        ...event,
        scope: { ...event.scope, availableDecisions: ['cancel', 'allow'] },
      }),
    ])
    view = mount(PersonsQueue, {}, { width: 1180, height: 808 })
    await nextTick()

    const lines = effectLines(view.host)
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
      consent('sess_a', 'req_grant', grant),
      consent('sess_b', 'req_enter', enter),
      consent('sess_c', 'req_leave', leave),
    ])
    view = mount(PersonsQueue, {}, { width: 1180, height: 808 })
    await nextTick()

    const approvals = effectLines(view.host)
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
