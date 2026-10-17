import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  ClaudeRuntime,
  CodexRuntime,
  codexAuthHealth,
  claudeKeychainTokenProvider,
  provisionCodexAuth,
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
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'

/**
 * ⚑ **584 · a LOCAL constant** (`HO-078` §1). ⛔ `PROJECT_MANAGER_PROFILE_ID` named the one other
 * identity this app used to ship, and a fresh install now ships `brobot` and nothing else — so the
 * slug is a name somebody CREATES, which is what this file drives it as.
 */
const PROJECT_MANAGER_PROFILE_ID = 'project-manager'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { runScratch } from '../../../packages/runtime/smoke/run-paths'

/**
 * 🔴 **456 · which verb a real model reaches for, after the copy moved.**
 *
 * ## ⛔ The one fact construction cannot reach
 *
 * ⚠️ **Everything else in `456` is decidable in the unit suite**: the two sentences and the labels.
 * ⛔ **Whether a model now picks the right verb FIRST is a model-behaviour fact**, and it is the only
 * reason the copy moved at all.
 *
 * ## ⚑ The before, measured — `445`'s five live arms, read out of their own ledgers
 *
 * | arm | BroBot's first agent-bringing verb | what happened |
 * |---|---|---|
 * | Codex 1 | `create_agent` | → `agent-name-taken`, then `spawn_agent` ✔ |
 * | Codex 2 | `spawn_agent` ✔ | — |
 * | Codex 3 | `create_agent` | **succeeded**, then `spawn_agent` → `not-in-can-spawn`; a durable orphan |
 * | Claude 1 | `create_agent` | `malformed-request`, `agent-name-taken`, …, `spawn_agent` ✔ after four refusals |
 * | Claude 2 | `create_agent` | → `agent-name-taken`, then `spawn_agent` ✔ |
 *
 * ⛔ **Four of five, on both providers** — so the brief's premise that *"Codex chose correctly on all
 * three arms"* is not what the Codex ledgers say, and standing rule 1 is why this table is derived
 * from them rather than restated.
 *
 * ⚑ **D-016 · the second verb is `give_work` now**, in `spawn_agent`'s place: one call that brings
 * the agent into existence (with `new`), starts its conversation and hands it the work. ⚠️ So the
 * question is the same one — does a model reach for the verb that does the whole job first, or for
 * `create_agent` — and the table above is the before it is read against.
 *
 * ## ⚠️ What is held fixed, so the only variable is the copy
 *
 *  - ⛔ **The brief is `445`'s own, word for word** — *"Put one agent to work on this, running as
 *    `project-manager`"* — which is the wording its final arms ran, and which names no verb.
 *  - ⛔ **The models are `445`'s** — `claude-haiku-4-5-20251001` and `gpt-5.6-sol`.
 *  - ⛔ **The grants are the one default set every agent holds** (D-014): BroBot may create an agent
 *    and give any agent work, so both verbs are open to it and neither is pushed.
 *  - ⚑ **The second conversation, not the first.** The first is a handshake that writes BroBot's
 *    identity row, so the grants are read back before the measured turn.
 *
 * ## 🔴 It REPORTS and does not gate
 *
 * ⛔ **A model that still reaches for `create_agent` is evidence about the model, not a red.** This
 * asserts only that a conversation ran and chose one of the two inside its bound; which one it chose
 * is printed, and the response is computed from that (`a-report-must-be-computed-from-the-outcome`).
 * ⚠️ **Every wait is bounded and a miss prints NOT PERFORMED** (standing rule 13).
 *
 * ## ⚠️ What this costs and what it touches
 *
 * ⛔ **One BroBot turn per provider on `445`'s model.** ⛔ **Nothing is read, copied or written under
 * a person's `provider-homes/`, and no `auth.json` is opened by this file**: Claude's machine login
 * is injected transiently from the Keychain by the adapter's own path, and the Codex arm runs
 * `provisionCodexAuth` — **the product's own copy-once path, the same one `main/index.ts` performs on
 * every launch and the same one `lifecycle-stage.smoke.ts` calls** — against a home provisioned fresh
 * under this run's own root. ⚑ Every home is removed afterwards.
 */

const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'
const CODEX_MODEL = 'gpt-5.6-sol'

/** ⛔ **The two verbs the measurement is about, and nothing else is counted.** */
const VERBS_THAT_BRING_ONE_INTO_BEING = ['create_agent', 'give_work'] as const

/**
 * ⚑ **`445`'s own words, and it names no verb.** The whole measurement is what a model does with a
 * need it has to satisfy through a tool it was never pointed at.
 */
const BRIEF = [
  'DEV-75297 — the login flow is flaky on Chromium.',
  '',
  'Do exactly these things, then stop and wait:',
  '1. Put one agent to work on this, running as `' + PROJECT_MANAGER_PROFILE_ID + '`.',
  '2. Send that agent one message telling it the ticket and asking it to investigate.',
  '3. Stop. Do not investigate anything yourself.',
].join('\n')

class Recorder implements RuntimeEventSink {
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(
    readonly ownerId: string,
    readonly aPersonIsBehindIt = true,
  ) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

const say = (line: string): void => {
  console.log(`[456] ${line}`)
}

/** ⛔ **Bounded, and it reports rather than throwing** — the caller decides what a miss means. */
const until = async (what: string, ms: number, ready: () => boolean): Promise<boolean> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (ready()) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  say(`⛔ NOT PERFORMED · ${what} · deadline ${String(ms)}ms passed`)
  return false
}

interface Arm {
  readonly provider: Provider
  readonly model: string
  readonly runtime: () => AgentRuntime
  readonly homeEnv: string
  readonly codex: boolean
}

const drive = async (arm: Arm): Promise<void> => {
  const scratch = runScratch(`456-${arm.provider}`)
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
      const home = join(
        managedRoot,
        `456-${profileId}-${String(process.pid)}-${String(Date.now())}`,
      )
      await provisionProviderHome(managedRoot, home)
      // ⚑ **The product's own copy-once path, called exactly where the lifecycle stage calls it.**
      if (arm.codex) await provisionCodexAuth(home)
      homes.push(home)
      return home
    },
    providerHomePath: (_provider, profileId) => join(managedRoot, `456-${profileId}`),
    resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
    newSessionId: () => `sess_${String(++counter)}`,
    readProviderConfig: (_provider, home) => ({
      home,
      homeEnv: arm.homeEnv,
      model: 'live',
      authNote: null,
      files: [],
    }),
  })

  try {
    // ── 1 · the handshake that writes the identity row, and is then closed ────────────────────
    // ⚑ The row is what the grants are read back from; the measurement belongs on the second one.
    const first = new Recorder('webContents:1')
    const handshake = await host.createSession(
      { provider: arm.provider, profileId: DEFAULT_PROFILE_ID, cwd: work, model: arm.model },
      first,
    )
    await host.close(handshake.sessionId, first)
    const held = store.capabilitiesOf(DEFAULT_PROFILE_ID)
    say(`1 · ${arm.provider}: BroBot's grants · ${JSON.stringify(held)}`)
    // ⚠️ The premise this whole measurement rests on: BroBot holds the one default set, so both
    // verbs are open to it and a model that picks the wrong one is choosing rather than being pushed.
    expect(held, 'BroBot holds the one default set').toEqual(DEFAULT_CAPABILITIES)

    // ── 2 · the conversation the measurement is on ────────────────────────────────────────────
    const sink = new Recorder('webContents:2')
    const brobot = await host.createSession(
      {
        provider: arm.provider,
        profileId: DEFAULT_PROFILE_ID,
        cwd: work,
        model: arm.model,
        approvalMode: 'auto',
      },
      sink,
    )
    say(`2 · ${arm.provider}: BroBot is ${brobot.sessionId}; sending a brief that names no verb`)
    await host.send(brobot.sessionId, BRIEF, sink)

    // ── 3 · the first verb it reaches for ─────────────────────────────────────────────────────
    const chosen = (): { verb: string; ordinal: number } | null => {
      for (const entry of store.events(brobot.sessionId)) {
        const event = entry.event
        if (event.type !== 'tool_call') continue
        const verb = VERBS_THAT_BRING_ONE_INTO_BEING.find((one) => event.name.endsWith(one))
        if (verb !== undefined) return { verb, ordinal: entry.ordinal }
      }
      return null
    }
    const picked = await until('BroBot to reach for a verb', 300_000, () => chosen() !== null)
    const first_ = chosen()
    say(
      `3 · ${arm.provider}: FIRST VERB = ${first_?.verb ?? 'NONE'} (ordinal ${String(
        first_?.ordinal ?? -1,
      )})`,
    )

    // ⛔ **Wait for the TURN to end before reading the trail** — found by this probe's own first
    // run, which printed *"the whole trail"* about a conversation that was still going and so could
    // never show a recovery or an orphan. ⚑ `410`'s shape at the Slice 4 exit: fixing the instrument
    // is the dispatch's job, and a report computed from a partial outcome is the defect standing
    // rule 13's last line names.
    const turnsEnded = (): number =>
      store.events(brobot.sessionId).filter((one) => one.event.type === 'turn').length
    const settled = await until(
      'BroBot to finish the turn',
      300_000,
      () => turnsEnded() > 0 && chosen() !== null,
    )
    say(`3b · ${arm.provider}: turn ended: ${String(settled)} (${String(turnsEnded())} turns)`)

    // ── 4 · everything it did with those two doors, in order ──────────────────────────────────
    const trail: string[] = []
    for (const entry of store.events(brobot.sessionId)) {
      const event = entry.event
      if (
        event.type === 'tool_call' &&
        VERBS_THAT_BRING_ONE_INTO_BEING.some((verb) => event.name.endsWith(verb))
      ) {
        trail.push(`call ${event.name}`)
      }
      if (
        event.type === 'tool_refused' &&
        (VERBS_THAT_BRING_ONE_INTO_BEING as readonly string[]).includes(event.tool)
      ) {
        trail.push(`refused ${event.tool} → ${event.rail}`)
      }
    }
    say(`4 · ${arm.provider}: the whole trail · ${JSON.stringify(trail)}`)

    // ⛔ **The identities that exist afterwards** — the residue `445`'s third Codex arm left and
    // nobody counted. A name created and never startable is the cost HO-020 §4 priced.
    const identities = (
      db.prepare('SELECT slug FROM agent_identity ORDER BY created_at').all() as {
        slug: string
      }[]
    ).map((row) => row.slug)
    say(`5 · ${arm.provider}: identities now · ${JSON.stringify(identities)}`)

    // 🔴 **The only assertion.** It chose one of the two inside its bound; WHICH one is the finding
    // and is reported, never gated — a model-behaviour miss is evidence about the model.
    expect(picked, `${arm.provider}: BroBot reached for a verb inside the bound`).toBe(true)
  } finally {
    await host.closeAll()
    db.close()
    for (const home of homes) rmSync(home, { recursive: true, force: true })
  }
}

it(
  '🔴 Claude · which verb BroBot reaches for, holding the one default set and told no verb',
  { timeout: 900_000 },
  async () => {
    const token = claudeKeychainTokenProvider()
    expect(token() !== null, 'a live measurement needs a live machine login').toBe(true)
    await drive({
      provider: 'claude',
      model: CLAUDE_MODEL,
      runtime: () => new ClaudeRuntime(undefined, undefined, token),
      homeEnv: 'CLAUDE_CONFIG_DIR',
      codex: false,
    })
  },
)

it(
  '🔴 Codex · which verb BroBot reaches for, holding the one default set and told no verb',
  { timeout: 900_000 },
  async () => {
    await drive({
      provider: 'codex',
      model: CODEX_MODEL,
      runtime: () => new CodexRuntime(bundledCodexTransportFactory(), codexAuthHealth),
      homeEnv: 'CODEX_HOME',
      codex: true,
    })
  },
)
