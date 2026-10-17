import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, type AgentRuntime, type SessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { GO_AHEAD_MESSAGE } from '../src/renderer/src/lib/plan-mode'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { isVisibleIn } from '../src/renderer/src/lib/transcript-mode'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import type {
  RuntimeEventMessage,
  SessionLiveness,
  SessionLivenessMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * # 🔴 A message BroBot should sign (278, from 276)
 *
 * Pressing “Start work on this plan” creates `Go ahead with this plan.` as a `user_turn`.
 * Record it as app-authored so the transcript cannot attribute generated words to the person.
 *
 * ## ⛔ The measurement that decides what the fix may NOT be
 *
 * The obvious repair is to stop sending the sentence. `276` ran the committed `CodexRuntime`
 * against the bundled **0.146.0** app-server, `gpt-5.6-luna` low, a fresh isolated provider home
 * per trial, and measured all three shapes:
 *
 * | shape | continuation | work |
 * |---|---|---|
 * | switch alone, nothing sent | **0/2** turns, 10 s of silence | **0/2** files |
 * | switch **+ the message** (what the button does) | **2/2** | **2/2**, byte-exact |
 * | the message alone, plan mode still on | 5/5 | acted 3/5; **2/5** said they were waiting for plan mode to end |
 *
 * ⚑ `setPlanMode(false)` records a phase for the NEXT turn and sends nothing, so with no next turn
 * Codex never receives the switch at all. **The message is what starts the turn**, and every test
 * below that asserts the sentence still reaches the provider is asserting that measurement.
 *
 * ⚠️ **So this dispatch changes the AUTHORSHIP and nothing else.** The event stays a `user_turn`
 * because it really is one — `045` opens a turn row from that event and from nothing else — and the
 * transcript stops drawing it as anybody's bubble.
 *
 * ⚠️ **Codex-only, and 276 corrected the record on that too.** Claude's planning ends at the model's
 * own `ExitPlanMode` card, so this button is not drawn there and `setPlanMode(false)` rejects —
 * measured in `packages/runtime/test/claude-runtime.test.ts`, *"the client-side switch OFF is still
 * refused"*, and held at the renderer end by `app-authored-turn.render.test.ts`.
 *
 * ⚠️ **This is the node half, and the split is a tsconfig boundary rather than a taste.** Everything
 * that imports an SFC is in `app-authored-turn.render.test.ts`: `tsconfig.web.json` typechecks the
 * `.render.test.ts` suffix with `vue-tsc`, and `tsconfig.node.json` takes every other test with no
 * Vue shims — so a `.vue` import here passes `pnpm run test` and fails `pnpm run typecheck`, which
 * is a green suite beside a red gate.
 */

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  // ⛔ **A WINDOW's owner id, since 413, and it is load-bearing here of all files.** The turn
  // below is the positive half of every negative in this suite — *"a turn somebody TYPED is still
  // unmarked"* — and `413` made that answer depend on the caller being a window: a turn is the
  // person's only when a person demonstrably typed it, which is a POSITIVE test on the id
  // `sinkOwnerId` mints. ⚠️ A double spelling its own id `owner:1` was standing in for a window
  // and did not look like one, so it was asserting the person's case from a caller the product
  // classifies as something else.
  readonly ownerId = sinkOwnerId({ id: 1 })
  readonly alive = true
  readonly messages: RuntimeEventMessage[] = []
  readonly liveness: SessionLiveness[] = []
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(message: SessionLivenessMessage): void {
    this.liveness.push(message.liveness)
  }
  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }
}

/**
 * ⛔ **A runtime that records the exact string the PROVIDER was handed.**
 *
 * ⚠️ **Reading the ledger is not enough here, and that is the whole reason this wrapper exists.**
 * The ledger event and the provider send are two different acts in `endPlanMode`, and the failure
 * this dispatch must not introduce is the one where the transcript is corrected and the message
 * quietly stops going — which is 276's shape A, measured at **0/2** turns. A test that asserted only
 * the transcript entry would pass for that build.
 *
 * Wraps a real {@link FakeRuntime} through a `Proxy` rather than reimplementing a handle, so
 * everything else about the double — the plan state machine `060` relies on, the turn machinery —
 * stays the real one.
 */
class RecordingRuntime implements AgentRuntime {
  readonly sent: string[] = []
  /** Whether a session was started or resumed on it, rather than only a model list asked. */
  launched = false
  private readonly inner: FakeRuntime

  constructor(provider: Provider) {
    this.inner = new FakeRuntime(provider)
  }

  get provider(): AgentRuntime['provider'] {
    return this.inner.provider
  }

  async listModels(
    ...args: Parameters<AgentRuntime['listModels']>
  ): ReturnType<AgentRuntime['listModels']> {
    return await this.inner.listModels(...args)
  }

  private watch(handle: SessionHandle): SessionHandle {
    const sent = this.sent
    return new Proxy(handle, {
      get(target, key, receiver) {
        if (key !== 'send') return Reflect.get(target, key, receiver)
        return async (text: string) => {
          sent.push(text)
          return await (target as SessionHandle).send(text)
        }
      },
    })
  }

  async start(options: Parameters<AgentRuntime['start']>[0]): Promise<SessionHandle> {
    this.launched = true
    return this.watch(await this.inner.start(options))
  }

  async resume(...args: Parameters<AgentRuntime['resume']>): Promise<SessionHandle> {
    this.launched = true
    return this.watch(await this.inner.resume(...args))
  }
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('the go-ahead reaches the provider and is signed by BroBot (278 §1)', () => {
  let userData: string
  let host: RuntimeHost
  let sink: RecordingSink
  let runtimes: RecordingRuntime[]

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-authored-'))
    runtimes = []
    let counter = 0
    host = new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => {
        const runtime = new RecordingRuntime(provider)
        runtimes.push(runtime)
        return runtime
      },
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'X',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    sink = new RecordingSink()
  })

  afterEach(async () => {
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  it('🔴 the provider is handed the message AND the ledger says who wrote it', async () => {
    const created = await host.createSession({ provider: 'codex', planMode: true }, sink)
    expect(created.planNeedsGoAhead, 'a planning Codex session is what has a go-ahead').toBe(true)

    await host.endPlanMode(created.sessionId, sink, GO_AHEAD_MESSAGE)
    await waitFor(
      () => sink.liveness.at(-1)?.plan?.planNeedsGoAhead === false,
      'the released plan on the liveness channel',
    )

    // 1 — the half 276 measured, and the half that must never be traded away for the other one.
    //     With this empty, real Codex started 0/2 turns and produced 0/2 files.
    // The session's own runtime: a start also makes one to ask the model list.
    const launched = runtimes.filter((one) => one.launched)
    expect(launched).toHaveLength(1)
    expect(launched[0]?.sent, 'the provider was not handed the go-ahead').toEqual([
      GO_AHEAD_MESSAGE,
    ])

    // Assert the whole event records BroBot’s authorship. A partial `toMatchObject` match
    // could pass while the required field is missing.
    const turns = sink.events().filter((event) => event.type === 'user_turn')
    // ⚑ **F093 · R2 — and the whole text it was handed**, which for the go-ahead is its words.
    expect(turns).toEqual([
      {
        type: 'user_turn',
        text: GO_AHEAD_MESSAGE,
        attribution: 'app_authored',
        sent: GO_AHEAD_MESSAGE,
      },
    ])
  })

  it('⛔ it attaches nothing, and that zero is pinned rather than assumed', async () => {
    // This gesture carries `attached: 0`, and `transcript.ts`’s `appendAppTurn` accepts no
    // attachments. If a released plan gains attachments, the continuation item and component
    // must display them; this assertion makes that change fail instead of silently hiding a
    // path.
    const created = await host.createSession({ provider: 'codex', planMode: true }, sink)
    await host.endPlanMode(created.sessionId, sink, GO_AHEAD_MESSAGE)
    const turn = sink.events().find((event) => event.type === 'user_turn')
    expect(turn && 'attachments' in turn).toBe(false)
  })

  it('⚠️ a turn somebody TYPED is still unmarked — the mark means something', async () => {
    // The positive half of every negative below. If `app_authored` were put on every `user_turn`
    // the transcript would stop lying in one direction and start lying in the other, and no
    // assertion about the go-ahead alone could tell.
    const created = await host.createSession({ provider: 'codex' }, sink)
    await host.send(created.sessionId, 'do the thing', sink)
    const turns = sink.events().filter((event) => event.type === 'user_turn')
    // ⚑ **F093 · R2** — the row also keeps the whole text the provider was handed (`sent`, the
    // words in their frame); the authorship is what this case is about, so it is set aside here.
    expect(turns.map(({ sent, ...row }) => (void sent, row))).toEqual([
      { type: 'user_turn', text: 'do the thing' },
    ])
    expect(turns[0]?.sent).toContain('do the thing')
  })
})

describe('the fold: an app-authored turn is a turn, and is not a bubble (278 §1)', () => {
  const authored = (text = GO_AHEAD_MESSAGE): TranscriptEvent => ({
    type: 'user_turn',
    text,
    attribution: 'app_authored',
  })

  it('🔴 becomes a continuation entry, and no user item is created', () => {
    const state = createTranscript()
    applyEvent(state, authored(), 1_000)
    // Positive first: the entry EXISTS and carries the exact sentence that went to the provider.
    // "No user bubble appears" is true of an empty transcript too (SSR rule).
    expect(state.items).toEqual([
      { kind: 'continuation', id: 'continuation_1', text: GO_AHEAD_MESSAGE, at: 1_000 },
    ])
    expect(state.items.filter((item) => item.kind === 'user')).toEqual([])
  })

  it('…and an ordinary turn still becomes one, so the branch is a branch', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'user_turn', text: 'do the thing' }, 1_000)
    expect(state.items.map((item) => item.kind)).toEqual(['user'])
  })

  it('⚑ it still OPENS a turn — the bookkeeping is the reason it stayed a `user_turn`', () => {
    // Everything the fold does on a turn boundary has to happen here too, because a turn really
    // begins. A separate event type would have had to be taught each of these, and the first one
    // anybody forgot would be a real provider turn folded as though nothing had started.
    const state = createTranscript()
    applyEvent(state, { type: 'activity', phase: 'tool', detail: 'Bash' }, 900)
    applyEvent(state, { type: 'error', message: 'boom', fatal: false }, 950)
    const before = state.changes.turn

    applyEvent(state, authored(), 1_000)

    expect(state.activity, 'a new turn inherits no activity from the last one (099)').toBeNull()
    expect(state.lastError, "nor any memory of the last turn's error (246 §1)").toBeNull()
    expect(state.changes.turn, "096's scope axis counts this turn").toBe(before + 1)
  })

  it('⚠️ the two marked provenances stay apart — one is BroBot, the other is a file', () => {
    // 074's `provider_transcript` must not be collapsed into this. It says a JSONL line inside a
    // provider home CLAIMED the person said it; this says BroBot wrote it and nobody claimed
    // otherwise. They render differently because they are different facts.
    const state = createTranscript()
    applyEvent(state, { type: 'user_turn', text: 'ship it', attribution: 'provider_transcript' }, 1)
    applyEvent(state, authored(), 2)
    expect(state.items.map((item) => item.kind)).toEqual(['user', 'continuation'])
  })

  it('is shown in the reading view, not only with lifecycle events on', () => {
    // It is content: 276 measured the sentence changing what the model DID (3/5 planning-profile
    // turns crossed from proposing into executing on the text alone). A reader who could not see it
    // would be looking at work with no visible cause.
    const item = {
      kind: 'continuation',
      id: 'continuation_1',
      text: GO_AHEAD_MESSAGE,
      at: 1,
    } as const
    expect(isVisibleIn('normal', item)).toBe(true)
    expect(isVisibleIn('debug', item)).toBe(true)
  })

  it('and the raw stream stops printing one word for three different provenances', () => {
    expect(describeEvent(authored())).toContain('This app wrote it')
    // Paired, because a single assertion here would pass for a build that printed that phrase on
    // every turn.
    expect(describeEvent({ type: 'user_turn', text: 'hi' })).toContain('(ours)')
    expect(
      describeEvent({ type: 'user_turn', text: 'hi', attribution: 'provider_transcript' }),
    ).toContain('per the transcript')
  })
})
