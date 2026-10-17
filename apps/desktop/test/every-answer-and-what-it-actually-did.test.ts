import { describe, expect, it } from 'vitest'
import { isProxy, ref } from 'vue'
import type { PermissionOutcome } from '@brobot2/runtime'
import { answerFor, type AttentionDecision } from '../src/renderer/src/lib/attention'
import { permissionOffer } from '../src/renderer/src/lib/permission-offer'
import {
  userInputOffer,
  whatThisAnswerDoes,
  type AttentionLimit,
} from '../src/renderer/src/lib/user-input-offer'
import type { UserInputRequestEvent } from '../src/renderer/src/lib/transcript'
import type { UserInputQuestion } from '../src/shared/runtime-ipc'
import { asTheWireWouldCarry } from './lib/the-wire'

/** One `user_input_request`, built whole — 478 made the offer take the request, not a slice. */
const asking = (
  questions: UserInputQuestion[],
  over: Partial<UserInputRequestEvent> = {},
): UserInputRequestEvent => ({
  type: 'user_input_request',
  id: 'req_476',
  prompt: 'the agent asks',
  questions,
  ...over,
})

/**
 * # 476 · every PersonsQueue answer, and the clone boundary before its effect
 *
 * This is a MEASUREMENT of the answer vocabulary, not a second implementation of it. The offered
 * roster comes from the production offer functions (two since D-016 took the proposal offer out)
 * and the expected sentences below are an independent literal oracle. The host/provider effects
 * are exercised by the focused suites named in the 476 response; this file owns the missing join
 * that let 469 through: a decision taken from a Vue-deep queue world is passed through
 * `answerFor`, then through a real structured clone.
 *
 * 🔴 The four permission cases now pin both sides of 473's repair: the raw nested decision remains
 * a reactive value that the wire refuses, while `answerFor` rebuilds the same outcome as a plain
 * value the wire carries. The paired readings make a return to handing over the nested object red.
 */

// 🔴 **739 · re-aimed** — `allow_always` joins the row (`736` F-1: *"*Always allow* is offered by the
// runtime and drawn by no surface"*), after the conversation's grant and before the refusals.
const PERSONS_QUEUE_PERMISSION_OUTCOMES = [
  'allow',
  'allow_for_session',
  'allow_always',
  'deny',
  'cancel',
] as const satisfies readonly Exclude<PermissionOutcome, 'allow_all_for_session'>[]

/**
 * ⚠️ **736 · R95 — offered by the runtime, drawn by NO surface yet** — until `739` drew it. 🔴 **739
 * · re-aimed**: the list that was asserted ABSENT from the row is asserted IN it now, and its answer
 * is carried exactly as it was — the drawing added a button and nothing on the wire.
 */
const DRAWN_SINCE_739 = ['allow_always'] as const satisfies readonly PermissionOutcome[]

const PERMISSION_WORDS = {
  allow: 'the agent may do this once',
  // ⚑ 736 · R94 — the CLI's own rule for the ask, no longer *"the same thing again"* (`728`'s file rule).
  allow_for_session:
    'the agent may do this, and what the provider’s own rule for it covers, for this conversation',
  allow_all_for_session: 'the agent may do anything of this kind for this conversation',
  // ⚑ 736 · R95 — typed out, as every other row here. 🔴 739 · re-aimed — the line for a card that
  // names neither the rule nor the file (a card that names them says both, `always-allow-on-every-
  // surface.render.test.ts`); `736`'s placeholder is gone.
  allow_always:
    'the agent may do this, and the provider’s own rule for it is kept beyond this conversation',
  deny: 'the agent is refused this one thing',
  // ⚑ **478** — this oracle said `'the request is cancelled'`, which `476` itself reported as
  // materially incomplete: both adapters call `requestInterrupt()` before they answer, so the
  // press ends the whole turn. The oracle moves with the repair and stays an independent literal.
  // ⚠️ **492** — and it moves again, for the claim rather than the scope: the Codex agent-tool door
  // now sends `turn/interrupt` instead of latching, and `asked` is what this app may say about an
  // interrupt on either provider. ⛔ Typed out, never imported: `ASKED_TO_STOP` is the subject here.
  cancel: 'the whole turn is asked to stop, and this request is refused',
} as const satisfies Readonly<Record<PermissionOutcome, string>>

const DECISION_WORDS = {
  permission: PERMISSION_WORDS.deny,
  answer: 'the agent is given “Current” as the answer',
  // ⚑ **478** — `'the request is approved with no answer'` described the PAYLOAD. The sentence is
  // now keyed by what the card is a consent TO; this row's decision is built with
  // `access-for-this-turn`, which is what a Codex `item/permissions/requestApproval` asks for.
  approve: 'the access this card asks for is granted, for this turn and no longer',
  reject: 'the request is declined and the agent is told nothing was answered',
} as const satisfies Readonly<Record<AttentionDecision['kind'], string>>

const LIMITED_QUESTIONS = {
  multiple: [
    { id: 'a', prompt: 'A?', options: [{ label: 'A' }] },
    { id: 'b', prompt: 'B?', options: [{ label: 'B' }] },
  ],
  'multi-select': [{ id: 'many', prompt: 'Many?', options: [{ label: 'A' }], multiSelect: true }],
  'free-form': [{ id: 'typed', prompt: 'Type?', options: [] }],
  secret: [{ id: 'secret', prompt: 'Secret?', options: [{ label: 'A' }], secret: true }],
} as const satisfies Readonly<Record<AttentionLimit, readonly UserInputQuestion[]>>

/** The relevant shape of `createPersonsQueue`'s deep `ref<PersonsQueueWorld>`. */
function fromADeepQueueWorld(decision: AttentionDecision): AttentionDecision {
  const world = ref({
    answerable: new Map([['session:request', { decisions: [decision] }]]),
  })
  const carried = world.value.answerable.get('session:request')?.decisions[0]
  if (carried === undefined) throw new Error('the planted queue decision disappeared')
  expect(isProxy(carried), `${decision.kind} did not pass through Vue's deep world`).toBe(true)
  return carried
}

describe('476 · the source-derived PersonsQueue answer roster', () => {
  it('enumerates every permission outcome the row may offer, with the wholesale grant apart', () => {
    const everyOutcome = Object.keys(PERMISSION_WORDS) as PermissionOutcome[]
    const offered = permissionOffer(everyOutcome, 'Bash')
    expect(offered.row).toEqual(PERSONS_QUEUE_PERMISSION_OUTCOMES)
    for (const outcome of DRAWN_SINCE_739) expect(offered.row).toContain(outcome)
    // 🔴 739 review · re-aimed — the wholesale grant's label was *"Always allow Bash this session"*;
    // since R95 *Always allow* is `allow_always` (in the row above), and this grant ends with the
    // conversation, so it says so.
    expect(offered.wide).toEqual({
      outcome: 'allow_all_for_session',
      label: 'Allow every Bash call for this conversation',
    })

    for (const outcome of everyOutcome) {
      expect(
        whatThisAnswerDoes({
          kind: 'permission',
          label: outcome,
          decision: { outcome },
        }),
      ).toBe(PERMISSION_WORDS[outcome])
    }
  })

  it('derives option, empty-consent and every limited question offer from the question shape', () => {
    const choices = userInputOffer(
      asking([
        {
          id: 'release',
          prompt: 'Which release?',
          options: [{ label: 'Current' }, { label: 'Previous' }],
          multiSelect: false,
        },
      ]),
    )
    expect(choices.decisions.map((decision) => decision.label)).toEqual([
      'Current',
      'Previous',
      'Reject',
    ])
    expect(choices.decisions.map(whatThisAnswerDoes)).toEqual([
      'the agent is given “Current” as the answer',
      'the agent is given “Previous” as the answer',
      'the request is declined and the agent is told nothing was answered',
    ])

    const consent = userInputOffer(asking([], { permission: { paths: [], network: false } }))
    expect(consent.decisions.map((decision) => decision.label)).toEqual(['Approve', 'Reject'])
    expect(consent.decisions.map(whatThisAnswerDoes)).toEqual([
      DECISION_WORDS.approve,
      'the request is declined and the agent is told nothing was answered',
    ])

    for (const limit of Object.keys(LIMITED_QUESTIONS) as AttentionLimit[]) {
      const offered = userInputOffer(asking([...LIMITED_QUESTIONS[limit]]))
      expect(offered.limit).toBe(limit)
      expect(offered.decisions.map((decision) => decision.label)).toEqual(['Reject'])
    }
  })
})

describe('476 · what actually reaches structured clone from a Vue-deep queue answer', () => {
  const cloneable = {
    answer: { kind: 'answer', label: 'Current', questionId: 'release', option: 'Current' },
    approve: { kind: 'approve', label: 'Approve', consent: 'access-for-this-turn' },
    reject: { kind: 'reject', label: 'Reject' },
  } as const satisfies Readonly<
    Record<Exclude<AttentionDecision['kind'], 'permission'>, AttentionDecision>
  >

  it.each(Object.values(cloneable))('$kind is rebuilt as a plain wire value', (decision) => {
    expect(whatThisAnswerDoes(decision)).toBe(DECISION_WORDS[decision.kind])
    const answer = answerFor(fromADeepQueueWorld(decision))
    const carried = asTheWireWouldCarry(`476 ${decision.kind}`, answer)
    expect(carried).toEqual(answer)
    expect(carried).not.toBe(answer)
  })

  /**
   * 🔴 **The four rows this file left RED — and the two dispatches that turned them over.**
   *
   * ⛔ **`476` wrote the failure deliberately and told its successor to replace it** — *"473 must
   * replace those four failure assertions with carried payload assertions … when it lands."* ⚠️ It
   * landed at `cdf6fb6`, this file merged at `622ae2c` unrebased, and `main` was red on exactly
   * these four until `40e402c`.
   *
   * ⚑ **`476` relay 1 and `478` then repaired it independently, and the body below is the
   * relay's** — a strict superset of what `478` wrote, because it keeps the pre-473 hand-over
   * as a NEGATIVE CONTROL beside the repair. ⛔ Without that control a wire that stopped cloning
   * would pass here, which is the defect `473` itself found in `469`'s step: an instrument that
   * cannot tell a fix from the absence of one. 🔴 `478` kept the relay's rather than its own
   * on the rebase; what `478` owns in this file are the EFFECT SENTENCES above.
   */
  // ⚑ 739 · `DRAWN_SINCE_739` is in the roster now, so the roster alone covers it once.
  it.each([...PERSONS_QUEUE_PERMISSION_OUTCOMES])(
    'permission %s rebuilds the proxied decision as the plain value the wire carries',
    (outcome) => {
      const decision = fromADeepQueueWorld({
        kind: 'permission',
        label: outcome,
        decision: { outcome },
      })
      if (decision.kind !== 'permission') throw new Error('the permission decision changed kind')

      expect(whatThisAnswerDoes(decision)).toBe(PERMISSION_WORDS[outcome])
      expect(isProxy(decision.decision)).toBe(true)

      // ⛔ The pre-473 hand-over, planted beside the repair: the nested object is still a Proxy and
      // the real structured-clone boundary still refuses it. A wire that stopped cloning goes green
      // above and red here; an `answerFor` that hands it over again does the reverse.
      expect(() =>
        asTheWireWouldCarry(`476 raw permission ${outcome}`, {
          permission: decision.decision,
        }),
      ).toThrow(/permission is a Vue reactive Proxy/)

      const answer = answerFor(decision)
      if (!('permission' in answer)) throw new Error('permission produced another answer kind')

      expect(answer).toEqual({ permission: { outcome } })
      expect(answer.permission).not.toBe(decision.decision)
      expect(isProxy(answer.permission)).toBe(false)

      const carried = asTheWireWouldCarry(`476 permission ${outcome}`, answer)
      expect(carried).toEqual({ permission: { outcome } })
      expect(carried).not.toBe(answer)
      expect(carried.permission).not.toBe(answer.permission)
    },
  )
})
