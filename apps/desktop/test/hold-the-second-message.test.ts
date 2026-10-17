import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentRuntime, AgentToolAnswer } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { refuseInterrupt } from '../src/main/runtime/interrupt-rails'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { pieceCalled, pieceNumbersOf } from '../src/shared/piece-called'

/**
 * # 🔴 657 · hold the second message instead of refusing it
 *
 * ⛔ **`650` found a race and gave it an honest word**: a message read its receiver idle, awaited the
 * sign-in and the path check, and lost the handover to a turn another sender opened in that gap. It
 * answered `agent-started-a-turn-first` — *busy, not broken, make the same call again*. ⚑ **`657`
 * holds it instead**: the loser goes back through every gate against the busy conversation and is
 * held, or refused by the rail that is true then. The word is retired.
 *
 * ## ⚑ What each section holds to
 *
 *  - §1 · the race itself — two sends in one tick to one idle agent, and BOTH reach it.
 *  - §2 · a loser WAITS for work already on its way, or it would hold a second task beside it —
 *    and the wait is bounded (§2.1).
 *  - §3 · the app's own delivery doors — a reply, an answer — get the hold too.
 *  - §4 · a hold is never made after the conversation started closing — ⚑ D-017 · R1: the words
 *    wait out the stop and start it again, and go as its first turn.
 *  - §5 · `650` F5 — no identity read runs after the words have left.
 *  - §6 · `650` F4 — `withdraw_task` answers a launch in flight with the shared word.
 *  - §7 · `650` F7 — the interrupt door's sentence is true of a launch that fails.
 *
 * ⚑ **D-016 · the tree** — work is given with `give_work`, whose brief is the child's FIRST TURN, so
 * a child is never idle straight from its start: {@link aParentAndItsIdleChild} lets that first
 * piece be answered and its turn end. A message that only talks is a `note`; a follow-up names a
 * piece; and the one-open-task rail is gone, so §2's loser is held as a second piece.
 *
 * ⚠️ **§5 and §5.1 send a `note` where they sent `kind: 'work'`**, because the receipt §5 reads —
 * `message_sent` and the `toProfile` read on it — is a message's alone. ⚑ A give's brief goes
 * through the same `queueAs` and `sendAs`: its `user_turn` authorship is built before the handover
 * (the read §5.1 fails), and after the handover it writes only its piece (`recordTheGive`), which
 * reads no identity. So the give has no read after the handover for §5's trap to catch, and the note
 * is the door that still has one.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** ⛔ **What `650` answered the loser**, kept as the control every hold is measured against. */
const THE_RETIRED_WORD = 'agent-started-a-turn-first'

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** A latch a test opens by hand. */
const latch = (): { promise: Promise<void>; open: () => void } => {
  let open = (): void => {}
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

describe('657 · hold the second message instead of refusing it', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  /** ⛔ Texts handed to a provider, recorded BEFORE the call — so a refused handover shows too. */
  let sends: string[]
  /** ⚑ Holds a successful handover open AFTER the turn has begun — `queued-message.test.ts`' gate. */
  let sendGate: { promise: Promise<void>; open: () => void } | null
  /** ⚑ Holds `assertCanTakeTurn` inside the sign-in check, which the Fake has none of by itself. */
  let signInGate: { promise: Promise<void>; open: () => void } | null
  /** ⚑ Set the moment any handover is attempted — §5's trap arms on it. */
  let handedOver: boolean
  /** ⚑ §1.2 · when set, a REFUSED handover arms the sign-in gate, so the loser's second attempt parks. */
  let gateTheSecondAttempt: boolean
  /** ⚑ Opened when a gated sign-in check is reached. */
  let signInReached: { promise: Promise<void>; open: () => void }
  /** ⚑ A launch held inside `prepareProviderHome` — §6's reopen in flight. */
  let homeHold: { promise: Promise<void>; open: () => void } | null
  /** ⚑ **D-016** — the cards a person has allowed already, so a later turn's card is told apart. */
  let answeredCards: Set<string>

  const buildHost = (deliveryWaitMs?: number): RuntimeHost =>
    new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => {
        const inner = new FakeRuntime(provider, { sessions })
        const bind = <T extends object>(target: T, prop: string | symbol): unknown => {
          const value = Reflect.get(target, prop) as unknown
          return typeof value === 'function' ? value.bind(target) : value
        }
        const wrap = <H extends object>(handle: H): H =>
          new Proxy(handle, {
            get(h, p) {
              if (p === 'send') {
                return async (text: string) => {
                  sends.push(text)
                  handedOver = true
                  const sent = await (h as unknown as { send: (t: string) => Promise<void> })
                    .send(text)
                    .catch((error: unknown) => {
                      if (gateTheSecondAttempt) signInGate = latch()
                      throw error
                    })
                  if (sendGate !== null) await sendGate.promise
                  return sent
                }
              }
              if (p === 'checkSignIn') {
                return async () => {
                  if (signInGate !== null) {
                    signInReached.open()
                    await signInGate.promise
                  }
                  return false
                }
              }
              return bind(h, p)
            },
          })
        return new Proxy(inner, {
          get(target, prop) {
            if (prop === 'start') {
              return async (opts: Parameters<AgentRuntime['start']>[0]) =>
                wrap(await target.start(opts))
            }
            if (prop === 'resume') {
              return async (...args: Parameters<AgentRuntime['resume']>) =>
                wrap(await target.resume(...args))
            }
            return bind(target, prop)
          },
        }) as AgentRuntime
      },
      prepareProviderHome: async (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        if (homeHold !== null) await homeHold.promise
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: () => clock++,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      ...(deliveryWaitMs === undefined ? {} : { deliveryWaitMs }),
    })

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-657-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-657-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 6_000_000
    store = createSessionStore(db, () => clock++)
    counter = 0
    sessions = new FakeProviderSessions()
    sends = []
    sendGate = null
    signInGate = null
    handedOver = false
    gateTheSecondAttempt = false
    signInReached = latch()
    homeHold = null
    answeredCards = new Set()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    sendGate?.open()
    signInGate?.open()
    homeHold?.open()
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId: string,
    approvalMode: 'ask' | 'auto' = 'auto',
  ): Promise<string> =>
    (await host.createSession({ provider: 'claude', profileId, approvalMode, cwd: work }, window))
      .sessionId

  const toolsOf = (sessionId: string) => {
    const set = agentToolsFor(host, sessionId)
    return async (name: ToolName, args: Record<string, unknown>): Promise<AgentToolAnswer> => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      return tool.call(args)
    }
  }
  const payload = (answer: AgentToolAnswer): Record<string, unknown> =>
    answer.structured as Record<string, unknown>

  /** ⛔ Bounded, and it waits on the THING. */
  const until = async (check: () => boolean | Promise<boolean>, what: string): Promise<void> => {
    for (let n = 0; n < 400; n += 1) {
      if (await check()) return
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const eventsOf = (sessionId: string): { type: string; [key: string]: unknown }[] =>
    store.events(sessionId).map((one) => one.event as { type: string; [key: string]: unknown })
  const turnTexts = (sessionId: string): string[] =>
    eventsOf(sessionId)
      .filter((event) => event.type === 'user_turn')
      .map((event) => String(event.text))
  /** ⚑ **D-016** — the labels of the pieces given to a conversation, in the order they were given. */
  const labelsGivenIn = (sessionId: string): string[] =>
    eventsOf(sessionId)
      .filter((event) => event.type === 'work_given')
      .map((event) => String(event.label))

  /**
   * ⚑ **D-016** — the label a give answers under a parent, one number on from `label`: built by the
   * product's own `pieceCalled` from the numbers `pieceNumbersOf` reads, never spelled here.
   */
  const theNextAfter = (label: string): string => {
    const numbers = pieceNumbersOf(label)
    if (numbers === null || numbers.length < 2)
      throw new Error(`not a given piece's label: ${label}`)
    const last = numbers[numbers.length - 1] ?? 0
    return pieceCalled([...numbers.slice(0, -1), last + 1])
  }

  /**
   * ⚑ **A parent and a child its give started, idle.** ⛔ The child runs in `ask`, so every turn
   * PARKS on a permission card — which is what keeps it busy while a loser is held.
   *
   * ⚑ **D-016** — the give's brief is the child's first turn, so the child is made idle here: it
   * answers that first piece and a person lets the turn end. ⚠️ Answered, because a piece left open
   * when its turn ends STALLS, and a stalled helper refuses the next give (R2 step 6). ⛔ The reply
   * reaches the parent as a turn of its own, so the provider sends recorded until then are cleared.
   */
  const aParentAndItsIdleChild = async (): Promise<{
    parent: string
    child: string
    call: ReturnType<typeof toolsOf>
    piece: string
  }> => {
    await host.close(await personOpens('worker'), window)
    // ⚠️ **`ask`, because a child inherits its parent's mode**, and a child in `auto` finishes each
    // turn at once — nothing would ever be busy long enough to hold a message behind.
    const parent = await personOpens(DEFAULT_PROFILE_ID, 'ask')
    const call = toolsOf(parent)
    const given = payload(
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'X',
        brief: 'x',
      }),
    )
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const child = given.agent as string
    const piece = given.label as string
    const replied = payload(
      await toolsOf(child)('reply_to_parent', { piece, outcome: 'done', summary: 'done' }),
    )
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    await aPersonLetsItFinish(child)
    await until(
      () => host.agentCard(child, window, null)?.state.is === 'idle',
      'the child to be idle',
    )
    // ⚑ …and hands it back, so the child is nobody's again — as a child a give started is.
    host.releaseSession(child, window)
    await until(() => turnTexts(parent).length > 0, 'the reply to reach the parent')
    sends = []
    return { parent, child, call, piece }
  }

  /**
   * ⚑ A person takes the child over and allows its parked card, so its turn can end. ⚑ **D-016** —
   * only a card nobody has answered yet: the child's first turn raised one of its own.
   */
  const aPersonLetsItFinish = async (child: string): Promise<void> => {
    const openCards = (): string[] =>
      eventsOf(child)
        .filter((event) => event.type === 'permission_request')
        .map((event) => String(event.id))
        .filter((id) => !answeredCards.has(id))
    await until(() => openCards().length > 0, 'the child to park on its card')
    host.claimSession(child, window)
    for (const card of openCards()) {
      answeredCards.add(card)
      await host.respondPermission(child, card, { outcome: 'allow' }, window).catch(() => undefined)
    }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the race itself
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('§1 two sends in one tick to one idle agent: neither is refused, and BOTH reach it', async () => {
    const { child, call, piece } = await aParentAndItsIdleChild()
    const turnsBefore = turnTexts(child).length
    // ⚑ **D-016** — a note that talks, and a give whose brief is the work.
    const asked = { agent: child, text: 'what are you on', kind: 'note' }
    const given = {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'Then this',
      brief: 'then do this',
    }

    const answers = (
      await Promise.all([call('message_agent', asked), call('give_work', given)])
    ).map(payload)

    // ⛔ **The premise, measured rather than assumed**: both texts were HANDED to the provider, so
    // the second really did lose a handover — one of the two was refused by the adapter.
    expect(
      sends.filter((one) => one.includes('what are you on') || one.includes('then do this')),
    ).toHaveLength(2)
    // 🔴 **Neither is refused.** One went straight out; the other is HELD — in its own verb's word,
    // whichever lost: `message_agent` says `queued`, `give_work` says `held` (D-022 · R3).
    expect(answers.map((one) => one.outcome)).toEqual(['ok', 'ok'])
    expect([
      ['sent', 'held'],
      ['queued', 'sent'],
    ]).toContainEqual(answers.map((one) => one.delivery))
    // ⚠️ **The control**: `650` answered the loser with this word. It is nowhere now.
    expect(answers.map((one) => one.rail)).not.toContain(THE_RETIRED_WORD)

    // 🔴 **And BOTH reach it**: the parked turn ends, the held message goes out as its own turn.
    await aPersonLetsItFinish(child)
    await until(
      () => turnTexts(child).length === turnsBefore + 2,
      'the held message to reach the child',
    )
    expect(turnTexts(child).join('\n')).toContain('what are you on')
    expect(turnTexts(child).join('\n')).toContain('then do this')
    // ⚑ **One piece more, and the race burned no number** — the give's is the next under the root.
    expect(labelsGivenIn(child)).toEqual([piece, theNextAfter(piece)])
  })

  it('§1.1 and the answer a held caller reads is true whichever way the hold goes out', async () => {
    const { parent, child, call } = await aParentAndItsIdleChild()
    const named = host.nameByItsWork(child)
    const answers = await Promise.all([
      call('message_agent', { agent: child, text: 'first', kind: 'note' }),
      call('message_agent', { agent: child, text: 'second', kind: 'note' }),
    ])
    const held = answers.find((one) => payload(one).delivery === 'queued')
    expect(held).toBeDefined()
    const receipts = eventsOf(parent).filter((event) => event.type === 'message_sent')
    expect(receipts).toHaveLength(2)
    const acts = answers.map((one) => payload(one).messageAct)
    expect(new Set(acts).size).toBe(2)
    for (const act of acts) {
      expect(act).toMatch(/^message_act_[0-9a-f-]{36}$/)
      const matched = receipts.filter((event) => event.messageAct === act)
      expect(matched).toHaveLength(1)
      expect(matched[0]).toMatchObject({ to: child, addressedAs: child, toLabel: named })
    }
    // ⚑ Read before the winner's turn stops on its card, it goes once the child is free; read after,
    // it waits for the person's answer to that card — never for the turn's end, either way.
    expect(held?.text).toMatch(/at once, if it is|Its turn is stopped until a person answers/)
    expect(held?.text).not.toContain('anything held before it has gone')
    expect(held?.text).not.toContain('the turn it is running now ends')
  })

  /**
   * 🔴 **The two lines that only matter when the winner's turn ENDS between the loser's attempts.**
   *
   * ⛔ **The loser's second attempt is parked at its sign-in check** (the gate arms itself when the
   * adapter refuses the loser's handover) while a person lets the winner's turn finish, so when the
   * second attempt reads the conversation it is idle again. ⚑ It must still HOLD — a second attempt
   * never takes the idle branch, or it could race again without end — and the hold must still go
   * out, although the `idle` event that flushes a mailbox has already passed.
   */
  it('§1.2 a second attempt that finds the conversation free again still holds, and goes out at once', async () => {
    const { child, call } = await aParentAndItsIdleChild()
    const turnsBefore = turnTexts(child).length
    gateTheSecondAttempt = true
    const answers = [
      call('message_agent', { agent: child, text: 'what are you on', kind: 'note' }),
      call('message_agent', { agent: child, text: 'and one more thing', kind: 'note' }),
    ]
    await signInReached.promise
    // ⚑ The loser is parked; the winner's turn is parked on its card. A person lets it finish.
    gateTheSecondAttempt = false
    await aPersonLetsItFinish(child)
    await until(
      () => host.agentCard(child, window, null)?.state.is === 'idle',
      'the child to be free',
    )
    signInGate?.open()
    signInGate = null
    const settled = await Promise.all(answers)
    const [one, two] = settled.map(payload)
    // 🔴 **Held, not sent** — the second attempt never takes the idle branch.
    expect([one?.delivery, two?.delivery].sort()).toEqual(['queued', 'sent'])
    // ⛔ It said *"when the turn it is running now ends"*, and a hold made after a lost race can
    // find the winning turn already over — then it goes at once, with no turn to wait for.
    // ⚑ **D-027 moved the other half**: what is held no longer goes out BEFORE it, one turn each —
    // it goes out WITH it, in one turn, oldest first — so the answer says *"once <X> is free — at
    // once, if it is — with whatever else is held for it, oldest first"*, and the old *"anything
    // held before it has gone"* would now be false.
    const heldText = settled.find((answer) => payload(answer).delivery === 'queued')?.text
    expect(heldText).toContain('with whatever else is held for it, oldest first')
    expect(heldText).toContain('at once, if it is')
    expect(heldText).not.toContain('anything held before it has gone')
    expect(heldText).not.toContain('the turn it is running now ends')
    // 🔴 **And it goes out now**, with no `idle` event left to flush it.
    await until(
      () => turnTexts(child).length === turnsBefore + 2,
      'the held message to go out at once',
    )
    expect(turnTexts(child).join('\n')).toContain('and one more thing')
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · work already on its way is waited for
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * ⚑ **D-016 · the one-open-task rail is gone**, so the loser no longer meets the winner's open
   * work as a refusal: it is held as a second piece beside it. ⚑ What is left of `657`'s property is
   * the WAIT — the loser still waits for the winner's piece to be written down before it reads the
   * conversation, so it never races the handover.
   */
  it('§2 a loser waits for the winner’s work to be written down, and is held behind it — never a second handover', async () => {
    const { child, call, piece } = await aParentAndItsIdleChild()
    // ⚑ **The winner's handover is held open AFTER its turn has begun** — the real adapters'
    // shape, where `send` awaits the settings acknowledgement — so its piece is not written yet
    // when the loser reads the conversation.
    sendGate = latch()
    const first = call('give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'This',
      brief: 'do this',
    })
    const second = call('give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'And this',
      brief: 'and this',
    })
    let settled = 0
    void first.then(() => (settled += 1))
    void second.then(() => (settled += 1))
    await until(() => sends.length === 1, 'the first handover to be attempted')
    // ⛔ **Premise**: while the first handover is open, NEITHER call has answered — the second is
    // waiting for the first's work to be written down rather than deciding without it. ⚑ **And it
    // never raced at all**: it waited BEFORE it read the conversation idle, so only one handover was
    // ever attempted. Without the wait both would have been, and the second refused by the adapter.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(0)
    expect(sends).toHaveLength(1)
    expect(labelsGivenIn(child)).toEqual([piece])

    sendGate.open()
    sendGate = null
    const answers = (await Promise.all([first, second])).map(payload)
    // 🔴 **The loser is HELD behind the winner's piece** — a second piece, which is no longer a
    // refusal (D-016), and still never a second handover.
    expect(answers.map((one) => one.outcome)).toEqual(['ok', 'ok'])
    expect(answers.map((one) => one.delivery)).toEqual(['sent', 'held'])
    expect(answers.map((one) => one.agent)).toEqual([child, child])
    expect(labelsGivenIn(child)).toEqual([
      piece,
      theNextAfter(piece),
      theNextAfter(theNextAfter(piece)),
    ])
    expect(sends).toHaveLength(1)
  })

  it('§2.1 and the wait is bounded: a handover that never ends does not hang the loser', async () => {
    host = buildHost(40)
    const { child, call } = await aParentAndItsIdleChild()
    sendGate = latch()
    const first = call('give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'This',
      brief: 'do this',
    })
    const second = call('message_agent', { agent: child, text: 'and this', kind: 'note' })
    // ⚑ **The loser answers while the winner is still held** — it decided after the bound.
    const loser = await Promise.race([
      second,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000)),
    ])
    expect(loser).not.toBeNull()
    expect(payload(loser as AgentToolAnswer)).toMatchObject({ outcome: 'ok', delivery: 'queued' })
    sendGate.open()
    sendGate = null
    await first
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the app's own delivery doors get the hold too
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('§3 the app delivering two things at once to an idle conversation holds the second', async () => {
    const { child } = await aParentAndItsIdleChild()
    // ⚑ **`deliverReplyTo`'s own call shape** — the app itself, as work — which reported a lost
    // race as `not-delivered` until `657`: a child's reply lost to a microtask.
    const outcomes = await Promise.all([
      host.queueMessage(child, 'a reply arrives', THE_APP_ITSELF, [], 'work'),
      host.queueMessage(child, 'an answer arrives', THE_APP_ITSELF, [], 'notice'),
    ])
    expect(outcomes.map((one) => one.outcome).sort()).toEqual(['queued', 'sent'])
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · no hold after the conversation started closing
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * ⚑ **D-017 · R1 — a Close is a STOP, and *still closing* is never a refusal.** This was *"refused,
   * because nothing can ever send it"*: a hold in the mailbox of a conversation going away had no
   * ending. ⚑ Now the words wait out the stop and start it again, and go as its first turn — so the
   * property left is the one that mattered: they are never held in the mailbox the stop emptied.
   */
  it('§4 a message suspended while its receiver closes waits out the stop, starts it again, and is sent — never held in the mailbox that went', async () => {
    const { child, call } = await aParentAndItsIdleChild()
    // ⚑ Park the child on its card, so the message below takes the HELD branch.
    const cardsBefore = eventsOf(child).filter(
      (event) => event.type === 'permission_request',
    ).length
    expect(
      payload(
        await call('give_work', {
          profile: 'worker',
          title: 'Go',
          brief: 'go',
          definition_of_done: 'The requested result and its checks are recorded.',
        }),
      ).outcome,
    ).toBe('ok')
    await until(
      () =>
        eventsOf(child).filter((event) => event.type === 'permission_request').length > cardsBefore,
      'the child to park',
    )
    signInGate = latch()
    const asking = call('message_agent', { agent: child, text: 'are you there', kind: 'note' })
    host.claimSession(child, window)
    const closing = host.close(child, window)
    await closing
    signInGate.open()
    signInGate = null
    const answered = payload(await asking)
    // 🔴 **Delivered, to the conversation started again** — never refused as still closing.
    expect(answered).toMatchObject({ outcome: 'ok', delivery: 'sent', agent: child })
    const stopped = eventsOf(child).findIndex(
      (event) => event.type === 'session' && event.state === 'ended',
    )
    const reopened = eventsOf(child).findIndex((event) => event.type === 'reopened')
    expect(stopped).toBeGreaterThan(-1)
    expect(reopened).toBeGreaterThan(stopped)
    // ⚑ …as a turn of the NEW start, after the reopen.
    const turnAt = eventsOf(child).findIndex(
      (event) => event.type === 'user_turn' && event.text === 'are you there',
    )
    expect(turnAt).toBeGreaterThan(reopened)
    // ⛔ …and never held in the mailbox the stop emptied, where it would have had no ending.
    const queued = eventsOf(child).filter((event) => event.type === 'message_queued')
    expect(queued.map((event) => event.text)).not.toContain('are you there')
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · `650` F5 — no identity read runs after the words have left
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * ⛔ **The trap is armed AT the handover**, and only for the reads that happen inside the sending
   * code — every such read has a twin BEFORE the handover on the same row, so a trap armed from the
   * start would fire before the send both before and after the fix and measure nothing.
   */
  const aReadThatFailsAfterTheHandover = (ids: readonly string[]): void => {
    const real = store.identityOf.bind(store)
    vi.spyOn(store, 'identityOf').mockImplementation((id: string) => {
      const stack = new Error().stack ?? ''
      const sending =
        stack.includes('whoseWordsTheseAre') ||
        stack.includes('noteTheSending') ||
        stack.includes('queueAs')
      if (handedOver && sending && ids.includes(id))
        throw new Error('SQLITE_BUSY: database is locked')
      return real(id)
    })
  }

  it('§5 a read failing after the handover no longer turns delivered words into "not queued"', async () => {
    const { parent, child, call } = await aParentAndItsIdleChild()
    aReadThatFailsAfterTheHandover([parent, child])
    handedOver = false
    const answered = payload(
      await call('message_agent', { agent: child, text: 'build it', kind: 'note' }),
    )
    // 🔴 **RED before `657`**: the catch-all — *"the message was not queued"* — while the child's
    // own ledger held the turn those words opened.
    expect(answered).toMatchObject({ outcome: 'ok', delivery: 'sent' })
    expect(turnTexts(child).join('\n')).toContain('build it')
    // ⚑ **The hoisted values reached their rows**: the sender's receipt names the recipient.
    const receipt = eventsOf(parent).find((event) => event.type === 'message_sent')
    expect(receipt?.toProfile).toBe('worker')
  })

  it('§5.1 control: the same failing read BEFORE the handover refuses, and then "not queued" is true', async () => {
    const { parent, child, call } = await aParentAndItsIdleChild()
    aReadThatFailsAfterTheHandover([parent, child])
    handedOver = true
    const before = sends.length
    const answered = payload(
      await call('message_agent', { agent: child, text: 'build it', kind: 'note' }),
    )
    expect(answered).toMatchObject({ outcome: 'refused', rail: 'agent-cannot-take-a-message' })
    expect(sends.length).toBe(before)
    expect(turnTexts(child).join('\n')).not.toContain('build it')
  })

  it('§5.2 held branch: a read failing after the push no longer says "not queued" about words the mailbox holds', async () => {
    const { parent, child, call } = await aParentAndItsIdleChild()
    // ⚑ Park the child, so the next message takes the HELD branch.
    const cardsBefore = eventsOf(child).filter(
      (event) => event.type === 'permission_request',
    ).length
    expect(
      payload(
        await call('give_work', {
          profile: 'worker',
          title: 'Go',
          brief: 'go',
          definition_of_done: 'The requested result and its checks are recorded.',
        }),
      ).outcome,
    ).toBe('ok')
    await until(
      () =>
        eventsOf(child).filter((event) => event.type === 'permission_request').length > cardsBefore,
      'the child to park',
    )
    // ⛔ **Armed on the PUSH**, read off the host's own mailbox — a private cast, because the push is
    // the handover on this branch and nothing public observes it before the row that follows.
    const mailbox = (): unknown[] =>
      (
        host as unknown as {
          slots: Map<string, { session: { mailbox: unknown[] } | null }>
        }
      ).slots.get(child)?.session?.mailbox ?? []
    const real = store.identityOf.bind(store)
    vi.spyOn(store, 'identityOf').mockImplementation((id: string) => {
      const stack = new Error().stack ?? ''
      // ⚠️ **Either frame, because the read it hunts lived in `queueMessage` before `657`** — a trap
      // keyed on `queueAs` alone was green against the very code this test says it is red on
      // (measured by the review, on `main`). `whoseWordsTheseAre` is the read itself, wherever it runs.
      const theRead = stack.includes('queueAs') || stack.includes('whoseWordsTheseAre')
      if (mailbox().length > 0 && theRead && id === parent) {
        throw new Error('SQLITE_BUSY: database is locked')
      }
      return real(id)
    })
    const answered = payload(
      await call('message_agent', { agent: child, text: 'and then this', kind: 'note' }),
    )
    // 🔴 **RED before `657`**: the `message_queued` row re-read the caller's identity after the push,
    // so the caller was told *not queued* while the mailbox held the words and would send them.
    expect(answered).toMatchObject({ outcome: 'ok', delivery: 'queued' })
    expect(eventsOf(child).filter((event) => event.type === 'message_queued')).toHaveLength(1)
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · `650` F4 — withdraw_task and a launch in flight
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('§6 withdrawing work from a child whose reopen is in flight answers the shared word, and works once it lands', async () => {
    const { child, call } = await aParentAndItsIdleChild()
    const given = payload(
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The task',
        brief: 'the task',
      }),
    )
    expect(given.outcome).toBe('ok')
    const piece = given.label as string
    // ⚠️ **A person closes it, not the parent**: the child is parked on a person's card — and
    // since D-017 a Close is the one stop there is (`end_agent` is gone).
    host.claimSession(child, window)
    await host.close(child, window)

    // ⚑ **A person reopens it, and the launch is held** — the route where a task is real and its
    // holder is a reservation.
    homeHold = latch()
    const reopening = host.resumeSession(child, window)
    reopening.catch(() => undefined)
    const cards = async (): Promise<{ agent: string; state: string }[]> =>
      (payload(await call('list_agents', {})) as { agents: { agent: string; state: string }[] })
        .agents
    // ⚑ **D-017 · R11 — a start on its way in is `active`** (there is no *starting* state).
    await until(
      async () => (await cards()).some((one) => one.agent === child && one.state === 'active'),
      'the reopen to be listed as active',
    )

    const during = payload(await call('withdraw_task', { piece }))
    // 🔴 **RED before `657`**: `no-task-you-gave-that-agent`, priced `permanent`, about a task that
    // is real and that the identical call withdraws a moment later.
    // ⚑ **D-016** — `withdraw_task` names the piece alone, and the refusal carries its label.
    expect(during).toMatchObject({
      outcome: 'refused',
      rail: 'that-conversation-has-not-started',
      permanence: 'while-this-holds',
      detail: { piece, label: piece },
    })
    // ⚠️ **The control, one fact over**: a piece this caller never gave is still the old word —
    // the launch in flight is not disclosed to a caller the piece lookup would have refused.
    expect(payload(await call('withdraw_task', { piece: pieceCalled([99, 1]) })).rail).toBe(
      'not-a-piece-you-gave',
    )

    homeHold.open()
    homeHold = null
    await reopening
    expect(payload(await call('withdraw_task', { piece })).outcome).toBe('ok')
  })

  it('§6.1 a reopen a person is CLOSING is not a launch in flight, and is not told to retry', async () => {
    const { child, call } = await aParentAndItsIdleChild()
    const given = payload(
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The task',
        brief: 'the task',
      }),
    )
    expect(given.outcome).toBe('ok')
    const piece = given.label as string
    host.claimSession(child, window)
    await host.close(child, window)
    homeHold = latch()
    const reopening = host.resumeSession(child, window)
    reopening.catch(() => undefined)
    await until(
      async () =>
        (
          payload(await call('list_agents', {})) as { agents: { agent: string; state: string }[] }
        ).agents.some((one) => one.agent === child && one.state === 'active'),
      'the reopen to be listed as active',
    )
    const closing = host.close(child, window)
    closing.catch(() => undefined)
    // ⛔ **The fold, as `message_agent` keeps it**: this reservation will never come up.
    expect(payload(await call('withdraw_task', { piece })).rail).toBe('not-a-piece-you-gave')
    homeHold.open()
    homeHold = null
    await Promise.allSettled([reopening, closing])
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · `650` F7 — the interrupt door's sentence
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('§7 the interrupt door says both ways a launch in flight can end, and a person reads all of it', () => {
    const said = refuseInterrupt('that-conversation-has-not-started', { agent: 'sess_x' }).reason
    // ⛔ It said *"Wait for it to be working"*, which a launch that FAILS never is.
    expect(said).not.toContain('Wait for it to be working')
    expect(said).toContain('fails to launch on its own')
    expect(`refused (that-conversation-has-not-started): ${said}`.length).toBeLessThanOrEqual(200)
  })
})
