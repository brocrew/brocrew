import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  ClaudeRuntime,
  claudeKeychainTokenProvider,
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
import { runEvidence, runScratch } from '../../../packages/runtime/smoke/run-paths'

/**
 * 🔴 **347 · criterion 1, performed: a REAL provider child gives another agent work and talks to it.**
 *
 * ⚑ **D-016 · the verb is `give_work`**: it starts the other agent's conversation and hands it the
 * work as its first turn, where `347` spawned a child with `spawn_agent` and then spoke to it. The
 * rig asks for the give and then a note, so both halves of criterion 1 — a conversation brought
 * into being, and words sent to it — are still performed by the model.
 *
 * ⛔ **`342` measured that nothing in this repository could make a real MCP call, and named the
 * reason it could not be re-checked**: `327`'s rig — a real app-server plus a real stdio MCP
 * server — *"was never committed"*, so the one live measurement of an `mcpToolCall` was *"literally
 * accurate and literally unrepeatable from this tree."* ⚑ **This file is the rig, committed.**
 *
 * ## ⚑ Why it needs no stdio server, no socket and no port
 *
 * The pinned SDK ships `createSdkMcpServer` — an IN-PROCESS transport — so the tools run in the
 * same process as the chokepoint they call. `307` had to stand up a real stdio server to prove the
 * doorway existed; the doorway it proved is reachable from here with a `StartOptions` field.
 *
 * ## ⚠️ What this costs, and what it touches
 *
 * Three real Claude children on the CHEAP model: one handshake to bring an identity into being, one
 * parent that is given a single turn, and the child that turn's give starts — on the model a person
 * chose for its agent, because a give names none. ⛔ **Nothing here reads,
 * copies or writes anything under a `provider-homes/` belonging to a person, and no `auth.json` is
 * read or written**: the machine login is injected transiently from the Keychain by the adapter's
 * own path, every home is provisioned fresh under this run's own root, and every one is removed
 * afterwards.
 */

const CHEAP = 'claude-haiku-4-5-20251001'
/**
 * ⚑ **D-016 · the same model, as Claude's own list names it** — `supportedModels()` gives aliases
 * (`haiku` resolves to `claude-haiku-4-5`), and a person's choice is one of the list's rows.
 */
const CHEAP_LISTED = 'haiku'
/** ⛔ Model-unprompted and appearing nowhere else, so a match cannot be an echo of the prompt. */
const MARKER = `BROBOT_347_CHILD_${process.pid}`

class Recorder implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly messages: RuntimeEventMessage[] = []
  alive = true
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
  '🔴 a real Claude child calls give_work, then message_agent, and both transcripts show it',
  { timeout: 300_000 },
  async () => {
    const token = claudeKeychainTokenProvider()
    expect(token() !== null, 'a live demonstration needs a live machine login').toBe(true)

    const scratch = runScratch('agent-spawns-agent')
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
      // ⚑ **The real adapter, the real `query`, and the Keychain bridge** — the same three the
      // shipped app uses. The only thing this rig substitutes is where the homes live.
      createRuntime: (): AgentRuntime => new ClaudeRuntime(undefined, undefined, token),
      prepareProviderHome: async (provider: Provider, profileId: string) => {
        const home = join(managedRoot, `347-${profileId}-${process.pid}-${Date.now()}`)
        await provisionProviderHome(managedRoot, home)
        homes.push(home)
        return home
      },
      providerHomePath: (_provider, profileId) => join(managedRoot, `347-${profileId}`),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
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
        { provider: 'claude', profileId: 'worker', cwd: work, model: CHEAP },
        window,
      )
      await host.close(worker0.sessionId, window)
      // ⚑ **D-016 · the model the child runs on is a person's choice for its agent** — a give takes
      // no model, so without one the child would run on the provider's default. ⚑ Made through the
      // person's own door, which checks it against the list the provider gives (no turn, no
      // tokens) — and Claude's list names the cheap model by its alias, {@link CHEAP_LISTED}.
      const chose = await host.setAgentModelAndEffort('worker', {
        provider: 'claude',
        model: CHEAP_LISTED,
        effort: null,
      })
      expect(chose, 'a person chose the child’s model').toMatchObject({ ok: true })
      say(`1 · identity 'worker' exists (session ${worker0.sessionId}, closed), on ${CHEAP_LISTED}`)

      // ── 2 · a parent that may give it work ──────────────────────────────────────────────────
      const parentSink = new Recorder('webContents:2')
      const parent = await host.createSession(
        {
          provider: 'claude',
          profileId: 'pm',
          cwd: work,
          model: CHEAP,
          // ⚠️ **`auto`, and said out loud.** MCP tools reach `canUseTool` like every other
          // consequential call — 347 deliberately did NOT add them to `allowedTools` — so under
          // `ask` this exchange would stop on a permission prompt with nobody to answer it. That
          // is the tools being gated exactly as everything else is, not an exemption.
          approvalMode: 'auto',
        },
        parentSink,
      )
      say(`2 · parent ${parent.sessionId} running, pm may give worker work`)

      // ── 3 · one turn, naming the tools by intent and not by hand ────────────────────────────
      const before = new Set(host.sessionIds)
      await host.send(
        parent.sessionId,
        `You are running inside an app that gives you tools for managing other agents. ` +
          `Give the agent "worker" one piece of work, titled "347 live demonstration", whose brief ` +
          `is: wait for my next message. Then send that agent a note whose text is exactly: ` +
          `reply with ${MARKER}. Do those two things and then stop. Do not use any other tool.`,
        parentSink,
      )
      say('3 · turn sent; waiting for the parent to give a child work…')

      const appeared = await until('a child session', 180_000, () =>
        host.sessionIds.some((id) => !before.has(id)),
      )
      const child = host.sessionIds.find((id) => !before.has(id))
      say(`   child: ${child ?? 'NONE'}`)

      // ── 4 · what the two transcripts say ────────────────────────────────────────────────────
      expect(appeared, 'the parent started a child').toBe(true)
      expect(child, 'a child session id').toBeDefined()

      /**
       * ⛔ **Re-read every time, never captured once.** The first version of this file read the
       * parent's tool calls the moment the CHILD appeared and then asserted `message_agent` against
       * that list several seconds later — so it was asking whether the second act had happened using
       * a snapshot taken before it could have. It reported a live run that had in fact worked as a
       * product failure. ⚠️ *Assert in the gap* means asserting at the right moment, not caching one.
       */
      const parentToolCalls = (): string[] =>
        store
          .events(parent.sessionId)
          .map((one) => one.event)
          .filter(
            (one): one is Extract<TranscriptEvent, { type: 'tool_call' }> =>
              one.type === 'tool_call',
          )
          .map((one) => one.name)

      // ⛔ **The parent's half of "the exchange renders in both transcripts"** — the MCP calls are
      // ordinary tool rows, qualified `mcp__<server>__<tool>` (327 measured that spelling on both
      // providers). Nothing had to be added to the transcript for this to be true.
      await until('give_work in the parent transcript', 60_000, () =>
        parentToolCalls().some((name) => name.includes('give_work')),
      )
      say(`4 · parent tool calls after the give: ${JSON.stringify(parentToolCalls())}`)
      expect(parentToolCalls().some((name) => name.includes('give_work'))).toBe(true)

      const called = await until('message_agent in the parent transcript', 180_000, () =>
        parentToolCalls().some((name) => name.includes('message_agent')),
      )
      const spokeTo = await until('the child to be given the message', 60_000, () =>
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
      expect(spokeTo, 'the child was given the message').toBe(true)
      // ⛔ **The child's half**: the words the parent chose are in the CHILD's ledger.
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
      expect(pieces[0]?.title).toContain('347')

      say(`✅ criterion 1: ${parent.sessionId} gave ${child} work and spoke to it, live.`)
      say(`   evidence: ${runEvidence('347-live.txt')}`)
    } finally {
      await host.closeAll()
      db.close()
      for (const home of homes) rmSync(home, { recursive: true, force: true })
    }
  },
)
