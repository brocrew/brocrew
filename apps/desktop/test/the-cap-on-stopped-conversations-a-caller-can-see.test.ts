import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { CallerIdentity, RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { CONVERSATIONS_LISTED, agentCallerId } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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

class ToolWatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

/**
 * # 🔴 D-017 · the cap on the conversations a caller can see
 *
 * ⚑ **§1 pins `agentsVisibleTo`'s cut** (`runtime-host.ts`). ⚑ **D-017 · R12 — it is ONE list
 * now** (`5206d835`): every conversation the caller may reach, running and stopped alike, newest
 * activity first, cut at {@link CONVERSATIONS_LISTED}, with `notListed` saying how many more there
 * are. ⛔ It was (`45a11477`) the running slots PLUS up to a separate cap of stopped ones — so
 * whether one runs no longer buys it a place: a running conversation whose last activity is the
 * oldest is cut like any other. ⛔ **No existing test can tell 50 from 51** — nothing else creates
 * more than the cap's worth of reachable conversations, so an off-by-one on the slice bound is
 * invisible everywhere else.
 *
 * ⚑ **D-017b · its §2 went with `kept-open.ts`** — it pinned `whatTheFirstMessagePaneSays`, the
 * kept-open pane's sentence for a first message that TOOK its conversation rather than started it.
 * There is no such pane any more: a conversation opens in its one full view, and a message's refusal
 * is the host's own sentence, said on the conversation's record (`session-store.ts`' `startAndSend`).
 */
describe('D-017 · the cap on the conversations a caller can see', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-cap-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-cap-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'auto', cwd: root },
      window,
    )
    return sessionId
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /** ⚑ In the order the list gives them — newest activity first is part of what §1 pins. */
  const listedBy = async (
    toolset: AgentToolset,
  ): Promise<{ ids: string[]; notListed: unknown }> => {
    const listed = (await callOn(toolset, 'list_agents', {})) as {
      agents: { agent: string }[]
      notListed: unknown
    }
    return { ids: listed.agents.map((one) => one.agent), notListed: listed.notListed }
  }

  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })

  // ───────────────────────────────────────────────────────────────────────────────
  // §1 · the cap itself
  // ───────────────────────────────────────────────────────────────────────────────

  it('list_agents (and agentsVisibleTo) lists at most CONVERSATIONS_LISTED conversations, running and stopped alike, the caller’s own first, then newest activity first — dropping the oldest and counting them', async () => {
    // ⚑ The caller, running — and, opened first, the OLDEST activity of all.
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const tools = theToolsetJustHandedOut()

    // ⚑ Open-and-immediately-close CONVERSATIONS_LISTED distinct identities, in strict sequence, so
    // each Close lands on a strictly increasing `updated_at` via the shared tick clock — the SAME
    // clock the host and the store share (`now: tick`), so the order these conversations were
    // closed IN is the order the list reads them back OUT in.
    const stopped: string[] = []
    for (let i = 0; i < CONVERSATIONS_LISTED; i++) {
      const worker = await personOpens(`worker${String(i)}`)
      await host.close(worker, window)
      stopped.push(worker)
    }
    expect(stopped).toHaveLength(CONVERSATIONS_LISTED)
    // ⚑ And one more, left RUNNING — the NEWEST activity. 52 reachable: two running, fifty stopped.
    const newest = await personOpens('the-newest')
    expect(host.sessionIds).toEqual(expect.arrayContaining([brobot, newest]))
    expect(host.sessionIds).not.toContain(stopped[0])

    const { ids, notListed } = await listedBy(tools)
    // ⚑ Exactly the cap — never one more — and the answer counts the two it left out.
    expect(ids).toHaveLength(CONVERSATIONS_LISTED)
    expect(notListed).toBe(2)
    // ⚑ **The caller's own conversation comes first, whatever its activity** — `list_agents`
    // promises it lists "your own", so the cap never cuts it — **then one order by recency alone**:
    // the running newest, then the stopped ones most recently closed first, running and stopped
    // alike.
    expect(ids).toEqual([brobot, newest, ...stopped.slice(2).reverse()])
    // ⛔ **The negative half**: the two first-closed workers are the oldest, and the cap drops them —
    // together with the positive half this shows the cut is by recency and not an arbitrary count
    // or an off-by-one that would still admit one of them.
    expect(ids).not.toContain(stopped[0])
    expect(ids).not.toContain(stopped[1])

    // ⚑ The reader `list_agents` IS, asked directly, agrees with the tool's own answer — order and
    // count alike.
    const visible = host.agentsVisibleTo(speakingAs(brobot), brobot)
    expect(visible.agents.map((card) => card.agent)).toEqual(ids)
    expect(visible.notListed).toBe(2)
  })
})
