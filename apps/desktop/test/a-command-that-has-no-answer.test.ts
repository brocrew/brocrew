import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionStore } from '../src/renderer/src/lib/session-store'
import type { SessionRecord } from '../src/renderer/src/lib/session-record'
import {
  DEFAULT_PROFILE_ID,
  type AnswerAck,
  type ApprovalModeDisclosure,
  type ResumedSession,
  type RuntimeBridge,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { everythingOverTheWire } from './lib/the-wire'

/**
 * # 🔴 739 · Draw 4 — a command that has had no answer lets go of `busy`, and says so (`737` F-6)
 *
 * ⚑ **The finding, verbatim** (`737` §7): *"**A command whose promise never settles now keeps
 * `busy` up for good**, with nothing said: *Leave planning*, the go-ahead and both Reopens stay
 * dark."* ⚑ **The brief's draw** (`739` §2.4): *"Bound it: after the bound, `busy` comes down and
 * the person is told the command has not answered (rule 8.4)."*
 *
 * ⚑ **The bound releases the BUTTONS, never the caller** (`A_COMMAND_IS_WAITED_ON_MS`'s own
 * docblock): the command's promise is still awaited, and its value or its failure lands when it
 * comes. So every late answer below is asserted on what it WRITES — the disclosure a late
 * `setApprovalMode` puts on `meta`, the sentence a late failure puts in `error`.
 *
 * | § | 🔴 subject (RED on `main` 8a52dfd8, by assertion) | ⚑ control, one fact over (green on both) |
 * |---|---|---|
 * | 1 | at 15_000 ms `busy` is down, one command is counted unanswered, and the caller still waits; the bound and the sentence are the exports', and the sentence claims nothing about buttons or about the window's waiting | at 14_999 ms the command still holds `busy`, and nothing is counted |
 * | 2 | a late success takes the count back, writes no error, and lands its value; a late failure takes it back and says its own sentence | a command answered INSIDE the bound: nothing is counted when the bound's time passes |
 * | 3 | the count never goes below zero: after a released command's late answer, two new commands out, the first settles — still busy; two out, one past its bound — still busy until the other settles | two out, BOTH inside their bounds: still busy until the last settles, nothing counted |
 * | 4 | — | a store disposed before the bound: no BOUND fires into the record when the time passes |
 * | 5 | an ANSWER to a permission out past the bound: `busy` down and counted, like any command | the card's own guard (`sent`) is still up past the bound — only the host's answer takes it off |
 *
 * ⚠️ **Re-aimed at `739`'s review round 1** (rule 26; `739` #23, #28). ⛔ The sentence said *"…, so
 * its buttons no longer wait for it"* — false for an answer to a permission, a question or a
 * proposal: each goes through `forSession` AND keeps its card's `sent` guard until the host answers
 * (`markSent`, cleared only by `noteAnswer`); §5 is that limit, measured. ⛔ And §4 said *"a store
 * that is gone writes nothing"*; `dispose` clears the bounds only (a command still out settles as it
 * would have), so §4 says what it measures: no bound fires after `dispose`.
 *
 * ⚠️ **Re-aimed again at round 2** (rule 26; `739` #6, #15). ⛔ Round 1's words — *"This window has
 * stopped waiting for it"* — were false too: the store still awaits every bounded command (§1, §2:
 * the caller is still waiting, and a late answer lands), and beside an ANSWER the card's `sent`
 * guard and Home's *"answer sent — waiting for the conversation to settle"* say the window IS
 * waiting. ⚑ The sentence now says only what is true of every bounded command — it has had no
 * answer, and an answer may still come — and §1 pins that it claims nothing about buttons or about
 * the window's waiting.
 *
 * ⚠️ **What `main` (8a52dfd8; 5f406f2f and 176a860f before it) does instead**, measured in its worktree with this file: `busy` stays
 * `true` for as long as the command is out — at 15_000 ms and at any time after — and the record has
 * no `unanswered` at all (`undefined`); `A_COMMAND_IS_WAITED_ON_MS` and `A_COMMAND_HAS_NOT_ANSWERED`
 * are `undefined` off the module.
 *
 * ⚑ **The real store, adopting a planning Codex conversation through `attachOpen`** — the door a
 * window takes it by — over a bridge that goes through the wire's clone (`the-wire.ts`, 361 §2).
 * Only the bridge is a double: its `endPlanMode` and `setApprovalMode` park on promises this file
 * holds. ⛔ **A parked call is never awaited** (a flip awaiting a parked call is red by TIMEOUT on
 * `main`, not by assertion): each is answered by the test first, and the caller's state is read off
 * a flag set when it settles.
 *
 * ⚑ **Time is the test's** (rule 22): `setTimeout`/`clearTimeout` are faked BEFORE each command,
 * so no assertion here is about the machine's clock. ⚠️ The advances are LITERALS (`15_000`,
 * `14_999`) with the constant named beside them, and §1 asserts the export equals the literal — a
 * constant that moved would redden that pin rather than silently move every advance with it.
 *
 * ⚠️ **The new exports are reached only INSIDE subjects**, by a dynamic `import()`: a static import
 * of a name `main` does not export would redden every test here on `main`, controls included.
 * ⚠️ **No wire field is new in this draw** — the bound is a local copy (`739` GAP: no door's bound
 * is on the wire) — so no bridge double can lag behind one. ⚑ The new RECORD field is read with
 * `?? 0` in the controls only, because on `main` it does not exist and draws the same nothing.
 * The drawing — Leave planning lit again and the line said beside the conversation — is
 * `test/dom/a-command-that-has-no-answer.dom.test.ts`.
 */

/** ⚑ The new exports — read inside subjects only (see the header). */
const since739 = (): Promise<typeof import('../src/renderer/src/lib/session-store')> =>
  import('../src/renderer/src/lib/session-store')

/** ⚑ The bound, as a literal — `A_COMMAND_IS_WAITED_ON_MS`, pinned against it in §1. */
const THE_BOUND_MS = 15_000

/**
 * ⚑ The pane's line, verbatim ONCE — rule 5 pins it by `A_COMMAND_HAS_NOT_ANSWERED` in §1.
 * ⚠️ `739` review rounds 1 and 2 (#23, #6, #15): the fact and that an answer may still come — never
 * a claim about the buttons (§5) or that the window stopped waiting (it did not: §1, §2).
 */
const HAS_NOT_ANSWERED =
  'Something you asked of this conversation has had no answer in 15 seconds. An answer may still come — this line goes once every answer has.'

const AT = 1_700_000_000_000

/** ⚑ A planning Codex conversation, as the host hands one back to a window. */
const HANDED: ResumedSession = {
  sessionId: 'sess_1',
  provider: 'codex',
  cwd: '/work/checkout',
  providerHome: '/homes/codex',
  profileId: DEFAULT_PROFILE_ID,
  ref: { provider: 'codex', sessionId: 'th_1', cwd: '/work/checkout', rotation: 0 },
  config: {
    home: '/homes/codex',
    homeEnv: 'CODEX_HOME',
    model: 'gpt-5-codex',
    authNote: null,
    files: [],
  },
  instructions: {
    injected: [],
    agentMemory: [],
    provider: [],
    refused: [],
    note: '',
    recallsReported: false,
    writesReported: false,
    composed: null,
  },
  approvalMode: 'ask',
  pendingApprovalMode: null,
  approvalNote: 'approvals: ask',
  blanketGrants: [],
  planNeedsGoAhead: true,
  queued: [],
  settings: {
    model: null,
    pendingModel: null,
    reasoningEffort: null,
    pendingReasoningEffort: null,
    planMode: true,
    pendingPlanMode: null,
  },
  liveness: { state: 'live', since: AT },
  hasACommander: false,
  startedWithoutAWindow: false,
  mayHandItBack: false,
  history: { entries: [], from: 0, hasOlder: false, turnAligned: true },
  handover: 'attached',
}

/** ⚑ What a late `setApprovalMode` hands back — the host's echo, which the store folds onto `meta`. */
const NOW_AUTO: ApprovalModeDisclosure = {
  approvalMode: 'auto',
  pendingApprovalMode: null,
  approvalNote: 'approvals: auto',
  blanketGrants: [],
}

interface Parked<T> {
  resolve: (value: T) => void
  reject: (cause: Error) => void
}

/** ⚑ A promise the store is waiting on, and whether it has settled — read, never awaited. */
interface Watched {
  readonly settled: () => boolean
  readonly promise: Promise<void>
}

function watch(promise: Promise<unknown>): Watched {
  let settled = false
  const done = promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  return { settled: () => settled, promise: done }
}

const stores: { dispose(): void }[] = []

beforeEach(() => {
  stores.length = 0
})

afterEach(() => {
  for (const store of stores) store.dispose()
  vi.useRealTimers()
})

/**
 * ⚑ The real store holding one planning Codex conversation, adopted through `attachOpen`, whose
 * Leave planning (`endPlanMode`) and approval switch (`setApprovalMode`) wait on the test.
 */
async function aConversationWhoseCommandsWait() {
  const leaves: Parked<void>[] = []
  const switches: Parked<ApprovalModeDisclosure>[] = []
  const bridge = everythingOverTheWire({
    onEvent: () => () => undefined,
    onLiveness: () => () => undefined,
    attachOpen: async () => [HANDED],
    endPlanMode: () =>
      new Promise<void>((resolve, reject) => void leaves.push({ resolve, reject })),
    setApprovalMode: () =>
      new Promise<ApprovalModeDisclosure>(
        (resolve, reject) => void switches.push({ resolve, reject }),
      ),
  }) as unknown as RuntimeBridge
  const store = createSessionStore(bridge)
  stores.push(store)
  expect(await store.attachOpen(), 'the premise: the store holds the conversation').toEqual([
    'sess_1',
  ])
  const record = store.get('sess_1')
  if (record === null) throw new Error('the store adopted nothing')
  expect(record.busy, 'the premise: nothing is out').toBe(false)
  // ⚑ Faked AFTER the adoption and BEFORE the first command: the bound is armed by the command.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  return { store, record, leaves, switches }
}

/** ⚑ What the record says of commands with no answer — `main` has no field, which says nothing. */
const counted = (record: SessionRecord): number =>
  (record as { unanswered?: number }).unanswered ?? 0

/* ------------------------------------------------------------------ §1 */

describe('§1 · a command out past the bound lets go of `busy`, and is counted', () => {
  it('⚑ the control: at 14_999 ms the command still holds `busy`, and nothing is counted unanswered', async () => {
    const { store, record } = await aConversationWhoseCommandsWait()
    const leave = watch(store.endPlanMode('sess_1'))
    expect(record.busy, 'Leave planning is out').toBe(true)

    // ⚑ One millisecond short of `A_COMMAND_IS_WAITED_ON_MS`.
    await vi.advanceTimersByTimeAsync(THE_BOUND_MS - 1)
    expect(record.busy, 'inside the bound the command still holds the buttons').toBe(true)
    expect(counted(record), 'nothing has outlived its bound').toBe(0)
    expect(leave.settled(), 'the caller is still waiting').toBe(false)
    expect(record.error).toBeNull()
  })

  it('🔴 at 15_000 ms `busy` comes down and one command is counted unanswered — the caller still waits', async () => {
    const { store, record } = await aConversationWhoseCommandsWait()
    const leave = watch(store.endPlanMode('sess_1'))

    // ⚑ Exactly `A_COMMAND_IS_WAITED_ON_MS`.
    await vi.advanceTimersByTimeAsync(THE_BOUND_MS)
    // ⛔ On `main` this is `true`, and it stays `true` for as long as the command is out.
    expect(record.busy, 'the bound passed and the buttons are still held').toBe(false)
    expect(record.unanswered, 'the command that outlived its bound is counted').toBe(1)
    // ⚑ The bound releases the buttons, never the caller: nothing has answered it.
    expect(leave.settled(), 'the bound answered the caller in the command’s place').toBe(false)
    expect(record.error, 'an unanswered command is not a failure').toBeNull()

    // ⚑ …and it stays that way: the bound fires once, not once a period.
    await vi.advanceTimersByTimeAsync(THE_BOUND_MS * 4)
    expect(record.unanswered).toBe(1)
    expect(record.busy).toBe(false)
  })

  it('🔴 the bound is `A_COMMAND_IS_WAITED_ON_MS`, 15_000, and the pane’s sentence is `A_COMMAND_HAS_NOT_ANSWERED`, verbatim', async () => {
    const since = await since739()
    // ⛔ Both are `undefined` off `main`'s module.
    expect(since.A_COMMAND_IS_WAITED_ON_MS, 'the literal every advance here uses').toBe(
      THE_BOUND_MS,
    )
    expect(since.A_COMMAND_HAS_NOT_ANSWERED).toBe(HAS_NOT_ANSWERED)
    // ⚑ The sentence's number is the bound's, composed rather than typed twice.
    expect(since.A_COMMAND_HAS_NOT_ANSWERED).toContain(
      `no answer in ${since.A_COMMAND_IS_WAITED_ON_MS / 1_000} seconds`,
    )
    // ⛔ Never *failed* (`086`: the window cannot back it), and no provider is named — the window
    // cannot tell a provider's silence from the app's own.
    expect(since.A_COMMAND_HAS_NOT_ANSWERED).not.toMatch(/fail|Codex|Claude/i)
    // ⛔ `739` #23 — nothing about BUTTONS: an answer's own card keeps its `sent` guard past the
    // bound (§5), so *"its buttons no longer wait for it"* was false there. ⛔ `739` #6/#15 — and
    // nothing about the window's WAITING: the store still awaits the command (the caller above is
    // still waiting, §1; a late answer lands, §2), so *"This window has stopped waiting for it"*
    // was false of every command it bounds. ⚑ Beside the two negatives, the positive: what IS true
    // of every one — an answer may still come.
    expect(since.A_COMMAND_HAS_NOT_ANSWERED).not.toMatch(/button/i)
    expect(since.A_COMMAND_HAS_NOT_ANSWERED).not.toMatch(/wait/i)
    expect(since.A_COMMAND_HAS_NOT_ANSWERED).toContain('An answer may still come')
  })
})

/* ------------------------------------------------------------------ §2 */

describe('§2 · the late answer takes the count back, and lands', () => {
  it('🔴 a late SUCCESS: nothing counted, no error, `busy` stays down — and the caller gets its value', async () => {
    const { store, record, switches } = await aConversationWhoseCommandsWait()
    const flip = watch(store.setApprovalMode('sess_1', 'auto'))
    expect(switches, 'the press reached the host').toHaveLength(1)

    await vi.advanceTimersByTimeAsync(THE_BOUND_MS)
    // ⛔ On `main`: still busy.
    expect(record.busy, 'the premise: the bound passed').toBe(false)
    expect(record.unanswered).toBe(1)
    expect(flip.settled(), 'the caller is still waiting on the real answer').toBe(false)
    expect(record.meta?.approvalMode, 'nothing has landed yet').toBe('ask')

    switches[0]!.resolve(NOW_AUTO)
    await flip.promise
    expect(record.unanswered, 'the late answer takes its count back').toBe(0)
    expect(record.busy).toBe(false)
    expect(record.error).toBeNull()
    // ⚑ The value lands when it comes — the disclosure is on `meta`, as an early answer's would be.
    expect(record.meta?.approvalMode, 'the late disclosure was dropped').toBe('auto')
    expect(record.meta?.approvalNote).toBe(NOW_AUTO.approvalNote)
  })

  it('🔴 a late FAILURE: the failure’s own sentence beside the conversation, and nothing counted', async () => {
    const { store, record, leaves } = await aConversationWhoseCommandsWait()
    const leave = watch(store.endPlanMode('sess_1'))

    await vi.advanceTimersByTimeAsync(THE_BOUND_MS)
    // ⛔ On `main`: still busy.
    expect(record.busy, 'the premise: the bound passed').toBe(false)
    expect(record.unanswered).toBe(1)

    leaves[0]!.reject(
      new Error("Error invoking remote method 'runtime:command': Error: the plan could not end"),
    )
    await leave.promise
    expect(record.unanswered, 'the late failure takes its count back').toBe(0)
    expect(record.error, 'the failure is said beside the conversation').toBe(
      'the plan could not end',
    )
    expect(record.busy).toBe(false)
  })

  it('⚑ the control: a command answered INSIDE the bound is never counted — not when the bound’s time passes either', async () => {
    const { store, record, leaves } = await aConversationWhoseCommandsWait()
    const leave = watch(store.endPlanMode('sess_1'))

    await vi.advanceTimersByTimeAsync(THE_BOUND_MS - 1)
    leaves[0]!.resolve()
    await leave.promise
    expect(record.busy, 'answered, so nothing is out').toBe(false)

    // ⚑ Past where its bound would have fired: the answer cleared it.
    await vi.advanceTimersByTimeAsync(THE_BOUND_MS * 2)
    expect(counted(record), 'an answered command was counted unanswered').toBe(0)
    expect(record.busy).toBe(false)
    expect(record.error).toBeNull()
  })
})

/* ------------------------------------------------------------------ §3 */

describe('§3 · the count: counted down once, never below zero', () => {
  it('🔴 after a released command’s late answer, two new commands are out and the FIRST settles — still busy', async () => {
    const { store, record, leaves, switches } = await aConversationWhoseCommandsWait()
    const first = watch(store.endPlanMode('sess_1'))
    await vi.advanceTimersByTimeAsync(THE_BOUND_MS)
    // ⛔ On `main`: still busy.
    expect(record.busy, 'the premise: the first command was released at its bound').toBe(false)
    leaves[0]!.resolve()
    await first.promise
    expect(record.unanswered, 'its late answer took its count back').toBe(0)

    // ⚑ Two new commands, both inside their bounds.
    const second = watch(store.endPlanMode('sess_1'))
    const third = watch(store.setApprovalMode('sess_1', 'auto'))
    expect(record.busy).toBe(true)
    leaves[1]!.resolve()
    await second.promise
    // ⛔ A command counted down twice — by its bound AND by its late answer — leaves the count one
    // short, and the first of the next two to settle lowers `busy` under the other.
    expect(record.busy, 'a command is still out, and the count said none was').toBe(true)

    switches[0]!.resolve(NOW_AUTO)
    await third.promise
    expect(record.busy, 'the last one settled').toBe(false)
    expect(record.unanswered, 'never below zero').toBe(0)
  })

  it('🔴 two commands out, one past its bound and one inside it: `busy` stays up until the second settles', async () => {
    const { store, record, leaves, switches } = await aConversationWhoseCommandsWait()
    const first = watch(store.endPlanMode('sess_1'))
    await vi.advanceTimersByTimeAsync(10_000)
    const second = watch(store.setApprovalMode('sess_1', 'auto'))

    // ⚑ The first command's bound passes; the second is 5 s into its own.
    await vi.advanceTimersByTimeAsync(THE_BOUND_MS - 10_000)
    // ⛔ On `main` there is no count at all.
    expect(record.unanswered, 'the first command outlived its bound').toBe(1)
    expect(record.busy, 'the second command is out and inside its bound').toBe(true)

    switches[0]!.resolve(NOW_AUTO)
    await second.promise
    // ⛔ On `main` the first command still holds it.
    expect(record.busy, 'the only counted command answered').toBe(false)
    expect(record.unanswered, 'the first is still unanswered').toBe(1)

    leaves[0]!.resolve()
    await first.promise
    expect(record.unanswered).toBe(0)
    expect(record.busy).toBe(false)
  })
  it('⚑ the control: two commands out, BOTH inside their bounds — `busy` stays up until the last settles', async () => {
    const { store, record, leaves, switches } = await aConversationWhoseCommandsWait()
    const first = watch(store.endPlanMode('sess_1'))
    await vi.advanceTimersByTimeAsync(10_000)
    const second = watch(store.setApprovalMode('sess_1', 'auto'))

    // ⚑ One millisecond short of the first command's bound.
    await vi.advanceTimersByTimeAsync(THE_BOUND_MS - 10_000 - 1)
    expect(counted(record), 'nothing has outlived its bound').toBe(0)
    expect(record.busy).toBe(true)

    switches[0]!.resolve(NOW_AUTO)
    await second.promise
    expect(record.busy, 'the first command is still out').toBe(true)

    leaves[0]!.resolve()
    await first.promise
    expect(record.busy, 'the last one settled').toBe(false)
    expect(counted(record)).toBe(0)
  })
})

/* ------------------------------------------------------------------ §4 */

/**
 * ⚠️ **`739` review #28 — what this measures, and only that**: `dispose` clears the BOUNDS, so none
 * fires into a record afterwards. ⛔ It is not *"a store that is gone writes nothing"*: a command still
 * out when the store is disposed settles as it would have, and its own `catch`/`finally` write its
 * own answer — this file never settles one after `dispose`, so it claims nothing about that.
 */
describe('§4 · after `dispose`, no bound fires into a record', () => {
  it('⚑ the control: disposed before the bound, the bound’s time passing writes nothing into the record', async () => {
    const { store, record } = await aConversationWhoseCommandsWait()
    const leave = watch(store.endPlanMode('sess_1'))
    await vi.advanceTimersByTimeAsync(THE_BOUND_MS - 1)
    store.dispose()

    await vi.advanceTimersByTimeAsync(THE_BOUND_MS * 2)
    expect(record.busy, 'a bound fired after `dispose` and lowered a record’s `busy`').toBe(true)
    expect(counted(record), 'a bound fired after `dispose` and counted a command').toBe(0)
    expect(leave.settled()).toBe(false)
  })
})

/* ------------------------------------------------------------------ §5 */

/** ⚑ A permission card the host is waiting on — the row the fold draws a card from. */
const ASKS: TranscriptEvent = {
  type: 'permission_request',
  id: 'req_1',
  kind: 'command',
  action: 'Bash',
  detail: 'run: ls',
  scope: {
    cwd: '/work/checkout',
    paths: [],
    networkHosts: [],
    persistence: 'once',
    amendments: [],
    availableDecisions: ['allow', 'deny'],
    underDisclosed: false,
  },
} as TranscriptEvent

/**
 * ⚑ The real store holding one Codex conversation with a permission card up, whose ANSWER
 * (`respondPermission`) waits on the test — the command `739` #23 found the sentence overclaimed on.
 */
async function aConversationWhoseAnswerWaits() {
  const answers: Parked<AnswerAck>[] = []
  const handed: ResumedSession = {
    ...HANDED,
    planNeedsGoAhead: false,
    settings: { ...HANDED.settings, planMode: false },
    history: {
      entries: [
        { ordinal: 0, at: AT, event: ASKS },
        { ordinal: 1, at: AT + 1_000, event: { type: 'status', state: 'waiting_permission' } },
      ] as ResumedSession['history']['entries'],
      from: 0,
      hasOlder: false,
      turnAligned: true,
    },
  }
  const bridge = everythingOverTheWire({
    onEvent: () => () => undefined,
    onLiveness: () => () => undefined,
    attachOpen: async () => [handed],
    respondPermission: () =>
      new Promise<AnswerAck>((resolve, reject) => void answers.push({ resolve, reject })),
  }) as unknown as RuntimeBridge
  const store = createSessionStore(bridge)
  stores.push(store)
  expect(await store.attachOpen(), 'the premise: the store holds the conversation').toEqual([
    'sess_1',
  ])
  const record = store.get('sess_1')
  if (record === null) throw new Error('the store adopted nothing')
  expect(
    record.control.items.some((item) => item.kind === 'permission' && item.request.id === 'req_1'),
    'the premise: the card is up',
  ).toBe(true)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  return { store, record, answers }
}

/** ⚑ The card's own in-flight guard — what its buttons are disabled on (`PermissionCard`'s `sent`). */
const guardUp = (record: SessionRecord): boolean | undefined => record.requests.get('req_1')?.sent

describe('§5 · an ANSWER with no answer: `busy` comes down, and the card keeps its own guard (`739` #23)', () => {
  it('⚑ the control: past the bound the card’s guard (`sent`) is still up — only the host’s answer takes it off', async () => {
    const { store, record, answers } = await aConversationWhoseAnswerWaits()
    const answer = watch(store.respondPermission('sess_1', 'req_1', { outcome: 'allow' }))
    expect(answers, 'the answer reached the host').toHaveLength(1)
    expect(guardUp(record), 'the press put the guard up').toBe(true)

    await vi.advanceTimersByTimeAsync(THE_BOUND_MS)
    expect(guardUp(record), 'the bound took the card’s guard off').toBe(true)
    await vi.advanceTimersByTimeAsync(THE_BOUND_MS * 4)
    expect(guardUp(record), 'the card’s guard came off with no answer').toBe(true)
    expect(answer.settled(), 'the caller is still waiting').toBe(false)
    expect(record.error, 'an unanswered answer is not a failure').toBeNull()
  })

  it('🔴 …while the ANSWER, like any command, lets go of `busy` at the bound and is counted unanswered', async () => {
    const { store, record, answers } = await aConversationWhoseAnswerWaits()
    const answer = watch(store.respondPermission('sess_1', 'req_1', { outcome: 'allow' }))
    expect(answers, 'the answer reached the host').toHaveLength(1)
    expect(record.busy, 'the answer is out').toBe(true)

    await vi.advanceTimersByTimeAsync(THE_BOUND_MS)
    // ⛔ On `main`: still busy, and nothing counted.
    expect(record.busy, 'the bound passed and `busy` is still up').toBe(false)
    expect(record.unanswered, 'the answer that outlived its bound is counted').toBe(1)
    // ⚑ The limit the pane's sentence must not contradict: the card is still guarded.
    expect(guardUp(record)).toBe(true)
    expect(answer.settled()).toBe(false)
  })
})
