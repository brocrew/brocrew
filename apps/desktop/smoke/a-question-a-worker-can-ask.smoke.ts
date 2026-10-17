import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  ClaudeRuntime,
  CodexRuntime,
  codexAuthHealth,
  claudeKeychainTokenProvider,
  provisionProviderHome,
  type AgentRuntime,
} from '@brobot2/runtime'
import { bundledCodexTransportFactory } from '../../../packages/runtime/smoke/bundled-codex'
import type { Provider } from '@brobot2/shared'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { runEvidence, runScratch } from '../../../packages/runtime/smoke/run-paths'

/**
 * 🔴 **437 · criterion 29, PERFORMED: a real worker asks its parent for a decision, keeps its piece
 * of work open, and finishes the work when the answer arrives.**
 *
 * ## ⛔ Why this file exists and `436`'s evidence was not enough
 *
 * ⚠️ **`436` proved PUBLICATION and said so in as many words** — *"a catalogue entry is not
 * successful invocation"*. It captured `message_agent` in Claude's init inventory and a dynamic
 * `message_agent` declaration reaching a Codex model's description, both without a model ever
 * calling anything. ⛔ **This dispatch's property is about a call being made, a turn being held and
 * a piece staying open, and none of those three can be read off a catalogue.**
 *
 * ## ⚑ The one measurement only a live provider can make
 *
 * **That the worker's turn is HELD while the question is outstanding.** ⛔ The in-process suite
 * cannot see it: the double does not dispatch tools, so there is no turn for a tool call to hold.
 * ⚑ Here the model itself calls `ask_question` (`ask_parent` at `437`) asked of `the-parent`, and
 * the assertion is that **no `turn` event arrives until the answer is sent** — which is the whole of
 * why `437` added no task state. A verb that returned early would end the turn, `derivePieces` would
 * stall the piece at `turn_ended`, and the parent would be told *its turn ended and it replied
 * nothing* about a worker that had asked it a question.
 *
 * ## ⚠️ What is DRIVEN here and what is not — stated rather than implied
 *
 *  - ⚑ **DRIVEN by a real model:** the worker seeing `ask_question`, choosing it, calling it naming
 *    the piece it was given, receiving the answer, and calling `reply_to_parent` afterwards.
 *  - ⛔ **NOT driven by a model:** the parent's choice to answer. The answer is sent through
 *    `RuntimeHost.answerQuestion` as the parent conversation — the same door `answer_question`
 *    calls, with the same caller shape — because a parent model choosing that verb is `394`'s
 *    coverage and not this dispatch's addition. ⚠️ **Reported as what it is**, never as a model
 *    that answered.
 *
 * ## ⚠️ What this costs, and what it touches
 *
 * ⛔ **Two real worker turns per provider on the CHEAPEST model each offers** — a person's choice
 * for the worker, because a give names no model — plus one handshake per identity with no turn
 * sent. ⛔ **Nothing here reads, copies or writes anything under a
 * `provider-homes/` belonging to a person, and no `auth.json` is read or written**: Claude's machine
 * login is injected transiently from the Keychain by the adapter's own path, Codex runs against a
 * home provisioned fresh under this run's own root, and every home is removed afterwards.
 * ⚠️ **Every wait below is bounded and reports NOT PERFORMED rather than hanging** (standing
 * rule 13).
 */

const CLAUDE_CHEAP = 'claude-haiku-4-5-20251001'
/**
 * ⚑ **D-016 · the same model, as Claude's own list names it** — `supportedModels()` gives aliases,
 * and a person's choice for the worker is one of the list's rows.
 */
const CLAUDE_CHEAP_LISTED = 'haiku'
/** ⚑ Cheap on both sides — the standing smoke policy for anything that spends tokens. */
const CODEX_CHEAP = 'gpt-5.6-luna'
/** ⚠️ **The marker is model-unprompted and appears nowhere else**, so a match cannot be an echo. */
const DECISION = `BROBOT_437_ANSWER_${process.pid}`

class Recorder implements RuntimeEventSink {
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  /**
   * ⛔ **The flag is about the OWNER and not the caller**, and it is load-bearing here rather than
   * decorative. ⚠️ A sink that declares `false` cannot answer a permission card at all — the rail
   * says so in as many words: *"Answering this is a person's decision. An agent can give this
   * conversation work, but not decide what that work is allowed to do."* ⚑ **The surface that takes
   * the worker over IS a person**, in the app and here, which is the only reading under which this
   * rig is honest.
   */
  constructor(
    readonly ownerId: string,
    readonly aPersonIsBehindIt = false,
  ) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

const say = (line: string): void => {
  console.log(`[437] ${line}`)
}

/** ⛔ **Bounded, and it reports rather than throwing** — the caller decides what a miss means. */
const until = async (what: string, ms: number, ready: () => boolean): Promise<boolean> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (ready()) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  say(`⛔ NOT PERFORMED · ${what} · deadline ${ms}ms passed`)
  return false
}

interface Arm {
  readonly provider: Provider
  readonly model: string | undefined
  /** ⚑ D-016 · {@link model} as the provider's own list names it — a person's choice is a row. */
  readonly listedModel: string
  readonly runtime: () => AgentRuntime
  readonly homeEnv: string
}

const drive = async (arm: Arm): Promise<void> => {
  const scratch = runScratch(`437-${arm.provider}`)
  mkdirSync(scratch, { recursive: true })
  const userData = join(scratch, 'userData')
  const work = join(scratch, 'work')
  mkdirSync(userData, { recursive: true })
  mkdirSync(work, { recursive: true })
  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const homes: string[] = []

  const db = openDatabase(join(userData, 'brobot2.sqlite'))
  applyMigrations(db, join(__dirname, '../src/main/db/migrations'))
  const store = createSessionStore(db)
  let counter = 0

  const host = new RuntimeHost({
    store,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(userData, 'exports'),
    createRuntime: arm.runtime,
    prepareProviderHome: async (_provider: Provider, profileId: string) => {
      const home = join(managedRoot, `437-${profileId}-${process.pid}-${Date.now()}`)
      await provisionProviderHome(managedRoot, home)
      homes.push(home)
      return home
    },
    providerHomePath: (_provider, profileId) => join(managedRoot, `437-${profileId}`),
    resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
    newSessionId: () => `sess_${++counter}`,
    readProviderConfig: (_provider, home) => ({
      home,
      homeEnv: arm.homeEnv,
      model: 'live',
      authNote: null,
      files: [],
    }),
  })

  const window = new Recorder('webContents:1')
  let watching: ReturnType<typeof setInterval> | undefined
  try {
    // ── 1 · the identity, brought into being with no turn sent ────────────────────────────────
    const worker0 = await host.createSession(
      { provider: arm.provider, profileId: 'worker', cwd: work, model: arm.model },
      window,
    )
    await host.close(worker0.sessionId, window)
    // ⚑ **D-016 · the model the worker runs on is a person's choice for it** — a give names none.
    // Made through the person's own door, which checks it against the provider's list (no turn).
    const chose = await host.setAgentModelAndEffort('worker', {
      provider: arm.provider,
      model: arm.listedModel,
      effort: null,
    })
    expect(chose, `${arm.provider}: a person chose the worker's model`).toMatchObject({ ok: true })
    say(`1 · ${arm.provider}: identity 'worker' exists (${worker0.sessionId}, closed)`)

    // ── 2 · a parent, and the one piece of work it gives the worker ──────────────────────────
    const parentSink = new Recorder('webContents:2')
    const parent = await host.createSession(
      {
        provider: arm.provider,
        profileId: 'pm',
        cwd: work,
        model: arm.model,
        approvalMode: 'auto',
      },
      parentSink,
    )
    // ⚑ **The give, through the host's own door** — the one `give_work` calls, with the parent's
    // caller shape. It starts the worker's conversation and hands it the brief as its first turn,
    // with the piece's label in the footer the app writes under it.
    const given = await host.giveWork(
      {
        profile: 'worker',
        title: '437 live demonstration',
        brief:
          `Decide nothing yourself. Before you do anything else, ask the conversation that gave ` +
          `you this work, with ask_question naming this piece and who_answers "the-parent", the ` +
          `question "which database should I use?". Wait for the answer. When you have it, ` +
          `finish this piece with reply_to_parent, outcome "done", and a summary that quotes the ` +
          `answer you were given exactly.`,
      },
      { ownerId: `agent:${parent.sessionId}` },
    )
    expect(given.ok, JSON.stringify(given)).toBe(true)
    const worker = given.ok ? given.owner : ''
    say(`2 · ${arm.provider}: parent ${parent.sessionId} gave worker ${worker} its piece`)

    // ── 3 · a person watches the worker's cards ───────────────────────────────────────────────
    // ⚠️ **A conversation a give starts runs in its giver's mode** (499, HO-036) — `auto` here — so
    // no card is expected. ⛔ **But one that does arrive has nobody behind it**: the conversation is
    // born WITHOUT a surface, its slot *"held for nobody"*, and a first consequential call parked on
    // it would stop the worker short of `ask_question`, reported as a product failure that is really
    // a missing person. ⚑ `claimSession` is `336`'s door and the one way a person picks one up;
    // taking it over is exactly what a person does in the app before answering anything on a child,
    // and the answer goes through the person's own door, the only thing entitled to settle one.
    const workerSink = new Recorder('webContents:3', true)
    host.claimSession(worker, workerSink)
    say(`   · took over ${worker} so its cards can be answered`)
    const answeredCards = new Set<string>()
    const settleCards = async (): Promise<void> => {
      for (const entry of store.events(worker)) {
        const event = entry.event
        if (event.type !== 'permission_request' || answeredCards.has(event.id)) continue
        answeredCards.add(event.id)
        say(`   · answering the worker's permission card ${event.id} (${event.action})`)
        // ⛔ **Reported, never swallowed.** A `void`-ed failure here looks exactly like a worker that
        // never called the tool, and the run would report a product defect that is really a card
        // nobody answered — `a-report-must-be-computed-from-the-outcome`.
        try {
          const ack = await host.respondPermission(
            worker,
            event.id,
            { outcome: 'allow' },
            workerSink,
          )
          say(`     → ${JSON.stringify(ack)}`)
        } catch (error) {
          say(`     ⛔ could not answer: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    watching = setInterval(() => void settleCards(), 500)

    const openPiece = (): string | null =>
      store.piecesOwnedBy(worker).find((one) => one.state !== 'answered')?.piece ?? null
    expect(await until('the piece to reach the worker', 60_000, () => openPiece() !== null)).toBe(
      true,
    )
    const piece = openPiece()
    say(`3 · ${arm.provider}: worker holds piece ${piece ?? 'NONE'}`)

    // ── 4 · the model chooses the verb, and the TURN IS HELD ──────────────────────────────────
    const askedQuestion = (): string | null =>
      store.routedRequestsOf(worker).find((one) => one.went.to === 'the-parent')?.requestId ?? null
    const asked = await until(
      'the worker to call ask_question',
      240_000,
      () => askedQuestion() !== null,
    )
    const turns = (): TranscriptEvent[] =>
      store
        .events(worker)
        .map((one) => one.event)
        .filter((one) => one.type === 'turn')
    say(`4 · ${arm.provider}: ask_question called: ${asked} · turns so far: ${turns().length}`)
    if (!asked) {
      say(
        `   ⛔ worker event kinds: ${JSON.stringify(
          store.events(worker).map((one) => one.event.type),
        )}`,
      )
    }
    expect(asked, `${arm.provider}: the worker called ask_question`).toBe(true)

    // 🔴 **THE measurement.** ⛔ The question is outstanding and the worker's turn has NOT ended, so
    // `derivePieces` has nothing to stall and the work derives `working` — which is `437`'s whole
    // ruling, observed on a real provider rather than argued.
    const turnsWhileWaiting = turns().length
    const stateWhileWaiting = store.piecesOwnedBy(worker).find((one) => one.piece === piece)?.state
    say(`   while waiting · turns: ${turnsWhileWaiting} · piece state: ${stateWhileWaiting ?? '—'}`)
    expect(turnsWhileWaiting, `${arm.provider}: no turn ended while the question was open`).toBe(0)
    expect(stateWhileWaiting, `${arm.provider}: the piece is working while the worker waits`).toBe(
      'working',
    )

    // ── 5 · the parent answers — through the door, not through a model ────────────────────────
    const requestId = askedQuestion()
    const answered = await host.answerQuestion(
      { questionId: requestId ?? '', answers: [{ part: 'answer', answer: [DECISION] }] },
      { ownerId: `agent:${parent.sessionId}` },
    )
    say(`5 · ${arm.provider}: answered ${requestId}: ${JSON.stringify(answered.ok)}`)
    expect(answered.ok, JSON.stringify(answered)).toBe(true)

    // ── 6 · it carried on, and finished the work it kept ──────────────────────────────────────
    const finished = await until('the worker to finish the original piece', 240_000, () =>
      store.piecesOwnedBy(worker).some((one) => one.piece === piece && one.state === 'answered'),
    )
    const row = store.piecesOwnedBy(worker).find((one) => one.piece === piece)
    say(
      `6 · ${arm.provider}: piece ${String(row?.label)} · state ${row?.state} · outcome ${row?.outcome}`,
    )
    // ⛔ **The REPLY's summary and not the piece's brief** (found by `437`'s own review). The brief
    // is the work that was handed OVER; printing it under the word *summary* labels the prompt as
    // the worker's answer, which is the one line a reader would quote.
    const replied = store
      .events(worker)
      .map((one) => one.event)
      .filter(
        (one): one is Extract<TranscriptEvent, { type: 'work_replied' }> =>
          one.type === 'work_replied',
      )
      .at(-1)
    say(`   reply summary: ${JSON.stringify(replied?.summary ?? '')}`)
    expect(finished, `${arm.provider}: the worker finished the piece it had kept`).toBe(true)
    expect(row?.state).toBe('answered')

    // ⛔ **The answer reached the model**, which is the difference between *the call returned* and
    // *the worker carried on with what it was told*. ⚑ The marker is model-unprompted.
    const ledger = JSON.stringify(store.events(worker).map((one) => one.event))
    say(`   worker ledger carries the decision: ${ledger.includes(DECISION)}`)
    expect(ledger, `${arm.provider}: the decision reached the worker`).toContain(DECISION)

    say(
      `✅ ${arm.provider}: criterion 29 performed · evidence ${runEvidence(`437-${arm.provider}.txt`)}`,
    )
  } finally {
    if (watching !== undefined) clearInterval(watching)
    await host.closeAll()
    db.close()
    for (const home of homes) rmSync(home, { recursive: true, force: true })
  }
}

it(
  '🔴 Claude · a worker asks its parent, keeps the piece, and finishes it',
  { timeout: 900_000 },
  async () => {
    const token = claudeKeychainTokenProvider()
    expect(token() !== null, 'a live demonstration needs a live machine login').toBe(true)
    await drive({
      provider: 'claude',
      model: CLAUDE_CHEAP,
      listedModel: CLAUDE_CHEAP_LISTED,
      runtime: () => new ClaudeRuntime(undefined, undefined, token),
      homeEnv: 'CLAUDE_CONFIG_DIR',
    })
  },
)

/**
 * 🔴 **The Codex arm is NOT PERFORMED by `437`, and the reason is a RULE rather than a limitation.**
 *
 * ⛔ **Codex authenticates a managed home by COPYING `~/.codex/auth.json` into it** — that is the
 * only route the runtime has (`provisionCodexAuth`, and `provider-home.ts` describes the same copy).
 * ⚠️ **`437`'s standing security block forbids it in as many words**: *"Do not read, copy or write
 * anything under his `provider-homes/`, and never an `auth.json`."* ⚑ That clause is categorical and
 * is not the one the same block relaxes for `pnpm run ci` — the gate's Electron steps touch their own
 * temporary userData, and this would touch a person's machine login.
 *
 * ⛔ **So this arm is SKIPPED rather than failed, and skipped LOUDLY**: it prints why, every run, so
 * the skip cannot be mistaken for coverage. 🔴 **A step that has never executed is not coverage, it
 * is a claim** — and a green suite that quietly omitted a provider would be exactly that.
 *
 * ⚑ **It runs unchanged for anyone entitled to provision the credential.** Nothing about the arm is
 * conditional except whether a usable Codex sign-in is ALREADY present in the managed home; the
 * check below reads that home and never a person's.
 */
const codexHomeForTheArm = join(
  tmpdir(),
  'brobot2-smoke-homes',
  `437-codex-preflight-${process.pid}`,
)
const codexIsSignedIn = ((): boolean => {
  try {
    return codexAuthHealth(codexHomeForTheArm).ok
  } catch {
    return false
  }
})()

if (!codexIsSignedIn) {
  say(
    '⛔ NOT PERFORMED · the Codex arm · its managed home has no Codex sign-in, and the only way to ' +
      'give it one is to copy a person’s ~/.codex/auth.json, which this dispatch’s security block ' +
      'forbids outright. Run it from an environment whose managed home is already signed in.',
  )
}

it.skipIf(!codexIsSignedIn)(
  '🔴 Codex · a worker asks its parent, keeps the piece, and finishes it',
  { timeout: 900_000 },
  async () => {
    await drive({
      provider: 'codex',
      // Use the cheap model because the measured behavior does not depend on model quality.
      model: CODEX_CHEAP,
      listedModel: CODEX_CHEAP,
      runtime: () => new CodexRuntime(bundledCodexTransportFactory()),
      homeEnv: 'CODEX_HOME',
    })
  },
)
