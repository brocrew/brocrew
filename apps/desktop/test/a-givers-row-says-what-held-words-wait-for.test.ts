import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeProviderSessions,
  FakeRuntime,
  type FakeSessionHandle,
  type SessionHandle,
} from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import type {
  RuntimeEventMessage,
  SessionLiveness,
  SessionLivenessMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * # The giver's `list_tasks` row says what the words held for its helper wait for
 *
 * Words an agent sends a Claude helper whose sign-in the Mac has moved on from are held until this
 * app reopens the helper on the current sign-in. Two of the holds wait for a person: the helper is
 * planning (a reopen would end the plan), or this app already reopened it moments ago and it read
 * as moved on again (the loop guard). The sender's receipt and the window's bar said why; the
 * giver's `list_tasks` row said only *waiting*. ⚑ The row carries `held_because` in both cases, in
 * the receipt's words, and says it on its line. ⚑ Controls: a helper whose sign-in never moved
 * carries none, and the row stops saying it once the held words go in.
 */

class RecordingSink implements RuntimeEventSink {
  // 349 · this double stands in for a WINDOW — the tests below answer for a person through it.
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  readonly liveness: SessionLiveness[] = []
  alive = true

  constructor(readonly ownerId = 'owner:1') {}

  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }

  sendLiveness(message: SessionLivenessMessage): void {
    this.liveness.push(message.liveness)
  }

  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }

  types(): string[] {
    return this.events().map((event) => event.type)
  }
}

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * A stand-in for the adapter's own credential watch, with the same two properties that matter: it
 * LATCHES, and looking costs something (so the count tells us where the host looks).
 *
 * ⚠️ **`check` is asynchronous, like the thing it stands in for** (149). The real one shells out to
 * `security`, and 148 H4 is that it used to do so on the calling thread; a synchronous double could
 * not catch a host that awaited it in the wrong place — or failed to await it at all.
 */
class Watch {
  moved = false
  latched = false
  looks = 0
  /** Set to have the credential move DURING an interrupt — the 148 M1 window, on demand. */
  movesOnInterrupt = false

  async check(): Promise<boolean> {
    this.looks++
    if (this.moved) this.latched = true
    return this.latched
  }
}

/** `FakeRuntime`, with every handle it hands out wired to `watch` (Codex-shaped handles have none). */
class WatchedRuntime extends FakeRuntime {
  constructor(
    provider: Parameters<typeof FakeRuntime.prototype.start> extends never
      ? never
      : ConstructorParameters<typeof FakeRuntime>[0],
    private readonly watch: Watch,
    /** ⚑ What the provider issued, shared by every runtime of a test, so a reopen can resume. */
    sessions: FakeProviderSessions,
    private readonly handles: FakeSessionHandle[],
  ) {
    super(provider, { sessions })
  }

  private wire<T extends SessionHandle>(handle: T): T {
    Object.defineProperty(handle, 'signInSuperseded', {
      get: () => this.watch.latched,
      configurable: true,
    })
    Object.defineProperty(handle, 'checkSignIn', {
      value: async () => this.watch.check(),
      configurable: true,
    })
    // The 148 M1 fixture: `sendInterrupting` checks, then awaits an interrupt — for at most the
    // host's interrupt wait since 709 — and up to five seconds of `waitForIdle` before it sends. This is what puts a credential move inside that window.
    const interrupt = handle.interrupt.bind(handle)
    Object.defineProperty(handle, 'interrupt', {
      value: async () => {
        if (this.watch.movesOnInterrupt) this.watch.moved = true
        return interrupt()
      },
      configurable: true,
    })
    return handle
  }

  override async start(
    ...args: Parameters<FakeRuntime['start']>
  ): ReturnType<FakeRuntime['start']> {
    const handle = this.wire(await super.start(...args))
    this.handles.push(handle)
    return handle
  }

  override async resume(
    ...args: Parameters<FakeRuntime['resume']>
  ): ReturnType<FakeRuntime['resume']> {
    const handle = this.wire(await super.resume(...args))
    this.handles.push(handle)
    return handle
  }
}

const THE_SIGN_IN_CHANGED = 'Its Claude sign-in changed after it started.'

describe('the giver’s list_tasks row says what held words wait for', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let window: RecordingSink
  let watch: Watch
  let handles: FakeSessionHandle[]
  let store: ReturnType<typeof createSessionStore>

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-held-row-'))
    watch = new Watch()
    handles = []
    const sessions = new FakeProviderSessions()
    let counter = 0
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider) => new WatchedRuntime(provider, watch, sessions, handles),
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink()
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const tool = (from: string, name: string) => {
    const found = agentToolsFor(host, from).tools.find((one) => one.name === name)
    if (found === undefined) throw new Error(`no ${name} tool`)
    return found
  }

  /** A giver in a window, and a Claude helper it gave one piece to. */
  async function aGiverAndItsHelper(): Promise<{ giver: string; helper: string; label: string }> {
    store.createAgentIdentity(
      { slug: 'helper', displayName: null, provider: 'claude' },
      { by: 'a-person' },
    )
    const giver = (await host.createSession({ provider: 'claude', approvalMode: 'auto' }, window))
      .sessionId
    const given = await tool(giver, 'give_work').call({
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'helper',
      title: 'Build the index',
      brief: 'build the index',
    })
    const structured = given.structured as { outcome: string; agent: string; label: string }
    expect(structured.outcome, JSON.stringify(given.structured)).toBe('ok')
    await waitFor(() => handles.length >= 2, 'the helper to start')
    return { giver, helper: structured.agent, label: structured.label }
  }

  /** The giver's row for its piece, and its line, as `list_tasks` hands them back. */
  async function theRow(
    giver: string,
    label: string,
  ): Promise<{ row: Record<string, unknown>; line: string }> {
    const listed = await tool(giver, 'list_tasks').call({})
    const gave = (listed.structured as { you_gave?: Record<string, unknown>[] }).you_gave ?? []
    const row = gave.find((one) => one['label'] === label)
    if (row === undefined) throw new Error(`no row for ${label}`)
    const line = listed.text.split('\n').find((one) => one.includes(`${label} ·`)) ?? ''
    return { row, line }
  }

  const note = async (giver: string, label: string, text: string) =>
    await tool(giver, 'message_agent').call({ agent: label, text, kind: 'note' })

  /** ⚑ The helper was started again: a reopen is a new life, and its handle is the newest. */
  const startedAgain = (lives: number): boolean => handles.length > lives

  it('🔴 planning: the row says the held words wait for a person to end the plan', async () => {
    const { giver, label } = await aGiverAndItsHelper()
    await handles.at(-1)!.setPlanMode(true)
    watch.moved = true
    const said = await note(giver, label, 'a note for a planner')

    const { row, line } = await theRow(giver, label)
    expect(row['held_because']).toBe(
      `${THE_SIGN_IN_CHANGED} This app reopens it on the current one once a person ends its planning, since a reopen would end that; what is held for it goes in then. A person can reopen it sooner.`,
    )
    expect(line).toContain(
      `what is held for the conversation holding it waits: ${row['held_because']}`,
    )
    // ⚑ One account of one hold: the receipt said the same words.
    expect(said.text).toContain(row['held_because'] as string)
  })

  it('🔴 the loop guard: the row says the held words wait for a person to reopen it', async () => {
    const { giver, helper, label } = await aGiverAndItsHelper()
    const lives = handles.length
    watch.moved = true
    // ⚑ The first note: this app reopens the helper on the current sign-in for it.
    await note(giver, label, 'the first note')
    await waitFor(() => startedAgain(lives), 'this app to reopen the helper')
    // ⚑ The reopened life holds a moved sign-in too, so what is held stays held: the loop guard.
    await waitFor(
      () => (host.whyWhatIsHeldWaits(helper) ?? '').includes('moments ago'),
      'the loop guard to hold what is held',
    )
    const said = await note(giver, label, 'the second note')

    const { row, line } = await theRow(giver, label)
    expect(row['held_because']).toBe(
      `${THE_SIGN_IN_CHANGED} This app reopened it on the current one moments ago, and it read as moved on again before it ever read as current, so this app does not reopen it again within 10 minutes of that reopen; until then, what is held for it waits for a person to reopen it.`,
    )
    expect(line).toContain(
      `what is held for the conversation holding it waits: ${row['held_because']}`,
    )
    expect(said.text).toContain(row['held_because'] as string)
  })

  it('⚑ control: with the sign-in unchanged, a helper that is planning carries no held_because', async () => {
    const { giver, label } = await aGiverAndItsHelper()
    await handles.at(-1)!.setPlanMode(true)
    await note(giver, label, 'an ordinary note')
    const { row, line } = await theRow(giver, label)
    expect(row).not.toHaveProperty('held_because')
    expect(line).not.toContain('what is held for the conversation holding it waits')
  })

  it('⚑ control: once the planning ends and the held words go in, the row no longer says held_because', async () => {
    const { giver, helper, label } = await aGiverAndItsHelper()
    const lives = handles.length
    await handles.at(-1)!.setPlanMode(true)
    watch.moved = true
    await note(giver, label, 'a note for a planner')
    expect((await theRow(giver, label)).row).toHaveProperty('held_because')

    // ⚑ The planning ends, and the Mac's sign-in reads as current to the life a reopen makes.
    await handles.at(-1)!.setPlanMode(false)
    watch.moved = false
    watch.latched = false
    // ⚑ The next words ask again: nothing is lost now, so this app reopens it and both go in.
    await note(giver, label, 'and one more')
    await waitFor(() => startedAgain(lives), 'this app to reopen the helper')
    await waitFor(() => host.whyWhatIsHeldWaits(helper) === null, 'the held words to go in')
    const { row, line } = await theRow(giver, label)
    expect(row).not.toHaveProperty('held_because')
    expect(line).not.toContain('what is held for the conversation holding it waits')
  })
})
