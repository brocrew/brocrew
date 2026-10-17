import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  CodexRuntime,
  codexAuthHealth,
  provisionCodexAuth,
  provisionProviderHome,
  type AgentRuntime,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { bundledCodexTransportFactory } from '../../../packages/runtime/smoke/bundled-codex'
import { runEvidence, runScratch } from '../../../packages/runtime/smoke/run-paths'

/**
 * 🔴 **348 · a REAL Codex child calls a BroBot tool, gives another agent work, and talks to it.**
 *
 * ⚑ **D-016 · the verb is `give_work`**, which starts the other agent's conversation and hands it
 * the work as its first turn, where `348` spawned a child with `spawn_agent` and then spoke to it.
 * The rig still asks for two calls — the give, then a note — so the second verb is still measured.
 *
 * ⛔ **`347` performed this on Claude and left the Codex half empty**: *"A Codex child gets none."*
 * This is that half, and it needed **no stdio server, no socket, no port and no `config.toml`
 * merge** — the published tools ride `ThreadStartParams.dynamicTools` and come back as ordinary
 * `item/tool/call` server requests on the connection the adapter already holds.
 *
 * ## ⚠️ What this costs, and what it touches
 *
 * Three real Codex children on the CHEAP model — the child's because a person chose it for its
 * agent, since a give names no model — and Codex runs on the signed-in plan: `210`'s ruling stands,
 * *"it exposed no incremental dollar charge, so I will not invent one."*
 *
 * Every provider home is created under the run’s temporary root and removed in `finally`;
 * personal `provider-homes/` and `:9444` are untouched. Authentication is the exception: a
 * Codex child requires `auth.json`, has no Keychain route, and this fixture uses no
 * `OPENAI_API_KEY`. `provisionCodexAuth` copies the machine login into each temporary home,
 * as `smoke:codex` does, and those copies are removed with the homes.
 *
 * ## ⚑ The `ask` half is NOT here, and that is deliberate
 *
 * Under `ask` these calls publish a permission card and wait for a person, exactly as the Claude
 * adapter's do — nobody is watching a smoke run, so this parent runs `auto` for the same reason
 * `347`'s did. The card path is pinned by `codex-agent-tools.test.ts`, where a test can answer it.
 */

/** The cheap Codex model every probe in this repository uses. */
const CHEAP = 'gpt-5.6-luna'
/** ⛔ Model-unprompted and appearing nowhere else, so a match cannot be an echo of the prompt. */
const MARKER = `BROBOT_348_CHILD_${process.pid}`

class Recorder implements RuntimeEventSink {
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  // ⛔ Not a person. Added when 348 met 349 at integration: this is an automated probe's recorder,
  // so it may command a session and may never answer a permission for one (HO-005 Q2). Matches the
  // two sibling smokes 349 itself updated.
  readonly aPersonIsBehindIt = false
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
  events(): TranscriptEvent[] {
    return this.messages.map((one) => one.event)
  }
}

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

/** Poll until `check` is true, or give up. Bounded, because a live child can simply not answer. */
async function until(
  what: string,
  ms: number,
  check: () => boolean | Promise<boolean>,
): Promise<boolean> {
  const deadline = Date.now() + ms
  for (;;) {
    if (await check()) return true
    if (Date.now() > deadline) {
      say(`   … gave up waiting for ${what} after ${ms}ms`)
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

it(
  '🔴 a real Codex child calls brobot__give_work, then brobot__message_agent',
  { timeout: 600_000 },
  async () => {
    const scratch = runScratch('codex-agent-spawns-agent')
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
      // ⚑ **The real adapter, the real bundled binary, the real fail-closed auth health** — the same
      // three the shipped app uses. The only thing this rig substitutes is where the homes live.
      createRuntime: (): AgentRuntime =>
        new CodexRuntime(bundledCodexTransportFactory(), codexAuthHealth),
      prepareProviderHome: async (_provider: Provider, profileId: string) => {
        const home = join(managedRoot, `348-${profileId}-${process.pid}-${Date.now()}`)
        await provisionProviderHome(managedRoot, home)
        await provisionCodexAuth(home)
        homes.push(home)
        return home
      },
      providerHomePath: (_provider, profileId) => join(managedRoot, `348-${profileId}`),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'live',
        authNote: null,
        files: [],
      }),
    })

    const window = new Recorder('webContents:1')
    try {
      // ── 1 · bring the identity into being, the only way anything can ────────────────────────
      // ⛔ Started and closed with no turn sent: a handshake, and no model tokens spent.
      const worker0 = await host.createSession(
        { provider: 'codex', profileId: 'worker', cwd: work, model: CHEAP },
        window,
      )
      await host.close(worker0.sessionId, window)
      // ⚑ **D-016 · the model the child runs on is a person's choice for its agent** — a give takes
      // no model. ⚑ Made through the person's own door, which checks it against the list Codex gives
      // (`model/list`: no thread, no turn).
      const chose = await host.setAgentModelAndEffort('worker', {
        provider: 'codex',
        model: CHEAP,
        effort: null,
      })
      expect(chose, 'a person chose the child’s model').toMatchObject({ ok: true })
      say(`1 · identity 'worker' exists (session ${worker0.sessionId}, closed), on ${CHEAP}`)

      // ── 2 · a parent that may give it work ──────────────────────────────────────────────────
      const parentSink = new Recorder('webContents:2')
      const parent = await host.createSession(
        { provider: 'codex', profileId: 'pm', cwd: work, model: CHEAP, approvalMode: 'auto' },
        parentSink,
      )
      say(`2 · parent ${parent.sessionId} running, pm may give worker work`)

      // ── 3 · one turn, naming the tools by intent and not by hand ────────────────────────────
      const before = new Set(host.sessionIds)
      await host.send(
        parent.sessionId,
        `You are running inside an app that gives you tools for managing other agents. ` +
          `Give the agent "worker" one piece of work, titled "348 live demonstration", whose brief ` +
          `is: wait for my next message. Then send that agent a note whose text is exactly: ` +
          `reply with ${MARKER}. Do those two things and then stop. Do not use any other tool.`,
        parentSink,
      )
      say('3 · turn sent; waiting for the parent to give a child work…')

      const appeared = await until('a child session', 300_000, () =>
        host.sessionIds.some((id) => !before.has(id)),
      )
      const child = host.sessionIds.find((id) => !before.has(id))
      say(`   child: ${child ?? 'NONE'}`)

      expect(appeared, 'the parent started a child').toBe(true)
      expect(child, 'a child session id').toBeDefined()

      // ── 4 · what the two transcripts say ────────────────────────────────────────────────────
      /** ⛔ Re-read every time, never captured once — `347`'s own defect, and its comment. */
      const parentToolCalls = (): string[] =>
        store
          .events(parent.sessionId)
          .map((one) => one.event)
          .filter(
            (one): one is Extract<TranscriptEvent, { type: 'tool_call' }> =>
              one.type === 'tool_call',
          )
          .map((one) => one.name)

      // ⛔ **`brobot__give_work`, and the prefix is the measurement.** Codex declares a namespaced
      // dynamic tool to the model as `<namespace>__<tool>` (probe:codex-dynamic-tools, arm A), and
      // `toolItemName` had this item type mapped to the constant `'tool'` until `348` — so a row
      // that says only `tool` here is `327`'s defect, not a passing run.
      await until('give_work in the parent transcript', 120_000, () =>
        parentToolCalls().some((name) => name.includes('give_work')),
      )
      say(`4 · parent tool calls after the give: ${JSON.stringify(parentToolCalls())}`)
      expect(parentToolCalls().some((name) => name === 'brobot__give_work')).toBe(true)

      const called = await until('message_agent in the parent transcript', 300_000, () =>
        parentToolCalls().some((name) => name.includes('message_agent')),
      )
      const spokeTo = await until('the child to be given the message', 120_000, () =>
        store
          .events(child!)
          .some((one) => one.event.type === 'user_turn' || one.event.type === 'message_queued'),
      )
      const childEvents = store.events(child!).map((one) => one.event)
      const childText = JSON.stringify(childEvents)
      say(`   parent tool calls, final: ${JSON.stringify(parentToolCalls())}`)
      say(`   child event kinds: ${JSON.stringify(childEvents.map((one) => one.type))}`)
      say(`   child ledger carries the marker: ${childText.includes(MARKER)}`)

      expect(called, 'the parent called message_agent').toBe(true)
      expect(parentToolCalls().some((name) => name === 'brobot__message_agent')).toBe(true)
      expect(spokeTo, 'the child was given the message').toBe(true)
      expect(childText).toContain(MARKER)

      // ── 5 · what the ledger keeps: the parent, and the piece ────────────────────────────────
      const startedBy = store.parentOf(child!)
      const pieces = store.piecesOwnedBy(child!)
      say(
        `5 · started by ${String(startedBy)}; pieces ${JSON.stringify(pieces.map((one) => one.label))}`,
      )
      expect(startedBy).toBe(parent.sessionId)
      expect(pieces).toHaveLength(1)
      expect(pieces[0]?.giver).toBe(parent.sessionId)
      expect(pieces[0]?.title).toContain('348')

      say(`✅ a Codex child gave ${child} work and spoke to it, live.`)
      say(`   evidence: ${runEvidence('348-live.txt')}`)
    } finally {
      await host.closeAll()
      db.close()
      for (const home of homes) rmSync(home, { recursive: true, force: true })
    }
  },
)
