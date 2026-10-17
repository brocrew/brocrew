import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { AgentToolset, FakeRuntime, FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { MessagingRefused } from '../src/main/runtime/message-rails'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentCallerId, agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { anOpenGate, ProviderDouble, type ResumeGate } from './lib/provider-double'

/**
 * 🔴 **D-016a · `692` M14 · the boundary wall is asked BEFORE a stopped conversation is started**
 *
 * ⚑ **The rule.** A message to a conversation that is not running is refused by every wall a
 * message meets, and it is refused BEFORE the start — a refusal spends no provider launch
 * ({@link RuntimeHost}'s `refuseBeforeAStart`, asked ahead of `ensureRunning`).
 *
 * ⛔ **Why the existing tests could not see the reach wall there.** Every one of them refuses an
 * out-of-reach caller with `withinMessagingReach`, which answers *unknown session* for a caller
 * that neither commands the child nor holds a grant — earlier than the wall itself. ⚑ **The one
 * caller only the wall refuses is a COMMANDER whose own grant says it may message nobody**: it
 * commands its own child (so `withinMessagingReach` admits it through `mayCommand`, whatever the
 * grant), and `assertMayReach('message', …)` is the only line that turns it away. ⚠️ Without that
 * line the message still ends in the same refusal — the gate inside `queueAs` asks the same
 * wall — but only AFTER a provider has been launched for it, so the property is a COUNT of
 * launches and not the refusal.
 *
 * ⚑ **One host, a real quit and relaunch with a real child — started by the lead's own `give_work`
 * (D-016: the one door that starts a child) — and the host's own door asked directly** (a tool door
 * asks the argument-independent reach wall first and would hide the very line under test). The only
 * double is the provider.
 */

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

describe('D-016a · a commander narrowed off messaging spends no launch on its stopped child', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let gate: ResumeGate
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const runtime = (provider: Provider): FakeRuntime =>
      new ProviderDouble(provider, handles, issued, gate)
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: runtime,
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-m14-wall-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-m14-wall-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 19_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    hosts = []
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /** Bounded, and it waits on the THING. */
  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** ⚑ A real macrotask pause, so a negative is measured after whatever was queued has run. */
  const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60))

  /** An identity exists only once a person has run a conversation as it (341 criterion 12). */
  const bringIntoBeing = async (profileId: string): Promise<void> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    await host.close(sessionId, window)
  }

  /**
   * ⚑ **A lead a person opened, a child its own `give_work` started, a graceful quit, and the next
   * launch** — its own store object over the same database, as `a-restart-keeps-what-was-open`
   * does. ⚑ The person presses the lead's row; the child is stopped, and the lead still commands it.
   * ⚠️ **D-016 · the child starts on the piece's brief**, so the give is waited out to its turn
   * before the quit — a stop under a launch still on its way in is not the fixture this file needs.
   */
  const aLeadAndItsStoppedChild = async (): Promise<{ lead: string; child: string }> => {
    await bringIntoBeing('kid')
    const { sessionId: lead } = await host.createSession(
      { provider: 'claude', profileId: 'lead', approvalMode: 'ask', cwd: root },
      window,
    )
    const given = await callOn(agentToolsFor(host, lead), 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'kid',
      title: 'The half of the work',
      brief: 'the half of the work the lead handed over',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    expect(given.started).toBe(true)
    const child = given.agent as string
    await waitFor(
      () => store.events(child).some((entry) => entry.event.type === 'user_turn'),
      'the brief to reach the child as its turn',
    )
    await host.closeAll()
    store = createSessionStore(db, tick)
    host = buildHost()
    await host.resumeSession(lead, window)
    return { lead, child }
  }

  const asTheLead = (lead: string, child: string): ReturnType<RuntimeHost['queueMessage']> =>
    host.queueMessage(
      child,
      'are you there',
      { ownerId: agentCallerId(lead) },
      [],
      'work',
      {},
      'follow-up',
    )

  it('🔴 a commander whose grant says it may message nobody is refused by the reach wall, and no provider is launched for it', async () => {
    const { lead, child } = await aLeadAndItsStoppedChild()
    // ⚑ **It still COMMANDS the child** — the grant narrows what it may message, and nothing here
    // took the child away from it, which is why `withinMessagingReach` lets it through to the wall.
    expect(store.setCapabilities('lead', { canMessage: 'none' })).toBe(true)
    const before = handles.length

    const refused = await asTheLead(lead, child).then(
      () => null,
      (error: unknown) => error,
    )
    expect(refused, 'the message was not refused').toBeInstanceOf(MessagingRefused)
    expect((refused as MessagingRefused).refusal.rail).toBe('may-not-message')
    await letItSettle()
    // ⛔ **The count is the property**: the refusal is the same either way, the launch is not.
    expect(handles.length - before, 'a provider was launched for a message the wall refuses').toBe(
      0,
    )
  })

  it('⚑ the RUNNING child refuses the same commander by the same wall — the stopped one is asked what it would be asked running', async () => {
    const { lead, child } = await aLeadAndItsStoppedChild()
    // ⚑ The control: a person presses the child's row so it RUNS, THEN the lead is narrowed — the
    // running child's own gate.
    await host.resumeSession(child, window)
    expect(store.setCapabilities('lead', { canMessage: 'none' })).toBe(true)
    const before = handles.length

    const refused = await asTheLead(lead, child).then(
      () => null,
      (error: unknown) => error,
    )
    expect(refused).toBeInstanceOf(MessagingRefused)
    expect((refused as MessagingRefused).refusal.rail).toBe('may-not-message')
    await letItSettle()
    expect(handles.length - before).toBe(0)
  })

  it('⚑ the same commander, its grant one step over, starts the stopped child — the launch is spent on a message the walls admit', async () => {
    const { lead, child } = await aLeadAndItsStoppedChild()
    expect(store.setCapabilities('lead', { canMessage: 'none' })).toBe(true)
    const before = handles.length
    await expect(asTheLead(lead, child)).rejects.toBeInstanceOf(MessagingRefused)
    await letItSettle()
    expect(handles.length - before).toBe(0)

    // ⚑ **THE PAIR**: the same call, the same caller, the same stopped child — with the grant it
    // had. It is admitted, and it DOES start the child.
    expect(store.setCapabilities('lead', { canMessage: 'any' })).toBe(true)
    await expect(asTheLead(lead, child)).resolves.toMatchObject({ outcome: 'sent' })
    expect(handles.length - before, 'the admitted message did not start the child').toBe(1)
  })
})
