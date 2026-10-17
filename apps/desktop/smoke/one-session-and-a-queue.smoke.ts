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
import { TASK_IS_OPEN } from '../src/shared/tasks'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { runEvidence, runScratch } from '../../../packages/runtime/smoke/run-paths'

/**
 * 🔴 **440 · a real model is TOLD NO when it adds to work it did not give — and its own give reaches
 * its own conversation, never the one another caller started** (D-014, re-aimed at D-016).
 *
 * ## ⛔ The one thing only a live provider can show
 *
 * ⚑ **That a caller is a MODEL and what it is told is something it receives.** The in-process suite
 * proves the rules. ⛔ **What it cannot show is a model choosing the verb and reading the answer**,
 * and that is this file.
 *
 * ## ⚑ What D-016 moved
 *
 * ⛔ **Until D-016 the subject was a refusal**: a second caller that sent work to a conversation it
 * did not start was refused `assign-work-to-one-you-did-not-start`. ⚑ **There is no such send any
 * more.** Work is given by PROFILE, and a give reaches the one conversation the giver has with that
 * agent — started for it the first time — so another caller's conversation is out of its reach by
 * construction, and no rail is left to refuse it. ⚑ So this file measures the two facts that
 * replaced it: a follow-up naming a piece the caller did not give is refused
 * `not-a-piece-you-gave`, and the caller's own give starts its OWN conversation with that agent while
 * the holder goes on holding exactly the one piece it was given.
 *
 * ## ⚠️ What is DRIVEN here and what is not — stated rather than implied
 *
 *  - ⚑ **DRIVEN by a real model:** the second caller choosing `message_agent` and `give_work`,
 *    naming the holder's piece, and being refused the first.
 *  - ⛔ **NOT driven by a model:** the FIRST caller's give. It is made through `RuntimeHost.giveWork`
 *    as the parent conversation, because what this file measures is who the second caller is held
 *    against, and a second live model would buy a fact `415` already owns while doubling the tokens.
 *
 * ## 🔴 The budget, stated before the run (standing rule 13)
 *
 * ⛔ **Two worker turns and two second-caller turns on the cheapest model each provider offers** —
 * the workers' a person's choice for their agent, because a give names no model — plus two
 * handshakes with no turn sent. ⚠️ **Every wait is bounded and reports NOT PERFORMED rather than
 * hanging**, and a bound that passes is a finding about the run rather than a reason to keep
 * waiting.
 *
 * ## 🔒 What it touches
 *
 * ⛔ **Its own `userData` under this run's scratch, its own provider homes under a managed root, and
 * nothing else.** No `provider-homes/` belonging to a person is read, copied or written, and no
 * `auth.json` is opened: Claude's machine login is injected transiently from the Keychain by the
 * adapter's own path, and every home this run provisions is removed in the `finally`.
 */

const CLAUDE_CHEAP = 'claude-haiku-4-5-20251001'
/**
 * ⚑ **D-016 · the same model, as Claude's own list names it** — `supportedModels()` gives aliases,
 * and a person's choice for the worker is one of the list's rows.
 */
const CLAUDE_CHEAP_LISTED = 'haiku'
/** ⚑ Cheap on both sides — the standing smoke policy for anything that spends tokens. */
const CODEX_CHEAP = 'gpt-5.6-luna'

class Recorder implements RuntimeEventSink {
  readonly messages: RuntimeEventMessage[] = []
  alive = true
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
  console.log(`[440] ${line}`)
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
  const scratch = runScratch(`440-${arm.provider}`)
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
      const home = join(managedRoot, `440-${profileId}-${process.pid}-${Date.now()}`)
      await provisionProviderHome(managedRoot, home)
      homes.push(home)
      return home
    },
    providerHomePath: (_provider, profileId) => join(managedRoot, `440-${profileId}`),
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
    // ── 1 · the holder's identity, brought into being with no turn sent ───────────────────────
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

    // ── 2 · the first caller, and the conversation its give starts ────────────────────────────
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
    // ⚑ **The give, through the host's own door** — the one `give_work` calls, with the first
    // caller's shape — so the holder is holding a piece when the second caller asks.
    const given = await host.giveWork(
      {
        profile: 'worker',
        title: '440 live demonstration',
        brief: 'Take your time on this. Do not reply yet.',
      },
      { ownerId: `agent:${parent.sessionId}` },
    )
    expect(given.ok, JSON.stringify(given)).toBe(true)
    const worker = given.ok ? given.owner : ''
    const label = given.ok ? given.label : ''
    say(`2 · ${arm.provider}: first caller ${parent.sessionId} gave ${worker} ${label}`)

    // ── 3 · a person watches the holder's cards ───────────────────────────────────────────────
    // ⚠️ **A conversation a give starts runs in its giver's mode** (499, HO-036) — `auto` here — so
    // no card is expected; ⛔ but one that does arrive has nobody behind it, since the conversation
    // is born without a surface, so a person takes it over — `336`'s door. ⚑ Without this a stray
    // card would keep the holder from its turn boundary, reported as a product failure that is
    // really a missing person.
    const workerSink = new Recorder('webContents:3', true)
    host.claimSession(worker, workerSink)
    const answeredCards = new Set<string>()
    const settleCards = async (): Promise<void> => {
      for (const entry of store.events(worker)) {
        const event = entry.event
        if (event.type !== 'permission_request' || answeredCards.has(event.id)) continue
        answeredCards.add(event.id)
        try {
          await host.respondPermission(worker, event.id, { outcome: 'allow' }, workerSink)
        } catch (error) {
          say(`   ⛔ could not answer a card: ${error instanceof Error ? error.message : error}`)
        }
      }
    }
    watching = setInterval(() => void settleCards(), 500)
    const openWork = (): number =>
      store.piecesOwnedBy(worker).filter((one) => TASK_IS_OPEN[one.state]).length
    expect(await until('the first caller’s work to land', 60_000, () => openWork() === 1)).toBe(
      true,
    )
    say(`3 · ${arm.provider}: the holder has ${openWork()} open piece of work`)

    // ── 4 · a SECOND caller, reaching an identity it did not start ────────────────────────────
    // ⚑ **`431`'s door and not a relationship.** It never started the holder and does not command
    // it; every agent may message anyone by default. ⛔ **That is criterion 27's shape** — an agent
    // with no other route reaching the identity that holds the thing.
    const secondSink = new Recorder('webContents:4')
    const second = await host.createSession(
      {
        provider: arm.provider,
        profileId: 'archivist',
        cwd: work,
        model: arm.model,
        approvalMode: 'auto',
      },
      secondSink,
    )
    expect(store.capabilitiesOf('archivist')?.canMessage).toBe('any')
    say(`4 · ${arm.provider}: second caller ${second.sessionId}`)

    const askIt = async (text: string): Promise<void> => {
      await host.send(second.sessionId, text, secondSink)
    }
    const turnsOf = (id: string): number =>
      store.events(id).filter((one) => one.event.type === 'turn').length
    /**
     * 🔴 **What the MODEL was told, written by this app at the moment it refused** — see
     * `ToolRefusedEvent`. ⛔ **This is the non-vacuity of step 5 and it is the whole reason the row
     * is read at all**: *the holder still has one open piece* is also true of a model that never
     * called the tool, so a run in which nothing happened would have passed the count.
     */
    const refusalsSeenBy = (id: string): { tool: string; rail: string }[] =>
      store
        .events(id)
        .map((one) => one.event)
        .filter((one) => one.type === 'tool_refused')
        .map((one) => ({ tool: one.tool, rail: one.rail }))

    // ── 5 · the model is TOLD NO ─────────────────────────────────────────────────────────────
    const before = turnsOf(second.sessionId)
    const FOLLOW_UP = 'please run my job too'
    await askIt(
      `Call the message_agent tool exactly once, with agent "${worker}", kind "follow-up", piece ` +
        `"${label}" and text "${FOLLOW_UP}", and no other arguments. Then tell me, in one ` +
        `line, the outcome field of what came back and the rail field if there was one. Do not ` +
        `retry and do not call any other tool.`,
    )
    const firstTurn = await until(
      'the second caller’s first turn to end',
      300_000,
      () => turnsOf(second.sessionId) > before,
    )
    expect(firstTurn, `${arm.provider}: the second caller took a turn`).toBe(true)
    // 🔴 **THE measurement.** ⛔ The holder still holds exactly one piece of work and its ledger
    // holds none of the follow-up's words, so the call was refused rather than delivered — read off
    // the RECEIVER's ledger rather than off the caller's prose, because a model's summary of what it
    // was told is the model's claim.
    const refused = refusalsSeenBy(second.sessionId)
    say(
      `5 · ${arm.provider}: the holder has ${openWork()} open piece(s) · the model was handed ` +
        `${JSON.stringify(refused)}`,
    )
    expect(openWork(), `${arm.provider}: the holder still holds its one piece`).toBe(1)
    expect(
      JSON.stringify(store.events(worker).map((one) => one.event)),
      `${arm.provider}: nothing reached the holder`,
    ).not.toContain(FOLLOW_UP)
    // ⛔ **The model CALLED it and the app REFUSED it**, which is what separates a refusal from a
    // model that did nothing. ⚑ The row is written where the decision is made, from the
    // payload handed to the model, so this is not a reading of the model's own account of it.
    expect(
      refused,
      `${arm.provider}: the model called message_agent and was told no`,
    ).toContainEqual({ tool: 'message_agent', rail: 'not-a-piece-you-gave' })

    // ── 6 · its own give reaches its OWN conversation with that agent ────────────────────────
    // ⚑ **D-016 · one conversation per helper per giver, with no rule of its own**: a give takes a
    // profile and resolves it to the giver's own conversation with it, started the first time.
    const secondAsked = turnsOf(second.sessionId)
    await askIt(
      `Call the give_work tool exactly once, with profile "worker", title "440 the second ` +
        `caller's own piece" and brief "Answer DONE and nothing else.", and no other arguments. ` +
        `Then stop. Do not call any other tool.`,
    )
    const itsOwn = (): string | null =>
      store
        .recorded()
        .find(
          (one) =>
            one.profileId === 'worker' &&
            store.parentOf(one.sessionId) === second.sessionId &&
            store.piecesOwnedBy(one.sessionId).some((piece) => piece.giver === second.sessionId),
        )?.sessionId ?? null
    const gaveItsOwn = await until(
      'the second caller’s give to start its own conversation',
      300_000,
      () => itsOwn() !== null && turnsOf(second.sessionId) > secondAsked,
    )
    const holderPieces = store.piecesOwnedBy(worker)
    say(
      `6 · ${arm.provider}: the second caller's own conversation with worker is ` +
        `${String(itsOwn())} · the holder holds ${JSON.stringify(holderPieces.map((one) => [one.label, one.giver]))}`,
    )
    expect(
      gaveItsOwn,
      `${arm.provider}: the second caller's give started its own conversation`,
    ).toBe(true)
    expect(itsOwn(), `${arm.provider}: not the holder`).not.toBe(worker)
    expect(
      holderPieces.map((one) => one.giver),
      `${arm.provider}: the holder holds only what the first caller gave it`,
    ).toEqual([parent.sessionId])

    say(
      `✅ ${arm.provider}: a follow-up on work it did not give was refused, and its own give ` +
        `reached its own conversation · evidence ${runEvidence(`440-${arm.provider}.txt`)}`,
    )
  } finally {
    if (watching !== undefined) clearInterval(watching)
    await host.closeAll()
    db.close()
    for (const home of homes) rmSync(home, { recursive: true, force: true })
  }
}

it(
  '🔴 Claude · a caller that did not give the holder its work is told no, and gives to its own',
  { timeout: 1_200_000 },
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
 * 🔴 **The Codex arm is NOT PERFORMED, and the reason is a RULE rather than a limitation.**
 *
 * ⛔ **Codex authenticates a managed home by COPYING `~/.codex/auth.json` into it** — the only route
 * the runtime has. ⚠️ **The standing security block forbids it in as many words**: *"Do not read,
 * copy or write anything under his `provider-homes/`, and never an `auth.json`."* ⚑ `437` §5.2
 * refused for this reason and `440`'s own brief rules that it stays refused.
 *
 * ⛔ **So this arm is SKIPPED rather than failed, and skipped LOUDLY**: it prints why, every run, so
 * the skip cannot be mistaken for coverage. 🔴 **A step that has never executed is not coverage, it
 * is a claim.**
 */
const codexHomeForTheArm = join(
  tmpdir(),
  'brobot2-smoke-homes',
  `440-codex-preflight-${process.pid}`,
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
      'give it one is to copy a person’s ~/.codex/auth.json, which the standing security block ' +
      'forbids outright. Run it from an environment whose managed home is already signed in.',
  )
}

it.skipIf(!codexIsSignedIn)(
  '🔴 Codex · a caller that did not give the holder its work is told no, and gives to its own',
  { timeout: 1_200_000 },
  async () => {
    await drive({
      provider: 'codex',
      model: CODEX_CHEAP,
      listedModel: CODEX_CHEAP,
      runtime: () => new CodexRuntime(bundledCodexTransportFactory()),
      homeEnv: 'CODEX_HOME',
    })
  },
)
