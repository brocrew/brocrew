import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { computed, defineComponent, h, nextTick, reactive } from 'vue'
import AttentionQueue from '../../src/renderer/src/components/AttentionQueue.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { attentionQueue } from '../../src/renderer/src/lib/attention'
import { GO_AHEAD_NOTE } from '../../src/renderer/src/lib/plan-mode'
import { createSessionRecord, type SessionRecord } from '../../src/renderer/src/lib/session-record'
import { createSessionStore } from '../../src/renderer/src/lib/session-store'
import type {
  AnswerAck,
  CreatedSession,
  PermissionDecision,
  PersistedEventInfo,
  ResumedSession,
  RuntimeBridge,
  TranscriptEvent,
} from '../../src/shared/runtime-ipc'
import { everythingOverTheWire } from '../lib/the-wire'
import { assertDrawn, drawnReady } from './drawn'
import { META, mount, paneProps, permission, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 739 · Draw 4, DRAWN — a command that has had no answer lets go of its buttons, and says so
 *
 * ⚑ **The finding, verbatim** (`737` §7 F-6): *"**A command whose promise never settles now keeps
 * `busy` up for good**, with nothing said: *Leave planning*, the go-ahead and both Reopens stay
 * dark."* ⚑ **Rule 8.4**: *"write one line saying what a person sees in that state. If the honest
 * answer is *nothing they can act on*, that is a finding and it outranks the test."*
 *
 * | § | surface | 🔴 subject (RED on `main` 8a52dfd8, by assertion) | ⚑ control, one fact over (green on both) |
 * |---|---|---|---|
 * | 1 | a planning Codex conversation whose *Leave planning* has had no answer | at 15_000 ms *Leave planning* and the go-ahead are lit again, and the line says the command has had no answer — drawn whole at the pane's width, and not as a failure; the late answer takes the line back | at 14_999 ms still dark, no line; a command answered inside the bound draws no line when the bound's time passes |
 * | 2 | the go-ahead, dark only because a command is out | its title says it waits for what was asked, not for a turn | a RUNNING conversation with a command out: *"Wait for the current turn to finish"* |
 * | 3 | a record built without the new field | — | draws no line (the old drawing) |
 * | 4 | a Claude conversation whose ANSWER to a permission card has had no answer (`739` #23, #6, #15) | at 15_000 ms the line is drawn beside the card while Home's row says *"answer sent — waiting for the conversation to settle"* — and the line contradicts neither: nothing about buttons, nothing about the window's waiting | past the bound the card's own buttons are still dark (`sent`) — only the host's answer lights them |
 * | 5 | the same conversation, a reader pinned to the bottom of a transcript that scrolls (`739` #9) | when the line appears at the bound — a sibling of the scroller taking height, on a timer, with no transcript change — the newest line is still the one on screen | a reader who scrolled up stays exactly where they were |
 *
 * ⚠️ **Re-aimed at `739`'s review round 1** (rule 26; `739` #23). ⛔ The line said *"…, so its
 * buttons no longer wait for it"*, which is false beside an ANSWER — a permission, a question, a
 * proposal: the answer goes through the same bounded `forSession`, but its card keeps its own `sent`
 * guard until the host answers (`markSent`, cleared only by `noteAnswer`). ⚑ It now says the
 * window's own act — *"This window has stopped waiting for it"* — and §4 draws the limit it no longer
 * overclaims: the line, beside a card whose buttons stay dark.
 *
 * ⚠️ **Re-aimed again at round 2** (rule 26; `739` #6, #15). ⛔ *"This window has stopped waiting for
 * it"* was false as well: beside an ANSWER, the card's `sent` guard and Home's own row — *"answer sent
 * — waiting for the conversation to settle"* — say the window IS waiting, and the store still awaits
 * the command. ⛔ And §4's check could not see it: it asked only that the line did not say *button*.
 * ⚑ The line now says only the fact and that an answer may still come, and §4 draws Home's row BESIDE
 * it at the same moment and asserts the line claims nothing about the window's waiting. ⚑ `739` #9:
 * the line is a sibling of the scroller that appears on a timer, so §5 measures a pinned reader.
 *
 * ⚑ **The REAL store and the REAL pane** — the store adopts the conversation the host hands back
 * (`attachOpen`), the pane is mounted on that same reactive record, and a press on *Leave planning*
 * or the go-ahead goes to `store.endPlanMode` exactly as `RuntimeScreen` wires `@end-plan-mode`.
 * Only the bridge is a double — through the wire's clone — and its `endPlanMode` parks on a promise
 * this file holds. ⛔ **Never awaited while parked**: on `main` that is red by timeout, not by
 * assertion. ⚑ At the width a conversation is drawn at beside the rail (1180 − 208 = 972 px), in a
 * window that wide, and left mounted until the test ends (the lead photographs these mounts).
 *
 * ⚑ **Time is the test's** (rule 22): only `setTimeout`/`clearTimeout` are faked, and only after the
 * mount — the frame and the font `drawnReady` waits on stay real.
 *
 * ⚠️ **What `main` (8a52dfd8; 5f406f2f and 176a860f before it) draws instead**, measured in its worktree with this file: at 15_000
 * ms, and after, *Leave planning* and the go-ahead stay dark and nothing is said beside the
 * conversation — no `session-unanswered`, no `session-error`; the go-ahead's title over an idle
 * conversation with a command out is *"Wait for the current turn to finish, then start work."*
 *
 * ⚠️ **`A_COMMAND_HAS_NOT_ANSWERED` is a NEW export of a module `main` has**, and this runner's
 * import analysis fails a WHOLE file on a specifier it cannot resolve — so it is reached by
 * `import.meta.glob`, awaited only inside subjects, as `the-stop-says-it-asks.dom.test.ts` reaches
 * its clause. The store half — the count, the late answer, `dispose` — is
 * `test/a-command-that-has-no-answer.test.ts`.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

const stores: { dispose(): void }[] = []

afterEach(async () => {
  unmountAll()
  for (const store of stores.splice(0)) store.dispose()
  vi.useRealTimers()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

type StoreModule = typeof import('../../src/renderer/src/lib/session-store')
const STORE_MODULE = import.meta.glob<StoreModule>('../../src/renderer/src/lib/session-store.ts')

/** ⚑ The sentence the draw added — `undefined` on a tree without it, and a subject then says so. */
async function theSentence(): Promise<string | undefined> {
  const load = Object.values(STORE_MODULE)[0]
  if (load === undefined) throw new Error('`lib/session-store.ts` is not on this tree')
  return (await load()).A_COMMAND_HAS_NOT_ANSWERED
}

const AT = 1_700_000_000_000
const RAIL_W = 208
const PANE_W = 972
const PANE_H = 900

/** ⚑ `A_COMMAND_IS_WAITED_ON_MS`, as a literal — the store suite pins the export against it. */
const THE_BOUND_MS = 15_000

/**
 * ⚑ The line, verbatim ONCE — each subject also reads it off the export. ⚠️ `739` review rounds 1
 * and 2 (#23, #6, #15): the fact and that an answer may still come — no claim about the buttons, and
 * none about the window's waiting (§4 draws why).
 */
const HAS_NOT_ANSWERED =
  'Something you asked of this conversation has had no answer in 15 seconds. An answer may still come — this line goes once every answer has.'

/** ⚑ Home's words on a row whose answer is out — `AttentionQueue`'s `attention-sent`, typed. */
const HOME_SAYS_SENT = 'answer sent — waiting for the conversation to settle'

/** ⚑ The go-ahead's two dark titles that are not a superseded sign-in's. */
const WAITS_FOR_AN_ANSWER =
  'Wait for what you just asked of this conversation to be answered, then start work.'
const WAITS_FOR_THE_TURN = 'Wait for the current turn to finish, then start work.'

/** ⚑ A Codex conversation — the host's echo of its provider on `meta`. */
const CODEX_META: CreatedSession = {
  ...META,
  provider: 'codex',
  providerHome: '/homes/codex',
  ref: { provider: 'codex', sessionId: 'th_1', cwd: '/work', rotation: 0 },
  planNeedsGoAhead: true,
}

const started = { type: 'session', state: 'started', ref: CODEX_META.ref } as TranscriptEvent
const asked = { type: 'user_turn', text: 'plan the migration' } as TranscriptEvent
const working = { type: 'status', state: 'working' } as TranscriptEvent

/** ⚑ Rows as the ledger hands them back, from ordinal 0. */
const rows = (...events: TranscriptEvent[]): PersistedEventInfo[] =>
  events.map((event, ordinal) => ({ ordinal, at: AT + ordinal * 1_000, event }))

/**
 * ⚑ The real store holding one planning Codex conversation — idle, or with a turn RUNNING — whose
 * `endPlanMode` waits on the test, and the real pane drawn on it.
 */
async function aPlanningConversationWhoseLeaveWaits(turn: 'idle' | 'running' = 'idle') {
  const answers: { resolve: () => void; reject: (cause: Error) => void }[] = []
  const handed: ResumedSession = {
    ...CODEX_META,
    history: {
      entries: turn === 'running' ? rows(started, asked, working) : [],
      from: 0,
      hasOlder: false,
      turnAligned: true,
    },
    handover: 'attached',
  }
  const bridge = everythingOverTheWire({
    onEvent: () => () => undefined,
    onLiveness: () => () => undefined,
    attachOpen: async () => [handed],
    endPlanMode: () =>
      new Promise<void>((resolve, reject) => void answers.push({ resolve, reject })),
  }) as unknown as RuntimeBridge
  const store = createSessionStore(bridge)
  stores.push(store)
  expect(await store.attachOpen(), 'the premise: the store holds the conversation').toEqual([
    'sess_1',
  ])
  const record = store.get('sess_1')
  if (record === null) throw new Error('the store adopted nothing')

  await page.viewport(PANE_W + RAIL_W, PANE_H)
  const m = mount(
    ConversationPane,
    paneProps({
      record,
      cwd: '/work',
      // ⚑ As `RuntimeScreen` wires it: `@end-plan-mode="(text) => … store.endPlanMode(activeId, text)"`.
      onEndPlanMode: (text?: string) => void store.endPlanMode('sess_1', text),
    }),
    { width: PANE_W, height: PANE_H },
  )
  await nextTick()
  await drawnReady()
  const leave = (): HTMLButtonElement => m.q('plan-leave-button') as HTMLButtonElement
  const goAhead = (): HTMLButtonElement => m.q('plan-go-ahead-button') as HTMLButtonElement
  expect(visible(leave()), 'the premise: Leave planning is on screen').toBe(true)
  expect(leave().disabled, 'the premise: nothing is out').toBe(false)
  // ⚑ Faked AFTER the mount and BEFORE the press: the bound is armed by the command.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  return { store, record, answers, m, leave, goAhead }
}

const settle = async (): Promise<void> => {
  await nextTick()
  await drawnReady()
}

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** ⚑ The line, found by its hook — a control can count none. */
const unansweredLines = (m: Mounted): HTMLElement[] => m.all('session-unanswered')

/* ------------------------------------------------------------------ §1 */

describe('§1 · a planning Codex conversation whose Leave planning has had no answer', () => {
  it('⚑ the control: at 14_999 ms Leave planning is still dark, and nothing is said', async () => {
    const { answers, m, leave } = await aPlanningConversationWhoseLeaveWaits()
    leave().click()
    await settle()
    expect(answers, 'the press reached the host').toHaveLength(1)
    expect(leave().disabled, 'the command is out').toBe(true)

    // ⚑ One millisecond short of `A_COMMAND_IS_WAITED_ON_MS`.
    await vi.advanceTimersByTimeAsync(THE_BOUND_MS - 1)
    await settle()
    expect(leave().disabled, 'inside the bound the command still holds the button').toBe(true)
    expect(unansweredLines(m), 'nothing has outlived its bound').toEqual([])
    expect(m.all('session-error')).toEqual([])
  })

  it('🔴 at 15_000 ms Leave planning and the go-ahead are lit again, and the line says the command has had no answer — drawn whole', async () => {
    const { answers, m, leave, goAhead } = await aPlanningConversationWhoseLeaveWaits()
    expect(goAhead().disabled, 'the premise: the go-ahead is lit over an idle turn').toBe(false)
    leave().click()
    await settle()
    expect(answers, 'the press reached the host').toHaveLength(1)
    expect(leave().disabled, 'the command is out').toBe(true)
    expect(goAhead().disabled).toBe(true)

    // ⚑ Exactly `A_COMMAND_IS_WAITED_ON_MS`.
    await vi.advanceTimersByTimeAsync(THE_BOUND_MS)
    await settle()
    // ⛔ On `main` both stay dark, for good.
    expect(leave().disabled, 'Leave planning stayed dark past the bound').toBe(false)
    expect(goAhead().disabled, 'the go-ahead stayed dark past the bound').toBe(false)
    expect(goAhead().getAttribute('title')).toBe(GO_AHEAD_NOTE)

    // ⚑ The photograph is taken here: lit, and the line says why.
    const lines = unansweredLines(m)
    expect(lines.map(text), 'nothing said why the buttons were lit').toEqual([HAS_NOT_ANSWERED])
    expect(lines.map(text), 'rule 5: the pane draws the export').toEqual([await theSentence()])
    const line = lines[0]!
    expect(visible(line)).toBe(true)
    assertDrawn(line, 'the no-answer line', m.host)
    // ⚑ Not a failure: nothing is said in the failure's place.
    expect(m.all('session-error'), 'an unanswered command was drawn as a failure').toEqual([])
    // ⚑ The caller was not answered by the bound: the command is still parked.
    expect(answers).toHaveLength(1)
  })

  it('🔴 …and the late answer takes the line back', async () => {
    const { answers, m, leave } = await aPlanningConversationWhoseLeaveWaits()
    leave().click()
    await settle()
    await vi.advanceTimersByTimeAsync(THE_BOUND_MS)
    await settle()
    // ⛔ On `main` there is no line to take back.
    expect(unansweredLines(m).map(text), 'the premise: the line is drawn').toEqual([
      HAS_NOT_ANSWERED,
    ])

    answers[0]!.resolve()
    await vi.advanceTimersByTimeAsync(0)
    await settle()
    expect(unansweredLines(m), 'the answer came and the line stayed').toEqual([])
    expect(leave().disabled).toBe(false)
    expect(m.all('session-error')).toEqual([])
  })

  it('⚑ the control: a command answered INSIDE the bound draws no line — not when the bound’s time passes either', async () => {
    const { answers, m, leave } = await aPlanningConversationWhoseLeaveWaits()
    leave().click()
    await settle()
    await vi.advanceTimersByTimeAsync(THE_BOUND_MS - 1)
    answers[0]!.resolve()
    await vi.advanceTimersByTimeAsync(0)
    await settle()
    expect(leave().disabled, 'answered, so lit on the answer').toBe(false)

    await vi.advanceTimersByTimeAsync(THE_BOUND_MS * 2)
    await settle()
    expect(unansweredLines(m), 'an answered command was said to have no answer').toEqual([])
    expect(leave().disabled).toBe(false)
  })
})

/* ------------------------------------------------------------------ §2 */

describe('§2 · the go-ahead, dark while a command is out', () => {
  it('🔴 over an IDLE conversation its title says it waits for what was asked — not for a turn', async () => {
    const { answers, leave, goAhead } = await aPlanningConversationWhoseLeaveWaits('idle')
    expect(goAhead().disabled, 'the premise: no turn is running').toBe(false)
    leave().click()
    await settle()
    expect(answers, 'the press reached the host').toHaveLength(1)
    expect(goAhead().disabled, 'the command is out').toBe(true)
    // ⛔ On `main`: *"Wait for the current turn to finish, then start work."* — over no turn at all.
    expect(goAhead().getAttribute('title')).toBe(WAITS_FOR_AN_ANSWER)
  })

  it('⚑ the control: over a RUNNING conversation, with the same command out, it waits for the turn', async () => {
    const { answers, leave, goAhead } = await aPlanningConversationWhoseLeaveWaits('running')
    expect(goAhead().disabled, 'the premise: a turn is running').toBe(true)
    expect(goAhead().getAttribute('title')).toBe(WAITS_FOR_THE_TURN)
    // ⚑ Leave planning stays pressable while a turn runs — that button sends nothing.
    leave().click()
    await settle()
    expect(answers, 'the press reached the host').toHaveLength(1)
    expect(goAhead().disabled).toBe(true)
    expect(goAhead().getAttribute('title')).toBe(WAITS_FOR_THE_TURN)
  })
})

/* ------------------------------------------------------------------ §3 */

describe('§3 · a record built without the new field', () => {
  it('⚑ the control: draws no line — the drawing it had before', async () => {
    // ⚑ A record as a double built before `739` would hand it: no `unanswered` at all.
    const bare = createSessionRecord('sess_1') as Partial<SessionRecord>
    delete bare.unanswered
    const record = reactive(bare as SessionRecord) as SessionRecord
    record.meta = CODEX_META
    record.phase = 'open'
    await page.viewport(PANE_W + RAIL_W, PANE_H)
    const m = mount(ConversationPane, paneProps({ record, cwd: '/work' }), {
      width: PANE_W,
      height: PANE_H,
    })
    await settle()
    expect(visible(m.q('plan-leave-button')), 'the pane drew the conversation').toBe(true)
    expect(unansweredLines(m)).toEqual([])
  })
})

/* ------------------------------------------------------------------ §4 */

/**
 * ⚑ **`739` #23 — an ANSWER that has had no answer.** The real store and the real pane over a Claude
 * conversation with a permission card up (`harness`'s own `permission`, *Allow* and *Deny*); a press
 * on the card goes to `store.respondPermission` exactly as `RuntimeScreen`'s `decide` wires
 * `@decide`, and the bridge's `respondPermission` parks. ⛔ Never awaited while parked.
 *
 * ⚑ `earlier` — the person's turns before the card, so §5's transcript scrolls; `0` for §4.
 */
async function aConversationWhoseAnswerWaits(earlier = 0) {
  const answers: { resolve: (ack: AnswerAck) => void; reject: (cause: Error) => void }[] = []
  const claudeStarted = { type: 'session', state: 'started', ref: META.ref } as TranscriptEvent
  const turns = Array.from(
    { length: earlier },
    (_, i) =>
      ({
        type: 'user_turn',
        text: `step ${i}: read the migration notes and say which table moves first, and why`,
      }) as TranscriptEvent,
  )
  const handed: ResumedSession = {
    ...META,
    history: {
      entries: rows(claudeStarted, ...turns, asked, permission('req_1'), {
        type: 'status',
        state: 'waiting_permission',
      } as TranscriptEvent),
      from: 0,
      hasOlder: false,
      turnAligned: true,
    },
    handover: 'attached',
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

  await page.viewport(PANE_W + RAIL_W, PANE_H)
  const m = mount(
    ConversationPane,
    paneProps({
      record,
      cwd: '/work',
      // ⚑ As `RuntimeScreen` wires it: `decide(requestId, decision)` → `store.respondPermission`.
      onDecide: (requestId: string, decision: PermissionDecision) =>
        void store.respondPermission('sess_1', requestId, decision),
    }),
    { width: PANE_W, height: PANE_H },
  )
  await nextTick()
  await drawnReady()
  const allow = (): HTMLButtonElement => m.q('permission-allow') as HTMLButtonElement
  const deny = (): HTMLButtonElement => m.q('permission-deny') as HTMLButtonElement
  expect(visible(allow()), 'the premise: the card is on screen').toBe(true)
  expect(allow().disabled, 'the premise: the card is answerable').toBe(false)
  // ⚑ Faked AFTER the mount and BEFORE the press: the bound is armed by the command.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  return { answers, m, allow, deny, record }
}

/**
 * ⚑ **Home, over the SAME reactive record** — `attentionQueue`, the projection `RuntimeScreen` hands
 * `AttentionQueue`, recomputed as the store writes the record. Mounted in its own box beside the
 * pane, as Home and a conversation are two surfaces a person reads at the same moment.
 */
function homeOver(record: SessionRecord): Mounted {
  const Home = defineComponent({
    setup() {
      const requests = computed(() => attentionQueue([record], () => 'waiting: permission'))
      return () => h(AttentionQueue, { requests: requests.value, now: AT + 60_000 })
    },
  })
  return mount(Home, {}, { width: 560, height: 480 })
}

/**
 * ⛔ **What a line would have to say to contradict a surface that is still waiting** — that the
 * window, or anything in it, stopped or no longer waits; and anything about buttons, whose card is
 * still dark beside it. ⚑ Read as words, so an innocent line passes and round 1's fails:
 * *"This window has stopped waiting for it"* matches, and so does *"its buttons no longer wait"*.
 */
const CLAIMS_ABOUT_WAITING = /\bwait/i
const CLAIMS_ABOUT_BUTTONS = /\bbutton/i

describe('§4 · an ANSWER to a permission that has had no answer: the line, beside a card still dark and Home still waiting (`739` #23, #6, #15)', () => {
  it('⚑ the control: past the bound the card’s own buttons are still dark — its `sent` guard waits for the host', async () => {
    const { answers, m, allow, deny } = await aConversationWhoseAnswerWaits()
    allow().click()
    await settle()
    expect(answers, 'the press reached the host').toHaveLength(1)
    expect([allow().disabled, deny().disabled], 'the press guarded the card').toEqual([true, true])

    await vi.advanceTimersByTimeAsync(THE_BOUND_MS)
    await settle()
    expect([allow().disabled, deny().disabled], 'the bound lit the card again').toEqual([
      true,
      true,
    ])
    await vi.advanceTimersByTimeAsync(THE_BOUND_MS * 4)
    await settle()
    expect([allow().disabled, deny().disabled], 'the card lit again with no answer').toEqual([
      true,
      true,
    ])
    expect(m.all('session-error'), 'an unanswered answer was drawn as a failure').toEqual([])
  })

  it('⚑ the control: Home’s row over the same answer says it is waiting — before the bound and after it', async () => {
    const { answers, allow, record } = await aConversationWhoseAnswerWaits()
    const home = homeOver(record)
    await settle()
    expect(home.all('attention-sent'), 'the premise: nothing is sent yet').toEqual([])
    allow().click()
    await settle()
    expect(answers, 'the press reached the host').toHaveLength(1)
    expect(home.all('attention-sent').map(text), 'Home did not say the answer is out').toEqual([
      HOME_SAYS_SENT,
    ])
    await vi.advanceTimersByTimeAsync(THE_BOUND_MS)
    await settle()
    // ⚑ The bound releases `busy` — never Home's word that the answer is on its way.
    expect(home.all('attention-sent').map(text), 'the bound took Home’s waiting away').toEqual([
      HOME_SAYS_SENT,
    ])
  })

  it('🔴 at 15_000 ms the line is drawn beside that card while Home says it is waiting — and it contradicts neither', async () => {
    const { answers, m, allow, deny, record } = await aConversationWhoseAnswerWaits()
    const home = homeOver(record)
    allow().click()
    await settle()
    expect(answers, 'the press reached the host').toHaveLength(1)

    await vi.advanceTimersByTimeAsync(THE_BOUND_MS)
    await settle()
    // ⛔ On `main` nothing is said: no line at all.
    const lines = unansweredLines(m)
    expect(lines.map(text), 'nothing said the answer has had no answer').toEqual([HAS_NOT_ANSWERED])
    expect(lines.map(text), 'rule 5: the pane draws the export').toEqual([await theSentence()])
    const line = lines[0]!
    assertDrawn(line, 'the no-answer line beside a card', m.host)

    // ⚑ The two surfaces the line sits beside, at the SAME moment, each still waiting: the card's
    // own buttons dark on its `sent` guard, and Home's row saying the answer is on its way.
    expect([allow().disabled, deny().disabled], 'the card is not still waiting').toEqual([
      true,
      true,
    ])
    const sent = home.all('attention-sent')
    expect(sent.map(text), 'Home is not still waiting').toEqual([HOME_SAYS_SENT])
    expect(visible(sent[0]!)).toBe(true)
    expect(visible(line)).toBe(true)
    // ⛔ `739` #6/#15 — so the line may say nothing about the window's waiting (round 1's *"This
    // window has stopped waiting for it"* said the opposite of Home's row), and nothing about
    // buttons (round 0's *"its buttons no longer wait for it"* said the opposite of the card's).
    expect(text(line), 'the line contradicts Home’s “waiting”').not.toMatch(CLAIMS_ABOUT_WAITING)
    expect(text(line), 'the line speaks of the card’s buttons').not.toMatch(CLAIMS_ABOUT_BUTTONS)
    // ⚑ …and the sensor is live: Home's own words DO speak of waiting, and round 1's line did too.
    expect(text(sent[0]!)).toMatch(CLAIMS_ABOUT_WAITING)
    expect('This window has stopped waiting for it').toMatch(CLAIMS_ABOUT_WAITING)
    // ⚑ What the line does say, true beside both: an answer may still come.
    expect(text(line)).toContain('An answer may still come')
  })
})

/* ------------------------------------------------------------------ §5 */

/**
 * ⚑ **`739` #9 — the line is a sibling of the scroller that takes height on a TIMER.** `.pane-
 * unanswered` sits beside `TranscriptView`'s scroll container, not in it, and appears when the bound
 * passes — no press, no transcript change — so `useStickToBottom`'s follow signal hears of it only
 * through the pane's footprint (`paneFootprint`, `520`'s category: *"A third such sibling joins this
 * string"*). ⚠️ **This section is the measurement** (`the-button-between-looking-and-killing-it`'s
 * §6 shape): nothing in the markup can see a reader lose the last line to the fold.
 */
describe('§5 · a reader pinned to the bottom stays pinned when the line appears (`739` #9)', () => {
  const scrollerOf = (m: Mounted): HTMLElement => {
    const el = m.host.querySelector<HTMLElement>('.stream')
    expect(el, 'no .stream scroll container').not.toBeNull()
    return el!
  }
  const gapOf = (el: HTMLElement): number => el.scrollHeight - el.scrollTop - el.clientHeight

  it('🔴 at 15_000 ms the line takes its height beside the scroller — and the newest line is still the one on screen', async () => {
    const { answers, m, allow } = await aConversationWhoseAnswerWaits(40)
    const stream = scrollerOf(m)
    // ⛔ **The premise, asserted**: this transcript really scrolls, and the reader really is pinned.
    expect(stream.scrollHeight).toBeGreaterThan(stream.clientHeight + 200)
    allow().click()
    await settle()
    expect(answers, 'the press reached the host').toHaveLength(1)
    expect(gapOf(stream), 'the premise: the reader is at the bottom before the bound').toBe(0)
    const before = stream.clientHeight

    await vi.advanceTimersByTimeAsync(THE_BOUND_MS)
    await settle()
    // ⛔ On `main` no line appears, so nothing takes the space.
    expect(unansweredLines(m).map(text), 'the line did not appear').toEqual([HAS_NOT_ANSWERED])
    // ⚑ The line really did take the scroller's height — without this the pin below would pass
    // over a line drawn somewhere that moved nothing.
    expect(stream.clientHeight, 'the line took no height from the scroller').toBeLessThan(before)
    // 🔴 …and the reader is still at the bottom.
    expect(gapOf(stream), 'the newest line went below the fold').toBe(0)
  })

  it('⚑ the control: a reader who scrolled up stays exactly where they were', async () => {
    const { answers, m, allow } = await aConversationWhoseAnswerWaits(40)
    const stream = scrollerOf(m)
    allow().click()
    await settle()
    expect(answers, 'the press reached the host').toHaveLength(1)
    stream.scrollTop = 200
    stream.dispatchEvent(new Event('scroll'))
    await settle()
    expect(gapOf(stream), 'the premise: the reader left the bottom').toBeGreaterThan(100)

    await vi.advanceTimersByTimeAsync(THE_BOUND_MS)
    await settle()
    expect(stream.scrollTop, 'a reader who scrolled up was moved').toBe(200)
  })
})
